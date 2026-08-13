export const MANUAL_CURATION_COMMAND_SCHEMA_VERSION =
  'struinfo.manual-curation-command.v1' as const;

export const INTAKE_ACTIONS = [
  'full',
  'split',
  'condense',
  'source_only',
  'ignore',
  'needs_review',
] as const;

export const INTAKE_FEEDBACK_REASONS = [
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
] as const;

export const ASSESSMENT_DIMENSIONS = [
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
] as const;

export const CURATION_LIMITS = Object.freeze({
  commandOperations: 64,
  currentClassifications: 64,
  feedbackReasons: 10,
  displayNameCodePoints: 120,
  descriptionCodePoints: 2_000,
  noteCodePoints: 2_000,
  idempotencyKeyCharacters: 200,
  revisionNumber: 2_147_483_647,
  targetVersion: 2_147_483_647,
});

export type IntakeAction = (typeof INTAKE_ACTIONS)[number];
export type IntakeFeedbackReason = (typeof INTAKE_FEEDBACK_REASONS)[number];
export type AssessmentDimension = (typeof ASSESSMENT_DIMENSIONS)[number];
export type AssessmentScore = 0 | 1 | 2 | 3 | 4;
export type VocabularyTermLifecycle = 'active' | 'retired';

export interface ManualCurationContext {
  readonly effectiveWorkspaceId: string;
  readonly commandIdempotencyKey: string;
  readonly authority: 'manual_user';
}

export type CurationTargetRef =
  | Readonly<{kind: 'snapshot'; snapshotId: string}>
  | Readonly<{kind: 'fragment'; fragmentId: string}>;

export interface PutContentClassificationTermRequest {
  readonly termId: string;
  readonly expectedRevision: number;
  readonly value: Readonly<{
    displayName: string;
    description?: string;
    parentTermId?: string;
    lifecycle: VocabularyTermLifecycle;
  }>;
}

export interface ApplyManualCurationRequest {
  readonly target: CurationTargetRef;
  readonly expectedTargetVersion: number;
  readonly operations: readonly ManualCurationOperation[];
}

export type ManualCurationOperation =
  | Readonly<{kind: 'assign_classification'; termId: string}>
  | Readonly<{kind: 'remove_classification'; termId: string}>
  | Readonly<{
      kind: 'set_intake_decision';
      action: IntakeAction;
      reasonCodes: readonly IntakeFeedbackReason[];
      note?: string;
    }>
  | Readonly<{
      kind: 'set_assessment';
      dimension: AssessmentDimension;
      score: AssessmentScore;
      note?: string;
    }>
  | Readonly<{
      kind: 'clear_assessment';
      dimension: AssessmentDimension;
    }>;

export type CurationCommandStatus =
  'applied' | 'replayed' | 'unchanged' | 'rejected';
export type CurationOriginalOutcome = 'applied' | 'unchanged';

export interface PutContentClassificationTermReceipt<
  Outcome extends CurationOriginalOutcome = CurationOriginalOutcome,
> {
  readonly workspaceId: string;
  readonly commandIdempotencyKey: string;
  readonly commandKind: 'put_content_classification_term';
  readonly termId: string;
  readonly resultingRevision: number;
  readonly originalOutcome: Outcome;
}

export interface ApplyManualCurationReceipt<
  Outcome extends CurationOriginalOutcome = CurationOriginalOutcome,
> {
  readonly workspaceId: string;
  readonly commandIdempotencyKey: string;
  readonly commandKind: 'apply_manual_curation';
  readonly targetId: string;
  readonly resultingVersion: number;
  readonly originalOutcome: Outcome;
}

export type PutContentClassificationTermResult =
  | Readonly<{
      status: 'applied';
      receipt: PutContentClassificationTermReceipt<'applied'>;
    }>
  | Readonly<{
      status: 'unchanged';
      receipt: PutContentClassificationTermReceipt<'unchanged'>;
    }>
  | Readonly<{
      status: 'replayed';
      receipt: PutContentClassificationTermReceipt;
    }>
  | CurationRejectedResult;

export type ApplyManualCurationResult =
  | Readonly<{
      status: 'applied';
      receipt: ApplyManualCurationReceipt<'applied'>;
    }>
  | Readonly<{
      status: 'unchanged';
      receipt: ApplyManualCurationReceipt<'unchanged'>;
    }>
  | Readonly<{
      status: 'replayed';
      receipt: ApplyManualCurationReceipt;
    }>
  | CurationRejectedResult;

export type CurationIssueCode =
  | 'invalid_shape'
  | 'invalid_identifier'
  | 'invalid_text'
  | 'invalid_state'
  | 'limit_exceeded'
  | 'duplicate_operation'
  | 'target_not_found'
  | 'term_not_found'
  | 'term_retired'
  | 'invalid_parent'
  | 'hierarchy_cycle'
  | 'stale_revision'
  | 'idempotency_conflict'
  | 'persistence_failed';

export type CurationBudgetName =
  | 'command_operations'
  | 'current_classifications'
  | 'feedback_reasons'
  | 'display_name_code_points'
  | 'description_code_points'
  | 'note_code_points'
  | 'idempotency_key_characters'
  | 'revision_number'
  | 'target_version';

export type CurationOperationIndex =
  | 0
  | 1
  | 2
  | 3
  | 4
  | 5
  | 6
  | 7
  | 8
  | 9
  | 10
  | 11
  | 12
  | 13
  | 14
  | 15
  | 16
  | 17
  | 18
  | 19
  | 20
  | 21
  | 22
  | 23
  | 24
  | 25
  | 26
  | 27
  | 28
  | 29
  | 30
  | 31
  | 32
  | 33
  | 34
  | 35
  | 36
  | 37
  | 38
  | 39
  | 40
  | 41
  | 42
  | 43
  | 44
  | 45
  | 46
  | 47
  | 48
  | 49
  | 50
  | 51
  | 52
  | 53
  | 54
  | 55
  | 56
  | 57
  | 58
  | 59
  | 60
  | 61
  | 62
  | 63;

export type CurationReasonIndex = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;

export type CurationIssuePath =
  | 'context'
  | 'context.effectiveWorkspaceId'
  | 'context.commandIdempotencyKey'
  | 'context.authority'
  | 'request'
  | 'request.termId'
  | 'request.expectedRevision'
  | 'request.value'
  | 'request.value.displayName'
  | 'request.value.description'
  | 'request.value.parentTermId'
  | 'request.value.lifecycle'
  | 'request.target'
  | 'request.target.kind'
  | 'request.target.snapshotId'
  | 'request.target.fragmentId'
  | 'request.expectedTargetVersion'
  | 'request.operations'
  | `request.operations[${CurationOperationIndex}]`
  | `request.operations[${CurationOperationIndex}].kind`
  | `request.operations[${CurationOperationIndex}].termId`
  | `request.operations[${CurationOperationIndex}].action`
  | `request.operations[${CurationOperationIndex}].reasonCodes`
  | `request.operations[${CurationOperationIndex}].reasonCodes[${CurationReasonIndex}]`
  | `request.operations[${CurationOperationIndex}].note`
  | `request.operations[${CurationOperationIndex}].dimension`
  | `request.operations[${CurationOperationIndex}].score`
  | 'state'
  | 'persistence';

export type CurationIssue =
  | Readonly<{
      code: 'limit_exceeded';
      path: CurationIssuePath;
      budget: CurationBudgetName;
    }>
  | Readonly<{
      code: Exclude<CurationIssueCode, 'limit_exceeded'>;
      path: CurationIssuePath;
    }>;

export type CurationRejectedResult = Readonly<{
  status: 'rejected';
  issue: CurationIssue;
}>;

export type VocabularyTermValue = Readonly<{
  displayName: string;
  description?: string;
  parentTermId?: string;
  lifecycle: VocabularyTermLifecycle;
}>;

export type EvidenceTargetState =
  | Readonly<{
      workspaceId: string;
      kind: 'snapshot';
      resourceId: string;
      snapshotId: string;
    }>
  | Readonly<{
      workspaceId: string;
      kind: 'fragment';
      fragmentId: string;
    }>;

export type CurationTargetState = EvidenceTargetState &
  Readonly<{targetId: string; currentVersion: number}>;

export interface VocabularyTermState {
  readonly workspaceId: string;
  readonly termId: string;
  readonly currentRevision: number;
  readonly currentRevisionId: string;
  readonly value: VocabularyTermValue;
}

export interface ClassificationAssignmentState {
  readonly workspaceId: string;
  readonly assignmentId: string;
  readonly targetId: string;
  readonly termId: string;
  readonly currentRevision: number;
  readonly currentRevisionId: string;
  readonly state: 'assigned' | 'removed';
  readonly termRevisionNumber: number;
  readonly termRevisionId: string;
}

export interface IntakeDecisionValue {
  readonly action: IntakeAction;
  readonly reasonCodes: readonly IntakeFeedbackReason[];
  readonly note?: string;
}

export interface IntakeDecisionState {
  readonly workspaceId: string;
  readonly decisionId: string;
  readonly targetId: string;
  readonly currentRevision: number;
  readonly currentRevisionId: string;
  readonly value: IntakeDecisionValue;
}

export type AssessmentRevisionValue =
  | Readonly<{state: 'rated'; score: AssessmentScore; note?: string}>
  | Readonly<{state: 'cleared'}>;

export interface AssessmentState {
  readonly workspaceId: string;
  readonly assessmentId: string;
  readonly targetId: string;
  readonly dimension: AssessmentDimension;
  readonly currentRevision: number;
  readonly currentRevisionId: string;
  readonly value: AssessmentRevisionValue;
}

export type StoredCurationReceipt =
  PutContentClassificationTermReceipt | ApplyManualCurationReceipt;

export interface StoredCurationCommandState {
  readonly workspaceId: string;
  readonly commandIdempotencyKey: string;
  readonly requestSha256: string;
  readonly receipt: StoredCurationReceipt;
}

export interface ManualCurationRepositorySnapshot {
  readonly evidenceTargets: readonly EvidenceTargetState[];
  readonly targets: readonly CurationTargetState[];
  readonly terms: readonly VocabularyTermState[];
  readonly assignments: readonly ClassificationAssignmentState[];
  readonly decisions: readonly IntakeDecisionState[];
  readonly assessments: readonly AssessmentState[];
  readonly commands: readonly StoredCurationCommandState[];
}

export interface CurationCommandInsert {
  readonly workspaceId: string;
  readonly commandIdempotencyKey: string;
  readonly requestSha256: string;
  readonly commandKind:
    'put_content_classification_term' | 'apply_manual_curation';
  readonly authority: 'manual_user';
  readonly termId?: string;
  readonly targetId?: string;
  readonly outcome: CurationOriginalOutcome;
  readonly resultingVersion: number;
}

export interface VocabularyTermIdentityInsert {
  readonly workspaceId: string;
  readonly termId: string;
  readonly currentRevision: number;
  readonly currentRevisionId: string;
}

export interface VocabularyTermRevisionInsert {
  readonly workspaceId: string;
  readonly termId: string;
  readonly termRevisionId: string;
  readonly revisionNumber: number;
  readonly value: VocabularyTermValue;
}

export interface CurrentPointerCas {
  readonly workspaceId: string;
  readonly stableId: string;
  readonly expectedRevision: number;
  readonly nextRevision: number;
  readonly nextRevisionId: string;
}

export type CurationTargetInsert = CurationTargetState;

export interface TargetVersionCas {
  readonly workspaceId: string;
  readonly targetId: string;
  readonly expectedVersion: number;
  readonly nextVersion: number;
}

export interface ClassificationAssignmentIdentityInsert {
  readonly workspaceId: string;
  readonly assignmentId: string;
  readonly targetId: string;
  readonly termId: string;
  readonly currentRevision: number;
  readonly currentRevisionId: string;
}

export interface ClassificationAssignmentRevisionInsert {
  readonly workspaceId: string;
  readonly assignmentId: string;
  readonly assignmentRevisionId: string;
  readonly revisionNumber: number;
  readonly state: 'assigned' | 'removed';
  readonly termId: string;
  readonly termRevisionNumber: number;
  readonly termRevisionId: string;
}

export interface PreparedClassificationChange {
  readonly identityInsert?: ClassificationAssignmentIdentityInsert;
  readonly revisionInsert: ClassificationAssignmentRevisionInsert;
  readonly currentPointerCas?: CurrentPointerCas;
}

export interface IntakeDecisionIdentityInsert {
  readonly workspaceId: string;
  readonly decisionId: string;
  readonly targetId: string;
  readonly currentRevision: number;
  readonly currentRevisionId: string;
}

export interface IntakeDecisionRevisionInsert {
  readonly workspaceId: string;
  readonly decisionId: string;
  readonly decisionRevisionId: string;
  readonly revisionNumber: number;
  readonly value: IntakeDecisionValue;
}

export interface IntakeDecisionReasonInsert {
  readonly workspaceId: string;
  readonly decisionId: string;
  readonly decisionRevisionId: string;
  readonly reasonOrdinal: number;
  readonly reasonCode: IntakeFeedbackReason;
}

export interface PreparedDecisionChange {
  readonly identityInsert?: IntakeDecisionIdentityInsert;
  readonly revisionInsert: IntakeDecisionRevisionInsert;
  readonly reasonInserts: readonly IntakeDecisionReasonInsert[];
  readonly currentPointerCas?: CurrentPointerCas;
}

export interface AssessmentIdentityInsert {
  readonly workspaceId: string;
  readonly assessmentId: string;
  readonly targetId: string;
  readonly dimension: AssessmentDimension;
  readonly currentRevision: number;
  readonly currentRevisionId: string;
}

export interface AssessmentRevisionInsert {
  readonly workspaceId: string;
  readonly assessmentId: string;
  readonly assessmentRevisionId: string;
  readonly revisionNumber: number;
  readonly value: AssessmentRevisionValue;
}

export interface PreparedAssessmentChange {
  readonly identityInsert?: AssessmentIdentityInsert;
  readonly revisionInsert: AssessmentRevisionInsert;
  readonly currentPointerCas?: CurrentPointerCas;
}

export interface PreparedPutContentClassificationTermPlan {
  readonly commandKind: 'put_content_classification_term';
  readonly requestSha256: string;
  readonly outcome: CurationOriginalOutcome;
  readonly receipt: PutContentClassificationTermReceipt;
  readonly workspaceLockId: string;
  readonly termIdentityInsert?: VocabularyTermIdentityInsert;
  readonly termRevisionInsert?: VocabularyTermRevisionInsert;
  readonly termCurrentPointerCas?: CurrentPointerCas;
  readonly commandInsert: CurationCommandInsert;
}

export interface PreparedApplyManualCurationPlan {
  readonly commandKind: 'apply_manual_curation';
  readonly requestSha256: string;
  readonly outcome: CurationOriginalOutcome;
  readonly receipt: ApplyManualCurationReceipt;
  readonly targetLock: Readonly<{
    workspaceId: string;
    targetId: string;
    expectedVersion: number;
  }>;
  readonly termLocks: readonly Readonly<{
    termId: string;
    expectedRevision: number;
  }>[];
  readonly targetInsert?: CurationTargetInsert;
  readonly targetVersionCas?: TargetVersionCas;
  readonly classificationChanges: readonly PreparedClassificationChange[];
  readonly decisionChange?: PreparedDecisionChange;
  readonly assessmentChanges: readonly PreparedAssessmentChange[];
  readonly commandInsert: CurationCommandInsert;
}

export type PreparedManualCurationPlan =
  PreparedPutContentClassificationTermPlan | PreparedApplyManualCurationPlan;

export interface LockedTermCommandSnapshotQuery {
  readonly workspaceId: string;
  readonly commandIdempotencyKey: string;
  readonly termId: string;
  readonly parentTermId?: string;
}

export interface LockedTargetCommandSnapshotQuery {
  readonly workspaceId: string;
  readonly commandIdempotencyKey: string;
  readonly target: CurationTargetRef;
  readonly referencedTermIds: readonly string[];
}

export type PutContentClassificationTermPreparation =
  | Readonly<{
      kind: 'prepared';
      plan: PreparedPutContentClassificationTermPlan;
    }>
  | Readonly<{
      kind: 'resolved';
      result: PutContentClassificationTermResult;
    }>;

export type ApplyManualCurationPreparation =
  | Readonly<{kind: 'prepared'; plan: PreparedApplyManualCurationPlan}>
  | Readonly<{kind: 'resolved'; result: ApplyManualCurationResult}>;
