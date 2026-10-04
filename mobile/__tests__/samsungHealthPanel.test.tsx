import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { Button, NativeModules, Platform, TextInput } from 'react-native';
import { SamsungHealthPanel } from '../src/views/SamsungHealthPanel';

// Real UI / ViewModel / service / mapping. No claim of native SDK execution.
const native = { getAccess: jest.fn(), readBloodGlucose: jest.fn() };
let renderer: ReactTestRenderer;
const originalOS = Platform.OS;
function screen() {
  return JSON.stringify(renderer.toJSON());
}
async function press(title: string) {
  await act(async () => {
    await renderer.root
      .findAllByType(Button)
      .find(b => b.props.title === title)!
      .props.onPress();
  });
}
async function enter(label: string, value: string) {
  await act(async () => {
    renderer.root
      .findAllByType(TextInput)
      .find(i => i.props.accessibilityLabel === label)!
      .props.onChangeText(value);
  });
}
beforeEach(async () => {
  jest.clearAllMocks();
  native.getAccess.mockReset();
  native.readBloodGlucose.mockReset();
  Platform.OS = 'android';
  NativeModules.SamsungHealth = native;
  native.getAccess.mockResolvedValue({
    availability: 'available',
    permission: 'granted',
  });
  native.readBloodGlucose.mockResolvedValue([]);
  await act(async () => {
    renderer = create(<SamsungHealthPanel />);
  });
  await enter('Samsung start UTC', '2026-10-04T00:00:00Z');
  await enter('Samsung end UTC', '2026-10-04T01:00:00Z');
});
afterEach(async () => {
  await act(async () => {
    renderer.unmount();
  });
  Platform.OS = originalOS;
  delete NativeModules.SamsungHealth;
});

test('status check does not prompt; editable historical range and zero success render', async () => {
  expect(native.getAccess).toHaveBeenCalledWith(false);
  expect(native.getAccess).not.toHaveBeenCalledWith(true);
  await press('Load Samsung Health Blood Glucose');
  expect(native.readBloodGlucose).toHaveBeenCalledWith(
    '2026-10-04T00:00:00.000Z',
    '2026-10-04T01:00:00.000Z',
  );
  expect(screen()).toContain('The read succeeded');
  expect(screen()).toContain('success');
});

test('successful data renders mmol/L and local source package', async () => {
  native.readBloodGlucose.mockResolvedValue([
    {
      uid: 'parent',
      startTime: '2026-10-04T00:00:00Z',
      sourcePackage: 'example.importer',
      series: [{ timestamp: '2026-10-04T00:05:00Z', glucoseMmolL: 5.75 }],
    },
  ]);
  await press('Load Samsung Health Blood Glucose');
  expect(screen()).toContain('5.75');
  expect(screen()).toContain('2026-10-04T00:05:00.000Z');
  expect(screen()).toContain('example.importer');
});

test('permission denial renders clearly after explicit request', async () => {
  native.getAccess.mockResolvedValue({
    availability: 'available',
    permission: 'denied',
  });
  await press('Request Samsung Health Permission');
  expect(native.getAccess).toHaveBeenLastCalledWith(true);
  expect(screen()).toContain('permission is not granted');
  expect(native.readBloodGlucose).not.toHaveBeenCalled();
});

test('native error renders an error rather than successful zero records', async () => {
  native.readBloodGlucose.mockRejectedValue({
    code: 'SAMSUNG_READ_ERROR',
    message: 'private detail',
  });
  await press('Load Samsung Health Blood Glucose');
  expect(screen()).toContain('SAMSUNG_READ_ERROR');
  expect(screen()).not.toContain('The read succeeded');
  expect(screen()).not.toContain('private detail');
});

test('developer read restriction is distinct from user permission denial', async () => {
  native.getAccess.mockRejectedValue({
    code: 'SAMSUNG_READ_ACCESS_UNAVAILABLE',
  });
  await press('Check Samsung Health Status');
  expect(screen()).toContain('read_access_unavailable');
  expect(screen()).toContain('SDK read access is blocked');
});

test('invalid time entry never invokes a native read', async () => {
  await enter('Samsung start UTC', 'yesterday');
  await press('Load Samsung Health Blood Glucose');
  expect(screen()).toContain('SAMSUNG_INVALID_RANGE');
  expect(native.readBloodGlucose).not.toHaveBeenCalled();
});

test('changing diagnostic range clears old data so it cannot be mistaken for the new interval', async () => {
  await press('Load Samsung Health Blood Glucose');
  expect(screen()).toContain('The read succeeded');
  await enter('Samsung start UTC', '2026-10-03T00:00:00Z');
  expect(screen()).not.toContain('The read succeeded');
  expect(screen()).toContain('not loaded');
});
