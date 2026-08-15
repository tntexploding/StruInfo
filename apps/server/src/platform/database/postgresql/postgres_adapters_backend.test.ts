import {describe, expect, it} from 'vitest';

import {
  deriveCurationTargetId,
  deriveIntakeDecisionId,
  deriveIntakeDecisionRevisionId,
} from '../../../modules/curation/index.js';
import {decodeManualCurationRepositorySnapshot} from '../../../modules/curation/closed_manual_curation_input.js';
import {decodeManualKnowledgeRepositorySnapshot} from '../../../modules/knowledge/closed_manual_knowledge_input.js';
import {
  deriveKnowledgeItemRevisionId,
  deriveKnowledgeRelationRevisionId,
} from '../../../modules/knowledge/index.js';

import {
  decodePostgresConnectionUrl,
  PostgresConnectionConfigError,
} from './postgres_connection_config.js';
import {
  PostgresManualCurationRepository,
  READ_CURATION_COMMAND_SQL,
} from './postgres_curation_repository.js';
import {
  PostgresManualKnowledgeRepository,
  READ_KNOWLEDGE_CHANGE_SET_SQL,
} from './postgres_knowledge_repository.js';
import type {
  PostgresClientBoundary,
  PostgresPoolBoundary,
  PostgresQueryResult,
} from './postgres_pool.js';
import {createPostgresKnowledgeRepositories} from './postgres_repository_factory.js';
import {
  PostgresDeterministicKnowledgeSearchRepository,
  READ_CURRENT_SEARCH_FRAGMENT_INPUTS_SQL,
  READ_CURRENT_SEARCH_ITEMS_SQL,
  READ_CURRENT_SEARCH_RELATIONS_SQL,
  READ_CURRENT_SEARCH_RELATION_REVISIONS_SQL,
  READ_CURRENT_SEARCH_REVISIONS_SQL,
} from './postgres_retrieval_repository.js';
import {
  BEGIN_READ_COMMITTED_SQL,
  BEGIN_REPEATABLE_READ_ONLY_SQL,
  COMMIT_TRANSACTION_SQL,
  ROLLBACK_TRANSACTION_SQL,
  PostgresTransactionError,
  runPostgresTransaction,
} from './postgres_transaction.js';
import {
  ACQUIRE_WORKSPACE_WRITE_LOCK_SQL,
  deriveWorkspaceWriteLockKey,
  READ_WORKSPACE_SQL,
} from './workspace_write_lock.js';

const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';
const MIGRATOR_ROLE = 'struinfo_tm2_migrator';
const RUNTIME_ROLE = 'struinfo_tm2_runtime';
const ITEM_ID = '22222222-2222-4222-8222-222222222222';
const ITEM_REVISION_ID = deriveKnowledgeItemRevisionId(ITEM_ID, 1);
const RELATION_ID = '44444444-4444-4444-8444-444444444444';
const RELATION_REVISION_ID = deriveKnowledgeRelationRevisionId(RELATION_ID, 1);
const RESOURCE_ID = '66666666-6666-4666-8666-666666666666';
const SNAPSHOT_ID = '77777777-7777-4777-8777-777777777777';
const FRAGMENT_ID = '88888888-8888-4888-8888-888888888888';
const SECOND_FRAGMENT_ID = '99999999-9999-4999-8999-999999999999';
const TARGET_ID = deriveCurationTargetId(WORKSPACE_ID, {
  kind: 'fragment',
  fragmentId: FRAGMENT_ID,
});
const DECISION_ID = deriveIntakeDecisionId(TARGET_ID);
const DECISION_REVISION_ID = deriveIntakeDecisionRevisionId(DECISION_ID, 1);

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
    `postgresql://${RUNTIME_ROLE}:synthetic@example.invalid/struinfo`,
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

describe('write adapter traces', () => {
  it('performs the ordinary curation command lookup after the workspace lock', async () => {
    const client = new FakeClient(workspaceResponse);
    const pool = new FakePool(client);
    const repository = new PostgresManualCurationRepository(pool);

    await repository.runCommandTransaction((transaction) =>
      transaction.lockAndLoadTermCommandSnapshot({
        workspaceId: WORKSPACE_ID,
        commandIdempotencyKey: 'synthetic-command',
        termId: ITEM_ID,
      }),
    );

    const sql = client.calls.map((call) => call.sql);
    expect(sql.slice(0, 5)).toEqual([
      BEGIN_READ_COMMITTED_SQL,
      ACQUIRE_WORKSPACE_WRITE_LOCK_SQL,
      READ_WORKSPACE_SQL,
      READ_CURATION_COMMAND_SQL,
      expect.stringContaining('FROM struinfo.vocabulary_term'),
    ]);
    expect(READ_CURATION_COMMAND_SQL).not.toMatch(/\bFOR\b/iu);
    expect(client.calls[1]?.parameters).toEqual(['6525535244086785952']);
    expect(client.calls[2]?.parameters).toEqual([WORKSPACE_ID]);
    expect(client.calls[3]?.parameters).toEqual([
      WORKSPACE_ID,
      'synthetic-command',
    ]);
    expect(sql.at(-1)).toBe(COMMIT_TRANSACTION_SQL);
    expect(client.releaseCalls).toBe(1);
  });

  it('locks knowledge identities in primary-item, relation, endpoint order', async () => {
    const client = new FakeClient(workspaceResponse);
    const repository = new PostgresManualKnowledgeRepository(
      new FakePool(client),
    );

    await repository.runCommandTransaction((transaction) =>
      transaction.lockAndLoadManualKnowledgeSnapshot({
        workspaceId: WORKSPACE_ID,
        commandIdempotencyKey: 'synthetic-command',
        authorization: {kind: 'manual_edit'},
        primaryItemIds: [ITEM_ID],
        primaryRelationIds: [RELATION_ID],
        endpointItemIds: [ITEM_ID, RESOURCE_ID],
        fragmentIds: [],
        historicalItemRevisions: [],
        historicalRelationRevisions: [],
      }),
    );

    expect(READ_KNOWLEDGE_CHANGE_SET_SQL).not.toMatch(/\bFOR\b/iu);
    const locks = client.calls.filter(({sql}) => /\bFOR UPDATE\b/iu.test(sql));
    expect(locks).toHaveLength(3);
    expect(locks.map(({parameters}) => parameters)).toEqual([
      [WORKSPACE_ID, [ITEM_ID]],
      [WORKSPACE_ID, [RELATION_ID]],
      [WORKSPACE_ID, [RESOURCE_ID]],
    ]);
  });

  it('maps target state narrowly and preserves decision reason ordinal', async () => {
    const client = new FakeClient(curationTargetResponse);
    const repository = new PostgresManualCurationRepository(
      new FakePool(client),
    );

    const snapshot = decodeManualCurationRepositorySnapshot(
      await repository.runCommandTransaction((transaction) =>
        transaction.lockAndLoadTargetCommandSnapshot({
          workspaceId: WORKSPACE_ID,
          commandIdempotencyKey: 'synthetic-command',
          target: {kind: 'fragment', fragmentId: FRAGMENT_ID},
          referencedTermIds: [],
        }),
      ),
    );

    expect(snapshot.targets).toHaveLength(1);
    expect(snapshot.decisions).toEqual([
      {
        workspaceId: WORKSPACE_ID,
        decisionId: DECISION_ID,
        targetId: TARGET_ID,
        currentRevision: 1,
        currentRevisionId: DECISION_REVISION_ID,
        value: {
          action: 'full',
          reasonCodes: ['worth_exploring', 'insufficient_evidence'],
        },
      },
    ]);
    const scopedReads = client.calls.filter(({parameters}) =>
      parameters.some((parameter) => Array.isArray(parameter)),
    );
    expect(
      scopedReads.every(({parameters}) =>
        parameters.some(
          (parameter) =>
            Array.isArray(parameter) &&
            parameter.length === 1 &&
            parameter[0] === TARGET_ID,
        ),
      ),
    ).toBe(true);
  });

  it('maps citation and derivation ordinals independently', async () => {
    const client = new FakeClient(knowledgeMappingResponse);
    const repository = new PostgresManualKnowledgeRepository(
      new FakePool(client),
    );

    const snapshot = decodeManualKnowledgeRepositorySnapshot(
      await repository.runCommandTransaction((transaction) =>
        transaction.lockAndLoadManualKnowledgeSnapshot({
          workspaceId: WORKSPACE_ID,
          commandIdempotencyKey: 'synthetic-command',
          authorization: {kind: 'manual_edit'},
          primaryItemIds: [ITEM_ID],
          primaryRelationIds: [],
          endpointItemIds: [],
          fragmentIds: [FRAGMENT_ID, SECOND_FRAGMENT_ID],
          historicalItemRevisions: [],
          historicalRelationRevisions: [],
        }),
      ),
    );

    expect(snapshot.revisions).toHaveLength(1);
    expect(snapshot.revisions[0]?.provenance).toEqual({
      citations: [FRAGMENT_ID],
      fragmentDerivations: [SECOND_FRAGMENT_ID],
      knowledgeDerivations: [],
    });
    expect(Object.isFrozen(snapshot.revisions[0]?.provenance)).toBe(true);
  });

  it('turns a zero-row current-pointer CAS into rollback', async () => {
    const client = new FakeClient(() => ({rowCount: 0}));
    const repository = new PostgresManualCurationRepository(
      new FakePool(client),
    );

    await expect(
      repository.runCommandTransaction((transaction) =>
        transaction.compareAndSetTargetVersion({
          workspaceId: WORKSPACE_ID,
          targetId: ITEM_ID,
          expectedVersion: 1,
          nextVersion: 2,
        }),
      ),
    ).rejects.toThrow('PostgreSQL transaction failed.');
    expect(client.calls.at(-1)?.sql).toBe(ROLLBACK_TRANSACTION_SQL);
    expect(client.calls[1]?.parameters).toEqual([WORKSPACE_ID, ITEM_ID, 1, 2]);
  });

  it('keeps caller text in parameters rather than the SQL statement', async () => {
    const callerText = "synthetic'); DROP TABLE struinfo.workspace; --";
    const client = new FakeClient((sql) =>
      sql.startsWith('INSERT INTO') ? {rowCount: 1} : defaultResponse(),
    );
    const repository = new PostgresManualCurationRepository(
      new FakePool(client),
    );

    await repository.runCommandTransaction((transaction) =>
      transaction.insertVocabularyTermRevision({
        workspaceId: WORKSPACE_ID,
        termId: ITEM_ID,
        termRevisionId: RESOURCE_ID,
        revisionNumber: 1,
        value: {
          displayName: callerText,
          lifecycle: 'active',
        },
      }),
    );

    const insert = client.calls.find(({sql}) =>
      sql.startsWith('INSERT INTO struinfo.vocabulary_term_revision'),
    );
    expect(insert?.sql).not.toContain(callerText);
    expect(insert?.parameters).toContain(callerText);
    expect(client.calls.at(-1)?.sql).toBe(COMMIT_TRANSACTION_SQL);
  });
});

describe('retrieval adapter', () => {
  it('loads five owned arrays in one repeatable-read read-only transaction', async () => {
    const client = new FakeClient(retrievalResponse);
    const pool = new FakePool(client);
    const repositories = createPostgresKnowledgeRepositories(pool);
    const repository = new PostgresDeterministicKnowledgeSearchRepository(pool);

    const snapshot =
      await repository.loadCurrentKnowledgeSearchSnapshot(WORKSPACE_ID);

    expect(client.calls.map(({sql}) => sql)).toEqual([
      BEGIN_REPEATABLE_READ_ONLY_SQL,
      READ_CURRENT_SEARCH_ITEMS_SQL,
      READ_CURRENT_SEARCH_REVISIONS_SQL,
      READ_CURRENT_SEARCH_FRAGMENT_INPUTS_SQL,
      READ_CURRENT_SEARCH_RELATIONS_SQL,
      READ_CURRENT_SEARCH_RELATION_REVISIONS_SQL,
      COMMIT_TRANSACTION_SQL,
    ]);
    expect(snapshot.items).toEqual([
      {
        workspaceId: WORKSPACE_ID,
        itemId: ITEM_ID,
        currentRevision: 1,
        currentRevisionId: ITEM_REVISION_ID,
      },
    ]);
    expect(snapshot.revisions[0]).not.toHaveProperty('body');
    expect(snapshot.relationRevisions[0]?.value).not.toHaveProperty(
      'qualifier',
    );
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot.fragmentInputs)).toBe(true);
    expect(pool.endCalls).toBe(0);
    expect(client.releaseCalls).toBe(1);
    expect(repositories.retrieval).toBeInstanceOf(
      PostgresDeterministicKnowledgeSearchRepository,
    );
  });
});

function defaultResponse(): Response {
  return {rows: [], rowCount: 0};
}

function workspaceResponse(sql: string): Response {
  return sql === READ_WORKSPACE_SQL
    ? {rows: [{workspace_id: WORKSPACE_ID}], rowCount: 1}
    : defaultResponse();
}

function curationTargetResponse(sql: string): Response {
  if (sql === READ_WORKSPACE_SQL) {
    return {rows: [{workspace_id: WORKSPACE_ID}], rowCount: 1};
  }
  if (sql.endsWith('WHERE workspace_id = $1 AND fragment_id = $2')) {
    return {rows: [{target_id: TARGET_ID}], rowCount: 1};
  }
  if (sql.includes('target_kind,') && sql.includes('target_id = ANY')) {
    return {
      rows: [
        {
          workspace_id: WORKSPACE_ID,
          target_id: TARGET_ID,
          target_kind: 'fragment',
          resource_id: null,
          snapshot_id: null,
          fragment_id: FRAGMENT_ID,
          current_version: 1,
        },
      ],
      rowCount: 1,
    };
  }
  if (sql.includes('FROM struinfo.intake_decision AS d')) {
    return {
      rows: [
        {
          workspace_id: WORKSPACE_ID,
          decision_id: DECISION_ID,
          target_id: TARGET_ID,
          current_revision: 1,
          current_revision_id: DECISION_REVISION_ID,
          intake_action: 'full',
          note: null,
        },
      ],
      rowCount: 1,
    };
  }
  if (sql.includes('FROM struinfo.intake_decision_reason AS r')) {
    return {
      rows: [
        {
          workspace_id: WORKSPACE_ID,
          decision_id: DECISION_ID,
          decision_revision_id: DECISION_REVISION_ID,
          reason_ordinal: 0,
          reason_code: 'worth_exploring',
        },
        {
          workspace_id: WORKSPACE_ID,
          decision_id: DECISION_ID,
          decision_revision_id: DECISION_REVISION_ID,
          reason_ordinal: 1,
          reason_code: 'insufficient_evidence',
        },
      ],
      rowCount: 2,
    };
  }
  return defaultResponse();
}

function knowledgeMappingResponse(sql: string): Response {
  if (sql === READ_WORKSPACE_SQL) {
    return {rows: [{workspace_id: WORKSPACE_ID}], rowCount: 1};
  }
  if (
    sql.includes('FROM struinfo.knowledge_item\nWHERE') &&
    sql.includes('ANY')
  ) {
    return {
      rows: [
        {
          workspace_id: WORKSPACE_ID,
          item_id: ITEM_ID,
          current_revision: 1,
          current_revision_id: ITEM_REVISION_ID,
        },
      ],
      rowCount: 1,
    };
  }
  if (sql.includes('FROM struinfo.knowledge_revision\nWHERE')) {
    return {
      rows: [
        {
          workspace_id: WORKSPACE_ID,
          item_id: ITEM_ID,
          revision_number: 1,
          revision_id: ITEM_REVISION_ID,
          previous_revision_id: null,
          knowledge_kind: 'concept',
          epistemic_role: 'summary',
          review_state: 'confirmed',
          title: 'Synthetic title',
          body: null,
        },
      ],
      rowCount: 1,
    };
  }
  if (sql.includes('FROM struinfo.fragment\nWHERE')) {
    return {
      rows: [FRAGMENT_ID, SECOND_FRAGMENT_ID].map((fragmentId) => ({
        workspace_id: WORKSPACE_ID,
        resource_id: RESOURCE_ID,
        snapshot_id: SNAPSHOT_ID,
        fragment_id: fragmentId,
        selected_text_sha256: 'a'.repeat(64),
      })),
      rowCount: 2,
    };
  }
  if (sql.includes('FROM struinfo.knowledge_revision_fragment_input')) {
    return {
      rows: [
        {
          workspace_id: WORKSPACE_ID,
          item_id: ITEM_ID,
          revision_number: 1,
          revision_id: ITEM_REVISION_ID,
          input_kind: 'citation',
          input_ordinal: 0,
          fragment_id: FRAGMENT_ID,
        },
        {
          workspace_id: WORKSPACE_ID,
          item_id: ITEM_ID,
          revision_number: 1,
          revision_id: ITEM_REVISION_ID,
          input_kind: 'derivation',
          input_ordinal: 0,
          fragment_id: SECOND_FRAGMENT_ID,
        },
      ],
      rowCount: 2,
    };
  }
  return defaultResponse();
}

function retrievalResponse(sql: string): Response {
  if (sql === READ_CURRENT_SEARCH_ITEMS_SQL) {
    return {
      rows: [
        {
          workspace_id: WORKSPACE_ID,
          item_id: ITEM_ID,
          current_revision: 1,
          current_revision_id: ITEM_REVISION_ID,
        },
      ],
      rowCount: 1,
    };
  }
  if (sql === READ_CURRENT_SEARCH_REVISIONS_SQL) {
    return {
      rows: [
        {
          workspace_id: WORKSPACE_ID,
          item_id: ITEM_ID,
          revision_number: 1,
          revision_id: ITEM_REVISION_ID,
          knowledge_kind: 'concept',
          epistemic_role: 'summary',
          review_state: 'withdrawn',
          title: 'Synthetic title',
          body: null,
        },
      ],
      rowCount: 1,
    };
  }
  if (sql === READ_CURRENT_SEARCH_FRAGMENT_INPUTS_SQL) {
    return {
      rows: [
        {
          workspace_id: WORKSPACE_ID,
          item_id: ITEM_ID,
          revision_number: 1,
          revision_id: ITEM_REVISION_ID,
          input_kind: 'citation',
          input_ordinal: 0,
          resource_id: RESOURCE_ID,
          snapshot_id: SNAPSHOT_ID,
          fragment_id: FRAGMENT_ID,
        },
      ],
      rowCount: 1,
    };
  }
  if (sql === READ_CURRENT_SEARCH_RELATIONS_SQL) {
    return {
      rows: [
        {
          workspace_id: WORKSPACE_ID,
          relation_id: RELATION_ID,
          subject_item_id: ITEM_ID,
          relation_type_key: 'synthetic:relation',
          object_item_id: RESOURCE_ID,
          current_revision: 1,
          current_revision_id: RELATION_REVISION_ID,
        },
      ],
      rowCount: 1,
    };
  }
  if (sql === READ_CURRENT_SEARCH_RELATION_REVISIONS_SQL) {
    return {
      rows: [
        {
          workspace_id: WORKSPACE_ID,
          relation_id: RELATION_ID,
          revision_number: 1,
          revision_id: RELATION_REVISION_ID,
          subject_item_id: ITEM_ID,
          relation_type_key: 'synthetic:relation',
          object_item_id: RESOURCE_ID,
          epistemic_role: 'summary',
          review_state: 'rejected',
          qualifier: null,
        },
      ],
      rowCount: 1,
    };
  }
  return defaultResponse();
}
