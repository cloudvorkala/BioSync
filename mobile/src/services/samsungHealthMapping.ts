import type { GlucoseReading } from '../models/api';

/** Internal bridge payload only; never part of the backend transport contract. */
export interface SamsungDataPoint {
  uid: string;
  startTime: string;
  glucoseMmolL?: number;
  series?: { timestamp: string; glucoseMmolL: number }[];
  sourcePackage?: string | null;
}

export class SamsungMappingError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = 'SamsungMappingError';
  }
}

function invalid(): never {
  throw new SamsungMappingError(
    'SAMSUNG_INVALID_DATA',
    'Samsung Health returned an invalid glucose record. No readings were submitted.',
  );
}

function utc(value: string): string {
  const parts =
    typeof value === 'string'
      ? /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,3}))?(Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.exec(
          value,
        )
      : null;
  if (!parts || !Number.isFinite(Date.parse(value))) {
    return invalid();
  }
  // Reject calendar rollover (e.g. February 30) instead of Date's normalization.
  const wallClock = `${parts[1]}.${(parts[2] ?? '').padEnd(3, '0')}Z`;
  if (new Date(wallClock).toISOString() !== wallClock) {
    return invalid();
  }
  return new Date(value).toISOString();
}

export interface SamsungReadResult {
  readings: GlucoseReading[];
  /** Local diagnostic lookup; deliberately separate from each domain reading. */
  sourcePackages: Record<string, string>;
}

/** Flatten SDK series, then enforce [start, end) on actual sample timestamps.
 * GLUCOSE_LEVEL for a series is an average, not an additional measurement.
 * Dedup only exact source samples; conflicting timestamps fail explicitly.
 */
export function mapSamsungReadings(
  points: SamsungDataPoint[],
  start: Date,
  end: Date,
): SamsungReadResult {
  if (!Array.isArray(points)) {
    return invalid();
  }
  const readings: GlucoseReading[] = [];
  const sourcePackages: Record<string, string> = {};
  const seen = new Set<string>();
  const valuesAtTime = new Map<string, number>();
  for (const point of points) {
    if (!point || typeof point.uid !== 'string' || !point.uid.trim()) {
      return invalid();
    }
    if (point.series !== undefined && !Array.isArray(point.series)) {
      return invalid();
    }
    const isSeries = !!point.series?.length;
    const samples = isSeries
      ? point.series!
      : [{ timestamp: point.startTime, glucoseMmolL: point.glucoseMmolL }];
    for (const sample of samples) {
      if (!sample) {
        return invalid();
      }
      const measured_at = utc(sample.timestamp);
      const time = Date.parse(measured_at);
      if (time < start.getTime() || time >= end.getTime()) {
        continue;
      }
      const value_mmol_l = sample.glucoseMmolL;
      if (typeof value_mmol_l !== 'number' || !Number.isFinite(value_mmol_l)) {
        return invalid();
      }
      if (
        valuesAtTime.has(measured_at) &&
        valuesAtTime.get(measured_at) !== value_mmol_l
      ) {
        throw new SamsungMappingError(
          'CONFLICTING_GLUCOSE_READINGS',
          'Samsung Health contains different glucose values at the same timestamp. Check the source records; no values were chosen or overwritten.',
        );
      }
      valuesAtTime.set(measured_at, value_mmol_l);
      const source_record_id = isSeries
        ? `${encodeURIComponent(point.uid)}:series:${measured_at}`
        : point.uid;
      const key = JSON.stringify([source_record_id, measured_at, value_mmol_l]);
      if (!seen.has(key)) {
        seen.add(key);
        readings.push({
          source: 'samsung_health',
          source_record_id,
          measured_at,
          value_mmol_l,
        });
      }
      if (typeof point.sourcePackage === 'string' && point.sourcePackage) {
        // Key by source sample, never place metadata in the API reading object.
        sourcePackages[source_record_id] = point.sourcePackage;
      }
    }
  }
  readings.sort(
    (a, b) =>
      Date.parse(a.measured_at) - Date.parse(b.measured_at) ||
      a.source_record_id.localeCompare(b.source_record_id),
  );
  return { readings, sourcePackages };
}
