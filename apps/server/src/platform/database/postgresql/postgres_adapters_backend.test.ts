import {describe, expect, it} from 'vitest';

import {
  decodePostgresConnectionUrl,
  PostgresConnectionConfigError,
} from './postgres_connection_config.js';
import type {
  PostgresClientBoundary,
  PostgresPoolBoundary,
  PostgresQueryResult,
} from './postgres_pool.js';
import {
  BEGIN_READ_COMMITTED_SQL,
  COMMIT_TRANSACTION_SQL,
  ROLLBACK_TRANSACTION_SQL,
  PostgresTransactionError,
  runPostgresTransaction,
} from './postgres_transaction.js';
import {deriveWorkspaceWriteLockKey} from './workspace_write_lock.js';

const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';
const MIGRATOR_ROLE = 'struinfo_tm2_migrator';
const RUNTIME_ROLE = 'struinfo_tm2_runtime';
interface QueryCall {
  readonly sql: string;
  readonly parameters: readonly unknown[];
}

type Response = Readonly<{
  rows?: readonly Readonly<Record<string, unknown>>[];
  rowCount?: number | null;
}>;

class FakeClient implements PostgresClientBoundary {
  public readonly calls: QueryCall[] = [];
  public releaseCalls = 0;
  public releaseFails = false;
  readonly #respond: (sql: string, parameters: readonly unknown[]) => Response;

  public constructor(
    respond: (
      sql: string,
      parameters: readonly unknown[],
    ) => Response = defaultResponse,
  ) {
    this.#respond = respond;
  }

  public query<Row extends Readonly<Record<string, unknown>>>(
    sql: string,
    parameters: readonly unknown[] = [],
  ): Promise<PostgresQueryResult<Row>> {
    const ownedParameters = Object.freeze([...parameters]);
    this.calls.push({sql, parameters: ownedParameters});
    const response = this.#respond(sql, ownedParameters);
    return Promise.resolve({
      rows: (response.rows ?? []) as readonly Row[],
      rowCount: response.rowCount ?? 0,
    });
  }

  public executeSimple<Row extends Readonly<Record<string, unknown>>>(
    sql: string,
    parameters: readonly unknown[],
  ): Promise<PostgresQueryResult<Row>> {
    return this.query<Row>(sql, parameters);
  }

  public release(): void {
    this.releaseCalls += 1;
    if (this.releaseFails) throw new Error('synthetic release failure');
  }
}

class FakePool implements PostgresPoolBoundary {
  public connectCalls = 0;
  public endCalls = 0;
  readonly #client: FakeClient;

  public constructor(client: FakeClient) {
    this.#client = client;
  }

  public query<Row extends Readonly<Record<string, unknown>>>(
    sql: string,
    parameters: readonly unknown[] = [],
  ): Promise<PostgresQueryResult<Row>> {
    return this.#client.query<Row>(sql, parameters);
  }

  public connect(): Promise<PostgresClientBoundary> {
    this.connectCalls += 1;
    return Promise.resolve(this.#client);
  }

  public end(): Promise<void> {
    this.endCalls += 1;
    return Promise.resolve();
  }
}

describe('closed PostgreSQL connection projection', () => {
  it.each([
    ['literal plus', 'synthetic+secret', 'synthetic+secret'],
    ['encoded plus', 'synthetic%2Bsecret', 'synthetic+secret'],
    ['encoded at', 'synthetic%40secret', 'synthetic@secret'],
    ['single decoding', 'synthetic%2525secret', 'synthetic%25secret'],
  ])('preserves %s semantics exactly once', (_name, encoded, decoded) => {
    const config = decodePostgresConnectionUrl(
      `postgresql://${RUNTIME_ROLE}:${encoded}@localhost/struinfo`,
      'runtime',
    );

    expect(config.password).toBe(decoded);
    expect(Reflect.ownKeys(config)).toEqual([
      'host',
      'port',
      'database',
      'user',
      'password',
      'ssl',
      'application_name',
      'options',
    ]);
    expect(Object.getPrototypeOf(config)).toBeNull();
    expect(Object.isFrozen(config)).toBe(true);
    expect(Object.getOwnPropertyDescriptor(config, 'password')).toMatchObject({
      value: decoded,
      enumerable: true,
      writable: false,
      configurable: false,
    });
    expect('connectionString' in config).toBe(false);
    expect(config.application_name).toBe('struinfo-tm2-runtime');
  });

  it.each([
    `postgresql://${RUNTIME_ROLE}@localhost/struinfo`,
    `postgresql://${RUNTIME_ROLE}:@localhost/struinfo`,
    `postgresql://${RUNTIME_ROLE}:%00@localhost/struinfo`,
    `postgresql://${RUNTIME_ROLE}:synthetic@localhost,example.invalid/struinfo`,
    `postgresql://${RUNTIME_ROLE}:synthetic@bad_host/struinfo`,
    `postgresql://${RUNTIME_ROLE}:synthetic@0.0.0.0/struinfo`,
    `postgresql://${RUNTIME_ROLE}:synthetic@[::]/struinfo`,
    `postgresql://${RUNTIME_ROLE}:synthetic@localhost/a/b`,
    `postgresql://${RUNTIME_ROLE}:synthetic@localhost/struinfo?ssl=true`,
    `postgresql://${RUNTIME_ROLE}:%ZZ@localhost/struinfo`,
    `postgresql://${RUNTIME_ROLE}:synthetic@localhost:/struinfo`,
  ])('rejects %s before any pg factory is involved', (value) => {
    expect(() => decodePostgresConnectionUrl(value, 'runtime')).toThrow(
      PostgresConnectionConfigError,
    );
  });

  it.each([
    ['postgres', 'postgres'],
    ['host.docker.internal', 'host.docker.internal'],
    ['10.20.30.40', '10.20.30.40'],
    ['db.internal', 'db.internal'],
    ['[2001:db8::10]', '2001:db8::10'],
  ] as const)(
    'accepts the explicit single PostgreSQL host %s',
    (serializedHost, expectedHost) => {
      const config = decodePostgresConnectionUrl(
        `postgresql://${RUNTIME_ROLE}:synthetic@${serializedHost}/struinfo`,
        'runtime',
      );

      expect(config.host).toBe(expectedHost);
    },
  );

  it.each([
    ['runtime', RUNTIME_ROLE, 'struinfo-tm2-runtime'],
    ['migrator', MIGRATOR_ROLE, 'struinfo-tm2-migrator'],
  ] as const)(
    'accepts the exact %s role identity',
    (purpose, role, applicationName) => {
      const config = decodePostgresConnectionUrl(
        `postgresql://${role}:synthetic@localhost/struinfo`,
        purpose,
      );

      expect(config.user).toBe(role);
      expect(config.application_name).toBe(applicationName);
    },
  );

  it.each([
    ['runtime', 'struinfo_tm2_%72untime', RUNTIME_ROLE],
    ['migrator', 'struinfo_tm2_%6Digrator', MIGRATOR_ROLE],
  ] as const)(
    'accepts a once-decoded exact %s role identity',
    (purpose, encodedRole, expectedRole) => {
      const config = decodePostgresConnectionUrl(
        `postgresql://${encodedRole}:synthetic@localhost/struinfo`,
        purpose,
      );

      expect(config.user).toBe(expectedRole);
    },
  );

  it.each([
    ['runtime', 'synthetic_runtime'],
    ['migrator', 'synthetic_migrator'],
    ['runtime', MIGRATOR_ROLE],
    ['migrator', RUNTIME_ROLE],
    ['runtime', 'struinfo_tm2_%52untime'],
    ['migrator', 'struinfo_tm2_%4Digrator'],
  ] as const)(
    'rejects a non-matching decoded %s role without echoing credentials',
    (purpose, encodedRole) => {
      const password = 'synthetic-private-password';
      const input = `postgresql://${encodedRole}:${password}@localhost/struinfo`;
      let failure: unknown;

      try {
        decodePostgresConnectionUrl(input, purpose);
      } catch (error) {
        failure = error;
      }

      expect(failure).toBeInstanceOf(PostgresConnectionConfigError);
      expect(String(failure)).not.toContain(input);
      expect(String(failure)).not.toContain(encodedRole);
      expect(String(failure)).not.toContain(password);
    },
  );

  it('owns the decoded configuration independently of later input changes', () => {
    const source = {
      url: `postgresql://${RUNTIME_ROLE}:synthetic@localhost/struinfo`,
    };
    const config = decodePostgresConnectionUrl(source.url, 'runtime');

    source.url = `postgresql://${MIGRATOR_ROLE}:changed@example.invalid/changed`;

    expect(config).toMatchObject({
      host: 'localhost',
      database: 'struinfo',
      user: RUNTIME_ROLE,
      password: 'synthetic',
    });
  });
});

describe('transaction and workspace lock envelope', () => {
  it('uses the frozen signed-bigint known answer', () => {
    expect(deriveWorkspaceWriteLockKey(WORKSPACE_ID)).toBe(
      '6525535244086785952',
    );
  });

  it('commits once and releases the one acquired client', async () => {
    const client = new FakeClient();
    const pool = new FakePool(client);

    await expect(
      runPostgresTransaction(pool, 'read_committed', async (transaction) => {
        await transaction.query('SELECT $1::text AS synthetic', ['value']);
        return 'completed';
      }),
    ).resolves.toBe('completed');

    expect(pool.connectCalls).toBe(1);
    expect(client.releaseCalls).toBe(1);
    expect(client.calls).toEqual([
      {sql: BEGIN_READ_COMMITTED_SQL, parameters: []},
      {
        sql: 'SELECT $1::text AS synthetic',
        parameters: ['value'],
      },
      {sql: COMMIT_TRANSACTION_SQL, parameters: []},
    ]);
  });

  it('rolls back and releases after a callback failure', async () => {
    const client = new FakeClient();
    const pool = new FakePool(client);

    await expect(
      runPostgresTransaction(pool, 'read_committed', () =>
        Promise.reject(new Error('synthetic callback failure')),
      ),
    ).rejects.toThrow('PostgreSQL transaction failed.');

    expect(client.calls.map(({sql}) => sql)).toEqual([
      BEGIN_READ_COMMITTED_SQL,
      ROLLBACK_TRANSACTION_SQL,
    ]);
    expect(client.releaseCalls).toBe(1);
  });

  it.each([
    ['begin', BEGIN_READ_COMMITTED_SQL, [BEGIN_READ_COMMITTED_SQL]],
    [
      'commit',
      COMMIT_TRANSACTION_SQL,
      [
        BEGIN_READ_COMMITTED_SQL,
        COMMIT_TRANSACTION_SQL,
        ROLLBACK_TRANSACTION_SQL,
      ],
    ],
    [
      'rollback',
      ROLLBACK_TRANSACTION_SQL,
      [BEGIN_READ_COMMITTED_SQL, ROLLBACK_TRANSACTION_SQL],
    ],
  ] as const)(
    'maps a %s failure to one safe error and still releases',
    async (phase, failingSql, expectedSql) => {
      const client = new FakeClient((sql) => {
        if (sql === failingSql) {
          throw new Error(`synthetic private ${phase} detail`);
        }
        return defaultResponse();
      });
      const pool = new FakePool(client);

      const result = runPostgresTransaction(pool, 'read_committed', () =>
        phase === 'rollback'
          ? Promise.reject(new Error('synthetic callback detail'))
          : Promise.resolve(),
      );

      await expect(result).rejects.toEqual(new PostgresTransactionError());
      await expect(result).rejects.not.toThrow(/private|synthetic/iu);
      expect(client.calls.map(({sql}) => sql)).toEqual(expectedSql);
      expect(client.releaseCalls).toBe(1);
    },
  );

  it('fails safely when acquisition or release fails', async () => {
    const acquisition: PostgresPoolBoundary = {
      query: () => Promise.resolve({rows: [], rowCount: 0}),
      connect: () => Promise.reject(new Error('synthetic acquisition detail')),
      end: () => Promise.resolve(),
    };
    await expect(
      runPostgresTransaction(acquisition, 'read_committed', () =>
        Promise.resolve(),
      ),
    ).rejects.toEqual(new PostgresTransactionError());

    const client = new FakeClient();
    client.releaseFails = true;
    await expect(
      runPostgresTransaction(new FakePool(client), 'read_committed', () =>
        Promise.resolve(),
      ),
    ).rejects.toEqual(new PostgresTransactionError());
    expect(client.calls.map(({sql}) => sql)).toEqual([
      BEGIN_READ_COMMITTED_SQL,
      COMMIT_TRANSACTION_SQL,
    ]);
    expect(client.releaseCalls).toBe(1);
  });
});

function defaultResponse(): Response {
  return {rows: [], rowCount: 0};
}
