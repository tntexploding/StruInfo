import type {QueryResultRow} from 'pg';

import {
  executeApplyManualKnowledgeChangeSet,
  executeDeterministicKnowledgeSearch,
  type DeterministicKnowledgeSearchResult,
} from '../../src/modules/knowledge/index.js';
import {
  createPostgresKnowledgeRepositories,
  type PostgresClientBoundary,
  type PostgresPoolBoundary,
  type PostgresQueryResult,
} from '../../src/platform/database/postgresql/index.js';

import {withTm2Deadline} from './concurrency_oracle.js';
import type {Tm2MandatoryCase} from './mandatory_ledger.js';
import type {Tm2CaseEvidence} from './public_facade.js';
import {Tm2SafeFailure} from './bound_runtime.js';
import type {BoundPostgresTm2Runtime} from './bound_runtime.js';

const DEADLINE_MILLISECONDS = 10_000;
const WORKSPACE_ID = '33333333-3333-4333-8333-333333333441';
const ITEM_ID = '55555555-5555-4555-8555-555555555441';

interface ReaderController {
  beginSeen: boolean;
  firstItemsReadSeen: boolean;
  commitSeen: boolean;
  rollbackSeen: boolean;
  releaseCount: number;
  readQueryCount: number;
  readonly firstItemsRead: Promise<void>;
  readonly continueReader: Promise<void>;
  markFirstItemsRead(): void;
  releaseReader(): void;
}

interface SnapshotObservation {
  readonly conditions: readonly boolean[];
}

const observations = new WeakMap<
  BoundPostgresTm2Runtime,
  Promise<SnapshotObservation>
>();

function evidence(row: Tm2MandatoryCase): Tm2CaseEvidence {
  return Object.freeze({
    caseId: row.id,
    vectorId: row.vectorId,
    assertionCount: 2,
    safeEvidenceCodes: Object.freeze([
      `${row.id}:repeatable_read_snapshot_observed`,
    ]),
  });
}

function assertCondition(condition: boolean, code: string): void {
  if (!condition) {
    throw new Tm2SafeFailure(code);
  }
}

function createReaderController(): ReaderController {
  let markFirstItemsRead: (() => void) | undefined;
  let releaseReader: (() => void) | undefined;
  const firstItemsRead = new Promise<void>((resolve) => {
    markFirstItemsRead = resolve;
  });
  const continueReader = new Promise<void>((resolve) => {
    releaseReader = resolve;
  });
  return {
    beginSeen: false,
    firstItemsReadSeen: false,
    commitSeen: false,
    rollbackSeen: false,
    releaseCount: 0,
    readQueryCount: 0,
    firstItemsRead,
    continueReader,
    markFirstItemsRead(): void {
      this.firstItemsReadSeen = true;
      const callback = markFirstItemsRead;
      markFirstItemsRead = undefined;
      callback?.();
    },
    releaseReader(): void {
      const callback = releaseReader;
      releaseReader = undefined;
      callback?.();
    },
  };
}

class ReaderPool implements PostgresPoolBoundary {
  public constructor(
    private readonly delegate: PostgresPoolBoundary,
    private readonly controller: ReaderController,
    private readonly failReadOrdinal: number | undefined,
  ) {}

  public async query<Row extends Readonly<Record<string, unknown>>>(
    sql: string,
    parameters?: readonly unknown[],
  ): Promise<PostgresQueryResult<Row>> {
    return await this.delegate.query<Row>(sql, parameters);
  }

  public async connect(): Promise<PostgresClientBoundary> {
    return new ReaderClient(
      await this.delegate.connect(),
      this.controller,
      this.failReadOrdinal,
    );
  }

  public end(): Promise<void> {
    return Promise.reject(new Tm2SafeFailure('test_wrapper_does_not_own_pool'));
  }
}

class ReaderClient implements PostgresClientBoundary {
  public constructor(
    private readonly delegate: PostgresClientBoundary,
    private readonly controller: ReaderController,
    private readonly failReadOrdinal: number | undefined,
  ) {}

  public async query<Row extends Readonly<Record<string, unknown>>>(
    sql: string,
    parameters?: readonly unknown[],
  ): Promise<PostgresQueryResult<Row>> {
    const normalized = sql.trim().replaceAll(/\s+/gu, ' ').toUpperCase();
    if (normalized === 'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY') {
      this.controller.beginSeen = true;
    } else if (normalized === 'COMMIT') {
      const result = await this.delegate.query<Row>(sql, parameters);
      this.controller.commitSeen = true;
      return result;
    } else if (normalized === 'ROLLBACK') {
      const result = await this.delegate.query<Row>(sql, parameters);
      this.controller.rollbackSeen = true;
      return result;
    }
    if (/\bFROM\s+struinfo\./iu.test(sql)) {
      this.controller.readQueryCount += 1;
      if (this.controller.readQueryCount === this.failReadOrdinal) {
        throw new Error('synthetic retrieval boundary failure');
      }
    }
    const result = await this.delegate.query<Row>(sql, parameters);
    if (
      !this.controller.firstItemsReadSeen &&
      /FROM\s+struinfo\.knowledge_item\s+WHERE/iu.test(sql)
    ) {
      this.controller.markFirstItemsRead();
      await this.controller.continueReader;
    }
    return result;
  }

  public async executeSimple<Row extends Readonly<Record<string, unknown>>>(
    statement: string,
    parameters: readonly unknown[],
  ): Promise<PostgresQueryResult<Row>> {
    return await this.delegate.executeSimple<Row>(statement, parameters);
  }

  public release(): void {
    this.controller.releaseCount += 1;
    this.delegate.release();
  }
}

function knowledgeContext(key: string) {
  return {
    effectiveWorkspaceId: WORKSPACE_ID,
    commandIdempotencyKey: key,
    authority: 'manual_user',
  } as const;
}

function itemRequest(expectedRevision: number, title: string) {
  return {
    authorization: {kind: 'manual_edit' as const},
    operations: [
      {
        kind: 'put_item' as const,
        itemId: ITEM_ID,
        expectedRevision,
        value: {
          knowledgeKind: 'concept' as const,
          epistemicRole: 'user_assertion' as const,
          reviewState: 'confirmed' as const,
          title,
        },
        provenance: {
          citations: [],
          fragmentDerivations: [],
          knowledgeDerivations: [],
        },
      },
    ],
  };
}

function browseRequest() {
  return {
    filters: {
      knowledgeKinds: [],
      epistemicRoles: [],
      reviewStates: [],
      source: {kind: 'any' as const},
      relation: {kind: 'any' as const},
    },
    page: {limit: 100},
  };
}

function searchContext() {
  return {
    effectiveWorkspaceId: WORKSPACE_ID,
    authority: 'manual_user',
  } as const;
}

function searchItem(result: DeterministicKnowledgeSearchResult) {
  return result.status === 'ok' ? result.items[0] : undefined;
}

async function buildObservation(
  runtime: BoundPostgresTm2Runtime,
): Promise<SnapshotObservation> {
  await runtime.prepare();
  await runtime.queryAdmin(
    `INSERT INTO struinfo.workspace (workspace_id)
     VALUES ($1)
     ON CONFLICT (workspace_id) DO NOTHING`,
    [WORKSPACE_ID],
  );
  const seed = await executeApplyManualKnowledgeChangeSet(
    runtime.repositories.knowledge,
    knowledgeContext('tm2-rr-seed'),
    itemRequest(0, '合成快照旧值'),
  );
  assertCondition(seed.status === 'applied', 'rr_seed_failed');

  const reader = createReaderController();
  const readerRepositories = createPostgresKnowledgeRepositories(
    new ReaderPool(runtime.runtimePool, reader, undefined),
  );
  const readerPromise = executeDeterministicKnowledgeSearch(
    readerRepositories.retrieval,
    searchContext(),
    browseRequest(),
  );
  await withTm2Deadline(reader.firstItemsRead, DEADLINE_MILLISECONDS);
  let writer;
  try {
    writer = await withTm2Deadline(
      executeApplyManualKnowledgeChangeSet(
        runtime.repositories.knowledge,
        knowledgeContext('tm2-rr-writer'),
        itemRequest(1, '合成快照新值'),
      ),
      DEADLINE_MILLISECONDS,
    );
  } finally {
    reader.releaseReader();
  }
  const during = await withTm2Deadline(readerPromise, DEADLINE_MILLISECONDS);
  const after = await executeDeterministicKnowledgeSearch(
    runtime.repositories.retrieval,
    searchContext(),
    browseRequest(),
  );

  const failing = createReaderController();
  failing.releaseReader();
  const failingRepositories = createPostgresKnowledgeRepositories(
    new ReaderPool(runtime.runtimePool, failing, 3),
  );
  const failed = await executeDeterministicKnowledgeSearch(
    failingRepositories.retrieval,
    searchContext(),
    browseRequest(),
  );
  const persisted = await runtime.queryAdmin<
    QueryResultRow & {readonly current_revision: number}
  >(
    `SELECT current_revision
       FROM struinfo.knowledge_item
      WHERE workspace_id = $1 AND item_id = $2`,
    [WORKSPACE_ID, ITEM_ID],
  );

  const duringItem = searchItem(during);
  const afterItem = searchItem(after);
  return Object.freeze({
    conditions: Object.freeze([
      reader.beginSeen,
      reader.firstItemsReadSeen,
      writer.status === 'applied' && persisted[0]?.current_revision === 2,
      during.status === 'ok' &&
        duringItem?.revision === 1 &&
        duringItem.value.title === '合成快照旧值' &&
        after.status === 'ok' &&
        afterItem?.revision === 2 &&
        afterItem.value.title === '合成快照新值',
      reader.commitSeen && during.status === 'ok',
      reader.releaseCount === 1,
      failed.status === 'failed' &&
        failed.issue.code === 'repository_failed' &&
        failing.rollbackSeen &&
        failing.releaseCount === 1,
      reader.readQueryCount === 5 &&
        failing.readQueryCount === 3 &&
        !reader.rollbackSeen,
    ]),
  });
}

async function observationFor(
  runtime: BoundPostgresTm2Runtime,
): Promise<SnapshotObservation> {
  let observation = observations.get(runtime);
  if (observation === undefined) {
    observation = buildObservation(runtime);
    observations.set(runtime, observation);
  }
  return await observation;
}

export async function executeRetrievalSnapshotCase(
  row: Tm2MandatoryCase,
  runtime: BoundPostgresTm2Runtime,
): Promise<Tm2CaseEvidence> {
  const observation = await observationFor(runtime);
  assertCondition(
    observation.conditions[row.number - 441] === true,
    `${row.id}:repeatable_read_snapshot_failed`,
  );
  return evidence(row);
}
