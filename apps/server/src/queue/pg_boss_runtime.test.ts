import {tmpdir} from 'node:os';
import {join} from 'node:path';

import {describe, expect, it, vi} from 'vitest';

import {
  parseRuntimeConfig,
  type ProcessRole,
} from '../config/runtime_config.js';
import type {PostgresPoolBoundary} from '../platform/database/postgresql/postgres_pool.js';
import {
  createPgBossDatabaseAdapter,
  createPgBossOptions,
  PgBossDatabaseError,
  PgBossRuntime,
  roleUsesPgBoss,
  type PgBossClient,
  type PgBossFactory,
  type PgBossRuntimeOptions,
} from './pg_boss_runtime.js';

const DATABASE_URL =
  'postgresql://struinfo_tm2_runtime:synthetic@localhost/struinfo';
const RUNTIME_ENVIRONMENT = {
  DATABASE_URL,
  STRUIINFO_DATA_ROOT: join(tmpdir(), 'struinfo-synthetic-data'),
  STRUIINFO_WORKSPACE_ID: '11111111-1111-4111-8111-111111111111',
};
const POOL = createFakePool();

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
        POOL,
      );

      expect(typeof options.db.executeSql).toBe('function');
      expect(options).toMatchObject({
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
      expect(options).not.toHaveProperty('connectionString');
      expect(options).not.toHaveProperty('password');
    },
  );

  it('does not construct pg-boss for the API-only role', () => {
    expect(roleUsesPgBoss('api')).toBe(false);
    expect(roleUsesPgBoss('scheduler')).toBe(true);
    expect(roleUsesPgBoss('worker')).toBe(true);
    expect(roleUsesPgBoss('all')).toBe(true);
  });

  it('delegates through the shared pool and removes driver failure detail', async () => {
    const query = vi.fn();
    const pool: PostgresPoolBoundary = {
      query(sql, parameters) {
        query(sql, parameters);
        return Promise.resolve({rows: [], rowCount: 0});
      },
      connect: () => Promise.reject(new Error('unexpected acquisition')),
      end: () => Promise.resolve(),
    };
    const database = createPgBossDatabaseAdapter(pool);

    await expect(
      database.executeSql('SELECT $1::text', ['synthetic']),
    ).resolves.toEqual({rows: []});
    expect(query).toHaveBeenCalledExactlyOnceWith('SELECT $1::text', [
      'synthetic',
    ]);

    const failed = createPgBossDatabaseAdapter({
      ...pool,
      query: () => Promise.reject(new Error('synthetic private detail')),
    });
    await expect(failed.executeSql('SELECT 1')).rejects.toEqual(
      new PgBossDatabaseError(),
    );
    await expect(failed.executeSql('SELECT 1')).rejects.not.toThrow(
      /private|synthetic/iu,
    );
  });
});

describe('PgBossRuntime', () => {
  it('starts with frozen runtime permissions and stops only once', async () => {
    const start = vi.fn(() => Promise.resolve());
    const stop = vi.fn(() => Promise.resolve());
    let receivedOptions: PgBossRuntimeOptions | undefined;
    const factory: PgBossFactory = {
      create: (options) => {
        receivedOptions = options;
        return {start, stop};
      },
    };
    const config = createPgBossOptions(
      parseRuntimeConfig('worker', RUNTIME_ENVIRONMENT),
      POOL,
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
          POOL,
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

function createFakePool(): PostgresPoolBoundary {
  return {
    query: () => Promise.resolve({rows: [], rowCount: 0}),
    connect: () => Promise.reject(new Error('unexpected acquisition')),
    end: () => Promise.resolve(),
  };
}
