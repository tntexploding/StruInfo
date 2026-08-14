import {createHash} from 'node:crypto';

export type JsonPrimitive = boolean | null | number | string;
export interface JsonObject {
  readonly [key: string]: JsonValue;
}
export type JsonValue = JsonPrimitive | readonly JsonValue[] | JsonObject;

export type KnowledgeTm1Layer = 'module' | 'oracle' | 'migration' | 'boundary';

export interface KnowledgeTm1LedgerRow {
  readonly id: `K-TM1-${string}`;
  readonly ordinal: number;
  readonly group: string;
  readonly title: string;
  readonly layer: KnowledgeTm1Layer;
}

export interface CanonicalJsonMeasurement {
  readonly bytes: number;
  readonly values: number;
  readonly depth: number;
  readonly sha256: string;
}

export interface KnowledgeIssueOracle {
  readonly code: string;
  readonly path: string;
  readonly budget?: string;
}

export interface NumericIssueOracle {
  readonly name: string;
  readonly field:
    | 'operation_expected_revision'
    | 'expected_decision_revision'
    | 'derivation_revision'
    | 'repository_or_calculated_revision';
  readonly value: unknown;
  readonly accepted: boolean;
  readonly issue?: KnowledgeIssueOracle;
}

export interface TrapCounter {
  readonly count: () => number;
  readonly touch: () => void;
}

export const KNOWLEDGE_LIMITS = Object.freeze({
  operations: 64,
  provenanceInputs: 64,
  titleCodePoints: 300,
  relationTypeCodePoints: 120,
  bodyCodePoints: 20_000,
  qualifierCodePoints: 2_000,
  idempotencyKeyCharacters: 200,
  revisionNumber: 2_147_483_647,
  encoderBytes: 8 * 1024 * 1024,
  encoderValues: 100_000,
  encoderDepth: 64,
});

export const SYNTHETIC_KNOWLEDGE_IDS = Object.freeze({
  workspaceA: '10000000-0000-4000-8000-000000000001',
  workspaceB: '10000000-0000-4000-8000-000000000002',
  itemA: '20000000-0000-4000-8000-000000000001',
  itemB: '20000000-0000-4000-8000-000000000002',
  itemC: '20000000-0000-4000-8000-000000000003',
  relationA: '30000000-0000-4000-8000-000000000001',
  relationB: '30000000-0000-4000-8000-000000000002',
  fragmentA: '40000000-0000-4000-8000-000000000001',
  fragmentB: '40000000-0000-4000-8000-000000000002',
  resourceA: '50000000-0000-4000-8000-000000000001',
  snapshotA: '60000000-0000-4000-8000-000000000001',
});

export const SYNTHETIC_KNOWLEDGE_TEXT = Object.freeze({
  excerpt: 'synthetic excerpt',
  title: 'synthetic-title',
  body: 'synthetic-body',
  relationTypeKey: 'synthetic.relation',
  qualifier: 'synthetic-qualifier',
  commandKey: 'synthetic.knowledge.command.0001',
});

export const KNOWLEDGE_UUID_KNOWN_ANSWERS = Object.freeze({
  changeSetId: 'bdb29058-6fb2-5a77-9ff3-e3eab50ee4fe',
  itemRevisionId: '60307b87-c0a4-5cf1-96f5-84568f684d91',
  relationRevisionId: '65ec2bcb-5279-5508-bdf0-9c1837a98916',
  eventId: 'c5060479-8b2e-538d-b870-f490aefb4d36',
});

export const KNOWLEDGE_CANONICAL_KNOWN_ANSWER = Object.freeze({
  bytes: 614,
  sha256: '485e20e8845cab656280a48cb8ecca439aa04a96475545d0a7dbac372086acf3',
});

const textEncoder = new TextEncoder();

function isJsonArray(value: JsonValue): value is readonly JsonValue[] {
  return Array.isArray(value);
}

function isJsonObject(value: JsonValue): value is JsonObject {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function sha256(value: Uint8Array | string): string {
  return createHash('sha256')
    .update(typeof value === 'string' ? textEncoder.encode(value) : value)
    .digest('hex');
}

export function independentUuidV5(namespace: string, name: string): string {
  const namespaceBytes = Buffer.from(namespace.replaceAll('-', ''), 'hex');
  if (namespaceBytes.byteLength !== 16) {
    throw new RangeError('The independent UUID namespace must be 16 bytes.');
  }
  const digest = createHash('sha1')
    .update(namespaceBytes)
    .update(textEncoder.encode(name))
    .digest()
    .subarray(0, 16);
  const versionByte = digest[6];
  const variantByte = digest[8];
  if (versionByte === undefined || variantByte === undefined) {
    throw new RangeError('The independent UUIDv5 digest was incomplete.');
  }
  digest[6] = (versionByte & 0x0f) | 0x50;
  digest[8] = (variantByte & 0x3f) | 0x80;
  const hex = digest.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(
    12,
    16,
  )}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function canonicalizeIndependent(value: JsonValue): JsonValue {
  if (isJsonArray(value)) {
    return value.map((entry) => canonicalizeIndependent(entry));
  }
  if (isJsonObject(value)) {
    const result = Object.create(null) as Record<string, JsonValue>;
    for (const key of Object.keys(value).sort()) {
      const entry = value[key];
      if (entry === undefined) {
        throw new TypeError('Canonical JSON objects cannot contain undefined.');
      }
      Object.defineProperty(result, key, {
        configurable: false,
        enumerable: true,
        value: canonicalizeIndependent(entry),
        writable: false,
      });
    }
    return Object.freeze(result);
  }
  return value;
}

export function encodeIndependentCanonicalJson(value: JsonValue): Uint8Array {
  return textEncoder.encode(
    `${JSON.stringify(canonicalizeIndependent(value))}\n`,
  );
}

export function measureIndependentCanonicalJson(
  value: JsonValue,
): CanonicalJsonMeasurement {
  let values = 0;
  let depth = 0;
  const visit = (entry: JsonValue, containerDepth: number): void => {
    values += 1;
    if (isJsonArray(entry)) {
      const nextDepth = containerDepth + 1;
      depth = Math.max(depth, nextDepth);
      for (const child of entry) visit(child, nextDepth);
      return;
    }
    if (isJsonObject(entry)) {
      const nextDepth = containerDepth + 1;
      depth = Math.max(depth, nextDepth);
      for (const key of Object.keys(entry).sort()) {
        const child = entry[key];
        if (child === undefined) {
          throw new TypeError(
            'Canonical JSON objects cannot contain undefined.',
          );
        }
        visit(child, nextDepth);
      }
    }
  };
  visit(value, 0);
  const encoded = encodeIndependentCanonicalJson(value);
  return Object.freeze({
    bytes: encoded.byteLength,
    values,
    depth,
    sha256: sha256(encoded),
  });
}

function syntheticUuid(group: number, value: number): string {
  return `${group.toString(16).padStart(8, '0')}-0000-4000-8000-${value
    .toString(16)
    .padStart(12, '0')}`;
}

function saturatedKnowledgeDerivations(): readonly JsonValue[] {
  return Array.from(
    {length: KNOWLEDGE_LIMITS.provenanceInputs},
    (_, index) => ({
      kind: 'relation',
      relationId: syntheticUuid(0x73000000, index + 1),
      revision: KNOWLEDGE_LIMITS.revisionNumber,
    }),
  );
}

function saturatedProvenance(): Readonly<Record<string, JsonValue>> {
  return {
    citations: [],
    fragmentDerivations: [],
    knowledgeDerivations: saturatedKnowledgeDerivations(),
  };
}

function saturatedItemOperation(index: number): JsonValue {
  const scalar = '\u{10000}';
  return {
    kind: 'put_item',
    itemId: syntheticUuid(0x71000000, index + 1),
    expectedRevision: KNOWLEDGE_LIMITS.revisionNumber,
    value: {
      knowledgeKind: 'framework',
      epistemicRole: 'user_assertion',
      reviewState: 'pending_review',
      title: scalar.repeat(KNOWLEDGE_LIMITS.titleCodePoints),
      body: scalar.repeat(KNOWLEDGE_LIMITS.bodyCodePoints),
    },
    provenance: saturatedProvenance(),
  };
}

function saturatedRelationOperation(index: number): JsonValue {
  const scalar = '\u{10000}';
  return {
    kind: 'put_relation',
    relationId: syntheticUuid(0x72000000, index + 1),
    expectedRevision: KNOWLEDGE_LIMITS.revisionNumber,
    value: {
      subjectItemId: syntheticUuid(0x74000000, 1),
      relationTypeKey: scalar.repeat(KNOWLEDGE_LIMITS.relationTypeCodePoints),
      objectItemId: syntheticUuid(0x74000000, 2),
      epistemicRole: 'user_assertion',
      reviewState: 'pending_review',
      qualifier: scalar.repeat(KNOWLEDGE_LIMITS.qualifierCodePoints),
    },
    provenance: saturatedProvenance(),
  };
}

export function createSaturatedKnowledgeProjection(
  authorizationKind: 'eligible_target' | 'manual_edit',
  itemCount: number,
): JsonValue {
  if (!Number.isInteger(itemCount) || itemCount < 0 || itemCount > 64) {
    throw new RangeError('The saturated item count must be from 0 through 64.');
  }
  const authorization: JsonValue =
    authorizationKind === 'manual_edit'
      ? {kind: 'manual_edit'}
      : {
          kind: 'eligible_target',
          target: {
            kind: 'snapshot',
            snapshotId: syntheticUuid(0x75000000, 1),
          },
          expectedDecisionRevision: KNOWLEDGE_LIMITS.revisionNumber,
        };
  const operations = Array.from(
    {length: KNOWLEDGE_LIMITS.operations},
    (_, index): JsonValue =>
      index < itemCount
        ? saturatedItemOperation(index)
        : saturatedRelationOperation(index),
  );
  return {
    schemaVersion: 'struinfo.manual-knowledge-change-set.v1',
    authority: 'manual_user',
    operationOrigin: 'manual_user',
    commandKind: 'apply_manual_knowledge_change_set',
    workspaceId: syntheticUuid(0x76000000, 1),
    request: {authorization, operations},
  };
}

export function createSyntheticKnowledgeContext(): Record<string, unknown> {
  return {
    effectiveWorkspaceId: SYNTHETIC_KNOWLEDGE_IDS.workspaceA,
    commandIdempotencyKey: SYNTHETIC_KNOWLEDGE_TEXT.commandKey,
    authority: 'manual_user',
  };
}

export function createSyntheticItemOperation(
  overrides: Readonly<Record<string, unknown>> = {},
): Record<string, unknown> {
  return {
    kind: 'put_item',
    itemId: SYNTHETIC_KNOWLEDGE_IDS.itemA,
    expectedRevision: 0,
    value: {
      knowledgeKind: 'assertion',
      epistemicRole: 'user_assertion',
      reviewState: 'draft',
      title: SYNTHETIC_KNOWLEDGE_TEXT.title,
    },
    provenance: {
      citations: [SYNTHETIC_KNOWLEDGE_IDS.fragmentA],
      fragmentDerivations: [],
      knowledgeDerivations: [],
    },
    ...overrides,
  };
}

export function createSyntheticRelationOperation(
  overrides: Readonly<Record<string, unknown>> = {},
): Record<string, unknown> {
  return {
    kind: 'put_relation',
    relationId: SYNTHETIC_KNOWLEDGE_IDS.relationA,
    expectedRevision: 0,
    value: {
      subjectItemId: SYNTHETIC_KNOWLEDGE_IDS.itemA,
      relationTypeKey: SYNTHETIC_KNOWLEDGE_TEXT.relationTypeKey,
      objectItemId: SYNTHETIC_KNOWLEDGE_IDS.itemB,
      epistemicRole: 'user_assertion',
      reviewState: 'draft',
      qualifier: SYNTHETIC_KNOWLEDGE_TEXT.qualifier,
    },
    provenance: {
      citations: [SYNTHETIC_KNOWLEDGE_IDS.fragmentA],
      fragmentDerivations: [],
      knowledgeDerivations: [],
    },
    ...overrides,
  };
}

export function createSyntheticManualRequest(): Record<string, unknown> {
  return {
    authorization: {kind: 'manual_edit'},
    operations: [createSyntheticItemOperation()],
  };
}

export function createSyntheticEligibleRequest(
  targetKind: 'snapshot' | 'fragment' = 'fragment',
): Record<string, unknown> {
  return {
    authorization: {
      kind: 'eligible_target',
      target:
        targetKind === 'snapshot'
          ? {
              kind: 'snapshot',
              snapshotId: SYNTHETIC_KNOWLEDGE_IDS.snapshotA,
            }
          : {
              kind: 'fragment',
              fragmentId: SYNTHETIC_KNOWLEDGE_IDS.fragmentA,
            },
      expectedDecisionRevision: 1,
    },
    operations: [createSyntheticItemOperation()],
  };
}

export function createEmptyKnowledgeRepositorySnapshot(): Record<
  string,
  unknown[]
> {
  return {
    curationTargets: [],
    intakeDecisions: [],
    fragments: [],
    items: [],
    revisions: [],
    relations: [],
    relationRevisions: [],
    changeSets: [],
    changeOperations: [],
    changeEvents: [],
  };
}

export function createSyntheticFragmentState(): Record<string, unknown> {
  return {
    workspaceId: SYNTHETIC_KNOWLEDGE_IDS.workspaceA,
    resourceId: SYNTHETIC_KNOWLEDGE_IDS.resourceA,
    snapshotId: SYNTHETIC_KNOWLEDGE_IDS.snapshotA,
    fragmentId: SYNTHETIC_KNOWLEDGE_IDS.fragmentA,
    selectedTextSha256: sha256(SYNTHETIC_KNOWLEDGE_TEXT.excerpt),
  };
}

export function createSyntheticNewCommandState(): Record<string, unknown[]> {
  return {
    ...createEmptyKnowledgeRepositorySnapshot(),
    fragments: [createSyntheticFragmentState()],
  };
}

export function createSmallKnowledgeCommandProjection(): JsonValue {
  return {
    schemaVersion: 'struinfo.manual-knowledge-change-set.v1',
    authority: 'manual_user',
    operationOrigin: 'manual_user',
    commandKind: 'apply_manual_knowledge_change_set',
    workspaceId: SYNTHETIC_KNOWLEDGE_IDS.workspaceA,
    request: {
      authorization: {kind: 'manual_edit'},
      operations: [createSyntheticItemOperation() as JsonObject],
    },
  };
}

export function issueOracle(
  code: string,
  path: string,
  budget?: string,
): KnowledgeIssueOracle {
  return budget === undefined
    ? Object.freeze({code, path})
    : Object.freeze({code, path, budget});
}

function numericFieldCases(
  field: NumericIssueOracle['field'],
  path: string,
  zeroAccepted: boolean,
): readonly NumericIssueOracle[] {
  const invalidShape = (name: string, value: unknown): NumericIssueOracle => ({
    name: `${field}:${name}`,
    field,
    value,
    accepted: false,
    issue: issueOracle('invalid_shape', path),
  });
  const invalidState = (name: string, value: unknown): NumericIssueOracle => ({
    name: `${field}:${name}`,
    field,
    value,
    accepted: false,
    issue: issueOracle('invalid_state', path),
  });
  const accepted = (name: string, value: number): NumericIssueOracle => ({
    name: `${field}:${name}`,
    field,
    value,
    accepted: true,
  });
  return [
    invalidShape('string', '1'),
    invalidShape('boolean', true),
    invalidShape('null', null),
    invalidShape('undefined', undefined),
    invalidState('negative-zero', -0),
    invalidState('negative-one', -1),
    zeroAccepted ? accepted('zero', 0) : invalidState('zero', 0),
    accepted('one', 1),
    accepted('maximum', KNOWLEDGE_LIMITS.revisionNumber),
    {
      name: `${field}:maximum-plus-one`,
      field,
      value: KNOWLEDGE_LIMITS.revisionNumber + 1,
      accepted: false,
      issue: issueOracle('limit_exceeded', path, 'revision_number'),
    },
    invalidState('fraction', 1.5),
    invalidState('nan', Number.NaN),
    invalidState('positive-infinity', Number.POSITIVE_INFINITY),
    invalidState('negative-infinity', Number.NEGATIVE_INFINITY),
    invalidState('unsafe-integer', Number.MAX_SAFE_INTEGER + 1),
    invalidState('positive-subnormal', Number.MIN_VALUE),
  ];
}

const numericBaseCases = [
  ...numericFieldCases(
    'operation_expected_revision',
    'request.operations[0].expectedRevision',
    true,
  ),
  ...numericFieldCases(
    'expected_decision_revision',
    'request.authorization.expectedDecisionRevision',
    false,
  ),
  ...numericFieldCases(
    'derivation_revision',
    'request.operations[0].provenance.knowledgeDerivations[0].revision',
    false,
  ),
];

const numericRepositoryCases: readonly NumericIssueOracle[] = [
  {
    name: 'repository_or_calculated_revision:item-current-zero',
    field: 'repository_or_calculated_revision',
    value: 0,
    accepted: false,
    issue: issueOracle('invalid_shape', 'state'),
  },
  {
    name: 'repository_or_calculated_revision:item-current-overflow',
    field: 'repository_or_calculated_revision',
    value: 2_147_483_648,
    accepted: false,
    issue: issueOracle('invalid_shape', 'state'),
  },
  {
    name: 'repository_or_calculated_revision:relation-current-zero',
    field: 'repository_or_calculated_revision',
    value: 0,
    accepted: false,
    issue: issueOracle('invalid_shape', 'state'),
  },
  {
    name: 'repository_or_calculated_revision:relation-current-overflow',
    field: 'repository_or_calculated_revision',
    value: 2_147_483_648,
    accepted: false,
    issue: issueOracle('invalid_shape', 'state'),
  },
  {
    name: 'repository_or_calculated_revision:decision-current-zero',
    field: 'repository_or_calculated_revision',
    value: 0,
    accepted: false,
    issue: issueOracle('invalid_shape', 'state'),
  },
  {
    name: 'repository_or_calculated_revision:historical-state-zero',
    field: 'repository_or_calculated_revision',
    value: 0,
    accepted: false,
    issue: issueOracle('invalid_shape', 'state'),
  },
  {
    name: 'repository_or_calculated_revision:calculated-item-next-overflow',
    field: 'repository_or_calculated_revision',
    value: KNOWLEDGE_LIMITS.revisionNumber,
    accepted: false,
    issue: issueOracle(
      'limit_exceeded',
      'request.operations[0].expectedRevision',
      'revision_number',
    ),
  },
  {
    name: 'repository_or_calculated_revision:calculated-relation-next-overflow',
    field: 'repository_or_calculated_revision',
    value: KNOWLEDGE_LIMITS.revisionNumber,
    accepted: false,
    issue: issueOracle(
      'limit_exceeded',
      'request.operations[0].expectedRevision',
      'revision_number',
    ),
  },
];

export const KNOWLEDGE_NUMERIC_ISSUE_ORACLES = Object.freeze([
  ...numericBaseCases,
  ...numericRepositoryCases,
]);

export function createTrapCounter(): TrapCounter {
  let count = 0;
  return Object.freeze({
    count: () => count,
    touch: () => {
      count += 1;
    },
  });
}

export function createOwnAccessorRequest(counter: TrapCounter): object {
  const request = createSyntheticManualRequest();
  Object.defineProperty(request, 'authorization', {
    enumerable: true,
    get: () => {
      counter.touch();
      return {kind: 'manual_edit'};
    },
  });
  return request;
}

export function createInheritedAccessorRequest(counter: TrapCounter): object {
  const prototype = Object.create(Object.prototype) as Record<string, unknown>;
  Object.defineProperty(prototype, 'authorization', {
    enumerable: true,
    get: () => {
      counter.touch();
      return {kind: 'manual_edit'};
    },
  });
  const request = Object.create(prototype) as Record<string, unknown>;
  Object.defineProperty(request, 'operations', {
    enumerable: true,
    value: [createSyntheticItemOperation()],
  });
  return request;
}

export function createInheritedSetterRequest(counter: TrapCounter): object {
  const prototype = Object.create(Object.prototype) as Record<string, unknown>;
  Object.defineProperty(prototype, 'authorization', {
    enumerable: true,
    set: () => {
      counter.touch();
    },
  });
  const request = Object.create(prototype) as Record<string, unknown>;
  Object.defineProperty(request, 'authorization', {
    enumerable: true,
    value: {kind: 'manual_edit'},
  });
  Object.defineProperty(request, 'operations', {
    enumerable: true,
    value: [createSyntheticItemOperation()],
  });
  return request;
}

export function createZeroTrapProxy(counter: TrapCounter): object {
  const trap = (): never => {
    counter.touch();
    throw new Error('A caller-owned Proxy trap was invoked.');
  };
  return new Proxy(createSyntheticManualRequest(), {
    defineProperty: trap,
    deleteProperty: trap,
    get: trap,
    getOwnPropertyDescriptor: trap,
    getPrototypeOf: trap,
    has: trap,
    ownKeys: trap,
    preventExtensions: trap,
    set: trap,
    setPrototypeOf: trap,
  });
}

function tm1Id(ordinal: number): `K-TM1-${string}` {
  return `K-TM1-${String(ordinal).padStart(3, '0')}`;
}

const groups: readonly Readonly<{
  group: string;
  layer: KnowledgeTm1Layer;
  titles: readonly string[];
}>[] = [
  {
    group: 'authorization',
    layer: 'module',
    titles: [
      'manual_edit authorization',
      'eligible snapshot authorization',
      'eligible fragment authorization',
      'closed authorization discriminator',
    ],
  },
  {
    group: 'target',
    layer: 'module',
    titles: [
      'missing target',
      'cross-workspace target',
      'exact Fragment target',
      'Snapshot target resource binding',
    ],
  },
  {
    group: 'decision',
    layer: 'module',
    titles: [
      'missing decision',
      'stale decision revision',
      'eligible actions',
      'ineligible actions',
      'classification changes do not stale decision',
    ],
  },
  {
    group: 'item-lifecycle',
    layer: 'module',
    titles: [
      'item create',
      'item revise',
      'item unchanged',
      'item withdraw',
      'item reactivate',
      'item not found',
      'item stale revision',
      'first rejected forbidden',
      'first withdrawn forbidden',
    ],
  },
  {
    group: 'relation-lifecycle',
    layer: 'module',
    titles: [
      'relation create',
      'relation revise',
      'relation unchanged',
      'relation self-edge',
      'subject identity immutable',
      'relation type identity immutable',
      'object identity immutable',
      'endpoint existence',
      'endpoint lifecycle independence',
      'parallel natural identity',
    ],
  },
  {
    group: 'multi-operation',
    layer: 'module',
    titles: [
      'same-command endpoint order independence',
      'receipt request order',
      'mixed applied and unchanged',
      'atomic rejection has no partial plan',
    ],
  },
  {
    group: 'provenance',
    layer: 'module',
    titles: [
      'direct citation',
      'Fragment derivation',
      'item revision derivation',
      'relation revision derivation',
      'ordered provenance equality',
      'citation and derivation distinction',
      'historical revision exactness',
      'same-command derivation rejected',
      'duplicate citation rejected',
      'duplicate Fragment across branches rejected',
      'duplicate formal revision rejected',
    ],
  },
  {
    group: 'source-excerpt',
    layer: 'module',
    titles: [
      'exact excerpt digest',
      'excerpt body required',
      'excerpt one citation',
      'excerpt rejects two citations',
      'excerpt rejects Fragment derivation',
      'excerpt rejects knowledge derivation',
      'excerpt digest mismatch',
      'relation excludes excerpt role',
    ],
  },
  {
    group: 'manual-provenance',
    layer: 'module',
    titles: [
      'manual Fragment citation',
      'manual historical item derivation',
      'manual historical relation derivation',
      'manual cross-workspace rejection',
    ],
  },
  {
    group: 'eligible-grounding',
    layer: 'module',
    titles: [
      'Fragment target grounding',
      'Snapshot target grounding',
      'out-of-scope Fragment',
      'knowledge-only derivation insufficient',
      'target grounding precedes role rules',
    ],
  },
  {
    group: 'replacement',
    layer: 'module',
    titles: [
      'item provenance replacement',
      'relation provenance replacement',
      'empty inheritance forbidden',
      'provenance delta creates revision',
    ],
  },
  {
    group: 'provenance-errors',
    layer: 'module',
    titles: [
      'all-empty provenance',
      'length-first aggregate limit',
      'malformed citations container',
      'malformed derivations container',
      'malformed knowledge container',
      'dense index validation',
      'citation lookup order',
      'Fragment derivation lookup order',
      'knowledge derivation lookup order',
      'source_claim requirement',
      'inference-only-citation rejection',
      'natural identity first field',
    ],
  },
  {
    group: 'identity',
    layer: 'oracle',
    titles: [
      'change-set UUIDv5 known answer',
      'item revision UUIDv5 known answer',
      'relation revision UUIDv5 known answer',
      'event UUIDv5 known answer',
      'canonical digest known answer',
      'optional presence and array order',
    ],
  },
  {
    group: 'capacity',
    layer: 'oracle',
    titles: [
      'independent canonical serializer self-check',
      'eligible_target put_item byte maximum',
      'eligible_target put_relation value maximum',
      'manual_edit put_item saturated vector',
      'manual_edit put_relation saturated vector',
      'all 65 eligible_target mixtures',
      'all 65 manual_edit mixtures',
      'encoder headroom and no request_bytes protocol',
    ],
  },
  {
    group: 'result',
    layer: 'module',
    titles: [
      'applied result',
      'unchanged result',
      'replayed result',
      'rejected result',
      'authorization receipt eligible branch',
      'authorization receipt manual branch',
      'operation receipt typed union',
    ],
  },
  {
    group: 'idempotency',
    layer: 'module',
    titles: [
      'same-key equal replay',
      'same-key conflict',
      'rejected-key reuse',
      'historical receipt after state advance',
      'stored applied replay',
      'stored unchanged replay',
      'stored command exact closure',
    ],
  },
  {
    group: 'numeric-issue',
    layer: 'module',
    titles: KNOWLEDGE_NUMERIC_ISSUE_ORACLES.map((row) => row.name),
  },
  {
    group: 'hostile-input',
    layer: 'module',
    titles: [
      'own getter zero calls',
      'inherited accessor zero calls',
      'inherited setter zero calls',
      'context Proxy zero traps',
      'request Proxy zero traps',
      'state Proxy zero traps',
      'array Proxy zero traps',
      'dangerous key rejection',
      'symbol rejection',
      'sparse array rejection',
      'cycle rejection',
      'custom prototype rejection',
      'caller input not frozen',
      'owned-copy mutation isolation',
      'successful plan deep freeze',
      'result and issue deep freeze',
    ],
  },
  {
    group: 'repository-snapshot',
    layer: 'module',
    titles: [
      'curationTargets sort tuple',
      'intakeDecisions sort tuple',
      'fragments sort tuple',
      'items sort tuple',
      'revisions sort tuple',
      'relations sort tuple',
      'relationRevisions sort tuple',
      'changeSets sort tuple',
      'changeOperations sort tuple',
      'changeEvents sort tuple',
      'target unique identity',
      'decision dual uniqueness',
      'Fragment uniqueness',
      'item uniqueness',
      'revision tuple and ID uniqueness',
      'relation uniqueness',
      'relation revision tuple and ID uniqueness',
      'change-set key and ID uniqueness',
      'operation tuple uniqueness',
      'event change-set and ID uniqueness',
      'stored-command closure',
      'new-command closure',
      'unrelated extra row rejected',
      'detectable missing current revision',
      'wholly absent lookup boundary',
      'pointer predecessor and derived-ID consistency',
    ],
  },
  {
    group: 'ddl',
    layer: 'migration',
    titles: [
      'thirteen-table closed set',
      'workspace-first keys and typed foreign keys',
      'current pointer and predecessor constraints',
      'provenance table branch semantics',
      'one event per accepted change set',
      'mutation and comment/string anti-spoof',
      'forbidden cascade JSON trigger and seed',
      'static-only DDL claim',
    ],
  },
  {
    group: 'event',
    layer: 'module',
    titles: [
      'applied change set emits one event',
      'unchanged change set emits one event',
      'rejected command emits no event',
    ],
  },
  {
    group: 'pure-seams',
    layer: 'module',
    titles: [
      'filesystem network and environment poisoned',
      'clock random and AI poisoned',
      'database and framework seams absent',
    ],
  },
  {
    group: 'boundary',
    layer: 'boundary',
    titles: [
      'dependency and license delta zero',
      'synthetic privacy provenance',
      'test helpers excluded from application artifact',
      'mandatory tests contain no disabled or empty-test gates',
    ],
  },
];

function buildLedger(): readonly KnowledgeTm1LedgerRow[] {
  const rows: KnowledgeTm1LedgerRow[] = [];
  for (const group of groups) {
    for (const title of group.titles) {
      const ordinal = rows.length + 1;
      rows.push(
        Object.freeze({
          id: tm1Id(ordinal),
          ordinal,
          group: group.group,
          title,
          layer: group.layer,
        }),
      );
    }
  }
  if (rows.length !== 224) {
    throw new RangeError(
      `The knowledge TM1 ledger has ${String(rows.length)} rows.`,
    );
  }
  return Object.freeze(rows);
}

export const KNOWLEDGE_TM1_LEDGER = buildLedger();
