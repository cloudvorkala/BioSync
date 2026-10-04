import { useEffect, useRef, useState } from 'react';
import uuid from 'react-native-uuid';
import type { AnalysisResult, FoodInfo } from '../models/api';
import {
  manualAnalysisRequest,
  manualFoodInfo,
  mealGlucoseQuery,
  normalizeMealTime,
} from '../models/manualMeal';
import { analyzeMeal, BackendClientError } from '../services/backendClient';
import {
  getBloodGlucoseReadings,
  getHealthConnectAccess,
  HealthConnectServiceError,
  type HealthAccess,
} from '../services/healthConnectService';

type MealError = {
  kind:
    | 'input'
    | 'health_connect'
    | 'waiting'
    | 'policy'
    | 'network'
    | 'backend'
    | 'client';
  code: string;
  message: string;
  retryable: boolean;
};
const policyMessages: Record<string, string> = {
  WAITING_FOR_GLUCOSE_DATA:
    'More post-meal glucose data is needed through 120 minutes, possibly including a later reading for the end boundary. Wait for data to sync, then analyse again.',
  INSUFFICIENT_BASELINE_DATA:
    'Not enough pre-meal baseline readings. Check that readings exist during the 15 minutes before the selected meal time.',
  INSUFFICIENT_GLUCOSE_DATA:
    'The backend found insufficient glucose coverage or a gap. Check the source data and selected meal time.',
  OVERLAPPING_MEAL:
    'The backend detected another meal in the analysis window. This meal cannot be analysed in isolation.',
  CONFLICTING_GLUCOSE_READINGS:
    'The backend found different glucose values at the same time. Check the source records.',
  INVALID_GLUCOSE_DATA:
    'The backend rejected invalid glucose data. Check the source records.',
};

type State = {
  phase:
    | 'idle'
    | 'requesting_permission'
    | 'reading'
    | 'submitting'
    | 'success'
    | 'waiting'
    | 'error';
  access: HealthAccess;
  readingCount: number | null;
  query: { start: string; end: string } | null;
  result: AnalysisResult | null;
  error: MealError | null;
};
const initialState: State = {
  phase: 'idle',
  access: { availability: 'unknown', permission: 'unknown' },
  readingCount: null,
  query: null,
  result: null,
  error: null,
};

function describeError(error: unknown): MealError {
  if (error instanceof BackendClientError) {
    const { code, message, retryable } = error.apiError;
    const kind =
      code === 'WAITING_FOR_GLUCOSE_DATA'
        ? 'waiting'
        : policyMessages[code]
        ? 'policy'
        : ['NETWORK_ERROR', 'REQUEST_TIMEOUT'].includes(code)
        ? 'network'
        : 'backend';
    return { kind, code, message: policyMessages[code] ?? message, retryable };
  }
  if (error instanceof HealthConnectServiceError) {
    return {
      kind: 'health_connect',
      code: 'HEALTH_CONNECT_ERROR',
      message: error.message,
      retryable: false,
    };
  }
  return {
    kind: 'client',
    code: 'CLIENT_ERROR',
    message: 'Could not complete the meal analysis. Please try again.',
    retryable: false,
  };
}

export function useHealthMealViewModel() {
  const [description, setDescription] = useState('');
  const [weight, setWeight] = useState('');
  const [mealTime, setMealTime] = useState(() => new Date().toISOString());
  const [state, setState] = useState<State>(initialState);
  const inFlight = useRef(false);
  const mounted = useRef(true);
  // Stable identity/confirmation time for retries of the unchanged meal.
  const draft = useRef<{ key: string; id: string; food: FoodInfo } | null>(
    null,
  );
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  function updateDescription(value: string) {
    if (inFlight.current) {
      return;
    }
    setDescription(value);
    setState(s => ({ ...initialState, access: s.access }));
  }
  function updateMealTime(value: string) {
    if (inFlight.current) {
      return;
    }
    setMealTime(value);
    setState(s => ({ ...initialState, access: s.access }));
  }

  function updateWeight(value: string) {
    if (inFlight.current) {
      return;
    }
    setWeight(value);
    setState(s => ({ ...initialState, access: s.access }));
  }

  async function requestHealthPermission() {
    if (inFlight.current || !mounted.current) {
      return;
    }
    inFlight.current = true;
    setState(s => ({ ...s, phase: 'requesting_permission', error: null }));
    try {
      const access = await getHealthConnectAccess(true);
      if (mounted.current) {
        setState({ ...initialState, access });
      }
    } catch (error) {
      if (mounted.current) {
        setState({
          ...initialState,
          phase: 'error',
          error: describeError(error),
        });
      }
    } finally {
      inFlight.current = false;
    }
  }

  async function analyseHealthConnectMeal() {
    if (inFlight.current || !mounted.current) {
      return;
    }
    let mealAt: string;
    let query: ReturnType<typeof mealGlucoseQuery>;
    let food: FoodInfo;
    try {
      mealAt = normalizeMealTime(mealTime);
      query = mealGlucoseQuery(mealAt);
      food = manualFoodInfo(description, new Date(), weight);
    } catch (error) {
      setState(s => ({
        ...initialState,
        access: s.access,
        phase: 'error',
        error: {
          kind: 'input',
          code: 'INVALID_INPUT',
          message: (error as Error).message,
          retryable: false,
        },
      }));
      return;
    }
    inFlight.current = true;
    setState(s => ({
      ...initialState,
      access: s.access,
      phase: 'reading',
      query: { start: query.start.toISOString(), end: query.end.toISOString() },
    }));
    try {
      const key = JSON.stringify([
        mealAt,
        food.items[0].name,
        food.items[0].weight_g,
      ]);
      if (draft.current?.key !== key) {
        draft.current = { key, id: uuid.v4(), food };
      }
      const current = draft.current;
      const readings = await getBloodGlucoseReadings(query.start, query.end);
      if (!mounted.current) {
        return;
      }
      setState(s => ({
        ...s,
        phase: 'submitting',
        access: { availability: 'available', permission: 'granted' },
        readingCount: readings.length,
      }));
      // Even [] is submitted: the backend decides scientific sufficiency.
      const result = await analyzeMeal(
        manualAnalysisRequest(current.id, mealAt, current.food, readings),
      );
      if (mounted.current) {
        setState(s => ({ ...s, phase: 'success', result }));
      }
    } catch (error) {
      if (mounted.current) {
        const problem = describeError(error);
        setState(s => ({
          ...s,
          phase: problem.kind === 'waiting' ? 'waiting' : 'error',
          error: problem,
          access:
            error instanceof HealthConnectServiceError
              ? error.access ?? {
                  availability: 'unknown',
                  permission: 'unknown',
                }
              : s.access,
        }));
      }
    } finally {
      inFlight.current = false;
    }
  }

  return {
    description,
    weight,
    mealTime,
    state,
    busy: ['requesting_permission', 'reading', 'submitting'].includes(
      state.phase,
    ),
    updateDescription,
    updateWeight,
    updateMealTime,
    requestHealthPermission,
    analyseHealthConnectMeal,
  };
}
