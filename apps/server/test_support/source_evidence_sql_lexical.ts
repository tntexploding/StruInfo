/**
 * Narrow lexical analysis for the source-evidence migration's test support.
 *
 * This is deliberately not a general PostgreSQL parser. It recognizes the
 * CREATE TABLE/INDEX subset used by the frozen migration so tests can compare
 * semantic sets without treating comments, string literals, declaration order,
 * or constraint names as SQL behavior.
 */

export type SqlTokenKind =
  | 'word'
  | 'quoted_identifier'
  | 'string'
  | 'escape_string'
  | 'number'
  | 'operator'
  | 'punctuation';

export interface SqlToken {
  readonly kind: SqlTokenKind;
  readonly value: string;
  readonly offset: number;
}

export interface SqlColumnShape {
  readonly type: string;
  readonly nullable: boolean;
  readonly defaultExpression?: string;
}

export interface SqlTableShape {
  readonly columns: ReadonlyMap<string, Readonly<SqlColumnShape>>;
  readonly keys: ReadonlySet<string>;
  readonly foreignKeys: ReadonlySet<string>;
  readonly checks: readonly (readonly SqlToken[])[];
}

export interface SqlIndexShape {
  readonly table: string;
  readonly columns: readonly string[];
  readonly unique: boolean;
}

export type SqlForeignKeyMatch = 'simple' | 'full' | 'partial';
export type SqlReferentialAction =
  'no_action' | 'restrict' | 'cascade' | 'set_null' | 'set_default';

export interface SqlForeignKeyOptions {
  readonly match?: SqlForeignKeyMatch;
  readonly onDelete?: SqlReferentialAction;
  readonly onUpdate?: SqlReferentialAction;
}

export interface SourceEvidenceDdlShape {
  readonly tables: ReadonlyMap<string, Readonly<SqlTableShape>>;
  readonly indexes: readonly Readonly<SqlIndexShape>[];
}

export class SourceEvidenceSqlLexicalError extends Error {
  public readonly offset: number;

  public constructor(message: string, offset: number) {
    super(message);
    this.name = 'SourceEvidenceSqlLexicalError';
    this.offset = offset;
  }
}

export function analyzeSourceEvidenceDdl(sql: string): SourceEvidenceDdlShape {
  const statements = splitStatements(tokenizeSourceEvidenceSql(sql));
  const tables = new Map<string, Readonly<SqlTableShape>>();
  const indexes: Readonly<SqlIndexShape>[] = [];

  for (const statement of statements) {
    if (startsWithWords(statement, ['create', 'table'])) {
      const [tableName, table] = parseCreateTable(statement);
      if (tables.has(tableName)) {
        failSql(`Duplicate table ${tableName}.`, statement[0]?.offset ?? 0);
      }
      tables.set(tableName, table);
      continue;
    }
    if (
      startsWithWords(statement, ['create', 'index']) ||
      startsWithWords(statement, ['create', 'unique', 'index'])
    ) {
      indexes.push(parseCreateIndex(statement));
      continue;
    }
    failSql(
      'Only CREATE TABLE and CREATE INDEX statements are supported.',
      statement[0]?.offset ?? 0,
    );
  }

  return {tables, indexes};
}

export function tokenizeSourceEvidenceSql(sql: string): readonly SqlToken[] {
  const tokens: SqlToken[] = [];
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
    if (
      (current === 'E' || current === 'e') &&
      next === "'" &&
      isTokenBoundary(sql[offset - 1])
    ) {
      const parsed = readSingleQuotedString(sql, offset + 1, true);
      tokens.push({kind: 'escape_string', value: parsed.value, offset});
      offset = parsed.nextOffset;
      continue;
    }
    if (current === "'") {
      const parsed = readSingleQuotedString(sql, offset, false);
      tokens.push({kind: 'string', value: parsed.value, offset});
      offset = parsed.nextOffset;
      continue;
    }
    if (current === '"') {
      const parsed = readQuotedIdentifier(sql, offset);
      tokens.push({
        kind: 'quoted_identifier',
        value: parsed.value,
        offset,
      });
      offset = parsed.nextOffset;
      continue;
    }
    if (current === '$') {
      const parsed = readDollarQuotedString(sql, offset);
      if (parsed !== undefined) {
        tokens.push({kind: 'string', value: parsed.value, offset});
        offset = parsed.nextOffset;
        continue;
      }
    }
    if (/[A-Za-z_]/u.test(current)) {
      const start = offset;
      offset += 1;
      while (offset < sql.length && /[A-Za-z0-9_$]/u.test(sql[offset] ?? '')) {
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
      while (offset < sql.length && /[0-9.]/u.test(sql[offset] ?? '')) {
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
    const operator = longestOperatorAt(sql, offset);
    if (operator !== undefined) {
      tokens.push({kind: 'operator', value: operator, offset});
      offset += operator.length;
      continue;
    }
    failSql('Unsupported SQL character.', offset);
  }
  return tokens;
}

export function findForbiddenSqlOperations(sql: string): readonly string[] {
  const tokens = tokenizeSourceEvidenceSql(sql);
  const statements = splitStatements(tokens);
  const findings = new Set<string>();
  const forbiddenHeads = new Set([
    'alter',
    'copy',
    'delete',
    'drop',
    'grant',
    'insert',
    'revoke',
    'truncate',
    'update',
  ]);
  const forbiddenCreateTargets = new Set([
    'extension',
    'function',
    'procedure',
    'role',
    'schema',
    'trigger',
    'user',
  ]);

  for (const statement of statements) {
    const words = statement.filter(
      (token): token is SqlToken & {readonly kind: 'word'} =>
        token.kind === 'word',
    );
    const head = words[0]?.value;
    if (head !== undefined && forbiddenHeads.has(head)) {
      findings.add(`statement:${head}`);
    }
    const createTarget =
      words[1]?.value === 'or' && words[2]?.value === 'replace'
        ? words[3]?.value
        : words[1]?.value;
    if (
      head === 'create' &&
      createTarget !== undefined &&
      forbiddenCreateTargets.has(createTarget)
    ) {
      findings.add(`create:${createTarget}`);
    }
    if (startsWithWords(statement, ['create', 'table'])) {
      const [, table] = parseCreateTable(statement);
      for (const column of table.columns.values()) {
        if (['bytea', 'json', 'jsonb'].includes(column.type)) {
          findings.add(`column_type:${column.type}`);
        }
        if (
          column.defaultExpression !== undefined &&
          /(?:^|\s)(?:gen_random_uuid|uuid_generate_v4)(?:\s|$)/u.test(
            column.defaultExpression,
          )
        ) {
          findings.add('column_default:uuid_generator');
        }
      }
      if (
        [...table.foreignKeys].some((foreignKey) =>
          foreignKey.includes('|on_delete:cascade|'),
        )
      ) {
        findings.add('foreign_key:on_delete_cascade');
      }
    }
  }
  if (containsVendorSchemaReference(tokens)) {
    findings.add('vendor:pg_boss');
  }
  return [...findings].sort();
}

export function keyFingerprint(
  kind: 'primary_key' | 'unique' | 'unique_nulls_not_distinct',
  columns: readonly string[],
): string {
  return `${kind}|${columns.join(',')}`;
}

export function foreignKeyFingerprint(
  columns: readonly string[],
  targetTable: string,
  targetColumns: readonly string[],
  options: SqlForeignKeyOptions = {},
): string {
  return [
    'foreign_key',
    columns.join(','),
    targetTable,
    targetColumns.join(','),
    `match:${options.match ?? 'simple'}`,
    `on_delete:${options.onDelete ?? 'no_action'}`,
    `on_update:${options.onUpdate ?? 'no_action'}`,
  ].join('|');
}

export function normalizeForeignKeyMatchForContract(
  fingerprint: string,
  localColumns: ReadonlyMap<string, Readonly<SqlColumnShape>>,
): string {
  const segments = fingerprint.split('|');
  if (
    segments.length !== 7 ||
    segments[0] !== 'foreign_key' ||
    segments[4] === undefined
  ) {
    failSql('Invalid foreign-key fingerprint.', 0);
  }
  const columnNames = segments[1]?.split(',') ?? [];
  const everyColumnRequired = columnNames.every((columnName) => {
    const column = localColumns.get(columnName);
    if (column === undefined) {
      failSql('Foreign-key fingerprint names an unknown local column.', 0);
    }
    return !column.nullable;
  });
  if (
    segments[4] === 'match:full' &&
    (columnNames.length === 1 || everyColumnRequired)
  ) {
    segments[4] = 'match:simple';
  }
  return segments.join('|');
}

export function checkFingerprint(check: readonly SqlToken[]): string {
  return canonicalTokens(check);
}

function parseCreateTable(
  statement: readonly SqlToken[],
): readonly [string, Readonly<SqlTableShape>] {
  const cursor = new TokenCursor(statement);
  cursor.expectWord('create');
  cursor.expectWord('table');
  cursor.consumeWords(['if', 'not', 'exists']);
  const qualifiedName = cursor.readQualifiedIdentifier();
  if (qualifiedName.schema !== 'struinfo') {
    cursor.fail('Evidence tables must use the struinfo schema.');
  }
  cursor.expectPunctuation('(');
  const bodyStart = cursor.position;
  const bodyEnd = matchingClosingParenthesis(statement, bodyStart - 1);
  const body = statement.slice(bodyStart, bodyEnd);
  cursor.position = bodyEnd + 1;
  cursor.expectEnd();

  const columns = new Map<string, Readonly<SqlColumnShape>>();
  const keys = new Set<string>();
  const foreignKeys = new Set<string>();
  const checks: (readonly SqlToken[])[] = [];
  for (const segment of splitTopLevel(body, ',')) {
    if (segment.length === 0) {
      cursor.fail('Empty table declaration segment.');
    }
    const declaration = skipConstraintName(segment);
    if (startsWithWords(declaration, ['primary', 'key'])) {
      keys.add(
        keyFingerprint(
          'primary_key',
          parseParenthesizedColumnList(declaration, 2),
        ),
      );
      continue;
    }
    if (startsWithWords(declaration, ['unique'])) {
      const nullsNotDistinct = startsWithWords(declaration, [
        'unique',
        'nulls',
        'not',
        'distinct',
      ]);
      keys.add(
        keyFingerprint(
          nullsNotDistinct ? 'unique_nulls_not_distinct' : 'unique',
          parseParenthesizedColumnList(declaration, nullsNotDistinct ? 4 : 1),
        ),
      );
      continue;
    }
    if (startsWithWords(declaration, ['foreign', 'key'])) {
      const parsed = parseForeignKey(declaration);
      foreignKeys.add(
        foreignKeyFingerprint(
          parsed.columns,
          parsed.targetTable,
          parsed.targetColumns,
          parsed.options,
        ),
      );
      continue;
    }
    if (startsWithWords(declaration, ['check'])) {
      checks.push(parseParenthesizedTokens(declaration, 1));
      continue;
    }

    const [columnName, column] = parseColumnDeclaration(segment);
    if (columns.has(columnName)) {
      cursor.fail(`Duplicate column ${columnName}.`);
    }
    columns.set(columnName, column);
  }
  return [qualifiedName.name, {columns, keys, foreignKeys, checks}];
}

function parseCreateIndex(statement: readonly SqlToken[]): SqlIndexShape {
  const cursor = new TokenCursor(statement);
  cursor.expectWord('create');
  const unique = cursor.consumeWord('unique');
  cursor.expectWord('index');
  cursor.consumeWords(['if', 'not', 'exists']);
  cursor.readIdentifier();
  cursor.expectWord('on');
  const table = cursor.readQualifiedIdentifier();
  cursor.expectPunctuation('(');
  const start = cursor.position;
  const end = matchingClosingParenthesis(statement, start - 1);
  const columns = parseColumnTokens(statement.slice(start, end));
  cursor.position = end + 1;
  cursor.expectEnd();
  return {
    table: `${table.schema}.${table.name}`,
    columns,
    unique,
  };
}

function parseColumnDeclaration(
  declaration: readonly SqlToken[],
): readonly [string, Readonly<SqlColumnShape>] {
  const cursor = new TokenCursor(declaration);
  const name = cursor.readIdentifier();
  const type = readColumnType(cursor);
  const remaining = declaration.slice(cursor.position);
  let nullable = true;
  let sawNotNull = false;
  let defaultExpression: string | undefined;
  let position = 0;

  while (position < remaining.length) {
    const token = requiredToken(remaining, position);
    if (isWord(token, 'not')) {
      const nullToken = remaining[position + 1];
      if (!isWord(nullToken, 'null') || sawNotNull) {
        failSql(
          'Unsupported or duplicate NOT NULL column constraint.',
          token.offset,
        );
      }
      sawNotNull = true;
      nullable = false;
      position += 2;
      continue;
    }
    if (isWord(token, 'default')) {
      if (defaultExpression !== undefined) {
        failSql('Duplicate DEFAULT column constraint.', token.offset);
      }
      const expressionStart = position + 1;
      const expressionEnd = findNextTopLevelColumnConstraint(
        remaining,
        expressionStart,
      );
      if (expressionEnd === expressionStart) {
        failSql('DEFAULT requires an expression.', token.offset);
      }
      defaultExpression = canonicalTokens(
        remaining.slice(expressionStart, expressionEnd),
      );
      position = expressionEnd;
      continue;
    }
    failSql(
      'Unsupported inline column constraint; use a supported table constraint.',
      token.offset,
    );
  }

  return [
    name,
    {
      type,
      nullable,
      ...(defaultExpression === undefined ? {} : {defaultExpression}),
    },
  ];
}

const COLUMN_CONSTRAINT_START_WORDS = new Set([
  'check',
  'collate',
  'constraint',
  'default',
  'generated',
  'not',
  'null',
  'primary',
  'references',
  'unique',
]);

function findNextTopLevelColumnConstraint(
  tokens: readonly SqlToken[],
  start: number,
): number {
  let depth = 0;
  for (let index = start; index < tokens.length; index += 1) {
    const token = requiredToken(tokens, index);
    if (
      index > start &&
      depth === 0 &&
      token.kind === 'word' &&
      COLUMN_CONSTRAINT_START_WORDS.has(token.value)
    ) {
      return index;
    }
    if (token.kind === 'punctuation' && token.value === '(') {
      depth += 1;
    } else if (token.kind === 'punctuation' && token.value === ')') {
      depth -= 1;
      if (depth < 0) {
        failSql('Unbalanced DEFAULT expression.', token.offset);
      }
    }
  }
  if (depth !== 0) {
    failSql('Unbalanced DEFAULT expression.', tokens.at(-1)?.offset ?? 0);
  }
  return tokens.length;
}

function readColumnType(cursor: TokenCursor): string {
  if (cursor.peekWord('timestamp')) {
    cursor.expectWord('timestamp');
    cursor.expectWord('with');
    cursor.expectWord('time');
    cursor.expectWord('zone');
    return 'timestamp with time zone';
  }
  if (cursor.peekWord('double')) {
    cursor.expectWord('double');
    cursor.expectWord('precision');
    return 'double precision';
  }
  return cursor.readIdentifier();
}

function parseForeignKey(declaration: readonly SqlToken[]): Readonly<{
  columns: readonly string[];
  targetTable: string;
  targetColumns: readonly string[];
  options: Readonly<Required<SqlForeignKeyOptions>>;
}> {
  const cursor = new TokenCursor(declaration);
  cursor.expectWord('foreign');
  cursor.expectWord('key');
  const columns = cursor.readParenthesizedColumns();
  cursor.expectWord('references');
  const target = cursor.readQualifiedIdentifier();
  const targetColumns = cursor.readParenthesizedColumns();
  let match: SqlForeignKeyMatch = 'simple';
  let onDelete: SqlReferentialAction = 'no_action';
  let onUpdate: SqlReferentialAction = 'no_action';
  while (!cursor.atEnd()) {
    if (cursor.consumeWord('match')) {
      if (cursor.consumeWord('full')) {
        match = 'full';
      } else if (cursor.consumeWord('simple')) {
        match = 'simple';
      } else if (cursor.consumeWord('partial')) {
        match = 'partial';
      } else {
        cursor.fail('MATCH requires a supported mode.');
      }
      continue;
    }
    if (cursor.consumeWord('on')) {
      const isDelete = cursor.consumeWord('delete');
      const isUpdate = !isDelete && cursor.consumeWord('update');
      if (!isDelete && !isUpdate) {
        cursor.fail('ON requires DELETE or UPDATE.');
      }
      const action = readReferentialAction(cursor);
      if (isDelete) {
        onDelete = action;
      } else {
        onUpdate = action;
      }
      continue;
    }
    cursor.fail('Unsupported foreign-key clause.');
  }
  return {
    columns,
    targetTable: `${target.schema}.${target.name}`,
    targetColumns,
    options: {match, onDelete, onUpdate},
  };
}

function readReferentialAction(cursor: TokenCursor): SqlReferentialAction {
  if (cursor.consumeWord('no')) {
    cursor.expectWord('action');
    return 'no_action';
  }
  if (cursor.consumeWord('restrict')) {
    return 'restrict';
  }
  if (cursor.consumeWord('cascade')) {
    return 'cascade';
  }
  if (cursor.consumeWord('set')) {
    if (cursor.consumeWord('null')) {
      return 'set_null';
    }
    if (cursor.consumeWord('default')) {
      return 'set_default';
    }
  }
  cursor.fail('Unsupported referential action.');
}

function parseParenthesizedColumnList(
  tokens: readonly SqlToken[],
  openingIndex: number,
): readonly string[] {
  const opening = tokens[openingIndex];
  if (opening?.kind !== 'punctuation' || opening.value !== '(') {
    failSql('Expected a parenthesized column list.', opening?.offset ?? 0);
  }
  const closingIndex = matchingClosingParenthesis(tokens, openingIndex);
  if (closingIndex !== tokens.length - 1) {
    failSql(
      'Unexpected tokens after a key declaration.',
      tokens[closingIndex + 1]?.offset ?? 0,
    );
  }
  return parseColumnTokens(tokens.slice(openingIndex + 1, closingIndex));
}

function parseParenthesizedTokens(
  tokens: readonly SqlToken[],
  openingIndex: number,
): readonly SqlToken[] {
  const opening = tokens[openingIndex];
  if (opening?.kind !== 'punctuation' || opening.value !== '(') {
    failSql('Expected a parenthesized expression.', opening?.offset ?? 0);
  }
  const closingIndex = matchingClosingParenthesis(tokens, openingIndex);
  if (closingIndex !== tokens.length - 1) {
    failSql(
      'Unexpected tokens after CHECK.',
      tokens[closingIndex + 1]?.offset ?? 0,
    );
  }
  return tokens.slice(openingIndex + 1, closingIndex);
}

function parseColumnTokens(tokens: readonly SqlToken[]): readonly string[] {
  const segments = splitTopLevel(tokens, ',');
  return segments.map((segment) => {
    if (segment.length !== 1) {
      failSql(
        'Only identifier column keys are supported.',
        segment[0]?.offset ?? 0,
      );
    }
    return identifierValue(requiredToken(segment, 0));
  });
}

function skipConstraintName(tokens: readonly SqlToken[]): readonly SqlToken[] {
  if (!startsWithWords(tokens, ['constraint'])) {
    return tokens;
  }
  identifierValue(requiredToken(tokens, 1));
  return tokens.slice(2);
}

function splitStatements(
  tokens: readonly SqlToken[],
): readonly (readonly SqlToken[])[] {
  const statements: SqlToken[][] = [];
  let current: SqlToken[] = [];
  let depth = 0;
  for (const token of tokens) {
    if (token.kind === 'punctuation' && token.value === '(') {
      depth += 1;
    } else if (token.kind === 'punctuation' && token.value === ')') {
      depth -= 1;
      if (depth < 0) {
        failSql('Unbalanced closing parenthesis.', token.offset);
      }
    }
    if (token.kind === 'punctuation' && token.value === ';' && depth === 0) {
      if (current.length > 0) {
        statements.push(current);
        current = [];
      }
    } else {
      current.push(token);
    }
  }
  if (depth !== 0) {
    failSql('Unbalanced SQL parentheses.', tokens.at(-1)?.offset ?? 0);
  }
  if (current.length > 0) {
    statements.push(current);
  }
  return statements;
}

function splitTopLevel(
  tokens: readonly SqlToken[],
  punctuation: string,
): readonly (readonly SqlToken[])[] {
  const segments: SqlToken[][] = [[]];
  let depth = 0;
  for (const token of tokens) {
    if (token.kind === 'punctuation' && token.value === '(') {
      depth += 1;
    } else if (token.kind === 'punctuation' && token.value === ')') {
      depth -= 1;
      if (depth < 0) {
        failSql('Unbalanced declaration parenthesis.', token.offset);
      }
    }
    if (
      token.kind === 'punctuation' &&
      token.value === punctuation &&
      depth === 0
    ) {
      segments.push([]);
    } else {
      segments.at(-1)?.push(token);
    }
  }
  if (depth !== 0) {
    failSql('Unbalanced declaration parentheses.', tokens.at(-1)?.offset ?? 0);
  }
  return segments;
}

function matchingClosingParenthesis(
  tokens: readonly SqlToken[],
  openingIndex: number,
): number {
  const opening = tokens[openingIndex];
  if (opening?.kind !== 'punctuation' || opening.value !== '(') {
    failSql('Expected opening parenthesis.', opening?.offset ?? 0);
  }
  let depth = 0;
  for (let index = openingIndex; index < tokens.length; index += 1) {
    const token = requiredToken(tokens, index);
    if (token.kind === 'punctuation' && token.value === '(') {
      depth += 1;
    } else if (token.kind === 'punctuation' && token.value === ')') {
      depth -= 1;
      if (depth === 0) {
        return index;
      }
    }
  }
  failSql('Missing closing parenthesis.', opening.offset);
}

class TokenCursor {
  public position = 0;
  private readonly tokens: readonly SqlToken[];

  public constructor(tokens: readonly SqlToken[]) {
    this.tokens = tokens;
  }

  public atEnd(): boolean {
    return this.position >= this.tokens.length;
  }

  public expectEnd(): void {
    if (!this.atEnd()) {
      this.fail('Unexpected trailing SQL tokens.');
    }
  }

  public peekWord(value: string): boolean {
    const token = this.tokens[this.position];
    return token?.kind === 'word' && token.value === value;
  }

  public consumeWord(value: string): boolean {
    if (!this.peekWord(value)) {
      return false;
    }
    this.position += 1;
    return true;
  }

  public consumeWords(values: readonly string[]): boolean {
    if (
      !values.every((value, index) => {
        const token = this.tokens[this.position + index];
        return token?.kind === 'word' && token.value === value;
      })
    ) {
      return false;
    }
    this.position += values.length;
    return true;
  }

  public expectWord(value: string): void {
    if (!this.consumeWord(value)) {
      this.fail(`Expected ${value}.`);
    }
  }

  public expectPunctuation(value: string): void {
    const token = this.tokens[this.position];
    if (token?.kind !== 'punctuation' || token.value !== value) {
      this.fail(`Expected ${value}.`);
    }
    this.position += 1;
  }

  public readIdentifier(): string {
    const token = this.tokens[this.position];
    if (token === undefined) {
      this.fail('Expected identifier.');
    }
    this.position += 1;
    return identifierValue(token);
  }

  public readQualifiedIdentifier(): Readonly<{
    schema: string;
    name: string;
  }> {
    const first = this.readIdentifier();
    const dot = this.tokens[this.position];
    if (dot?.kind === 'punctuation' && dot.value === '.') {
      this.position += 1;
      return {schema: first, name: this.readIdentifier()};
    }
    return {schema: '', name: first};
  }

  public readParenthesizedColumns(): readonly string[] {
    this.expectPunctuation('(');
    const start = this.position;
    const end = matchingClosingParenthesis(this.tokens, start - 1);
    const columns = parseColumnTokens(this.tokens.slice(start, end));
    this.position = end + 1;
    return columns;
  }

  public fail(message: string): never {
    failSql(message, this.tokens[this.position]?.offset ?? 0);
  }
}

function isWord(token: SqlToken | undefined, value: string): boolean {
  return token?.kind === 'word' && token.value === value;
}

function startsWithWords(
  tokens: readonly SqlToken[],
  values: readonly string[],
): boolean {
  return values.every((value, index) => {
    const token = tokens[index];
    return token?.kind === 'word' && token.value === value;
  });
}

function containsVendorSchemaReference(tokens: readonly SqlToken[]): boolean {
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token?.kind !== 'word') {
      continue;
    }
    let candidateIndex: number | undefined;
    if (token.value === 'references' || token.value === 'on') {
      candidateIndex = index + 1;
    } else if (token.value === 'table') {
      candidateIndex = index + 1;
      const optional = tokens.slice(candidateIndex, candidateIndex + 3);
      if (startsWithWords(optional, ['if', 'not', 'exists'])) {
        candidateIndex += 3;
      }
    }
    if (candidateIndex === undefined) {
      continue;
    }
    const schema = tokens[candidateIndex];
    const dot = tokens[candidateIndex + 1];
    if (
      (schema?.kind === 'word' || schema?.kind === 'quoted_identifier') &&
      (schema.value === 'pg_boss' || schema.value === 'pgboss') &&
      dot?.kind === 'punctuation' &&
      dot.value === '.'
    ) {
      return true;
    }
  }
  return false;
}

function canonicalTokens(tokens: readonly SqlToken[]): string {
  return tokens.map(canonicalToken).join(' ');
}

function canonicalToken(token: SqlToken): string {
  if (token.kind === 'escape_string') {
    return `escape_string:${JSON.stringify(token.value)}`;
  }
  if (token.kind === 'string') {
    return JSON.stringify(token.value);
  }
  if (token.kind === 'quoted_identifier') {
    return `identifier:${JSON.stringify(token.value)}`;
  }
  return token.value;
}

function identifierValue(token: SqlToken): string {
  if (token.kind !== 'word' && token.kind !== 'quoted_identifier') {
    failSql('Expected SQL identifier.', token.offset);
  }
  return token.value;
}

function requiredToken(tokens: readonly SqlToken[], index: number): SqlToken {
  const token = tokens[index];
  if (token === undefined) {
    failSql('Required SQL token is missing.', tokens.at(-1)?.offset ?? 0);
  }
  return token;
}

function skipLineComment(sql: string, offset: number): number {
  let cursor = offset;
  while (cursor < sql.length && sql[cursor] !== '\n') {
    cursor += 1;
  }
  return cursor;
}

function skipBlockComment(sql: string, offset: number): number {
  let cursor = offset + 2;
  let depth = 1;
  while (cursor < sql.length) {
    if (sql[cursor] === '/' && sql[cursor + 1] === '*') {
      depth += 1;
      cursor += 2;
      continue;
    }
    if (sql[cursor] === '*' && sql[cursor + 1] === '/') {
      depth -= 1;
      cursor += 2;
      if (depth === 0) {
        return cursor;
      }
      continue;
    }
    cursor += 1;
  }
  failSql('Unterminated block comment.', offset);
}

function readSingleQuotedString(
  sql: string,
  quoteOffset: number,
  backslashEscapes: boolean,
): Readonly<{value: string; nextOffset: number}> {
  let cursor = quoteOffset + 1;
  let value = '';
  while (cursor < sql.length) {
    const current = sql[cursor];
    if (current === undefined) {
      break;
    }
    if (current === "'") {
      if (sql[cursor + 1] === "'") {
        value += "'";
        cursor += 2;
        continue;
      }
      return {value, nextOffset: cursor + 1};
    }
    if (backslashEscapes && current === '\\' && cursor + 1 < sql.length) {
      const escaped = sql[cursor + 1];
      if (escaped === undefined) {
        break;
      }
      const decoded = POSTGRES_ESCAPE_CHARACTERS.get(escaped);
      if (decoded === undefined) {
        failSql('Unsupported PostgreSQL escape-string sequence.', cursor);
      }
      value += decoded;
      cursor += 2;
      continue;
    }
    value += current;
    cursor += 1;
  }
  failSql('Unterminated SQL string.', quoteOffset);
}

const POSTGRES_ESCAPE_CHARACTERS = new Map<string, string>([
  ['\\', '\\'],
  ["'", "'"],
  ['b', '\b'],
  ['f', '\f'],
  ['n', '\n'],
  ['r', '\r'],
  ['t', '\t'],
]);

function readQuotedIdentifier(
  sql: string,
  quoteOffset: number,
): Readonly<{value: string; nextOffset: number}> {
  let cursor = quoteOffset + 1;
  let value = '';
  while (cursor < sql.length) {
    const current = sql[cursor];
    if (current === undefined) {
      break;
    }
    if (current === '"') {
      if (sql[cursor + 1] === '"') {
        value += '"';
        cursor += 2;
        continue;
      }
      return {value, nextOffset: cursor + 1};
    }
    value += current;
    cursor += 1;
  }
  failSql('Unterminated quoted identifier.', quoteOffset);
}

function readDollarQuotedString(
  sql: string,
  offset: number,
): Readonly<{value: string; nextOffset: number}> | undefined {
  const tag = /^\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$/u.exec(sql.slice(offset))?.[0];
  if (tag === undefined) {
    return undefined;
  }
  const bodyStart = offset + tag.length;
  const bodyEnd = sql.indexOf(tag, bodyStart);
  if (bodyEnd === -1) {
    failSql('Unterminated dollar-quoted string.', offset);
  }
  return {
    value: sql.slice(bodyStart, bodyEnd),
    nextOffset: bodyEnd + tag.length,
  };
}

function longestOperatorAt(sql: string, offset: number): string | undefined {
  for (const operator of [
    '!~*',
    '::',
    '>=',
    '<=',
    '<>',
    '!=',
    '!~',
    '~*',
    '||',
    '&&',
    '=',
    '>',
    '<',
    '~',
    '+',
    '-',
    '*',
    '/',
  ]) {
    if (sql.startsWith(operator, offset)) {
      return operator;
    }
  }
  return undefined;
}

function isTokenBoundary(value: string | undefined): boolean {
  return value === undefined || !/[A-Za-z0-9_$]/u.test(value);
}

function failSql(message: string, offset: number): never {
  throw new SourceEvidenceSqlLexicalError(message, offset);
}
