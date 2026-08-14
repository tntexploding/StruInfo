import {readFileSync, readdirSync} from 'node:fs';

import {describe, expect, it, vi} from 'vitest';

import {
  KNOWLEDGE_CANONICAL_KNOWN_ANSWER,
  KNOWLEDGE_LIMITS,
  KNOWLEDGE_NUMERIC_ISSUE_ORACLES,
  KNOWLEDGE_TM1_LEDGER,
  KNOWLEDGE_UUID_KNOWN_ANSWERS,
  SYNTHETIC_KNOWLEDGE_IDS,
  SYNTHETIC_KNOWLEDGE_TEXT,
  createInheritedAccessorRequest,
  createInheritedSetterRequest,
  createOwnAccessorRequest,
  createSaturatedKnowledgeProjection,
  createSmallKnowledgeCommandProjection,
  createSyntheticEligibleRequest,
  createSyntheticItemOperation,
  createSyntheticKnowledgeContext,
  createSyntheticManualRequest,
  createSyntheticNewCommandState,
  createTrapCounter,
  createZeroTrapProxy,
  encodeIndependentCanonicalJson,
  independentUuidV5,
  measureIndependentCanonicalJson,
  sha256,
  type KnowledgeIssueOracle,
  type KnowledgeTm1LedgerRow,
  type NumericIssueOracle,
} from '../../../test_support/manual_knowledge_tm1_oracle.js';

type PrepareKnowledge = (
  context: unknown,
  request: unknown,
  state: unknown,
) => unknown;

interface KnowledgePublicModule {
  readonly prepareApplyManualKnowledgeChangeSet: PrepareKnowledge;
}

const publicModuleUrl = new URL('./index.js', import.meta.url).href;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

async function loadPublicKnowledgeModule(
  row: KnowledgeTm1LedgerRow,
): Promise<KnowledgePublicModule> {
  let imported: unknown;
  try {
    imported = (await import(publicModuleUrl)) as unknown;
  } catch (error) {
    const cause =
      error instanceof Error ? error.message : 'unknown import error';
    throw new Error(`${row.id} requires the public knowledge index; ${cause}`, {
      cause: error,
    });
  }
  if (!isRecord(imported)) {
    throw new TypeError(
      `${row.id} public knowledge index is not a module record.`,
    );
  }
  const prepare = imported.prepareApplyManualKnowledgeChangeSet;
  if (typeof prepare !== 'function') {
    throw new TypeError(
      `${row.id} requires public export prepareApplyManualKnowledgeChangeSet.`,
    );
  }
  return {prepareApplyManualKnowledgeChangeSet: prepare as PrepareKnowledge};
}

function expectClosedPreparation(
  value: unknown,
  row: KnowledgeTm1LedgerRow,
): void {
  expect(isRecord(value), `${row.id} preparation must be a closed record`).toBe(
    true,
  );
  if (!isRecord(value))
    throw new TypeError(`${row.id} preparation was not a record.`);
  expect(
    ['prepared', 'resolved'],
    `${row.id} preparation discriminator`,
  ).toContain(value.kind);
}

function expectedResolvedIssue(
  issue: KnowledgeIssueOracle,
): Readonly<Record<string, unknown>> {
  return {kind: 'resolved', result: {status: 'rejected', issue}};
}

type AcceptedOutcome = 'applied' | 'unchanged';

type ModuleExpectation =
  | Readonly<{
      kind: 'issue';
      issue: KnowledgeIssueOracle;
    }>
  | Readonly<{
      kind: 'prepared';
      outcome: AcceptedOutcome;
      authorizationKind?: 'eligible_target' | 'manual_edit';
      operationOutcomes?: readonly AcceptedOutcome[];
    }>
  | Readonly<{
      kind: 'replayed';
      originalOutcome: AcceptedOutcome;
    }>;

interface ModuleFixture {
  readonly context: unknown;
  readonly request: unknown;
  readonly state: unknown;
  readonly expectation: ModuleExpectation;
}

interface KnowledgeStateFixture {
  readonly [key: string]: unknown[];
  curationTargets: unknown[];
  intakeDecisions: unknown[];
  fragments: unknown[];
  items: unknown[];
  revisions: unknown[];
  relations: unknown[];
  relationRevisions: unknown[];
  changeSets: unknown[];
  changeOperations: unknown[];
  changeEvents: unknown[];
}

const ADDITIONAL_IDS = Object.freeze({
  fragmentC: '40000000-0000-4000-8000-000000000003',
  fragmentMissing: '40000000-0000-4000-8000-000000000099',
  resourceB: '50000000-0000-4000-8000-000000000002',
  snapshotB: '60000000-0000-4000-8000-000000000002',
  decisionRevisionA: '70000000-0000-4000-8000-000000000001',
});

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (!isRecord(value)) throw new TypeError(`${label} must be a record.`);
  return value;
}

function requireRecordField(
  value: Record<string, unknown>,
  field: string,
): Record<string, unknown> {
  return requireRecord(value[field], field);
}

function requireArrayField(
  value: Record<string, unknown>,
  field: string,
): unknown[] {
  const array = value[field];
  if (!Array.isArray(array)) throw new TypeError(`${field} must be an array.`);
  return array;
}

function freshState(): KnowledgeStateFixture {
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

function requireState(value: unknown): KnowledgeStateFixture {
  if (!isRecord(value)) throw new TypeError('state must be a record.');
  for (const field of [
    'curationTargets',
    'intakeDecisions',
    'fragments',
    'items',
    'revisions',
    'relations',
    'relationRevisions',
    'changeSets',
    'changeOperations',
    'changeEvents',
  ]) {
    if (!Array.isArray(value[field])) {
      throw new TypeError(`state.${field} must be an array.`);
    }
  }
  return value as KnowledgeStateFixture;
}

function provenance(
  citations: readonly string[] = [SYNTHETIC_KNOWLEDGE_IDS.fragmentA],
  fragmentDerivations: readonly string[] = [],
  knowledgeDerivations: readonly Record<string, unknown>[] = [],
): Record<string, unknown> {
  return {
    citations: [...citations],
    fragmentDerivations: [...fragmentDerivations],
    knowledgeDerivations: knowledgeDerivations.map((entry) => ({...entry})),
  };
}

function itemValue(
  overrides: Readonly<Record<string, unknown>> = {},
): Record<string, unknown> {
  return {
    knowledgeKind: 'assertion',
    epistemicRole: 'source_claim',
    reviewState: 'draft',
    title: SYNTHETIC_KNOWLEDGE_TEXT.title,
    ...overrides,
  };
}

function relationValue(
  overrides: Readonly<Record<string, unknown>> = {},
): Record<string, unknown> {
  return {
    subjectItemId: SYNTHETIC_KNOWLEDGE_IDS.itemA,
    relationTypeKey: SYNTHETIC_KNOWLEDGE_TEXT.relationTypeKey,
    objectItemId: SYNTHETIC_KNOWLEDGE_IDS.itemB,
    epistemicRole: 'source_claim',
    reviewState: 'draft',
    qualifier: SYNTHETIC_KNOWLEDGE_TEXT.qualifier,
    ...overrides,
  };
}

function itemOperation(
  overrides: Readonly<Record<string, unknown>> = {},
): Record<string, unknown> {
  return {
    kind: 'put_item',
    itemId: SYNTHETIC_KNOWLEDGE_IDS.itemA,
    expectedRevision: 0,
    value: itemValue(),
    provenance: provenance(),
    ...overrides,
  };
}

function relationOperation(
  overrides: Readonly<Record<string, unknown>> = {},
): Record<string, unknown> {
  return {
    kind: 'put_relation',
    relationId: SYNTHETIC_KNOWLEDGE_IDS.relationA,
    expectedRevision: 0,
    value: relationValue(),
    provenance: provenance(),
    ...overrides,
  };
}

function manualRequest(
  operations: readonly Record<string, unknown>[],
): Record<string, unknown> {
  return {
    authorization: {kind: 'manual_edit'},
    operations: operations.map((operation) => structuredClone(operation)),
  };
}

function fragmentState(
  fragmentId: string = SYNTHETIC_KNOWLEDGE_IDS.fragmentA,
  overrides: Readonly<Record<string, unknown>> = {},
): Record<string, unknown> {
  return {
    workspaceId: SYNTHETIC_KNOWLEDGE_IDS.workspaceA,
    resourceId: SYNTHETIC_KNOWLEDGE_IDS.resourceA,
    snapshotId: SYNTHETIC_KNOWLEDGE_IDS.snapshotA,
    fragmentId,
    selectedTextSha256: sha256(SYNTHETIC_KNOWLEDGE_TEXT.excerpt),
    ...overrides,
  };
}

function revisionId(itemId: string, revision: number): string {
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

function addCurrentItem(
  state: KnowledgeStateFixture,
  itemId: string,
  revision: number,
  value: Readonly<Record<string, unknown>> = itemValue(),
  inputProvenance: Readonly<Record<string, unknown>> = provenance(),
): void {
  const currentRevisionId = revisionId(itemId, revision);
  state.items.push({
    workspaceId: SYNTHETIC_KNOWLEDGE_IDS.workspaceA,
    itemId,
    currentRevision: revision,
    currentRevisionId,
  });
  state.revisions.push({
    workspaceId: SYNTHETIC_KNOWLEDGE_IDS.workspaceA,
    itemId,
    revision,
    revisionId: currentRevisionId,
    ...(revision === 1
      ? {}
      : {previousRevisionId: revisionId(itemId, revision - 1)}),
    value: structuredClone(value),
    provenance: structuredClone(inputProvenance),
  });
}

function addCurrentRelation(
  state: KnowledgeStateFixture,
  relationId: string,
  revision: number,
  value: Readonly<Record<string, unknown>> = relationValue(),
  inputProvenance: Readonly<Record<string, unknown>> = provenance(),
): void {
  const currentRevisionId = relationRevisionId(relationId, revision);
  state.relations.push({
    workspaceId: SYNTHETIC_KNOWLEDGE_IDS.workspaceA,
    relationId,
    subjectItemId: value.subjectItemId,
    relationTypeKey: value.relationTypeKey,
    objectItemId: value.objectItemId,
    currentRevision: revision,
    currentRevisionId,
  });
  state.relationRevisions.push({
    workspaceId: SYNTHETIC_KNOWLEDGE_IDS.workspaceA,
    relationId,
    revision,
    revisionId: currentRevisionId,
    ...(revision === 1
      ? {}
      : {previousRevisionId: relationRevisionId(relationId, revision - 1)}),
    value: structuredClone(value),
    provenance: structuredClone(inputProvenance),
  });
}

function addEndpointItems(
  state: KnowledgeStateFixture,
  reviewState: 'draft' | 'withdrawn' = 'draft',
): void {
  const value = itemValue({reviewState});
  addCurrentItem(state, SYNTHETIC_KNOWLEDGE_IDS.itemA, 1, value);
  addCurrentItem(state, SYNTHETIC_KNOWLEDGE_IDS.itemB, 1, value);
}

function manualFixture(
  operations: readonly Record<string, unknown>[] = [itemOperation()],
  state?: KnowledgeStateFixture,
  expectation: ModuleExpectation = {kind: 'prepared', outcome: 'applied'},
): ModuleFixture {
  const repositoryState = state ?? freshState();
  if (state === undefined) repositoryState.fragments.push(fragmentState());
  return {
    context: createSyntheticKnowledgeContext(),
    request: manualRequest(operations),
    state: repositoryState,
    expectation,
  };
}

function eligibleIds(kind: 'fragment' | 'snapshot'): Readonly<{
  targetId: string;
  decisionId: string;
  decisionRevisionId: string;
}> {
  const targetName =
    kind === 'fragment'
      ? `struinfo:curation-target:v1:fragment:${SYNTHETIC_KNOWLEDGE_IDS.fragmentA}`
      : `struinfo:curation-target:v1:snapshot:${SYNTHETIC_KNOWLEDGE_IDS.snapshotA}`;
  const targetId = independentUuidV5(
    SYNTHETIC_KNOWLEDGE_IDS.workspaceA,
    targetName,
  );
  const decisionId = independentUuidV5(targetId, 'struinfo:intake-decision:v1');
  return {
    targetId,
    decisionId,
    decisionRevisionId: independentUuidV5(
      decisionId,
      'struinfo:intake-decision-revision:v1:1',
    ),
  };
}

function eligibleFixture(
  kind: 'fragment' | 'snapshot',
  action:
    | 'condense'
    | 'full'
    | 'ignore'
    | 'needs_review'
    | 'source_only'
    | 'split' = 'full',
  operation: Record<string, unknown> = itemOperation(),
): ModuleFixture {
  const state = freshState();
  const ids = eligibleIds(kind);
  state.curationTargets.push(
    kind === 'fragment'
      ? {
          workspaceId: SYNTHETIC_KNOWLEDGE_IDS.workspaceA,
          targetId: ids.targetId,
          kind,
          fragmentId: SYNTHETIC_KNOWLEDGE_IDS.fragmentA,
        }
      : {
          workspaceId: SYNTHETIC_KNOWLEDGE_IDS.workspaceA,
          targetId: ids.targetId,
          kind,
          resourceId: SYNTHETIC_KNOWLEDGE_IDS.resourceA,
          snapshotId: SYNTHETIC_KNOWLEDGE_IDS.snapshotA,
        },
  );
  state.intakeDecisions.push({
    workspaceId: SYNTHETIC_KNOWLEDGE_IDS.workspaceA,
    targetId: ids.targetId,
    decisionId: ids.decisionId,
    currentRevision: 1,
    currentRevisionId: ids.decisionRevisionId,
    action,
  });
  state.fragments.push(fragmentState());
  const request = createSyntheticEligibleRequest(kind);
  request.operations = [structuredClone(operation)];
  return {
    context: createSyntheticKnowledgeContext(),
    request,
    state,
    expectation: {
      kind: 'prepared',
      outcome: 'applied',
      authorizationKind: 'eligible_target',
    },
  };
}

function setEligibleOperation(
  fixture: ModuleFixture,
  operation: Record<string, unknown>,
): ModuleFixture {
  const request = requireRecord(structuredClone(fixture.request), 'request');
  request.operations = [structuredClone(operation)];
  return {...fixture, request};
}

function expectModuleResult(
  actual: unknown,
  row: KnowledgeTm1LedgerRow,
  expectation: ModuleExpectation,
): void {
  if (expectation.kind === 'issue') {
    expect(actual, row.id).toEqual(expectedResolvedIssue(expectation.issue));
    return;
  }
  expectClosedPreparation(actual, row);
  const preparation = requireRecord(actual, `${row.id} preparation`);
  if (expectation.kind === 'replayed') {
    expect(preparation.kind, row.id).toBe('resolved');
    const result = requireRecord(preparation.result, `${row.id} result`);
    expect(result.status, row.id).toBe('replayed');
    const receipt = requireRecord(result.receipt, `${row.id} receipt`);
    expect(receipt.originalOutcome, row.id).toBe(expectation.originalOutcome);
    return;
  }
  expect(preparation.kind, row.id).toBe('prepared');
  const plan = requireRecord(preparation.plan, `${row.id} plan`);
  expect(plan.outcome, row.id).toBe(expectation.outcome);
  const receipt = requireRecord(plan.receipt, `${row.id} receipt`);
  expect(receipt.originalOutcome, row.id).toBe(expectation.outcome);
  if (expectation.authorizationKind !== undefined) {
    expect(
      requireRecord(receipt.authorization, `${row.id} authorization`).kind,
      row.id,
    ).toBe(expectation.authorizationKind);
  }
  if (expectation.operationOutcomes !== undefined) {
    const operations = requireArrayField(receipt, 'operations');
    expect(
      operations.map(
        (operation) =>
          requireRecord(operation, `${row.id} operation receipt`).outcome,
      ),
      row.id,
    ).toEqual(expectation.operationOutcomes);
  }
}

function expectDeepFrozen(value: unknown, label: string): void {
  const seen = new WeakSet<object>();
  const visit = (entry: unknown, path: string): void => {
    if (entry === null || typeof entry !== 'object' || seen.has(entry)) return;
    seen.add(entry);
    expect(Object.isFrozen(entry), path).toBe(true);
    for (const key of Reflect.ownKeys(entry)) {
      const descriptor = Object.getOwnPropertyDescriptor(entry, key);
      if (descriptor === undefined || !('value' in descriptor)) continue;
      visit(descriptor.value, `${path}.${String(key)}`);
    }
  };
  visit(value, label);
}

function withIssue(
  fixture: ModuleFixture,
  code: string,
  path: string,
  budget?: string,
): ModuleFixture {
  const issue = budget === undefined ? {code, path} : {code, path, budget};
  return {...fixture, expectation: {kind: 'issue', issue}};
}

function existingItemFixture(
  requestedValue: Readonly<Record<string, unknown>>,
  requestedProvenance: Readonly<Record<string, unknown>> = provenance(),
  currentValue: Readonly<Record<string, unknown>> = itemValue(),
  currentProvenance: Readonly<Record<string, unknown>> = provenance(),
  currentRevision = 1,
): ModuleFixture {
  const state = freshState();
  state.fragments.push(fragmentState());
  addCurrentItem(
    state,
    SYNTHETIC_KNOWLEDGE_IDS.itemA,
    currentRevision,
    currentValue,
    currentProvenance,
  );
  const equal =
    JSON.stringify(requestedValue) === JSON.stringify(currentValue) &&
    JSON.stringify(requestedProvenance) === JSON.stringify(currentProvenance);
  return manualFixture(
    [
      itemOperation({
        expectedRevision: currentRevision,
        value: structuredClone(requestedValue),
        provenance: structuredClone(requestedProvenance),
      }),
    ],
    state,
    {
      kind: 'prepared',
      outcome: equal ? 'unchanged' : 'applied',
      authorizationKind: 'manual_edit',
      operationOutcomes: [equal ? 'unchanged' : 'applied'],
    },
  );
}

function existingRelationFixture(
  requestedValue: Readonly<Record<string, unknown>>,
  requestedProvenance: Readonly<Record<string, unknown>> = provenance(),
  currentValue: Readonly<Record<string, unknown>> = relationValue(),
  currentProvenance: Readonly<Record<string, unknown>> = provenance(),
  currentRevision = 1,
  endpointReviewState: 'draft' | 'withdrawn' = 'draft',
): ModuleFixture {
  const state = freshState();
  state.fragments.push(fragmentState());
  addEndpointItems(state, endpointReviewState);
  addCurrentRelation(
    state,
    SYNTHETIC_KNOWLEDGE_IDS.relationA,
    currentRevision,
    currentValue,
    currentProvenance,
  );
  const equal =
    JSON.stringify(requestedValue) === JSON.stringify(currentValue) &&
    JSON.stringify(requestedProvenance) === JSON.stringify(currentProvenance);
  return manualFixture(
    [
      relationOperation({
        expectedRevision: currentRevision,
        value: structuredClone(requestedValue),
        provenance: structuredClone(requestedProvenance),
      }),
    ],
    state,
    {
      kind: 'prepared',
      outcome: equal ? 'unchanged' : 'applied',
      authorizationKind: 'manual_edit',
      operationOutcomes: [equal ? 'unchanged' : 'applied'],
    },
  );
}

function relationCreateFixture(
  operation: Record<string, unknown> = relationOperation(),
  endpointReviewState: 'draft' | 'withdrawn' = 'draft',
): ModuleFixture {
  const state = freshState();
  state.fragments.push(fragmentState());
  addEndpointItems(state, endpointReviewState);
  return manualFixture([operation], state, {
    kind: 'prepared',
    outcome: 'applied',
    authorizationKind: 'manual_edit',
    operationOutcomes: ['applied'],
  });
}

function historicalItemDerivation(
  itemId: string = SYNTHETIC_KNOWLEDGE_IDS.itemB,
  revision = 1,
): Record<string, unknown> {
  return {kind: 'item', itemId, revision};
}

function historicalRelationDerivation(
  relationId: string = SYNTHETIC_KNOWLEDGE_IDS.relationB,
  revision = 1,
): Record<string, unknown> {
  return {kind: 'relation', relationId, revision};
}

function addHistoricalItem(
  state: KnowledgeStateFixture,
  itemId: string = SYNTHETIC_KNOWLEDGE_IDS.itemB,
  currentRevision = 1,
  requestedRevision = 1,
): void {
  addCurrentItem(state, itemId, currentRevision);
  if (requestedRevision !== currentRevision) {
    state.revisions.unshift({
      workspaceId: SYNTHETIC_KNOWLEDGE_IDS.workspaceA,
      itemId,
      revision: requestedRevision,
      revisionId: revisionId(itemId, requestedRevision),
      ...(requestedRevision === 1
        ? {}
        : {previousRevisionId: revisionId(itemId, requestedRevision - 1)}),
      value: itemValue({title: 'synthetic-historical-title'}),
      provenance: provenance(),
    });
  }
}

function addHistoricalRelation(
  state: KnowledgeStateFixture,
  relationId: string = SYNTHETIC_KNOWLEDGE_IDS.relationB,
  currentRevision = 1,
  requestedRevision = 1,
): void {
  addEndpointItems(state);
  addCurrentRelation(state, relationId, currentRevision);
  if (requestedRevision !== currentRevision) {
    state.relationRevisions.unshift({
      workspaceId: SYNTHETIC_KNOWLEDGE_IDS.workspaceA,
      relationId,
      revision: requestedRevision,
      revisionId: relationRevisionId(relationId, requestedRevision),
      ...(requestedRevision === 1
        ? {}
        : {
            previousRevisionId: relationRevisionId(
              relationId,
              requestedRevision - 1,
            ),
          }),
      value: relationValue(),
      provenance: provenance(),
    });
  }
}

function storedReceipt(
  originalOutcome: AcceptedOutcome = 'applied',
): Record<string, unknown> {
  return {
    workspaceId: SYNTHETIC_KNOWLEDGE_IDS.workspaceA,
    commandIdempotencyKey: SYNTHETIC_KNOWLEDGE_TEXT.commandKey,
    changeSetId: KNOWLEDGE_UUID_KNOWN_ANSWERS.changeSetId,
    commandKind: 'apply_manual_knowledge_change_set',
    authorization: {kind: 'manual_edit'},
    originalOutcome,
    operations: [
      {
        operationIndex: 0,
        operationKind: 'put_item',
        itemId: SYNTHETIC_KNOWLEDGE_IDS.itemA,
        resultingRevision: 1,
        resultingRevisionId: KNOWLEDGE_UUID_KNOWN_ANSWERS.itemRevisionId,
        outcome: originalOutcome,
      },
    ],
  };
}

function storedCommandState(
  originalOutcome: AcceptedOutcome = 'applied',
  requestSha256 = KNOWLEDGE_CANONICAL_KNOWN_ANSWER.sha256,
): KnowledgeStateFixture {
  const state = freshState();
  const receipt = storedReceipt(originalOutcome);
  state.changeSets.push({
    workspaceId: SYNTHETIC_KNOWLEDGE_IDS.workspaceA,
    commandIdempotencyKey: SYNTHETIC_KNOWLEDGE_TEXT.commandKey,
    changeSetId: KNOWLEDGE_UUID_KNOWN_ANSWERS.changeSetId,
    requestSha256,
    authorization: {kind: 'manual_edit'},
    originalOutcome,
    operationCount: 1,
  });
  const operations = requireArrayField(receipt, 'operations');
  const operation = requireRecord(operations[0], 'stored operation');
  state.changeOperations.push({
    workspaceId: SYNTHETIC_KNOWLEDGE_IDS.workspaceA,
    changeSetId: KNOWLEDGE_UUID_KNOWN_ANSWERS.changeSetId,
    ...operation,
  });
  state.changeEvents.push({
    workspaceId: SYNTHETIC_KNOWLEDGE_IDS.workspaceA,
    eventId: KNOWLEDGE_UUID_KNOWN_ANSWERS.eventId,
    eventKind: 'knowledge_change_set_committed',
    eventSchemaVersion: 1,
    changeSetId: KNOWLEDGE_UUID_KNOWN_ANSWERS.changeSetId,
  });
  return state;
}

function replayFixture(
  originalOutcome: AcceptedOutcome = 'applied',
): ModuleFixture {
  return {
    context: createSyntheticKnowledgeContext(),
    request: createSyntheticManualRequest(),
    state: storedCommandState(originalOutcome),
    expectation: {kind: 'replayed', originalOutcome},
  };
}

function firstOperation(
  request: Record<string, unknown>,
): Record<string, unknown> {
  const operations = request.operations;
  if (!Array.isArray(operations) || !isRecord(operations[0])) {
    throw new TypeError('Synthetic operation fixture is malformed.');
  }
  return operations[0];
}

function setOperationExpectedRevision(
  request: Record<string, unknown>,
  value: unknown,
): void {
  Object.defineProperty(firstOperation(request), 'expectedRevision', {
    configurable: true,
    enumerable: true,
    value,
    writable: true,
  });
}

function setExpectedDecisionRevision(
  request: Record<string, unknown>,
  value: unknown,
): void {
  const authorization = request.authorization;
  if (!isRecord(authorization)) {
    throw new TypeError('Synthetic authorization fixture is malformed.');
  }
  Object.defineProperty(authorization, 'expectedDecisionRevision', {
    configurable: true,
    enumerable: true,
    value,
    writable: true,
  });
}

function setDerivationRevision(
  request: Record<string, unknown>,
  value: unknown,
): void {
  firstOperation(request).provenance = {
    citations: [],
    fragmentDerivations: [],
    knowledgeDerivations: [
      {kind: 'item', itemId: SYNTHETIC_KNOWLEDGE_IDS.itemB, revision: value},
    ],
  };
}

function numericFixture(oracle: NumericIssueOracle): ModuleFixture {
  let fixture = manualFixture();
  let request = requireRecord(fixture.request, 'request');
  if (oracle.field === 'operation_expected_revision') {
    setOperationExpectedRevision(request, oracle.value);
    if (
      oracle.accepted &&
      typeof oracle.value === 'number' &&
      oracle.value > 0
    ) {
      const state = freshState();
      state.fragments.push(fragmentState());
      addCurrentItem(state, SYNTHETIC_KNOWLEDGE_IDS.itemA, oracle.value);
      fixture = manualFixture(
        [itemOperation({expectedRevision: oracle.value})],
        state,
        {
          kind: 'prepared',
          outcome: 'unchanged',
          operationOutcomes: ['unchanged'],
        },
      );
    }
  } else if (oracle.field === 'expected_decision_revision') {
    fixture = eligibleFixture('fragment');
    request = requireRecord(fixture.request, 'request');
    setExpectedDecisionRevision(request, oracle.value);
    if (oracle.accepted && typeof oracle.value === 'number') {
      const decision = requireRecord(
        requireArrayField(requireState(fixture.state), 'intakeDecisions')[0],
        'intake decision',
      );
      const decisionId = decision.decisionId;
      if (typeof decisionId !== 'string') {
        throw new TypeError('Synthetic decision ID is missing.');
      }
      decision.currentRevision = oracle.value;
      decision.currentRevisionId = independentUuidV5(
        decisionId,
        `struinfo:intake-decision-revision:v1:${String(oracle.value)}`,
      );
    }
  } else if (oracle.field === 'derivation_revision') {
    const state = freshState();
    if (oracle.accepted && typeof oracle.value === 'number') {
      addHistoricalItem(
        state,
        SYNTHETIC_KNOWLEDGE_IDS.itemB,
        oracle.value,
        oracle.value,
      );
    }
    fixture = manualFixture(
      [
        itemOperation({
          value: itemValue({epistemicRole: 'user_assertion'}),
          provenance: provenance(
            [],
            [],
            [
              historicalItemDerivation(
                SYNTHETIC_KNOWLEDGE_IDS.itemB,
                typeof oracle.value === 'number' ? oracle.value : 1,
              ),
            ],
          ),
        }),
      ],
      state,
    );
    request = requireRecord(fixture.request, 'request');
    setDerivationRevision(request, oracle.value);
  } else {
    const state = freshState();
    state.fragments.push(fragmentState());
    state.items.push({
      workspaceId: SYNTHETIC_KNOWLEDGE_IDS.workspaceA,
      itemId: SYNTHETIC_KNOWLEDGE_IDS.itemA,
      currentRevision: oracle.value,
      currentRevisionId: independentUuidV5(
        SYNTHETIC_KNOWLEDGE_IDS.itemA,
        'struinfo:knowledge-revision:v1:1',
      ),
    });
    fixture = manualFixture(
      [itemOperation({expectedRevision: KNOWLEDGE_LIMITS.revisionNumber})],
      state,
    );
    request = requireRecord(fixture.request, 'request');
    setOperationExpectedRevision(request, KNOWLEDGE_LIMITS.revisionNumber);
  }
  return oracle.issue === undefined
    ? fixture
    : {...fixture, expectation: {kind: 'issue', issue: oracle.issue}};
}

async function evaluateNumericCase(
  row: KnowledgeTm1LedgerRow,
  oracle: NumericIssueOracle,
): Promise<void> {
  const module = await loadPublicKnowledgeModule(row);
  const fixture = numericFixture(oracle);
  const actual = module.prepareApplyManualKnowledgeChangeSet(
    fixture.context,
    fixture.request,
    fixture.state,
  );
  expectModuleResult(actual, row, fixture.expectation);
}

async function evaluateHostileCase(row: KnowledgeTm1LedgerRow): Promise<void> {
  const module = await loadPublicKnowledgeModule(row);
  let context: unknown = createSyntheticKnowledgeContext();
  let state: unknown = createSyntheticNewCommandState();
  const counter = createTrapCounter();
  let request: unknown = createSyntheticManualRequest();
  let expectedPath = 'request';
  switch (row.ordinal) {
    case 165:
      request = createOwnAccessorRequest(counter);
      expectedPath = 'request.authorization';
      break;
    case 166:
      request = createInheritedAccessorRequest(counter);
      expectedPath = 'request.authorization';
      break;
    case 167:
      request = createInheritedSetterRequest(counter);
      expectedPath = 'request.authorization';
      break;
    case 168:
      context = createZeroTrapProxy(counter);
      expectedPath = 'context';
      break;
    case 169:
      request = createZeroTrapProxy(counter);
      break;
    case 170:
      state = createZeroTrapProxy(counter);
      expectedPath = 'state';
      break;
    case 171: {
      const manual = createSyntheticManualRequest();
      manual.operations = createZeroTrapProxy(counter);
      request = manual;
      expectedPath = 'request.operations';
      break;
    }
    case 172:
      Object.defineProperty(request, '__proto__', {
        enumerable: true,
        value: 'synthetic-dangerous-key',
      });
      break;
    case 173:
      Object.defineProperty(request, Symbol('synthetic'), {
        enumerable: true,
        value: 'synthetic-symbol',
      });
      break;
    case 174: {
      const sparse = new Array<unknown>(2);
      sparse[0] = createSyntheticItemOperation();
      const manual = createSyntheticManualRequest();
      manual.operations = sparse;
      request = manual;
      expectedPath = 'request.operations';
      break;
    }
    case 175: {
      const cyclic = createSyntheticManualRequest();
      cyclic.cycle = cyclic;
      request = cyclic;
      break;
    }
    case 176:
      request = Object.create({synthetic: true}) as object;
      break;
    case 177:
    case 178:
    case 179: {
      const actual = module.prepareApplyManualKnowledgeChangeSet(
        context,
        request,
        state,
      );
      expectClosedPreparation(actual, row);
      expect(Object.isFrozen(request), `${row.id} caller request`).toBe(false);
      if (row.ordinal === 178) {
        const before = JSON.stringify(actual);
        const requestRecord = requireRecord(request, 'request');
        requireRecordField(firstOperation(requestRecord), 'value').title =
          'synthetic-caller-mutation-after-prepare';
        expect(JSON.stringify(actual), row.id).toBe(before);
      }
      if (row.ordinal === 179) expectDeepFrozen(actual, row.id);
      return;
    }
    case 180:
      request = {authorization: {kind: 'manual_edit'}, operations: []};
      expectedPath = 'request.operations';
      break;
    default:
      throw new RangeError(`${row.id} is not a hostile-input row.`);
  }
  const actual = module.prepareApplyManualKnowledgeChangeSet(
    context,
    request,
    state,
  );
  expect(actual, row.id).toEqual(
    expectedResolvedIssue({
      code: row.ordinal === 180 ? 'invalid_state' : 'invalid_shape',
      path: expectedPath,
    }),
  );
  expect(counter.count(), `${row.id} caller code invocation count`).toBe(0);
  if (row.ordinal === 180) expectDeepFrozen(actual, row.id);
}

function moduleFixtures(row: KnowledgeTm1LedgerRow): readonly ModuleFixture[] {
  switch (row.ordinal) {
    case 1:
      return [
        manualFixture(undefined, undefined, {
          kind: 'prepared',
          outcome: 'applied',
          authorizationKind: 'manual_edit',
        }),
      ];
    case 2:
      return [eligibleFixture('snapshot')];
    case 3:
      return [eligibleFixture('fragment')];
    case 4: {
      const fixture = manualFixture();
      const request = requireRecord(fixture.request, 'request');
      request.authorization = {kind: 'synthetic_unknown'};
      return [
        withIssue(fixture, 'invalid_state', 'request.authorization.kind'),
      ];
    }
    case 5: {
      const fixture = eligibleFixture('fragment');
      const state = requireRecord(fixture.state, 'state');
      state.curationTargets = [];
      state.intakeDecisions = [];
      return [
        withIssue(
          fixture,
          'curation_target_not_found',
          'request.authorization.target',
        ),
      ];
    }
    case 6: {
      const fixture = eligibleFixture('fragment');
      const request = requireRecord(fixture.request, 'request');
      const authorization = requireRecordField(request, 'authorization');
      authorization.target = {
        kind: 'fragment',
        fragmentId: SYNTHETIC_KNOWLEDGE_IDS.fragmentB,
      };
      const state = requireRecord(fixture.state, 'state');
      state.curationTargets = [];
      state.intakeDecisions = [];
      return [
        withIssue(
          fixture,
          'curation_target_not_found',
          'request.authorization.target',
        ),
      ];
    }
    case 7:
      return [eligibleFixture('fragment')];
    case 8:
      return [eligibleFixture('snapshot')];
    case 9: {
      const fixture = eligibleFixture('fragment');
      requireRecord(fixture.state, 'state').intakeDecisions = [];
      return [
        withIssue(fixture, 'curation_not_eligible', 'request.authorization'),
      ];
    }
    case 10: {
      const fixture = eligibleFixture('fragment');
      const decisions = requireArrayField(
        requireRecord(fixture.state, 'state'),
        'intakeDecisions',
      );
      const decision = requireRecord(decisions[0], 'intake decision');
      decision.currentRevision = 2;
      decision.currentRevisionId = ADDITIONAL_IDS.decisionRevisionA;
      return [
        withIssue(
          fixture,
          'stale_curation_revision',
          'request.authorization.expectedDecisionRevision',
        ),
      ];
    }
    case 11:
      return [
        eligibleFixture('fragment', 'full'),
        eligibleFixture('fragment', 'split'),
        eligibleFixture('fragment', 'condense'),
      ];
    case 12:
      return (['source_only', 'ignore', 'needs_review'] as const).map(
        (action) =>
          withIssue(
            eligibleFixture('fragment', action),
            'curation_not_eligible',
            'request.authorization',
          ),
      );
    case 13:
      return [eligibleFixture('fragment', 'full')];
    case 14:
      return [
        manualFixture(undefined, undefined, {
          kind: 'prepared',
          outcome: 'applied',
          operationOutcomes: ['applied'],
        }),
      ];
    case 15:
      return [existingItemFixture(itemValue({title: 'synthetic-revised'}))];
    case 16:
      return [existingItemFixture(itemValue())];
    case 17:
      return [existingItemFixture(itemValue({reviewState: 'withdrawn'}))];
    case 18:
      return [
        existingItemFixture(
          itemValue({reviewState: 'draft'}),
          provenance(),
          itemValue({reviewState: 'withdrawn'}),
        ),
      ];
    case 19:
      return [
        withIssue(
          manualFixture([itemOperation({expectedRevision: 1})]),
          'item_not_found',
          'request.operations[0].itemId',
        ),
      ];
    case 20: {
      const fixture = existingItemFixture(
        itemValue(),
        provenance(),
        itemValue(),
        provenance(),
        2,
      );
      setOperationExpectedRevision(
        requireRecord(fixture.request, 'request'),
        1,
      );
      return [
        withIssue(
          fixture,
          'stale_revision',
          'request.operations[0].expectedRevision',
        ),
      ];
    }
    case 21:
    case 22: {
      const reviewState = row.ordinal === 21 ? 'rejected' : 'withdrawn';
      const operation = itemOperation({value: itemValue({reviewState})});
      return [
        withIssue(
          manualFixture([operation]),
          'invalid_state',
          'request.operations[0].value.reviewState',
        ),
      ];
    }
    case 23:
      return [relationCreateFixture()];
    case 24:
      return [
        existingRelationFixture(
          relationValue({qualifier: 'synthetic-revised-qualifier'}),
        ),
      ];
    case 25:
      return [existingRelationFixture(relationValue())];
    case 26:
      return [
        withIssue(
          relationCreateFixture(
            relationOperation({
              value: relationValue({
                objectItemId: SYNTHETIC_KNOWLEDGE_IDS.itemA,
              }),
            }),
          ),
          'invalid_relation',
          'request.operations[0].value.objectItemId',
        ),
      ];
    case 27: {
      const fixture = existingRelationFixture(
        relationValue({subjectItemId: SYNTHETIC_KNOWLEDGE_IDS.itemC}),
      );
      addCurrentItem(
        requireState(fixture.state),
        SYNTHETIC_KNOWLEDGE_IDS.itemC,
        1,
      );
      return [
        withIssue(
          fixture,
          'invalid_relation',
          'request.operations[0].value.subjectItemId',
        ),
      ];
    }
    case 28:
      return [
        withIssue(
          existingRelationFixture(
            relationValue({relationTypeKey: 'synthetic.changed.relation'}),
          ),
          'invalid_relation',
          'request.operations[0].value.relationTypeKey',
        ),
      ];
    case 29: {
      const fixture = existingRelationFixture(
        relationValue({objectItemId: SYNTHETIC_KNOWLEDGE_IDS.itemC}),
      );
      addCurrentItem(
        requireState(fixture.state),
        SYNTHETIC_KNOWLEDGE_IDS.itemC,
        1,
      );
      return [
        withIssue(
          fixture,
          'invalid_relation',
          'request.operations[0].value.objectItemId',
        ),
      ];
    }
    case 30:
      return [
        withIssue(
          relationCreateFixture(
            relationOperation({
              value: relationValue({
                objectItemId: SYNTHETIC_KNOWLEDGE_IDS.itemC,
              }),
            }),
          ),
          'item_not_found',
          'request.operations[0].value.objectItemId',
        ),
      ];
    case 31:
      return [
        existingRelationFixture(
          relationValue(),
          provenance(),
          relationValue(),
          provenance(),
          1,
          'withdrawn',
        ),
      ];
    case 32: {
      const state = freshState();
      state.fragments.push(fragmentState());
      addEndpointItems(state);
      return [
        manualFixture(
          [
            relationOperation(),
            relationOperation({relationId: SYNTHETIC_KNOWLEDGE_IDS.relationB}),
          ],
          state,
          {
            kind: 'prepared',
            outcome: 'applied',
            operationOutcomes: ['applied', 'applied'],
          },
        ),
      ];
    }
    case 33:
    case 34: {
      const itemB = itemOperation({itemId: SYNTHETIC_KNOWLEDGE_IDS.itemB});
      const fixture = manualFixture(
        [relationOperation(), itemOperation(), itemB],
        undefined,
        {
          kind: 'prepared',
          outcome: 'applied',
          operationOutcomes: ['applied', 'applied', 'applied'],
        },
      );
      return [fixture];
    }
    case 35: {
      const state = freshState();
      state.fragments.push(fragmentState());
      addCurrentItem(state, SYNTHETIC_KNOWLEDGE_IDS.itemA, 1);
      return [
        manualFixture(
          [
            itemOperation({expectedRevision: 1}),
            itemOperation({itemId: SYNTHETIC_KNOWLEDGE_IDS.itemC}),
          ],
          state,
          {
            kind: 'prepared',
            outcome: 'applied',
            operationOutcomes: ['unchanged', 'applied'],
          },
        ),
      ];
    }
    case 36:
      return [
        withIssue(
          manualFixture([itemOperation(), itemOperation()]),
          'duplicate_operation',
          'request.operations[1]',
        ),
      ];
    case 37:
      return [manualFixture()];
    case 38:
      return [
        manualFixture([
          itemOperation({
            provenance: provenance([], [SYNTHETIC_KNOWLEDGE_IDS.fragmentA]),
          }),
        ]),
      ];
    case 39: {
      const state = freshState();
      addHistoricalItem(state);
      return [
        manualFixture(
          [
            itemOperation({
              value: itemValue({epistemicRole: 'user_assertion'}),
              provenance: provenance([], [], [historicalItemDerivation()]),
            }),
          ],
          state,
        ),
      ];
    }
    case 40: {
      const state = freshState();
      addHistoricalRelation(state);
      return [
        manualFixture(
          [
            itemOperation({
              value: itemValue({epistemicRole: 'user_assertion'}),
              provenance: provenance([], [], [historicalRelationDerivation()]),
            }),
          ],
          state,
        ),
      ];
    }
    case 41:
    case 42: {
      const state = freshState();
      state.fragments.push(
        fragmentState(),
        fragmentState(SYNTHETIC_KNOWLEDGE_IDS.fragmentB),
      );
      addCurrentItem(
        state,
        SYNTHETIC_KNOWLEDGE_IDS.itemA,
        1,
        itemValue(),
        provenance([
          SYNTHETIC_KNOWLEDGE_IDS.fragmentA,
          SYNTHETIC_KNOWLEDGE_IDS.fragmentB,
        ]),
      );
      const changedProvenance =
        row.ordinal === 41
          ? provenance([
              SYNTHETIC_KNOWLEDGE_IDS.fragmentB,
              SYNTHETIC_KNOWLEDGE_IDS.fragmentA,
            ])
          : provenance([], [SYNTHETIC_KNOWLEDGE_IDS.fragmentA]);
      if (row.ordinal === 42) state.fragments.pop();
      return [
        manualFixture(
          [
            itemOperation({
              expectedRevision: 1,
              provenance: changedProvenance,
            }),
          ],
          state,
        ),
      ];
    }
    case 43: {
      const state = freshState();
      addHistoricalItem(state, SYNTHETIC_KNOWLEDGE_IDS.itemB, 2, 1);
      return [
        manualFixture(
          [
            itemOperation({
              value: itemValue({epistemicRole: 'user_assertion'}),
              provenance: provenance([], [], [historicalItemDerivation()]),
            }),
          ],
          state,
        ),
      ];
    }
    case 44:
      return [
        withIssue(
          manualFixture([
            itemOperation({
              value: itemValue({epistemicRole: 'user_assertion'}),
              provenance: provenance(
                [],
                [],
                [historicalItemDerivation(SYNTHETIC_KNOWLEDGE_IDS.itemA)],
              ),
            }),
          ]),
          'invalid_provenance',
          'request.operations[0].provenance.knowledgeDerivations[0]',
        ),
      ];
    case 45:
      return [
        withIssue(
          manualFixture([
            itemOperation({
              provenance: provenance([
                SYNTHETIC_KNOWLEDGE_IDS.fragmentA,
                SYNTHETIC_KNOWLEDGE_IDS.fragmentA,
              ]),
            }),
          ]),
          'invalid_provenance',
          'request.operations[0].provenance.citations[1]',
        ),
      ];
    case 46:
      return [
        withIssue(
          manualFixture([
            itemOperation({
              provenance: provenance(
                [SYNTHETIC_KNOWLEDGE_IDS.fragmentA],
                [SYNTHETIC_KNOWLEDGE_IDS.fragmentA],
              ),
            }),
          ]),
          'invalid_provenance',
          'request.operations[0].provenance.fragmentDerivations[0]',
        ),
      ];
    case 47: {
      const state = freshState();
      addHistoricalItem(state);
      return [
        withIssue(
          manualFixture(
            [
              itemOperation({
                value: itemValue({epistemicRole: 'user_assertion'}),
                provenance: provenance(
                  [],
                  [],
                  [historicalItemDerivation(), historicalItemDerivation()],
                ),
              }),
            ],
            state,
          ),
          'invalid_provenance',
          'request.operations[0].provenance.knowledgeDerivations[1]',
        ),
      ];
    }
    case 48:
    case 50:
      return [
        manualFixture([
          itemOperation({
            value: itemValue({
              epistemicRole: 'source_excerpt',
              body: SYNTHETIC_KNOWLEDGE_TEXT.excerpt,
            }),
          }),
        ]),
      ];
    case 49:
      return [
        withIssue(
          manualFixture([
            itemOperation({
              value: itemValue({epistemicRole: 'source_excerpt'}),
            }),
          ]),
          'invalid_provenance',
          'request.operations[0].value.body',
        ),
      ];
    case 51: {
      const state = freshState();
      state.fragments.push(
        fragmentState(),
        fragmentState(SYNTHETIC_KNOWLEDGE_IDS.fragmentB),
      );
      return [
        withIssue(
          manualFixture(
            [
              itemOperation({
                value: itemValue({
                  epistemicRole: 'source_excerpt',
                  body: SYNTHETIC_KNOWLEDGE_TEXT.excerpt,
                }),
                provenance: provenance([
                  SYNTHETIC_KNOWLEDGE_IDS.fragmentA,
                  SYNTHETIC_KNOWLEDGE_IDS.fragmentB,
                ]),
              }),
            ],
            state,
          ),
          'invalid_provenance',
          'request.operations[0].provenance.citations',
        ),
      ];
    }
    case 52: {
      const state = freshState();
      state.fragments.push(
        fragmentState(),
        fragmentState(SYNTHETIC_KNOWLEDGE_IDS.fragmentB),
      );
      return [
        withIssue(
          manualFixture(
            [
              itemOperation({
                value: itemValue({
                  epistemicRole: 'source_excerpt',
                  body: SYNTHETIC_KNOWLEDGE_TEXT.excerpt,
                }),
                provenance: provenance(
                  [SYNTHETIC_KNOWLEDGE_IDS.fragmentA],
                  [SYNTHETIC_KNOWLEDGE_IDS.fragmentB],
                ),
              }),
            ],
            state,
          ),
          'invalid_provenance',
          'request.operations[0].provenance.fragmentDerivations',
        ),
      ];
    }
    case 53: {
      const state = freshState();
      state.fragments.push(fragmentState());
      addHistoricalItem(state);
      return [
        withIssue(
          manualFixture(
            [
              itemOperation({
                value: itemValue({
                  epistemicRole: 'source_excerpt',
                  body: SYNTHETIC_KNOWLEDGE_TEXT.excerpt,
                }),
                provenance: provenance(
                  [SYNTHETIC_KNOWLEDGE_IDS.fragmentA],
                  [],
                  [historicalItemDerivation()],
                ),
              }),
            ],
            state,
          ),
          'invalid_provenance',
          'request.operations[0].provenance.knowledgeDerivations',
        ),
      ];
    }
    case 54:
      return [
        withIssue(
          manualFixture([
            itemOperation({
              value: itemValue({
                epistemicRole: 'source_excerpt',
                body: 'synthetic-mismatched-excerpt',
              }),
            }),
          ]),
          'invalid_provenance',
          'request.operations[0].value.body',
        ),
      ];
    case 55:
      return [
        withIssue(
          relationCreateFixture(
            relationOperation({
              value: relationValue({epistemicRole: 'source_excerpt'}),
            }),
          ),
          'invalid_state',
          'request.operations[0].value.epistemicRole',
        ),
      ];
    case 56:
      return [manualFixture()];
    case 57: {
      const state = freshState();
      addHistoricalItem(state);
      return [
        manualFixture(
          [
            itemOperation({
              value: itemValue({epistemicRole: 'user_assertion'}),
              provenance: provenance([], [], [historicalItemDerivation()]),
            }),
          ],
          state,
        ),
      ];
    }
    case 58: {
      const state = freshState();
      addHistoricalRelation(state);
      return [
        manualFixture(
          [
            itemOperation({
              value: itemValue({epistemicRole: 'user_assertion'}),
              provenance: provenance([], [], [historicalRelationDerivation()]),
            }),
          ],
          state,
        ),
      ];
    }
    case 59:
      return [
        withIssue(
          manualFixture([
            itemOperation({
              provenance: provenance([SYNTHETIC_KNOWLEDGE_IDS.fragmentB]),
            }),
          ]),
          'fragment_not_found',
          'request.operations[0].provenance.citations[0]',
        ),
      ];
    case 60:
      return [eligibleFixture('fragment')];
    case 61:
      return [eligibleFixture('snapshot')];
    case 62: {
      let fixture = eligibleFixture('fragment');
      fixture = setEligibleOperation(
        fixture,
        itemOperation({
          provenance: provenance([SYNTHETIC_KNOWLEDGE_IDS.fragmentB]),
        }),
      );
      const state = requireState(fixture.state);
      state.fragments = [fragmentState(SYNTHETIC_KNOWLEDGE_IDS.fragmentB)];
      return [
        withIssue(
          fixture,
          'fragment_out_of_scope',
          'request.operations[0].provenance.citations[0]',
        ),
      ];
    }
    case 63: {
      let fixture = eligibleFixture('fragment');
      fixture = setEligibleOperation(
        fixture,
        itemOperation({
          value: itemValue({epistemicRole: 'user_assertion'}),
          provenance: provenance([], [], [historicalItemDerivation()]),
        }),
      );
      const state = requireState(fixture.state);
      state.fragments = [];
      addHistoricalItem(state);
      return [
        withIssue(
          fixture,
          'invalid_provenance',
          'request.operations[0].provenance',
        ),
      ];
    }
    case 64: {
      let fixture = eligibleFixture('fragment');
      fixture = setEligibleOperation(
        fixture,
        itemOperation({
          value: itemValue({epistemicRole: 'source_excerpt'}),
          provenance: provenance([SYNTHETIC_KNOWLEDGE_IDS.fragmentB]),
        }),
      );
      requireState(fixture.state).fragments = [
        fragmentState(SYNTHETIC_KNOWLEDGE_IDS.fragmentB),
      ];
      return [
        withIssue(
          fixture,
          'fragment_out_of_scope',
          'request.operations[0].provenance.citations[0]',
        ),
      ];
    }
    case 65: {
      const state = freshState();
      state.fragments.push(
        fragmentState(),
        fragmentState(SYNTHETIC_KNOWLEDGE_IDS.fragmentB),
      );
      addCurrentItem(state, SYNTHETIC_KNOWLEDGE_IDS.itemA, 1);
      return [
        manualFixture(
          [
            itemOperation({
              expectedRevision: 1,
              provenance: provenance([SYNTHETIC_KNOWLEDGE_IDS.fragmentB]),
            }),
          ],
          state,
        ),
      ];
    }
    case 66: {
      const state = freshState();
      state.fragments.push(
        fragmentState(),
        fragmentState(SYNTHETIC_KNOWLEDGE_IDS.fragmentB),
      );
      addEndpointItems(state);
      addCurrentRelation(state, SYNTHETIC_KNOWLEDGE_IDS.relationA, 1);
      return [
        manualFixture(
          [
            relationOperation({
              expectedRevision: 1,
              provenance: provenance([SYNTHETIC_KNOWLEDGE_IDS.fragmentB]),
            }),
          ],
          state,
        ),
      ];
    }
    case 67: {
      const state = freshState();
      addCurrentItem(state, SYNTHETIC_KNOWLEDGE_IDS.itemA, 1);
      return [
        withIssue(
          manualFixture(
            [
              itemOperation({
                expectedRevision: 1,
                provenance: provenance([]),
              }),
            ],
            state,
          ),
          'invalid_provenance',
          'request.operations[0].provenance',
        ),
      ];
    }
    case 68:
      return moduleFixtures({...row, ordinal: 65});
    case 69:
      return [
        withIssue(
          manualFixture([itemOperation({provenance: provenance([])})]),
          'invalid_provenance',
          'request.operations[0].provenance',
        ),
      ];
    case 70: {
      const tooMany = Array.from({length: 65}, (_, index) =>
        index === 0
          ? 'synthetic-invalid-uuid'
          : `40000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
      );
      return [
        withIssue(
          manualFixture([itemOperation({provenance: provenance(tooMany)})]),
          'limit_exceeded',
          'request.operations[0].provenance',
          'operation_provenance_inputs',
        ),
      ];
    }
    case 71:
    case 72:
    case 73: {
      const operation = itemOperation();
      const input = requireRecordField(operation, 'provenance');
      const field =
        row.ordinal === 71
          ? 'citations'
          : row.ordinal === 72
            ? 'fragmentDerivations'
            : 'knowledgeDerivations';
      input[field] = {synthetic: true};
      return [
        withIssue(
          manualFixture([operation]),
          'invalid_shape',
          `request.operations[0].provenance.${field}`,
        ),
      ];
    }
    case 74: {
      const sparse = new Array<string>(2);
      sparse[0] = SYNTHETIC_KNOWLEDGE_IDS.fragmentA;
      const operation = itemOperation();
      requireRecordField(operation, 'provenance').citations = sparse;
      return [
        withIssue(
          manualFixture([operation]),
          'invalid_shape',
          'request.operations[0].provenance.citations',
        ),
      ];
    }
    case 75:
      return [
        withIssue(
          manualFixture([
            itemOperation({
              provenance: provenance([ADDITIONAL_IDS.fragmentMissing]),
            }),
          ]),
          'fragment_not_found',
          'request.operations[0].provenance.citations[0]',
        ),
      ];
    case 76:
      return [
        withIssue(
          manualFixture([
            itemOperation({
              provenance: provenance([], [ADDITIONAL_IDS.fragmentMissing]),
            }),
          ]),
          'fragment_not_found',
          'request.operations[0].provenance.fragmentDerivations[0]',
        ),
      ];
    case 77:
      return [
        withIssue(
          manualFixture(
            [
              itemOperation({
                value: itemValue({epistemicRole: 'user_assertion'}),
                provenance: provenance([], [], [historicalItemDerivation()]),
              }),
            ],
            freshState(),
          ),
          'revision_not_found',
          'request.operations[0].provenance.knowledgeDerivations[0]',
        ),
      ];
    case 78: {
      const state = freshState();
      addHistoricalItem(state);
      return [
        withIssue(
          manualFixture(
            [
              itemOperation({
                provenance: provenance([], [], [historicalItemDerivation()]),
              }),
            ],
            state,
          ),
          'invalid_provenance',
          'request.operations[0].provenance',
        ),
      ];
    }
    case 79:
      return [
        withIssue(
          manualFixture([
            itemOperation({
              value: itemValue({epistemicRole: 'inference'}),
            }),
          ]),
          'invalid_provenance',
          'request.operations[0].provenance',
        ),
      ];
    case 80: {
      const fixture = existingRelationFixture(
        relationValue({
          subjectItemId: SYNTHETIC_KNOWLEDGE_IDS.itemC,
          relationTypeKey: 'synthetic.changed.relation',
          objectItemId: SYNTHETIC_KNOWLEDGE_IDS.itemC,
        }),
      );
      addCurrentItem(
        requireState(fixture.state),
        SYNTHETIC_KNOWLEDGE_IDS.itemC,
        1,
      );
      return [
        withIssue(
          fixture,
          'invalid_relation',
          'request.operations[0].value.subjectItemId',
        ),
      ];
    }
    case 95:
      return [
        manualFixture(undefined, undefined, {
          kind: 'prepared',
          outcome: 'applied',
          authorizationKind: 'manual_edit',
          operationOutcomes: ['applied'],
        }),
      ];
    case 96:
      return [existingItemFixture(itemValue())];
    case 97:
      return [replayFixture('applied')];
    case 98:
      return [
        withIssue(manualFixture([]), 'invalid_state', 'request.operations'),
      ];
    case 99:
      return [eligibleFixture('fragment')];
    case 100:
      return [
        manualFixture(undefined, undefined, {
          kind: 'prepared',
          outcome: 'applied',
          authorizationKind: 'manual_edit',
        }),
      ];
    case 101: {
      const itemB = itemOperation({itemId: SYNTHETIC_KNOWLEDGE_IDS.itemB});
      return [
        manualFixture(
          [itemOperation(), itemB, relationOperation()],
          undefined,
          {
            kind: 'prepared',
            outcome: 'applied',
            operationOutcomes: ['applied', 'applied', 'applied'],
          },
        ),
      ];
    }
    case 102:
      return [replayFixture('applied')];
    case 103: {
      const fixture = replayFixture('applied');
      const request = requireRecord(fixture.request, 'request');
      const value = requireRecordField(firstOperation(request), 'value');
      value.title = 'synthetic-conflicting-title';
      return [
        withIssue(
          fixture,
          'idempotency_conflict',
          'context.commandIdempotencyKey',
        ),
      ];
    }
    case 104:
      return [manualFixture()];
    case 105:
    case 106:
      return [replayFixture('applied')];
    case 107:
      return [replayFixture('unchanged')];
    case 108: {
      const fixture = replayFixture('applied');
      requireArrayField(
        requireRecord(fixture.state, 'state'),
        'fragments',
      ).push(fragmentState());
      return [withIssue(fixture, 'invalid_shape', 'state')];
    }
    case 181: {
      const fixture = eligibleFixture('fragment');
      const targets = requireArrayField(
        requireRecord(fixture.state, 'state'),
        'curationTargets',
      );
      targets.unshift({
        workspaceId: SYNTHETIC_KNOWLEDGE_IDS.workspaceA,
        targetId: '00000000-0000-4000-8000-000000000001',
        kind: 'fragment',
        fragmentId: SYNTHETIC_KNOWLEDGE_IDS.fragmentB,
      });
      return [withIssue(fixture, 'invalid_shape', 'state')];
    }
    case 182: {
      const fixture = eligibleFixture('fragment');
      const decisions = requireArrayField(
        requireRecord(fixture.state, 'state'),
        'intakeDecisions',
      );
      decisions.unshift({
        workspaceId: SYNTHETIC_KNOWLEDGE_IDS.workspaceA,
        targetId: '00000000-0000-4000-8000-000000000001',
        decisionId: '00000000-0000-4000-8000-000000000002',
        currentRevision: 1,
        currentRevisionId: '00000000-0000-4000-8000-000000000003',
        action: 'full',
      });
      return [withIssue(fixture, 'invalid_shape', 'state')];
    }
    case 183: {
      const state = freshState();
      state.fragments.push(
        fragmentState(SYNTHETIC_KNOWLEDGE_IDS.fragmentB),
        fragmentState(SYNTHETIC_KNOWLEDGE_IDS.fragmentA),
      );
      return [
        withIssue(
          manualFixture(
            [
              itemOperation({
                provenance: provenance([
                  SYNTHETIC_KNOWLEDGE_IDS.fragmentA,
                  SYNTHETIC_KNOWLEDGE_IDS.fragmentB,
                ]),
              }),
            ],
            state,
          ),
          'invalid_shape',
          'state',
        ),
      ];
    }
    case 184:
    case 185: {
      const fixture = relationCreateFixture();
      const state = requireState(fixture.state);
      const field = row.ordinal === 184 ? 'items' : 'revisions';
      requireArrayField(state, field).reverse();
      return [withIssue(fixture, 'invalid_shape', 'state')];
    }
    case 186:
    case 187: {
      const state = freshState();
      addHistoricalRelation(state, SYNTHETIC_KNOWLEDGE_IDS.relationA);
      addCurrentRelation(state, SYNTHETIC_KNOWLEDGE_IDS.relationB, 1);
      const field = row.ordinal === 186 ? 'relations' : 'relationRevisions';
      requireArrayField(state, field).reverse();
      const operation = itemOperation({
        value: itemValue({epistemicRole: 'user_assertion'}),
        provenance: provenance(
          [],
          [],
          [
            historicalRelationDerivation(SYNTHETIC_KNOWLEDGE_IDS.relationA),
            historicalRelationDerivation(SYNTHETIC_KNOWLEDGE_IDS.relationB),
          ],
        ),
      });
      return [
        withIssue(manualFixture([operation], state), 'invalid_shape', 'state'),
      ];
    }
    case 188: {
      const fixture = replayFixture();
      const state = requireState(fixture.state);
      requireArrayField(state, 'changeSets').unshift({
        workspaceId: SYNTHETIC_KNOWLEDGE_IDS.workspaceA,
        commandIdempotencyKey: 'synthetic.knowledge.command.0000',
        changeSetId: '00000000-0000-5000-8000-000000000001',
        requestSha256: KNOWLEDGE_CANONICAL_KNOWN_ANSWER.sha256,
        authorization: {kind: 'manual_edit'},
        originalOutcome: 'applied',
        operationCount: 1,
      });
      return [withIssue(fixture, 'invalid_shape', 'state')];
    }
    case 189: {
      const fixture = replayFixture();
      const state = requireState(fixture.state);
      const operations = requireArrayField(state, 'changeOperations');
      const first = requireRecord(operations[0], 'change operation');
      operations.unshift({...first, operationIndex: 1});
      requireRecord(
        requireArrayField(state, 'changeSets')[0],
        'change set',
      ).operationCount = 2;
      return [withIssue(fixture, 'invalid_shape', 'state')];
    }
    case 190: {
      const fixture = replayFixture();
      const events = requireArrayField(
        requireRecord(fixture.state, 'state'),
        'changeEvents',
      );
      events.unshift({
        workspaceId: SYNTHETIC_KNOWLEDGE_IDS.workspaceA,
        eventId: '00000000-0000-5000-8000-000000000001',
        eventKind: 'knowledge_change_set_committed',
        eventSchemaVersion: 1,
        changeSetId: KNOWLEDGE_UUID_KNOWN_ANSWERS.changeSetId,
      });
      return [withIssue(fixture, 'invalid_shape', 'state')];
    }
    case 191:
    case 192: {
      const fixture = eligibleFixture('fragment');
      const field = row.ordinal === 191 ? 'curationTargets' : 'intakeDecisions';
      const rows = requireArrayField(
        requireRecord(fixture.state, 'state'),
        field,
      );
      rows.push(structuredClone(rows[0]));
      return [withIssue(fixture, 'invalid_shape', 'state')];
    }
    case 193: {
      const fixture = manualFixture();
      const rows = requireArrayField(
        requireRecord(fixture.state, 'state'),
        'fragments',
      );
      rows.push(structuredClone(rows[0]));
      return [withIssue(fixture, 'invalid_shape', 'state')];
    }
    case 194:
    case 195: {
      const state = freshState();
      state.fragments.push(fragmentState());
      addCurrentItem(state, SYNTHETIC_KNOWLEDGE_IDS.itemA, 1);
      const field = row.ordinal === 194 ? 'items' : 'revisions';
      const rows = requireArrayField(state, field);
      rows.push(structuredClone(rows[0]));
      return [
        withIssue(
          manualFixture([itemOperation({expectedRevision: 1})], state),
          'invalid_shape',
          'state',
        ),
      ];
    }
    case 196:
    case 197: {
      const fixture = existingRelationFixture(relationValue());
      const state = requireState(fixture.state);
      const field = row.ordinal === 196 ? 'relations' : 'relationRevisions';
      const rows = requireArrayField(state, field);
      rows.push(structuredClone(rows[0]));
      return [withIssue(fixture, 'invalid_shape', 'state')];
    }
    case 198:
    case 199:
    case 200: {
      const fixture = replayFixture();
      const field =
        row.ordinal === 198
          ? 'changeSets'
          : row.ordinal === 199
            ? 'changeOperations'
            : 'changeEvents';
      const rows = requireArrayField(
        requireRecord(fixture.state, 'state'),
        field,
      );
      rows.push(structuredClone(rows[0]));
      return [withIssue(fixture, 'invalid_shape', 'state')];
    }
    case 201:
      return [replayFixture('applied')];
    case 202:
      return [manualFixture()];
    case 203: {
      const fixture = manualFixture();
      requireArrayField(
        requireRecord(fixture.state, 'state'),
        'fragments',
      ).push(fragmentState(SYNTHETIC_KNOWLEDGE_IDS.fragmentB));
      return [withIssue(fixture, 'invalid_shape', 'state')];
    }
    case 204: {
      const state = freshState();
      state.fragments.push(fragmentState());
      state.items.push({
        workspaceId: SYNTHETIC_KNOWLEDGE_IDS.workspaceA,
        itemId: SYNTHETIC_KNOWLEDGE_IDS.itemA,
        currentRevision: 1,
        currentRevisionId: KNOWLEDGE_UUID_KNOWN_ANSWERS.itemRevisionId,
      });
      return [
        withIssue(
          manualFixture([itemOperation({expectedRevision: 1})], state),
          'invalid_shape',
          'state',
        ),
      ];
    }
    case 205:
      return [
        withIssue(
          manualFixture([itemOperation({expectedRevision: 1})]),
          'item_not_found',
          'request.operations[0].itemId',
        ),
      ];
    case 206: {
      const fixture = existingItemFixture(itemValue());
      const item = requireRecord(
        requireArrayField(requireRecord(fixture.state, 'state'), 'items')[0],
        'item',
      );
      item.currentRevisionId = '00000000-0000-5000-8000-000000000001';
      return [withIssue(fixture, 'invalid_shape', 'state')];
    }
    case 215:
      return [
        manualFixture(undefined, undefined, {
          kind: 'prepared',
          outcome: 'applied',
        }),
      ];
    case 216:
      return [existingItemFixture(itemValue())];
    case 217:
      return [
        withIssue(manualFixture([]), 'invalid_state', 'request.operations'),
      ];
    case 218:
    case 219:
    case 220:
      return [manualFixture()];
    default:
      return [manualFixture()];
  }
}

function knowledgeProductSourceText(): string {
  const directory = new URL('.', import.meta.url);
  return readdirSync(directory, {withFileTypes: true})
    .filter(
      (entry) =>
        entry.isFile() &&
        entry.name.endsWith('.ts') &&
        !entry.name.endsWith('.test.ts'),
    )
    .map((entry) => readFileSync(new URL(entry.name, directory), 'utf8'))
    .join('\n');
}

function occurrenceCount(value: string, token: string): number {
  return value.split(token).length - 1;
}

function expectRowSpecificEvidence(
  actual: unknown,
  row: KnowledgeTm1LedgerRow,
): void {
  if (row.ordinal === 215 || row.ordinal === 216) {
    const preparation = requireRecord(actual, `${row.id} preparation`);
    const plan = requireRecord(preparation.plan, `${row.id} plan`);
    const serialized = JSON.stringify(plan);
    expect(
      occurrenceCount(serialized, KNOWLEDGE_UUID_KNOWN_ANSWERS.eventId),
      row.id,
    ).toBe(1);
    expect(
      occurrenceCount(serialized, 'knowledge_change_set_committed'),
      row.id,
    ).toBe(1);
  } else if (row.ordinal === 217) {
    const serialized = JSON.stringify(actual);
    expect(serialized, row.id).not.toContain('knowledge_change_set_committed');
    expect(serialized, row.id).not.toContain('"plan"');
  } else if (row.ordinal >= 218 && row.ordinal <= 220) {
    const source = knowledgeProductSourceText();
    if (row.ordinal === 218) {
      expect(source, row.id).not.toMatch(
        /from ['"](?:node:fs|node:http|node:https|node:net|node:dns|node:process)['"]/u,
      );
      expect(source, row.id).not.toMatch(/process\.env/u);
    } else if (row.ordinal === 219) {
      expect(source, row.id).not.toMatch(
        /Date\.now|Math\.random|randomUUID|node:crypto[^\n]*random/u,
      );
    } else {
      expect(source, row.id).not.toMatch(
        /@nestjs|from ['"](?:pg|pg-boss|drizzle|express)['"]/u,
      );
    }
  }
}

async function evaluateDefaultModuleCase(
  row: KnowledgeTm1LedgerRow,
): Promise<void> {
  const module = await loadPublicKnowledgeModule(row);
  const random = vi.spyOn(Math, 'random').mockImplementation(() => {
    throw new Error(`${row.id} touched randomness.`);
  });
  const clock = vi.spyOn(Date, 'now').mockImplementation(() => {
    throw new Error(`${row.id} touched the system clock.`);
  });
  try {
    for (const fixture of moduleFixtures(row)) {
      const actual = module.prepareApplyManualKnowledgeChangeSet(
        fixture.context,
        fixture.request,
        fixture.state,
      );
      expectModuleResult(actual, row, fixture.expectation);
      expectRowSpecificEvidence(actual, row);
    }
  } finally {
    random.mockRestore();
    clock.mockRestore();
  }
}

function capacityOracle(row: KnowledgeTm1LedgerRow): void {
  switch (row.ordinal) {
    case 81:
      expect(
        independentUuidV5(
          SYNTHETIC_KNOWLEDGE_IDS.workspaceA,
          `struinfo:knowledge-change-set:v1:${SYNTHETIC_KNOWLEDGE_TEXT.commandKey}`,
        ),
      ).toBe(KNOWLEDGE_UUID_KNOWN_ANSWERS.changeSetId);
      return;
    case 82:
      expect(
        independentUuidV5(
          SYNTHETIC_KNOWLEDGE_IDS.itemA,
          'struinfo:knowledge-revision:v1:1',
        ),
      ).toBe(KNOWLEDGE_UUID_KNOWN_ANSWERS.itemRevisionId);
      return;
    case 83:
      expect(
        independentUuidV5(
          SYNTHETIC_KNOWLEDGE_IDS.relationA,
          'struinfo:knowledge-relation-revision:v1:1',
        ),
      ).toBe(KNOWLEDGE_UUID_KNOWN_ANSWERS.relationRevisionId);
      return;
    case 84:
      expect(
        independentUuidV5(
          KNOWLEDGE_UUID_KNOWN_ANSWERS.changeSetId,
          'struinfo:knowledge-change-committed-event:v1',
        ),
      ).toBe(KNOWLEDGE_UUID_KNOWN_ANSWERS.eventId);
      return;
    case 85: {
      const measurement = measureIndependentCanonicalJson(
        createSmallKnowledgeCommandProjection(),
      );
      expect(measurement.bytes).toBe(KNOWLEDGE_CANONICAL_KNOWN_ANSWER.bytes);
      expect(measurement.sha256).toBe(KNOWLEDGE_CANONICAL_KNOWN_ANSWER.sha256);
      return;
    }
    case 86: {
      const projection = createSmallKnowledgeCommandProjection();
      const encoded = encodeIndependentCanonicalJson(projection);
      expect(encoded.at(-1)).toBe(0x0a);
      expect(measureIndependentCanonicalJson(projection).sha256).not.toBe(
        measureIndependentCanonicalJson({projection: [projection]}).sha256,
      );
      return;
    }
    case 87:
      expect(
        measureIndependentCanonicalJson({b: true, a: [null]}),
      ).toMatchObject({
        bytes: 22,
        values: 4,
        depth: 2,
      });
      return;
    case 88:
      expect(
        measureIndependentCanonicalJson(
          createSaturatedKnowledgeProjection('eligible_target', 64),
        ),
      ).toMatchObject({bytes: 5_601_498, values: 17_294, depth: 7});
      return;
    case 89:
      expect(
        measureIndependentCanonicalJson(
          createSaturatedKnowledgeProjection('eligible_target', 0),
        ),
      ).toMatchObject({bytes: 954_074, values: 17_358, depth: 7});
      return;
    case 90:
      expect(
        measureIndependentCanonicalJson(
          createSaturatedKnowledgeProjection('manual_edit', 64),
        ),
      ).toMatchObject({bytes: 5_601_375, values: 17_290, depth: 7});
      return;
    case 91:
      expect(
        measureIndependentCanonicalJson(
          createSaturatedKnowledgeProjection('manual_edit', 0),
        ),
      ).toMatchObject({bytes: 953_951, values: 17_354, depth: 7});
      return;
    case 92:
    case 93: {
      const authorization =
        row.ordinal === 92 ? 'eligible_target' : 'manual_edit';
      const baseBytes = authorization === 'eligible_target' ? 954_074 : 953_951;
      const baseValues = authorization === 'eligible_target' ? 17_358 : 17_354;
      for (let itemCount = 0; itemCount <= 64; itemCount += 1) {
        const measurement = measureIndependentCanonicalJson(
          createSaturatedKnowledgeProjection(authorization, itemCount),
        );
        expect(
          measurement.bytes,
          `${row.id} itemCount=${String(itemCount)}`,
        ).toBe(baseBytes + 72_616 * itemCount);
        expect(
          measurement.values,
          `${row.id} itemCount=${String(itemCount)}`,
        ).toBe(baseValues - itemCount);
        expect(measurement.depth).toBe(7);
      }
      return;
    }
    case 94: {
      const byteMaximum = measureIndependentCanonicalJson(
        createSaturatedKnowledgeProjection('eligible_target', 64),
      );
      const valueMaximum = measureIndependentCanonicalJson(
        createSaturatedKnowledgeProjection('eligible_target', 0),
      );
      expect(KNOWLEDGE_LIMITS.encoderBytes - byteMaximum.bytes).toBe(2_787_110);
      expect(KNOWLEDGE_LIMITS.encoderValues - valueMaximum.values).toBe(82_642);
      expect(KNOWLEDGE_LIMITS.encoderDepth - 7).toBe(57);
      expect([
        'change_set_operations',
        'operation_provenance_inputs',
        'title_code_points',
        'relation_type_code_points',
        'body_code_points',
        'qualifier_code_points',
        'idempotency_key_characters',
        'revision_number',
      ]).not.toContain('request_bytes');
      return;
    }
    default:
      throw new RangeError(
        `${row.id} is not an independent identity/capacity row.`,
      );
  }
}

function boundaryOracle(row: KnowledgeTm1LedgerRow): void {
  const ownedUrls = [
    new URL(
      '../../../test_support/manual_knowledge_tm1_oracle.ts',
      import.meta.url,
    ),
    new URL(
      '../../../test_support/manual_knowledge_sql_lexical.ts',
      import.meta.url,
    ),
    new URL('./manual_knowledge_tm1.test.ts', import.meta.url),
    new URL('./manual_knowledge_migration_tm1.test.ts', import.meta.url),
  ];
  const text = ownedUrls.map((url) => readFileSync(url, 'utf8')).join('\n');
  if (row.ordinal === 221) {
    expect(text).not.toMatch(/from ['"][^'"]*(decoder|identity|expected_map)/u);
  } else if (row.ordinal === 222) {
    const forbiddenText = [
      ['ruan', 'yf'].join(''),
      ['week', 'ly #'].join(''),
      ['BEGIN PRIVATE', ' KEY'].join(''),
    ];
    for (const forbidden of forbiddenText)
      expect(text).not.toContain(forbidden);
    const usersDirectory = ['Use', 'rs'].join('');
    expect(text).not.toMatch(
      new RegExp(`[A-Za-z]:\\\\${usersDirectory}\\\\`, 'u'),
    );
    expect(text).toContain('synthetic');
  } else if (row.ordinal === 223) {
    expect(ownedUrls.every((url) => !url.pathname.includes('/dist/'))).toBe(
      true,
    );
  } else if (row.ordinal === 224) {
    for (const method of [
      ['s', 'kip'].join(''),
      ['t', 'odo'].join(''),
      ['o', 'nly'].join(''),
    ]) {
      expect(text).not.toMatch(new RegExp(`\\.${method}\\s*\\(`, 'u'));
    }
    const emptyGate = ['passWithNo', 'Tests'].join('');
    expect(text).not.toContain(emptyGate);
    expect(text).not.toContain(`--${emptyGate}`);
  }
}

async function evaluateLedgerRow(row: KnowledgeTm1LedgerRow): Promise<void> {
  if (row.ordinal >= 81 && row.ordinal <= 94) {
    capacityOracle(row);
    return;
  }
  if (row.ordinal >= 109 && row.ordinal <= 164) {
    const oracle = KNOWLEDGE_NUMERIC_ISSUE_ORACLES[row.ordinal - 109];
    if (oracle === undefined)
      throw new RangeError(`${row.id} numeric oracle missing.`);
    await evaluateNumericCase(row, oracle);
    return;
  }
  if (row.ordinal >= 165 && row.ordinal <= 180) {
    await evaluateHostileCase(row);
    return;
  }
  if (row.ordinal >= 221) {
    boundaryOracle(row);
    return;
  }
  await evaluateDefaultModuleCase(row);
}

describe('manual knowledge independent TM1 ledger', () => {
  it('contains each mandatory ID exactly once', () => {
    expect(KNOWLEDGE_TM1_LEDGER).toHaveLength(224);
    expect(new Set(KNOWLEDGE_TM1_LEDGER.map((row) => row.id)).size).toBe(224);
    expect(KNOWLEDGE_TM1_LEDGER.at(0)?.id).toBe('K-TM1-001');
    expect(KNOWLEDGE_TM1_LEDGER.at(-1)?.id).toBe('K-TM1-224');
  });

  const moduleRows = KNOWLEDGE_TM1_LEDGER.filter(
    (row) => row.layer !== 'migration',
  );
  it.each(moduleRows)('$id $title', async (row) => {
    await evaluateLedgerRow(row);
  });
});
