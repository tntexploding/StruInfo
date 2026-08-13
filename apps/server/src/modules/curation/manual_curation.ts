import {
  CurationInputFault,
  decodeApplyManualCurationRequest,
  decodeManualCurationContext,
  decodeManualCurationRepositorySnapshot,
  decodePutContentClassificationTermRequest,
  deepFreeze,
} from './closed_manual_curation_input.js';
import {
  ASSESSMENT_DIMENSIONS,
  type ApplyManualCurationPreparation,
  type ApplyManualCurationReceipt,
  type ApplyManualCurationRequest,
  type ApplyManualCurationResult,
  type AssessmentRevisionValue,
  type ClassificationAssignmentState,
  CURATION_LIMITS,
  type CurationIssue,
  type CurationRejectedResult,
  type CurationTargetInsert,
  type EvidenceTargetState,
  type IntakeDecisionValue,
  type ManualCurationContext,
  type ManualCurationOperation,
  type ManualCurationRepositorySnapshot,
  type PreparedApplyManualCurationPlan,
  type PreparedAssessmentChange,
  type PreparedClassificationChange,
  type PreparedDecisionChange,
  type PreparedPutContentClassificationTermPlan,
  type PutContentClassificationTermPreparation,
  type PutContentClassificationTermReceipt,
  type PutContentClassificationTermRequest,
  type PutContentClassificationTermResult,
  type StoredCurationCommandState,
  type VocabularyTermState,
  type VocabularyTermValue,
} from './manual_curation_contract.js';
import {
  createTargetCommandProjection,
  createTermCommandProjection,
  deriveAssessmentId,
  deriveAssessmentRevisionId,
  deriveClassificationAssignmentId,
  deriveClassificationAssignmentRevisionId,
  deriveCurationTargetId,
  deriveIntakeDecisionId,
  deriveIntakeDecisionRevisionId,
  deriveVocabularyTermRevisionId,
  digestCommandProjection,
} from './manual_curation_identity.js';

export function preparePutContentClassificationTerm(
  contextInput: unknown,
  requestInput: unknown,
  repositorySnapshotInput: unknown,
): PutContentClassificationTermPreparation {
  try {
    const context = decodeManualCurationContext(contextInput);
    const request = decodePutContentClassificationTermRequest(requestInput);
    const state = decodeAndValidateRepositoryState(repositorySnapshotInput);
    const requestSha256 = digestCommandProjection(
      createTermCommandProjection(context, request),
    );
    const replay = reconcileTermCommand(context, requestSha256, state.commands);
    if (replay !== undefined) {
      return deepFreeze({kind: 'resolved', result: replay});
    }
    return deepFreeze({
      kind: 'prepared',
      plan: planTermCommand(context, request, requestSha256, state),
    });
  } catch (error) {
    return deepFreeze({kind: 'resolved', result: rejectedFromError(error)});
  }
}

export function prepareApplyManualCuration(
  contextInput: unknown,
  requestInput: unknown,
  repositorySnapshotInput: unknown,
): ApplyManualCurationPreparation {
  try {
    const context = decodeManualCurationContext(contextInput);
    const request = decodeApplyManualCurationRequest(requestInput);
    const state = decodeAndValidateRepositoryState(repositorySnapshotInput);
    const requestSha256 = digestCommandProjection(
      createTargetCommandProjection(context, request),
    );
    const replay = reconcileTargetCommand(
      context,
      requestSha256,
      state.commands,
    );
    if (replay !== undefined) {
      return deepFreeze({kind: 'resolved', result: replay});
    }
    return deepFreeze({
      kind: 'prepared',
      plan: planTargetCommand(context, request, requestSha256, state),
    });
  } catch (error) {
    return deepFreeze({kind: 'resolved', result: rejectedFromError(error)});
  }
}

export function resultForCommittedTermPlan(
  plan: PreparedPutContentClassificationTermPlan,
): PutContentClassificationTermResult {
  const receipt = copyTermReceipt(plan.receipt);
  return plan.outcome === 'applied'
    ? deepFreeze({
        status: 'applied',
        receipt: receipt as PutContentClassificationTermReceipt<'applied'>,
      })
    : deepFreeze({
        status: 'unchanged',
        receipt: receipt as PutContentClassificationTermReceipt<'unchanged'>,
      });
}

export function resultForCommittedTargetPlan(
  plan: PreparedApplyManualCurationPlan,
): ApplyManualCurationResult {
  const receipt = copyTargetReceipt(plan.receipt);
  return plan.outcome === 'applied'
    ? deepFreeze({
        status: 'applied',
        receipt: receipt as ApplyManualCurationReceipt<'applied'>,
      })
    : deepFreeze({
        status: 'unchanged',
        receipt: receipt as ApplyManualCurationReceipt<'unchanged'>,
      });
}

export function mapCurationPersistenceFailure(): CurationRejectedResult {
  return deepFreeze({
    status: 'rejected',
    issue: {code: 'persistence_failed', path: 'persistence'},
  });
}

function planTermCommand(
  context: ManualCurationContext,
  request: PutContentClassificationTermRequest,
  requestSha256: string,
  state: ManualCurationRepositorySnapshot,
): PreparedPutContentClassificationTermPlan {
  const current = findTerm(state, context.effectiveWorkspaceId, request.termId);
  if (current === undefined && request.expectedRevision > 0) {
    throw domainFault('term_not_found', 'request.termId');
  }
  if (
    current !== undefined &&
    request.expectedRevision !== current.currentRevision
  ) {
    throw domainFault('stale_revision', 'request.expectedRevision');
  }
  if (current === undefined && request.value.lifecycle === 'retired') {
    throw domainFault('invalid_state', 'request.value.lifecycle');
  }
  if (current !== undefined && equalTermValue(current.value, request.value)) {
    return createTermPlan(
      context,
      request,
      requestSha256,
      current.currentRevision,
      'unchanged',
    );
  }

  const parentChanged =
    current === undefined ||
    optionalText(current.value.parentTermId) !==
      optionalText(request.value.parentTermId);
  if (parentChanged && request.value.parentTermId !== undefined) {
    validateNewParent(context, request, state);
  }

  const nextRevision = (current?.currentRevision ?? 0) + 1;
  if (nextRevision > CURATION_LIMITS.revisionNumber) {
    throw domainFault(
      'limit_exceeded',
      'request.expectedRevision',
      'revision_number',
    );
  }
  return createTermPlan(
    context,
    request,
    requestSha256,
    nextRevision,
    'applied',
    current,
  );
}

function createTermPlan(
  context: ManualCurationContext,
  request: PutContentClassificationTermRequest,
  requestSha256: string,
  resultingRevision: number,
  outcome: 'applied' | 'unchanged',
  current?: VocabularyTermState,
): PreparedPutContentClassificationTermPlan {
  const receipt: PutContentClassificationTermReceipt = {
    workspaceId: context.effectiveWorkspaceId,
    commandIdempotencyKey: context.commandIdempotencyKey,
    commandKind: 'put_content_classification_term',
    termId: request.termId,
    resultingRevision,
    originalOutcome: outcome,
  };
  const revisionId =
    outcome === 'applied'
      ? deriveVocabularyTermRevisionId(request.termId, resultingRevision)
      : undefined;
  return deepFreeze({
    commandKind: 'put_content_classification_term',
    requestSha256,
    outcome,
    receipt,
    workspaceLockId: context.effectiveWorkspaceId,
    ...(outcome !== 'applied' || revisionId === undefined
      ? {}
      : current === undefined
        ? {
            termIdentityInsert: {
              workspaceId: context.effectiveWorkspaceId,
              termId: request.termId,
              currentRevision: resultingRevision,
              currentRevisionId: revisionId,
            },
            termRevisionInsert: {
              workspaceId: context.effectiveWorkspaceId,
              termId: request.termId,
              termRevisionId: revisionId,
              revisionNumber: resultingRevision,
              value: request.value,
            },
          }
        : {
            termRevisionInsert: {
              workspaceId: context.effectiveWorkspaceId,
              termId: request.termId,
              termRevisionId: revisionId,
              revisionNumber: resultingRevision,
              value: request.value,
            },
            termCurrentPointerCas: {
              workspaceId: context.effectiveWorkspaceId,
              stableId: request.termId,
              expectedRevision: current.currentRevision,
              nextRevision: resultingRevision,
              nextRevisionId: revisionId,
            },
          }),
    commandInsert: {
      workspaceId: context.effectiveWorkspaceId,
      commandIdempotencyKey: context.commandIdempotencyKey,
      requestSha256,
      commandKind: 'put_content_classification_term',
      authority: 'manual_user',
      termId: request.termId,
      outcome,
      resultingVersion: resultingRevision,
    },
  });
}

function validateNewParent(
  context: ManualCurationContext,
  request: PutContentClassificationTermRequest,
  state: ManualCurationRepositorySnapshot,
): void {
  const parentId = request.value.parentTermId;
  if (parentId === undefined || parentId === request.termId) {
    throw domainFault('invalid_parent', 'request.value.parentTermId');
  }
  const parent = findTerm(state, context.effectiveWorkspaceId, parentId);
  if (parent?.value.lifecycle !== 'active') {
    throw domainFault('invalid_parent', 'request.value.parentTermId');
  }
  const byId = termsForWorkspace(state, context.effectiveWorkspaceId);
  let cursor: VocabularyTermState = parent;
  const visited = new Set<string>();
  while (cursor.value.parentTermId !== undefined) {
    if (cursor.termId === request.termId) {
      throw domainFault('hierarchy_cycle', 'request.value.parentTermId');
    }
    if (visited.has(cursor.termId)) {
      throw stateFault();
    }
    visited.add(cursor.termId);
    const next = byId.get(cursor.value.parentTermId);
    if (next === undefined) {
      throw stateFault();
    }
    cursor = next;
  }
  if (cursor.termId === request.termId) {
    throw domainFault('hierarchy_cycle', 'request.value.parentTermId');
  }
}

function planTargetCommand(
  context: ManualCurationContext,
  request: ApplyManualCurationRequest,
  requestSha256: string,
  state: ManualCurationRepositorySnapshot,
): PreparedApplyManualCurationPlan {
  const evidenceTarget = findEvidenceTarget(
    state,
    context.effectiveWorkspaceId,
    request,
  );
  if (evidenceTarget === undefined) {
    throw domainFault('target_not_found', 'request.target');
  }
  const targetId = deriveCurationTargetId(
    context.effectiveWorkspaceId,
    request.target,
  );
  const currentTarget = state.targets.find(
    (target) =>
      target.workspaceId === context.effectiveWorkspaceId &&
      target.targetId === targetId,
  );
  const currentVersion = currentTarget?.currentVersion ?? 0;
  if (request.expectedTargetVersion !== currentVersion) {
    throw domainFault('stale_revision', 'request.expectedTargetVersion');
  }

  const requestedTerms = collectRequestedTerms(request.operations);
  const terms = new Map<string, VocabularyTermState>();
  for (const [termId, operation] of [...requestedTerms.entries()].sort(
    ([left], [right]) => compareProtocolText(left, right),
  )) {
    const term = findTerm(state, context.effectiveWorkspaceId, termId);
    if (term === undefined) {
      throw domainFault(
        'term_not_found',
        operationPath(operation) as CurationIssue['path'],
      );
    }
    if (
      operation.kind === 'assign_classification' &&
      term.value.lifecycle === 'retired'
    ) {
      throw domainFault(
        'term_retired',
        operationPath(operation) as CurationIssue['path'],
      );
    }
    terms.set(termId, term);
  }

  const currentAssignments = new Map(
    state.assignments
      .filter(
        (assignment) =>
          assignment.workspaceId === context.effectiveWorkspaceId &&
          assignment.targetId === targetId,
      )
      .map((assignment) => [assignment.termId, assignment]),
  );
  let resultingClassificationCount = [...currentAssignments.values()].filter(
    (assignment) => assignment.state === 'assigned',
  ).length;
  for (const operation of request.operations) {
    if (operation.kind === 'assign_classification') {
      if (currentAssignments.get(operation.termId)?.state !== 'assigned') {
        resultingClassificationCount += 1;
      }
    } else if (operation.kind === 'remove_classification') {
      if (currentAssignments.get(operation.termId)?.state === 'assigned') {
        resultingClassificationCount -= 1;
      }
    }
  }
  if (resultingClassificationCount > CURATION_LIMITS.currentClassifications) {
    throw domainFault(
      'limit_exceeded',
      'request.operations',
      'current_classifications',
    );
  }

  const classificationChanges = planClassificationChanges(
    context,
    targetId,
    request.operations,
    terms,
    currentAssignments,
  );
  const decisionChange = planDecisionChange(
    context,
    targetId,
    request.operations,
    state,
  );
  const assessmentChanges = planAssessmentChanges(
    context,
    targetId,
    request.operations,
    state,
  );
  const changed =
    classificationChanges.length > 0 ||
    decisionChange !== undefined ||
    assessmentChanges.length > 0;
  const nextVersion = changed ? currentVersion + 1 : currentVersion;
  if (changed && nextVersion > CURATION_LIMITS.targetVersion) {
    throw domainFault(
      'limit_exceeded',
      'request.expectedTargetVersion',
      'target_version',
    );
  }
  const outcome = changed ? 'applied' : 'unchanged';
  const receipt: ApplyManualCurationReceipt = {
    workspaceId: context.effectiveWorkspaceId,
    commandIdempotencyKey: context.commandIdempotencyKey,
    commandKind: 'apply_manual_curation',
    targetId,
    resultingVersion: nextVersion,
    originalOutcome: outcome,
  };
  const targetInsert =
    currentTarget === undefined
      ? createTargetInsert(evidenceTarget, targetId)
      : undefined;
  return deepFreeze({
    commandKind: 'apply_manual_curation',
    requestSha256,
    outcome,
    receipt,
    targetLock: {
      workspaceId: context.effectiveWorkspaceId,
      targetId,
      expectedVersion: currentVersion,
    },
    termLocks: [...terms.values()]
      .sort((left, right) => compareProtocolText(left.termId, right.termId))
      .map((term) => ({
        termId: term.termId,
        expectedRevision: term.currentRevision,
      })),
    ...(targetInsert === undefined ? {} : {targetInsert}),
    ...(changed
      ? {
          targetVersionCas: {
            workspaceId: context.effectiveWorkspaceId,
            targetId,
            expectedVersion: currentVersion,
            nextVersion,
          },
        }
      : {}),
    classificationChanges,
    ...(decisionChange === undefined ? {} : {decisionChange}),
    assessmentChanges,
    commandInsert: {
      workspaceId: context.effectiveWorkspaceId,
      commandIdempotencyKey: context.commandIdempotencyKey,
      requestSha256,
      commandKind: 'apply_manual_curation',
      authority: 'manual_user',
      targetId,
      outcome,
      resultingVersion: nextVersion,
    },
  });
}

function planClassificationChanges(
  context: ManualCurationContext,
  targetId: string,
  operations: readonly ManualCurationOperation[],
  terms: ReadonlyMap<string, VocabularyTermState>,
  currentAssignments: ReadonlyMap<string, ClassificationAssignmentState>,
): readonly PreparedClassificationChange[] {
  const operationsByTerm = operations
    .filter(
      (
        operation,
      ): operation is Extract<
        ManualCurationOperation,
        {kind: 'assign_classification' | 'remove_classification'}
      > =>
        operation.kind === 'assign_classification' ||
        operation.kind === 'remove_classification',
    )
    .sort((left, right) => compareProtocolText(left.termId, right.termId));
  const changes: PreparedClassificationChange[] = [];
  for (const operation of operationsByTerm) {
    const current = currentAssignments.get(operation.termId);
    const nextState =
      operation.kind === 'assign_classification' ? 'assigned' : 'removed';
    if (
      current?.state === nextState ||
      (current === undefined && nextState === 'removed')
    ) {
      continue;
    }
    const term = terms.get(operation.termId);
    if (term === undefined) {
      throw stateFault();
    }
    const assignmentId = deriveClassificationAssignmentId(
      targetId,
      operation.termId,
    );
    const nextRevision = (current?.currentRevision ?? 0) + 1;
    assertTargetChildRevisionBudget(nextRevision);
    const revisionId = deriveClassificationAssignmentRevisionId(
      assignmentId,
      nextRevision,
    );
    changes.push({
      ...(current === undefined
        ? {
            identityInsert: {
              workspaceId: context.effectiveWorkspaceId,
              assignmentId,
              targetId,
              termId: operation.termId,
              currentRevision: nextRevision,
              currentRevisionId: revisionId,
            },
          }
        : {
            currentPointerCas: {
              workspaceId: context.effectiveWorkspaceId,
              stableId: assignmentId,
              expectedRevision: current.currentRevision,
              nextRevision,
              nextRevisionId: revisionId,
            },
          }),
      revisionInsert: {
        workspaceId: context.effectiveWorkspaceId,
        assignmentId,
        assignmentRevisionId: revisionId,
        revisionNumber: nextRevision,
        state: nextState,
        termId: operation.termId,
        termRevisionNumber: term.currentRevision,
        termRevisionId: term.currentRevisionId,
      },
    });
  }
  return changes;
}

function planDecisionChange(
  context: ManualCurationContext,
  targetId: string,
  operations: readonly ManualCurationOperation[],
  state: ManualCurationRepositorySnapshot,
): PreparedDecisionChange | undefined {
  const operation = operations.find(
    (
      candidate,
    ): candidate is Extract<
      ManualCurationOperation,
      {kind: 'set_intake_decision'}
    > => candidate.kind === 'set_intake_decision',
  );
  if (operation === undefined) {
    return undefined;
  }
  const current = state.decisions.find(
    (decision) =>
      decision.workspaceId === context.effectiveWorkspaceId &&
      decision.targetId === targetId,
  );
  const nextValue: IntakeDecisionValue =
    operation.note === undefined
      ? {action: operation.action, reasonCodes: operation.reasonCodes}
      : {
          action: operation.action,
          reasonCodes: operation.reasonCodes,
          note: operation.note,
        };
  if (current !== undefined && equalDecisionValue(current.value, nextValue)) {
    return undefined;
  }
  const decisionId = deriveIntakeDecisionId(targetId);
  const nextRevision = (current?.currentRevision ?? 0) + 1;
  assertTargetChildRevisionBudget(nextRevision);
  const revisionId = deriveIntakeDecisionRevisionId(decisionId, nextRevision);
  return {
    ...(current === undefined
      ? {
          identityInsert: {
            workspaceId: context.effectiveWorkspaceId,
            decisionId,
            targetId,
            currentRevision: nextRevision,
            currentRevisionId: revisionId,
          },
        }
      : {
          currentPointerCas: {
            workspaceId: context.effectiveWorkspaceId,
            stableId: decisionId,
            expectedRevision: current.currentRevision,
            nextRevision,
            nextRevisionId: revisionId,
          },
        }),
    revisionInsert: {
      workspaceId: context.effectiveWorkspaceId,
      decisionId,
      decisionRevisionId: revisionId,
      revisionNumber: nextRevision,
      value: nextValue,
    },
    reasonInserts: nextValue.reasonCodes.map((reasonCode, reasonOrdinal) => ({
      workspaceId: context.effectiveWorkspaceId,
      decisionId,
      decisionRevisionId: revisionId,
      reasonOrdinal,
      reasonCode,
    })),
  };
}

function planAssessmentChanges(
  context: ManualCurationContext,
  targetId: string,
  operations: readonly ManualCurationOperation[],
  state: ManualCurationRepositorySnapshot,
): readonly PreparedAssessmentChange[] {
  const operationByDimension = new Map(
    operations
      .filter(
        (
          operation,
        ): operation is Extract<
          ManualCurationOperation,
          {kind: 'set_assessment' | 'clear_assessment'}
        > =>
          operation.kind === 'set_assessment' ||
          operation.kind === 'clear_assessment',
      )
      .map((operation) => [operation.dimension, operation]),
  );
  const changes: PreparedAssessmentChange[] = [];
  for (const dimension of ASSESSMENT_DIMENSIONS) {
    const operation = operationByDimension.get(dimension);
    if (operation === undefined) {
      continue;
    }
    const current = state.assessments.find(
      (assessment) =>
        assessment.workspaceId === context.effectiveWorkspaceId &&
        assessment.targetId === targetId &&
        assessment.dimension === dimension,
    );
    const nextValue: AssessmentRevisionValue =
      operation.kind === 'clear_assessment'
        ? {state: 'cleared'}
        : operation.note === undefined
          ? {state: 'rated', score: operation.score}
          : {state: 'rated', score: operation.score, note: operation.note};
    if (
      (current === undefined && nextValue.state === 'cleared') ||
      (current !== undefined && equalAssessmentValue(current.value, nextValue))
    ) {
      continue;
    }
    const assessmentId = deriveAssessmentId(targetId, dimension);
    const nextRevision = (current?.currentRevision ?? 0) + 1;
    assertTargetChildRevisionBudget(nextRevision);
    const revisionId = deriveAssessmentRevisionId(assessmentId, nextRevision);
    changes.push({
      ...(current === undefined
        ? {
            identityInsert: {
              workspaceId: context.effectiveWorkspaceId,
              assessmentId,
              targetId,
              dimension,
              currentRevision: nextRevision,
              currentRevisionId: revisionId,
            },
          }
        : {
            currentPointerCas: {
              workspaceId: context.effectiveWorkspaceId,
              stableId: assessmentId,
              expectedRevision: current.currentRevision,
              nextRevision,
              nextRevisionId: revisionId,
            },
          }),
      revisionInsert: {
        workspaceId: context.effectiveWorkspaceId,
        assessmentId,
        assessmentRevisionId: revisionId,
        revisionNumber: nextRevision,
        value: nextValue,
      },
    });
  }
  return changes;
}

function reconcileTermCommand(
  context: ManualCurationContext,
  requestSha256: string,
  commands: readonly StoredCurationCommandState[],
): PutContentClassificationTermResult | undefined {
  const existing = findCommand(commands, context);
  if (existing === undefined) {
    return undefined;
  }
  if (
    existing.requestSha256 !== requestSha256 ||
    existing.receipt.commandKind !== 'put_content_classification_term'
  ) {
    return rejected('idempotency_conflict', 'context.commandIdempotencyKey');
  }
  return deepFreeze({status: 'replayed', receipt: existing.receipt});
}

function reconcileTargetCommand(
  context: ManualCurationContext,
  requestSha256: string,
  commands: readonly StoredCurationCommandState[],
): ApplyManualCurationResult | undefined {
  const existing = findCommand(commands, context);
  if (existing === undefined) {
    return undefined;
  }
  if (
    existing.requestSha256 !== requestSha256 ||
    existing.receipt.commandKind !== 'apply_manual_curation'
  ) {
    return rejected('idempotency_conflict', 'context.commandIdempotencyKey');
  }
  return deepFreeze({status: 'replayed', receipt: existing.receipt});
}

function findCommand(
  commands: readonly StoredCurationCommandState[],
  context: ManualCurationContext,
): StoredCurationCommandState | undefined {
  return commands.find(
    (command) =>
      command.workspaceId === context.effectiveWorkspaceId &&
      command.commandIdempotencyKey === context.commandIdempotencyKey,
  );
}

function decodeAndValidateRepositoryState(
  input: unknown,
): ManualCurationRepositorySnapshot {
  const state = decodeManualCurationRepositorySnapshot(input);
  validateRepositoryState(state);
  return state;
}

function validateRepositoryState(
  state: ManualCurationRepositorySnapshot,
): void {
  ensureUnique(
    state.evidenceTargets,
    (target) =>
      `${target.workspaceId}|${target.kind}|${target.kind === 'snapshot' ? target.snapshotId : target.fragmentId}`,
  );
  ensureUnique(
    state.targets,
    (target) => `${target.workspaceId}|${target.targetId}`,
  );
  ensureUnique(state.terms, (term) => `${term.workspaceId}|${term.termId}`);
  ensureUnique(
    state.assignments,
    (assignment) => `${assignment.workspaceId}|${assignment.assignmentId}`,
  );
  ensureUnique(
    state.assignments,
    (assignment) =>
      `${assignment.workspaceId}|${assignment.targetId}|${assignment.termId}`,
  );
  ensureUnique(
    state.decisions,
    (decision) => `${decision.workspaceId}|${decision.targetId}`,
  );
  ensureUnique(
    state.assessments,
    (assessment) =>
      `${assessment.workspaceId}|${assessment.targetId}|${assessment.dimension}`,
  );
  ensureUnique(
    state.commands,
    (command) => `${command.workspaceId}|${command.commandIdempotencyKey}`,
  );

  const evidenceTargets = new Map(
    state.evidenceTargets.map((target) => [evidenceTargetKey(target), target]),
  );
  const targets = new Map(
    state.targets.map((target) => [
      `${target.workspaceId}|${target.targetId}`,
      target,
    ]),
  );
  const terms = new Map(
    state.terms.map((term) => [`${term.workspaceId}|${term.termId}`, term]),
  );
  for (const target of state.targets) {
    const targetRef =
      target.kind === 'snapshot'
        ? {kind: target.kind, snapshotId: target.snapshotId}
        : {kind: target.kind, fragmentId: target.fragmentId};
    const evidenceTarget = evidenceTargets.get(evidenceTargetKey(target));
    if (
      target.targetId !==
        deriveCurationTargetId(target.workspaceId, targetRef) ||
      evidenceTarget === undefined ||
      (target.kind === 'snapshot' &&
        (evidenceTarget.kind !== 'snapshot' ||
          evidenceTarget.resourceId !== target.resourceId))
    ) {
      throw stateFault();
    }
  }
  for (const term of state.terms) {
    if (
      term.currentRevisionId !==
      deriveVocabularyTermRevisionId(term.termId, term.currentRevision)
    ) {
      throw stateFault();
    }
    if (
      term.value.parentTermId !== undefined &&
      !terms.has(`${term.workspaceId}|${term.value.parentTermId}`)
    ) {
      throw stateFault();
    }
  }
  validateExistingHierarchy(state.terms);
  for (const assignment of state.assignments) {
    const target = targets.get(
      `${assignment.workspaceId}|${assignment.targetId}`,
    );
    const term = terms.get(`${assignment.workspaceId}|${assignment.termId}`);
    if (
      target === undefined ||
      term === undefined ||
      assignment.assignmentId !==
        deriveClassificationAssignmentId(
          assignment.targetId,
          assignment.termId,
        ) ||
      assignment.currentRevisionId !==
        deriveClassificationAssignmentRevisionId(
          assignment.assignmentId,
          assignment.currentRevision,
        ) ||
      assignment.termRevisionNumber > term.currentRevision ||
      assignment.termRevisionId !==
        deriveVocabularyTermRevisionId(
          assignment.termId,
          assignment.termRevisionNumber,
        ) ||
      assignment.currentRevision > target.currentVersion
    ) {
      throw stateFault();
    }
  }
  const assignedCounts = new Map<string, number>();
  for (const assignment of state.assignments) {
    if (assignment.state === 'assigned') {
      const key = `${assignment.workspaceId}|${assignment.targetId}`;
      const count = (assignedCounts.get(key) ?? 0) + 1;
      if (count > CURATION_LIMITS.currentClassifications) {
        throw stateFault();
      }
      assignedCounts.set(key, count);
    }
  }
  for (const decision of state.decisions) {
    const target = targets.get(`${decision.workspaceId}|${decision.targetId}`);
    if (
      target === undefined ||
      decision.decisionId !== deriveIntakeDecisionId(decision.targetId) ||
      decision.currentRevisionId !==
        deriveIntakeDecisionRevisionId(
          decision.decisionId,
          decision.currentRevision,
        ) ||
      decision.currentRevision > target.currentVersion
    ) {
      throw stateFault();
    }
  }
  for (const assessment of state.assessments) {
    const target = targets.get(
      `${assessment.workspaceId}|${assessment.targetId}`,
    );
    if (
      target === undefined ||
      assessment.assessmentId !==
        deriveAssessmentId(assessment.targetId, assessment.dimension) ||
      assessment.currentRevisionId !==
        deriveAssessmentRevisionId(
          assessment.assessmentId,
          assessment.currentRevision,
        ) ||
      assessment.currentRevision > target.currentVersion
    ) {
      throw stateFault();
    }
  }
  for (const command of state.commands) {
    if (
      command.receipt.workspaceId !== command.workspaceId ||
      command.receipt.commandIdempotencyKey !== command.commandIdempotencyKey
    ) {
      throw stateFault();
    }
    if (command.receipt.commandKind === 'put_content_classification_term') {
      const term = terms.get(
        `${command.workspaceId}|${command.receipt.termId}`,
      );
      if (
        term === undefined ||
        command.receipt.resultingRevision > term.currentRevision
      ) {
        throw stateFault();
      }
    } else {
      const target = targets.get(
        `${command.workspaceId}|${command.receipt.targetId}`,
      );
      if (
        target === undefined ||
        (command.receipt.originalOutcome === 'applied' &&
          command.receipt.resultingVersion === 0) ||
        command.receipt.resultingVersion > target.currentVersion
      ) {
        throw stateFault();
      }
    }
  }
}

function validateExistingHierarchy(
  terms: readonly VocabularyTermState[],
): void {
  const byWorkspace = new Map<string, Map<string, VocabularyTermState>>();
  for (const term of terms) {
    let workspace = byWorkspace.get(term.workspaceId);
    if (workspace === undefined) {
      workspace = new Map();
      byWorkspace.set(term.workspaceId, workspace);
    }
    workspace.set(term.termId, term);
  }

  for (const workspace of byWorkspace.values()) {
    const visitState = new Map<string, 'visiting' | 'complete'>();
    for (const term of workspace.values()) {
      if (visitState.get(term.termId) === 'complete') {
        continue;
      }

      const path: string[] = [];
      let cursor: VocabularyTermState = term;
      for (;;) {
        const currentVisitState = visitState.get(cursor.termId);
        if (currentVisitState === 'complete') {
          break;
        }
        if (currentVisitState === 'visiting') {
          throw stateFault();
        }

        visitState.set(cursor.termId, 'visiting');
        path.push(cursor.termId);
        const parentTermId = cursor.value.parentTermId;
        if (parentTermId === undefined) {
          break;
        }
        const parent = workspace.get(parentTermId);
        if (parent === undefined) {
          throw stateFault();
        }
        cursor = parent;
      }

      for (const termId of path) {
        visitState.set(termId, 'complete');
      }
    }
  }
}

function ensureUnique<Value>(
  values: readonly Value[],
  key: (value: Value) => string,
): void {
  const seen = new Set<string>();
  for (const value of values) {
    const identity = key(value);
    if (seen.has(identity)) {
      throw stateFault();
    }
    seen.add(identity);
  }
}

function evidenceTargetKey(target: EvidenceTargetState): string {
  return target.kind === 'snapshot'
    ? `${target.workspaceId}|snapshot|${target.snapshotId}`
    : `${target.workspaceId}|fragment|${target.fragmentId}`;
}

function findEvidenceTarget(
  state: ManualCurationRepositorySnapshot,
  workspaceId: string,
  request: ApplyManualCurationRequest,
): EvidenceTargetState | undefined {
  return state.evidenceTargets.find((target) => {
    if (
      target.workspaceId !== workspaceId ||
      target.kind !== request.target.kind
    ) {
      return false;
    }
    return request.target.kind === 'snapshot' && target.kind === 'snapshot'
      ? target.snapshotId === request.target.snapshotId
      : request.target.kind === 'fragment' && target.kind === 'fragment'
        ? target.fragmentId === request.target.fragmentId
        : false;
  });
}

function createTargetInsert(
  evidenceTarget: EvidenceTargetState,
  targetId: string,
): CurationTargetInsert {
  return evidenceTarget.kind === 'snapshot'
    ? {
        workspaceId: evidenceTarget.workspaceId,
        kind: evidenceTarget.kind,
        resourceId: evidenceTarget.resourceId,
        snapshotId: evidenceTarget.snapshotId,
        targetId,
        currentVersion: 0,
      }
    : {
        workspaceId: evidenceTarget.workspaceId,
        kind: evidenceTarget.kind,
        fragmentId: evidenceTarget.fragmentId,
        targetId,
        currentVersion: 0,
      };
}

function collectRequestedTerms(
  operations: readonly ManualCurationOperation[],
): ReadonlyMap<
  string,
  Extract<
    ManualCurationOperation,
    {kind: 'assign_classification' | 'remove_classification'}
  > & {readonly operationIndex: number}
> {
  const result = new Map<
    string,
    Extract<
      ManualCurationOperation,
      {kind: 'assign_classification' | 'remove_classification'}
    > & {readonly operationIndex: number}
  >();
  operations.forEach((operation, operationIndex) => {
    if (
      operation.kind === 'assign_classification' ||
      operation.kind === 'remove_classification'
    ) {
      result.set(operation.termId, {...operation, operationIndex});
    }
  });
  return result;
}

function operationPath(operation: Readonly<{operationIndex: number}>): string {
  return `request.operations[${String(operation.operationIndex)}].termId`;
}

function findTerm(
  state: ManualCurationRepositorySnapshot,
  workspaceId: string,
  termId: string,
): VocabularyTermState | undefined {
  return state.terms.find(
    (term) => term.workspaceId === workspaceId && term.termId === termId,
  );
}

function termsForWorkspace(
  state: ManualCurationRepositorySnapshot,
  workspaceId: string,
): ReadonlyMap<string, VocabularyTermState> {
  return new Map(
    state.terms
      .filter((term) => term.workspaceId === workspaceId)
      .map((term) => [term.termId, term]),
  );
}

function equalTermValue(
  left: VocabularyTermValue,
  right: VocabularyTermValue,
): boolean {
  return (
    left.displayName === right.displayName &&
    optionalText(left.description) === optionalText(right.description) &&
    optionalText(left.parentTermId) === optionalText(right.parentTermId) &&
    left.lifecycle === right.lifecycle
  );
}

function equalDecisionValue(
  left: IntakeDecisionValue,
  right: IntakeDecisionValue,
): boolean {
  return (
    left.action === right.action &&
    optionalText(left.note) === optionalText(right.note) &&
    equalStringArray(left.reasonCodes, right.reasonCodes)
  );
}

function equalAssessmentValue(
  left: AssessmentRevisionValue,
  right: AssessmentRevisionValue,
): boolean {
  if (left.state !== right.state) {
    return false;
  }
  if (left.state === 'cleared' || right.state === 'cleared') {
    return true;
  }
  return (
    left.score === right.score &&
    optionalText(left.note) === optionalText(right.note)
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

function optionalText(value: string | undefined): string | undefined {
  return value;
}

function copyTermReceipt(
  receipt: PutContentClassificationTermReceipt,
): PutContentClassificationTermReceipt {
  return {
    workspaceId: receipt.workspaceId,
    commandIdempotencyKey: receipt.commandIdempotencyKey,
    commandKind: receipt.commandKind,
    termId: receipt.termId,
    resultingRevision: receipt.resultingRevision,
    originalOutcome: receipt.originalOutcome,
  };
}

function copyTargetReceipt(
  receipt: ApplyManualCurationReceipt,
): ApplyManualCurationReceipt {
  return {
    workspaceId: receipt.workspaceId,
    commandIdempotencyKey: receipt.commandIdempotencyKey,
    commandKind: receipt.commandKind,
    targetId: receipt.targetId,
    resultingVersion: receipt.resultingVersion,
    originalOutcome: receipt.originalOutcome,
  };
}

function compareProtocolText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function assertTargetChildRevisionBudget(revision: number): void {
  if (revision > CURATION_LIMITS.revisionNumber) {
    throw domainFault(
      'limit_exceeded',
      'request.expectedTargetVersion',
      'target_version',
    );
  }
}

function rejectedFromError(error: unknown): CurationRejectedResult {
  if (error instanceof CurationInputFault) {
    return error.budget === undefined
      ? rejected(error.code, error.path)
      : rejected(error.code, error.path, error.budget);
  }
  throw error;
}

function rejected(
  code: CurationIssue['code'],
  path: CurationIssue['path'],
  budget?: Extract<CurationIssue, {code: 'limit_exceeded'}>['budget'],
): CurationRejectedResult {
  const issue =
    code === 'limit_exceeded' && budget !== undefined
      ? {code, path, budget}
      : {code: code as Exclude<CurationIssue['code'], 'limit_exceeded'>, path};
  return deepFreeze({status: 'rejected', issue});
}

function domainFault(
  code: Exclude<CurationIssue['code'], 'persistence_failed'>,
  path: CurationIssue['path'],
  budget?: Extract<CurationIssue, {code: 'limit_exceeded'}>['budget'],
): CurationInputFault {
  return new CurationInputFault(code, path, budget);
}

function stateFault(): CurationInputFault {
  return new CurationInputFault('invalid_shape', 'state');
}
