import {readFile} from 'node:fs/promises';
import {join} from 'node:path';

import {Client, type QueryResultRow} from 'pg';

import {
  createNodePostgresPool,
  createPostgresKnowledgeRepositories,
  decodePostgresConnectionUrl,
  type PostgresConnectionConfig,
  type PostgresKnowledgeRepositorySet,
  type PostgresPoolBoundary,
  type PostgresQueryResult,
} from '../../src/platform/database/postgresql/index.js';
import {
  NodeMigrationFileSystem,
  type MigrationDirectoryEntry,
  type MigrationFileSystem,
} from '../../src/platform/database/migrations/migration_files.js';
import type {
  MigrationLogRecord,
  MigrationLogger,
} from '../../src/platform/database/migrations/migration_log.js';
import {PgMigrationConnector} from '../../src/platform/database/migrations/postgres_migration_connection.js';
import {
  executeMigrations,
  type MigrationRunResult,
} from '../../src/platform/database/migrations/migration_runner.js';

import {
  auditClosedPgConfig,
  type AcceptedTm2Environment,
  type Tm2PgConfig,
} from './environment_oracle.js';
import {
  TM2_BUSINESS_TABLES,
  TM2_RUNTIME_POINTER_UPDATES,
} from './semantic_oracle.js';

const MIGRATION_ROOT = join(process.cwd(), 'apps', 'server', 'migrations');
const RUNTIME_INSERT_TABLES = Object.freeze([
  'assessment',
  'assessment_revision',
  'classification_assignment',
  'classification_assignment_revision',
  'curation_command',
  'curation_target',
  'intake_decision',
  'intake_decision_reason',
  'intake_decision_revision',
  'vocabulary_term',
  'vocabulary_term_revision',
  'knowledge_change_event',
  'knowledge_change_operation',
  'knowledge_change_set',
  'knowledge_item',
  'knowledge_relation',
  'knowledge_relation_revision',
  'knowledge_revision',
  'knowledge_revision_fragment_input',
  'knowledge_revision_item_input',
  'knowledge_revision_relation_input',
  'relation_revision_fragment_input',
  'relation_revision_item_input',
  'relation_revision_relation_input',
] as const);

export const TM2_FIXED_ROLE_NAMES = Object.freeze({
  admin: 'struinfo_tm2_admin',
  migrator: 'struinfo_tm2_migrator',
  runtime: 'struinfo_tm2_runtime',
});

export class Tm2SafeFailure extends Error {
  public readonly code: string;

  public constructor(code: string) {
    super(code);
    this.name = 'Tm2SafeFailure';
    this.code = code;
  }
}

interface SessionIdentityRow extends QueryResultRow {
  readonly session_user: string;
  readonly current_user: string;
  readonly role_setting: string;
  readonly database_name: string;
  readonly server_address: string | null;
  readonly server_port: number | null;
  readonly server_version_num: number;
  readonly server_encoding: string;
  readonly client_encoding: string;
  readonly time_zone: string;
  readonly standard_conforming_strings: string;
}

export interface Tm2SessionIdentity {
  readonly sessionUser: string;
  readonly currentUser: string;
  readonly roleSetting: string;
  readonly databaseName: string;
  readonly serverAddress: string | null;
  readonly serverPort: number | null;
  readonly serverVersionNumber: number;
  readonly serverEncoding: string;
  readonly clientEncoding: string;
  readonly timeZone: string;
  readonly standardConformingStrings: string;
}

export interface Tm2MigrationObservation {
  readonly concurrent: readonly Readonly<MigrationRunResult>[];
  readonly secondNoop: Readonly<MigrationRunResult>;
  readonly safeLogRecords: readonly Readonly<MigrationLogRecord>[];
}

export interface Tm2FailingMigrationObservation {
  readonly runnerRejected: boolean;
  readonly tableAbsent: boolean;
  readonly ledgerAbsent: boolean;
  readonly postFailureNoop: boolean;
}

class CapturingMigrationLogger implements MigrationLogger {
  readonly #records: MigrationLogRecord[] = [];

  public write(record: Readonly<MigrationLogRecord>): void {
    this.#records.push({...record});
  }

  public snapshot(): readonly Readonly<MigrationLogRecord>[] {
    return Object.freeze(this.#records.map((record) => Object.freeze(record)));
  }
}

class InjectedFailingMigrationFileSystem implements MigrationFileSystem {
  readonly #delegate = new NodeMigrationFileSystem();
  readonly #entry: MigrationDirectoryEntry = Object.freeze({
    name: '000005_synthetic_tm2_failure.sql',
    kind: 'file',
  });

  public async readDirectory(
    root: string,
  ): Promise<readonly MigrationDirectoryEntry[]> {
    return Object.freeze([
      ...(await this.#delegate.readDirectory(root)),
      this.#entry,
    ]);
  }

  public async readFile(root: string, name: string): Promise<Uint8Array> {
    if (name !== this.#entry.name) {
      return await this.#delegate.readFile(root, name);
    }
    return new TextEncoder().encode(
      `CREATE TABLE struinfo.synthetic_tm2_rollback_probe (
  workspace_id uuid NOT NULL PRIMARY KEY
);
SELECT struinfo.synthetic_tm2_missing_function();
`,
    );
  }
}

function copyConfig(config: Readonly<Tm2PgConfig>): PostgresConnectionConfig {
  const copy = Object.create(null) as PostgresConnectionConfig;
  for (const key of [
    'host',
    'port',
    'database',
    'user',
    'password',
    'ssl',
    'application_name',
    'options',
  ] as const) {
    Object.defineProperty(copy, key, {
      value: config[key],
      enumerable: true,
      configurable: false,
      writable: false,
    });
  }
  return Object.freeze(copy);
}

function quoteIdentifier(identifier: string): string {
  return `"${identifier.replaceAll('"', '""')}"`;
}

function configEntries(config: Readonly<PostgresConnectionConfig>) {
  return Reflect.ownKeys(config)
    .filter((key): key is string => typeof key === 'string')
    .sort()
    .map(
      (key) => [key, config[key as keyof PostgresConnectionConfig]] as const,
    );
}

export function configsAreByteForByteEquivalent(
  expected: Readonly<Tm2PgConfig>,
  actual: Readonly<PostgresConnectionConfig>,
): boolean {
  return (
    Object.getPrototypeOf(actual) === null &&
    auditClosedPgConfig(actual).length === 0 &&
    JSON.stringify(configEntries(expected)) ===
      JSON.stringify(configEntries(actual))
  );
}

function productConfigFromEnvironment(
  variable:
    | 'STRUIINFO_TM2_MIGRATION_DATABASE_URL'
    | 'STRUIINFO_TM2_RUNTIME_DATABASE_URL',
): Readonly<PostgresConnectionConfig> {
  const purpose =
    variable === 'STRUIINFO_TM2_MIGRATION_DATABASE_URL'
      ? 'migrator'
      : 'runtime';
  return decodePostgresConnectionUrl(process.env[variable], purpose);
}

async function closeClient(client: Client): Promise<void> {
  try {
    await client.end();
  } catch {
    throw new Tm2SafeFailure('client_close_failed');
  }
}

async function connectClient(
  config: Readonly<PostgresConnectionConfig>,
): Promise<Client> {
  const client = new Client(config);
  try {
    await client.connect();
    return client;
  } catch {
    try {
      await client.end();
    } catch {
      // The stable acquisition failure remains the only exposed observation.
    }
    throw new Tm2SafeFailure('client_connect_failed');
  }
}

function projectSession(row: SessionIdentityRow): Tm2SessionIdentity {
  return Object.freeze({
    sessionUser: row.session_user,
    currentUser: row.current_user,
    roleSetting: row.role_setting,
    databaseName: row.database_name,
    serverAddress: row.server_address,
    serverPort: row.server_port,
    serverVersionNumber: row.server_version_num,
    serverEncoding: row.server_encoding,
    clientEncoding: row.client_encoding,
    timeZone: row.time_zone,
    standardConformingStrings: row.standard_conforming_strings,
  });
}

const SESSION_IDENTITY_SQL = `SELECT
  session_user::text AS session_user,
  current_user::text AS current_user,
  current_setting('role')::text AS role_setting,
  current_database()::text AS database_name,
  inet_server_addr()::text AS server_address,
  inet_server_port()::integer AS server_port,
  current_setting('server_version_num')::integer AS server_version_num,
  current_setting('server_encoding')::text AS server_encoding,
  current_setting('client_encoding')::text AS client_encoding,
  current_setting('TimeZone')::text AS time_zone,
  current_setting('standard_conforming_strings')::text AS standard_conforming_strings`;

export class BoundPostgresTm2Runtime {
  readonly #admission: AcceptedTm2Environment;
  readonly #migrationConfig: Readonly<PostgresConnectionConfig>;
  readonly #runtimeConfig: Readonly<PostgresConnectionConfig>;
  readonly #adminConfig: Readonly<PostgresConnectionConfig>;
  readonly #runtimePool: PostgresPoolBoundary;
  readonly #repositories: Readonly<PostgresKnowledgeRepositorySet>;
  #adminClient: Client | undefined;
  #prepared: Promise<void> | undefined;
  #migrationObservation: Tm2MigrationObservation | undefined;
  #schemasAbsentBeforeMigration = false;
  #failingMigrationObservation:
    Promise<Tm2FailingMigrationObservation> | undefined;
  #closed = false;

  public constructor(admission: AcceptedTm2Environment) {
    this.#admission = admission;
    this.#migrationConfig = productConfigFromEnvironment(
      'STRUIINFO_TM2_MIGRATION_DATABASE_URL',
    );
    this.#runtimeConfig = productConfigFromEnvironment(
      'STRUIINFO_TM2_RUNTIME_DATABASE_URL',
    );
    this.#adminConfig = copyConfig(admission.admin.config);
    if (
      !configsAreByteForByteEquivalent(
        admission.migration.config,
        this.#migrationConfig,
      ) ||
      !configsAreByteForByteEquivalent(
        admission.runtime.config,
        this.#runtimeConfig,
      )
    ) {
      throw new Tm2SafeFailure('product_config_projection_mismatch');
    }
    this.#runtimePool = createNodePostgresPool(this.#runtimeConfig);
    this.#repositories = createPostgresKnowledgeRepositories(this.#runtimePool);
  }

  public get admission(): AcceptedTm2Environment {
    return this.#admission;
  }

  public get migrationConfig(): Readonly<PostgresConnectionConfig> {
    return this.#migrationConfig;
  }

  public get runtimeConfig(): Readonly<PostgresConnectionConfig> {
    return this.#runtimeConfig;
  }

  public get repositories(): Readonly<PostgresKnowledgeRepositorySet> {
    return this.#repositories;
  }

  public get runtimePool(): PostgresPoolBoundary {
    return this.#runtimePool;
  }

  public get migrationObservation(): Tm2MigrationObservation {
    if (this.#migrationObservation === undefined) {
      throw new Tm2SafeFailure('migration_observation_unavailable');
    }
    return this.#migrationObservation;
  }

  public get schemasAbsentBeforeMigration(): boolean {
    return this.#schemasAbsentBeforeMigration;
  }

  public async prepare(): Promise<void> {
    if (this.#closed) {
      throw new Tm2SafeFailure('runtime_already_closed');
    }
    this.#prepared ??= this.#prepareOnce();
    await this.#prepared;
  }

  public async queryAdmin<Row extends QueryResultRow>(
    sql: string,
    parameters: readonly unknown[] = [],
  ): Promise<readonly Row[]> {
    await this.prepare();
    const client = this.#adminClient;
    if (client === undefined) {
      throw new Tm2SafeFailure('admin_client_unavailable');
    }
    try {
      return (await client.query<Row>(sql, [...parameters])).rows;
    } catch {
      throw new Tm2SafeFailure('admin_query_failed');
    }
  }

  public async queryRuntime<Row extends Readonly<Record<string, unknown>>>(
    sql: string,
    parameters: readonly unknown[] = [],
  ): Promise<PostgresQueryResult<Row>> {
    await this.prepare();
    try {
      return await this.#runtimePool.query<Row>(sql, parameters);
    } catch {
      throw new Tm2SafeFailure('runtime_query_failed');
    }
  }

  public async observeFailingMigrationRollback(): Promise<Tm2FailingMigrationObservation> {
    await this.prepare();
    this.#failingMigrationObservation ??=
      this.#observeFailingMigrationRollbackOnce();
    return await this.#failingMigrationObservation;
  }

  public async withRuntimeRollback<Value>(
    work: (
      client: Awaited<ReturnType<PostgresPoolBoundary['connect']>>,
    ) => Promise<Value>,
  ): Promise<Value> {
    await this.prepare();
    const client = await this.#runtimePool.connect();
    let value: Value | undefined;
    let failed = false;
    try {
      await client.query('BEGIN');
      value = await work(client);
      await client.query('ROLLBACK');
    } catch {
      failed = true;
      try {
        await client.query('ROLLBACK');
      } catch {
        // The stable transaction failure below is sufficient.
      }
    }
    try {
      client.release();
    } catch {
      throw new Tm2SafeFailure('runtime_client_release_failed');
    }
    if (failed || value === undefined) {
      throw new Tm2SafeFailure('runtime_rollback_probe_failed');
    }
    return value;
  }

  public async expectRuntimeStatementRejected(
    sql: string,
    parameters: readonly unknown[] = [],
  ): Promise<boolean> {
    await this.prepare();
    const client = await this.#runtimePool.connect();
    let rejected = false;
    let releaseFailed = false;
    try {
      await client.query('BEGIN');
      try {
        await client.query(sql, parameters);
      } catch {
        rejected = true;
      }
      try {
        await client.query('ROLLBACK');
      } catch {
        throw new Tm2SafeFailure('runtime_rejection_rollback_failed');
      }
    } catch {
      throw new Tm2SafeFailure('runtime_rejection_probe_failed');
    }
    try {
      client.release();
    } catch {
      releaseFailed = true;
    }
    if (releaseFailed) {
      throw new Tm2SafeFailure('runtime_client_release_failed');
    }
    return rejected;
  }

  public async sessionIdentity(
    role: 'admin' | 'migration' | 'runtime',
  ): Promise<Tm2SessionIdentity> {
    await this.prepare();
    if (role === 'admin') {
      const client = this.#adminClient;
      if (client === undefined) {
        throw new Tm2SafeFailure('admin_client_unavailable');
      }
      const result =
        await client.query<SessionIdentityRow>(SESSION_IDENTITY_SQL);
      const row = result.rows[0];
      if (row === undefined) {
        throw new Tm2SafeFailure('session_identity_missing');
      }
      return projectSession(row);
    }
    const config =
      role === 'migration' ? this.#migrationConfig : this.#runtimeConfig;
    const client = await connectClient(config);
    try {
      const result =
        await client.query<SessionIdentityRow>(SESSION_IDENTITY_SQL);
      const row = result.rows[0];
      if (row === undefined) {
        throw new Tm2SafeFailure('session_identity_missing');
      }
      return projectSession(row);
    } finally {
      await closeClient(client);
    }
  }

  public async close(): Promise<void> {
    if (this.#closed) {
      return;
    }
    this.#closed = true;
    let failed = false;
    try {
      await this.#runtimePool.end();
    } catch {
      failed = true;
    }
    if (this.#adminClient !== undefined) {
      try {
        await this.#adminClient.end();
      } catch {
        failed = true;
      }
    }
    if (failed) {
      throw new Tm2SafeFailure('runtime_shutdown_failed');
    }
  }

  async #prepareOnce(): Promise<void> {
    this.#adminClient = await connectClient(this.#adminConfig);
    await this.#observePreMigrationClosure();
    await this.#prepareDatabasePrivileges();
    await this.#runMigrations();
    await this.#applyRuntimeGrants();
  }

  async #observePreMigrationClosure(): Promise<void> {
    const client = this.#adminClient;
    if (client === undefined) {
      throw new Tm2SafeFailure('admin_client_unavailable');
    }
    try {
      const result = await client.query<{readonly count: string}>(
        `SELECT count(*)::text AS count
           FROM pg_catalog.pg_namespace
          WHERE nspname IN ('struinfo', 'struinfo_meta')`,
      );
      this.#schemasAbsentBeforeMigration = result.rows[0]?.count === '0';
      if (!this.#schemasAbsentBeforeMigration) {
        throw new Tm2SafeFailure('database_not_disposable_fresh');
      }
    } catch (error) {
      if (error instanceof Tm2SafeFailure) {
        throw error;
      }
      throw new Tm2SafeFailure('pre_migration_catalog_probe_failed');
    }
  }

  async #prepareDatabasePrivileges(): Promise<void> {
    const client = this.#adminClient;
    if (client === undefined) {
      throw new Tm2SafeFailure('admin_client_unavailable');
    }
    const database = quoteIdentifier(this.#adminConfig.database);
    const statements = [
      `REVOKE CONNECT, CREATE, TEMPORARY ON DATABASE ${database} FROM PUBLIC`,
      `GRANT CONNECT ON DATABASE ${database} TO ${TM2_FIXED_ROLE_NAMES.admin}, ${TM2_FIXED_ROLE_NAMES.migrator}, ${TM2_FIXED_ROLE_NAMES.runtime}`,
      `GRANT CREATE ON DATABASE ${database} TO ${TM2_FIXED_ROLE_NAMES.migrator}`,
      `REVOKE CREATE, TEMPORARY ON DATABASE ${database} FROM ${TM2_FIXED_ROLE_NAMES.runtime}`,
      'REVOKE CREATE ON SCHEMA public FROM PUBLIC',
      `REVOKE CREATE ON SCHEMA public FROM ${TM2_FIXED_ROLE_NAMES.migrator}, ${TM2_FIXED_ROLE_NAMES.runtime}`,
    ];
    try {
      for (const statement of statements) {
        await client.query(statement);
      }
    } catch {
      throw new Tm2SafeFailure('database_privilege_setup_failed');
    }
  }

  async #runMigrations(): Promise<void> {
    const logger = new CapturingMigrationLogger();
    const options = {
      config: {connection: this.#migrationConfig},
      migrationRoots: [MIGRATION_ROOT],
      fileSystem: new NodeMigrationFileSystem(),
      connector: new PgMigrationConnector(),
      logger,
    } as const;
    try {
      const concurrent = await Promise.all([
        executeMigrations(options),
        executeMigrations(options),
      ]);
      const secondNoop = await executeMigrations(options);
      this.#migrationObservation = Object.freeze({
        concurrent: Object.freeze(concurrent),
        secondNoop,
        safeLogRecords: logger.snapshot(),
      });
    } catch {
      throw new Tm2SafeFailure('migration_execution_failed');
    }
  }

  async #applyRuntimeGrants(): Promise<void> {
    const client = this.#adminClient;
    if (client === undefined) {
      throw new Tm2SafeFailure('admin_client_unavailable');
    }
    try {
      await client.query('REVOKE ALL ON SCHEMA struinfo_meta FROM PUBLIC');
      await client.query(
        `REVOKE ALL ON SCHEMA struinfo_meta FROM ${TM2_FIXED_ROLE_NAMES.runtime}`,
      );
      await client.query('REVOKE ALL ON SCHEMA struinfo FROM PUBLIC');
      await client.query(
        `GRANT USAGE ON SCHEMA struinfo TO ${TM2_FIXED_ROLE_NAMES.runtime}`,
      );
      await client.query(
        `GRANT SELECT ON ALL TABLES IN SCHEMA struinfo TO ${TM2_FIXED_ROLE_NAMES.runtime}`,
      );

      const columns = await client.query<{
        table_name: string;
        column_name: string;
      }>(
        `SELECT table_name, column_name
           FROM information_schema.columns
          WHERE table_schema = 'struinfo'
          ORDER BY table_name, ordinal_position`,
      );
      const byTable = new Map<string, string[]>();
      for (const row of columns.rows) {
        const list = byTable.get(row.table_name) ?? [];
        list.push(row.column_name);
        byTable.set(row.table_name, list);
      }
      for (const table of RUNTIME_INSERT_TABLES) {
        const insertColumns = (byTable.get(table) ?? []).filter(
          (column) => column !== 'created_at',
        );
        if (insertColumns.length === 0) {
          throw new Tm2SafeFailure('runtime_insert_column_map_missing');
        }
        await client.query(
          `GRANT INSERT (${insertColumns.map(quoteIdentifier).join(', ')}) ON struinfo.${quoteIdentifier(table)} TO ${TM2_FIXED_ROLE_NAMES.runtime}`,
        );
      }
      for (const pointer of TM2_RUNTIME_POINTER_UPDATES) {
        await client.query(
          `GRANT UPDATE (${pointer.columns.map(quoteIdentifier).join(', ')}) ON struinfo.${quoteIdentifier(pointer.table)} TO ${TM2_FIXED_ROLE_NAMES.runtime}`,
        );
      }

      const tableSet = new Set(byTable.keys());
      if (
        TM2_BUSINESS_TABLES.some((table) => !tableSet.has(table)) ||
        tableSet.size !== TM2_BUSINESS_TABLES.length
      ) {
        throw new Tm2SafeFailure('runtime_grant_table_set_mismatch');
      }
    } catch (error) {
      if (error instanceof Tm2SafeFailure) {
        throw error;
      }
      throw new Tm2SafeFailure('runtime_grant_setup_failed');
    }
  }

  async #observeFailingMigrationRollbackOnce(): Promise<Tm2FailingMigrationObservation> {
    let runnerRejected = false;
    try {
      await executeMigrations({
        config: {connection: this.#migrationConfig},
        migrationRoots: [MIGRATION_ROOT],
        fileSystem: new InjectedFailingMigrationFileSystem(),
        connector: new PgMigrationConnector(),
        logger: new CapturingMigrationLogger(),
      });
    } catch {
      runnerRejected = true;
    }
    const client = this.#adminClient;
    if (client === undefined) {
      throw new Tm2SafeFailure('admin_client_unavailable');
    }
    try {
      const table = await client.query<{exists: boolean}>(
        `SELECT to_regclass('struinfo.synthetic_tm2_rollback_probe') IS NOT NULL AS exists`,
      );
      const ledger = await client.query<{count: string}>(
        `SELECT count(*)::text AS count
           FROM struinfo_meta.schema_migrations
          WHERE version = '000005'`,
      );
      const postFailure = await executeMigrations({
        config: {connection: this.#migrationConfig},
        migrationRoots: [MIGRATION_ROOT],
        fileSystem: new NodeMigrationFileSystem(),
        connector: new PgMigrationConnector(),
        logger: new CapturingMigrationLogger(),
      });
      return Object.freeze({
        runnerRejected,
        tableAbsent: table.rows[0]?.exists === false,
        ledgerAbsent: ledger.rows[0]?.count === '0',
        postFailureNoop: postFailure.outcome === 'noop',
      });
    } catch {
      throw new Tm2SafeFailure('failing_migration_observation_failed');
    }
  }
}

export async function loadMigrationBytes(
  filename: string,
): Promise<Uint8Array> {
  return Uint8Array.from(await readFile(join(MIGRATION_ROOT, filename)));
}
