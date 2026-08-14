export type SqlTokenKind =
  | 'word'
  | 'quoted_identifier'
  | 'string'
  | 'e_string'
  | 'number'
  | 'punctuation'
  | 'operator';

export interface SqlToken {
  readonly kind: SqlTokenKind;
  readonly value: string;
  readonly start: number;
  readonly end: number;
}

export interface SqlFinding {
  readonly code: string;
  readonly detail: string;
  readonly table?: string;
}

interface ParsedConstraint {
  readonly kind: 'primary_key' | 'unique' | 'foreign_key' | 'check';
  readonly tokens: readonly SqlToken[];
}

interface ParsedTable {
  readonly name: string;
  readonly columns: ReadonlyMap<string, readonly SqlToken[]>;
  readonly constraints: readonly ParsedConstraint[];
}

interface ParsedIndex {
  readonly unique: boolean;
  readonly table: string;
  readonly columns: readonly string[];
  readonly predicate: readonly SqlToken[];
}

interface ParsedDocument {
  readonly tables: ReadonlyMap<string, ParsedTable>;
  readonly indexes: readonly ParsedIndex[];
  readonly externalConstraints: ReadonlyMap<
    string,
    readonly ParsedConstraint[]
  >;
  readonly findings: readonly SqlFinding[];
}

export const MANUAL_KNOWLEDGE_TABLES = Object.freeze([
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
]);

interface ColumnExpectation {
  readonly type: 'integer' | 'text' | 'timestamp with time zone' | 'uuid';
  readonly nullable: boolean;
  readonly defaultCurrentTimestamp?: boolean;
}

function required(type: ColumnExpectation['type']): ColumnExpectation {
  return {type, nullable: false};
}

function optional(type: ColumnExpectation['type']): ColumnExpectation {
  return {type, nullable: true};
}

const createdAt: ColumnExpectation = Object.freeze({
  type: 'timestamp with time zone',
  nullable: false,
  defaultCurrentTimestamp: true,
});

function columnMap(
  entries: readonly (readonly [string, ColumnExpectation])[],
): ReadonlyMap<string, ColumnExpectation> {
  return new Map(entries);
}

export const MANUAL_KNOWLEDGE_COLUMN_ORACLE: ReadonlyMap<
  string,
  ReadonlyMap<string, ColumnExpectation>
> = new Map([
  [
    'knowledge_change_set',
    columnMap([
      ['workspace_id', required('uuid')],
      ['change_set_id', required('uuid')],
      ['command_idempotency_key', required('text')],
      ['request_sha256', required('text')],
      ['command_kind', required('text')],
      ['authority', required('text')],
      ['operation_origin', required('text')],
      ['authorization_kind', required('text')],
      ['curation_target_id', optional('uuid')],
      ['decision_id', optional('uuid')],
      ['decision_revision_number', optional('integer')],
      ['decision_revision_id', optional('uuid')],
      ['original_outcome', required('text')],
      ['operation_count', required('integer')],
      ['created_at', createdAt],
    ]),
  ],
  [
    'knowledge_item',
    columnMap([
      ['workspace_id', required('uuid')],
      ['item_id', required('uuid')],
      ['current_revision', required('integer')],
      ['current_revision_id', required('uuid')],
      ['created_at', createdAt],
    ]),
  ],
  [
    'knowledge_revision',
    columnMap([
      ['workspace_id', required('uuid')],
      ['item_id', required('uuid')],
      ['revision_id', required('uuid')],
      ['revision_number', required('integer')],
      ['knowledge_kind', required('text')],
      ['epistemic_role', required('text')],
      ['review_state', required('text')],
      ['title', required('text')],
      ['body', optional('text')],
      ['change_set_id', required('uuid')],
      ['operation_index', required('integer')],
      ['previous_revision_id', optional('uuid')],
      ['created_at', createdAt],
    ]),
  ],
  [
    'knowledge_relation',
    columnMap([
      ['workspace_id', required('uuid')],
      ['relation_id', required('uuid')],
      ['subject_item_id', required('uuid')],
      ['relation_type_key', required('text')],
      ['object_item_id', required('uuid')],
      ['current_revision', required('integer')],
      ['current_revision_id', required('uuid')],
      ['created_at', createdAt],
    ]),
  ],
  [
    'knowledge_relation_revision',
    columnMap([
      ['workspace_id', required('uuid')],
      ['relation_id', required('uuid')],
      ['revision_id', required('uuid')],
      ['revision_number', required('integer')],
      ['subject_item_id', required('uuid')],
      ['relation_type_key', required('text')],
      ['object_item_id', required('uuid')],
      ['epistemic_role', required('text')],
      ['review_state', required('text')],
      ['qualifier', optional('text')],
      ['change_set_id', required('uuid')],
      ['operation_index', required('integer')],
      ['previous_revision_id', optional('uuid')],
      ['created_at', createdAt],
    ]),
  ],
  [
    'knowledge_change_operation',
    columnMap([
      ['workspace_id', required('uuid')],
      ['change_set_id', required('uuid')],
      ['operation_index', required('integer')],
      ['operation_kind', required('text')],
      ['item_id', optional('uuid')],
      ['relation_id', optional('uuid')],
      ['outcome', required('text')],
      ['resulting_revision', required('integer')],
      ['resulting_revision_id', required('uuid')],
    ]),
  ],
  [
    'knowledge_revision_fragment_input',
    columnMap([
      ['workspace_id', required('uuid')],
      ['item_id', required('uuid')],
      ['revision_id', required('uuid')],
      ['input_kind', required('text')],
      ['input_ordinal', required('integer')],
      ['fragment_id', required('uuid')],
    ]),
  ],
  [
    'knowledge_revision_item_input',
    columnMap([
      ['workspace_id', required('uuid')],
      ['item_id', required('uuid')],
      ['revision_id', required('uuid')],
      ['input_ordinal', required('integer')],
      ['input_item_id', required('uuid')],
      ['input_revision_number', required('integer')],
      ['input_revision_id', required('uuid')],
    ]),
  ],
  [
    'knowledge_revision_relation_input',
    columnMap([
      ['workspace_id', required('uuid')],
      ['item_id', required('uuid')],
      ['revision_id', required('uuid')],
      ['input_ordinal', required('integer')],
      ['input_relation_id', required('uuid')],
      ['input_revision_number', required('integer')],
      ['input_revision_id', required('uuid')],
    ]),
  ],
  [
    'relation_revision_fragment_input',
    columnMap([
      ['workspace_id', required('uuid')],
      ['relation_id', required('uuid')],
      ['revision_id', required('uuid')],
      ['input_kind', required('text')],
      ['input_ordinal', required('integer')],
      ['fragment_id', required('uuid')],
    ]),
  ],
  [
    'relation_revision_item_input',
    columnMap([
      ['workspace_id', required('uuid')],
      ['relation_id', required('uuid')],
      ['revision_id', required('uuid')],
      ['input_ordinal', required('integer')],
      ['input_item_id', required('uuid')],
      ['input_revision_number', required('integer')],
      ['input_revision_id', required('uuid')],
    ]),
  ],
  [
    'relation_revision_relation_input',
    columnMap([
      ['workspace_id', required('uuid')],
      ['relation_id', required('uuid')],
      ['revision_id', required('uuid')],
      ['input_ordinal', required('integer')],
      ['input_relation_id', required('uuid')],
      ['input_revision_number', required('integer')],
      ['input_revision_id', required('uuid')],
    ]),
  ],
  [
    'knowledge_change_event',
    columnMap([
      ['workspace_id', required('uuid')],
      ['event_id', required('uuid')],
      ['event_kind', required('text')],
      ['event_schema_version', required('integer')],
      ['change_set_id', required('uuid')],
      ['created_at', createdAt],
    ]),
  ],
]);

const tableSet = new Set(MANUAL_KNOWLEDGE_TABLES);
const wordStart = /[A-Za-z_]/u;
const wordContinue = /[A-Za-z0-9_$]/u;
const digit = /[0-9]/u;
const punctuation = new Set(['(', ')', ',', '.', ';']);
const operatorStart = new Set(['=', '<', '>', '+', '-', '*', '/']);

export function tokenizeManualKnowledgeSql(sql: string): readonly SqlToken[] {
  const tokens: SqlToken[] = [];
  let cursor = 0;
  while (cursor < sql.length) {
    const character = sql[cursor];
    if (character === undefined) break;
    if (/\s/u.test(character)) {
      cursor += 1;
      continue;
    }
    if (sql.startsWith('--', cursor)) {
      const end = sql.indexOf('\n', cursor + 2);
      cursor = end === -1 ? sql.length : end + 1;
      continue;
    }
    if (sql.startsWith('/*', cursor)) {
      const end = sql.indexOf('*/', cursor + 2);
      if (end === -1) throw new SyntaxError('Unterminated SQL block comment.');
      if (sql.slice(cursor + 2, end).includes('/*')) {
        throw new SyntaxError('Nested SQL block comments are unsupported.');
      }
      cursor = end + 2;
      continue;
    }
    if ((character === 'E' || character === 'e') && sql[cursor + 1] === "'") {
      const token = readQuoted(sql, cursor, cursor + 1, 'e_string');
      tokens.push(token);
      cursor = token.end;
      continue;
    }
    if (character === "'") {
      const token = readQuoted(sql, cursor, cursor, 'string');
      tokens.push(token);
      cursor = token.end;
      continue;
    }
    if (character === '"') {
      const token = readQuotedIdentifier(sql, cursor);
      tokens.push(token);
      cursor = token.end;
      continue;
    }
    if (wordStart.test(character)) {
      const start = cursor;
      cursor += 1;
      while (cursor < sql.length) {
        const next = sql[cursor];
        if (next === undefined || !wordContinue.test(next)) break;
        cursor += 1;
      }
      tokens.push({
        kind: 'word',
        value: sql.slice(start, cursor).toLowerCase(),
        start,
        end: cursor,
      });
      continue;
    }
    if (digit.test(character)) {
      const start = cursor;
      cursor += 1;
      while (cursor < sql.length) {
        const next = sql[cursor];
        if (next === undefined || !digit.test(next)) break;
        cursor += 1;
      }
      tokens.push({
        kind: 'number',
        value: sql.slice(start, cursor),
        start,
        end: cursor,
      });
      continue;
    }
    if (punctuation.has(character)) {
      tokens.push({
        kind: 'punctuation',
        value: character,
        start: cursor,
        end: cursor + 1,
      });
      cursor += 1;
      continue;
    }
    if (operatorStart.has(character)) {
      const start = cursor;
      cursor += 1;
      const next = sql[cursor];
      if (next !== undefined && ['=', '>'].includes(next)) cursor += 1;
      tokens.push({
        kind: 'operator',
        value: sql.slice(start, cursor),
        start,
        end: cursor,
      });
      continue;
    }
    throw new SyntaxError(
      `Unsupported SQL character at offset ${String(cursor)}.`,
    );
  }
  return Object.freeze(tokens);
}

function readQuoted(
  sql: string,
  tokenStart: number,
  quoteStart: number,
  kind: 'string' | 'e_string',
): SqlToken {
  let cursor = quoteStart + 1;
  let value = '';
  while (cursor < sql.length) {
    const character = sql[cursor];
    if (character === "'") {
      if (sql[cursor + 1] === "'") {
        value += "'";
        cursor += 2;
        continue;
      }
      return {kind, value, start: tokenStart, end: cursor + 1};
    }
    if (kind === 'e_string' && character === '\\') {
      const escaped = sql[cursor + 1];
      if (escaped === undefined) break;
      value += `\\${escaped}`;
      cursor += 2;
      continue;
    }
    if (character === undefined) break;
    value += character;
    cursor += 1;
  }
  throw new SyntaxError('Unterminated SQL string literal.');
}

function readQuotedIdentifier(sql: string, start: number): SqlToken {
  let cursor = start + 1;
  let value = '';
  while (cursor < sql.length) {
    const character = sql[cursor];
    if (character === '"') {
      if (sql[cursor + 1] === '"') {
        value += '"';
        cursor += 2;
        continue;
      }
      return {
        kind: 'quoted_identifier',
        value,
        start,
        end: cursor + 1,
      };
    }
    if (character === undefined) break;
    value += character;
    cursor += 1;
  }
  throw new SyntaxError('Unterminated SQL quoted identifier.');
}

function splitStatements(tokens: readonly SqlToken[]): readonly SqlToken[][] {
  const statements: SqlToken[][] = [];
  let current: SqlToken[] = [];
  let depth = 0;
  for (const token of tokens) {
    if (token.value === '(') depth += 1;
    if (token.value === ')') depth -= 1;
    if (depth < 0) throw new SyntaxError('Unexpected SQL closing parenthesis.');
    if (token.value === ';' && depth === 0) {
      if (current.length > 0) statements.push(current);
      current = [];
    } else {
      current.push(token);
    }
  }
  if (depth !== 0) throw new SyntaxError('Unbalanced SQL parentheses.');
  if (current.length > 0) statements.push(current);
  return statements;
}

function isWord(token: SqlToken | undefined, value?: string): boolean {
  return (
    token?.kind === 'word' && (value === undefined || token.value === value)
  );
}

function requireWord(token: SqlToken | undefined, label: string): string {
  if (token?.kind !== 'word') {
    throw new SyntaxError(`Expected ${label}.`);
  }
  return token.value;
}

function parseQualifiedName(
  tokens: readonly SqlToken[],
  start: number,
): Readonly<{schema: string; name: string; next: number}> {
  const schema = requireWord(tokens[start], 'schema name');
  if (tokens[start + 1]?.value !== '.') {
    throw new SyntaxError('Every DDL object must use an explicit schema.');
  }
  const name = requireWord(tokens[start + 2], 'object name');
  return {schema, name, next: start + 3};
}

function findMatchingParenthesis(
  tokens: readonly SqlToken[],
  openIndex: number,
): number {
  if (tokens[openIndex]?.value !== '(') {
    throw new SyntaxError('Expected opening parenthesis.');
  }
  let depth = 0;
  for (let index = openIndex; index < tokens.length; index += 1) {
    const value = tokens[index]?.value;
    if (value === '(') depth += 1;
    if (value === ')') {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  throw new SyntaxError('Missing closing parenthesis.');
}

function splitTopLevelComma(
  tokens: readonly SqlToken[],
): readonly SqlToken[][] {
  const parts: SqlToken[][] = [];
  let current: SqlToken[] = [];
  let depth = 0;
  for (const token of tokens) {
    if (token.value === '(') depth += 1;
    if (token.value === ')') depth -= 1;
    if (token.value === ',' && depth === 0) {
      if (current.length === 0) throw new SyntaxError('Empty SQL list member.');
      parts.push(current);
      current = [];
    } else {
      current.push(token);
    }
  }
  if (current.length === 0) throw new SyntaxError('Empty SQL list member.');
  parts.push(current);
  return parts;
}

function stripConstraintName(tokens: readonly SqlToken[]): readonly SqlToken[] {
  if (!isWord(tokens[0], 'constraint')) return tokens;
  if (!isWord(tokens[1])) throw new SyntaxError('Invalid constraint name.');
  return tokens.slice(2);
}

function parseConstraint(
  tokens: readonly SqlToken[],
): ParsedConstraint | undefined {
  const body = stripConstraintName(tokens);
  if (isWord(body[0], 'primary') && isWord(body[1], 'key')) {
    return {kind: 'primary_key', tokens: body};
  }
  if (isWord(body[0], 'unique')) return {kind: 'unique', tokens: body};
  if (isWord(body[0], 'foreign') && isWord(body[1], 'key')) {
    return {kind: 'foreign_key', tokens: body};
  }
  if (isWord(body[0], 'check')) return {kind: 'check', tokens: body};
  return undefined;
}

function parseTable(tokens: readonly SqlToken[]): ParsedTable {
  const qualified = parseQualifiedName(tokens, 2);
  if (qualified.schema !== 'struinfo') {
    throw new SyntaxError('Manual knowledge tables must use struinfo.');
  }
  if (tokens[qualified.next]?.value !== '(') {
    throw new SyntaxError('CREATE TABLE requires a column list.');
  }
  const close = findMatchingParenthesis(tokens, qualified.next);
  if (close !== tokens.length - 1) {
    throw new SyntaxError('Unsupported trailing CREATE TABLE tokens.');
  }
  const members = splitTopLevelComma(tokens.slice(qualified.next + 1, close));
  const columns = new Map<string, readonly SqlToken[]>();
  const constraints: ParsedConstraint[] = [];
  for (const member of members) {
    const constraint = parseConstraint(member);
    if (constraint !== undefined) {
      constraints.push(constraint);
      continue;
    }
    const column = requireWord(member[0], 'column name');
    if (columns.has(column) || member.length < 2) {
      throw new SyntaxError('Invalid or duplicate column declaration.');
    }
    if (!isWord(member[1])) {
      throw new SyntaxError('Column types must use unquoted built-in words.');
    }
    columns.set(column, member.slice(1));
  }
  return {
    name: qualified.name,
    columns,
    constraints: Object.freeze(constraints),
  };
}

function parseColumnList(
  tokens: readonly SqlToken[],
  openIndex: number,
): Readonly<{columns: readonly string[]; next: number}> {
  const close = findMatchingParenthesis(tokens, openIndex);
  const parts = splitTopLevelComma(tokens.slice(openIndex + 1, close));
  const columns = parts.map((part) => {
    if (part.length !== 1)
      throw new SyntaxError('Only simple index columns are supported.');
    return requireWord(part[0], 'column name');
  });
  return {columns: Object.freeze(columns), next: close + 1};
}

function parseIndex(tokens: readonly SqlToken[], unique: boolean): ParsedIndex {
  let cursor = unique ? 3 : 2;
  requireWord(tokens[cursor], 'index name');
  cursor += 1;
  if (!isWord(tokens[cursor], 'on'))
    throw new SyntaxError('Expected INDEX ON.');
  const qualified = parseQualifiedName(tokens, cursor + 1);
  if (qualified.schema !== 'struinfo')
    throw new SyntaxError('Index schema mismatch.');
  cursor = qualified.next;
  if (tokens[cursor]?.value !== '(')
    throw new SyntaxError('Expected index columns.');
  const columns = parseColumnList(tokens, cursor);
  cursor = columns.next;
  let predicate: readonly SqlToken[] = [];
  if (isWord(tokens[cursor], 'where')) {
    predicate = tokens.slice(cursor + 1);
    cursor = tokens.length;
  }
  if (cursor !== tokens.length)
    throw new SyntaxError('Unsupported CREATE INDEX suffix.');
  return {unique, table: qualified.name, columns: columns.columns, predicate};
}

function parseAlterConstraint(tokens: readonly SqlToken[]): Readonly<{
  table: string;
  constraint: ParsedConstraint;
}> {
  const qualified = parseQualifiedName(tokens, 2);
  if (qualified.schema !== 'struinfo')
    throw new SyntaxError('ALTER schema mismatch.');
  let cursor = qualified.next;
  if (!isWord(tokens[cursor], 'add'))
    throw new SyntaxError('Only ALTER TABLE ADD is supported.');
  cursor += 1;
  if (isWord(tokens[cursor], 'constraint')) {
    cursor += 1;
    requireWord(tokens[cursor], 'constraint name');
    cursor += 1;
  }
  const constraint = parseConstraint(tokens.slice(cursor));
  if (constraint === undefined)
    throw new SyntaxError('Unsupported ALTER constraint.');
  return {table: qualified.name, constraint};
}

function parseDocument(sql: string): ParsedDocument {
  const tables = new Map<string, ParsedTable>();
  const indexes: ParsedIndex[] = [];
  const pending = new Map<string, ParsedConstraint[]>();
  const externalConstraints = new Map<string, readonly ParsedConstraint[]>();
  const findings: SqlFinding[] = [];
  for (const statement of splitStatements(tokenizeManualKnowledgeSql(sql))) {
    try {
      if (isWord(statement[0], 'create') && isWord(statement[1], 'table')) {
        const table = parseTable(statement);
        if (tables.has(table.name))
          throw new SyntaxError('Duplicate CREATE TABLE.');
        tables.set(table.name, table);
      } else if (
        isWord(statement[0], 'create') &&
        isWord(statement[1], 'unique') &&
        isWord(statement[2], 'index')
      ) {
        indexes.push(parseIndex(statement, true));
      } else if (
        isWord(statement[0], 'create') &&
        isWord(statement[1], 'index')
      ) {
        indexes.push(parseIndex(statement, false));
      } else if (
        isWord(statement[0], 'alter') &&
        isWord(statement[1], 'table')
      ) {
        const alteration = parseAlterConstraint(statement);
        const list = pending.get(alteration.table) ?? [];
        list.push(alteration.constraint);
        pending.set(alteration.table, list);
      } else {
        throw new SyntaxError('Unsupported SQL statement.');
      }
    } catch (error) {
      findings.push({
        code: 'unsupported_statement',
        detail:
          error instanceof Error ? error.message : 'Unknown parser failure.',
      });
    }
  }
  for (const [tableName, constraints] of pending) {
    const table = tables.get(tableName);
    if (table === undefined) {
      if (tableName === 'intake_decision') {
        externalConstraints.set(tableName, Object.freeze([...constraints]));
      } else {
        findings.push({code: 'unknown_alter_table', detail: tableName});
      }
      continue;
    }
    tables.set(tableName, {
      ...table,
      constraints: Object.freeze([...table.constraints, ...constraints]),
    });
  }
  return {
    tables,
    indexes: Object.freeze(indexes),
    externalConstraints,
    findings: Object.freeze(findings),
  };
}

function tokenValues(tokens: readonly SqlToken[]): readonly string[] {
  return tokens.map((token) =>
    token.kind === 'string' || token.kind === 'e_string'
      ? `${token.kind}:${token.value}`
      : token.value,
  );
}

function parseColumnExpectation(
  tokens: readonly SqlToken[],
): ColumnExpectation | undefined {
  const timestampWords = ['timestamp', 'with', 'time', 'zone'] as const;
  let type: ColumnExpectation['type'];
  let offset: number;
  if (
    tokens[0]?.kind === 'word' &&
    ['uuid', 'text', 'integer'].includes(tokens[0].value)
  ) {
    type = tokens[0].value as 'integer' | 'text' | 'uuid';
    offset = 1;
  } else if (
    timestampWords.every((word, index) => {
      const token = tokens[index];
      return token?.kind === 'word' && token.value === word;
    })
  ) {
    type = 'timestamp with time zone';
    offset = timestampWords.length;
  } else {
    return undefined;
  }
  const tail = tokens.slice(offset);
  if (tail.length === 0) return {type, nullable: true};
  if (containsSequence(tail, ['not', 'null']) && tail.length === 2) {
    return {type, nullable: false};
  }
  if (
    containsSequence(tail, ['not', 'null', 'default', 'current_timestamp']) &&
    tail.length === 4
  ) {
    return {type, nullable: false, defaultCurrentTimestamp: true};
  }
  return undefined;
}

function sameColumnExpectation(
  actual: ColumnExpectation,
  expected: ColumnExpectation,
): boolean {
  return (
    actual.type === expected.type &&
    actual.nullable === expected.nullable &&
    Boolean(actual.defaultCurrentTimestamp) ===
      Boolean(expected.defaultCurrentTimestamp)
  );
}

function containsSequence(
  tokens: readonly SqlToken[],
  expected: readonly string[],
): boolean {
  const values = tokenValues(tokens);
  for (let start = 0; start <= values.length - expected.length; start += 1) {
    if (expected.every((value, offset) => values[start + offset] === value))
      return true;
  }
  return false;
}

function constraintColumns(
  constraint: ParsedConstraint,
  marker: readonly string[],
): readonly string[] | undefined {
  const values = tokenValues(constraint.tokens);
  let markerIndex = -1;
  for (let index = 0; index <= values.length - marker.length; index += 1) {
    if (marker.every((value, offset) => values[index + offset] === value)) {
      markerIndex = index + marker.length;
      break;
    }
  }
  if (markerIndex < 0 || values[markerIndex] !== '(') return undefined;
  const columns: string[] = [];
  for (let index = markerIndex + 1; index < values.length; index += 1) {
    const value = values[index];
    if (value === ')') return Object.freeze(columns);
    if (value === ',') continue;
    if (value === undefined) break;
    columns.push(value);
  }
  return undefined;
}

function finding(code: string, detail: string, table?: string): SqlFinding {
  return table === undefined ? {code, detail} : {code, detail, table};
}

function commaSeparated(columns: readonly string[]): readonly string[] {
  return columns.flatMap((column, index) =>
    index === 0 ? [column] : [',', column],
  );
}

function foreignKey(
  local: readonly string[],
  targetTable: string,
  target: readonly string[],
): readonly string[] {
  return [
    'foreign',
    'key',
    '(',
    ...commaSeparated(local),
    ')',
    'references',
    'struinfo',
    '.',
    targetTable,
    '(',
    ...commaSeparated(target),
    ')',
  ];
}

function uniqueKey(columns: readonly string[]): readonly string[] {
  return ['unique', '(', ...commaSeparated(columns), ')'];
}

const reviewStateCheck = [
  'check',
  '(',
  'review_state',
  'in',
  '(',
  'string:draft',
  ',',
  'string:pending_review',
  ',',
  'string:confirmed',
  ',',
  'string:disputed',
  ',',
  'string:rejected',
  ',',
  'string:withdrawn',
  ')',
  ')',
] as const;

const requiredSemanticSequences: Readonly<
  Record<string, readonly (readonly string[])[]>
> = Object.freeze({
  knowledge_change_set: [
    uniqueKey(['workspace_id', 'command_idempotency_key']),
    foreignKey(['workspace_id', 'curation_target_id'], 'curation_target', [
      'workspace_id',
      'target_id',
    ]),
    foreignKey(
      ['workspace_id', 'curation_target_id', 'decision_id'],
      'intake_decision',
      ['workspace_id', 'target_id', 'decision_id'],
    ),
    [
      'check',
      '(',
      'command_kind',
      '=',
      'string:apply_manual_knowledge_change_set',
      ')',
    ],
    ['check', '(', 'authority', '=', 'string:manual_user', ')'],
    ['check', '(', 'operation_origin', '=', 'string:manual_user', ')'],
  ],
  knowledge_item: [
    uniqueKey([
      'workspace_id',
      'item_id',
      'current_revision',
      'current_revision_id',
    ]),
    foreignKey(
      ['workspace_id', 'item_id', 'current_revision', 'current_revision_id'],
      'knowledge_revision',
      ['workspace_id', 'item_id', 'revision_number', 'revision_id'],
    ),
  ],
  knowledge_revision: [
    uniqueKey(['workspace_id', 'item_id', 'revision_number']),
    uniqueKey(['workspace_id', 'item_id', 'revision_number', 'revision_id']),
    foreignKey(['workspace_id', 'item_id'], 'knowledge_item', [
      'workspace_id',
      'item_id',
    ]),
    foreignKey(
      ['workspace_id', 'item_id', 'previous_revision_id'],
      'knowledge_revision',
      ['workspace_id', 'item_id', 'revision_id'],
    ),
    reviewStateCheck,
  ],
  knowledge_relation: [
    uniqueKey([
      'workspace_id',
      'relation_id',
      'current_revision',
      'current_revision_id',
    ]),
    foreignKey(
      [
        'workspace_id',
        'relation_id',
        'current_revision',
        'current_revision_id',
      ],
      'knowledge_relation_revision',
      ['workspace_id', 'relation_id', 'revision_number', 'revision_id'],
    ),
    foreignKey(['workspace_id', 'subject_item_id'], 'knowledge_item', [
      'workspace_id',
      'item_id',
    ]),
    foreignKey(['workspace_id', 'object_item_id'], 'knowledge_item', [
      'workspace_id',
      'item_id',
    ]),
  ],
  knowledge_relation_revision: [
    uniqueKey(['workspace_id', 'relation_id', 'revision_number']),
    uniqueKey([
      'workspace_id',
      'relation_id',
      'revision_number',
      'revision_id',
    ]),
    foreignKey(['workspace_id', 'relation_id'], 'knowledge_relation', [
      'workspace_id',
      'relation_id',
    ]),
    foreignKey(
      ['workspace_id', 'relation_id', 'previous_revision_id'],
      'knowledge_relation_revision',
      ['workspace_id', 'relation_id', 'revision_id'],
    ),
    reviewStateCheck,
  ],
  knowledge_change_operation: [
    foreignKey(['workspace_id', 'change_set_id'], 'knowledge_change_set', [
      'workspace_id',
      'change_set_id',
    ]),
    [
      'check',
      '(',
      'operation_kind',
      'in',
      '(',
      'string:put_item',
      ',',
      'string:put_relation',
      ')',
      ')',
    ],
  ],
  knowledge_revision_fragment_input: [
    foreignKey(
      ['workspace_id', 'item_id', 'revision_id'],
      'knowledge_revision',
      ['workspace_id', 'item_id', 'revision_id'],
    ),
    foreignKey(['workspace_id', 'fragment_id'], 'fragment', [
      'workspace_id',
      'fragment_id',
    ]),
    uniqueKey(['workspace_id', 'item_id', 'revision_id', 'fragment_id']),
  ],
  knowledge_revision_item_input: [
    foreignKey(
      ['workspace_id', 'item_id', 'revision_id'],
      'knowledge_revision',
      ['workspace_id', 'item_id', 'revision_id'],
    ),
    foreignKey(
      [
        'workspace_id',
        'input_item_id',
        'input_revision_number',
        'input_revision_id',
      ],
      'knowledge_revision',
      ['workspace_id', 'item_id', 'revision_number', 'revision_id'],
    ),
  ],
  knowledge_revision_relation_input: [
    foreignKey(
      ['workspace_id', 'item_id', 'revision_id'],
      'knowledge_revision',
      ['workspace_id', 'item_id', 'revision_id'],
    ),
    foreignKey(
      [
        'workspace_id',
        'input_relation_id',
        'input_revision_number',
        'input_revision_id',
      ],
      'knowledge_relation_revision',
      ['workspace_id', 'relation_id', 'revision_number', 'revision_id'],
    ),
  ],
  relation_revision_fragment_input: [
    foreignKey(
      ['workspace_id', 'relation_id', 'revision_id'],
      'knowledge_relation_revision',
      ['workspace_id', 'relation_id', 'revision_id'],
    ),
    foreignKey(['workspace_id', 'fragment_id'], 'fragment', [
      'workspace_id',
      'fragment_id',
    ]),
    uniqueKey(['workspace_id', 'relation_id', 'revision_id', 'fragment_id']),
  ],
  relation_revision_item_input: [
    foreignKey(
      ['workspace_id', 'relation_id', 'revision_id'],
      'knowledge_relation_revision',
      ['workspace_id', 'relation_id', 'revision_id'],
    ),
    foreignKey(
      [
        'workspace_id',
        'input_item_id',
        'input_revision_number',
        'input_revision_id',
      ],
      'knowledge_revision',
      ['workspace_id', 'item_id', 'revision_number', 'revision_id'],
    ),
  ],
  relation_revision_relation_input: [
    foreignKey(
      ['workspace_id', 'relation_id', 'revision_id'],
      'knowledge_relation_revision',
      ['workspace_id', 'relation_id', 'revision_id'],
    ),
    foreignKey(
      [
        'workspace_id',
        'input_relation_id',
        'input_revision_number',
        'input_revision_id',
      ],
      'knowledge_relation_revision',
      ['workspace_id', 'relation_id', 'revision_number', 'revision_id'],
    ),
  ],
  knowledge_change_event: [
    uniqueKey(['workspace_id', 'change_set_id']),
    foreignKey(['workspace_id', 'change_set_id'], 'knowledge_change_set', [
      'workspace_id',
      'change_set_id',
    ]),
    [
      'check',
      '(',
      'event_kind',
      '=',
      'string:knowledge_change_set_committed',
      ')',
    ],
    ['check', '(', 'event_schema_version', '=', '1', ')'],
  ],
});

function constraintFingerprints(
  constraints: readonly ParsedConstraint[],
): readonly string[] {
  return constraints
    .map(
      (constraint) =>
        `${constraint.kind}:${tokenValues(constraint.tokens).join(' ')}`,
    )
    .sort();
}

export function auditManualKnowledgeSql(sql: string): readonly SqlFinding[] {
  const document = parseDocument(sql);
  const frozenDocument = parseDocument(createSyntheticManualKnowledgeSql());
  const findings: SqlFinding[] = [...document.findings];
  const actualTables = [...document.tables.keys()].sort();
  const expectedTables = [...MANUAL_KNOWLEDGE_TABLES].sort();
  if (JSON.stringify(actualTables) !== JSON.stringify(expectedTables)) {
    findings.push(finding('table_set', actualTables.join(',')));
  }
  for (const [name, table] of document.tables) {
    if (!tableSet.has(name))
      findings.push(finding('unexpected_table', name, name));
    const expectedColumns = MANUAL_KNOWLEDGE_COLUMN_ORACLE.get(name);
    if (expectedColumns === undefined) {
      findings.push(finding('column_set', 'no frozen column oracle', name));
    } else {
      const actualNames = [...table.columns.keys()].sort();
      const expectedNames = [...expectedColumns.keys()].sort();
      if (JSON.stringify(actualNames) !== JSON.stringify(expectedNames)) {
        findings.push(finding('column_set', actualNames.join(','), name));
      }
      for (const [column, expected] of expectedColumns) {
        const declaration = table.columns.get(column);
        if (declaration === undefined) continue;
        const actual = parseColumnExpectation(declaration);
        if (actual === undefined) {
          findings.push(
            finding('column_declaration', 'unsupported declaration', name),
          );
        } else if (!sameColumnExpectation(actual, expected)) {
          findings.push(
            finding(
              'column_declaration',
              `${column}:${actual.type}:${String(actual.nullable)}`,
              name,
            ),
          );
        }
      }
    }
    const workspaceColumn = table.columns.get('workspace_id');
    if (
      workspaceColumn === undefined ||
      !containsSequence(workspaceColumn, ['uuid', 'not', 'null'])
    ) {
      findings.push(
        finding(
          'workspace_column',
          'workspace_id uuid NOT NULL required',
          name,
        ),
      );
    }
    const primaryKeys = table.constraints.filter(
      (constraint) => constraint.kind === 'primary_key',
    );
    if (primaryKeys.length !== 1) {
      findings.push(
        finding('primary_key_count', String(primaryKeys.length), name),
      );
    } else {
      const primaryKey = primaryKeys[0];
      if (primaryKey === undefined) {
        throw new Error('Primary-key count guard was violated.');
      }
      const columns = constraintColumns(primaryKey, ['primary', 'key']);
      if (columns?.[0] !== 'workspace_id') {
        findings.push(
          finding('workspace_primary_key', 'workspace_id must be first', name),
        );
      }
    }
    for (const constraint of table.constraints) {
      if (constraint.kind !== 'foreign_key') continue;
      const local = constraintColumns(constraint, ['foreign', 'key']);
      const referenced = constraintColumns(constraint, [
        'references',
        'struinfo',
        '.',
        tokenValues(constraint.tokens)[
          tokenValues(constraint.tokens).indexOf('references') + 3
        ] ?? '',
      ]);
      if (local?.[0] !== 'workspace_id' || referenced?.[0] !== 'workspace_id') {
        findings.push(
          finding(
            'workspace_foreign_key',
            'foreign key must be workspace-first',
            name,
          ),
        );
      }
      if (containsSequence(constraint.tokens, ['on', 'delete', 'cascade'])) {
        findings.push(
          finding('cascade', 'ON DELETE CASCADE is forbidden', name),
        );
      }
    }
    const required = requiredSemanticSequences[name] ?? [];
    const materialTokens = table.constraints.flatMap(
      (constraint) => constraint.tokens,
    );
    for (const sequence of required) {
      if (!containsSequence(materialTokens, sequence)) {
        findings.push(finding('required_semantic', sequence.join(' '), name));
      }
    }
    const frozenTable = frozenDocument.tables.get(name);
    if (
      frozenTable === undefined ||
      JSON.stringify(constraintFingerprints(table.constraints)) !==
        JSON.stringify(constraintFingerprints(frozenTable.constraints))
    ) {
      findings.push(
        finding('constraint_set', 'closed semantic mismatch', name),
      );
    }
    for (const [column, declaration] of table.columns) {
      if (
        declaration.some(
          (token) =>
            token.kind !== 'word' &&
            token.kind !== 'number' &&
            token.kind !== 'string' &&
            token.kind !== 'e_string' &&
            token.kind !== 'punctuation' &&
            token.kind !== 'operator',
        )
      ) {
        findings.push(finding('unsupported_column_token', column, name));
      }
      if (
        declaration.some(
          (token) =>
            token.kind === 'word' && ['json', 'jsonb'].includes(token.value),
        )
      ) {
        findings.push(finding('json_column', column, name));
      }
    }
  }
  const actualExternal =
    document.externalConstraints.get('intake_decision') ?? [];
  const frozenExternal =
    frozenDocument.externalConstraints.get('intake_decision') ?? [];
  if (
    document.externalConstraints.size !== 1 ||
    JSON.stringify(constraintFingerprints(actualExternal)) !==
      JSON.stringify(constraintFingerprints(frozenExternal))
  ) {
    findings.push(
      finding(
        'upstream_constraint',
        'intake_decision workspace/target/decision uniqueness mismatch',
      ),
    );
  }
  for (const index of document.indexes) {
    const table = document.tables.get(index.table);
    if (!tableSet.has(index.table) || table === undefined)
      findings.push(finding('unknown_index_table', index.table));
    if (index.columns[0] !== 'workspace_id')
      findings.push(
        finding('workspace_index', index.columns.join(','), index.table),
      );
    if (index.unique || index.predicate.length > 0)
      findings.push(
        finding(
          'unexpected_material_index',
          index.columns.join(','),
          index.table,
        ),
      );
    if (!index.unique && index.predicate.length === 0 && table !== undefined) {
      const keyColumns = table.constraints.flatMap((constraint) => {
        if (constraint.kind === 'primary_key') {
          return [constraintColumns(constraint, ['primary', 'key']) ?? []];
        }
        if (constraint.kind === 'unique') {
          return [constraintColumns(constraint, ['unique']) ?? []];
        }
        if (constraint.kind === 'foreign_key') {
          return [constraintColumns(constraint, ['foreign', 'key']) ?? []];
        }
        return [];
      });
      const isLeadingPrefix = keyColumns.some(
        (columns) =>
          index.columns.length <= columns.length &&
          index.columns.every((column, offset) => columns[offset] === column),
      );
      if (!isLeadingPrefix) {
        findings.push(
          finding('performance_index', index.columns.join(','), index.table),
        );
      }
    }
  }
  return Object.freeze(findings);
}

export function replaceExecutableTokenSequence(
  sql: string,
  expected: readonly string[],
  replacement: string,
): string {
  const tokens = tokenizeManualKnowledgeSql(sql);
  const values = tokenValues(tokens);
  const matches: number[] = [];
  for (let start = 0; start <= values.length - expected.length; start += 1) {
    if (expected.every((value, offset) => values[start + offset] === value))
      matches.push(start);
  }
  if (matches.length !== 1) {
    throw new RangeError(
      `Expected one executable token sequence, found ${String(matches.length)}.`,
    );
  }
  const match = matches[0];
  if (match === undefined) throw new RangeError('Mutation match missing.');
  const startToken = tokens[match];
  const endToken = tokens[match + expected.length - 1];
  if (startToken === undefined || endToken === undefined)
    throw new RangeError('Mutation token missing.');
  return `${sql.slice(0, startToken.start)}${replacement}${sql.slice(endToken.end)}`;
}

function renderColumn(name: string, expectation: ColumnExpectation): string {
  const nullability = expectation.nullable ? '' : ' NOT NULL';
  const defaultValue = expectation.defaultCurrentTimestamp
    ? ' DEFAULT CURRENT_TIMESTAMP'
    : '';
  return `${name} ${expectation.type}${nullability}${defaultValue}`;
}

function createSyntheticTable(
  name: string,
  constraints: readonly string[],
): string {
  const columns = MANUAL_KNOWLEDGE_COLUMN_ORACLE.get(name);
  if (columns === undefined) {
    throw new RangeError(`Missing synthetic column oracle for ${name}.`);
  }
  return `CREATE TABLE struinfo.${name} (\n  ${[
    ...[...columns].map(([column, expectation]) =>
      renderColumn(column, expectation),
    ),
    ...constraints,
  ].join(',\n  ')}\n);`;
}

const workspaceForeignKey =
  'FOREIGN KEY (workspace_id) REFERENCES struinfo.workspace (workspace_id)';
const reviewCheck =
  "CHECK (review_state IN ('draft', 'pending_review', 'confirmed', 'disputed', 'rejected', 'withdrawn'))";

export function createSyntheticManualKnowledgeSql(): string {
  const tables = [
    createSyntheticTable('knowledge_change_set', [
      'PRIMARY KEY (workspace_id, change_set_id)',
      workspaceForeignKey,
      'FOREIGN KEY (workspace_id, curation_target_id) REFERENCES struinfo.curation_target (workspace_id, target_id)',
      'FOREIGN KEY (workspace_id, curation_target_id, decision_id) REFERENCES struinfo.intake_decision (workspace_id, target_id, decision_id)',
      'UNIQUE (workspace_id, command_idempotency_key)',
      "CHECK (command_kind = 'apply_manual_knowledge_change_set')",
      "CHECK (authority = 'manual_user')",
      "CHECK (operation_origin = 'manual_user')",
      "CHECK (authorization_kind IN ('eligible_target', 'manual_edit'))",
      "CHECK ((authorization_kind = 'manual_edit' AND curation_target_id IS NULL AND decision_id IS NULL AND decision_revision_number IS NULL AND decision_revision_id IS NULL) OR (authorization_kind = 'eligible_target' AND curation_target_id IS NOT NULL AND decision_id IS NOT NULL AND decision_revision_number IS NOT NULL AND decision_revision_id IS NOT NULL))",
      'CHECK (decision_revision_number IS NULL OR decision_revision_number >= 1)',
      "CHECK (original_outcome IN ('applied', 'unchanged'))",
      'CHECK (operation_count >= 1 AND operation_count <= 64)',
    ]),
    createSyntheticTable('knowledge_item', [
      'PRIMARY KEY (workspace_id, item_id)',
      workspaceForeignKey,
      'UNIQUE (workspace_id, item_id, current_revision, current_revision_id)',
      'CHECK (current_revision >= 1)',
    ]),
    createSyntheticTable('knowledge_revision', [
      'PRIMARY KEY (workspace_id, item_id, revision_id)',
      'FOREIGN KEY (workspace_id, item_id) REFERENCES struinfo.knowledge_item (workspace_id, item_id)',
      'FOREIGN KEY (workspace_id, item_id, previous_revision_id) REFERENCES struinfo.knowledge_revision (workspace_id, item_id, revision_id)',
      'UNIQUE (workspace_id, item_id, revision_number)',
      'UNIQUE (workspace_id, item_id, revision_number, revision_id)',
      'CHECK (revision_number >= 1)',
      "CHECK (knowledge_kind IN ('entity', 'concept', 'assertion', 'event', 'method', 'framework', 'resource', 'work'))",
      "CHECK (epistemic_role IN ('source_excerpt', 'source_claim', 'summary', 'inference', 'user_assertion'))",
      reviewCheck,
      "CHECK (btrim(title) <> '')",
      "CHECK (body IS NULL OR btrim(body) <> '')",
      'CHECK ((revision_number = 1 AND previous_revision_id IS NULL) OR (revision_number > 1 AND previous_revision_id IS NOT NULL))',
    ]),
    createSyntheticTable('knowledge_relation', [
      'PRIMARY KEY (workspace_id, relation_id)',
      workspaceForeignKey,
      'FOREIGN KEY (workspace_id, subject_item_id) REFERENCES struinfo.knowledge_item (workspace_id, item_id)',
      'FOREIGN KEY (workspace_id, object_item_id) REFERENCES struinfo.knowledge_item (workspace_id, item_id)',
      'UNIQUE (workspace_id, relation_id, current_revision, current_revision_id)',
      'CHECK (current_revision >= 1)',
      'CHECK (subject_item_id <> object_item_id)',
    ]),
    createSyntheticTable('knowledge_relation_revision', [
      'PRIMARY KEY (workspace_id, relation_id, revision_id)',
      'FOREIGN KEY (workspace_id, relation_id) REFERENCES struinfo.knowledge_relation (workspace_id, relation_id)',
      'FOREIGN KEY (workspace_id, relation_id, previous_revision_id) REFERENCES struinfo.knowledge_relation_revision (workspace_id, relation_id, revision_id)',
      'UNIQUE (workspace_id, relation_id, revision_number)',
      'UNIQUE (workspace_id, relation_id, revision_number, revision_id)',
      'CHECK (revision_number >= 1)',
      'CHECK (subject_item_id <> object_item_id)',
      "CHECK (btrim(relation_type_key) <> '')",
      "CHECK (epistemic_role IN ('source_claim', 'summary', 'inference', 'user_assertion'))",
      reviewCheck,
      "CHECK (qualifier IS NULL OR btrim(qualifier) <> '')",
      'CHECK ((revision_number = 1 AND previous_revision_id IS NULL) OR (revision_number > 1 AND previous_revision_id IS NOT NULL))',
    ]),
    createSyntheticTable('knowledge_change_operation', [
      'PRIMARY KEY (workspace_id, change_set_id, operation_index)',
      'FOREIGN KEY (workspace_id, change_set_id) REFERENCES struinfo.knowledge_change_set (workspace_id, change_set_id)',
      "CHECK (operation_kind IN ('put_item', 'put_relation'))",
      "CHECK ((operation_kind = 'put_item' AND item_id IS NOT NULL AND relation_id IS NULL) OR (operation_kind = 'put_relation' AND item_id IS NULL AND relation_id IS NOT NULL))",
      "CHECK (outcome IN ('applied', 'unchanged'))",
      'CHECK (operation_index >= 0 AND operation_index <= 63)',
      'CHECK (resulting_revision >= 1)',
    ]),
    createSyntheticTable('knowledge_revision_fragment_input', [
      'PRIMARY KEY (workspace_id, item_id, revision_id, input_kind, input_ordinal)',
      'FOREIGN KEY (workspace_id, item_id, revision_id) REFERENCES struinfo.knowledge_revision (workspace_id, item_id, revision_id)',
      'FOREIGN KEY (workspace_id, fragment_id) REFERENCES struinfo.fragment (workspace_id, fragment_id)',
      'UNIQUE (workspace_id, item_id, revision_id, fragment_id)',
      "CHECK (input_kind IN ('citation', 'derivation'))",
      'CHECK (input_ordinal >= 0 AND input_ordinal <= 63)',
    ]),
    createSyntheticTable('knowledge_revision_item_input', [
      'PRIMARY KEY (workspace_id, item_id, revision_id, input_ordinal)',
      'FOREIGN KEY (workspace_id, item_id, revision_id) REFERENCES struinfo.knowledge_revision (workspace_id, item_id, revision_id)',
      'FOREIGN KEY (workspace_id, input_item_id, input_revision_number, input_revision_id) REFERENCES struinfo.knowledge_revision (workspace_id, item_id, revision_number, revision_id)',
      'UNIQUE (workspace_id, item_id, revision_id, input_item_id, input_revision_number)',
      'CHECK (input_ordinal >= 0 AND input_ordinal <= 63)',
    ]),
    createSyntheticTable('knowledge_revision_relation_input', [
      'PRIMARY KEY (workspace_id, item_id, revision_id, input_ordinal)',
      'FOREIGN KEY (workspace_id, item_id, revision_id) REFERENCES struinfo.knowledge_revision (workspace_id, item_id, revision_id)',
      'FOREIGN KEY (workspace_id, input_relation_id, input_revision_number, input_revision_id) REFERENCES struinfo.knowledge_relation_revision (workspace_id, relation_id, revision_number, revision_id)',
      'UNIQUE (workspace_id, item_id, revision_id, input_relation_id, input_revision_number)',
      'CHECK (input_ordinal >= 0 AND input_ordinal <= 63)',
    ]),
    createSyntheticTable('relation_revision_fragment_input', [
      'PRIMARY KEY (workspace_id, relation_id, revision_id, input_kind, input_ordinal)',
      'FOREIGN KEY (workspace_id, relation_id, revision_id) REFERENCES struinfo.knowledge_relation_revision (workspace_id, relation_id, revision_id)',
      'FOREIGN KEY (workspace_id, fragment_id) REFERENCES struinfo.fragment (workspace_id, fragment_id)',
      'UNIQUE (workspace_id, relation_id, revision_id, fragment_id)',
      "CHECK (input_kind IN ('citation', 'derivation'))",
      'CHECK (input_ordinal >= 0 AND input_ordinal <= 63)',
    ]),
    createSyntheticTable('relation_revision_item_input', [
      'PRIMARY KEY (workspace_id, relation_id, revision_id, input_ordinal)',
      'FOREIGN KEY (workspace_id, relation_id, revision_id) REFERENCES struinfo.knowledge_relation_revision (workspace_id, relation_id, revision_id)',
      'FOREIGN KEY (workspace_id, input_item_id, input_revision_number, input_revision_id) REFERENCES struinfo.knowledge_revision (workspace_id, item_id, revision_number, revision_id)',
      'UNIQUE (workspace_id, relation_id, revision_id, input_item_id, input_revision_number)',
      'CHECK (input_ordinal >= 0 AND input_ordinal <= 63)',
    ]),
    createSyntheticTable('relation_revision_relation_input', [
      'PRIMARY KEY (workspace_id, relation_id, revision_id, input_ordinal)',
      'FOREIGN KEY (workspace_id, relation_id, revision_id) REFERENCES struinfo.knowledge_relation_revision (workspace_id, relation_id, revision_id)',
      'FOREIGN KEY (workspace_id, input_relation_id, input_revision_number, input_revision_id) REFERENCES struinfo.knowledge_relation_revision (workspace_id, relation_id, revision_number, revision_id)',
      'UNIQUE (workspace_id, relation_id, revision_id, input_relation_id, input_revision_number)',
      'CHECK (input_ordinal >= 0 AND input_ordinal <= 63)',
    ]),
    createSyntheticTable('knowledge_change_event', [
      'PRIMARY KEY (workspace_id, event_id)',
      'FOREIGN KEY (workspace_id, change_set_id) REFERENCES struinfo.knowledge_change_set (workspace_id, change_set_id)',
      'UNIQUE (workspace_id, change_set_id)',
      "CHECK (event_kind = 'knowledge_change_set_committed')",
      'CHECK (event_schema_version = 1)',
    ]),
  ];
  const currentPointers = [
    'ALTER TABLE struinfo.intake_decision ADD CONSTRAINT synthetic_decision_target_uq UNIQUE (workspace_id, target_id, decision_id);',
    'ALTER TABLE struinfo.knowledge_item ADD CONSTRAINT synthetic_item_current_fk FOREIGN KEY (workspace_id, item_id, current_revision, current_revision_id) REFERENCES struinfo.knowledge_revision (workspace_id, item_id, revision_number, revision_id) DEFERRABLE INITIALLY DEFERRED;',
    'ALTER TABLE struinfo.knowledge_relation ADD CONSTRAINT synthetic_relation_current_fk FOREIGN KEY (workspace_id, relation_id, current_revision, current_revision_id) REFERENCES struinfo.knowledge_relation_revision (workspace_id, relation_id, revision_number, revision_id) DEFERRABLE INITIALLY DEFERRED;',
  ];
  return [...tables, ...currentPointers].join('\n\n');
}
