export const TM2_MIGRATION_IDENTITIES = Object.freeze([
  Object.freeze({
    version: 1,
    file: '000001_create_application_schema.sql',
    sha256: '99bc5217c7a678062777cecf09b13552363268add559ab759705035b358f62b5',
  }),
  Object.freeze({
    version: 2,
    file: '000002_create_source_evidence_schema.sql',
    sha256: 'aecfe896765b8d209080afc5c9f7466dab57ed8b7a19f8b8d44a575429628964',
  }),
  Object.freeze({
    version: 3,
    file: '000003_create_manual_curation_schema.sql',
    sha256: '60c94270ef3c9de019593a8a54861c697c16189f6e65d8759553028aafba0eb1',
  }),
  Object.freeze({
    version: 4,
    file: '000004_create_manual_knowledge_core.sql',
    sha256: '2261d1d3d638139aea23abbc6c67aa6dceb60e8c52317a9a787b2450ea5e4f8f',
  }),
]);

export const TM2_BUSINESS_TABLES = Object.freeze([
  'assessment',
  'assessment_revision',
  'classification_assignment',
  'classification_assignment_revision',
  'curation_command',
  'curation_target',
  'document_node',
  'document_structure',
  'evidence_blob',
  'fragment',
  'git_resource',
  'git_snapshot_observation',
  'intake_decision',
  'intake_decision_reason',
  'intake_decision_revision',
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
  'media_asset',
  'media_usage',
  'relation_revision_fragment_input',
  'relation_revision_item_input',
  'relation_revision_relation_input',
  'resource',
  'snapshot',
  'vocabulary_term',
  'vocabulary_term_revision',
  'workspace',
]);

export const TM2_CATALOG_CARDINALITIES = Object.freeze({
  businessTables: 35,
  primaryKeys: 35,
  uniqueConstraints: 49,
  foreignKeys: 77,
  checks: 128,
  explicitIndexes: 8,
  deferredCurrentPointerForeignKeys: 10,
});

export const TM2_RUNTIME_POINTER_UPDATES = Object.freeze([
  Object.freeze({table: 'curation_target', columns: ['current_version']}),
  Object.freeze({
    table: 'vocabulary_term',
    columns: ['current_revision', 'current_term_revision_id'],
  }),
  Object.freeze({
    table: 'classification_assignment',
    columns: ['current_revision', 'current_assignment_revision_id'],
  }),
  Object.freeze({
    table: 'intake_decision',
    columns: ['current_revision', 'current_decision_revision_id'],
  }),
  Object.freeze({
    table: 'assessment',
    columns: ['current_revision', 'current_assessment_revision_id'],
  }),
  Object.freeze({
    table: 'knowledge_item',
    columns: ['current_revision', 'current_revision_id'],
  }),
  Object.freeze({
    table: 'knowledge_relation',
    columns: ['current_revision', 'current_revision_id'],
  }),
]);

export const TM2_RUNTIME_GRANT_CARDINALITIES = Object.freeze({
  selectTables: 35,
  insertColumns: 181,
  updateColumns: 13,
  updateTables: 7,
});

export const TM2_CATALOG_QUERIES = Object.freeze({
  tables:
    "SELECT c.relname AS table_name, r.rolname AS owner_name FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace JOIN pg_catalog.pg_roles r ON r.oid = c.relowner WHERE n.nspname = $1 AND c.relkind = 'r' ORDER BY c.relname",
  columns:
    'SELECT table_name, column_name, ordinal_position, data_type, udt_name, is_nullable, column_default FROM information_schema.columns WHERE table_schema = $1 ORDER BY table_name, ordinal_position',
  constraints:
    'SELECT c.conrelid::regclass::text AS table_name, c.contype, c.conkey, c.confrelid::regclass::text AS referenced_table, c.confkey, c.confdeltype, c.confupdtype, pg_catalog.pg_get_constraintdef(c.oid, true) AS definition FROM pg_catalog.pg_constraint c JOIN pg_catalog.pg_namespace n ON n.oid = c.connamespace WHERE n.nspname = $1 ORDER BY table_name, c.contype, c.oid',
  indexes:
    'SELECT tablename, indexname, indexdef FROM pg_catalog.pg_indexes WHERE schemaname = $1 ORDER BY tablename, indexname',
  roles:
    'SELECT rolname, rolcanlogin, rolsuper, rolcreatedb, rolcreaterole, rolreplication, rolbypassrls FROM pg_catalog.pg_roles WHERE rolname = ANY($1::text[]) ORDER BY rolname',
  memberships:
    'SELECT member_role.rolname AS member_name, granted_role.rolname AS role_name, m.admin_option, m.inherit_option, m.set_option FROM pg_catalog.pg_auth_members m JOIN pg_catalog.pg_roles member_role ON member_role.oid = m.member JOIN pg_catalog.pg_roles granted_role ON granted_role.oid = m.roleid WHERE member_role.rolname = ANY($1::text[]) ORDER BY member_name, role_name',
});

export const TM2_SYNTHETIC_IDENTITIES = Object.freeze({
  workspaceA: '11111111-1111-4111-8111-111111111111',
  workspaceB: '22222222-2222-4222-8222-222222222222',
  commandA: '33333333-3333-4333-8333-333333333333',
  commandB: '44444444-4444-4444-8444-444444444444',
  resource: '55555555-5555-4555-8555-555555555555',
  snapshot: '66666666-6666-4666-8666-666666666666',
  fragment: '77777777-7777-4777-8777-777777777777',
  item: '88888888-8888-4888-8888-888888888888',
  relation: '99999999-9999-4999-8999-999999999999',
});

export interface CatalogSummary {
  readonly tableNames: readonly string[];
  readonly primaryKeys: number;
  readonly uniqueConstraints: number;
  readonly foreignKeys: number;
  readonly checks: number;
  readonly explicitIndexes: number;
}

export function auditCatalogSummary(
  summary: CatalogSummary,
): readonly string[] {
  const findings: string[] = [];
  const expectedTables = [...TM2_BUSINESS_TABLES].sort();
  const actualTables = [...summary.tableNames].sort();
  if (JSON.stringify(actualTables) !== JSON.stringify(expectedTables)) {
    findings.push('catalog_table_set');
  }
  for (const [key, actual, expected] of [
    [
      'catalog_primary_keys',
      summary.primaryKeys,
      TM2_CATALOG_CARDINALITIES.primaryKeys,
    ],
    [
      'catalog_unique_constraints',
      summary.uniqueConstraints,
      TM2_CATALOG_CARDINALITIES.uniqueConstraints,
    ],
    [
      'catalog_foreign_keys',
      summary.foreignKeys,
      TM2_CATALOG_CARDINALITIES.foreignKeys,
    ],
    ['catalog_checks', summary.checks, TM2_CATALOG_CARDINALITIES.checks],
    [
      'catalog_explicit_indexes',
      summary.explicitIndexes,
      TM2_CATALOG_CARDINALITIES.explicitIndexes,
    ],
  ] as const) {
    if (actual !== expected) {
      findings.push(key);
    }
  }
  return Object.freeze(findings);
}
