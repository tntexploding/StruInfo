import type {Response} from 'express';
import {describe, expect, it, vi} from 'vitest';

import type {DatabaseReadinessCheck} from '../database/database_readiness.js';
import {OperationalHealthService, ReadinessGate} from './operational_health.js';
import {
  HEALTH_CACHE_CONTROL,
  HEALTH_CONTENT_TYPE,
  OperationalHealthController,
  OperationalHealthModule,
} from '../transport/operational_health_controller.js';

describe('OperationalHealthService', () => {
  it.each(['api', 'scheduler', 'worker', 'all'] as const)(
    'returns the exact live body for %s',
    (role) => {
      const {health} = createHealth(role, true);

      expect(health.live()).toEqual({
        statusCode: 200,
        body: {
          schema_version: '1',
          service: 'struinfo',
          role,
          status: 'ok',
        },
      });
    },
  );

  it('returns exact ready success after initialization', async () => {
    const {health, gate} = createHealth('api', true);
    gate.markInitialized();

    await expect(health.ready()).resolves.toEqual({
      statusCode: 200,
      body: {
        schema_version: '1',
        service: 'struinfo',
        role: 'api',
        status: 'ready',
        checks: {database: 'ready'},
      },
    });
  });

  it('returns exact not-ready before initialization without querying', async () => {
    const check = vi.fn(() => Promise.resolve(true));
    const gate = new ReadinessGate();
    const health = new OperationalHealthService({
      role: 'worker',
      gate,
      database: {check},
    });

    await expect(health.ready()).resolves.toEqual({
      statusCode: 503,
      body: {
        schema_version: '1',
        service: 'struinfo',
        role: 'worker',
        status: 'not_ready',
        checks: {database: 'not_ready'},
      },
    });
    expect(check).not.toHaveBeenCalled();
  });

  it('returns exact not-ready when the database is unavailable', async () => {
    const {health, gate} = createHealth('scheduler', false);
    gate.markInitialized();

    await expect(health.ready()).resolves.toMatchObject({
      statusCode: 503,
      body: {
        schema_version: '1',
        service: 'struinfo',
        role: 'scheduler',
        status: 'not_ready',
        checks: {database: 'not_ready'},
      },
    });
  });

  it('stays not-ready if shutdown starts during a database check', async () => {
    const gate = new ReadinessGate();
    gate.markInitialized();
    let finishCheck: ((ready: boolean) => void) | undefined;
    const database: DatabaseReadinessCheck = {
      check: () =>
        new Promise<boolean>((resolve) => {
          finishCheck = resolve;
        }),
    };
    const health = new OperationalHealthService({role: 'all', gate, database});

    const result = health.ready();
    gate.beginShutdown();
    finishCheck?.(true);

    await expect(result).resolves.toMatchObject({
      statusCode: 503,
      body: {status: 'not_ready', checks: {database: 'not_ready'}},
    });
  });
});

describe('OperationalHealthController', () => {
  it('registers only the operational health controller', () => {
    const {health} = createHealth('scheduler', true);

    expect(OperationalHealthModule.register(health).controllers).toEqual([
      OperationalHealthController,
    ]);
  });

  it('writes the exact status, content type, cache header, and live JSON', () => {
    const {health} = createHealth('api', true);
    const controller = new OperationalHealthController(health);
    const {response, recording} = createResponseRecorder();

    controller.live(response);

    expect(recording).toEqual({
      statusCode: 200,
      headers: {
        'Content-Type': HEALTH_CONTENT_TYPE,
        'Cache-Control': HEALTH_CACHE_CONTROL,
      },
      body: JSON.stringify({
        schema_version: '1',
        service: 'struinfo',
        role: 'api',
        status: 'ok',
      }),
    });
  });

  it('writes exact 503 ready transport semantics', async () => {
    const {health} = createHealth('worker', false);
    const controller = new OperationalHealthController(health);
    const {response, recording} = createResponseRecorder();

    await controller.ready(response);

    expect(recording.statusCode).toBe(503);
    expect(recording.headers).toEqual({
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
    });
    expect(JSON.parse(recording.body ?? '')).toEqual({
      schema_version: '1',
      service: 'struinfo',
      role: 'worker',
      status: 'not_ready',
      checks: {database: 'not_ready'},
    });
  });
});

function createHealth(
  role: 'api' | 'scheduler' | 'worker' | 'all',
  databaseReady: boolean,
): Readonly<{health: OperationalHealthService; gate: ReadinessGate}> {
  const gate = new ReadinessGate();
  const database: DatabaseReadinessCheck = {
    check: () => Promise.resolve(databaseReady),
  };
  return {
    health: new OperationalHealthService({role, gate, database}),
    gate,
  };
}

function createResponseRecorder(): Readonly<{
  response: Response;
  recording: {
    statusCode?: number;
    headers: Record<string, string>;
    body?: string;
  };
}> {
  const recording: {
    statusCode?: number;
    headers: Record<string, string>;
    body?: string;
  } = {headers: {}};
  const response = {
    status(statusCode: number) {
      recording.statusCode = statusCode;
      return response;
    },
    setHeader(name: string, value: string) {
      recording.headers[name] = value;
      return response;
    },
    end(body: string) {
      recording.body = body;
      return response;
    },
  } as unknown as Response;
  return {response, recording};
}
