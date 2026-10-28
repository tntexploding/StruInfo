import {createHash} from 'node:crypto';
import type {SourceProcessingProfile} from './source_processing_profile.js';
import {
  DEFAULT_SOURCE_RECEIVING,
  sourceSchedule,
  type Reception,
  type SourceReceiving,
  type SourceCheckState,
  type SourceReceivingStatus,
} from './source_receiving.js';

import {deriveUuidV5} from '../entries/index.js';
import {
  importMarkdownEvidence,
  type EvidenceReadRepositoryPort,
  type EvidenceRepositoryPort,
} from '../evidence/index.js';
import {
  deriveProcessingRunId,
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
  type ReviewGitSourceSubscriptionCursor,
  type ReviewGitSourceSubscription,
  type ReviewJsonApiSourceSubscription,
  type ReviewJsonApiSourceSubscriptionCursor,
  type ReviewPluginSourceSubscription,
  type ReviewPluginSourceSubscriptionCursor,
  type ReviewRssSourceSubscription,
  type ReviewRssSourceSubscriptionCursor,
  type ReviewSourceSubscription,
  type ReviewSourceSubscriptionPreferences,
  type ReviewWebSourceSubscription,
  type ReviewWebSourceSubscriptionCursor,
} from '../../storage/review_preferences_store.js';
import {
  importSourceConnectorDocuments,
  SourceConnectorError,
  type SourceConnectorCapability,
  type SourceConnectorRegistry,
} from './source_connector.js';

const CANONICAL_UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;
const REQUEST_KEY = /^[A-Za-z0-9._:-]{1,80}$/u;
const RSS_ATOM_CONNECTOR_ID = 'builtin.rss-atom.v1';
const JSON_API_CONNECTOR_ID = 'builtin.json-api.v1';
const WEB_CONNECTOR_ID = 'builtin.web.v1';

interface SourceSubscriptionWriteBase {
  readonly processingProfile?: SourceProcessingProfile;
  readonly receiving?: SourceReceiving;
  readonly subscriptionId: string;
  readonly label: string;
  readonly description?: string;
  readonly enabled: boolean;
  readonly sourceAlias: string;
  readonly isPrivate: boolean;
  readonly intervalMinutes: number;
}

export interface GitSourceSubscriptionWrite extends SourceSubscriptionWriteBase {
  readonly kind?: 'github_markdown';
  readonly repositoryUri: string;
  readonly repositoryRef: string;
  readonly repositoryPath: string;
  readonly profile: 'commonmark-v1' | 'ruanyf-weekly-v1';
}

export interface RssSourceSubscriptionWrite extends SourceSubscriptionWriteBase {
  readonly kind: 'rss_atom';
  readonly feedUrl: string;
  readonly itemLimit: number;
}

export interface JsonApiSourceSubscriptionWrite extends SourceSubscriptionWriteBase {
  readonly kind: 'json_api';
  readonly endpointUrl: string;
  readonly recordsPath: string;
  readonly externalIdPath: string;
  readonly titlePath: string;
  readonly bodyPath: string;
  readonly canonicalUriPath?: string;
  readonly publishedAtPath?: string;
  readonly versionPath?: string;
  readonly recordLimit: number;
  readonly pageCursor?: Readonly<{
    queryParameter: string;
    responsePath: string;
  }>;
  readonly incrementalCursor?: Readonly<{
    queryParameter: string;
    responsePath: string;
  }>;
  readonly authentication:
    Readonly<{kind: 'none'}> | Readonly<{kind: 'bearer_env'; variable: string}>;
}

export interface WebSourceSubscriptionWrite extends SourceSubscriptionWriteBase {
  readonly kind: 'web';
  readonly pageUrl: string;
  readonly additionalPaths: readonly string[];
}

export interface PluginSourceSubscriptionWrite extends SourceSubscriptionWriteBase {
  readonly kind: 'plugin';
  readonly connectorId: string;
  readonly configurationRef: string;
}

export type SourceSubscriptionWrite =
  | GitSourceSubscriptionWrite
  | RssSourceSubscriptionWrite
  | JsonApiSourceSubscriptionWrite
  | WebSourceSubscriptionWrite
  | PluginSourceSubscriptionWrite;

export interface GitSourceSubscriptionRead {
  readonly commitSha: string;
  readonly sourceUtf8: Uint8Array;
  readonly canonicalUri: string;
}

export interface GitSourceSubscriptionReaderPort {
  read(
    subscription: Readonly<ReviewGitSourceSubscription>,
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
  readonly snapshotIds?: readonly string[];
  readonly importedDocumentCount?: number;
}

export interface SourceSubscriptionServicePort {
  receivingStatus?(): Promise<Readonly<Record<string, SourceReceivingStatus>>>;
  list(): Promise<Readonly<ReviewSourceSubscriptionPreferences>>;
  connectorCapabilities?(): readonly Readonly<SourceConnectorCapability>[];
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
    authorize?: (source: Readonly<SourceSubscriptionWrite>) => void,
  ): Promise<Readonly<SourceSubscriptionRunResult>>;
  runDue(): Promise<readonly Readonly<SourceSubscriptionRunResult>[]>;
}

export interface SourceSubscriptionServiceDependencies {
  readonly workspaceId: string;
  readonly preferences: ReviewPreferencesStore;
  readonly processing: ProcessingRunRepositoryPort;
  readonly reader: GitSourceSubscriptionReaderPort;
  readonly connectors?: SourceConnectorRegistry;
  readonly blobStore: BlobStore;
  readonly evidence: EvidenceRepositoryPort;
  readonly evidenceForSubscription?: (
    subscriptionId: string,
    reception?: Reception,
  ) => EvidenceRepositoryPort;
  readonly pendingCounts?: () => Promise<Readonly<Record<string, number>>>;
  readonly evidenceRead?: EvidenceReadRepositoryPort;
  readonly importEvidence?: typeof importMarkdownEvidence;
  readonly importConnectorDocuments?: typeof importSourceConnectorDocuments;
  readonly now?: () => string;
}

interface SourceSubscriptionState {
  readonly checkState?: SourceCheckState;
  readonly qualityReview?: ReviewSourceSubscription['qualityReview'];
  readonly lastAttemptAt?: string;
  readonly lastRunId?: string;
  readonly lastSuccessAt?: string;
  readonly cursor?:
    | Readonly<ReviewGitSourceSubscriptionCursor>
    | Readonly<ReviewRssSourceSubscriptionCursor>
    | Readonly<ReviewJsonApiSourceSubscriptionCursor>
    | Readonly<ReviewWebSourceSubscriptionCursor>
    | Readonly<ReviewPluginSourceSubscriptionCursor>;
}

export class SourceSubscriptionService implements SourceSubscriptionServicePort {
  readonly #dependencies: Readonly<SourceSubscriptionServiceDependencies>;
  readonly #subscriptionRuns = new Map<string, Promise<void>>();

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

  public connectorCapabilities(): readonly Readonly<SourceConnectorCapability>[] {
    return this.#dependencies.connectors?.capabilities() ?? Object.freeze([]);
  }

  public async receivingStatus(): Promise<
    Readonly<Record<string, SourceReceivingStatus>>
  > {
    const [preferences, pending] = await Promise.all([
      this.list(),
      this.#dependencies.pendingCounts?.(),
    ]);
    return Object.fromEntries(
      preferences.subscriptions.map((source) => [
        source.subscriptionId,
        {
          ...sourceSchedule(source, this.#now()),
          live: 'poll' as const,
          history:
            source.receiving?.history === 'none'
              ? ('disabled' as const)
              : source.kind === 'rss_atom' || source.kind === 'web'
                ? ('public_index' as const)
                : ('not_supported' as const),
          pendingCount: pending?.[source.subscriptionId] ?? 0,
          lastNewAt: source.checkState?.lastNewAt ?? null,
          errorCode: source.checkState?.errorCode ?? null,
          failures: source.checkState?.failures ?? 0,
        },
      ]),
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
    if (
      !Number.isSafeInteger(expectedRevision) ||
      expectedRevision < 0 ||
      subscriptions.some((s) => 'routeAfterImport' in s)
    ) {
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
            ? copySourceSubscriptionWithState(subscription, {
                ...(previous.checkState
                  ? {checkState: previous.checkState}
                  : {}),
                ...(previous.qualityReview
                  ? {qualityReview: previous.qualityReview}
                  : {}),
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
                  : {cursor: previous.cursor}),
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
    authorize?: (source: Readonly<SourceSubscriptionWrite>) => void,
  ): Promise<Readonly<SourceSubscriptionRunResult>> {
    if (!CANONICAL_UUID.test(subscriptionId) || !REQUEST_KEY.test(requestKey)) {
      throw new SourceSubscriptionServiceError('source_subscription_invalid');
    }
    return this.#serializeSubscriptionRun(subscriptionId, async () => {
      const subscription = (await this.list()).subscriptions.find(
        (candidate) => candidate.subscriptionId === subscriptionId,
      );
      if (subscription === undefined) {
        throw new SourceSubscriptionServiceError(
          'source_subscription_not_found',
        );
      }
      authorize?.(subscription);
      return this.#run(subscription, `manual:${requestKey}`);
    });
  }

  public async runDue(): Promise<
    readonly Readonly<SourceSubscriptionRunResult>[]
  > {
    const now = this.#now();
    const subscriptions = (await this.list()).subscriptions
      .filter((subscription) => isDue(subscription, now))
      .sort((a, b) =>
        (sourceSchedule(a, now).nextCheckAt ?? '').localeCompare(
          sourceSchedule(b, now).nextCheckAt ?? '',
        ),
      );
    const results: SourceSubscriptionRunResult[] = [];
    for (const subscription of subscriptions) {
      try {
        const result = await this.#serializeSubscriptionRun(
          subscription.subscriptionId,
          async () => {
            const current = (await this.list()).subscriptions.find(
              (candidate) =>
                candidate.subscriptionId === subscription.subscriptionId,
            );
            if (
              current === undefined ||
              !current.enabled ||
              !isDue(current, this.#now())
            ) {
              return undefined;
            }
            const dueAt = sourceSchedule(current, this.#now()).nextCheckAt;
            if (dueAt === null) return undefined;
            return this.#run(
              current,
              `scheduled:${dueAt.replace(/[^0-9A-Za-z._:-]/gu, '-')}`,
            );
          },
        );
        if (result !== undefined) results.push(result);
      } catch {
        // Each run already records a closed failure state. A broken source must
        // not prevent another due subscription from being checked.
      }
    }
    return Object.freeze(results);
  }

  async #serializeSubscriptionRun<T>(
    subscriptionId: string,
    operation: () => Promise<T>,
  ): Promise<T> {
    // API checks and the scheduler share this service in the supported single
    // instance. Load the current cursor only after earlier work has settled.
    const previous =
      this.#subscriptionRuns.get(subscriptionId) ?? Promise.resolve();
    const run = previous.then(operation);
    const settled = run.then(
      () => undefined,
      () => undefined,
    );
    this.#subscriptionRuns.set(subscriptionId, settled);
    try {
      return await run;
    } finally {
      if (this.#subscriptionRuns.get(subscriptionId) === settled) {
        this.#subscriptionRuns.delete(subscriptionId);
      }
    }
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
      currentStep: '正在检查外部信源内容',
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
      if (
        subscription.kind === 'rss_atom' ||
        subscription.kind === 'json_api' ||
        subscription.kind === 'web' ||
        subscription.kind === 'plugin'
      ) {
        return await this.#runConnectorSubscription(
          subscription,
          identity,
          runId,
          attemptAt,
        );
      }
      const read = await this.#dependencies.reader.read(subscription);
      const sourceSha256 = createHash('sha256')
        .update(read.sourceUtf8)
        .digest('hex');
      if (
        subscription.cursor?.commitSha === read.commitSha ||
        subscription.cursor?.sourceSha256 === sourceSha256
      ) {
        await this.#recordSubscriptionState(subscription, identity, {
          checkState: {
            failures: 0,
            ...(subscription.checkState?.lastNewAt
              ? {lastNewAt: subscription.checkState.lastNewAt}
              : {}),
          },
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
      const existing = await this.#dependencies.evidenceRead?.loadSnapshot(
        this.#dependencies.workspaceId,
        importInput.snapshot.snapshotId,
      );
      if (existing && Boolean(existing.isPrivate) !== subscription.isPrivate)
        throw new SourceSubscriptionServiceError('source_import_rejected');
      const imported = existing
        ? {status: 'existing' as const, snapshotId: existing.snapshotId}
        : await (this.#dependencies.importEvidence ?? importMarkdownEvidence)(
            {
              blobStore: this.#dependencies.blobStore,
              evidenceRepository:
                this.#dependencies.evidenceForSubscription?.(
                  subscription.subscriptionId,
                  {
                    channel: 'live',
                    strategy:
                      subscription.receiving ?? DEFAULT_SOURCE_RECEIVING,
                  },
                ) ?? this.#dependencies.evidence,
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
      await this.#recordSubscriptionState(subscription, identity, {
        checkState: {
          failures: 0,
          ...(imported.status === 'created'
            ? {lastNewAt: attemptAt}
            : subscription.checkState?.lastNewAt
              ? {lastNewAt: subscription.checkState.lastNewAt}
              : {}),
        },
        lastAttemptAt: attemptAt,
        lastSuccessAt: this.#now(),
        lastRunId: runId,
        cursor: Object.freeze({commitSha: read.commitSha, sourceSha256}),
      });
      await this.#completeRun(runId, 3, '原文已保存，等待接收审核');
      return Object.freeze({
        outcome: 'imported',
        runId,
        subscriptionId: subscription.subscriptionId,
        snapshotId: imported.snapshotId,
      });
    } catch (error) {
      const code = sourceSubscriptionErrorCode(error);
      if (code !== 'source_subscription_changed') {
        await this.#recordSubscriptionState(subscription, identity, {
          checkState: {
            failures: Math.min(
              1000,
              (subscription.checkState?.failures ?? 0) + 1,
            ),
            errorCode: code,
            ...(subscription.checkState?.lastNewAt
              ? {lastNewAt: subscription.checkState.lastNewAt}
              : {}),
          },
        });
      }
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

  async #runConnectorSubscription(
    subscription: Readonly<
      | ReviewRssSourceSubscription
      | ReviewJsonApiSourceSubscription
      | ReviewWebSourceSubscription
      | ReviewPluginSourceSubscription
    >,
    configurationIdentity: string,
    runId: string,
    attemptAt: string,
  ): Promise<Readonly<SourceSubscriptionRunResult>> {
    const connectors = this.#dependencies.connectors;
    if (connectors === undefined) {
      throw new SourceSubscriptionServiceError('source_unavailable');
    }
    const connectorId = connectorIdFor(subscription);
    const sourceLabel = connectorSourceLabel(subscription);
    if (
      subscription.kind === 'plugin' &&
      !connectors
        .capabilities()
        .some(
          (capability) =>
            capability.connectorId === connectorId &&
            capability.origin === 'plugin' &&
            capability.configurationMode === 'external_reference',
        )
    ) {
      throw new SourceSubscriptionServiceError('source_unavailable');
    }
    const read = await connectors.read(connectorId, {
      subscriptionId: subscription.subscriptionId,
      configuration: connectorConfiguration(subscription),
      ...(subscription.cursor === undefined
        ? {}
        : {previousCursor: subscription.cursor.connectorCursor}),
    });
    if (read.status === 'unchanged') {
      await this.#recordSubscriptionState(subscription, configurationIdentity, {
        checkState: {
          failures: 0,
          ...(subscription.checkState?.lastNewAt
            ? {lastNewAt: subscription.checkState.lastNewAt}
            : {}),
        },
        lastAttemptAt: attemptAt,
        lastSuccessAt: this.#now(),
        lastRunId: runId,
        cursor: Object.freeze({connectorCursor: read.cursor}),
      });
      await this.#completeRun(runId, 2, `${sourceLabel}没有新增或变化内容`);
      return Object.freeze({
        outcome: 'unchanged' as const,
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
      currentStep: `正在逐条写入 ${String(read.documents.length)} 个${sourceLabel}`,
      completedUnits: 0,
      totalUnits: read.documents.length,
    });
    if (writing !== 'applied') {
      throw new SourceSubscriptionServiceError(
        'source_subscription_run_invalid',
      );
    }
    const imported = await (
      this.#dependencies.importConnectorDocuments ??
      importSourceConnectorDocuments
    )(
      {
        blobStore: this.#dependencies.blobStore,
        evidenceRepository:
          this.#dependencies.evidenceForSubscription?.(
            subscription.subscriptionId,
            {
              channel: 'live',
              strategy: subscription.receiving ?? DEFAULT_SOURCE_RECEIVING,
            },
          ) ?? this.#dependencies.evidence,
        ...(this.#dependencies.evidenceRead
          ? {evidenceRead: this.#dependencies.evidenceRead}
          : {}),
      },
      {
        workspaceId: this.#dependencies.workspaceId,
        subscriptionId: subscription.subscriptionId,
        connectorId,
        sourceAlias: subscription.sourceAlias,
        isPrivate: subscription.isPrivate,
        capturedAt: attemptAt,
        result: read,
      },
    );
    if (imported.status !== 'complete') {
      throw new SourceSubscriptionServiceError(
        imported.code === 'persistence_failed'
          ? 'source_import_unavailable'
          : 'source_import_rejected',
      );
    }
    await this.#recordSubscriptionState(subscription, configurationIdentity, {
      checkState: {
        failures: 0,
        ...(imported.documents.some((d) => d.outcome === 'created')
          ? {lastNewAt: attemptAt}
          : subscription.checkState?.lastNewAt
            ? {lastNewAt: subscription.checkState.lastNewAt}
            : {}),
      },
      lastAttemptAt: attemptAt,
      lastSuccessAt: this.#now(),
      lastRunId: runId,
      cursor: Object.freeze({connectorCursor: read.cursor}),
    });
    await this.#completeRun(
      runId,
      3,
      `已保存 ${String(imported.documents.length)} 个${sourceLabel}，等待接收审核`,
      imported.documents.length,
      read.documents.length,
    );
    const snapshotIds = Object.freeze(
      imported.documents.map((document) => document.snapshotId),
    );
    return Object.freeze({
      outcome: 'imported' as const,
      runId,
      subscriptionId: subscription.subscriptionId,
      ...(snapshotIds[0] === undefined ? {} : {snapshotId: snapshotIds[0]}),
      snapshotIds,
      importedDocumentCount: imported.documents.length,
    });
  }

  async #completeRun(
    runId: string,
    expectedVersion: number,
    currentStep: string,
    completedUnits = 1,
    totalUnits = 1,
  ): Promise<void> {
    const completed = await this.#dependencies.processing.writeProgress({
      workspaceId: this.#dependencies.workspaceId,
      runId,
      expectedVersion,
      status: 'succeeded',
      currentStage: 'import',
      currentStep,
      completedUnits,
      totalUnits,
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
    state: Readonly<SourceSubscriptionState>,
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
            ? copySourceSubscriptionWithState(subscription, state)
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
  subscription: Readonly<ReviewGitSourceSubscription>,
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
    commandIdempotencyKey: `source-subscription-import:v2:${resourceId}:${subscription.profile}:${sourceSha256}`,
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
  if (subscription.kind === 'rss_atom') {
    return createHash('sha256')
      .update(
        JSON.stringify([
          subscription.kind,
          subscription.feedUrl,
          subscription.itemLimit,
          subscription.sourceAlias,
          subscription.isPrivate,
          false,
        ]),
      )
      .digest('hex');
  }
  if (subscription.kind === 'json_api') {
    return createHash('sha256')
      .update(
        JSON.stringify([
          subscription.kind,
          subscription.endpointUrl,
          subscription.recordsPath,
          subscription.externalIdPath,
          subscription.titlePath,
          subscription.bodyPath,
          subscription.canonicalUriPath ?? null,
          subscription.publishedAtPath ?? null,
          subscription.versionPath ?? null,
          subscription.recordLimit,
          subscription.pageCursor ?? null,
          subscription.incrementalCursor ?? null,
          subscription.authentication,
          subscription.sourceAlias,
          subscription.isPrivate,
          false,
        ]),
      )
      .digest('hex');
  }
  if (subscription.kind === 'web') {
    return createHash('sha256')
      .update(
        JSON.stringify([
          subscription.kind,
          subscription.pageUrl,
          subscription.additionalPaths,
          subscription.sourceAlias,
          subscription.isPrivate,
          false,
        ]),
      )
      .digest('hex');
  }
  if (subscription.kind === 'plugin') {
    return createHash('sha256')
      .update(
        JSON.stringify([
          subscription.kind,
          subscription.connectorId,
          subscription.configurationRef,
          subscription.sourceAlias,
          subscription.isPrivate,
          false,
        ]),
      )
      .digest('hex');
  }
  return createHash('sha256')
    .update(
      JSON.stringify([
        subscription.kind,
        subscription.repositoryUri,
        subscription.repositoryRef,
        subscription.repositoryPath,
        subscription.profile,
        subscription.sourceAlias,
        subscription.isPrivate,
        false,
      ]),
    )
    .digest('hex');
}

function copySourceSubscriptionWithState(
  subscription: Readonly<ReviewSourceSubscription>,
  state: Readonly<SourceSubscriptionState>,
): Readonly<ReviewSourceSubscription> {
  const timestamps = {
    ...(state.checkState ? {checkState: state.checkState} : {}),
    ...(state.qualityReview ? {qualityReview: state.qualityReview} : {}),
    ...(state.lastAttemptAt === undefined
      ? {}
      : {lastAttemptAt: state.lastAttemptAt}),
    ...(state.lastSuccessAt === undefined
      ? {}
      : {lastSuccessAt: state.lastSuccessAt}),
    ...(state.lastRunId === undefined ? {} : {lastRunId: state.lastRunId}),
  };
  if (
    subscription.kind === 'rss_atom' ||
    subscription.kind === 'json_api' ||
    subscription.kind === 'web' ||
    subscription.kind === 'plugin'
  ) {
    if (
      state.cursor !== undefined &&
      !Object.hasOwn(state.cursor, 'connectorCursor')
    ) {
      throw new SourceSubscriptionServiceError('source_subscription_changed');
    }
    return Object.freeze({
      ...subscription,
      ...timestamps,
      ...(state.cursor === undefined
        ? {}
        : {
            cursor: Object.freeze({
              connectorCursor: (
                state.cursor as
                  | ReviewRssSourceSubscriptionCursor
                  | ReviewJsonApiSourceSubscriptionCursor
                  | ReviewWebSourceSubscriptionCursor
                  | ReviewPluginSourceSubscriptionCursor
              ).connectorCursor,
            }),
          }),
    });
  }
  if (state.cursor !== undefined && !Object.hasOwn(state.cursor, 'commitSha')) {
    throw new SourceSubscriptionServiceError('source_subscription_changed');
  }
  return Object.freeze({
    ...subscription,
    ...timestamps,
    ...(state.cursor === undefined
      ? {}
      : {
          cursor: Object.freeze({
            commitSha: (state.cursor as ReviewGitSourceSubscriptionCursor)
              .commitSha,
            sourceSha256: (state.cursor as ReviewGitSourceSubscriptionCursor)
              .sourceSha256,
          }),
        }),
  });
}

function connectorConfiguration(
  subscription: Readonly<
    | ReviewRssSourceSubscription
    | ReviewJsonApiSourceSubscription
    | ReviewWebSourceSubscription
    | ReviewPluginSourceSubscription
  >,
): Readonly<Record<string, unknown>> {
  if (subscription.kind === 'rss_atom') {
    return Object.freeze({
      feedUrl: subscription.feedUrl,
      itemLimit: subscription.itemLimit,
    });
  }
  if (subscription.kind === 'web') {
    return Object.freeze({
      pageUrl: subscription.pageUrl,
      additionalPaths: Object.freeze([...subscription.additionalPaths]),
    });
  }
  if (subscription.kind === 'plugin') {
    return Object.freeze({configurationRef: subscription.configurationRef});
  }
  return Object.freeze({
    endpointUrl: subscription.endpointUrl,
    recordsPath: subscription.recordsPath,
    externalIdPath: subscription.externalIdPath,
    titlePath: subscription.titlePath,
    bodyPath: subscription.bodyPath,
    ...(subscription.canonicalUriPath === undefined
      ? {}
      : {canonicalUriPath: subscription.canonicalUriPath}),
    ...(subscription.publishedAtPath === undefined
      ? {}
      : {publishedAtPath: subscription.publishedAtPath}),
    ...(subscription.versionPath === undefined
      ? {}
      : {versionPath: subscription.versionPath}),
    recordLimit: subscription.recordLimit,
    ...(subscription.pageCursor === undefined
      ? {}
      : {pageCursor: Object.freeze({...subscription.pageCursor})}),
    ...(subscription.incrementalCursor === undefined
      ? {}
      : {
          incrementalCursor: Object.freeze({
            ...subscription.incrementalCursor,
          }),
        }),
    authentication: Object.freeze({...subscription.authentication}),
  });
}

function connectorIdFor(
  subscription: Readonly<
    | ReviewRssSourceSubscription
    | ReviewJsonApiSourceSubscription
    | ReviewWebSourceSubscription
    | ReviewPluginSourceSubscription
  >,
): string {
  if (subscription.kind === 'rss_atom') return RSS_ATOM_CONNECTOR_ID;
  if (subscription.kind === 'json_api') return JSON_API_CONNECTOR_ID;
  if (subscription.kind === 'web') return WEB_CONNECTOR_ID;
  return subscription.connectorId;
}

function connectorSourceLabel(
  subscription: Readonly<
    | ReviewRssSourceSubscription
    | ReviewJsonApiSourceSubscription
    | ReviewWebSourceSubscription
    | ReviewPluginSourceSubscription
  >,
): string {
  if (subscription.kind === 'rss_atom') return 'Feed 条目';
  if (subscription.kind === 'json_api') return 'JSON API 记录';
  if (subscription.kind === 'web') return '网页';
  return '插件来源文档';
}

function sourceContentIdentity(
  subscription: Readonly<ReviewGitSourceSubscription>,
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
        current.description === candidate.description &&
        JSON.stringify(current.processingProfile) ===
          JSON.stringify(candidate.processingProfile) &&
        current.enabled === candidate.enabled &&
        current.intervalMinutes === candidate.intervalMinutes &&
        JSON.stringify(current.receiving) ===
          JSON.stringify(candidate.receiving) &&
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
  return sourceSchedule(subscription, now).reason === 'due';
}

function sourceSubscriptionErrorCode(
  error: unknown,
): SourceSubscriptionServiceErrorCode {
  if (error instanceof SourceSubscriptionReaderError) return error.code;
  if (error instanceof SourceConnectorError) {
    if (error.code === 'connector_too_large') return 'source_too_large';
    if (error.code === 'connector_result_invalid') return 'source_invalid';
    return 'source_unavailable';
  }
  if (error instanceof SourceSubscriptionServiceError) return error.code;
  return 'source_import_unavailable';
}

function defaultNow(): string {
  return new Date().toISOString();
}
