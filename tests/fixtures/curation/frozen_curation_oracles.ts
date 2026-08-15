import {CURATION_SYNTHETIC_IDS} from './synthetic_curation_fixtures.js';

export const CURATION_CONTRACT_ORACLE = Object.freeze({
  contractId: 'C-SLICE-A-CURATION-r3',
  contractSha256:
    '5CAD7B266126E82BD3007699C090D8D971AEE6D903E026E188FEA352EF2F0DC7',
  schemaVersion: 'struinfo.manual-curation-command.v1',
  authority: 'manual_user',
  commandKinds: Object.freeze([
    'put_content_classification_term',
    'apply_manual_curation',
  ]),
  statuses: Object.freeze(['applied', 'unchanged', 'replayed', 'rejected']),
  originalOutcomes: Object.freeze(['applied', 'unchanged']),
});

export const CURATION_UUID_KNOWN_ANSWERS = Object.freeze({
  targetSnapshotA1: '20e08ba5-5029-5605-aa08-88ca5fdc4353',
  targetSnapshotA2: '36953196-2d3c-55a5-9e84-5cb175468a24',
  targetFragmentA: 'd37a19e2-08c1-5021-83d0-70e477f6bc6d',
  targetSnapshotB1: 'f3d1ead1-2c30-5648-9a7b-dff5e45b0936',
  targetFragmentB: '953f4dfe-59ed-5724-99e2-8aa32f497824',
  termARevision1: '332d1955-5065-5363-9a1e-c5588ddaff22',
  termARevision2: 'cf3e674f-ea19-5983-8f52-fc74512bcdc1',
  termBRevision1: 'f5c10c46-5fab-5417-bed7-9b7bf17d4dc3',
  assignmentA: 'f1881349-7f27-5932-b134-b8900b515c48',
  assignmentARevision1: '371d8f8c-705c-588a-aa97-615af42baab8',
  assignmentARevision2: '41202b0e-8ac0-51c1-bb65-cc131c153eb5',
  decisionA: 'bc07074b-b085-5796-885e-fc78be0aee87',
  decisionARevision1: 'd5be876f-d06f-5c9d-93ac-e47d48c643fd',
  decisionARevision2: '33200ff5-ac6d-5a99-b2bf-b48a3f2fbc1a',
  informationDensityAssessmentA: '69c57b2e-8272-518b-b968-cad1eb15f62f',
  informationDensityAssessmentARevision1:
    '421ec15b-ae54-5139-af18-a47160ea9ca8',
  informationDensityAssessmentARevision2:
    'e48419db-d52a-56ca-a9bc-facd48a2bc8a',
});

export const TERM_COMMAND_PROJECTION_WITH_DESCRIPTION = Object.freeze({
  schemaVersion: CURATION_CONTRACT_ORACLE.schemaVersion,
  authority: 'manual_user',
  commandKind: 'put_content_classification_term',
  workspaceId: CURATION_SYNTHETIC_IDS.workspaceA,
  request: Object.freeze({
    termId: CURATION_SYNTHETIC_IDS.termA,
    expectedRevision: 0,
    value: Object.freeze({
      displayName: 'synthetic-label',
      description: 'synthetic-description',
      lifecycle: 'active',
    }),
  }),
});

export const TERM_COMMAND_PROJECTION_WITHOUT_DESCRIPTION = Object.freeze({
  schemaVersion: CURATION_CONTRACT_ORACLE.schemaVersion,
  authority: 'manual_user',
  commandKind: 'put_content_classification_term',
  workspaceId: CURATION_SYNTHETIC_IDS.workspaceA,
  request: Object.freeze({
    termId: CURATION_SYNTHETIC_IDS.termA,
    expectedRevision: 0,
    value: Object.freeze({
      displayName: 'synthetic-label',
      lifecycle: 'active',
    }),
  }),
});

const MIXED_OPERATIONS = Object.freeze([
  Object.freeze({
    kind: 'assign_classification',
    termId: CURATION_SYNTHETIC_IDS.termA,
  }),
  Object.freeze({
    kind: 'set_intake_decision',
    action: 'needs_review',
    reasonCodes: Object.freeze(['worth_exploring', 'other']),
    note: 'synthetic-note',
  }),
  Object.freeze({
    kind: 'set_assessment',
    dimension: 'information_density',
    score: 0,
  }),
]);

function targetProjection(
  operations: readonly Readonly<Record<string, unknown>>[],
): Readonly<Record<string, unknown>> {
  return Object.freeze({
    schemaVersion: CURATION_CONTRACT_ORACLE.schemaVersion,
    authority: 'manual_user',
    commandKind: 'apply_manual_curation',
    workspaceId: CURATION_SYNTHETIC_IDS.workspaceA,
    request: Object.freeze({
      target: Object.freeze({
        kind: 'fragment',
        fragmentId: CURATION_SYNTHETIC_IDS.fragment,
      }),
      expectedTargetVersion: 0,
      operations: Object.freeze(operations),
    }),
  });
}

export const MIXED_COMMAND_PROJECTION = targetProjection(MIXED_OPERATIONS);

export const MIXED_COMMAND_REVERSED_REASONS_PROJECTION = targetProjection([
  MIXED_OPERATIONS[0] ?? {},
  Object.freeze({
    kind: 'set_intake_decision',
    action: 'needs_review',
    reasonCodes: Object.freeze(['other', 'worth_exploring']),
    note: 'synthetic-note',
  }),
  MIXED_OPERATIONS[2] ?? {},
]);

export const MIXED_COMMAND_REVERSED_OPERATIONS_PROJECTION = targetProjection(
  [...MIXED_OPERATIONS].reverse(),
);

export const CURATION_CANONICAL_PROJECTION_ORACLES = Object.freeze({
  termWithDescription: Object.freeze({
    bytes: 365,
    sha256: '17e68baeb9e82f2eeb9ef94c17d7c805f51c42dcedbe6ec576dd06d7083d862c',
  }),
  termWithoutDescription: Object.freeze({
    bytes: 327,
    sha256: '56ad280f989d7cb069c9861e4b423482b874c29045f15669fb100b837f575aaa',
  }),
  mixed: Object.freeze({
    bytes: 579,
    sha256: '87dd8344b879bc4bb7c3177b2e3970cfd95859b074265b2a144a98be9f7f158a',
  }),
  mixedReversedReasons: Object.freeze({
    bytes: 579,
    sha256: '5a06ab8ce77da28457b1f22e48b6300d65e3f9bdabc1738dbb43794246e828f6',
  }),
  mixedReversedOperations: Object.freeze({
    bytes: 579,
    sha256: '0dafbb53f6f19f93dd59e8694b772ba899fbdda53006e9d18707f3cc090419fd',
  }),
});

export const CURATION_ASSESSMENT_GROUPS = Object.freeze({
  informationValue: Object.freeze([
    'information_density',
    'breadth',
    'depth',
    'novelty',
  ]),
  currentPreference: Object.freeze(['current_interest']),
  explorationValue: Object.freeze([
    'neighborhood_expansion',
    'cross_domain_connection',
    'foundational_gap',
    'emerging_signal',
    'viewpoint_source_diversity',
    'serendipity',
  ]),
  noiseAndCost: Object.freeze(['noise_marketing', 'cognitive_cost']),
  reliabilityEvidence: Object.freeze([
    'traceability',
    'source_reliability',
    'extraction_confidence',
    'identity_confidence',
    'corroboration',
    'freshness',
  ]),
});

export const CURATION_LIMIT_ORACLE = Object.freeze({
  commandOperations: 64,
  currentClassifications: 64,
  feedbackReasons: 10,
  displayNameCodePoints: 120,
  descriptionCodePoints: 2_000,
  noteCodePoints: 2_000,
  idempotencyKeyCharacters: 200,
  revisionNumber: 2_147_483_647,
  targetVersion: 2_147_483_647,
  maximumDisplayNameUtf8BytesByScalarArithmetic: 480,
  maximumDescriptionOrNoteUtf8BytesByScalarArithmetic: 8_000,
});

export interface ExactIssueOracle {
  readonly scenario: string;
  readonly code: string;
  readonly path: string;
  readonly budget?: string;
}

export const CURATION_EXACT_ISSUE_ORACLES = Object.freeze<
  readonly ExactIssueOracle[]
>([
  Object.freeze({
    scenario: 'invalid context container',
    code: 'invalid_shape',
    path: 'context',
  }),
  Object.freeze({
    scenario: 'invalid workspace UUID',
    code: 'invalid_identifier',
    path: 'context.effectiveWorkspaceId',
  }),
  Object.freeze({
    scenario: 'invalid command key',
    code: 'invalid_identifier',
    path: 'context.commandIdempotencyKey',
  }),
  Object.freeze({
    scenario: 'invalid authority',
    code: 'invalid_state',
    path: 'context.authority',
  }),
  Object.freeze({
    scenario: 'invalid state UUID',
    code: 'invalid_identifier',
    path: 'state',
  }),
  Object.freeze({
    scenario: 'invalid display name',
    code: 'invalid_text',
    path: 'request.value.displayName',
  }),
  Object.freeze({
    scenario: 'retired create',
    code: 'invalid_state',
    path: 'request.value.lifecycle',
  }),
  Object.freeze({
    scenario: 'empty operations',
    code: 'invalid_state',
    path: 'request.operations',
  }),
  Object.freeze({
    scenario: 'invalid score',
    code: 'invalid_state',
    path: 'request.operations[0].score',
  }),
  Object.freeze({
    scenario: 'duplicate reason',
    code: 'invalid_state',
    path: 'request.operations[0].reasonCodes[1]',
  }),
  Object.freeze({
    scenario: 'other without note',
    code: 'invalid_state',
    path: 'request.operations[0].note',
  }),
  Object.freeze({
    scenario: 'operation limit',
    code: 'limit_exceeded',
    path: 'request.operations',
    budget: 'command_operations',
  }),
  Object.freeze({
    scenario: 'classification limit',
    code: 'limit_exceeded',
    path: 'request.operations',
    budget: 'current_classifications',
  }),
  Object.freeze({
    scenario: 'reason limit',
    code: 'limit_exceeded',
    path: 'request.operations[0].reasonCodes',
    budget: 'feedback_reasons',
  }),
  Object.freeze({
    scenario: 'display limit',
    code: 'limit_exceeded',
    path: 'request.value.displayName',
    budget: 'display_name_code_points',
  }),
  Object.freeze({
    scenario: 'description limit',
    code: 'limit_exceeded',
    path: 'request.value.description',
    budget: 'description_code_points',
  }),
  Object.freeze({
    scenario: 'note limit',
    code: 'limit_exceeded',
    path: 'request.operations[0].note',
    budget: 'note_code_points',
  }),
  Object.freeze({
    scenario: 'key limit',
    code: 'limit_exceeded',
    path: 'context.commandIdempotencyKey',
    budget: 'idempotency_key_characters',
  }),
  Object.freeze({
    scenario: 'term revision limit',
    code: 'limit_exceeded',
    path: 'request.expectedRevision',
    budget: 'revision_number',
  }),
  Object.freeze({
    scenario: 'target version limit',
    code: 'limit_exceeded',
    path: 'request.expectedTargetVersion',
    budget: 'target_version',
  }),
  Object.freeze({
    scenario: 'duplicate operation',
    code: 'duplicate_operation',
    path: 'request.operations[1]',
  }),
  Object.freeze({
    scenario: 'target missing',
    code: 'target_not_found',
    path: 'request.target',
  }),
  Object.freeze({
    scenario: 'primary term missing',
    code: 'term_not_found',
    path: 'request.termId',
  }),
  Object.freeze({
    scenario: 'operation term missing',
    code: 'term_not_found',
    path: 'request.operations[0].termId',
  }),
  Object.freeze({
    scenario: 'term retired',
    code: 'term_retired',
    path: 'request.operations[0].termId',
  }),
  Object.freeze({
    scenario: 'invalid parent',
    code: 'invalid_parent',
    path: 'request.value.parentTermId',
  }),
  Object.freeze({
    scenario: 'hierarchy cycle',
    code: 'hierarchy_cycle',
    path: 'request.value.parentTermId',
  }),
  Object.freeze({
    scenario: 'stale term',
    code: 'stale_revision',
    path: 'request.expectedRevision',
  }),
  Object.freeze({
    scenario: 'stale target',
    code: 'stale_revision',
    path: 'request.expectedTargetVersion',
  }),
  Object.freeze({
    scenario: 'idempotency conflict',
    code: 'idempotency_conflict',
    path: 'context.commandIdempotencyKey',
  }),
  Object.freeze({
    scenario: 'persistence failure',
    code: 'persistence_failed',
    path: 'persistence',
  }),
]);

export const CURATION_RESULT_SHAPE_ORACLE = Object.freeze({
  successfulResultKeys: Object.freeze(['receipt', 'status']),
  rejectedResultKeys: Object.freeze(['issue', 'status']),
  termReceiptKeys: Object.freeze([
    'commandIdempotencyKey',
    'commandKind',
    'originalOutcome',
    'resultingRevision',
    'termId',
    'workspaceId',
  ]),
  targetReceiptKeys: Object.freeze([
    'commandIdempotencyKey',
    'commandKind',
    'originalOutcome',
    'resultingVersion',
    'targetId',
    'workspaceId',
  ]),
  nonBudgetIssueKeys: Object.freeze(['code', 'path']),
  budgetIssueKeys: Object.freeze(['budget', 'code', 'path']),
});

export interface CurationDdlColumnOracle {
  readonly name: string;
  readonly type: string;
  readonly nullable: boolean;
  readonly defaultExpression?: string;
}

export interface CurationDdlForeignKeyOracle {
  readonly localColumns: readonly string[];
  readonly targetTable: string;
  readonly targetColumns: readonly string[];
  readonly deferrable: boolean;
}

export interface CurationDdlTableOracle {
  readonly columns: readonly CurationDdlColumnOracle[];
  readonly primaryKeys: readonly (readonly string[])[];
  readonly uniqueKeys: readonly (readonly string[])[];
  readonly foreignKeys: readonly CurationDdlForeignKeyOracle[];
  readonly checks: readonly string[];
}

function ddlColumn(
  name: string,
  type: string,
  nullable = false,
  defaultExpression?: string,
): Readonly<CurationDdlColumnOracle> {
  return Object.freeze({
    name,
    type,
    nullable,
    ...(defaultExpression === undefined ? {} : {defaultExpression}),
  });
}

function ddlForeignKey(
  localColumns: readonly string[],
  targetTable: string,
  targetColumns: readonly string[],
  deferrable = false,
): Readonly<CurationDdlForeignKeyOracle> {
  return Object.freeze({
    localColumns: Object.freeze(localColumns),
    targetTable,
    targetColumns: Object.freeze(targetColumns),
    deferrable,
  });
}

function ddlTable(
  columns: readonly CurationDdlColumnOracle[],
  primaryKeys: readonly (readonly string[])[],
  uniqueKeys: readonly (readonly string[])[],
  foreignKeys: readonly CurationDdlForeignKeyOracle[],
  checks: readonly string[],
): Readonly<CurationDdlTableOracle> {
  return Object.freeze({
    columns: Object.freeze(columns),
    primaryKeys: Object.freeze(primaryKeys.map((key) => Object.freeze(key))),
    uniqueKeys: Object.freeze(uniqueKeys.map((key) => Object.freeze(key))),
    foreignKeys: Object.freeze(foreignKeys),
    checks: Object.freeze(checks),
  });
}

const CREATED_AT_COLUMN = ddlColumn(
  'created_at',
  'timestamp with time zone',
  false,
  'CURRENT_TIMESTAMP',
);

export const CURATION_DDL_SEMANTIC_ORACLE = Object.freeze({
  tables: Object.freeze({
    curation_target: ddlTable(
      [
        ddlColumn('workspace_id', 'uuid'),
        ddlColumn('target_id', 'uuid'),
        ddlColumn('target_kind', 'text'),
        ddlColumn('resource_id', 'uuid', true),
        ddlColumn('snapshot_id', 'uuid', true),
        ddlColumn('fragment_id', 'uuid', true),
        ddlColumn('current_version', 'integer'),
        CREATED_AT_COLUMN,
      ],
      [['workspace_id', 'target_id']],
      [],
      [
        ddlForeignKey(['workspace_id'], 'struinfo.workspace', ['workspace_id']),
        ddlForeignKey(
          ['workspace_id', 'resource_id', 'snapshot_id'],
          'struinfo.snapshot',
          ['workspace_id', 'resource_id', 'snapshot_id'],
        ),
        ddlForeignKey(['workspace_id', 'fragment_id'], 'struinfo.fragment', [
          'workspace_id',
          'fragment_id',
        ]),
      ],
      [
        "target_kind IN ('snapshot', 'fragment')",
        "(target_kind = 'snapshot' AND resource_id IS NOT NULL AND snapshot_id IS NOT NULL AND fragment_id IS NULL) OR (target_kind = 'fragment' AND resource_id IS NULL AND snapshot_id IS NULL AND fragment_id IS NOT NULL)",
        'current_version >= 0',
      ],
    ),
    vocabulary_term: ddlTable(
      [
        ddlColumn('workspace_id', 'uuid'),
        ddlColumn('term_id', 'uuid'),
        ddlColumn('current_revision', 'integer'),
        ddlColumn('current_term_revision_id', 'uuid'),
        CREATED_AT_COLUMN,
      ],
      [['workspace_id', 'term_id']],
      [
        [
          'workspace_id',
          'term_id',
          'current_revision',
          'current_term_revision_id',
        ],
      ],
      [
        ddlForeignKey(['workspace_id'], 'struinfo.workspace', ['workspace_id']),
        ddlForeignKey(
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
      ['current_revision >= 1'],
    ),
    vocabulary_term_revision: ddlTable(
      [
        ddlColumn('workspace_id', 'uuid'),
        ddlColumn('term_id', 'uuid'),
        ddlColumn('term_revision_id', 'uuid'),
        ddlColumn('revision_number', 'integer'),
        ddlColumn('display_name', 'text'),
        ddlColumn('description', 'text', true),
        ddlColumn('parent_term_id', 'uuid', true),
        ddlColumn('lifecycle', 'text'),
        CREATED_AT_COLUMN,
      ],
      [['workspace_id', 'term_id', 'term_revision_id']],
      [
        ['workspace_id', 'term_id', 'revision_number'],
        ['workspace_id', 'term_id', 'revision_number', 'term_revision_id'],
      ],
      [
        ddlForeignKey(['workspace_id', 'term_id'], 'struinfo.vocabulary_term', [
          'workspace_id',
          'term_id',
        ]),
        ddlForeignKey(
          ['workspace_id', 'parent_term_id'],
          'struinfo.vocabulary_term',
          ['workspace_id', 'term_id'],
        ),
      ],
      [
        'revision_number >= 1',
        "btrim(display_name) <> ''",
        "description IS NULL OR btrim(description) <> ''",
        'parent_term_id IS NULL OR parent_term_id <> term_id',
        "lifecycle IN ('active', 'retired')",
      ],
    ),
    classification_assignment: ddlTable(
      [
        ddlColumn('workspace_id', 'uuid'),
        ddlColumn('assignment_id', 'uuid'),
        ddlColumn('target_id', 'uuid'),
        ddlColumn('term_id', 'uuid'),
        ddlColumn('current_revision', 'integer'),
        ddlColumn('current_assignment_revision_id', 'uuid'),
        CREATED_AT_COLUMN,
      ],
      [['workspace_id', 'assignment_id']],
      [
        ['workspace_id', 'target_id', 'term_id'],
        ['workspace_id', 'assignment_id', 'term_id'],
        [
          'workspace_id',
          'assignment_id',
          'current_revision',
          'current_assignment_revision_id',
        ],
      ],
      [
        ddlForeignKey(
          ['workspace_id', 'target_id'],
          'struinfo.curation_target',
          ['workspace_id', 'target_id'],
        ),
        ddlForeignKey(['workspace_id', 'term_id'], 'struinfo.vocabulary_term', [
          'workspace_id',
          'term_id',
        ]),
        ddlForeignKey(
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
      ['current_revision >= 1'],
    ),
    classification_assignment_revision: ddlTable(
      [
        ddlColumn('workspace_id', 'uuid'),
        ddlColumn('assignment_id', 'uuid'),
        ddlColumn('assignment_revision_id', 'uuid'),
        ddlColumn('revision_number', 'integer'),
        ddlColumn('assignment_state', 'text'),
        ddlColumn('term_id', 'uuid'),
        ddlColumn('term_revision_number', 'integer'),
        ddlColumn('term_revision_id', 'uuid'),
        CREATED_AT_COLUMN,
      ],
      [['workspace_id', 'assignment_id', 'assignment_revision_id']],
      [
        ['workspace_id', 'assignment_id', 'revision_number'],
        [
          'workspace_id',
          'assignment_id',
          'revision_number',
          'assignment_revision_id',
        ],
      ],
      [
        ddlForeignKey(
          ['workspace_id', 'assignment_id', 'term_id'],
          'struinfo.classification_assignment',
          ['workspace_id', 'assignment_id', 'term_id'],
        ),
        ddlForeignKey(
          [
            'workspace_id',
            'term_id',
            'term_revision_number',
            'term_revision_id',
          ],
          'struinfo.vocabulary_term_revision',
          ['workspace_id', 'term_id', 'revision_number', 'term_revision_id'],
        ),
      ],
      ['revision_number >= 1', "assignment_state IN ('assigned', 'removed')"],
    ),
    intake_decision: ddlTable(
      [
        ddlColumn('workspace_id', 'uuid'),
        ddlColumn('decision_id', 'uuid'),
        ddlColumn('target_id', 'uuid'),
        ddlColumn('current_revision', 'integer'),
        ddlColumn('current_decision_revision_id', 'uuid'),
        CREATED_AT_COLUMN,
      ],
      [['workspace_id', 'decision_id']],
      [
        ['workspace_id', 'target_id'],
        [
          'workspace_id',
          'decision_id',
          'current_revision',
          'current_decision_revision_id',
        ],
      ],
      [
        ddlForeignKey(
          ['workspace_id', 'target_id'],
          'struinfo.curation_target',
          ['workspace_id', 'target_id'],
        ),
        ddlForeignKey(
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
      ['current_revision >= 1'],
    ),
    intake_decision_revision: ddlTable(
      [
        ddlColumn('workspace_id', 'uuid'),
        ddlColumn('decision_id', 'uuid'),
        ddlColumn('decision_revision_id', 'uuid'),
        ddlColumn('revision_number', 'integer'),
        ddlColumn('intake_action', 'text'),
        ddlColumn('note', 'text', true),
        CREATED_AT_COLUMN,
      ],
      [['workspace_id', 'decision_id', 'decision_revision_id']],
      [
        ['workspace_id', 'decision_id', 'revision_number'],
        [
          'workspace_id',
          'decision_id',
          'revision_number',
          'decision_revision_id',
        ],
      ],
      [
        ddlForeignKey(
          ['workspace_id', 'decision_id'],
          'struinfo.intake_decision',
          ['workspace_id', 'decision_id'],
        ),
      ],
      [
        'revision_number >= 1',
        "intake_action IN ('full', 'split', 'condense', 'source_only', 'ignore', 'needs_review')",
        "note IS NULL OR btrim(note) <> ''",
      ],
    ),
    intake_decision_reason: ddlTable(
      [
        ddlColumn('workspace_id', 'uuid'),
        ddlColumn('decision_id', 'uuid'),
        ddlColumn('decision_revision_id', 'uuid'),
        ddlColumn('reason_ordinal', 'integer'),
        ddlColumn('reason_code', 'text'),
        CREATED_AT_COLUMN,
      ],
      [
        [
          'workspace_id',
          'decision_id',
          'decision_revision_id',
          'reason_ordinal',
        ],
      ],
      [['workspace_id', 'decision_id', 'decision_revision_id', 'reason_code']],
      [
        ddlForeignKey(
          ['workspace_id', 'decision_id', 'decision_revision_id'],
          'struinfo.intake_decision_revision',
          ['workspace_id', 'decision_id', 'decision_revision_id'],
        ),
      ],
      [
        'reason_ordinal >= 0 AND reason_ordinal < 10',
        "reason_code IN ('already_known', 'low_information_value', 'high_noise_or_marketing', 'unreliable_source', 'insufficient_evidence', 'temporarily_not_needed', 'not_interested', 'worth_exploring', 'recommendation_direction_right_sample_wrong', 'other')",
      ],
    ),
    assessment: ddlTable(
      [
        ddlColumn('workspace_id', 'uuid'),
        ddlColumn('assessment_id', 'uuid'),
        ddlColumn('target_id', 'uuid'),
        ddlColumn('dimension', 'text'),
        ddlColumn('current_revision', 'integer'),
        ddlColumn('current_assessment_revision_id', 'uuid'),
        CREATED_AT_COLUMN,
      ],
      [['workspace_id', 'assessment_id']],
      [
        ['workspace_id', 'target_id', 'dimension'],
        [
          'workspace_id',
          'assessment_id',
          'current_revision',
          'current_assessment_revision_id',
        ],
      ],
      [
        ddlForeignKey(
          ['workspace_id', 'target_id'],
          'struinfo.curation_target',
          ['workspace_id', 'target_id'],
        ),
        ddlForeignKey(
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
      [
        "dimension IN ('information_density', 'breadth', 'depth', 'novelty', 'current_interest', 'neighborhood_expansion', 'cross_domain_connection', 'foundational_gap', 'emerging_signal', 'viewpoint_source_diversity', 'serendipity', 'noise_marketing', 'cognitive_cost', 'traceability', 'source_reliability', 'extraction_confidence', 'identity_confidence', 'corroboration', 'freshness')",
        'current_revision >= 1',
      ],
    ),
    assessment_revision: ddlTable(
      [
        ddlColumn('workspace_id', 'uuid'),
        ddlColumn('assessment_id', 'uuid'),
        ddlColumn('assessment_revision_id', 'uuid'),
        ddlColumn('revision_number', 'integer'),
        ddlColumn('assessment_state', 'text'),
        ddlColumn('score', 'integer', true),
        ddlColumn('note', 'text', true),
        CREATED_AT_COLUMN,
      ],
      [['workspace_id', 'assessment_id', 'assessment_revision_id']],
      [
        ['workspace_id', 'assessment_id', 'revision_number'],
        [
          'workspace_id',
          'assessment_id',
          'revision_number',
          'assessment_revision_id',
        ],
      ],
      [
        ddlForeignKey(
          ['workspace_id', 'assessment_id'],
          'struinfo.assessment',
          ['workspace_id', 'assessment_id'],
        ),
      ],
      [
        'revision_number >= 1',
        "assessment_state IN ('rated', 'cleared')",
        "(assessment_state = 'rated' AND score IS NOT NULL AND score >= 0 AND score <= 4 AND (note IS NULL OR btrim(note) <> '')) OR (assessment_state = 'cleared' AND score IS NULL AND note IS NULL)",
      ],
    ),
    curation_command: ddlTable(
      [
        ddlColumn('workspace_id', 'uuid'),
        ddlColumn('command_idempotency_key', 'text'),
        ddlColumn('request_sha256', 'text'),
        ddlColumn('command_kind', 'text'),
        ddlColumn('authority', 'text'),
        ddlColumn('target_id', 'uuid', true),
        ddlColumn('term_id', 'uuid', true),
        ddlColumn('outcome', 'text'),
        ddlColumn('resulting_version', 'integer'),
        CREATED_AT_COLUMN,
      ],
      [['workspace_id', 'command_idempotency_key']],
      [],
      [
        ddlForeignKey(['workspace_id'], 'struinfo.workspace', ['workspace_id']),
        ddlForeignKey(
          ['workspace_id', 'target_id'],
          'struinfo.curation_target',
          ['workspace_id', 'target_id'],
        ),
        ddlForeignKey(['workspace_id', 'term_id'], 'struinfo.vocabulary_term', [
          'workspace_id',
          'term_id',
        ]),
      ],
      [
        "request_sha256 ~ '^[0-9a-f]{64}$'",
        "command_idempotency_key ~ '^[A-Za-z0-9._:-]{1,200}$'",
        "command_kind IN ('put_content_classification_term', 'apply_manual_curation')",
        "authority = 'manual_user'",
        "(command_kind = 'put_content_classification_term' AND term_id IS NOT NULL AND target_id IS NULL) OR (command_kind = 'apply_manual_curation' AND target_id IS NOT NULL AND term_id IS NULL)",
        "outcome IN ('applied', 'unchanged')",
        "resulting_version >= 0 AND (outcome <> 'applied' OR resulting_version >= 1) AND (command_kind <> 'put_content_classification_term' OR resulting_version >= 1)",
      ],
    ),
  }),
  indexes: Object.freeze([
    Object.freeze({
      table: 'struinfo.curation_target',
      columns: Object.freeze(['workspace_id', 'resource_id', 'snapshot_id']),
      unique: true,
      predicate: "target_kind = 'snapshot'",
    }),
    Object.freeze({
      table: 'struinfo.curation_target',
      columns: Object.freeze(['workspace_id', 'fragment_id']),
      unique: true,
      predicate: "target_kind = 'fragment'",
    }),
  ]),
});

export const CURATION_TEST_OWNED_PATHS = Object.freeze([
  'tests/fixtures/curation/synthetic_curation_fixtures.ts',
  'tests/fixtures/curation/frozen_curation_oracles.ts',
  'tools/manual_curation_contract_oracles.test.ts',
  'tools/manual_curation_fixture_provenance.test.ts',
]);

export const CURATION_BACKEND_CANDIDATE_PATHS = Object.freeze([
  'apps/server/migrations/000003_create_manual_curation_schema.sql',
  'apps/server/src/modules/curation/closed_manual_curation_input.ts',
  'apps/server/src/modules/curation/index.ts',
  'apps/server/src/modules/curation/manual_curation.test.ts',
  'apps/server/src/modules/curation/manual_curation.ts',
  'apps/server/src/modules/curation/manual_curation_contract.ts',
  'apps/server/src/modules/curation/manual_curation_identity.ts',
  'apps/server/src/modules/curation/manual_curation_migration.test.ts',
  'apps/server/src/modules/curation/manual_curation_repository.ts',
  'apps/server/test_support/manual_curation_sql_lexical.ts',
]);

export const CURATION_BACKEND_ENTRY_HASHES = Object.freeze({
  'apps/server/migrations/000003_create_manual_curation_schema.sql':
    '60C94270EF3C9DE019593A8A54861C697C16189F6E65D8759553028AAFBA0EB1',
  'apps/server/src/modules/curation/closed_manual_curation_input.ts':
    '4E1FB5E2CFC80042FDFFA1C05DB7A11BD0758C4E69B44C50E37F3AE261A5F40A',
  'apps/server/src/modules/curation/index.ts':
    '76E44CDD3D864CB3B41CD45657618ACE21D7075ACF93DB1AD3550653775A3926',
  'apps/server/src/modules/curation/manual_curation.test.ts':
    'ED2545FD75604508157F726AAC8EEE5F851528D8746E1502F135DAA5AE0331AB',
  'apps/server/src/modules/curation/manual_curation.ts':
    '63093EE30C6F253AAB003769D23A8B9421F583BA58BC5998EDE3A8AE729573B5',
  'apps/server/src/modules/curation/manual_curation_contract.ts':
    '02BE5C4348E6BB93E1190461433196084BD7B360072A4A768B5FE7348E9C16A8',
  'apps/server/src/modules/curation/manual_curation_identity.ts':
    'EFC060D1131E73AD512899BDF44270AF0B05AA8BB144C64312FDC30819EA80D9',
  'apps/server/src/modules/curation/manual_curation_migration.test.ts':
    '71F3B330D8FFE62C868D2DF06FA37AFD14BCBFCBE8C53EA675CBFF5053B16F8A',
  'apps/server/src/modules/curation/manual_curation_repository.ts':
    'FA9C50726B0236487240BECA4DBE567C6E1AD259FAE72F9682F6869154546BD8',
  'apps/server/test_support/manual_curation_sql_lexical.ts':
    'CDD329F0DEA2FAB6AF4FD093690687A6814CB12A5E9DA9126D9E57137E6F8F80',
});

export const CURATION_DEPENDENCY_ORACLE = Object.freeze({
  packageSha256:
    '1EBBCA4172FDD8131F8C2C9B9FA2B87201F75984961DE87FD46E05269CBE596F',
  serverPackageSha256:
    '3DFD35E4629BCCB9E766B63037A09EDDADA46E295D44DF72567A2051FC279D5F',
  lockfileSha256:
    '99F261C35311919380BF6AEF018E0B2A9D076DC7937A5EDE1E0D7F26F56192A0',
  productionDependencyDelta: 0,
  developmentDependencyDelta: 0,
});
