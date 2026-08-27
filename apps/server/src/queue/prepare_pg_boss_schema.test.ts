import {describe, expect, it, vi} from 'vitest';

import type {PostgresPoolBoundary} from '../platform/database/postgresql/postgres_pool.js';
import {
  createPgBossPreparationOptions,
  preparePgBossSchema,
} from './prepare_pg_boss_schema.js';
import type {PgBossFactory, PgBossRuntimeOptions} from './pg_boss_runtime.js';

const POOL: PostgresPoolBoundary = {
  query: () => Promise.resolve({rows: [], rowCount: 0}),
  connect: () => Promise.reject(new Error('not used')),
  end: () => Promise.resolve(),
};

describe('pg-boss production schema preparation', () => {
  it('enables only the explicit migrator-owned schema path', () => {
    expect(createPgBossPreparationOptions(POOL)).toMatchObject({
      schema: 'pgboss',
      migrate: true,
      createSchema: true,
      schedule: false,
      supervise: false,
      useListenNotify: false,
      connectionTimeoutMillis: 1000,
    });
  });

  it('stops the preparation client after success and failure', async () => {
    const stop = vi.fn(() => Promise.resolve());
    let received: PgBossRuntimeOptions | undefined;
    const successFactory: PgBossFactory = {
      create: (options) => {
        received = options;
        return {start: () => Promise.resolve(), stop};
      },
    };
    await preparePgBossSchema({factory: successFactory, pool: POOL});
    expect(received?.migrate).toBe(true);
    expect(stop).toHaveBeenCalledExactlyOnceWith({
      close: true,
      graceful: false,
      timeout: 60_000,
    });

    const failedStop = vi.fn(() => Promise.resolve());
    const failure = new Error('synthetic preparation failure');
    await expect(
      preparePgBossSchema({
        factory: {
          create: () => ({
            start: () => Promise.reject(failure),
            stop: failedStop,
          }),
        },
        pool: POOL,
      }),
    ).rejects.toBe(failure);
    expect(failedStop).toHaveBeenCalledOnce();
  });
});
