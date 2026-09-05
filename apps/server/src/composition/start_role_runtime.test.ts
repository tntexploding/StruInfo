import {tmpdir} from 'node:os';
import {join} from 'node:path';

import {describe, expect, it, vi} from 'vitest';

import {
  parseRuntimeConfig,
  type ProcessRole,
} from '../config/runtime_config.js';
import type {DatabasePoolFactory} from '../database/database_readiness.js';
import type {PostgresPoolBoundary} from '../platform/database/postgresql/postgres_pool.js';
import type {OperationalHealthService} from '../health/operational_health.js';
import type {
  ExitDecision,
  SignalSource,
} from '../lifecycle/shutdown_coordinator.js';
import type {RuntimeResource} from '../lifecycle/runtime_resource.js';
import type {RuntimeLogger} from '../logging/structured_logger.js';
import type {PgBossClient, PgBossFactory} from '../queue/pg_boss_runtime.js';
import type {
  StorageServices,
  StorageServicesFactory,
} from '../storage/storage_services.js';
import type {HealthListenerFactory} from '../transport/nest_health_listener.js';
import type {M1cApiServicePort} from '../transport/m1c_api_service.js';
import {startRoleRuntime} from './start_role_runtime.js';

const DATABASE_URL =
  'postgresql://struinfo_tm2_runtime:synthetic@localhost/struinfo';
const RUNTIME_ENVIRONMENT = {
  DATABASE_URL,
  STRUIINFO_DATA_ROOT: join(tmpdir(), 'struinfo-synthetic-data'),
  STRUIINFO_WORKSPACE_ID: '11111111-1111-4111-8111-111111111111',
};

describe('startRoleRuntime', () => {
  it.each([
    ['api', 3000, false],
    ['scheduler', 3001, true],
    ['worker', 3002, true],
    ['all', 3000, true],
  ] satisfies readonly [ProcessRole, number, boolean][])(
    'composes an independent %s process without real network dependencies',
    async (role, expectedPort, expectsQueue) => {
      const {pool: databasePool, end} = createDatabasePool();
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
            api?: M1cApiServicePort;
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
      const storage = createStorageServices();
      const storageServicesFactory = vi.fn<StorageServicesFactory>(() =>
        Promise.resolve(storage),
      );

      const runtime = await startRoleRuntime(
        parseRuntimeConfig(role, RUNTIME_ENVIRONMENT),
        logger,
        {
          databasePoolFactory,
          pgBossFactory,
          healthListenerFactory,
          signalSource,
          exitDecision,
          storageServicesFactory,
        },
      );

      expect(storageServicesFactory).toHaveBeenCalledExactlyOnceWith(
        RUNTIME_ENVIRONMENT.STRUIINFO_DATA_ROOT,
      );
      expect(runtime.storage).toBe(storage);
      expect(runtime.workspaceId).toBe(
        RUNTIME_ENVIRONMENT.STRUIINFO_WORKSPACE_ID,
      );
      expect(listenerOptions?.host).toBe('127.0.0.1');
      expect(listenerOptions?.port).toBe(expectedPort);
      expect(listenerOptions?.api === undefined).toBe(
        role !== 'api' && role !== 'all',
      );
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
    const {pool: databasePool, end} = createDatabasePool();
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
    const storageServicesFactory: StorageServicesFactory = () =>
      Promise.resolve(createStorageServices());

    await expect(
      startRoleRuntime(
        parseRuntimeConfig('worker', RUNTIME_ENVIRONMENT),
        {write: vi.fn()},
        {
          databasePoolFactory: () => databasePool,
          pgBossFactory,
          healthListenerFactory,
          signalSource,
          exitDecision: {exit: vi.fn()},
          storageServicesFactory,
        },
      ),
    ).rejects.toBe(signalFailure);

    expect(closeListener).toHaveBeenCalledTimes(1);
    expect(queueStop).toHaveBeenCalledTimes(1);
    expect(end).toHaveBeenCalledTimes(1);
  });

  it('does not acquire database or listener resources when data-root initialization fails', async () => {
    const storageFailure = new Error('synthetic data-root failure');
    const databasePoolFactory = vi.fn(() => {
      throw new Error('database must not be acquired');
    });
    const healthListenerFactory = {
      start: vi.fn(() => Promise.reject(new Error('listener must not start'))),
    } satisfies HealthListenerFactory;

    await expect(
      startRoleRuntime(
        parseRuntimeConfig('api', RUNTIME_ENVIRONMENT),
        {write: vi.fn()},
        {
          storageServicesFactory: () => Promise.reject(storageFailure),
          databasePoolFactory,
          healthListenerFactory,
        },
      ),
    ).rejects.toBe(storageFailure);

    expect(databasePoolFactory).not.toHaveBeenCalled();
    expect(healthListenerFactory.start).not.toHaveBeenCalled();
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

function createStorageServices(): Readonly<StorageServices> {
  return Object.freeze({
    blobStore: {
      put: () => Promise.reject(new Error('unexpected Blob write')),
      read: () => Promise.reject(new Error('unexpected Blob read')),
    },
    reviewPreferences: {
      load: () => Promise.reject(new Error('unexpected preferences read')),
      save: () => Promise.reject(new Error('unexpected preferences write')),
    },
    entryMarkdownFiles: {
      write: () => Promise.reject(new Error('unexpected Markdown write')),
    },
    workspaceBundleFiles: {
      write: () => Promise.reject(new Error('unexpected Bundle write')),
      read: () => Promise.reject(new Error('unexpected Bundle read')),
    },
  });
}

function createDatabasePool(): Readonly<{
  pool: PostgresPoolBoundary;
  end: ReturnType<typeof vi.fn<() => Promise<void>>>;
}> {
  const end = vi.fn(() => Promise.resolve());
  const query = vi.fn();
  return {
    end,
    pool: {
      query() {
        query();
        return Promise.resolve({rows: [], rowCount: 0});
      },
      connect: () => Promise.reject(new Error('unexpected acquisition')),
      end,
    },
  };
}
