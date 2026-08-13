import {readFile} from 'node:fs/promises';

import {beforeAll, describe, expect, it} from 'vitest';

import {
  analyzeManualCurationDdl,
  checkFingerprint,
  findForbiddenManualCurationSql,
  foreignKeyFingerprint,
  keyFingerprint,
  type ManualCurationDdlShape,
  type ManualCurationTableShape,
  predicateFingerprint,
} from '../../../test_support/manual_curation_sql_lexical.js';

const MIGRATION_URL = new URL(
  '../../../migrations/000003_create_manual_curation_schema.sql',
  import.meta.url,
);

const STATIC_SCOPE =
  'This is a static SQL text audit only; it does not parse with or execute PostgreSQL.';

const TABLES = [
  'curation_target',
  'vocabulary_term',
  'vocabulary_term_revision',
  'classification_assignment',
  'classification_assignment_revision',
  'intake_decision',
  'intake_decision_revision',
  'intake_decision_reason',
  'assessment',
  'assessment_revision',
  'curation_command',
] as const;

type TableName = (typeof TABLES)[number];

const REQUIRED_COLUMNS: Readonly<Record<TableName, readonly string[]>> = {
  curation_target: [
    'workspace_id',
    'target_id',
    'target_kind',
    'resource_id',
    'snapshot_id',
    'fragment_id',
    'current_version',
    'created_at',
  ],
  vocabulary_term: [
    'workspace_id',
    'term_id',
    'current_revision',
    'current_term_revision_id',
    'created_at',
  ],
  vocabulary_term_revision: [
    'workspace_id',
    'term_id',
    'term_revision_id',
    'revision_number',
    'display_name',
    'description',
    'parent_term_id',
    'lifecycle',
    'created_at',
  ],
  classification_assignment: [
    'workspace_id',
    'assignment_id',
    'target_id',
    'term_id',
    'current_revision',
    'current_assignment_revision_id',
    'created_at',
  ],
  classification_assignment_revision: [
    'workspace_id',
    'assignment_id',
    'assignment_revision_id',
    'revision_number',
    'assignment_state',
    'term_id',
    'term_revision_number',
    'term_revision_id',
    'created_at',
  ],
  intake_decision: [
    'workspace_id',
    'decision_id',
    'target_id',
    'current_revision',
    'current_decision_revision_id',
    'created_at',
  ],
  intake_decision_revision: [
    'workspace_id',
    'decision_id',
    'decision_revision_id',
    'revision_number',
    'intake_action',
    'note',
    'created_at',
  ],
  intake_decision_reason: [
    'workspace_id',
    'decision_id',
    'decision_revision_id',
    'reason_ordinal',
    'reason_code',
    'created_at',
  ],
  assessment: [
    'workspace_id',
    'assessment_id',
    'target_id',
    'dimension',
    'current_revision',
    'current_assessment_revision_id',
    'created_at',
  ],
  assessment_revision: [
    'workspace_id',
    'assessment_id',
    'assessment_revision_id',
    'revision_number',
    'assessment_state',
    'score',
    'note',
    'created_at',
  ],
  curation_command: [
    'workspace_id',
    'command_idempotency_key',
    'request_sha256',
    'command_kind',
    'authority',
    'target_id',
    'term_id',
    'outcome',
    'resulting_version',
    'created_at',
  ],
};

const MATERIAL_CHECKS: Readonly<Partial<Record<TableName, readonly string[]>>> =
  {
    curation_target: [
      "target_kind IN ('snapshot', 'fragment')",
      "(target_kind = 'snapshot' AND resource_id IS NOT NULL AND snapshot_id IS NOT NULL AND fragment_id IS NULL) OR (target_kind = 'fragment' AND resource_id IS NULL AND snapshot_id IS NULL AND fragment_id IS NOT NULL)",
      'current_version >= 0',
    ],
    vocabulary_term: ['current_revision >= 1'],
    vocabulary_term_revision: [
      'revision_number >= 1',
      "btrim(display_name) <> ''",
      "description IS NULL OR btrim(description) <> ''",
      "lifecycle IN ('active', 'retired')",
      'parent_term_id IS NULL OR parent_term_id <> term_id',
    ],
    classification_assignment: ['current_revision >= 1'],
    classification_assignment_revision: [
      'revision_number >= 1',
      "assignment_state IN ('assigned', 'removed')",
    ],
    intake_decision: ['current_revision >= 1'],
    intake_decision_revision: [
      'revision_number >= 1',
      "intake_action IN ('full', 'split', 'condense', 'source_only', 'ignore', 'needs_review')",
      "note IS NULL OR btrim(note) <> ''",
    ],
    intake_decision_reason: [
      'reason_ordinal >= 0 AND reason_ordinal < 10',
      "reason_code IN ('already_known', 'low_information_value', 'high_noise_or_marketing', 'unreliable_source', 'insufficient_evidence', 'temporarily_not_needed', 'not_interested', 'worth_exploring', 'recommendation_direction_right_sample_wrong', 'other')",
    ],
    assessment_revision: [
      'revision_number >= 1',
      "assessment_state IN ('rated', 'cleared')",
      "(assessment_state = 'rated' AND score IS NOT NULL AND score >= 0 AND score <= 4 AND (note IS NULL OR btrim(note) <> '')) OR (assessment_state = 'cleared' AND score IS NULL AND note IS NULL)",
    ],
    assessment: [
      "dimension IN ('information_density', 'breadth', 'depth', 'novelty', 'current_interest', 'neighborhood_expansion', 'cross_domain_connection', 'foundational_gap', 'emerging_signal', 'viewpoint_source_diversity', 'serendipity', 'noise_marketing', 'cognitive_cost', 'traceability', 'source_reliability', 'extraction_confidence', 'identity_confidence', 'corroboration', 'freshness')",
      'current_revision >= 1',
    ],
    curation_command: [
      "request_sha256 ~ '^[0-9a-f]{64}$'",
      "command_idempotency_key ~ '^[A-Za-z0-9._:-]{1,200}$'",
      "command_kind IN ('put_content_classification_term', 'apply_manual_curation')",
      "authority = 'manual_user'",
      "(command_kind = 'put_content_classification_term' AND term_id IS NOT NULL AND target_id IS NULL) OR (command_kind = 'apply_manual_curation' AND target_id IS NOT NULL AND term_id IS NULL)",
      "outcome IN ('applied', 'unchanged')",
      "resulting_version >= 0 AND (outcome <> 'applied' OR resulting_version >= 1) AND (command_kind <> 'put_content_classification_term' OR resulting_version >= 1)",
    ],
  };

const NULLABLE_COLUMNS: Readonly<
  Partial<Record<TableName, readonly string[]>>
> = {
  curation_target: ['resource_id', 'snapshot_id', 'fragment_id'],
  vocabulary_term_revision: ['description', 'parent_term_id'],
  intake_decision_revision: ['note'],
  assessment_revision: ['score', 'note'],
  curation_command: ['target_id', 'term_id'],
};

const REQUIRED_PRIMARY_KEYS: Readonly<Record<TableName, readonly string[]>> = {
  curation_target: ['workspace_id,target_id'],
  vocabulary_term: ['workspace_id,term_id'],
  vocabulary_term_revision: ['workspace_id,term_id,term_revision_id'],
  classification_assignment: ['workspace_id,assignment_id'],
  classification_assignment_revision: [
    'workspace_id,assignment_id,assignment_revision_id',
  ],
  intake_decision: ['workspace_id,decision_id'],
  intake_decision_revision: ['workspace_id,decision_id,decision_revision_id'],
  intake_decision_reason: [
    'workspace_id,decision_id,decision_revision_id,reason_ordinal',
  ],
  assessment: ['workspace_id,assessment_id'],
  assessment_revision: ['workspace_id,assessment_id,assessment_revision_id'],
  curation_command: ['workspace_id,command_idempotency_key'],
};

const REQUIRED_UNIQUE_KEYS: Readonly<Record<TableName, readonly string[]>> = {
  curation_target: [],
  vocabulary_term: [
    'workspace_id,term_id,current_revision,current_term_revision_id',
  ],
  vocabulary_term_revision: [
    'workspace_id,term_id,revision_number',
    'workspace_id,term_id,revision_number,term_revision_id',
  ],
  classification_assignment: [
    'workspace_id,target_id,term_id',
    'workspace_id,assignment_id,term_id',
    'workspace_id,assignment_id,current_revision,current_assignment_revision_id',
  ],
  classification_assignment_revision: [
    'workspace_id,assignment_id,revision_number',
    'workspace_id,assignment_id,revision_number,assignment_revision_id',
  ],
  intake_decision: [
    'workspace_id,target_id',
    'workspace_id,decision_id,current_revision,current_decision_revision_id',
  ],
  intake_decision_revision: [
    'workspace_id,decision_id,revision_number',
    'workspace_id,decision_id,revision_number,decision_revision_id',
  ],
  intake_decision_reason: [
    'workspace_id,decision_id,decision_revision_id,reason_code',
  ],
  assessment: [
    'workspace_id,target_id,dimension',
    'workspace_id,assessment_id,current_revision,current_assessment_revision_id',
  ],
  assessment_revision: [
    'workspace_id,assessment_id,revision_number',
    'workspace_id,assessment_id,revision_number,assessment_revision_id',
  ],
  curation_command: [],
};

const REQUIRED_FOREIGN_KEYS: Readonly<Record<TableName, readonly string[]>> = {
  curation_target: [
    foreignKeyFingerprint(['workspace_id'], 'struinfo.workspace', [
      'workspace_id',
    ]),
    foreignKeyFingerprint(
      ['workspace_id', 'resource_id', 'snapshot_id'],
      'struinfo.snapshot',
      ['workspace_id', 'resource_id', 'snapshot_id'],
    ),
    foreignKeyFingerprint(
      ['workspace_id', 'fragment_id'],
      'struinfo.fragment',
      ['workspace_id', 'fragment_id'],
    ),
  ],
  vocabulary_term: [
    foreignKeyFingerprint(['workspace_id'], 'struinfo.workspace', [
      'workspace_id',
    ]),
    foreignKeyFingerprint(
      [
        'workspace_id',
        'term_id',
        'current_revision',
        'current_term_revision_id',
      ],
      'struinfo.vocabulary_term_revision',
      ['workspace_id', 'term_id', 'revision_number', 'term_revision_id'],
      true,
    ),
  ],
  vocabulary_term_revision: [
    foreignKeyFingerprint(
      ['workspace_id', 'term_id'],
      'struinfo.vocabulary_term',
      ['workspace_id', 'term_id'],
    ),
    foreignKeyFingerprint(
      ['workspace_id', 'parent_term_id'],
      'struinfo.vocabulary_term',
      ['workspace_id', 'term_id'],
    ),
  ],
  classification_assignment: [
    foreignKeyFingerprint(
      ['workspace_id', 'target_id'],
      'struinfo.curation_target',
      ['workspace_id', 'target_id'],
    ),
    foreignKeyFingerprint(
      ['workspace_id', 'term_id'],
      'struinfo.vocabulary_term',
      ['workspace_id', 'term_id'],
    ),
    foreignKeyFingerprint(
      [
        'workspace_id',
        'assignment_id',
        'current_revision',
        'current_assignment_revision_id',
      ],
      'struinfo.classification_assignment_revision',
      [
        'workspace_id',
        'assignment_id',
        'revision_number',
        'assignment_revision_id',
      ],
      true,
    ),
  ],
  classification_assignment_revision: [
    foreignKeyFingerprint(
      ['workspace_id', 'assignment_id', 'term_id'],
      'struinfo.classification_assignment',
      ['workspace_id', 'assignment_id', 'term_id'],
    ),
    foreignKeyFingerprint(
      ['workspace_id', 'term_id', 'term_revision_number', 'term_revision_id'],
      'struinfo.vocabulary_term_revision',
      ['workspace_id', 'term_id', 'revision_number', 'term_revision_id'],
    ),
  ],
  intake_decision: [
    foreignKeyFingerprint(
      ['workspace_id', 'target_id'],
      'struinfo.curation_target',
      ['workspace_id', 'target_id'],
    ),
    foreignKeyFingerprint(
      [
        'workspace_id',
        'decision_id',
        'current_revision',
        'current_decision_revision_id',
      ],
      'struinfo.intake_decision_revision',
      [
        'workspace_id',
        'decision_id',
        'revision_number',
        'decision_revision_id',
      ],
      true,
    ),
  ],
  intake_decision_revision: [
    foreignKeyFingerprint(
      ['workspace_id', 'decision_id'],
      'struinfo.intake_decision',
      ['workspace_id', 'decision_id'],
    ),
  ],
  intake_decision_reason: [
    foreignKeyFingerprint(
      ['workspace_id', 'decision_id', 'decision_revision_id'],
      'struinfo.intake_decision_revision',
      ['workspace_id', 'decision_id', 'decision_revision_id'],
    ),
  ],
  assessment: [
    foreignKeyFingerprint(
      ['workspace_id', 'target_id'],
      'struinfo.curation_target',
      ['workspace_id', 'target_id'],
    ),
    foreignKeyFingerprint(
      [
        'workspace_id',
        'assessment_id',
        'current_revision',
        'current_assessment_revision_id',
      ],
      'struinfo.assessment_revision',
      [
        'workspace_id',
        'assessment_id',
        'revision_number',
        'assessment_revision_id',
      ],
      true,
    ),
  ],
  assessment_revision: [
    foreignKeyFingerprint(
      ['workspace_id', 'assessment_id'],
      'struinfo.assessment',
      ['workspace_id', 'assessment_id'],
    ),
  ],
  curation_command: [
    foreignKeyFingerprint(['workspace_id'], 'struinfo.workspace', [
      'workspace_id',
    ]),
    foreignKeyFingerprint(
      ['workspace_id', 'target_id'],
      'struinfo.curation_target',
      ['workspace_id', 'target_id'],
    ),
    foreignKeyFingerprint(
      ['workspace_id', 'term_id'],
      'struinfo.vocabulary_term',
      ['workspace_id', 'term_id'],
    ),
  ],
};

let sql = '';
let ddl: ManualCurationDdlShape;

beforeAll(async () => {
  sql = await readFile(MIGRATION_URL, {encoding: 'utf8'});
  ddl = analyzeManualCurationDdl(sql);
});

describe('000003 manual-curation migration static contract', () => {
  it('states that this is static text evidence, not PostgreSQL execution evidence', () => {
    expect(STATIC_SCOPE).toContain('static SQL text audit only');
    expect(STATIC_SCOPE).toContain('does not parse with or execute PostgreSQL');
  });

  it('defines exactly the eleven material tables independent of table order', () => {
    expect(sorted(ddl.tables.keys())).toEqual(sorted(TABLES));
  });

  it('defines each table as a closed material-column set independent of column order', () => {
    for (const tableName of TABLES) {
      const table = requiredTable(ddl, tableName);
      expect(sorted(table.columns.keys())).toEqual(
        sorted(REQUIRED_COLUMNS[tableName]),
      );
      const nullable = new Set(NULLABLE_COLUMNS[tableName] ?? []);
      for (const [columnName, column] of table.columns) {
        expect(column.type, `${tableName}.${columnName}`).toBe(
          expectedColumnType(columnName),
        );
        expect(column.nullable, `${tableName}.${columnName}`).toBe(
          nullable.has(columnName),
        );
        expect(column.defaultExpression === undefined).toBe(
          columnName !== 'created_at',
        );
        if (columnName === 'created_at') {
          expect(column.defaultExpression).toBe(
            checkFingerprint('CURRENT_TIMESTAMP'),
          );
        }
      }
    }
  });

  it('maps every material primary, unique, and foreign key as order-independent constraint sets', () => {
    for (const tableName of TABLES) {
      const table = requiredTable(ddl, tableName);
      expect(sorted(table.primaryKeys)).toEqual(
        sorted(
          REQUIRED_PRIMARY_KEYS[tableName].map((key) =>
            keyFingerprint(key.split(',')),
          ),
        ),
      );
      expect(sorted(table.uniqueKeys)).toEqual(
        sorted(
          REQUIRED_UNIQUE_KEYS[tableName].map((key) =>
            keyFingerprint(key.split(',')),
          ),
        ),
      );
      expect(sorted(table.foreignKeys)).toEqual(
        sorted(REQUIRED_FOREIGN_KEYS[tableName]),
      );
    }
  });

  it('keeps every primary, unique, foreign, and partial-index identity workspace-first', () => {
    for (const table of ddl.tables.values()) {
      for (const key of [...table.primaryKeys, ...table.uniqueKeys]) {
        expect(key.split(',')[0]).toBe('workspace_id');
      }
      for (const foreignKey of table.foreignKeys) {
        const [localColumns, targetTable, targetColumns] =
          foreignKey.split('|');
        expect(localColumns?.split(',')[0]).toBe('workspace_id');
        expect(targetColumns?.split(',')[0]).toBe('workspace_id');
        expect(targetTable?.startsWith('struinfo.')).toBe(true);
      }
    }
    for (const index of ddl.indexes) {
      expect(index.columns[0]).toBe('workspace_id');
    }
  });

  it('binds exact evidence targets, parent/current pointers, and immutable revisions through composite foreign keys', () => {
    expectForeignKey(
      ddl,
      'curation_target',
      'workspace_id,resource_id,snapshot_id|struinfo.snapshot|workspace_id,resource_id,snapshot_id|deferrable:false',
    );
    expectForeignKey(
      ddl,
      'curation_target',
      'workspace_id,fragment_id|struinfo.fragment|workspace_id,fragment_id|deferrable:false',
    );
    expectForeignKey(
      ddl,
      'vocabulary_term_revision',
      'workspace_id,parent_term_id|struinfo.vocabulary_term|workspace_id,term_id|deferrable:false',
    );
    expectForeignKey(
      ddl,
      'vocabulary_term',
      'workspace_id,term_id,current_revision,current_term_revision_id|struinfo.vocabulary_term_revision|workspace_id,term_id,revision_number,term_revision_id|deferrable:true',
    );
    expectForeignKey(
      ddl,
      'classification_assignment_revision',
      'workspace_id,term_id,term_revision_number,term_revision_id|struinfo.vocabulary_term_revision|workspace_id,term_id,revision_number,term_revision_id|deferrable:false',
    );
  });

  it('recognizes the two canonical partial unique predicates and no other partial index', () => {
    const partial = ddl.indexes.filter(
      (index) => index.predicate !== undefined,
    );
    expect(
      partial
        .map((index) => ({
          table: index.table,
          columns: index.columns.join(','),
          predicate: index.predicate,
          unique: index.unique,
        }))
        .sort((left, right) => left.columns.localeCompare(right.columns, 'en')),
    ).toEqual([
      {
        table: 'struinfo.curation_target',
        columns: 'workspace_id,fragment_id',
        predicate: predicateFingerprint("target_kind = 'fragment'"),
        unique: true,
      },
      {
        table: 'struinfo.curation_target',
        columns: 'workspace_id,resource_id,snapshot_id',
        predicate: predicateFingerprint("target_kind = 'snapshot'"),
        unique: true,
      },
    ]);
  });

  it('preserves target, lifecycle, action, reason, assessment, and command checks as semantic sets', () => {
    for (const [tableName, expected] of Object.entries(MATERIAL_CHECKS)) {
      const actual = requiredTable(ddl, tableName).checks;
      expect(sorted(actual)).toEqual(
        sorted(expected.map((expression) => checkFingerprint(expression))),
      );
    }
  });

  it('uses non-null current pointers and application-provided UUIDs without history updated_at columns', () => {
    for (const [tableName, table] of ddl.tables) {
      expect(table.columns.has('updated_at')).toBe(false);
      for (const [columnName, column] of table.columns) {
        if (columnName.startsWith('current_')) {
          expect(column.nullable, `${tableName}.${columnName}`).toBe(false);
        }
        if (column.type === 'uuid') {
          expect(column.defaultExpression).toBeUndefined();
        }
      }
    }
  });

  it('contains no cascade, JSON, raw bytes, seed DML, roles, grants, triggers, views, or vendor work', () => {
    expect(findForbiddenManualCurationSql(sql)).toEqual([]);
    expect(sql).not.toMatch(/\b(?:task|outbox|search|pgboss|pg_boss)\b/iu);
  });

  it.each([
    [
      'workspace-first target FK',
      'FOREIGN KEY (workspace_id, fragment_id)',
      'FOREIGN KEY (fragment_id)',
    ],
    [
      'lifecycle CHECK',
      "lifecycle IN ('active', 'retired')",
      "lifecycle IN ('active', 'retired', 'unknown')",
    ],
    ['target sum CHECK', 'AND fragment_id IS NULL', 'OR fragment_id IS NULL'],
    [
      'idempotency key',
      'PRIMARY KEY (workspace_id, command_idempotency_key)',
      'PRIMARY KEY (command_idempotency_key, workspace_id)',
    ],
    [
      'partial predicate',
      "WHERE target_kind = 'snapshot'",
      "WHERE target_kind IN ('snapshot', 'fragment')",
    ],
  ])(
    'fails the semantic contract after a single %s weakening',
    (_, from, to) => {
      expect(sql.split(from)).toHaveLength(2);
      const mutated = analyzeManualCurationDdl(sql.replace(from, to));
      expect(normalizeMaterialShape(mutated)).not.toEqual(
        normalizeMaterialShape(ddl),
      );
    },
  );

  it.each([
    [
      'exact term-revision binding',
      'workspace_id,\n      term_id,\n      term_revision_number,\n      term_revision_id',
      'workspace_id,\n      term_id,\n      term_revision_id,\n      term_revision_number',
    ],
    [
      'current-pointer identity',
      'workspace_id,\n    assessment_id,\n    current_revision,\n    current_assessment_revision_id',
      'workspace_id,\n    assessment_id,\n    current_assessment_revision_id,\n    current_revision',
    ],
    ['assessment rated-cleared sum', 'AND note IS NULL', 'OR note IS NULL'],
    [
      'command exact-one subject',
      'AND target_id IS NULL',
      'OR target_id IS NULL',
    ],
  ])('detects a single %s mutation', (_, from, to) => {
    expect(sql.split(from)).toHaveLength(2);
    const mutated = analyzeManualCurationDdl(sql.replace(from, to));
    expect(normalizeMaterialShape(mutated)).not.toEqual(
      normalizeMaterialShape(ddl),
    );
  });

  it('fails closed on unsupported inline constraints and SQL statement classes', () => {
    const inline = sql.replace(
      'workspace_id uuid NOT NULL,',
      'workspace_id uuid NOT NULL CHECK (workspace_id IS NOT NULL),',
    );
    expect(() => analyzeManualCurationDdl(inline)).toThrow();
    expect(() =>
      analyzeManualCurationDdl(`${sql}\nCOPY x FROM STDIN;`),
    ).toThrow();
  });
});

function requiredTable(
  shape: ManualCurationDdlShape,
  name: string,
): Readonly<ManualCurationTableShape> {
  const table = shape.tables.get(name);
  expect(table, `missing table ${name}`).toBeDefined();
  if (table === undefined) {
    throw new Error(`Missing table ${name}.`);
  }
  return table;
}

function expectForeignKey(
  shape: ManualCurationDdlShape,
  table: string,
  fingerprint: string,
): void {
  expect(requiredTable(shape, table).foreignKeys).toContain(fingerprint);
}

function normalizeMaterialShape(shape: ManualCurationDdlShape): unknown {
  return {
    tables: Object.fromEntries(
      [...shape.tables.entries()]
        .sort(([left], [right]) => left.localeCompare(right, 'en'))
        .map(([name, table]) => [
          name,
          {
            columns: Object.fromEntries(
              [...table.columns.entries()].sort(([left], [right]) =>
                left.localeCompare(right, 'en'),
              ),
            ),
            primaryKeys: sorted(table.primaryKeys),
            uniqueKeys: sorted(table.uniqueKeys),
            foreignKeys: sorted(table.foreignKeys),
            checks: sorted(table.checks),
          },
        ]),
    ),
    indexes: [...shape.indexes]
      .map((index) => ({
        table: index.table,
        columns: index.columns,
        unique: index.unique,
        predicate: index.predicate,
      }))
      .sort((left, right) => left.table.localeCompare(right.table, 'en')),
  };
}

function sorted(values: Iterable<string>): readonly string[] {
  return [...values].sort((left, right) => left.localeCompare(right, 'en'));
}

function expectedColumnType(columnName: string): string {
  if (columnName === 'created_at') {
    return 'timestamp with time zone';
  }
  if (
    [
      'current_version',
      'current_revision',
      'revision_number',
      'term_revision_number',
      'reason_ordinal',
      'score',
      'resulting_version',
    ].includes(columnName)
  ) {
    return 'integer';
  }
  return columnName === 'workspace_id' || columnName.endsWith('_id')
    ? 'uuid'
    : 'text';
}
