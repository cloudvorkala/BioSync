import { useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { normalizeMealTime } from '../models/manualMeal';
import type { GlucoseAccess } from '../services/glucoseProviderTypes';
import type { SamsungReadResult } from '../services/samsungHealthMapping';
import {
  getSamsungHealthAccess,
  readSamsungBloodGlucose,
  SamsungHealthServiceError,
} from '../services/samsungHealthService';

type State = {
  access: GlucoseAccess;
  operation:
    | 'idle'
    | 'checking'
    | 'requesting'
    | 'loading'
    | 'success'
    | 'error';
  result: SamsungReadResult | null;
  period: { start: string; end: string } | null;
  error: string | null;
};
const initial: State = {
  access: { availability: 'unknown', permission: 'unknown' },
  operation: 'idle',
  result: null,
  period: null,
  error: null,
};

export function useSamsungHealthViewModel() {
  const [range] = useState(() => {
    const end = new Date();
    return {
      start: new Date(end.getTime() - 86_400_000).toISOString(),
      end: end.toISOString(),
    };
  });
  const [startTime, setStartTime] = useState(range.start);
  const [endTime, setEndTime] = useState(range.end);
  const [state, setState] = useState<State>(initial);
  const mounted = useRef(true);
  const inFlight = useRef(false);

  async function run(operation: 'checking' | 'requesting' | 'loading') {
    if (inFlight.current || !mounted.current) {
      return;
    }
    inFlight.current = true;
    setState(s => ({ ...s, operation, result: null, error: null }));
    try {
      if (operation === 'loading') {
        let start: Date;
        let end: Date;
        try {
          start = new Date(normalizeMealTime(startTime));
          end = new Date(normalizeMealTime(endTime));
        } catch {
          throw new SamsungHealthServiceError(
            'SAMSUNG_INVALID_RANGE',
            'Enter valid UTC ISO timestamps ending in Z.',
          );
        }
        const result = await readSamsungBloodGlucose(start, end);
        if (mounted.current) {
          setState({
            access: { availability: 'available', permission: 'granted' },
            operation: 'success',
            result,
            period: { start: start.toISOString(), end: end.toISOString() },
            error: null,
          });
        }
      } else {
        const access = await getSamsungHealthAccess(operation === 'requesting');
        if (mounted.current) {
          setState({ ...initial, access });
        }
      }
    } catch (error) {
      if (mounted.current) {
        const known = error instanceof SamsungHealthServiceError ? error : null;
        setState(s => ({
          ...s,
          operation: 'error',
          result: null,
          access: known?.access ?? s.access,
          error: known
            ? `${known.code}: ${known.message}`
            : 'Samsung Health operation failed. Please retry.',
        }));
      }
    } finally {
      inFlight.current = false;
    }
  }

  useEffect(() => {
    mounted.current = true;
    run('checking');
    const listener = AppState.addEventListener('change', value => {
      if (value === 'active') {
        run('checking');
      }
    });
    return () => {
      mounted.current = false;
      listener.remove();
    };
    // Only access checking runs here; it does not capture the editable range.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function updateRange(setter: (value: string) => void, value: string) {
    if (!inFlight.current) {
      setter(value);
      setState(s => ({ ...initial, access: s.access }));
    }
  }

  return {
    state,
    startTime,
    endTime,
    busy: ['checking', 'requesting', 'loading'].includes(state.operation),
    updateStart: (value: string) => updateRange(setStartTime, value),
    updateEnd: (value: string) => updateRange(setEndTime, value),
    checkStatus: () => run('checking'),
    requestPermission: () => run('requesting'),
    loadReadings: () => run('loading'),
  };
}
