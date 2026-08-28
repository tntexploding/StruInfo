import {createHash} from 'node:crypto';

import {
  trialInformationEntryAutomationPolicy,
  type InformationEntryAutomationTrialResult,
  type InformationEntryRepositoryPort,
} from '../entries/index.js';
import {
  DEFAULT_ENTRY_AUTOMATION_POLICY,
  DEFAULT_ENTRY_PREFERENCE_PROFILE,
  patchReviewPreferences,
  updateReviewPreferences,
  type EntryAutomationPolicy,
  type ReviewPreferencesStore,
} from '../../storage/review_preferences_store.js';
import {deriveProcessingRunId} from './processing_identity.js';
import type {
  EntryAutomationClaimInput,
  EntryAutomationExecution,
  EntryAutomationExecutionRepositoryPort,
  EntryAutomationPolicyPauseOutcome,
  ExecuteEntryAutomationRequest,
  ExecuteEntryAutomationResult,
} from './entry_automation_execution_contract.js';

const CANONICAL_UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;
export interface EntryAutomationExecutionDependencies {
  readonly repository: EntryAutomationExecutionRepositoryPort;
  readonly entries: InformationEntryRepositoryPort;
  readonly preferences: ReviewPreferencesStore;
}

export async function executeInformationEntryAutomation(
  dependencies: Readonly<EntryAutomationExecutionDependencies>,
  request: Readonly<ExecuteEntryAutomationRequest>,
): Promise<Readonly<ExecuteEntryAutomationResult>> {
  if (!validRequest(request)) return Object.freeze({status: 'invalid_request'});
  const runId = deriveProcessingRunId(
    request.workspaceId,
    request.idempotencyKey,
  );
  const requestSha256 = digestRequest(request);
  let execution: Readonly<EntryAutomationExecution> | undefined;

  try {
    execution = await dependencies.repository.loadExecution(
      request.workspaceId,
      runId,
    );
    if (execution !== undefined) {
      if (execution.requestSha256 !== requestSha256) {
        return Object.freeze({status: 'conflict', runId});
      }
      return await continueExecution(dependencies, request, execution, true);
    }

    const planned = await planExecution(dependencies, request);
    if (planned.result !== undefined) return planned.result;
    if (planned.claims.length === 0) {
      return Object.freeze({status: 'not_ready', reason: 'no_entries'});
    }
    const initialized = await dependencies.repository.initializeExecution({
      workspaceId: request.workspaceId,
      runId,
      idempotencyKey: request.idempotencyKey,
      requestSha256,
      planSha256: digestPlan(planned.claims),
      policyRevision: request.expectedPolicyRevision,
      profileRevision: request.expectedProfileRevision,
      includePrivate: request.includePrivate,
      advanceActions:
        planned.policy.advanceActions ??
        Object.freeze({
          deterministicTags: false,
          rebuildAssociations: false,
        }),
      claims: planned.claims,
    });
    if (initialized === 'conflict') {
      return Object.freeze({status: 'conflict', runId});
    }
    if (initialized !== 'applied' && initialized !== 'unchanged') {
      return failedResult(
        runId,
        false,
        'automation_execution_failed',
        'superseded',
        true,
      );
    }
    execution = await dependencies.repository.loadExecution(
      request.workspaceId,
      runId,
    );
    if (execution === undefined) {
      return failedResult(
        runId,
        false,
        'automation_execution_failed',
        'superseded',
        true,
      );
    }
    return await continueExecution(
      dependencies,
      request,
      execution,
      initialized === 'unchanged',
    );
  } catch {
    if (execution === undefined) {
      return failedResult(
        runId,
        false,
        'automation_execution_failed',
        'superseded',
        true,
      );
    }
    return failExecution(
      dependencies,
      execution,
      'automation_execution_failed',
      false,
    );
  }
}

async function continueExecution(
  dependencies: Readonly<EntryAutomationExecutionDependencies>,
  request: Readonly<ExecuteEntryAutomationRequest>,
  initial: Readonly<EntryAutomationExecution>,
  replayed: boolean,
): Promise<Readonly<ExecuteEntryAutomationResult>> {
  let execution = initial;
  if (execution.status === 'succeeded') {
    return successResult(execution, true);
  }
  if (execution.status === 'failed') {
    const policyPause = await pausePolicy(
      dependencies.preferences,
      execution.workspaceId,
      execution.policyRevision,
    );
    return failedResult(
      execution.runId,
      true,
      execution.errorCode === 'automation_revalidation_failed'
        ? 'automation_revalidation_failed'
        : 'automation_execution_failed',
      policyPause,
      policyPause === 'failed',
    );
  }
  if (execution.status === 'cancelled') {
    return failedResult(
      execution.runId,
      true,
      'automation_execution_failed',
      'superseded',
      false,
    );
  }
  if (!(await executionStillValid(dependencies, request, execution))) {
    return failExecution(
      dependencies,
      execution,
      'automation_revalidation_failed',
      replayed,
    );
  }

  if (execution.status === 'queued') {
    await dependencies.repository.startExecution(
      execution.workspaceId,
      execution.runId,
      execution.version,
    );
    const current = await dependencies.repository.loadExecution(
      execution.workspaceId,
      execution.runId,
    );
    if (current === undefined) {
      return failedResult(
        execution.runId,
        replayed,
        'automation_execution_failed',
        'superseded',
        true,
      );
    }
    execution = current;
  }
  if (execution.status === 'succeeded') return successResult(execution, true);
  if (execution.status !== 'running') {
    return failExecution(
      dependencies,
      execution,
      'automation_execution_failed',
      replayed,
    );
  }

  // The second read is the commit fence for external policy/Profile state.
  // Entry revisions are checked again by the PostgreSQL settle transaction.
  if (!(await executionStillValid(dependencies, request, execution))) {
    return failExecution(
      dependencies,
      execution,
      'automation_revalidation_failed',
      replayed,
    );
  }
  const settled = await dependencies.repository.settleExecution({
    workspaceId: execution.workspaceId,
    runId: execution.runId,
    expectedVersion: execution.version,
    status: 'succeeded',
  });
  const current = await dependencies.repository.loadExecution(
    execution.workspaceId,
    execution.runId,
  );
  if (
    (settled === 'applied' ||
      settled === 'unchanged' ||
      settled === 'terminal') &&
    current?.status === 'succeeded'
  ) {
    return successResult(current, replayed);
  }
  return current === undefined
    ? failedResult(
        execution.runId,
        replayed,
        'automation_execution_failed',
        'superseded',
        true,
      )
    : failExecution(
        dependencies,
        current,
        'automation_execution_failed',
        replayed,
      );
}

async function planExecution(
  dependencies: Readonly<EntryAutomationExecutionDependencies>,
  request: Readonly<ExecuteEntryAutomationRequest>,
): Promise<
  Readonly<{
    result?: Readonly<ExecuteEntryAutomationResult>;
    policy: Readonly<EntryAutomationPolicy>;
    claims: readonly Readonly<EntryAutomationClaimInput>[];
  }>
> {
  const preferences = await dependencies.preferences.load(request.workspaceId);
  const entries = await dependencies.entries.loadCurrentEntries(
    request.workspaceId,
    true,
  );
  const policy =
    preferences.entryAutomationPolicy ?? DEFAULT_ENTRY_AUTOMATION_POLICY;
  const profile =
    preferences.entryPreferenceProfile ?? DEFAULT_ENTRY_PREFERENCE_PROFILE;
  const trial = trialInformationEntryAutomationPolicy(
    entries,
    policy.revision,
    profile.revision,
    policy,
    profile,
    trialRequest(request),
  );
  const notReady = trialResult(trial);
  if (notReady !== undefined) {
    return Object.freeze({
      result: notReady,
      policy,
      claims: Object.freeze([]),
    });
  }
  if (trial.status !== 'complete') {
    throw new Error('Entry automation trial did not produce a plan.');
  }
  const currentById = new Map(entries.map((entry) => [entry.entryId, entry]));
  const claims = trial.items.map((item, ordinal) => {
    const entry = currentById.get(item.entryId);
    if (entry?.revision !== item.revision) {
      throw new Error('Entry automation planning state changed.');
    }
    return Object.freeze({
      ordinal,
      entryId: item.entryId,
      entryRevision: item.revision,
      entryRevisionId: entry.revisionId,
      route: item.route,
      reason: item.reason,
    });
  });
  return Object.freeze({policy, claims: Object.freeze(claims)});
}

async function executionStillValid(
  dependencies: Readonly<EntryAutomationExecutionDependencies>,
  request: Readonly<ExecuteEntryAutomationRequest>,
  execution: Readonly<EntryAutomationExecution>,
): Promise<boolean> {
  const preferences = await dependencies.preferences.load(request.workspaceId);
  const entries = await dependencies.entries.loadCurrentEntries(
    request.workspaceId,
    true,
  );
  const policy =
    preferences.entryAutomationPolicy ?? DEFAULT_ENTRY_AUTOMATION_POLICY;
  const profile =
    preferences.entryPreferenceProfile ?? DEFAULT_ENTRY_PREFERENCE_PROFILE;
  const trial = trialInformationEntryAutomationPolicy(
    entries,
    policy.revision,
    profile.revision,
    policy,
    profile,
    {
      includePrivate: execution.includePrivate,
      expectedPolicyRevision: execution.policyRevision,
      expectedProfileRevision: execution.profileRevision,
      expectedEntries: execution.claims.map((claim) => ({
        entryId: claim.entryId,
        revision: claim.entryRevision,
      })),
      ...(request.manualTakeoverEntryIds === undefined
        ? {}
        : {manualTakeoverEntryIds: request.manualTakeoverEntryIds}),
    },
  );
  if (
    trial.status !== 'complete' ||
    trial.activation !== 'ready' ||
    trial.items.length !== execution.claims.length
  ) {
    return false;
  }
  const currentById = new Map(entries.map((entry) => [entry.entryId, entry]));
  const regenerated = trial.items.map((item, ordinal) => {
    const entry = currentById.get(item.entryId);
    if (entry === undefined) return undefined;
    return {
      ordinal,
      entryId: item.entryId,
      entryRevision: item.revision,
      entryRevisionId: entry.revisionId,
      route: item.route,
      reason: item.reason,
    } as const;
  });
  if (regenerated.some((claim) => claim === undefined)) return false;
  const claims = regenerated as readonly Readonly<EntryAutomationClaimInput>[];
  return (
    digestPlan(claims) === execution.planSha256 &&
    execution.claims.every((claim, index) => sameClaim(claim, claims[index]))
  );
}

async function failExecution(
  dependencies: Readonly<EntryAutomationExecutionDependencies>,
  execution: Readonly<EntryAutomationExecution>,
  errorCode: 'automation_revalidation_failed' | 'automation_execution_failed',
  replayed: boolean,
): Promise<Readonly<ExecuteEntryAutomationResult>> {
  if (execution.status === 'failed') {
    const policyPause = await pausePolicy(
      dependencies.preferences,
      execution.workspaceId,
      execution.policyRevision,
    );
    return failedResult(
      execution.runId,
      true,
      execution.errorCode === 'automation_revalidation_failed'
        ? 'automation_revalidation_failed'
        : 'automation_execution_failed',
      policyPause,
      policyPause === 'failed',
    );
  }
  const policyPause = await pausePolicy(
    dependencies.preferences,
    execution.workspaceId,
    execution.policyRevision,
  );
  try {
    const outcome = await dependencies.repository.settleExecution({
      workspaceId: execution.workspaceId,
      runId: execution.runId,
      expectedVersion: execution.version,
      status: 'failed',
      errorCode,
    });
    const current = await dependencies.repository.loadExecution(
      execution.workspaceId,
      execution.runId,
    );
    const recoveryPending =
      policyPause === 'failed' ||
      !['applied', 'unchanged', 'terminal'].includes(outcome) ||
      current?.status !== 'failed';
    return failedResult(
      execution.runId,
      replayed,
      errorCode,
      policyPause,
      recoveryPending,
    );
  } catch {
    return failedResult(
      execution.runId,
      replayed,
      errorCode,
      policyPause,
      true,
    );
  }
}

async function pausePolicy(
  store: ReviewPreferencesStore,
  workspaceId: string,
  expectedRevision: number,
): Promise<EntryAutomationPolicyPauseOutcome> {
  try {
    const updated = await updateReviewPreferences(
      store,
      workspaceId,
      (current) => {
        const policy =
          current.entryAutomationPolicy ?? DEFAULT_ENTRY_AUTOMATION_POLICY;
        if (policy.revision !== expectedRevision || policy.paused) {
          return Object.freeze({next: current, result: 'superseded' as const});
        }
        if (policy.revision >= Number.MAX_SAFE_INTEGER) {
          return Object.freeze({next: current, result: 'failed' as const});
        }
        return Object.freeze({
          next: patchReviewPreferences(current, {
            entryAutomationPolicy: Object.freeze({
              ...policy,
              revision: policy.revision + 1,
              paused: true,
            }),
          }),
          result: 'applied' as const,
        });
      },
    );
    return updated.result;
  } catch {
    return 'failed';
  }
}

function trialRequest(
  request: Readonly<ExecuteEntryAutomationRequest>,
): Parameters<typeof trialInformationEntryAutomationPolicy>[5] {
  return {
    includePrivate: request.includePrivate,
    expectedPolicyRevision: request.expectedPolicyRevision,
    expectedProfileRevision: request.expectedProfileRevision,
    ...(request.expectedEntries === undefined
      ? {}
      : {expectedEntries: request.expectedEntries}),
    ...(request.manualTakeoverEntryIds === undefined
      ? {}
      : {manualTakeoverEntryIds: request.manualTakeoverEntryIds}),
  };
}

function trialResult(
  trial: Readonly<InformationEntryAutomationTrialResult>,
): Readonly<ExecuteEntryAutomationResult> | undefined {
  if (trial.status === 'invalid_request') {
    return Object.freeze({status: 'invalid_request'});
  }
  if (trial.status === 'invalid_policy' || trial.status === 'invalid_profile') {
    return Object.freeze({status: 'not_ready', reason: 'invalid_state'});
  }
  if (trial.status === 'stale_policy') {
    return Object.freeze({status: 'not_ready', reason: 'stale_policy'});
  }
  if (trial.status === 'stale_profile') {
    return Object.freeze({status: 'not_ready', reason: 'stale_profile'});
  }
  if (trial.status === 'stale_entries') {
    return Object.freeze({status: 'not_ready', reason: 'stale_entries'});
  }
  if (trial.activation !== 'ready') {
    return Object.freeze({status: 'not_ready', reason: trial.activation});
  }
  return undefined;
}

function successResult(
  execution: Readonly<EntryAutomationExecution>,
  replayed: boolean,
): Readonly<ExecuteEntryAutomationResult> {
  const counts = {
    advance_candidate: 0,
    manual_review: 0,
    defer_candidate: 0,
  };
  for (const claim of execution.claims) counts[claim.route] += 1;
  return Object.freeze({
    status: 'succeeded',
    runId: execution.runId,
    replayed,
    counts: Object.freeze(counts),
  });
}

function failedResult(
  runId: string,
  replayed: boolean,
  errorCode: 'automation_revalidation_failed' | 'automation_execution_failed',
  policyPause: EntryAutomationPolicyPauseOutcome,
  recoveryPending: boolean,
): Readonly<ExecuteEntryAutomationResult> {
  return Object.freeze({
    status: 'failed',
    runId,
    replayed,
    errorCode,
    policyPause,
    recoveryPending,
  });
}

function sameClaim(
  left: Readonly<EntryAutomationClaimInput>,
  right: Readonly<EntryAutomationClaimInput> | undefined,
): boolean {
  return (
    right?.ordinal === left.ordinal &&
    left.entryId === right.entryId &&
    left.entryRevision === right.entryRevision &&
    left.entryRevisionId === right.entryRevisionId &&
    left.route === right.route &&
    left.reason === right.reason
  );
}

function digestRequest(
  request: Readonly<ExecuteEntryAutomationRequest>,
): string {
  const expectedEntries =
    request.expectedEntries === undefined
      ? null
      : [...request.expectedEntries]
          .map((entry) => ({entryId: entry.entryId, revision: entry.revision}))
          .sort((left, right) => left.entryId.localeCompare(right.entryId));
  const manualTakeoverEntryIds = [
    ...(request.manualTakeoverEntryIds ?? []),
  ].sort();
  return sha256(
    JSON.stringify({
      schemaVersion: 'struinfo.entry-automation-execution-request.v1',
      workspaceId: request.workspaceId,
      includePrivate: request.includePrivate,
      expectedPolicyRevision: request.expectedPolicyRevision,
      expectedProfileRevision: request.expectedProfileRevision,
      expectedEntries,
      manualTakeoverEntryIds,
    }),
  );
}

function digestPlan(
  claims: readonly Readonly<EntryAutomationClaimInput>[],
): string {
  return sha256(
    JSON.stringify({
      schemaVersion: 'struinfo.entry-automation-execution-plan.v1',
      claims: claims.map((claim) => ({
        ordinal: claim.ordinal,
        entryId: claim.entryId,
        entryRevision: claim.entryRevision,
        entryRevisionId: claim.entryRevisionId,
        route: claim.route,
        reason: claim.reason,
      })),
    }),
  );
}

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function validRequest(
  request: Readonly<ExecuteEntryAutomationRequest>,
): boolean {
  return (
    CANONICAL_UUID.test(request.workspaceId) &&
    typeof request.idempotencyKey === 'string' &&
    request.idempotencyKey.trim() === request.idempotencyKey &&
    request.idempotencyKey.length > 0 &&
    Array.from(request.idempotencyKey).length <= 200 &&
    !containsControlCharacter(request.idempotencyKey) &&
    typeof request.includePrivate === 'boolean' &&
    Number.isSafeInteger(request.expectedPolicyRevision) &&
    request.expectedPolicyRevision >= 0 &&
    Number.isSafeInteger(request.expectedProfileRevision) &&
    request.expectedProfileRevision >= 0
  );
}

function containsControlCharacter(value: string): boolean {
  for (const character of value) {
    const codePoint = character.codePointAt(0);
    if (codePoint !== undefined && (codePoint <= 0x1f || codePoint === 0x7f)) {
      return true;
    }
  }
  return false;
}
