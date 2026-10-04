import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import type { GlucoseReading } from '../models/api';
import {
  getBloodGlucoseReadings,
  getHealthConnectAccess,
  HealthConnectServiceError,
  type HealthAccess,
} from '../services/healthConnectService';

type State = HealthAccess & {
  operation:
    | 'idle'
    | 'checking'
    | 'requesting'
    | 'loading'
    | 'success'
    | 'error';
  readings: GlucoseReading[] | null;
  period: { start: string; end: string } | null;
  error: string | null;
};

export function useHealthConnectViewModel() {
  const [state, setState] = useState<State>({
    availability: 'unknown',
    permission: 'unknown',
    operation: 'idle',
    readings: null,
    period: null,
    error: null,
  });
  const busy = useRef(false);
  const mounted = useRef(false);

  const run = useCallback(
    async (operation: 'checking' | 'requesting' | 'loading') => {
      if (busy.current || !mounted.current) {
        return;
      }
      busy.current = true;
      setState(s => ({
        ...s,
        operation,
        error: null,
        readings: null,
        period: null,
      }));
      try {
        if (operation === 'loading') {
          const end = new Date();
          const start = new Date(end.getTime() - 24 * 60 * 60 * 1000);
          const readings = await getBloodGlucoseReadings(start, end);
          if (mounted.current) {
            setState({
              availability: 'available',
              permission: 'granted',
              operation: 'success',
              readings,
              period: { start: start.toISOString(), end: end.toISOString() },
              error: null,
            });
          }
        } else {
          const access = await getHealthConnectAccess(
            operation === 'requesting',
          );
          if (mounted.current) {
            setState(s => ({ ...s, ...access, operation: 'idle' }));
          }
        }
      } catch (error) {
        if (mounted.current) {
          setState(s => ({
            ...s,
            ...(error instanceof HealthConnectServiceError && error.access
              ? error.access
              : {
                  availability: 'unknown' as const,
                  permission: 'unknown' as const,
                }),
            operation: 'error',
            error:
              error instanceof HealthConnectServiceError
                ? error.message
                : 'Health Connect operation failed. Please retry.',
          }));
        }
      } finally {
        busy.current = false;
      }
    },
    [],
  );

  useEffect(() => {
    mounted.current = true;
    run('checking');
    const subscription = AppState.addEventListener('change', next => {
      if (next === 'active') {
        run('checking');
      }
    });
    return () => {
      mounted.current = false;
      subscription.remove();
    };
  }, [run]);

  return {
    state,
    busy: ['checking', 'requesting', 'loading'].includes(state.operation),
    requestHealthPermission: () => run('requesting'),
    loadBloodGlucose: () => run('loading'),
  };
}
