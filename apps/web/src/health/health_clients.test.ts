import {afterEach, describe, expect, it, vi} from 'vitest';

import {createFetchHealthClient} from './fetch_health_client.js';
import {
  HealthConfigurationError,
  HealthContractError,
  type HealthFetch,
  HealthNetworkError,
  HealthResponseError,
} from './health_client.js';
import {createHealthRuntime} from './health_runtime.js';
import {
  NOT_READY_HEALTH_FIXTURE,
  READY_HEALTH_FIXTURE,
} from './mock_health_client.js';

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    headers: {'content-type': 'application/json; charset=utf-8'},
    status,
  });
}

function inputUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

afterEach(() => {
  vi.useRealTimers();
});

describe('health clients', () => {
  it('keeps deterministic fixtures aligned with the frozen contract examples', () => {
    expect(READY_HEALTH_FIXTURE).toEqual({
      checks: {database: 'ready'},
      role: 'api',
      schema_version: '1',
      service: 'struinfo',
      status: 'ready',
    });
    expect(NOT_READY_HEALTH_FIXTURE).toEqual({
      checks: {database: 'not_ready'},
      role: 'api',
      schema_version: '1',
      service: 'struinfo',
      status: 'not_ready',
    });
  });

  it('requests only the safe relative readiness path', async () => {
    const requests: {init: RequestInit | undefined; url: string}[] = [];
    const fetchImplementation: HealthFetch = (input, init) => {
      requests.push({init, url: inputUrl(input)});
      return Promise.resolve(jsonResponse(READY_HEALTH_FIXTURE, 200));
    };

    const client = createFetchHealthClient(
      'http://127.0.0.1:3000',
      fetchImplementation,
    );
    await expect(client.checkReadiness()).resolves.toEqual(
      READY_HEALTH_FIXTURE,
    );

    expect(requests).toHaveLength(1);
    const request = requests[0];
    if (request === undefined) {
      throw new Error('Expected one health request.');
    }
    expect(request.url).toBe('http://127.0.0.1:3000/health/ready');
    expect(request.init).toMatchObject({
      cache: 'no-store',
      credentials: 'omit',
      method: 'GET',
      redirect: 'error',
    });
  });

  it('accepts the frozen 503 not-ready response', async () => {
    const fetchImplementation: HealthFetch = () =>
      Promise.resolve(jsonResponse(NOT_READY_HEALTH_FIXTURE, 503));
    const client = createFetchHealthClient(
      'https://localhost:3000/',
      fetchImplementation,
    );

    await expect(client.checkReadiness()).resolves.toEqual(
      NOT_READY_HEALTH_FIXTURE,
    );
  });

  it('reports unsupported HTTP, invalid JSON, and network failures', async () => {
    const unsupported = createFetchHealthClient('https://localhost:3000/', () =>
      Promise.resolve(jsonResponse({error: 'safe'}, 500)),
    );
    const invalidJson = createFetchHealthClient('https://localhost:3000/', () =>
      Promise.resolve(
        new Response('{', {
          headers: {'content-type': 'application/json'},
          status: 200,
        }),
      ),
    );
    const networkFailure = createFetchHealthClient(
      'https://localhost:3000/',
      () => Promise.reject(new Error('Synthetic network failure.')),
    );

    await expect(unsupported.checkReadiness()).rejects.toBeInstanceOf(
      HealthResponseError,
    );
    await expect(invalidJson.checkReadiness()).rejects.toBeInstanceOf(
      HealthContractError,
    );
    await expect(networkFailure.checkReadiness()).rejects.toBeInstanceOf(
      HealthNetworkError,
    );
  });

  it('rejects unsafe API base URLs before any request', () => {
    expect(() => createFetchHealthClient('ftp://localhost/')).toThrow(
      HealthConfigurationError,
    );
    expect(() =>
      createFetchHealthClient('https://user:secret@localhost/'),
    ).toThrow(HealthConfigurationError);
  });

  it('surfaces invalid runtime configuration without mounting a blank page', async () => {
    let liveRequestCount = 0;
    const guardedFetch: HealthFetch = () => {
      liveRequestCount += 1;
      return Promise.reject(new Error('Invalid configuration must not fetch.'));
    };
    const runtime = createHealthRuntime('not an absolute URL', guardedFetch);

    expect(runtime.transportMode).toBe('live');
    await expect(runtime.client.checkReadiness()).rejects.toBeInstanceOf(
      HealthConfigurationError,
    );
    expect(liveRequestCount).toBe(0);
  });

  it('never calls an injected live transport in mock mode', async () => {
    vi.useFakeTimers();
    let liveRequestCount = 0;
    const guardedFetch: HealthFetch = () => {
      liveRequestCount += 1;
      return Promise.reject(
        new Error('Live transport must not run in mock mode.'),
      );
    };
    const runtime = createHealthRuntime(undefined, guardedFetch);

    const readinessPromise = runtime.client.checkReadiness();
    await vi.advanceTimersByTimeAsync(480);
    await expect(readinessPromise).resolves.toEqual(READY_HEALTH_FIXTURE);
    expect(runtime.transportMode).toBe('mock');
    expect(liveRequestCount).toBe(0);
  });
});
