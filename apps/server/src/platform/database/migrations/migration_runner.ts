import type {MigrationConfig} from './migration_config.js';
import {
  discoverMigrations,
  MIGRATION_NAME_PATTERN,
  type DiscoveredMigration,
  type MigrationFileSystem,
} from './migration_files.js';
import {
  MigrationFailure,
  toMigrationFailure,
  type MigrationLogRecord,
  type MigrationLogger,
} from './migration_log.js';
import type {
  MigrationConnection,
  MigrationConnector,
  MigrationRow,
} from './postgres_migration_connection.js';

export const MIGRATION_ADVISORY_LOCK_IDENTITY = Object.freeze({
  classId: 1_398_035_029,
  objectId: 1_296_648_018,
});

export const ACQUIRE_MIGRATION_LOCK_SQL =
  'SELECT pg_advisory_lock($1::integer, $2::integer)';
export const RELEASE_MIGRATION_LOCK_SQL =
  'SELECT pg_advisory_unlock($1::integer, $2::integer) AS unlocked';
export const CREATE_METADATA_SCHEMA_SQL =
  'CREATE SCHEMA IF NOT EXISTS struinfo_meta';
export const CREATE_MIGRATION_LEDGER_SQL = `CREATE TABLE IF NOT EXISTS struinfo_meta.schema_migrations (
  version character(6) PRIMARY KEY,
  name text NOT NULL,
  checksum character(64) NOT NULL,
  applied_at timestamp with time zone NOT NULL DEFAULT CURRENT_TIMESTAMP
)`;
export const READ_MIGRATION_LEDGER_SQL =
  'SELECT version, name, checksum FROM struinfo_meta.schema_migrations ORDER BY version ASC';
export const INSERT_MIGRATION_LEDGER_SQL =
  'INSERT INTO struinfo_meta.schema_migrations (version, name, checksum) VALUES ($1, $2, $3)';

const BEGIN_SQL = 'BEGIN';
const COMMIT_SQL = 'COMMIT';
const ROLLBACK_SQL = 'ROLLBACK';
const VERSION_PATTERN = /^\d{6}$/u;
const CHECKSUM_PATTERN = /^[a-f0-9]{64}$/u;

interface AppliedMigration {
  readonly version: string;
  readonly name: string;
  readonly checksum: string;
}

export interface MigrationRunResult {
  readonly outcome: 'applied' | 'noop';
  readonly appliedVersions: readonly string[];
}

export async function executeMigrations(options: {
  readonly config: Readonly<MigrationConfig>;
  readonly migrationRoots: readonly string[];
  readonly fileSystem: MigrationFileSystem;
  readonly connector: MigrationConnector;
  readonly logger: MigrationLogger;
}): Promise<Readonly<MigrationRunResult>> {
  const migrations = await discoverMigrations(
    options.migrationRoots,
    options.fileSystem,
  );

  let connection: MigrationConnection;
  try {
    connection = await options.connector.connect(options.config.connection);
  } catch (error) {
    throw toMigrationFailure(error, {
      event: 'migration_connection_failed',
      outcome: 'failed',
    });
  }

  let result: Readonly<MigrationRunResult> | undefined;
  let failure: MigrationFailure | undefined;
  try {
    result = await executeOnOwnedConnection(
      connection,
      migrations,
      options.logger,
    );
  } catch (error) {
    failure = toMigrationFailure(error, {
      event: 'migration_execution_failed',
      outcome: 'failed',
    });
  }

  try {
    await connection.close();
  } catch {
    failure = new MigrationFailure({
      event: 'migration_connection_close_failed',
      outcome: 'failed',
    });
  }

  if (failure !== undefined) {
    throw failure;
  }
  if (result === undefined) {
    throw new MigrationFailure({
      event: 'migration_execution_failed',
      outcome: 'failed',
    });
  }
  return result;
}

async function executeOnOwnedConnection(
  connection: MigrationConnection,
  migrations: readonly DiscoveredMigration[],
  logger: MigrationLogger,
): Promise<Readonly<MigrationRunResult>> {
  await acquireLock(connection);
  let result: Readonly<MigrationRunResult> | undefined;
  let failure: MigrationFailure | undefined;
  try {
    await bootstrapLedger(connection);
    const applied = await readAppliedMigrations(connection);
    const pending = reconcileMigrations(migrations, applied);
    const appliedVersions: string[] = [];
    for (const migration of pending) {
      await applyMigration(connection, migration);
      try {
        logger.write({
          event: 'migration_applied',
          version: migration.version,
          name: migration.name,
          checksum: migration.checksum,
          outcome: 'applied',
        });
      } catch {
        throw new MigrationFailure({
          event: 'migration_logging_failed',
          version: migration.version,
          name: migration.name,
          checksum: migration.checksum,
          outcome: 'failed',
        });
      }
      appliedVersions.push(migration.version);
    }
    result = Object.freeze({
      outcome: appliedVersions.length === 0 ? 'noop' : 'applied',
      appliedVersions: Object.freeze(appliedVersions),
    });
  } catch (error) {
    failure = toMigrationFailure(error, {
      event: 'migration_execution_failed',
      outcome: 'failed',
    });
  }

  try {
    await releaseLock(connection);
  } catch (error) {
    failure = toMigrationFailure(error, {
      event: 'migration_unlock_failed',
      outcome: 'failed',
    });
  }

  if (failure !== undefined) {
    throw failure;
  }
  if (result === undefined) {
    throw new MigrationFailure({
      event: 'migration_execution_failed',
      outcome: 'failed',
    });
  }
  return result;
}

async function acquireLock(connection: MigrationConnection): Promise<void> {
  try {
    await connection.query(ACQUIRE_MIGRATION_LOCK_SQL, [
      MIGRATION_ADVISORY_LOCK_IDENTITY.classId,
      MIGRATION_ADVISORY_LOCK_IDENTITY.objectId,
    ]);
  } catch {
    throw new MigrationFailure({
      event: 'migration_lock_failed',
      outcome: 'failed',
    });
  }
}

async function releaseLock(connection: MigrationConnection): Promise<void> {
  let rows: readonly MigrationRow[];
  try {
    rows = await connection.query(RELEASE_MIGRATION_LOCK_SQL, [
      MIGRATION_ADVISORY_LOCK_IDENTITY.classId,
      MIGRATION_ADVISORY_LOCK_IDENTITY.objectId,
    ]);
  } catch {
    throw new MigrationFailure({
      event: 'migration_unlock_failed',
      outcome: 'failed',
    });
  }

  if (rows.at(0)?.unlocked !== true) {
    throw new MigrationFailure({
      event: 'migration_unlock_failed',
      outcome: 'failed',
    });
  }
}

async function bootstrapLedger(connection: MigrationConnection): Promise<void> {
  await executeTransaction(
    connection,
    async () => {
      await connection.query(CREATE_METADATA_SCHEMA_SQL);
      await connection.query(CREATE_MIGRATION_LEDGER_SQL);
    },
    {event: 'migration_bootstrap_failed', outcome: 'failed'},
    {event: 'migration_bootstrap_rollback_failed', outcome: 'failed'},
  );
}

async function readAppliedMigrations(
  connection: MigrationConnection,
): Promise<readonly AppliedMigration[]> {
  let rows: readonly MigrationRow[];
  try {
    rows = await connection.query(READ_MIGRATION_LEDGER_SQL);
  } catch {
    throw new MigrationFailure({
      event: 'migration_ledger_read_failed',
      outcome: 'failed',
    });
  }

  const versions = new Set<string>();
  return rows.map((row) => {
    const version = row.version;
    const name = row.name;
    const checksum = row.checksum;
    if (
      typeof version !== 'string' ||
      !VERSION_PATTERN.test(version) ||
      typeof name !== 'string' ||
      !MIGRATION_NAME_PATTERN.test(name) ||
      typeof checksum !== 'string' ||
      !CHECKSUM_PATTERN.test(checksum) ||
      versions.has(version)
    ) {
      throw new MigrationFailure({
        event: 'migration_ledger_invalid',
        outcome: 'failed',
      });
    }
    versions.add(version);
    return Object.freeze({version, name, checksum});
  });
}

function reconcileMigrations(
  migrations: readonly DiscoveredMigration[],
  appliedMigrations: readonly AppliedMigration[],
): readonly DiscoveredMigration[] {
  const migrationsByVersion = new Map(
    migrations.map((migration) => [migration.version, migration]),
  );
  const appliedVersions = new Set<string>();
  for (const applied of appliedMigrations) {
    const migration = migrationsByVersion.get(applied.version);
    if (migration === undefined) {
      throw new MigrationFailure({
        event: 'migration_applied_file_missing',
        version: applied.version,
        name: applied.name,
        checksum: applied.checksum,
        outcome: 'failed',
      });
    }
    if (
      migration.name !== applied.name ||
      migration.checksum !== applied.checksum
    ) {
      throw new MigrationFailure({
        event: 'migration_history_changed',
        version: migration.version,
        name: migration.name,
        checksum: migration.checksum,
        outcome: 'failed',
      });
    }
    appliedVersions.add(applied.version);
  }

  const pending = migrations.filter(
    (migration) => !appliedVersions.has(migration.version),
  );
  const greatestApplied = appliedMigrations
    .map((migration) => migration.version)
    .sort()
    .at(-1);
  const nonLinear = pending.find(
    (migration) =>
      greatestApplied !== undefined && migration.version < greatestApplied,
  );
  if (nonLinear !== undefined) {
    throw new MigrationFailure({
      event: 'migration_history_non_linear',
      version: nonLinear.version,
      name: nonLinear.name,
      checksum: nonLinear.checksum,
      outcome: 'failed',
    });
  }
  return pending;
}

async function applyMigration(
  connection: MigrationConnection,
  migration: DiscoveredMigration,
): Promise<void> {
  const failure: MigrationLogRecord = {
    event: 'migration_transaction_failed',
    version: migration.version,
    name: migration.name,
    checksum: migration.checksum,
    outcome: 'failed',
  };
  const rollbackFailure: MigrationLogRecord = {
    event: 'migration_rollback_failed',
    version: migration.version,
    name: migration.name,
    checksum: migration.checksum,
    outcome: 'failed',
  };
  await executeTransaction(
    connection,
    async () => {
      await connection.query(migration.sql);
      await connection.query(INSERT_MIGRATION_LEDGER_SQL, [
        migration.version,
        migration.name,
        migration.checksum,
      ]);
    },
    failure,
    rollbackFailure,
  );
}

async function executeTransaction(
  connection: MigrationConnection,
  body: () => Promise<void>,
  failureRecord: Readonly<MigrationLogRecord>,
  rollbackFailureRecord: Readonly<MigrationLogRecord>,
): Promise<void> {
  let transactionActive = false;
  try {
    await connection.query(BEGIN_SQL);
    transactionActive = true;
    await body();
    await connection.query(COMMIT_SQL);
    transactionActive = false;
  } catch {
    if (transactionActive) {
      try {
        await connection.query(ROLLBACK_SQL);
      } catch {
        throw new MigrationFailure(rollbackFailureRecord);
      }
    }
    throw new MigrationFailure(failureRecord);
  }
}
