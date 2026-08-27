import {tmpdir} from 'node:os';
import {join} from 'node:path';

import {describe, expect, it, vi} from 'vitest';

import {parseRuntimeConfig} from '../config/runtime_config.js';
import {DeadlineExceededError, type Deadline} from '../lifecycle/deadline.js';
import {
  BoundedDatabaseReadinessCheck,
  createRuntimeDatabase,
  DATABASE_READINESS_SQL,
  type DatabasePoolFactory,
  RuntimeDatabase,
  RuntimeDatabaseError,
} from './database_readiness.js';
import type {PostgresPoolBoundary} from '../platform/database/postgresql/postgres_pool.js';

class ImmediateDeadline implements Deadline {
  public readonly calls: Readonly<{label: string; timeoutMs: number}>[] = [];

  public async run<T>(
    label: string,
    timeoutMs: number,
    operation: () => Promise<T>,
  ): Promise<T> {
    this.calls.push({label, timeoutMs});
    return operation();
  }
}

describe('BoundedDatabaseReadinessCheck', () => {
  it('executes only the fixed read-only probe within an explicit timeout', async () => {
    const query = vi.fn((sql: string) => {
      void sql;
      return Promise.resolve({rows: [{ready: 1}], rowCount: 1});
    });
    const deadline = new ImmediateDeadline();
    const readiness = new BoundedDatabaseReadinessCheck({
      executor: {query},
      deadline,
      timeoutMs: 321,
    });

    await expect(readiness.check()).resolves.toBe(true);
    expect(query).toHaveBeenCalledExactlyOnceWith(DATABASE_READINESS_SQL);
    expect(deadline.calls).toEqual([
      {label: 'database readiness check', timeoutMs: 321},
    ]);
    expect(DATABASE_READINESS_SQL).not.toMatch(
      /\b(?:alter|create|drop|grant|revoke|truncate)\b/iu,
    );
  });

  it('returns false when PostgreSQL is unavailable', async () => {
    const readiness = new BoundedDatabaseReadinessCheck({
      executor: {
        query: () => Promise.reject(new Error('synthetic unavailable')),
      },
      deadline: new ImmediateDeadline(),
      timeoutMs: 100,
    });

    await expect(readiness.check()).resolves.toBe(false);
  });

  it('returns false when the injected deadline expires', async () => {
    const deadline: Deadline = {
      run: () =>
        Promise.reject(
          new DeadlineExceededError('database readiness check', 100),
        ),
    };
    const query = vi.fn(() => Promise.resolve({rows: [], rowCount: 0}));
    const readiness = new BoundedDatabaseReadinessCheck({
      executor: {query},
      deadline,
      timeoutMs: 100,
    });

    await expect(readiness.check()).resolves.toBe(false);
    expect(query).not.toHaveBeenCalled();
  });
});

describe('RuntimeDatabase', () => {
  it.each(['synthetic_runtime', 'struinfo_tm2_migrator'])(
    'rejects non-runtime role %s before invoking the pool factory',
    (role) => {
      const poolFactory: DatabasePoolFactory = vi.fn(() => {
        throw new Error('pool factory must remain unreachable');
      });

      expect(() => {
        const config = parseRuntimeConfig('api', {
          DATABASE_URL: `postgresql://${role}:synthetic-private-password@localhost/struinfo`,
          STRUIINFO_DATA_ROOT: join(tmpdir(), 'struinfo-synthetic-data'),
          STRUIINFO_WORKSPACE_ID: '11111111-1111-4111-8111-111111111111',
        });
        createRuntimeDatabase(config, new ImmediateDeadline(), poolFactory);
      }).toThrow(
        'DATABASE_URL must be a valid single-host PostgreSQL connection URL',
      );
      expect(poolFactory).not.toHaveBeenCalled();
    },
  );

  it('sets bounded driver timeouts and closes the pool idempotently', async () => {
    const query = vi.fn(() => Promise.resolve({rows: [], rowCount: 0}));
    const end = vi.fn(() => Promise.resolve());
    const pool: PostgresPoolBoundary = {
      query,
      connect: () => Promise.reject(new Error('unexpected acquisition')),
      end,
    };
    let poolConfig: Parameters<DatabasePoolFactory>[0] | undefined;
    const config = parseRuntimeConfig('api', {
      DATABASE_URL:
        'postgresql://struinfo_tm2_runtime:synthetic@localhost/struinfo',
      STRUIINFO_DATA_ROOT: join(tmpdir(), 'struinfo-synthetic-data'),
      STRUIINFO_WORKSPACE_ID: '11111111-1111-4111-8111-111111111111',
    });
    const database = createRuntimeDatabase(
      config,
      new ImmediateDeadline(),
      (receivedConfig) => {
        poolConfig = receivedConfig;
        return pool;
      },
    );

    await expect(database.readiness.check()).resolves.toBe(true);
    await database.close();
    await database.close();

    expect(poolConfig).toEqual({
      host: 'localhost',
      port: 5432,
      database: 'struinfo',
      user: 'struinfo_tm2_runtime',
      password: 'synthetic',
      ssl: false,
      application_name: 'struinfo-tm2-runtime',
      options: '-c role=none -c search_path=pg_catalog',
    });
    expect(query).toHaveBeenCalledExactlyOnceWith('SELECT 1 AS ready');
    expect(end).toHaveBeenCalledTimes(1);
  });

  it('retains one safe pool shutdown failure across repeated close calls', async () => {
    const end = vi.fn(() =>
      Promise.reject(new Error('synthetic private shutdown detail')),
    );
    const database = new RuntimeDatabase({
      pool: {
        query: () => Promise.resolve({rows: [], rowCount: 0}),
        connect: () => Promise.reject(new Error('unexpected acquisition')),
        end,
      },
      deadline: new ImmediateDeadline(),
      readinessTimeoutMs: 100,
    });

    await expect(database.close()).rejects.toEqual(new RuntimeDatabaseError());
    await expect(database.close()).rejects.not.toThrow(/private|synthetic/iu);
    expect(end).toHaveBeenCalledTimes(1);
  });
});
