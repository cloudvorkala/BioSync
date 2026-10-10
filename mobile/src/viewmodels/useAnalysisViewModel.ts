import { useCallback, useEffect, useRef, useState } from 'react';
import fixture from '../dev/analysisFixture.json';
import type { AnalysisRequest, AnalysisResult, ApiError } from '../models/api';
import { analyzeMeal, BackendClientError } from '../services/backendClient';

export type AnalysisState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'success'; result: AnalysisResult }
  | { status: 'error'; error: ApiError };

type Analyzer = (request: AnalysisRequest) => Promise<AnalysisResult>;

/** Development screen state, not persisted MealRecord workflow state. */
export function useAnalysisViewModel(analyze: Analyzer = analyzeMeal) {
  const [state, setState] = useState<AnalysisState>({ status: 'idle' });
  const inFlight = useRef(false);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const runTestAnalysis = useCallback(async () => {
    if (inFlight.current || !mounted.current) {
      return;
    }
    inFlight.current = true;
    setState({ status: 'loading' });
    try {
      const result = await analyze(fixture);
      if (mounted.current) {
        setState({ status: 'success', result });
      }
    } catch (error) {
      if (mounted.current) {
        setState({
          status: 'error',
          error:
            error instanceof BackendClientError
              ? error.apiError
              : {
                  code: 'CLIENT_ERROR',
                  message: 'Analysis could not be completed. Please try again.',
                  retryable: false,
                },
        });
      }
    } finally {
      inFlight.current = false;
    }
  }, [analyze]);

  return { state, runTestAnalysis };
}
