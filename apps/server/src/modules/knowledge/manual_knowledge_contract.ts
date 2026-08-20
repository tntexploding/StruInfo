export const MANUAL_KNOWLEDGE_COMMAND_SCHEMA_VERSION =
  'struinfo.manual-knowledge-change-set.v1' as const;

export const KNOWLEDGE_KINDS = [
  'entity',
  'concept',
  'assertion',
  'event',
  'method',
  'framework',
  'resource',
  'work',
  'other',
] as const;

export const EPISTEMIC_ROLES = [
  'source_excerpt',
  'source_claim',
  'summary',
  'inference',
  'user_assertion',
] as const;

export const KNOWLEDGE_REVIEW_STATES = [
  'draft',
  'pending_review',
  'confirmed',
  'disputed',
  'rejected',
  'withdrawn',
] as const;

export const ELIGIBLE_INTAKE_ACTIONS = ['full', 'split', 'condense'] as const;

export const KNOWLEDGE_LIMITS = Object.freeze({
  changeSetOperations: 64,
  operationProvenanceInputs: 64,
  titleCodePoints: 300,
  relationTypeCodePoints: 120,
  bodyCodePoints: 20_000,
  qualifierCodePoints: 2_000,
  idempotencyKeyCharacters: 200,
  revisionNumber: 2_147_483_647,
});

export type KnowledgeKind = (typeof KNOWLEDGE_KINDS)[number];
export type EpistemicRole = (typeof EPISTEMIC_ROLES)[number];
export type KnowledgeReviewState = (typeof KNOWLEDGE_REVIEW_STATES)[number];
export type IntakeAction =
  | (typeof ELIGIBLE_INTAKE_ACTIONS)[number]
  | 'source_only'
  | 'ignore'
  | 'needs_review';

export interface ManualKnowledgeContext {
  readonly effectiveWorkspaceId: string;
  readonly commandIdempotencyKey: string;
  readonly authority: 'manual_user';
}

export type KnowledgeSourceTargetRef =
  | Readonly<{kind: 'snapshot'; snapshotId: string}>
  | Readonly<{kind: 'fragment'; fragmentId: string}>;

export type ManualKnowledgeAuthorization =
  | Readonly<{
      kind: 'eligible_target';
      target: KnowledgeSourceTargetRef;
      expectedDecisionRevision: number;
    }>
  | Readonly<{kind: 'manual_edit'}>;

export interface ApplyManualKnowledgeChangeSetRequest {
  readonly authorization: Readonly<ManualKnowledgeAuthorization>;
  readonly operations: readonly ManualKnowledgeOperation[];
}

export interface KnowledgeItemRevisionValue {
  readonly knowledgeKind: KnowledgeKind;
  readonly epistemicRole: EpistemicRole;
  readonly reviewState: KnowledgeReviewState;
  readonly title: string;
  readonly body?: string;
}

export interface KnowledgeRelationRevisionValue {
  readonly subjectItemId: string;
  readonly relationTypeKey: string;
  readonly objectItemId: string;
  readonly epistemicRole: Exclude<EpistemicRole, 'source_excerpt'>;
  readonly reviewState: KnowledgeReviewState;
  readonly qualifier?: string;
}

export type FormalKnowledgeRevisionRef =
  | Readonly<{kind: 'item'; itemId: string; revision: number}>
  | Readonly<{kind: 'relation'; relationId: string; revision: number}>;

export interface KnowledgeProvenanceInput {
  readonly citations: readonly string[];
  readonly fragmentDerivations: readonly string[];
  readonly knowledgeDerivations: readonly FormalKnowledgeRevisionRef[];
}

export interface PutKnowledgeItemOperation {
  readonly kind: 'put_item';
  readonly itemId: string;
  readonly expectedRevision: number;
  readonly value: Readonly<KnowledgeItemRevisionValue>;
  readonly provenance: Readonly<KnowledgeProvenanceInput>;
}

export interface PutKnowledgeRelationOperation {
  readonly kind: 'put_relation';
  readonly relationId: string;
  readonly expectedRevision: number;
  readonly value: Readonly<KnowledgeRelationRevisionValue>;
  readonly provenance: Readonly<KnowledgeProvenanceInput>;
}

export type ManualKnowledgeOperation =
  Readonly<PutKnowledgeItemOperation> | Readonly<PutKnowledgeRelationOperation>;

export type KnowledgeAuthorizationReceipt =
  | Readonly<{
      kind: 'eligible_target';
      targetId: string;
      decisionId: string;
      decisionRevision: number;
      decisionRevisionId: string;
    }>
  | Readonly<{kind: 'manual_edit'}>;

export type KnowledgeOriginalOutcome = 'applied' | 'unchanged';
export type KnowledgeOperationOutcome = 'applied' | 'unchanged';

export type KnowledgeBoundedIndex =
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

export type KnowledgeOperationReceipt =
  | Readonly<{
      operationIndex: KnowledgeBoundedIndex;
      operationKind: 'put_item';
      itemId: string;
      resultingRevision: number;
      resultingRevisionId: string;
      outcome: KnowledgeOperationOutcome;
    }>
  | Readonly<{
      operationIndex: KnowledgeBoundedIndex;
      operationKind: 'put_relation';
      relationId: string;
      resultingRevision: number;
      resultingRevisionId: string;
      outcome: KnowledgeOperationOutcome;
    }>;

export interface ManualKnowledgeReceipt<
  Outcome extends KnowledgeOriginalOutcome = KnowledgeOriginalOutcome,
> {
  readonly workspaceId: string;
  readonly commandIdempotencyKey: string;
  readonly changeSetId: string;
  readonly commandKind: 'apply_manual_knowledge_change_set';
  readonly authorization: KnowledgeAuthorizationReceipt;
  readonly originalOutcome: Outcome;
  readonly operations: readonly KnowledgeOperationReceipt[];
}

export type ApplyManualKnowledgeChangeSetResult =
  | Readonly<{
      status: 'applied';
      receipt: ManualKnowledgeReceipt<'applied'>;
    }>
  | Readonly<{
      status: 'unchanged';
      receipt: ManualKnowledgeReceipt<'unchanged'>;
    }>
  | Readonly<{status: 'replayed'; receipt: ManualKnowledgeReceipt}>
  | Readonly<{status: 'rejected'; issue: KnowledgeIssue}>;

export type KnowledgeIssueCode =
  | 'invalid_shape'
  | 'invalid_identifier'
  | 'invalid_text'
  | 'invalid_state'
  | 'limit_exceeded'
  | 'duplicate_operation'
  | 'curation_target_not_found'
  | 'curation_not_eligible'
  | 'stale_curation_revision'
  | 'fragment_not_found'
  | 'fragment_out_of_scope'
  | 'item_not_found'
  | 'relation_not_found'
  | 'revision_not_found'
  | 'stale_revision'
  | 'invalid_provenance'
  | 'invalid_relation'
  | 'idempotency_conflict'
  | 'persistence_failed';

export type KnowledgeBudgetName =
  | 'change_set_operations'
  | 'operation_provenance_inputs'
  | 'title_code_points'
  | 'relation_type_code_points'
  | 'body_code_points'
  | 'qualifier_code_points'
  | 'idempotency_key_characters'
  | 'revision_number';

export type KnowledgeIssuePath =
  | 'context'
  | 'context.effectiveWorkspaceId'
  | 'context.commandIdempotencyKey'
  | 'context.authority'
  | 'request'
  | 'request.authorization'
  | 'request.authorization.kind'
  | 'request.authorization.target'
  | 'request.authorization.target.kind'
  | 'request.authorization.target.snapshotId'
  | 'request.authorization.target.fragmentId'
  | 'request.authorization.expectedDecisionRevision'
  | 'request.operations'
  | `request.operations[${KnowledgeBoundedIndex}]`
  | `request.operations[${KnowledgeBoundedIndex}].kind`
  | `request.operations[${KnowledgeBoundedIndex}].itemId`
  | `request.operations[${KnowledgeBoundedIndex}].relationId`
  | `request.operations[${KnowledgeBoundedIndex}].expectedRevision`
  | `request.operations[${KnowledgeBoundedIndex}].value`
  | `request.operations[${KnowledgeBoundedIndex}].value.knowledgeKind`
  | `request.operations[${KnowledgeBoundedIndex}].value.epistemicRole`
  | `request.operations[${KnowledgeBoundedIndex}].value.reviewState`
  | `request.operations[${KnowledgeBoundedIndex}].value.title`
  | `request.operations[${KnowledgeBoundedIndex}].value.body`
  | `request.operations[${KnowledgeBoundedIndex}].value.subjectItemId`
  | `request.operations[${KnowledgeBoundedIndex}].value.relationTypeKey`
  | `request.operations[${KnowledgeBoundedIndex}].value.objectItemId`
  | `request.operations[${KnowledgeBoundedIndex}].value.qualifier`
  | `request.operations[${KnowledgeBoundedIndex}].provenance`
  | `request.operations[${KnowledgeBoundedIndex}].provenance.citations`
  | `request.operations[${KnowledgeBoundedIndex}].provenance.citations[${KnowledgeBoundedIndex}]`
  | `request.operations[${KnowledgeBoundedIndex}].provenance.fragmentDerivations`
  | `request.operations[${KnowledgeBoundedIndex}].provenance.fragmentDerivations[${KnowledgeBoundedIndex}]`
  | `request.operations[${KnowledgeBoundedIndex}].provenance.knowledgeDerivations`
  | `request.operations[${KnowledgeBoundedIndex}].provenance.knowledgeDerivations[${KnowledgeBoundedIndex}]`
  | `request.operations[${KnowledgeBoundedIndex}].provenance.knowledgeDerivations[${KnowledgeBoundedIndex}].kind`
  | `request.operations[${KnowledgeBoundedIndex}].provenance.knowledgeDerivations[${KnowledgeBoundedIndex}].itemId`
  | `request.operations[${KnowledgeBoundedIndex}].provenance.knowledgeDerivations[${KnowledgeBoundedIndex}].relationId`
  | `request.operations[${KnowledgeBoundedIndex}].provenance.knowledgeDerivations[${KnowledgeBoundedIndex}].revision`
  | 'state'
  | 'persistence';

export type KnowledgeIssue =
  | Readonly<{
      code: 'limit_exceeded';
      path: KnowledgeIssuePath;
      budget: KnowledgeBudgetName;
    }>
  | Readonly<{
      code: Exclude<KnowledgeIssueCode, 'limit_exceeded'>;
      path: KnowledgeIssuePath;
    }>;

export type KnowledgeCurationTargetState =
  | Readonly<{
      workspaceId: string;
      targetId: string;
      kind: 'snapshot';
      resourceId: string;
      snapshotId: string;
    }>
  | Readonly<{
      workspaceId: string;
      targetId: string;
      kind: 'fragment';
      fragmentId: string;
    }>;

export interface KnowledgeIntakeDecisionState {
  readonly workspaceId: string;
  readonly targetId: string;
  readonly decisionId: string;
  readonly currentRevision: number;
  readonly currentRevisionId: string;
  readonly action: IntakeAction;
}

export interface KnowledgeFragmentState {
  readonly workspaceId: string;
  readonly resourceId: string;
  readonly snapshotId: string;
  readonly fragmentId: string;
  readonly selectedTextSha256: string;
  readonly isPrivate?: true;
}

export interface KnowledgeItemState {
  readonly workspaceId: string;
  readonly itemId: string;
  readonly currentRevision: number;
  readonly currentRevisionId: string;
}

export interface KnowledgeRevisionState {
  readonly workspaceId: string;
  readonly itemId: string;
  readonly revision: number;
  readonly revisionId: string;
  readonly previousRevisionId?: string;
  readonly value: Readonly<KnowledgeItemRevisionValue>;
  readonly provenance: Readonly<KnowledgeProvenanceInput>;
  readonly isPrivate?: true;
}

export interface KnowledgeRelationState {
  readonly workspaceId: string;
  readonly relationId: string;
  readonly subjectItemId: string;
  readonly relationTypeKey: string;
  readonly objectItemId: string;
  readonly currentRevision: number;
  readonly currentRevisionId: string;
}

export interface KnowledgeRelationRevisionState {
  readonly workspaceId: string;
  readonly relationId: string;
  readonly revision: number;
  readonly revisionId: string;
  readonly previousRevisionId?: string;
  readonly value: Readonly<KnowledgeRelationRevisionValue>;
  readonly provenance: Readonly<KnowledgeProvenanceInput>;
  readonly isPrivate?: true;
}

export interface StoredKnowledgeChangeSetState {
  readonly workspaceId: string;
  readonly commandIdempotencyKey: string;
  readonly changeSetId: string;
  readonly requestSha256: string;
  readonly authorization: Readonly<KnowledgeAuthorizationReceipt>;
  readonly originalOutcome: KnowledgeOriginalOutcome;
  readonly operationCount: number;
}

export type StoredKnowledgeChangeOperationState =
  | (Readonly<{workspaceId: string; changeSetId: string}> &
      Extract<KnowledgeOperationReceipt, {operationKind: 'put_item'}>)
  | (Readonly<{workspaceId: string; changeSetId: string}> &
      Extract<KnowledgeOperationReceipt, {operationKind: 'put_relation'}>);

export interface KnowledgeChangeEventState {
  readonly workspaceId: string;
  readonly eventId: string;
  readonly eventKind: 'knowledge_change_set_committed';
  readonly eventSchemaVersion: 1;
  readonly changeSetId: string;
}

export interface ManualKnowledgeRepositorySnapshot {
  readonly curationTargets: readonly KnowledgeCurationTargetState[];
  readonly intakeDecisions: readonly KnowledgeIntakeDecisionState[];
  readonly fragments: readonly KnowledgeFragmentState[];
  readonly items: readonly KnowledgeItemState[];
  readonly revisions: readonly KnowledgeRevisionState[];
  readonly relations: readonly KnowledgeRelationState[];
  readonly relationRevisions: readonly KnowledgeRelationRevisionState[];
  readonly changeSets: readonly StoredKnowledgeChangeSetState[];
  readonly changeOperations: readonly StoredKnowledgeChangeOperationState[];
  readonly changeEvents: readonly KnowledgeChangeEventState[];
}

export interface KnowledgeChangeSetInsert extends StoredKnowledgeChangeSetState {
  readonly commandKind: 'apply_manual_knowledge_change_set';
  readonly authority: 'manual_user';
  readonly operationOrigin: 'manual_user';
}

export type KnowledgeItemIdentityInsert = KnowledgeItemState;

export interface KnowledgeRevisionInsert {
  readonly workspaceId: string;
  readonly itemId: string;
  readonly revision: number;
  readonly revisionId: string;
  readonly previousRevisionId?: string;
  readonly value: Readonly<KnowledgeItemRevisionValue>;
  readonly changeSetId: string;
  readonly operationIndex: KnowledgeBoundedIndex;
  readonly isPrivate?: true;
}

export type KnowledgeRelationIdentityInsert = KnowledgeRelationState;

export interface KnowledgeRelationRevisionInsert {
  readonly workspaceId: string;
  readonly relationId: string;
  readonly revision: number;
  readonly revisionId: string;
  readonly previousRevisionId?: string;
  readonly value: Readonly<KnowledgeRelationRevisionValue>;
  readonly changeSetId: string;
  readonly operationIndex: KnowledgeBoundedIndex;
  readonly isPrivate?: true;
}

export type KnowledgeRevisionFragmentInputKind = 'citation' | 'derivation';

export interface KnowledgeRevisionFragmentInputInsert {
  readonly workspaceId: string;
  readonly itemId: string;
  readonly revision: number;
  readonly revisionId: string;
  readonly inputKind: KnowledgeRevisionFragmentInputKind;
  readonly inputOrdinal: KnowledgeBoundedIndex;
  readonly fragmentId: string;
}

export interface KnowledgeRevisionItemInputInsert {
  readonly workspaceId: string;
  readonly itemId: string;
  readonly revision: number;
  readonly revisionId: string;
  readonly inputOrdinal: KnowledgeBoundedIndex;
  readonly inputItemId: string;
  readonly inputRevision: number;
  readonly inputRevisionId: string;
}

export interface KnowledgeRevisionRelationInputInsert {
  readonly workspaceId: string;
  readonly itemId: string;
  readonly revision: number;
  readonly revisionId: string;
  readonly inputOrdinal: KnowledgeBoundedIndex;
  readonly inputRelationId: string;
  readonly inputRevision: number;
  readonly inputRevisionId: string;
}

export interface RelationRevisionFragmentInputInsert {
  readonly workspaceId: string;
  readonly relationId: string;
  readonly revision: number;
  readonly revisionId: string;
  readonly inputKind: KnowledgeRevisionFragmentInputKind;
  readonly inputOrdinal: KnowledgeBoundedIndex;
  readonly fragmentId: string;
}

export interface RelationRevisionItemInputInsert {
  readonly workspaceId: string;
  readonly relationId: string;
  readonly revision: number;
  readonly revisionId: string;
  readonly inputOrdinal: KnowledgeBoundedIndex;
  readonly inputItemId: string;
  readonly inputRevision: number;
  readonly inputRevisionId: string;
}

export interface RelationRevisionRelationInputInsert {
  readonly workspaceId: string;
  readonly relationId: string;
  readonly revision: number;
  readonly revisionId: string;
  readonly inputOrdinal: KnowledgeBoundedIndex;
  readonly inputRelationId: string;
  readonly inputRevision: number;
  readonly inputRevisionId: string;
}

export interface KnowledgeCurrentPointerCas {
  readonly workspaceId: string;
  readonly stableId: string;
  readonly expectedRevision: number;
  readonly nextRevision: number;
  readonly nextRevisionId: string;
}

export interface PreparedManualKnowledgePlan {
  readonly commandKind: 'apply_manual_knowledge_change_set';
  readonly requestSha256: string;
  readonly outcome: KnowledgeOriginalOutcome;
  readonly receipt: ManualKnowledgeReceipt;
  readonly workspaceLockId: string;
  readonly changeSetInsert: KnowledgeChangeSetInsert;
  readonly changeOperationInserts: readonly StoredKnowledgeChangeOperationState[];
  readonly itemIdentityInserts: readonly KnowledgeItemIdentityInsert[];
  readonly itemRevisionInserts: readonly KnowledgeRevisionInsert[];
  readonly relationIdentityInserts: readonly KnowledgeRelationIdentityInsert[];
  readonly relationRevisionInserts: readonly KnowledgeRelationRevisionInsert[];
  readonly knowledgeRevisionFragmentInputs: readonly KnowledgeRevisionFragmentInputInsert[];
  readonly knowledgeRevisionItemInputs: readonly KnowledgeRevisionItemInputInsert[];
  readonly knowledgeRevisionRelationInputs: readonly KnowledgeRevisionRelationInputInsert[];
  readonly relationRevisionFragmentInputs: readonly RelationRevisionFragmentInputInsert[];
  readonly relationRevisionItemInputs: readonly RelationRevisionItemInputInsert[];
  readonly relationRevisionRelationInputs: readonly RelationRevisionRelationInputInsert[];
  readonly itemCurrentPointerCases: readonly KnowledgeCurrentPointerCas[];
  readonly relationCurrentPointerCases: readonly KnowledgeCurrentPointerCas[];
  readonly eventInsert: KnowledgeChangeEventState;
}

export type ManualKnowledgePreparation =
  | Readonly<{kind: 'prepared'; plan: PreparedManualKnowledgePlan}>
  | Readonly<{
      kind: 'resolved';
      result: ApplyManualKnowledgeChangeSetResult;
    }>;

export interface LockedManualKnowledgeSnapshotQuery {
  readonly workspaceId: string;
  readonly commandIdempotencyKey: string;
  readonly authorization: ManualKnowledgeAuthorization;
  readonly primaryItemIds: readonly string[];
  readonly primaryRelationIds: readonly string[];
  readonly endpointItemIds: readonly string[];
  readonly fragmentIds: readonly string[];
  readonly historicalItemRevisions: readonly Readonly<{
    itemId: string;
    revision: number;
  }>[];
  readonly historicalRelationRevisions: readonly Readonly<{
    relationId: string;
    revision: number;
  }>[];
}
