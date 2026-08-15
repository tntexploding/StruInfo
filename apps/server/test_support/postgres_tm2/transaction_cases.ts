import {setImmediate as waitForNextTurn} from 'node:timers/promises';

import type {QueryResultRow} from 'pg';

import {
  executePutContentClassificationTerm,
  type PutContentClassificationTermResult,
} from '../../src/modules/curation/index.js';
import {
  executeApplyManualKnowledgeChangeSet,
  type ApplyManualKnowledgeChangeSetResult,
} from '../../src/modules/knowledge/index.js';
import {
  createPostgresKnowledgeRepositories,
  type PostgresClientBoundary,
  type PostgresPoolBoundary,
  type PostgresQueryResult,
} from '../../src/platform/database/postgresql/index.js';

import {
  isLockBlockedObservation,
  withTm2Deadline,
} from './concurrency_oracle.js';
import type {Tm2MandatoryCase} from './mandatory_ledger.js';
import type {Tm2CaseEvidence} from './public_facade.js';
import {TM2_FIXED_ROLE_NAMES, Tm2SafeFailure} from './bound_runtime.js';
import type {BoundPostgresTm2Runtime} from './bound_runtime.js';

const DEADLINE_MILLISECONDS = 10_000;
const SYNTHETIC = Object.freeze({
  rollbackEarlyWorkspace: '33333333-3333-4333-8333-333333333361',
  rollbackCasWorkspace: '33333333-3333-4333-8333-333333333362',
  rollbackCallbackWorkspace: '33333333-3333-4333-8333-333333333363',
  rollbackConstraintWorkspace: '33333333-3333-4333-8333-333333333364',
  equalWorkspace: '33333333-3333-4333-8333-333333333377',
  conflictWorkspace: '33333333-3333-4333-8333-333333333378',
  casWorkspace: '33333333-3333-4333-8333-333333333379',
  hierarchyWorkspace: '33333333-3333-4333-8333-333333333393',
  earlyTerm: '44444444-4444-4444-8444-444444444361',
  casTerm: '44444444-4444-4444-8444-444444444362',
  constraintTerm: '44444444-4444-4444-8444-444444444364',
  equalTerm: '44444444-4444-4444-8444-444444444377',
  conflictTerm: '44444444-4444-4444-8444-444444444378',
  concurrentCasTerm: '44444444-4444-4444-8444-444444444379',
  hierarchyTermA: '44444444-4444-4444-8444-444444444393',
  hierarchyTermB: '44444444-4444-4444-8444-444444444394',
  callbackItem: '55555555-5555-4555-8555-555555555363',
});

type CurationResult = PutContentClassificationTermResult;
type KnowledgeResult = ApplyManualKnowledgeChangeSetResult;

type FaultMode =
  | 'throw_first_mutation'
  | 'zero_first_update'
  | 'throw_second_mutation'
  | 'corrupt_first_mutation';

interface FaultController {
  readonly mode: FaultMode;
  mutationCount: number;
  releaseCount: number;
  triggered: boolean;
}

interface LockController {
  claimed: boolean;
  releaseCount: number;
  readonly acquired: Promise<void>;
  readonly released: Promise<void>;
  markAcquired(): void;
  releaseHolder(): void;
}

interface RollbackObservation {
  readonly conditions: readonly boolean[];
}

interface ConcurrencyObservation {
  readonly conditions: readonly boolean[];
}

interface HierarchyObservation {
  readonly conditions: readonly boolean[];
}

const rollbackObservations = new WeakMap<
  BoundPostgresTm2Runtime,
  Promise<RollbackObservation>
>();
const concurrencyObservations = new WeakMap<
  BoundPostgresTm2Runtime,
  Promise<ConcurrencyObservation>
>();
const hierarchyObservations = new WeakMap<
  BoundPostgresTm2Runtime,
  Promise<HierarchyObservation>
>();

function evidence(
  row: Tm2MandatoryCase,
  assertionCount: number,
  suffix: string,
): Tm2CaseEvidence {
  return Object.freeze({
    caseId: row.id,
    vectorId: row.vectorId,
    assertionCount,
    safeEvidenceCodes: Object.freeze([`${row.id}:${suffix}`]),
  });
}

function assertCondition(condition: boolean, code: string): void {
  if (!condition) {
    throw new Tm2SafeFailure(code);
  }
}

function curationContext(workspaceId: string, key: string) {
  return {
    effectiveWorkspaceId: workspaceId,
    commandIdempotencyKey: key,
    authority: 'manual_user',
  } as const;
}

function termRequest(
  termId: string,
  expectedRevision: number,
  displayName: string,
  parentTermId?: string,
) {
  return {
    termId,
    expectedRevision,
    value: {
      displayName,
      lifecycle: 'active' as const,
      ...(parentTermId === undefined ? {} : {parentTermId}),
    },
  };
}

function knowledgeContext(workspaceId: string, key: string) {
  return {
    effectiveWorkspaceId: workspaceId,
    commandIdempotencyKey: key,
    authority: 'manual_user',
  } as const;
}

function itemRequest(itemId: string) {
  return {
    authorization: {kind: 'manual_edit' as const},
    operations: [
      {
        kind: 'put_item' as const,
        itemId,
        expectedRevision: 0,
        value: {
          knowledgeKind: 'concept' as const,
          epistemicRole: 'user_assertion' as const,
          reviewState: 'confirmed' as const,
          title: '合成回滚项',
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

function isPersistenceFailure(
  result: CurationResult | KnowledgeResult,
): boolean {
  return (
    result.status === 'rejected' &&
    result.issue.code === 'persistence_failed' &&
    result.issue.path === 'persistence'
  );
}

function rejectedCode(result: CurationResult): string | undefined {
  return result.status === 'rejected' ? result.issue.code : undefined;
}

function outcomeMultiset(
  results: readonly CurationResult[],
): readonly string[] {
  return Object.freeze(
    results
      .map((result) =>
        result.status === 'rejected'
          ? `rejected:${result.issue.code}`
          : result.status,
      )
      .sort(),
  );
}

async function ensureWorkspace(
  runtime: BoundPostgresTm2Runtime,
  workspaceId: string,
): Promise<void> {
  await runtime.queryAdmin(
    `INSERT INTO struinfo.workspace (workspace_id)
     VALUES ($1)
     ON CONFLICT (workspace_id) DO NOTHING`,
    [workspaceId],
  );
}

async function countRows(
  runtime: BoundPostgresTm2Runtime,
  table: string,
  workspaceId: string,
): Promise<number> {
  if (!/^[a-z_]+$/u.test(table)) {
    throw new Tm2SafeFailure('test_table_name_invalid');
  }
  const rows = await runtime.queryAdmin<
    QueryResultRow & {readonly count: string}
  >(
    `SELECT count(*)::text AS count
       FROM struinfo.${table}
      WHERE workspace_id = $1`,
    [workspaceId],
  );
  const count = Number(rows[0]?.count);
  if (!Number.isSafeInteger(count) || count < 0) {
    throw new Tm2SafeFailure('test_count_invalid');
  }
  return count;
}

class FaultInjectingPool implements PostgresPoolBoundary {
  public constructor(
    private readonly delegate: PostgresPoolBoundary,
    private readonly controller: FaultController,
  ) {}

  public async query<Row extends Readonly<Record<string, unknown>>>(
    sql: string,
    parameters?: readonly unknown[],
  ): Promise<PostgresQueryResult<Row>> {
    return await this.delegate.query<Row>(sql, parameters);
  }

  public async connect(): Promise<PostgresClientBoundary> {
    return new FaultInjectingClient(
      await this.delegate.connect(),
      this.controller,
    );
  }

  public end(): Promise<void> {
    return Promise.reject(new Tm2SafeFailure('test_wrapper_does_not_own_pool'));
  }
}

class FaultInjectingClient implements PostgresClientBoundary {
  public constructor(
    private readonly delegate: PostgresClientBoundary,
    private readonly controller: FaultController,
  ) {}

  public async query<Row extends Readonly<Record<string, unknown>>>(
    sql: string,
    parameters?: readonly unknown[],
  ): Promise<PostgresQueryResult<Row>> {
    return await this.delegate.query<Row>(sql, parameters);
  }

  public async executeSimple<Row extends Readonly<Record<string, unknown>>>(
    statement: string,
    parameters: readonly unknown[],
  ): Promise<PostgresQueryResult<Row>> {
    this.controller.mutationCount += 1;
    const ordinal = this.controller.mutationCount;
    if (
      !this.controller.triggered &&
      ((this.controller.mode === 'throw_first_mutation' && ordinal === 1) ||
        (this.controller.mode === 'throw_second_mutation' && ordinal === 2))
    ) {
      this.controller.triggered = true;
      throw new Error('synthetic persistence boundary failure');
    }
    if (
      !this.controller.triggered &&
      this.controller.mode === 'zero_first_update' &&
      /^\s*UPDATE\b/iu.test(statement)
    ) {
      this.controller.triggered = true;
      return {rows: [], rowCount: 0};
    }
    if (
      !this.controller.triggered &&
      this.controller.mode === 'corrupt_first_mutation' &&
      ordinal === 1
    ) {
      this.controller.triggered = true;
      return await this.delegate.executeSimple<Row>(statement, [
        'synthetic-invalid-uuid',
        ...parameters.slice(1),
      ]);
    }
    return await this.delegate.executeSimple<Row>(statement, parameters);
  }

  public release(): void {
    this.controller.releaseCount += 1;
    this.delegate.release();
  }
}

function createLockController(): LockController {
  let markAcquired: (() => void) | undefined;
  let releaseHolder: (() => void) | undefined;
  const acquired = new Promise<void>((resolve) => {
    markAcquired = resolve;
  });
  const released = new Promise<void>((resolve) => {
    releaseHolder = resolve;
  });
  return {
    claimed: false,
    releaseCount: 0,
    acquired,
    released,
    markAcquired(): void {
      const callback = markAcquired;
      markAcquired = undefined;
      callback?.();
    },
    releaseHolder(): void {
      const callback = releaseHolder;
      releaseHolder = undefined;
      callback?.();
    },
  };
}

class LockObservingPool implements PostgresPoolBoundary {
  public constructor(
    private readonly delegate: PostgresPoolBoundary,
    private readonly controller: LockController,
  ) {}

  public async query<Row extends Readonly<Record<string, unknown>>>(
    sql: string,
    parameters?: readonly unknown[],
  ): Promise<PostgresQueryResult<Row>> {
    return await this.delegate.query<Row>(sql, parameters);
  }

  public async connect(): Promise<PostgresClientBoundary> {
    return new LockObservingClient(
      await this.delegate.connect(),
      this.controller,
    );
  }

  public end(): Promise<void> {
    return Promise.reject(new Tm2SafeFailure('test_wrapper_does_not_own_pool'));
  }
}

class LockObservingClient implements PostgresClientBoundary {
  public constructor(
    private readonly delegate: PostgresClientBoundary,
    private readonly controller: LockController,
  ) {}

  public async query<Row extends Readonly<Record<string, unknown>>>(
    sql: string,
    parameters?: readonly unknown[],
  ): Promise<PostgresQueryResult<Row>> {
    const result = await this.delegate.query<Row>(sql, parameters);
    if (
      !this.controller.claimed &&
      /\bpg_advisory_xact_lock\s*\(/iu.test(sql)
    ) {
      this.controller.claimed = true;
      this.controller.markAcquired();
      await this.controller.released;
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

async function observeBlockedWorkspaceLock(
  runtime: BoundPostgresTm2Runtime,
): Promise<boolean> {
  return await withTm2Deadline(
    (async () => {
      for (;;) {
        const rows = await runtime.queryAdmin<
          QueryResultRow & {
            readonly application_name: string;
            readonly wait_event_type: string | null;
            readonly wait_event: string | null;
          }
        >(
          `SELECT application_name, wait_event_type, wait_event
             FROM pg_catalog.pg_stat_activity
            WHERE datname = current_database()
              AND usename = $1
              AND query ~ 'pg_advisory_xact_lock'
              AND wait_event_type = 'Lock'`,
          [TM2_FIXED_ROLE_NAMES.runtime],
        );
        if (
          rows.some(
            (row) =>
              row.wait_event_type !== null &&
              row.wait_event !== null &&
              isLockBlockedObservation({
                applicationName: row.application_name,
                waitEventType: row.wait_event_type,
                waitEvent: row.wait_event,
                transactionId: undefined,
              }),
          )
        ) {
          return true;
        }
        await waitForNextTurn();
      }
    })(),
    DEADLINE_MILLISECONDS,
  );
}

async function runLockedPair(
  runtime: BoundPostgresTm2Runtime,
  first: (
    repository: ReturnType<typeof createPostgresKnowledgeRepositories>,
  ) => Promise<CurationResult>,
  second: (
    repository: ReturnType<typeof createPostgresKnowledgeRepositories>,
  ) => Promise<CurationResult>,
): Promise<{
  readonly results: readonly CurationResult[];
  readonly blocked: boolean;
  readonly releaseCount: number;
}> {
  const controller = createLockController();
  const repositories = createPostgresKnowledgeRepositories(
    new LockObservingPool(runtime.runtimePool, controller),
  );
  const firstPromise = first(repositories);
  await withTm2Deadline(controller.acquired, DEADLINE_MILLISECONDS);
  const secondPromise = second(repositories);
  let blocked: boolean;
  try {
    blocked = await observeBlockedWorkspaceLock(runtime);
  } finally {
    controller.releaseHolder();
  }
  const results = await withTm2Deadline(
    Promise.all([firstPromise, secondPromise]),
    DEADLINE_MILLISECONDS,
  );
  return Object.freeze({
    results: Object.freeze(results),
    blocked,
    releaseCount: controller.releaseCount,
  });
}

async function runFaultCuration(
  runtime: BoundPostgresTm2Runtime,
  mode: FaultMode,
  workspaceId: string,
  key: string,
  request: ReturnType<typeof termRequest>,
): Promise<{
  readonly result: CurationResult;
  readonly control: FaultController;
}> {
  const control: FaultController = {
    mode,
    mutationCount: 0,
    releaseCount: 0,
    triggered: false,
  };
  const repositories = createPostgresKnowledgeRepositories(
    new FaultInjectingPool(runtime.runtimePool, control),
  );
  const result = await executePutContentClassificationTerm(
    repositories.curation,
    curationContext(workspaceId, key),
    request,
  );
  return {result, control};
}

async function buildRollbackObservation(
  runtime: BoundPostgresTm2Runtime,
): Promise<RollbackObservation> {
  await runtime.prepare();
  for (const workspaceId of [
    SYNTHETIC.rollbackEarlyWorkspace,
    SYNTHETIC.rollbackCasWorkspace,
    SYNTHETIC.rollbackCallbackWorkspace,
    SYNTHETIC.rollbackConstraintWorkspace,
  ]) {
    await ensureWorkspace(runtime, workspaceId);
  }

  const early = await runFaultCuration(
    runtime,
    'throw_first_mutation',
    SYNTHETIC.rollbackEarlyWorkspace,
    'tm2-rollback-early',
    termRequest(SYNTHETIC.earlyTerm, 0, '合成早期回滚'),
  );

  const casSeed = await executePutContentClassificationTerm(
    runtime.repositories.curation,
    curationContext(SYNTHETIC.rollbackCasWorkspace, 'tm2-cas-seed'),
    termRequest(SYNTHETIC.casTerm, 0, '合成 CAS 初始'),
  );
  assertCondition(casSeed.status === 'applied', 'rollback_cas_seed_failed');
  const cas = await runFaultCuration(
    runtime,
    'zero_first_update',
    SYNTHETIC.rollbackCasWorkspace,
    'tm2-cas-zero-row',
    termRequest(SYNTHETIC.casTerm, 1, '合成 CAS 修订'),
  );

  const callbackControl: FaultController = {
    mode: 'throw_second_mutation',
    mutationCount: 0,
    releaseCount: 0,
    triggered: false,
  };
  const callbackRepositories = createPostgresKnowledgeRepositories(
    new FaultInjectingPool(runtime.runtimePool, callbackControl),
  );
  const callback = await executeApplyManualKnowledgeChangeSet(
    callbackRepositories.knowledge,
    knowledgeContext(
      SYNTHETIC.rollbackCallbackWorkspace,
      'tm2-rollback-callback',
    ),
    itemRequest(SYNTHETIC.callbackItem),
  );

  const constraint = await runFaultCuration(
    runtime,
    'corrupt_first_mutation',
    SYNTHETIC.rollbackConstraintWorkspace,
    'tm2-rollback-constraint',
    termRequest(SYNTHETIC.constraintTerm, 0, '合成约束回滚'),
  );

  const conditions = Object.freeze([
    isPersistenceFailure(early.result),
    early.control.triggered && early.control.mutationCount === 1,
    early.control.releaseCount === 1,
    (await countRows(
      runtime,
      'vocabulary_term',
      SYNTHETIC.rollbackEarlyWorkspace,
    )) === 0,
    isPersistenceFailure(cas.result),
    cas.control.triggered && cas.control.releaseCount === 1,
    (await countRows(
      runtime,
      'vocabulary_term_revision',
      SYNTHETIC.rollbackCasWorkspace,
    )) === 1,
    (await countRows(
      runtime,
      'curation_command',
      SYNTHETIC.rollbackCasWorkspace,
    )) === 1,
    isPersistenceFailure(callback),
    callbackControl.triggered && callbackControl.releaseCount === 1,
    (await countRows(
      runtime,
      'knowledge_item',
      SYNTHETIC.rollbackCallbackWorkspace,
    )) === 0,
    (await countRows(
      runtime,
      'knowledge_change_event',
      SYNTHETIC.rollbackCallbackWorkspace,
    )) === 0,
    isPersistenceFailure(constraint.result),
    constraint.control.triggered && constraint.control.releaseCount === 1,
    (await countRows(
      runtime,
      'vocabulary_term',
      SYNTHETIC.rollbackConstraintWorkspace,
    )) === 0,
    (await countRows(
      runtime,
      'curation_command',
      SYNTHETIC.rollbackConstraintWorkspace,
    )) === 0,
  ]);
  return Object.freeze({conditions});
}

async function rollbackObservationFor(
  runtime: BoundPostgresTm2Runtime,
): Promise<RollbackObservation> {
  let observation = rollbackObservations.get(runtime);
  if (observation === undefined) {
    observation = buildRollbackObservation(runtime);
    rollbackObservations.set(runtime, observation);
  }
  return await observation;
}

async function buildConcurrencyObservation(
  runtime: BoundPostgresTm2Runtime,
): Promise<ConcurrencyObservation> {
  await runtime.prepare();
  for (const workspaceId of [
    SYNTHETIC.equalWorkspace,
    SYNTHETIC.conflictWorkspace,
    SYNTHETIC.casWorkspace,
  ]) {
    await ensureWorkspace(runtime, workspaceId);
  }

  const equalRequest = termRequest(SYNTHETIC.equalTerm, 0, '合成同键相等');
  const equal = await runLockedPair(
    runtime,
    async (repositories) =>
      await executePutContentClassificationTerm(
        repositories.curation,
        curationContext(SYNTHETIC.equalWorkspace, 'tm2-concurrent-equal'),
        equalRequest,
      ),
    async (repositories) =>
      await executePutContentClassificationTerm(
        repositories.curation,
        curationContext(SYNTHETIC.equalWorkspace, 'tm2-concurrent-equal'),
        equalRequest,
      ),
  );

  const conflict = await runLockedPair(
    runtime,
    async (repositories) =>
      await executePutContentClassificationTerm(
        repositories.curation,
        curationContext(SYNTHETIC.conflictWorkspace, 'tm2-concurrent-conflict'),
        termRequest(SYNTHETIC.conflictTerm, 0, '合成同键载荷 A'),
      ),
    async (repositories) =>
      await executePutContentClassificationTerm(
        repositories.curation,
        curationContext(SYNTHETIC.conflictWorkspace, 'tm2-concurrent-conflict'),
        termRequest(SYNTHETIC.conflictTerm, 0, '合成同键载荷 B'),
      ),
  );

  const casSeed = await executePutContentClassificationTerm(
    runtime.repositories.curation,
    curationContext(SYNTHETIC.casWorkspace, 'tm2-concurrent-cas-seed'),
    termRequest(SYNTHETIC.concurrentCasTerm, 0, '合成 CAS 并发初始'),
  );
  assertCondition(casSeed.status === 'applied', 'concurrent_cas_seed_failed');
  const cas = await runLockedPair(
    runtime,
    async (repositories) =>
      await executePutContentClassificationTerm(
        repositories.curation,
        curationContext(SYNTHETIC.casWorkspace, 'tm2-concurrent-cas-a'),
        termRequest(SYNTHETIC.concurrentCasTerm, 1, '合成 CAS 并发 A'),
      ),
    async (repositories) =>
      await executePutContentClassificationTerm(
        repositories.curation,
        curationContext(SYNTHETIC.casWorkspace, 'tm2-concurrent-cas-b'),
        termRequest(SYNTHETIC.concurrentCasTerm, 1, '合成 CAS 并发 B'),
      ),
  );

  const equalOutcomes = outcomeMultiset(equal.results);
  const conflictOutcomes = outcomeMultiset(conflict.results);
  const casOutcomes = outcomeMultiset(cas.results);
  return Object.freeze({
    conditions: Object.freeze([
      equal.blocked,
      JSON.stringify(equalOutcomes) === JSON.stringify(['applied', 'replayed']),
      equal.releaseCount === 2,
      (await countRows(
        runtime,
        'vocabulary_term',
        SYNTHETIC.equalWorkspace,
      )) === 1,
      (await countRows(
        runtime,
        'curation_command',
        SYNTHETIC.equalWorkspace,
      )) === 1,
      conflict.blocked,
      JSON.stringify(conflictOutcomes) ===
        JSON.stringify(['applied', 'rejected:idempotency_conflict']),
      conflict.releaseCount === 2,
      (await countRows(
        runtime,
        'vocabulary_term_revision',
        SYNTHETIC.conflictWorkspace,
      )) === 1,
      (await countRows(
        runtime,
        'curation_command',
        SYNTHETIC.conflictWorkspace,
      )) === 1,
      cas.blocked,
      JSON.stringify(casOutcomes) ===
        JSON.stringify(['applied', 'rejected:stale_revision']),
      cas.releaseCount === 2,
      (await countRows(
        runtime,
        'vocabulary_term_revision',
        SYNTHETIC.casWorkspace,
      )) === 2,
      (await countRows(runtime, 'curation_command', SYNTHETIC.casWorkspace)) ===
        2,
      (await countRows(runtime, 'vocabulary_term', SYNTHETIC.casWorkspace)) ===
        1,
    ]),
  });
}

async function concurrencyObservationFor(
  runtime: BoundPostgresTm2Runtime,
): Promise<ConcurrencyObservation> {
  let observation = concurrencyObservations.get(runtime);
  if (observation === undefined) {
    observation = buildConcurrencyObservation(runtime);
    concurrencyObservations.set(runtime, observation);
  }
  return await observation;
}

async function buildHierarchyObservation(
  runtime: BoundPostgresTm2Runtime,
): Promise<HierarchyObservation> {
  await runtime.prepare();
  await ensureWorkspace(runtime, SYNTHETIC.hierarchyWorkspace);
  const seedA = await executePutContentClassificationTerm(
    runtime.repositories.curation,
    curationContext(SYNTHETIC.hierarchyWorkspace, 'tm2-hierarchy-seed-a'),
    termRequest(SYNTHETIC.hierarchyTermA, 0, '合成层级 A'),
  );
  const seedB = await executePutContentClassificationTerm(
    runtime.repositories.curation,
    curationContext(SYNTHETIC.hierarchyWorkspace, 'tm2-hierarchy-seed-b'),
    termRequest(SYNTHETIC.hierarchyTermB, 0, '合成层级 B'),
  );
  assertCondition(
    seedA.status === 'applied' && seedB.status === 'applied',
    'hierarchy_seed_failed',
  );
  const pair = await runLockedPair(
    runtime,
    async (repositories) =>
      await executePutContentClassificationTerm(
        repositories.curation,
        curationContext(SYNTHETIC.hierarchyWorkspace, 'tm2-hierarchy-a-b'),
        termRequest(
          SYNTHETIC.hierarchyTermA,
          1,
          '合成层级 A',
          SYNTHETIC.hierarchyTermB,
        ),
      ),
    async (repositories) =>
      await executePutContentClassificationTerm(
        repositories.curation,
        curationContext(SYNTHETIC.hierarchyWorkspace, 'tm2-hierarchy-b-a'),
        termRequest(
          SYNTHETIC.hierarchyTermB,
          1,
          '合成层级 B',
          SYNTHETIC.hierarchyTermA,
        ),
      ),
  );
  const outcomes = outcomeMultiset(pair.results);
  const currentParents = await runtime.queryAdmin<
    QueryResultRow & {
      readonly term_id: string;
      readonly parent_term_id: string | null;
    }
  >(
    `SELECT t.term_id::text, r.parent_term_id::text
       FROM struinfo.vocabulary_term t
       JOIN struinfo.vocabulary_term_revision r
         ON r.workspace_id = t.workspace_id
        AND r.term_id = t.term_id
        AND r.revision_number = t.current_revision
        AND r.term_revision_id = t.current_term_revision_id
      WHERE t.workspace_id = $1
      ORDER BY t.term_id`,
    [SYNTHETIC.hierarchyWorkspace],
  );
  const byId = new Map(
    currentParents.map((entry) => [entry.term_id, entry.parent_term_id]),
  );
  const noCycle = !(
    byId.get(SYNTHETIC.hierarchyTermA) === SYNTHETIC.hierarchyTermB &&
    byId.get(SYNTHETIC.hierarchyTermB) === SYNTHETIC.hierarchyTermA
  );
  return Object.freeze({
    conditions: Object.freeze([
      seedA.status === 'applied',
      seedB.status === 'applied',
      pair.blocked,
      JSON.stringify(outcomes) ===
        JSON.stringify(['applied', 'rejected:hierarchy_cycle']),
      pair.results.filter((result) => result.status === 'applied').length === 1,
      pair.results.filter(
        (result) => rejectedCode(result) === 'hierarchy_cycle',
      ).length === 1,
      pair.releaseCount === 2,
      currentParents.length === 2,
      noCycle,
      (await countRows(
        runtime,
        'vocabulary_term_revision',
        SYNTHETIC.hierarchyWorkspace,
      )) === 3,
    ]),
  });
}

async function hierarchyObservationFor(
  runtime: BoundPostgresTm2Runtime,
): Promise<HierarchyObservation> {
  let observation = hierarchyObservations.get(runtime);
  if (observation === undefined) {
    observation = buildHierarchyObservation(runtime);
    hierarchyObservations.set(runtime, observation);
  }
  return await observation;
}

export async function executeAdvancedTransactionCase(
  row: Tm2MandatoryCase,
  runtime: BoundPostgresTm2Runtime,
): Promise<Tm2CaseEvidence> {
  if (row.number <= 376) {
    const observation = await rollbackObservationFor(runtime);
    assertCondition(
      observation.conditions[row.number - 361] === true,
      `${row.id}:rollback_observation_failed`,
    );
    return evidence(row, 2, 'rollback_observed');
  }
  if (row.number <= 392) {
    const observation = await concurrencyObservationFor(runtime);
    assertCondition(
      observation.conditions[row.number - 377] === true,
      `${row.id}:command_concurrency_failed`,
    );
    return evidence(row, 2, 'command_concurrency_observed');
  }
  const observation = await hierarchyObservationFor(runtime);
  assertCondition(
    observation.conditions[row.number - 393] === true,
    `${row.id}:hierarchy_concurrency_failed`,
  );
  return evidence(row, 2, 'hierarchy_concurrency_observed');
}
