import {createHash} from 'node:crypto';

import {
  deriveUuidV5,
  prepareSplitInformationEntries,
  type InformationEntryAssociationRepositoryPort,
  type InformationEntryEmptySnapshotRepositoryPort,
} from '../entries/index.js';
import {
  importMarkdownEvidence,
  materializeEvidenceSnapshot,
  type EvidenceReadRepositoryPort,
  type EvidenceRepositoryPort,
} from '../evidence/index.js';
import {
  deriveProcessingRunId,
  executeEntryAutomationRunActions,
  executeInformationEntryAutomation,
  type EntryAutomationActionRepositoryPort,
  type EntryAutomationExecutionRepositoryPort,
  type EntryAutomationWorkQueueRepositoryPort,
  type ProcessingRunRepositoryPort,
} from '../processing/index.js';
import type {BlobStore} from '../../storage/blob_store.js';
import {
  decodeReviewSourceSubscriptionPreferences,
  DEFAULT_REVIEW_SOURCE_SUBSCRIPTION_PREFERENCES,
  patchReviewPreferences,
  updateReviewPreferences,
  type ReviewPreferences,
  type ReviewPreferencesUpdater,
  type ReviewPreferencesStore,
  type ReviewSourceSubscription,
  type ReviewSourceSubscriptionPreferences,
} from '../../storage/review_preferences_store.js';

const CANONICAL_UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;
const REQUEST_KEY = /^[A-Za-z0-9._:-]{1,80}$/u;

export interface SourceSubscriptionWrite {
  readonly subscriptionId: string;
  readonly label: string;
  readonly enabled: boolean;
  readonly repositoryUri: string;
  readonly repositoryRef: string;
  readonly repositoryPath: string;
  readonly profile: 'commonmark-v1' | 'ruanyf-weekly-v1';
  readonly sourceAlias: string;
  readonly isPrivate: boolean;
  readonly routeAfterImport: boolean;
  readonly intervalMinutes: number;
}

export interface GitSourceSubscriptionRead {
  readonly commitSha: string;
  readonly sourceUtf8: Uint8Array;
  readonly canonicalUri: string;
}

export interface GitSourceSubscriptionReaderPort {
  read(
    subscription: Readonly<ReviewSourceSubscription>,
  ): Promise<Readonly<GitSourceSubscriptionRead>>;
}

export type SourceSubscriptionReaderErrorCode =
  | 'source_not_found'
  | 'source_too_large'
  | 'source_invalid'
  | 'source_unavailable';

export class SourceSubscriptionReaderError extends Error {
  public readonly code: SourceSubscriptionReaderErrorCode;

  public constructor(code: SourceSubscriptionReaderErrorCode) {
    super('The subscribed source could not be read.');
    this.name = 'SourceSubscriptionReaderError';
    this.code = code;
  }
}

export type SourceSubscriptionServiceErrorCode =
  | SourceSubscriptionReaderErrorCode
  | 'source_subscription_invalid'
  | 'source_subscription_not_found'
  | 'source_subscription_stale'
  | 'source_subscription_changed'
  | 'source_subscription_run_conflict'
  | 'source_subscription_run_invalid'
  | 'source_import_rejected'
  | 'source_import_unavailable'
  | 'source_subscription_automation_not_ready'
  | 'source_subscription_automation_failed'
  | 'source_subscription_actions_failed'
  | 'source_subscription_materialization_failed'
  | 'source_subscription_preferences_unavailable';

export class SourceSubscriptionServiceError extends Error {
  public readonly code: SourceSubscriptionServiceErrorCode;

  public constructor(code: SourceSubscriptionServiceErrorCode) {
    super('The source subscription operation failed.');
    this.name = 'SourceSubscriptionServiceError';
    this.code = code;
  }
}

export interface SourceSubscriptionRunResult {
  readonly outcome: 'existing' | 'unchanged' | 'imported';
  readonly runId: string;
  readonly subscriptionId: string;
  readonly snapshotId?: string;
  readonly automationRunId?: string;
  readonly materializedEntryCount?: number;
}

export interface SourceSubscriptionServicePort {
  list(): Promise<Readonly<ReviewSourceSubscriptionPreferences>>;
  replace(
    expectedRevision: number,
    subscriptions: readonly Readonly<SourceSubscriptionWrite>[],
  ): Promise<
    Readonly<{
      outcome: 'applied' | 'unchanged';
      value: Readonly<ReviewSourceSubscriptionPreferences>;
    }>
  >;
  runNow(
    subscriptionId: string,
    requestKey: string,
  ): Promise<Readonly<SourceSubscriptionRunResult>>;
  runDue(): Promise<readonly Readonly<SourceSubscriptionRunResult>[]>;
}

export interface SourceSubscriptionServiceDependencies {
  readonly workspaceId: string;
  readonly preferences: ReviewPreferencesStore;
  readonly processing: ProcessingRunRepositoryPort;
  readonly reader: GitSourceSubscriptionReaderPort;
  readonly blobStore: BlobStore;
  readonly evidence: EvidenceRepositoryPort;
  readonly evidenceRead?: EvidenceReadRepositoryPort;
  readonly entries?: InformationEntryEmptySnapshotRepositoryPort;
  readonly automationExecutions?: EntryAutomationExecutionRepositoryPort;
  readonly automationWorkQueue?: EntryAutomationWorkQueueRepositoryPort;
  readonly automationActions?: EntryAutomationActionRepositoryPort;
  readonly associations?: InformationEntryAssociationRepositoryPort;
  readonly importEvidence?: typeof importMarkdownEvidence;
  readonly now?: () => string;
}

export class SourceSubscriptionService implements SourceSubscriptionServicePort {
  readonly #dependencies: Readonly<SourceSubscriptionServiceDependencies>;

  public constructor(
    dependencies: Readonly<SourceSubscriptionServiceDependencies>,
  ) {
    this.#dependencies = dependencies;
  }

  public async list(): Promise<Readonly<ReviewSourceSubscriptionPreferences>> {
    const preferences = await this.#loadPreferences();
    return (
      preferences.sourceSubscriptions ??
      DEFAULT_REVIEW_SOURCE_SUBSCRIPTION_PREFERENCES
    );
  }

  public async replace(
    expectedRevision: number,
    subscriptions: readonly Readonly<SourceSubscriptionWrite>[],
  ): Promise<
    Readonly<{
      outcome: 'applied' | 'unchanged';
      value: Readonly<ReviewSourceSubscriptionPreferences>;
    }>
  > {
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) {
      throw new SourceSubscriptionServiceError('source_subscription_invalid');
    }
    const decoded = decodeReviewSourceSubscriptionPreferences({
      revision: expectedRevision + 1,
      subscriptions,
    });
    if (decoded === undefined) {
      throw new SourceSubscriptionServiceError('source_subscription_invalid');
    }
    return this.#updatePreferences<
      Readonly<{
        outcome: 'applied' | 'unchanged';
        value: Readonly<ReviewSourceSubscriptionPreferences>;
      }>
    >((preferences) => {
      const current =
        preferences.sourceSubscriptions ??
        DEFAULT_REVIEW_SOURCE_SUBSCRIPTION_PREFERENCES;
      if (current.revision !== expectedRevision) {
        throw new SourceSubscriptionServiceError('source_subscription_stale');
      }
      const previousById = new Map(
        current.subscriptions.map((subscription) => [
          subscription.subscriptionId,
          subscription,
        ]),
      );
      const merged = Object.freeze(
        decoded.subscriptions.map((subscription) => {
          const previous = previousById.get(subscription.subscriptionId);
          return previous !== undefined &&
            sourceConfigurationIdentity(previous) ===
              sourceConfigurationIdentity(subscription)
            ? Object.freeze({
                ...subscription,
                ...(previous.lastAttemptAt === undefined
                  ? {}
                  : {lastAttemptAt: previous.lastAttemptAt}),
                ...(previous.lastSuccessAt === undefined
                  ? {}
                  : {lastSuccessAt: previous.lastSuccessAt}),
                ...(previous.lastRunId === undefined
                  ? {}
                  : {lastRunId: previous.lastRunId}),
                ...(previous.cursor === undefined
                  ? {}
                  : {cursor: Object.freeze({...previous.cursor})}),
              })
            : subscription;
        }),
      );
      if (sameSubscriptionConfigurations(current.subscriptions, merged)) {
        return Object.freeze({
          next: preferences,
          result: Object.freeze({
            outcome: 'unchanged' as const,
            value: current,
          }),
        });
      }
      const next = Object.freeze({
        revision: current.revision + 1,
        subscriptions: merged,
      });
      return Object.freeze({
        next: patchReviewPreferences(preferences, {
          sourceSubscriptions: next,
        }),
        result: Object.freeze({outcome: 'applied' as const, value: next}),
      });
    });
  }

  public async runNow(
    subscriptionId: string,
    requestKey: string,
  ): Promise<Readonly<SourceSubscriptionRunResult>> {
    if (!CANONICAL_UUID.test(subscriptionId) || !REQUEST_KEY.test(requestKey)) {
      throw new SourceSubscriptionServiceError('source_subscription_invalid');
    }
    const subscription = (await this.list()).subscriptions.find(
      (candidate) => candidate.subscriptionId === subscriptionId,
    );
    if (subscription === undefined) {
      throw new SourceSubscriptionServiceError('source_subscription_not_found');
    }
    return this.#run(subscription, `manual:${requestKey}`);
  }

  public async runDue(): Promise<
    readonly Readonly<SourceSubscriptionRunResult>[]
  > {
    const now = this.#now();
    const subscriptions = (await this.list()).subscriptions.filter(
      (subscription) => subscription.enabled && isDue(subscription, now),
    );
    const results: SourceSubscriptionRunResult[] = [];
    for (const subscription of subscriptions) {
      const dueAt = nextDueAt(subscription);
      try {
        results.push(
          await this.#run(
            subscription,
            `scheduled:${dueAt.replace(/[^0-9A-Za-z._:-]/gu, '-')}`,
          ),
        );
      } catch {
        // Each run already records a closed failure state. A broken source must
        // not prevent another due subscription from being checked.
      }
    }
    return Object.freeze(results);
  }

  async #run(
    subscription: Readonly<ReviewSourceSubscription>,
    requestKey: string,
  ): Promise<Readonly<SourceSubscriptionRunResult>> {
    const idempotencyKey = `source-subscription:${subscription.subscriptionId}:${requestKey}`;
    const runId = deriveProcessingRunId(
      this.#dependencies.workspaceId,
      idempotencyKey,
    );
    const created = await this.#dependencies.processing.createRun({
      workspaceId: this.#dependencies.workspaceId,
      runId,
      idempotencyKey,
      origin: 'deterministic',
      privacyScope: subscription.isPrivate ? 'include_private' : 'public_only',
      initialStage: 'import',
      initialStep: '等待检查订阅来源',
    });
    if (created === 'unchanged') {
      return Object.freeze({
        outcome: 'existing',
        runId,
        subscriptionId: subscription.subscriptionId,
      });
    }
    if (created === 'conflict') {
      throw new SourceSubscriptionServiceError(
        'source_subscription_run_conflict',
      );
    }
    if (created !== 'applied') {
      throw new SourceSubscriptionServiceError(
        'source_subscription_run_invalid',
      );
    }
    const running = await this.#dependencies.processing.writeProgress({
      workspaceId: this.#dependencies.workspaceId,
      runId,
      expectedVersion: 1,
      status: 'running',
      currentStage: 'import',
      currentStep: '正在检查 Git 提交与文件内容',
      completedUnits: 0,
      totalUnits: 1,
    });
    if (running !== 'applied') {
      throw new SourceSubscriptionServiceError(
        'source_subscription_run_invalid',
      );
    }
    const attemptAt = this.#now();
    const identity = sourceConfigurationIdentity(subscription);
    try {
      await this.#recordSubscriptionState(subscription, identity, {
        lastAttemptAt: attemptAt,
        lastRunId: runId,
      });
      const read = await this.#dependencies.reader.read(subscription);
      const sourceSha256 = createHash('sha256')
        .update(read.sourceUtf8)
        .digest('hex');
      if (
        subscription.cursor?.commitSha === read.commitSha ||
        subscription.cursor?.sourceSha256 === sourceSha256
      ) {
        await this.#recordSubscriptionState(subscription, identity, {
          lastAttemptAt: attemptAt,
          lastSuccessAt: this.#now(),
          lastRunId: runId,
          cursor: Object.freeze({
            commitSha: read.commitSha,
            sourceSha256,
          }),
        });
        await this.#completeRun(runId, 2, '订阅来源没有内容变化');
        return Object.freeze({
          outcome: 'unchanged',
          runId,
          subscriptionId: subscription.subscriptionId,
        });
      }
      const writing = await this.#dependencies.processing.writeProgress({
        workspaceId: this.#dependencies.workspaceId,
        runId,
        expectedVersion: 2,
        status: 'running',
        currentStage: 'import',
        currentStep: '正在写入变化后的来源 Snapshot',
        completedUnits: 0,
        totalUnits: 1,
      });
      if (writing !== 'applied') {
        throw new SourceSubscriptionServiceError(
          'source_subscription_run_invalid',
        );
      }
      const importInput = subscriptionImportInput(
        this.#dependencies.workspaceId,
        subscription,
        read,
        sourceSha256,
        attemptAt,
      );
      const imported = await (
        this.#dependencies.importEvidence ?? importMarkdownEvidence
      )(
        {
          blobStore: this.#dependencies.blobStore,
          evidenceRepository: this.#dependencies.evidence,
        },
        importInput,
      );
      if (imported.status !== 'created' && imported.status !== 'existing') {
        throw new SourceSubscriptionServiceError(
          imported.status === 'persistence_failed'
            ? 'source_import_unavailable'
            : 'source_import_rejected',
        );
      }
      const routed = subscription.routeAfterImport
        ? await this.#routeImportedSnapshot(
            subscription,
            imported.snapshotId,
            sourceSha256,
          )
        : undefined;
      await this.#recordSubscriptionState(subscription, identity, {
        lastAttemptAt: attemptAt,
        lastSuccessAt: this.#now(),
        lastRunId: runId,
        cursor: Object.freeze({commitSha: read.commitSha, sourceSha256}),
      });
      await this.#completeRun(
        runId,
        3,
        routed === undefined
          ? '新版本已保存为来源 Snapshot'
          : '新版本已保存、拆分并完成自动分流',
      );
      return Object.freeze({
        outcome: 'imported',
        runId,
        subscriptionId: subscription.subscriptionId,
        snapshotId: imported.snapshotId,
        ...(routed ?? {}),
      });
    } catch (error) {
      const code = sourceSubscriptionErrorCode(error);
      const failed = await this.#dependencies.processing.writeProgress({
        workspaceId: this.#dependencies.workspaceId,
        runId,
        expectedVersion: await this.#currentRunVersion(runId),
        status: 'failed',
        currentStage: 'import',
        currentStep: '订阅来源检查失败',
        completedUnits: 0,
        totalUnits: 1,
        errorCode: code,
      });
      if (failed !== 'applied') {
        throw new SourceSubscriptionServiceError(
          'source_subscription_run_invalid',
        );
      }
      throw new SourceSubscriptionServiceError(code);
    }
  }

  async #routeImportedSnapshot(
    subscription: Readonly<ReviewSourceSubscription>,
    snapshotId: string,
    sourceSha256: string,
  ): Promise<
    Readonly<{automationRunId: string; materializedEntryCount: number}>
  > {
    const evidenceRead = this.#dependencies.evidenceRead;
    const entries = this.#dependencies.entries;
    const automationExecutions = this.#dependencies.automationExecutions;
    if (
      evidenceRead === undefined ||
      entries === undefined ||
      automationExecutions === undefined
    ) {
      throw new SourceSubscriptionServiceError(
        'source_subscription_automation_not_ready',
      );
    }
    const preferences = await this.#loadPreferences();
    const policy = preferences.entryAutomationPolicy;
    const profile = preferences.entryPreferenceProfile;
    if (
      policy === undefined ||
      profile === undefined ||
      !policy.enabled ||
      policy.paused ||
      !profile.enabled ||
      policy.profileRevision !== profile.revision
    ) {
      throw new SourceSubscriptionServiceError(
        'source_subscription_automation_not_ready',
      );
    }
    const snapshot = await evidenceRead.loadSnapshot(
      this.#dependencies.workspaceId,
      snapshotId,
    );
    if (
      snapshot === undefined ||
      (snapshot.isPrivate === true) !== subscription.isPrivate
    ) {
      throw new SourceSubscriptionServiceError(
        'source_subscription_materialization_failed',
      );
    }
    const materialized = await materializeEvidenceSnapshot(
      snapshot,
      this.#dependencies.blobStore,
    );
    const prepared = prepareSplitInformationEntries(materialized);
    if (prepared.length === 0) {
      throw new SourceSubscriptionServiceError(
        'source_subscription_materialization_failed',
      );
    }
    await entries.materializeEntriesIfSnapshotEmpty(prepared);
    const current = (
      await entries.loadCurrentEntries(this.#dependencies.workspaceId, true)
    ).filter((entry) => entry.snapshotId === snapshotId);
    if (current.length === 0) {
      throw new SourceSubscriptionServiceError(
        'source_subscription_materialization_failed',
      );
    }
    const result = await executeInformationEntryAutomation(
      {
        repository: automationExecutions,
        entries,
        preferences: this.#dependencies.preferences,
      },
      {
        workspaceId: this.#dependencies.workspaceId,
        idempotencyKey: `source-route:${subscription.subscriptionId}:${sourceSha256}`,
        includePrivate: subscription.isPrivate,
        expectedPolicyRevision: policy.revision,
        expectedProfileRevision: profile.revision,
        expectedEntries: Object.freeze(
          current.map((entry) =>
            Object.freeze({entryId: entry.entryId, revision: entry.revision}),
          ),
        ),
      },
    );
    if (result.status === 'not_ready') {
      throw new SourceSubscriptionServiceError(
        'source_subscription_automation_not_ready',
      );
    }
    if (result.status !== 'succeeded') {
      throw new SourceSubscriptionServiceError(
        'source_subscription_automation_failed',
      );
    }
    const actionsEnabled =
      policy.advanceActions?.deterministicTags === true ||
      policy.advanceActions?.rebuildAssociations === true;
    if (actionsEnabled) {
      const automationWorkQueue = this.#dependencies.automationWorkQueue;
      const automationActions = this.#dependencies.automationActions;
      const associations = this.#dependencies.associations;
      if (
        automationWorkQueue === undefined ||
        automationActions === undefined ||
        associations === undefined
      ) {
        throw new SourceSubscriptionServiceError(
          'source_subscription_automation_not_ready',
        );
      }
      const actionResult = await executeEntryAutomationRunActions(
        {
          repository: automationActions,
          workQueue: automationWorkQueue,
          entries,
          associations,
          preferences: this.#dependencies.preferences,
        },
        {
          workspaceId: this.#dependencies.workspaceId,
          runId: result.runId,
          includePrivate: subscription.isPrivate,
        },
      );
      if (actionResult.status !== 'complete') {
        throw new SourceSubscriptionServiceError(
          'source_subscription_actions_failed',
        );
      }
    }
    return Object.freeze({
      automationRunId: result.runId,
      materializedEntryCount: current.length,
    });
  }

  async #completeRun(
    runId: string,
    expectedVersion: number,
    currentStep: string,
  ): Promise<void> {
    const completed = await this.#dependencies.processing.writeProgress({
      workspaceId: this.#dependencies.workspaceId,
      runId,
      expectedVersion,
      status: 'succeeded',
      currentStage: 'import',
      currentStep,
      completedUnits: 1,
      totalUnits: 1,
    });
    if (completed !== 'applied') {
      throw new SourceSubscriptionServiceError(
        'source_subscription_run_invalid',
      );
    }
  }

  async #currentRunVersion(runId: string): Promise<number> {
    const runs = await this.#dependencies.processing.listRecentRuns(
      this.#dependencies.workspaceId,
      100,
    );
    const run = runs.find((candidate) => candidate.runId === runId);
    if (run?.status !== 'running') {
      throw new SourceSubscriptionServiceError(
        'source_subscription_run_invalid',
      );
    }
    return run.version;
  }

  async #recordSubscriptionState(
    original: Readonly<ReviewSourceSubscription>,
    configurationIdentity: string,
    state: Readonly<
      Pick<ReviewSourceSubscription, 'lastAttemptAt' | 'lastRunId'> &
        Partial<Pick<ReviewSourceSubscription, 'lastSuccessAt' | 'cursor'>>
    >,
  ): Promise<void> {
    await this.#updatePreferences((preferences) => {
      const current =
        preferences.sourceSubscriptions ??
        DEFAULT_REVIEW_SOURCE_SUBSCRIPTION_PREFERENCES;
      const index = current.subscriptions.findIndex(
        (candidate) => candidate.subscriptionId === original.subscriptionId,
      );
      const candidate = current.subscriptions[index];
      if (
        candidate === undefined ||
        sourceConfigurationIdentity(candidate) !== configurationIdentity
      ) {
        throw new SourceSubscriptionServiceError('source_subscription_changed');
      }
      const subscriptions = current.subscriptions.map(
        (subscription, ordinal) =>
          ordinal === index
            ? Object.freeze({...subscription, ...state})
            : subscription,
      );
      return Object.freeze({
        next: patchReviewPreferences(preferences, {
          sourceSubscriptions: Object.freeze({
            revision: current.revision + 1,
            subscriptions: Object.freeze(subscriptions),
          }),
        }),
        result: undefined,
      });
    });
  }

  async #loadPreferences(): Promise<Readonly<ReviewPreferences>> {
    try {
      return await this.#dependencies.preferences.load(
        this.#dependencies.workspaceId,
      );
    } catch {
      throw new SourceSubscriptionServiceError(
        'source_subscription_preferences_unavailable',
      );
    }
  }

  async #updatePreferences<T>(
    updater: ReviewPreferencesUpdater<T>,
  ): Promise<T> {
    try {
      return (
        await updateReviewPreferences(
          this.#dependencies.preferences,
          this.#dependencies.workspaceId,
          updater,
        )
      ).result;
    } catch (error) {
      if (error instanceof SourceSubscriptionServiceError) throw error;
      throw new SourceSubscriptionServiceError(
        'source_subscription_preferences_unavailable',
      );
    }
  }

  #now(): string {
    return (this.#dependencies.now ?? defaultNow)();
  }
}

function subscriptionImportInput(
  workspaceId: string,
  subscription: Readonly<ReviewSourceSubscription>,
  read: Readonly<GitSourceSubscriptionRead>,
  sourceSha256: string,
  capturedAt: string,
) {
  const sourceIdentity = sourceContentIdentity(subscription);
  const resourceId = deriveUuidV5(
    workspaceId,
    `struinfo:source-subscription-resource:v1:${subscription.subscriptionId}:${sourceIdentity}`,
  );
  const snapshotId = deriveUuidV5(
    resourceId,
    `struinfo:source-subscription-snapshot:v1:${subscription.profile}:${sourceSha256}`,
  );
  const observationId = deriveUuidV5(
    snapshotId,
    `struinfo:source-subscription-observation:v1:${read.commitSha}`,
  );
  return Object.freeze({
    workspaceId,
    commandIdempotencyKey: `source-subscription-import:${subscription.subscriptionId}:${subscription.profile}:${sourceSha256}`,
    resource: Object.freeze({
      workspaceId,
      resourceId,
      resourceKind: 'git_file' as const,
      sourceKey: subscription.sourceAlias,
      canonicalUri: read.canonicalUri,
      ...(subscription.isPrivate ? {isPrivate: true as const} : {}),
    }),
    gitResource: Object.freeze({
      workspaceId,
      resourceId,
      canonicalRepositoryUri: subscription.repositoryUri,
      repositoryRelativePath: subscription.repositoryPath,
    }),
    snapshot: Object.freeze({
      workspaceId,
      resourceId,
      snapshotId,
      capturedAt,
      mediaType: 'text/markdown',
    }),
    gitObservations: Object.freeze([
      Object.freeze({
        workspaceId,
        observationId,
        resourceId,
        snapshotId,
        repositoryRef: subscription.repositoryRef,
        commit: Object.freeze({
          algorithm: 'sha1' as const,
          digest: read.commitSha,
        }),
        observedAt: capturedAt,
      }),
    ]),
    profile: subscription.profile,
    sourceUtf8: Uint8Array.from(read.sourceUtf8),
    documentBaseUri: read.canonicalUri,
  });
}

function sourceConfigurationIdentity(
  subscription: Readonly<ReviewSourceSubscription>,
): string {
  return createHash('sha256')
    .update(
      JSON.stringify([
        subscription.repositoryUri,
        subscription.repositoryRef,
        subscription.repositoryPath,
        subscription.profile,
        subscription.sourceAlias,
        subscription.isPrivate,
        subscription.routeAfterImport,
      ]),
    )
    .digest('hex');
}

function sourceContentIdentity(
  subscription: Readonly<ReviewSourceSubscription>,
): string {
  return createHash('sha256')
    .update(
      JSON.stringify([
        subscription.repositoryUri,
        subscription.repositoryRef,
        subscription.repositoryPath,
        subscription.profile,
        subscription.sourceAlias,
        subscription.isPrivate,
      ]),
    )
    .digest('hex');
}

function sameSubscriptionConfigurations(
  left: readonly Readonly<ReviewSourceSubscription>[],
  right: readonly Readonly<ReviewSourceSubscription>[],
): boolean {
  return (
    left.length === right.length &&
    left.every((current, index) => {
      const candidate = right[index];
      if (candidate === undefined) return false;
      return (
        current.subscriptionId === candidate.subscriptionId &&
        current.label === candidate.label &&
        current.enabled === candidate.enabled &&
        current.intervalMinutes === candidate.intervalMinutes &&
        sourceConfigurationIdentity(current) ===
          sourceConfigurationIdentity(candidate)
      );
    })
  );
}

function isDue(
  subscription: Readonly<ReviewSourceSubscription>,
  now: string,
): boolean {
  return new Date(nextDueAt(subscription)).valueOf() <= new Date(now).valueOf();
}

function nextDueAt(subscription: Readonly<ReviewSourceSubscription>): string {
  if (subscription.lastAttemptAt === undefined)
    return new Date(0).toISOString();
  return new Date(
    new Date(subscription.lastAttemptAt).valueOf() +
      subscription.intervalMinutes * 60_000,
  ).toISOString();
}

function sourceSubscriptionErrorCode(
  error: unknown,
): SourceSubscriptionServiceErrorCode {
  if (error instanceof SourceSubscriptionReaderError) return error.code;
  if (error instanceof SourceSubscriptionServiceError) return error.code;
  return 'source_import_unavailable';
}

function defaultNow(): string {
  return new Date().toISOString();
}
