import {
  getSdkStatus,
  initialize,
  getGrantedPermissions,
  requestPermission,
  readRecords,
  SdkAvailabilityStatus,
} from 'react-native-health-connect';
import type { GlucoseReading } from '../models/api';
import { mapBloodGlucoseRecord } from './healthConnectMapping';

export type HealthAccess = {
  availability: 'unknown' | 'available' | 'unavailable' | 'update_required';
  permission: 'unknown' | 'granted' | 'denied';
};

export class HealthConnectServiceError extends Error {
  constructor(message: string, public readonly access?: HealthAccess) {
    super(message);
    this.name = 'HealthConnectServiceError';
  }
}

/** Queries actual access on each operation; never assumes a previous grant persists. */
export async function getHealthConnectAccess(
  requestAccess = false,
): Promise<HealthAccess> {
  try {
    const sdk = await getSdkStatus();
    if (sdk !== SdkAvailabilityStatus.SDK_AVAILABLE) {
      return {
        availability:
          sdk === SdkAvailabilityStatus.SDK_UNAVAILABLE_PROVIDER_UPDATE_REQUIRED
            ? 'update_required'
            : 'unavailable',
        permission: 'unknown',
      };
    }
    if (!(await initialize())) {
      throw new Error('Initialization failed');
    }
    const permissions = requestAccess
      ? await requestPermission([
          { accessType: 'read', recordType: 'BloodGlucose' },
        ])
      : await getGrantedPermissions();
    return {
      availability: 'available',
      permission: permissions.some(
        p => p.recordType === 'BloodGlucose' && p.accessType === 'read',
      )
        ? 'granted'
        : 'denied',
    };
  } catch {
    throw new HealthConnectServiceError(
      'Cannot access Health Connect. Check its settings and rebuild the app if the native module is missing.',
    );
  }
}

/** Foreground read only. Returns every page, sorted by actual measurement time. */
export async function getBloodGlucoseReadings(
  startTime: Date,
  endTime: Date,
): Promise<GlucoseReading[]> {
  if (
    !Number.isFinite(startTime.getTime()) ||
    !Number.isFinite(endTime.getTime()) ||
    startTime >= endTime
  ) {
    throw new HealthConnectServiceError(
      'Choose a valid time range with the start before the end.',
    );
  }
  const access = await getHealthConnectAccess();
  if (access.availability !== 'available' || access.permission !== 'granted') {
    throw new HealthConnectServiceError(
      'Blood glucose read access is required. Check Health Connect availability and permission.',
      access,
    );
  }
  try {
    const readings: GlucoseReading[] = [];
    const tokens = new Set<string>();
    let pageToken: string | undefined;
    do {
      const page = await readRecords('BloodGlucose', {
        timeRangeFilter: {
          operator: 'between',
          startTime: startTime.toISOString(),
          endTime: endTime.toISOString(),
        },
        ascendingOrder: true,
        pageSize: 1000,
        ...(pageToken ? { pageToken } : {}),
      });
      readings.push(...page.records.map(mapBloodGlucoseRecord));
      pageToken = page.pageToken || undefined;
      if (pageToken && tokens.has(pageToken)) {
        throw new Error('Repeated pagination token');
      }
      if (pageToken) {
        tokens.add(pageToken);
      }
    } while (pageToken);
    return readings.sort(
      (a, b) =>
        Date.parse(a.measured_at) - Date.parse(b.measured_at) ||
        a.source_record_id.localeCompare(b.source_record_id),
    );
  } catch {
    // Permission may be revoked while the native read is in flight.
    const latestAccess = await getHealthConnectAccess();
    throw new HealthConnectServiceError(
      'Could not read valid blood glucose records. Check permission, the selected period, and Health Connect; then retry.',
      latestAccess,
    );
  }
}
