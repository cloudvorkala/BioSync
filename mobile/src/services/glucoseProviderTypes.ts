import type { GlucoseReading } from '../models/api';

export type GlucoseSource = 'health_connect' | 'samsung_health';
export type GlucoseAccess = {
  availability:
    | 'unknown'
    | 'available'
    | 'unavailable'
    | 'update_required'
    | 'initialization_required'
    | 'read_access_unavailable';
  permission: 'unknown' | 'granted' | 'denied';
};

export interface GlucoseDataProvider {
  label: string;
  getAccess(requestPermission?: boolean): Promise<GlucoseAccess>;
  getReadings(startTime: Date, endTime: Date): Promise<GlucoseReading[]>;
}
