import {describe, expect, it, vi} from 'vitest';

import {
  parseRuntimeConfig,
  type ProcessRole,
} from '../config/runtime_config.js';
import type {
  DatabasePool,
  DatabasePoolFactory,
} from '../database/database_readiness.js';
import type {OperationalHealthService} from '../health/operational_health.js';
import type {
  ExitDecision,
  SignalSource,
} from '../lifecycle/shutdown_coordinator.js';
import type {RuntimeResource} from '../lifecycle/runtime_resource.js';
import type {RuntimeLogger} from '../logging/structured_logger.js';
import type {PgBossClient, PgBossFactory} from '../queue/pg_boss_runtime.js';
import type {HealthListenerFactory} from '../transport/nest_health_listener.js';
import {startRoleRuntime} from './start_role_runtime.js';

const DATABASE_URL = 'postgresql://runtime:synthetic@localhost/struinfo';

describe('startRoleRuntime', () => {
  it.each([
    ['api', 3000, false],
    ['scheduler', 3001, true],
    ['worker', 3002, true],
    ['all', 3000, true],
  ] satisfies readonly [ProcessRole, number, boolean][])(
    'composes an independent %s process without real network dependencies',
    async (role, expectedPort, expectsQueue) => {
      const query = vi.fn(() => Promise.resolve({rows: [{ready: 1}]}));
      const end = vi.fn(() => Promise.resolve());
      const databasePool: DatabasePool = {query, end};
      const databasePoolFactory: DatabasePoolFactory = () => databasePool;
      const queueStart = vi.fn(() => Promise.resolve());
      const queueStop = vi.fn(() => Promise.resolve());
      const queueCreate = vi.fn((): PgBossClient => ({
        start: queueStart,
        stop: queueStop,
      }));
      const pgBossFactory: PgBossFactory = {create: queueCreate};
      const {resource: listener, close: closeListener} =
        createListenerResource();
      let listenerOptions:
        | Readonly<{
            health: OperationalHealthService;
            host: string;
            port: number;
          }>
        | undefined;
      const healthListenerFactory: HealthListenerFactory = {
        start: (options) => {
          listenerOptions = options;
          return Promise.resolve(listener);
        },
      };
      const signalSource: SignalSource = {subscribe: () => () => undefined};
      const exitDecision: ExitDecision = {exit: vi.fn()};
      const logger: RuntimeLogger = {write: vi.fn()};

      const runtime = await startRoleRuntime(
        parseRuntimeConfig(role, {DATABASE_URL}),
        logger,
        {
          databasePoolFactory,
          pgBossFactory,
          healthListenerFactory,
          signalSource,
          exitDecision,
        },
      );

      expect(listenerOptions?.host).toBe('127.0.0.1');
      expect(listenerOptions?.port).toBe(expectedPort);
      await expect(listenerOptions?.health.ready()).resolves.toMatchObject({
        statusCode: 200,
        body: {role, status: 'ready', checks: {database: 'ready'}},
      });
      expect(queueCreate).toHaveBeenCalledTimes(expectsQueue ? 1 : 0);
      if (expectsQueue) {
        expect(queueCreate).toHaveBeenCalledWith(
          expect.objectContaining({
            migrate: false,
            createSchema: false,
          }),
        );
      }

      await expect(runtime.shutdown.requestShutdown('test')).resolves.toBe(
        'completed',
      );
      expect(end).toHaveBeenCalledTimes(1);
      expect(closeListener).toHaveBeenCalledTimes(1);
      runtime.disposeSignalHandlers();
    },
  );

  it('cleans every acquired resource when late startup wiring fails', async () => {
    const end = vi.fn(() => Promise.resolve());
    const databasePool: DatabasePool = {
      query: vi.fn(() => Promise.resolve({rows: []})),
      end,
    };
    const queueStop = vi.fn(() => Promise.resolve());
    const pgBossFactory: PgBossFactory = {
      create: () => ({
        start: () => Promise.resolve(),
        stop: queueStop,
      }),
    };
    const {resource: listener, close: closeListener} = createListenerResource();
    const healthListenerFactory: HealthListenerFactory = {
      start: () => Promise.resolve(listener),
    };
    const signalFailure = new Error('synthetic signal subscription failure');
    const signalSource: SignalSource = {
      subscribe: () => {
        throw signalFailure;
      },
    };

    await expect(
      startRoleRuntime(
        parseRuntimeConfig('worker', {DATABASE_URL}),
        {write: vi.fn()},
        {
          databasePoolFactory: () => databasePool,
          pgBossFactory,
          healthListenerFactory,
          signalSource,
          exitDecision: {exit: vi.fn()},
        },
      ),
    ).rejects.toBe(signalFailure);

    expect(closeListener).toHaveBeenCalledTimes(1);
    expect(queueStop).toHaveBeenCalledTimes(1);
    expect(end).toHaveBeenCalledTimes(1);
  });
});

function createListenerResource(): Readonly<{
  resource: RuntimeResource;
  close: ReturnType<typeof vi.fn<() => Promise<void>>>;
}> {
  const close = vi.fn(() => Promise.resolve());
  return {
    close,
    resource: {
      name: 'health-listener',
      stopAccepting: vi.fn(() => undefined),
      drain: vi.fn(() => Promise.resolve()),
      close,
    },
  };
}
