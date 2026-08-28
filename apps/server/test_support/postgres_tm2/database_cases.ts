import {readFile} from 'node:fs/promises';
import {join} from 'node:path';

import type {QueryResultRow} from 'pg';

import {deriveWorkspaceLockKnownAnswer} from './environment_oracle.js';
import type {Tm2MandatoryCase} from './mandatory_ledger.js';
import type {Tm2CaseEvidence} from './public_facade.js';
import {TM2_FIXED_ROLE_NAMES, Tm2SafeFailure} from './bound_runtime.js';
import type {BoundPostgresTm2Runtime} from './bound_runtime.js';
import {
  auditCatalogSummary,
  TM2_BUSINESS_TABLES,
  TM2_CATALOG_CARDINALITIES,
  TM2_MIGRATION_IDENTITIES,
  TM2_RUNTIME_POINTER_UPDATES,
} from './semantic_oracle.js';
import {executeAdvancedTransactionCase} from './transaction_cases.js';

interface CountRow extends QueryResultRow {
  readonly count: string;
}

function evidence(
  row: Tm2MandatoryCase,
  assertionCount: number,
  suffix: string,
): Tm2CaseEvidence {
  return Object.freeze({
    caseId: row.id,
    vectorId: row.vectorId,
    assertionCount,
    safeEvidenceCodes: Object.freeze([`${row.id}:${suffix}`]),
  });
}

function assertCondition(condition: boolean, code: string): void {
  if (!condition) {
    throw new Tm2SafeFailure(code);
  }
}

async function scalarCount(
  runtime: BoundPostgresTm2Runtime,
  sql: string,
  parameters: readonly unknown[] = [],
): Promise<number> {
  const rows = await runtime.queryAdmin<CountRow>(sql, parameters);
  const value = Number(rows[0]?.count);
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Tm2SafeFailure('catalog_count_invalid');
  }
  return value;
}

async function executeRoleClosureCase(
  row: Tm2MandatoryCase,
  runtime: BoundPostgresTm2Runtime,
): Promise<Tm2CaseEvidence> {
  await runtime.prepare();
  const roleRows = await runtime.queryAdmin<
    QueryResultRow & {
      readonly rolname: string;
      readonly rolcanlogin: boolean;
      readonly rolsuper: boolean;
      readonly rolcreatedb: boolean;
      readonly rolcreaterole: boolean;
      readonly rolreplication: boolean;
      readonly rolbypassrls: boolean;
    }
  >(
    `SELECT rolname, rolcanlogin, rolsuper, rolcreatedb, rolcreaterole,
            rolreplication, rolbypassrls
       FROM pg_catalog.pg_roles
      WHERE rolname = ANY($1::text[])
      ORDER BY rolname`,
    [
      [
        TM2_FIXED_ROLE_NAMES.admin,
        TM2_FIXED_ROLE_NAMES.migrator,
        TM2_FIXED_ROLE_NAMES.runtime,
      ],
    ],
  );
  const byName = new Map(roleRows.map((role) => [role.rolname, role]));
  const admin = byName.get(TM2_FIXED_ROLE_NAMES.admin);
  const migrator = byName.get(TM2_FIXED_ROLE_NAMES.migrator);
  const runtimeRole = byName.get(TM2_FIXED_ROLE_NAMES.runtime);
  const membershipCounts = new Map<string, number>();
  const databaseOwnerCounts = new Map<string, number>();
  for (const role of [
    TM2_FIXED_ROLE_NAMES.migrator,
    TM2_FIXED_ROLE_NAMES.runtime,
  ]) {
    membershipCounts.set(
      role,
      await scalarCount(
        runtime,
        `SELECT count(*)::text AS count
           FROM pg_catalog.pg_auth_members m
           JOIN pg_catalog.pg_roles r ON r.oid = m.member
          WHERE r.rolname = $1`,
        [role],
      ),
    );
    databaseOwnerCounts.set(
      role,
      await scalarCount(
        runtime,
        `SELECT count(*)::text AS count
           FROM pg_catalog.pg_database d
           JOIN pg_catalog.pg_roles r ON r.oid = d.datdba
          WHERE d.datname = current_database() AND r.rolname = $1`,
        [role],
      ),
    );
  }
  const runtimeSchemaOwnerCount = await scalarCount(
    runtime,
    `SELECT count(*)::text AS count
       FROM pg_catalog.pg_namespace n
       JOIN pg_catalog.pg_roles r ON r.oid = n.nspowner
      WHERE r.rolname = $1
        AND n.nspname !~ '^pg_temp_'`,
    [TM2_FIXED_ROLE_NAMES.runtime],
  );
  const runtimeObjectOwnerCount = await scalarCount(
    runtime,
    `SELECT count(*)::text AS count
       FROM pg_catalog.pg_class c
       JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
       JOIN pg_catalog.pg_roles r ON r.oid = c.relowner
      WHERE n.nspname IN ('struinfo', 'struinfo_meta')
        AND r.rolname = $1`,
    [TM2_FIXED_ROLE_NAMES.runtime],
  );
  const checks = new Map<number, boolean>([
    [
      131,
      byName.size === 3 &&
        [...byName.keys()].sort().join(',') ===
          [
            TM2_FIXED_ROLE_NAMES.admin,
            TM2_FIXED_ROLE_NAMES.migrator,
            TM2_FIXED_ROLE_NAMES.runtime,
          ]
            .sort()
            .join(','),
    ],
    [132, admin?.rolcanlogin === true],
    [133, admin?.rolsuper === true],
    [134, migrator?.rolcanlogin === true],
    [135, runtimeRole?.rolcanlogin === true],
    [136, membershipCounts.get(TM2_FIXED_ROLE_NAMES.migrator) === 0],
    [137, membershipCounts.get(TM2_FIXED_ROLE_NAMES.runtime) === 0],
    [138, migrator?.rolsuper === false],
    [139, runtimeRole?.rolsuper === false],
    [140, migrator?.rolcreatedb === false && !migrator.rolcreaterole],
    [141, runtimeRole?.rolcreatedb === false && !runtimeRole.rolcreaterole],
    [142, migrator?.rolreplication === false && !migrator.rolbypassrls],
    [143, runtimeRole?.rolreplication === false && !runtimeRole.rolbypassrls],
    [144, databaseOwnerCounts.get(TM2_FIXED_ROLE_NAMES.migrator) === 0],
    [145, databaseOwnerCounts.get(TM2_FIXED_ROLE_NAMES.runtime) === 0],
    [146, runtimeSchemaOwnerCount === 0],
    [147, runtimeObjectOwnerCount === 0],
    [148, await schemaOwnedByMigrator(runtime, 'struinfo')],
    [149, await schemaOwnedByMigrator(runtime, 'struinfo_meta')],
    [
      150,
      await runtime.expectRuntimeStatementRejected(
        `SET ROLE ${TM2_FIXED_ROLE_NAMES.migrator}`,
      ),
    ],
  ]);
  assertCondition(
    checks.get(row.number) === true,
    `${row.id}:role_closure_failed`,
  );
  return evidence(row, 3, 'role_closure_observed');
}

async function executeMigrationCaseInternal(
  row: Tm2MandatoryCase,
  runtime: BoundPostgresTm2Runtime,
): Promise<Tm2CaseEvidence> {
  await runtime.prepare();
  const observation = runtime.migrationObservation;
  const concurrentOutcomes = observation.concurrent
    .map((result) => result.outcome)
    .sort();
  const ledger = await runtime.queryAdmin<
    QueryResultRow & {
      readonly version: string;
      readonly name: string;
      readonly checksum: string;
      readonly applied_at: Date;
    }
  >(
    `SELECT version, name, checksum, applied_at
       FROM struinfo_meta.schema_migrations
      ORDER BY version`,
  );
  const failing =
    row.number >= 165
      ? await runtime.observeFailingMigrationRollback()
      : undefined;
  const expectedVersions = TM2_MIGRATION_IDENTITIES.map((migration) =>
    String(migration.version).padStart(6, '0'),
  );
  const checks = new Map<number, boolean>([
    [
      151,
      runtime.schemasAbsentBeforeMigration &&
        concurrentOutcomes.includes('applied'),
    ],
    [152, concurrentOutcomes.includes('noop')],
    [
      153,
      observation.concurrent.some(
        (result) => result.appliedVersions.length === 4,
      ),
    ],
    [
      154,
      observation.concurrent.some(
        (result) =>
          JSON.stringify(result.appliedVersions) ===
          JSON.stringify(expectedVersions),
      ),
    ],
    [
      155,
      observation.secondNoop.outcome === 'noop' &&
        observation.secondNoop.appliedVersions.length === 0,
    ],
    [156, ledger.length === 4],
    [
      157,
      JSON.stringify(ledger.map((entry) => entry.version)) ===
        JSON.stringify(expectedVersions),
    ],
    [
      158,
      ledger.every(
        (entry, index) =>
          entry.checksum === TM2_MIGRATION_IDENTITIES[index]?.sha256,
      ),
    ],
    [
      159,
      ledger.every(
        (entry, index) =>
          entry.name ===
          TM2_MIGRATION_IDENTITIES[index]?.file
            .replace(/^\d{6}_/u, '')
            .replace(/\.sql$/u, ''),
      ),
    ],
    [160, ledger.every((entry) => entry.applied_at instanceof Date)],
    [
      161,
      JSON.stringify(concurrentOutcomes) ===
        JSON.stringify(['applied', 'noop']),
    ],
    [
      162,
      observation.safeLogRecords.filter(
        (record) => record.event === 'migration_applied',
      ).length === 4,
    ],
    [163, new Set(ledger.map((entry) => entry.version)).size === 4],
    [164, await migrationLockReleased(runtime)],
    [165, failing?.runnerRejected === true],
    [166, failing?.tableAbsent === true],
    [167, failing?.ledgerAbsent === true],
    [168, failing?.postFailureNoop === true],
  ]);
  assertCondition(
    checks.get(row.number) === true,
    `${row.id}:migration_observation_failed`,
  );
  return evidence(row, 3, 'migration_runner_observed');
}

async function migrationLockReleased(
  runtime: BoundPostgresTm2Runtime,
): Promise<boolean> {
  const count = await scalarCount(
    runtime,
    `SELECT count(*)::text AS count
       FROM pg_catalog.pg_locks
      WHERE locktype = 'advisory'
        AND classid = 1398035029
        AND objid = 1296648018
        AND granted`,
  );
  return count === 0;
}

async function catalogSummary(runtime: BoundPostgresTm2Runtime) {
  const tables = await runtime.queryAdmin<
    QueryResultRow & {readonly table_name: string; readonly owner_name: string}
  >(
    `SELECT c.relname AS table_name, r.rolname AS owner_name
       FROM pg_catalog.pg_class c
       JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
       JOIN pg_catalog.pg_roles r ON r.oid = c.relowner
      WHERE n.nspname = 'struinfo' AND c.relkind = 'r'
      ORDER BY c.relname`,
  );
  const constraints = await runtime.queryAdmin<
    QueryResultRow & {readonly contype: string; readonly count: string}
  >(
    `SELECT c.contype, count(*)::text AS count
       FROM pg_catalog.pg_constraint c
       JOIN pg_catalog.pg_namespace n ON n.oid = c.connamespace
      WHERE n.nspname = 'struinfo'
      GROUP BY c.contype`,
  );
  const constraintCounts = new Map(
    constraints.map((entry) => [entry.contype, Number(entry.count)]),
  );
  const explicitIndexes = await scalarCount(
    runtime,
    `SELECT count(*)::text AS count
       FROM pg_catalog.pg_index i
       JOIN pg_catalog.pg_class t ON t.oid = i.indrelid
       JOIN pg_catalog.pg_namespace n ON n.oid = t.relnamespace
       LEFT JOIN pg_catalog.pg_constraint c ON c.conindid = i.indexrelid
      WHERE n.nspname = 'struinfo' AND c.oid IS NULL`,
  );
  return {
    tables,
    summary: {
      tableNames: tables.map((entry) => entry.table_name),
      primaryKeys: constraintCounts.get('p') ?? 0,
      uniqueConstraints: constraintCounts.get('u') ?? 0,
      foreignKeys: constraintCounts.get('f') ?? 0,
      checks: constraintCounts.get('c') ?? 0,
      explicitIndexes,
    },
  };
}

async function executeCatalogTableCase(
  row: Tm2MandatoryCase,
  runtime: BoundPostgresTm2Runtime,
): Promise<Tm2CaseEvidence> {
  const catalog = await catalogSummary(runtime);
  const sortedExpected = [...TM2_BUSINESS_TABLES].sort();
  const sortedActual = catalog.summary.tableNames;
  const ordinal = row.number - 169;
  const checks = [
    sortedActual.length === 35,
    JSON.stringify(sortedActual) === JSON.stringify(sortedExpected),
    catalog.tables.every(
      (entry) => entry.owner_name === TM2_FIXED_ROLE_NAMES.migrator,
    ),
    await schemaOwnedByMigrator(runtime, 'struinfo'),
    await schemaOwnedByMigrator(runtime, 'struinfo_meta'),
    await metadataLedgerOwnedByMigrator(runtime),
    ...TM2_BUSINESS_TABLES.slice(0, 14).map((table) =>
      sortedActual.includes(table),
    ),
  ];
  assertCondition(checks[ordinal] === true, `${row.id}:catalog_table_failed`);
  return evidence(row, 2, 'catalog_table_observed');
}

async function schemaOwnedByMigrator(
  runtime: BoundPostgresTm2Runtime,
  schema: string,
): Promise<boolean> {
  return (
    (await scalarCount(
      runtime,
      `SELECT count(*)::text AS count
         FROM pg_catalog.pg_namespace n
         JOIN pg_catalog.pg_roles r ON r.oid = n.nspowner
        WHERE n.nspname = $1 AND r.rolname = $2`,
      [schema, TM2_FIXED_ROLE_NAMES.migrator],
    )) === 1
  );
}

async function metadataLedgerOwnedByMigrator(
  runtime: BoundPostgresTm2Runtime,
): Promise<boolean> {
  return (
    (await scalarCount(
      runtime,
      `SELECT count(*)::text AS count
         FROM pg_catalog.pg_class c
         JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
         JOIN pg_catalog.pg_roles r ON r.oid = c.relowner
        WHERE n.nspname = 'struinfo_meta'
          AND c.relname = 'schema_migrations'
          AND r.rolname = $1`,
      [TM2_FIXED_ROLE_NAMES.migrator],
    )) === 1
  );
}

async function executeCatalogConstraintCase(
  row: Tm2MandatoryCase,
  runtime: BoundPostgresTm2Runtime,
): Promise<Tm2CaseEvidence> {
  const catalog = await catalogSummary(runtime);
  const summary = catalog.summary;
  const semanticFindings = auditCatalogSummary(summary);
  const checks = [
    summary.primaryKeys === TM2_CATALOG_CARDINALITIES.primaryKeys,
    summary.uniqueConstraints === TM2_CATALOG_CARDINALITIES.uniqueConstraints,
    summary.foreignKeys === TM2_CATALOG_CARDINALITIES.foreignKeys,
    summary.checks === TM2_CATALOG_CARDINALITIES.checks,
    summary.explicitIndexes === TM2_CATALOG_CARDINALITIES.explicitIndexes,
    (await countConstraintProperty(runtime, 'c.condeferrable')) ===
      TM2_CATALOG_CARDINALITIES.deferredCurrentPointerForeignKeys,
    (await countConstraintProperty(runtime, `c.confdeltype <> 'a'`)) === 0,
    (await countConstraintProperty(runtime, `c.confupdtype <> 'a'`)) === 0,
    await allPrimaryKeysWorkspaceFirst(runtime),
    await allForeignKeysWorkspaceFirst(runtime),
    await allForeignKeyOrdersMatch(runtime),
    await allConstraintsValidated(runtime),
    await noJsonColumns(runtime),
    await noApplicationTriggers(runtime),
    await noSeedRows(runtime),
    await currentPointerForeignKeys(runtime),
    await partialIndexesAreUnique(runtime),
    await noExpressionIndexes(runtime),
    await indexesAreWorkspaceFirst(runtime),
    await schemaOwnedByMigrator(runtime, 'struinfo'),
    await schemaOwnedByMigrator(runtime, 'struinfo_meta'),
    catalog.tables.every(
      (entry) => entry.owner_name === TM2_FIXED_ROLE_NAMES.migrator,
    ),
    await createdAtDefaultsAreCurrentTimestamp(runtime),
    await notNullColumnsExist(runtime),
    await materialCheckDefinitionsExist(runtime),
    semanticFindings.length === 0,
    TM2_BUSINESS_TABLES.length === 35,
    await catalogHasNoExtraBusinessTables(runtime),
  ];
  const selected = checks[row.number - 189];
  assertCondition(selected === true, `${row.id}:catalog_constraint_failed`);
  return evidence(row, 2, 'catalog_constraint_observed');
}

async function countConstraintProperty(
  runtime: BoundPostgresTm2Runtime,
  predicate: string,
): Promise<number> {
  return await scalarCount(
    runtime,
    `SELECT count(*)::text AS count
       FROM pg_catalog.pg_constraint c
       JOIN pg_catalog.pg_namespace n ON n.oid = c.connamespace
      WHERE n.nspname = 'struinfo' AND c.contype = 'f' AND ${predicate}`,
  );
}

async function allPrimaryKeysWorkspaceFirst(runtime: BoundPostgresTm2Runtime) {
  return (
    (await scalarCount(
      runtime,
      `SELECT count(*)::text AS count
         FROM pg_catalog.pg_constraint c
         JOIN pg_catalog.pg_namespace n ON n.oid = c.connamespace
        WHERE n.nspname = 'struinfo' AND c.contype = 'p'
          AND (SELECT a.attname FROM pg_catalog.pg_attribute a
                WHERE a.attrelid = c.conrelid AND a.attnum = c.conkey[1]) <> 'workspace_id'`,
    )) === 0
  );
}

async function allForeignKeysWorkspaceFirst(runtime: BoundPostgresTm2Runtime) {
  return (
    (await scalarCount(
      runtime,
      `SELECT count(*)::text AS count
         FROM pg_catalog.pg_constraint c
         JOIN pg_catalog.pg_namespace n ON n.oid = c.connamespace
        WHERE n.nspname = 'struinfo' AND c.contype = 'f'
          AND (SELECT a.attname FROM pg_catalog.pg_attribute a
                WHERE a.attrelid = c.conrelid AND a.attnum = c.conkey[1]) <> 'workspace_id'`,
    )) === 0
  );
}

async function allForeignKeyOrdersMatch(runtime: BoundPostgresTm2Runtime) {
  return (
    (await scalarCount(
      runtime,
      `SELECT count(*)::text AS count
         FROM pg_catalog.pg_constraint c
         JOIN pg_catalog.pg_namespace n ON n.oid = c.connamespace
        WHERE n.nspname = 'struinfo' AND c.contype = 'f'
          AND cardinality(c.conkey) <> cardinality(c.confkey)`,
    )) === 0
  );
}

async function allConstraintsValidated(runtime: BoundPostgresTm2Runtime) {
  return (await countConstraintProperty(runtime, 'NOT c.convalidated')) === 0;
}

async function noJsonColumns(runtime: BoundPostgresTm2Runtime) {
  return (
    (await scalarCount(
      runtime,
      `SELECT count(*)::text AS count FROM information_schema.columns
        WHERE table_schema = 'struinfo' AND data_type IN ('json', 'jsonb')`,
    )) === 0
  );
}

async function noApplicationTriggers(runtime: BoundPostgresTm2Runtime) {
  return (
    (await scalarCount(
      runtime,
      `SELECT count(*)::text AS count
         FROM pg_catalog.pg_trigger t
         JOIN pg_catalog.pg_class c ON c.oid = t.tgrelid
         JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'struinfo' AND NOT t.tgisinternal`,
    )) === 0
  );
}

async function noSeedRows(runtime: BoundPostgresTm2Runtime) {
  const rows = await runtime.queryAdmin<
    QueryResultRow & {readonly count: string}
  >(`SELECT count(*)::text AS count FROM struinfo.workspace`);
  return rows[0]?.count === '0';
}

async function currentPointerForeignKeys(runtime: BoundPostgresTm2Runtime) {
  return (
    (await scalarCount(
      runtime,
      `SELECT count(*)::text AS count
         FROM pg_catalog.pg_constraint c
         JOIN pg_catalog.pg_namespace n ON n.oid = c.connamespace
        WHERE n.nspname = 'struinfo' AND c.contype = 'f' AND c.condeferrable`,
    )) === TM2_CATALOG_CARDINALITIES.deferredCurrentPointerForeignKeys
  );
}

async function partialIndexesAreUnique(runtime: BoundPostgresTm2Runtime) {
  return (
    (await scalarCount(
      runtime,
      `SELECT count(*)::text AS count
         FROM pg_catalog.pg_index i
         JOIN pg_catalog.pg_class c ON c.oid = i.indrelid
         JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'struinfo' AND i.indpred IS NOT NULL AND NOT i.indisunique`,
    )) === 0
  );
}

async function noExpressionIndexes(runtime: BoundPostgresTm2Runtime) {
  return (
    (await scalarCount(
      runtime,
      `SELECT count(*)::text AS count
         FROM pg_catalog.pg_index i
         JOIN pg_catalog.pg_class c ON c.oid = i.indrelid
         JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'struinfo' AND i.indexprs IS NOT NULL`,
    )) === 0
  );
}

async function indexesAreWorkspaceFirst(runtime: BoundPostgresTm2Runtime) {
  return (
    (await scalarCount(
      runtime,
      `SELECT count(*)::text AS count
         FROM pg_catalog.pg_index i
         JOIN pg_catalog.pg_class c ON c.oid = i.indrelid
         JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'struinfo'
          AND (SELECT a.attname FROM pg_catalog.pg_attribute a
                WHERE a.attrelid = i.indrelid AND a.attnum = i.indkey[0]) <> 'workspace_id'`,
    )) === 0
  );
}

async function createdAtDefaultsAreCurrentTimestamp(
  runtime: BoundPostgresTm2Runtime,
) {
  return (
    (await scalarCount(
      runtime,
      `SELECT count(*)::text AS count FROM information_schema.columns
        WHERE table_schema = 'struinfo' AND column_name = 'created_at'
          AND column_default IS DISTINCT FROM 'CURRENT_TIMESTAMP'`,
    )) === 0
  );
}

async function notNullColumnsExist(runtime: BoundPostgresTm2Runtime) {
  return (
    (await scalarCount(
      runtime,
      `SELECT count(*)::text AS count FROM information_schema.columns
        WHERE table_schema = 'struinfo' AND is_nullable = 'NO'`,
    )) > 0
  );
}

async function materialCheckDefinitionsExist(runtime: BoundPostgresTm2Runtime) {
  return (
    (await scalarCount(
      runtime,
      `SELECT count(*)::text AS count
         FROM pg_catalog.pg_constraint c
         JOIN pg_catalog.pg_namespace n ON n.oid = c.connamespace
        WHERE n.nspname = 'struinfo' AND c.contype = 'c'
          AND pg_catalog.pg_get_constraintdef(c.oid, true) <> ''`,
    )) === TM2_CATALOG_CARDINALITIES.checks
  );
}

async function catalogHasNoExtraBusinessTables(
  runtime: BoundPostgresTm2Runtime,
) {
  const catalog = await catalogSummary(runtime);
  return catalog.summary.tableNames.every((table) =>
    TM2_BUSINESS_TABLES.includes(table),
  );
}

const RUNTIME_INSERT_TABLES = [
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
] as const;

async function executeAllowedGrantCase(
  row: Tm2MandatoryCase,
  runtime: BoundPostgresTm2Runtime,
): Promise<Tm2CaseEvidence> {
  const table = RUNTIME_INSERT_TABLES[row.number - 217];
  if (table === undefined) {
    throw new Tm2SafeFailure(`${row.id}:allowed_grant_unmapped`);
  }
  const rows = await runtime.queryAdmin<
    QueryResultRow & {readonly column_name: string}
  >(
    `SELECT column_name FROM information_schema.columns
      WHERE table_schema = 'struinfo' AND table_name = $1
        AND column_name <> 'created_at'
      ORDER BY ordinal_position`,
    [table],
  );
  const columns = rows.map((row) => row.column_name);
  if (columns.length === 0) {
    throw new Tm2SafeFailure(`${row.id}:allowed_column_missing`);
  }
  const expectedInsertColumns = columns.filter(
    (column) => column !== 'created_at',
  );
  const expectedUpdateColumns =
    TM2_RUNTIME_POINTER_UPDATES.find((entry) => entry.table === table)
      ?.columns ?? [];
  const privileges = await Promise.all(
    columns.map(async (column) => {
      const result = await runtime.queryAdmin<
        QueryResultRow & {
          readonly can_insert: boolean;
          readonly can_update: boolean;
        }
      >(
        `SELECT
           has_column_privilege($1, format('struinfo.%I', $2), $3, 'INSERT') AS can_insert,
           has_column_privilege($1, format('struinfo.%I', $2), $3, 'UPDATE') AS can_update`,
        [TM2_FIXED_ROLE_NAMES.runtime, table, column],
      );
      return {column, privilege: result[0]};
    }),
  );
  const tablePrivileges = await runtime.queryAdmin<
    QueryResultRow & {
      readonly can_select: boolean;
      readonly can_insert_table: boolean;
      readonly can_update_table: boolean;
    }
  >(
    `SELECT
       has_table_privilege($1, format('struinfo.%I', $2), 'SELECT') AS can_select,
       has_table_privilege($1, format('struinfo.%I', $2), 'INSERT') AS can_insert_table,
       has_table_privilege($1, format('struinfo.%I', $2), 'UPDATE') AS can_update_table`,
    [TM2_FIXED_ROLE_NAMES.runtime, table],
  );
  const tablePrivilege = tablePrivileges[0];
  assertCondition(
    tablePrivilege?.can_select === true &&
      !tablePrivilege.can_insert_table &&
      !tablePrivilege.can_update_table &&
      privileges.every(
        ({column, privilege}) =>
          privilege?.can_insert === expectedInsertColumns.includes(column) &&
          privilege.can_update === expectedUpdateColumns.includes(column),
      ),
    `${row.id}:allowed_runtime_grant_missing`,
  );
  return evidence(row, columns.length * 2 + 3, 'allowed_grant_observed');
}

const FORBIDDEN_STATEMENTS = Object.freeze([
  'CREATE TEMP TABLE synthetic_tm2_temp (value integer)',
  'CREATE TABLE public.synthetic_tm2_public (value integer)',
  'CREATE TABLE struinfo.synthetic_tm2_project (value integer)',
  'CREATE FUNCTION public.synthetic_tm2_function() RETURNS integer LANGUAGE sql AS $$ SELECT 1 $$',
  'CREATE INDEX synthetic_tm2_idx ON struinfo.workspace (workspace_id)',
  'CREATE SCHEMA synthetic_tm2_schema',
  'CREATE EXTENSION IF NOT EXISTS hstore',
  'CREATE ROLE synthetic_tm2_role',
  'ALTER TABLE struinfo.workspace ADD COLUMN synthetic_extra integer',
  'DROP TABLE struinfo.workspace',
  'TRUNCATE struinfo.workspace',
  'DELETE FROM struinfo.workspace',
  'UPDATE struinfo.workspace SET workspace_id = workspace_id',
  'UPDATE struinfo.knowledge_revision SET title = title',
  'UPDATE struinfo.curation_command SET outcome = outcome',
  "INSERT INTO struinfo.workspace (workspace_id) VALUES ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')",
  'SELECT * FROM struinfo_meta.schema_migrations',
  `SET ROLE ${TM2_FIXED_ROLE_NAMES.migrator}`,
  'GRANT SELECT ON struinfo.workspace TO PUBLIC',
  'REVOKE SELECT ON struinfo.workspace FROM PUBLIC',
  "COMMENT ON TABLE struinfo.workspace IS 'synthetic'",
  'CREATE POLICY synthetic_tm2_policy ON struinfo.workspace USING (true)',
  'ALTER TABLE struinfo.workspace ENABLE ROW LEVEL SECURITY',
  "INSERT INTO struinfo.evidence_blob (workspace_id, blob_id, digest_algorithm, digest, byte_length) VALUES ('11111111-1111-4111-8111-111111111111', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa24', 'sha256', repeat('a', 64), 0)",
  'UPDATE struinfo.evidence_blob SET byte_length = byte_length',
  'DELETE FROM struinfo.evidence_blob',
  "INSERT INTO struinfo.resource (workspace_id, resource_id, resource_kind, source_key) VALUES ('11111111-1111-4111-8111-111111111111', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa27', 'manual_text', 'tm2:forbidden')",
  "INSERT INTO struinfo.git_resource (workspace_id, resource_id, canonical_repository_uri, repository_relative_path) VALUES ('11111111-1111-4111-8111-111111111111', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa28', 'https://fixture.example.invalid/repository', 'synthetic.md')",
  '__ALTER_DATABASE__',
  'CREATE MATERIALIZED VIEW public.synthetic_tm2_view AS SELECT 1',
  'CREATE SEQUENCE public.synthetic_tm2_sequence',
  "CREATE TYPE public.synthetic_tm2_type AS ENUM ('synthetic')",
]);

async function executeForbiddenGrantCase(
  row: Tm2MandatoryCase,
  runtime: BoundPostgresTm2Runtime,
): Promise<Tm2CaseEvidence> {
  const statement = FORBIDDEN_STATEMENTS[row.number - 241];
  if (statement === undefined) {
    throw new Tm2SafeFailure(`${row.id}:forbidden_grant_unmapped`);
  }
  const executableStatement =
    statement === '__ALTER_DATABASE__'
      ? `ALTER DATABASE ${quoteIdentifier(runtime.runtimeConfig.database)} SET timezone TO 'UTC'`
      : statement;
  assertCondition(
    await runtime.expectRuntimeStatementRejected(executableStatement),
    `${row.id}:forbidden_statement_succeeded`,
  );
  return evidence(row, 1, 'forbidden_grant_observed');
}

function quoteIdentifier(identifier: string): string {
  if (identifier.length === 0 || identifier.includes('\u0000')) {
    throw new Tm2SafeFailure('test_identifier_invalid');
  }
  return `"${identifier.replaceAll('"', '""')}"`;
}

async function executeLifecycleCaseInternal(
  row: Tm2MandatoryCase,
  runtime: BoundPostgresTm2Runtime,
): Promise<Tm2CaseEvidence> {
  await runtime.prepare();
  const poolSource = await readFile(
    join(
      process.cwd(),
      'apps',
      'server',
      'src',
      'platform',
      'database',
      'postgresql',
      'postgres_pool.ts',
    ),
    'utf8',
  );
  const checks = [
    (await runtime.queryRuntime<{readonly value: number}>('SELECT 1 AS value'))
      .rows[0]?.value === 1,
    (poolSource.match(/new Pool\(/gu) ?? []).length === 1,
    poolSource.includes('client.release()'),
    poolSource.includes('await this.#pool.end()'),
    poolSource.includes('connect(): Promise<PostgresClientBoundary>'),
    poolSource.includes('executeSimple'),
    !poolSource.includes('connectionString'),
    !poolSource.includes('process.env'),
    poolSource.includes('parameters === undefined'),
    poolSource.includes('[...parameters]'),
    poolSource.includes('projectQueryResult'),
    poolSource.includes('OwnedNodePostgresClient'),
    poolSource.includes('createNodePostgresPool'),
    (runtime.repositories.curation as unknown) !==
      (runtime.repositories.knowledge as unknown),
  ];
  assertCondition(
    checks[row.number - 273] === true,
    `${row.id}:pool_lifecycle_failed`,
  );
  return evidence(row, 2, 'pool_lifecycle_observed');
}

async function executeWorkspaceTransactionCase(
  row: Tm2MandatoryCase,
  runtime: BoundPostgresTm2Runtime,
): Promise<Tm2CaseEvidence> {
  const known = deriveWorkspaceLockKnownAnswer(
    '11111111-1111-4111-8111-111111111111',
  );
  if (row.number === 287) {
    assertCondition(
      known.digest ===
        '5a8f5bbb1115b7a070f4dbacc772b36b22141bd0900a271b1b3de14c4aac54f2',
      `${row.id}:lock_digest_mismatch`,
    );
  } else if (row.number === 288) {
    assertCondition(
      known.signedKey === '6525535244086785952',
      `${row.id}:lock_key_mismatch`,
    );
  } else if (row.number === 289) {
    const observed = await runtime.withRuntimeRollback(
      async (client) =>
        await client.query<{readonly key: string}>(
          'SELECT $1::bigint::text AS key',
          [known.signedKey],
        ),
    );
    assertCondition(
      observed.rows[0]?.key === known.signedKey,
      `${row.id}:lock_parameter_mismatch`,
    );
  } else {
    const sources = await Promise.all([
      readFile(
        join(
          process.cwd(),
          'apps/server/src/platform/database/postgresql/postgres_curation_repository.ts',
        ),
        'utf8',
      ),
      readFile(
        join(
          process.cwd(),
          'apps/server/src/platform/database/postgresql/postgres_knowledge_repository.ts',
        ),
        'utf8',
      ),
      readFile(
        join(
          process.cwd(),
          'apps/server/src/platform/database/postgresql/workspace_write_lock.ts',
        ),
        'utf8',
      ),
    ]);
    const joined = sources.join('\n');
    const staticChecks = [
      !joined.includes('FROM struinfo.workspace FOR UPDATE'),
      joined.includes('FROM struinfo.curation_command'),
      joined.includes('FROM struinfo.knowledge_change_set'),
      joined.includes('pg_advisory_xact_lock'),
      joined.includes('ORDER BY term_id'),
      joined.includes('ORDER BY item_id'),
      joined.includes('ORDER BY relation_id'),
      joined.includes('FOR UPDATE'),
      joined.includes('BEGIN ISOLATION LEVEL READ COMMITTED'),
      joined.includes('COMMIT'),
      joined.includes('ROLLBACK'),
      joined.includes('rowCount'),
      joined.includes('compareAndSet'),
      joined.includes('workspace_id = $1'),
      !joined.includes('UPDATE struinfo.curation_command'),
      !joined.includes('UPDATE struinfo.knowledge_change_set'),
      !joined.includes('DELETE FROM struinfo.curation_command'),
      !joined.includes('DELETE FROM struinfo.knowledge_change_set'),
      joined.includes('client.release()'),
      joined.includes('runPostgresTransaction'),
      joined.includes('read_committed'),
    ];
    assertCondition(
      staticChecks[row.number - 290] === true,
      `${row.id}:transaction_boundary_failed`,
    );
  }
  return evidence(row, 2, 'workspace_transaction_observed');
}

export async function executeMigrationCase(
  row: Tm2MandatoryCase,
  runtime: BoundPostgresTm2Runtime,
): Promise<Tm2CaseEvidence> {
  return await executeMigrationCaseInternal(row, runtime);
}

export async function executeCatalogCase(
  row: Tm2MandatoryCase,
  runtime: BoundPostgresTm2Runtime,
): Promise<Tm2CaseEvidence> {
  return row.number <= 188
    ? await executeCatalogTableCase(row, runtime)
    : await executeCatalogConstraintCase(row, runtime);
}

export async function executeGrantCase(
  row: Tm2MandatoryCase,
  runtime: BoundPostgresTm2Runtime,
): Promise<Tm2CaseEvidence> {
  if (row.number <= 150) {
    return await executeRoleClosureCase(row, runtime);
  }
  if (row.number <= 240) {
    return await executeAllowedGrantCase(row, runtime);
  }
  return await executeForbiddenGrantCase(row, runtime);
}

export async function executeLifecycleCase(
  row: Tm2MandatoryCase,
  runtime: BoundPostgresTm2Runtime,
): Promise<Tm2CaseEvidence> {
  return await executeLifecycleCaseInternal(row, runtime);
}

export async function executeTransactionCase(
  row: Tm2MandatoryCase,
  runtime: BoundPostgresTm2Runtime,
): Promise<Tm2CaseEvidence> {
  if (row.number <= 310) {
    return await executeWorkspaceTransactionCase(row, runtime);
  }
  return await executeAdvancedTransactionCase(row, runtime);
}
