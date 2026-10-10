import type { RecordResult } from 'react-native-health-connect';
import type { GlucoseReading } from '../models/api';

/** v4 read results, not the library's differently shaped write records. */
export function mapBloodGlucoseRecord(
  record: RecordResult<'BloodGlucose'>,
): GlucoseReading {
  const id = record.metadata?.id;
  const value = record.level?.inMillimolesPerLiter;
  // Require an explicit offset. Native Instant strings normally end in Z.
  const timestamp =
    typeof record.time === 'string' &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(
      record.time,
    )
      ? Date.parse(record.time)
      : NaN;
  if (
    typeof id !== 'string' ||
    !id.trim() ||
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    !Number.isFinite(timestamp)
  ) {
    throw new Error(
      'Health Connect returned an invalid glucose record or missing record ID.',
    );
  }
  return {
    source: 'health_connect',
    source_record_id: id,
    measured_at: new Date(timestamp).toISOString(),
    // Android's BloodGlucose unit accessor already converts mg/dL to mmol/L.
    value_mmol_l: value,
  };
}
