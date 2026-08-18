import {createHash} from 'node:crypto';

import {
  deriveCurationTargetId,
  deriveIntakeDecisionId,
  deriveIntakeDecisionRevisionId,
} from '../curation/manual_curation_identity.js';
import {
  decodeApplyManualKnowledgeChangeSetRequest,
  decodeManualKnowledgeContext,
  decodeManualKnowledgeRepositorySnapshot,
  deepFreeze,
  defineOwnedRecord,
  KnowledgeInputFault,
} from './closed_manual_knowledge_input.js';
import {
  type ApplyManualKnowledgeChangeSetRequest,
  type ApplyManualKnowledgeChangeSetResult,
  type FormalKnowledgeRevisionRef,
  type KnowledgeAuthorizationReceipt,
  type KnowledgeBoundedIndex,
  type KnowledgeBudgetName,
  type KnowledgeCurationTargetState,
  type KnowledgeFragmentState,
  type KnowledgeIssue,
  type KnowledgeIssueCode,
  type KnowledgeIssuePath,
  type KnowledgeItemState,
  type KnowledgeItemIdentityInsert,
  KNOWLEDGE_LIMITS,
  type KnowledgeOperationReceipt,
  type KnowledgeProvenanceInput,
  type KnowledgeRelationIdentityInsert,
  type KnowledgeRelationRevisionInsert,
  type KnowledgeRelationState,
  type KnowledgeRevisionFragmentInputInsert,
  type KnowledgeRevisionInsert,
  type KnowledgeRevisionItemInputInsert,
  type KnowledgeRevisionRelationInputInsert,
  type KnowledgeRevisionState,
  type KnowledgeRelationRevisionState,
  type ManualKnowledgeContext,
  type ManualKnowledgeOperation,
  type ManualKnowledgePreparation,
  type ManualKnowledgeReceipt,
  type ManualKnowledgeRepositorySnapshot,
  type PreparedManualKnowledgePlan,
  type RelationRevisionFragmentInputInsert,
  type RelationRevisionItemInputInsert,
  type RelationRevisionRelationInputInsert,
  type StoredKnowledgeChangeOperationState,
  type StoredKnowledgeChangeSetState,
} from './manual_knowledge_contract.js';
import {
  deriveKnowledgeChangeSetId,
  deriveKnowledgeCommittedEventId,
  deriveKnowledgeItemRevisionId,
  deriveKnowledgeRelationRevisionId,
  digestManualKnowledgeCommandProjection,
} from './manual_knowledge_identity.js';

interface ResolvedOperation {
  readonly operation: ManualKnowledgeOperation;
  readonly operationIndex: KnowledgeBoundedIndex;
  readonly currentItem?: KnowledgeItemState;
  readonly currentRevision?: KnowledgeRevisionState;
  readonly currentRelation?: KnowledgeRelationState;
  readonly currentRelationRevision?: KnowledgeRelationRevisionState;
  readonly outcome?: 'applied' | 'unchanged';
  readonly resultingRevision?: number;
  readonly resultingRevisionId?: string;
  readonly isPrivate?: boolean;
}

type CompletedOperation = ResolvedOperation &
  Required<
    Pick<
      ResolvedOperation,
      'outcome' | 'resultingRevision' | 'resultingRevisionId' | 'isPrivate'
    >
  >;

interface ResolutionMaps {
  readonly fragments: ReadonlyMap<string, KnowledgeFragmentState>;
  readonly items: ReadonlyMap<string, KnowledgeItemState>;
  readonly revisions: ReadonlyMap<string, KnowledgeRevisionState>;
  readonly relations: ReadonlyMap<string, KnowledgeRelationState>;
  readonly relationRevisions: ReadonlyMap<
    string,
    KnowledgeRelationRevisionState
  >;
}

export function prepareApplyManualKnowledgeChangeSet(
  contextInput: unknown,
  requestInput: unknown,
  repositorySnapshotInput: unknown,
): ManualKnowledgePreparation {
  try {
    const context = decodeManualKnowledgeContext(contextInput);
    const request = decodeApplyManualKnowledgeChangeSetRequest(requestInput);
    const requestSha256 = digestManualKnowledgeCommandProjection(
      context,
      request,
    );
    const state = decodeManualKnowledgeRepositorySnapshot(
      repositorySnapshotInput,
    );
    validateRepositorySnapshot(context, request, state);
    const replay = reconcileStoredCommand(
      context,
      request,
      requestSha256,
      state,
    );
    if (replay !== undefined) {
      return deepFreeze({kind: 'resolved', result: replay});
    }
    return deepFreeze({
      kind: 'prepared',
      plan: planNewCommand(context, request, requestSha256, state),
    });
  } catch (error) {
    return deepFreeze({kind: 'resolved', result: rejectedFromError(error)});
  }
}

export function resultForCommittedManualKnowledgePlan(
  plan: PreparedManualKnowledgePlan,
): ApplyManualKnowledgeChangeSetResult {
  const receipt = copyReceipt(plan.receipt);
  return plan.outcome === 'applied'
    ? deepFreeze({
        status: 'applied',
        receipt: receipt as ManualKnowledgeReceipt<'applied'>,
      })
    : deepFreeze({
        status: 'unchanged',
        receipt: receipt as ManualKnowledgeReceipt<'unchanged'>,
      });
}

export function mapKnowledgePersistenceFailure(): ApplyManualKnowledgeChangeSetResult {
  return deepFreeze({
    status: 'rejected',
    issue: {code: 'persistence_failed', path: 'persistence'},
  });
}

function planNewCommand(
  context: ManualKnowledgeContext,
  request: ApplyManualKnowledgeChangeSetRequest,
  requestSha256: string,
  state: ManualKnowledgeRepositorySnapshot,
): PreparedManualKnowledgePlan {
  const authorization = resolveAuthorization(context, request, state);
  const maps = createResolutionMaps(state);
  const resolved = resolvePrimaryOperations(request, maps);
  resolveFragmentInputs(context, request, state, maps);
  resolveHistoricalInputs(request, maps);
  resolveRelationEndpoints(request, maps);
  validateOperationSemantics(context, request, state, maps, resolved);
  const completed = calculateOperationOutcomes(resolved, maps);
  return createPlan(
    context,
    request,
    requestSha256,
    authorization,
    maps,
    completed,
  );
}

function resolveAuthorization(
  context: ManualKnowledgeContext,
  request: ApplyManualKnowledgeChangeSetRequest,
  state: ManualKnowledgeRepositorySnapshot,
): KnowledgeAuthorizationReceipt {
  if (request.authorization.kind === 'manual_edit') {
    return defineOwnedRecord({kind: 'manual_edit'});
  }
  const target = state.curationTargets[0];
  if (target === undefined) {
    throw domainFault(
      'curation_target_not_found',
      'request.authorization.target',
    );
  }
  const decision = state.intakeDecisions[0];
  if (decision === undefined) {
    throw domainFault('curation_not_eligible', 'request.authorization');
  }
  if (
    decision.currentRevision !== request.authorization.expectedDecisionRevision
  ) {
    throw domainFault(
      'stale_curation_revision',
      'request.authorization.expectedDecisionRevision',
    );
  }
  if (
    decision.action !== 'full' &&
    decision.action !== 'split' &&
    decision.action !== 'condense'
  ) {
    throw domainFault('curation_not_eligible', 'request.authorization');
  }
  if (target.workspaceId !== context.effectiveWorkspaceId) {
    throw stateFault();
  }
  return defineOwnedRecord({
    kind: 'eligible_target',
    targetId: target.targetId,
    decisionId: decision.decisionId,
    decisionRevision: decision.currentRevision,
    decisionRevisionId: decision.currentRevisionId,
  });
}

function resolvePrimaryOperations(
  request: ApplyManualKnowledgeChangeSetRequest,
  maps: ResolutionMaps,
): readonly ResolvedOperation[] {
  return request.operations.map((operation, index) => {
    const operationIndex = index as KnowledgeBoundedIndex;
    const path = operationPath(index);
    if (operation.kind === 'put_item') {
      const currentItem = maps.items.get(operation.itemId);
      if (currentItem === undefined) {
        if (operation.expectedRevision > 0) {
          throw domainFault(
            'item_not_found',
            `${path}.itemId` as KnowledgeIssuePath,
          );
        }
        if (
          operation.value.reviewState === 'rejected' ||
          operation.value.reviewState === 'withdrawn'
        ) {
          throw domainFault(
            'invalid_state',
            `${path}.value.reviewState` as KnowledgeIssuePath,
          );
        }
        return {operation, operationIndex};
      }
      if (operation.expectedRevision !== currentItem.currentRevision) {
        throw domainFault(
          'stale_revision',
          `${path}.expectedRevision` as KnowledgeIssuePath,
        );
      }
      const currentRevision = maps.revisions.get(
        revisionKey(operation.itemId, currentItem.currentRevision),
      );
      if (currentRevision === undefined) {
        throw stateFault();
      }
      return {operation, operationIndex, currentItem, currentRevision};
    }

    const currentRelation = maps.relations.get(operation.relationId);
    if (currentRelation === undefined) {
      if (operation.expectedRevision > 0) {
        throw domainFault(
          'relation_not_found',
          `${path}.relationId` as KnowledgeIssuePath,
        );
      }
      if (
        operation.value.reviewState === 'rejected' ||
        operation.value.reviewState === 'withdrawn'
      ) {
        throw domainFault(
          'invalid_state',
          `${path}.value.reviewState` as KnowledgeIssuePath,
        );
      }
      return {operation, operationIndex};
    }
    if (operation.expectedRevision !== currentRelation.currentRevision) {
      throw domainFault(
        'stale_revision',
        `${path}.expectedRevision` as KnowledgeIssuePath,
      );
    }
    const currentRelationRevision = maps.relationRevisions.get(
      revisionKey(operation.relationId, currentRelation.currentRevision),
    );
    if (currentRelationRevision === undefined) {
      throw stateFault();
    }
    return {
      operation,
      operationIndex,
      currentRelation,
      currentRelationRevision,
    };
  });
}

function resolveFragmentInputs(
  context: ManualKnowledgeContext,
  request: ApplyManualKnowledgeChangeSetRequest,
  state: ManualKnowledgeRepositorySnapshot,
  maps: ResolutionMaps,
): void {
  const target = state.curationTargets[0];
  for (
    let operationIndex = 0;
    operationIndex < request.operations.length;
    operationIndex += 1
  ) {
    const operation = request.operations[operationIndex];
    if (operation === undefined) {
      throw stateFault();
    }
    for (
      let index = 0;
      index < operation.provenance.citations.length;
      index += 1
    ) {
      resolveOneFragment(
        context,
        request,
        target,
        maps,
        operation.provenance.citations[index],
        `request.operations[${String(operationIndex)}].provenance.citations[${String(index)}]` as KnowledgeIssuePath,
      );
    }
    for (
      let index = 0;
      index < operation.provenance.fragmentDerivations.length;
      index += 1
    ) {
      resolveOneFragment(
        context,
        request,
        target,
        maps,
        operation.provenance.fragmentDerivations[index],
        `request.operations[${String(operationIndex)}].provenance.fragmentDerivations[${String(index)}]` as KnowledgeIssuePath,
      );
    }
  }
}

function resolveOneFragment(
  context: ManualKnowledgeContext,
  request: ApplyManualKnowledgeChangeSetRequest,
  target: KnowledgeCurationTargetState | undefined,
  maps: ResolutionMaps,
  fragmentId: string | undefined,
  path: KnowledgeIssuePath,
): void {
  if (fragmentId === undefined) {
    throw stateFault();
  }
  const fragment = maps.fragments.get(fragmentId);
  if (fragment === undefined) {
    throw domainFault('fragment_not_found', path);
  }
  if (fragment.workspaceId !== context.effectiveWorkspaceId) {
    throw stateFault();
  }
  if (
    request.authorization.kind === 'eligible_target' &&
    (target === undefined || !fragmentIsWithinTarget(fragment, target))
  ) {
    throw domainFault('fragment_out_of_scope', path);
  }
}

function resolveHistoricalInputs(
  request: ApplyManualKnowledgeChangeSetRequest,
  maps: ResolutionMaps,
): void {
  for (
    let operationIndex = 0;
    operationIndex < request.operations.length;
    operationIndex += 1
  ) {
    const operation = request.operations[operationIndex];
    if (operation === undefined) {
      throw stateFault();
    }
    for (
      let index = 0;
      index < operation.provenance.knowledgeDerivations.length;
      index += 1
    ) {
      const derivation = operation.provenance.knowledgeDerivations[index];
      if (derivation === undefined) {
        throw stateFault();
      }
      const found =
        derivation.kind === 'item'
          ? maps.revisions.has(
              revisionKey(derivation.itemId, derivation.revision),
            )
          : maps.relationRevisions.has(
              revisionKey(derivation.relationId, derivation.revision),
            );
      if (!found) {
        throw domainFault(
          'revision_not_found',
          `request.operations[${String(operationIndex)}].provenance.knowledgeDerivations[${String(index)}]` as KnowledgeIssuePath,
        );
      }
    }
  }
}

function resolveRelationEndpoints(
  request: ApplyManualKnowledgeChangeSetRequest,
  maps: ResolutionMaps,
): void {
  const commandItems = new Set(
    request.operations.flatMap((operation) =>
      operation.kind === 'put_item' ? [operation.itemId] : [],
    ),
  );
  for (let index = 0; index < request.operations.length; index += 1) {
    const operation = request.operations[index];
    if (operation?.kind !== 'put_relation') {
      continue;
    }
    const path = operationPath(index);
    if (
      !maps.items.has(operation.value.subjectItemId) &&
      !commandItems.has(operation.value.subjectItemId)
    ) {
      throw domainFault(
        'item_not_found',
        `${path}.value.subjectItemId` as KnowledgeIssuePath,
      );
    }
    if (
      !maps.items.has(operation.value.objectItemId) &&
      !commandItems.has(operation.value.objectItemId)
    ) {
      throw domainFault(
        'item_not_found',
        `${path}.value.objectItemId` as KnowledgeIssuePath,
      );
    }
  }
}

function validateOperationSemantics(
  context: ManualKnowledgeContext,
  request: ApplyManualKnowledgeChangeSetRequest,
  state: ManualKnowledgeRepositorySnapshot,
  maps: ResolutionMaps,
  resolved: readonly ResolvedOperation[],
): void {
  const target = state.curationTargets[0];
  for (const operationState of resolved) {
    const operation = operationState.operation;
    const index = operationState.operationIndex;
    const path = operationPath(index);
    const fragmentCount =
      operation.provenance.citations.length +
      operation.provenance.fragmentDerivations.length;
    if (
      request.authorization.kind === 'eligible_target' &&
      (target === undefined || fragmentCount === 0)
    ) {
      throw domainFault(
        'invalid_provenance',
        `${path}.provenance` as KnowledgeIssuePath,
      );
    }

    const role = operation.value.epistemicRole;
    if (role === 'source_excerpt') {
      if (operation.kind !== 'put_item') {
        throw stateFault();
      }
      validateSourceExcerpt(operation, index, maps);
    } else if (role === 'source_claim' && fragmentCount === 0) {
      throw domainFault(
        'invalid_provenance',
        `${path}.provenance` as KnowledgeIssuePath,
      );
    } else if (
      role === 'inference' &&
      operation.provenance.fragmentDerivations.length === 0 &&
      operation.provenance.knowledgeDerivations.length === 0
    ) {
      throw domainFault(
        'invalid_provenance',
        `${path}.provenance` as KnowledgeIssuePath,
      );
    }

    if (operation.kind === 'put_relation') {
      if (operation.value.subjectItemId === operation.value.objectItemId) {
        throw domainFault(
          'invalid_relation',
          `${path}.value.objectItemId` as KnowledgeIssuePath,
        );
      }
      const current = operationState.currentRelation;
      if (current !== undefined) {
        if (current.subjectItemId !== operation.value.subjectItemId) {
          throw domainFault(
            'invalid_relation',
            `${path}.value.subjectItemId` as KnowledgeIssuePath,
          );
        }
        if (current.relationTypeKey !== operation.value.relationTypeKey) {
          throw domainFault(
            'invalid_relation',
            `${path}.value.relationTypeKey` as KnowledgeIssuePath,
          );
        }
        if (current.objectItemId !== operation.value.objectItemId) {
          throw domainFault(
            'invalid_relation',
            `${path}.value.objectItemId` as KnowledgeIssuePath,
          );
        }
      }
    }
    if (context.effectiveWorkspaceId.length === 0) {
      throw stateFault();
    }
  }
}

function validateSourceExcerpt(
  operation: Extract<ManualKnowledgeOperation, {kind: 'put_item'}>,
  operationIndex: number,
  maps: ResolutionMaps,
): void {
  const path = operationPath(operationIndex);
  if (!Object.hasOwn(operation.value, 'body')) {
    throw domainFault(
      'invalid_provenance',
      `${path}.value.body` as KnowledgeIssuePath,
    );
  }
  if (operation.provenance.citations.length !== 1) {
    throw domainFault(
      'invalid_provenance',
      `${path}.provenance.citations` as KnowledgeIssuePath,
    );
  }
  if (operation.provenance.fragmentDerivations.length !== 0) {
    throw domainFault(
      'invalid_provenance',
      `${path}.provenance.fragmentDerivations` as KnowledgeIssuePath,
    );
  }
  if (operation.provenance.knowledgeDerivations.length !== 0) {
    throw domainFault(
      'invalid_provenance',
      `${path}.provenance.knowledgeDerivations` as KnowledgeIssuePath,
    );
  }
  const citationId = operation.provenance.citations[0];
  const fragment =
    citationId === undefined ? undefined : maps.fragments.get(citationId);
  const body = operation.value.body;
  if (
    fragment === undefined ||
    body === undefined ||
    createHash('sha256')
      .update(new TextEncoder().encode(body))
      .digest('hex') !== fragment.selectedTextSha256
  ) {
    throw domainFault(
      'invalid_provenance',
      `${path}.value.body` as KnowledgeIssuePath,
    );
  }
}

function calculateOperationOutcomes(
  resolved: readonly ResolvedOperation[],
  maps: ResolutionMaps,
): readonly CompletedOperation[] {
  const itemPrivacy = new Map<string, boolean>();
  for (const entry of resolved) {
    if (entry.operation.kind !== 'put_item') continue;
    itemPrivacy.set(
      entry.operation.itemId,
      entry.currentRevision?.isPrivate === true ||
        provenanceIsPrivate(entry.operation, maps),
    );
  }
  return resolved.map((entry) => {
    const operation = entry.operation;
    const isPrivate =
      operation.kind === 'put_item'
        ? (itemPrivacy.get(operation.itemId) ?? false)
        : entry.currentRelationRevision?.isPrivate === true ||
          provenanceIsPrivate(operation, maps) ||
          itemIsPrivate(operation.value.subjectItemId, maps, itemPrivacy) ||
          itemIsPrivate(operation.value.objectItemId, maps, itemPrivacy);
    const unchanged =
      operation.kind === 'put_item'
        ? entry.currentRevision !== undefined &&
          equalItemValue(entry.currentRevision.value, operation.value) &&
          equalProvenance(
            entry.currentRevision.provenance,
            operation.provenance,
          ) &&
          (entry.currentRevision.isPrivate === true) === isPrivate
        : entry.currentRelationRevision !== undefined &&
          equalRelationValue(
            entry.currentRelationRevision.value,
            operation.value,
          ) &&
          equalProvenance(
            entry.currentRelationRevision.provenance,
            operation.provenance,
          ) &&
          (entry.currentRelationRevision.isPrivate === true) === isPrivate;
    const currentRevision =
      operation.kind === 'put_item'
        ? entry.currentItem?.currentRevision
        : entry.currentRelation?.currentRevision;
    const resultingRevision = unchanged
      ? currentRevision
      : (currentRevision ?? 0) + 1;
    if (resultingRevision === undefined) {
      throw stateFault();
    }
    if (resultingRevision > KNOWLEDGE_LIMITS.revisionNumber) {
      throw domainFault(
        'limit_exceeded',
        `${operationPath(entry.operationIndex)}.expectedRevision` as KnowledgeIssuePath,
        'revision_number',
      );
    }
    const resultingRevisionId =
      operation.kind === 'put_item'
        ? deriveKnowledgeItemRevisionId(operation.itemId, resultingRevision)
        : deriveKnowledgeRelationRevisionId(
            operation.relationId,
            resultingRevision,
          );
    return defineOwnedRecord<CompletedOperation>({
      ...entry,
      outcome: unchanged ? 'unchanged' : 'applied',
      resultingRevision,
      resultingRevisionId,
      isPrivate,
    });
  });
}

function provenanceIsPrivate(
  operation: ManualKnowledgeOperation,
  maps: ResolutionMaps,
): boolean {
  for (const fragmentId of [
    ...operation.provenance.citations,
    ...operation.provenance.fragmentDerivations,
  ]) {
    if (maps.fragments.get(fragmentId)?.isPrivate === true) return true;
  }
  for (const reference of operation.provenance.knowledgeDerivations) {
    if (
      reference.kind === 'item'
        ? maps.revisions.get(revisionKey(reference.itemId, reference.revision))
            ?.isPrivate === true
        : maps.relationRevisions.get(
            revisionKey(reference.relationId, reference.revision),
          )?.isPrivate === true
    ) {
      return true;
    }
  }
  return false;
}

function itemIsPrivate(
  itemId: string,
  maps: ResolutionMaps,
  commandPrivacy: ReadonlyMap<string, boolean>,
): boolean {
  const planned = commandPrivacy.get(itemId);
  if (planned !== undefined) return planned;
  const item = maps.items.get(itemId);
  if (item === undefined) return false;
  return (
    maps.revisions.get(revisionKey(itemId, item.currentRevision))?.isPrivate ===
    true
  );
}

function createPlan(
  context: ManualKnowledgeContext,
  request: ApplyManualKnowledgeChangeSetRequest,
  requestSha256: string,
  authorization: KnowledgeAuthorizationReceipt,
  maps: ResolutionMaps,
  resolved: readonly CompletedOperation[],
): PreparedManualKnowledgePlan {
  const workspaceId = context.effectiveWorkspaceId;
  const changeSetId = deriveKnowledgeChangeSetId(
    workspaceId,
    context.commandIdempotencyKey,
  );
  const outcome = resolved.some((entry) => entry.outcome === 'applied')
    ? 'applied'
    : 'unchanged';
  const operationReceipts: KnowledgeOperationReceipt[] = resolved.map((entry) =>
    operationReceipt(entry),
  );
  const receipt: ManualKnowledgeReceipt = defineOwnedRecord({
    workspaceId,
    commandIdempotencyKey: context.commandIdempotencyKey,
    changeSetId,
    commandKind: 'apply_manual_knowledge_change_set',
    authorization,
    originalOutcome: outcome,
    operations: operationReceipts,
  });

  const itemIdentityInserts: KnowledgeItemIdentityInsert[] = [];
  const itemRevisionInserts: KnowledgeRevisionInsert[] = [];
  const relationIdentityInserts: KnowledgeRelationIdentityInsert[] = [];
  const relationRevisionInserts: KnowledgeRelationRevisionInsert[] = [];
  const knowledgeRevisionFragmentInputs: KnowledgeRevisionFragmentInputInsert[] =
    [];
  const knowledgeRevisionItemInputs: KnowledgeRevisionItemInputInsert[] = [];
  const knowledgeRevisionRelationInputs: KnowledgeRevisionRelationInputInsert[] =
    [];
  const relationRevisionFragmentInputs: RelationRevisionFragmentInputInsert[] =
    [];
  const relationRevisionItemInputs: RelationRevisionItemInputInsert[] = [];
  const relationRevisionRelationInputs: RelationRevisionRelationInputInsert[] =
    [];
  const itemCurrentPointerCases: PreparedManualKnowledgePlan['itemCurrentPointerCases'][number][] =
    [];
  const relationCurrentPointerCases: PreparedManualKnowledgePlan['relationCurrentPointerCases'][number][] =
    [];

  for (const entry of resolved) {
    if (entry.outcome !== 'applied') {
      continue;
    }
    const operation = entry.operation;
    const commonRevision = {
      workspaceId,
      revision: entry.resultingRevision,
      revisionId: entry.resultingRevisionId,
      changeSetId,
      operationIndex: entry.operationIndex,
    } as const;
    if (operation.kind === 'put_item') {
      if (entry.currentItem === undefined) {
        itemIdentityInserts.push({
          workspaceId,
          itemId: operation.itemId,
          currentRevision: entry.resultingRevision,
          currentRevisionId: entry.resultingRevisionId,
        });
      } else {
        itemCurrentPointerCases.push({
          workspaceId,
          stableId: operation.itemId,
          expectedRevision: entry.currentItem.currentRevision,
          nextRevision: entry.resultingRevision,
          nextRevisionId: entry.resultingRevisionId,
        });
      }
      itemRevisionInserts.push({
        ...commonRevision,
        itemId: operation.itemId,
        ...(entry.currentItem === undefined
          ? {}
          : {previousRevisionId: entry.currentItem.currentRevisionId}),
        value: operation.value,
        ...(entry.isPrivate ? {isPrivate: true as const} : {}),
      });
      knowledgeRevisionFragmentInputs.push(
        ...createItemFragmentRows(
          workspaceId,
          operation,
          entry.resultingRevision,
          entry.resultingRevisionId,
        ),
      );
      const knowledgeRows = createItemKnowledgeRows(
        workspaceId,
        operation,
        entry.resultingRevision,
        entry.resultingRevisionId,
        maps,
      );
      knowledgeRevisionItemInputs.push(...knowledgeRows.items);
      knowledgeRevisionRelationInputs.push(...knowledgeRows.relations);
    } else {
      if (entry.currentRelation === undefined) {
        relationIdentityInserts.push({
          workspaceId,
          relationId: operation.relationId,
          subjectItemId: operation.value.subjectItemId,
          relationTypeKey: operation.value.relationTypeKey,
          objectItemId: operation.value.objectItemId,
          currentRevision: entry.resultingRevision,
          currentRevisionId: entry.resultingRevisionId,
        });
      } else {
        relationCurrentPointerCases.push({
          workspaceId,
          stableId: operation.relationId,
          expectedRevision: entry.currentRelation.currentRevision,
          nextRevision: entry.resultingRevision,
          nextRevisionId: entry.resultingRevisionId,
        });
      }
      relationRevisionInserts.push({
        ...commonRevision,
        relationId: operation.relationId,
        ...(entry.currentRelation === undefined
          ? {}
          : {previousRevisionId: entry.currentRelation.currentRevisionId}),
        value: operation.value,
        ...(entry.isPrivate ? {isPrivate: true as const} : {}),
      });
      relationRevisionFragmentInputs.push(
        ...createRelationFragmentRows(
          workspaceId,
          operation,
          entry.resultingRevision,
          entry.resultingRevisionId,
        ),
      );
      const knowledgeRows = createRelationKnowledgeRows(
        workspaceId,
        operation,
        entry.resultingRevision,
        entry.resultingRevisionId,
        maps,
      );
      relationRevisionItemInputs.push(...knowledgeRows.items);
      relationRevisionRelationInputs.push(...knowledgeRows.relations);
    }
  }

  const changeOperationInserts: StoredKnowledgeChangeOperationState[] =
    operationReceipts.map((operation) => ({
      workspaceId,
      changeSetId,
      ...operation,
    }));
  return deepFreeze({
    commandKind: 'apply_manual_knowledge_change_set',
    requestSha256,
    outcome,
    receipt,
    workspaceLockId: workspaceId,
    changeSetInsert: {
      workspaceId,
      commandIdempotencyKey: context.commandIdempotencyKey,
      changeSetId,
      requestSha256,
      authorization,
      originalOutcome: outcome,
      operationCount: request.operations.length,
      commandKind: 'apply_manual_knowledge_change_set',
      authority: 'manual_user',
      operationOrigin: 'manual_user',
    },
    changeOperationInserts,
    itemIdentityInserts,
    itemRevisionInserts,
    relationIdentityInserts,
    relationRevisionInserts,
    knowledgeRevisionFragmentInputs,
    knowledgeRevisionItemInputs,
    knowledgeRevisionRelationInputs,
    relationRevisionFragmentInputs,
    relationRevisionItemInputs,
    relationRevisionRelationInputs,
    itemCurrentPointerCases,
    relationCurrentPointerCases,
    eventInsert: {
      workspaceId,
      eventId: deriveKnowledgeCommittedEventId(changeSetId),
      eventKind: 'knowledge_change_set_committed',
      eventSchemaVersion: 1,
      changeSetId,
    },
  });
}

function createItemFragmentRows(
  workspaceId: string,
  operation: Extract<ManualKnowledgeOperation, {kind: 'put_item'}>,
  revision: number,
  revisionId: string,
): readonly KnowledgeRevisionFragmentInputInsert[] {
  return [
    ...operation.provenance.citations.map((fragmentId, index) => ({
      workspaceId,
      itemId: operation.itemId,
      revision,
      revisionId,
      inputKind: 'citation' as const,
      inputOrdinal: index as KnowledgeBoundedIndex,
      fragmentId,
    })),
    ...operation.provenance.fragmentDerivations.map((fragmentId, index) => ({
      workspaceId,
      itemId: operation.itemId,
      revision,
      revisionId,
      inputKind: 'derivation' as const,
      inputOrdinal: index as KnowledgeBoundedIndex,
      fragmentId,
    })),
  ];
}

function createRelationFragmentRows(
  workspaceId: string,
  operation: Extract<ManualKnowledgeOperation, {kind: 'put_relation'}>,
  revision: number,
  revisionId: string,
): readonly RelationRevisionFragmentInputInsert[] {
  return [
    ...operation.provenance.citations.map((fragmentId, index) => ({
      workspaceId,
      relationId: operation.relationId,
      revision,
      revisionId,
      inputKind: 'citation' as const,
      inputOrdinal: index as KnowledgeBoundedIndex,
      fragmentId,
    })),
    ...operation.provenance.fragmentDerivations.map((fragmentId, index) => ({
      workspaceId,
      relationId: operation.relationId,
      revision,
      revisionId,
      inputKind: 'derivation' as const,
      inputOrdinal: index as KnowledgeBoundedIndex,
      fragmentId,
    })),
  ];
}

function createItemKnowledgeRows(
  workspaceId: string,
  operation: Extract<ManualKnowledgeOperation, {kind: 'put_item'}>,
  revision: number,
  revisionId: string,
  maps: ResolutionMaps,
): Readonly<{
  items: readonly KnowledgeRevisionItemInputInsert[];
  relations: readonly KnowledgeRevisionRelationInputInsert[];
}> {
  const items: KnowledgeRevisionItemInputInsert[] = [];
  const relations: KnowledgeRevisionRelationInputInsert[] = [];
  for (
    let index = 0;
    index < operation.provenance.knowledgeDerivations.length;
    index += 1
  ) {
    const reference = operation.provenance.knowledgeDerivations[index];
    if (reference === undefined) {
      throw stateFault();
    }
    if (reference.kind === 'item') {
      const input = maps.revisions.get(
        revisionKey(reference.itemId, reference.revision),
      );
      if (input === undefined) {
        throw stateFault();
      }
      items.push({
        workspaceId,
        itemId: operation.itemId,
        revision,
        revisionId,
        inputOrdinal: index as KnowledgeBoundedIndex,
        inputItemId: reference.itemId,
        inputRevision: reference.revision,
        inputRevisionId: input.revisionId,
      });
    } else {
      const input = maps.relationRevisions.get(
        revisionKey(reference.relationId, reference.revision),
      );
      if (input === undefined) {
        throw stateFault();
      }
      relations.push({
        workspaceId,
        itemId: operation.itemId,
        revision,
        revisionId,
        inputOrdinal: index as KnowledgeBoundedIndex,
        inputRelationId: reference.relationId,
        inputRevision: reference.revision,
        inputRevisionId: input.revisionId,
      });
    }
  }
  return {items, relations};
}

function createRelationKnowledgeRows(
  workspaceId: string,
  operation: Extract<ManualKnowledgeOperation, {kind: 'put_relation'}>,
  revision: number,
  revisionId: string,
  maps: ResolutionMaps,
): Readonly<{
  items: readonly RelationRevisionItemInputInsert[];
  relations: readonly RelationRevisionRelationInputInsert[];
}> {
  const items: RelationRevisionItemInputInsert[] = [];
  const relations: RelationRevisionRelationInputInsert[] = [];
  for (
    let index = 0;
    index < operation.provenance.knowledgeDerivations.length;
    index += 1
  ) {
    const reference = operation.provenance.knowledgeDerivations[index];
    if (reference === undefined) {
      throw stateFault();
    }
    if (reference.kind === 'item') {
      const input = maps.revisions.get(
        revisionKey(reference.itemId, reference.revision),
      );
      if (input === undefined) {
        throw stateFault();
      }
      items.push({
        workspaceId,
        relationId: operation.relationId,
        revision,
        revisionId,
        inputOrdinal: index as KnowledgeBoundedIndex,
        inputItemId: reference.itemId,
        inputRevision: reference.revision,
        inputRevisionId: input.revisionId,
      });
    } else {
      const input = maps.relationRevisions.get(
        revisionKey(reference.relationId, reference.revision),
      );
      if (input === undefined) {
        throw stateFault();
      }
      relations.push({
        workspaceId,
        relationId: operation.relationId,
        revision,
        revisionId,
        inputOrdinal: index as KnowledgeBoundedIndex,
        inputRelationId: reference.relationId,
        inputRevision: reference.revision,
        inputRevisionId: input.revisionId,
      });
    }
  }
  return {items, relations};
}

function operationReceipt(
  entry: ResolvedOperation &
    Required<
      Pick<
        ResolvedOperation,
        'outcome' | 'resultingRevision' | 'resultingRevisionId'
      >
    >,
): KnowledgeOperationReceipt {
  return entry.operation.kind === 'put_item'
    ? defineOwnedRecord({
        operationIndex: entry.operationIndex,
        operationKind: 'put_item',
        itemId: entry.operation.itemId,
        resultingRevision: entry.resultingRevision,
        resultingRevisionId: entry.resultingRevisionId,
        outcome: entry.outcome,
      })
    : defineOwnedRecord({
        operationIndex: entry.operationIndex,
        operationKind: 'put_relation',
        relationId: entry.operation.relationId,
        resultingRevision: entry.resultingRevision,
        resultingRevisionId: entry.resultingRevisionId,
        outcome: entry.outcome,
      });
}

function reconcileStoredCommand(
  context: ManualKnowledgeContext,
  request: ApplyManualKnowledgeChangeSetRequest,
  requestSha256: string,
  state: ManualKnowledgeRepositorySnapshot,
): ApplyManualKnowledgeChangeSetResult | undefined {
  const stored = state.changeSets[0];
  if (stored === undefined) {
    return undefined;
  }
  if (stored.requestSha256 !== requestSha256) {
    return deepFreeze({
      status: 'rejected',
      issue: {
        code: 'idempotency_conflict',
        path: 'context.commandIdempotencyKey',
      },
    });
  }
  validateStoredReceiptAgainstRequest(context, request, stored, state);
  return deepFreeze({
    status: 'replayed',
    receipt: receiptFromStored(context, stored, state.changeOperations),
  });
}

function validateStoredReceiptAgainstRequest(
  context: ManualKnowledgeContext,
  request: ApplyManualKnowledgeChangeSetRequest,
  stored: StoredKnowledgeChangeSetState,
  state: ManualKnowledgeRepositorySnapshot,
): void {
  if (stored.workspaceId !== context.effectiveWorkspaceId) {
    throw stateFault();
  }
  if (request.authorization.kind !== stored.authorization.kind) {
    throw stateFault();
  }
  if (request.authorization.kind === 'eligible_target') {
    if (
      stored.authorization.kind !== 'eligible_target' ||
      stored.authorization.targetId !==
        deriveCurationTargetId(
          context.effectiveWorkspaceId,
          request.authorization.target,
        ) ||
      stored.authorization.decisionRevision !==
        request.authorization.expectedDecisionRevision
    ) {
      throw stateFault();
    }
  }
  for (let index = 0; index < request.operations.length; index += 1) {
    const operation = request.operations[index];
    const storedOperation = state.changeOperations[index];
    if (
      operation === undefined ||
      storedOperation?.operationIndex !== index ||
      (operation.kind === 'put_item'
        ? storedOperation.operationKind !== 'put_item' ||
          storedOperation.itemId !== operation.itemId
        : storedOperation.operationKind !== 'put_relation' ||
          storedOperation.relationId !== operation.relationId)
    ) {
      throw stateFault();
    }
  }
}

function receiptFromStored(
  context: ManualKnowledgeContext,
  stored: StoredKnowledgeChangeSetState,
  operations: readonly StoredKnowledgeChangeOperationState[],
): ManualKnowledgeReceipt {
  return deepFreeze(
    defineOwnedRecord({
      workspaceId: context.effectiveWorkspaceId,
      commandIdempotencyKey: context.commandIdempotencyKey,
      changeSetId: stored.changeSetId,
      commandKind: 'apply_manual_knowledge_change_set',
      authorization: copyAuthorizationReceipt(stored.authorization),
      originalOutcome: stored.originalOutcome,
      operations: operations.map((operation) =>
        copyOperationReceipt(operation),
      ),
    }),
  );
}

function validateRepositorySnapshot(
  context: ManualKnowledgeContext,
  request: ApplyManualKnowledgeChangeSetRequest,
  state: ManualKnowledgeRepositorySnapshot,
): void {
  assertWorkspace(context.effectiveWorkspaceId, state);
  assertSortedAndUnique(state);
  if (state.changeSets.length > 1) {
    throw stateFault();
  }
  if (state.changeSets.length === 1) {
    validateStoredCommandClosure(context, state);
  } else {
    validateNewCommandClosure(context, request, state);
  }
}

function assertWorkspace(
  workspaceId: string,
  state: ManualKnowledgeRepositorySnapshot,
): void {
  const arrays: readonly (readonly {readonly workspaceId: string}[])[] = [
    state.curationTargets,
    state.intakeDecisions,
    state.fragments,
    state.items,
    state.revisions,
    state.relations,
    state.relationRevisions,
    state.changeSets,
    state.changeOperations,
    state.changeEvents,
  ];
  if (
    arrays.some((rows) => rows.some((row) => row.workspaceId !== workspaceId))
  ) {
    throw stateFault();
  }
}

function assertSortedAndUnique(state: ManualKnowledgeRepositorySnapshot): void {
  assertStrictSort(state.curationTargets, (row) => [row.targetId]);
  assertStrictSort(state.intakeDecisions, (row) => [
    row.targetId,
    row.decisionId,
  ]);
  assertUnique(state.intakeDecisions.map((row) => row.decisionId));
  assertStrictSort(state.fragments, (row) => [row.fragmentId]);
  assertStrictSort(state.items, (row) => [row.itemId]);
  assertStrictSort(state.revisions, (row) => [row.itemId, row.revision]);
  assertUnique(state.revisions.map((row) => row.revisionId));
  assertStrictSort(state.relations, (row) => [row.relationId]);
  assertStrictSort(state.relationRevisions, (row) => [
    row.relationId,
    row.revision,
  ]);
  assertUnique(state.relationRevisions.map((row) => row.revisionId));
  assertStrictSort(state.changeSets, (row) => [
    row.commandIdempotencyKey,
    row.changeSetId,
  ]);
  assertUnique(state.changeSets.map((row) => row.changeSetId));
  assertStrictSort(state.changeOperations, (row) => [
    row.changeSetId,
    row.operationIndex,
  ]);
  assertStrictSort(state.changeEvents, (row) => [row.changeSetId, row.eventId]);
  assertUnique(state.changeEvents.map((row) => row.eventId));
}

function validateStoredCommandClosure(
  context: ManualKnowledgeContext,
  state: ManualKnowledgeRepositorySnapshot,
): void {
  if (
    state.curationTargets.length !== 0 ||
    state.intakeDecisions.length !== 0 ||
    state.fragments.length !== 0 ||
    state.items.length !== 0 ||
    state.revisions.length !== 0 ||
    state.relations.length !== 0 ||
    state.relationRevisions.length !== 0
  ) {
    throw stateFault();
  }
  const stored = state.changeSets[0];
  if (
    stored?.commandIdempotencyKey !== context.commandIdempotencyKey ||
    stored.changeSetId !==
      deriveKnowledgeChangeSetId(
        context.effectiveWorkspaceId,
        context.commandIdempotencyKey,
      ) ||
    state.changeOperations.length !== stored.operationCount ||
    state.changeEvents.length !== 1
  ) {
    throw stateFault();
  }
  validateAuthorizationReceiptState(stored.authorization);
  let applied = 0;
  for (let index = 0; index < state.changeOperations.length; index += 1) {
    const operation = state.changeOperations[index];
    if (operation === undefined) {
      throw stateFault();
    }
    if (
      operation.changeSetId !== stored.changeSetId ||
      operation.operationIndex !== index
    ) {
      throw stateFault();
    }
    const expectedRevisionId =
      operation.operationKind === 'put_item'
        ? deriveKnowledgeItemRevisionId(
            operation.itemId,
            operation.resultingRevision,
          )
        : deriveKnowledgeRelationRevisionId(
            operation.relationId,
            operation.resultingRevision,
          );
    if (operation.resultingRevisionId !== expectedRevisionId) {
      throw stateFault();
    }
    if (operation.outcome === 'applied') {
      applied += 1;
    }
  }
  if (
    (stored.originalOutcome === 'applied' && applied === 0) ||
    (stored.originalOutcome === 'unchanged' && applied !== 0)
  ) {
    throw stateFault();
  }
  const event = state.changeEvents[0];
  if (
    event?.changeSetId !== stored.changeSetId ||
    event.eventId !== deriveKnowledgeCommittedEventId(stored.changeSetId)
  ) {
    throw stateFault();
  }
}

function validateAuthorizationReceiptState(
  authorization: KnowledgeAuthorizationReceipt,
): void {
  if (
    authorization.kind === 'eligible_target' &&
    (authorization.decisionId !==
      deriveIntakeDecisionId(authorization.targetId) ||
      authorization.decisionRevisionId !==
        deriveIntakeDecisionRevisionId(
          authorization.decisionId,
          authorization.decisionRevision,
        ))
  ) {
    throw stateFault();
  }
}

function validateNewCommandClosure(
  context: ManualKnowledgeContext,
  request: ApplyManualKnowledgeChangeSetRequest,
  state: ManualKnowledgeRepositorySnapshot,
): void {
  if (state.changeOperations.length !== 0 || state.changeEvents.length !== 0) {
    throw stateFault();
  }
  validateCurationClosure(context, request, state);
  const requestedFragments = new Set<string>();
  const requestedItems = new Set<string>();
  const requestedRelations = new Set<string>();
  const historicalItems = new Set<string>();
  const historicalRelations = new Set<string>();
  for (const operation of request.operations) {
    if (operation.kind === 'put_item') {
      requestedItems.add(operation.itemId);
    } else {
      requestedRelations.add(operation.relationId);
      requestedItems.add(operation.value.subjectItemId);
      requestedItems.add(operation.value.objectItemId);
    }
    for (const fragmentId of operation.provenance.citations) {
      requestedFragments.add(fragmentId);
    }
    for (const fragmentId of operation.provenance.fragmentDerivations) {
      requestedFragments.add(fragmentId);
    }
    for (const derivation of operation.provenance.knowledgeDerivations) {
      if (derivation.kind === 'item') {
        requestedItems.add(derivation.itemId);
        historicalItems.add(
          revisionKey(derivation.itemId, derivation.revision),
        );
      } else {
        requestedRelations.add(derivation.relationId);
        historicalRelations.add(
          revisionKey(derivation.relationId, derivation.revision),
        );
      }
    }
  }
  if (
    state.fragments.some((row) => !requestedFragments.has(row.fragmentId)) ||
    state.items.some((row) => !requestedItems.has(row.itemId)) ||
    state.relations.some((row) => !requestedRelations.has(row.relationId))
  ) {
    throw stateFault();
  }
  validateItemRevisionClosure(state, historicalItems);
  validateRelationRevisionClosure(state, historicalRelations);
}

function validateCurationClosure(
  context: ManualKnowledgeContext,
  request: ApplyManualKnowledgeChangeSetRequest,
  state: ManualKnowledgeRepositorySnapshot,
): void {
  if (request.authorization.kind === 'manual_edit') {
    if (
      state.curationTargets.length !== 0 ||
      state.intakeDecisions.length !== 0
    ) {
      throw stateFault();
    }
    return;
  }
  if (state.curationTargets.length > 1 || state.intakeDecisions.length > 1) {
    throw stateFault();
  }
  const target = state.curationTargets[0];
  const targetId = deriveCurationTargetId(
    context.effectiveWorkspaceId,
    request.authorization.target,
  );
  if (target !== undefined) {
    if (
      target.targetId !== targetId ||
      target.kind !== request.authorization.target.kind
    ) {
      throw stateFault();
    }
    if (
      target.kind === 'snapshot' &&
      (request.authorization.target.kind !== 'snapshot' ||
        target.snapshotId !== request.authorization.target.snapshotId)
    ) {
      throw stateFault();
    }
    if (
      target.kind === 'fragment' &&
      (request.authorization.target.kind !== 'fragment' ||
        target.fragmentId !== request.authorization.target.fragmentId)
    ) {
      throw stateFault();
    }
  }
  const decision = state.intakeDecisions[0];
  if (decision !== undefined) {
    if (
      target === undefined ||
      decision.targetId !== targetId ||
      decision.decisionId !== deriveIntakeDecisionId(targetId) ||
      decision.currentRevisionId !==
        deriveIntakeDecisionRevisionId(
          decision.decisionId,
          decision.currentRevision,
        )
    ) {
      throw stateFault();
    }
  }
}

function validateItemRevisionClosure(
  state: ManualKnowledgeRepositorySnapshot,
  historical: ReadonlySet<string>,
): void {
  const items = new Map(state.items.map((row) => [row.itemId, row]));
  const revisions = new Map(
    state.revisions.map((row) => [revisionKey(row.itemId, row.revision), row]),
  );
  for (const item of state.items) {
    const current = revisions.get(
      revisionKey(item.itemId, item.currentRevision),
    );
    if (
      current?.revisionId !== item.currentRevisionId ||
      item.currentRevisionId !==
        deriveKnowledgeItemRevisionId(item.itemId, item.currentRevision)
    ) {
      throw stateFault();
    }
  }
  for (const revision of state.revisions) {
    const item = items.get(revision.itemId);
    const key = revisionKey(revision.itemId, revision.revision);
    if (
      item === undefined ||
      (item.currentRevision !== revision.revision && !historical.has(key))
    ) {
      throw stateFault();
    }
    validateRevisionIdentity(
      revision.itemId,
      revision.revision,
      revision.revisionId,
      revision.previousRevisionId,
      deriveKnowledgeItemRevisionId,
    );
    validateStoredProvenance(
      revision.value.epistemicRole,
      revision.value.body,
      revision.provenance,
    );
    if (
      revision.revision === 1 &&
      (revision.value.reviewState === 'rejected' ||
        revision.value.reviewState === 'withdrawn')
    ) {
      throw stateFault();
    }
  }
}

function validateRelationRevisionClosure(
  state: ManualKnowledgeRepositorySnapshot,
  historical: ReadonlySet<string>,
): void {
  const relations = new Map(
    state.relations.map((row) => [row.relationId, row]),
  );
  const revisions = new Map(
    state.relationRevisions.map((row) => [
      revisionKey(row.relationId, row.revision),
      row,
    ]),
  );
  for (const relation of state.relations) {
    const current = revisions.get(
      revisionKey(relation.relationId, relation.currentRevision),
    );
    if (
      current?.revisionId !== relation.currentRevisionId ||
      relation.currentRevisionId !==
        deriveKnowledgeRelationRevisionId(
          relation.relationId,
          relation.currentRevision,
        ) ||
      relation.subjectItemId === relation.objectItemId
    ) {
      throw stateFault();
    }
  }
  for (const revision of state.relationRevisions) {
    const relation = relations.get(revision.relationId);
    const key = revisionKey(revision.relationId, revision.revision);
    if (
      relation === undefined ||
      (relation.currentRevision !== revision.revision &&
        !historical.has(key)) ||
      revision.value.subjectItemId !== relation.subjectItemId ||
      revision.value.relationTypeKey !== relation.relationTypeKey ||
      revision.value.objectItemId !== relation.objectItemId
    ) {
      throw stateFault();
    }
    validateRevisionIdentity(
      revision.relationId,
      revision.revision,
      revision.revisionId,
      revision.previousRevisionId,
      deriveKnowledgeRelationRevisionId,
    );
    validateStoredProvenance(
      revision.value.epistemicRole,
      undefined,
      revision.provenance,
    );
    if (
      revision.revision === 1 &&
      (revision.value.reviewState === 'rejected' ||
        revision.value.reviewState === 'withdrawn')
    ) {
      throw stateFault();
    }
  }
}

function validateRevisionIdentity(
  stableId: string,
  revision: number,
  revisionId: string,
  previousRevisionId: string | undefined,
  derive: (stableId: string, revision: number) => string,
): void {
  if (revisionId !== derive(stableId, revision)) {
    throw stateFault();
  }
  if (
    (revision === 1 && previousRevisionId !== undefined) ||
    (revision > 1 && previousRevisionId !== derive(stableId, revision - 1))
  ) {
    throw stateFault();
  }
}

function validateStoredProvenance(
  role: string,
  body: string | undefined,
  provenance: KnowledgeProvenanceInput,
): void {
  const fragments = new Set<string>();
  for (const value of provenance.citations) {
    if (fragments.has(value)) {
      throw stateFault();
    }
    fragments.add(value);
  }
  for (const value of provenance.fragmentDerivations) {
    if (fragments.has(value)) {
      throw stateFault();
    }
    fragments.add(value);
  }
  const knowledge = new Set<string>();
  for (const value of provenance.knowledgeDerivations) {
    const key = formalReferenceKey(value);
    if (knowledge.has(key)) {
      throw stateFault();
    }
    knowledge.add(key);
  }
  if (fragments.size + knowledge.size === 0) {
    throw stateFault();
  }
  if (
    role === 'source_excerpt' &&
    (body === undefined ||
      provenance.citations.length !== 1 ||
      provenance.fragmentDerivations.length !== 0 ||
      provenance.knowledgeDerivations.length !== 0)
  ) {
    throw stateFault();
  }
  if (role === 'source_claim' && fragments.size === 0) {
    throw stateFault();
  }
  if (
    role === 'inference' &&
    provenance.fragmentDerivations.length === 0 &&
    provenance.knowledgeDerivations.length === 0
  ) {
    throw stateFault();
  }
}

function createResolutionMaps(
  state: ManualKnowledgeRepositorySnapshot,
): ResolutionMaps {
  return {
    fragments: new Map(state.fragments.map((row) => [row.fragmentId, row])),
    items: new Map(state.items.map((row) => [row.itemId, row])),
    revisions: new Map(
      state.revisions.map((row) => [
        revisionKey(row.itemId, row.revision),
        row,
      ]),
    ),
    relations: new Map(state.relations.map((row) => [row.relationId, row])),
    relationRevisions: new Map(
      state.relationRevisions.map((row) => [
        revisionKey(row.relationId, row.revision),
        row,
      ]),
    ),
  };
}

function fragmentIsWithinTarget(
  fragment: KnowledgeFragmentState,
  target: KnowledgeCurationTargetState,
): boolean {
  return target.kind === 'fragment'
    ? fragment.fragmentId === target.fragmentId
    : fragment.resourceId === target.resourceId &&
        fragment.snapshotId === target.snapshotId;
}

function equalItemValue(
  left: KnowledgeRevisionState['value'],
  right: Extract<ManualKnowledgeOperation, {kind: 'put_item'}>['value'],
): boolean {
  return (
    left.knowledgeKind === right.knowledgeKind &&
    left.epistemicRole === right.epistemicRole &&
    left.reviewState === right.reviewState &&
    left.title === right.title &&
    equalOptionalText(left, right, 'body')
  );
}

function equalRelationValue(
  left: KnowledgeRelationRevisionState['value'],
  right: Extract<ManualKnowledgeOperation, {kind: 'put_relation'}>['value'],
): boolean {
  return (
    left.subjectItemId === right.subjectItemId &&
    left.relationTypeKey === right.relationTypeKey &&
    left.objectItemId === right.objectItemId &&
    left.epistemicRole === right.epistemicRole &&
    left.reviewState === right.reviewState &&
    equalOptionalText(left, right, 'qualifier')
  );
}

function equalOptionalText(
  left: Readonly<Record<string, unknown>>,
  right: Readonly<Record<string, unknown>>,
  key: string,
): boolean {
  return (
    Object.hasOwn(left, key) === Object.hasOwn(right, key) &&
    (!Object.hasOwn(left, key) || left[key] === right[key])
  );
}

function equalProvenance(
  left: KnowledgeProvenanceInput,
  right: KnowledgeProvenanceInput,
): boolean {
  return (
    equalStringArray(left.citations, right.citations) &&
    equalStringArray(left.fragmentDerivations, right.fragmentDerivations) &&
    left.knowledgeDerivations.length === right.knowledgeDerivations.length &&
    left.knowledgeDerivations.every((value, index) => {
      const other = right.knowledgeDerivations[index];
      return (
        other !== undefined &&
        formalReferenceKey(value) === formalReferenceKey(other)
      );
    })
  );
}

function equalStringArray(
  left: readonly string[],
  right: readonly string[],
): boolean {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

function copyReceipt(receipt: ManualKnowledgeReceipt): ManualKnowledgeReceipt {
  return deepFreeze(
    defineOwnedRecord({
      workspaceId: receipt.workspaceId,
      commandIdempotencyKey: receipt.commandIdempotencyKey,
      changeSetId: receipt.changeSetId,
      commandKind: receipt.commandKind,
      authorization: copyAuthorizationReceipt(receipt.authorization),
      originalOutcome: receipt.originalOutcome,
      operations: receipt.operations.map((operation) =>
        copyOperationReceipt(operation),
      ),
    }),
  );
}

function copyAuthorizationReceipt(
  authorization: KnowledgeAuthorizationReceipt,
): KnowledgeAuthorizationReceipt {
  return authorization.kind === 'manual_edit'
    ? defineOwnedRecord({kind: 'manual_edit'})
    : defineOwnedRecord({
        kind: 'eligible_target',
        targetId: authorization.targetId,
        decisionId: authorization.decisionId,
        decisionRevision: authorization.decisionRevision,
        decisionRevisionId: authorization.decisionRevisionId,
      });
}

function copyOperationReceipt(
  operation: KnowledgeOperationReceipt,
): KnowledgeOperationReceipt {
  return operation.operationKind === 'put_item'
    ? defineOwnedRecord({
        operationIndex: operation.operationIndex,
        operationKind: operation.operationKind,
        itemId: operation.itemId,
        resultingRevision: operation.resultingRevision,
        resultingRevisionId: operation.resultingRevisionId,
        outcome: operation.outcome,
      })
    : defineOwnedRecord({
        operationIndex: operation.operationIndex,
        operationKind: operation.operationKind,
        relationId: operation.relationId,
        resultingRevision: operation.resultingRevision,
        resultingRevisionId: operation.resultingRevisionId,
        outcome: operation.outcome,
      });
}

function assertStrictSort<Row>(
  rows: readonly Row[],
  tuple: (row: Row) => readonly (number | string)[],
): void {
  for (let index = 1; index < rows.length; index += 1) {
    const previous = rows[index - 1];
    const current = rows[index];
    if (
      previous === undefined ||
      current === undefined ||
      compareTuple(tuple(previous), tuple(current)) >= 0
    ) {
      throw stateFault();
    }
  }
}

function assertUnique(values: readonly string[]): void {
  if (new Set(values).size !== values.length) {
    throw stateFault();
  }
}

function compareTuple(
  left: readonly (number | string)[],
  right: readonly (number | string)[],
): number {
  for (let index = 0; index < left.length; index += 1) {
    const a = left[index];
    const b = right[index];
    if (a === b) {
      continue;
    }
    if (a === undefined || b === undefined || typeof a !== typeof b) {
      throw stateFault();
    }
    return a < b ? -1 : 1;
  }
  return left.length - right.length;
}

function formalReferenceKey(reference: FormalKnowledgeRevisionRef): string {
  return reference.kind === 'item'
    ? `item:${reference.itemId}:${String(reference.revision)}`
    : `relation:${reference.relationId}:${String(reference.revision)}`;
}

function revisionKey(stableId: string, revision: number): string {
  return `${stableId}:${String(revision)}`;
}

function operationPath(index: number): KnowledgeIssuePath {
  return `request.operations[${String(index)}]` as KnowledgeIssuePath;
}

function domainFault(
  code: Exclude<KnowledgeIssueCode, 'persistence_failed'>,
  path: KnowledgeIssuePath,
  budget?: KnowledgeBudgetName,
): KnowledgeInputFault {
  return new KnowledgeInputFault(code, path, budget);
}

function stateFault(): KnowledgeInputFault {
  return domainFault('invalid_shape', 'state');
}

function rejectedFromError(
  error: unknown,
): ApplyManualKnowledgeChangeSetResult {
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
  const issue: KnowledgeIssue = {code: error.code, path: error.path};
  return deepFreeze({status: 'rejected', issue});
}
