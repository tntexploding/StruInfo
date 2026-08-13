import type {
  ApplyManualCurationRequest,
  ApplyManualCurationResult,
  AssessmentIdentityInsert,
  AssessmentRevisionInsert,
  ClassificationAssignmentIdentityInsert,
  ClassificationAssignmentRevisionInsert,
  CurationCommandInsert,
  CurationTargetInsert,
  CurationRejectedResult,
  CurrentPointerCas,
  IntakeDecisionIdentityInsert,
  IntakeDecisionReasonInsert,
  IntakeDecisionRevisionInsert,
  PreparedManualCurationPlan,
  PutContentClassificationTermRequest,
  PutContentClassificationTermResult,
  LockedTargetCommandSnapshotQuery,
  LockedTermCommandSnapshotQuery,
  TargetVersionCas,
  VocabularyTermIdentityInsert,
  VocabularyTermRevisionInsert,
} from './manual_curation_contract.js';
import {
  CurationInputFault,
  decodeApplyManualCurationRequest,
  decodeManualCurationContext,
  decodePutContentClassificationTermRequest,
  deepFreeze,
} from './closed_manual_curation_input.js';
import {
  mapCurationPersistenceFailure,
  prepareApplyManualCuration,
  preparePutContentClassificationTerm,
  resultForCommittedTargetPlan,
  resultForCommittedTermPlan,
} from './manual_curation.js';

/**
 * Atomic adapter boundary for one already-validated command plan.
 *
 * History rows expose inserts only. The two compare-and-set methods are limited
 * to mutable identity-row current pointers; no history update/delete surface is
 * available. A future PostgreSQL adapter must execute the callback in one
 * transaction after its command/workspace/target/term lock-and-lookup phase.
 */
export interface ManualCurationRepositoryPort {
  runCommandTransaction<Value>(
    work: (transaction: ManualCurationTransactionPort) => Promise<Value>,
  ): Promise<Value>;
}

export interface ManualCurationTransactionPort {
  /** Locks the workspace hierarchy, then returns the closed term-command view. */
  lockAndLoadTermCommandSnapshot(
    query: LockedTermCommandSnapshotQuery,
  ): Promise<unknown>;

  /** Locks target and canonical-sorted term identities before loading state. */
  lockAndLoadTargetCommandSnapshot(
    query: LockedTargetCommandSnapshotQuery,
  ): Promise<unknown>;

  insertCurationTarget(row: CurationTargetInsert): Promise<void>;
  compareAndSetTargetVersion(change: TargetVersionCas): Promise<void>;

  insertVocabularyTerm(row: VocabularyTermIdentityInsert): Promise<void>;
  insertVocabularyTermRevision(
    row: VocabularyTermRevisionInsert,
  ): Promise<void>;
  compareAndSetVocabularyTermCurrent(change: CurrentPointerCas): Promise<void>;

  insertClassificationAssignment(
    row: ClassificationAssignmentIdentityInsert,
  ): Promise<void>;
  insertClassificationAssignmentRevision(
    row: ClassificationAssignmentRevisionInsert,
  ): Promise<void>;
  compareAndSetClassificationAssignmentCurrent(
    change: CurrentPointerCas,
  ): Promise<void>;

  insertIntakeDecision(row: IntakeDecisionIdentityInsert): Promise<void>;
  insertIntakeDecisionRevision(
    row: IntakeDecisionRevisionInsert,
  ): Promise<void>;
  insertIntakeDecisionReason(row: IntakeDecisionReasonInsert): Promise<void>;
  compareAndSetIntakeDecisionCurrent(change: CurrentPointerCas): Promise<void>;

  insertAssessment(row: AssessmentIdentityInsert): Promise<void>;
  insertAssessmentRevision(row: AssessmentRevisionInsert): Promise<void>;
  compareAndSetAssessmentCurrent(change: CurrentPointerCas): Promise<void>;

  insertCurationCommand(row: CurationCommandInsert): Promise<void>;
}

export async function executePutContentClassificationTerm(
  repository: ManualCurationRepositoryPort,
  contextInput: unknown,
  requestInput: unknown,
): Promise<PutContentClassificationTermResult> {
  let context;
  let request: PutContentClassificationTermRequest;
  try {
    context = decodeManualCurationContext(contextInput);
    request = decodePutContentClassificationTermRequest(requestInput);
  } catch (error) {
    return inputFailure(error);
  }
  try {
    return await repository.runCommandTransaction(async (transaction) => {
      const state = await transaction.lockAndLoadTermCommandSnapshot(
        deepFreeze({
          workspaceId: context.effectiveWorkspaceId,
          commandIdempotencyKey: context.commandIdempotencyKey,
          termId: request.termId,
          ...(request.value.parentTermId === undefined
            ? {}
            : {parentTermId: request.value.parentTermId}),
        }),
      );
      const preparation = preparePutContentClassificationTerm(
        context,
        request,
        state,
      );
      if (preparation.kind === 'resolved') {
        return preparation.result;
      }
      await persistPlanInTransaction(transaction, preparation.plan);
      return resultForCommittedTermPlan(preparation.plan);
    });
  } catch {
    return mapCurationPersistenceFailure();
  }
}

export async function executeApplyManualCuration(
  repository: ManualCurationRepositoryPort,
  contextInput: unknown,
  requestInput: unknown,
): Promise<ApplyManualCurationResult> {
  let context;
  let request: ApplyManualCurationRequest;
  try {
    context = decodeManualCurationContext(contextInput);
    request = decodeApplyManualCurationRequest(requestInput);
  } catch (error) {
    return inputFailure(error);
  }
  const referencedTermIds = request.operations
    .flatMap((operation) =>
      operation.kind === 'assign_classification' ||
      operation.kind === 'remove_classification'
        ? [operation.termId]
        : [],
    )
    .sort(compareProtocolText);
  try {
    return await repository.runCommandTransaction(async (transaction) => {
      const state = await transaction.lockAndLoadTargetCommandSnapshot(
        deepFreeze({
          workspaceId: context.effectiveWorkspaceId,
          commandIdempotencyKey: context.commandIdempotencyKey,
          target: request.target,
          referencedTermIds,
        }),
      );
      const preparation = prepareApplyManualCuration(context, request, state);
      if (preparation.kind === 'resolved') {
        return preparation.result;
      }
      await persistPlanInTransaction(transaction, preparation.plan);
      return resultForCommittedTargetPlan(preparation.plan);
    });
  } catch {
    return mapCurationPersistenceFailure();
  }
}

async function persistPlanInTransaction(
  transaction: ManualCurationTransactionPort,
  plan: PreparedManualCurationPlan,
): Promise<void> {
  if (plan.commandKind === 'put_content_classification_term') {
    if (plan.termIdentityInsert !== undefined) {
      await transaction.insertVocabularyTerm(plan.termIdentityInsert);
    }
    if (plan.termRevisionInsert !== undefined) {
      await transaction.insertVocabularyTermRevision(plan.termRevisionInsert);
    }
    if (plan.termCurrentPointerCas !== undefined) {
      await transaction.compareAndSetVocabularyTermCurrent(
        plan.termCurrentPointerCas,
      );
    }
    await transaction.insertCurationCommand(plan.commandInsert);
    return;
  }

  if (plan.targetInsert !== undefined) {
    await transaction.insertCurationTarget(plan.targetInsert);
  }
  for (const change of plan.classificationChanges) {
    if (change.identityInsert !== undefined) {
      await transaction.insertClassificationAssignment(change.identityInsert);
    }
    await transaction.insertClassificationAssignmentRevision(
      change.revisionInsert,
    );
    if (change.currentPointerCas !== undefined) {
      await transaction.compareAndSetClassificationAssignmentCurrent(
        change.currentPointerCas,
      );
    }
  }
  if (plan.decisionChange !== undefined) {
    if (plan.decisionChange.identityInsert !== undefined) {
      await transaction.insertIntakeDecision(
        plan.decisionChange.identityInsert,
      );
    }
    await transaction.insertIntakeDecisionRevision(
      plan.decisionChange.revisionInsert,
    );
    for (const reason of plan.decisionChange.reasonInserts) {
      await transaction.insertIntakeDecisionReason(reason);
    }
    if (plan.decisionChange.currentPointerCas !== undefined) {
      await transaction.compareAndSetIntakeDecisionCurrent(
        plan.decisionChange.currentPointerCas,
      );
    }
  }
  for (const change of plan.assessmentChanges) {
    if (change.identityInsert !== undefined) {
      await transaction.insertAssessment(change.identityInsert);
    }
    await transaction.insertAssessmentRevision(change.revisionInsert);
    if (change.currentPointerCas !== undefined) {
      await transaction.compareAndSetAssessmentCurrent(
        change.currentPointerCas,
      );
    }
  }
  if (plan.targetVersionCas !== undefined) {
    await transaction.compareAndSetTargetVersion(plan.targetVersionCas);
  }
  await transaction.insertCurationCommand(plan.commandInsert);
}

function inputFailure(error: unknown): CurationRejectedResult {
  if (!(error instanceof CurationInputFault)) {
    throw error;
  }
  if (error.budget !== undefined) {
    return deepFreeze({
      status: 'rejected',
      issue: {
        code: 'limit_exceeded',
        path: error.path,
        budget: error.budget,
      },
    });
  }
  if (error.code === 'limit_exceeded') {
    throw new Error('A curation budget fault omitted its budget token.');
  }
  return deepFreeze({
    status: 'rejected',
    issue: {code: error.code, path: error.path},
  });
}

function compareProtocolText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
