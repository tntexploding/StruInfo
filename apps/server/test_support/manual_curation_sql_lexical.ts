/**
 * Narrow first-party lexical audit for the frozen manual-curation migration.
 *
 * This is not a PostgreSQL parser. It recognizes only the CREATE TABLE,
 * ALTER TABLE ... ADD CONSTRAINT, and CREATE [UNIQUE] INDEX forms emitted by
 * migration 000003. Unsupported syntax fails closed.
 */

export type ManualCurationSqlTokenKind =
  | 'word'
  | 'string'
  | 'quoted_identifier'
  | 'number'
  | 'operator'
  | 'punctuation';

export interface ManualCurationSqlToken {
  readonly kind: ManualCurationSqlTokenKind;
  readonly value: string;
  readonly offset: number;
}

export interface ManualCurationColumnShape {
  readonly type: string;
  readonly nullable: boolean;
  readonly defaultExpression?: string;
}

export interface ManualCurationTableShape {
  readonly columns: ReadonlyMap<string, Readonly<ManualCurationColumnShape>>;
  readonly primaryKeys: readonly string[];
  readonly uniqueKeys: readonly string[];
  readonly foreignKeys: readonly string[];
  readonly checks: readonly string[];
}

export interface ManualCurationIndexShape {
  readonly table: string;
  readonly columns: readonly string[];
  readonly unique: boolean;
  readonly predicate?: string;
}

export interface ManualCurationDdlShape {
  readonly tables: ReadonlyMap<string, Readonly<ManualCurationTableShape>>;
  readonly indexes: readonly Readonly<ManualCurationIndexShape>[];
}

export class ManualCurationSqlLexicalError extends Error {
  public readonly offset: number;

  public constructor(message: string, offset: number) {
    super(message);
    this.name = 'ManualCurationSqlLexicalError';
    this.offset = offset;
  }
}

interface MutableTable {
  readonly columns: Map<string, Readonly<ManualCurationColumnShape>>;
  readonly primaryKeys: string[];
  readonly uniqueKeys: string[];
  readonly foreignKeys: string[];
  readonly checks: string[];
}

export function analyzeManualCurationDdl(sql: string): ManualCurationDdlShape {
  const tables = new Map<string, MutableTable>();
  const indexes: ManualCurationIndexShape[] = [];
  const alterStatements: (readonly ManualCurationSqlToken[])[] = [];
  for (const statement of splitStatements(tokenizeManualCurationSql(sql))) {
    if (startsWithWords(statement, ['create', 'table'])) {
      const [name, table] = parseCreateTable(statement);
      if (tables.has(name)) {
        fail(`Duplicate table ${name}.`, statement[0]?.offset ?? 0);
      }
      tables.set(name, table);
      continue;
    }
    if (startsWithWords(statement, ['alter', 'table'])) {
      alterStatements.push(statement);
      continue;
    }
    if (
      startsWithWords(statement, ['create', 'index']) ||
      startsWithWords(statement, ['create', 'unique', 'index'])
    ) {
      indexes.push(parseCreateIndex(statement));
      continue;
    }
    fail('Unsupported SQL statement.', statement[0]?.offset ?? 0);
  }
  for (const statement of alterStatements) {
    parseAlterTable(statement, tables);
  }
  return {
    tables: new Map(
      [...tables.entries()].map(([name, table]) => [
        name,
        {
          columns: table.columns,
          primaryKeys: table.primaryKeys,
          uniqueKeys: table.uniqueKeys,
          foreignKeys: table.foreignKeys,
          checks: table.checks,
        },
      ]),
    ),
    indexes,
  };
}

export function tokenizeManualCurationSql(
  sql: string,
): readonly ManualCurationSqlToken[] {
  const tokens: ManualCurationSqlToken[] = [];
  let offset = 0;
  while (offset < sql.length) {
    const current = sql[offset];
    const next = sql[offset + 1];
    if (current === undefined) {
      break;
    }
    if (/\s/u.test(current)) {
      offset += 1;
      continue;
    }
    if (current === '-' && next === '-') {
      offset = skipLineComment(sql, offset + 2);
      continue;
    }
    if (current === '/' && next === '*') {
      offset = skipBlockComment(sql, offset);
      continue;
    }
    if (current === "'") {
      const parsed = readString(sql, offset);
      tokens.push({kind: 'string', value: parsed.value, offset});
      offset = parsed.nextOffset;
      continue;
    }
    if (current === '"') {
      const parsed = readQuotedIdentifier(sql, offset);
      tokens.push({kind: 'quoted_identifier', value: parsed.value, offset});
      offset = parsed.nextOffset;
      continue;
    }
    if (/[A-Za-z_]/u.test(current)) {
      const start = offset;
      offset += 1;
      while (/[A-Za-z0-9_$]/u.test(sql[offset] ?? '')) {
        offset += 1;
      }
      tokens.push({
        kind: 'word',
        value: sql.slice(start, offset).toLowerCase(),
        offset: start,
      });
      continue;
    }
    if (/[0-9]/u.test(current)) {
      const start = offset;
      offset += 1;
      while (/[0-9.]/u.test(sql[offset] ?? '')) {
        offset += 1;
      }
      tokens.push({
        kind: 'number',
        value: sql.slice(start, offset),
        offset: start,
      });
      continue;
    }
    if ('(),.;'.includes(current)) {
      tokens.push({kind: 'punctuation', value: current, offset});
      offset += 1;
      continue;
    }
    const operator = ['<>', '>=', '<=', '::', '~', '=', '<', '>'].find(
      (candidate) => sql.startsWith(candidate, offset),
    );
    if (operator !== undefined) {
      tokens.push({kind: 'operator', value: operator, offset});
      offset += operator.length;
      continue;
    }
    fail('Unsupported SQL character.', offset);
  }
  return tokens;
}

export function checkFingerprint(expression: string): string {
  return canonicalTokens(tokenizeManualCurationSql(expression));
}

export function keyFingerprint(columns: readonly string[]): string {
  return columns.join(',');
}

export function foreignKeyFingerprint(
  localColumns: readonly string[],
  targetTable: string,
  targetColumns: readonly string[],
  deferrable = false,
): string {
  return `${localColumns.join(',')}|${targetTable}|${targetColumns.join(',')}|deferrable:${String(deferrable)}`;
}

export function predicateFingerprint(expression: string): string {
  return canonicalTokens(tokenizeManualCurationSql(expression));
}

export function findForbiddenManualCurationSql(sql: string): readonly string[] {
  const tokens = tokenizeManualCurationSql(sql);
  const statements = splitStatements(tokens);
  const findings = new Set<string>();
  for (const statement of statements) {
    const words = statement
      .filter((token) => token.kind === 'word')
      .map((token) => token.value);
    const head = words[0];
    if (
      [
        'copy',
        'delete',
        'drop',
        'grant',
        'insert',
        'revoke',
        'truncate',
        'update',
      ].includes(head ?? '')
    ) {
      findings.add(`statement:${String(head)}`);
    }
    if (
      head === 'create' &&
      [
        'extension',
        'function',
        'policy',
        'procedure',
        'role',
        'rule',
        'schema',
        'trigger',
        'user',
        'view',
      ].includes(words[1] ?? '')
    ) {
      findings.add(`create:${String(words[1])}`);
    }
    if (
      head === 'create' &&
      words[1] === 'materialized' &&
      words[2] === 'view'
    ) {
      findings.add('create:materialized_view');
    }
    if (containsWords(statement, ['on', 'delete', 'cascade'])) {
      findings.add('foreign_key:on_delete_cascade');
    }
  }
  for (const statement of statements) {
    if (startsWithWords(statement, ['create', 'table'])) {
      const [, table] = parseCreateTable(statement);
      for (const column of table.columns.values()) {
        if (['bytea', 'json', 'jsonb'].includes(column.type)) {
          findings.add(`column_type:${column.type}`);
        }
      }
    }
  }
  return [...findings].sort();
}

function parseCreateTable(
  statement: readonly ManualCurationSqlToken[],
): readonly [string, MutableTable] {
  const open = statement.findIndex((token) => token.value === '(');
  if (open < 3 || statement.at(-1)?.value !== ')') {
    fail('Malformed CREATE TABLE.', statement[0]?.offset ?? 0);
  }
  const name = qualifiedName(statement.slice(2, open));
  if (!name.startsWith('struinfo.')) {
    fail('Only struinfo tables are supported.', statement[2]?.offset ?? 0);
  }
  const table = emptyTable();
  for (const segment of splitTopLevel(statement.slice(open + 1, -1), ',')) {
    parseTableSegment(segment, table);
  }
  return [name.slice('struinfo.'.length), table];
}

function parseTableSegment(
  segment: readonly ManualCurationSqlToken[],
  table: MutableTable,
): void {
  let declaration = segment;
  if (startsWithWords(segment, ['constraint'])) {
    if (segment.length < 3) {
      fail('Incomplete table constraint.', segment[0]?.offset ?? 0);
    }
    identifier(segment[1]);
    declaration = segment.slice(2);
  }
  if (startsWithWords(declaration, ['primary', 'key'])) {
    table.primaryKeys.push(parseColumnsAfter(declaration, 2).join(','));
    return;
  }
  if (startsWithWords(declaration, ['unique'])) {
    table.uniqueKeys.push(parseColumnsAfter(declaration, 1).join(','));
    return;
  }
  if (startsWithWords(declaration, ['foreign', 'key'])) {
    table.foreignKeys.push(parseForeignKey(declaration));
    return;
  }
  if (startsWithWords(declaration, ['check'])) {
    table.checks.push(canonicalParenthesized(declaration, 1));
    return;
  }
  parseColumn(segment, table);
}

function parseColumn(
  segment: readonly ManualCurationSqlToken[],
  table: MutableTable,
): void {
  const name = identifier(segment[0]);
  if (table.columns.has(name)) {
    fail('Duplicate column declaration.', segment[0]?.offset ?? 0);
  }
  let position = 1;
  const typeParts: string[] = [];
  while (position < segment.length) {
    if (isColumnConstraintStart(segment, position)) {
      break;
    }
    typeParts.push(required(segment, position).value);
    position += 1;
  }
  if (typeParts.length === 0) {
    fail('Column type is missing.', segment[0]?.offset ?? 0);
  }
  let nullable = true;
  let defaultExpression: string | undefined;
  while (position < segment.length) {
    if (matchesWords(segment, position, ['not', 'null'])) {
      nullable = false;
      position += 2;
      continue;
    }
    if (matchesWords(segment, position, ['default'])) {
      const start = position + 1;
      position = nextColumnConstraint(segment, start);
      if (position === start) {
        fail('DEFAULT expression is empty.', segment[start]?.offset ?? 0);
      }
      defaultExpression = canonicalTokens(segment.slice(start, position));
      continue;
    }
    fail(
      'Inline column constraints are not supported.',
      segment[position]?.offset ?? 0,
    );
  }
  table.columns.set(name, {
    type: typeParts.join(' '),
    nullable,
    ...(defaultExpression === undefined ? {} : {defaultExpression}),
  });
}

function parseAlterTable(
  statement: readonly ManualCurationSqlToken[],
  tables: ReadonlyMap<string, MutableTable>,
): void {
  const nameEnd = statement.findIndex(
    (token, index) =>
      index >= 2 && token.kind === 'word' && token.value === 'add',
  );
  if (nameEnd < 0) {
    fail('Unsupported ALTER TABLE.', statement[0]?.offset ?? 0);
  }
  const name = qualifiedName(statement.slice(2, nameEnd));
  const tableName = name.slice('struinfo.'.length);
  const table = tables.get(tableName);
  if (table === undefined) {
    fail('ALTER TABLE names an unknown table.', statement[2]?.offset ?? 0);
  }
  let declaration = statement.slice(nameEnd + 1);
  if (startsWithWords(declaration, ['constraint'])) {
    identifier(declaration[1]);
    declaration = declaration.slice(2);
  }
  if (!startsWithWords(declaration, ['foreign', 'key'])) {
    fail('Only ADD FOREIGN KEY is supported.', declaration[0]?.offset ?? 0);
  }
  table.foreignKeys.push(parseForeignKey(declaration));
}

function parseCreateIndex(
  statement: readonly ManualCurationSqlToken[],
): ManualCurationIndexShape {
  let position = 1;
  const unique = isWord(statement[position], 'unique');
  if (unique) {
    position += 1;
  }
  if (!isWord(statement[position], 'index')) {
    fail('Malformed CREATE INDEX.', statement[position]?.offset ?? 0);
  }
  identifier(statement[position + 1]);
  position += 2;
  if (!isWord(statement[position], 'on')) {
    fail('CREATE INDEX lacks ON.', statement[position]?.offset ?? 0);
  }
  position += 1;
  const open = statement.findIndex(
    (token, index) => index >= position && token.value === '(',
  );
  if (open < 0) {
    fail('CREATE INDEX lacks columns.', statement[position]?.offset ?? 0);
  }
  const table = qualifiedName(statement.slice(position, open));
  const close = matchingClose(statement, open);
  const columns = parseIdentifierList(statement.slice(open + 1, close));
  position = close + 1;
  let predicate: string | undefined;
  if (position < statement.length) {
    if (!isWord(statement[position], 'where')) {
      fail(
        'Unsupported CREATE INDEX suffix.',
        statement[position]?.offset ?? 0,
      );
    }
    const predicateTokens = statement.slice(position + 1);
    if (predicateTokens.length === 0) {
      fail(
        'Partial index predicate is empty.',
        statement[position]?.offset ?? 0,
      );
    }
    predicate = canonicalTokens(predicateTokens);
  }
  return {
    table,
    columns,
    unique,
    ...(predicate === undefined ? {} : {predicate}),
  };
}

function parseForeignKey(
  declaration: readonly ManualCurationSqlToken[],
): string {
  const localOpen = declaration.findIndex((token) => token.value === '(');
  if (localOpen !== 2) {
    fail('Malformed FOREIGN KEY.', declaration[0]?.offset ?? 0);
  }
  const localClose = matchingClose(declaration, localOpen);
  const local = parseIdentifierList(
    declaration.slice(localOpen + 1, localClose),
  );
  if (!isWord(declaration[localClose + 1], 'references')) {
    fail(
      'FOREIGN KEY lacks REFERENCES.',
      declaration[localClose + 1]?.offset ?? 0,
    );
  }
  const targetOpen = declaration.findIndex(
    (token, index) => index > localClose + 1 && token.value === '(',
  );
  if (targetOpen < 0) {
    fail('REFERENCES lacks target columns.', declaration[0]?.offset ?? 0);
  }
  const targetTable = qualifiedName(
    declaration.slice(localClose + 2, targetOpen),
  );
  const targetClose = matchingClose(declaration, targetOpen);
  const suffix = declaration.slice(targetClose + 1);
  const deferrable =
    suffix.length === 3 &&
    startsWithWords(suffix, ['deferrable', 'initially', 'deferred']);
  if (suffix.length > 0 && !deferrable) {
    fail('Unsupported FOREIGN KEY suffix.', suffix[0]?.offset ?? 0);
  }
  const target = parseIdentifierList(
    declaration.slice(targetOpen + 1, targetClose),
  );
  return foreignKeyFingerprint(local, targetTable, target, deferrable);
}

function canonicalParenthesized(
  tokens: readonly ManualCurationSqlToken[],
  openIndex: number,
): string {
  if (tokens[openIndex]?.value !== '(') {
    fail('Expected parenthesized expression.', tokens[openIndex]?.offset ?? 0);
  }
  const close = matchingClose(tokens, openIndex);
  if (close !== tokens.length - 1) {
    fail('Unexpected tokens after expression.', tokens[close + 1]?.offset ?? 0);
  }
  return canonicalTokens(tokens.slice(openIndex + 1, close));
}

function parseColumnsAfter(
  tokens: readonly ManualCurationSqlToken[],
  index: number,
): readonly string[] {
  if (tokens[index]?.value !== '(') {
    fail('Expected key column list.', tokens[index]?.offset ?? 0);
  }
  const close = matchingClose(tokens, index);
  if (close !== tokens.length - 1) {
    fail('Unsupported key suffix.', tokens[close + 1]?.offset ?? 0);
  }
  return parseIdentifierList(tokens.slice(index + 1, close));
}

function parseIdentifierList(
  tokens: readonly ManualCurationSqlToken[],
): readonly string[] {
  const segments = splitTopLevel(tokens, ',');
  return segments.map((segment) => {
    if (segment.length !== 1) {
      fail(
        'Only simple index/key columns are supported.',
        segment[0]?.offset ?? 0,
      );
    }
    return identifier(segment[0]);
  });
}

function splitStatements(
  tokens: readonly ManualCurationSqlToken[],
): readonly (readonly ManualCurationSqlToken[])[] {
  const statements: ManualCurationSqlToken[][] = [];
  let current: ManualCurationSqlToken[] = [];
  let depth = 0;
  for (const token of tokens) {
    if (token.value === '(') depth += 1;
    if (token.value === ')') depth -= 1;
    if (depth < 0) fail('Unbalanced closing parenthesis.', token.offset);
    if (token.value === ';' && depth === 0) {
      if (current.length > 0) statements.push(current);
      current = [];
    } else {
      current.push(token);
    }
  }
  if (depth !== 0)
    fail('Unbalanced SQL parentheses.', tokens.at(-1)?.offset ?? 0);
  if (current.length > 0)
    fail('SQL statement lacks terminating semicolon.', current[0]?.offset ?? 0);
  return statements;
}

function splitTopLevel(
  tokens: readonly ManualCurationSqlToken[],
  separator: string,
): readonly (readonly ManualCurationSqlToken[])[] {
  const segments: ManualCurationSqlToken[][] = [];
  let current: ManualCurationSqlToken[] = [];
  let depth = 0;
  for (const token of tokens) {
    if (token.value === '(') depth += 1;
    if (token.value === ')') depth -= 1;
    if (token.value === separator && depth === 0) {
      if (current.length === 0) fail('Empty SQL list member.', token.offset);
      segments.push(current);
      current = [];
    } else {
      current.push(token);
    }
  }
  if (depth !== 0 || current.length === 0)
    fail('Malformed SQL list.', tokens[0]?.offset ?? 0);
  segments.push(current);
  return segments;
}

function matchingClose(
  tokens: readonly ManualCurationSqlToken[],
  open: number,
): number {
  let depth = 0;
  for (let index = open; index < tokens.length; index += 1) {
    const token = required(tokens, index);
    if (token.value === '(') depth += 1;
    if (token.value === ')') {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  fail('Unbalanced SQL parentheses.', tokens[open]?.offset ?? 0);
}

function qualifiedName(tokens: readonly ManualCurationSqlToken[]): string {
  if (tokens.length === 3 && tokens[1]?.value === '.') {
    return `${identifier(tokens[0])}.${identifier(tokens[2])}`;
  }
  if (tokens.length === 1) return identifier(tokens[0]);
  fail('Malformed qualified identifier.', tokens[0]?.offset ?? 0);
}

function identifier(token: ManualCurationSqlToken | undefined): string {
  if (
    token === undefined ||
    (token.kind !== 'word' && token.kind !== 'quoted_identifier')
  ) {
    fail('Expected SQL identifier.', token?.offset ?? 0);
  }
  return token.value;
}

function canonicalTokens(tokens: readonly ManualCurationSqlToken[]): string {
  return tokens.map((token) => `${token.kind}:${token.value}`).join('|');
}

function emptyTable(): MutableTable {
  return {
    columns: new Map(),
    primaryKeys: [],
    uniqueKeys: [],
    foreignKeys: [],
    checks: [],
  };
}

function isColumnConstraintStart(
  tokens: readonly ManualCurationSqlToken[],
  index: number,
): boolean {
  return (
    matchesWords(tokens, index, ['not', 'null']) ||
    matchesWords(tokens, index, ['default']) ||
    matchesWords(tokens, index, ['check']) ||
    matchesWords(tokens, index, ['references']) ||
    matchesWords(tokens, index, ['primary', 'key']) ||
    matchesWords(tokens, index, ['unique']) ||
    matchesWords(tokens, index, ['constraint'])
  );
}

function nextColumnConstraint(
  tokens: readonly ManualCurationSqlToken[],
  start: number,
): number {
  let depth = 0;
  for (let index = start; index < tokens.length; index += 1) {
    const token = required(tokens, index);
    if (token.value === '(') depth += 1;
    if (token.value === ')') depth -= 1;
    if (depth === 0 && isColumnConstraintStart(tokens, index)) return index;
  }
  return tokens.length;
}

function startsWithWords(
  tokens: readonly ManualCurationSqlToken[],
  words: readonly string[],
): boolean {
  return matchesWords(tokens, 0, words);
}

function matchesWords(
  tokens: readonly ManualCurationSqlToken[],
  start: number,
  words: readonly string[],
): boolean {
  return words.every((word, index) => isWord(tokens[start + index], word));
}

function containsWords(
  tokens: readonly ManualCurationSqlToken[],
  words: readonly string[],
): boolean {
  return tokens.some((_, index) => matchesWords(tokens, index, words));
}

function isWord(
  token: ManualCurationSqlToken | undefined,
  value: string,
): boolean {
  return token?.kind === 'word' && token.value === value;
}

function required(
  tokens: readonly ManualCurationSqlToken[],
  index: number,
): ManualCurationSqlToken {
  const token = tokens[index];
  if (token === undefined)
    fail('Required SQL token is missing.', tokens.at(-1)?.offset ?? 0);
  return token;
}

function skipLineComment(sql: string, start: number): number {
  let offset = start;
  while (offset < sql.length && sql[offset] !== '\n') offset += 1;
  return offset;
}

function skipBlockComment(sql: string, start: number): number {
  let offset = start + 2;
  let depth = 1;
  while (offset < sql.length) {
    if (sql.startsWith('/*', offset)) {
      depth += 1;
      offset += 2;
    } else if (sql.startsWith('*/', offset)) {
      depth -= 1;
      offset += 2;
      if (depth === 0) return offset;
    } else {
      offset += 1;
    }
  }
  fail('Unterminated block comment.', start);
}

function readString(
  sql: string,
  start: number,
): Readonly<{value: string; nextOffset: number}> {
  let offset = start + 1;
  let value = '';
  while (offset < sql.length) {
    if (sql[offset] === "'") {
      if (sql[offset + 1] === "'") {
        value += "'";
        offset += 2;
      } else {
        return {value, nextOffset: offset + 1};
      }
    } else {
      value += sql[offset] ?? '';
      offset += 1;
    }
  }
  fail('Unterminated SQL string.', start);
}

function readQuotedIdentifier(
  sql: string,
  start: number,
): Readonly<{value: string; nextOffset: number}> {
  let offset = start + 1;
  let value = '';
  while (offset < sql.length) {
    if (sql[offset] === '"') {
      if (sql[offset + 1] === '"') {
        value += '"';
        offset += 2;
      } else {
        return {value, nextOffset: offset + 1};
      }
    } else {
      value += sql[offset] ?? '';
      offset += 1;
    }
  }
  fail('Unterminated quoted identifier.', start);
}

function fail(message: string, offset: number): never {
  throw new ManualCurationSqlLexicalError(message, offset);
}
