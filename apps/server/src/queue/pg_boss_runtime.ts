import {PgBoss, type ConstructorOptions, type StopOptions} from 'pg-boss';

import type {ProcessRole, RuntimeConfig} from '../config/runtime_config.js';
import type {RuntimeResource} from '../lifecycle/runtime_resource.js';
import {toError} from '../lifecycle/runtime_resource.js';
import type {PostgresPoolBoundary} from '../platform/database/postgresql/postgres_pool.js';

export interface PgBossClient {
  start(): Promise<unknown>;
  stop(options?: StopOptions): Promise<void>;
}

export interface PgBossDatabaseBoundary {
  executeSql(sql: string, values?: unknown[]): Promise<{rows: unknown[]}>;
}

export class PgBossDatabaseError extends Error {
  public constructor() {
    super('pg-boss database operation failed.');
    this.name = 'PgBossDatabaseError';
  }
}

export type PgBossRuntimeOptions = ConstructorOptions &
  Readonly<{db: PgBossDatabaseBoundary}>;

export interface PgBossFactory {
  create(options: PgBossRuntimeOptions): PgBossClient;
}

export class SystemPgBossFactory implements PgBossFactory {
  public create(options: PgBossRuntimeOptions): PgBossClient {
    return new PgBoss(options);
  }
}

export class PgBossRuntime implements RuntimeResource {
  public readonly name = 'pg-boss';
  readonly #client: PgBossClient;
  readonly #timeoutMs: number;
  #stopPromise: Promise<void> | undefined;

  private constructor(client: PgBossClient, timeoutMs: number) {
    this.#client = client;
    this.#timeoutMs = timeoutMs;
  }

  public static async start(options: {
    readonly factory: PgBossFactory;
    readonly config: PgBossRuntimeOptions;
    readonly shutdownTimeoutMs: number;
  }): Promise<PgBossRuntime> {
    const client = options.factory.create(options.config);
    try {
      await client.start();
    } catch (startupFailure) {
      try {
        await client.stop({
          close: true,
          graceful: false,
          timeout: options.shutdownTimeoutMs,
        });
      } catch (cleanupFailure) {
        throw new AggregateError(
          [toError(startupFailure), toError(cleanupFailure)],
          'pg-boss startup and cleanup failed.',
          {cause: cleanupFailure},
        );
      }
      throw toError(startupFailure);
    }
    return new PgBossRuntime(client, options.shutdownTimeoutMs);
  }

  public stopAccepting(): void {
    if (this.#stopPromise !== undefined) {
      return;
    }
    this.#stopPromise = this.#client.stop({
      close: true,
      graceful: true,
      timeout: this.#timeoutMs,
    });
    void this.#stopPromise.catch(() => undefined);
  }

  public async drain(): Promise<void> {
    await this.#stopPromise;
  }

  public async close(): Promise<void> {
    if (this.#stopPromise === undefined) {
      this.stopAccepting();
    }
    await this.#stopPromise;
  }
}

export function createPgBossOptions(
  config: Readonly<RuntimeConfig>,
  pool: PostgresPoolBoundary,
): PgBossRuntimeOptions {
  return {
    db: createPgBossDatabaseAdapter(pool),
    schema: 'pgboss',
    migrate: false,
    createSchema: false,
    schedule: hasScheduler(config.role),
    supervise: hasWorker(config.role),
    useListenNotify: false,
    connectionTimeoutMillis: config.databaseReadinessTimeoutMs,
  };
}

export function createPgBossDatabaseAdapter(
  pool: PostgresPoolBoundary,
): PgBossDatabaseBoundary {
  return Object.freeze({
    async executeSql(sql: string, values: unknown[] = []) {
      try {
        const result = await pool.query(sql, values);
        return {rows: [...result.rows]};
      } catch {
        throw new PgBossDatabaseError();
      }
    },
  });
}

export function roleUsesPgBoss(role: ProcessRole): boolean {
  return role === 'scheduler' || role === 'worker' || role === 'all';
}

function hasScheduler(role: ProcessRole): boolean {
  return role === 'scheduler' || role === 'all';
}

function hasWorker(role: ProcessRole): boolean {
  return role === 'worker' || role === 'all';
}
