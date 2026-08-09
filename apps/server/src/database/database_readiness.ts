import {Pool, type PoolConfig} from 'pg';

import type {RuntimeConfig} from '../config/runtime_config.js';
import type {Deadline} from '../lifecycle/deadline.js';
import type {RuntimeResource} from '../lifecycle/runtime_resource.js';

export const DATABASE_READINESS_SQL = 'SELECT 1 AS ready';

export interface DatabaseQueryExecutor {
  query(sql: string): Promise<unknown>;
}

export interface DatabasePool extends DatabaseQueryExecutor {
  end(): Promise<void>;
}

export interface DatabaseReadinessCheck {
  check(): Promise<boolean>;
}

export type DatabasePoolFactory = (config: PoolConfig) => DatabasePool;

export class BoundedDatabaseReadinessCheck implements DatabaseReadinessCheck {
  readonly #executor: DatabaseQueryExecutor;
  readonly #deadline: Deadline;
  readonly #timeoutMs: number;

  public constructor(options: {
    readonly executor: DatabaseQueryExecutor;
    readonly deadline: Deadline;
    readonly timeoutMs: number;
  }) {
    this.#executor = options.executor;
    this.#deadline = options.deadline;
    this.#timeoutMs = options.timeoutMs;
  }

  public async check(): Promise<boolean> {
    try {
      await this.#deadline.run(
        'database readiness check',
        this.#timeoutMs,
        () => this.#executor.query(DATABASE_READINESS_SQL),
      );
      return true;
    } catch {
      return false;
    }
  }
}

export class RuntimeDatabase implements RuntimeResource {
  public readonly name = 'postgresql';
  public readonly readiness: DatabaseReadinessCheck;
  readonly #pool: DatabasePool;
  #closed = false;

  public constructor(options: {
    readonly pool: DatabasePool;
    readonly deadline: Deadline;
    readonly readinessTimeoutMs: number;
  }) {
    this.#pool = options.pool;
    this.readiness = new BoundedDatabaseReadinessCheck({
      executor: this.#pool,
      deadline: options.deadline,
      timeoutMs: options.readinessTimeoutMs,
    });
  }

  public stopAccepting(): void {
    return;
  }

  public drain(): Promise<void> {
    return Promise.resolve();
  }

  public async close(): Promise<void> {
    if (this.#closed) {
      return;
    }
    this.#closed = true;
    await this.#pool.end();
  }
}

export function createRuntimeDatabase(
  config: Readonly<RuntimeConfig>,
  deadline: Deadline,
  poolFactory: DatabasePoolFactory = (poolConfig) => new Pool(poolConfig),
): RuntimeDatabase {
  const timeoutMs = config.databaseReadinessTimeoutMs;
  const pool = poolFactory({
    connectionString: config.databaseUrl,
    application_name: `struinfo-${config.role}`,
    connectionTimeoutMillis: timeoutMs,
    query_timeout: timeoutMs,
    statement_timeout: timeoutMs,
  });
  return new RuntimeDatabase({
    pool,
    deadline,
    readinessTimeoutMs: timeoutMs,
  });
}
