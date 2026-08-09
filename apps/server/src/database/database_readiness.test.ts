import type {PoolConfig} from 'pg';
import {describe, expect, it, vi} from 'vitest';

import {parseRuntimeConfig} from '../config/runtime_config.js';
import {DeadlineExceededError, type Deadline} from '../lifecycle/deadline.js';
import {
  BoundedDatabaseReadinessCheck,
  createRuntimeDatabase,
  DATABASE_READINESS_SQL,
  type DatabasePool,
} from './database_readiness.js';

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
      return Promise.resolve({rows: [{ready: 1}]});
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
    const query = vi.fn(() => Promise.resolve());
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
  it('sets bounded driver timeouts and closes the pool idempotently', async () => {
    const query = vi.fn(() => Promise.resolve({rows: []}));
    const end = vi.fn(() => Promise.resolve());
    const pool: DatabasePool = {query, end};
    let poolConfig: PoolConfig | undefined;
    const config = parseRuntimeConfig('api', {
      DATABASE_URL: 'postgresql://runtime:synthetic@localhost/struinfo',
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

    expect(poolConfig).toMatchObject({
      connectionString: config.databaseUrl,
      application_name: 'struinfo-api',
      connectionTimeoutMillis: 1000,
      query_timeout: 1000,
      statement_timeout: 1000,
    });
    expect(query).toHaveBeenCalledExactlyOnceWith('SELECT 1 AS ready');
    expect(end).toHaveBeenCalledTimes(1);
  });
});
