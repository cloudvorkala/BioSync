import type { RecordResult } from 'react-native-health-connect';
import { mapBloodGlucoseRecord } from '../src/services/healthConnectMapping';

function record(): RecordResult<'BloodGlucose'> {
  return {
    specimenSource: 0,
    mealType: 0,
    relationToMeal: 0,
    time: '2026-10-04T12:00:00+13:00',
    metadata: { id: 'health-connect-record-123' },
    level: { inMillimolesPerLiter: 5.5, inMilligramsPerDeciliter: 99 },
  };
}

test('uses the explicit mmol/L accessor, metadata ID and UTC instant', () => {
  expect(mapBloodGlucoseRecord(record())).toEqual({
    source: 'health_connect',
    source_record_id: 'health-connect-record-123',
    measured_at: '2026-10-03T23:00:00.000Z',
    value_mmol_l: 5.5,
  });
});

test('does not mutate the native result or invent an ID', () => {
  const input = record();
  const before = JSON.stringify(input);
  expect(mapBloodGlucoseRecord(input)).toEqual(mapBloodGlucoseRecord(input));
  expect(JSON.stringify(input)).toBe(before);
  input.metadata = {};
  expect(() => mapBloodGlucoseRecord(input)).toThrow('missing record ID');
});

test.each([NaN, Infinity, -Infinity, undefined, '5.5'])(
  'rejects invalid mmol/L value %s',
  value => {
    const input = record();
    input.level.inMillimolesPerLiter = value as number;
    expect(() => mapBloodGlucoseRecord(input)).toThrow();
  },
);

test.each(['invalid', '2026-10-04T12:00:00'])(
  'rejects invalid or unzoned time %s',
  time => {
    expect(() => mapBloodGlucoseRecord({ ...record(), time })).toThrow();
  },
);

test('does not interpret a write-record value/unit object as a read result', () => {
  const input = {
    ...record(),
    level: { value: 99, unit: 'milligramsPerDeciliter' },
  };
  expect(() =>
    mapBloodGlucoseRecord(input as unknown as RecordResult<'BloodGlucose'>),
  ).toThrow();
});
