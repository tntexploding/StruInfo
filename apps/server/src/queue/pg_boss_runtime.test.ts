import {tmpdir} from 'node:os';
import {join} from 'node:path';

import type {ConstructorOptions} from 'pg-boss';
import {describe, expect, it, vi} from 'vitest';

import {
  parseRuntimeConfig,
  type ProcessRole,
} from '../config/runtime_config.js';
import {
  createPgBossOptions,
  PgBossRuntime,
  roleUsesPgBoss,
  type PgBossClient,
  type PgBossFactory,
} from './pg_boss_runtime.js';

const DATABASE_URL = 'postgresql://runtime:synthetic@localhost/struinfo';
const RUNTIME_ENVIRONMENT = {
  DATABASE_URL,
  STRUIINFO_DATA_ROOT: join(tmpdir(), 'struinfo-synthetic-data'),
};

describe('createPgBossOptions', () => {
  it.each([
    ['scheduler', true, false],
    ['worker', false, true],
    ['all', true, true],
  ] satisfies readonly [ProcessRole, boolean, boolean][])(
    'disables every implicit DDL path for the %s role',
    (role, schedule, supervise) => {
      const options = createPgBossOptions(
        parseRuntimeConfig(role, RUNTIME_ENVIRONMENT),
      );

      expect(options).toEqual({
        connectionString: DATABASE_URL,
        schema: 'pgboss',
        migrate: false,
        createSchema: false,
        schedule,
        supervise,
        useListenNotify: false,
        connectionTimeoutMillis: 1000,
      });
      expect(options.migrate).toBe(false);
      expect(options.createSchema).toBe(false);
    },
  );

  it('does not construct pg-boss for the API-only role', () => {
    expect(roleUsesPgBoss('api')).toBe(false);
    expect(roleUsesPgBoss('scheduler')).toBe(true);
    expect(roleUsesPgBoss('worker')).toBe(true);
    expect(roleUsesPgBoss('all')).toBe(true);
  });
});

describe('PgBossRuntime', () => {
  it('starts with frozen runtime permissions and stops only once', async () => {
    const start = vi.fn(() => Promise.resolve());
    const stop = vi.fn(() => Promise.resolve());
    let receivedOptions: ConstructorOptions | undefined;
    const factory: PgBossFactory = {
      create: (options) => {
        receivedOptions = options;
        return {start, stop};
      },
    };
    const config = createPgBossOptions(
      parseRuntimeConfig('worker', RUNTIME_ENVIRONMENT),
    );

    const runtime = await PgBossRuntime.start({
      factory,
      config,
      shutdownTimeoutMs: 1234,
    });
    runtime.stopAccepting();
    runtime.stopAccepting();
    await runtime.drain();
    await runtime.close();

    expect(receivedOptions).toMatchObject({
      schema: 'pgboss',
      migrate: false,
      createSchema: false,
    });
    expect(start).toHaveBeenCalledTimes(1);
    expect(stop).toHaveBeenCalledExactlyOnceWith({
      close: true,
      graceful: true,
      timeout: 1234,
    });
  });

  it('cleans a partially started pg-boss client after startup failure', async () => {
    const startupFailure = new Error('synthetic startup failure');
    const stop = vi.fn(() => Promise.resolve());
    const client: PgBossClient = {
      start: () => Promise.reject(startupFailure),
      stop,
    };
    const factory: PgBossFactory = {create: () => client};

    await expect(
      PgBossRuntime.start({
        factory,
        config: createPgBossOptions(
          parseRuntimeConfig('scheduler', RUNTIME_ENVIRONMENT),
        ),
        shutdownTimeoutMs: 2000,
      }),
    ).rejects.toBe(startupFailure);
    expect(stop).toHaveBeenCalledExactlyOnceWith({
      close: true,
      graceful: false,
      timeout: 2000,
    });
  });
});
