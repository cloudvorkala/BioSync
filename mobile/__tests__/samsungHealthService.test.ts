import { NativeModules, Platform } from 'react-native';
import {
  mapSamsungReadings,
  SamsungMappingError,
  type SamsungDataPoint,
} from '../src/services/samsungHealthMapping';
import {
  getSamsungHealthAccess,
  getSamsungBloodGlucoseReadings,
  readSamsungBloodGlucose,
} from '../src/services/samsungHealthService';

// Only the native boundary is mocked. Mapping, validation and services are real.
const native = { getAccess: jest.fn(), readBloodGlucose: jest.fn() };
const start = new Date('2026-10-04T00:00:00Z');
const end = new Date('2026-10-04T01:00:00Z');
const single: SamsungDataPoint = {
  uid: 'samsung-point-1',
  startTime: '2026-10-04T00:05:00Z',
  glucoseMmolL: 6.25,
  sourcePackage: 'example.importer',
};
const series: SamsungDataPoint = {
  uid: 'samsung-series-1',
  startTime: '2026-10-03T23:55:00Z',
  glucoseMmolL: 99, // Parent aggregate must never become a sample.
  series: [
    { timestamp: '2026-10-04T00:10:00Z', glucoseMmolL: 6.5 },
    { timestamp: '2026-10-04T00:00:00Z', glucoseMmolL: 5 },
    { timestamp: '2026-10-04T01:00:00Z', glucoseMmolL: 7 },
  ],
  sourcePackage: 'example.importer',
};
const originalOS = Platform.OS;
beforeEach(() => {
  jest.resetAllMocks();
  Platform.OS = 'android';
  NativeModules.SamsungHealth = native;
  native.getAccess.mockResolvedValue({
    availability: 'available',
    permission: 'granted',
  });
  native.readBloodGlucose.mockResolvedValue([single]);
});
afterAll(() => {
  Platform.OS = originalOS;
  delete NativeModules.SamsungHealth;
});

test('single measurement maps directly in mmol/L with stable UID and UTC Z, excluding metadata', async () => {
  const readings = await getSamsungBloodGlucoseReadings(start, end);
  expect(readings).toEqual([
    {
      source: 'samsung_health',
      source_record_id: 'samsung-point-1',
      measured_at: '2026-10-04T00:05:00.000Z',
      value_mmol_l: 6.25,
    },
  ]);
  expect(native.readBloodGlucose).toHaveBeenCalledWith(
    start.toISOString(),
    end.toISOString(),
  );
  expect(native.getAccess).toHaveBeenCalledWith(false);
});

test('SERIES_DATA is flattened, filtered by sample time, and sorted; average is excluded', () => {
  const result = mapSamsungReadings([single, series], start, end);
  expect(result.readings.map(r => r.value_mmol_l)).toEqual([5, 6.25, 6.5]);
  expect(result.readings[0].measured_at).toBe('2026-10-04T00:00:00.000Z');
  expect(result.readings[0].source_record_id).toBe(
    'samsung-series-1:series:2026-10-04T00:00:00.000Z',
  );
  expect(result.sourcePackages[result.readings[0].source_record_id]).toBe(
    'example.importer',
  );
});

test('stable series IDs are independent of input order and repeated loads', () => {
  const first = mapSamsungReadings([series], start, end);
  const reordered = { ...series, series: [...series.series!].reverse() };
  expect(mapSamsungReadings([reordered], start, end)).toEqual(first);
});

test('time offsets are normalized without device timezone drift', () => {
  const record = { ...single, startTime: '2026-10-04T13:05:00+13:00' };
  expect(mapSamsungReadings([record], start, end).readings[0].measured_at).toBe(
    '2026-10-04T00:05:00.000Z',
  );
});

test('exact duplicate parents and series samples are collapsed without mutating inputs', () => {
  const data = [
    single,
    single,
    { ...series, series: [...series.series!, series.series![0]] },
    series,
  ];
  const before = JSON.stringify(data);
  expect(mapSamsungReadings(data, start, end).readings).toHaveLength(3);
  expect(JSON.stringify(data)).toBe(before);
});

test.each([false, true])(
  'conflicting same-time values are surfaced, including series=%s',
  inSeries => {
    const conflict = inSeries
      ? {
          ...series,
          series: [{ timestamp: single.startTime, glucoseMmolL: 9 }],
        }
      : { ...single, uid: 'another-record', glucoseMmolL: 9 };
    expect(() => mapSamsungReadings([single, conflict], start, end)).toThrow(
      SamsungMappingError,
    );
    try {
      mapSamsungReadings([single, conflict], start, end);
    } catch (error) {
      expect(error).toMatchObject({ code: 'CONFLICTING_GLUCOSE_READINGS' });
    }
  },
);

test('equal same-time measurements from different parents retain traceability', () => {
  const result = mapSamsungReadings(
    [single, { ...single, uid: 'second-source' }],
    start,
    end,
  );
  expect(result.readings).toHaveLength(2);
});

test.each([NaN, Infinity, -Infinity, '5', null, undefined])(
  'invalid glucose %s is rejected, never coerced',
  value => {
    expect(() =>
      mapSamsungReadings(
        [{ ...single, glucoseMmolL: value } as SamsungDataPoint],
        start,
        end,
      ),
    ).toThrow('invalid glucose record');
  },
);

test.each(['invalid', '2026-10-04T00:05:00', '2026-02-30T00:05:00Z'])(
  'invalid/timezone-free timestamp rejected: %s',
  startTime => {
    expect(() =>
      mapSamsungReadings([{ ...single, startTime }], start, end),
    ).toThrow(SamsungMappingError);
  },
);

test('missing stable UID is rejected instead of invented', () => {
  expect(() =>
    mapSamsungReadings([{ ...single, uid: '' }], start, end),
  ).toThrow(SamsungMappingError);
});

test('empty read is successful and diagnostics stay separate', async () => {
  native.readBloodGlucose.mockResolvedValue([]);
  expect(await readSamsungBloodGlucose(start, end)).toEqual({
    readings: [],
    sourcePackages: {},
  });
});

test('permission is requested only when explicitly asked', async () => {
  await getSamsungHealthAccess(true);
  expect(native.getAccess).toHaveBeenLastCalledWith(true);
});

test('denied permission prevents reading and remains distinct from read failure', async () => {
  native.getAccess.mockResolvedValue({
    availability: 'available',
    permission: 'denied',
  });
  await expect(
    getSamsungBloodGlucoseReadings(start, end),
  ).rejects.toMatchObject({ code: 'SAMSUNG_PERMISSION_DENIED' });
  expect(native.readBloodGlucose).not.toHaveBeenCalled();
});

test.each([
  ['SAMSUNG_UNAVAILABLE', 'unavailable'],
  ['SAMSUNG_UPDATE_REQUIRED', 'update_required'],
  ['SAMSUNG_INITIALIZATION_REQUIRED', 'initialization_required'],
  ['SAMSUNG_READ_ACCESS_UNAVAILABLE', 'read_access_unavailable'],
])('SDK error %s has distinct availability %s', async (code, availability) => {
  native.getAccess.mockRejectedValue({ code });
  expect(await getSamsungHealthAccess()).toEqual({
    availability,
    permission: 'unknown',
  });
  await expect(
    getSamsungBloodGlucoseReadings(start, end),
  ).rejects.toMatchObject({ code });
});

test('native read failure is sanitized, never returned as zero records', async () => {
  native.readBloodGlucose.mockRejectedValue(
    new Error('private native details'),
  );
  await expect(
    getSamsungBloodGlucoseReadings(start, end),
  ).rejects.toMatchObject({
    code: 'SAMSUNG_READ_ERROR',
    message: expect.not.stringContaining('private'),
  });
});

test('permission revoked during read is represented accurately', async () => {
  native.readBloodGlucose.mockRejectedValue({
    code: 'SAMSUNG_PERMISSION_DENIED',
  });
  await expect(
    getSamsungBloodGlucoseReadings(start, end),
  ).rejects.toMatchObject({
    access: { availability: 'available', permission: 'denied' },
  });
});

test('missing native module has clear unavailable status', async () => {
  delete NativeModules.SamsungHealth;
  expect(await getSamsungHealthAccess()).toEqual({
    availability: 'unavailable',
    permission: 'unknown',
  });
});

test('invalid/reversed query is rejected before native access', async () => {
  await expect(
    getSamsungBloodGlucoseReadings(end, start),
  ).rejects.toMatchObject({ code: 'SAMSUNG_INVALID_RANGE' });
  expect(native.getAccess).not.toHaveBeenCalled();
});
