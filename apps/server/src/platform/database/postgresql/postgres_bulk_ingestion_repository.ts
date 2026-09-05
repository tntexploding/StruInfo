import {
  BULK_INGESTION_BATCH_STATUSES,
  BULK_INGESTION_ITEM_STATUSES,
  BULK_INGESTION_MAXIMUM_ENTRIES,
  BULK_INGESTION_MAXIMUM_SNAPSHOTS,
  PROCESSING_PRIVACY_SCOPES,
  type BulkIngestionBatch,
  type BulkIngestionBatchInitialize,
  type BulkIngestionBeginOutcome,
  type BulkIngestionClaimResult,
  type BulkIngestionInitializeOutcome,
  type BulkIngestionItem,
  type BulkIngestionPauseOutcome,
  type BulkIngestionRepositoryPort,
  type BulkIngestionSettleOutcome,
  type BulkIngestionSnapshotCandidate,
  type ProcessingPrivacyScope,
} from '../../../modules/processing/index.js';

import type {
  PostgresClientBoundary,
  PostgresPoolBoundary,
} from './postgres_pool.js';
import {runPostgresTransaction} from './postgres_transaction.js';
import {
  canonicalUuid,
  enumValue,
  expectOneAffected,
  integer,
  optionalText,
  PostgresAdapterError,
  sha256,
  text,
} from './postgres_values.js';
import {acquireWorkspaceWriteLock} from './workspace_write_lock.js';

function sql(...lines: readonly string[]): string {
  return lines.join(String.fromCharCode(10));
}

export const LIST_BULK_INGESTION_CANDIDATES_SQL = sql(
  'SELECT s.workspace_id::text, s.snapshot_id::text,',
  '  s.canonical_content_sha256, r.is_private,',
  '  count(f.fragment_id)::integer AS planned_entry_count',
  'FROM struinfo.snapshot AS s',
  'JOIN struinfo.resource AS r',
  '  ON r.workspace_id = s.workspace_id AND r.resource_id = s.resource_id',
  'JOIN LATERAL (',
  '  SELECT structure_id',
  '  FROM struinfo.document_structure',
  '  WHERE workspace_id = s.workspace_id AND snapshot_id = s.snapshot_id',
  '  ORDER BY structure_id',
  '  LIMIT 1',
  ') AS first_structure ON true',
  'JOIN struinfo.fragment AS f',
  '  ON f.workspace_id = s.workspace_id',
  ' AND f.snapshot_id = s.snapshot_id',
  ' AND f.structure_id = first_structure.structure_id',
  'JOIN struinfo.document_node AS n',
  '  ON n.workspace_id = f.workspace_id',
  ' AND n.resource_id = f.resource_id',
  ' AND n.snapshot_id = f.snapshot_id',
  ' AND n.structure_id = f.structure_id',
  ' AND n.node_id = f.node_id',
  'WHERE s.workspace_id = $1',
  "  AND ($2 = 'include_private'",
  "    OR ($2 = 'public_only' AND NOT r.is_private)",
  "    OR ($2 = 'private_only' AND r.is_private))",
  "  AND n.node_kind = 'section'",
  '  AND NOT EXISTS (',
  '    SELECT 1 FROM struinfo.information_entry AS entry',
  '    WHERE entry.workspace_id = s.workspace_id',
  '      AND entry.snapshot_id = s.snapshot_id',
  '      AND entry.is_current_structure',
  '  )',
  'GROUP BY s.workspace_id, s.snapshot_id, s.canonical_content_sha256,',
  '  r.is_private, s.captured_at',
  'HAVING count(f.fragment_id) > 0',
  'ORDER BY s.captured_at, s.snapshot_id',
  'LIMIT $3',
);

const READ_BATCH_SQL = sql(
  'SELECT workspace_id::text, batch_id::text, idempotency_key,',
  '  request_sha256, plan_sha256, privacy_scope, status, active_run_id::text,',
  '  attempt, snapshot_count, planned_entry_count, succeeded_snapshot_count,',
  '  succeeded_entry_count, failed_snapshot_count,',
  '  current_version::integer AS current_version,',
  '  created_at, started_at, finished_at, updated_at',
  'FROM struinfo.processing_bulk_ingestion_batch',
  'WHERE workspace_id = $1 AND batch_id = $2',
);
const READ_BATCH_ITEMS_SQL = sql(
  'SELECT workspace_id::text, batch_id::text, item_ordinal, snapshot_id::text,',
  '  canonical_content_sha256, is_private, planned_entry_count, status,',
  '  attempt, claimed_run_id::text, result_entry_count, error_code,',
  '  current_version::integer AS current_version',
  'FROM struinfo.processing_bulk_ingestion_item',
  'WHERE workspace_id = $1 AND batch_id = $2',
  'ORDER BY item_ordinal',
);
const LOCK_BATCH_SQL = `${READ_BATCH_SQL}\nFOR UPDATE`;
const READ_BATCH_BY_KEY_SQL = sql(
  'SELECT batch_id::text, request_sha256, plan_sha256, privacy_scope,',
  '  snapshot_count, planned_entry_count',
  'FROM struinfo.processing_bulk_ingestion_batch',
  'WHERE workspace_id = $1 AND idempotency_key = $2',
  'FOR UPDATE',
);
const INSERT_BATCH_SQL = sql(
  'INSERT INTO struinfo.processing_bulk_ingestion_batch (',
  '  workspace_id, batch_id, idempotency_key, request_sha256, plan_sha256,',
  '  privacy_scope, snapshot_count, planned_entry_count',
  ') VALUES ($1, $2, $3, $4, $5, $6, $7, $8)',
);
const INSERT_ITEM_SQL = sql(
  'INSERT INTO struinfo.processing_bulk_ingestion_item (',
  '  workspace_id, batch_id, item_ordinal, snapshot_id,',
  '  canonical_content_sha256, is_private, planned_entry_count',
  ') VALUES ($1, $2, $3, $4, $5, $6, $7)',
);
const FAIL_ACTIVE_RUN_SQL = sql(
  'UPDATE struinfo.processing_run SET',
  "  status = 'failed', error_code = 'bulk_executor_recovered',",
  "  current_step = '批次执行器被恢复操作取代',",
  '  current_version = current_version + 1, finished_at = CURRENT_TIMESTAMP,',
  '  updated_at = CURRENT_TIMESTAMP',
  "WHERE workspace_id = $1 AND run_id = $2 AND status = 'running'",
);
const RESET_RETRY_ITEMS_SQL = sql(
  'UPDATE struinfo.processing_bulk_ingestion_item SET',
  "  status = 'pending', claimed_run_id = NULL, result_entry_count = NULL,",
  '  error_code = NULL, started_at = NULL, finished_at = NULL,',
  '  current_version = current_version + 1, updated_at = CURRENT_TIMESTAMP',
  'WHERE workspace_id = $1 AND batch_id = $2',
  "  AND status IN ('running', 'failed')",
);
const INSERT_ATTEMPT_RUN_SQL = sql(
  'INSERT INTO struinfo.processing_run (',
  '  workspace_id, run_id, idempotency_key, origin, status, privacy_scope,',
  '  current_stage, current_step, completed_units, total_units, attempt, started_at',
  ") VALUES ($1, $2, $3, 'deterministic', 'running', $4, 'split',",
  "  '批量生成文档条目', $5, $6, $7, CURRENT_TIMESTAMP)",
);
const START_BATCH_SQL = sql(
  'UPDATE struinfo.processing_bulk_ingestion_batch SET',
  "  status = 'running', active_run_id = $3, attempt = $4,",
  '  current_version = current_version + 1,',
  '  started_at = COALESCE(started_at, CURRENT_TIMESTAMP),',
  '  finished_at = NULL, updated_at = CURRENT_TIMESTAMP',
  'WHERE workspace_id = $1 AND batch_id = $2',
);
const CLAIM_ITEM_SQL = sql(
  'SELECT workspace_id::text, batch_id::text, item_ordinal, snapshot_id::text,',
  '  canonical_content_sha256, is_private, planned_entry_count, status,',
  '  attempt, claimed_run_id::text, result_entry_count, error_code,',
  '  current_version::integer AS current_version',
  'FROM struinfo.processing_bulk_ingestion_item',
  "WHERE workspace_id = $1 AND batch_id = $2 AND status = 'pending'",
  'ORDER BY item_ordinal',
  'LIMIT 1 FOR UPDATE',
);
const MARK_ITEM_RUNNING_SQL = sql(
  'UPDATE struinfo.processing_bulk_ingestion_item SET',
  "  status = 'running', attempt = attempt + 1, claimed_run_id = $4,",
  '  current_version = current_version + 1, started_at = CURRENT_TIMESTAMP,',
  '  finished_at = NULL, updated_at = CURRENT_TIMESTAMP',
  'WHERE workspace_id = $1 AND batch_id = $2 AND item_ordinal = $3',
  'RETURNING current_version::integer AS current_version, attempt',
);
const LOCK_ITEM_SQL = sql(
  'SELECT status, claimed_run_id::text, current_version::integer AS current_version,',
  '  planned_entry_count',
  'FROM struinfo.processing_bulk_ingestion_item',
  'WHERE workspace_id = $1 AND batch_id = $2 AND item_ordinal = $3',
  'FOR UPDATE',
);
const SETTLE_ITEM_SQL = sql(
  'UPDATE struinfo.processing_bulk_ingestion_item SET',
  '  status = $6, result_entry_count = $7, error_code = $8,',
  '  current_version = current_version + 1, finished_at = CURRENT_TIMESTAMP,',
  '  updated_at = CURRENT_TIMESTAMP',
  'WHERE workspace_id = $1 AND batch_id = $2 AND item_ordinal = $3',
  '  AND current_version = $4 AND claimed_run_id = $5',
);
const COUNT_ITEMS_SQL = sql(
  'SELECT',
  "  count(*) FILTER (WHERE status = 'pending')::integer AS pending_count,",
  "  count(*) FILTER (WHERE status = 'running')::integer AS running_count,",
  "  count(*) FILTER (WHERE status = 'succeeded')::integer AS succeeded_count,",
  "  count(*) FILTER (WHERE status = 'failed')::integer AS failed_count,",
  "  COALESCE(sum(result_entry_count) FILTER (WHERE status = 'succeeded'), 0)::integer",
  '    AS succeeded_entry_count',
  'FROM struinfo.processing_bulk_ingestion_item',
  'WHERE workspace_id = $1 AND batch_id = $2',
);
const REFRESH_BATCH_COUNTS_SQL = sql(
  'UPDATE struinfo.processing_bulk_ingestion_batch SET',
  '  succeeded_snapshot_count = $3, succeeded_entry_count = $4,',
  '  failed_snapshot_count = $5, current_version = current_version + 1,',
  '  updated_at = CURRENT_TIMESTAMP',
  'WHERE workspace_id = $1 AND batch_id = $2',
);
const UPDATE_RUN_PROGRESS_SQL = sql(
  'UPDATE struinfo.processing_run SET completed_units = $3,',
  '  current_version = current_version + 1, updated_at = CURRENT_TIMESTAMP',
  "WHERE workspace_id = $1 AND run_id = $2 AND status = 'running'",
);
const FINISH_RUN_SQL = sql(
  'UPDATE struinfo.processing_run SET',
  '  status = $3, current_step = $4, completed_units = $5, error_code = $6,',
  '  current_version = current_version + 1, finished_at = CURRENT_TIMESTAMP,',
  '  updated_at = CURRENT_TIMESTAMP',
  "WHERE workspace_id = $1 AND run_id = $2 AND status = 'running'",
);
export const FINISH_BULK_INGESTION_BATCH_SQL = sql(
  'UPDATE struinfo.processing_bulk_ingestion_batch SET',
  '  status = $3::varchar, active_run_id = NULL, succeeded_snapshot_count = $4,',
  '  succeeded_entry_count = $5, failed_snapshot_count = $6,',
  '  current_version = current_version + 1,',
  "  finished_at = CASE WHEN $3::varchar IN ('succeeded', 'failed')",
  '    THEN CURRENT_TIMESTAMP ELSE NULL END,',
  '  updated_at = CURRENT_TIMESTAMP',
  'WHERE workspace_id = $1 AND batch_id = $2',
);

type Row = Readonly<Record<string, unknown>>;

export class PostgresBulkIngestionRepository implements BulkIngestionRepositoryPort {
  readonly #pool: PostgresPoolBoundary;

  public constructor(pool: PostgresPoolBoundary) {
    this.#pool = pool;
  }

  public listCandidates(
    workspaceIdInput: string,
    privacyScopeInput: ProcessingPrivacyScope,
    limitInput: number,
  ): Promise<readonly Readonly<BulkIngestionSnapshotCandidate>[]> {
    const workspaceId = canonicalUuid(workspaceIdInput);
    const privacyScope = enumValue(
      privacyScopeInput,
      PROCESSING_PRIVACY_SCOPES,
    );
    if (!validLimit(limitInput, BULK_INGESTION_MAXIMUM_SNAPSHOTS)) {
      throw new PostgresAdapterError();
    }
    return runPostgresTransaction(
      this.#pool,
      'repeatable_read_only',
      async (client) => {
        const result = await client.query<Row>(
          LIST_BULK_INGESTION_CANDIDATES_SQL,
          [workspaceId, privacyScope, limitInput],
        );
        return Object.freeze(result.rows.map((row) => mapCandidate(row)));
      },
    );
  }

  public async loadBatch(
    workspaceIdInput: string,
    batchIdInput: string,
  ): Promise<Readonly<BulkIngestionBatch> | undefined> {
    const workspaceId = canonicalUuid(workspaceIdInput);
    const batchId = canonicalUuid(batchIdInput);
    return runPostgresTransaction(
      this.#pool,
      'repeatable_read_only',
      async (client) => {
        const batch = await client.query<Row>(READ_BATCH_SQL, [
          workspaceId,
          batchId,
        ]);
        if (batch.rows.length === 0) return undefined;
        if (batch.rows.length !== 1 || batch.rows[0] === undefined) {
          throw new PostgresAdapterError();
        }
        const items = await client.query<Row>(READ_BATCH_ITEMS_SQL, [
          workspaceId,
          batchId,
        ]);
        return mapBatch(batch.rows[0], items.rows);
      },
    );
  }

  public initializeBatch(
    initialize: Readonly<BulkIngestionBatchInitialize>,
  ): Promise<BulkIngestionInitializeOutcome> {
    validateInitialize(initialize);
    return runPostgresTransaction(
      this.#pool,
      'read_committed',
      async (client) => {
        await acquireWorkspaceWriteLock(client, initialize.workspaceId);
        const existing = await client.query<Row>(READ_BATCH_BY_KEY_SQL, [
          initialize.workspaceId,
          initialize.idempotencyKey,
        ]);
        if (existing.rows.length > 1) throw new PostgresAdapterError();
        if (existing.rows[0] !== undefined) {
          return sameInitialize(existing.rows[0], initialize)
            ? 'existing'
            : 'conflict';
        }
        const plannedEntries = initialize.items.reduce(
          (total, item) => total + item.plannedEntryCount,
          0,
        );
        expectOneAffected(
          (
            await client.query<Row>(INSERT_BATCH_SQL, [
              initialize.workspaceId,
              initialize.batchId,
              initialize.idempotencyKey,
              initialize.requestSha256,
              initialize.planSha256,
              initialize.privacyScope,
              initialize.items.length,
              plannedEntries,
            ])
          ).rowCount,
        );
        for (const [ordinal, item] of initialize.items.entries()) {
          expectOneAffected(
            (
              await client.query<Row>(INSERT_ITEM_SQL, [
                initialize.workspaceId,
                initialize.batchId,
                ordinal,
                item.snapshotId,
                item.canonicalContentSha256,
                item.isPrivate,
                item.plannedEntryCount,
              ])
            ).rowCount,
          );
        }
        return 'created';
      },
    );
  }

  public beginAttempt(
    input: Readonly<{
      workspaceId: string;
      batchId: string;
      runId: string;
      mode: 'run' | 'resume' | 'retry';
    }>,
  ): Promise<BulkIngestionBeginOutcome> {
    const workspaceId = canonicalUuid(input.workspaceId);
    const batchId = canonicalUuid(input.batchId);
    const runId = canonicalUuid(input.runId);
    return runPostgresTransaction(
      this.#pool,
      'read_committed',
      async (client) => {
        await acquireWorkspaceWriteLock(client, workspaceId);
        const batchResult = await client.query<Row>(LOCK_BATCH_SQL, [
          workspaceId,
          batchId,
        ]);
        if (batchResult.rows.length === 0) return 'not_found';
        if (
          batchResult.rows.length !== 1 ||
          batchResult.rows[0] === undefined
        ) {
          throw new PostgresAdapterError();
        }
        const batch = batchResult.rows[0];
        const status = enumValue(batch.status, BULK_INGESTION_BATCH_STATUSES);
        const allowed =
          (input.mode === 'run' && status === 'planned') ||
          (input.mode === 'resume' && status === 'paused') ||
          (input.mode === 'retry' &&
            ['running', 'pause_requested', 'failed'].includes(status));
        if (!allowed) return 'invalid_state';
        const activeRunId = optionalUuid(batch.active_run_id);
        if (input.mode === 'retry') {
          if (activeRunId !== undefined) {
            expectOptionalSingleAffected(
              (
                await client.query<Row>(FAIL_ACTIVE_RUN_SQL, [
                  workspaceId,
                  activeRunId,
                ])
              ).rowCount,
            );
          }
          await client.query<Row>(RESET_RETRY_ITEMS_SQL, [
            workspaceId,
            batchId,
          ]);
        }
        const attempt = integer(batch.attempt) + 1;
        const idempotencyKey = `m2-p0a:${batchId}:${attempt.toString()}`;
        expectOneAffected(
          (
            await client.query<Row>(INSERT_ATTEMPT_RUN_SQL, [
              workspaceId,
              runId,
              idempotencyKey,
              enumValue(batch.privacy_scope, PROCESSING_PRIVACY_SCOPES),
              integer(batch.succeeded_snapshot_count),
              integer(batch.snapshot_count, 1),
              attempt,
            ])
          ).rowCount,
        );
        expectOneAffected(
          (
            await client.query<Row>(START_BATCH_SQL, [
              workspaceId,
              batchId,
              runId,
              attempt,
            ])
          ).rowCount,
        );
        return 'started';
      },
    );
  }

  public requestPause(
    workspaceIdInput: string,
    batchIdInput: string,
  ): Promise<BulkIngestionPauseOutcome> {
    const workspaceId = canonicalUuid(workspaceIdInput);
    const batchId = canonicalUuid(batchIdInput);
    return this.#withLockedBatch(
      workspaceId,
      batchId,
      async (client, batch) => {
        const status = enumValue(batch.status, BULK_INGESTION_BATCH_STATUSES);
        if (status === 'paused' || status === 'pause_requested')
          return 'unchanged';
        if (status === 'succeeded' || status === 'failed') return 'terminal';
        const nextStatus = status === 'planned' ? 'paused' : 'pause_requested';
        expectOneAffected(
          (
            await client.query<Row>(
              sql(
                'UPDATE struinfo.processing_bulk_ingestion_batch SET',
                '  status = $3, current_version = current_version + 1,',
                '  updated_at = CURRENT_TIMESTAMP',
                'WHERE workspace_id = $1 AND batch_id = $2',
              ),
              [workspaceId, batchId, nextStatus],
            )
          ).rowCount,
        );
        return 'applied';
      },
    );
  }

  public claimNextItem(
    workspaceIdInput: string,
    batchIdInput: string,
    runIdInput: string,
  ): Promise<Readonly<BulkIngestionClaimResult>> {
    const workspaceId = canonicalUuid(workspaceIdInput);
    const batchId = canonicalUuid(batchIdInput);
    const runId = canonicalUuid(runIdInput);
    return runPostgresTransaction(
      this.#pool,
      'read_committed',
      async (client) => {
        await acquireWorkspaceWriteLock(client, workspaceId);
        const batchResult = await client.query<Row>(LOCK_BATCH_SQL, [
          workspaceId,
          batchId,
        ]);
        if (batchResult.rows.length === 0) {
          return Object.freeze({outcome: 'not_found' as const});
        }
        const batch = requireOne(batchResult.rows);
        if (optionalUuid(batch.active_run_id) !== runId) {
          return Object.freeze({outcome: 'stale' as const});
        }
        if (batch.status === 'pause_requested') {
          return Object.freeze({outcome: 'pause_requested' as const});
        }
        if (batch.status !== 'running') {
          return Object.freeze({outcome: 'stale' as const});
        }
        const result = await client.query<Row>(CLAIM_ITEM_SQL, [
          workspaceId,
          batchId,
        ]);
        if (result.rows.length === 0) {
          return Object.freeze({outcome: 'drained' as const});
        }
        const row = requireOne(result.rows);
        const updated = await client.query<Row>(MARK_ITEM_RUNNING_SQL, [
          workspaceId,
          batchId,
          integer(row.item_ordinal),
          runId,
        ]);
        const returned = requireOne(updated.rows);
        expectOneAffected(updated.rowCount);
        return Object.freeze({
          outcome: 'claimed' as const,
          item: mapItem({
            ...row,
            status: 'running',
            attempt: returned.attempt,
            claimed_run_id: runId,
            current_version: returned.current_version,
          }),
        });
      },
    );
  }

  public settleItem(
    input: Readonly<{
      workspaceId: string;
      batchId: string;
      ordinal: number;
      expectedVersion: number;
      runId: string;
      status: 'succeeded' | 'failed';
      resultEntryCount?: number;
      errorCode?: string;
    }>,
  ): Promise<BulkIngestionSettleOutcome> {
    validateSettlement(input);
    return runPostgresTransaction(
      this.#pool,
      'read_committed',
      async (client) => {
        await acquireWorkspaceWriteLock(client, input.workspaceId);
        const batchResult = await client.query<Row>(LOCK_BATCH_SQL, [
          input.workspaceId,
          input.batchId,
        ]);
        if (batchResult.rows.length === 0) return 'not_found';
        const batch = requireOne(batchResult.rows);
        if (
          optionalUuid(batch.active_run_id) !== input.runId ||
          !['running', 'pause_requested'].includes(text(batch.status))
        ) {
          return 'stale';
        }
        const itemResult = await client.query<Row>(LOCK_ITEM_SQL, [
          input.workspaceId,
          input.batchId,
          input.ordinal,
        ]);
        if (itemResult.rows.length === 0) return 'not_found';
        const item = requireOne(itemResult.rows);
        if (
          item.status !== 'running' ||
          optionalUuid(item.claimed_run_id) !== input.runId ||
          integer(item.current_version, 1) !== input.expectedVersion
        ) {
          return 'stale';
        }
        if (
          input.status === 'succeeded' &&
          input.resultEntryCount !== integer(item.planned_entry_count, 1)
        ) {
          throw new PostgresAdapterError();
        }
        expectOneAffected(
          (
            await client.query<Row>(SETTLE_ITEM_SQL, [
              input.workspaceId,
              input.batchId,
              input.ordinal,
              input.expectedVersion,
              input.runId,
              input.status,
              input.resultEntryCount ?? null,
              input.errorCode ?? null,
            ])
          ).rowCount,
        );
        const counts = await readCounts(
          client,
          input.workspaceId,
          input.batchId,
        );
        await refreshCounts(client, input.workspaceId, input.batchId, counts);
        expectOneAffected(
          (
            await client.query<Row>(UPDATE_RUN_PROGRESS_SQL, [
              input.workspaceId,
              input.runId,
              counts.succeededCount,
            ])
          ).rowCount,
        );
        return 'applied';
      },
    );
  }

  public finishAttempt(
    input: Readonly<{
      workspaceId: string;
      batchId: string;
      runId: string;
      reason: 'drained' | 'pause' | 'window';
    }>,
  ): Promise<BulkIngestionSettleOutcome> {
    const workspaceId = canonicalUuid(input.workspaceId);
    const batchId = canonicalUuid(input.batchId);
    const runId = canonicalUuid(input.runId);
    return runPostgresTransaction(
      this.#pool,
      'read_committed',
      async (client) => {
        await acquireWorkspaceWriteLock(client, workspaceId);
        const batchResult = await client.query<Row>(LOCK_BATCH_SQL, [
          workspaceId,
          batchId,
        ]);
        if (batchResult.rows.length === 0) return 'not_found';
        const batch = requireOne(batchResult.rows);
        if (optionalUuid(batch.active_run_id) !== runId) return 'stale';
        const counts = await readCounts(client, workspaceId, batchId);
        if (counts.runningCount !== 0) return 'stale';
        const paused = counts.pendingCount > 0;
        const failed = !paused && counts.failedCount > 0;
        const batchStatus = paused ? 'paused' : failed ? 'failed' : 'succeeded';
        const runStatus = paused
          ? 'cancelled'
          : failed
            ? 'failed'
            : 'succeeded';
        const step = paused
          ? input.reason === 'pause'
            ? '批次已按请求暂停'
            : '批次执行窗口已完成'
          : failed
            ? '批次存在失败分片，等待重试'
            : '批次文档条目生成完成';
        expectOneAffected(
          (
            await client.query<Row>(FINISH_RUN_SQL, [
              workspaceId,
              runId,
              runStatus,
              step,
              counts.succeededCount,
              failed ? 'bulk_items_failed' : null,
            ])
          ).rowCount,
        );
        expectOneAffected(
          (
            await client.query<Row>(FINISH_BULK_INGESTION_BATCH_SQL, [
              workspaceId,
              batchId,
              batchStatus,
              counts.succeededCount,
              counts.succeededEntryCount,
              counts.failedCount,
            ])
          ).rowCount,
        );
        return 'applied';
      },
    );
  }

  async #withLockedBatch<Value extends BulkIngestionPauseOutcome>(
    workspaceId: string,
    batchId: string,
    work: (client: PostgresClientBoundary, batch: Row) => Promise<Value>,
  ): Promise<Value | 'not_found'> {
    return runPostgresTransaction(
      this.#pool,
      'read_committed',
      async (client) => {
        await acquireWorkspaceWriteLock(client, workspaceId);
        const result = await client.query<Row>(LOCK_BATCH_SQL, [
          workspaceId,
          batchId,
        ]);
        if (result.rows.length === 0) return 'not_found';
        return work(client, requireOne(result.rows));
      },
    );
  }
}

function mapCandidate(row: Row): Readonly<BulkIngestionSnapshotCandidate> {
  if (typeof row.is_private !== 'boolean') throw new PostgresAdapterError();
  return Object.freeze({
    workspaceId: canonicalUuid(row.workspace_id),
    snapshotId: canonicalUuid(row.snapshot_id),
    canonicalContentSha256: sha256(row.canonical_content_sha256),
    isPrivate: row.is_private,
    plannedEntryCount: integer(row.planned_entry_count, 1),
  });
}

function mapBatch(row: Row, itemRows: readonly Row[]): BulkIngestionBatch {
  const activeRunId = optionalUuid(row.active_run_id);
  const startedAt = optionalTimestamp(row.started_at);
  const finishedAt = optionalTimestamp(row.finished_at);
  const items = itemRows.map((item) => mapItem(item));
  if (items.some((item, index) => item.ordinal !== index)) {
    throw new PostgresAdapterError();
  }
  return Object.freeze({
    workspaceId: canonicalUuid(row.workspace_id),
    batchId: canonicalUuid(row.batch_id),
    idempotencyKey: text(row.idempotency_key),
    requestSha256: sha256(row.request_sha256),
    planSha256: sha256(row.plan_sha256),
    privacyScope: enumValue(row.privacy_scope, PROCESSING_PRIVACY_SCOPES),
    status: enumValue(row.status, BULK_INGESTION_BATCH_STATUSES),
    ...(activeRunId === undefined ? {} : {activeRunId}),
    attempt: integer(row.attempt),
    snapshotCount: integer(row.snapshot_count, 1),
    plannedEntryCount: integer(row.planned_entry_count, 1),
    succeededSnapshotCount: integer(row.succeeded_snapshot_count),
    succeededEntryCount: integer(row.succeeded_entry_count),
    failedSnapshotCount: integer(row.failed_snapshot_count),
    version: integer(row.current_version, 1),
    createdAt: timestamp(row.created_at),
    ...(startedAt === undefined ? {} : {startedAt}),
    ...(finishedAt === undefined ? {} : {finishedAt}),
    updatedAt: timestamp(row.updated_at),
    items: Object.freeze(items),
  });
}

function mapItem(row: Row): BulkIngestionItem {
  if (typeof row.is_private !== 'boolean') throw new PostgresAdapterError();
  const claimedRunId = optionalUuid(row.claimed_run_id);
  const resultEntryCount = optionalInteger(row.result_entry_count);
  const errorCode = optionalText(row.error_code);
  return Object.freeze({
    workspaceId: canonicalUuid(row.workspace_id),
    batchId: canonicalUuid(row.batch_id),
    ordinal: integer(row.item_ordinal),
    snapshotId: canonicalUuid(row.snapshot_id),
    canonicalContentSha256: sha256(row.canonical_content_sha256),
    isPrivate: row.is_private,
    plannedEntryCount: integer(row.planned_entry_count, 1),
    status: enumValue(row.status, BULK_INGESTION_ITEM_STATUSES),
    attempt: integer(row.attempt),
    ...(claimedRunId === undefined ? {} : {claimedRunId}),
    ...(resultEntryCount === undefined ? {} : {resultEntryCount}),
    ...(errorCode === undefined ? {} : {errorCode}),
    version: integer(row.current_version, 1),
  });
}

function validateInitialize(
  initialize: Readonly<BulkIngestionBatchInitialize>,
): void {
  canonicalUuid(initialize.workspaceId);
  canonicalUuid(initialize.batchId);
  sha256(initialize.requestSha256);
  sha256(initialize.planSha256);
  enumValue(initialize.privacyScope, PROCESSING_PRIVACY_SCOPES);
  if (
    !validIdempotencyKey(initialize.idempotencyKey) ||
    initialize.items.length < 1 ||
    initialize.items.length > BULK_INGESTION_MAXIMUM_SNAPSHOTS
  ) {
    throw new PostgresAdapterError();
  }
  const snapshots = new Set<string>();
  let entries = 0;
  for (const item of initialize.items) {
    if (
      canonicalUuid(item.workspaceId) !== initialize.workspaceId ||
      snapshots.has(canonicalUuid(item.snapshotId)) ||
      typeof item.isPrivate !== 'boolean' ||
      !validLimit(item.plannedEntryCount, BULK_INGESTION_MAXIMUM_ENTRIES)
    ) {
      throw new PostgresAdapterError();
    }
    sha256(item.canonicalContentSha256);
    snapshots.add(item.snapshotId);
    entries += item.plannedEntryCount;
  }
  if (entries > BULK_INGESTION_MAXIMUM_ENTRIES) {
    throw new PostgresAdapterError();
  }
}

function validateSettlement(
  input: Readonly<{
    workspaceId: string;
    batchId: string;
    ordinal: number;
    expectedVersion: number;
    runId: string;
    status: 'succeeded' | 'failed';
    resultEntryCount?: number;
    errorCode?: string;
  }>,
): void {
  canonicalUuid(input.workspaceId);
  canonicalUuid(input.batchId);
  canonicalUuid(input.runId);
  if (
    !Number.isSafeInteger(input.ordinal) ||
    input.ordinal < 0 ||
    !Number.isSafeInteger(input.expectedVersion) ||
    input.expectedVersion < 1 ||
    (input.status === 'succeeded' &&
      (!validLimit(
        input.resultEntryCount ?? 0,
        BULK_INGESTION_MAXIMUM_ENTRIES,
      ) ||
        input.errorCode !== undefined)) ||
    (input.status === 'failed' &&
      (input.resultEntryCount !== undefined ||
        typeof input.errorCode !== 'string' ||
        input.errorCode.length < 1 ||
        input.errorCode.length > 120))
  ) {
    throw new PostgresAdapterError();
  }
}

function sameInitialize(
  row: Row,
  initialize: Readonly<BulkIngestionBatchInitialize>,
): boolean {
  return (
    canonicalUuid(row.batch_id) === initialize.batchId &&
    sha256(row.request_sha256) === initialize.requestSha256 &&
    sha256(row.plan_sha256) === initialize.planSha256 &&
    row.privacy_scope === initialize.privacyScope &&
    integer(row.snapshot_count, 1) === initialize.items.length &&
    integer(row.planned_entry_count, 1) ===
      initialize.items.reduce(
        (total, item) => total + item.plannedEntryCount,
        0,
      )
  );
}

interface ItemCounts {
  readonly pendingCount: number;
  readonly runningCount: number;
  readonly succeededCount: number;
  readonly failedCount: number;
  readonly succeededEntryCount: number;
}

async function readCounts(
  client: PostgresClientBoundary,
  workspaceId: string,
  batchId: string,
): Promise<Readonly<ItemCounts>> {
  const row = requireOne(
    (await client.query<Row>(COUNT_ITEMS_SQL, [workspaceId, batchId])).rows,
  );
  return Object.freeze({
    pendingCount: integer(row.pending_count),
    runningCount: integer(row.running_count),
    succeededCount: integer(row.succeeded_count),
    failedCount: integer(row.failed_count),
    succeededEntryCount: integer(row.succeeded_entry_count),
  });
}

async function refreshCounts(
  client: PostgresClientBoundary,
  workspaceId: string,
  batchId: string,
  counts: Readonly<ItemCounts>,
): Promise<void> {
  expectOneAffected(
    (
      await client.query<Row>(REFRESH_BATCH_COUNTS_SQL, [
        workspaceId,
        batchId,
        counts.succeededCount,
        counts.succeededEntryCount,
        counts.failedCount,
      ])
    ).rowCount,
  );
}

/** @internal Exported only for the cancelled-run recovery regression. */
export function expectOptionalSingleAffected(rowCount: number | null): void {
  if (rowCount !== 0 && rowCount !== 1) {
    throw new PostgresAdapterError();
  }
}

function requireOne(rows: readonly Row[]): Row {
  if (rows.length !== 1 || rows[0] === undefined) {
    throw new PostgresAdapterError();
  }
  return rows[0];
}

function optionalUuid(value: unknown): string | undefined {
  return value === null ? undefined : canonicalUuid(value);
}

function optionalInteger(value: unknown): number | undefined {
  return value === null ? undefined : integer(value);
}

function optionalTimestamp(value: unknown): string | undefined {
  return value === null ? undefined : timestamp(value);
}

function timestamp(value: unknown): string {
  const date = value instanceof Date ? value : new Date(text(value));
  if (Number.isNaN(date.getTime())) throw new PostgresAdapterError();
  return date.toISOString();
}

function validLimit(value: number, maximum: number): boolean {
  return Number.isSafeInteger(value) && value >= 1 && value <= maximum;
}

function validIdempotencyKey(value: string): boolean {
  return (
    typeof value === 'string' &&
    value.trim() === value &&
    value.length > 0 &&
    Array.from(value).length <= 160 &&
    !Array.from(value).some((character) => {
      const codePoint = character.codePointAt(0);
      return (
        codePoint !== undefined && (codePoint <= 0x1f || codePoint === 0x7f)
      );
    })
  );
}
