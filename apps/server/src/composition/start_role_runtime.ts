import type {RuntimeConfig} from '../config/runtime_config.js';
import {
  InformationEntryQuerySynthesisService,
  InformationEntryRetrievalService,
} from '../modules/entries/index.js';
import {
  AiAssociationProposalService,
  AiSplitProposalService,
  AiTagProposalService,
} from '../modules/processing/index.js';
import {
  SourceConnectorRegistry,
  SourceSubscriptionService,
  type GitSourceSubscriptionReaderPort,
  type SourceConnectorPort,
} from '../modules/subscriptions/index.js';
import {
  OpenAiEntryAssociationProvider,
  OpenAiEntrySplitProvider,
  OpenAiEntryTagProvider,
  OpenAiInformationEntryQuerySynthesisProvider,
  OpenAiInformationEntryEmbeddingProvider,
} from '../platform/ai/index.js';
import {
  GithubGitSourceSubscriptionReader,
  JsonApiSourceConnector,
  RssAtomSourceConnector,
  WebSourceConnector,
} from '../platform/sources/index.js';
import {
  createRuntimeDatabase,
  type DatabasePoolFactory,
} from '../database/database_readiness.js';
import {
  ReadinessGate,
  OperationalHealthService,
} from '../health/operational_health.js';
import {NodeTimerScheduler, SystemDeadline} from '../lifecycle/deadline.js';
import {
  SourceSubscriptionScheduler,
  type SourceSubscriptionSchedulerDependencies,
} from '../lifecycle/source_subscription_scheduler.js';
import {
  ProcessExitDecision,
  ProcessSignalSource,
  ShutdownCoordinator,
  type ExitDecision,
  type SignalSource,
} from '../lifecycle/shutdown_coordinator.js';
import {
  closeResourcesInReverse,
  startOwnedResources,
  toError,
  type ResourceStarter,
  type RuntimeResource,
} from '../lifecycle/runtime_resource.js';
import type {RuntimeLogger} from '../logging/structured_logger.js';
import {createLocalStorageServices} from '../platform/storage/local_storage_services.js';
import {
  createPostgresRepositories,
  type PostgresRepositorySet,
} from '../platform/database/postgresql/index.js';
import {
  createPgBossOptions,
  PgBossRuntime,
  roleUsesPgBoss,
  SystemPgBossFactory,
  type PgBossFactory,
} from '../queue/pg_boss_runtime.js';
import type {
  StorageServices,
  StorageServicesFactory,
} from '../storage/storage_services.js';
import {
  NestHealthListenerFactory,
  type HealthListenerFactory,
} from '../transport/nest_health_listener.js';
import {M1cApiService} from '../transport/m1c_api_service.js';
import {M1cWorkspaceTransfer} from '../workspace_transfer/m1c_workspace_transfer.js';

export interface StartedRoleRuntime {
  readonly workspaceId: string;
  readonly resources: readonly RuntimeResource[];
  readonly storage: Readonly<StorageServices>;
  readonly repositories: Readonly<PostgresRepositorySet>;
  readonly shutdown: ShutdownCoordinator;
  disposeSignalHandlers(): void;
}

export interface RoleRuntimeDependencies {
  readonly databasePoolFactory?: DatabasePoolFactory;
  readonly pgBossFactory?: PgBossFactory;
  readonly healthListenerFactory?: HealthListenerFactory;
  readonly signalSource?: SignalSource;
  readonly exitDecision?: ExitDecision;
  readonly storageServicesFactory?: StorageServicesFactory;
  readonly sourceSubscriptionReader?: GitSourceSubscriptionReaderPort;
  /** Trusted adapters supplied by the installed host; never loaded from prefs. */
  readonly sourceConnectors?: readonly SourceConnectorPort[];
  readonly sourceSubscriptionSchedulerStarter?: (
    dependencies: Readonly<SourceSubscriptionSchedulerDependencies>,
  ) => Promise<RuntimeResource>;
}

export async function startRoleRuntime(
  config: Readonly<RuntimeConfig>,
  logger: RuntimeLogger,
  dependencies: Readonly<RoleRuntimeDependencies> = {},
): Promise<StartedRoleRuntime> {
  const storage = await (
    dependencies.storageServicesFactory ?? createLocalStorageServices
  )(config.dataRoot);
  const deadline = new SystemDeadline(new NodeTimerScheduler());
  const database = createRuntimeDatabase(
    config,
    deadline,
    dependencies.databasePoolFactory,
  );
  const gate = new ReadinessGate();
  const repositories = createPostgresRepositories(database.pool);
  const health = new OperationalHealthService({
    role: config.role,
    gate,
    database: database.readiness,
  });
  const starters: ResourceStarter[] = [() => Promise.resolve(database)];

  if (roleUsesPgBoss(config.role)) {
    const factory = dependencies.pgBossFactory ?? new SystemPgBossFactory();
    starters.push(() =>
      PgBossRuntime.start({
        factory,
        config: createPgBossOptions(config, database.pool),
        shutdownTimeoutMs: config.shutdownTimeoutMs,
      }),
    );
  }

  const listenerFactory =
    dependencies.healthListenerFactory ?? new NestHealthListenerFactory();
  const address = listenerAddress(config);
  const aiSplitProposals =
    config.aiProposalProvider === undefined
      ? undefined
      : new AiSplitProposalService({
          workspaceId: config.workspaceId,
          blobStore: storage.blobStore,
          evidence: repositories.evidenceRead,
          entries: repositories.informationEntries,
          processing: repositories.processingRuns,
          provider: new OpenAiEntrySplitProvider(config.aiProposalProvider),
        });
  const aiTagProposals =
    config.aiProposalProvider === undefined
      ? undefined
      : new AiTagProposalService({
          workspaceId: config.workspaceId,
          entries: repositories.informationEntries,
          processing: repositories.processingRuns,
          provider: new OpenAiEntryTagProvider(config.aiProposalProvider),
        });
  const aiAssociationProposals =
    config.aiProposalProvider === undefined
      ? undefined
      : new AiAssociationProposalService({
          workspaceId: config.workspaceId,
          entries: repositories.informationEntries,
          associations: repositories.informationEntryAssociations,
          processing: repositories.aiAssociationProposals,
          provider: new OpenAiEntryAssociationProvider(
            config.aiProposalProvider,
          ),
        });
  const informationEntryRetrieval = new InformationEntryRetrievalService({
    workspaceId: config.workspaceId,
    entries: repositories.informationEntries,
    associations: repositories.informationEntryAssociations,
    index: repositories.informationEntrySearchIndex,
    ...(config.embeddingProvider === undefined
      ? {}
      : {
          embeddingProvider: new OpenAiInformationEntryEmbeddingProvider(
            config.embeddingProvider,
          ),
        }),
  });
  const aiQuerySynthesis =
    config.aiProposalProvider === undefined
      ? undefined
      : new InformationEntryQuerySynthesisService({
          workspaceId: config.workspaceId,
          entries: repositories.informationEntries,
          associations: repositories.informationEntryAssociations,
          retrieval: informationEntryRetrieval,
          provider: new OpenAiInformationEntryQuerySynthesisProvider(
            config.aiProposalProvider,
          ),
        });
  const sourceSubscriptions = new SourceSubscriptionService({
    workspaceId: config.workspaceId,
    preferences: storage.reviewPreferences,
    processing: repositories.processingRuns,
    reader:
      dependencies.sourceSubscriptionReader ??
      new GithubGitSourceSubscriptionReader(),
    connectors: new SourceConnectorRegistry([
      new RssAtomSourceConnector(),
      new JsonApiSourceConnector(),
      new WebSourceConnector(),
      ...(dependencies.sourceConnectors ?? []),
    ]),
    blobStore: storage.blobStore,
    evidence: repositories.evidence,
    evidenceRead: repositories.evidenceRead,
    entries: repositories.informationEntries,
    automationExecutions: repositories.entryAutomationExecutions,
    automationWorkQueue: repositories.entryAutomationWorkQueue,
    automationActions: repositories.entryAutomationActions,
    associations: repositories.informationEntryAssociations,
  });
  if (config.role === 'scheduler' || config.role === 'all') {
    starters.push(() =>
      (
        dependencies.sourceSubscriptionSchedulerStarter ??
        SourceSubscriptionScheduler.start
      )({
        subscriptions: sourceSubscriptions,
        logger,
      }),
    );
  }
  const api =
    config.role === 'api' || config.role === 'all'
      ? new M1cApiService({
          workspaceId: config.workspaceId,
          blobStore: storage.blobStore,
          reviewPreferences: storage.reviewPreferences,
          evidenceRepository: repositories.evidence,
          evidenceReadRepository: repositories.evidenceRead,
          informationEntryRepository: repositories.informationEntries,
          informationDocumentWorkingCopyRepository:
            repositories.informationDocumentWorkingCopies,
          informationDocumentTagRepository:
            repositories.informationDocumentTags,
          informationEntryAssociationRepository:
            repositories.informationEntryAssociations,
          informationEntryRetrieval,
          informationEntryRestructureRepository:
            repositories.informationEntryRestructures,
          processingRunRepository: repositories.processingRuns,
          entryAutomationExecutionRepository:
            repositories.entryAutomationExecutions,
          entryAutomationWorkQueueRepository:
            repositories.entryAutomationWorkQueue,
          entryAutomationActionRepository: repositories.entryAutomationActions,
          sourceSubscriptions,
          ...(aiSplitProposals === undefined ? {} : {aiSplitProposals}),
          ...(aiTagProposals === undefined ? {} : {aiTagProposals}),
          ...(aiAssociationProposals === undefined
            ? {}
            : {aiAssociationProposals}),
          ...(aiQuerySynthesis === undefined ? {} : {aiQuerySynthesis}),
          workspaceTransfer: new M1cWorkspaceTransfer({
            repository: repositories.workspaceTransfer,
            blobStore: storage.blobStore,
            reviewPreferences: storage.reviewPreferences,
            fileStore: storage.workspaceBundleFiles,
          }),
        })
      : undefined;
  starters.push(() =>
    listenerFactory.start({
      health,
      ...(api === undefined ? {} : {api}),
      host: address.host,
      port: address.port,
    }),
  );

  const resources = await startOwnedResources(starters);
  const shutdown = new ShutdownCoordinator({
    readiness: gate,
    resources,
    deadline,
    timeoutMs: config.shutdownTimeoutMs,
    logger,
    exitDecision: dependencies.exitDecision ?? new ProcessExitDecision(),
  });
  let disposeSignalHandlers: (() => void) | undefined;
  try {
    disposeSignalHandlers = shutdown.bind(
      dependencies.signalSource ?? new ProcessSignalSource(),
    );
    gate.markInitialized();
    logger.write('info', 'startup_completed', {
      listener_host: address.host,
      listener_port: address.port,
    });
    return {
      workspaceId: config.workspaceId,
      resources,
      storage,
      repositories,
      shutdown,
      disposeSignalHandlers,
    };
  } catch (startupFailure) {
    gate.beginShutdown();
    const cleanupFailures = [...(await closeResourcesInReverse(resources))];
    if (disposeSignalHandlers !== undefined) {
      try {
        disposeSignalHandlers();
      } catch (cleanupFailure) {
        cleanupFailures.push(toError(cleanupFailure));
      }
    }
    if (cleanupFailures.length > 0) {
      throw new AggregateError(
        [toError(startupFailure), ...cleanupFailures],
        'Runtime startup and cleanup failed.',
        {cause: startupFailure},
      );
    }
    throw toError(startupFailure);
  }
}

function listenerAddress(config: Readonly<RuntimeConfig>): Readonly<{
  host: string;
  port: number;
}> {
  if (config.role === 'api' || config.role === 'all') {
    return {host: config.host, port: config.port};
  }
  return {host: config.healthHost, port: config.healthPort};
}
