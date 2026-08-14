import {createHash} from 'node:crypto';

// Test-owned deterministic retrieval oracles. Product modules must not import this file.

export type JsonPrimitive = boolean | null | number | string;
export interface JsonObject {
  readonly [key: string]: JsonValue;
}
export type JsonValue = JsonPrimitive | readonly JsonValue[] | JsonObject;

export type RetrievalTm1Layer = 'boundary' | 'module' | 'oracle';

export interface RetrievalTm1LedgerRow {
  readonly id: string;
  readonly ordinal: number;
  readonly groupOrdinal: number;
  readonly group: string;
  readonly title: string;
  readonly layer: RetrievalTm1Layer;
}

export interface CanonicalJsonMeasurement {
  readonly bytes: number;
  readonly values: number;
  readonly depth: number;
  readonly sha256: string;
  readonly text: string;
}

export interface CursorJsonMeasurement {
  readonly bytes: number;
  readonly sha256: string;
  readonly text: string;
}

export interface SearchIssueOracle {
  readonly code: string;
  readonly path: string;
  readonly budget?: string;
}

export interface TrapCounter {
  readonly count: () => number;
  readonly touch: () => void;
}

export interface UnicodeInvariantMeasurement {
  readonly scalarCount: number;
  readonly scalarIdempotenceFailures: number;
  readonly markScalarCount: number;
  readonly asciiMarkVectorCount: number;
  readonly asciiMarkIdempotenceFailures: number;
  readonly oldAsciiMarkIdempotenceFailures: number;
  readonly oldFailureInputs: readonly string[];
  readonly maxNfdCodePoints: number;
  readonly maxNfdWitnessCount: number;
  readonly maxNfdFirstPairCompositionFailures: number;
  readonly maxSearchKeyCodePoints: number;
  readonly maxSearchKeyCodePointWitnessCount: number;
  readonly maxSearchKeyUtf8Bytes: number;
  readonly maxSearchKeyByteWitnessCount: number;
}

export const RETRIEVAL_SCHEMA_VERSION =
  'struinfo.deterministic-knowledge-search.v1' as const;

export const RETRIEVAL_LIMITS = Object.freeze({
  queryCodePoints: 300,
  normalizedTitleCodePoints: 900,
  relationKeyCodePoints: 120,
  relationKeys: 32,
  resultLimit: 100,
  digestBytes: 32 * 1024,
  digestValues: 128,
  digestDepth: 8,
  encoderBytes: 8 * 1024 * 1024,
  encoderValues: 100_000,
  encoderDepth: 64,
});

export const RETRIEVAL_PROTOCOL = Object.freeze({
  knowledgeKinds: Object.freeze([
    'entity',
    'concept',
    'assertion',
    'event',
    'method',
    'framework',
    'resource',
    'work',
  ]),
  epistemicRoles: Object.freeze([
    'source_excerpt',
    'source_claim',
    'summary',
    'inference',
    'user_assertion',
  ]),
  reviewStates: Object.freeze([
    'draft',
    'pending_review',
    'confirmed',
    'disputed',
    'rejected',
    'withdrawn',
  ]),
  textFields: Object.freeze(['title', 'body']),
  sourceInputKinds: Object.freeze(['citation', 'derivation']),
});

export const SYNTHETIC_RETRIEVAL_IDS = Object.freeze({
  workspace: '10000000-0000-4000-8000-000000000001',
  otherWorkspace: '10000000-0000-4000-8000-000000000002',
  itemA: '20000000-0000-4000-8000-000000000001',
  itemB: '20000000-0000-4000-8000-000000000002',
  itemC: '20000000-0000-4000-8000-000000000003',
  missingItem: '20000000-0000-4000-8000-000000000099',
  relationA: '30000000-0000-4000-8000-000000000001',
  relationB: '30000000-0000-4000-8000-000000000002',
  relationC: '30000000-0000-4000-8000-000000000003',
  resourceA: '40000000-0000-4000-8000-000000000001',
  resourceB: '40000000-0000-4000-8000-000000000002',
  snapshotA: '50000000-0000-4000-8000-000000000001',
  snapshotB: '50000000-0000-4000-8000-000000000002',
  fragmentA: '60000000-0000-4000-8000-000000000001',
  fragmentB: '60000000-0000-4000-8000-000000000002',
  fragmentC: '60000000-0000-4000-8000-000000000003',
});

export const RETRIEVAL_FROZEN_FILE_HASHES = Object.freeze({
  contract: '9321A1DEE5BC3065A256769E715C36667C8EDFDD87A85C9835D5585346FC7A02',
  migration: '2261D1D3D638139AEA23ABBC6C67AA6DCEB60E8C52317A9A787B2450EA5E4F8F',
  package: 'C89DF0DDED248F87945A9590A8EFCD0D1B0D051B774026C729F483D7381F2A46',
  serverPackage:
    '3DFD35E4629BCCB9E766B63037A09EDDADA46E295D44DF72567A2051FC279D5F',
  lockfile: '99F261C35311919380BF6AEF018E0B2A9D076DC7937A5EDE1E0D7F26F56192A0',
  notices: 'F2D9EC875E62B34250414A61F214EAB65728EA4401BB4DFB99FBB6A04EDDF37F',
});

export const RETRIEVAL_BUDGET_NAMES = Object.freeze([
  'query_text_code_points',
  'text_fields',
  'knowledge_kinds',
  'epistemic_roles',
  'item_review_states',
  'source_input_kinds',
  'relation_type_filters',
  'relation_type_code_points',
  'relation_review_states',
  'result_limit',
]);

function jsonPrimitiveText(value: JsonPrimitive): string {
  if (typeof value === 'number' && !Number.isFinite(value)) {
    throw new TypeError('Canonical JSON accepts only finite numbers.');
  }
  const encoded = JSON.stringify(value);
  return encoded;
}

function canonicalJsonText(value: JsonValue): string {
  if (value === null || typeof value !== 'object') {
    return jsonPrimitiveText(value);
  }
  if (Array.isArray(value)) {
    return `[${value
      .map((entry: JsonValue) => canonicalJsonText(entry))
      .join(',')}]`;
  }
  const entries = Object.entries(value).sort(([left], [right]) =>
    compareUtf8(left, right),
  );
  return `{${entries
    .map(
      ([key, entry]) => `${jsonPrimitiveText(key)}:${canonicalJsonText(entry)}`,
    )
    .join(',')}}`;
}

function canonicalValueCount(value: JsonValue): number {
  if (value === null || typeof value !== 'object') return 1;
  const children: readonly JsonValue[] = Array.isArray(value)
    ? value
    : Object.values(value);
  return children.reduce<number>(
    (total, child) => total + canonicalValueCount(child),
    1,
  );
}

function canonicalValueDepth(value: JsonValue): number {
  if (value === null || typeof value !== 'object') return 0;
  const children: readonly JsonValue[] = Array.isArray(value)
    ? value
    : Object.values(value);
  if (children.length === 0) return 1;
  return 1 + Math.max(...children.map((child) => canonicalValueDepth(child)));
}

export function sha256(value: Uint8Array | string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function compareUtf8(left: string, right: string): number {
  return Buffer.compare(Buffer.from(left, 'utf8'), Buffer.from(right, 'utf8'));
}

export function encodeIndependentCanonicalJson(value: JsonValue): Uint8Array {
  return new TextEncoder().encode(`${canonicalJsonText(value)}\n`);
}

export function measureIndependentCanonicalJson(
  value: JsonValue,
): CanonicalJsonMeasurement {
  const text = `${canonicalJsonText(value)}\n`;
  const encoded = new TextEncoder().encode(text);
  return Object.freeze({
    bytes: encoded.byteLength,
    values: canonicalValueCount(value),
    depth: canonicalValueDepth(value),
    sha256: sha256(encoded),
    text,
  });
}

export function measureIndependentCursorJson(
  value: JsonValue,
): CursorJsonMeasurement {
  const text = canonicalJsonText(value);
  const encoded = new TextEncoder().encode(text);
  return Object.freeze({
    bytes: encoded.byteLength,
    sha256: sha256(encoded),
    text,
  });
}

function asciiLowercase(value: string): string {
  let lowered = '';
  for (const scalar of value) {
    const codePoint = scalar.codePointAt(0);
    if (codePoint === undefined) {
      throw new TypeError('String iteration produced no code point.');
    }
    lowered +=
      codePoint >= 0x41 && codePoint <= 0x5a
        ? String.fromCodePoint(codePoint + 0x20)
        : scalar;
  }
  return lowered;
}

export function searchKeyV1(value: string): string {
  return asciiLowercase(value.normalize('NFC')).normalize('NFC');
}

export function oldNonIdempotentSearchKey(value: string): string {
  return asciiLowercase(value.normalize('NFC'));
}

export function codePointCount(value: string): number {
  return Array.from(value).length;
}

export function codePointLedger(value: string): string {
  return Array.from(value)
    .map((scalar) => {
      const codePoint = scalar.codePointAt(0);
      if (codePoint === undefined) throw new TypeError('Missing code point.');
      return `U+${codePoint.toString(16).toUpperCase().padStart(4, '0')}`;
    })
    .join(' ');
}

function parseCanonicalUuid(value: string): Uint8Array {
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u.test(
      value,
    )
  ) {
    throw new TypeError('UUID must use lowercase canonical spelling.');
  }
  const compact = value.replaceAll('-', '');
  const bytes = new Uint8Array(16);
  for (let index = 0; index < bytes.length; index += 1) {
    const parsed = Number.parseInt(compact.slice(index * 2, index * 2 + 2), 16);
    if (!Number.isInteger(parsed)) throw new TypeError('UUID byte is invalid.');
    bytes[index] = parsed;
  }
  return bytes;
}

function formatUuid(bytes: Uint8Array): string {
  const hex = Buffer.from(bytes).toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function independentUuidV5(namespace: string, name: string): string {
  const namespaceBytes = parseCanonicalUuid(namespace);
  const digest = createHash('sha1')
    .update(namespaceBytes)
    .update(name, 'utf8')
    .digest();
  if (digest.byteLength < 16)
    throw new RangeError('SHA-1 digest is too short.');
  const bytes = Uint8Array.from(digest.subarray(0, 16));
  const sixth = bytes[6];
  const eighth = bytes[8];
  if (sixth === undefined || eighth === undefined) {
    throw new RangeError('UUID digest bytes are missing.');
  }
  bytes[6] = (sixth & 0x0f) | 0x50;
  bytes[8] = (eighth & 0x3f) | 0x80;
  return formatUuid(bytes);
}

export function createAnyFilters(): JsonObject {
  return {
    knowledgeKinds: [],
    epistemicRoles: [],
    reviewStates: [],
    source: {kind: 'any'},
    relation: {kind: 'any'},
  };
}

export function createBrowseProjection(): JsonObject {
  return {schemaVersion: RETRIEVAL_SCHEMA_VERSION, filters: createAnyFilters()};
}

export function createTextProjection(searchKey: string): JsonObject {
  return {
    schemaVersion: RETRIEVAL_SCHEMA_VERSION,
    text: {searchKey, mode: 'exact', fields: ['title']},
    filters: createAnyFilters(),
  };
}

export function createRichProjection(): JsonObject {
  return {
    schemaVersion: RETRIEVAL_SCHEMA_VERSION,
    text: {
      searchKey: searchKeyV1('\u77e5\u8bc6 e\u0301 \u{1f600} ABC'),
      mode: 'substring',
      fields: ['title', 'body'],
    },
    filters: {
      knowledgeKinds: ['entity', 'work'],
      epistemicRoles: ['source_claim', 'user_assertion'],
      reviewStates: ['confirmed', 'withdrawn'],
      source: {
        kind: 'resource',
        resourceId: '11111111-1111-4111-8111-111111111111',
        inputKinds: ['citation', 'derivation'],
      },
      relation: {
        kind: 'connected_to',
        anchorItemId: '22222222-2222-4222-8222-222222222222',
        direction: 'either',
        relationTypeKeys: ['a.synthetic', 'z.synthetic'],
        reviewStates: ['draft', 'withdrawn'],
      },
    },
  };
}

export function createSaturatedProjection(): JsonObject {
  const relationTypeKeys = Array.from({length: 32}, (_, index) =>
    String.fromCodePoint(0x10000 + index).repeat(120),
  ).sort((left, right) => compareUtf8(left, right));
  return {
    schemaVersion: RETRIEVAL_SCHEMA_VERSION,
    text: {
      searchKey: searchKeyV1('\u{1d160}'.repeat(300)),
      mode: 'substring',
      fields: ['title', 'body'],
    },
    filters: {
      knowledgeKinds: [...RETRIEVAL_PROTOCOL.knowledgeKinds],
      epistemicRoles: [...RETRIEVAL_PROTOCOL.epistemicRoles],
      reviewStates: [...RETRIEVAL_PROTOCOL.reviewStates],
      source: {
        kind: 'resource',
        resourceId: 'ffffffff-ffff-4fff-bfff-ffffffffffff',
        inputKinds: [...RETRIEVAL_PROTOCOL.sourceInputKinds],
      },
      relation: {
        kind: 'connected_to',
        anchorItemId: 'ffffffff-ffff-4fff-bfff-ffffffffffff',
        direction: 'outgoing',
        relationTypeKeys,
        reviewStates: [...RETRIEVAL_PROTOCOL.reviewStates],
      },
    },
  };
}

export const RETRIEVAL_DIGEST_KNOWN_ANSWERS = Object.freeze({
  browse: Object.freeze({
    bytes: 183,
    values: 10,
    depth: 3,
    sha256: '0de9f5d69fe20b260f107c5f5eabcbe88c7f80bd88056af480b82ad8163bd216',
  }),
  eAcute: Object.freeze({
    bytes: 243,
    values: 15,
    depth: 3,
    sha256: '3db10255e20e134430118ae29f7b21d558f923c4de6a677c10e40ca3091f2781',
  }),
  jCaron: Object.freeze({
    bytes: 243,
    values: 15,
    depth: 3,
    sha256: 'da26f4c6fa4a9076d3655e52fe89194537440b4def33775127d1d415f9dcec43',
  }),
  hLineBelow: Object.freeze({
    bytes: 244,
    values: 15,
    depth: 3,
    sha256: '262ca6b8bfbac68246411e78199cc3437ccd608f98d929cb9045b170a6763cbe',
  }),
  rich: Object.freeze({
    bytes: 605,
    values: 34,
    depth: 4,
    sha256: 'aee15bfef15de94e8bc3b76e83e9c92774622e26beafe4a3b96b65ebf4ebea57',
  }),
  saturated: Object.freeze({
    bytes: 19_816,
    values: 81,
    depth: 4,
    sha256: 'ea2d379f63e54b41950bf4e838568462fa61b93ba7cf0579af09fd80315238a4',
  }),
});

export function createSaturatedCursor(witness: 'fb2c' | 'u1d160'): JsonObject {
  const scalar = witness === 'fb2c' ? '\ufb2c' : '\u{1d160}';
  const itemId =
    witness === 'fb2c'
      ? '00000000-0000-4000-8000-000000000002'
      : '00000000-0000-4000-8000-000000000004';
  return {
    schemaVersion: 1,
    querySha256: RETRIEVAL_DIGEST_KNOWN_ANSWERS.browse.sha256,
    matchRank: 4,
    normalizedTitle: searchKeyV1(scalar.repeat(300)),
    itemId,
  };
}

export const RETRIEVAL_CURSOR_KNOWN_ANSWERS = Object.freeze({
  fb2c: Object.freeze({
    codePoints: 900,
    titleBytes: 1_800,
    jsonBytes: 1_983,
    sha256: '50c6f1ae35aa4e25be5844d97b19bdcb776fb273d5c164a91af38b1fb3b27d8c',
  }),
  u1d160: Object.freeze({
    codePoints: 900,
    titleBytes: 3_600,
    jsonBytes: 3_783,
    sha256: 'f2c2c4bc282cec58e12529d5e8da7b70dd1fd071e3d4887658b33fd4e9230e20',
  }),
});

let unicodeInvariantCache: UnicodeInvariantMeasurement | undefined;

export function measureUnicode17SearchKeyInvariants(): UnicodeInvariantMeasurement {
  if (unicodeInvariantCache !== undefined) return unicodeInvariantCache;
  let scalarCount = 0;
  let scalarIdempotenceFailures = 0;
  let maxNfdCodePoints = 0;
  let maxSearchKeyCodePoints = 0;
  let maxSearchKeyUtf8Bytes = 0;
  let maxNfdWitnesses: string[] = [];
  let maxSearchKeyCodePointWitnessCount = 0;
  let maxSearchKeyByteWitnessCount = 0;
  const markScalars: string[] = [];
  for (let codePoint = 0; codePoint <= 0x10ffff; codePoint += 1) {
    if (codePoint >= 0xd800 && codePoint <= 0xdfff) continue;
    scalarCount += 1;
    const scalar = String.fromCodePoint(codePoint);
    const key = searchKeyV1(scalar);
    if (searchKeyV1(key) !== key) scalarIdempotenceFailures += 1;
    const nfdCodePoints = codePointCount(scalar.normalize('NFD'));
    if (nfdCodePoints > maxNfdCodePoints) {
      maxNfdCodePoints = nfdCodePoints;
      maxNfdWitnesses = [scalar];
    } else if (nfdCodePoints === maxNfdCodePoints) {
      maxNfdWitnesses.push(scalar);
    }
    const keyCodePoints = codePointCount(key);
    if (keyCodePoints > maxSearchKeyCodePoints) {
      maxSearchKeyCodePoints = keyCodePoints;
      maxSearchKeyCodePointWitnessCount = 1;
    } else if (keyCodePoints === maxSearchKeyCodePoints) {
      maxSearchKeyCodePointWitnessCount += 1;
    }
    const keyBytes = Buffer.byteLength(key, 'utf8');
    if (keyBytes > maxSearchKeyUtf8Bytes) {
      maxSearchKeyUtf8Bytes = keyBytes;
      maxSearchKeyByteWitnessCount = 1;
    } else if (keyBytes === maxSearchKeyUtf8Bytes) {
      maxSearchKeyByteWitnessCount += 1;
    }
    if (/^\p{M}$/u.test(scalar)) markScalars.push(scalar);
  }

  let maxNfdFirstPairCompositionFailures = 0;
  for (const witness of maxNfdWitnesses) {
    const firstPair = Array.from(witness.normalize('NFD')).slice(0, 2).join('');
    if (codePointCount(firstPair.normalize('NFC')) !== 1) {
      maxNfdFirstPairCompositionFailures += 1;
    }
  }

  let asciiMarkIdempotenceFailures = 0;
  let oldAsciiMarkIdempotenceFailures = 0;
  const oldFailureInputs: string[] = [];
  for (let ascii = 0x41; ascii <= 0x5a; ascii += 1) {
    for (const mark of markScalars) {
      const value = `${String.fromCodePoint(ascii)}${mark}`;
      const key = searchKeyV1(value);
      if (searchKeyV1(key) !== key) asciiMarkIdempotenceFailures += 1;
      const oldKey = oldNonIdempotentSearchKey(value);
      if (oldNonIdempotentSearchKey(oldKey) !== oldKey) {
        oldAsciiMarkIdempotenceFailures += 1;
        oldFailureInputs.push(codePointLedger(value));
      }
    }
  }

  unicodeInvariantCache = Object.freeze({
    scalarCount,
    scalarIdempotenceFailures,
    markScalarCount: markScalars.length,
    asciiMarkVectorCount: markScalars.length * 26,
    asciiMarkIdempotenceFailures,
    oldAsciiMarkIdempotenceFailures,
    oldFailureInputs: Object.freeze(oldFailureInputs),
    maxNfdCodePoints,
    maxNfdWitnessCount: maxNfdWitnesses.length,
    maxNfdFirstPairCompositionFailures,
    maxSearchKeyCodePoints,
    maxSearchKeyCodePointWitnessCount,
    maxSearchKeyUtf8Bytes,
    maxSearchKeyByteWitnessCount,
  });
  return unicodeInvariantCache;
}

export function createTrapCounter(): TrapCounter {
  let invocations = 0;
  return Object.freeze({
    count: () => invocations,
    touch: () => {
      invocations += 1;
    },
  });
}

export function createZeroTrapProxy(
  target: object,
  counter: TrapCounter,
): object {
  return new Proxy(target, {
    defineProperty: () => {
      counter.touch();
      throw new Error('Unexpected Proxy defineProperty trap.');
    },
    get: () => {
      counter.touch();
      throw new Error('Unexpected Proxy get trap.');
    },
    getOwnPropertyDescriptor: () => {
      counter.touch();
      throw new Error('Unexpected Proxy descriptor trap.');
    },
    getPrototypeOf: () => {
      counter.touch();
      throw new Error('Unexpected Proxy prototype trap.');
    },
    has: () => {
      counter.touch();
      throw new Error('Unexpected Proxy has trap.');
    },
    ownKeys: () => {
      counter.touch();
      throw new Error('Unexpected Proxy ownKeys trap.');
    },
    set: () => {
      counter.touch();
      throw new Error('Unexpected Proxy set trap.');
    },
  });
}

export function defineOwnAccessor(
  target: object,
  key: string,
  counter: TrapCounter,
): void {
  Object.defineProperty(target, key, {
    configurable: true,
    enumerable: true,
    get: () => {
      counter.touch();
      throw new Error('Unexpected caller getter invocation.');
    },
  });
}

export function defineOwnDataProperty(
  target: object,
  key: PropertyKey,
  value: unknown,
): void {
  Object.defineProperty(target, key, {
    configurable: true,
    enumerable: true,
    writable: true,
    value,
  });
}

export function createSyntheticContext(): Record<string, unknown> {
  return {
    effectiveWorkspaceId: SYNTHETIC_RETRIEVAL_IDS.workspace,
    authority: 'manual_user',
  };
}

export function createBrowseRequest(limit = 100): Record<string, unknown> {
  return {
    filters: {
      knowledgeKinds: [],
      epistemicRoles: [],
      reviewStates: [],
      source: {kind: 'any'},
      relation: {kind: 'any'},
    },
    page: {limit},
  };
}

function itemRevisionId(itemId: string, revision: number): string {
  return independentUuidV5(
    itemId,
    `struinfo:knowledge-revision:v1:${String(revision)}`,
  );
}

function relationRevisionId(relationId: string, revision: number): string {
  return independentUuidV5(
    relationId,
    `struinfo:knowledge-relation-revision:v1:${String(revision)}`,
  );
}

export function createSyntheticSnapshot(): Record<string, unknown> {
  const ids = SYNTHETIC_RETRIEVAL_IDS;
  const itemARevisionId = itemRevisionId(ids.itemA, 1);
  const itemBRevisionId = itemRevisionId(ids.itemB, 1);
  const itemCRevisionId = itemRevisionId(ids.itemC, 2);
  const relationARevisionId = relationRevisionId(ids.relationA, 1);
  const relationBRevisionId = relationRevisionId(ids.relationB, 1);
  const relationCRevisionId = relationRevisionId(ids.relationC, 1);
  return {
    items: [
      {
        workspaceId: ids.workspace,
        itemId: ids.itemA,
        currentRevision: 1,
        currentRevisionId: itemARevisionId,
      },
      {
        workspaceId: ids.workspace,
        itemId: ids.itemB,
        currentRevision: 1,
        currentRevisionId: itemBRevisionId,
      },
      {
        workspaceId: ids.workspace,
        itemId: ids.itemC,
        currentRevision: 2,
        currentRevisionId: itemCRevisionId,
      },
    ],
    revisions: [
      {
        workspaceId: ids.workspace,
        itemId: ids.itemA,
        revision: 1,
        revisionId: itemARevisionId,
        value: {
          knowledgeKind: 'entity',
          epistemicRole: 'source_claim',
          reviewState: 'confirmed',
          title: 'Alpha Synthetic',
          body: 'Synthetic body knowledge',
        },
      },
      {
        workspaceId: ids.workspace,
        itemId: ids.itemB,
        revision: 1,
        revisionId: itemBRevisionId,
        value: {
          knowledgeKind: 'concept',
          epistemicRole: 'summary',
          reviewState: 'draft',
          title: '\u77e5\u8bc6 Beta',
          body: 'Body synthetic alpha',
        },
      },
      {
        workspaceId: ids.workspace,
        itemId: ids.itemC,
        revision: 2,
        revisionId: itemCRevisionId,
        value: {
          knowledgeKind: 'work',
          epistemicRole: 'user_assertion',
          reviewState: 'withdrawn',
          title: '\u{1f600} Gamma',
        },
      },
    ],
    fragmentInputs: [
      {
        workspaceId: ids.workspace,
        itemId: ids.itemA,
        revision: 1,
        revisionId: itemARevisionId,
        inputKind: 'citation',
        inputOrdinal: 0,
        resourceId: ids.resourceA,
        snapshotId: ids.snapshotA,
        fragmentId: ids.fragmentA,
      },
      {
        workspaceId: ids.workspace,
        itemId: ids.itemA,
        revision: 1,
        revisionId: itemARevisionId,
        inputKind: 'derivation',
        inputOrdinal: 1,
        resourceId: ids.resourceB,
        snapshotId: ids.snapshotB,
        fragmentId: ids.fragmentB,
      },
      {
        workspaceId: ids.workspace,
        itemId: ids.itemB,
        revision: 1,
        revisionId: itemBRevisionId,
        inputKind: 'citation',
        inputOrdinal: 0,
        resourceId: ids.resourceA,
        snapshotId: ids.snapshotA,
        fragmentId: ids.fragmentC,
      },
    ],
    relations: [
      {
        workspaceId: ids.workspace,
        relationId: ids.relationA,
        subjectItemId: ids.itemA,
        relationTypeKey: 'synthetic.related',
        objectItemId: ids.itemB,
        currentRevision: 1,
        currentRevisionId: relationARevisionId,
      },
      {
        workspaceId: ids.workspace,
        relationId: ids.relationB,
        subjectItemId: ids.itemA,
        relationTypeKey: 'synthetic.parallel',
        objectItemId: ids.itemB,
        currentRevision: 1,
        currentRevisionId: relationBRevisionId,
      },
      {
        workspaceId: ids.workspace,
        relationId: ids.relationC,
        subjectItemId: ids.itemC,
        relationTypeKey: 'synthetic.incoming',
        objectItemId: ids.itemA,
        currentRevision: 1,
        currentRevisionId: relationCRevisionId,
      },
    ],
    relationRevisions: [
      {
        workspaceId: ids.workspace,
        relationId: ids.relationA,
        revision: 1,
        revisionId: relationARevisionId,
        value: {
          subjectItemId: ids.itemA,
          relationTypeKey: 'synthetic.related',
          objectItemId: ids.itemB,
          epistemicRole: 'source_claim',
          reviewState: 'confirmed',
          qualifier: 'synthetic qualifier',
        },
      },
      {
        workspaceId: ids.workspace,
        relationId: ids.relationB,
        revision: 1,
        revisionId: relationBRevisionId,
        value: {
          subjectItemId: ids.itemA,
          relationTypeKey: 'synthetic.parallel',
          objectItemId: ids.itemB,
          epistemicRole: 'summary',
          reviewState: 'draft',
        },
      },
      {
        workspaceId: ids.workspace,
        relationId: ids.relationC,
        revision: 1,
        revisionId: relationCRevisionId,
        value: {
          subjectItemId: ids.itemC,
          relationTypeKey: 'synthetic.incoming',
          objectItemId: ids.itemA,
          epistemicRole: 'user_assertion',
          reviewState: 'withdrawn',
        },
      },
    ],
  };
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${label} must be a record.`);
  }
  return value as Record<string, unknown>;
}

function requireStringArray(value: unknown, label: string): string[] {
  if (
    !Array.isArray(value) ||
    !value.every((entry) => typeof entry === 'string')
  ) {
    throw new TypeError(`${label} must be a string array.`);
  }
  return [...value];
}

function canonicalProtocolArray(
  values: string[],
  order: readonly string[],
): string[] {
  const index = new Map(order.map((value, ordinal) => [value, ordinal]));
  return [...values].sort((left, right) => {
    const leftIndex = index.get(left);
    const rightIndex = index.get(right);
    if (leftIndex === undefined || rightIndex === undefined) {
      throw new TypeError(
        'Unknown protocol value in trusted projection fixture.',
      );
    }
    return leftIndex - rightIndex;
  });
}

export function createDigestProjectionFromTrustedRequest(
  requestInput: unknown,
): JsonObject {
  const request = requireRecord(requestInput, 'request');
  const filters = requireRecord(request.filters, 'request.filters');
  const source = requireRecord(filters.source, 'request.filters.source');
  const relation = requireRecord(filters.relation, 'request.filters.relation');
  const projectionFilters: Record<string, JsonValue> = {
    knowledgeKinds: canonicalProtocolArray(
      requireStringArray(filters.knowledgeKinds, 'knowledgeKinds'),
      RETRIEVAL_PROTOCOL.knowledgeKinds,
    ),
    epistemicRoles: canonicalProtocolArray(
      requireStringArray(filters.epistemicRoles, 'epistemicRoles'),
      RETRIEVAL_PROTOCOL.epistemicRoles,
    ),
    reviewStates: canonicalProtocolArray(
      requireStringArray(filters.reviewStates, 'reviewStates'),
      RETRIEVAL_PROTOCOL.reviewStates,
    ),
  };
  if (source.kind === 'any') {
    projectionFilters.source = {kind: 'any'};
  } else {
    const identifierField = `${String(source.kind)}Id`;
    const identifier = source[identifierField];
    if (typeof identifier !== 'string') {
      throw new TypeError('Trusted source identifier is missing.');
    }
    projectionFilters.source = {
      kind: String(source.kind),
      [identifierField]: identifier,
      inputKinds: canonicalProtocolArray(
        requireStringArray(source.inputKinds, 'source.inputKinds'),
        RETRIEVAL_PROTOCOL.sourceInputKinds,
      ),
    };
  }
  if (relation.kind === 'any') {
    projectionFilters.relation = {kind: 'any'};
  } else {
    if (
      typeof relation.anchorItemId !== 'string' ||
      typeof relation.direction !== 'string'
    ) {
      throw new TypeError('Trusted relation filter is incomplete.');
    }
    projectionFilters.relation = {
      kind: 'connected_to',
      anchorItemId: relation.anchorItemId,
      direction: relation.direction,
      relationTypeKeys: requireStringArray(
        relation.relationTypeKeys,
        'relation.relationTypeKeys',
      ).sort((left, right) => compareUtf8(left, right)),
      reviewStates: canonicalProtocolArray(
        requireStringArray(relation.reviewStates, 'relation.reviewStates'),
        RETRIEVAL_PROTOCOL.reviewStates,
      ),
    };
  }
  const projection: Record<string, JsonValue> = {
    schemaVersion: RETRIEVAL_SCHEMA_VERSION,
    filters: projectionFilters,
  };
  if (request.text !== undefined) {
    const text = requireRecord(request.text, 'request.text');
    if (typeof text.value !== 'string' || typeof text.mode !== 'string') {
      throw new TypeError('Trusted text filter is incomplete.');
    }
    projection.text = {
      searchKey: searchKeyV1(text.value),
      mode: text.mode,
      fields: canonicalProtocolArray(
        requireStringArray(text.fields, 'text.fields'),
        RETRIEVAL_PROTOCOL.textFields,
      ),
    };
  }
  return projection;
}

export function querySha256FromTrustedRequest(request: unknown): string {
  return measureIndependentCanonicalJson(
    createDigestProjectionFromTrustedRequest(request),
  ).sha256;
}

export function createExpectedCursor(
  request: unknown,
  matchRank: number,
  normalizedTitle: string,
  itemId: string,
): Record<string, unknown> {
  return {
    schemaVersion: 1,
    querySha256: querySha256FromTrustedRequest(request),
    matchRank,
    normalizedTitle,
    itemId,
  };
}

export function cloneSynthetic<T>(value: T): T {
  return structuredClone(value);
}

export function isRecursivelyFrozen(value: unknown): boolean {
  if (value === null || typeof value !== 'object') return true;
  if (!Object.isFrozen(value)) return false;
  for (const child of Object.values(value)) {
    if (!isRecursivelyFrozen(child)) return false;
  }
  return true;
}

interface LedgerGroup {
  readonly name: string;
  readonly titles: readonly string[];
}

const LEDGER_GROUPS: readonly LedgerGroup[] = [
  {
    name: 'identity-governance',
    titles: [
      'public index export admission',
      'schema version identity',
      'effective workspace cannot be overridden',
      'one read-only repository port',
      'contract identity',
      'migration identity and no new migration',
      'dependency and NOTICE identity',
      'no public request_bytes issue or budget',
    ],
  },
  {
    name: 'closed-unions',
    titles: [
      'context primitive rejected',
      'context extra key rejected',
      'unknown authority rejected',
      'request primitive rejected',
      'request extra key rejected',
      'filters record required',
      'text absence is browse',
      'text primitive rejected',
      'source any closed branch',
      'source resource branch',
      'source snapshot branch',
      'source fragment branch',
      'relation any closed branch',
      'relation connected_to branch',
      'cursor closed branch',
      'result discriminated union',
    ],
  },
  {
    name: 'hostile-ownership',
    titles: [
      'context own accessor zero calls',
      'request own accessor zero calls',
      'nested own accessor zero calls',
      'inherited accessor zero calls',
      'inherited setter zero calls',
      'context Proxy zero traps',
      'request Proxy zero traps',
      'nested record Proxy zero traps',
      'request array Proxy zero traps',
      'repository Proxy zero traps',
      'symbol key rejected',
      'dangerous proto key rejected',
      'sparse array rejected',
      'array extra key rejected',
      'custom prototype rejected',
      'cycle rejected',
      'caller request is not frozen',
      'repository input is not frozen',
      'request caller mutation isolation',
      'repository caller mutation isolation',
      'result deep freeze',
      'owned output does not retain input records',
    ],
  },
  {
    name: 'uuid-text-budgets',
    titles: [
      'workspace UUID canonical spelling',
      'source UUID canonical spelling',
      'relation anchor UUID canonical spelling',
      'cursor item UUID uses cursor issue',
      'empty query rejected',
      'all-whitespace query rejected',
      'query control rejected',
      'query invalid scalar rejected',
      'query leading whitespace rejected',
      'query trailing whitespace rejected',
      'query one-code-point lower boundary',
      'query 300-code-point inclusive boundary',
      'query 301-code-point upper failure',
      'relation key empty rejected',
      'relation key 120-code-point boundary',
      'relation key 121-code-point failure',
    ],
  },
  {
    name: 'enums-arrays',
    titles: [
      'text exact enum',
      'text substring enum',
      'unknown text mode',
      'empty text fields length-first',
      'two text fields accepted',
      'three text fields rejected length-first',
      'duplicate text field later path',
      'knowledge kind declaration order',
      'knowledge kind over limit',
      'epistemic role declaration order',
      'epistemic role over limit',
      'item review state declaration order',
      'item review state duplicate',
      'source input kind empty means both',
      'source input kind duplicate',
      'relation key UTF-8 order',
      'relation key duplicate',
      'relation review state duplicate',
    ],
  },
  {
    name: 'page-cursor-numeric',
    titles: [
      'page limit wrong type',
      'page limit negative zero',
      'page limit zero',
      'page limit one',
      'page limit one hundred',
      'page limit one hundred one',
      'page limit fractional',
      'page limit NaN',
      'page limit Infinity',
      'cursor schema invalid',
      'cursor SHA syntax invalid',
      'cursor rank negative zero and five',
    ],
  },
  {
    name: 'exact-issues-precedence',
    titles: [
      'wrong primitive is invalid_shape',
      'noncanonical UUID is invalid_identifier',
      'unknown authority is invalid_enum',
      'unknown request literal is invalid_enum',
      'invalid query text is invalid_text',
      'query over budget issue',
      'empty text fields is invalid_state',
      'relation key over budget issue',
      'set length precedes element access',
      'later duplicate owns path',
      'invalid page numeric domain',
      'page upper budget issue',
      'cursor field issue is invalid_cursor',
      'invalid and overlong query is lexical first',
      'context issue precedes request issue',
      'request rejection avoids repository',
    ],
  },
  {
    name: 'normalization',
    titles: [
      'double-NFC search key definition',
      'J plus caron fixed point',
      'H plus line-below fixed point',
      'ASCII lowercase known answer',
      'NFC and NFD acute equality',
      'Chinese substring preservation',
      'Emoji and non-ASCII case preservation',
      'full-width A does not fold',
      'sharp-s does not full-case-fold',
      'all Unicode 17 scalars idempotent',
      'ASCII A-Z by every Mark idempotent',
      'single-scalar and 900-code-point saturation',
    ],
  },
  {
    name: 'utf8-order',
    titles: [
      'ASCII unsigned byte order',
      'Chinese unsigned byte order',
      'Emoji unsigned byte order',
      'BMP before non-BMP vector',
      'NFC NFD equal-key order',
      'full-width vector',
      'sharp-s vector',
      'title tie uses item UUID',
      'rank precedes title',
      'comparator is insertion and locale independent',
    ],
  },
  {
    name: 'text-matching',
    titles: [
      'exact title rank zero',
      'title substring rank one',
      'exact body rank two',
      'body substring rank three',
      'no text rank four',
      'exact mode rejects title substring',
      'exact mode rejects body substring',
      'title-only selected field',
      'body-only selected field',
      'both selected fields',
      'missing body never matches',
      'matching fields title before body',
      'lowest matching rank wins',
      'exact mode emits no substring reason',
      'canonically equivalent query matches',
      'nonfolded full-width query does not match ASCII',
    ],
  },
  {
    name: 'filter-algebra',
    titles: [
      'knowledge kind filter alone',
      'epistemic role filter alone',
      'item review state filter alone',
      'knowledge kind empty means any',
      'epistemic role empty means any',
      'review state empty means any',
      'within knowledge kind OR',
      'within role OR',
      'within state OR',
      'different dimensions AND',
      'rejected and withdrawn are explicit',
      'filters never mutate knowledge',
    ],
  },
  {
    name: 'current-visibility',
    titles: [
      'current revision only',
      'historical revision excluded',
      'withdrawn item visible with empty state filter',
      'withdrawn item excluded by confirmed filter',
      'draft item visible explicitly',
      'review state returned faithfully',
      'current pointer exact revision ID',
      'missing current pointer is repository failure',
    ],
  },
  {
    name: 'direct-source',
    titles: [
      'Resource citation match',
      'Resource derivation match',
      'Snapshot citation match',
      'Snapshot derivation match',
      'Fragment citation match',
      'Fragment derivation match',
      'empty inputKinds admits both',
      'citation-only restriction',
      'derivation-only restriction',
      'source any returns no reasons',
      'missing source yields zero matches',
      'cross-workspace source appears absent',
      'direct current inputs only',
      'no recursive provenance propagation',
      'source reason order',
      'source result retains three identities',
    ],
  },
  {
    name: 'one-hop-relations',
    titles: [
      'outgoing traversal',
      'incoming traversal',
      'either traversal union',
      'anchor is not returned',
      'missing anchor yields zero matches',
      'cross-workspace anchor appears absent',
      'empty type keys admit all',
      'exact type-key filter',
      'empty relation states admit all',
      'exact relation-state filter',
      'parallel relations deduplicate item',
      'parallel relation exact count',
      'relation reasons UTF-8 type order',
      'relation reason relation-ID tie-break',
      'relation reason revision tie-break',
      'more than 32 reasons truncate display',
      'truncation does not change match',
      'endpoint item filters still apply',
      'inactive endpoint visibility is explicit',
      'one-hop only with no inferred semantics',
    ],
  },
  {
    name: 'digest-capacity',
    titles: [
      'digest projection stores searchKey not raw text',
      'NFC NFD query digest equality',
      'J composition digest known answer',
      'H composition digest known answer',
      'browse digest known answer',
      'rich digest known answer',
      'saturated byte construction',
      'saturated value and depth construction',
      'canonicalized set arrays own digest',
      'page limit excluded from digest',
      'cursor excluded from digest',
      'matching semantic change changes digest',
    ],
  },
  {
    name: 'cursor',
    titles: [
      'cursor closed shape',
      'cursor schema version',
      'cursor SHA syntax and equality',
      'cursor match-rank domain including negative zero',
      'cursor title lexical and 1-900 boundary',
      'cursor title must be search-key fixed point',
      'cursor item canonical UUID',
      'FB2C 900-code-point cursor',
      'U+1D160 900-code-point worst-byte cursor',
      'cursor JSON round trip and exclusive continuation',
      'page-limit change preserves cursor',
      'semantic mismatch and fabricated final boundary',
    ],
  },
  {
    name: 'pagination',
    titles: [
      'stable complete tuple order',
      'first page',
      'ordinary middle page',
      'last page',
      'limit one lower boundary',
      'limit one hundred upper boundary',
      'exclusive cursor boundary',
      'nextCursor only with further match',
      'changed page size after cursor',
      'zero-match totalCount zero',
      'empty continuation preserves totalCount',
      'fabricated beyond-final cursor',
      'no omission across stable pages',
      'no duplication across stable pages',
    ],
  },
  {
    name: 'repository-shape',
    titles: [
      'snapshot has exactly five arrays',
      'items closed dense array',
      'revisions closed dense array',
      'fragmentInputs closed dense array',
      'relations closed dense array',
      'relationRevisions closed dense array',
      'all rows effective workspace',
      'repository thrown error is repository_failed',
      'repository rejection is repository_failed',
      'malformed snapshot is invalid_repository_snapshot',
      'repository failures do not echo values',
      'repository called once after decode',
    ],
  },
  {
    name: 'item-revision-closure',
    titles: [
      'item IDs sorted and unique',
      'current revisions sorted by item ID',
      'one current revision per item',
      'historical revision row rejected',
      'missing current revision row rejected',
      'extra revision row rejected',
      'current revision number equality',
      'current revision ID equality',
      'revision value closed and valid',
      'item duplicate rejected',
    ],
  },
  {
    name: 'fragment-relation-closure',
    titles: [
      'Fragment input current revision binding',
      'Fragment input identity uniqueness',
      'Fragment input ordinal preserved',
      'Fragment input sort tuple',
      'relation IDs sorted and unique',
      'one current relation revision per identity',
      'historical relation revision rejected',
      'relation pointer revision number equality',
      'relation pointer revision ID equality',
      'relation identity endpoints equal value',
      'relation identity type equals value',
      'both relation endpoints present',
      'self-edge repository relation rejected',
      'cross-workspace relation row rejected',
    ],
  },
  {
    name: 'result-port',
    titles: [
      'successful result identity fidelity',
      'successful result value fidelity',
      'no duplicate result items',
      'exact text reasons',
      'exact source reasons',
      'exact relation reasons',
      'optional body absence preserved',
      'optional qualifier absence preserved',
      'zero-match closed result',
      'rejected result has no partial items or cursor',
      'failed result has no partial items or cursor',
      'repository receives only effective workspace UUID',
    ],
  },
  {
    name: 'purity-no-write',
    titles: [
      'filesystem seam poisoned',
      'network seam poisoned',
      'database seam limited to one read port',
      'AI seam poisoned',
      'clock seam poisoned',
      'random seam poisoned',
      'framework seam absent',
      'no write method invoked',
      'no event audit cache or history mutation',
      'rejection avoids every repository method',
    ],
  },
  {
    name: 'privacy-license-artifact',
    titles: [
      'no private Backend helper import',
      'no skipped todo only or empty-test gate',
      'no lint or type suppression',
      'fixtures are synthetic and value-free',
      'no credential or private-path fixture',
      'no real-source or Stage-0 fixture',
      'package and lockfile unchanged',
      'migration and NOTICE unchanged',
      'test and test_support excluded from artifact boundary',
      'no new dependency migration extension or model',
    ],
  },
];

function tm1Id(ordinal: number): string {
  return `R-TM1-${String(ordinal).padStart(3, '0')}`;
}

function layerForOrdinal(ordinal: number): RetrievalTm1Layer {
  if (
    (ordinal >= 109 && ordinal <= 130) ||
    (ordinal >= 203 && ordinal <= 214)
  ) {
    return 'oracle';
  }
  if (ordinal >= 299) return 'boundary';
  return 'module';
}

function buildLedger(): readonly RetrievalTm1LedgerRow[] {
  const rows: RetrievalTm1LedgerRow[] = [];
  for (const group of LEDGER_GROUPS) {
    for (const [index, title] of group.titles.entries()) {
      const ordinal = rows.length + 1;
      rows.push(
        Object.freeze({
          id: tm1Id(ordinal),
          ordinal,
          groupOrdinal: index + 1,
          group: group.name,
          title,
          layer: layerForOrdinal(ordinal),
        }),
      );
    }
  }
  if (rows.length !== 308) {
    throw new RangeError(
      `The deterministic retrieval TM1 ledger has ${String(rows.length)} rows.`,
    );
  }
  return Object.freeze(rows);
}

export const RETRIEVAL_TM1_LEDGER = buildLedger();
