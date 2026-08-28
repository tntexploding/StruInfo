import {
  HealthConfigurationError,
  HealthContractError,
  type HealthClient,
  type HealthFetch,
  HealthNetworkError,
  HealthResponseError,
} from './health_client.js';
import {
  HEALTH_READINESS_PATH,
  parseHealthReadiness,
} from './health_contract.js';

const ACCEPTED_RESPONSE_STATUSES = new Set([200, 503]);

function createReadinessUrl(apiBaseUrl: string): URL {
  let baseUrl: URL;
  try {
    baseUrl = new URL(apiBaseUrl);
  } catch (cause) {
    throw new HealthConfigurationError(
      'VITE_STRUIINFO_API_BASE_URL must be an absolute URL.',
      {cause},
    );
  }

  if (
    (baseUrl.protocol !== 'http:' && baseUrl.protocol !== 'https:') ||
    baseUrl.username !== '' ||
    baseUrl.password !== '' ||
    baseUrl.search !== '' ||
    baseUrl.hash !== ''
  ) {
    throw new HealthConfigurationError(
      'The operational health base URL must be a plain HTTP(S) URL.',
    );
  }

  if (!baseUrl.pathname.endsWith('/')) {
    baseUrl.pathname = `${baseUrl.pathname}/`;
  }

  return new URL(HEALTH_READINESS_PATH, baseUrl);
}

async function readJson(response: Response): Promise<unknown> {
  const contentType = response.headers.get('content-type')?.toLowerCase();
  if (contentType?.includes('application/json') !== true) {
    throw new HealthContractError(
      'Operational health did not return application/json.',
    );
  }

  try {
    return await response.json();
  } catch (cause) {
    throw new HealthContractError('Operational health returned invalid JSON.', {
      cause,
    });
  }
}

export function createFetchHealthClient(
  apiBaseUrl: string,
  fetchImplementation: HealthFetch = globalThis.fetch,
): HealthClient {
  const readinessUrl = createReadinessUrl(apiBaseUrl);

  return {
    async checkReadiness(options) {
      const requestInit: RequestInit = {
        cache: 'no-store',
        credentials: 'omit',
        headers: {Accept: 'application/json'},
        method: 'GET',
        redirect: 'error',
      };
      if (options?.signal !== undefined) {
        requestInit.signal = options.signal;
      }

      let response: Response;
      try {
        response = await fetchImplementation(readinessUrl, requestInit);
      } catch (cause) {
        throw new HealthNetworkError(
          'Operational health request could not reach the configured service.',
          {cause},
        );
      }

      if (!ACCEPTED_RESPONSE_STATUSES.has(response.status)) {
        throw new HealthResponseError(response.status);
      }

      const readiness = parseHealthReadiness(await readJson(response));
      const hasMatchingStatus =
        (response.status === 200 && readiness.status === 'ready') ||
        (response.status === 503 && readiness.status === 'not_ready');
      if (!hasMatchingStatus) {
        throw new HealthContractError(
          'HTTP status and operational readiness body disagree.',
        );
      }

      return readiness;
    },
  };
}
