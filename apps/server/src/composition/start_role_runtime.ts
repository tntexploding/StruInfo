import type {RuntimeConfig} from '../config/runtime_config.js';
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
  createPostgresKnowledgeRepositories,
  type PostgresKnowledgeRepositorySet,
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
  readonly repositories: Readonly<PostgresKnowledgeRepositorySet>;
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
  const repositories = createPostgresKnowledgeRepositories(database.pool);
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
  const api =
    config.role === 'api' || config.role === 'all'
      ? new M1cApiService({
          workspaceId: config.workspaceId,
          blobStore: storage.blobStore,
          reviewPreferences: storage.reviewPreferences,
          evidenceRepository: repositories.evidence,
          evidenceReadRepository: repositories.evidenceRead,
          curationRepository: repositories.curation,
          curationReadRepository: repositories.curationRead,
          knowledgeRepository: repositories.knowledge,
          retrievalRepository: repositories.retrieval,
          workspaceTransfer: new M1cWorkspaceTransfer({
            repository: repositories.workspaceTransfer,
            blobStore: storage.blobStore,
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
