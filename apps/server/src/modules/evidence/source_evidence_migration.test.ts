import {readFile} from 'node:fs/promises';

import {beforeAll, describe, expect, it} from 'vitest';

import {
  analyzeSourceEvidenceDdl,
  checkFingerprint,
  findForbiddenSqlOperations,
  foreignKeyFingerprint,
  keyFingerprint,
  normalizeForeignKeyMatchForContract,
  SourceEvidenceSqlLexicalError,
  tokenizeSourceEvidenceSql,
  type SourceEvidenceDdlShape,
  type SqlColumnShape,
  type SqlTableShape,
} from '../../../test_support/source_evidence_sql_lexical.js';

const MIGRATION_URL = new URL(
  '../../../migrations/000002_create_source_evidence_schema.sql',
  import.meta.url,
);
const STATIC_TEST_SCOPE =
  'static SQL text audit only; it does not parse with or execute PostgreSQL DDL';
const EXPECTED_TABLES = [
  'workspace',
  'evidence_blob',
  'resource',
  'git_resource',
  'snapshot',
  'git_snapshot_observation',
  'document_structure',
  'document_node',
  'fragment',
  'media_asset',
  'media_usage',
] as const;

type EvidenceTableName = (typeof EXPECTED_TABLES)[number];

const REQUIRED_TIMESTAMP_DEFAULT = {
  type: 'timestamp with time zone',
  nullable: false,
  defaultExpression: 'current_timestamp',
} as const;

const EXPECTED_COLUMNS: Readonly<
  Record<EvidenceTableName, Readonly<Record<string, Readonly<SqlColumnShape>>>>
> = {
  workspace: {
    workspace_id: required('uuid'),
    created_at: REQUIRED_TIMESTAMP_DEFAULT,
  },
  evidence_blob: {
    workspace_id: required('uuid'),
    blob_id: required('uuid'),
    digest_algorithm: required('text'),
    digest: required('text'),
    byte_length: required('bigint'),
    media_type: optional('text'),
    read_revoked_at: optional('timestamp with time zone'),
    delete_after: optional('timestamp with time zone'),
    created_at: REQUIRED_TIMESTAMP_DEFAULT,
  },
  resource: {
    workspace_id: required('uuid'),
    resource_id: required('uuid'),
    resource_kind: required('text'),
    source_key: required('text'),
    canonical_uri: optional('text'),
    created_at: REQUIRED_TIMESTAMP_DEFAULT,
  },
  git_resource: {
    workspace_id: required('uuid'),
    resource_id: required('uuid'),
    canonical_repository_uri: required('text'),
    repository_relative_path: required('text'),
    created_at: REQUIRED_TIMESTAMP_DEFAULT,
  },
  snapshot: {
    workspace_id: required('uuid'),
    snapshot_id: required('uuid'),
    resource_id: required('uuid'),
    raw_sha256: required('text'),
    raw_blob_id: optional('uuid'),
    raw_blob_byte_length: optional('bigint'),
    canonical_content_sha256: required('text'),
    canonicalization_version: required('text'),
    media_type: optional('text'),
    published_at: optional('timestamp with time zone'),
    published_timezone: optional('text'),
    published_precision: optional('text'),
    published_source_text: optional('text'),
    published_inferred: required('boolean', 'false'),
    captured_at: required('timestamp with time zone'),
    created_at: REQUIRED_TIMESTAMP_DEFAULT,
  },
  git_snapshot_observation: {
    workspace_id: required('uuid'),
    observation_id: required('uuid'),
    resource_id: required('uuid'),
    snapshot_id: required('uuid'),
    repository_ref: required('text'),
    commit_hash_algorithm: required('text'),
    commit_hash: required('text'),
    git_blob_hash_algorithm: optional('text'),
    git_blob_hash: optional('text'),
    observed_at: required('timestamp with time zone'),
    created_at: REQUIRED_TIMESTAMP_DEFAULT,
  },
  document_structure: {
    workspace_id: required('uuid'),
    structure_id: required('uuid'),
    resource_id: required('uuid'),
    snapshot_id: required('uuid'),
    parser_name: required('text'),
    parser_version: required('text'),
    text_normalization_version: required('text'),
    text_blob_id: required('uuid'),
    text_blob_sha256: required('text'),
    text_blob_byte_length: required('bigint'),
    structure_sha256: required('text'),
    created_at: REQUIRED_TIMESTAMP_DEFAULT,
  },
  document_node: {
    workspace_id: required('uuid'),
    structure_id: required('uuid'),
    node_id: required('uuid'),
    resource_id: required('uuid'),
    snapshot_id: required('uuid'),
    parent_node_id: optional('uuid'),
    node_kind: required('text'),
    sibling_ordinal: required('integer'),
    code_point_start: required('bigint'),
    code_point_end: required('bigint'),
    line_start: optional('integer'),
    line_end: optional('integer'),
    created_at: REQUIRED_TIMESTAMP_DEFAULT,
  },
  fragment: {
    workspace_id: required('uuid'),
    fragment_id: required('uuid'),
    resource_id: required('uuid'),
    snapshot_id: required('uuid'),
    structure_id: required('uuid'),
    node_id: required('uuid'),
    text_blob_id: required('uuid'),
    text_blob_sha256: required('text'),
    text_blob_byte_length: required('bigint'),
    locator_kind: required('text'),
    locator_version: required('integer'),
    code_point_start: required('bigint'),
    code_point_end: required('bigint'),
    line_start: optional('integer'),
    line_end: optional('integer'),
    selected_text_sha256: required('text'),
    created_at: REQUIRED_TIMESTAMP_DEFAULT,
  },
  media_asset: {
    workspace_id: required('uuid'),
    media_asset_id: required('uuid'),
    storage_mode: required('text'),
    blob_id: optional('uuid'),
    blob_sha256: optional('text'),
    blob_byte_length: optional('bigint'),
    original_uri: optional('text'),
    media_type: optional('text'),
    pixel_width: optional('integer'),
    pixel_height: optional('integer'),
    created_at: REQUIRED_TIMESTAMP_DEFAULT,
  },
  media_usage: {
    workspace_id: required('uuid'),
    media_usage_id: required('uuid'),
    media_asset_id: required('uuid'),
    resource_id: required('uuid'),
    snapshot_id: required('uuid'),
    structure_id: required('uuid'),
    node_id: required('uuid'),
    ordinal: required('integer'),
    purpose: required('text'),
    purpose_origin: required('text'),
    confidence: optional('double precision'),
    superseded_usage_id: optional('uuid'),
    created_at: REQUIRED_TIMESTAMP_DEFAULT,
  },
};

const EXPECTED_KEYS: Readonly<Record<EvidenceTableName, readonly string[]>> = {
  workspace: [keyFingerprint('primary_key', ['workspace_id'])],
  evidence_blob: [
    keyFingerprint('primary_key', ['workspace_id', 'blob_id']),
    keyFingerprint('unique', ['workspace_id', 'digest_algorithm', 'digest']),
    keyFingerprint('unique', [
      'workspace_id',
      'blob_id',
      'digest',
      'byte_length',
    ]),
  ],
  resource: [
    keyFingerprint('primary_key', ['workspace_id', 'resource_id']),
    keyFingerprint('unique', ['workspace_id', 'resource_kind', 'source_key']),
  ],
  git_resource: [
    keyFingerprint('primary_key', ['workspace_id', 'resource_id']),
    keyFingerprint('unique', [
      'workspace_id',
      'canonical_repository_uri',
      'repository_relative_path',
    ]),
  ],
  snapshot: [
    keyFingerprint('primary_key', ['workspace_id', 'snapshot_id']),
    keyFingerprint('unique', ['workspace_id', 'resource_id', 'raw_sha256']),
    keyFingerprint('unique', ['workspace_id', 'resource_id', 'snapshot_id']),
  ],
  git_snapshot_observation: [
    keyFingerprint('primary_key', ['workspace_id', 'observation_id']),
    keyFingerprint('unique', [
      'workspace_id',
      'resource_id',
      'repository_ref',
      'commit_hash_algorithm',
      'commit_hash',
    ]),
  ],
  document_structure: [
    keyFingerprint('primary_key', ['workspace_id', 'structure_id']),
    keyFingerprint('unique', [
      'workspace_id',
      'snapshot_id',
      'parser_name',
      'parser_version',
      'text_normalization_version',
      'structure_sha256',
    ]),
    keyFingerprint('unique', [
      'workspace_id',
      'resource_id',
      'snapshot_id',
      'structure_id',
    ]),
    keyFingerprint('unique', [
      'workspace_id',
      'resource_id',
      'snapshot_id',
      'structure_id',
      'text_blob_id',
      'text_blob_sha256',
      'text_blob_byte_length',
    ]),
  ],
  document_node: [
    keyFingerprint('primary_key', ['workspace_id', 'structure_id', 'node_id']),
    keyFingerprint('unique_nulls_not_distinct', [
      'workspace_id',
      'structure_id',
      'parent_node_id',
      'sibling_ordinal',
    ]),
    keyFingerprint('unique', [
      'workspace_id',
      'resource_id',
      'snapshot_id',
      'structure_id',
      'node_id',
    ]),
  ],
  fragment: [
    keyFingerprint('primary_key', ['workspace_id', 'fragment_id']),
    keyFingerprint('unique', [
      'workspace_id',
      'resource_id',
      'snapshot_id',
      'structure_id',
      'node_id',
      'locator_kind',
      'locator_version',
      'code_point_start',
      'code_point_end',
    ]),
  ],
  media_asset: [
    keyFingerprint('primary_key', ['workspace_id', 'media_asset_id']),
    keyFingerprint('unique', ['workspace_id', 'storage_mode', 'blob_sha256']),
  ],
  media_usage: [
    keyFingerprint('primary_key', ['workspace_id', 'media_usage_id']),
    keyFingerprint('unique', [
      'workspace_id',
      'resource_id',
      'snapshot_id',
      'structure_id',
      'node_id',
      'ordinal',
      'media_usage_id',
    ]),
    keyFingerprint('unique_nulls_not_distinct', [
      'workspace_id',
      'resource_id',
      'snapshot_id',
      'structure_id',
      'node_id',
      'ordinal',
      'superseded_usage_id',
    ]),
  ],
};

const EXPECTED_FOREIGN_KEYS: Readonly<
  Record<EvidenceTableName, readonly string[]>
> = {
  workspace: [],
  evidence_blob: [workspaceForeignKey()],
  resource: [workspaceForeignKey()],
  git_resource: [
    foreignKeyFingerprint(
      ['workspace_id', 'resource_id'],
      'struinfo.resource',
      ['workspace_id', 'resource_id'],
    ),
  ],
  snapshot: [
    foreignKeyFingerprint(
      ['workspace_id', 'resource_id'],
      'struinfo.resource',
      ['workspace_id', 'resource_id'],
    ),
    foreignKeyFingerprint(
      ['workspace_id', 'raw_blob_id', 'raw_sha256', 'raw_blob_byte_length'],
      'struinfo.evidence_blob',
      ['workspace_id', 'blob_id', 'digest', 'byte_length'],
    ),
  ],
  git_snapshot_observation: [
    foreignKeyFingerprint(
      ['workspace_id', 'resource_id', 'snapshot_id'],
      'struinfo.snapshot',
      ['workspace_id', 'resource_id', 'snapshot_id'],
    ),
  ],
  document_structure: [
    foreignKeyFingerprint(
      ['workspace_id', 'resource_id', 'snapshot_id'],
      'struinfo.snapshot',
      ['workspace_id', 'resource_id', 'snapshot_id'],
    ),
    foreignKeyFingerprint(
      [
        'workspace_id',
        'text_blob_id',
        'text_blob_sha256',
        'text_blob_byte_length',
      ],
      'struinfo.evidence_blob',
      ['workspace_id', 'blob_id', 'digest', 'byte_length'],
    ),
  ],
  document_node: [
    foreignKeyFingerprint(
      ['workspace_id', 'resource_id', 'snapshot_id', 'structure_id'],
      'struinfo.document_structure',
      ['workspace_id', 'resource_id', 'snapshot_id', 'structure_id'],
    ),
    foreignKeyFingerprint(
      ['workspace_id', 'structure_id', 'parent_node_id'],
      'struinfo.document_node',
      ['workspace_id', 'structure_id', 'node_id'],
    ),
  ],
  fragment: [
    foreignKeyFingerprint(
      [
        'workspace_id',
        'resource_id',
        'snapshot_id',
        'structure_id',
        'text_blob_id',
        'text_blob_sha256',
        'text_blob_byte_length',
      ],
      'struinfo.document_structure',
      [
        'workspace_id',
        'resource_id',
        'snapshot_id',
        'structure_id',
        'text_blob_id',
        'text_blob_sha256',
        'text_blob_byte_length',
      ],
    ),
    foreignKeyFingerprint(
      ['workspace_id', 'resource_id', 'snapshot_id', 'structure_id', 'node_id'],
      'struinfo.document_node',
      ['workspace_id', 'resource_id', 'snapshot_id', 'structure_id', 'node_id'],
    ),
  ],
  media_asset: [
    workspaceForeignKey(),
    foreignKeyFingerprint(
      ['workspace_id', 'blob_id', 'blob_sha256', 'blob_byte_length'],
      'struinfo.evidence_blob',
      ['workspace_id', 'blob_id', 'digest', 'byte_length'],
    ),
  ],
  media_usage: [
    foreignKeyFingerprint(
      ['workspace_id', 'media_asset_id'],
      'struinfo.media_asset',
      ['workspace_id', 'media_asset_id'],
    ),
    foreignKeyFingerprint(
      ['workspace_id', 'resource_id', 'snapshot_id', 'structure_id', 'node_id'],
      'struinfo.document_node',
      ['workspace_id', 'resource_id', 'snapshot_id', 'structure_id', 'node_id'],
    ),
    foreignKeyFingerprint(
      [
        'workspace_id',
        'resource_id',
        'snapshot_id',
        'structure_id',
        'node_id',
        'ordinal',
        'superseded_usage_id',
      ],
      'struinfo.media_usage',
      [
        'workspace_id',
        'resource_id',
        'snapshot_id',
        'structure_id',
        'node_id',
        'ordinal',
        'media_usage_id',
      ],
    ),
  ],
};

const EXPECTED_CHECKS: Readonly<Record<EvidenceTableName, readonly string[]>> =
  {
    workspace: [],
    evidence_blob: checks(
      "digest_algorithm = 'sha256'",
      "digest ~ '^[0-9a-f]{64}$'",
      'byte_length >= 0',
      "media_type IS NULL OR btrim(media_type) <> ''",
    ),
    resource: checks(
      "resource_kind IN ('git_file', 'manual_text', 'uploaded_file')",
      "btrim(source_key) <> ''",
      "canonical_uri IS NULL OR btrim(canonical_uri) <> ''",
    ),
    git_resource: checks(
      "btrim(canonical_repository_uri) <> ''",
      String.raw`btrim(repository_relative_path) <> '' AND left(repository_relative_path, 1) <> '/' AND position(E'\\' IN repository_relative_path) = 0 AND repository_relative_path !~ '(^|/)\.\.?(/|$)' AND repository_relative_path !~ '^[A-Za-z]:'`,
    ),
    snapshot: checks(
      "raw_sha256 ~ '^[0-9a-f]{64}$'",
      '(raw_blob_id IS NULL) = (raw_blob_byte_length IS NULL)',
      'raw_blob_byte_length IS NULL OR raw_blob_byte_length >= 0',
      "canonical_content_sha256 ~ '^[0-9a-f]{64}$'",
      "btrim(canonicalization_version) <> ''",
      "media_type IS NULL OR btrim(media_type) <> ''",
      "published_timezone IS NULL OR btrim(published_timezone) <> ''",
      "published_precision IS NULL OR published_precision IN ('year', 'month', 'day', 'hour', 'minute', 'second')",
      'published_at IS NOT NULL OR (published_timezone IS NULL AND published_precision IS NULL)',
    ),
    git_snapshot_observation: checks(
      "btrim(repository_ref) <> ''",
      "(commit_hash_algorithm = 'sha1' AND commit_hash ~ '^[0-9a-f]{40}$') OR (commit_hash_algorithm = 'sha256' AND commit_hash ~ '^[0-9a-f]{64}$')",
      '(git_blob_hash_algorithm IS NULL) = (git_blob_hash IS NULL)',
      "git_blob_hash_algorithm IS NULL OR (git_blob_hash_algorithm = 'sha1' AND git_blob_hash ~ '^[0-9a-f]{40}$') OR (git_blob_hash_algorithm = 'sha256' AND git_blob_hash ~ '^[0-9a-f]{64}$')",
    ),
    document_structure: checks(
      "btrim(parser_name) <> ''",
      "btrim(parser_version) <> ''",
      "btrim(text_normalization_version) <> ''",
      "text_blob_sha256 ~ '^[0-9a-f]{64}$'",
      'text_blob_byte_length >= 0',
      "structure_sha256 ~ '^[0-9a-f]{64}$'",
    ),
    document_node: checks(
      'parent_node_id IS NULL OR parent_node_id <> node_id',
      "node_kind IN ('document', 'section', 'heading', 'paragraph', 'blockquote', 'list', 'list_item', 'code_block', 'table', 'table_row', 'table_cell', 'image', 'thematic_break')",
      'sibling_ordinal >= 0',
      'parent_node_id IS NOT NULL OR sibling_ordinal = 0',
      'code_point_start >= 0 AND code_point_end > code_point_start',
      '(line_start IS NULL AND line_end IS NULL) OR (line_start IS NOT NULL AND line_end IS NOT NULL AND line_start >= 1 AND line_end >= line_start)',
    ),
    fragment: checks(
      "text_blob_sha256 ~ '^[0-9a-f]{64}$'",
      'text_blob_byte_length >= 0',
      "locator_kind = 'unicode_code_point_range'",
      'locator_version = 1',
      'code_point_start >= 0 AND code_point_end > code_point_start',
      '(line_start IS NULL AND line_end IS NULL) OR (line_start IS NOT NULL AND line_end IS NOT NULL AND line_start >= 1 AND line_end >= line_start)',
      "selected_text_sha256 ~ '^[0-9a-f]{64}$'",
    ),
    media_asset: checks(
      "storage_mode IN ('stored_blob', 'external_reference')",
      "(storage_mode = 'stored_blob' AND blob_id IS NOT NULL AND blob_sha256 IS NOT NULL AND blob_byte_length IS NOT NULL) OR (storage_mode = 'external_reference' AND blob_id IS NULL AND blob_sha256 IS NULL AND blob_byte_length IS NULL AND original_uri IS NOT NULL AND btrim(original_uri) <> '')",
      "blob_sha256 IS NULL OR blob_sha256 ~ '^[0-9a-f]{64}$'",
      'blob_byte_length IS NULL OR blob_byte_length >= 0',
      "original_uri IS NULL OR btrim(original_uri) <> ''",
      "media_type IS NULL OR btrim(media_type) <> ''",
      '(pixel_width IS NULL AND pixel_height IS NULL) OR (pixel_width IS NOT NULL AND pixel_height IS NOT NULL AND pixel_width > 0 AND pixel_height > 0)',
    ),
    media_usage: checks(
      'ordinal >= 0',
      "purpose IN ('cover', 'concept_explanation', 'data_visualization', 'screenshot', 'example', 'decorative', 'unknown')",
      "purpose_origin IN ('source_statement', 'deterministic_parser', 'ai_inference', 'user_confirmation', 'unknown')",
      "confidence IS NULL OR (purpose_origin = 'ai_inference' AND confidence >= 0 AND confidence <= 1)",
      'superseded_usage_id IS NULL OR superseded_usage_id <> media_usage_id',
    ),
  };

let sql = '';
let ddl: SourceEvidenceDdlShape;

beforeAll(async () => {
  sql = await readFile(MIGRATION_URL, {encoding: 'utf8'});
  ddl = analyzeSourceEvidenceDdl(sql);
});

describe('000002 source-evidence migration static contract', () => {
  it('states the static-only boundary without claiming PostgreSQL acceptance or execution', () => {
    expect(STATIC_TEST_SCOPE).toContain('static SQL text audit only');
    expect(STATIC_TEST_SCOPE).toContain(
      'does not parse with or execute PostgreSQL',
    );
  });

  it('defines exactly the eleven material tables independent of declaration order', () => {
    expect(sorted(ddl.tables.keys())).toEqual(sorted(EXPECTED_TABLES));
  });

  it('defines every material column with its type, nullability, and relevant default independent of column order', () => {
    for (const tableName of EXPECTED_TABLES) {
      const table = requiredTable(ddl, tableName);
      expect(sortedRecord(table.columns)).toEqual(
        sortedRecord(new Map(Object.entries(EXPECTED_COLUMNS[tableName]))),
      );
    }
  });

  it('defines the material primary and unique keys as order-independent sets while preserving key column order', () => {
    for (const tableName of EXPECTED_TABLES) {
      const actualKeys = keysIncludingUniqueIndexes(ddl, tableName);
      expect(sorted(actualKeys)).toEqual(sorted(EXPECTED_KEYS[tableName]));
      for (const key of actualKeys) {
        expect(key.split('|')[1]?.split(',')[0]).toBe('workspace_id');
      }
    }
  });

  it('defines all workspace-first composite foreign keys including exact Blob and Fragment context bindings', () => {
    for (const tableName of EXPECTED_TABLES) {
      const table = requiredTable(ddl, tableName);
      expect(
        sorted(
          [...table.foreignKeys].map((foreignKey) =>
            normalizeForeignKeyMatchForContract(foreignKey, table.columns),
          ),
        ),
      ).toEqual(sorted(EXPECTED_FOREIGN_KEYS[tableName]));
      for (const foreignKey of table.foreignKeys) {
        const [, localColumns, , targetColumns] = foreignKey.split('|');
        expect(localColumns?.split(',')[0]).toBe('workspace_id');
        expect(targetColumns?.split(',')[0]).toBe('workspace_id');
      }
    }
  });

  it('matches complete material CHECK expressions as order-independent sets without depending on constraint names', () => {
    for (const tableName of EXPECTED_TABLES) {
      const table = requiredTable(ddl, tableName);
      expect(sorted(table.checks.map(checkFingerprint))).toEqual(
        sorted(EXPECTED_CHECKS[tableName]),
      );
    }
  });

  it('uses application-provided UUIDs and append-only row shapes', () => {
    for (const tableName of EXPECTED_TABLES) {
      const table = requiredTable(ddl, tableName);
      expect(table.columns.has('updated_at')).toBe(false);
      for (const column of table.columns.values()) {
        if (column.type === 'uuid') {
          expect(column.defaultExpression).toBeUndefined();
        }
      }
    }
  });

  it('contains no real forbidden cascade, mutation, seed, raw-byte, JSON, role, grant, extension, trigger, or vendor operation', () => {
    expect(findForbiddenSqlOperations(sql)).toEqual([]);
  });

  it('fails the contract audit when the repository path CHECK loses PostgreSQL escape-string semantics', () => {
    const escapedPathExpression = String.raw`position(E'\\' IN repository_relative_path)`;
    const ordinaryPathExpression = String.raw`position('\\' IN repository_relative_path)`;

    expect(sql.split(escapedPathExpression)).toHaveLength(2);
    expect(
      checkFingerprint(tokenizeSourceEvidenceSql(escapedPathExpression)),
    ).not.toBe(
      checkFingerprint(tokenizeSourceEvidenceSql(ordinaryPathExpression)),
    );

    const mutated = sql.replace(escapedPathExpression, ordinaryPathExpression);
    const mutatedChecks = requiredTable(
      analyzeSourceEvidenceDdl(mutated),
      'git_resource',
    ).checks.map(checkFingerprint);
    expect(sorted(mutatedChecks)).not.toEqual(
      sorted(EXPECTED_CHECKS.git_resource),
    );
  });

  it('allows workspace-first lookup indexes while requiring unique indexes to match an authorized unique identity', () => {
    for (const index of ddl.indexes) {
      expect(index.table.startsWith('struinfo.')).toBe(true);
      expect(index.columns[0]).toBe('workspace_id');
      expect(
        EXPECTED_TABLES.includes(
          index.table.slice('struinfo.'.length) as EvidenceTableName,
        ),
      ).toBe(true);
      if (index.unique) {
        const tableName = index.table.slice(
          'struinfo.'.length,
        ) as EvidenceTableName;
        expect(EXPECTED_KEYS[tableName]).toContain(
          keyFingerprint('unique', index.columns),
        );
      }
    }
  });
});

describe('task-specific SQL lexical helper', () => {
  it('ignores forbidden-looking words in comments and every supported SQL string form', () => {
    const synthetic = String.raw`
      -- DROP TABLE; DELETE; jsonb; bytea
      /* outer DROP /* nested DELETE */ GRANT */
      CREATE TABLE struinfo.sample (
        workspace_id uuid NOT NULL,
        note text,
        CONSTRAINT sample_pk PRIMARY KEY (workspace_id),
        CONSTRAINT sample_words_ck CHECK (
          note <> 'DROP DELETE jsonb bytea'
          AND note <> E'GRANT\\TRIGGER'
          AND note <> $$CREATE ROLE; ON DELETE CASCADE$$
          AND note <> $tag$CREATE EXTENSION; INSERT$tag$
        )
      );
    `;
    expect(findForbiddenSqlOperations(synthetic)).toEqual([]);
    expect(analyzeSourceEvidenceDdl(synthetic).tables.has('sample')).toBe(true);
  });

  it('detects real forbidden tokens rather than comment or string contents', () => {
    expect(findForbiddenSqlOperations('DROP TABLE struinfo.sample;')).toEqual([
      'statement:drop',
    ]);
    expect(
      findForbiddenSqlOperations(
        'CREATE TABLE struinfo.sample (payload jsonb NOT NULL);',
      ),
    ).toEqual(['column_type:jsonb']);
    expect(
      findForbiddenSqlOperations(
        'CREATE TABLE struinfo.sample (workspace_id uuid, FOREIGN KEY (workspace_id) REFERENCES struinfo.workspace (workspace_id) ON DELETE CASCADE);',
      ),
    ).toEqual(['foreign_key:on_delete_cascade']);
  });

  it('does not treat constraint or index names as forbidden SQL types or vendor targets', () => {
    const synthetic = `
      CREATE TABLE struinfo.sample (
        workspace_id uuid NOT NULL,
        CONSTRAINT jsonb CHECK (workspace_id IS NOT NULL)
      );
      CREATE INDEX pgboss ON struinfo.sample (workspace_id);
    `;
    expect(findForbiddenSqlOperations(synthetic)).toEqual([]);
    expect(analyzeSourceEvidenceDdl(synthetic).indexes).toHaveLength(1);
  });

  it('keeps the complete boolean CHECK structure so TRUE OR cannot satisfy a required expression', () => {
    const requiredDigest = checkFingerprint(
      tokenizeSourceEvidenceSql("digest ~ '^[0-9a-f]{64}$'"),
    );
    const weakenedDigest = checkFingerprint(
      tokenizeSourceEvidenceSql("TRUE OR digest ~ '^[0-9a-f]{64}$'"),
    );
    expect(weakenedDigest).not.toBe(requiredDigest);
  });

  it('does not derive NOT NULL from a table CHECK expression', () => {
    const shape = analyzeSourceEvidenceDdl(`
      CREATE TABLE struinfo.sample (
        required_value text,
        CHECK (TRUE OR required_value IS NOT NULL)
      );
    `);
    expect(
      requiredTable(shape, 'sample').columns.get('required_value'),
    ).toEqual(optional('text'));
  });

  it('terminates DEFAULT at the next top-level constraint regardless of declaration order', () => {
    const defaultFirst = analyzeSourceEvidenceDdl(`
      CREATE TABLE struinfo.sample (
        created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
      );
    `);
    const notNullFirst = analyzeSourceEvidenceDdl(`
      CREATE TABLE struinfo.sample (
        created_at timestamp with time zone NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
    `);

    expect(normalizeDdlShape(defaultFirst)).toEqual(
      normalizeDdlShape(notNullFirst),
    );
    expect(
      requiredTable(defaultFirst, 'sample').columns.get('created_at'),
    ).toEqual(REQUIRED_TIMESTAMP_DEFAULT);
  });

  it.each([
    ['CHECK', 'value text CHECK (TRUE OR value IS NOT NULL)'],
    ['REFERENCES', 'value uuid REFERENCES struinfo.parent (workspace_id)'],
    ['PRIMARY KEY', 'value uuid PRIMARY KEY'],
    ['UNIQUE', 'value text UNIQUE'],
    ['CONSTRAINT', 'value text CONSTRAINT sample_value_ck CHECK (TRUE)'],
  ])(
    'fails closed instead of dropping an inline %s constraint',
    (_, column) => {
      expect(() =>
        analyzeSourceEvidenceDdl(`CREATE TABLE struinfo.sample (${column});`),
      ).toThrow(SourceEvidenceSqlLexicalError);
    },
  );

  it('fails the forbidden-operation audit closed for inline REFERENCES with ON DELETE CASCADE', () => {
    const inlineCascade = `
      CREATE TABLE struinfo.child (
        parent_id uuid REFERENCES struinfo.parent (parent_id) ON DELETE CASCADE
      );
    `;
    expect(() => analyzeSourceEvidenceDdl(inlineCascade)).toThrow(
      SourceEvidenceSqlLexicalError,
    );
    expect(() => findForbiddenSqlOperations(inlineCascade)).toThrow(
      SourceEvidenceSqlLexicalError,
    );
  });

  it('allows CREATE INDEX and MATCH FULL because the source-evidence contract does not ban either', () => {
    const synthetic = `
      CREATE TABLE struinfo.parent (
        workspace_id uuid NOT NULL,
        parent_id uuid NOT NULL,
        PRIMARY KEY (workspace_id, parent_id)
      );
      CREATE TABLE struinfo.child (
        workspace_id uuid NOT NULL,
        parent_id uuid NOT NULL,
        FOREIGN KEY (workspace_id, parent_id)
          REFERENCES struinfo.parent (workspace_id, parent_id) MATCH FULL
      );
      CREATE INDEX child_lookup ON struinfo.child (workspace_id, parent_id);
    `;
    const shape = analyzeSourceEvidenceDdl(synthetic);
    expect(findForbiddenSqlOperations(synthetic)).toEqual([]);
    expect(shape.indexes).toEqual([
      {
        table: 'struinfo.child',
        columns: ['workspace_id', 'parent_id'],
        unique: false,
      },
    ]);
    expect(shape.tables.get('child')?.foreignKeys).toContain(
      foreignKeyFingerprint(
        ['workspace_id', 'parent_id'],
        'struinfo.parent',
        ['workspace_id', 'parent_id'],
        {match: 'full'},
      ),
    );
    const child = shape.tables.get('child');
    expect(child).toBeDefined();
    if (child === undefined) {
      throw new Error('Synthetic child table is missing.');
    }
    expect(
      [...child.foreignKeys].map((foreignKey) =>
        normalizeForeignKeyMatchForContract(foreignKey, child.columns),
      ),
    ).toContain(
      foreignKeyFingerprint(['workspace_id', 'parent_id'], 'struinfo.parent', [
        'workspace_id',
        'parent_id',
      ]),
    );
  });

  it('retains MATCH FULL as material when a composite foreign key mixes required and optional local columns', () => {
    const shape = analyzeSourceEvidenceDdl(`
      CREATE TABLE struinfo.parent (
        workspace_id uuid NOT NULL,
        parent_id uuid NOT NULL,
        PRIMARY KEY (workspace_id, parent_id)
      );
      CREATE TABLE struinfo.child (
        workspace_id uuid NOT NULL,
        parent_id uuid,
        FOREIGN KEY (workspace_id, parent_id)
          REFERENCES struinfo.parent (workspace_id, parent_id) MATCH FULL
      );
    `);
    const child = shape.tables.get('child');
    expect(child).toBeDefined();
    if (child === undefined) {
      throw new Error('Synthetic child table is missing.');
    }
    const full = foreignKeyFingerprint(
      ['workspace_id', 'parent_id'],
      'struinfo.parent',
      ['workspace_id', 'parent_id'],
      {match: 'full'},
    );
    expect(normalizeForeignKeyMatchForContract(full, child.columns)).toBe(full);
  });

  it('treats table, column, and constraint declaration order and constraint names as non-semantic', () => {
    const first = analyzeSourceEvidenceDdl(`
      CREATE TABLE struinfo.alpha (
        workspace_id uuid NOT NULL,
        alpha_id uuid NOT NULL,
        CONSTRAINT alpha_old_pk PRIMARY KEY (workspace_id, alpha_id),
        CONSTRAINT alpha_old_ck CHECK (alpha_id IS NOT NULL)
      );
      CREATE TABLE struinfo.beta (
        workspace_id uuid NOT NULL,
        alpha_id uuid NOT NULL,
        CONSTRAINT beta_old_fk FOREIGN KEY (workspace_id, alpha_id)
          REFERENCES struinfo.alpha (workspace_id, alpha_id)
      );
    `);
    const reorderedAndRenamed = analyzeSourceEvidenceDdl(`
      CREATE TABLE struinfo.beta (
        CONSTRAINT beta_new_fk FOREIGN KEY (workspace_id, alpha_id)
          REFERENCES struinfo.alpha (workspace_id, alpha_id),
        alpha_id uuid NOT NULL,
        workspace_id uuid NOT NULL
      );
      CREATE TABLE struinfo.alpha (
        CONSTRAINT alpha_new_ck CHECK (alpha_id IS NOT NULL),
        CONSTRAINT alpha_new_pk PRIMARY KEY (workspace_id, alpha_id),
        alpha_id uuid NOT NULL,
        workspace_id uuid NOT NULL
      );
    `);
    expect(normalizeDdlShape(reorderedAndRenamed)).toEqual(
      normalizeDdlShape(first),
    );
  });

  it('preserves internal primary, unique, and foreign-key column order as semantic', () => {
    expect(
      keyFingerprint('primary_key', ['workspace_id', 'resource_id']),
    ).not.toBe(keyFingerprint('primary_key', ['resource_id', 'workspace_id']));
    expect(keyFingerprint('unique', ['workspace_id', 'source_key'])).not.toBe(
      keyFingerprint('unique', ['source_key', 'workspace_id']),
    );
    expect(
      foreignKeyFingerprint(
        ['workspace_id', 'resource_id'],
        'struinfo.resource',
        ['workspace_id', 'resource_id'],
      ),
    ).not.toBe(
      foreignKeyFingerprint(
        ['resource_id', 'workspace_id'],
        'struinfo.resource',
        ['workspace_id', 'resource_id'],
      ),
    );
  });

  it('surfaces CREATE UNIQUE INDEX as uniqueness instead of treating it as an ordinary lookup index', () => {
    const shape = analyzeSourceEvidenceDdl(`
      CREATE TABLE struinfo.sample (
        workspace_id uuid NOT NULL,
        storage_mode text NOT NULL
      );
      CREATE UNIQUE INDEX sample_mode_uq
        ON struinfo.sample (workspace_id, storage_mode);
    `);
    expect(keysIncludingUniqueIndexes(shape, 'sample')).toContain(
      keyFingerprint('unique', ['workspace_id', 'storage_mode']),
    );
  });

  it.each([
    "CREATE TABLE struinfo.bad (value text CHECK (value <> 'unterminated));",
    'CREATE TABLE struinfo.bad (value text); /* unterminated',
    'CREATE TABLE struinfo.bad (value text CHECK (value <> $tag$unterminated));',
    'CREATE TABLE struinfo.bad (value text;',
  ])('fails closed for malformed or incomplete SQL: %s', (malformed) => {
    expect(() => analyzeSourceEvidenceDdl(malformed)).toThrow(
      SourceEvidenceSqlLexicalError,
    );
  });
});

function required(type: string, defaultExpression?: string): SqlColumnShape {
  return {
    type,
    nullable: false,
    ...(defaultExpression === undefined ? {} : {defaultExpression}),
  };
}

function optional(type: string): SqlColumnShape {
  return {type, nullable: true};
}

function workspaceForeignKey(): string {
  return foreignKeyFingerprint(['workspace_id'], 'struinfo.workspace', [
    'workspace_id',
  ]);
}

function checks(...expressions: readonly string[]): readonly string[] {
  return expressions.map((expression) =>
    checkFingerprint(tokenizeSourceEvidenceSql(expression)),
  );
}

function requiredTable(
  shape: SourceEvidenceDdlShape,
  name: string,
): Readonly<SqlTableShape> {
  const table = shape.tables.get(name);
  expect(table, `missing parsed table ${name}`).toBeDefined();
  if (table === undefined) {
    throw new Error(`Missing parsed table ${name}.`);
  }
  return table;
}

function sorted(values: Iterable<string>): readonly string[] {
  return [...values].sort((left, right) => left.localeCompare(right, 'en'));
}

function keysIncludingUniqueIndexes(
  shape: SourceEvidenceDdlShape,
  tableName: string,
): ReadonlySet<string> {
  const table = shape.tables.get(tableName);
  if (table === undefined) {
    throw new Error(`Missing table ${tableName}.`);
  }
  const keys = new Set(table.keys);
  for (const index of shape.indexes) {
    if (index.unique && index.table === `struinfo.${tableName}`) {
      keys.add(keyFingerprint('unique', index.columns));
    }
  }
  return keys;
}

function sortedRecord(
  columns: ReadonlyMap<string, Readonly<SqlColumnShape>>,
): Readonly<Record<string, Readonly<SqlColumnShape>>> {
  return Object.fromEntries(
    [...columns.entries()].sort(([left], [right]) =>
      left.localeCompare(right, 'en'),
    ),
  );
}

function normalizeDdlShape(shape: SourceEvidenceDdlShape): unknown {
  return Object.fromEntries(
    [...shape.tables.entries()]
      .sort(([left], [right]) => left.localeCompare(right, 'en'))
      .map(([name, table]) => [
        name,
        {
          columns: sortedRecord(table.columns),
          keys: sorted(table.keys),
          foreignKeys: sorted(table.foreignKeys),
          checks: table.checks.map(checkFingerprint).sort(),
        },
      ]),
  );
}
