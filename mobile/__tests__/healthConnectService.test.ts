import * as native from 'react-native-health-connect';
import {
  getBloodGlucoseReadings,
  getHealthConnectAccess,
} from '../src/services/healthConnectService';

// Only the native-facing package boundary is mocked. No simulated Android SDK.
jest.mock('react-native-health-connect', () => ({
  getSdkStatus: jest.fn(),
  initialize: jest.fn(),
  getGrantedPermissions: jest.fn(),
  requestPermission: jest.fn(),
  readRecords: jest.fn(),
  SdkAvailabilityStatus: {
    SDK_UNAVAILABLE: 1,
    SDK_UNAVAILABLE_PROVIDER_UPDATE_REQUIRED: 2,
    SDK_AVAILABLE: 3,
  },
}));
const bridge = jest.mocked(native);
const permission = { accessType: 'read', recordType: 'BloodGlucose' } as const;
const start = new Date('2026-10-03T00:00:00Z');
const end = new Date('2026-10-04T00:00:00Z');
const record = (time: string, id: string) => ({
  time,
  metadata: { id },
  level: { inMillimolesPerLiter: 5.5, inMilligramsPerDeciliter: 99 },
});

beforeEach(() => {
  jest.resetAllMocks();
  bridge.getSdkStatus.mockResolvedValue(3);
  bridge.initialize.mockResolvedValue(true);
  bridge.getGrantedPermissions.mockResolvedValue([permission]);
  bridge.requestPermission.mockResolvedValue([permission]);
  bridge.readRecords.mockResolvedValue({ records: [] });
});

test('requests only read BloodGlucose and reports a grant', async () => {
  await expect(getHealthConnectAccess(true)).resolves.toEqual({
    availability: 'available',
    permission: 'granted',
  });
  expect(bridge.requestPermission).toHaveBeenCalledWith([permission]);
});

test.each([
  [1, 'unavailable'],
  [2, 'update_required'],
])(
  'handles SDK status %s without requesting permission',
  async (sdk, availability) => {
    bridge.getSdkStatus.mockResolvedValue(sdk as number);
    await expect(getHealthConnectAccess(true)).resolves.toEqual({
      availability,
      permission: 'unknown',
    });
    expect(bridge.initialize).not.toHaveBeenCalled();
    expect(bridge.requestPermission).not.toHaveBeenCalled();
  },
);

test('denial or dismissal is distinct from a grant', async () => {
  bridge.requestPermission.mockResolvedValue([]);
  await expect(getHealthConnectAccess(true)).resolves.toMatchObject({
    permission: 'denied',
  });
});

test('unrelated or write permissions do not grant glucose read access', async () => {
  bridge.getGrantedPermissions.mockResolvedValue([
    { accessType: 'write', recordType: 'BloodGlucose' },
    { accessType: 'read', recordType: 'Steps' },
  ]);
  await expect(getBloodGlucoseReadings(start, end)).rejects.toMatchObject({
    access: { permission: 'denied' },
  });
  expect(bridge.readRecords).not.toHaveBeenCalled();
});

test('reads all pages, sorts a copy, and sends a UTC range', async () => {
  const later = record('2026-10-03T12:00:00Z', 'later');
  const earlier = record('2026-10-03T08:00:00Z', 'earlier');
  const input = [later];
  bridge.readRecords.mockResolvedValueOnce({
    records: input,
    pageToken: 'next',
  });
  bridge.readRecords.mockResolvedValueOnce({ records: [earlier] });
  const result = await getBloodGlucoseReadings(start, end);
  expect(result.map(r => r.source_record_id)).toEqual(['earlier', 'later']);
  expect(result[0].value_mmol_l).toBe(5.5);
  expect(input).toEqual([later]);
  expect(bridge.readRecords).toHaveBeenNthCalledWith(1, 'BloodGlucose', {
    timeRangeFilter: {
      operator: 'between',
      startTime: start.toISOString(),
      endTime: end.toISOString(),
    },
    ascendingOrder: true,
    pageSize: 1000,
  });
  expect(bridge.readRecords.mock.calls[1][1].pageToken).toBe('next');
  expect(bridge.requestPermission).not.toHaveBeenCalled();
});

test('zero records succeeds with an empty array', async () => {
  await expect(getBloodGlucoseReadings(start, end)).resolves.toEqual([]);
});

test('does not silently return partial results when a later page fails', async () => {
  bridge.readRecords.mockResolvedValueOnce({
    records: [record(start.toISOString(), 'first')],
    pageToken: 'next',
  });
  bridge.readRecords.mockRejectedValueOnce(new Error('native details'));
  await expect(getBloodGlucoseReadings(start, end)).rejects.toThrow(
    'Could not read valid blood glucose',
  );
});

test('refreshes permission after native read failure', async () => {
  bridge.getGrantedPermissions
    .mockResolvedValueOnce([permission])
    .mockResolvedValueOnce([]);
  bridge.readRecords.mockRejectedValue(new Error('revoked'));
  await expect(getBloodGlucoseReadings(start, end)).rejects.toMatchObject({
    access: { permission: 'denied' },
  });
});

test('reports initialization failure', async () => {
  bridge.initialize.mockResolvedValue(false);
  await expect(getHealthConnectAccess()).rejects.toThrow(
    'Cannot access Health Connect',
  );
});

test('reports native availability failures', async () => {
  bridge.getSdkStatus.mockRejectedValue(new Error('native error'));
  await expect(getHealthConnectAccess()).rejects.toThrow(
    'Cannot access Health Connect',
  );
});

test('rejects invalid native records instead of dropping them silently', async () => {
  const invalidRecord = {
    ...record(start.toISOString(), 'bad'),
    level: { inMillimolesPerLiter: NaN, inMilligramsPerDeciliter: 99 },
  };
  bridge.readRecords.mockResolvedValue({
    records: [invalidRecord],
  });
  await expect(getBloodGlucoseReadings(start, end)).rejects.toThrow(
    'Could not read valid',
  );
});

test('rejects repeated pagination tokens', async () => {
  bridge.readRecords.mockResolvedValue({ records: [], pageToken: 'same' });
  await expect(getBloodGlucoseReadings(start, end)).rejects.toThrow();
  expect(bridge.readRecords).toHaveBeenCalledTimes(2);
});

test.each([
  [end, start],
  [start, start],
  [new Date('invalid'), end],
])('rejects invalid time ranges before reading', async (from, to) => {
  await expect(getBloodGlucoseReadings(from, to)).rejects.toThrow(
    'valid time range',
  );
  expect(bridge.readRecords).not.toHaveBeenCalled();
});
