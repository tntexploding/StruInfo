import {TextEncoder} from 'node:util';

import {describe, expect, it, vi} from 'vitest';

import type {MigrationFileSystem} from './migration_files.js';
import {
  JsonMigrationLogger,
  type MigrationLogSink,
  type MigrationLogger,
} from './migration_log.js';
import {
  type MigrationExitDecision,
  runMigrationProcess,
} from './migration_process.js';
import {
  READ_MIGRATION_LEDGER_SQL,
  RELEASE_MIGRATION_LOCK_SQL,
} from './migration_runner.js';
import {
  PgMigrationConnector,
  type MigrationConnection,
  type MigrationConnector,
  type MigrationRow,
} from './postgres_migration_connection.js';
import type {PostgresConnectionConfig} from '../postgresql/postgres_connection_config.js';

const MIGRATION_URL =
  'postgresql://struinfo_tm2_migrator:synthetic-migration-secret@localhost/struinfo';
const ORDINARY_URL =
  'postgresql://struinfo_tm2_runtime:synthetic-runtime-secret@localhost/struinfo';
const MIGRATION_SQL =
  "SELECT 'synthetic-private-sql-content-知识' AS migration_value;";

class SingleFileSystem implements MigrationFileSystem {
  public directoryReads = 0;
  readonly #sql: string;

  public constructor(sql: string = MIGRATION_SQL) {
    this.#sql = sql;
  }

  public readDirectory(): Promise<
    readonly {readonly name: string; readonly kind: 'file'}[]
  > {
    this.directoryReads += 1;
    return Promise.resolve([{name: '000001_synthetic_step.sql', kind: 'file'}]);
  }

  public readFile(): Promise<Uint8Array> {
    return Promise.resolve(new TextEncoder().encode(this.#sql));
  }
}

class ProcessConnection implements MigrationConnection {
  public readonly queries: string[] = [];
  public closeCalls = 0;
  public failOnMigration = false;

  public query(sql: string): Promise<readonly MigrationRow[]> {
    this.queries.push(sql);
    if (this.failOnMigration && sql === MIGRATION_SQL) {
      return Promise.reject(
        new Error(
          `raw driver ${MIGRATION_URL} ${ORDINARY_URL} ${MIGRATION_SQL}`,
        ),
      );
    }
    if (sql === READ_MIGRATION_LEDGER_SQL) {
      return Promise.resolve([]);
    }
    if (sql === RELEASE_MIGRATION_LOCK_SQL) {
      return Promise.resolve([{unlocked: true}]);
    }
    return Promise.resolve([]);
  }

  public close(): Promise<void> {
    this.closeCalls += 1;
    return Promise.resolve();
  }
}

class SingleConnector implements MigrationConnector {
  public readonly connections: Readonly<PostgresConnectionConfig>[] = [];
  readonly #connection: MigrationConnection;

  public constructor(connection: MigrationConnection) {
    this.#connection = connection;
  }

  public connect(
    config: Readonly<PostgresConnectionConfig>,
  ): Promise<MigrationConnection> {
    this.connections.push(config);
    return Promise.resolve(this.#connection);
  }
}

class RecordingSink implements MigrationLogSink {
  public readonly lines: string[] = [];

  public writeLine(line: string): void {
    this.lines.push(line);
  }
}

class RecordingExitDecision implements MigrationExitDecision {
  public readonly codes: number[] = [];

  public setExitCode(code: number): void {
    this.codes.push(code);
  }
}

function environment(
  migrationUrl: string | null = MIGRATION_URL,
): Readonly<Record<string, string | undefined>> {
  return {
    ...(migrationUrl === null
      ? {}
      : {STRUIINFO_MIGRATION_DATABASE_URL: migrationUrl}),
    DATABASE_URL: ORDINARY_URL,
  };
}

describe('runMigrationProcess', () => {
  it.each(['synthetic_migrator', 'struinfo_tm2_runtime'])(
    'rejects non-migrator role %s before invoking the client factory',
    async (role) => {
      const fileSystem = new SingleFileSystem();
      const sink = new RecordingSink();
      const exitDecision = new RecordingExitDecision();
      const clientFactory = vi.fn(() => {
        throw new Error('client factory must remain unreachable');
      });

      const outcome = await runMigrationProcess({
        environment: environment(
          `postgresql://${role}:synthetic-private-password@localhost/struinfo`,
        ),
        migrationRoots: ['synthetic-root'],
        fileSystem,
        connector: new PgMigrationConnector(clientFactory),
        logger: new JsonMigrationLogger(sink),
        exitDecision,
      });

      expect(outcome).toBe('failed');
      expect(exitDecision.codes).toEqual([1]);
      expect(fileSystem.directoryReads).toBe(0);
      expect(clientFactory).not.toHaveBeenCalled();
      expect(sink.lines).toEqual([
        '{"event":"migration_credential_invalid","outcome":"failed"}',
      ]);
      expect(sink.lines.join('\n')).not.toContain(role);
      expect(sink.lines.join('\n')).not.toContain('synthetic-private-password');
    },
  );

  it('fails closed before filesystem or database access without a migration credential', async () => {
    const fileSystem = new SingleFileSystem();
    const connection = new ProcessConnection();
    const connector = new SingleConnector(connection);
    const sink = new RecordingSink();
    const exitDecision = new RecordingExitDecision();

    const outcome = await runMigrationProcess({
      environment: environment(null),
      migrationRoots: ['synthetic-root'],
      fileSystem,
      connector,
      logger: new JsonMigrationLogger(sink),
      exitDecision,
    });

    expect(outcome).toBe('failed');
    expect(exitDecision.codes).toEqual([1]);
    expect(fileSystem.directoryReads).toBe(0);
    expect(connector.connections).toEqual([]);
    expect(connection.queries).toEqual([]);
    expect(sink.lines).toEqual([
      '{"event":"migration_credential_missing","outcome":"failed"}',
    ]);
  });

  it('logs only the allowed safe fields after successful cleanup', async () => {
    const fileSystem = new SingleFileSystem();
    const connection = new ProcessConnection();
    const connector = new SingleConnector(connection);
    const sink = new RecordingSink();
    const exitDecision = new RecordingExitDecision();

    const outcome = await runMigrationProcess({
      environment: environment(),
      migrationRoots: ['synthetic-root'],
      fileSystem,
      connector,
      logger: new JsonMigrationLogger(sink),
      exitDecision,
    });

    expect(outcome).toBe('succeeded');
    expect(exitDecision.codes).toEqual([0]);
    expect(connector.connections).toHaveLength(1);
    expect(connector.connections[0]).toMatchObject({
      host: 'localhost',
      user: 'struinfo_tm2_migrator',
      password: 'synthetic-migration-secret',
      database: 'struinfo',
    });
    expect(connection.closeCalls).toBe(1);
    const records = sink.lines.map(
      (line) => JSON.parse(line) as Readonly<Record<string, unknown>>,
    );
    expect(records.map(({event}) => event)).toEqual([
      'migration_applied',
      'migration_completed',
    ]);
    for (const record of records) {
      expect(Object.keys(record)).toEqual(
        expect.arrayContaining(['event', 'outcome']),
      );
      expect(Object.keys(record)).toEqual(
        expect.not.arrayContaining(['database_url', 'error', 'sql', 'stack']),
      );
    }
    const output = sink.lines.join('\n');
    expect(output).not.toContain(MIGRATION_URL);
    expect(output).not.toContain(ORDINARY_URL);
    expect(output).not.toContain(MIGRATION_SQL);
  });

  it('redacts credentials, SQL, driver errors, and stacks on failure', async () => {
    const connection = new ProcessConnection();
    connection.failOnMigration = true;
    const sink = new RecordingSink();
    const exitDecision = new RecordingExitDecision();

    const outcome = await runMigrationProcess({
      environment: environment(),
      migrationRoots: ['synthetic-root'],
      fileSystem: new SingleFileSystem(),
      connector: new SingleConnector(connection),
      logger: new JsonMigrationLogger(sink),
      exitDecision,
    });

    expect(outcome).toBe('failed');
    expect(exitDecision.codes).toEqual([1]);
    expect(connection.queries).toContain('ROLLBACK');
    expect(connection.queries.at(-1)).toBe(RELEASE_MIGRATION_LOCK_SQL);
    expect(connection.closeCalls).toBe(1);
    const output = sink.lines.join('\n');
    expect(output).toContain('migration_transaction_failed');
    expect(output).not.toContain(MIGRATION_URL);
    expect(output).not.toContain(ORDINARY_URL);
    expect(output).not.toContain('synthetic-migration-secret');
    expect(output).not.toContain('synthetic-runtime-secret');
    expect(output).not.toContain(MIGRATION_SQL);
    expect(output).not.toContain('raw driver');
    expect(output).not.toContain('Error:');
  });

  it('returns a nonzero decision when the injected log sink fails', async () => {
    const connection = new ProcessConnection();
    const exitDecision = new RecordingExitDecision();
    const logger: MigrationLogger = {
      write: () => {
        throw new Error('synthetic sink failure');
      },
    };

    const outcome = await runMigrationProcess({
      environment: environment(),
      migrationRoots: ['synthetic-root'],
      fileSystem: new SingleFileSystem(),
      connector: new SingleConnector(connection),
      logger,
      exitDecision,
    });

    expect(outcome).toBe('failed');
    expect(exitDecision.codes).toEqual([1]);
    expect(connection.queries.at(-1)).toBe(RELEASE_MIGRATION_LOCK_SQL);
    expect(connection.closeCalls).toBe(1);
  });
});
