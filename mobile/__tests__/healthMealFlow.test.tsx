import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { Button, TextInput } from 'react-native';
import * as native from 'react-native-health-connect';
import { HealthMealPanel } from '../src/views/HealthMealPanel';
import fixture from '../src/dev/analysisFixture.json';
import type { AnalysisRequest } from '../src/models/api';
import { response } from './testData';

// Real View, ViewModel, mapping and backendClient; mock only native and HTTP I/O.
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
const originalFetch = globalThis.fetch;
const fetchMock = jest.fn<ReturnType<typeof fetch>, Parameters<typeof fetch>>();
let renderer: ReactTestRenderer;
const nativeRecords = fixture.readings.map(r => ({
  time: r.measured_at,
  metadata: { id: r.source_record_id },
  level: {
    inMillimolesPerLiter: r.value_mmol_l,
    inMilligramsPerDeciliter: r.value_mmol_l * 18,
  },
}));

function body(index = 0): AnalysisRequest {
  return JSON.parse(fetchMock.mock.calls[index][1]?.body as string);
}
function screen() {
  return JSON.stringify(renderer.toJSON());
}
async function enter(label: string, value: string) {
  await act(async () => {
    renderer.root
      .findAllByType(TextInput)
      .find(input => input.props.accessibilityLabel === label)!
      .props.onChangeText(value);
  });
}
async function press(title = 'Analyse Health Connect Meal') {
  await act(async () => {
    await renderer.root
      .findAllByType(Button)
      .find(button => button.props.title === title)!
      .props.onPress();
  });
}
function fail(code: string, retryable = false, status = 422) {
  fetchMock.mockResolvedValue({
    ok: false,
    status,
    json: async () => ({
      error: { code, message: 'Backend explanation.', retryable },
    }),
  } as Response);
}

beforeEach(async () => {
  jest.clearAllMocks();
  fetchMock.mockReset();
  globalThis.fetch = fetchMock;
  bridge.getSdkStatus.mockResolvedValue(3);
  bridge.initialize.mockResolvedValue(true);
  bridge.getGrantedPermissions.mockResolvedValue([
    { accessType: 'read', recordType: 'BloodGlucose' },
  ]);
  bridge.requestPermission.mockResolvedValue([
    { accessType: 'read', recordType: 'BloodGlucose' },
  ]);
  bridge.readRecords.mockResolvedValue({ records: nativeRecords });
  fetchMock.mockImplementation(
    async (_url, options) =>
      ({
        ok: true,
        status: 200,
        json: async () => ({
          ...response,
          meal_id: JSON.parse(options?.body as string).meal_id,
        }),
      } as Response),
  );
  await act(async () => {
    renderer = create(<HealthMealPanel />);
  });
  await enter('Meal description', '  Chicken rice with broccoli  ');
  await enter('Meal time UTC', fixture.meal_at);
});
afterEach(async () => {
  await act(async () => {
    renderer.unmount();
  });
  globalThis.fetch = originalFetch;
});

test('real flow builds the complete request and renders only backend-calculated values', async () => {
  await press();
  expect(bridge.readRecords).toHaveBeenCalledWith('BloodGlucose', {
    timeRangeFilter: {
      operator: 'between',
      startTime: '2026-09-23T11:45:00.000Z',
      endTime: '2026-09-23T14:15:00.000Z',
    },
    ascendingOrder: true,
    pageSize: 1000,
  });
  const request = body();
  expect(request.meal_id).toMatch(
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
  );
  expect(request).toEqual({
    meal_id: request.meal_id,
    meal_at: '2026-09-23T12:00:00.000Z',
    food_info: {
      recognized_at: expect.stringMatching(/Z$/),
      items: [{ name: 'Chicken rice with broccoli' }],
    },
    readings: fixture.readings.map(r => ({
      ...r,
      source: 'health_connect',
      measured_at: new Date(r.measured_at).toISOString(),
    })),
    other_meal_times: [],
  });
  // Same glucose curve as the 225 fixture, but HTTP returns 42.75. No mobile math.
  expect(screen()).toContain('42.75');
  expect(screen()).toContain(response.feedback.summary);
  expect(screen()).toContain(response.feedback.suggestions[0]);
  expect(screen()).not.toContain('225');
});

test('WAITING is a data state, retries reread glucose with the same meal ID', async () => {
  fail('WAITING_FOR_GLUCOSE_DATA', true);
  await press();
  expect(screen()).toContain('waiting');
  expect(screen()).toContain('More post-meal glucose data is needed');
  const first = body();
  await press();
  expect(bridge.readRecords).toHaveBeenCalledTimes(2);
  expect(body(1).meal_id).toBe(first.meal_id);
  expect(body(1).food_info).toEqual(first.food_info);
});

test('optional weight reaches the backend without changing glucose data or using mobile iAUC', async () => {
  await enter('Approximate weight (g)', ' 350.5 ');
  await press();
  expect(body().food_info.items).toEqual([
    { name: 'Chicken rice with broccoli', weight_g: 350.5 },
  ]);
  expect(body().readings.map(r => r.value_mmol_l)).toEqual(
    fixture.readings.map(r => r.value_mmol_l),
  );
  expect(screen()).toContain('42.75');
  expect(screen()).toContain(response.feedback.summary);
  expect(screen()).not.toContain('225');
});

test('weight changes invalidate old results and retries preserve the normalized draft', async () => {
  await enter('Approximate weight (g)', '350');
  await press();
  const first = body();
  await enter('Approximate weight (g)', '350.0');
  await press();
  expect(body(1).meal_id).toBe(first.meal_id);
  expect(body(1).food_info).toEqual(first.food_info);
  await enter('Approximate weight (g)', '400');
  expect(screen()).not.toContain(response.feedback.summary);
  await press();
  expect(body(2).meal_id).not.toBe(first.meal_id);
  expect(body(2).food_info.items[0].weight_g).toBe(400);
  await enter('Approximate weight (g)', '');
  await press();
  expect(body(3).meal_id).not.toBe(body(2).meal_id);
  expect(body(3).food_info.items).toEqual([
    { name: 'Chicken rice with broccoli' },
  ]);
});

test.each(['0', '-1', 'NaN', 'Infinity', 'not a weight'])(
  'invalid weight %s prevents Health Connect access and HTTP',
  async text => {
    await enter('Approximate weight (g)', text);
    await press();
    expect(screen()).toContain('INVALID_INPUT');
    expect(screen()).toContain('weight greater than 0');
    expect(bridge.readRecords).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  },
);

test.each([
  ['INSUFFICIENT_BASELINE_DATA', 'Not enough pre-meal baseline'],
  ['INSUFFICIENT_GLUCOSE_DATA', 'insufficient glucose coverage'],
  ['OVERLAPPING_MEAL', 'another meal'],
  ['CONFLICTING_GLUCOSE_READINGS', 'different glucose values'],
])(
  'shows backend policy code %s independently of networking',
  async (code, message) => {
    fail(code);
    await press();
    expect(screen()).toContain('policy');
    expect(screen()).toContain(code);
    expect(screen()).toContain(message);
  },
);

test('zero records are submitted and baseline sufficiency remains a backend decision', async () => {
  bridge.readRecords.mockResolvedValue({ records: [] });
  fail('INSUFFICIENT_BASELINE_DATA');
  await press();
  expect(body().readings).toEqual([]);
  expect(screen()).toContain('Health Connect returned no records');
  expect(screen()).toContain('INSUFFICIENT_BASELINE_DATA');
  expect(screen()).not.toContain('Meal iAUC:');
});

test('denied permission prevents submission', async () => {
  bridge.getGrantedPermissions.mockResolvedValue([]);
  await press();
  expect(fetchMock).not.toHaveBeenCalled();
  expect(screen()).toContain('health_connect');
  expect(screen()).toContain('denied');
});

test('native read error prevents submission', async () => {
  bridge.readRecords.mockRejectedValue(new Error('native failure'));
  await press();
  expect(fetchMock).not.toHaveBeenCalled();
  expect(screen()).toContain('HEALTH_CONNECT_ERROR');
});

test('network failures are not presented as policy conditions', async () => {
  fetchMock.mockRejectedValue(new Error('connection refused'));
  await press();
  expect(screen()).toContain('network');
  expect(screen()).toContain('NETWORK_ERROR');
  expect(screen()).not.toContain('WAITING_FOR_GLUCOSE_DATA');
});

test('server errors remain backend errors', async () => {
  fail('INTERNAL_ERROR', false, 500);
  await press();
  expect(screen()).toContain('backend');
  expect(screen()).toContain('INTERNAL_ERROR');
});

test.each([
  ['LLM_CONFIGURATION_ERROR', 500, false],
  ['LLM_AUTHENTICATION_ERROR', 502, false],
  ['UPSTREAM_TIMEOUT', 504, true],
  ['LLM_NETWORK_ERROR', 502, true],
  ['LLM_RATE_LIMITED', 503, true],
  ['LLM_INVALID_RESPONSE', 502, false],
  ['UPSTREAM_FAILURE', 502, true],
] as const)(
  'feedback error %s remains a backend error',
  async (code, status, retryable) => {
    fail(code, retryable, status);
    await press();
    expect(screen()).toContain('backend');
    expect(screen()).toContain(code);
    expect(screen()).toContain('Backend explanation.');
    expect(screen()).not.toContain('WAITING_FOR_GLUCOSE_DATA');
    expect(screen()).not.toContain(response.feedback.summary);
  },
);

test('invalid input prevents native access and HTTP', async () => {
  await enter('Meal description', '  ');
  await press();
  expect(screen()).toContain('Enter a meal description');
  expect(bridge.readRecords).not.toHaveBeenCalled();
  expect(fetchMock).not.toHaveBeenCalled();
});

test('editing the meal clears stale results and generates a new meal identity', async () => {
  await press();
  const firstId = body().meal_id;
  await enter('Meal description', 'Different meal');
  expect(screen()).not.toContain(response.feedback.summary);
  await press();
  expect(body(1).meal_id).not.toBe(firstId);
});

test('zero iAUC from the backend is displayed successfully', async () => {
  fetchMock.mockImplementation(
    async (_url, options) =>
      ({
        ok: true,
        status: 200,
        json: async () => ({
          ...response,
          meal_id: JSON.parse(options?.body as string).meal_id,
          iauc_mmol_l_min: 0,
        }),
      } as Response),
  );
  await press();
  expect(screen()).toContain('success');
  expect(screen()).toContain('Meal iAUC:');
  expect(screen()).not.toContain('42.75');
});
