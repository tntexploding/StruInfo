import {
  HealthConfigurationError,
  type HealthClient,
  type HealthFetch,
} from './health_client.js';
import {createFetchHealthClient} from './fetch_health_client.js';
import {createMockHealthClient} from './mock_health_client.js';

export type HealthTransportMode = 'live' | 'mock';

export interface HealthRuntime {
  readonly client: HealthClient;
  readonly transportMode: HealthTransportMode;
}

const DEFAULT_MOCK_DELAY_MS = 480;

function createConfigurationFailureClient(
  error: HealthConfigurationError,
): HealthClient {
  return {
    checkReadiness() {
      return Promise.reject(error);
    },
  };
}

export function createHealthRuntime(
  apiBaseUrl: string | undefined,
  fetchImplementation?: HealthFetch,
): HealthRuntime {
  const normalizedBaseUrl = apiBaseUrl?.trim();
  if (normalizedBaseUrl === undefined || normalizedBaseUrl === '') {
    return {
      client: createMockHealthClient({
        delayMs: DEFAULT_MOCK_DELAY_MS,
        scenario: 'ready',
      }),
      transportMode: 'mock',
    };
  }

  try {
    return {
      client:
        fetchImplementation === undefined
          ? createFetchHealthClient(normalizedBaseUrl)
          : createFetchHealthClient(normalizedBaseUrl, fetchImplementation),
      transportMode: 'live',
    };
  } catch (error) {
    if (error instanceof HealthConfigurationError) {
      return {
        client: createConfigurationFailureClient(error),
        transportMode: 'live',
      };
    }
    throw error;
  }
}
