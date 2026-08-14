import {
  decodeApplyManualKnowledgeChangeSetRequest,
  decodeManualKnowledgeContext,
  deepFreeze,
  defineOwnedRecord,
  KnowledgeInputFault,
} from './closed_manual_knowledge_input.js';
import {
  type ApplyManualKnowledgeChangeSetRequest,
  type ApplyManualKnowledgeChangeSetResult,
  type KnowledgeChangeEventState,
  type KnowledgeChangeSetInsert,
  type KnowledgeCurrentPointerCas,
  type KnowledgeItemIdentityInsert,
  type KnowledgeRelationIdentityInsert,
  type KnowledgeRelationRevisionInsert,
  type KnowledgeRevisionInsert,
  type KnowledgeRevisionFragmentInputInsert,
  type KnowledgeRevisionItemInputInsert,
  type KnowledgeRevisionRelationInputInsert,
  type LockedManualKnowledgeSnapshotQuery,
  type PreparedManualKnowledgePlan,
  type RelationRevisionFragmentInputInsert,
  type RelationRevisionItemInputInsert,
  type RelationRevisionRelationInputInsert,
  type StoredKnowledgeChangeOperationState,
} from './manual_knowledge_contract.js';
import {
  mapKnowledgePersistenceFailure,
  prepareApplyManualKnowledgeChangeSet,
  resultForCommittedManualKnowledgePlan,
} from './manual_knowledge.js';

/**
 * One atomic command transaction. The adapter owns database-specific locking,
 * but it cannot expose generic SQL, cross-workspace lookup, or history updates.
 */
export interface ManualKnowledgeRepositoryPort {
  runCommandTransaction<Value>(
    work: (transaction: ManualKnowledgeTransactionPort) => Promise<Value>,
  ): Promise<Value>;
}

export interface ManualKnowledgeTransactionPort {
  lockAndLoadManualKnowledgeSnapshot(
    query: LockedManualKnowledgeSnapshotQuery,
  ): Promise<unknown>;

  insertKnowledgeChangeSet(row: KnowledgeChangeSetInsert): Promise<void>;
  insertKnowledgeChangeOperation(
    row: StoredKnowledgeChangeOperationState,
  ): Promise<void>;

  insertKnowledgeItem(row: KnowledgeItemIdentityInsert): Promise<void>;
  insertKnowledgeRevision(row: KnowledgeRevisionInsert): Promise<void>;
  compareAndSetKnowledgeItemCurrent(
    change: KnowledgeCurrentPointerCas,
  ): Promise<void>;

  insertKnowledgeRelation(row: KnowledgeRelationIdentityInsert): Promise<void>;
  insertKnowledgeRelationRevision(
    row: KnowledgeRelationRevisionInsert,
  ): Promise<void>;
  compareAndSetKnowledgeRelationCurrent(
    change: KnowledgeCurrentPointerCas,
  ): Promise<void>;

  insertKnowledgeRevisionFragmentInput(
    row: KnowledgeRevisionFragmentInputInsert,
  ): Promise<void>;
  insertKnowledgeRevisionItemInput(
    row: KnowledgeRevisionItemInputInsert,
  ): Promise<void>;
  insertKnowledgeRevisionRelationInput(
    row: KnowledgeRevisionRelationInputInsert,
  ): Promise<void>;
  insertRelationRevisionFragmentInput(
    row: RelationRevisionFragmentInputInsert,
  ): Promise<void>;
  insertRelationRevisionItemInput(
    row: RelationRevisionItemInputInsert,
  ): Promise<void>;
  insertRelationRevisionRelationInput(
    row: RelationRevisionRelationInputInsert,
  ): Promise<void>;

  insertKnowledgeChangeEvent(row: KnowledgeChangeEventState): Promise<void>;
}

export async function executeApplyManualKnowledgeChangeSet(
  repository: ManualKnowledgeRepositoryPort,
  contextInput: unknown,
  requestInput: unknown,
): Promise<ApplyManualKnowledgeChangeSetResult> {
  let context;
  let request;
  try {
    context = decodeManualKnowledgeContext(contextInput);
    request = decodeApplyManualKnowledgeChangeSetRequest(requestInput);
  } catch (error) {
    return inputFailure(error);
  }
  const query = createSnapshotQuery(
    context.effectiveWorkspaceId,
    context.commandIdempotencyKey,
    request,
  );
  try {
    return await repository.runCommandTransaction(async (transaction) => {
      const state = await transaction.lockAndLoadManualKnowledgeSnapshot(query);
      const preparation = prepareApplyManualKnowledgeChangeSet(
        context,
        request,
        state,
      );
      if (preparation.kind === 'resolved') {
        return preparation.result;
      }
      await persistPlanInTransaction(transaction, preparation.plan);
      return resultForCommittedManualKnowledgePlan(preparation.plan);
    });
  } catch {
    return mapKnowledgePersistenceFailure();
  }
}

function createSnapshotQuery(
  workspaceId: string,
  commandIdempotencyKey: string,
  request: ApplyManualKnowledgeChangeSetRequest,
): LockedManualKnowledgeSnapshotQuery {
  const primaryItemIds: string[] = [];
  const primaryRelationIds: string[] = [];
  const endpointItemIds: string[] = [];
  const fragmentIds: string[] = [];
  const historicalItemRevisions: {
    itemId: string;
    revision: number;
  }[] = [];
  const historicalRelationRevisions: {
    relationId: string;
    revision: number;
  }[] = [];
  for (const operation of request.operations) {
    if (operation.kind === 'put_item') {
      primaryItemIds.push(operation.itemId);
    } else {
      primaryRelationIds.push(operation.relationId);
      endpointItemIds.push(
        operation.value.subjectItemId,
        operation.value.objectItemId,
      );
    }
    fragmentIds.push(
      ...operation.provenance.citations,
      ...operation.provenance.fragmentDerivations,
    );
    for (const derivation of operation.provenance.knowledgeDerivations) {
      if (derivation.kind === 'item') {
        historicalItemRevisions.push({
          itemId: derivation.itemId,
          revision: derivation.revision,
        });
      } else {
        historicalRelationRevisions.push({
          relationId: derivation.relationId,
          revision: derivation.revision,
        });
      }
    }
  }
  return deepFreeze(
    defineOwnedRecord({
      workspaceId,
      commandIdempotencyKey,
      authorization: request.authorization,
      primaryItemIds: uniqueSorted(primaryItemIds),
      primaryRelationIds: uniqueSorted(primaryRelationIds),
      endpointItemIds: uniqueSorted(endpointItemIds),
      fragmentIds: uniqueSorted(fragmentIds),
      historicalItemRevisions: uniqueSortedRevisions(
        historicalItemRevisions,
        'itemId',
      ),
      historicalRelationRevisions: uniqueSortedRevisions(
        historicalRelationRevisions,
        'relationId',
      ),
    }),
  );
}

async function persistPlanInTransaction(
  transaction: ManualKnowledgeTransactionPort,
  plan: PreparedManualKnowledgePlan,
): Promise<void> {
  await transaction.insertKnowledgeChangeSet(plan.changeSetInsert);
  for (const row of plan.itemIdentityInserts) {
    await transaction.insertKnowledgeItem(row);
  }
  for (const row of plan.relationIdentityInserts) {
    await transaction.insertKnowledgeRelation(row);
  }
  for (const row of plan.changeOperationInserts) {
    await transaction.insertKnowledgeChangeOperation(row);
  }
  for (const row of plan.itemRevisionInserts) {
    await transaction.insertKnowledgeRevision(row);
  }
  for (const row of plan.relationRevisionInserts) {
    await transaction.insertKnowledgeRelationRevision(row);
  }
  for (const row of plan.knowledgeRevisionFragmentInputs) {
    await transaction.insertKnowledgeRevisionFragmentInput(row);
  }
  for (const row of plan.knowledgeRevisionItemInputs) {
    await transaction.insertKnowledgeRevisionItemInput(row);
  }
  for (const row of plan.knowledgeRevisionRelationInputs) {
    await transaction.insertKnowledgeRevisionRelationInput(row);
  }
  for (const row of plan.relationRevisionFragmentInputs) {
    await transaction.insertRelationRevisionFragmentInput(row);
  }
  for (const row of plan.relationRevisionItemInputs) {
    await transaction.insertRelationRevisionItemInput(row);
  }
  for (const row of plan.relationRevisionRelationInputs) {
    await transaction.insertRelationRevisionRelationInput(row);
  }
  for (const change of plan.itemCurrentPointerCases) {
    await transaction.compareAndSetKnowledgeItemCurrent(change);
  }
  for (const change of plan.relationCurrentPointerCases) {
    await transaction.compareAndSetKnowledgeRelationCurrent(change);
  }
  await transaction.insertKnowledgeChangeEvent(plan.eventInsert);
}

function uniqueSorted(values: readonly string[]): readonly string[] {
  return [...new Set(values)].sort(compareText);
}

function uniqueSortedRevisions<
  Key extends 'itemId' | 'relationId',
  Row extends Readonly<Record<Key, string>> & Readonly<{revision: number}>,
>(rows: readonly Row[], key: Key): readonly Row[] {
  const byIdentity = new Map<string, Row>();
  for (const row of rows) {
    byIdentity.set(`${row[key]}:${String(row.revision)}`, row);
  }
  return [...byIdentity.values()].sort((left, right) => {
    const text = compareText(left[key], right[key]);
    return text === 0 ? left.revision - right.revision : text;
  });
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function inputFailure(error: unknown): ApplyManualKnowledgeChangeSetResult {
  if (!(error instanceof KnowledgeInputFault)) {
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
    throw new Error(
      'A manual knowledge budget fault omitted its budget token.',
    );
  }
  return deepFreeze({
    status: 'rejected',
    issue: {code: error.code, path: error.path},
  });
}
