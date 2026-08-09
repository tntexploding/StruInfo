import {useCallback, useEffect, useRef, useState} from 'react';

import type {HealthClient} from './health_client.js';
import {
  type HealthPageState,
  INITIAL_HEALTH_STATE,
  runHealthCheck,
} from './health_state.js';

export interface OperationalHealthModel {
  readonly retry: () => void;
  readonly state: HealthPageState;
}

export function useOperationalHealth(
  healthClient: HealthClient,
): OperationalHealthModel {
  const [state, setState] = useState<HealthPageState>(INITIAL_HEALTH_STATE);
  const requestSequence = useRef(0);

  const retry = useCallback(() => {
    const requestId = ++requestSequence.current;
    void runHealthCheck(healthClient, (nextState) => {
      if (requestSequence.current === requestId) {
        setState(nextState);
      }
    });
  }, [healthClient]);

  useEffect(() => {
    retry();
    return () => {
      requestSequence.current += 1;
    };
  }, [retry]);

  return {retry, state};
}
