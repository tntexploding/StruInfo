import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';

import {describe, expect, it, vi} from 'vitest';

import {
  ASSESSMENT_DIMENSIONS,
  CURATION_LIMITS,
  INTAKE_ACTIONS,
  INTAKE_FEEDBACK_REASONS,
  mapCurationPersistenceFailure,
  prepareApplyManualCuration,
  preparePutContentClassificationTerm,
  resultForCommittedTargetPlan,
  resultForCommittedTermPlan,
} from '../apps/server/src/modules/curation/index.js';
import {
  CURATION_ASSESSMENT_GROUPS,
  CURATION_CANONICAL_PROJECTION_ORACLES,
  CURATION_CONTRACT_ORACLE,
  CURATION_DDL_SEMANTIC_ORACLE,
  CURATION_EXACT_ISSUE_ORACLES,
  CURATION_LIMIT_ORACLE,
  CURATION_RESULT_SHAPE_ORACLE,
  CURATION_UUID_KNOWN_ANSWERS,
  MIXED_COMMAND_PROJECTION,
  MIXED_COMMAND_REVERSED_OPERATIONS_PROJECTION,
  MIXED_COMMAND_REVERSED_REASONS_PROJECTION,
  TERM_COMMAND_PROJECTION_WITH_DESCRIPTION,
  TERM_COMMAND_PROJECTION_WITHOUT_DESCRIPTION,
} from '../tests/fixtures/curation/frozen_curation_oracles.js';
import {
  CURATION_SYNTHETIC_IDS,
  F_CUR_ACTIONS,
  F_CUR_ASSESS,
  F_CUR_ASSIGN_64,
  F_CUR_BUDGET,
  F_CUR_DDL_ANTISPOOF,
  F_CUR_DDL_MUT,
  F_CUR_HOSTILE,
  F_CUR_MIXED,
  F_CUR_REASON_11_DUP,
  F_CUR_REASON_11_ENUM,
  F_CUR_REPLAY,
  F_CUR_RESULTS,
  F_CUR_TERM_GRAPH,
  F_CUR_UNICODE,
  F_CUR_UUID_SPELLINGS,
  SYNTHETIC_ASSESSMENT_DIMENSIONS,
  SYNTHETIC_INTAKE_ACTIONS,
  SYNTHETIC_INTAKE_REASONS,
  createAccessorContext,
  createArrayAccessorOperations,
  createClosedInputAttackCounter,
  createCyclicTermRequest,
  createDangerousKeyTermRequest,
  createEmptyCurationState,
  createEvidenceCurationState,
  createProxyRequest,
  createSparseOperations,
  createSymbolKeyTermRequest,
  createSyntheticContext,
  createSyntheticTargetRequest,
  createSyntheticTermRequest,
  type SyntheticSqlToken,
} from '../tests/fixtures/curation/synthetic_curation_fixtures.js';

const textEncoder = new TextEncoder();
const migrationUrl = new URL(
  '../apps/server/migrations/000003_create_manual_curation_schema.sql',
  import.meta.url,
);

function sha256(value: Uint8Array | string): string {
  return createHash('sha256')
    .update(typeof value === 'string' ? textEncoder.encode(value) : value)
    .digest('hex');
}

function uuidBytes(uuid: string): Uint8Array {
  return Uint8Array.from(Buffer.from(uuid.replaceAll('-', ''), 'hex'));
}

function independentUuidV5(namespace: string, name: string): string {
  const digest = createHash('sha1')
    .update(uuidBytes(namespace))
    .update(textEncoder.encode(name))
    .digest()
    .subarray(0, 16);
  const versionByte = digest[6];
  const variantByte = digest[8];
  if (versionByte === undefined || variantByte === undefined) {
    throw new RangeError('Independent UUIDv5 digest was too short.');
  }
  digest[6] = (versionByte & 0x0f) | 0x50;
  digest[8] = (variantByte & 0x3f) | 0x80;
  const hex = digest.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(
    12,
    16,
  )}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => canonicalize(item));
  }
  if (value !== null && typeof value === 'object') {
    const record = value as Readonly<Record<string, unknown>>;
    return Object.fromEntries(
      Object.keys(record)
        .sort()
        .map((key) => [key, canonicalize(record[key])]),
    );
  }
  return value;
}

function encodeIndependentCanonicalJson(value: unknown): Uint8Array {
  return textEncoder.encode(`${JSON.stringify(canonicalize(value))}\n`);
}

function digestProjection(value: unknown): Readonly<{
  bytes: number;
  sha256: string;
}> {
  const bytes = encodeIndependentCanonicalJson(value);
  return Object.freeze({bytes: bytes.byteLength, sha256: sha256(bytes)});
}

function requirePreparedTerm(
  preparation: ReturnType<typeof preparePutContentClassificationTerm>,
) {
  expect(preparation.kind).toBe('prepared');
  if (preparation.kind !== 'prepared') {
    throw new Error('Expected a prepared term plan.');
  }
  return preparation.plan;
}

function requirePreparedTarget(
  preparation: ReturnType<typeof prepareApplyManualCuration>,
) {
  expect(preparation.kind).toBe('prepared');
  if (preparation.kind !== 'prepared') {
    throw new Error('Expected a prepared target plan.');
  }
  return preparation.plan;
}

function expectedIssue(
  code: string,
  path: string,
  budget?: string,
): Readonly<Record<string, unknown>> {
  return {
    kind: 'resolved',
    result: {
      status: 'rejected',
      issue: budget === undefined ? {code, path} : {code, path, budget},
    },
  };
}

function termRevisionId(termId: string, revision: number): string {
  return independentUuidV5(
    termId,
    `struinfo:vocabulary-term-revision:v1:${String(revision)}`,
  );
}

function targetId(
  workspaceId = CURATION_SYNTHETIC_IDS.workspaceA,
  kind: 'snapshot' | 'fragment' = 'fragment',
  identity = CURATION_SYNTHETIC_IDS.fragment,
): string {
  return independentUuidV5(
    workspaceId,
    `struinfo:curation-target:v1:${kind}:${identity}`,
  );
}

function termState(
  termId: string,
  revision = 1,
  lifecycle: 'active' | 'retired' = 'active',
  parentTermId?: string,
  workspaceId = CURATION_SYNTHETIC_IDS.workspaceA,
): Record<string, unknown> {
  return {
    workspaceId,
    termId,
    currentRevision: revision,
    currentRevisionId: termRevisionId(termId, revision),
    value: {
      displayName: `synthetic-${termId.slice(-4)}`,
      ...(parentTermId === undefined ? {} : {parentTermId}),
      lifecycle,
    },
  };
}

function stateWithTerms(
  terms: readonly unknown[],
  includeEvidence = false,
): Record<string, unknown[]> {
  return {
    ...(includeEvidence
      ? createEvidenceCurationState()
      : createEmptyCurationState()),
    terms: [...terms],
  };
}

function stateWithCurrentTarget(
  terms: readonly unknown[] = [],
  currentVersion = 1,
): Record<string, unknown[]> {
  return {
    ...stateWithTerms(terms, true),
    targets: [
      {
        workspaceId: CURATION_SYNTHETIC_IDS.workspaceA,
        kind: 'fragment',
        fragmentId: CURATION_SYNTHETIC_IDS.fragment,
        targetId: targetId(),
        currentVersion,
      },
    ],
  };
}

function assignmentId(termId: string): string {
  return independentUuidV5(
    targetId(),
    `struinfo:classification-assignment:v1:${termId}`,
  );
}

function assignmentRevisionId(id: string, revision: number): string {
  return independentUuidV5(
    id,
    `struinfo:classification-assignment-revision:v1:${String(revision)}`,
  );
}

function assignedState(
  terms: readonly Record<string, unknown>[],
  count: number,
): Record<string, unknown[]> {
  const base = stateWithCurrentTarget(terms);
  return {
    ...base,
    assignments: terms.slice(0, count).map((term) => {
      const id = assignmentId(String(term.termId));
      return {
        workspaceId: CURATION_SYNTHETIC_IDS.workspaceA,
        assignmentId: id,
        targetId: targetId(),
        termId: term.termId,
        currentRevision: 1,
        currentRevisionId: assignmentRevisionId(id, 1),
        state: 'assigned',
        termRevisionNumber: 1,
        termRevisionId: term.currentRevisionId,
      };
    }),
  };
}

function stateWithDecision(
  value: Readonly<Record<string, unknown>>,
  revision = 1,
): Record<string, unknown[]> {
  const currentTargetId = targetId();
  const id = independentUuidV5(currentTargetId, 'struinfo:intake-decision:v1');
  return {
    ...stateWithCurrentTarget([], revision),
    decisions: [
      {
        workspaceId: CURATION_SYNTHETIC_IDS.workspaceA,
        decisionId: id,
        targetId: currentTargetId,
        currentRevision: revision,
        currentRevisionId: independentUuidV5(
          id,
          `struinfo:intake-decision-revision:v1:${String(revision)}`,
        ),
        value: {...value},
      },
    ],
  };
}

function stateWithAssessment(
  value: Readonly<Record<string, unknown>>,
  revision = 1,
): Record<string, unknown[]> {
  const currentTargetId = targetId();
  const id = independentUuidV5(
    currentTargetId,
    'struinfo:assessment:v1:freshness',
  );
  return {
    ...stateWithCurrentTarget([], revision),
    assessments: [
      {
        workspaceId: CURATION_SYNTHETIC_IDS.workspaceA,
        assessmentId: id,
        targetId: currentTargetId,
        dimension: 'freshness',
        currentRevision: revision,
        currentRevisionId: independentUuidV5(
          id,
          `struinfo:assessment-revision:v1:${String(revision)}`,
        ),
        value: {...value},
      },
    ],
  };
}

function sortedKeys(value: object): string[] {
  return Object.keys(value).sort();
}

function replaceFirstUuidLeaf(
  value: unknown,
  key: string,
  replacement: string,
): boolean {
  if (value === null || typeof value !== 'object') {
    return false;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      if (replaceFirstUuidLeaf(item, key, replacement)) {
        return true;
      }
    }
    return false;
  }
  const record = value as Record<string, unknown>;
  for (const ownKey of Object.keys(record)) {
    if (ownKey === key && typeof record[ownKey] === 'string') {
      record[ownKey] = replacement;
      return true;
    }
    if (replaceFirstUuidLeaf(record[ownKey], key, replacement)) {
      return true;
    }
  }
  return false;
}

function isDeepFrozen(value: unknown): boolean {
  if (value === null || typeof value !== 'object') {
    return true;
  }
  if (!Object.isFrozen(value)) {
    return false;
  }
  return Object.values(value).every((child) => isDeepFrozen(child));
}

interface TestSqlToken extends SyntheticSqlToken {
  readonly offset: number;
  readonly end: number;
}

interface TestDdlColumnShape {
  readonly name: string;
  readonly type: string;
  readonly nullable: boolean;
  readonly defaultExpression?: string;
}

interface TestDdlForeignKeyShape {
  readonly localColumns: readonly string[];
  readonly targetTable: string;
  readonly targetColumns: readonly string[];
  readonly deferrable: boolean;
}

interface TestDdlTableShape {
  readonly columns: readonly TestDdlColumnShape[];
  readonly primaryKeys: readonly (readonly string[])[];
  readonly uniqueKeys: readonly (readonly string[])[];
  readonly foreignKeys: readonly TestDdlForeignKeyShape[];
  readonly checks: readonly string[];
}

interface TestDdlIndexShape {
  readonly table: string;
  readonly columns: readonly string[];
  readonly unique: boolean;
  readonly predicate?: string;
}

interface TestDdlShape {
  readonly tables: ReadonlyMap<string, TestDdlTableShape>;
  readonly indexes: readonly TestDdlIndexShape[];
}

const CLOSED_TEST_BUILTIN_TYPES: ReadonlySet<string> = new Set([
  'uuid',
  'text',
  'integer',
  'timestamp with time zone',
]);

class TestSqlAuditError extends Error {
  public readonly offset: number;

  public constructor(message: string, offset: number) {
    super(message);
    this.name = 'TestSqlAuditError';
    this.offset = offset;
  }
}

interface MutableTestDdlTable {
  readonly columns: TestDdlColumnShape[];
  readonly primaryKeys: string[][];
  readonly uniqueKeys: string[][];
  readonly foreignKeys: TestDdlForeignKeyShape[];
  readonly checks: string[];
}

function failSql(message: string, offset: number): never {
  throw new TestSqlAuditError(message, offset);
}

function readTestQuotedToken(
  sql: string,
  start: number,
  quote: "'" | '"',
  kind: 'string' | 'escape_string' | 'quoted_identifier',
): Readonly<{token: TestSqlToken; nextOffset: number}> {
  let offset = start + 1;
  let value = '';
  while (offset < sql.length) {
    const current = sql[offset];
    if (current === quote) {
      if (sql[offset + 1] === quote) {
        value += quote;
        offset += 2;
        continue;
      }
      const end = offset + 1;
      return {token: {kind, value, offset: start, end}, nextOffset: end};
    }
    if (kind === 'escape_string' && current === '\\') {
      const escaped = sql[offset + 1];
      if (escaped === undefined) {
        failSql('Unterminated E-string escape.', offset);
      }
      value += `\\${escaped}`;
      offset += 2;
      continue;
    }
    value += current ?? '';
    offset += 1;
  }
  failSql('Unterminated SQL quoted token.', start);
}

function tokenizeTestSql(sql: string): readonly TestSqlToken[] {
  const tokens: TestSqlToken[] = [];
  let offset = 0;
  while (offset < sql.length) {
    const current = sql[offset];
    const next = sql[offset + 1];
    if (current === undefined) break;
    if (/\s/u.test(current)) {
      offset += 1;
      continue;
    }
    if (current === '-' && next === '-') {
      offset += 2;
      while (offset < sql.length && sql[offset] !== '\n') offset += 1;
      continue;
    }
    if (current === '/' && next === '*') {
      const start = offset;
      offset += 2;
      let depth = 1;
      while (offset < sql.length && depth > 0) {
        if (sql.startsWith('/*', offset)) {
          depth += 1;
          offset += 2;
        } else if (sql.startsWith('*/', offset)) {
          depth -= 1;
          offset += 2;
        } else {
          offset += 1;
        }
      }
      if (depth !== 0) failSql('Unterminated block comment.', start);
      continue;
    }
    if ((current === 'E' || current === 'e') && next === "'") {
      const parsed = readTestQuotedToken(sql, offset + 1, "'", 'escape_string');
      tokens.push({...parsed.token, offset, end: parsed.nextOffset});
      offset = parsed.nextOffset;
      continue;
    }
    if (current === "'") {
      const parsed = readTestQuotedToken(sql, offset, "'", 'string');
      tokens.push(parsed.token);
      offset = parsed.nextOffset;
      continue;
    }
    if (current === '"') {
      const parsed = readTestQuotedToken(sql, offset, '"', 'quoted_identifier');
      tokens.push(parsed.token);
      offset = parsed.nextOffset;
      continue;
    }
    if (/[A-Za-z_]/u.test(current)) {
      const start = offset;
      offset += 1;
      while (/[A-Za-z0-9_$]/u.test(sql[offset] ?? '')) offset += 1;
      tokens.push({
        kind: 'word',
        value: sql.slice(start, offset).toLowerCase(),
        offset: start,
        end: offset,
      });
      continue;
    }
    if (/[0-9]/u.test(current)) {
      const start = offset;
      offset += 1;
      while (/[0-9.]/u.test(sql[offset] ?? '')) offset += 1;
      tokens.push({
        kind: 'number',
        value: sql.slice(start, offset),
        offset: start,
        end: offset,
      });
      continue;
    }
    if ('(),.;'.includes(current)) {
      tokens.push({
        kind: 'punctuation',
        value: current,
        offset,
        end: offset + 1,
      });
      offset += 1;
      continue;
    }
    const operator = ['<>', '>=', '<=', '::', '~', '=', '<', '>'].find(
      (candidate) => sql.startsWith(candidate, offset),
    );
    if (operator !== undefined) {
      tokens.push({
        kind: 'operator',
        value: operator,
        offset,
        end: offset + operator.length,
      });
      offset += operator.length;
      continue;
    }
    failSql('Unsupported SQL character.', offset);
  }
  return tokens;
}

function sqlTokenAt(
  tokens: readonly TestSqlToken[],
  index: number,
): TestSqlToken {
  const token = tokens[index];
  if (token === undefined) {
    failSql('Required SQL token is missing.', tokens.at(-1)?.end ?? 0);
  }
  return token;
}

function isSqlWord(token: TestSqlToken | undefined, value: string): boolean {
  return token?.kind === 'word' && token.value === value;
}

function sqlWordsAt(
  tokens: readonly TestSqlToken[],
  start: number,
  words: readonly string[],
): boolean {
  return words.every((word, index) => isSqlWord(tokens[start + index], word));
}

function splitSqlStatements(
  tokens: readonly TestSqlToken[],
): readonly (readonly TestSqlToken[])[] {
  const statements: TestSqlToken[][] = [];
  let current: TestSqlToken[] = [];
  let depth = 0;
  for (const token of tokens) {
    if (token.value === '(') depth += 1;
    if (token.value === ')') depth -= 1;
    if (depth < 0) failSql('Unbalanced closing parenthesis.', token.offset);
    if (token.value === ';' && depth === 0) {
      if (current.length === 0) failSql('Empty SQL statement.', token.offset);
      statements.push(current);
      current = [];
    } else {
      current.push(token);
    }
  }
  if (depth !== 0)
    failSql('Unbalanced SQL parentheses.', tokens.at(-1)?.end ?? 0);
  if (current.length > 0) {
    failSql(
      'SQL statement lacks a terminating semicolon.',
      current[0]?.offset ?? 0,
    );
  }
  return statements;
}

function matchingSqlClose(
  tokens: readonly TestSqlToken[],
  open: number,
): number {
  let depth = 0;
  for (let index = open; index < tokens.length; index += 1) {
    const token = sqlTokenAt(tokens, index);
    if (token.value === '(') depth += 1;
    if (token.value === ')') {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  failSql('Unbalanced SQL parentheses.', tokens[open]?.offset ?? 0);
}

function splitSqlTopLevel(
  tokens: readonly TestSqlToken[],
  separator: string,
): readonly (readonly TestSqlToken[])[] {
  const segments: TestSqlToken[][] = [];
  let current: TestSqlToken[] = [];
  let depth = 0;
  for (const token of tokens) {
    if (token.value === '(') depth += 1;
    if (token.value === ')') depth -= 1;
    if (token.value === separator && depth === 0) {
      if (current.length === 0) failSql('Empty SQL list member.', token.offset);
      segments.push(current);
      current = [];
    } else {
      current.push(token);
    }
  }
  if (depth !== 0 || current.length === 0) {
    failSql('Malformed SQL list.', tokens[0]?.offset ?? 0);
  }
  segments.push(current);
  return segments;
}

function sqlIdentifier(token: TestSqlToken | undefined): string {
  if (
    token === undefined ||
    (token.kind !== 'word' && token.kind !== 'quoted_identifier')
  ) {
    failSql('Expected SQL identifier.', token?.offset ?? 0);
  }
  return token.value;
}

function sqlQualifiedName(tokens: readonly TestSqlToken[]): string {
  if (tokens.length === 1) return sqlIdentifier(tokens[0]);
  if (tokens.length === 3 && tokens[1]?.value === '.') {
    return `${sqlIdentifier(tokens[0])}.${sqlIdentifier(tokens[2])}`;
  }
  failSql('Malformed qualified identifier.', tokens[0]?.offset ?? 0);
}

function parseSqlIdentifierList(
  tokens: readonly TestSqlToken[],
): readonly string[] {
  return splitSqlTopLevel(tokens, ',').map((segment) => {
    if (segment.length !== 1) {
      failSql(
        'Only simple key/index columns are admitted.',
        segment[0]?.offset ?? 0,
      );
    }
    return sqlIdentifier(segment[0]);
  });
}

function canonicalSqlToken(
  token: Pick<TestSqlToken, 'kind' | 'value'>,
): string {
  if (token.kind === 'quoted_identifier') return `identifier:${token.value}`;
  if (token.kind === 'string') return `'${token.value.replaceAll("'", "''")}'`;
  if (token.kind === 'escape_string') {
    return `E'${token.value.replaceAll("'", "''")}'`;
  }
  return token.value.toUpperCase();
}

function canonicalSqlExpression(tokens: readonly TestSqlToken[]): string {
  let result = '';
  let previous: TestSqlToken | undefined;
  for (const token of tokens) {
    const rendered = canonicalSqlToken(token);
    const needsSpace =
      previous !== undefined &&
      token.value !== ')' &&
      token.value !== ',' &&
      token.value !== ';' &&
      token.value !== '.' &&
      previous.value !== '(' &&
      previous.value !== '.';
    if (needsSpace) {
      result += ' ';
    }
    result += rendered;
    previous = token;
  }
  return result;
}

function parseSqlParenthesizedExpression(
  tokens: readonly TestSqlToken[],
  open: number,
): string {
  if (tokens[open]?.value !== '(') {
    failSql('Expected parenthesized expression.', tokens[open]?.offset ?? 0);
  }
  const close = matchingSqlClose(tokens, open);
  if (close !== tokens.length - 1) {
    failSql(
      'Unexpected trailing expression tokens.',
      tokens[close + 1]?.offset ?? 0,
    );
  }
  return canonicalSqlExpression(tokens.slice(open + 1, close));
}

function parseSqlColumnsAfter(
  tokens: readonly TestSqlToken[],
  open: number,
): readonly string[] {
  if (tokens[open]?.value !== '(') {
    failSql('Expected key column list.', tokens[open]?.offset ?? 0);
  }
  const close = matchingSqlClose(tokens, open);
  if (close !== tokens.length - 1) {
    failSql('Unsupported key suffix.', tokens[close + 1]?.offset ?? 0);
  }
  return parseSqlIdentifierList(tokens.slice(open + 1, close));
}

function parseTestForeignKey(
  declaration: readonly TestSqlToken[],
): TestDdlForeignKeyShape {
  if (!sqlWordsAt(declaration, 0, ['foreign', 'key'])) {
    failSql('Expected FOREIGN KEY.', declaration[0]?.offset ?? 0);
  }
  const localOpen = declaration.findIndex((token) => token.value === '(');
  if (localOpen !== 2)
    failSql('Malformed FOREIGN KEY.', declaration[0]?.offset ?? 0);
  const localClose = matchingSqlClose(declaration, localOpen);
  if (!isSqlWord(declaration[localClose + 1], 'references')) {
    failSql(
      'FOREIGN KEY lacks REFERENCES.',
      declaration[localClose + 1]?.offset ?? 0,
    );
  }
  const targetOpen = declaration.findIndex(
    (token, index) => index > localClose + 1 && token.value === '(',
  );
  if (targetOpen < 0)
    failSql('REFERENCES lacks target columns.', declaration[0]?.offset ?? 0);
  const targetClose = matchingSqlClose(declaration, targetOpen);
  const suffix = declaration.slice(targetClose + 1);
  const deferrable =
    suffix.length === 3 &&
    sqlWordsAt(suffix, 0, ['deferrable', 'initially', 'deferred']);
  if (suffix.length > 0 && !deferrable) {
    failSql('Unsupported FOREIGN KEY suffix.', suffix[0]?.offset ?? 0);
  }
  return {
    localColumns: parseSqlIdentifierList(
      declaration.slice(localOpen + 1, localClose),
    ),
    targetTable: sqlQualifiedName(
      declaration.slice(localClose + 2, targetOpen),
    ),
    targetColumns: parseSqlIdentifierList(
      declaration.slice(targetOpen + 1, targetClose),
    ),
    deferrable,
  };
}

function newMutableTestTable(): MutableTestDdlTable {
  return {
    columns: [],
    primaryKeys: [],
    uniqueKeys: [],
    foreignKeys: [],
    checks: [],
  };
}

function isTestColumnConstraintStart(
  tokens: readonly TestSqlToken[],
  index: number,
): boolean {
  return (
    sqlWordsAt(tokens, index, ['not', 'null']) ||
    sqlWordsAt(tokens, index, ['default']) ||
    sqlWordsAt(tokens, index, ['check']) ||
    sqlWordsAt(tokens, index, ['references']) ||
    sqlWordsAt(tokens, index, ['primary', 'key']) ||
    sqlWordsAt(tokens, index, ['unique']) ||
    sqlWordsAt(tokens, index, ['constraint'])
  );
}

function nextTestColumnConstraint(
  tokens: readonly TestSqlToken[],
  start: number,
): number {
  let depth = 0;
  for (let index = start; index < tokens.length; index += 1) {
    const token = sqlTokenAt(tokens, index);
    if (token.value === '(') depth += 1;
    if (token.value === ')') depth -= 1;
    if (depth === 0 && isTestColumnConstraintStart(tokens, index)) return index;
  }
  return tokens.length;
}

function parseClosedTestBuiltinType(tokens: readonly TestSqlToken[]): string {
  for (const token of tokens) {
    if (token.kind !== 'word') {
      failSql('Only unquoted built-in type words are admitted.', token.offset);
    }
  }
  const type = tokens.map((token) => token.value).join(' ');
  if (!CLOSED_TEST_BUILTIN_TYPES.has(type)) {
    failSql('Unsupported column type.', tokens[0]?.offset ?? 0);
  }
  return type;
}

function parseTestColumn(
  segment: readonly TestSqlToken[],
  table: MutableTestDdlTable,
): void {
  const name = sqlIdentifier(segment[0]);
  if (table.columns.some((column) => column.name === name)) {
    failSql('Duplicate column declaration.', segment[0]?.offset ?? 0);
  }
  let position = 1;
  const typeTokens: TestSqlToken[] = [];
  while (
    position < segment.length &&
    !isTestColumnConstraintStart(segment, position)
  ) {
    typeTokens.push(sqlTokenAt(segment, position));
    position += 1;
  }
  if (typeTokens.length === 0)
    failSql('Column type is missing.', segment[0]?.offset ?? 0);
  let nullable = true;
  let defaultExpression: string | undefined;
  while (position < segment.length) {
    if (sqlWordsAt(segment, position, ['not', 'null'])) {
      nullable = false;
      position += 2;
      continue;
    }
    if (sqlWordsAt(segment, position, ['default'])) {
      const start = position + 1;
      position = nextTestColumnConstraint(segment, start);
      if (position === start)
        failSql('DEFAULT expression is empty.', segment[start]?.offset ?? 0);
      defaultExpression = canonicalSqlExpression(
        segment.slice(start, position),
      );
      continue;
    }
    failSql(
      'Inline column constraints are not admitted.',
      segment[position]?.offset ?? 0,
    );
  }
  table.columns.push({
    name,
    type: parseClosedTestBuiltinType(typeTokens),
    nullable,
    ...(defaultExpression === undefined ? {} : {defaultExpression}),
  });
}

function parseTestTableSegment(
  segment: readonly TestSqlToken[],
  table: MutableTestDdlTable,
): void {
  let declaration = segment;
  if (sqlWordsAt(segment, 0, ['constraint'])) {
    if (segment.length < 3)
      failSql('Incomplete named constraint.', segment[0]?.offset ?? 0);
    sqlIdentifier(segment[1]);
    declaration = segment.slice(2);
  }
  if (sqlWordsAt(declaration, 0, ['primary', 'key'])) {
    table.primaryKeys.push([...parseSqlColumnsAfter(declaration, 2)]);
    return;
  }
  if (sqlWordsAt(declaration, 0, ['unique'])) {
    table.uniqueKeys.push([...parseSqlColumnsAfter(declaration, 1)]);
    return;
  }
  if (sqlWordsAt(declaration, 0, ['foreign', 'key'])) {
    table.foreignKeys.push(parseTestForeignKey(declaration));
    return;
  }
  if (sqlWordsAt(declaration, 0, ['check'])) {
    table.checks.push(parseSqlParenthesizedExpression(declaration, 1));
    return;
  }
  parseTestColumn(segment, table);
}

function parseTestCreateTable(
  statement: readonly TestSqlToken[],
): readonly [string, MutableTestDdlTable] {
  const open = statement.findIndex((token) => token.value === '(');
  if (open < 3 || statement.at(-1)?.value !== ')') {
    failSql('Malformed CREATE TABLE.', statement[0]?.offset ?? 0);
  }
  const name = sqlQualifiedName(statement.slice(2, open));
  if (!name.startsWith('struinfo.')) {
    failSql('Only struinfo tables are admitted.', statement[2]?.offset ?? 0);
  }
  const table = newMutableTestTable();
  for (const segment of splitSqlTopLevel(statement.slice(open + 1, -1), ',')) {
    parseTestTableSegment(segment, table);
  }
  return [name.slice('struinfo.'.length), table];
}

function parseTestCreateIndex(
  statement: readonly TestSqlToken[],
): TestDdlIndexShape {
  let position = 1;
  const unique = isSqlWord(statement[position], 'unique');
  if (unique) position += 1;
  if (!isSqlWord(statement[position], 'index')) {
    failSql('Malformed CREATE INDEX.', statement[position]?.offset ?? 0);
  }
  sqlIdentifier(statement[position + 1]);
  position += 2;
  if (!isSqlWord(statement[position], 'on')) {
    failSql('CREATE INDEX lacks ON.', statement[position]?.offset ?? 0);
  }
  position += 1;
  const open = statement.findIndex(
    (token, index) => index >= position && token.value === '(',
  );
  if (open < 0)
    failSql('CREATE INDEX lacks columns.', statement[position]?.offset ?? 0);
  const table = sqlQualifiedName(statement.slice(position, open));
  const close = matchingSqlClose(statement, open);
  const columns = parseSqlIdentifierList(statement.slice(open + 1, close));
  position = close + 1;
  let predicate: string | undefined;
  if (position < statement.length) {
    if (!isSqlWord(statement[position], 'where')) {
      failSql(
        'Unsupported CREATE INDEX suffix.',
        statement[position]?.offset ?? 0,
      );
    }
    const predicateTokens = statement.slice(position + 1);
    if (predicateTokens.length === 0)
      failSql('Partial predicate is empty.', statement[position]?.offset ?? 0);
    predicate = canonicalSqlExpression(predicateTokens);
  }
  return {
    table,
    columns,
    unique,
    ...(predicate === undefined ? {} : {predicate}),
  };
}

function parseTestAlterTable(
  statement: readonly TestSqlToken[],
  tables: ReadonlyMap<string, MutableTestDdlTable>,
): void {
  const add = statement.findIndex(
    (token, index) =>
      index >= 2 && token.kind === 'word' && token.value === 'add',
  );
  if (add < 0) failSql('Unsupported ALTER TABLE.', statement[0]?.offset ?? 0);
  const qualified = sqlQualifiedName(statement.slice(2, add));
  if (!qualified.startsWith('struinfo.'))
    failSql('Only struinfo tables are admitted.', statement[2]?.offset ?? 0);
  const table = tables.get(qualified.slice('struinfo.'.length));
  if (table === undefined)
    failSql('ALTER TABLE names unknown table.', statement[2]?.offset ?? 0);
  let declaration = statement.slice(add + 1);
  if (sqlWordsAt(declaration, 0, ['constraint'])) {
    sqlIdentifier(declaration[1]);
    declaration = declaration.slice(2);
  }
  if (!sqlWordsAt(declaration, 0, ['foreign', 'key'])) {
    failSql('Only ADD FOREIGN KEY is admitted.', declaration[0]?.offset ?? 0);
  }
  table.foreignKeys.push(parseTestForeignKey(declaration));
}

function sortStringLists(values: readonly (readonly string[])[]): string[][] {
  return values
    .map((value) => [...value])
    .sort((left, right) =>
      JSON.stringify(left).localeCompare(JSON.stringify(right), 'en'),
    );
}

function normalizeTestTable(table: MutableTestDdlTable): TestDdlTableShape {
  return {
    columns: [...table.columns].sort((left, right) =>
      left.name.localeCompare(right.name, 'en'),
    ),
    primaryKeys: sortStringLists(table.primaryKeys),
    uniqueKeys: sortStringLists(table.uniqueKeys),
    foreignKeys: [...table.foreignKeys].sort((left, right) =>
      JSON.stringify(left).localeCompare(JSON.stringify(right), 'en'),
    ),
    checks: [...table.checks].sort((left, right) =>
      left.localeCompare(right, 'en'),
    ),
  };
}

function analyzeTestOwnedCurationDdl(sql: string): TestDdlShape {
  const tables = new Map<string, MutableTestDdlTable>();
  const indexes: TestDdlIndexShape[] = [];
  const alters: (readonly TestSqlToken[])[] = [];
  for (const statement of splitSqlStatements(tokenizeTestSql(sql))) {
    if (sqlWordsAt(statement, 0, ['create', 'table'])) {
      const [name, table] = parseTestCreateTable(statement);
      if (!Object.hasOwn(CURATION_DDL_SEMANTIC_ORACLE.tables, name)) {
        failSql(
          'CREATE TABLE names an unexpected table.',
          statement[0]?.offset ?? 0,
        );
      }
      if (tables.has(name))
        failSql('Duplicate table.', statement[0]?.offset ?? 0);
      tables.set(name, table);
      continue;
    }
    if (sqlWordsAt(statement, 0, ['alter', 'table'])) {
      alters.push(statement);
      continue;
    }
    if (
      sqlWordsAt(statement, 0, ['create', 'index']) ||
      sqlWordsAt(statement, 0, ['create', 'unique', 'index'])
    ) {
      indexes.push(parseTestCreateIndex(statement));
      continue;
    }
    failSql('Unsupported SQL statement.', statement[0]?.offset ?? 0);
  }
  for (const alter of alters) parseTestAlterTable(alter, tables);
  const normalizedTables = new Map<string, TestDdlTableShape>();
  for (const [name, table] of [...tables].sort(([left], [right]) =>
    left.localeCompare(right, 'en'),
  )) {
    normalizedTables.set(name, normalizeTestTable(table));
  }
  return {
    tables: normalizedTables,
    indexes: [...indexes].sort((left, right) =>
      JSON.stringify(left).localeCompare(JSON.stringify(right), 'en'),
    ),
  };
}

function normalizeDdlOracle(): TestDdlShape {
  const tables = new Map<string, TestDdlTableShape>();
  for (const [name, table] of Object.entries(
    CURATION_DDL_SEMANTIC_ORACLE.tables,
  ).sort(([left], [right]) => left.localeCompare(right, 'en'))) {
    tables.set(name, {
      columns: [...table.columns].sort((left, right) =>
        left.name.localeCompare(right.name, 'en'),
      ),
      primaryKeys: sortStringLists(table.primaryKeys),
      uniqueKeys: sortStringLists(table.uniqueKeys),
      foreignKeys: [...table.foreignKeys].sort((left, right) =>
        JSON.stringify(left).localeCompare(JSON.stringify(right), 'en'),
      ),
      checks: table.checks
        .map((expression) =>
          canonicalSqlExpression(tokenizeTestSql(expression)),
        )
        .sort((left, right) => left.localeCompare(right, 'en')),
    });
  }
  return {
    tables,
    indexes: CURATION_DDL_SEMANTIC_ORACLE.indexes
      .map((index) => ({
        ...index,
        predicate: canonicalSqlExpression(tokenizeTestSql(index.predicate)),
      }))
      .sort((left, right) =>
        JSON.stringify(left).localeCompare(JSON.stringify(right), 'en'),
      ),
  };
}

function isLeadingColumnPrefix(
  candidate: readonly string[],
  declaredKey: readonly string[],
): boolean {
  return (
    candidate.length <= declaredKey.length &&
    candidate.every((column, index) => declaredKey[index] === column)
  );
}

function isAllowedOrdinaryPerformanceIndex(
  index: TestDdlIndexShape,
  expectedTables: ReadonlyMap<string, TestDdlTableShape>,
): boolean {
  if (
    index.unique ||
    index.predicate !== undefined ||
    index.columns.length === 0
  ) {
    return false;
  }
  if (index.columns[0] !== 'workspace_id') return false;
  const schemaPrefix = 'struinfo.';
  if (!index.table.startsWith(schemaPrefix)) return false;
  const table = expectedTables.get(index.table.slice(schemaPrefix.length));
  if (table === undefined) return false;
  const declaredKeys = [
    ...table.primaryKeys,
    ...table.uniqueKeys,
    ...table.foreignKeys.map((foreignKey) => foreignKey.localColumns),
  ];
  return declaredKeys.some((declaredKey) =>
    isLeadingColumnPrefix(index.columns, declaredKey),
  );
}

function testDdlFindingIds(actual: TestDdlShape): readonly string[] {
  const expected = normalizeDdlOracle();
  const findings: string[] = [];
  const tableNames = new Set([
    ...expected.tables.keys(),
    ...actual.tables.keys(),
  ]);
  if (
    JSON.stringify([...actual.tables.keys()].sort()) !==
    JSON.stringify([...expected.tables.keys()].sort())
  ) {
    findings.push('table_set');
  }
  for (const tableName of [...tableNames].sort()) {
    const actualTable = actual.tables.get(tableName);
    const expectedTable = expected.tables.get(tableName);
    if (actualTable === undefined || expectedTable === undefined) continue;
    for (const property of [
      'columns',
      'primaryKeys',
      'uniqueKeys',
      'foreignKeys',
      'checks',
    ] as const) {
      if (
        JSON.stringify(actualTable[property]) !==
        JSON.stringify(expectedTable[property])
      ) {
        findings.push(`${tableName}.${property}`);
      }
    }
  }
  const materialIndexes = actual.indexes.filter(
    (index) => index.unique || index.predicate !== undefined,
  );
  const ordinaryIndexes = actual.indexes.filter(
    (index) => !index.unique && index.predicate === undefined,
  );
  if (
    JSON.stringify(materialIndexes) !== JSON.stringify(expected.indexes) ||
    ordinaryIndexes.some(
      (index) => !isAllowedOrdinaryPerformanceIndex(index, expected.tables),
    )
  ) {
    findings.push('indexes');
  }
  return findings;
}

function sameSyntheticToken(
  actual: Pick<TestSqlToken, 'kind' | 'value'>,
  expected: SyntheticSqlToken,
): boolean {
  return actual.kind === expected.kind && actual.value === expected.value;
}

function tokenSequenceMatches(
  tokens: readonly TestSqlToken[],
  start: number,
  sequence: readonly SyntheticSqlToken[],
): boolean {
  return sequence.every((expected, index) => {
    const actual = tokens[start + index];
    return actual !== undefined && sameSyntheticToken(actual, expected);
  });
}

function tokenSequenceStarts(
  sql: string,
  sequence: readonly SyntheticSqlToken[],
): readonly number[] {
  const tokens = tokenizeTestSql(sql);
  const starts: number[] = [];
  for (let index = 0; index <= tokens.length - sequence.length; index += 1) {
    if (tokenSequenceMatches(tokens, index, sequence)) starts.push(index);
  }
  return starts;
}

function renderSyntheticSqlTokens(
  tokens: readonly SyntheticSqlToken[],
): string {
  return tokens
    .map((token) => {
      if (token.kind === 'string') {
        return `'${token.value.replaceAll("'", "''")}'`;
      }
      if (token.kind === 'escape_string') {
        return `E'${token.value.replaceAll("'", "''")}'`;
      }
      if (token.kind === 'quoted_identifier') {
        return `"${token.value.replaceAll('"', '""')}"`;
      }
      return token.value;
    })
    .join(' ');
}

function replaceUniqueExecutableSequence(
  sql: string,
  from: readonly SyntheticSqlToken[],
  to: readonly SyntheticSqlToken[],
): string {
  const tokens = tokenizeTestSql(sql);
  const starts = tokenSequenceStarts(sql, from);
  if (starts.length !== 1) {
    throw new RangeError(
      `Expected one executable token sequence, found ${String(starts.length)}.`,
    );
  }
  const start = starts[0];
  if (start === undefined)
    throw new RangeError('Executable sequence start is missing.');
  const first = sqlTokenAt(tokens, start);
  const last = sqlTokenAt(tokens, start + from.length - 1);
  return `${sql.slice(0, first.offset)}${renderSyntheticSqlTokens(to)}${sql.slice(last.end)}`;
}

function reformatExecutableTokenPair(
  sql: string,
  left: SyntheticSqlToken,
  right: SyntheticSqlToken,
): string {
  const tokens = tokenizeTestSql(sql);
  const pairs: Readonly<{left: TestSqlToken; right: TestSqlToken}>[] = tokens
    .flatMap((token, index) => {
      const next = tokens[index + 1];
      return next !== undefined &&
        sameSyntheticToken(token, left) &&
        sameSyntheticToken(next, right)
        ? [{left: token, right: next}]
        : [];
    })
    .reverse();
  if (pairs.length === 0) {
    throw new RangeError('Executable formatting token pair is missing.');
  }
  let result = sql;
  for (const pair of pairs) {
    result = `${result.slice(0, pair.left.end)}\n    ${result.slice(pair.right.offset)}`;
  }
  return result;
}

function insertTableConstraint(
  sql: string,
  tableName: string,
  declaration: readonly SyntheticSqlToken[],
): string {
  const tokens = tokenizeTestSql(sql);
  const statements = splitSqlStatements(tokens);
  const statement = statements.find(
    (candidate) =>
      sqlWordsAt(candidate, 0, ['create', 'table']) &&
      candidate.some(
        (token) => token.kind === 'word' && token.value === tableName,
      ),
  );
  if (statement === undefined)
    throw new RangeError(`Table ${tableName} is missing.`);
  const closing = statement.at(-1);
  if (closing?.value !== ')')
    throw new RangeError(`Table ${tableName} closing token is missing.`);
  return `${sql.slice(0, closing.offset)},\n  ${renderSyntheticSqlTokens(declaration)}\n${sql.slice(closing.offset)}`;
}

function reorderFirstTwoTableSegments(sql: string): string {
  const tokens = tokenizeTestSql(sql);
  const statement = splitSqlStatements(tokens)[0];
  if (
    statement === undefined ||
    !sqlWordsAt(statement, 0, ['create', 'table'])
  ) {
    throw new RangeError('First CREATE TABLE is missing.');
  }
  const open = statement.findIndex((token) => token.value === '(');
  const close = matchingSqlClose(statement, open);
  const segments = splitSqlTopLevel(statement.slice(open + 1, close), ',');
  const first = segments[0];
  const second = segments[1];
  if (first === undefined || second === undefined)
    throw new RangeError('Reorder segments are missing.');
  const firstStart = first[0]?.offset;
  const firstEnd = first.at(-1)?.end;
  const secondStart = second[0]?.offset;
  const secondEnd = second.at(-1)?.end;
  if (
    firstStart === undefined ||
    firstEnd === undefined ||
    secondStart === undefined ||
    secondEnd === undefined
  ) {
    throw new RangeError('Reorder offsets are missing.');
  }
  const between = sql.slice(firstEnd, secondStart);
  return `${sql.slice(0, firstStart)}${sql.slice(secondStart, secondEnd)}${between}${sql.slice(firstStart, firstEnd)}${sql.slice(secondEnd)}`;
}

function reorderLastTwoTableConstraints(sql: string): string {
  const tokens = tokenizeTestSql(sql);
  const statement = splitSqlStatements(tokens)[0];
  if (
    statement === undefined ||
    !sqlWordsAt(statement, 0, ['create', 'table'])
  ) {
    throw new RangeError('First CREATE TABLE is missing.');
  }
  const open = statement.findIndex((token) => token.value === '(');
  const close = matchingSqlClose(statement, open);
  const constraints = splitSqlTopLevel(
    statement.slice(open + 1, close),
    ',',
  ).filter((segment) => sqlWordsAt(segment, 0, ['constraint']));
  const first = constraints.at(-2);
  const second = constraints.at(-1);
  if (first === undefined || second === undefined) {
    throw new RangeError('Two constraints are required for reorder.');
  }
  const firstStart = first[0]?.offset;
  const firstEnd = first.at(-1)?.end;
  const secondStart = second[0]?.offset;
  const secondEnd = second.at(-1)?.end;
  if (
    firstStart === undefined ||
    firstEnd === undefined ||
    secondStart === undefined ||
    secondEnd === undefined
  ) {
    throw new RangeError('Constraint reorder offsets are missing.');
  }
  const between = sql.slice(firstEnd, secondStart);
  return `${sql.slice(0, firstStart)}${sql.slice(secondStart, secondEnd)}${between}${sql.slice(firstStart, firstEnd)}${sql.slice(secondEnd)}`;
}

function reorderCreateTableStatements(
  sql: string,
  firstName: string,
  secondName: string,
): string {
  const tokens = tokenizeTestSql(sql);
  const statements = splitSqlStatements(tokens);
  const findStatement = (name: string): readonly TestSqlToken[] => {
    const statement = statements.find(
      (candidate) =>
        sqlWordsAt(candidate, 0, ['create', 'table']) &&
        candidate.some(
          (token) => token.kind === 'word' && token.value === name,
        ),
    );
    if (statement === undefined)
      throw new RangeError(`CREATE TABLE ${name} is missing.`);
    return statement;
  };
  const first = findStatement(firstName);
  const second = findStatement(secondName);
  const firstStart = first[0]?.offset;
  const firstLast = first.at(-1);
  const secondStart = second[0]?.offset;
  const secondLast = second.at(-1);
  if (
    firstStart === undefined ||
    firstLast === undefined ||
    secondStart === undefined ||
    secondLast === undefined ||
    firstStart >= secondStart
  ) {
    throw new RangeError('CREATE TABLE reorder offsets are invalid.');
  }
  const firstSemicolon = tokens.find(
    (token) => token.offset >= firstLast.end && token.value === ';',
  );
  const secondSemicolon = tokens.find(
    (token) => token.offset >= secondLast.end && token.value === ';',
  );
  if (firstSemicolon === undefined || secondSemicolon === undefined) {
    throw new RangeError('CREATE TABLE terminator is missing.');
  }
  const firstEnd = firstSemicolon.end;
  const secondEnd = secondSemicolon.end;
  const firstText = sql.slice(firstStart, firstEnd);
  const middle = sql.slice(firstEnd, secondStart);
  const secondText = sql.slice(secondStart, secondEnd);
  return `${sql.slice(0, firstStart)}${secondText}${middle}${firstText}${sql.slice(secondEnd)}`;
}

describe('independent curation UUID and command identity oracles', () => {
  it('recomputes every frozen UUIDv5 known answer without product helpers', () => {
    const ids = CURATION_SYNTHETIC_IDS;
    const snapshotA1 = targetId(ids.workspaceA, 'snapshot', ids.snapshot1);
    const snapshotA2 = targetId(ids.workspaceA, 'snapshot', ids.snapshot2);
    const fragmentA = targetId(ids.workspaceA, 'fragment', ids.fragment);
    const snapshotB1 = targetId(ids.workspaceB, 'snapshot', ids.snapshot1);
    const fragmentB = targetId(ids.workspaceB, 'fragment', ids.fragment);
    expect(snapshotA1).toBe(CURATION_UUID_KNOWN_ANSWERS.targetSnapshotA1);
    expect(snapshotA2).toBe(CURATION_UUID_KNOWN_ANSWERS.targetSnapshotA2);
    expect(fragmentA).toBe(CURATION_UUID_KNOWN_ANSWERS.targetFragmentA);
    expect(snapshotB1).toBe(CURATION_UUID_KNOWN_ANSWERS.targetSnapshotB1);
    expect(fragmentB).toBe(CURATION_UUID_KNOWN_ANSWERS.targetFragmentB);

    const termARevision1 = termRevisionId(ids.termA, 1);
    const termARevision2 = termRevisionId(ids.termA, 2);
    const termBRevision1 = termRevisionId(ids.termB, 1);
    expect(termARevision1).toBe(CURATION_UUID_KNOWN_ANSWERS.termARevision1);
    expect(termARevision2).toBe(CURATION_UUID_KNOWN_ANSWERS.termARevision2);
    expect(termBRevision1).toBe(CURATION_UUID_KNOWN_ANSWERS.termBRevision1);

    const assignment = assignmentId(ids.termA);
    expect(assignment).toBe(CURATION_UUID_KNOWN_ANSWERS.assignmentA);
    expect(assignmentRevisionId(assignment, 1)).toBe(
      CURATION_UUID_KNOWN_ANSWERS.assignmentARevision1,
    );
    expect(assignmentRevisionId(assignment, 2)).toBe(
      CURATION_UUID_KNOWN_ANSWERS.assignmentARevision2,
    );

    const decision = independentUuidV5(
      fragmentA,
      'struinfo:intake-decision:v1',
    );
    expect(decision).toBe(CURATION_UUID_KNOWN_ANSWERS.decisionA);
    expect(
      independentUuidV5(decision, 'struinfo:intake-decision-revision:v1:1'),
    ).toBe(CURATION_UUID_KNOWN_ANSWERS.decisionARevision1);
    expect(
      independentUuidV5(decision, 'struinfo:intake-decision-revision:v1:2'),
    ).toBe(CURATION_UUID_KNOWN_ANSWERS.decisionARevision2);

    const assessment = independentUuidV5(
      fragmentA,
      'struinfo:assessment:v1:information_density',
    );
    expect(assessment).toBe(
      CURATION_UUID_KNOWN_ANSWERS.informationDensityAssessmentA,
    );
    expect(
      independentUuidV5(assessment, 'struinfo:assessment-revision:v1:1'),
    ).toBe(CURATION_UUID_KNOWN_ANSWERS.informationDensityAssessmentARevision1);
    expect(
      independentUuidV5(assessment, 'struinfo:assessment-revision:v1:2'),
    ).toBe(CURATION_UUID_KNOWN_ANSWERS.informationDensityAssessmentARevision2);

    for (const value of Object.values(CURATION_UUID_KNOWN_ANSWERS)) {
      expect(value).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u,
      );
    }
  });

  it('recomputes all frozen canonical JSON plus LF byte/digest answers', () => {
    expect(digestProjection(TERM_COMMAND_PROJECTION_WITH_DESCRIPTION)).toEqual(
      CURATION_CANONICAL_PROJECTION_ORACLES.termWithDescription,
    );
    expect(
      digestProjection(TERM_COMMAND_PROJECTION_WITHOUT_DESCRIPTION),
    ).toEqual(CURATION_CANONICAL_PROJECTION_ORACLES.termWithoutDescription);
    expect(digestProjection(MIXED_COMMAND_PROJECTION)).toEqual(
      CURATION_CANONICAL_PROJECTION_ORACLES.mixed,
    );
    expect(digestProjection(MIXED_COMMAND_REVERSED_REASONS_PROJECTION)).toEqual(
      CURATION_CANONICAL_PROJECTION_ORACLES.mixedReversedReasons,
    );
    expect(
      digestProjection(MIXED_COMMAND_REVERSED_OPERATIONS_PROJECTION),
    ).toEqual(CURATION_CANONICAL_PROJECTION_ORACLES.mixedReversedOperations);
  });

  it('binds product plans to independent target/digest literals and caller order', () => {
    const termPlan = requirePreparedTerm(
      preparePutContentClassificationTerm(
        createSyntheticContext('synthetic.curation.term.0001'),
        createSyntheticTermRequest(),
        createEmptyCurationState(),
      ),
    );
    expect(termPlan.requestSha256).toBe(
      CURATION_CANONICAL_PROJECTION_ORACLES.termWithDescription.sha256,
    );
    expect(termPlan.termRevisionInsert?.termRevisionId).toBe(
      CURATION_UUID_KNOWN_ANSWERS.termARevision1,
    );

    const targetPlan = requirePreparedTarget(
      prepareApplyManualCuration(
        createSyntheticContext('synthetic.curation.target.0001'),
        createSyntheticTargetRequest([
          F_CUR_MIXED[3],
          F_CUR_MIXED[2],
          F_CUR_MIXED[4],
        ]),
        stateWithTerms([termState(CURATION_SYNTHETIC_IDS.termA)], true),
      ),
    );
    expect(targetPlan.requestSha256).toBe(
      CURATION_CANONICAL_PROJECTION_ORACLES.mixed.sha256,
    );
    expect(targetPlan.receipt.targetId).toBe(
      CURATION_UUID_KNOWN_ANSWERS.targetFragmentA,
    );
  });
});

describe('exact target, vocabulary, assignment, decision, and assessment behavior', () => {
  it('keeps Snapshot and Fragment targets exact, workspace-scoped, and version-specific', () => {
    const snapshot1 = requirePreparedTarget(
      prepareApplyManualCuration(
        createSyntheticContext('synthetic.target.snapshot.1'),
        createSyntheticTargetRequest(
          [{kind: 'clear_assessment', dimension: 'freshness'}],
          {
            target: {
              kind: 'snapshot',
              snapshotId: CURATION_SYNTHETIC_IDS.snapshot1,
            },
          },
        ),
        createEvidenceCurationState(),
      ),
    );
    const snapshot2 = requirePreparedTarget(
      prepareApplyManualCuration(
        createSyntheticContext('synthetic.target.snapshot.2'),
        createSyntheticTargetRequest(
          [{kind: 'clear_assessment', dimension: 'freshness'}],
          {
            target: {
              kind: 'snapshot',
              snapshotId: CURATION_SYNTHETIC_IDS.snapshot2,
            },
          },
        ),
        createEvidenceCurationState(),
      ),
    );
    expect(snapshot1.receipt.targetId).toBe(
      CURATION_UUID_KNOWN_ANSWERS.targetSnapshotA1,
    );
    expect(snapshot2.receipt.targetId).toBe(
      CURATION_UUID_KNOWN_ANSWERS.targetSnapshotA2,
    );
    expect(snapshot2.receipt.targetId).not.toBe(snapshot1.receipt.targetId);
    expect(snapshot1.targetInsert).not.toHaveProperty('fragmentId');
    expect(snapshot2.targetInsert?.currentVersion).toBe(0);

    const snapshot1State = {
      ...createEvidenceCurationState(),
      targets: [
        {
          ...snapshot1.targetInsert,
          currentVersion: 1,
        },
      ],
      decisions: [],
      assessments: [],
      assignments: [],
      terms: [],
      commands: [],
    };
    const snapshot2WithExistingSnapshot1 = requirePreparedTarget(
      prepareApplyManualCuration(
        createSyntheticContext('synthetic.target.snapshot.2.no-inherit'),
        createSyntheticTargetRequest(
          [{kind: 'clear_assessment', dimension: 'freshness'}],
          {
            target: {
              kind: 'snapshot',
              snapshotId: CURATION_SYNTHETIC_IDS.snapshot2,
            },
          },
        ),
        snapshot1State,
      ),
    );
    expect(snapshot2WithExistingSnapshot1.targetInsert?.currentVersion).toBe(0);
    expect(snapshot2WithExistingSnapshot1.receipt.resultingVersion).toBe(0);

    const wrongWorkspace = createEvidenceCurationState();
    const evidenceTargets = wrongWorkspace.evidenceTargets;
    if (evidenceTargets === undefined) {
      throw new RangeError('Synthetic evidence targets are missing.');
    }
    wrongWorkspace.evidenceTargets = evidenceTargets.filter(
      (value) =>
        (value as Readonly<Record<string, unknown>>).workspaceId ===
        CURATION_SYNTHETIC_IDS.workspaceB,
    );
    expect(
      prepareApplyManualCuration(
        createSyntheticContext(
          'synthetic.target.cross-workspace',
          CURATION_SYNTHETIC_IDS.workspaceA,
        ),
        createSyntheticTargetRequest([
          {kind: 'clear_assessment', dimension: 'freshness'},
        ]),
        wrongWorkspace,
      ),
    ).toEqual(expectedIssue('target_not_found', 'request.target'));

    for (const invalidTarget of [
      {kind: 'resource', resourceId: CURATION_SYNTHETIC_IDS.resource},
      {kind: 'fragment'},
      {
        kind: 'fragment',
        fragmentId: CURATION_SYNTHETIC_IDS.fragment,
        snapshotId: CURATION_SYNTHETIC_IDS.snapshot1,
      },
      {
        kind: 'fragment',
        fragmentId: CURATION_SYNTHETIC_IDS.fragment,
        currentAlias: 'synthetic-current',
      },
    ]) {
      const result = prepareApplyManualCuration(
        createSyntheticContext('synthetic.target.invalid'),
        createSyntheticTargetRequest(
          [{kind: 'clear_assessment', dimension: 'freshness'}],
          {target: invalidTarget},
        ),
        createEvidenceCurationState(),
      );
      expect(result.kind).toBe('resolved');
      if (result.kind === 'resolved') {
        expect(result.result.status).toBe('rejected');
        if (result.result.status === 'rejected') {
          expect(result.result.issue.code).toMatch(
            /^(?:invalid_shape|invalid_state)$/u,
          );
          expect(result.result.issue.path.startsWith('request.target')).toBe(
            true,
          );
        }
      }
    }

    for (const rejectedTarget of [
      {kind: 'resource', resourceId: CURATION_SYNTHETIC_IDS.resource},
      {kind: 'url', canonicalUri: 'https://fixture.example.invalid/item'},
      {kind: 'node', nodeKey: 'synthetic-node-key'},
      {kind: 'local_key', localKey: 'synthetic-local-key'},
      {kind: 'heading', heading: 'synthetic-heading'},
      {kind: 'path', path: 'synthetic/path'},
      {kind: 'current', alias: 'synthetic-current'},
    ]) {
      expect(
        prepareApplyManualCuration(
          createSyntheticContext('synthetic.target.not-authorized'),
          createSyntheticTargetRequest(
            [{kind: 'clear_assessment', dimension: 'freshness'}],
            {target: rejectedTarget},
          ),
          createEvidenceCurationState(),
        ),
      ).toEqual(expectedIssue('invalid_shape', 'request.target'));
    }
  });

  it('covers empty vocabulary, create/revise/rename/reparent/retire/reactivate and duplicates', () => {
    const create = requirePreparedTerm(
      preparePutContentClassificationTerm(
        createSyntheticContext('synthetic.term.create'),
        createSyntheticTermRequest(),
        createEmptyCurationState(),
      ),
    );
    expect(create.receipt.resultingRevision).toBe(1);
    expect(create.termIdentityInsert).toBeDefined();

    expect(
      preparePutContentClassificationTerm(
        createSyntheticContext('synthetic.term.retired-create'),
        createSyntheticTermRequest({
          value: {displayName: 'synthetic-label', lifecycle: 'retired'},
        }),
        createEmptyCurationState(),
      ),
    ).toEqual(expectedIssue('invalid_state', 'request.value.lifecycle'));

    const parent = termState(CURATION_SYNTHETIC_IDS.termB);
    const child = termState(CURATION_SYNTHETIC_IDS.termA);
    const rename = requirePreparedTerm(
      preparePutContentClassificationTerm(
        createSyntheticContext('synthetic.term.rename'),
        createSyntheticTermRequest({
          expectedRevision: 1,
          value: {displayName: 'synthetic-renamed', lifecycle: 'active'},
        }),
        stateWithTerms([parent, child]),
      ),
    );
    expect(rename.termRevisionInsert?.revisionNumber).toBe(2);
    expect(rename.termIdentityInsert).toBeUndefined();
    expect(rename.termCurrentPointerCas).toMatchObject({
      expectedRevision: 1,
      nextRevision: 2,
    });
    expect(rename).not.toHaveProperty('classificationChanges');

    const reparent = requirePreparedTerm(
      preparePutContentClassificationTerm(
        createSyntheticContext('synthetic.term.reparent'),
        createSyntheticTermRequest({
          expectedRevision: 1,
          value: {
            displayName: String(
              (child.value as Readonly<Record<string, unknown>>).displayName,
            ),
            parentTermId: CURATION_SYNTHETIC_IDS.termB,
            lifecycle: 'active',
          },
        }),
        stateWithTerms([parent, child]),
      ),
    );
    expect(reparent.outcome).toBe('applied');

    const duplicateName = requirePreparedTerm(
      preparePutContentClassificationTerm(
        createSyntheticContext('synthetic.term.duplicate-name'),
        createSyntheticTermRequest({
          termId: CURATION_SYNTHETIC_IDS.termC,
          value: {
            displayName: String(
              (parent.value as Readonly<Record<string, unknown>>).displayName,
            ),
            lifecycle: 'active',
          },
        }),
        stateWithTerms([parent]),
      ),
    );
    expect(duplicateName.outcome).toBe('applied');

    for (const lifecycle of ['retired', 'active'] as const) {
      const current = termState(
        CURATION_SYNTHETIC_IDS.termA,
        1,
        lifecycle === 'retired' ? 'active' : 'retired',
      );
      const plan = requirePreparedTerm(
        preparePutContentClassificationTerm(
          createSyntheticContext(`synthetic.term.${lifecycle}`),
          createSyntheticTermRequest({
            expectedRevision: 1,
            value: {
              displayName: String(
                (current.value as Readonly<Record<string, unknown>>)
                  .displayName,
              ),
              lifecycle,
            },
          }),
          stateWithTerms([current]),
        ),
      );
      expect(plan.outcome).toBe('applied');
    }
  });

  it('executes the complete retired-parent truth table and hierarchy distinction', () => {
    const retiredParent = termState(CURATION_SYNTHETIC_IDS.termB, 2, 'retired');
    for (const currentLifecycle of ['active', 'retired'] as const) {
      const child = termState(
        CURATION_SYNTHETIC_IDS.termA,
        3,
        currentLifecycle,
        CURATION_SYNTHETIC_IDS.termB,
      );
      const currentValue = child.value as Readonly<Record<string, unknown>>;
      const cases = [
        {id: 'same', value: {...currentValue}, outcome: 'unchanged'},
        {
          id: 'rename',
          value: {...currentValue, displayName: 'synthetic-renamed'},
          outcome: 'applied',
        },
        {
          id: 'lifecycle',
          value: {
            ...currentValue,
            lifecycle: currentLifecycle === 'active' ? 'retired' : 'active',
          },
          outcome: 'applied',
        },
        {
          id: 'root',
          value: {
            displayName: currentValue.displayName,
            lifecycle: currentLifecycle,
          },
          outcome: 'applied',
        },
      ];
      for (const valueCase of cases) {
        const plan = requirePreparedTerm(
          preparePutContentClassificationTerm(
            createSyntheticContext(
              `synthetic.retired-parent.${currentLifecycle}.${valueCase.id}`,
            ),
            createSyntheticTermRequest({
              expectedRevision: 3,
              value: valueCase.value,
            }),
            stateWithTerms([retiredParent, child]),
          ),
        );
        expect(plan.outcome).toBe(valueCase.outcome);
      }
    }

    for (const request of [
      createSyntheticTermRequest({
        termId: CURATION_SYNTHETIC_IDS.termC,
        value: {
          displayName: 'synthetic-created-child',
          parentTermId: CURATION_SYNTHETIC_IDS.termB,
          lifecycle: 'active',
        },
      }),
      createSyntheticTermRequest({
        expectedRevision: 1,
        value: {
          displayName: 'synthetic-reparented-child',
          parentTermId: CURATION_SYNTHETIC_IDS.termB,
          lifecycle: 'active',
        },
      }),
      createSyntheticTermRequest({
        expectedRevision: 1,
        value: {
          displayName: 'synthetic-self-child',
          parentTermId: CURATION_SYNTHETIC_IDS.termA,
          lifecycle: 'active',
        },
      }),
    ]) {
      expect(
        preparePutContentClassificationTerm(
          createSyntheticContext('synthetic.retired-parent.reject'),
          request,
          stateWithTerms([
            retiredParent,
            termState(CURATION_SYNTHETIC_IDS.termA),
          ]),
        ),
      ).toEqual(expectedIssue('invalid_parent', 'request.value.parentTermId'));
    }

    const graph = F_CUR_TERM_GRAPH.activeChain.map((term) =>
      termState(
        term.termId,
        1,
        term.lifecycle,
        'parentTermId' in term && typeof term.parentTermId === 'string'
          ? term.parentTermId
          : undefined,
      ),
    );
    expect(
      preparePutContentClassificationTerm(
        createSyntheticContext('synthetic.hierarchy.cycle'),
        createSyntheticTermRequest({
          termId: CURATION_SYNTHETIC_IDS.termC,
          expectedRevision: 1,
          value: {
            displayName: 'synthetic-cycle',
            parentTermId: CURATION_SYNTHETIC_IDS.termA,
            lifecycle: 'active',
          },
        }),
        stateWithTerms(graph),
      ),
    ).toEqual(expectedIssue('hierarchy_cycle', 'request.value.parentTermId'));
  });

  it('appends exact assignment revisions, binds term revision, and enforces 64 current', () => {
    const terms = F_CUR_ASSIGN_64.map((id) => termState(id));
    const assign = requirePreparedTarget(
      prepareApplyManualCuration(
        createSyntheticContext('synthetic.assignment.create'),
        createSyntheticTargetRequest([
          {kind: 'assign_classification', termId: F_CUR_ASSIGN_64[0]},
        ]),
        stateWithTerms(terms, true),
      ),
    );
    expect(assign.classificationChanges[0]?.revisionInsert).toMatchObject({
      state: 'assigned',
      termRevisionNumber: 1,
      termRevisionId: termRevisionId(String(F_CUR_ASSIGN_64[0]), 1),
    });

    const operationAtLimit = requirePreparedTarget(
      prepareApplyManualCuration(
        createSyntheticContext('synthetic.assignment.operations-at-limit'),
        createSyntheticTargetRequest(
          F_CUR_ASSIGN_64.slice(0, F_CUR_BUDGET.operationAtLimit).map(
            (termId) => ({kind: 'assign_classification', termId}),
          ),
        ),
        stateWithTerms(terms, true),
      ),
    );
    expect(operationAtLimit.classificationChanges).toHaveLength(64);
    expect(operationAtLimit.receipt.resultingVersion).toBe(1);

    const at64 = assignedState(terms, 64);
    expect(
      prepareApplyManualCuration(
        createSyntheticContext('synthetic.assignment.over'),
        createSyntheticTargetRequest(
          [{kind: 'assign_classification', termId: F_CUR_ASSIGN_64[64]}],
          {expectedTargetVersion: 1},
        ),
        at64,
      ),
    ).toEqual(
      expectedIssue(
        'limit_exceeded',
        'request.operations',
        'current_classifications',
      ),
    );
    const balanced = requirePreparedTarget(
      prepareApplyManualCuration(
        createSyntheticContext('synthetic.assignment.balance'),
        createSyntheticTargetRequest(
          [
            {kind: 'assign_classification', termId: F_CUR_ASSIGN_64[64]},
            {kind: 'remove_classification', termId: F_CUR_ASSIGN_64[0]},
          ],
          {expectedTargetVersion: 1},
        ),
        at64,
      ),
    );
    expect(balanced.classificationChanges).toHaveLength(2);

    const retired = termState(CURATION_SYNTHETIC_IDS.termA, 2, 'retired');
    expect(
      prepareApplyManualCuration(
        createSyntheticContext('synthetic.assignment.retired'),
        createSyntheticTargetRequest([
          {
            kind: 'assign_classification',
            termId: CURATION_SYNTHETIC_IDS.termA,
          },
        ]),
        stateWithTerms([retired], true),
      ),
    ).toEqual(expectedIssue('term_retired', 'request.operations[0].termId'));

    const assignedActive = assignedState(
      [termState(CURATION_SYNTHETIC_IDS.termA)],
      1,
    );
    const remove = requirePreparedTarget(
      prepareApplyManualCuration(
        createSyntheticContext('synthetic.assignment.remove'),
        createSyntheticTargetRequest(
          [
            {
              kind: 'remove_classification',
              termId: CURATION_SYNTHETIC_IDS.termA,
            },
          ],
          {expectedTargetVersion: 1},
        ),
        assignedActive,
      ),
    );
    expect(remove.classificationChanges[0]?.revisionInsert).toMatchObject({
      state: 'removed',
      revisionNumber: 2,
      termRevisionNumber: 1,
    });
    expect(remove.receipt.resultingVersion).toBe(2);

    const alreadyAssigned = requirePreparedTarget(
      prepareApplyManualCuration(
        createSyntheticContext('synthetic.assignment.already-current'),
        createSyntheticTargetRequest(
          [
            {
              kind: 'assign_classification',
              termId: CURATION_SYNTHETIC_IDS.termA,
            },
          ],
          {expectedTargetVersion: 1},
        ),
        assignedActive,
      ),
    );
    expect(alreadyAssigned.outcome).toBe('unchanged');
    expect(alreadyAssigned.classificationChanges).toEqual([]);

    const retiredAssigned = assignedState(
      [termState(CURATION_SYNTHETIC_IDS.termA, 1, 'retired')],
      1,
    );
    expect(
      prepareApplyManualCuration(
        createSyntheticContext('synthetic.assignment.retired-current'),
        createSyntheticTargetRequest(
          [
            {
              kind: 'assign_classification',
              termId: CURATION_SYNTHETIC_IDS.termA,
            },
          ],
          {expectedTargetVersion: 1},
        ),
        retiredAssigned,
      ),
    ).toEqual(expectedIssue('term_retired', 'request.operations[0].termId'));
    const removeRetired = requirePreparedTarget(
      prepareApplyManualCuration(
        createSyntheticContext('synthetic.assignment.remove-retired'),
        createSyntheticTargetRequest(
          [
            {
              kind: 'remove_classification',
              termId: CURATION_SYNTHETIC_IDS.termA,
            },
          ],
          {expectedTargetVersion: 1},
        ),
        retiredAssigned,
      ),
    );
    expect(removeRetired.classificationChanges[0]?.revisionInsert.state).toBe(
      'removed',
    );
  });

  it('accepts six actions, ten reasons, preserves order, and proves 11-item length-first', () => {
    expect(INTAKE_ACTIONS).toEqual(SYNTHETIC_INTAKE_ACTIONS);
    expect(INTAKE_FEEDBACK_REASONS).toEqual(SYNTHETIC_INTAKE_REASONS);
    for (const operation of F_CUR_ACTIONS) {
      const plan = requirePreparedTarget(
        prepareApplyManualCuration(
          createSyntheticContext(`synthetic.action.${operation.action}`),
          createSyntheticTargetRequest([operation]),
          createEvidenceCurationState(),
        ),
      );
      expect(plan.decisionChange?.revisionInsert.value.action).toBe(
        operation.action,
      );
      expect(Object.keys(plan).some((key) => /knowledge/iu.test(key))).toBe(
        false,
      );
    }

    const allReasons = requirePreparedTarget(
      prepareApplyManualCuration(
        createSyntheticContext('synthetic.reason.all'),
        createSyntheticTargetRequest([
          {
            kind: 'set_intake_decision',
            action: 'needs_review',
            reasonCodes: SYNTHETIC_INTAKE_REASONS,
            note: 'synthetic-note',
          },
        ]),
        createEvidenceCurationState(),
      ),
    );
    expect(
      allReasons.decisionChange?.reasonInserts.map((row) => ({
        ordinal: row.reasonOrdinal,
        reason: row.reasonCode,
      })),
    ).toEqual(
      SYNTHETIC_INTAKE_REASONS.map((reason, ordinal) => ({ordinal, reason})),
    );

    for (const reasons of [F_CUR_REASON_11_DUP, F_CUR_REASON_11_ENUM]) {
      expect(
        prepareApplyManualCuration(
          createSyntheticContext('synthetic.reason.length-first'),
          createSyntheticTargetRequest([
            {
              kind: 'set_intake_decision',
              action: 'needs_review',
              reasonCodes: reasons,
              note: 'synthetic-note',
            },
          ]),
          createEvidenceCurationState(),
        ),
      ).toEqual(
        expectedIssue(
          'limit_exceeded',
          'request.operations[0].reasonCodes',
          'feedback_reasons',
        ),
      );
    }
    expect(
      prepareApplyManualCuration(
        createSyntheticContext('synthetic.reason.duplicate'),
        createSyntheticTargetRequest([
          {
            kind: 'set_intake_decision',
            action: 'ignore',
            reasonCodes: ['already_known', 'already_known'],
          },
        ]),
        createEvidenceCurationState(),
      ),
    ).toEqual(
      expectedIssue('invalid_state', 'request.operations[0].reasonCodes[1]'),
    );
    expect(
      prepareApplyManualCuration(
        createSyntheticContext('synthetic.reason.other'),
        createSyntheticTargetRequest([
          {
            kind: 'set_intake_decision',
            action: 'ignore',
            reasonCodes: ['other'],
          },
        ]),
        createEvidenceCurationState(),
      ),
    ).toEqual(expectedIssue('invalid_state', 'request.operations[0].note'));

    const noteOnOrdinaryReason = requirePreparedTarget(
      prepareApplyManualCuration(
        createSyntheticContext('synthetic.reason.optional-note'),
        createSyntheticTargetRequest([
          {
            kind: 'set_intake_decision',
            action: 'source_only',
            reasonCodes: ['already_known'],
            note: 'synthetic-note',
          },
        ]),
        createEvidenceCurationState(),
      ),
    );
    expect(noteOnOrdinaryReason.decisionChange?.revisionInsert.value.note).toBe(
      'synthetic-note',
    );

    for (const invalidNote of [
      '',
      ' ',
      ' synthetic-note',
      'synthetic-note ',
      'synthetic\u0000note',
      '\ud800',
    ]) {
      expect(
        prepareApplyManualCuration(
          createSyntheticContext('synthetic.reason.invalid-note'),
          createSyntheticTargetRequest([
            {
              kind: 'set_intake_decision',
              action: 'ignore',
              reasonCodes: [],
              note: invalidNote,
            },
          ]),
          createEvidenceCurationState(),
        ),
      ).toEqual(expectedIssue('invalid_text', 'request.operations[0].note'));
    }

    const currentDecision = {
      action: 'needs_review',
      reasonCodes: ['worth_exploring', 'other'],
      note: 'synthetic-note',
    };
    const equalDecision = requirePreparedTarget(
      prepareApplyManualCuration(
        createSyntheticContext('synthetic.reason.equal'),
        createSyntheticTargetRequest(
          [{kind: 'set_intake_decision', ...currentDecision}],
          {expectedTargetVersion: 1},
        ),
        stateWithDecision(currentDecision),
      ),
    );
    expect(equalDecision.outcome).toBe('unchanged');
    expect(equalDecision.decisionChange).toBeUndefined();
    expect(equalDecision.targetVersionCas).toBeUndefined();
    const changedOrder = requirePreparedTarget(
      prepareApplyManualCuration(
        createSyntheticContext('synthetic.reason.changed-order'),
        createSyntheticTargetRequest(
          [
            {
              kind: 'set_intake_decision',
              ...currentDecision,
              reasonCodes: ['other', 'worth_exploring'],
            },
          ],
          {expectedTargetVersion: 1},
        ),
        stateWithDecision(currentDecision),
      ),
    );
    expect(changedOrder.decisionChange?.revisionInsert.revisionNumber).toBe(2);
    expect(changedOrder.receipt.resultingVersion).toBe(2);
  });

  it('accepts all 19 assessment dimensions at 0 and 4 and keeps absence distinct', () => {
    expect(ASSESSMENT_DIMENSIONS).toEqual(SYNTHETIC_ASSESSMENT_DIMENSIONS);
    expect(Object.values(CURATION_ASSESSMENT_GROUPS).flat()).toEqual(
      SYNTHETIC_ASSESSMENT_DIMENSIONS,
    );
    expect(F_CUR_ASSESS).toHaveLength(38);
    for (const operation of F_CUR_ASSESS) {
      const plan = requirePreparedTarget(
        prepareApplyManualCuration(
          createSyntheticContext(
            `synthetic.assessment.${operation.dimension}.${String(operation.score)}`,
          ),
          createSyntheticTargetRequest([operation]),
          createEvidenceCurationState(),
        ),
      );
      expect(plan.assessmentChanges[0]?.revisionInsert.value).toEqual({
        state: 'rated',
        score: operation.score,
      });
    }

    const clearAbsent = requirePreparedTarget(
      prepareApplyManualCuration(
        createSyntheticContext('synthetic.assessment.clear-absent'),
        createSyntheticTargetRequest([
          {kind: 'clear_assessment', dimension: 'freshness'},
        ]),
        createEvidenceCurationState(),
      ),
    );
    expect(clearAbsent.outcome).toBe('unchanged');
    expect(clearAbsent.assessmentChanges).toEqual([]);

    const ratedState = stateWithAssessment({state: 'rated', score: 0});
    const revised = requirePreparedTarget(
      prepareApplyManualCuration(
        createSyntheticContext('synthetic.assessment.revise'),
        createSyntheticTargetRequest(
          [
            {
              kind: 'set_assessment',
              dimension: 'freshness',
              score: 4,
              note: 'synthetic-note',
            },
          ],
          {expectedTargetVersion: 1},
        ),
        ratedState,
      ),
    );
    expect(revised.assessmentChanges[0]?.revisionInsert).toMatchObject({
      revisionNumber: 2,
      value: {state: 'rated', score: 4, note: 'synthetic-note'},
    });
    const cleared = requirePreparedTarget(
      prepareApplyManualCuration(
        createSyntheticContext('synthetic.assessment.clear-rated'),
        createSyntheticTargetRequest(
          [{kind: 'clear_assessment', dimension: 'freshness'}],
          {expectedTargetVersion: 1},
        ),
        ratedState,
      ),
    );
    expect(cleared.assessmentChanges[0]?.revisionInsert).toMatchObject({
      revisionNumber: 2,
      value: {state: 'cleared'},
    });
    expect(
      cleared.assessmentChanges[0]?.revisionInsert.value,
    ).not.toHaveProperty('score');
    const alreadyCleared = requirePreparedTarget(
      prepareApplyManualCuration(
        createSyntheticContext('synthetic.assessment.clear-cleared'),
        createSyntheticTargetRequest(
          [{kind: 'clear_assessment', dimension: 'freshness'}],
          {expectedTargetVersion: 1},
        ),
        stateWithAssessment({state: 'cleared'}),
      ),
    );
    expect(alreadyCleared.outcome).toBe('unchanged');
    expect(alreadyCleared.assessmentChanges).toEqual([]);

    for (const score of [-1, 5, 0.5, Number.NaN, '0']) {
      const result = prepareApplyManualCuration(
        createSyntheticContext('synthetic.assessment.invalid-score'),
        createSyntheticTargetRequest([
          {
            kind: 'set_assessment',
            dimension: 'freshness',
            score,
          },
        ]),
        createEvidenceCurationState(),
      );
      expect(result.kind).toBe('resolved');
      if (result.kind === 'resolved' && result.result.status === 'rejected') {
        expect(result.result.issue).toMatchObject({
          path: 'request.operations[0].score',
        });
        expect(result.result).not.toHaveProperty('plan');
      }
    }
  });

  it('plans mixed commands atomically in persistence order and advances once', () => {
    const plan = requirePreparedTarget(
      prepareApplyManualCuration(
        createSyntheticContext('synthetic.mixed.atomic'),
        createSyntheticTargetRequest(F_CUR_MIXED),
        stateWithTerms(
          [
            termState(CURATION_SYNTHETIC_IDS.termA),
            termState(CURATION_SYNTHETIC_IDS.termB),
          ],
          true,
        ),
      ),
    );
    expect(plan.receipt.resultingVersion).toBe(1);
    expect(
      plan.classificationChanges.map((change) => change.revisionInsert.termId),
    ).toEqual([CURATION_SYNTHETIC_IDS.termA, CURATION_SYNTHETIC_IDS.termB]);
    expect(
      plan.assessmentChanges.map((change) => change.revisionInsert.value),
    ).toEqual([
      {state: 'rated', score: 0},
      {state: 'rated', score: 4},
    ]);
    expect(plan.targetVersionCas).toMatchObject({
      expectedVersion: 0,
      nextVersion: 1,
    });

    for (const duplicateOperations of [
      [
        {
          kind: 'assign_classification',
          termId: CURATION_SYNTHETIC_IDS.termA,
        },
        {
          kind: 'remove_classification',
          termId: CURATION_SYNTHETIC_IDS.termA,
        },
      ],
      [
        {kind: 'set_intake_decision', action: 'ignore', reasonCodes: []},
        {
          kind: 'set_intake_decision',
          action: 'needs_review',
          reasonCodes: [],
        },
      ],
      [
        {kind: 'set_assessment', dimension: 'freshness', score: 0},
        {kind: 'clear_assessment', dimension: 'freshness'},
      ],
    ]) {
      expect(
        prepareApplyManualCuration(
          createSyntheticContext('synthetic.mixed.duplicate'),
          createSyntheticTargetRequest(duplicateOperations),
          stateWithTerms([termState(CURATION_SYNTHETIC_IDS.termA)], true),
        ),
      ).toEqual(expectedIssue('duplicate_operation', 'request.operations[1]'));
    }
  });
});

describe('replay, results, UUID spellings, hostile input, Unicode, and budgets', () => {
  it('separates applied, unchanged, replayed, conflict, stale, and rejected-key reuse', () => {
    const originalContext = createSyntheticContext(F_CUR_REPLAY.appliedKey);
    const originalRequest = createSyntheticTermRequest({
      value: {displayName: 'synthetic-label', lifecycle: 'active'},
    });
    const original = requirePreparedTerm(
      preparePutContentClassificationTerm(
        originalContext,
        originalRequest,
        createEmptyCurationState(),
      ),
    );
    const advancedTerm = termState(CURATION_SYNTHETIC_IDS.termA, 2, 'retired');
    const replayState = {
      ...stateWithTerms([advancedTerm]),
      commands: [
        {
          workspaceId: CURATION_SYNTHETIC_IDS.workspaceA,
          commandIdempotencyKey: F_CUR_REPLAY.appliedKey,
          requestSha256: original.requestSha256,
          receipt: original.receipt,
        },
      ],
    };
    expect(
      preparePutContentClassificationTerm(
        originalContext,
        originalRequest,
        replayState,
      ),
    ).toEqual({
      kind: 'resolved',
      result: {status: 'replayed', receipt: original.receipt},
    });
    expect(
      preparePutContentClassificationTerm(
        originalContext,
        createSyntheticTermRequest({
          value: {displayName: 'synthetic-conflict', lifecycle: 'active'},
        }),
        replayState,
      ),
    ).toEqual(
      expectedIssue('idempotency_conflict', 'context.commandIdempotencyKey'),
    );
    expect(
      preparePutContentClassificationTerm(
        createSyntheticContext(
          F_CUR_REPLAY.appliedKey,
          CURATION_SYNTHETIC_IDS.workspaceB,
        ),
        originalRequest,
        replayState,
      ).kind,
    ).toBe('prepared');

    const current = termState(CURATION_SYNTHETIC_IDS.termA);
    const unchanged = requirePreparedTerm(
      preparePutContentClassificationTerm(
        createSyntheticContext(F_CUR_REPLAY.unchangedKey),
        createSyntheticTermRequest({
          expectedRevision: 1,
          value: {...(current.value as Readonly<Record<string, unknown>>)},
        }),
        stateWithTerms([current]),
      ),
    );
    expect(unchanged.outcome).toBe('unchanged');
    expect(resultForCommittedTermPlan(unchanged)).toMatchObject({
      status: 'unchanged',
      receipt: {originalOutcome: 'unchanged', resultingRevision: 1},
    });

    expect(
      preparePutContentClassificationTerm(
        createSyntheticContext(F_CUR_REPLAY.rejectedReusableKey),
        createSyntheticTermRequest({
          expectedRevision: 1,
          value: {displayName: 'synthetic-label', lifecycle: 'active'},
        }),
        createEmptyCurationState(),
      ),
    ).toEqual(expectedIssue('term_not_found', 'request.termId'));
    expect(
      preparePutContentClassificationTerm(
        createSyntheticContext(F_CUR_REPLAY.rejectedReusableKey),
        createSyntheticTermRequest({
          value: {displayName: 'synthetic-label', lifecycle: 'active'},
        }),
        createEmptyCurationState(),
      ).kind,
    ).toBe('prepared');
  });

  it('returns exact closed result, receipt, issue, and originalOutcome unions', () => {
    const termPlan = requirePreparedTerm(
      preparePutContentClassificationTerm(
        createSyntheticContext(F_CUR_RESULTS.termKey),
        createSyntheticTermRequest({
          value: {displayName: 'synthetic-label', lifecycle: 'active'},
        }),
        createEmptyCurationState(),
      ),
    );
    const targetPlan = requirePreparedTarget(
      prepareApplyManualCuration(
        createSyntheticContext(F_CUR_RESULTS.targetKey),
        createSyntheticTargetRequest([
          {kind: 'clear_assessment', dimension: 'freshness'},
        ]),
        createEvidenceCurationState(),
      ),
    );
    const termResult = resultForCommittedTermPlan(termPlan);
    const targetResult = resultForCommittedTargetPlan(targetPlan);
    expect(sortedKeys(termResult)).toEqual(
      CURATION_RESULT_SHAPE_ORACLE.successfulResultKeys,
    );
    expect(sortedKeys(targetResult)).toEqual(
      CURATION_RESULT_SHAPE_ORACLE.successfulResultKeys,
    );
    if (termResult.status !== 'rejected') {
      expect(sortedKeys(termResult.receipt)).toEqual(
        CURATION_RESULT_SHAPE_ORACLE.termReceiptKeys,
      );
    }
    if (targetResult.status !== 'rejected') {
      expect(sortedKeys(targetResult.receipt)).toEqual(
        CURATION_RESULT_SHAPE_ORACLE.targetReceiptKeys,
      );
      expect(targetResult.receipt.originalOutcome).toBe('unchanged');
      expect(targetResult.receipt.resultingVersion).toBe(0);
    }

    const persistence = mapCurationPersistenceFailure();
    expect(persistence).toEqual({
      status: 'rejected',
      issue: {code: 'persistence_failed', path: 'persistence'},
    });
    expect(sortedKeys(persistence)).toEqual(
      CURATION_RESULT_SHAPE_ORACLE.rejectedResultKeys,
    );
    expect(sortedKeys(persistence.issue)).toEqual(
      CURATION_RESULT_SHAPE_ORACLE.nonBudgetIssueKeys,
    );
    expect(isDeepFrozen(termResult)).toBe(true);
    expect(isDeepFrozen(targetResult)).toBe(true);
    expect(isDeepFrozen(persistence)).toBe(true);
  });

  it('rejects every noncanonical spelling across each request UUID field', () => {
    for (const spelling of F_CUR_UUID_SPELLINGS) {
      expect(
        preparePutContentClassificationTerm(
          createSyntheticContext(
            `synthetic.uuid.workspace.${spelling.id}`,
            spelling.value,
          ),
          createSyntheticTermRequest(),
          createEmptyCurationState(),
        ),
      ).toEqual(
        expectedIssue('invalid_identifier', 'context.effectiveWorkspaceId'),
      );
      expect(
        preparePutContentClassificationTerm(
          createSyntheticContext(`synthetic.uuid.term.${spelling.id}`),
          createSyntheticTermRequest({termId: spelling.value}),
          createEmptyCurationState(),
        ),
      ).toEqual(expectedIssue('invalid_identifier', 'request.termId'));
      expect(
        preparePutContentClassificationTerm(
          createSyntheticContext(`synthetic.uuid.parent.${spelling.id}`),
          createSyntheticTermRequest({
            value: {
              displayName: 'synthetic-label',
              parentTermId: spelling.value,
              lifecycle: 'active',
            },
          }),
          createEmptyCurationState(),
        ),
      ).toEqual(
        expectedIssue('invalid_identifier', 'request.value.parentTermId'),
      );
      expect(
        prepareApplyManualCuration(
          createSyntheticContext(`synthetic.uuid.snapshot.${spelling.id}`),
          createSyntheticTargetRequest(
            [{kind: 'clear_assessment', dimension: 'freshness'}],
            {target: {kind: 'snapshot', snapshotId: spelling.value}},
          ),
          createEvidenceCurationState(),
        ),
      ).toEqual(
        expectedIssue('invalid_identifier', 'request.target.snapshotId'),
      );
      expect(
        prepareApplyManualCuration(
          createSyntheticContext(`synthetic.uuid.fragment.${spelling.id}`),
          createSyntheticTargetRequest(
            [{kind: 'clear_assessment', dimension: 'freshness'}],
            {target: {kind: 'fragment', fragmentId: spelling.value}},
          ),
          createEvidenceCurationState(),
        ),
      ).toEqual(
        expectedIssue('invalid_identifier', 'request.target.fragmentId'),
      );
      expect(
        prepareApplyManualCuration(
          createSyntheticContext(`synthetic.uuid.operation.${spelling.id}`),
          createSyntheticTargetRequest([
            {kind: 'assign_classification', termId: spelling.value},
          ]),
          createEvidenceCurationState(),
        ),
      ).toEqual(
        expectedIssue('invalid_identifier', 'request.operations[0].termId'),
      );
    }
  });

  it('rejects every noncanonical spelling in every repository-state UUID field without echo', () => {
    const currentTargetId = targetId();
    const currentTerm = termState(
      CURATION_SYNTHETIC_IDS.termA,
      1,
      'active',
      CURATION_SYNTHETIC_IDS.termB,
    );
    const currentParent = termState(CURATION_SYNTHETIC_IDS.termB);
    const currentAssignmentId = assignmentId(CURATION_SYNTHETIC_IDS.termA);
    const currentDecisionId = independentUuidV5(
      currentTargetId,
      'struinfo:intake-decision:v1',
    );
    const currentAssessmentId = independentUuidV5(
      currentTargetId,
      'struinfo:assessment:v1:freshness',
    );
    const baseState = {
      ...createEvidenceCurationState(),
      targets: [
        {
          workspaceId: CURATION_SYNTHETIC_IDS.workspaceA,
          kind: 'fragment',
          fragmentId: CURATION_SYNTHETIC_IDS.fragment,
          targetId: currentTargetId,
          currentVersion: 1,
        },
      ],
      terms: [currentTerm, currentParent],
      assignments: [
        {
          workspaceId: CURATION_SYNTHETIC_IDS.workspaceA,
          assignmentId: currentAssignmentId,
          targetId: currentTargetId,
          termId: CURATION_SYNTHETIC_IDS.termA,
          currentRevision: 1,
          currentRevisionId: assignmentRevisionId(currentAssignmentId, 1),
          state: 'assigned',
          termRevisionNumber: 1,
          termRevisionId: termRevisionId(CURATION_SYNTHETIC_IDS.termA, 1),
        },
      ],
      decisions: [
        {
          workspaceId: CURATION_SYNTHETIC_IDS.workspaceA,
          decisionId: currentDecisionId,
          targetId: currentTargetId,
          currentRevision: 1,
          currentRevisionId: independentUuidV5(
            currentDecisionId,
            'struinfo:intake-decision-revision:v1:1',
          ),
          value: {action: 'ignore', reasonCodes: []},
        },
      ],
      assessments: [
        {
          workspaceId: CURATION_SYNTHETIC_IDS.workspaceA,
          assessmentId: currentAssessmentId,
          targetId: currentTargetId,
          dimension: 'freshness',
          currentRevision: 1,
          currentRevisionId: independentUuidV5(
            currentAssessmentId,
            'struinfo:assessment-revision:v1:1',
          ),
          value: {state: 'rated', score: 0},
        },
      ],
      commands: [
        {
          workspaceId: CURATION_SYNTHETIC_IDS.workspaceA,
          commandIdempotencyKey: 'synthetic.state.command',
          requestSha256: 'a'.repeat(64),
          receipt: {
            workspaceId: CURATION_SYNTHETIC_IDS.workspaceA,
            commandIdempotencyKey: 'synthetic.state.command',
            commandKind: 'apply_manual_curation',
            targetId: currentTargetId,
            resultingVersion: 1,
            originalOutcome: 'applied',
          },
        },
      ],
    };
    const stateUuidFields = [
      'workspaceId',
      'resourceId',
      'snapshotId',
      'fragmentId',
      'targetId',
      'termId',
      'currentRevisionId',
      'parentTermId',
      'assignmentId',
      'termRevisionId',
      'decisionId',
      'assessmentId',
    ];

    for (const field of stateUuidFields) {
      for (const spelling of F_CUR_UUID_SPELLINGS) {
        const state = structuredClone(baseState) as unknown;
        expect(replaceFirstUuidLeaf(state, field, spelling.value), field).toBe(
          true,
        );
        const result = prepareApplyManualCuration(
          createSyntheticContext(
            `synthetic.uuid.state.${field}.${spelling.id}`,
          ),
          createSyntheticTargetRequest(
            [{kind: 'clear_assessment', dimension: 'depth'}],
            {expectedTargetVersion: 1},
          ),
          state,
        );
        expect(result).toEqual(expectedIssue('invalid_identifier', 'state'));
        if (spelling.value.length > 0) {
          expect(JSON.stringify(result)).not.toContain(spelling.value);
        }
      }
    }
  });

  it('rejects hostile containers without running Proxy/getter/setter code', () => {
    const counter = createClosedInputAttackCounter();
    const accessor = createAccessorContext(counter);
    expect(Object.getPrototypeOf(accessor)).toBe(Object.prototype);
    expect(
      Object.getOwnPropertyDescriptor(accessor, 'effectiveWorkspaceId'),
    ).not.toHaveProperty('value');
    expect(
      preparePutContentClassificationTerm(
        accessor,
        createSyntheticTermRequest(),
        createEmptyCurationState(),
      ),
    ).toEqual(expectedIssue('invalid_shape', 'context.effectiveWorkspaceId'));
    expect(counter).toEqual(createClosedInputAttackCounter());

    expect(
      preparePutContentClassificationTerm(
        createSyntheticContext('synthetic.hostile.proxy'),
        createProxyRequest(counter),
        createEmptyCurationState(),
      ),
    ).toEqual(expectedIssue('invalid_shape', 'request'));
    expect(counter.proxyTrapCalls).toBe(0);

    const symbolRequest = createSymbolKeyTermRequest();
    expect(Object.getPrototypeOf(symbolRequest)).toBe(Object.prototype);
    expect(Object.getOwnPropertySymbols(symbolRequest)).toHaveLength(1);
    expect(
      preparePutContentClassificationTerm(
        createSyntheticContext('synthetic.hostile.symbol'),
        symbolRequest,
        createEmptyCurationState(),
      ),
    ).toEqual(expectedIssue('invalid_shape', 'request'));

    for (const key of F_CUR_HOSTILE.dangerousKeys) {
      const request = createDangerousKeyTermRequest(key);
      expect(Object.hasOwn(request, key)).toBe(true);
      expect(
        preparePutContentClassificationTerm(
          createSyntheticContext(`synthetic.hostile.${key}`),
          request,
          createEmptyCurationState(),
        ),
      ).toEqual(expectedIssue('invalid_shape', 'request'));
    }

    expect(
      prepareApplyManualCuration(
        createSyntheticContext('synthetic.hostile.sparse'),
        createSyntheticTargetRequest(createSparseOperations()),
        createEvidenceCurationState(),
      ),
    ).toEqual(expectedIssue('invalid_shape', 'request.operations'));
    expect(
      prepareApplyManualCuration(
        createSyntheticContext('synthetic.hostile.array-accessor'),
        createSyntheticTargetRequest(createArrayAccessorOperations(counter)),
        createEvidenceCurationState(),
      ),
    ).toEqual(expectedIssue('invalid_shape', 'request.operations'));
    expect(counter.getterCalls).toBe(0);

    expect(
      preparePutContentClassificationTerm(
        createSyntheticContext('synthetic.hostile.cycle'),
        createCyclicTermRequest(),
        createEmptyCurationState(),
      ),
    ).toEqual(expectedIssue('invalid_shape', 'request.value'));

    class SyntheticRecord {
      public readonly syntheticMarker = true;
    }
    const revoked = Proxy.revocable(createSyntheticTermRequest(), {});
    const hostileRecords: readonly unknown[] = [
      new SyntheticRecord(),
      Object.create(null) as object,
      new Map<string, unknown>(),
      new Set<unknown>(),
      revoked.proxy,
    ];
    revoked.revoke();
    for (const request of hostileRecords) {
      expect(
        preparePutContentClassificationTerm(
          createSyntheticContext('synthetic.hostile.record-kind'),
          request,
          createEmptyCurationState(),
        ),
      ).toEqual(expectedIssue('invalid_shape', 'request'));
    }

    const extraArray = [{kind: 'clear_assessment', dimension: 'freshness'}];
    Object.defineProperty(extraArray, 'syntheticExtra', {
      value: true,
      enumerable: true,
    });
    expect(
      prepareApplyManualCuration(
        createSyntheticContext('synthetic.hostile.extra-array-key'),
        createSyntheticTargetRequest(extraArray),
        createEvidenceCurationState(),
      ),
    ).toEqual(expectedIssue('invalid_shape', 'request.operations'));
  });

  it('rejects inherited accessors and invokes inherited setters exactly zero times', () => {
    const originalWorkspace = Object.getOwnPropertyDescriptor(
      Object.prototype,
      'effectiveWorkspaceId',
    );
    const originalOutput = Object.getOwnPropertyDescriptor(
      Object.prototype,
      'workspaceId',
    );
    const getter = vi.fn();
    const setter = vi.fn();
    try {
      Object.defineProperty(Object.prototype, 'effectiveWorkspaceId', {
        get: getter,
        configurable: true,
      });
      expect(
        preparePutContentClassificationTerm(
          createSyntheticContext('synthetic.inherited.getter'),
          createSyntheticTermRequest(),
          createEmptyCurationState(),
        ),
      ).toEqual(expectedIssue('invalid_shape', 'context.effectiveWorkspaceId'));
      expect(getter).not.toHaveBeenCalled();
    } finally {
      if (originalWorkspace === undefined) {
        Reflect.deleteProperty(Object.prototype, 'effectiveWorkspaceId');
      } else {
        Object.defineProperty(
          Object.prototype,
          'effectiveWorkspaceId',
          originalWorkspace,
        );
      }
    }
    try {
      Object.defineProperty(Object.prototype, 'workspaceId', {
        set: setter,
        configurable: true,
      });
      const plan = requirePreparedTerm(
        preparePutContentClassificationTerm(
          createSyntheticContext('synthetic.inherited.setter'),
          createSyntheticTermRequest(),
          createEmptyCurationState(),
        ),
      );
      expect(plan.receipt.workspaceId).toBe(CURATION_SYNTHETIC_IDS.workspaceA);
      expect(setter).not.toHaveBeenCalled();
    } finally {
      if (originalOutput === undefined) {
        Reflect.deleteProperty(Object.prototype, 'workspaceId');
      } else {
        Object.defineProperty(Object.prototype, 'workspaceId', originalOutput);
      }
    }
  });

  it('preserves Unicode/code-point semantics and removes all byte budgets', () => {
    expect(Array.from(F_CUR_UNICODE.displayAtLimit)).toHaveLength(120);
    expect(textEncoder.encode(F_CUR_UNICODE.displayAtLimit)).toHaveLength(480);
    expect(Array.from(F_CUR_UNICODE.descriptionAtLimit)).toHaveLength(2_000);
    expect(textEncoder.encode(F_CUR_UNICODE.descriptionAtLimit)).toHaveLength(
      8_000,
    );
    expect(
      CURATION_LIMIT_ORACLE.maximumDisplayNameUtf8BytesByScalarArithmetic,
    ).toBe(480);
    expect(
      CURATION_LIMIT_ORACLE.maximumDescriptionOrNoteUtf8BytesByScalarArithmetic,
    ).toBe(8_000);

    for (const displayName of [
      F_CUR_UNICODE.chineseEmojiCombining,
      F_CUR_UNICODE.nfc,
      F_CUR_UNICODE.nfd,
      F_CUR_UNICODE.internalWhitespace,
      F_CUR_UNICODE.displayAtLimit,
    ]) {
      const plan = requirePreparedTerm(
        preparePutContentClassificationTerm(
          createSyntheticContext('synthetic.unicode.accept'),
          createSyntheticTermRequest({
            value: {displayName, lifecycle: 'active'},
          }),
          createEmptyCurationState(),
        ),
      );
      expect(plan.termRevisionInsert?.value.displayName).toBe(displayName);
    }
    expect(F_CUR_UNICODE.nfc).not.toBe(F_CUR_UNICODE.nfd);

    for (const description of ['x', F_CUR_UNICODE.descriptionAtLimit]) {
      const plan = requirePreparedTerm(
        preparePutContentClassificationTerm(
          createSyntheticContext('synthetic.unicode.description-accept'),
          createSyntheticTermRequest({
            value: {
              displayName: 'synthetic-label',
              description,
              lifecycle: 'active',
            },
          }),
          createEmptyCurationState(),
        ),
      );
      expect(plan.termRevisionInsert?.value.description).toBe(description);
    }
    expect(
      preparePutContentClassificationTerm(
        createSyntheticContext('synthetic.unicode.description-empty'),
        createSyntheticTermRequest({
          value: {
            displayName: 'synthetic-label',
            description: '',
            lifecycle: 'active',
          },
        }),
        createEmptyCurationState(),
      ),
    ).toEqual(expectedIssue('invalid_text', 'request.value.description'));

    for (const note of ['x', F_CUR_UNICODE.noteAtLimit]) {
      const plan = requirePreparedTarget(
        prepareApplyManualCuration(
          createSyntheticContext('synthetic.unicode.note-accept'),
          createSyntheticTargetRequest([
            {
              kind: 'set_assessment',
              dimension: 'freshness',
              score: 0,
              note,
            },
          ]),
          createEvidenceCurationState(),
        ),
      );
      expect(plan.assessmentChanges[0]?.revisionInsert.value).toEqual({
        state: 'rated',
        score: 0,
        note,
      });
    }
    expect(
      preparePutContentClassificationTerm(
        createSyntheticContext('synthetic.unicode.display-over'),
        createSyntheticTermRequest({
          value: {
            displayName: F_CUR_UNICODE.displayOverLimit,
            lifecycle: 'active',
          },
        }),
        createEmptyCurationState(),
      ),
    ).toEqual(
      expectedIssue(
        'limit_exceeded',
        'request.value.displayName',
        'display_name_code_points',
      ),
    );

    expect(
      preparePutContentClassificationTerm(
        createSyntheticContext(F_CUR_BUDGET.keyAtLimit),
        createSyntheticTermRequest(),
        createEmptyCurationState(),
      ).kind,
    ).toBe('prepared');
    expect(
      preparePutContentClassificationTerm(
        createSyntheticContext('synthetic.unicode.description-over'),
        createSyntheticTermRequest({
          value: {
            displayName: 'synthetic-label',
            description: F_CUR_UNICODE.descriptionOverLimit,
            lifecycle: 'active',
          },
        }),
        createEmptyCurationState(),
      ),
    ).toEqual(
      expectedIssue(
        'limit_exceeded',
        'request.value.description',
        'description_code_points',
      ),
    );
    expect(
      prepareApplyManualCuration(
        createSyntheticContext('synthetic.unicode.note-over'),
        createSyntheticTargetRequest([
          {
            kind: 'set_assessment',
            dimension: 'freshness',
            score: 0,
            note: F_CUR_UNICODE.noteOverLimit,
          },
        ]),
        createEvidenceCurationState(),
      ),
    ).toEqual(
      expectedIssue(
        'limit_exceeded',
        'request.operations[0].note',
        'note_code_points',
      ),
    );
    expect(
      CURATION_EXACT_ISSUE_ORACLES.some((oracle) =>
        oracle.budget?.includes('byte'),
      ),
    ).toBe(false);
  });

  it('proves collection/key/numeric/text precedence and exact budget tokens', () => {
    const accessor = vi.fn();
    const operations = Array.from(
      {length: F_CUR_BUDGET.operationOverLimit},
      () => ({kind: 'clear_assessment', dimension: 'freshness'}),
    );
    Object.defineProperty(operations, '0', {get: accessor, enumerable: true});
    expect(
      prepareApplyManualCuration(
        createSyntheticContext('synthetic.budget.operations'),
        createSyntheticTargetRequest(operations),
        createEvidenceCurationState(),
      ),
    ).toEqual(
      expectedIssue(
        'limit_exceeded',
        'request.operations',
        'command_operations',
      ),
    );
    expect(accessor).not.toHaveBeenCalled();

    expect(
      preparePutContentClassificationTerm(
        createSyntheticContext(F_CUR_BUDGET.invalidKeyBeforeBudget),
        createSyntheticTermRequest(),
        createEmptyCurationState(),
      ),
    ).toEqual(
      expectedIssue('invalid_identifier', 'context.commandIdempotencyKey'),
    );
    expect(
      preparePutContentClassificationTerm(
        createSyntheticContext(F_CUR_BUDGET.keyOverLimit),
        createSyntheticTermRequest(),
        createEmptyCurationState(),
      ),
    ).toEqual(
      expectedIssue(
        'limit_exceeded',
        'context.commandIdempotencyKey',
        'idempotency_key_characters',
      ),
    );

    for (const invalidVersion of [-1, 0.5, Number.NaN, '1']) {
      const result = preparePutContentClassificationTerm(
        createSyntheticContext('synthetic.budget.invalid-number'),
        createSyntheticTermRequest({expectedRevision: invalidVersion}),
        createEmptyCurationState(),
      );
      expect(result.kind).toBe('resolved');
      if (result.kind === 'resolved' && result.result.status === 'rejected') {
        expect(result.result.issue).toMatchObject({
          path: 'request.expectedRevision',
        });
        expect(result.result.issue).not.toHaveProperty('budget');
      }
    }
    expect(
      preparePutContentClassificationTerm(
        createSyntheticContext('synthetic.budget.revision-over'),
        createSyntheticTermRequest({
          expectedRevision: F_CUR_BUDGET.overMaximumRevision,
        }),
        createEmptyCurationState(),
      ),
    ).toEqual(
      expectedIssue(
        'limit_exceeded',
        'request.expectedRevision',
        'revision_number',
      ),
    );

    const maximumTerm = termState(
      CURATION_SYNTHETIC_IDS.termA,
      F_CUR_BUDGET.maximumRevision,
    );
    const maximumTermValue = maximumTerm.value as Readonly<
      Record<string, unknown>
    >;
    expect(
      requirePreparedTerm(
        preparePutContentClassificationTerm(
          createSyntheticContext('synthetic.budget.revision-max-unchanged'),
          createSyntheticTermRequest({
            expectedRevision: F_CUR_BUDGET.maximumRevision,
            value: {...maximumTermValue},
          }),
          stateWithTerms([maximumTerm]),
        ),
      ).outcome,
    ).toBe('unchanged');
    expect(
      preparePutContentClassificationTerm(
        createSyntheticContext('synthetic.budget.revision-max-changed'),
        createSyntheticTermRequest({
          expectedRevision: F_CUR_BUDGET.maximumRevision,
          value: {...maximumTermValue, displayName: 'synthetic-max-changed'},
        }),
        stateWithTerms([maximumTerm]),
      ),
    ).toEqual(
      expectedIssue(
        'limit_exceeded',
        'request.expectedRevision',
        'revision_number',
      ),
    );

    const maximumTargetState = stateWithCurrentTarget(
      [],
      F_CUR_BUDGET.maximumRevision,
    );
    expect(
      requirePreparedTarget(
        prepareApplyManualCuration(
          createSyntheticContext('synthetic.budget.target-max-unchanged'),
          createSyntheticTargetRequest(
            [{kind: 'clear_assessment', dimension: 'freshness'}],
            {expectedTargetVersion: F_CUR_BUDGET.maximumRevision},
          ),
          maximumTargetState,
        ),
      ).outcome,
    ).toBe('unchanged');
    expect(
      prepareApplyManualCuration(
        createSyntheticContext('synthetic.budget.target-max-changed'),
        createSyntheticTargetRequest(
          [
            {
              kind: 'set_assessment',
              dimension: 'freshness',
              score: 0,
            },
          ],
          {expectedTargetVersion: F_CUR_BUDGET.maximumRevision},
        ),
        maximumTargetState,
      ),
    ).toEqual(
      expectedIssue(
        'limit_exceeded',
        'request.expectedTargetVersion',
        'target_version',
      ),
    );
  });

  it('owns and freezes prepared values against caller mutation', () => {
    const request = createSyntheticTermRequest();
    const state = createEmptyCurationState();
    const plan = requirePreparedTerm(
      preparePutContentClassificationTerm(
        createSyntheticContext('synthetic.ownership'),
        request,
        state,
      ),
    );
    const requestValue = request.value as Record<string, unknown>;
    requestValue.displayName = 'synthetic-mutated-after-call';
    const mutableTerms = state.terms;
    if (mutableTerms === undefined) {
      throw new RangeError('Synthetic state terms are missing.');
    }
    mutableTerms.push(termState(CURATION_SYNTHETIC_IDS.termB));
    expect(plan.termRevisionInsert?.value.displayName).toBe('synthetic-label');
    expect(isDeepFrozen(plan)).toBe(true);
  });
});

describe('independent static DDL and boundary audit', () => {
  it('parses a closed eleven-table semantic map independent of Backend helpers', () => {
    const sql = readFileSync(fileURLToPath(migrationUrl), 'utf8');
    const shape = analyzeTestOwnedCurationDdl(sql);
    expect(shape).toEqual(normalizeDdlOracle());
    expect(testDdlFindingIds(shape)).toEqual([]);
    expect(shape.tables.size).toBe(11);
    expect(shape.indexes).toHaveLength(2);
  });

  it('rejects quoted identifiers in closed built-in type positions', () => {
    const sql = readFileSync(fileURLToPath(migrationUrl), 'utf8');
    const quotedUuid = replaceUniqueExecutableSequence(
      sql,
      F_CUR_DDL_ANTISPOOF.currentTermRevisionTypeFrom,
      F_CUR_DDL_ANTISPOOF.currentTermRevisionTypeWithQuotedIdentifier,
    );
    const quotedTimestampWord = replaceUniqueExecutableSequence(
      sql,
      F_CUR_DDL_ANTISPOOF.createdAtTimestampTypeFrom,
      F_CUR_DDL_ANTISPOOF.createdAtTimestampTypeWithQuotedIdentifier,
    );

    expect(() => analyzeTestOwnedCurationDdl(quotedUuid)).toThrow(
      TestSqlAuditError,
    );
    expect(() => analyzeTestOwnedCurationDdl(quotedTimestampWord)).toThrow(
      TestSqlAuditError,
    );
  });

  it('cannot hide an executable __proto__ table from the closed table set', () => {
    const sql = readFileSync(fileURLToPath(migrationUrl), 'utf8');
    expect(() =>
      analyzeTestOwnedCurationDdl(
        `${sql}\n${F_CUR_DDL_ANTISPOOF.protoTableStatement}`,
      ),
    ).toThrow(TestSqlAuditError);
  });

  it('mutates one unique executable token sequence and detects every weakening', () => {
    const sql = readFileSync(fileURLToPath(migrationUrl), 'utf8');
    const findingMap: Readonly<Record<string, string>> = {
      fragment_fk: 'curation_target.foreignKeys',
      lifecycle_check: 'vocabulary_term_revision.checks',
      target_sum: 'curation_target.checks',
      command_pk: 'curation_command.primaryKeys',
      snapshot_partial_unique: 'indexes',
      term_revision_fk: 'classification_assignment_revision.foreignKeys',
      assessment_sum: 'assessment_revision.checks',
      command_subject: 'curation_command.checks',
    };
    for (const mutation of F_CUR_DDL_MUT) {
      expect(tokenSequenceStarts(sql, mutation.from), mutation.id).toHaveLength(
        1,
      );
      const mutated = replaceUniqueExecutableSequence(
        sql,
        mutation.from,
        mutation.to,
      );
      const expectedFinding = findingMap[mutation.finding];
      if (expectedFinding === undefined) {
        throw new RangeError(
          `Missing frozen finding mapping for ${mutation.finding}.`,
        );
      }
      expect(
        testDdlFindingIds(analyzeTestOwnedCurationDdl(mutated)),
        mutation.id,
      ).toContain(expectedFinding);
    }
  });

  it('ignores SQL-looking comments and string payloads as structural evidence', () => {
    const sql = readFileSync(fileURLToPath(migrationUrl), 'utf8');
    const fragmentMutation = F_CUR_DDL_MUT.find(
      (mutation) => mutation.id === 'workspace-first-fragment-fk',
    );
    if (fragmentMutation === undefined)
      throw new RangeError('Fragment mutation is missing.');
    const weak = replaceUniqueExecutableSequence(
      sql,
      fragmentMutation.from,
      fragmentMutation.to,
    );
    const commentDecoy = `${weak}\n-- ${F_CUR_DDL_ANTISPOOF.commentFragmentFk}\n/* ${F_CUR_DDL_ANTISPOOF.commentFragmentFk} /* synthetic nested */ */\n`;
    const stringDecoy = insertTableConstraint(
      weak,
      'curation_target',
      F_CUR_DDL_ANTISPOOF.stringPayloadConstraint,
    );

    expect(
      testDdlFindingIds(analyzeTestOwnedCurationDdl(commentDecoy)),
    ).toContain('curation_target.foreignKeys');
    expect(testDdlFindingIds(analyzeTestOwnedCurationDdl(stringDecoy))).toEqual(
      expect.arrayContaining([
        'curation_target.foreignKeys',
        'curation_target.checks',
      ]),
    );

    const tokenKinds = tokenizeTestSql(
      `-- synthetic comment\nSELECT 'synthetic', E'synthetic\\n', "Synthetic";`,
    ).map((token) => token.kind);
    expect(tokenKinds).toEqual([
      'word',
      'string',
      'punctuation',
      'escape_string',
      'punctuation',
      'quoted_identifier',
      'punctuation',
    ]);
    expect(() => analyzeTestOwnedCurationDdl(`SELECT 'synthetic';`)).toThrow(
      TestSqlAuditError,
    );
  });

  it('rejects tautological, redundant, and unexpected executable constraints', () => {
    const sql = readFileSync(fileURLToPath(migrationUrl), 'utf8');
    const lifecycleMutation = F_CUR_DDL_MUT.find(
      (mutation) => mutation.id === 'lifecycle-check',
    );
    const fragmentMutation = F_CUR_DDL_MUT.find(
      (mutation) => mutation.id === 'workspace-first-fragment-fk',
    );
    if (lifecycleMutation === undefined || fragmentMutation === undefined) {
      throw new RangeError('Required anti-spoof mutations are missing.');
    }

    const weakLifecycleWithDecoy = insertTableConstraint(
      replaceUniqueExecutableSequence(
        sql,
        lifecycleMutation.from,
        lifecycleMutation.to,
      ),
      'vocabulary_term_revision',
      F_CUR_DDL_ANTISPOOF.lifecycleTrueOrConstraint,
    );
    expect(
      testDdlFindingIds(analyzeTestOwnedCurationDdl(weakLifecycleWithDecoy)),
    ).toContain('vocabulary_term_revision.checks');
    const lifecycleWithEscapeString = replaceUniqueExecutableSequence(
      sql,
      lifecycleMutation.from,
      F_CUR_DDL_ANTISPOOF.lifecycleEscapeStringExpression,
    );
    expect(
      testDdlFindingIds(analyzeTestOwnedCurationDdl(lifecycleWithEscapeString)),
    ).toContain('vocabulary_term_revision.checks');
    const correctLifecycleWithAdditionalWeakCheck = insertTableConstraint(
      sql,
      'vocabulary_term_revision',
      F_CUR_DDL_ANTISPOOF.additionalWeakLifecycleConstraint,
    );
    expect(
      testDdlFindingIds(
        analyzeTestOwnedCurationDdl(correctLifecycleWithAdditionalWeakCheck),
      ),
    ).toContain('vocabulary_term_revision.checks');

    const weakFragmentWithCorrectRedundant = insertTableConstraint(
      replaceUniqueExecutableSequence(
        sql,
        fragmentMutation.from,
        fragmentMutation.to,
      ),
      'curation_target',
      F_CUR_DDL_ANTISPOOF.redundantCorrectFragmentFk,
    );
    expect(
      testDdlFindingIds(
        analyzeTestOwnedCurationDdl(weakFragmentWithCorrectRedundant),
      ),
    ).toContain('curation_target.foreignKeys');

    const unexpectedUnique = insertTableConstraint(
      sql,
      'curation_target',
      F_CUR_DDL_ANTISPOOF.unexpectedUniqueConstraint,
    );
    expect(
      testDdlFindingIds(analyzeTestOwnedCurationDdl(unexpectedUnique)),
    ).toContain('curation_target.uniqueKeys');
  });

  it('is insensitive to declaration order, names, whitespace, and equivalent formatting', () => {
    const sql = readFileSync(fileURLToPath(migrationUrl), 'utf8');
    const expected = normalizeDdlOracle();
    const reorderedColumns = reorderFirstTwoTableSegments(sql);
    const reorderedConstraints = reorderLastTwoTableConstraints(sql);
    const reorderedTables = reorderCreateTableStatements(
      sql,
      'curation_target',
      'vocabulary_term',
    );
    const renamed = replaceUniqueExecutableSequence(
      sql,
      F_CUR_DDL_ANTISPOOF.constraintNameFrom,
      F_CUR_DDL_ANTISPOOF.constraintNameQuotedTo,
    );
    const reformattedForeignKeys = reformatExecutableTokenPair(
      sql,
      {kind: 'word', value: 'foreign'},
      {kind: 'word', value: 'key'},
    );
    const reformatted = reformatExecutableTokenPair(
      reformattedForeignKeys,
      {kind: 'word', value: 'check'},
      {kind: 'punctuation', value: '('},
    );

    expect(analyzeTestOwnedCurationDdl(reorderedColumns)).toEqual(expected);
    expect(analyzeTestOwnedCurationDdl(reorderedConstraints)).toEqual(expected);
    expect(analyzeTestOwnedCurationDdl(reorderedTables)).toEqual(expected);
    expect(analyzeTestOwnedCurationDdl(renamed)).toEqual(expected);
    expect(analyzeTestOwnedCurationDdl(reformatted)).toEqual(expected);
  });

  it('fails closed on unsupported statements, inline constraints, and trailing tokens', () => {
    const sql = readFileSync(fileURLToPath(migrationUrl), 'utf8');
    expect(() =>
      analyzeTestOwnedCurationDdl(`${sql}\nGRANT SELECT ON x TO y;`),
    ).toThrow(TestSqlAuditError);
    expect(() =>
      analyzeTestOwnedCurationDdl(
        replaceUniqueExecutableSequence(
          sql,
          F_CUR_DDL_ANTISPOOF.targetKindColumnFrom,
          F_CUR_DDL_ANTISPOOF.targetKindColumnWithInlineCheck,
        ),
      ),
    ).toThrow(TestSqlAuditError);
    expect(() =>
      analyzeTestOwnedCurationDdl(
        replaceUniqueExecutableSequence(
          sql,
          F_CUR_DDL_ANTISPOOF.currentVersionColumnFrom,
          F_CUR_DDL_ANTISPOOF.currentVersionColumnWithTrailingToken,
        ),
      ),
    ).toThrow(TestSqlAuditError);
    expect(() => tokenizeTestSql("SELECT E'synthetic\\';")).toThrow(
      TestSqlAuditError,
    );
  });

  it('admits only declared workspace-first ordinary performance-index prefixes', () => {
    const sql = readFileSync(fileURLToPath(migrationUrl), 'utf8');
    const allowed = analyzeTestOwnedCurationDdl(
      `${sql}\n${F_CUR_DDL_ANTISPOOF.allowedOrdinaryIndex}`,
    );
    expect(testDdlFindingIds(allowed)).toEqual([]);

    for (const statement of [
      F_CUR_DDL_ANTISPOOF.nonWorkspaceFirstIndex,
      F_CUR_DDL_ANTISPOOF.unsupportedPrefixIndex,
      F_CUR_DDL_ANTISPOOF.unknownTableIndex,
      F_CUR_DDL_ANTISPOOF.unexpectedUniqueIndex,
      F_CUR_DDL_ANTISPOOF.unexpectedPartialIndex,
    ]) {
      expect(
        testDdlFindingIds(analyzeTestOwnedCurationDdl(`${sql}\n${statement}`)),
        statement,
      ).toContain('indexes');
    }

    for (const statement of [
      F_CUR_DDL_ANTISPOOF.expressionIndex,
      F_CUR_DDL_ANTISPOOF.unsupportedMethodIndex,
      F_CUR_DDL_ANTISPOOF.unsupportedSuffixIndex,
    ]) {
      expect(
        () => analyzeTestOwnedCurationDdl(`${sql}\n${statement}`),
        statement,
      ).toThrow(TestSqlAuditError);
    }
  });

  it('keeps pure curation code free of I/O, framework, database, clock, RNG, and AI seams', () => {
    const moduleRoot = new URL(
      '../apps/server/src/modules/curation/',
      import.meta.url,
    );
    const purePaths = [
      'closed_manual_curation_input.ts',
      'manual_curation.ts',
      'manual_curation_contract.ts',
      'manual_curation_identity.ts',
    ];
    const source = purePaths
      .map((path) =>
        readFileSync(fileURLToPath(new URL(path, moduleRoot)), 'utf8'),
      )
      .join('\n');
    expect(source).not.toMatch(
      /from ['"](?:node:(?:fs|http|https|net|dns|path|os)|@nestjs|pg|drizzle|pg-boss|playwright)/u,
    );
    expect(source).not.toMatch(
      /\b(?:fetch|XMLHttpRequest|Date\.now|new Date|Math\.random|randomUUID|process\.env|OpenAI|Anthropic)\b/u,
    );
    expect(source).not.toMatch(/\b(?:preference|ranking|threshold)\b/iu);
  });

  it('freezes a complete exact issue matrix without byte-budget aliases', () => {
    expect(CURATION_EXACT_ISSUE_ORACLES).toHaveLength(31);
    const codes = new Set(
      CURATION_EXACT_ISSUE_ORACLES.map((oracle) => oracle.code),
    );
    expect(codes).toEqual(
      new Set([
        'invalid_shape',
        'invalid_identifier',
        'invalid_text',
        'invalid_state',
        'limit_exceeded',
        'duplicate_operation',
        'target_not_found',
        'term_not_found',
        'term_retired',
        'invalid_parent',
        'hierarchy_cycle',
        'stale_revision',
        'idempotency_conflict',
        'persistence_failed',
      ]),
    );
    const budgets = new Set(
      CURATION_EXACT_ISSUE_ORACLES.flatMap((oracle) =>
        oracle.budget === undefined ? [] : [oracle.budget],
      ),
    );
    expect(budgets).toEqual(
      new Set([
        'command_operations',
        'current_classifications',
        'feedback_reasons',
        'display_name_code_points',
        'description_code_points',
        'note_code_points',
        'idempotency_key_characters',
        'revision_number',
        'target_version',
      ]),
    );
    expect([...budgets].some((budget) => budget.includes('byte'))).toBe(false);
    expect(CURATION_LIMITS).toEqual({
      commandOperations: CURATION_LIMIT_ORACLE.commandOperations,
      currentClassifications: CURATION_LIMIT_ORACLE.currentClassifications,
      feedbackReasons: CURATION_LIMIT_ORACLE.feedbackReasons,
      displayNameCodePoints: CURATION_LIMIT_ORACLE.displayNameCodePoints,
      descriptionCodePoints: CURATION_LIMIT_ORACLE.descriptionCodePoints,
      noteCodePoints: CURATION_LIMIT_ORACLE.noteCodePoints,
      idempotencyKeyCharacters: CURATION_LIMIT_ORACLE.idempotencyKeyCharacters,
      revisionNumber: CURATION_LIMIT_ORACLE.revisionNumber,
      targetVersion: CURATION_LIMIT_ORACLE.targetVersion,
    });
    expect(CURATION_CONTRACT_ORACLE.contractId).toBe('C-SLICE-A-CURATION-r3');
  });
});
