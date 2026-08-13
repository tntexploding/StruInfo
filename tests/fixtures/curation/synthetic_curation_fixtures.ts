export function syntheticUuid(suffix: number): string {
  return `00000000-0000-0000-0000-${String(suffix).padStart(12, '0')}`;
}

export const CURATION_SYNTHETIC_IDS = Object.freeze({
  workspaceA: syntheticUuid(101),
  workspaceB: syntheticUuid(102),
  resource: syntheticUuid(201),
  snapshot1: syntheticUuid(301),
  snapshot2: syntheticUuid(302),
  fragment: syntheticUuid(401),
  termA: syntheticUuid(501),
  termB: syntheticUuid(502),
  termC: syntheticUuid(503),
  termD: syntheticUuid(504),
  alphabeticUuid: 'a0000000-0000-0000-0000-000000000101',
});

export const SYNTHETIC_INTAKE_ACTIONS = Object.freeze([
  'full',
  'split',
  'condense',
  'source_only',
  'ignore',
  'needs_review',
] as const);

export const SYNTHETIC_INTAKE_REASONS = Object.freeze([
  'already_known',
  'low_information_value',
  'high_noise_or_marketing',
  'unreliable_source',
  'insufficient_evidence',
  'temporarily_not_needed',
  'not_interested',
  'worth_exploring',
  'recommendation_direction_right_sample_wrong',
  'other',
] as const);

export const SYNTHETIC_ASSESSMENT_DIMENSIONS = Object.freeze([
  'information_density',
  'breadth',
  'depth',
  'novelty',
  'current_interest',
  'neighborhood_expansion',
  'cross_domain_connection',
  'foundational_gap',
  'emerging_signal',
  'viewpoint_source_diversity',
  'serendipity',
  'noise_marketing',
  'cognitive_cost',
  'traceability',
  'source_reliability',
  'extraction_confidence',
  'identity_confidence',
  'corroboration',
  'freshness',
] as const);

export const F_CUR_TARGET = Object.freeze({
  workspaceA: Object.freeze([
    Object.freeze({
      workspaceId: CURATION_SYNTHETIC_IDS.workspaceA,
      kind: 'snapshot',
      resourceId: CURATION_SYNTHETIC_IDS.resource,
      snapshotId: CURATION_SYNTHETIC_IDS.snapshot1,
    }),
    Object.freeze({
      workspaceId: CURATION_SYNTHETIC_IDS.workspaceA,
      kind: 'snapshot',
      resourceId: CURATION_SYNTHETIC_IDS.resource,
      snapshotId: CURATION_SYNTHETIC_IDS.snapshot2,
    }),
    Object.freeze({
      workspaceId: CURATION_SYNTHETIC_IDS.workspaceA,
      kind: 'fragment',
      fragmentId: CURATION_SYNTHETIC_IDS.fragment,
    }),
  ]),
  workspaceB: Object.freeze([
    Object.freeze({
      workspaceId: CURATION_SYNTHETIC_IDS.workspaceB,
      kind: 'snapshot',
      resourceId: CURATION_SYNTHETIC_IDS.resource,
      snapshotId: CURATION_SYNTHETIC_IDS.snapshot1,
    }),
    Object.freeze({
      workspaceId: CURATION_SYNTHETIC_IDS.workspaceB,
      kind: 'fragment',
      fragmentId: CURATION_SYNTHETIC_IDS.fragment,
    }),
  ]),
});

export function createSyntheticContext(
  commandIdempotencyKey = 'synthetic.curation.command.0001',
  workspaceId = CURATION_SYNTHETIC_IDS.workspaceA,
): Record<string, unknown> {
  return {
    effectiveWorkspaceId: workspaceId,
    commandIdempotencyKey,
    authority: 'manual_user',
  };
}

export function createSyntheticTermRequest(
  overrides: Readonly<Record<string, unknown>> = {},
): Record<string, unknown> {
  return {
    termId: CURATION_SYNTHETIC_IDS.termA,
    expectedRevision: 0,
    value: {
      displayName: 'synthetic-label',
      description: 'synthetic-description',
      lifecycle: 'active',
    },
    ...overrides,
  };
}

export function createSyntheticTargetRequest(
  operations: readonly unknown[],
  overrides: Readonly<Record<string, unknown>> = {},
): Record<string, unknown> {
  return {
    target: {kind: 'fragment', fragmentId: CURATION_SYNTHETIC_IDS.fragment},
    expectedTargetVersion: 0,
    operations,
    ...overrides,
  };
}

export function createEmptyCurationState(): Record<string, unknown[]> {
  return {
    evidenceTargets: [],
    targets: [],
    terms: [],
    assignments: [],
    decisions: [],
    assessments: [],
    commands: [],
  };
}

export function createEvidenceCurationState(): Record<string, unknown[]> {
  return {
    ...createEmptyCurationState(),
    evidenceTargets: [
      ...F_CUR_TARGET.workspaceA.map((value) => ({...value})),
      ...F_CUR_TARGET.workspaceB.map((value) => ({...value})),
    ],
  };
}

export const F_CUR_TERM_GRAPH = Object.freeze({
  activeChain: Object.freeze([
    Object.freeze({
      termId: CURATION_SYNTHETIC_IDS.termA,
      parentTermId: CURATION_SYNTHETIC_IDS.termB,
      lifecycle: 'active',
    }),
    Object.freeze({
      termId: CURATION_SYNTHETIC_IDS.termB,
      parentTermId: CURATION_SYNTHETIC_IDS.termC,
      lifecycle: 'active',
    }),
    Object.freeze({
      termId: CURATION_SYNTHETIC_IDS.termC,
      lifecycle: 'active',
    }),
  ]),
  retiredRoot: Object.freeze({
    termId: CURATION_SYNTHETIC_IDS.termD,
    lifecycle: 'retired',
  }),
});

export const F_CUR_ASSIGN_64 = Object.freeze(
  Array.from({length: 65}, (_, index) => syntheticUuid(1_000 + index)),
);

export const F_CUR_ACTIONS = Object.freeze(
  SYNTHETIC_INTAKE_ACTIONS.map((action) =>
    Object.freeze({
      kind: 'set_intake_decision',
      action,
      reasonCodes: Object.freeze([]),
    }),
  ),
);

export const F_CUR_REASON_11_DUP = Object.freeze([
  ...SYNTHETIC_INTAKE_REASONS,
  'already_known',
]);

export const F_CUR_REASON_11_ENUM = Object.freeze([
  'synthetic_invalid_reason',
  ...SYNTHETIC_INTAKE_REASONS,
]);

export const F_CUR_ASSESS = Object.freeze(
  SYNTHETIC_ASSESSMENT_DIMENSIONS.flatMap((dimension) => [
    Object.freeze({kind: 'set_assessment', dimension, score: 0}),
    Object.freeze({kind: 'set_assessment', dimension, score: 4}),
  ]),
);

export const F_CUR_MIXED = Object.freeze([
  Object.freeze({
    kind: 'set_assessment',
    dimension: 'depth',
    score: 4,
  }),
  Object.freeze({
    kind: 'assign_classification',
    termId: CURATION_SYNTHETIC_IDS.termB,
  }),
  Object.freeze({
    kind: 'set_intake_decision',
    action: 'needs_review',
    reasonCodes: Object.freeze(['worth_exploring', 'other']),
    note: 'synthetic-note',
  }),
  Object.freeze({
    kind: 'assign_classification',
    termId: CURATION_SYNTHETIC_IDS.termA,
  }),
  Object.freeze({
    kind: 'set_assessment',
    dimension: 'information_density',
    score: 0,
  }),
]);

export const F_CUR_REPLAY = Object.freeze({
  appliedKey: 'synthetic.replay.applied',
  unchangedKey: 'synthetic.replay.unchanged',
  conflictingKey: 'synthetic.replay.conflict',
  rejectedReusableKey: 'synthetic.replay.rejected-reusable',
});

export const F_CUR_RESULTS = Object.freeze({
  termKey: 'synthetic.result.term',
  targetKey: 'synthetic.result.target',
  safePersistenceMarker: 'persistence_failed',
});

export const F_CUR_UNICODE = Object.freeze({
  chineseEmojiCombining: '合成😀e\u0301é值',
  nfc: 'é',
  nfd: 'e\u0301',
  internalWhitespace: 'synthetic  value\tinside',
  displayAtLimit: '😀'.repeat(120),
  displayOverLimit: '😀'.repeat(121),
  descriptionAtLimit: '𠮷'.repeat(2_000),
  descriptionOverLimit: '𠮷'.repeat(2_001),
  noteAtLimit: '😀'.repeat(2_000),
  noteOverLimit: '😀'.repeat(2_001),
});

export interface ClosedInputAttackCounter {
  getterCalls: number;
  setterCalls: number;
  proxyTrapCalls: number;
}

export function createClosedInputAttackCounter(): ClosedInputAttackCounter {
  return {getterCalls: 0, setterCalls: 0, proxyTrapCalls: 0};
}

export function createAccessorContext(
  counter: ClosedInputAttackCounter,
): Record<string, unknown> {
  const context: Record<string, unknown> = {
    commandIdempotencyKey: 'synthetic.hostile.accessor',
    authority: 'manual_user',
  };
  Object.defineProperty(context, 'effectiveWorkspaceId', {
    enumerable: true,
    configurable: true,
    get() {
      counter.getterCalls += 1;
      return CURATION_SYNTHETIC_IDS.workspaceA;
    },
    set() {
      counter.setterCalls += 1;
    },
  });
  return context;
}

export function createProxyRequest(counter: ClosedInputAttackCounter): object {
  return new Proxy(createSyntheticTermRequest(), {
    getPrototypeOf() {
      counter.proxyTrapCalls += 1;
      return Object.prototype;
    },
    ownKeys() {
      counter.proxyTrapCalls += 1;
      return [];
    },
  });
}

export function createSymbolKeyTermRequest(): Record<PropertyKey, unknown> {
  const request = createSyntheticTermRequest() as Record<PropertyKey, unknown>;
  request[Symbol('synthetic-symbol')] = 'synthetic-symbol-value';
  return request;
}

export function createDangerousKeyTermRequest(
  key: '__proto__' | 'constructor' | 'prototype',
): Record<string, unknown> {
  const request = createSyntheticTermRequest();
  Object.defineProperty(request, key, {
    value: 'synthetic-dangerous-value',
    enumerable: true,
    configurable: true,
    writable: true,
  });
  return request;
}

export function createSparseOperations(): unknown[] {
  const operations: unknown[] = [];
  operations.length = 1;
  return operations;
}

export function createArrayAccessorOperations(
  counter: ClosedInputAttackCounter,
): unknown[] {
  const operations = [{kind: 'clear_assessment', dimension: 'freshness'}];
  Object.defineProperty(operations, '0', {
    enumerable: true,
    configurable: true,
    get() {
      counter.getterCalls += 1;
      return {kind: 'clear_assessment', dimension: 'freshness'};
    },
  });
  return operations;
}

export function createCyclicTermRequest(): Record<string, unknown> {
  const request = createSyntheticTermRequest();
  request.value = request;
  return request;
}

export const F_CUR_HOSTILE = Object.freeze({
  dangerousKeys: Object.freeze([
    '__proto__',
    'constructor',
    'prototype',
  ] as const),
  attackKinds: Object.freeze([
    'accessor',
    'proxy',
    'symbol',
    'dangerous_key',
    'sparse_array',
    'array_accessor',
    'cycle',
    'custom_prototype',
  ]),
});

export interface UuidSpellingFixture {
  readonly id: string;
  readonly value: string;
}

export function createNonCanonicalUuidSpellings(
  canonical = CURATION_SYNTHETIC_IDS.alphabeticUuid,
): readonly UuidSpellingFixture[] {
  return Object.freeze([
    Object.freeze({id: 'uppercase', value: canonical.toUpperCase()}),
    Object.freeze({
      id: 'mixed-case',
      value: `${canonical.slice(0, 1).toUpperCase()}${canonical.slice(1)}`,
    }),
    Object.freeze({id: 'braces', value: `{${canonical}}`}),
    Object.freeze({id: 'urn-prefix', value: `urn:uuid:${canonical}`}),
    Object.freeze({id: 'hyphenless', value: canonical.replaceAll('-', '')}),
    Object.freeze({
      id: 'wrong-hyphen-placement',
      value: `${canonical.slice(0, 7)}-${canonical.slice(8)}`,
    }),
    Object.freeze({id: 'leading-whitespace', value: ` ${canonical}`}),
    Object.freeze({id: 'trailing-whitespace', value: `${canonical} `}),
    Object.freeze({id: 'non-hex', value: `g${canonical.slice(1)}`}),
    Object.freeze({id: 'short', value: canonical.slice(0, -1)}),
    Object.freeze({id: 'long', value: `${canonical}0`}),
    Object.freeze({id: 'empty', value: ''}),
  ]);
}

export const F_CUR_UUID_SPELLINGS = createNonCanonicalUuidSpellings();

export const F_CUR_BUDGET = Object.freeze({
  operationAtLimit: 64,
  operationOverLimit: 65,
  classificationAtLimit: 64,
  classificationOverLimit: 65,
  reasonAtLimit: 10,
  reasonOverLimit: 11,
  keyAtLimit: 'a'.repeat(200),
  keyOverLimit: 'a'.repeat(201),
  invalidKeyBeforeBudget: '!'.repeat(201),
  maximumRevision: 2_147_483_647,
  overMaximumRevision: 2_147_483_648,
});

export type SyntheticSqlTokenKind =
  | 'word'
  | 'string'
  | 'escape_string'
  | 'quoted_identifier'
  | 'number'
  | 'operator'
  | 'punctuation';

export interface SyntheticSqlToken {
  readonly kind: SyntheticSqlTokenKind;
  readonly value: string;
}

export interface SqlMutationFixture {
  readonly id: string;
  readonly finding: string;
  readonly from: readonly SyntheticSqlToken[];
  readonly to: readonly SyntheticSqlToken[];
}

function sqlToken(
  kind: SyntheticSqlTokenKind,
  value: string,
): Readonly<SyntheticSqlToken> {
  return Object.freeze({kind, value});
}

const sqlWord = (value: string): Readonly<SyntheticSqlToken> =>
  sqlToken('word', value);
const sqlString = (value: string): Readonly<SyntheticSqlToken> =>
  sqlToken('string', value);
const sqlPunctuation = (value: string): Readonly<SyntheticSqlToken> =>
  sqlToken('punctuation', value);

export const F_CUR_DDL_MUT = Object.freeze<readonly SqlMutationFixture[]>([
  Object.freeze({
    id: 'workspace-first-fragment-fk',
    finding: 'fragment_fk',
    from: Object.freeze([
      sqlWord('foreign'),
      sqlWord('key'),
      sqlPunctuation('('),
      sqlWord('workspace_id'),
      sqlPunctuation(','),
      sqlWord('fragment_id'),
      sqlPunctuation(')'),
    ]),
    to: Object.freeze([
      sqlWord('foreign'),
      sqlWord('key'),
      sqlPunctuation('('),
      sqlWord('fragment_id'),
      sqlPunctuation(')'),
    ]),
  }),
  Object.freeze({
    id: 'lifecycle-check',
    finding: 'lifecycle_check',
    from: Object.freeze([
      sqlWord('lifecycle'),
      sqlWord('in'),
      sqlPunctuation('('),
      sqlString('active'),
      sqlPunctuation(','),
      sqlString('retired'),
      sqlPunctuation(')'),
    ]),
    to: Object.freeze([
      sqlWord('lifecycle'),
      sqlWord('in'),
      sqlPunctuation('('),
      sqlString('active'),
      sqlPunctuation(','),
      sqlString('retired'),
      sqlPunctuation(','),
      sqlString('synthetic_unknown'),
      sqlPunctuation(')'),
    ]),
  }),
  Object.freeze({
    id: 'target-sum',
    finding: 'target_sum',
    from: Object.freeze([
      sqlWord('and'),
      sqlWord('fragment_id'),
      sqlWord('is'),
      sqlWord('null'),
    ]),
    to: Object.freeze([
      sqlWord('or'),
      sqlWord('fragment_id'),
      sqlWord('is'),
      sqlWord('null'),
    ]),
  }),
  Object.freeze({
    id: 'idempotency-key-order',
    finding: 'command_pk',
    from: Object.freeze([
      sqlWord('primary'),
      sqlWord('key'),
      sqlPunctuation('('),
      sqlWord('workspace_id'),
      sqlPunctuation(','),
      sqlWord('command_idempotency_key'),
      sqlPunctuation(')'),
    ]),
    to: Object.freeze([
      sqlWord('primary'),
      sqlWord('key'),
      sqlPunctuation('('),
      sqlWord('command_idempotency_key'),
      sqlPunctuation(','),
      sqlWord('workspace_id'),
      sqlPunctuation(')'),
    ]),
  }),
  Object.freeze({
    id: 'snapshot-partial-predicate',
    finding: 'snapshot_partial_unique',
    from: Object.freeze([
      sqlWord('where'),
      sqlWord('target_kind'),
      sqlToken('operator', '='),
      sqlString('snapshot'),
    ]),
    to: Object.freeze([
      sqlWord('where'),
      sqlWord('target_kind'),
      sqlWord('in'),
      sqlPunctuation('('),
      sqlString('snapshot'),
      sqlPunctuation(','),
      sqlString('fragment'),
      sqlPunctuation(')'),
    ]),
  }),
  Object.freeze({
    id: 'exact-term-revision-binding',
    finding: 'term_revision_fk',
    from: Object.freeze([
      sqlWord('foreign'),
      sqlWord('key'),
      sqlPunctuation('('),
      sqlWord('workspace_id'),
      sqlPunctuation(','),
      sqlWord('term_id'),
      sqlPunctuation(','),
      sqlWord('term_revision_number'),
      sqlPunctuation(','),
      sqlWord('term_revision_id'),
      sqlPunctuation(')'),
    ]),
    to: Object.freeze([
      sqlWord('foreign'),
      sqlWord('key'),
      sqlPunctuation('('),
      sqlWord('workspace_id'),
      sqlPunctuation(','),
      sqlWord('term_id'),
      sqlPunctuation(','),
      sqlWord('term_revision_id'),
      sqlPunctuation(','),
      sqlWord('term_revision_number'),
      sqlPunctuation(')'),
    ]),
  }),
  Object.freeze({
    id: 'rated-cleared-sum',
    finding: 'assessment_sum',
    from: Object.freeze([
      sqlWord('and'),
      sqlWord('note'),
      sqlWord('is'),
      sqlWord('null'),
    ]),
    to: Object.freeze([
      sqlWord('or'),
      sqlWord('note'),
      sqlWord('is'),
      sqlWord('null'),
    ]),
  }),
  Object.freeze({
    id: 'command-subject-sum',
    finding: 'command_subject',
    from: Object.freeze([
      sqlWord('and'),
      sqlWord('target_id'),
      sqlWord('is'),
      sqlWord('null'),
    ]),
    to: Object.freeze([
      sqlWord('or'),
      sqlWord('target_id'),
      sqlWord('is'),
      sqlWord('null'),
    ]),
  }),
]);

export const F_CUR_DDL_ANTISPOOF = Object.freeze({
  commentFragmentFk: 'FOREIGN KEY (workspace_id, fragment_id)',
  stringFragmentFk: 'FOREIGN KEY (workspace_id, fragment_id)',
  lifecycleTrueOrConstraint: Object.freeze([
    sqlWord('check'),
    sqlPunctuation('('),
    sqlWord('true'),
    sqlWord('or'),
    sqlWord('lifecycle'),
    sqlWord('in'),
    sqlPunctuation('('),
    sqlString('active'),
    sqlPunctuation(','),
    sqlString('retired'),
    sqlPunctuation(')'),
    sqlPunctuation(')'),
  ]),
  lifecycleEscapeStringExpression: Object.freeze([
    sqlWord('lifecycle'),
    sqlWord('in'),
    sqlPunctuation('('),
    sqlToken('escape_string', 'active'),
    sqlPunctuation(','),
    sqlString('retired'),
    sqlPunctuation(')'),
  ]),
  additionalWeakLifecycleConstraint: Object.freeze([
    sqlWord('check'),
    sqlPunctuation('('),
    sqlWord('lifecycle'),
    sqlWord('in'),
    sqlPunctuation('('),
    sqlString('active'),
    sqlPunctuation(','),
    sqlString('retired'),
    sqlPunctuation(','),
    sqlString('synthetic_unknown'),
    sqlPunctuation(')'),
    sqlPunctuation(')'),
  ]),
  redundantCorrectFragmentFk: Object.freeze([
    sqlWord('foreign'),
    sqlWord('key'),
    sqlPunctuation('('),
    sqlWord('workspace_id'),
    sqlPunctuation(','),
    sqlWord('fragment_id'),
    sqlPunctuation(')'),
    sqlWord('references'),
    sqlWord('struinfo'),
    sqlPunctuation('.'),
    sqlWord('fragment'),
    sqlPunctuation('('),
    sqlWord('workspace_id'),
    sqlPunctuation(','),
    sqlWord('fragment_id'),
    sqlPunctuation(')'),
  ]),
  stringPayloadConstraint: Object.freeze([
    sqlWord('check'),
    sqlPunctuation('('),
    sqlString('FOREIGN KEY (workspace_id, fragment_id)'),
    sqlToken('operator', '='),
    sqlString('synthetic-decoy'),
    sqlPunctuation(')'),
  ]),
  unexpectedUniqueConstraint: Object.freeze([
    sqlWord('unique'),
    sqlPunctuation('('),
    sqlWord('workspace_id'),
    sqlPunctuation(','),
    sqlWord('current_version'),
    sqlPunctuation(')'),
  ]),
  constraintNameFrom: Object.freeze([
    sqlWord('constraint'),
    sqlWord('curation_target_pk'),
  ]),
  constraintNameQuotedTo: Object.freeze([
    sqlWord('constraint'),
    sqlToken('quoted_identifier', 'synthetic_equivalent_name'),
  ]),
  targetKindColumnFrom: Object.freeze([
    sqlWord('target_kind'),
    sqlWord('text'),
    sqlWord('not'),
    sqlWord('null'),
  ]),
  targetKindColumnWithInlineCheck: Object.freeze([
    sqlWord('target_kind'),
    sqlWord('text'),
    sqlWord('not'),
    sqlWord('null'),
    sqlWord('check'),
    sqlPunctuation('('),
    sqlWord('target_kind'),
    sqlWord('is'),
    sqlWord('not'),
    sqlWord('null'),
    sqlPunctuation(')'),
  ]),
  currentVersionColumnFrom: Object.freeze([
    sqlWord('current_version'),
    sqlWord('integer'),
    sqlWord('not'),
    sqlWord('null'),
  ]),
  currentVersionColumnWithTrailingToken: Object.freeze([
    sqlWord('current_version'),
    sqlWord('integer'),
    sqlWord('not'),
    sqlWord('null'),
    sqlWord('synthetic_trailing'),
  ]),
  currentTermRevisionTypeFrom: Object.freeze([
    sqlWord('current_term_revision_id'),
    sqlWord('uuid'),
    sqlWord('not'),
    sqlWord('null'),
  ]),
  currentTermRevisionTypeWithQuotedIdentifier: Object.freeze([
    sqlWord('current_term_revision_id'),
    sqlToken('quoted_identifier', 'UUID'),
    sqlWord('not'),
    sqlWord('null'),
  ]),
  createdAtTimestampTypeFrom: Object.freeze([
    sqlWord('current_version'),
    sqlWord('integer'),
    sqlWord('not'),
    sqlWord('null'),
    sqlPunctuation(','),
    sqlWord('created_at'),
    sqlWord('timestamp'),
    sqlWord('with'),
    sqlWord('time'),
    sqlWord('zone'),
  ]),
  createdAtTimestampTypeWithQuotedIdentifier: Object.freeze([
    sqlWord('current_version'),
    sqlWord('integer'),
    sqlWord('not'),
    sqlWord('null'),
    sqlPunctuation(','),
    sqlWord('created_at'),
    sqlWord('timestamp'),
    sqlWord('with'),
    sqlToken('quoted_identifier', 'time'),
    sqlWord('zone'),
  ]),
  protoTableStatement: `CREATE TABLE struinfo.__proto__ (
  workspace_id uuid NOT NULL,
  CONSTRAINT synthetic_proto_pk PRIMARY KEY (workspace_id)
);`,
  allowedOrdinaryIndex:
    'CREATE INDEX synthetic_allowed ON struinfo.curation_target (workspace_id);',
  nonWorkspaceFirstIndex:
    'CREATE INDEX synthetic_non_workspace ON struinfo.curation_target (target_id);',
  unsupportedPrefixIndex:
    'CREATE INDEX synthetic_bad_prefix ON struinfo.curation_target (workspace_id, current_version);',
  unknownTableIndex:
    'CREATE INDEX synthetic_unknown_table ON struinfo.synthetic_unknown (workspace_id);',
  unexpectedUniqueIndex:
    'CREATE UNIQUE INDEX synthetic_unique ON struinfo.curation_target (workspace_id);',
  unexpectedPartialIndex:
    "CREATE INDEX synthetic_partial ON struinfo.curation_target (workspace_id) WHERE target_kind = 'snapshot';",
  expressionIndex:
    'CREATE INDEX synthetic_expression ON struinfo.curation_target (lower(target_kind));',
  unsupportedMethodIndex:
    'CREATE INDEX synthetic_method ON struinfo.curation_target USING hash (workspace_id);',
  unsupportedSuffixIndex:
    'CREATE INDEX synthetic_suffix ON struinfo.curation_target (workspace_id) INCLUDE (target_id);',
});

export const F_CUR_PROVENANCE = Object.freeze([
  'synthetic-label',
  'synthetic-description',
  'synthetic-note',
  '合成分类😀e\u0301',
  'synthetic-resource-key',
  'https://fixture.example.invalid/synthetic-item',
]);

export const ALL_STATIC_SYNTHETIC_CURATION_TEXT = Object.freeze([
  ...Object.values(CURATION_SYNTHETIC_IDS),
  ...SYNTHETIC_INTAKE_ACTIONS,
  ...SYNTHETIC_INTAKE_REASONS,
  ...SYNTHETIC_ASSESSMENT_DIMENSIONS,
  ...F_CUR_PROVENANCE,
]);
