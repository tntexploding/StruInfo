import {createHash} from 'node:crypto';
import {TextEncoder} from 'node:util';

import {describe, expect, it} from 'vitest';

import type {MigrationFileSystem} from './migration_files.js';
import {parseMigrationConfig} from './migration_config.js';
import type {MigrationLogRecord, MigrationLogger} from './migration_log.js';
import {
  ACQUIRE_MIGRATION_LOCK_SQL,
  CREATE_METADATA_SCHEMA_SQL,
  CREATE_MIGRATION_LEDGER_SQL,
  executeMigrations,
  INSERT_MIGRATION_LEDGER_SQL,
  MIGRATION_ADVISORY_LOCK_IDENTITY,
  READ_MIGRATION_LEDGER_SQL,
  RELEASE_MIGRATION_LOCK_SQL,
} from './migration_runner.js';
import type {
  MigrationConnection,
  MigrationConnector,
  MigrationRow,
} from './postgres_migration_connection.js';

const DATABASE_URL =
  'postgresql://struinfo_tm2_migrator:synthetic-secret@localhost/struinfo';
const MIGRATION_CONFIG = parseMigrationConfig({
  STRUIINFO_MIGRATION_DATABASE_URL: DATABASE_URL,
});
const ROOT = 'synthetic-root';
const FIRST_FILENAME = '000001_first_step.sql';
const FIRST_SQL = 'SELECT synthetic_first;';
const SECOND_FILENAME = '000002_second_step.sql';
const SECOND_SQL = 'SELECT synthetic_second;';

interface QueryCall {
  readonly sql: string;
  readonly parameters?: readonly unknown[];
}

class MemoryFileSystem implements MigrationFileSystem {
  readonly #files: ReadonlyMap<string, Uint8Array>;

  public constructor(files: readonly (readonly [string, string])[]) {
    this.#files = new Map(
      files.map(([filename, sql]) => [filename, new TextEncoder().encode(sql)]),
    );
  }

  public readDirectory(): Promise<
    readonly {readonly name: string; readonly kind: 'file'}[]
  > {
    return Promise.resolve(
      [...this.#files.keys()].map((name) => ({name, kind: 'file' as const})),
    );
  }

  public readFile(_root: string, name: string): Promise<Uint8Array> {
    const bytes = this.#files.get(name);
    return bytes === undefined
      ? Promise.reject(new Error('synthetic missing migration'))
      : Promise.resolve(Uint8Array.from(bytes));
  }
}

class ScriptedConnection implements MigrationConnection {
  public readonly calls: QueryCall[] = [];
  public closeCalls = 0;
  public ledgerRows: readonly MigrationRow[];
  public unlockResult = true;
  public closeFails = false;
  readonly #failures: Map<string, number>;

  public constructor(
    options: {
      readonly ledgerRows?: readonly MigrationRow[];
      readonly failures?: ReadonlyMap<string, number>;
    } = {},
  ) {
    this.ledgerRows = options.ledgerRows ?? [];
    this.#failures = new Map(options.failures);
  }

  public query(
    sql: string,
    parameters?: readonly unknown[],
  ): Promise<readonly MigrationRow[]> {
    this.calls.push({
      sql,
      ...(parameters === undefined ? {} : {parameters: [...parameters]}),
    });
    const remainingFailures = this.#failures.get(sql) ?? 0;
    if (remainingFailures > 0) {
      this.#failures.set(sql, remainingFailures - 1);
      return Promise.reject(
        new Error(`raw synthetic driver failure for ${sql}`),
      );
    }
    if (sql === READ_MIGRATION_LEDGER_SQL) {
      return Promise.resolve(this.ledgerRows);
    }
    if (sql === RELEASE_MIGRATION_LOCK_SQL) {
      return Promise.resolve([{unlocked: this.unlockResult}]);
    }
    return Promise.resolve([]);
  }

  public close(): Promise<void> {
    this.closeCalls += 1;
    return this.closeFails
      ? Promise.reject(new Error('raw close failure'))
      : Promise.resolve();
  }
}

class QueueConnector implements MigrationConnector {
  public readonly connections: unknown[] = [];
  readonly #connections: ScriptedConnection[];

  public constructor(connections: readonly ScriptedConnection[]) {
    this.#connections = [...connections];
  }

  public connect(
    config: typeof MIGRATION_CONFIG.connection,
  ): Promise<MigrationConnection> {
    this.connections.push(config);
    const connection = this.#connections.shift();
    return connection === undefined
      ? Promise.reject(new Error('raw connector failure'))
      : Promise.resolve(connection);
  }
}

class RecordingLogger implements MigrationLogger {
  public readonly records: MigrationLogRecord[] = [];

  public write(record: Readonly<MigrationLogRecord>): void {
    this.records.push({...record});
  }
}

function checksum(sql: string): string {
  return createHash('sha256')
    .update(new TextEncoder().encode(sql))
    .digest('hex');
}

function run(options: {
  readonly connection: ScriptedConnection;
  readonly files?: readonly (readonly [string, string])[];
  readonly logger?: MigrationLogger;
}): ReturnType<typeof executeMigrations> {
  return executeMigrations({
    config: MIGRATION_CONFIG,
    migrationRoots: [ROOT],
    fileSystem: new MemoryFileSystem(
      options.files ?? [[FIRST_FILENAME, FIRST_SQL]],
    ),
    connector: new QueueConnector([options.connection]),
    logger: options.logger ?? new RecordingLogger(),
  });
}

describe('executeMigrations', () => {
  it('holds the stable lock and atomically applies SQL with its ledger insert', async () => {
    const connection = new ScriptedConnection();
    const logger = new RecordingLogger();

    const result = await run({connection, logger});

    expect(result).toEqual({outcome: 'applied', appliedVersions: ['000001']});
    expect(MIGRATION_ADVISORY_LOCK_IDENTITY).toEqual({
      classId: 1_398_035_029,
      objectId: 1_296_648_018,
    });
    expect(connection.calls).toEqual([
      {
        sql: ACQUIRE_MIGRATION_LOCK_SQL,
        parameters: [1_398_035_029, 1_296_648_018],
      },
      {sql: 'BEGIN'},
      {sql: CREATE_METADATA_SCHEMA_SQL},
      {sql: CREATE_MIGRATION_LEDGER_SQL},
      {sql: 'COMMIT'},
      {sql: READ_MIGRATION_LEDGER_SQL},
      {sql: 'BEGIN'},
      {sql: FIRST_SQL},
      {
        sql: INSERT_MIGRATION_LEDGER_SQL,
        parameters: ['000001', 'first_step', checksum(FIRST_SQL)],
      },
      {sql: 'COMMIT'},
      {
        sql: RELEASE_MIGRATION_LOCK_SQL,
        parameters: [1_398_035_029, 1_296_648_018],
      },
    ]);
    expect(connection.closeCalls).toBe(1);
    expect(logger.records).toEqual([
      {
        event: 'migration_applied',
        version: '000001',
        name: 'first_step',
        checksum: checksum(FIRST_SQL),
        outcome: 'applied',
      },
    ]);
  });

  it('bootstraps only the metadata schema and fixed ledger', async () => {
    const connection = new ScriptedConnection({
      ledgerRows: [
        {
          version: '000001',
          name: 'first_step',
          checksum: checksum(FIRST_SQL),
        },
      ],
    });

    const result = await run({connection});

    expect(result).toEqual({outcome: 'noop', appliedVersions: []});
    const sql = connection.calls.map(({sql: query}) => query).join('\n');
    expect(sql).toContain('CREATE SCHEMA IF NOT EXISTS struinfo_meta');
    expect(sql).toContain('struinfo_meta.schema_migrations');
    expect(sql).not.toContain('CREATE ROLE');
    expect(sql).not.toContain('CREATE EXTENSION');
    expect(sql).not.toContain('pgboss');
    expect(sql).not.toContain(FIRST_SQL);
    expect(sql).not.toContain(INSERT_MIGRATION_LEDGER_SQL);
  });

  it('treats an exact second invocation as a no-op', async () => {
    const firstConnection = new ScriptedConnection();
    const secondConnection = new ScriptedConnection({
      ledgerRows: [
        {
          version: '000001',
          name: 'first_step',
          checksum: checksum(FIRST_SQL),
        },
      ],
    });
    const connector = new QueueConnector([firstConnection, secondConnection]);
    const logger = new RecordingLogger();
    const options = {
      config: MIGRATION_CONFIG,
      migrationRoots: [ROOT],
      fileSystem: new MemoryFileSystem([[FIRST_FILENAME, FIRST_SQL]]),
      connector,
      logger,
    } as const;

    const first = await executeMigrations(options);
    const second = await executeMigrations(options);

    expect(first.outcome).toBe('applied');
    expect(second).toEqual({outcome: 'noop', appliedVersions: []});
    expect(secondConnection.calls.some(({sql}) => sql === FIRST_SQL)).toBe(
      false,
    );
    expect(
      secondConnection.calls.some(
        ({sql}) => sql === INSERT_MIGRATION_LEDGER_SQL,
      ),
    ).toBe(false);
    expect(connector.connections).toEqual([
      MIGRATION_CONFIG.connection,
      MIGRATION_CONFIG.connection,
    ]);
    expect(firstConnection.closeCalls).toBe(1);
    expect(secondConnection.closeCalls).toBe(1);
  });

  it('rejects checksum drift before applying any pending migration', async () => {
    const connection = new ScriptedConnection({
      ledgerRows: [
        {
          version: '000001',
          name: 'first_step',
          checksum: 'a'.repeat(64),
        },
      ],
    });

    await expect(
      run({
        connection,
        files: [
          [FIRST_FILENAME, FIRST_SQL],
          [SECOND_FILENAME, SECOND_SQL],
        ],
      }),
    ).rejects.toMatchObject({
      record: {
        event: 'migration_history_changed',
        version: '000001',
        outcome: 'failed',
      },
    });
    expect(connection.calls.some(({sql}) => sql === FIRST_SQL)).toBe(false);
    expect(connection.calls.some(({sql}) => sql === SECOND_SQL)).toBe(false);
    expect(connection.calls.at(-1)?.sql).toBe(RELEASE_MIGRATION_LOCK_SQL);
    expect(connection.closeCalls).toBe(1);
  });

  it('rejects a ledger version whose applied file is missing', async () => {
    const connection = new ScriptedConnection({
      ledgerRows: [
        {
          version: '000001',
          name: 'missing_step',
          checksum: 'b'.repeat(64),
        },
      ],
    });

    await expect(
      run({
        connection,
        files: [[SECOND_FILENAME, SECOND_SQL]],
      }),
    ).rejects.toMatchObject({
      record: {
        event: 'migration_applied_file_missing',
        version: '000001',
        outcome: 'failed',
      },
    });
    expect(connection.calls.some(({sql}) => sql === SECOND_SQL)).toBe(false);
    expect(connection.closeCalls).toBe(1);
  });

  it('rejects invalid or duplicate ledger state', async () => {
    const duplicateRow = {
      version: '000001',
      name: 'first_step',
      checksum: checksum(FIRST_SQL),
    };
    const connection = new ScriptedConnection({
      ledgerRows: [duplicateRow, duplicateRow],
    });

    await expect(run({connection})).rejects.toMatchObject({
      record: {event: 'migration_ledger_invalid', outcome: 'failed'},
    });
    expect(connection.calls.at(-1)?.sql).toBe(RELEASE_MIGRATION_LOCK_SQL);
    expect(connection.closeCalls).toBe(1);
  });

  it('rejects a late historical gap instead of backfilling out of order', async () => {
    const connection = new ScriptedConnection({
      ledgerRows: [
        {
          version: '000002',
          name: 'second_step',
          checksum: checksum(SECOND_SQL),
        },
      ],
    });

    await expect(
      run({
        connection,
        files: [
          [FIRST_FILENAME, FIRST_SQL],
          [SECOND_FILENAME, SECOND_SQL],
        ],
      }),
    ).rejects.toMatchObject({
      record: {
        event: 'migration_history_non_linear',
        version: '000001',
        outcome: 'failed',
      },
    });
    expect(connection.calls.some(({sql}) => sql === FIRST_SQL)).toBe(false);
  });

  it('rolls back on the first SQL failure and suppresses all later files', async () => {
    const connection = new ScriptedConnection({
      failures: new Map([[FIRST_SQL, 1]]),
    });

    await expect(
      run({
        connection,
        files: [
          [FIRST_FILENAME, FIRST_SQL],
          [SECOND_FILENAME, SECOND_SQL],
        ],
      }),
    ).rejects.toMatchObject({
      record: {
        event: 'migration_transaction_failed',
        version: '000001',
        outcome: 'failed',
      },
    });
    const sql = connection.calls.map(({sql: query}) => query);
    expect(sql).toContain('ROLLBACK');
    expect(sql).not.toContain(INSERT_MIGRATION_LEDGER_SQL);
    expect(sql).not.toContain(SECOND_SQL);
    expect(sql.at(-1)).toBe(RELEASE_MIGRATION_LOCK_SQL);
    expect(connection.closeCalls).toBe(1);
  });

  it('rolls back when the parameterized ledger insert fails', async () => {
    const connection = new ScriptedConnection({
      failures: new Map([[INSERT_MIGRATION_LEDGER_SQL, 1]]),
    });

    await expect(
      run({
        connection,
        files: [
          [FIRST_FILENAME, FIRST_SQL],
          [SECOND_FILENAME, SECOND_SQL],
        ],
      }),
    ).rejects.toMatchObject({
      record: {event: 'migration_transaction_failed', outcome: 'failed'},
    });
    const sql = connection.calls.map(({sql: query}) => query);
    expect(sql).toContain(FIRST_SQL);
    expect(sql).toContain(INSERT_MIGRATION_LEDGER_SQL);
    expect(sql).toContain('ROLLBACK');
    expect(sql).not.toContain(SECOND_SQL);
  });

  it.each([
    ['lock', ACQUIRE_MIGRATION_LOCK_SQL, false],
    ['bootstrap', CREATE_METADATA_SCHEMA_SQL, true],
    ['ledger read', READ_MIGRATION_LEDGER_SQL, true],
  ] as const)(
    'cleans the connection after a %s failure',
    async (_stage, failedSql, expectsUnlock) => {
      const connection = new ScriptedConnection({
        failures: new Map([[failedSql, 1]]),
      });

      await expect(run({connection})).rejects.toBeDefined();

      expect(connection.closeCalls).toBe(1);
      expect(
        connection.calls.some(({sql}) => sql === RELEASE_MIGRATION_LOCK_SQL),
      ).toBe(expectsUnlock);
      if (failedSql === CREATE_METADATA_SCHEMA_SQL) {
        expect(connection.calls.some(({sql}) => sql === 'ROLLBACK')).toBe(true);
      }
    },
  );

  it('closes the connection when advisory unlock reports false', async () => {
    const connection = new ScriptedConnection({
      ledgerRows: [
        {
          version: '000001',
          name: 'first_step',
          checksum: checksum(FIRST_SQL),
        },
      ],
    });
    connection.unlockResult = false;

    await expect(run({connection})).rejects.toMatchObject({
      record: {event: 'migration_unlock_failed', outcome: 'failed'},
    });
    expect(connection.closeCalls).toBe(1);
  });

  it('turns connection cleanup failure into a safe visible failure', async () => {
    const connection = new ScriptedConnection({
      ledgerRows: [
        {
          version: '000001',
          name: 'first_step',
          checksum: checksum(FIRST_SQL),
        },
      ],
    });
    connection.closeFails = true;

    await expect(run({connection})).rejects.toMatchObject({
      record: {
        event: 'migration_connection_close_failed',
        outcome: 'failed',
      },
    });
    expect(connection.closeCalls).toBe(1);
  });

  it('does not connect when file discovery fails', async () => {
    const connector = new QueueConnector([new ScriptedConnection()]);
    const fileSystem: MigrationFileSystem = {
      readDirectory: () =>
        Promise.resolve([{name: 'malformed.sql', kind: 'file'}]),
      readFile: () => Promise.reject(new Error('must not read')),
    };

    await expect(
      executeMigrations({
        config: MIGRATION_CONFIG,
        migrationRoots: [ROOT],
        fileSystem,
        connector,
        logger: new RecordingLogger(),
      }),
    ).rejects.toMatchObject({
      record: {event: 'migration_file_name_invalid', outcome: 'failed'},
    });
    expect(connector.connections).toEqual([]);
  });
});
