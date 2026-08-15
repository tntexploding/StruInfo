import type {
  PostgresClientBoundary,
  PostgresPoolBoundary,
} from './postgres_pool.js';

export type PostgresTransactionMode = 'read_committed' | 'repeatable_read_only';

export const BEGIN_READ_COMMITTED_SQL =
  'BEGIN ISOLATION LEVEL READ COMMITTED' as const;
export const BEGIN_REPEATABLE_READ_ONLY_SQL =
  'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY' as const;
export const COMMIT_TRANSACTION_SQL = 'COMMIT' as const;
export const ROLLBACK_TRANSACTION_SQL = 'ROLLBACK' as const;

export class PostgresTransactionError extends Error {
  public constructor() {
    super('PostgreSQL transaction failed.');
    this.name = 'PostgresTransactionError';
  }
}

export async function runPostgresTransaction<Value>(
  pool: PostgresPoolBoundary,
  mode: PostgresTransactionMode,
  work: (client: PostgresClientBoundary) => Promise<Value>,
): Promise<Value> {
  let client: PostgresClientBoundary;
  try {
    client = await pool.connect();
  } catch {
    throw new PostgresTransactionError();
  }

  let transactionActive = false;
  let completed = false;
  let value: Value | undefined;
  let failed = false;
  try {
    await client.query(
      mode === 'read_committed'
        ? BEGIN_READ_COMMITTED_SQL
        : BEGIN_REPEATABLE_READ_ONLY_SQL,
    );
    transactionActive = true;
    value = await work(client);
    await client.query(COMMIT_TRANSACTION_SQL);
    transactionActive = false;
    completed = true;
  } catch {
    failed = true;
    if (transactionActive) {
      try {
        await client.query(ROLLBACK_TRANSACTION_SQL);
      } catch {
        // The single safe failure below covers both the original and rollback.
      }
    }
  }

  try {
    client.release();
  } catch {
    failed = true;
  }

  if (failed || !completed) {
    throw new PostgresTransactionError();
  }
  return value as Value;
}
