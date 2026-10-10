import {
  getBloodGlucoseReadings,
  getHealthConnectAccess,
} from './healthConnectService';
import {
  getSamsungBloodGlucoseReadings,
  getSamsungHealthAccess,
} from './samsungHealthService';
import type {
  GlucoseDataProvider,
  GlucoseSource,
} from './glucoseProviderTypes';

export const glucoseProviders: Record<GlucoseSource, GlucoseDataProvider> = {
  health_connect: {
    label: 'Health Connect',
    getAccess: getHealthConnectAccess,
    getReadings: getBloodGlucoseReadings,
  },
  samsung_health: {
    label: 'Samsung Health',
    getAccess: getSamsungHealthAccess,
    getReadings: getSamsungBloodGlucoseReadings,
  },
};
