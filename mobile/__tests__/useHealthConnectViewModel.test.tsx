import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import * as native from 'react-native-health-connect';
import { useHealthConnectViewModel } from '../src/viewmodels/useHealthConnectViewModel';

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
let renderer: ReactTestRenderer;
let model: ReturnType<typeof useHealthConnectViewModel>;
function Harness() {
  model = useHealthConnectViewModel();
  return null;
}

beforeEach(async () => {
  jest.clearAllMocks();
  bridge.getSdkStatus.mockResolvedValue(3);
  bridge.initialize.mockResolvedValue(true);
  bridge.getGrantedPermissions.mockResolvedValue([permission]);
  bridge.requestPermission.mockResolvedValue([permission]);
  bridge.readRecords.mockResolvedValue({ records: [] });
  await act(async () => {
    renderer = create(<Harness />);
  });
});
afterEach(async () => {
  await act(async () => {
    renderer.unmount();
  });
});

test('checks access on mount without prompting and distinguishes successful zero records', async () => {
  expect(model.state).toMatchObject({
    availability: 'available',
    permission: 'granted',
    readings: null,
  });
  expect(bridge.requestPermission).not.toHaveBeenCalled();
  await act(async () => {
    await model.loadBloodGlucose();
  });
  expect(model.state).toMatchObject({
    operation: 'success',
    readings: [],
    error: null,
  });
  const period = model.state.period!;
  expect(Date.parse(period.end) - Date.parse(period.start)).toBe(86400000);
});

test('reports denial independently from a read error', async () => {
  bridge.requestPermission.mockResolvedValue([]);
  await act(async () => {
    await model.requestHealthPermission();
  });
  expect(model.state).toMatchObject({
    permission: 'denied',
    operation: 'idle',
    readings: null,
    error: null,
  });
});

test('read failure shows an error, not zero records', async () => {
  bridge.readRecords.mockRejectedValue(new Error('native detail'));
  await act(async () => {
    await model.loadBloodGlucose();
  });
  expect(model.state.operation).toBe('error');
  expect(model.state.readings).toBeNull();
  expect(model.state.error).toContain('Could not read valid blood glucose');
});

test('renders mapped data after a successful native boundary response', async () => {
  const nativeRecord = {
    time: '2026-10-03T12:00:00Z',
    metadata: { id: 'record-1' },
    level: { inMillimolesPerLiter: 5, inMilligramsPerDeciliter: 90 },
  };
  bridge.readRecords.mockResolvedValue({ records: [nativeRecord] });
  await act(async () => {
    await model.loadBloodGlucose();
  });
  expect(model.state).toMatchObject({
    operation: 'success',
    readings: [
      {
        source: 'health_connect',
        source_record_id: 'record-1',
        measured_at: '2026-10-03T12:00:00.000Z',
        value_mmol_l: 5,
      },
    ],
  });
});
