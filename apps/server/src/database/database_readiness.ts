import type {RuntimeConfig} from '../config/runtime_config.js';
import type {Deadline} from '../lifecycle/deadline.js';
import type {RuntimeResource} from '../lifecycle/runtime_resource.js';
import {
  createNodePostgresPool,
  type PostgresPoolBoundary,
  type PostgresPoolFactory,
} from '../platform/database/postgresql/postgres_pool.js';

export const DATABASE_READINESS_SQL = 'SELECT 1 AS ready';

export interface DatabaseQueryExecutor {
  query(sql: string): Promise<unknown>;
}

export interface DatabaseReadinessCheck {
  check(): Promise<boolean>;
}

export class RuntimeDatabaseError extends Error {
  public constructor() {
    super('PostgreSQL runtime lifecycle operation failed.');
    this.name = 'RuntimeDatabaseError';
  }
}

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
  public readonly pool: PostgresPoolBoundary;
  #closePromise: Promise<void> | undefined;

  public constructor(options: {
    readonly pool: PostgresPoolBoundary;
    readonly deadline: Deadline;
    readonly readinessTimeoutMs: number;
  }) {
    this.pool = options.pool;
    this.readiness = new BoundedDatabaseReadinessCheck({
      executor: this.pool,
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

  public close(): Promise<void> {
    if (this.#closePromise === undefined) {
      this.#closePromise = this.#closeOwnedPool();
    }
    return this.#closePromise;
  }

  async #closeOwnedPool(): Promise<void> {
    try {
      await this.pool.end();
    } catch {
      throw new RuntimeDatabaseError();
    }
  }
}

export function createRuntimeDatabase(
  config: Readonly<RuntimeConfig>,
  deadline: Deadline,
  poolFactory: PostgresPoolFactory = createNodePostgresPool,
): RuntimeDatabase {
  const timeoutMs = config.databaseReadinessTimeoutMs;
  let pool: PostgresPoolBoundary;
  try {
    pool = poolFactory(config.database);
  } catch {
    throw new RuntimeDatabaseError();
  }
  return new RuntimeDatabase({
    pool,
    deadline,
    readinessTimeoutMs: timeoutMs,
  });
}

export type DatabasePoolFactory = PostgresPoolFactory;
