import {afterEach, describe, expect, it, vi} from 'vitest';

import {type HealthClient, HealthNetworkError} from './health_client.js';
import {runHealthCheck, type HealthPageState} from './health_state.js';
import {
  createMockHealthClient,
  READY_HEALTH_FIXTURE,
} from './mock_health_client.js';

afterEach(() => {
  vi.useRealTimers();
});

describe('runHealthCheck', () => {
  it('keeps the delayed client in loading before ready', async () => {
    vi.useFakeTimers();
    const states: HealthPageState[] = [];
    const checkPromise = runHealthCheck(
      createMockHealthClient({delayMs: 1_200, scenario: 'ready'}),
      (state) => states.push(state),
    );

    expect(states).toEqual([{kind: 'loading'}]);
    await vi.advanceTimersByTimeAsync(1_200);
    await checkPromise;
    expect(states).toEqual([
      {kind: 'loading'},
      {kind: 'ready', response: READY_HEALTH_FIXTURE},
    ]);
  });

  it.each([
    ['ready', 'ready'],
    ['not_ready', 'not_ready'],
    ['offline', 'not_ready'],
    ['unexpected_error', 'unexpected_error'],
  ] as const)('maps mock %s to view %s', async (scenario, expectedKind) => {
    const states: HealthPageState[] = [];
    await runHealthCheck(createMockHealthClient({scenario}), (state) =>
      states.push(state),
    );

    expect(states.at(-1)?.kind).toBe(expectedKind);
  });

  it('moves from offline to ready when the user retries', async () => {
    let attempt = 0;
    const sequenceClient: HealthClient = {
      checkReadiness() {
        attempt += 1;
        if (attempt === 1) {
          return Promise.reject(
            new HealthNetworkError('Synthetic first-attempt outage.'),
          );
        }
        return Promise.resolve(READY_HEALTH_FIXTURE);
      },
    };
    const states: HealthPageState[] = [];

    await runHealthCheck(sequenceClient, (state) => states.push(state));
    await runHealthCheck(sequenceClient, (state) => states.push(state));

    expect(states.map((state) => state.kind)).toEqual([
      'loading',
      'not_ready',
      'loading',
      'ready',
    ]);
  });
});
