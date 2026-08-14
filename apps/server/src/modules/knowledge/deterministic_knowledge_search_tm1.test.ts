import {readFileSync, readdirSync} from 'node:fs';

import {describe, expect, it, vi} from 'vitest';

import {
  RETRIEVAL_BUDGET_NAMES,
  RETRIEVAL_CURSOR_KNOWN_ANSWERS,
  RETRIEVAL_DIGEST_KNOWN_ANSWERS,
  RETRIEVAL_FROZEN_FILE_HASHES,
  RETRIEVAL_LIMITS,
  RETRIEVAL_SCHEMA_VERSION,
  RETRIEVAL_TM1_LEDGER,
  SYNTHETIC_RETRIEVAL_IDS,
  cloneSynthetic,
  codePointCount,
  codePointLedger,
  compareUtf8,
  createBrowseProjection,
  createBrowseRequest,
  createDigestProjectionFromTrustedRequest,
  createExpectedCursor,
  createRichProjection,
  createSaturatedCursor,
  createSaturatedProjection,
  createSyntheticContext,
  createSyntheticSnapshot,
  createTextProjection,
  createTrapCounter,
  createZeroTrapProxy,
  defineOwnAccessor,
  defineOwnDataProperty,
  independentUuidV5,
  isRecursivelyFrozen,
  measureIndependentCanonicalJson,
  measureIndependentCursorJson,
  measureUnicode17SearchKeyInvariants,
  oldNonIdempotentSearchKey,
  querySha256FromTrustedRequest,
  searchKeyV1,
  sha256,
  type RetrievalTm1LedgerRow,
  type SearchIssueOracle,
} from '../../../test_support/deterministic_knowledge_search_tm1_oracle.js';

type ExecuteDeterministicKnowledgeSearch = (
  repository: DeterministicKnowledgeSearchRepository,
  contextInput: unknown,
  requestInput: unknown,
) => Promise<unknown>;

interface DeterministicKnowledgeSearchRepository {
  readonly loadCurrentKnowledgeSearchSnapshot: (
    effectiveWorkspaceId: string,
  ) => Promise<unknown>;
}

interface PublicRetrievalModule {
  readonly executeDeterministicKnowledgeSearch: ExecuteDeterministicKnowledgeSearch;
}

interface ExecutedFixture {
  readonly result: unknown;
  readonly repository: SyntheticRepository;
}

const publicModuleUrl = new URL('./index.js', import.meta.url).href;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (!isRecord(value)) throw new TypeError(`${label} must be a record.`);
  return value;
}

function requireArray(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) throw new TypeError(`${label} must be an array.`);
  return value;
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== 'string') throw new TypeError(`${label} must be text.`);
  return value;
}

function nonCanonicalUppercaseUuid(value: string): string {
  return `A${value.slice(1)}`;
}

function setText(
  request: Record<string, unknown>,
  value: string,
  mode: 'exact' | 'substring' = 'exact',
  fields: unknown[] = ['title'],
): void {
  request.text = {value, mode, fields};
}

function requestFilters(
  request: Record<string, unknown>,
): Record<string, unknown> {
  return requireRecord(request.filters, 'request.filters');
}

function requestPage(
  request: Record<string, unknown>,
): Record<string, unknown> {
  return requireRecord(request.page, 'request.page');
}

function snapshotArray(
  snapshot: Record<string, unknown>,
  field: string,
): unknown[] {
  return requireArray(snapshot[field], `snapshot.${field}`);
}

function itemValue(
  snapshot: Record<string, unknown>,
  itemId: string,
): Record<string, unknown> {
  const revision = snapshotArray(snapshot, 'revisions').find(
    (entry) => isRecord(entry) && entry.itemId === itemId,
  );
  return requireRecord(
    requireRecord(revision, 'revision').value,
    'revision.value',
  );
}

function expectRejected(
  actual: unknown,
  expected: SearchIssueOracle,
  row: RetrievalTm1LedgerRow,
): void {
  expect(actual, row.id).toEqual({status: 'rejected', issue: expected});
  const record = requireRecord(actual, `${row.id} rejected result`);
  expect(record, row.id).not.toHaveProperty('items');
  expect(record, row.id).not.toHaveProperty('nextCursor');
}

function expectFailed(
  actual: unknown,
  code: 'invalid_repository_snapshot' | 'repository_failed',
  row: RetrievalTm1LedgerRow,
): void {
  expect(actual, row.id).toEqual({
    status: 'failed',
    issue: {code, path: 'repository'},
  });
  const record = requireRecord(actual, `${row.id} failed result`);
  expect(record, row.id).not.toHaveProperty('items');
  expect(record, row.id).not.toHaveProperty('nextCursor');
}

function requireOk(
  actual: unknown,
  row: RetrievalTm1LedgerRow,
): Record<string, unknown> {
  const result = requireRecord(actual, `${row.id} result`);
  expect(result.status, row.id).toBe('ok');
  expect(result.querySha256, row.id).toMatch(/^[0-9a-f]{64}$/u);
  expect(Array.isArray(result.items), row.id).toBe(true);
  return result;
}

function resultItems(
  result: Record<string, unknown>,
  row: RetrievalTm1LedgerRow,
): Record<string, unknown>[] {
  return requireArray(result.items, `${row.id} items`).map((item) =>
    requireRecord(item, `${row.id} item`),
  );
}

class SyntheticRepository implements DeterministicKnowledgeSearchRepository {
  readonly workspaceIds: string[] = [];
  calls = 0;

  constructor(
    private readonly snapshot: unknown,
    private readonly failure?: Error,
  ) {}

  async loadCurrentKnowledgeSearchSnapshot(
    effectiveWorkspaceId: string,
  ): Promise<unknown> {
    this.calls += 1;
    this.workspaceIds.push(effectiveWorkspaceId);
    if (this.failure !== undefined) throw this.failure;
    return Promise.resolve(this.snapshot);
  }
}

async function loadPublicRetrievalModule(
  row: RetrievalTm1LedgerRow,
): Promise<PublicRetrievalModule> {
  const imported: unknown = await import(publicModuleUrl);
  if (!isRecord(imported)) {
    throw new TypeError(
      `${row.id} public knowledge index is not a module record.`,
    );
  }
  const execute = imported.executeDeterministicKnowledgeSearch;
  if (typeof execute !== 'function') {
    throw new TypeError(
      `${row.id} EXPECTED_RED_PUBLIC_ENTRY_MISSING: knowledge/index.ts must export executeDeterministicKnowledgeSearch.`,
    );
  }
  return {
    executeDeterministicKnowledgeSearch:
      execute as ExecuteDeterministicKnowledgeSearch,
  };
}

async function executeWithModule(
  module: PublicRetrievalModule,
  row: RetrievalTm1LedgerRow,
  options: Readonly<{
    context?: unknown;
    request?: unknown;
    snapshot?: unknown;
    repositoryFailure?: Error;
  }> = {},
): Promise<ExecutedFixture> {
  const snapshot = selectOwnDataOption(
    options,
    'snapshot',
    createSyntheticSnapshot,
  );
  const context = selectOwnDataOption(
    options,
    'context',
    createSyntheticContext,
  );
  const request = selectOwnDataOption(options, 'request', createBrowseRequest);
  const repository = new SyntheticRepository(
    snapshot,
    options.repositoryFailure,
  );
  const result = await module.executeDeterministicKnowledgeSearch(
    repository,
    context,
    request,
  );
  return {result, repository};
}

function selectOwnDataOption(
  options: object,
  key: 'context' | 'request' | 'snapshot',
  createDefault: () => unknown,
): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(options, key);
  if (descriptor === undefined) return createDefault();
  if (!Object.hasOwn(descriptor, 'value')) {
    throw new TypeError(`Fixture option ${key} must be an own data property.`);
  }
  return descriptor.value;
}

async function withObjectPrototypeDescriptor<T>(
  key: string,
  descriptor: PropertyDescriptor,
  action: () => T | Promise<T>,
): Promise<T> {
  const original = Object.getOwnPropertyDescriptor(Object.prototype, key);
  if (original?.configurable === false) {
    throw new TypeError(`Object.prototype.${key} is non-configurable.`);
  }
  Object.defineProperty(Object.prototype, key, {
    configurable: true,
    enumerable: false,
    ...descriptor,
  });
  try {
    return await action();
  } finally {
    if (original === undefined) {
      Reflect.deleteProperty(Object.prototype, key);
    } else {
      Object.defineProperty(Object.prototype, key, original);
    }
  }
}

function fileSha256(url: URL): string {
  return sha256(readFileSync(url));
}

function expectMeasurement(
  actual: ReturnType<typeof measureIndependentCanonicalJson>,
  expected: Readonly<{
    bytes: number;
    values: number;
    depth: number;
    sha256: string;
  }>,
  id: string,
): void {
  expect(actual, id).toMatchObject(expected);
}

function evaluateNormalizationOracle(row: RetrievalTm1LedgerRow): void {
  switch (row.groupOrdinal) {
    case 1:
      expect(searchKeyV1('J\u030c'), row.id).toBe(
        asciiIndependent('J\u030c'.normalize('NFC')).normalize('NFC'),
      );
      return;
    case 2:
      expect(
        codePointLedger(oldNonIdempotentSearchKey('J\u030c')),
        row.id,
      ).toBe('U+006A U+030C');
      expect(codePointLedger(searchKeyV1('J\u030c')), row.id).toBe('U+01F0');
      expect(searchKeyV1(searchKeyV1('J\u030c')), row.id).toBe('\u01f0');
      return;
    case 3:
      expect(
        codePointLedger(oldNonIdempotentSearchKey('H\u0331')),
        row.id,
      ).toBe('U+0068 U+0331');
      expect(codePointLedger(searchKeyV1('H\u0331')), row.id).toBe('U+1E96');
      expect(searchKeyV1(searchKeyV1('H\u0331')), row.id).toBe('\u1e96');
      return;
    case 4:
      expect(searchKeyV1('ABC xyz'), row.id).toBe('abc xyz');
      return;
    case 5:
      expect(searchKeyV1('e\u0301'), row.id).toBe(searchKeyV1('\u00e9'));
      return;
    case 6:
      expect(searchKeyV1('\u77e5\u8bc6\u6570\u636e\u5e93'), row.id).toContain(
        searchKeyV1('\u77e5\u8bc6'),
      );
      return;
    case 7:
      expect(searchKeyV1('\u{1f600}\u03a9'), row.id).toBe('\u{1f600}\u03a9');
      return;
    case 8:
      expect(searchKeyV1('\uff21'), row.id).not.toBe(searchKeyV1('A'));
      return;
    case 9:
      expect(searchKeyV1('Stra\u00dfe'), row.id).not.toBe(
        searchKeyV1('STRASSE'),
      );
      return;
    case 10: {
      const measured = measureUnicode17SearchKeyInvariants();
      expect(process.versions.unicode, row.id).toBe('17.0');
      expect(measured.scalarCount, row.id).toBe(1_112_064);
      expect(measured.scalarIdempotenceFailures, row.id).toBe(0);
      return;
    }
    case 11: {
      const measured = measureUnicode17SearchKeyInvariants();
      expect(measured.markScalarCount, row.id).toBe(2_543);
      expect(measured.asciiMarkVectorCount, row.id).toBe(66_118);
      expect(measured.asciiMarkIdempotenceFailures, row.id).toBe(0);
      expect(measured.oldAsciiMarkIdempotenceFailures, row.id).toBe(6);
      expect(measured.oldFailureInputs, row.id).toContain('U+004A U+030C');
      expect(measured.oldFailureInputs, row.id).toContain('U+0048 U+0331');
      return;
    }
    case 12: {
      const measured = measureUnicode17SearchKeyInvariants();
      expect(measured, row.id).toMatchObject({
        maxNfdCodePoints: 4,
        maxNfdWitnessCount: 36,
        maxNfdFirstPairCompositionFailures: 0,
        maxSearchKeyCodePoints: 3,
        maxSearchKeyCodePointWitnessCount: 11,
        maxSearchKeyUtf8Bytes: 12,
        maxSearchKeyByteWitnessCount: 9,
      });
      for (const [scalar, bytes] of [
        ['\ufb2c', 1_800],
        ['\u{1d160}', 3_600],
      ] as const) {
        const key = searchKeyV1(scalar.repeat(300));
        expect(
          codePointCount(key),
          `${row.id} ${codePointLedger(scalar)}`,
        ).toBe(900);
        expect(Buffer.byteLength(key), row.id).toBe(bytes);
        expect(searchKeyV1(key), row.id).toBe(key);
      }
      return;
    }
    default:
      throw new RangeError(`${row.id} normalization oracle is missing.`);
  }
}

function asciiIndependent(value: string): string {
  return Array.from(value)
    .map((scalar) => {
      const codePoint = scalar.codePointAt(0);
      if (codePoint === undefined) throw new TypeError('Missing scalar.');
      return codePoint >= 0x41 && codePoint <= 0x5a
        ? String.fromCodePoint(codePoint + 0x20)
        : scalar;
    })
    .join('');
}

function evaluateUtf8OrderOracle(row: RetrievalTm1LedgerRow): void {
  const vectors: readonly Readonly<{
    left: string;
    right: string;
    expected: -1 | 0 | 1;
  }>[] = [
    {left: 'A', right: 'a', expected: -1},
    {left: 'a', right: '\u77e5', expected: -1},
    {left: '\u77e5', right: '\u{1f600}', expected: -1},
    {left: '\uff21', right: '\u{10000}', expected: -1},
    {left: searchKeyV1('e\u0301'), right: searchKeyV1('\u00e9'), expected: 0},
    {left: 'a', right: '\uff21', expected: -1},
    {
      left: searchKeyV1('Stra\u00dfe'),
      right: searchKeyV1('STRASSE'),
      expected: 1,
    },
    {
      left: '20000000-0000-4000-8000-000000000001',
      right: '20000000-0000-4000-8000-000000000002',
      expected: -1,
    },
    {left: 'rank-0', right: 'rank-1', expected: -1},
    {left: '\u77e5\u8bc6', right: '\u77e5\u8bc6', expected: 0},
  ];
  const vector = vectors[row.groupOrdinal - 1];
  if (vector === undefined)
    throw new RangeError(`${row.id} comparator vector missing.`);
  const actual = Math.sign(compareUtf8(vector.left, vector.right));
  expect(actual, row.id).toBe(vector.expected);
  if (row.groupOrdinal === 10) {
    const values = ['\u{1f600}', 'a', '\u77e5'].sort(compareUtf8);
    expect(values, row.id).toEqual(['a', '\u77e5', '\u{1f600}']);
  }
}

function evaluateDigestOracle(row: RetrievalTm1LedgerRow): void {
  switch (row.groupOrdinal) {
    case 1: {
      const request = createBrowseRequest();
      setText(request, 'J\u030c');
      const projection = createDigestProjectionFromTrustedRequest(request);
      expect(
        measureIndependentCanonicalJson(projection).text,
        row.id,
      ).not.toContain('J');
      expect(
        measureIndependentCanonicalJson(projection).text,
        row.id,
      ).toContain('\u01f0');
      return;
    }
    case 2:
      expectMeasurement(
        measureIndependentCanonicalJson(
          createTextProjection(searchKeyV1('e\u0301')),
        ),
        RETRIEVAL_DIGEST_KNOWN_ANSWERS.eAcute,
        row.id,
      );
      expect(searchKeyV1('e\u0301'), row.id).toBe(searchKeyV1('\u00e9'));
      return;
    case 3:
      expectMeasurement(
        measureIndependentCanonicalJson(
          createTextProjection(searchKeyV1('J\u030c')),
        ),
        RETRIEVAL_DIGEST_KNOWN_ANSWERS.jCaron,
        row.id,
      );
      return;
    case 4:
      expectMeasurement(
        measureIndependentCanonicalJson(
          createTextProjection(searchKeyV1('H\u0331')),
        ),
        RETRIEVAL_DIGEST_KNOWN_ANSWERS.hLineBelow,
        row.id,
      );
      return;
    case 5:
      expectMeasurement(
        measureIndependentCanonicalJson(createBrowseProjection()),
        RETRIEVAL_DIGEST_KNOWN_ANSWERS.browse,
        row.id,
      );
      return;
    case 6:
      expectMeasurement(
        measureIndependentCanonicalJson(createRichProjection()),
        RETRIEVAL_DIGEST_KNOWN_ANSWERS.rich,
        row.id,
      );
      return;
    case 7:
      expectMeasurement(
        measureIndependentCanonicalJson(createSaturatedProjection()),
        RETRIEVAL_DIGEST_KNOWN_ANSWERS.saturated,
        row.id,
      );
      return;
    case 8: {
      const measurement = measureIndependentCanonicalJson(
        createSaturatedProjection(),
      );
      expect(measurement.values, row.id).toBe(81);
      expect(measurement.depth, row.id).toBe(4);
      expect(measurement.bytes, row.id).toBeLessThan(
        RETRIEVAL_LIMITS.digestBytes,
      );
      expect(measurement.values, row.id).toBeLessThan(
        RETRIEVAL_LIMITS.digestValues,
      );
      expect(measurement.depth, row.id).toBeLessThan(
        RETRIEVAL_LIMITS.digestDepth,
      );
      expect(measurement.bytes, row.id).toBeLessThan(
        RETRIEVAL_LIMITS.encoderBytes,
      );
      expect(measurement.values, row.id).toBeLessThan(
        RETRIEVAL_LIMITS.encoderValues,
      );
      expect(measurement.depth, row.id).toBeLessThan(
        RETRIEVAL_LIMITS.encoderDepth,
      );
      return;
    }
    case 9: {
      const request = createBrowseRequest();
      const filters = requestFilters(request);
      filters.knowledgeKinds = ['work', 'entity'];
      const first = querySha256FromTrustedRequest(request);
      filters.knowledgeKinds = ['entity', 'work'];
      expect(querySha256FromTrustedRequest(request), row.id).toBe(first);
      return;
    }
    case 10: {
      const first = createBrowseRequest(1);
      const second = createBrowseRequest(100);
      expect(querySha256FromTrustedRequest(first), row.id).toBe(
        querySha256FromTrustedRequest(second),
      );
      return;
    }
    case 11: {
      const first = createBrowseRequest();
      const second = cloneSynthetic(first);
      requestPage(second).after = createExpectedCursor(
        second,
        4,
        'synthetic',
        SYNTHETIC_RETRIEVAL_IDS.itemA,
      );
      expect(querySha256FromTrustedRequest(first), row.id).toBe(
        querySha256FromTrustedRequest(second),
      );
      return;
    }
    case 12: {
      const first = createBrowseRequest();
      const second = cloneSynthetic(first);
      setText(second, 'synthetic');
      expect(querySha256FromTrustedRequest(second), row.id).not.toBe(
        querySha256FromTrustedRequest(first),
      );
      expect(RETRIEVAL_BUDGET_NAMES, row.id).not.toContain('request_bytes');
      return;
    }
    default:
      throw new RangeError(`${row.id} digest oracle is missing.`);
  }
}

function evaluateIndependentOracle(row: RetrievalTm1LedgerRow): void {
  if (row.group === 'normalization') {
    evaluateNormalizationOracle(row);
  } else if (row.group === 'utf8-order') {
    evaluateUtf8OrderOracle(row);
  } else if (row.group === 'digest-capacity') {
    evaluateDigestOracle(row);
  } else {
    throw new RangeError(`${row.id} is not an independent oracle row.`);
  }
}

function ownedSourceText(): string {
  const urls = [
    new URL('./deterministic_knowledge_search_tm1.test.ts', import.meta.url),
    new URL(
      '../../../test_support/deterministic_knowledge_search_tm1_oracle.ts',
      import.meta.url,
    ),
  ];
  return urls.map((url) => readFileSync(url, 'utf8')).join('\n');
}

function evaluateBoundaryOracle(row: RetrievalTm1LedgerRow): void {
  const source = ownedSourceText();
  const repositoryRoot = new URL('../../../../../', import.meta.url);
  switch (row.groupOrdinal) {
    case 1:
      expect(source, row.id).not.toMatch(
        /from ['"][^'"]*(?:normaliz|digest|cursor|ranking|decoder|filter|expected_map|fixture)[^'"]*['"]/iu,
      );
      expect(source, row.id).toContain(
        "new URL('./index.js', import.meta.url)",
      );
      return;
    case 2: {
      for (const token of [
        ['s', 'kip'].join(''),
        ['t', 'odo'].join(''),
        ['o', 'nly'].join(''),
      ]) {
        expect(source, row.id).not.toMatch(
          new RegExp(`\\.${token}\\s*\\(`, 'u'),
        );
      }
      const emptyGate = ['passWithNo', 'Tests'].join('');
      expect(source, row.id).not.toContain(emptyGate);
      expect(source, row.id).not.toContain(`--${emptyGate}`);
      return;
    }
    case 3: {
      for (const token of [
        ['eslint', '-disable'].join(''),
        ['ts', '-ignore'].join(''),
        ['ts', '-expect-error'].join(''),
        ['as ', 'any'].join(''),
      ]) {
        expect(source, row.id).not.toContain(token);
      }
      return;
    }
    case 4:
      expect(source, row.id).toContain('synthetic');
      expect(source, row.id).not.toContain(
        ['personal', ' vocabulary'].join(''),
      );
      return;
    case 5: {
      const privateKey = ['BEGIN ', 'PRIVATE KEY'].join('');
      const usersPath = ['[A-Za-z]:\\\\', 'Users\\\\'].join('');
      expect(source, row.id).not.toContain(privateKey);
      expect(source, row.id).not.toMatch(new RegExp(usersPath, 'u'));
      expect(source, row.id).not.toMatch(
        /postgres(?:ql)?:\/\/[^\s/:@]+:[^\s/@]+@/iu,
      );
      return;
    }
    case 6: {
      const realSourceCanary = ['ruan', 'yf'].join('');
      const stageCanary = ['stage', '-0'].join('');
      expect(source, row.id).not.toContain(realSourceCanary);
      expect(source, row.id).not.toContain(stageCanary);
      return;
    }
    case 7:
      expect(
        fileSha256(new URL('package.json', repositoryRoot)).toUpperCase(),
        row.id,
      ).toBe(RETRIEVAL_FROZEN_FILE_HASHES.package);
      expect(
        fileSha256(
          new URL('apps/server/package.json', repositoryRoot),
        ).toUpperCase(),
        row.id,
      ).toBe(RETRIEVAL_FROZEN_FILE_HASHES.serverPackage);
      expect(
        fileSha256(new URL('pnpm-lock.yaml', repositoryRoot)).toUpperCase(),
        row.id,
      ).toBe(RETRIEVAL_FROZEN_FILE_HASHES.lockfile);
      return;
    case 8:
      expect(
        fileSha256(
          new URL(
            'apps/server/migrations/000004_create_manual_knowledge_core.sql',
            repositoryRoot,
          ),
        ).toUpperCase(),
        row.id,
      ).toBe(RETRIEVAL_FROZEN_FILE_HASHES.migration);
      expect(
        fileSha256(
          new URL('THIRD_PARTY_NOTICES.md', repositoryRoot),
        ).toUpperCase(),
        row.id,
      ).toBe(RETRIEVAL_FROZEN_FILE_HASHES.notices);
      return;
    case 9: {
      const verifier = readFileSync(
        new URL('tools/verify_application_artifact.ts', repositoryRoot),
        'utf8',
      );
      expect(verifier, row.id).toContain("path.includes('.test.')");
      expect(verifier, row.id).toContain('apps\\/server\\/dist');
      expect(
        new URL('../../../test_support/', import.meta.url).pathname,
        row.id,
      ).not.toContain('/dist/');
      return;
    }
    case 10: {
      const packageText = readFileSync(
        new URL('package.json', repositoryRoot),
        'utf8',
      );
      const serverPackageText = readFileSync(
        new URL('apps/server/package.json', repositoryRoot),
        'utf8',
      );
      expect(`${packageText}\n${serverPackageText}`, row.id).not.toMatch(
        /retrieval|search service|tokenizer|embedding/iu,
      );
      return;
    }
    default:
      throw new RangeError(`${row.id} boundary oracle is missing.`);
  }
}

function issue(code: string, path: string, budget?: string): SearchIssueOracle {
  return budget === undefined ? {code, path} : {code, path, budget};
}

async function expectRequestRejection(
  module: PublicRetrievalModule,
  row: RetrievalTm1LedgerRow,
  expected: SearchIssueOracle,
  options: Readonly<{
    context?: unknown;
    request?: unknown;
  }> = {},
): Promise<void> {
  const execution = await executeWithModule(module, row, options);
  expectRejected(execution.result, expected, row);
  expect(execution.repository.calls, row.id).toBe(0);
}

async function expectBrowseIds(
  module: PublicRetrievalModule,
  row: RetrievalTm1LedgerRow,
  request: unknown,
  expectedIds: readonly string[],
  snapshot: unknown = createSyntheticSnapshot(),
): Promise<Record<string, unknown>> {
  const execution = await executeWithModule(module, row, {request, snapshot});
  const result = requireOk(execution.result, row);
  expect(
    resultItems(result, row).map((item) => item.itemId),
    row.id,
  ).toEqual(expectedIds);
  expect(execution.repository.calls, row.id).toBe(1);
  return result;
}

function sourceFilter(
  kind: 'resource' | 'snapshot' | 'fragment',
  identifier: string,
  inputKinds: readonly string[] = [],
): Record<string, unknown> {
  return {
    kind,
    [`${kind}Id`]: identifier,
    inputKinds: [...inputKinds],
  };
}

function connectedFilter(
  direction: 'outgoing' | 'incoming' | 'either' = 'either',
): Record<string, unknown> {
  return {
    kind: 'connected_to',
    anchorItemId: SYNTHETIC_RETRIEVAL_IDS.itemA,
    direction,
    relationTypeKeys: [],
    reviewStates: [],
  };
}

function mutateArray(
  snapshot: Record<string, unknown>,
  field: string,
  mutate: (values: unknown[]) => void,
): void {
  mutate(snapshotArray(snapshot, field));
}

function onlyItem(
  snapshot: Record<string, unknown>,
  itemId: string,
): Record<string, unknown> {
  const found = snapshotArray(snapshot, 'items').find(
    (entry) => isRecord(entry) && entry.itemId === itemId,
  );
  return requireRecord(found, `snapshot item ${itemId}`);
}

function onlyRelation(
  snapshot: Record<string, unknown>,
  relationId: string,
): Record<string, unknown> {
  const found = snapshotArray(snapshot, 'relations').find(
    (entry) => isRecord(entry) && entry.relationId === relationId,
  );
  return requireRecord(found, `snapshot relation ${relationId}`);
}

function exactResultItem(
  result: Record<string, unknown>,
  row: RetrievalTm1LedgerRow,
  itemId: string,
): Record<string, unknown> {
  const found = resultItems(result, row).find((item) => item.itemId === itemId);
  return requireRecord(found, `${row.id} result item ${itemId}`);
}

function expectSyntheticSnapshotFixtureInvariants(): void {
  const snapshot = createSyntheticSnapshot();
  const inputs = snapshotArray(snapshot, 'fragmentInputs').map((entry) =>
    requireRecord(entry, 'synthetic Fragment input'),
  );
  const expectedOrder = [...inputs].sort((left, right) => {
    const itemOrder = compareUtf8(
      requireString(left.itemId, 'left item ID'),
      requireString(right.itemId, 'right item ID'),
    );
    if (itemOrder !== 0) return itemOrder;
    const kindOrder: Readonly<Record<string, number>> = {
      citation: 0,
      derivation: 1,
    };
    const kindDifference =
      (kindOrder[requireString(left.inputKind, 'left input kind')] ?? 99) -
      (kindOrder[requireString(right.inputKind, 'right input kind')] ?? 99);
    if (kindDifference !== 0) return kindDifference;
    return Number(left.inputOrdinal) - Number(right.inputOrdinal);
  });
  expect(inputs).toEqual(expectedOrder);

  const nextOrdinal = new Map<string, number>();
  for (const input of inputs) {
    const key = [
      requireString(input.itemId, 'Fragment input item ID'),
      String(input.revision),
      requireString(input.inputKind, 'Fragment input kind'),
    ].join('\u0000');
    const expectedOrdinal = nextOrdinal.get(key) ?? 0;
    expect(input.inputOrdinal).toBe(expectedOrdinal);
    nextOrdinal.set(key, expectedOrdinal + 1);
  }

  for (const field of ['revisions', 'relationRevisions']) {
    for (const entry of snapshotArray(snapshot, field)) {
      const revision = requireRecord(entry, `${field} entry`);
      const value = requireRecord(revision.value, `${field} value`);
      if (revision.revision === 1) {
        expect(value.reviewState).not.toBe('rejected');
        expect(value.reviewState).not.toBe('withdrawn');
      }
    }
  }

  const relation = onlyRelation(snapshot, SYNTHETIC_RETRIEVAL_IDS.relationC);
  const revision = snapshotArray(snapshot, 'relationRevisions')
    .map((entry) => requireRecord(entry, 'relation revision'))
    .find((entry) => entry.relationId === SYNTHETIC_RETRIEVAL_IDS.relationC);
  const relationRevision = requireRecord(revision, 'relationC revision');
  const expectedRevisionId = independentUuidV5(
    SYNTHETIC_RETRIEVAL_IDS.relationC,
    'struinfo:knowledge-relation-revision:v1:2',
  );
  expect(relation.currentRevision).toBe(2);
  expect(relation.currentRevisionId).toBe(expectedRevisionId);
  expect(relationRevision.revision).toBe(2);
  expect(relationRevision.revisionId).toBe(expectedRevisionId);
  expect(
    requireRecord(relationRevision.value, 'relationC value').reviewState,
  ).toBe('withdrawn');
}

async function evaluateIdentityGovernance(
  module: PublicRetrievalModule,
  row: RetrievalTm1LedgerRow,
): Promise<void> {
  const repositoryRoot = new URL('../../../../../', import.meta.url);
  if (row.groupOrdinal === 1) {
    expect(module.executeDeterministicKnowledgeSearch, row.id).toBeTypeOf(
      'function',
    );
    return;
  }
  if (row.groupOrdinal === 2) {
    expect(RETRIEVAL_SCHEMA_VERSION, row.id).toBe(
      'struinfo.deterministic-knowledge-search.v1',
    );
    const result = requireOk(
      (await executeWithModule(module, row)).result,
      row,
    );
    expect(result.querySha256, row.id).toBe(
      querySha256FromTrustedRequest(createBrowseRequest()),
    );
    return;
  }
  if (row.groupOrdinal === 3 || row.groupOrdinal === 4) {
    const execution = await executeWithModule(module, row);
    requireOk(execution.result, row);
    expect(execution.repository.workspaceIds, row.id).toEqual([
      SYNTHETIC_RETRIEVAL_IDS.workspace,
    ]);
    expect(execution.repository.calls, row.id).toBe(1);
    return;
  }
  const checks = [
    {
      ordinal: 5,
      path: 'docs/deterministic-knowledge-retrieval-contract.md',
      hash: RETRIEVAL_FROZEN_FILE_HASHES.contract,
    },
    {
      ordinal: 6,
      path: 'apps/server/migrations/000004_create_manual_knowledge_core.sql',
      hash: RETRIEVAL_FROZEN_FILE_HASHES.migration,
    },
    {
      ordinal: 7,
      path: 'pnpm-lock.yaml',
      hash: RETRIEVAL_FROZEN_FILE_HASHES.lockfile,
    },
  ];
  const check = checks.find((entry) => entry.ordinal === row.groupOrdinal);
  if (check !== undefined) {
    expect(
      fileSha256(new URL(check.path, repositoryRoot)).toUpperCase(),
      row.id,
    ).toBe(check.hash);
    return;
  }
  expect(RETRIEVAL_BUDGET_NAMES, row.id).not.toContain('request_bytes');
}

async function evaluateClosedUnions(
  module: PublicRetrievalModule,
  row: RetrievalTm1LedgerRow,
): Promise<void> {
  const request = createBrowseRequest();
  switch (row.groupOrdinal) {
    case 1:
      await expectRequestRejection(
        module,
        row,
        issue('invalid_shape', 'context'),
        {
          context: null,
        },
      );
      return;
    case 2: {
      const context = createSyntheticContext();
      context.extra = true;
      await expectRequestRejection(
        module,
        row,
        issue('invalid_shape', 'context'),
        {
          context,
        },
      );
      return;
    }
    case 3: {
      const context = createSyntheticContext();
      context.authority = 'synthetic_unknown';
      await expectRequestRejection(
        module,
        row,
        issue('invalid_enum', 'context.authority'),
        {context},
      );
      return;
    }
    case 4:
      await expectRequestRejection(
        module,
        row,
        issue('invalid_shape', 'request'),
        {
          request: null,
        },
      );
      return;
    case 5:
      request.workspaceId = SYNTHETIC_RETRIEVAL_IDS.otherWorkspace;
      await expectRequestRejection(
        module,
        row,
        issue('invalid_shape', 'request'),
        {
          request,
        },
      );
      return;
    case 6:
      request.filters = null;
      await expectRequestRejection(
        module,
        row,
        issue('invalid_shape', 'request.filters'),
        {request},
      );
      return;
    case 7:
      expect(
        (
          await expectBrowseIds(module, row, request, [
            SYNTHETIC_RETRIEVAL_IDS.itemA,
            SYNTHETIC_RETRIEVAL_IDS.itemB,
            SYNTHETIC_RETRIEVAL_IDS.itemC,
          ])
        ).querySha256,
        row.id,
      ).toBe(querySha256FromTrustedRequest(request));
      return;
    case 8:
      request.text = 'synthetic';
      await expectRequestRejection(
        module,
        row,
        issue('invalid_shape', 'request.text'),
        {request},
      );
      return;
    case 9:
      expect(requestFilters(request).source, row.id).toEqual({kind: 'any'});
      await expectBrowseIds(module, row, request, [
        SYNTHETIC_RETRIEVAL_IDS.itemA,
        SYNTHETIC_RETRIEVAL_IDS.itemB,
        SYNTHETIC_RETRIEVAL_IDS.itemC,
      ]);
      return;
    case 10:
      requestFilters(request).source = sourceFilter(
        'resource',
        SYNTHETIC_RETRIEVAL_IDS.resourceA,
      );
      await expectBrowseIds(module, row, request, [
        SYNTHETIC_RETRIEVAL_IDS.itemA,
        SYNTHETIC_RETRIEVAL_IDS.itemB,
      ]);
      return;
    case 11:
      requestFilters(request).source = sourceFilter(
        'snapshot',
        SYNTHETIC_RETRIEVAL_IDS.snapshotA,
      );
      await expectBrowseIds(module, row, request, [
        SYNTHETIC_RETRIEVAL_IDS.itemA,
        SYNTHETIC_RETRIEVAL_IDS.itemB,
      ]);
      return;
    case 12:
      requestFilters(request).source = sourceFilter(
        'fragment',
        SYNTHETIC_RETRIEVAL_IDS.fragmentA,
      );
      await expectBrowseIds(module, row, request, [
        SYNTHETIC_RETRIEVAL_IDS.itemA,
      ]);
      return;
    case 13:
      await expectBrowseIds(module, row, request, [
        SYNTHETIC_RETRIEVAL_IDS.itemA,
        SYNTHETIC_RETRIEVAL_IDS.itemB,
        SYNTHETIC_RETRIEVAL_IDS.itemC,
      ]);
      return;
    case 14:
      requestFilters(request).relation = connectedFilter('outgoing');
      await expectBrowseIds(module, row, request, [
        SYNTHETIC_RETRIEVAL_IDS.itemB,
      ]);
      return;
    case 15:
      requestPage(request).after = createExpectedCursor(
        request,
        4,
        searchKeyV1('Alpha Synthetic'),
        SYNTHETIC_RETRIEVAL_IDS.itemA,
      );
      expect(
        requireOk(
          (await executeWithModule(module, row, {request})).result,
          row,
        ),
        row.id,
      ).toHaveProperty('status', 'ok');
      return;
    case 16: {
      const ok = requireOk((await executeWithModule(module, row)).result, row);
      expect(Object.keys(ok).sort(compareUtf8), row.id).toEqual([
        'items',
        'querySha256',
        'status',
        'totalCount',
      ]);
      return;
    }
    default:
      throw new RangeError(`${row.id} closed-union scenario is missing.`);
  }
}

class DeferredSyntheticRepository implements DeterministicKnowledgeSearchRepository {
  private releaseSnapshot: (() => void) | undefined;
  private readonly waitForRelease: Promise<void>;
  calls = 0;

  constructor(private readonly snapshot: unknown) {
    this.waitForRelease = new Promise((resolve) => {
      this.releaseSnapshot = resolve;
    });
  }

  release(): void {
    const release = this.releaseSnapshot;
    if (release === undefined)
      throw new TypeError('Repository release is unavailable.');
    this.releaseSnapshot = undefined;
    release();
  }

  async loadCurrentKnowledgeSearchSnapshot(): Promise<unknown> {
    this.calls += 1;
    await this.waitForRelease;
    return this.snapshot;
  }
}

async function evaluateHostileOwnership(
  module: PublicRetrievalModule,
  row: RetrievalTm1LedgerRow,
): Promise<void> {
  const request = createBrowseRequest();
  const context = createSyntheticContext();
  const snapshot = createSyntheticSnapshot();
  const counter = createTrapCounter();
  switch (row.groupOrdinal) {
    case 1:
      defineOwnAccessor(context, 'effectiveWorkspaceId', counter);
      await expectRequestRejection(
        module,
        row,
        issue('invalid_shape', 'context.effectiveWorkspaceId'),
        {
          context,
        },
      );
      expect(counter.count(), row.id).toBe(0);
      return;
    case 2:
      defineOwnAccessor(request, 'filters', counter);
      await expectRequestRejection(
        module,
        row,
        issue('invalid_shape', 'request.filters'),
        {
          request,
        },
      );
      expect(counter.count(), row.id).toBe(0);
      return;
    case 3:
      defineOwnAccessor(requestFilters(request), 'knowledgeKinds', counter);
      await expectRequestRejection(
        module,
        row,
        issue('invalid_shape', 'request.filters.knowledgeKinds'),
        {request},
      );
      expect(counter.count(), row.id).toBe(0);
      return;
    case 4:
      Reflect.deleteProperty(context, 'authority');
      await withObjectPrototypeDescriptor(
        'authority',
        {
          get: () => {
            counter.touch();
            throw new Error('Inherited getter must not run.');
          },
        },
        async () => {
          await expectRequestRejection(
            module,
            row,
            issue('invalid_shape', 'context.authority'),
            {
              context,
            },
          );
        },
      );
      expect(counter.count(), row.id).toBe(0);
      return;
    case 5:
      await withObjectPrototypeDescriptor(
        'status',
        {
          set: () => {
            counter.touch();
            throw new Error('Inherited setter must not run.');
          },
        },
        async () => {
          requireOk(
            (await executeWithModule(module, row, {request})).result,
            row,
          );
        },
      );
      expect(counter.count(), row.id).toBe(0);
      return;
    case 6:
      await expectRequestRejection(
        module,
        row,
        issue('invalid_shape', 'context'),
        {
          context: createZeroTrapProxy(context, counter),
        },
      );
      expect(counter.count(), row.id).toBe(0);
      return;
    case 7:
      await expectRequestRejection(
        module,
        row,
        issue('invalid_shape', 'request'),
        {
          request: createZeroTrapProxy(request, counter),
        },
      );
      expect(counter.count(), row.id).toBe(0);
      return;
    case 8:
      request.filters = createZeroTrapProxy(requestFilters(request), counter);
      await expectRequestRejection(
        module,
        row,
        issue('invalid_shape', 'request.filters'),
        {request},
      );
      expect(counter.count(), row.id).toBe(0);
      return;
    case 9: {
      const kinds = requestFilters(request).knowledgeKinds;
      requestFilters(request).knowledgeKinds = createZeroTrapProxy(
        requireArray(kinds, 'knowledge kinds'),
        counter,
      );
      await expectRequestRejection(
        module,
        row,
        issue('invalid_shape', 'request.filters.knowledgeKinds'),
        {request},
      );
      expect(counter.count(), row.id).toBe(0);
      return;
    }
    case 10: {
      snapshot.items = createZeroTrapProxy(
        snapshotArray(snapshot, 'items'),
        counter,
      );
      const execution = await executeWithModule(module, row, {
        snapshot,
      });
      expectFailed(execution.result, 'invalid_repository_snapshot', row);
      expect(counter.count(), row.id).toBe(0);
      return;
    }
    case 11:
      defineOwnDataProperty(request, Symbol('synthetic'), true);
      await expectRequestRejection(
        module,
        row,
        issue('invalid_shape', 'request'),
        {
          request,
        },
      );
      return;
    case 12:
      defineOwnDataProperty(request, '__proto__', {synthetic: true});
      await expectRequestRejection(
        module,
        row,
        issue('invalid_shape', 'request'),
        {
          request,
        },
      );
      expect(Object.getPrototypeOf(request), row.id).toBe(Object.prototype);
      return;
    case 13: {
      const sparse = new Array(1);
      requestFilters(request).knowledgeKinds = sparse;
      await expectRequestRejection(
        module,
        row,
        issue('invalid_shape', 'request.filters.knowledgeKinds'),
        {request},
      );
      return;
    }
    case 14: {
      const values: unknown[] = [];
      defineOwnDataProperty(values, 'syntheticExtra', true);
      requestFilters(request).knowledgeKinds = values;
      await expectRequestRejection(
        module,
        row,
        issue('invalid_shape', 'request.filters.knowledgeKinds'),
        {request},
      );
      return;
    }
    case 15:
      Object.setPrototypeOf(request, null);
      await expectRequestRejection(
        module,
        row,
        issue('invalid_shape', 'request'),
        {
          request,
        },
      );
      return;
    case 16: {
      const relation = requestFilters(request).relation;
      const relationRecord = requireRecord(relation, 'request relation');
      relationRecord.kind = 'connected_to';
      relationRecord.anchorItemId = SYNTHETIC_RETRIEVAL_IDS.itemA;
      relationRecord.direction = 'either';
      relationRecord.relationTypeKeys = [];
      relationRecord.reviewStates = [];
      defineOwnDataProperty(relationRecord, 'cycle', relationRecord);
      await expectRequestRejection(
        module,
        row,
        issue('invalid_shape', 'request.filters.relation'),
        {request},
      );
      return;
    }
    case 17:
      requireOk((await executeWithModule(module, row, {request})).result, row);
      expect(Object.isFrozen(request), row.id).toBe(false);
      expect(Object.isFrozen(requestFilters(request)), row.id).toBe(false);
      return;
    case 18:
      requireOk((await executeWithModule(module, row, {snapshot})).result, row);
      expect(Object.isFrozen(snapshot), row.id).toBe(false);
      expect(Object.isFrozen(snapshotArray(snapshot, 'items')), row.id).toBe(
        false,
      );
      return;
    case 19: {
      const repository = new DeferredSyntheticRepository(snapshot);
      const resultPromise = module.executeDeterministicKnowledgeSearch(
        repository,
        context,
        request,
      );
      requestPage(request).limit = 1;
      requestFilters(request).knowledgeKinds = ['work'];
      repository.release();
      const result = requireOk(await resultPromise, row);
      expect(result.totalCount, row.id).toBe(3);
      expect(resultItems(result, row), row.id).toHaveLength(3);
      return;
    }
    case 20: {
      const result = requireOk(
        (await executeWithModule(module, row, {snapshot})).result,
        row,
      );
      itemValue(snapshot, SYNTHETIC_RETRIEVAL_IDS.itemA).title = 'Mutated';
      expect(
        exactResultItem(result, row, SYNTHETIC_RETRIEVAL_IDS.itemA),
        row.id,
      ).toHaveProperty('value.title', 'Alpha Synthetic');
      return;
    }
    case 21: {
      const result = requireOk(
        (await executeWithModule(module, row)).result,
        row,
      );
      expect(isRecursivelyFrozen(result), row.id).toBe(true);
      return;
    }
    case 22: {
      const result = requireOk(
        (await executeWithModule(module, row, {request, snapshot})).result,
        row,
      );
      expect(
        exactResultItem(result, row, SYNTHETIC_RETRIEVAL_IDS.itemA).value,
        row.id,
      ).not.toBe(itemValue(snapshot, SYNTHETIC_RETRIEVAL_IDS.itemA));
      expect(result, row.id).not.toBe(request);
      return;
    }
    default:
      throw new RangeError(`${row.id} hostile-input scenario is missing.`);
  }
}

async function evaluateUuidTextBudgets(
  module: PublicRetrievalModule,
  row: RetrievalTm1LedgerRow,
): Promise<void> {
  const request = createBrowseRequest();
  const context = createSyntheticContext();
  switch (row.groupOrdinal) {
    case 1:
      context.effectiveWorkspaceId = nonCanonicalUppercaseUuid(
        SYNTHETIC_RETRIEVAL_IDS.workspace,
      );
      await expectRequestRejection(
        module,
        row,
        issue('invalid_identifier', 'context.effectiveWorkspaceId'),
        {context},
      );
      return;
    case 2:
      requestFilters(request).source = sourceFilter(
        'resource',
        nonCanonicalUppercaseUuid(SYNTHETIC_RETRIEVAL_IDS.resourceA),
      );
      await expectRequestRejection(
        module,
        row,
        issue('invalid_identifier', 'request.filters.source.resourceId'),
        {request},
      );
      return;
    case 3: {
      const relation = connectedFilter();
      relation.anchorItemId = nonCanonicalUppercaseUuid(
        SYNTHETIC_RETRIEVAL_IDS.itemA,
      );
      requestFilters(request).relation = relation;
      await expectRequestRejection(
        module,
        row,
        issue('invalid_identifier', 'request.filters.relation.anchorItemId'),
        {request},
      );
      return;
    }
    case 4:
      requestPage(request).after = {
        ...createExpectedCursor(
          request,
          4,
          'synthetic',
          SYNTHETIC_RETRIEVAL_IDS.itemA,
        ),
        itemId: nonCanonicalUppercaseUuid(SYNTHETIC_RETRIEVAL_IDS.itemA),
      };
      await expectRequestRejection(
        module,
        row,
        issue('invalid_cursor', 'request.page.after.itemId'),
        {request},
      );
      return;
    case 5:
      setText(request, '');
      await expectRequestRejection(
        module,
        row,
        issue('invalid_text', 'request.text.value'),
        {request},
      );
      return;
    case 6:
      setText(request, '   ');
      await expectRequestRejection(
        module,
        row,
        issue('invalid_text', 'request.text.value'),
        {request},
      );
      return;
    case 7:
      setText(request, 'synthetic\nquery');
      await expectRequestRejection(
        module,
        row,
        issue('invalid_text', 'request.text.value'),
        {request},
      );
      return;
    case 8:
      setText(request, '\ud800');
      await expectRequestRejection(
        module,
        row,
        issue('invalid_text', 'request.text.value'),
        {request},
      );
      return;
    case 9:
      setText(request, ' synthetic');
      await expectRequestRejection(
        module,
        row,
        issue('invalid_text', 'request.text.value'),
        {request},
      );
      return;
    case 10:
      setText(request, 'synthetic ');
      await expectRequestRejection(
        module,
        row,
        issue('invalid_text', 'request.text.value'),
        {request},
      );
      return;
    case 11:
      setText(request, 'x');
      requireOk((await executeWithModule(module, row, {request})).result, row);
      return;
    case 12:
      setText(request, 'x'.repeat(RETRIEVAL_LIMITS.queryCodePoints));
      requireOk((await executeWithModule(module, row, {request})).result, row);
      return;
    case 13:
      setText(request, 'x'.repeat(RETRIEVAL_LIMITS.queryCodePoints + 1));
      await expectRequestRejection(
        module,
        row,
        issue('limit_exceeded', 'request.text.value', 'query_text_code_points'),
        {request},
      );
      return;
    case 14: {
      const relation = connectedFilter();
      relation.relationTypeKeys = [''];
      requestFilters(request).relation = relation;
      await expectRequestRejection(
        module,
        row,
        issue('invalid_text', 'request.filters.relation.relationTypeKeys[0]'),
        {request},
      );
      return;
    }
    case 15: {
      const relation = connectedFilter();
      relation.relationTypeKeys = [
        'x'.repeat(RETRIEVAL_LIMITS.relationKeyCodePoints),
      ];
      requestFilters(request).relation = relation;
      requireOk((await executeWithModule(module, row, {request})).result, row);
      return;
    }
    case 16: {
      const relation = connectedFilter();
      relation.relationTypeKeys = [
        'x'.repeat(RETRIEVAL_LIMITS.relationKeyCodePoints + 1),
      ];
      requestFilters(request).relation = relation;
      await expectRequestRejection(
        module,
        row,
        issue(
          'limit_exceeded',
          'request.filters.relation.relationTypeKeys[0]',
          'relation_type_code_points',
        ),
        {request},
      );
      return;
    }
    default:
      throw new RangeError(`${row.id} UUID/text-budget scenario is missing.`);
  }
}

async function evaluateEnumsArrays(
  module: PublicRetrievalModule,
  row: RetrievalTm1LedgerRow,
): Promise<void> {
  const request = createBrowseRequest();
  const filters = requestFilters(request);
  switch (row.groupOrdinal) {
    case 1:
      setText(request, 'Alpha Synthetic', 'exact');
      requireOk((await executeWithModule(module, row, {request})).result, row);
      return;
    case 2:
      setText(request, 'synthetic', 'substring');
      requireOk((await executeWithModule(module, row, {request})).result, row);
      return;
    case 3:
      setText(request, 'synthetic');
      requireRecord(request.text, 'request.text').mode = 'synthetic_unknown';
      await expectRequestRejection(
        module,
        row,
        issue('invalid_enum', 'request.text.mode'),
        {request},
      );
      return;
    case 4:
      setText(request, 'synthetic', 'exact', []);
      await expectRequestRejection(
        module,
        row,
        issue('invalid_state', 'request.text.fields'),
        {request},
      );
      return;
    case 5:
      setText(request, 'synthetic', 'substring', ['body', 'title']);
      requireOk((await executeWithModule(module, row, {request})).result, row);
      return;
    case 6:
      setText(request, 'synthetic', 'exact', [null, null, null]);
      await expectRequestRejection(
        module,
        row,
        issue('limit_exceeded', 'request.text.fields', 'text_fields'),
        {request},
      );
      return;
    case 7:
      setText(request, 'synthetic', 'substring', ['title', 'title']);
      await expectRequestRejection(
        module,
        row,
        issue('duplicate_value', 'request.text.fields[1]'),
        {request},
      );
      return;
    case 8:
      filters.knowledgeKinds = ['work', 'entity'];
      expect(
        requireOk((await executeWithModule(module, row, {request})).result, row)
          .querySha256,
        row.id,
      ).toBe(querySha256FromTrustedRequest(request));
      return;
    case 9:
      filters.knowledgeKinds = new Array(9).fill('synthetic_unknown');
      await expectRequestRejection(
        module,
        row,
        issue(
          'limit_exceeded',
          'request.filters.knowledgeKinds',
          'knowledge_kinds',
        ),
        {request},
      );
      return;
    case 10:
      filters.epistemicRoles = ['user_assertion', 'source_claim'];
      expect(
        requireOk((await executeWithModule(module, row, {request})).result, row)
          .querySha256,
        row.id,
      ).toBe(querySha256FromTrustedRequest(request));
      return;
    case 11:
      filters.epistemicRoles = new Array(6).fill('synthetic_unknown');
      await expectRequestRejection(
        module,
        row,
        issue(
          'limit_exceeded',
          'request.filters.epistemicRoles',
          'epistemic_roles',
        ),
        {request},
      );
      return;
    case 12:
      filters.reviewStates = ['withdrawn', 'confirmed'];
      expect(
        requireOk((await executeWithModule(module, row, {request})).result, row)
          .querySha256,
        row.id,
      ).toBe(querySha256FromTrustedRequest(request));
      return;
    case 13:
      filters.reviewStates = ['confirmed', 'confirmed'];
      await expectRequestRejection(
        module,
        row,
        issue('duplicate_value', 'request.filters.reviewStates[1]'),
        {request},
      );
      return;
    case 14:
      filters.source = sourceFilter(
        'resource',
        SYNTHETIC_RETRIEVAL_IDS.resourceA,
        [],
      );
      requireOk((await executeWithModule(module, row, {request})).result, row);
      return;
    case 15:
      filters.source = sourceFilter(
        'resource',
        SYNTHETIC_RETRIEVAL_IDS.resourceA,
        ['citation', 'citation'],
      );
      await expectRequestRejection(
        module,
        row,
        issue('duplicate_value', 'request.filters.source.inputKinds[1]'),
        {request},
      );
      return;
    case 16: {
      const relation = connectedFilter();
      relation.relationTypeKeys = ['z.synthetic', 'a.synthetic'];
      filters.relation = relation;
      expect(
        requireOk((await executeWithModule(module, row, {request})).result, row)
          .querySha256,
        row.id,
      ).toBe(querySha256FromTrustedRequest(request));
      return;
    }
    case 17: {
      const relation = connectedFilter();
      relation.relationTypeKeys = ['synthetic.related', 'synthetic.related'];
      filters.relation = relation;
      await expectRequestRejection(
        module,
        row,
        issue(
          'duplicate_value',
          'request.filters.relation.relationTypeKeys[1]',
        ),
        {request},
      );
      return;
    }
    case 18: {
      const relation = connectedFilter();
      relation.reviewStates = ['draft', 'draft'];
      filters.relation = relation;
      await expectRequestRejection(
        module,
        row,
        issue('duplicate_value', 'request.filters.relation.reviewStates[1]'),
        {request},
      );
      return;
    }
    default:
      throw new RangeError(`${row.id} enum/array scenario is missing.`);
  }
}

async function evaluatePageCursorNumeric(
  module: PublicRetrievalModule,
  row: RetrievalTm1LedgerRow,
): Promise<void> {
  const request = createBrowseRequest();
  const values: readonly unknown[] = [
    '1',
    -0,
    0,
    1,
    100,
    101,
    1.5,
    Number.NaN,
    Infinity,
  ];
  if (row.groupOrdinal <= values.length) {
    requestPage(request).limit = values[row.groupOrdinal - 1];
    if (row.groupOrdinal === 4 || row.groupOrdinal === 5) {
      requireOk((await executeWithModule(module, row, {request})).result, row);
      return;
    }
    const expected =
      row.groupOrdinal === 6
        ? issue('limit_exceeded', 'request.page.limit', 'result_limit')
        : issue(
            row.groupOrdinal === 1 ? 'invalid_shape' : 'invalid_state',
            'request.page.limit',
          );
    await expectRequestRejection(module, row, expected, {request});
    return;
  }
  const cursor = createExpectedCursor(
    request,
    4,
    'synthetic',
    SYNTHETIC_RETRIEVAL_IDS.itemA,
  );
  requestPage(request).after = cursor;
  if (row.groupOrdinal === 10) {
    cursor.schemaVersion = 2;
    await expectRequestRejection(
      module,
      row,
      issue('invalid_cursor', 'request.page.after.schemaVersion'),
      {request},
    );
    return;
  }
  if (row.groupOrdinal === 11) {
    cursor.querySha256 = 'A'.repeat(64);
    await expectRequestRejection(
      module,
      row,
      issue('invalid_cursor', 'request.page.after.querySha256'),
      {request},
    );
    return;
  }
  for (const rank of [-0, 5]) {
    cursor.matchRank = rank;
    await expectRequestRejection(
      module,
      row,
      issue('invalid_cursor', 'request.page.after.matchRank'),
      {request},
    );
  }
}

async function evaluateExactIssuesPrecedence(
  module: PublicRetrievalModule,
  row: RetrievalTm1LedgerRow,
): Promise<void> {
  const request = createBrowseRequest();
  const context = createSyntheticContext();
  const filters = requestFilters(request);
  let expected: SearchIssueOracle;
  switch (row.groupOrdinal) {
    case 1:
      request.page = [];
      expected = issue('invalid_shape', 'request.page');
      break;
    case 2:
      context.effectiveWorkspaceId = nonCanonicalUppercaseUuid(
        SYNTHETIC_RETRIEVAL_IDS.workspace,
      );
      expected = issue('invalid_identifier', 'context.effectiveWorkspaceId');
      break;
    case 3:
      context.authority = 'synthetic_unknown';
      expected = issue('invalid_enum', 'context.authority');
      break;
    case 4:
      filters.source = {kind: 'synthetic_unknown'};
      expected = issue('invalid_enum', 'request.filters.source.kind');
      break;
    case 5:
      setText(request, '\u0000synthetic');
      expected = issue('invalid_text', 'request.text.value');
      break;
    case 6:
      setText(request, 'x'.repeat(301));
      expected = issue(
        'limit_exceeded',
        'request.text.value',
        'query_text_code_points',
      );
      break;
    case 7:
      setText(request, 'synthetic', 'exact', []);
      expected = issue('invalid_state', 'request.text.fields');
      break;
    case 8: {
      const relation = connectedFilter();
      relation.relationTypeKeys = ['x'.repeat(121)];
      filters.relation = relation;
      expected = issue(
        'limit_exceeded',
        'request.filters.relation.relationTypeKeys[0]',
        'relation_type_code_points',
      );
      break;
    }
    case 9:
      filters.knowledgeKinds = new Array(9).fill(null);
      expected = issue(
        'limit_exceeded',
        'request.filters.knowledgeKinds',
        'knowledge_kinds',
      );
      break;
    case 10:
      filters.knowledgeKinds = ['entity', 'entity'];
      expected = issue('duplicate_value', 'request.filters.knowledgeKinds[1]');
      break;
    case 11:
      requestPage(request).limit = -0;
      expected = issue('invalid_state', 'request.page.limit');
      break;
    case 12:
      requestPage(request).limit = 101;
      expected = issue('limit_exceeded', 'request.page.limit', 'result_limit');
      break;
    case 13: {
      const cursor = createExpectedCursor(
        request,
        4,
        'synthetic',
        SYNTHETIC_RETRIEVAL_IDS.itemA,
      );
      cursor.normalizedTitle = 'J\u030c';
      requestPage(request).after = cursor;
      expected = issue('invalid_cursor', 'request.page.after.normalizedTitle');
      break;
    }
    case 14:
      setText(request, `${'x'.repeat(301)}\u0000`);
      expected = issue('invalid_text', 'request.text.value');
      break;
    case 15:
      context.authority = 'synthetic_unknown';
      setText(request, '\u0000synthetic');
      expected = issue('invalid_enum', 'context.authority');
      break;
    case 16:
      requestPage(request).limit = 0;
      expected = issue('invalid_state', 'request.page.limit');
      break;
    default:
      throw new RangeError(`${row.id} exact-issue scenario is missing.`);
  }
  await expectRequestRejection(module, row, expected, {context, request});
}

async function evaluateTextMatching(
  module: PublicRetrievalModule,
  row: RetrievalTm1LedgerRow,
): Promise<void> {
  const request = createBrowseRequest();
  const ids = SYNTHETIC_RETRIEVAL_IDS;
  const snapshot = createSyntheticSnapshot();
  const execute = async (): Promise<Record<string, unknown>> =>
    requireOk(
      (await executeWithModule(module, row, {request, snapshot})).result,
      row,
    );
  switch (row.groupOrdinal) {
    case 1:
      setText(request, 'Alpha Synthetic', 'exact', ['title']);
      break;
    case 2:
      setText(request, 'synthetic', 'substring', ['title']);
      break;
    case 3:
      setText(request, 'Synthetic body knowledge', 'exact', ['body']);
      break;
    case 4:
      setText(request, 'body', 'substring', ['body']);
      break;
    case 5: {
      const result = await execute();
      for (const item of resultItems(result, row)) {
        expect(item.matchRank, row.id).toBe(4);
        expect(item.textMatches, row.id).toEqual([]);
      }
      return;
    }
    case 6:
      setText(request, 'Alpha', 'exact', ['title']);
      expect((await execute()).totalCount, row.id).toBe(0);
      return;
    case 7:
      setText(request, 'Synthetic body', 'exact', ['body']);
      expect((await execute()).totalCount, row.id).toBe(0);
      return;
    case 8:
      setText(request, 'Alpha Synthetic', 'exact', ['title']);
      break;
    case 9:
      setText(request, 'Synthetic body knowledge', 'exact', ['body']);
      break;
    case 10:
      setText(request, 'synthetic', 'substring', ['body', 'title']);
      break;
    case 11:
      setText(request, 'synthetic', 'substring', ['body']);
      expect(
        resultItems(await execute(), row).some(
          (item) => item.itemId === ids.itemC,
        ),
        row.id,
      ).toBe(false);
      return;
    case 12: {
      setText(request, 'synthetic', 'substring', ['body', 'title']);
      const item = exactResultItem(await execute(), row, ids.itemA);
      expect(item.textMatches, row.id).toEqual([
        {field: 'title', kind: 'substring', rank: 1},
        {field: 'body', kind: 'substring', rank: 3},
      ]);
      return;
    }
    case 13: {
      setText(request, 'alpha synthetic', 'substring', ['title', 'body']);
      const item = exactResultItem(await execute(), row, ids.itemA);
      expect(item.matchRank, row.id).toBe(0);
      return;
    }
    case 14: {
      setText(request, 'Alpha Synthetic', 'exact', ['title', 'body']);
      const item = exactResultItem(await execute(), row, ids.itemA);
      expect(item.textMatches, row.id).toEqual([
        {field: 'title', kind: 'exact', rank: 0},
      ]);
      return;
    }
    case 15:
      itemValue(snapshot, ids.itemA).title = '\u00e9';
      setText(request, 'e\u0301', 'exact', ['title']);
      break;
    case 16:
      itemValue(snapshot, ids.itemA).title = 'A';
      setText(request, '\uff21', 'exact', ['title']);
      expect((await execute()).totalCount, row.id).toBe(0);
      return;
    default:
      throw new RangeError(`${row.id} text-matching scenario is missing.`);
  }
  const result = await execute();
  const items = resultItems(result, row);
  expect(items.length, row.id).toBeGreaterThan(0);
  if (
    row.groupOrdinal === 1 ||
    row.groupOrdinal === 8 ||
    row.groupOrdinal === 15
  ) {
    expect(items, row.id).toHaveLength(1);
    expect(items[0]?.itemId, row.id).toBe(ids.itemA);
    expect(items[0]?.matchRank, row.id).toBe(0);
  }
}

async function evaluateFilterAlgebra(
  module: PublicRetrievalModule,
  row: RetrievalTm1LedgerRow,
): Promise<void> {
  const request = createBrowseRequest();
  const filters = requestFilters(request);
  const ids = SYNTHETIC_RETRIEVAL_IDS;
  let expectedIds: readonly string[];
  switch (row.groupOrdinal) {
    case 1:
      filters.knowledgeKinds = ['concept'];
      expectedIds = [ids.itemB];
      break;
    case 2:
      filters.epistemicRoles = ['source_claim'];
      expectedIds = [ids.itemA];
      break;
    case 3:
      filters.reviewStates = ['withdrawn'];
      expectedIds = [ids.itemC];
      break;
    case 4:
    case 5:
    case 6:
      expectedIds = [ids.itemA, ids.itemB, ids.itemC];
      break;
    case 7:
      filters.knowledgeKinds = ['entity', 'concept'];
      expectedIds = [ids.itemA, ids.itemB];
      break;
    case 8:
      filters.epistemicRoles = ['source_claim', 'summary'];
      expectedIds = [ids.itemA, ids.itemB];
      break;
    case 9:
      filters.reviewStates = ['confirmed', 'draft'];
      expectedIds = [ids.itemA, ids.itemB];
      break;
    case 10:
      filters.knowledgeKinds = ['entity', 'concept'];
      filters.epistemicRoles = ['summary'];
      filters.reviewStates = ['draft'];
      expectedIds = [ids.itemB];
      break;
    case 11:
      filters.reviewStates = ['rejected', 'withdrawn'];
      expectedIds = [ids.itemC];
      break;
    case 12: {
      const snapshot = createSyntheticSnapshot();
      const before = cloneSynthetic(snapshot);
      await expectBrowseIds(
        module,
        row,
        request,
        [ids.itemA, ids.itemB, ids.itemC],
        snapshot,
      );
      expect(snapshot, row.id).toEqual(before);
      return;
    }
    default:
      throw new RangeError(`${row.id} filter-algebra scenario is missing.`);
  }
  await expectBrowseIds(module, row, request, expectedIds);
}

async function evaluateCurrentVisibility(
  module: PublicRetrievalModule,
  row: RetrievalTm1LedgerRow,
): Promise<void> {
  const request = createBrowseRequest();
  const snapshot = createSyntheticSnapshot();
  const ids = SYNTHETIC_RETRIEVAL_IDS;
  if (row.groupOrdinal === 1 || row.groupOrdinal === 2) {
    const result = await expectBrowseIds(
      module,
      row,
      request,
      [ids.itemA, ids.itemB, ids.itemC],
      snapshot,
    );
    const item = exactResultItem(result, row, ids.itemC);
    expect(item.revision, row.id).toBe(2);
    expect(item.revisionId, row.id).toBe(
      onlyItem(snapshot, ids.itemC).currentRevisionId,
    );
    return;
  }
  if (row.groupOrdinal === 3) {
    await expectBrowseIds(
      module,
      row,
      request,
      [ids.itemA, ids.itemB, ids.itemC],
      snapshot,
    );
    return;
  }
  if (row.groupOrdinal === 4) {
    requestFilters(request).reviewStates = ['confirmed'];
    await expectBrowseIds(module, row, request, [ids.itemA], snapshot);
    return;
  }
  if (row.groupOrdinal === 5 || row.groupOrdinal === 6) {
    requestFilters(request).reviewStates = ['draft'];
    const result = await expectBrowseIds(
      module,
      row,
      request,
      [ids.itemB],
      snapshot,
    );
    expect(exactResultItem(result, row, ids.itemB), row.id).toHaveProperty(
      'value.reviewState',
      'draft',
    );
    return;
  }
  if (row.groupOrdinal === 7) {
    const result = await expectBrowseIds(
      module,
      row,
      request,
      [ids.itemA, ids.itemB, ids.itemC],
      snapshot,
    );
    for (const item of resultItems(result, row)) {
      const state = onlyItem(
        snapshot,
        requireString(item.itemId, 'result item ID'),
      );
      expect(item.revisionId, row.id).toBe(state.currentRevisionId);
    }
    return;
  }
  mutateArray(snapshot, 'revisions', (values) => {
    const index = values.findIndex(
      (entry) => isRecord(entry) && entry.itemId === ids.itemB,
    );
    values.splice(index, 1);
  });
  const execution = await executeWithModule(module, row, {request, snapshot});
  expectFailed(execution.result, 'invalid_repository_snapshot', row);
}

async function evaluateDirectSource(
  module: PublicRetrievalModule,
  row: RetrievalTm1LedgerRow,
): Promise<void> {
  const request = createBrowseRequest();
  const filters = requestFilters(request);
  const ids = SYNTHETIC_RETRIEVAL_IDS;
  let expectedIds: readonly string[];
  switch (row.groupOrdinal) {
    case 1:
      filters.source = sourceFilter('resource', ids.resourceA, ['citation']);
      expectedIds = [ids.itemA, ids.itemB];
      break;
    case 2:
      filters.source = sourceFilter('resource', ids.resourceB, ['derivation']);
      expectedIds = [ids.itemA];
      break;
    case 3:
      filters.source = sourceFilter('snapshot', ids.snapshotA, ['citation']);
      expectedIds = [ids.itemA, ids.itemB];
      break;
    case 4:
      filters.source = sourceFilter('snapshot', ids.snapshotB, ['derivation']);
      expectedIds = [ids.itemA];
      break;
    case 5:
      filters.source = sourceFilter('fragment', ids.fragmentA, ['citation']);
      expectedIds = [ids.itemA];
      break;
    case 6:
      filters.source = sourceFilter('fragment', ids.fragmentB, ['derivation']);
      expectedIds = [ids.itemA];
      break;
    case 7:
      filters.source = sourceFilter('resource', ids.resourceA, []);
      expectedIds = [ids.itemA, ids.itemB];
      break;
    case 8:
      filters.source = sourceFilter('resource', ids.resourceA, ['citation']);
      expectedIds = [ids.itemA, ids.itemB];
      break;
    case 9:
      filters.source = sourceFilter('resource', ids.resourceB, ['derivation']);
      expectedIds = [ids.itemA];
      break;
    case 10: {
      const result = await expectBrowseIds(module, row, request, [
        ids.itemA,
        ids.itemB,
        ids.itemC,
      ]);
      for (const item of resultItems(result, row)) {
        expect(item.sourceMatches, row.id).toEqual([]);
      }
      return;
    }
    case 11:
    case 12:
      filters.source = sourceFilter(
        'fragment',
        '60000000-0000-4000-8000-000000000099',
      );
      expectedIds = [];
      break;
    case 13:
    case 14:
      filters.source = sourceFilter('resource', ids.resourceB, []);
      expectedIds = [ids.itemA];
      break;
    case 15:
    case 16:
      filters.source = sourceFilter('resource', ids.resourceA, []);
      expectedIds = [ids.itemA, ids.itemB];
      break;
    default:
      throw new RangeError(`${row.id} direct-source scenario is missing.`);
  }
  const result = await expectBrowseIds(module, row, request, expectedIds);
  for (const item of resultItems(result, row)) {
    const matches = requireArray(
      item.sourceMatches,
      `${row.id} source matches`,
    );
    expect(matches.length, row.id).toBeGreaterThan(0);
    if (row.groupOrdinal === 15) {
      expect(matches, row.id).toEqual(
        [...matches].sort((left, right) => {
          const leftRecord = requireRecord(left, 'left source match');
          const rightRecord = requireRecord(right, 'right source match');
          const kindOrder: Readonly<Record<string, number>> = {
            citation: 0,
            derivation: 1,
          };
          const leftKind = requireString(
            leftRecord.inputKind,
            'left input kind',
          );
          const rightKind = requireString(
            rightRecord.inputKind,
            'right input kind',
          );
          return (kindOrder[leftKind] ?? 99) - (kindOrder[rightKind] ?? 99);
        }),
      );
    }
    if (row.groupOrdinal === 16) {
      for (const match of matches) {
        expect(
          Object.keys(requireRecord(match, 'source match')).sort(compareUtf8),
          row.id,
        ).toEqual([
          'fragmentId',
          'inputKind',
          'inputOrdinal',
          'resourceId',
          'snapshotId',
        ]);
      }
    }
  }
}

function replaceWithParallelRelations(
  snapshot: Record<string, unknown>,
  count: number,
): void {
  const relations: Record<string, unknown>[] = [];
  const relationRevisions: Record<string, unknown>[] = [];
  for (let ordinal = 0; ordinal < count; ordinal += 1) {
    const suffix = String(ordinal + 100).padStart(12, '0');
    const relationId = `30000000-0000-4000-8000-${suffix}`;
    const revisionId = independentUuidV5(
      relationId,
      'struinfo:knowledge-relation-revision:v1:1',
    );
    const relationTypeKey = `synthetic.parallel.${String(ordinal).padStart(2, '0')}`;
    relations.push({
      workspaceId: SYNTHETIC_RETRIEVAL_IDS.workspace,
      relationId,
      subjectItemId: SYNTHETIC_RETRIEVAL_IDS.itemA,
      relationTypeKey,
      objectItemId: SYNTHETIC_RETRIEVAL_IDS.itemB,
      currentRevision: 1,
      currentRevisionId: revisionId,
    });
    relationRevisions.push({
      workspaceId: SYNTHETIC_RETRIEVAL_IDS.workspace,
      relationId,
      revision: 1,
      revisionId,
      value: {
        subjectItemId: SYNTHETIC_RETRIEVAL_IDS.itemA,
        relationTypeKey,
        objectItemId: SYNTHETIC_RETRIEVAL_IDS.itemB,
        epistemicRole: 'source_claim',
        reviewState: 'confirmed',
      },
    });
  }
  snapshot.relations = relations;
  snapshot.relationRevisions = relationRevisions;
}

async function evaluateOneHopRelations(
  module: PublicRetrievalModule,
  row: RetrievalTm1LedgerRow,
): Promise<void> {
  const request = createBrowseRequest();
  const filters = requestFilters(request);
  const snapshot = createSyntheticSnapshot();
  const ids = SYNTHETIC_RETRIEVAL_IDS;
  const relation = connectedFilter('either');
  filters.relation = relation;
  switch (row.groupOrdinal) {
    case 1:
      relation.direction = 'outgoing';
      await expectBrowseIds(module, row, request, [ids.itemB], snapshot);
      return;
    case 2:
      relation.direction = 'incoming';
      await expectBrowseIds(module, row, request, [ids.itemC], snapshot);
      return;
    case 3:
      await expectBrowseIds(
        module,
        row,
        request,
        [ids.itemB, ids.itemC],
        snapshot,
      );
      return;
    case 4: {
      const result = await expectBrowseIds(
        module,
        row,
        request,
        [ids.itemB, ids.itemC],
        snapshot,
      );
      expect(
        resultItems(result, row).some((item) => item.itemId === ids.itemA),
        row.id,
      ).toBe(false);
      return;
    }
    case 5:
    case 6:
      relation.anchorItemId = ids.missingItem;
      await expectBrowseIds(module, row, request, [], snapshot);
      return;
    case 7:
      await expectBrowseIds(
        module,
        row,
        request,
        [ids.itemB, ids.itemC],
        snapshot,
      );
      return;
    case 8:
      relation.relationTypeKeys = ['synthetic.related'];
      await expectBrowseIds(module, row, request, [ids.itemB], snapshot);
      return;
    case 9:
      await expectBrowseIds(
        module,
        row,
        request,
        [ids.itemB, ids.itemC],
        snapshot,
      );
      return;
    case 10:
      relation.reviewStates = ['confirmed'];
      await expectBrowseIds(module, row, request, [ids.itemB], snapshot);
      return;
    case 11:
    case 12: {
      relation.direction = 'outgoing';
      const result = await expectBrowseIds(
        module,
        row,
        request,
        [ids.itemB],
        snapshot,
      );
      const item = exactResultItem(result, row, ids.itemB);
      expect(item.relationMatchCount, row.id).toBe(2);
      expect(
        requireArray(item.relationMatches, 'relation matches'),
        row.id,
      ).toHaveLength(2);
      return;
    }
    case 13:
    case 14:
    case 15: {
      relation.direction = 'outgoing';
      const result = await expectBrowseIds(
        module,
        row,
        request,
        [ids.itemB],
        snapshot,
      );
      const matches = requireArray(
        exactResultItem(result, row, ids.itemB).relationMatches,
        'relation matches',
      ).map((match) => requireRecord(match, 'relation match'));
      const sorted = [...matches].sort((left, right) => {
        const keyOrder = compareUtf8(
          requireString(left.relationTypeKey, 'left relation key'),
          requireString(right.relationTypeKey, 'right relation key'),
        );
        if (keyOrder !== 0) return keyOrder;
        const idOrder = compareUtf8(
          requireString(left.relationId, 'left relation ID'),
          requireString(right.relationId, 'right relation ID'),
        );
        if (idOrder !== 0) return idOrder;
        return Number(left.revision) - Number(right.revision);
      });
      expect(matches, row.id).toEqual(sorted);
      return;
    }
    case 16:
    case 17: {
      replaceWithParallelRelations(snapshot, 33);
      relation.direction = 'outgoing';
      const result = await expectBrowseIds(
        module,
        row,
        request,
        [ids.itemB],
        snapshot,
      );
      const item = exactResultItem(result, row, ids.itemB);
      expect(item.relationMatchCount, row.id).toBe(33);
      expect(
        requireArray(item.relationMatches, 'relation matches'),
        row.id,
      ).toHaveLength(32);
      expect(item.relationMatchesTruncated, row.id).toBe(true);
      return;
    }
    case 18:
      filters.knowledgeKinds = ['work'];
      await expectBrowseIds(module, row, request, [ids.itemC], snapshot);
      return;
    case 19:
      filters.reviewStates = ['draft'];
      await expectBrowseIds(module, row, request, [ids.itemB], snapshot);
      return;
    case 20: {
      const relationRows = snapshotArray(snapshot, 'relations').filter(
        (entry) => isRecord(entry) && entry.relationId !== ids.relationC,
      );
      const revisionRows = snapshotArray(snapshot, 'relationRevisions').filter(
        (entry) => isRecord(entry) && entry.relationId !== ids.relationC,
      );
      const chainId = ids.relationC;
      const chainRevisionId = independentUuidV5(
        chainId,
        'struinfo:knowledge-relation-revision:v1:1',
      );
      relationRows.push({
        workspaceId: ids.workspace,
        relationId: chainId,
        subjectItemId: ids.itemB,
        relationTypeKey: 'synthetic.chain',
        objectItemId: ids.itemC,
        currentRevision: 1,
        currentRevisionId: chainRevisionId,
      });
      revisionRows.push({
        workspaceId: ids.workspace,
        relationId: chainId,
        revision: 1,
        revisionId: chainRevisionId,
        value: {
          subjectItemId: ids.itemB,
          relationTypeKey: 'synthetic.chain',
          objectItemId: ids.itemC,
          epistemicRole: 'summary',
          reviewState: 'confirmed',
        },
      });
      snapshot.relations = relationRows.sort((left, right) =>
        compareUtf8(
          requireString(
            requireRecord(left, 'left relation').relationId,
            'relation ID',
          ),
          requireString(
            requireRecord(right, 'right relation').relationId,
            'relation ID',
          ),
        ),
      );
      snapshot.relationRevisions = revisionRows.sort((left, right) =>
        compareUtf8(
          requireString(
            requireRecord(left, 'left revision').relationId,
            'relation ID',
          ),
          requireString(
            requireRecord(right, 'right revision').relationId,
            'relation ID',
          ),
        ),
      );
      relation.direction = 'outgoing';
      await expectBrowseIds(module, row, request, [ids.itemB], snapshot);
      return;
    }
    default:
      throw new RangeError(`${row.id} relation scenario is missing.`);
  }
}

function cursorForItem(
  request: unknown,
  snapshot: Record<string, unknown>,
  itemId: string,
): Record<string, unknown> {
  const title = requireString(itemValue(snapshot, itemId).title, 'item title');
  return createExpectedCursor(request, 4, searchKeyV1(title), itemId);
}

async function evaluateCursor(
  module: PublicRetrievalModule,
  row: RetrievalTm1LedgerRow,
): Promise<void> {
  const request = createBrowseRequest();
  const snapshot = createSyntheticSnapshot();
  const ids = SYNTHETIC_RETRIEVAL_IDS;
  const cursor = cursorForItem(request, snapshot, ids.itemA);
  requestPage(request).after = cursor;
  switch (row.groupOrdinal) {
    case 1:
      cursor.extra = true;
      await expectRequestRejection(
        module,
        row,
        issue('invalid_shape', 'request.page.after'),
        {request},
      );
      return;
    case 2:
      cursor.schemaVersion = 2;
      await expectRequestRejection(
        module,
        row,
        issue('invalid_cursor', 'request.page.after.schemaVersion'),
        {request},
      );
      return;
    case 3:
      cursor.querySha256 = 'A'.repeat(64);
      await expectRequestRejection(
        module,
        row,
        issue('invalid_cursor', 'request.page.after.querySha256'),
        {request},
      );
      return;
    case 4:
      cursor.matchRank = -0;
      await expectRequestRejection(
        module,
        row,
        issue('invalid_cursor', 'request.page.after.matchRank'),
        {request},
      );
      return;
    case 5:
      for (const title of ['', 'x'.repeat(901)]) {
        cursor.normalizedTitle = title;
        await expectRequestRejection(
          module,
          row,
          issue('invalid_cursor', 'request.page.after.normalizedTitle'),
          {request},
        );
      }
      return;
    case 6:
      cursor.normalizedTitle = 'J\u030c';
      await expectRequestRejection(
        module,
        row,
        issue('invalid_cursor', 'request.page.after.normalizedTitle'),
        {request},
      );
      return;
    case 7:
      cursor.itemId = nonCanonicalUppercaseUuid(ids.itemA);
      await expectRequestRejection(
        module,
        row,
        issue('invalid_cursor', 'request.page.after.itemId'),
        {request},
      );
      return;
    case 8:
    case 9: {
      const witness = row.groupOrdinal === 8 ? 'fb2c' : 'u1d160';
      requestPage(request).after = createSaturatedCursor(witness);
      const result = requireOk(
        (await executeWithModule(module, row, {request, snapshot})).result,
        row,
      );
      expect(result.totalCount, row.id).toBe(3);
      expect(
        resultItems(result, row).map((item) => item.itemId),
        row.id,
      ).toEqual(witness === 'fb2c' ? [ids.itemB, ids.itemC] : [ids.itemC]);
      const known = RETRIEVAL_CURSOR_KNOWN_ANSWERS[witness];
      expect(
        measureIndependentCursorJson(createSaturatedCursor(witness)),
        row.id,
      ).toMatchObject({
        bytes: known.jsonBytes,
        sha256: known.sha256,
      });
      return;
    }
    case 10: {
      const encoded = JSON.stringify(cursor);
      const decoded: unknown = JSON.parse(encoded);
      requestPage(request).after = decoded;
      await expectBrowseIds(
        module,
        row,
        request,
        [ids.itemB, ids.itemC],
        snapshot,
      );
      return;
    }
    case 11: {
      const first = createBrowseRequest(1);
      const second = createBrowseRequest(100);
      requestPage(second).after = cursorForItem(first, snapshot, ids.itemA);
      expect(querySha256FromTrustedRequest(first), row.id).toBe(
        querySha256FromTrustedRequest(second),
      );
      await expectBrowseIds(
        module,
        row,
        second,
        [ids.itemB, ids.itemC],
        snapshot,
      );
      return;
    }
    case 12: {
      cursor.querySha256 = sha256('synthetic mismatch');
      await expectRequestRejection(
        module,
        row,
        issue('invalid_cursor', 'request.page.after.querySha256'),
        {request},
      );
      const fabricated = createExpectedCursor(
        request,
        4,
        '\u{10fffd}',
        ids.itemC,
      );
      requestPage(request).after = fabricated;
      const result = requireOk(
        (await executeWithModule(module, row, {request, snapshot})).result,
        row,
      );
      expect(result.totalCount, row.id).toBe(3);
      expect(result.items, row.id).toEqual([]);
      return;
    }
    default:
      throw new RangeError(`${row.id} cursor scenario is missing.`);
  }
}

async function evaluatePagination(
  module: PublicRetrievalModule,
  row: RetrievalTm1LedgerRow,
): Promise<void> {
  const snapshot = createSyntheticSnapshot();
  const ids = SYNTHETIC_RETRIEVAL_IDS;
  const orderedIds = [ids.itemA, ids.itemB, ids.itemC];
  const request = createBrowseRequest(1);
  if (row.groupOrdinal === 1) {
    await expectBrowseIds(
      module,
      row,
      createBrowseRequest(),
      orderedIds,
      snapshot,
    );
    return;
  }
  if (row.groupOrdinal === 2 || row.groupOrdinal === 5) {
    const result = await expectBrowseIds(
      module,
      row,
      request,
      [ids.itemA],
      snapshot,
    );
    expect(result.totalCount, row.id).toBe(3);
    expect(result.nextCursor, row.id).toEqual(
      cursorForItem(request, snapshot, ids.itemA),
    );
    return;
  }
  if (row.groupOrdinal === 3) {
    requestPage(request).after = cursorForItem(request, snapshot, ids.itemA);
    const result = await expectBrowseIds(
      module,
      row,
      request,
      [ids.itemB],
      snapshot,
    );
    expect(result.totalCount, row.id).toBe(3);
    return;
  }
  if (row.groupOrdinal === 4) {
    requestPage(request).after = cursorForItem(request, snapshot, ids.itemB);
    const result = await expectBrowseIds(
      module,
      row,
      request,
      [ids.itemC],
      snapshot,
    );
    expect(result.totalCount, row.id).toBe(3);
    expect(result, row.id).not.toHaveProperty('nextCursor');
    return;
  }
  if (row.groupOrdinal === 6) {
    await expectBrowseIds(
      module,
      row,
      createBrowseRequest(100),
      orderedIds,
      snapshot,
    );
    return;
  }
  if (row.groupOrdinal === 7) {
    requestPage(request).after = cursorForItem(request, snapshot, ids.itemA);
    await expectBrowseIds(module, row, request, [ids.itemB], snapshot);
    return;
  }
  if (row.groupOrdinal === 8) {
    const result = await expectBrowseIds(
      module,
      row,
      createBrowseRequest(2),
      [ids.itemA, ids.itemB],
      snapshot,
    );
    expect(result, row.id).toHaveProperty('nextCursor');
    const final = createBrowseRequest(2);
    requestPage(final).after = cursorForItem(final, snapshot, ids.itemB);
    expect(
      await expectBrowseIds(module, row, final, [ids.itemC], snapshot),
      row.id,
    ).not.toHaveProperty('nextCursor');
    return;
  }
  if (row.groupOrdinal === 9) {
    const changed = createBrowseRequest(2);
    requestPage(changed).after = cursorForItem(request, snapshot, ids.itemA);
    await expectBrowseIds(
      module,
      row,
      changed,
      [ids.itemB, ids.itemC],
      snapshot,
    );
    return;
  }
  if (row.groupOrdinal === 10) {
    setText(request, 'not-present', 'exact', ['title']);
    const result = requireOk(
      (await executeWithModule(module, row, {request, snapshot})).result,
      row,
    );
    expect(result, row.id).toEqual({
      status: 'ok',
      querySha256: querySha256FromTrustedRequest(request),
      totalCount: 0,
      items: [],
    });
    return;
  }
  if (row.groupOrdinal === 11 || row.groupOrdinal === 12) {
    requestPage(request).after = createExpectedCursor(
      request,
      4,
      '\u{10fffd}',
      ids.itemC,
    );
    const result = requireOk(
      (await executeWithModule(module, row, {request, snapshot})).result,
      row,
    );
    expect(result.totalCount, row.id).toBe(3);
    expect(result.items, row.id).toEqual([]);
    expect(result, row.id).not.toHaveProperty('nextCursor');
    return;
  }
  const collected: string[] = [];
  let after: unknown;
  for (let pageNumber = 0; pageNumber < 4; pageNumber += 1) {
    const nextRequest = createBrowseRequest(1);
    if (after !== undefined) requestPage(nextRequest).after = after;
    const result = requireOk(
      (await executeWithModule(module, row, {request: nextRequest, snapshot}))
        .result,
      row,
    );
    collected.push(
      ...resultItems(result, row).map((item) =>
        requireString(item.itemId, 'item ID'),
      ),
    );
    after = result.nextCursor;
    if (after === undefined) break;
  }
  expect(collected, row.id).toEqual(orderedIds);
  if (row.groupOrdinal === 14) {
    expect(new Set(collected).size, row.id).toBe(collected.length);
  }
}

async function evaluateRepositoryShape(
  module: PublicRetrievalModule,
  row: RetrievalTm1LedgerRow,
): Promise<void> {
  const request = createBrowseRequest();
  const snapshot = createSyntheticSnapshot();
  if (row.groupOrdinal === 1) {
    expect(Object.keys(snapshot).sort(compareUtf8), row.id).toEqual([
      'fragmentInputs',
      'items',
      'relationRevisions',
      'relations',
      'revisions',
    ]);
    requireOk((await executeWithModule(module, row, {snapshot})).result, row);
    return;
  }
  if (row.groupOrdinal >= 2 && row.groupOrdinal <= 6) {
    const fields = [
      'items',
      'revisions',
      'fragmentInputs',
      'relations',
      'relationRevisions',
    ];
    const field = fields[row.groupOrdinal - 2];
    if (field === undefined)
      throw new RangeError(`${row.id} snapshot field missing.`);
    const array = snapshotArray(snapshot, field);
    defineOwnDataProperty(array, 'syntheticExtra', true);
    const execution = await executeWithModule(module, row, {request, snapshot});
    expectFailed(execution.result, 'invalid_repository_snapshot', row);
    return;
  }
  if (row.groupOrdinal === 7) {
    const first = requireRecord(
      snapshotArray(snapshot, 'items')[0],
      'first item',
    );
    first.workspaceId = SYNTHETIC_RETRIEVAL_IDS.otherWorkspace;
    const execution = await executeWithModule(module, row, {request, snapshot});
    expectFailed(execution.result, 'invalid_repository_snapshot', row);
    return;
  }
  if (row.groupOrdinal === 8 || row.groupOrdinal === 9) {
    const execution = await executeWithModule(module, row, {
      request,
      repositoryFailure: new Error('synthetic private database detail'),
    });
    expectFailed(execution.result, 'repository_failed', row);
    expect(JSON.stringify(execution.result), row.id).not.toContain(
      'private database',
    );
    return;
  }
  if (row.groupOrdinal === 10) {
    const execution = await executeWithModule(module, row, {
      request,
      snapshot: null,
    });
    expectFailed(execution.result, 'invalid_repository_snapshot', row);
    return;
  }
  if (row.groupOrdinal === 11) {
    const first = itemValue(snapshot, SYNTHETIC_RETRIEVAL_IDS.itemA);
    first.title = 'synthetic private repository canary';
    first.extra = true;
    const execution = await executeWithModule(module, row, {request, snapshot});
    expectFailed(execution.result, 'invalid_repository_snapshot', row);
    expect(JSON.stringify(execution.result), row.id).not.toContain(
      'repository canary',
    );
    return;
  }
  const execution = await executeWithModule(module, row, {request, snapshot});
  requireOk(execution.result, row);
  expect(execution.repository.calls, row.id).toBe(1);
}

async function evaluateItemRevisionClosure(
  module: PublicRetrievalModule,
  row: RetrievalTm1LedgerRow,
): Promise<void> {
  const snapshot = createSyntheticSnapshot();
  const ids = SYNTHETIC_RETRIEVAL_IDS;
  switch (row.groupOrdinal) {
    case 1:
      snapshotArray(snapshot, 'items').reverse();
      break;
    case 2:
      snapshotArray(snapshot, 'revisions').reverse();
      break;
    case 3:
      snapshotArray(snapshot, 'revisions').push(
        cloneSynthetic(snapshotArray(snapshot, 'revisions')[0]),
      );
      break;
    case 4: {
      const historical = cloneSynthetic(
        requireRecord(
          snapshotArray(snapshot, 'revisions')[2],
          'current revision',
        ),
      );
      historical.revision = 1;
      historical.revisionId = independentUuidV5(
        ids.itemC,
        'struinfo:knowledge-revision:v1:1',
      );
      snapshotArray(snapshot, 'revisions').push(historical);
      break;
    }
    case 5:
      mutateArray(snapshot, 'revisions', (values) => {
        values.splice(1, 1);
      });
      break;
    case 6: {
      const extraId = ids.missingItem;
      snapshotArray(snapshot, 'revisions').push({
        workspaceId: ids.workspace,
        itemId: extraId,
        revision: 1,
        revisionId: independentUuidV5(
          extraId,
          'struinfo:knowledge-revision:v1:1',
        ),
        value: {
          knowledgeKind: 'entity',
          epistemicRole: 'summary',
          reviewState: 'draft',
          title: 'Synthetic extra',
        },
      });
      break;
    }
    case 7:
      requireRecord(
        snapshotArray(snapshot, 'revisions')[0],
        'revision',
      ).revision = 2;
      break;
    case 8:
      requireRecord(
        snapshotArray(snapshot, 'revisions')[0],
        'revision',
      ).revisionId = independentUuidV5(
        ids.itemA,
        'struinfo:knowledge-revision:v1:2',
      );
      break;
    case 9:
      itemValue(snapshot, ids.itemA).extra = true;
      break;
    case 10:
      snapshotArray(snapshot, 'items').splice(
        1,
        0,
        cloneSynthetic(snapshotArray(snapshot, 'items')[0]),
      );
      break;
    default:
      throw new RangeError(`${row.id} item-closure scenario is missing.`);
  }
  const execution = await executeWithModule(module, row, {snapshot});
  expectFailed(execution.result, 'invalid_repository_snapshot', row);
}

async function evaluateFragmentRelationClosure(
  module: PublicRetrievalModule,
  row: RetrievalTm1LedgerRow,
): Promise<void> {
  const snapshot = createSyntheticSnapshot();
  const ids = SYNTHETIC_RETRIEVAL_IDS;
  if (row.groupOrdinal === 3) {
    const request = createBrowseRequest();
    requestFilters(request).source = sourceFilter(
      'resource',
      ids.resourceA,
      [],
    );
    const result = requireOk(
      (await executeWithModule(module, row, {request, snapshot})).result,
      row,
    );
    const item = exactResultItem(result, row, ids.itemA);
    expect(item.sourceMatches, row.id).toEqual([
      {
        inputKind: 'citation',
        inputOrdinal: 0,
        resourceId: ids.resourceA,
        snapshotId: ids.snapshotA,
        fragmentId: ids.fragmentA,
      },
    ]);
    return;
  }
  switch (row.groupOrdinal) {
    case 1:
      requireRecord(
        snapshotArray(snapshot, 'fragmentInputs')[0],
        'fragment input',
      ).revision = 2;
      break;
    case 2: {
      const duplicate = cloneSynthetic(
        requireRecord(
          snapshotArray(snapshot, 'fragmentInputs')[0],
          'fragment input',
        ),
      );
      duplicate.inputOrdinal = 2;
      snapshotArray(snapshot, 'fragmentInputs').splice(2, 0, duplicate);
      break;
    }
    case 4:
      snapshotArray(snapshot, 'fragmentInputs').reverse();
      break;
    case 5:
      snapshotArray(snapshot, 'relations').reverse();
      break;
    case 6:
      snapshotArray(snapshot, 'relations').splice(
        1,
        0,
        cloneSynthetic(snapshotArray(snapshot, 'relations')[0]),
      );
      break;
    case 7: {
      const historical = cloneSynthetic(
        requireRecord(
          snapshotArray(snapshot, 'relationRevisions')[0],
          'relation revision',
        ),
      );
      historical.revision = 2;
      historical.revisionId = independentUuidV5(
        ids.relationA,
        'struinfo:knowledge-relation-revision:v1:2',
      );
      snapshotArray(snapshot, 'relationRevisions').splice(1, 0, historical);
      break;
    }
    case 8:
      requireRecord(
        snapshotArray(snapshot, 'relationRevisions')[0],
        'relation revision',
      ).revision = 2;
      break;
    case 9:
      requireRecord(
        snapshotArray(snapshot, 'relationRevisions')[0],
        'relation revision',
      ).revisionId = independentUuidV5(
        ids.relationA,
        'struinfo:knowledge-relation-revision:v1:2',
      );
      break;
    case 10:
      requireRecord(
        requireRecord(
          snapshotArray(snapshot, 'relationRevisions')[0],
          'relation revision',
        ).value,
        'relation value',
      ).objectItemId = ids.itemC;
      break;
    case 11:
      requireRecord(
        requireRecord(
          snapshotArray(snapshot, 'relationRevisions')[0],
          'relation revision',
        ).value,
        'relation value',
      ).relationTypeKey = 'synthetic.changed';
      break;
    case 12: {
      onlyRelation(snapshot, ids.relationA).objectItemId = ids.missingItem;
      requireRecord(
        requireRecord(
          snapshotArray(snapshot, 'relationRevisions')[0],
          'relation revision',
        ).value,
        'relation value',
      ).objectItemId = ids.missingItem;
      break;
    }
    case 13: {
      onlyRelation(snapshot, ids.relationA).objectItemId = ids.itemA;
      requireRecord(
        requireRecord(
          snapshotArray(snapshot, 'relationRevisions')[0],
          'relation revision',
        ).value,
        'relation value',
      ).objectItemId = ids.itemA;
      break;
    }
    case 14:
      onlyRelation(snapshot, ids.relationA).workspaceId = ids.otherWorkspace;
      break;
    default:
      throw new RangeError(`${row.id} Fragment/relation scenario is missing.`);
  }
  const execution = await executeWithModule(module, row, {snapshot});
  expectFailed(execution.result, 'invalid_repository_snapshot', row);
}

async function evaluateResultPort(
  module: PublicRetrievalModule,
  row: RetrievalTm1LedgerRow,
): Promise<void> {
  const request = createBrowseRequest();
  const snapshot = createSyntheticSnapshot();
  const ids = SYNTHETIC_RETRIEVAL_IDS;
  if (row.groupOrdinal === 9) {
    setText(request, 'absent synthetic title', 'exact', ['title']);
    const result = requireOk(
      (await executeWithModule(module, row, {request, snapshot})).result,
      row,
    );
    expect(result, row.id).toEqual({
      status: 'ok',
      querySha256: querySha256FromTrustedRequest(request),
      totalCount: 0,
      items: [],
    });
    return;
  }
  if (row.groupOrdinal === 10) {
    requestPage(request).limit = 0;
    await expectRequestRejection(
      module,
      row,
      issue('invalid_state', 'request.page.limit'),
      {request},
    );
    return;
  }
  if (row.groupOrdinal === 11) {
    const execution = await executeWithModule(module, row, {
      repositoryFailure: new Error('synthetic private failure'),
    });
    expectFailed(execution.result, 'repository_failed', row);
    return;
  }
  const result = requireOk(
    (await executeWithModule(module, row, {request, snapshot})).result,
    row,
  );
  switch (row.groupOrdinal) {
    case 1:
      for (const item of resultItems(result, row)) {
        const state = onlyItem(snapshot, requireString(item.itemId, 'item ID'));
        expect(item.revision, row.id).toBe(state.currentRevision);
        expect(item.revisionId, row.id).toBe(state.currentRevisionId);
      }
      return;
    case 2:
      expect(exactResultItem(result, row, ids.itemA).value, row.id).toEqual(
        itemValue(snapshot, ids.itemA),
      );
      return;
    case 3: {
      const itemIds = resultItems(result, row).map((item) => item.itemId);
      expect(new Set(itemIds).size, row.id).toBe(itemIds.length);
      return;
    }
    case 4: {
      const exactRequest = createBrowseRequest();
      setText(exactRequest, 'Alpha Synthetic', 'exact', ['title']);
      const exactResult = requireOk(
        (
          await executeWithModule(module, row, {
            request: exactRequest,
            snapshot,
          })
        ).result,
        row,
      );
      expect(
        exactResultItem(exactResult, row, ids.itemA).textMatches,
        row.id,
      ).toEqual([{field: 'title', kind: 'exact', rank: 0}]);
      return;
    }
    case 5: {
      const sourceRequest = createBrowseRequest();
      requestFilters(sourceRequest).source = sourceFilter(
        'fragment',
        ids.fragmentA,
        ['citation'],
      );
      const sourceResult = requireOk(
        (
          await executeWithModule(module, row, {
            request: sourceRequest,
            snapshot,
          })
        ).result,
        row,
      );
      expect(
        exactResultItem(sourceResult, row, ids.itemA).sourceMatches,
        row.id,
      ).toHaveLength(1);
      return;
    }
    case 6: {
      const relationRequest = createBrowseRequest();
      requestFilters(relationRequest).relation = connectedFilter('outgoing');
      const relationResult = requireOk(
        (
          await executeWithModule(module, row, {
            request: relationRequest,
            snapshot,
          })
        ).result,
        row,
      );
      expect(
        exactResultItem(relationResult, row, ids.itemB).relationMatches,
        row.id,
      ).toHaveLength(2);
      return;
    }
    case 7:
      expect(
        requireRecord(
          exactResultItem(result, row, ids.itemC).value,
          'item value',
        ),
        row.id,
      ).not.toHaveProperty('body');
      return;
    case 8: {
      const relationRequest = createBrowseRequest();
      requestFilters(relationRequest).relation = connectedFilter('outgoing');
      const relationResult = requireOk(
        (
          await executeWithModule(module, row, {
            request: relationRequest,
            snapshot,
          })
        ).result,
        row,
      );
      const matches = requireArray(
        exactResultItem(relationResult, row, ids.itemB).relationMatches,
        'relation matches',
      ).map((match) => requireRecord(match, 'relation match'));
      const noQualifier = matches.find(
        (match) => match.relationId === ids.relationB,
      );
      expect(
        requireRecord(noQualifier, 'relation without qualifier'),
        row.id,
      ).not.toHaveProperty('qualifier');
      return;
    }
    case 12:
      expect(result, row.id).toHaveProperty('status', 'ok');
      return;
    default:
      throw new RangeError(`${row.id} result-port scenario is missing.`);
  }
}

function knowledgeProductionSource(): string {
  const directory = new URL('./', import.meta.url);
  return readdirSync(directory, {withFileTypes: true})
    .filter(
      (entry) =>
        entry.isFile() &&
        entry.name.endsWith('.ts') &&
        !entry.name.includes('.test.') &&
        !entry.name.includes('_tm1.'),
    )
    .map((entry) => readFileSync(new URL(entry.name, directory), 'utf8'))
    .join('\n');
}

async function evaluatePurityNoWrite(
  module: PublicRetrievalModule,
  row: RetrievalTm1LedgerRow,
): Promise<void> {
  const source = knowledgeProductionSource();
  if (row.groupOrdinal === 1) {
    expect(source, row.id).not.toMatch(
      /(?:node:fs|readFile|writeFile|readdir)/u,
    );
    requireOk((await executeWithModule(module, row)).result, row);
    return;
  }
  if (row.groupOrdinal === 2) {
    const originalFetch = globalThis.fetch;
    const poisoned = vi.fn(() => {
      throw new Error('Network seam was invoked.');
    });
    globalThis.fetch = poisoned;
    try {
      requireOk((await executeWithModule(module, row)).result, row);
      expect(poisoned, row.id).not.toHaveBeenCalled();
    } finally {
      globalThis.fetch = originalFetch;
    }
    return;
  }
  if (row.groupOrdinal === 3) {
    const execution = await executeWithModule(module, row);
    requireOk(execution.result, row);
    expect(execution.repository.calls, row.id).toBe(1);
    return;
  }
  if (row.groupOrdinal === 4) {
    expect(source, row.id).not.toMatch(/(?:openai|languageModel|aiAdapter)/iu);
    requireOk((await executeWithModule(module, row)).result, row);
    return;
  }
  if (row.groupOrdinal === 5) {
    const spy = vi.spyOn(Date, 'now').mockImplementation(() => {
      throw new Error('Clock seam was invoked.');
    });
    try {
      requireOk((await executeWithModule(module, row)).result, row);
      expect(spy, row.id).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
    return;
  }
  if (row.groupOrdinal === 6) {
    const spy = vi.spyOn(Math, 'random').mockImplementation(() => {
      throw new Error('Random seam was invoked.');
    });
    try {
      requireOk((await executeWithModule(module, row)).result, row);
      expect(spy, row.id).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
    return;
  }
  if (row.groupOrdinal === 7) {
    expect(source, row.id).not.toMatch(/(?:express|fastify|koa|nestjs)/iu);
    return;
  }
  if (row.groupOrdinal === 8 || row.groupOrdinal === 9) {
    const repository = new SyntheticRepository(createSyntheticSnapshot());
    const write = vi.fn(() => {
      throw new Error('Write seam was invoked.');
    });
    defineOwnDataProperty(repository, 'save', write);
    defineOwnDataProperty(repository, 'appendEvent', write);
    const result = await module.executeDeterministicKnowledgeSearch(
      repository,
      createSyntheticContext(),
      createBrowseRequest(),
    );
    requireOk(result, row);
    expect(write, row.id).not.toHaveBeenCalled();
    return;
  }
  const repository = new SyntheticRepository(createSyntheticSnapshot());
  const invalidRequest = createBrowseRequest(0);
  const result = await module.executeDeterministicKnowledgeSearch(
    repository,
    createSyntheticContext(),
    invalidRequest,
  );
  expectRejected(result, issue('invalid_state', 'request.page.limit'), row);
  expect(repository.calls, row.id).toBe(0);
}

async function evaluateModuleRow(row: RetrievalTm1LedgerRow): Promise<void> {
  const module = await loadPublicRetrievalModule(row);
  switch (row.group) {
    case 'identity-governance':
      await evaluateIdentityGovernance(module, row);
      return;
    case 'closed-unions':
      await evaluateClosedUnions(module, row);
      return;
    case 'hostile-ownership':
      await evaluateHostileOwnership(module, row);
      return;
    case 'uuid-text-budgets':
      await evaluateUuidTextBudgets(module, row);
      return;
    case 'enums-arrays':
      await evaluateEnumsArrays(module, row);
      return;
    case 'page-cursor-numeric':
      await evaluatePageCursorNumeric(module, row);
      return;
    case 'exact-issues-precedence':
      await evaluateExactIssuesPrecedence(module, row);
      return;
    case 'text-matching':
      await evaluateTextMatching(module, row);
      return;
    case 'filter-algebra':
      await evaluateFilterAlgebra(module, row);
      return;
    case 'current-visibility':
      await evaluateCurrentVisibility(module, row);
      return;
    case 'direct-source':
      await evaluateDirectSource(module, row);
      return;
    case 'one-hop-relations':
      await evaluateOneHopRelations(module, row);
      return;
    case 'cursor':
      await evaluateCursor(module, row);
      return;
    case 'pagination':
      await evaluatePagination(module, row);
      return;
    case 'repository-shape':
      await evaluateRepositoryShape(module, row);
      return;
    case 'item-revision-closure':
      await evaluateItemRevisionClosure(module, row);
      return;
    case 'fragment-relation-closure':
      await evaluateFragmentRelationClosure(module, row);
      return;
    case 'result-port':
      await evaluateResultPort(module, row);
      return;
    case 'purity-no-write':
      await evaluatePurityNoWrite(module, row);
      return;
    default:
      throw new RangeError(`${row.id} module group ${row.group} is missing.`);
  }
}

describe('deterministic knowledge retrieval mandatory ledger', () => {
  it('contains each R-TM1-001 through R-TM1-308 exactly once', () => {
    const expected = Array.from(
      {length: 308},
      (_, index) => `R-TM1-${String(index + 1).padStart(3, '0')}`,
    );
    const actual = RETRIEVAL_TM1_LEDGER.map((row) => row.id);
    expect(actual).toEqual(expected);
    expect(new Set(actual).size).toBe(308);
    expect(
      RETRIEVAL_TM1_LEDGER.filter((row) => row.layer === 'oracle'),
    ).toHaveLength(34);
    expect(
      RETRIEVAL_TM1_LEDGER.filter((row) => row.layer === 'boundary'),
    ).toHaveLength(10);
    expect(
      RETRIEVAL_TM1_LEDGER.filter((row) => row.layer === 'module'),
    ).toHaveLength(264);

    const explicitNull = {context: null, request: null, snapshot: null};
    expect(selectOwnDataOption(explicitNull, 'context', Object)).toBeNull();
    expect(selectOwnDataOption(explicitNull, 'request', Object)).toBeNull();
    expect(selectOwnDataOption(explicitNull, 'snapshot', Object)).toBeNull();

    const inherited = Object.create({context: null}) as object;
    const inheritedDefault = Object.freeze({kind: 'synthetic-default'});
    expect(
      selectOwnDataOption(inherited, 'context', () => inheritedDefault),
    ).toBe(inheritedDefault);

    const counter = createTrapCounter();
    const accessorOptions = {};
    defineOwnAccessor(accessorOptions, 'request', counter);
    expect(() =>
      selectOwnDataOption(accessorOptions, 'request', Object),
    ).toThrow('Fixture option request must be an own data property.');
    expect(counter.count()).toBe(0);

    expectSyntheticSnapshotFixtureInvariants();
  });
});

describe('Test-owned deterministic retrieval independent oracles', () => {
  it.each(RETRIEVAL_TM1_LEDGER.filter((row) => row.layer === 'oracle'))(
    '$id $title',
    (row) => {
      evaluateIndependentOracle(row);
    },
  );
});

describe('Test-owned deterministic retrieval static boundaries', () => {
  it.each(RETRIEVAL_TM1_LEDGER.filter((row) => row.layer === 'boundary'))(
    '$id $title',
    (row) => {
      evaluateBoundaryOracle(row);
    },
  );
});

describe('deterministic retrieval public product boundary', () => {
  it.each(RETRIEVAL_TM1_LEDGER.filter((row) => row.layer === 'module'))(
    '$id $title',
    async (row) => {
      await evaluateModuleRow(row);
    },
  );
});
