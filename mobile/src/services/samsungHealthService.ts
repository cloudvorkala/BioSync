import { NativeModules, Platform } from 'react-native';
import type { GlucoseAccess } from './glucoseProviderTypes';
import {
  mapSamsungReadings,
  SamsungMappingError,
  type SamsungDataPoint,
} from './samsungHealthMapping';

interface SamsungBridge {
  getAccess(requestPermission: boolean): Promise<GlucoseAccess>;
  readBloodGlucose(
    startTime: string,
    endTime: string,
  ): Promise<SamsungDataPoint[]>;
}

const accessForCode: Record<string, GlucoseAccess> = {
  SAMSUNG_UNAVAILABLE: { availability: 'unavailable', permission: 'unknown' },
  SAMSUNG_UPDATE_REQUIRED: {
    availability: 'update_required',
    permission: 'unknown',
  },
  SAMSUNG_INITIALIZATION_REQUIRED: {
    availability: 'initialization_required',
    permission: 'unknown',
  },
  SAMSUNG_READ_ACCESS_UNAVAILABLE: {
    availability: 'read_access_unavailable',
    permission: 'unknown',
  },
  SAMSUNG_PERMISSION_DENIED: {
    availability: 'available',
    permission: 'denied',
  },
};
const messages: Record<string, string> = {
  SAMSUNG_UNAVAILABLE:
    'Samsung Health is unavailable. Use a physical Android 10+ phone with Samsung Health installed and enabled.',
  SAMSUNG_UPDATE_REQUIRED: 'Update Samsung Health to version 6.30.2 or later.',
  SAMSUNG_INITIALIZATION_REQUIRED:
    'Open Samsung Health and finish its setup, then retry.',
  SAMSUNG_READ_ACCESS_UNAVAILABLE:
    'Samsung Health SDK read access is unavailable. For development, check Developer Mode for Data Read. Distributed apps require Samsung registration; account/platform restrictions may also apply.',
  SAMSUNG_PERMISSION_DENIED:
    'Samsung Health blood glucose read permission was not granted. Request permission to continue.',
  SAMSUNG_NO_ACTIVITY:
    'Open BioSync before requesting Samsung Health permission.',
  SAMSUNG_READ_ERROR:
    'Samsung Health could not read blood glucose. Check the app and retry.',
  SAMSUNG_CANCELLED:
    'The Samsung Health operation was cancelled. Please retry.',
  SAMSUNG_INVALID_RANGE:
    'Choose valid UTC times with the start before the end.',
};

export class SamsungHealthServiceError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly access?: GlucoseAccess,
  ) {
    super(message);
    this.name = 'SamsungHealthServiceError';
  }
}

function bridge(): SamsungBridge {
  const native = NativeModules.SamsungHealth as SamsungBridge | undefined;
  if (Platform.OS !== 'android' || !native) {
    throw new SamsungHealthServiceError(
      'SAMSUNG_UNAVAILABLE',
      'Samsung Health native module is unavailable. Install the Android build containing the SDK.',
      accessForCode.SAMSUNG_UNAVAILABLE,
    );
  }
  return native;
}

function failure(error: unknown): SamsungHealthServiceError {
  if (error instanceof SamsungHealthServiceError) {
    return error;
  }
  if (error instanceof SamsungMappingError) {
    return new SamsungHealthServiceError(error.code, error.message);
  }
  const code =
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof error.code === 'string' &&
    messages[error.code]
      ? error.code
      : 'SAMSUNG_READ_ERROR';
  return new SamsungHealthServiceError(
    code,
    messages[code],
    accessForCode[code],
  );
}

export async function getSamsungHealthAccess(
  requestPermission = false,
): Promise<GlucoseAccess> {
  try {
    return await bridge().getAccess(requestPermission);
  } catch (error) {
    const problem = failure(error);
    if (problem.access) {
      return problem.access;
    }
    throw problem;
  }
}

/** Diagnostic result retains package names locally, never in GlucoseReading. */
export async function readSamsungBloodGlucose(start: Date, end: Date) {
  if (
    !Number.isFinite(start.getTime()) ||
    !Number.isFinite(end.getTime()) ||
    start >= end
  ) {
    throw new SamsungHealthServiceError(
      'SAMSUNG_INVALID_RANGE',
      messages.SAMSUNG_INVALID_RANGE,
    );
  }
  try {
    const access = await getSamsungHealthAccess();
    if (
      access.availability !== 'available' ||
      access.permission !== 'granted'
    ) {
      const code =
        Object.keys(accessForCode).find(
          key =>
            accessForCode[key].availability === access.availability &&
            accessForCode[key].permission === access.permission,
        ) ?? 'SAMSUNG_PERMISSION_DENIED';
      throw new SamsungHealthServiceError(code, messages[code], access);
    }
    return mapSamsungReadings(
      await bridge().readBloodGlucose(start.toISOString(), end.toISOString()),
      start,
      end,
    );
  } catch (error) {
    throw failure(error);
  }
}

export async function getSamsungBloodGlucoseReadings(start: Date, end: Date) {
  return (await readSamsungBloodGlucose(start, end)).readings;
}
