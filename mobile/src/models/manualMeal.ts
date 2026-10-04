import type { AnalysisRequest, FoodInfo, GlucoseReading } from './api';

export function normalizeMealTime(input: string): string {
  const value = input.trim();
  const match = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,3}))?Z$/.exec(
    value,
  );
  const time = new Date(value);
  if (
    !match ||
    !Number.isFinite(time.getTime()) ||
    time.toISOString() !== `${match[1]}.${(match[2] ?? '').padEnd(3, '0')}Z`
  ) {
    throw new Error(
      'Enter a valid UTC meal time, for example 2026-10-04T00:00:00Z (up to 3 fractional digits).',
    );
  }
  return time.toISOString();
}

export function manualFoodInfo(
  description: string,
  confirmedAt: Date,
  weightInput = '',
): FoodInfo {
  const name = description.trim();
  if (!name) {
    throw new Error('Enter a meal description.');
  }
  const text = weightInput.trim();
  const item: FoodInfo['items'][number] = { name };
  if (text) {
    const weight = Number(text);
    // Parse the entire numeric input: do not accept units, hex, or partial text.
    if (
      !/^\+?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(text) ||
      !Number.isFinite(weight) ||
      weight <= 0
    ) {
      throw new Error(
        'Enter an approximate weight greater than 0 in grams, or leave it blank.',
      );
    }
    item.weight_g = weight;
  }
  // The contract has no food source field. This is manual confirmation time,
  // not a claim that a CV provider recognized the food. No confidence invented.
  return { recognized_at: confirmedAt.toISOString(), items: [item] };
}

/** Retrieval bounds only; no baseline calculation or data eligibility decisions. */
export function mealGlucoseQuery(mealAt: string): { start: Date; end: Date } {
  const meal = Date.parse(normalizeMealTime(mealAt));
  const start = new Date(meal - 15 * 60_000);
  // Health Connect's end is exclusive. This covers +120 exactly and all
  // potentially valid after-end interpolation support under the 15-minute gap.
  const end = new Date(meal + 135 * 60_000);
  if (start.getUTCFullYear() < 1 || end.getUTCFullYear() > 9999) {
    throw new Error('Meal time is outside the supported date range.');
  }
  return { start, end };
}

export function manualAnalysisRequest(
  mealId: string,
  mealAt: string,
  foodInfo: FoodInfo,
  readings: GlucoseReading[],
): AnalysisRequest {
  return {
    meal_id: mealId,
    meal_at: mealAt,
    food_info: foodInfo,
    readings,
    other_meal_times: [],
  };
}
