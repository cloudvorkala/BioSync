import {
  manualAnalysisRequest,
  manualFoodInfo,
  mealGlucoseQuery,
  normalizeMealTime,
} from '../src/models/manualMeal';

test('manual food becomes one trimmed item without confidence or invented source', () => {
  expect(
    manualFoodInfo(
      '  Chicken rice with broccoli  ',
      new Date('2026-10-04T02:00:00Z'),
    ),
  ).toEqual({
    recognized_at: '2026-10-04T02:00:00.000Z',
    items: [{ name: 'Chicken rice with broccoli' }],
  });
});
test('rejects empty food', () => {
  expect(() => manualFoodInfo('  ', new Date())).toThrow('description');
});

test.each([
  ['350', 350],
  [' 350.5 ', 350.5],
  ['.5', 0.5],
  ['3.5e2', 350],
])('maps manually supplied weight %s into grams', (text, weight) => {
  expect(
    manualFoodInfo(' Chicken rice ', new Date('2026-10-04T02:00:00Z'), text),
  ).toEqual({
    recognized_at: '2026-10-04T02:00:00.000Z',
    items: [{ name: 'Chicken rice', weight_g: weight }],
  });
});

test.each(['', '   '])('blank weight %j is omitted, not null or zero', text => {
  const food = manualFoodInfo('Rice', new Date(), text);
  expect(food.items).toEqual([{ name: 'Rice' }]);
  expect(JSON.stringify(food)).not.toContain('weight_g');
});

test.each([
  '0',
  '-0',
  '-5',
  'NaN',
  'Infinity',
  '-Infinity',
  '1e309',
  '1e-999',
  'abc',
  '350g',
  '0x10',
  '3,50',
])('rejects invalid manual weight %s without silently coercing it', text => {
  expect(() => manualFoodInfo('Rice', new Date(), text)).toThrow(
    'weight greater than 0',
  );
});
test('query includes baseline and a buffer beyond the exact +120 boundary', () => {
  const range = mealGlucoseQuery('2026-10-04T00:05:00Z');
  expect(range.start.toISOString()).toBe('2026-10-03T23:50:00.000Z');
  expect(range.end.toISOString()).toBe('2026-10-04T02:20:00.000Z');
});
test.each([
  '2026-02-30T00:00:00Z',
  '2026-10-04T12:00:00',
  '2026-10-04T12:00:00+13:00',
  '04/10/2026 12:00',
  'invalid',
])('rejects invalid or non-UTC meal time %s', input => {
  expect(() => normalizeMealTime(input)).toThrow('UTC meal time');
});
test('normalizes valid UTC input', () => {
  expect(normalizeMealTime(' 2026-10-04T00:00:00.1Z ')).toBe(
    '2026-10-04T00:00:00.100Z',
  );
});
test('request forwards domain readings unchanged, with no scientific fields', () => {
  const readings = [
    {
      source: 'health_connect',
      source_record_id: 'original-id',
      measured_at: '2026-10-03T23:55:00.000Z',
      value_mmol_l: 5.12345,
    },
  ];
  const food = manualFoodInfo('Rice', new Date('2026-10-04T02:00:00Z'));
  const request = manualAnalysisRequest(
    '53243736-8e46-441c-90ba-d1a922e7b8ad',
    '2026-10-04T00:00:00.000Z',
    food,
    readings,
  );
  expect(request).toEqual({
    meal_id: '53243736-8e46-441c-90ba-d1a922e7b8ad',
    meal_at: '2026-10-04T00:00:00.000Z',
    food_info: food,
    readings,
    other_meal_times: [],
  });
  expect(request.readings).toBe(readings);
  expect(request.readings[0]).toBe(readings[0]);
});
