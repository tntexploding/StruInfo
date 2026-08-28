import type {PostgresPoolBoundary} from '../platform/database/postgresql/postgres_pool.js';
import {
  createPgBossDatabaseAdapter,
  type PgBossClient,
  type PgBossFactory,
  type PgBossRuntimeOptions,
} from './pg_boss_runtime.js';

export const PG_BOSS_PREPARATION_TIMEOUT_MS = 60_000;

export function createPgBossPreparationOptions(
  pool: PostgresPoolBoundary,
): PgBossRuntimeOptions {
  return {
    db: createPgBossDatabaseAdapter(pool),
    schema: 'pgboss',
    migrate: true,
    createSchema: true,
    schedule: false,
    supervise: false,
    useListenNotify: false,
    connectionTimeoutMillis: 1_000,
  };
}

export async function preparePgBossSchema(options: {
  readonly factory: PgBossFactory;
  readonly pool: PostgresPoolBoundary;
  readonly timeoutMs?: number;
}): Promise<void> {
  let client: PgBossClient | undefined;
  try {
    client = options.factory.create(
      createPgBossPreparationOptions(options.pool),
    );
    await client.start();
  } finally {
    if (client !== undefined) {
      await client.stop({
        close: true,
        graceful: false,
        timeout: options.timeoutMs ?? PG_BOSS_PREPARATION_TIMEOUT_MS,
      });
    }
  }
}
