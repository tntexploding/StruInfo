import {readFile} from 'node:fs/promises';

import {beforeAll, describe, expect, it} from 'vitest';

const MIGRATION_URL = new URL(
  '../../../migrations/000004_create_manual_knowledge_core.sql',
  import.meta.url,
);

const STATIC_SCOPE =
  'Backend static SQL audit only; this does not parse with or execute PostgreSQL.';

const TABLES = [
  'knowledge_change_set',
  'knowledge_item',
  'knowledge_revision',
  'knowledge_relation',
  'knowledge_relation_revision',
  'knowledge_change_operation',
  'knowledge_revision_fragment_input',
  'knowledge_revision_item_input',
  'knowledge_revision_relation_input',
  'relation_revision_fragment_input',
  'relation_revision_item_input',
  'relation_revision_relation_input',
  'knowledge_change_event',
] as const;

type TableName = (typeof TABLES)[number];

const REQUIRED_COLUMNS: Readonly<Record<TableName, readonly string[]>> = {
  knowledge_change_set: [
    'workspace_id',
    'change_set_id',
    'command_idempotency_key',
    'request_sha256',
    'command_kind',
    'authority',
    'operation_origin',
    'authorization_kind',
    'target_id',
    'decision_id',
    'decision_revision',
    'decision_revision_id',
    'original_outcome',
    'operation_count',
    'created_at',
  ],
  knowledge_item: [
    'workspace_id',
    'item_id',
    'current_revision',
    'current_revision_id',
    'created_at',
  ],
  knowledge_revision: [
    'workspace_id',
    'item_id',
    'revision_id',
    'revision_number',
    'knowledge_kind',
    'epistemic_role',
    'review_state',
    'title',
    'body',
    'change_set_id',
    'operation_index',
    'previous_revision_id',
    'created_at',
  ],
  knowledge_relation: [
    'workspace_id',
    'relation_id',
    'subject_item_id',
    'relation_type_key',
    'object_item_id',
    'current_revision',
    'current_revision_id',
    'created_at',
  ],
  knowledge_relation_revision: [
    'workspace_id',
    'relation_id',
    'revision_id',
    'revision_number',
    'subject_item_id',
    'relation_type_key',
    'object_item_id',
    'epistemic_role',
    'review_state',
    'qualifier',
    'change_set_id',
    'operation_index',
    'previous_revision_id',
    'created_at',
  ],
  knowledge_change_operation: [
    'workspace_id',
    'change_set_id',
    'operation_index',
    'operation_kind',
    'item_id',
    'relation_id',
    'operation_outcome',
    'resulting_revision',
    'resulting_revision_id',
    'created_at',
  ],
  knowledge_revision_fragment_input: [
    'workspace_id',
    'item_id',
    'revision_number',
    'revision_id',
    'input_kind',
    'input_ordinal',
    'fragment_id',
    'created_at',
  ],
  knowledge_revision_item_input: [
    'workspace_id',
    'item_id',
    'revision_number',
    'revision_id',
    'input_ordinal',
    'input_item_id',
    'input_revision_number',
    'input_revision_id',
    'created_at',
  ],
  knowledge_revision_relation_input: [
    'workspace_id',
    'item_id',
    'revision_number',
    'revision_id',
    'input_ordinal',
    'input_relation_id',
    'input_revision_number',
    'input_revision_id',
    'created_at',
  ],
  relation_revision_fragment_input: [
    'workspace_id',
    'relation_id',
    'revision_number',
    'revision_id',
    'input_kind',
    'input_ordinal',
    'fragment_id',
    'created_at',
  ],
  relation_revision_item_input: [
    'workspace_id',
    'relation_id',
    'revision_number',
    'revision_id',
    'input_ordinal',
    'input_item_id',
    'input_revision_number',
    'input_revision_id',
    'created_at',
  ],
  relation_revision_relation_input: [
    'workspace_id',
    'relation_id',
    'revision_number',
    'revision_id',
    'input_ordinal',
    'input_relation_id',
    'input_revision_number',
    'input_revision_id',
    'created_at',
  ],
  knowledge_change_event: [
    'workspace_id',
    'event_id',
    'event_kind',
    'event_schema_version',
    'change_set_id',
    'created_at',
  ],
};

const REQUIRED_FOREIGN_KEYS = [
  'knowledge_change_set:workspace_id,target_id->curation_target:workspace_id,target_id',
  'knowledge_change_set:workspace_id,target_id,decision_id->intake_decision:workspace_id,target_id,decision_id',
  'knowledge_change_set:workspace_id,decision_id,decision_revision,decision_revision_id->intake_decision_revision:workspace_id,decision_id,revision_number,decision_revision_id',
  'knowledge_revision:workspace_id,item_id,previous_revision_id->knowledge_revision:workspace_id,item_id,revision_id',
  'knowledge_relation_revision:workspace_id,relation_id,previous_revision_id->knowledge_relation_revision:workspace_id,relation_id,revision_id',
  'knowledge_revision_fragment_input:workspace_id,fragment_id->fragment:workspace_id,fragment_id',
  'knowledge_revision_item_input:workspace_id,input_item_id,input_revision_number,input_revision_id->knowledge_revision:workspace_id,item_id,revision_number,revision_id',
  'knowledge_revision_relation_input:workspace_id,input_relation_id,input_revision_number,input_revision_id->knowledge_relation_revision:workspace_id,relation_id,revision_number,revision_id',
  'relation_revision_fragment_input:workspace_id,fragment_id->fragment:workspace_id,fragment_id',
  'relation_revision_item_input:workspace_id,input_item_id,input_revision_number,input_revision_id->knowledge_revision:workspace_id,item_id,revision_number,revision_id',
  'relation_revision_relation_input:workspace_id,input_relation_id,input_revision_number,input_revision_id->knowledge_relation_revision:workspace_id,relation_id,revision_number,revision_id',
  'knowledge_change_event:workspace_id,change_set_id->knowledge_change_set:workspace_id,change_set_id',
] as const;

const REQUIRED_SEMANTICS = [
  "command_kind='apply_manual_knowledge_change_set'",
  "authority='manual_user'",
  "operation_origin='manual_user'",
  "authorization_kind in('eligible_target','manual_edit')",
  "original_outcome in('applied','unchanged')",
  'operation_count>=1 and operation_count<=64',
  "knowledge_kind in('entity','concept','assertion','event','method','framework','resource','work')",
  "epistemic_role in('source_excerpt','source_claim','summary','inference','user_assertion')",
  "epistemic_role in('source_claim','summary','inference','user_assertion')",
  "review_state in('draft','pending_review','confirmed','disputed','rejected','withdrawn')",
  'subject_item_id<>object_item_id',
  "operation_kind in('put_item','put_relation')",
  "operation_outcome in('applied','unchanged')",
  "input_kind in('citation','derivation')",
  "event_kind='knowledge_change_set_committed'",
  'event_schema_version=1',
] as const;

let migrationSql = '';

beforeAll(async () => {
  migrationSql = await readFile(MIGRATION_URL, 'utf8');
});

describe('manual knowledge migration Backend static contract', () => {
  it('states the non-PostgreSQL scope explicitly', () => {
    expect(STATIC_SCOPE).toContain('does not parse with or execute PostgreSQL');
  });

  it('creates exactly the thirteen material tables and their material columns', () => {
    const audit = auditManualKnowledgeMigration(migrationSql);
    expect(audit.errors).toEqual([]);
    expect([...audit.tables.keys()].sort()).toEqual([...TABLES].sort());
    for (const table of TABLES) {
      expect(audit.tables.get(table)?.columns).toEqual(
        new Set(REQUIRED_COLUMNS[table]),
      );
    }
  });

  it('has workspace-first keys, typed provenance, exact current pointers, and one event', () => {
    const audit = auditManualKnowledgeMigration(migrationSql);
    expect(audit.errors).toEqual([]);
    expect(audit.foreignKeys).toEqual(
      expect.arrayContaining([...REQUIRED_FOREIGN_KEYS]),
    );
    expect(audit.semanticText).toContain(
      fingerprint('UNIQUE (workspace_id, change_set_id)'),
    );
    expect(audit.semanticText).toContain(
      fingerprint(
        'FOREIGN KEY (workspace_id, item_id, current_revision, current_revision_id) REFERENCES struinfo.knowledge_revision (workspace_id, item_id, revision_number, revision_id) DEFERRABLE INITIALLY DEFERRED',
      ),
    );
    expect(audit.semanticText).toContain(
      fingerprint(
        'FOREIGN KEY (workspace_id, relation_id, current_revision, current_revision_id) REFERENCES struinfo.knowledge_relation_revision (workspace_id, relation_id, revision_number, revision_id) DEFERRABLE INITIALLY DEFERRED',
      ),
    );
  });

  it('contains only the admitted upstream uniqueness addition', () => {
    const externalAlters = splitStatements(stripComments(migrationSql)).filter(
      (statement) =>
        /^alter table struinfo\.(?!knowledge_)(?!relation_revision_)/u.test(
          fingerprint(statement),
        ),
    );
    expect(externalAlters).toHaveLength(1);
    expect(fingerprint(externalAlters[0] ?? '')).toMatch(
      /^alter table struinfo\.intake_decision add constraint [a-z_][a-z0-9_]* unique\(workspace_id,target_id,decision_id\)$/u,
    );
  });

  it('rejects one-semantic weakening mutations', () => {
    const mutations: readonly [string, (sql: string) => string][] = [
      [
        'workspace-first foreign key',
        (sql) =>
          replaceOnce(
            sql,
            'CONSTRAINT knowledge_revision_fragment_input_fragment_fk\n    FOREIGN KEY (workspace_id, fragment_id)',
            'CONSTRAINT knowledge_revision_fragment_input_fragment_fk\n    FOREIGN KEY (fragment_id)',
          ),
      ],
      [
        'typed Fragment provenance target',
        (sql) =>
          replaceOnce(
            sql,
            'CONSTRAINT knowledge_revision_fragment_input_fragment_fk\n    FOREIGN KEY (workspace_id, fragment_id)\n    REFERENCES struinfo.fragment (workspace_id, fragment_id)',
            'CONSTRAINT knowledge_revision_fragment_input_fragment_fk\n    FOREIGN KEY (workspace_id, fragment_id)\n    REFERENCES struinfo.workspace (workspace_id, workspace_id)',
          ),
      ],
      [
        'no cascading history delete',
        (sql) =>
          replaceOnce(
            sql,
            'REFERENCES struinfo.curation_target (workspace_id, target_id)',
            'REFERENCES struinfo.curation_target (workspace_id, target_id) ON DELETE CASCADE',
          ),
      ],
      [
        'no arbitrary JSON payload',
        (sql) =>
          replaceOnce(
            sql,
            'event_schema_version integer NOT NULL,\n  change_set_id uuid NOT NULL,\n  created_at timestamp',
            'event_schema_version integer NOT NULL,\n  change_set_id uuid NOT NULL,\n  payload jsonb,\n  created_at timestamp',
          ),
      ],
      [
        'one event per change set',
        (sql) =>
          replaceOnce(
            sql,
            'UNIQUE (workspace_id, change_set_id)',
            'UNIQUE (workspace_id, event_id)',
          ),
      ],
      [
        'relation self-edge check',
        (sql) =>
          replaceOnce(
            sql,
            'CONSTRAINT knowledge_relation_not_self_ck\n    CHECK (subject_item_id <> object_item_id)',
            'CONSTRAINT knowledge_relation_not_self_ck\n    CHECK (subject_item_id = object_item_id)',
          ),
      ],
      [
        'authorization sum type',
        (sql) =>
          replaceOnce(
            sql,
            'AND target_id IS NULL',
            'AND target_id IS NOT NULL',
          ),
      ],
      [
        'upstream decision identity',
        (sql) =>
          replaceOnce(
            sql,
            'UNIQUE (workspace_id, target_id, decision_id)',
            'UNIQUE (workspace_id, decision_id)',
          ),
      ],
    ];

    for (const [name, mutate] of mutations) {
      const errors = auditManualKnowledgeMigration(mutate(migrationSql)).errors;
      expect(errors, name).not.toEqual([]);
    }
  });

  it('does not use forbidden persistence or distribution features', () => {
    const audit = auditManualKnowledgeMigration(migrationSql);
    expect(audit.errors).toEqual([]);
    expect(audit.codeText).not.toMatch(
      /\b(?:insert|update|delete|trigger|view|extension|role|grant|policy)\b/u,
    );
    expect(audit.codeText).not.toMatch(/\b(?:json|jsonb|bytea)\b/u);
    expect(audit.codeText).not.toMatch(/\bon\s+delete\s+cascade\b/u);
  });
});

interface TableAudit {
  readonly columns: ReadonlySet<string>;
  readonly statement: string;
}

interface MigrationAudit {
  readonly errors: readonly string[];
  readonly tables: ReadonlyMap<string, TableAudit>;
  readonly foreignKeys: readonly string[];
  readonly semanticText: string;
  readonly codeText: string;
}

function auditManualKnowledgeMigration(sql: string): MigrationAudit {
  const errors: string[] = [];
  let semanticSql: string;
  let codeText: string;
  try {
    semanticSql = stripComments(sql);
    codeText = stripStrings(semanticSql);
  } catch {
    return {
      errors: ['unsupported lexical form'],
      tables: new Map(),
      foreignKeys: [],
      semanticText: '',
      codeText: '',
    };
  }
  const statements = splitStatements(semanticSql);
  const tables = new Map<string, TableAudit>();
  for (const statement of statements) {
    const match =
      /^\s*create\s+table\s+struinfo\.([a-z_][a-z0-9_]*)\s*\(/iu.exec(
        statement,
      );
    if (match?.[1] === undefined) {
      continue;
    }
    const tableName = match[1].toLowerCase();
    const body = parenthesizedBody(
      statement,
      match.index + match[0].length - 1,
    );
    if (body === undefined || tables.has(tableName)) {
      errors.push(`invalid table declaration:${tableName}`);
      continue;
    }
    tables.set(tableName, {
      columns: new Set(columnNames(body)),
      statement,
    });
  }

  const actualTables = [...tables.keys()].sort();
  if (!equalStringArrays(actualTables, [...TABLES].sort())) {
    errors.push('table set mismatch');
  }
  for (const tableName of TABLES) {
    const table = tables.get(tableName);
    if (table === undefined) {
      continue;
    }
    if (!equalSets(table.columns, new Set(REQUIRED_COLUMNS[tableName]))) {
      errors.push(`column set mismatch:${tableName}`);
    }
  }

  const foreignKeys = extractForeignKeys(statements, tables);
  for (const key of extractAllKeyColumns(statements)) {
    if (key[0] !== 'workspace_id') {
      errors.push(`non-workspace-first key:${key.join(',')}`);
    }
  }
  for (const foreignKey of foreignKeys) {
    const localColumns = foreignKey.split(':')[1]?.split('->')[0]?.split(',');
    const targetColumns = foreignKey.split('->')[1]?.split(':')[1]?.split(',');
    if (
      localColumns?.[0] !== 'workspace_id' ||
      targetColumns?.[0] !== 'workspace_id'
    ) {
      errors.push(`non-workspace-first foreign key:${foreignKey}`);
    }
  }
  for (const required of REQUIRED_FOREIGN_KEYS) {
    if (!foreignKeys.includes(required)) {
      errors.push(`missing typed foreign key:${required}`);
    }
  }

  const semanticText = fingerprint(semanticSql);
  const normalizedCode = fingerprint(codeText);
  for (const required of REQUIRED_SEMANTICS) {
    if (!semanticText.includes(fingerprint(required))) {
      errors.push(`missing check:${required}`);
    }
  }
  const externalAlters = statements
    .map((statement) => fingerprint(statement))
    .filter((statement) =>
      /^alter table struinfo\.intake_decision\b/u.test(statement),
    );
  if (
    externalAlters.length !== 1 ||
    !/^alter table struinfo\.intake_decision add constraint [a-z_][a-z0-9_]* unique\(workspace_id,target_id,decision_id\)$/u.test(
      externalAlters[0] ?? '',
    )
  ) {
    errors.push('missing admitted intake decision unique identity');
  }
  if (
    !semanticText.includes(fingerprint('unique(workspace_id,change_set_id)'))
  ) {
    errors.push('missing one-event-per-change-set identity');
  }
  if (
    !semanticText.includes(
      fingerprint(
        "authorization_kind='manual_edit' and target_id is null and decision_id is null and decision_revision is null and decision_revision_id is null",
      ),
    )
  ) {
    errors.push('missing manual-edit authorization branch');
  }
  if (countOccurrences(semanticText, 'subject_item_id<>object_item_id') < 2) {
    errors.push('missing item and relation-revision self-edge checks');
  }

  if (/\b(?:insert|update|delete)\b/u.test(normalizedCode)) {
    errors.push('data mutation statement present');
  }
  if (/\b(?:json|jsonb|bytea)\b/u.test(normalizedCode)) {
    errors.push('forbidden payload type present');
  }
  if (/\bon\s+delete\s+cascade\b/u.test(normalizedCode)) {
    errors.push('cascade present');
  }
  if (
    /\bcreate\s+(?:trigger|view|extension|role|policy)\b/u.test(normalizedCode)
  ) {
    errors.push('forbidden database feature present');
  }
  if (/\bgrant\b/u.test(normalizedCode)) {
    errors.push('grant present');
  }

  return {
    errors,
    tables,
    foreignKeys,
    semanticText,
    codeText: normalizedCode,
  };
}

function stripComments(sql: string): string {
  let output = '';
  let inString = false;
  for (let index = 0; index < sql.length; index += 1) {
    const current = sql.charAt(index);
    const next = sql.charAt(index + 1);
    if (current === "'") {
      output += current;
      if (inString && next === "'") {
        output += next;
        index += 1;
      } else {
        inString = !inString;
      }
      continue;
    }
    if (inString) {
      output += current;
      continue;
    }
    if (current === '-' && next === '-') {
      const lineEnd = sql.indexOf('\n', index + 2);
      if (lineEnd === -1) {
        return output;
      }
      output += '\n';
      index = lineEnd;
      continue;
    }
    if (current === '/' && next === '*') {
      const commentEnd = sql.indexOf('*/', index + 2);
      if (commentEnd === -1) {
        throw new Error('Unclosed SQL comment.');
      }
      output += ' ';
      index = commentEnd + 1;
      continue;
    }
    if (current === '$' || current === '`') {
      throw new Error('Unsupported SQL quoting form.');
    }
    output += current;
  }
  if (inString) {
    throw new Error('Unclosed SQL string.');
  }
  return output;
}

function stripStrings(sql: string): string {
  let output = '';
  for (let index = 0; index < sql.length; index += 1) {
    const current = sql.charAt(index);
    if (current !== "'") {
      output += current;
      continue;
    }
    output += ' ';
    let closed = false;
    for (index += 1; index < sql.length; index += 1) {
      if (sql[index] !== "'") {
        output += sql[index] === '\n' ? '\n' : ' ';
        continue;
      }
      if (sql[index + 1] === "'") {
        output += '  ';
        index += 1;
        continue;
      }
      output += ' ';
      closed = true;
      break;
    }
    if (!closed) {
      throw new Error('Unclosed SQL string.');
    }
  }
  return output;
}

function splitStatements(sql: string): readonly string[] {
  const statements: string[] = [];
  let start = 0;
  let inString = false;
  for (let index = 0; index < sql.length; index += 1) {
    const current = sql[index];
    if (current === "'") {
      if (inString && sql[index + 1] === "'") {
        index += 1;
      } else {
        inString = !inString;
      }
    } else if (current === ';' && !inString) {
      const statement = sql.slice(start, index).trim();
      if (statement.length > 0) {
        statements.push(statement);
      }
      start = index + 1;
    }
  }
  if (inString || sql.slice(start).trim().length > 0) {
    throw new Error('Migration has an unterminated statement.');
  }
  return statements;
}

function parenthesizedBody(
  statement: string,
  openIndex: number,
): string | undefined {
  let depth = 0;
  let inString = false;
  for (let index = openIndex; index < statement.length; index += 1) {
    const current = statement[index];
    if (current === "'") {
      if (inString && statement[index + 1] === "'") {
        index += 1;
      } else {
        inString = !inString;
      }
      continue;
    }
    if (inString) {
      continue;
    }
    if (current === '(') {
      depth += 1;
    } else if (current === ')') {
      depth -= 1;
      if (depth === 0) {
        return statement.slice(openIndex + 1, index);
      }
    }
  }
  return undefined;
}

function splitTopLevel(value: string): readonly string[] {
  const parts: string[] = [];
  let start = 0;
  let depth = 0;
  let inString = false;
  for (let index = 0; index < value.length; index += 1) {
    const current = value[index];
    if (current === "'") {
      if (inString && value[index + 1] === "'") {
        index += 1;
      } else {
        inString = !inString;
      }
    } else if (!inString && current === '(') {
      depth += 1;
    } else if (!inString && current === ')') {
      depth -= 1;
    } else if (!inString && current === ',' && depth === 0) {
      parts.push(value.slice(start, index).trim());
      start = index + 1;
    }
  }
  parts.push(value.slice(start).trim());
  return parts;
}

function columnNames(body: string): readonly string[] {
  const columns: string[] = [];
  for (const part of splitTopLevel(body)) {
    if (
      /^(?:constraint|primary\s+key|unique|foreign\s+key|check)\b/iu.test(part)
    ) {
      continue;
    }
    const column = /^([a-z_][a-z0-9_]*)\s+/iu.exec(part)?.[1];
    if (column === undefined) {
      throw new Error(`Unsupported column declaration: ${part}`);
    }
    columns.push(column.toLowerCase());
  }
  return columns;
}

function extractForeignKeys(
  statements: readonly string[],
  tables: ReadonlyMap<string, TableAudit>,
): readonly string[] {
  const results: string[] = [];
  for (const statement of statements) {
    const normalized = fingerprint(statement);
    const altered = /^alter table struinfo\.([a-z_][a-z0-9_]*)/u.exec(
      normalized,
    )?.[1];
    const created = /^create table struinfo\.([a-z_][a-z0-9_]*)/u.exec(
      normalized,
    )?.[1];
    const owner = altered ?? created;
    if (owner === undefined || !tables.has(owner)) {
      continue;
    }
    const pattern =
      /foreign key\(([^)]*)\)references struinfo\.([a-z_][a-z0-9_]*)\(([^)]*)\)/gu;
    for (const match of normalized.matchAll(pattern)) {
      const local = normalizeColumns(match[1]);
      const target = match[2];
      const remote = normalizeColumns(match[3]);
      if (local === undefined || target === undefined || remote === undefined) {
        throw new Error('Unsupported foreign key declaration.');
      }
      results.push(
        `${owner}:${local.join(',')}->${target}:${remote.join(',')}`,
      );
    }
  }
  return results;
}

function extractAllKeyColumns(
  statements: readonly string[],
): readonly string[][] {
  const results: string[][] = [];
  for (const statement of statements) {
    const normalized = fingerprint(statement);
    for (const match of normalized.matchAll(
      /(?:primary key|unique)\(([^)]*)\)/gu,
    )) {
      const columns = normalizeColumns(match[1]);
      if (columns === undefined) {
        throw new Error('Unsupported key declaration.');
      }
      results.push(columns);
    }
    const index =
      /^create(?: unique)? index [a-z_][a-z0-9_]* on struinfo\.[a-z_][a-z0-9_]*\(([^)]*)\)/u.exec(
        normalized,
      );
    if (index?.[1] !== undefined) {
      const columns = normalizeColumns(index[1]);
      if (columns === undefined) {
        throw new Error('Unsupported index declaration.');
      }
      results.push(columns);
    }
  }
  return results;
}

function normalizeColumns(value: string | undefined): string[] | undefined {
  if (value === undefined) {
    return undefined;
  }
  const columns = value.split(',').map((column) => column.trim());
  return columns.every((column) => /^[a-z_][a-z0-9_]*$/u.test(column))
    ? columns
    : undefined;
}

function fingerprint(value: string): string {
  return value
    .toLowerCase()
    .replace(/\s+/gu, ' ')
    .replace(/\s*([(),=<>])\s*/gu, '$1')
    .trim();
}

function equalSets(
  left: ReadonlySet<string>,
  right: ReadonlySet<string>,
): boolean {
  return (
    left.size === right.size && [...left].every((value) => right.has(value))
  );
}

function equalStringArrays(
  left: readonly string[],
  right: readonly string[],
): boolean {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

function replaceOnce(sql: string, before: string, after: string): string {
  const first = sql.indexOf(before);
  if (first === -1 || sql.includes(before, first + before.length)) {
    throw new Error(`Mutation target is not unique: ${before}`);
  }
  return `${sql.slice(0, first)}${after}${sql.slice(first + before.length)}`;
}

function countOccurrences(value: string, needle: string): number {
  let count = 0;
  let start = 0;
  let found = value.indexOf(needle, start);
  while (found !== -1) {
    count += 1;
    start = found + needle.length;
    found = value.indexOf(needle, start);
  }
  return count;
}
