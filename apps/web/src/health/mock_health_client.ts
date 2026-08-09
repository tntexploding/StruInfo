import {HealthNetworkError, type HealthClient} from './health_client.js';
import {parseHealthReadiness} from './health_contract.js';

export type MockHealthScenario =
  'ready' | 'not_ready' | 'offline' | 'unexpected_error';

export interface MockHealthOptions {
  readonly delayMs?: number;
  readonly scenario: MockHealthScenario;
}

export const READY_HEALTH_FIXTURE = {
  schema_version: '1',
  service: 'struinfo',
  role: 'api',
  status: 'ready',
  checks: {database: 'ready'},
} as const;

export const NOT_READY_HEALTH_FIXTURE = {
  schema_version: '1',
  service: 'struinfo',
  role: 'api',
  status: 'not_ready',
  checks: {database: 'not_ready'},
} as const;

async function wait(delayMs: number): Promise<void> {
  if (delayMs <= 0) return;
  await new Promise<void>((resolve) => {
    globalThis.setTimeout(resolve, delayMs);
  });
}

export function createMockHealthClient({
  delayMs = 0,
  scenario,
}: MockHealthOptions): HealthClient {
  return {
    async checkReadiness() {
      await wait(delayMs);

      switch (scenario) {
        case 'ready':
          return parseHealthReadiness(READY_HEALTH_FIXTURE);
        case 'not_ready':
          return parseHealthReadiness(NOT_READY_HEALTH_FIXTURE);
        case 'offline':
          throw new HealthNetworkError(
            'Deterministic mock reports an unavailable service.',
          );
        case 'unexpected_error':
          throw new Error('Deterministic mock reports an unexpected error.');
      }
    },
  };
}
