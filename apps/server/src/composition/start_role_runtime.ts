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
import {
  createPgBossOptions,
  PgBossRuntime,
  roleUsesPgBoss,
  SystemPgBossFactory,
  type PgBossFactory,
} from '../queue/pg_boss_runtime.js';
import {
  NestHealthListenerFactory,
  type HealthListenerFactory,
} from '../transport/nest_health_listener.js';

export interface StartedRoleRuntime {
  readonly resources: readonly RuntimeResource[];
  readonly shutdown: ShutdownCoordinator;
  disposeSignalHandlers(): void;
}

export interface RoleRuntimeDependencies {
  readonly databasePoolFactory?: DatabasePoolFactory;
  readonly pgBossFactory?: PgBossFactory;
  readonly healthListenerFactory?: HealthListenerFactory;
  readonly signalSource?: SignalSource;
  readonly exitDecision?: ExitDecision;
}

export async function startRoleRuntime(
  config: Readonly<RuntimeConfig>,
  logger: RuntimeLogger,
  dependencies: Readonly<RoleRuntimeDependencies> = {},
): Promise<StartedRoleRuntime> {
  const deadline = new SystemDeadline(new NodeTimerScheduler());
  const database = createRuntimeDatabase(
    config,
    deadline,
    dependencies.databasePoolFactory,
  );
  const gate = new ReadinessGate();
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
        config: createPgBossOptions(config),
        shutdownTimeoutMs: config.shutdownTimeoutMs,
      }),
    );
  }

  const listenerFactory =
    dependencies.healthListenerFactory ?? new NestHealthListenerFactory();
  const address = listenerAddress(config);
  starters.push(() =>
    listenerFactory.start({
      health,
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
    return {resources, shutdown, disposeSignalHandlers};
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
