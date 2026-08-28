import {describe, expect, it} from 'vitest';

import {
  createReviewPreferences,
  type EntryAutomationPolicy,
  type EntryPreferenceProfile,
  type ReviewPreferences,
  type ReviewPreferencesStore,
  type ReviewPreferencesUpdater,
  type ReviewPreferencesUpdateResult,
} from '../../storage/review_preferences_store.js';
import type {
  CurrentInformationEntry,
  InformationEntryRepositoryPort,
} from '../entries/index.js';
import type {
  EntryAutomationClaim,
  EntryAutomationExecution,
  EntryAutomationExecutionInitialize,
  EntryAutomationExecutionRepositoryPort,
  EntryAutomationExecutionSettle,
  ProcessingRunWriteOutcome,
} from './index.js';
import {executeInformationEntryAutomation} from './entry_automation_execution_service.js';

const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';
const RESOURCE_ID = '22222222-2222-4222-8222-222222222222';
const SNAPSHOT_ID = '33333333-3333-4333-8333-333333333333';

describe('Entry automation execution service', () => {
  it('persists and completes exact routing claims without mutating Entries', async () => {
    const entries = new MemoryEntries([
      entry(1, {keywords: ['advance']}),
      entry(2, {keywords: ['defer']}),
      entry(3, {}),
    ]);
    const preferences = new MemoryPreferences(validPreferences());
    const repository = new MemoryExecutionRepository();

    const result = await executeInformationEntryAutomation(
      {repository, entries, preferences},
      request('synthetic-execution-1'),
    );

    expect(result).toMatchObject({
      status: 'succeeded',
      replayed: false,
      counts: {
        advance_candidate: 1,
        manual_review: 1,
        defer_candidate: 1,
      },
    });
    expect(repository.current?.status).toBe('succeeded');
    expect(repository.current?.version).toBe(3);
    expect(
      repository.current?.claims.map(({route, status}) => ({route, status})),
    ).toEqual([
      {route: 'advance_candidate', status: 'completed'},
      {route: 'defer_candidate', status: 'completed'},
      {route: 'manual_review', status: 'completed'},
    ]);
    expect(entries.values.map((value) => value.revision)).toEqual([1, 1, 1]);
  });

  it('replays a finished run and rejects different input under the same key', async () => {
    const dependencies = {
      repository: new MemoryExecutionRepository(),
      entries: new MemoryEntries([entry(1, {keywords: ['advance']})]),
      preferences: new MemoryPreferences(validPreferences()),
    };
    const first = await executeInformationEntryAutomation(
      dependencies,
      request('synthetic-replay'),
    );
    const replay = await executeInformationEntryAutomation(
      dependencies,
      request('synthetic-replay'),
    );
    const conflict = await executeInformationEntryAutomation(dependencies, {
      ...request('synthetic-replay'),
      manualTakeoverEntryIds: [entryId(1)],
    });

    expect(first.status).toBe('succeeded');
    expect(replay).toMatchObject({status: 'succeeded', replayed: true});
    expect(conflict).toMatchObject({status: 'conflict'});
  });

  it('does not create a run while the independent policy authority is disabled', async () => {
    const preferences = validPreferences({
      policy: {...validPolicy(), enabled: false},
    });
    const repository = new MemoryExecutionRepository();

    await expect(
      executeInformationEntryAutomation(
        {
          repository,
          entries: new MemoryEntries([entry(1, {keywords: ['advance']})]),
          preferences: new MemoryPreferences(preferences),
        },
        request('synthetic-disabled'),
      ),
    ).resolves.toEqual({status: 'not_ready', reason: 'disabled'});
    expect(repository.current).toBeUndefined();
  });

  it('records manual takeover as a manual-review claim', async () => {
    const repository = new MemoryExecutionRepository();
    await executeInformationEntryAutomation(
      {
        repository,
        entries: new MemoryEntries([entry(1, {keywords: ['advance']})]),
        preferences: new MemoryPreferences(validPreferences()),
      },
      {
        ...request('synthetic-takeover'),
        manualTakeoverEntryIds: [entryId(1)],
      },
    );

    expect(repository.current?.claims[0]).toMatchObject({
      route: 'manual_review',
      reason: 'manual_takeover',
      status: 'completed',
    });
  });

  it('compensates claims and pauses the exact policy when Entry state changes', async () => {
    const entries = new MemoryEntries([entry(1, {keywords: ['advance']})]);
    const preferences = new MemoryPreferences(validPreferences());
    const repository = new MemoryExecutionRepository(() => {
      entries.values = [entry(1, {revision: 2, keywords: ['advance']})];
    });

    const result = await executeInformationEntryAutomation(
      {repository, entries, preferences},
      request('synthetic-stale'),
    );

    expect(result).toMatchObject({
      status: 'failed',
      errorCode: 'automation_revalidation_failed',
      policyPause: 'applied',
      recoveryPending: false,
    });
    expect(repository.current?.status).toBe('failed');
    expect(repository.current?.claims[0]).toMatchObject({
      status: 'compensated',
      errorCode: 'automation_revalidation_failed',
    });
    expect(preferences.value.entryAutomationPolicy).toMatchObject({
      revision: 5,
      paused: true,
    });
  });

  it('keeps recovery pending and retries the policy pause on failed-run replay', async () => {
    const entries = new MemoryEntries([entry(1, {keywords: ['advance']})]);
    const preferences = new FailingPausePreferences(validPreferences());
    const repository = new MemoryExecutionRepository(() => {
      entries.values = [entry(1, {revision: 2, keywords: ['advance']})];
    });
    const executionRequest = request('synthetic-pause-recovery');

    const first = await executeInformationEntryAutomation(
      {repository, entries, preferences},
      executionRequest,
    );

    expect(first).toMatchObject({
      status: 'failed',
      policyPause: 'failed',
      recoveryPending: true,
    });
    expect(repository.current?.status).toBe('failed');

    const recoveredPreferences = new MemoryPreferences(preferences.value);
    const replay = await executeInformationEntryAutomation(
      {repository, entries, preferences: recoveredPreferences},
      executionRequest,
    );

    expect(replay).toMatchObject({
      status: 'failed',
      replayed: true,
      policyPause: 'applied',
      recoveryPending: false,
    });
    expect(recoveredPreferences.value.entryAutomationPolicy).toMatchObject({
      revision: 5,
      paused: true,
    });
  });

  it('applies privacy scope before claims are counted', async () => {
    const repository = new MemoryExecutionRepository();
    await executeInformationEntryAutomation(
      {
        repository,
        entries: new MemoryEntries([
          entry(1, {keywords: ['advance']}),
          entry(2, {keywords: ['advance'], isPrivate: true}),
        ]),
        preferences: new MemoryPreferences(validPreferences()),
      },
      request('synthetic-public-only'),
    );

    expect(repository.current?.includePrivate).toBe(false);
    expect(repository.current?.claims.map((claim) => claim.entryId)).toEqual([
      entryId(1),
    ]);
  });
});

class MemoryEntries implements InformationEntryRepositoryPort {
  public values: readonly Readonly<CurrentInformationEntry>[];

  public constructor(values: readonly Readonly<CurrentInformationEntry>[]) {
    this.values = values;
  }

  public materializeEntries(): Promise<never> {
    return Promise.reject(new Error('not used'));
  }

  public reviseEntry(): Promise<never> {
    return Promise.reject(new Error('not used'));
  }

  public loadCurrentEntries(): Promise<
    readonly Readonly<CurrentInformationEntry>[]
  > {
    return Promise.resolve(this.values);
  }
}

class MemoryPreferences implements ReviewPreferencesStore {
  public value: Readonly<ReviewPreferences>;

  public constructor(value: Readonly<ReviewPreferences>) {
    this.value = value;
  }

  public load(): Promise<Readonly<ReviewPreferences>> {
    return Promise.resolve(this.value);
  }

  public save(): Promise<Readonly<ReviewPreferences>> {
    return Promise.reject(new Error('update is required'));
  }

  public update<T>(
    workspaceId: string,
    updater: ReviewPreferencesUpdater<T>,
  ): Promise<Readonly<ReviewPreferencesUpdateResult<T>>> {
    void workspaceId;
    const update = updater(this.value);
    this.value = update.next;
    return Promise.resolve(
      Object.freeze({preferences: this.value, result: update.result}),
    );
  }
}

class FailingPausePreferences extends MemoryPreferences {
  public override update<T>(): Promise<
    Readonly<ReviewPreferencesUpdateResult<T>>
  > {
    return Promise.reject(new Error('synthetic preference failure'));
  }
}

class MemoryExecutionRepository implements EntryAutomationExecutionRepositoryPort {
  public current: Readonly<EntryAutomationExecution> | undefined;
  readonly #afterStart: (() => void) | undefined;

  public constructor(afterStart?: () => void) {
    this.#afterStart = afterStart;
  }

  public loadExecution(): Promise<
    Readonly<EntryAutomationExecution> | undefined
  > {
    return Promise.resolve(this.current);
  }

  public initializeExecution(
    initialize: Readonly<EntryAutomationExecutionInitialize>,
  ): Promise<ProcessingRunWriteOutcome> {
    if (this.current !== undefined) {
      return Promise.resolve(
        this.current.requestSha256 === initialize.requestSha256 &&
          this.current.planSha256 === initialize.planSha256
          ? 'unchanged'
          : 'conflict',
      );
    }
    this.current = Object.freeze({
      workspaceId: initialize.workspaceId,
      runId: initialize.runId,
      idempotencyKey: initialize.idempotencyKey,
      requestSha256: initialize.requestSha256,
      planSha256: initialize.planSha256,
      policyRevision: initialize.policyRevision,
      profileRevision: initialize.profileRevision,
      includePrivate: initialize.includePrivate,
      status: 'queued',
      version: 1,
      claims: Object.freeze(
        initialize.claims.map((claim) => claimValue(initialize, claim)),
      ),
    });
    return Promise.resolve('applied');
  }

  public startExecution(
    _workspaceId: string,
    _runId: string,
    expectedVersion: number,
  ): Promise<ProcessingRunWriteOutcome> {
    if (this.current === undefined) return Promise.resolve('not_found');
    if (this.current.status === 'running') return Promise.resolve('unchanged');
    if (this.current.status !== 'queued') return Promise.resolve('terminal');
    if (this.current.version !== expectedVersion)
      return Promise.resolve('stale');
    this.current = Object.freeze({
      ...this.current,
      status: 'running',
      version: 2,
    });
    this.#afterStart?.();
    return Promise.resolve('applied');
  }

  public settleExecution(
    settle: Readonly<EntryAutomationExecutionSettle>,
  ): Promise<ProcessingRunWriteOutcome> {
    if (this.current === undefined) return Promise.resolve('not_found');
    if (this.current.status === settle.status)
      return Promise.resolve('unchanged');
    if (this.current.version !== settle.expectedVersion) {
      return Promise.resolve('stale');
    }
    const claimStatus =
      settle.status === 'succeeded' ? 'completed' : 'compensated';
    const claims = this.current.claims.map((claim) =>
      Object.freeze({
        ...claim,
        status: claimStatus,
        ...(settle.errorCode === undefined
          ? {}
          : {errorCode: settle.errorCode}),
        finishedAt: '2040-01-02T03:04:06.000Z',
      }),
    );
    this.current = Object.freeze({
      ...this.current,
      status: settle.status,
      version: this.current.version + 1,
      ...(settle.errorCode === undefined ? {} : {errorCode: settle.errorCode}),
      claims: Object.freeze(claims),
    });
    return Promise.resolve('applied');
  }
}

function claimValue(
  initialize: Readonly<EntryAutomationExecutionInitialize>,
  claim: Readonly<EntryAutomationExecutionInitialize['claims'][number]>,
): Readonly<EntryAutomationClaim> {
  return Object.freeze({
    workspaceId: initialize.workspaceId,
    runId: initialize.runId,
    ...claim,
    status: 'claimed',
    createdAt: '2040-01-02T03:04:05.000Z',
  });
}

function request(idempotencyKey: string) {
  return {
    workspaceId: WORKSPACE_ID,
    idempotencyKey,
    includePrivate: false,
    expectedPolicyRevision: 4,
    expectedProfileRevision: 2,
  } as const;
}

function validPreferences(
  options: Readonly<{policy?: EntryAutomationPolicy}> = {},
): Readonly<ReviewPreferences> {
  return createReviewPreferences(
    WORKSPACE_ID,
    [],
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    validProfile(),
    options.policy ?? validPolicy(),
  );
}

function validPolicy(): EntryAutomationPolicy {
  return {
    revision: 4,
    enabled: true,
    paused: false,
    profileRevision: 2,
    minimumMatchedRuleCount: 1,
    advanceThresholds: {usefulness: 3, interest: 3, requiredDimensions: 1},
    deferThresholds: {usefulness: 3, interest: 3, requiredDimensions: 1},
    budgets: {
      maximumEntriesPerRun: 5,
      maximumAdvanceCandidatesPerRun: 2,
      maximumDeferCandidatesPerRun: 2,
    },
    failureMode: 'pause',
  };
}

function validProfile(): EntryPreferenceProfile {
  return {
    revision: 2,
    enabled: true,
    rules: [
      {
        ruleId: '77777777-7777-4777-8777-777777777771',
        dimension: 'usefulness',
        featureKind: 'content_keyword',
        featureIdentity: 'advance',
        displayValue: 'Advance',
        effect: 'prefer',
        weight: 5,
      },
      {
        ruleId: '77777777-7777-4777-8777-777777777772',
        dimension: 'interest',
        featureKind: 'content_keyword',
        featureIdentity: 'defer',
        displayValue: 'Defer',
        effect: 'deprioritize',
        weight: 5,
      },
    ],
  };
}

function entry(
  ordinal: number,
  options: Readonly<{
    revision?: number;
    isPrivate?: boolean;
    keywords?: readonly string[];
  }>,
): Readonly<CurrentInformationEntry> {
  const revision = options.revision ?? 1;
  return Object.freeze({
    workspaceId: WORKSPACE_ID,
    entryId: entryId(ordinal),
    resourceId: RESOURCE_ID,
    snapshotId: SNAPSHOT_ID,
    revision,
    revisionId: revisionId(ordinal, revision),
    sourceKey: 'synthetic:automation-execution',
    capturedAt: '2040-01-02T00:00:00.000Z',
    value: Object.freeze({
      documentOrder: ordinal - 1,
      titlePath: `Synthetic Entry ${ordinal.toString()}`,
      body: `Synthetic body ${ordinal.toString()}`,
      bodySha256: ordinal.toString(16).padStart(64, '0'),
      chunkMode: 'split' as const,
      splitRuleVersion: 'synthetic.v1',
      isPrivate: options.isPrivate ?? false,
      contentKeywords: Object.freeze(
        (options.keywords ?? []).map((keyword) =>
          Object.freeze({
            displayValue: keyword,
            normalizedValue: keyword,
            origin: 'manual' as const,
            originVersion: 'synthetic.v1',
          }),
        ),
      ),
      domains: Object.freeze([]),
      fragmentIds: Object.freeze([fragmentId(ordinal)]),
    }),
  });
}

function entryId(ordinal: number): string {
  return `44444444-4444-4444-8444-${ordinal.toString().padStart(12, '0')}`;
}

function revisionId(ordinal: number, revision: number): string {
  return `55555555-5555-4555-8555-${(ordinal * 100 + revision)
    .toString()
    .padStart(12, '0')}`;
}

function fragmentId(ordinal: number): string {
  return `66666666-6666-4666-8666-${ordinal.toString().padStart(12, '0')}`;
}
