import {
  BULK_INGESTION_ENRICHMENT_EXCEPTION_CODES,
  BULK_INGESTION_ENRICHMENT_ITEM_STATUSES,
  BULK_INGESTION_MAXIMUM_SNAPSHOTS,
  PROCESSING_PRIVACY_SCOPES,
  type BulkIngestionEnrichmentBatch,
  type BulkIngestionEnrichmentBeginOutcome,
  type BulkIngestionEnrichmentException,
  type BulkIngestionEnrichmentItem,
  type BulkIngestionEnrichmentMode,
  type BulkIngestionEnrichmentRepositoryPort,
  type BulkIngestionEnrichmentWriteOutcome,
} from '../../../modules/processing/index.js';

import type {PostgresPoolBoundary} from './postgres_pool.js';
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

export const READ_BULK_INGESTION_ENRICHMENT_BASE_BATCH_SQL = sql(
  'SELECT batch.privacy_scope, batch.status, batch.snapshot_count,',
  '  batch.planned_entry_count, COALESCE((',
  '    SELECT max(run.attempt)',
  '    FROM struinfo.processing_run AS run',
  '    WHERE run.workspace_id = batch.workspace_id',
  "      AND run.idempotency_key LIKE ('m2-p0b:' || batch.batch_id::text || ':%')",
  '  ), 0)::integer AS enrichment_attempt',
  'FROM struinfo.processing_bulk_ingestion_batch AS batch',
  'WHERE batch.workspace_id = $1 AND batch.batch_id = $2',
);
const LOCK_BASE_BATCH_SQL = `${READ_BULK_INGESTION_ENRICHMENT_BASE_BATCH_SQL}\nFOR UPDATE`;
const INSERT_MISSING_ITEMS_SQL = sql(
  'INSERT INTO struinfo.processing_bulk_ingestion_enrichment_item (',
  '  workspace_id, batch_id, item_ordinal',
  ') SELECT base.workspace_id, base.batch_id, base.item_ordinal',
  'FROM struinfo.processing_bulk_ingestion_item AS base',
  'WHERE base.workspace_id = $1 AND base.batch_id = $2',
  'ON CONFLICT (workspace_id, batch_id, item_ordinal) DO NOTHING',
);
const READ_ITEMS_SQL = sql(
  'SELECT base.workspace_id::text, base.batch_id::text, base.item_ordinal,',
  '  base.snapshot_id::text, base.is_private, base.planned_entry_count,',
  '  enrichment.status, enrichment.attempt,',
  '  enrichment.claimed_run_id::text, enrichment.rules_sha256,',
  '  enrichment.result_entry_count, enrichment.revised_entry_count,',
  '  enrichment.added_tag_count, enrichment.association_projection_count,',
  '  enrichment.exception_entry_count, enrichment.error_code,',
  '  enrichment.current_version::integer AS current_version',
  'FROM struinfo.processing_bulk_ingestion_item AS base',
  'JOIN struinfo.processing_bulk_ingestion_enrichment_item AS enrichment',
  '  ON enrichment.workspace_id = base.workspace_id',
  ' AND enrichment.batch_id = base.batch_id',
  ' AND enrichment.item_ordinal = base.item_ordinal',
  'WHERE base.workspace_id = $1 AND base.batch_id = $2',
  'ORDER BY base.item_ordinal',
);
const LOCK_ITEMS_SQL = `${READ_ITEMS_SQL}\nFOR UPDATE OF enrichment`;
const READ_EXCEPTIONS_SQL = sql(
  'SELECT item_ordinal, entry_id::text, entry_revision,',
  '  entry_revision_id::text, exception_code',
  'FROM struinfo.processing_bulk_ingestion_exception',
  'WHERE workspace_id = $1 AND batch_id = $2',
  'ORDER BY item_ordinal, entry_id',
);
export const FAIL_ORPHANED_BULK_INGESTION_ENRICHMENT_RUNS_SQL = sql(
  'UPDATE struinfo.processing_run SET',
  "  status = 'failed', error_code = 'bulk_enrichment_executor_recovered',",
  "  current_step = '批量标签执行器被恢复操作取代',",
  '  current_version = current_version + 1, finished_at = CURRENT_TIMESTAMP,',
  '  updated_at = CURRENT_TIMESTAMP',
  "WHERE workspace_id = $1 AND status = 'running'",
  "  AND idempotency_key LIKE ('m2-p0b:' || $2::uuid::text || ':%')",
);
const DELETE_RESET_EXCEPTIONS_SQL = sql(
  'DELETE FROM struinfo.processing_bulk_ingestion_exception',
  'WHERE workspace_id = $1 AND batch_id = $2',
  '  AND item_ordinal IN (',
  '    SELECT item_ordinal',
  '    FROM struinfo.processing_bulk_ingestion_enrichment_item',
  '    WHERE workspace_id = $1 AND batch_id = $2',
  "      AND status IN ('running', 'failed')",
  '  )',
);
const RESET_RETRY_ITEMS_SQL = sql(
  'UPDATE struinfo.processing_bulk_ingestion_enrichment_item SET',
  "  status = 'pending', claimed_run_id = NULL, rules_sha256 = NULL,",
  '  result_entry_count = NULL, revised_entry_count = NULL,',
  '  added_tag_count = NULL, association_projection_count = NULL,',
  '  exception_entry_count = NULL, error_code = NULL,',
  '  started_at = NULL, finished_at = NULL,',
  '  current_version = current_version + 1, updated_at = CURRENT_TIMESTAMP',
  'WHERE workspace_id = $1 AND batch_id = $2',
  "  AND status IN ('running', 'failed')",
);
const DELETE_REFRESH_ADJUDICATIONS_SQL = sql(
  'DELETE FROM struinfo.processing_bulk_ingestion_adjudication AS adjudication',
  'USING struinfo.processing_bulk_ingestion_enrichment_item AS enrichment',
  'WHERE adjudication.workspace_id = enrichment.workspace_id',
  '  AND adjudication.batch_id = enrichment.batch_id',
  '  AND adjudication.item_ordinal = enrichment.item_ordinal',
  '  AND adjudication.workspace_id = $1 AND adjudication.batch_id = $2',
  "  AND enrichment.status = 'succeeded'",
  '  AND enrichment.rules_sha256 IS DISTINCT FROM $3',
);
const DELETE_REFRESH_EXCEPTIONS_SQL = sql(
  'DELETE FROM struinfo.processing_bulk_ingestion_exception AS exception',
  'USING struinfo.processing_bulk_ingestion_enrichment_item AS enrichment',
  'WHERE exception.workspace_id = enrichment.workspace_id',
  '  AND exception.batch_id = enrichment.batch_id',
  '  AND exception.item_ordinal = enrichment.item_ordinal',
  '  AND exception.workspace_id = $1 AND exception.batch_id = $2',
  "  AND enrichment.status = 'succeeded'",
  '  AND enrichment.rules_sha256 IS DISTINCT FROM $3',
);
const RESET_REFRESH_ITEMS_SQL = sql(
  'UPDATE struinfo.processing_bulk_ingestion_enrichment_item SET',
  "  status = 'pending', claimed_run_id = NULL, rules_sha256 = NULL,",
  '  result_entry_count = NULL, revised_entry_count = NULL,',
  '  added_tag_count = NULL, association_projection_count = NULL,',
  '  exception_entry_count = NULL, error_code = NULL,',
  '  started_at = NULL, finished_at = NULL,',
  '  current_version = current_version + 1, updated_at = CURRENT_TIMESTAMP',
  'WHERE workspace_id = $1 AND batch_id = $2',
  "  AND status = 'succeeded'",
  '  AND rules_sha256 IS DISTINCT FROM $3',
);
const INSERT_ATTEMPT_RUN_SQL = sql(
  'INSERT INTO struinfo.processing_run (',
  '  workspace_id, run_id, idempotency_key, origin, status, privacy_scope,',
  '  current_stage, current_step, completed_units, total_units, attempt, started_at',
  ") VALUES ($1, $2, $3, 'deterministic', 'running', $4, 'tags',",
  "  '批量确定性标签与增量联系', $5, $6, $7, CURRENT_TIMESTAMP)",
);
const READ_RUN_ATTEMPT_SQL = sql(
  'SELECT attempt',
  'FROM struinfo.processing_run',
  "WHERE workspace_id = $1 AND run_id = $2 AND status = 'running'",
  'FOR UPDATE',
);
const CLAIM_ITEMS_SQL = sql(
  'SELECT base.workspace_id::text, base.batch_id::text, base.item_ordinal,',
  '  base.snapshot_id::text, base.is_private, base.planned_entry_count,',
  '  enrichment.status, enrichment.attempt,',
  '  enrichment.claimed_run_id::text, enrichment.rules_sha256,',
  '  enrichment.result_entry_count, enrichment.revised_entry_count,',
  '  enrichment.added_tag_count, enrichment.association_projection_count,',
  '  enrichment.exception_entry_count, enrichment.error_code,',
  '  enrichment.current_version::integer AS current_version',
  'FROM struinfo.processing_bulk_ingestion_item AS base',
  'JOIN struinfo.processing_bulk_ingestion_enrichment_item AS enrichment',
  '  ON enrichment.workspace_id = base.workspace_id',
  ' AND enrichment.batch_id = base.batch_id',
  ' AND enrichment.item_ordinal = base.item_ordinal',
  'WHERE base.workspace_id = $1 AND base.batch_id = $2',
  "  AND enrichment.status = 'pending'",
  'ORDER BY base.item_ordinal',
  'LIMIT $3 FOR UPDATE OF enrichment',
);
const MARK_ITEM_RUNNING_SQL = sql(
  'UPDATE struinfo.processing_bulk_ingestion_enrichment_item SET',
  "  status = 'running', attempt = $4, claimed_run_id = $5, rules_sha256 = $6,",
  '  current_version = current_version + 1, started_at = CURRENT_TIMESTAMP,',
  '  finished_at = NULL, updated_at = CURRENT_TIMESTAMP',
  'WHERE workspace_id = $1 AND batch_id = $2 AND item_ordinal = $3',
  'RETURNING current_version::integer AS current_version',
);
const LOCK_ITEM_SQL = sql(
  'SELECT base.snapshot_id::text, enrichment.status,',
  '  enrichment.claimed_run_id::text,',
  '  enrichment.current_version::integer AS current_version',
  'FROM struinfo.processing_bulk_ingestion_item AS base',
  'JOIN struinfo.processing_bulk_ingestion_enrichment_item AS enrichment',
  '  ON enrichment.workspace_id = base.workspace_id',
  ' AND enrichment.batch_id = base.batch_id',
  ' AND enrichment.item_ordinal = base.item_ordinal',
  'WHERE base.workspace_id = $1 AND base.batch_id = $2',
  '  AND base.item_ordinal = $3',
  'FOR UPDATE OF enrichment',
);
const DELETE_ITEM_EXCEPTIONS_SQL = sql(
  'DELETE FROM struinfo.processing_bulk_ingestion_exception',
  'WHERE workspace_id = $1 AND batch_id = $2 AND item_ordinal = $3',
);
const INSERT_ITEM_EXCEPTION_SQL = sql(
  'INSERT INTO struinfo.processing_bulk_ingestion_exception (',
  '  workspace_id, batch_id, item_ordinal, entry_id, entry_revision,',
  '  entry_revision_id, exception_code',
  ') SELECT $1, $2, $3, entry.entry_id, entry.current_revision,',
  '  entry.current_revision_id, $8',
  'FROM struinfo.information_entry AS entry',
  'WHERE entry.workspace_id = $1 AND entry.entry_id = $4',
  '  AND entry.snapshot_id = $5 AND entry.is_current_structure',
  '  AND entry.current_revision = $6 AND entry.current_revision_id = $7',
);
const SETTLE_ITEM_SQL = sql(
  'UPDATE struinfo.processing_bulk_ingestion_enrichment_item SET',
  '  status = $6, result_entry_count = $7, revised_entry_count = $8,',
  '  added_tag_count = $9, association_projection_count = $10,',
  '  exception_entry_count = $11, error_code = $12,',
  '  current_version = current_version + 1, finished_at = CURRENT_TIMESTAMP,',
  '  updated_at = CURRENT_TIMESTAMP',
  'WHERE workspace_id = $1 AND batch_id = $2 AND item_ordinal = $3',
  '  AND current_version = $4 AND claimed_run_id = $5',
);
const FINISH_RUN_SQL = sql(
  'UPDATE struinfo.processing_run SET status = $3, current_stage = $4,',
  '  current_step = $5, completed_units = $6, error_code = $7,',
  '  current_version = current_version + 1, finished_at = CURRENT_TIMESTAMP,',
  '  updated_at = CURRENT_TIMESTAMP',
  "WHERE workspace_id = $1 AND run_id = $2 AND status = 'running'",
);

type Row = Readonly<Record<string, unknown>>;

export class PostgresBulkIngestionEnrichmentRepository implements BulkIngestionEnrichmentRepositoryPort {
  readonly #pool: PostgresPoolBoundary;

  public constructor(pool: PostgresPoolBoundary) {
    this.#pool = pool;
  }

  public ensureItems(
    workspaceIdInput: string,
    batchIdInput: string,
  ): Promise<boolean> {
    const workspaceId = canonicalUuid(workspaceIdInput);
    const batchId = canonicalUuid(batchIdInput);
    return runPostgresTransaction(
      this.#pool,
      'read_committed',
      async (client) => {
        await acquireWorkspaceWriteLock(client, workspaceId);
        const base = await client.query<Row>(LOCK_BASE_BATCH_SQL, [
          workspaceId,
          batchId,
        ]);
        if (base.rows.length === 0) return false;
        const row = requireOne(base.rows);
        if (row.status !== 'succeeded') return false;
        await client.query<Row>(INSERT_MISSING_ITEMS_SQL, [
          workspaceId,
          batchId,
        ]);
        return true;
      },
    );
  }

  public async loadBatch(
    workspaceIdInput: string,
    batchIdInput: string,
  ): Promise<Readonly<BulkIngestionEnrichmentBatch> | undefined> {
    const workspaceId = canonicalUuid(workspaceIdInput);
    const batchId = canonicalUuid(batchIdInput);
    return runPostgresTransaction(
      this.#pool,
      'repeatable_read_only',
      async (client) => {
        const base = await client.query<Row>(
          READ_BULK_INGESTION_ENRICHMENT_BASE_BATCH_SQL,
          [workspaceId, batchId],
        );
        const items = await client.query<Row>(READ_ITEMS_SQL, [
          workspaceId,
          batchId,
        ]);
        const exceptions = await client.query<Row>(READ_EXCEPTIONS_SQL, [
          workspaceId,
          batchId,
        ]);
        if (base.rows.length === 0) return undefined;
        const baseRow = requireOne(base.rows);
        if (baseRow.status !== 'succeeded') return undefined;
        return mapBatch(
          workspaceId,
          batchId,
          baseRow,
          items.rows,
          exceptions.rows,
        );
      },
    );
  }

  public beginAttempt(
    input: Readonly<{
      workspaceId: string;
      batchId: string;
      runId: string;
      mode: BulkIngestionEnrichmentMode;
      maximumItems: number;
      rulesSha256: string;
    }>,
  ): Promise<BulkIngestionEnrichmentBeginOutcome> {
    validateBegin(input);
    return runPostgresTransaction(
      this.#pool,
      'read_committed',
      async (client) => {
        await acquireWorkspaceWriteLock(client, input.workspaceId);
        const base = await client.query<Row>(LOCK_BASE_BATCH_SQL, [
          input.workspaceId,
          input.batchId,
        ]);
        if (base.rows.length === 0) return 'not_found';
        const baseRow = requireOne(base.rows);
        if (baseRow.status !== 'succeeded') return 'invalid_state';
        await client.query<Row>(INSERT_MISSING_ITEMS_SQL, [
          input.workspaceId,
          input.batchId,
        ]);
        const locked = await client.query<Row>(LOCK_ITEMS_SQL, [
          input.workspaceId,
          input.batchId,
        ]);
        if (locked.rows.length !== integer(baseRow.snapshot_count, 1)) {
          throw new PostgresAdapterError();
        }
        const batch = mapBatch(
          input.workspaceId,
          input.batchId,
          baseRow,
          locked.rows,
          [],
        );
        const refreshableCount = locked.rows.filter(
          (row) =>
            row.status === 'succeeded' &&
            optionalText(row.rules_sha256) !== input.rulesSha256,
        ).length;
        const allowed =
          (input.mode === 'run' && batch.status === 'planned') ||
          (input.mode === 'resume' && batch.status === 'paused') ||
          (input.mode === 'retry' &&
            (batch.status === 'failed' || batch.status === 'running')) ||
          (input.mode === 'refresh' &&
            batch.status === 'succeeded' &&
            refreshableCount > 0);
        if (!allowed) return 'invalid_state';
        await client.query<Row>(
          FAIL_ORPHANED_BULK_INGESTION_ENRICHMENT_RUNS_SQL,
          [input.workspaceId, input.batchId],
        );
        if (input.mode === 'retry') {
          await client.query<Row>(DELETE_RESET_EXCEPTIONS_SQL, [
            input.workspaceId,
            input.batchId,
          ]);
          await client.query<Row>(RESET_RETRY_ITEMS_SQL, [
            input.workspaceId,
            input.batchId,
          ]);
        }
        if (input.mode === 'refresh') {
          const refreshArguments = [
            input.workspaceId,
            input.batchId,
            input.rulesSha256,
          ];
          await client.query<Row>(
            DELETE_REFRESH_ADJUDICATIONS_SQL,
            refreshArguments,
          );
          await client.query<Row>(
            DELETE_REFRESH_EXCEPTIONS_SQL,
            refreshArguments,
          );
          await client.query<Row>(RESET_REFRESH_ITEMS_SQL, refreshArguments);
        }
        const attempt = batch.attempt + 1;
        expectOneAffected(
          (
            await client.query<Row>(INSERT_ATTEMPT_RUN_SQL, [
              input.workspaceId,
              input.runId,
              `m2-p0b:${input.batchId}:${attempt.toString()}`,
              enumValue(baseRow.privacy_scope, PROCESSING_PRIVACY_SCOPES),
              input.mode === 'refresh'
                ? batch.succeededSnapshotCount - refreshableCount
                : batch.succeededSnapshotCount,
              batch.snapshotCount,
              attempt,
            ])
          ).rowCount,
        );
        return 'started';
      },
    );
  }

  public claimItems(
    workspaceIdInput: string,
    batchIdInput: string,
    runIdInput: string,
    maximumItems: number,
    rulesSha256Input: string,
  ): Promise<readonly Readonly<BulkIngestionEnrichmentItem>[]> {
    const workspaceId = canonicalUuid(workspaceIdInput);
    const batchId = canonicalUuid(batchIdInput);
    const runId = canonicalUuid(runIdInput);
    const rulesSha256 = sha256(rulesSha256Input);
    if (!validCount(maximumItems, 1, BULK_INGESTION_MAXIMUM_SNAPSHOTS)) {
      throw new PostgresAdapterError();
    }
    return runPostgresTransaction(
      this.#pool,
      'read_committed',
      async (client) => {
        await acquireWorkspaceWriteLock(client, workspaceId);
        const run = await client.query<Row>(READ_RUN_ATTEMPT_SQL, [
          workspaceId,
          runId,
        ]);
        if (run.rows.length === 0) return Object.freeze([]);
        const attempt = integer(requireOne(run.rows).attempt, 1);
        const selected = await client.query<Row>(CLAIM_ITEMS_SQL, [
          workspaceId,
          batchId,
          maximumItems,
        ]);
        const claimed: BulkIngestionEnrichmentItem[] = [];
        for (const row of selected.rows) {
          const ordinal = integer(row.item_ordinal);
          const updated = await client.query<Row>(MARK_ITEM_RUNNING_SQL, [
            workspaceId,
            batchId,
            ordinal,
            attempt,
            runId,
            rulesSha256,
          ]);
          expectOneAffected(updated.rowCount);
          claimed.push(
            mapItem(
              {
                ...row,
                status: 'running',
                attempt,
                claimed_run_id: runId,
                rules_sha256: rulesSha256,
                current_version: requireOne(updated.rows).current_version,
              },
              [],
            ),
          );
        }
        return Object.freeze(claimed);
      },
    );
  }

  public settleItem(
    input: Readonly<{
      workspaceId: string;
      batchId: string;
      ordinal: number;
      runId: string;
      expectedVersion: number;
      status: 'succeeded' | 'failed';
      resultEntryCount?: number;
      revisedEntryCount?: number;
      addedTagCount?: number;
      associationProjectionCount?: number;
      exceptionEntryCount?: number;
      errorCode?: string;
      exceptions: readonly Readonly<BulkIngestionEnrichmentException>[];
    }>,
  ): Promise<BulkIngestionEnrichmentWriteOutcome> {
    validateSettlement(input);
    return runPostgresTransaction(
      this.#pool,
      'read_committed',
      async (client) => {
        await acquireWorkspaceWriteLock(client, input.workspaceId);
        const locked = await client.query<Row>(LOCK_ITEM_SQL, [
          input.workspaceId,
          input.batchId,
          input.ordinal,
        ]);
        if (locked.rows.length === 0) return 'not_found';
        const row = requireOne(locked.rows);
        if (
          row.status !== 'running' ||
          optionalText(row.claimed_run_id) !== input.runId ||
          integer(row.current_version, 1) !== input.expectedVersion
        ) {
          return 'stale';
        }
        await client.query<Row>(DELETE_ITEM_EXCEPTIONS_SQL, [
          input.workspaceId,
          input.batchId,
          input.ordinal,
        ]);
        const snapshotId = canonicalUuid(row.snapshot_id);
        for (const exception of input.exceptions) {
          expectOneAffected(
            (
              await client.query<Row>(INSERT_ITEM_EXCEPTION_SQL, [
                input.workspaceId,
                input.batchId,
                input.ordinal,
                exception.entryId,
                snapshotId,
                exception.entryRevision,
                exception.entryRevisionId,
                exception.code,
              ])
            ).rowCount,
          );
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
              input.revisedEntryCount ?? null,
              input.addedTagCount ?? null,
              input.associationProjectionCount ?? null,
              input.exceptionEntryCount ?? null,
              input.errorCode ?? null,
            ])
          ).rowCount,
        );
        return 'applied';
      },
    );
  }

  public finishAttempt(
    workspaceIdInput: string,
    batchIdInput: string,
    runIdInput: string,
  ): Promise<BulkIngestionEnrichmentWriteOutcome> {
    const workspaceId = canonicalUuid(workspaceIdInput);
    const batchId = canonicalUuid(batchIdInput);
    const runId = canonicalUuid(runIdInput);
    return runPostgresTransaction(
      this.#pool,
      'read_committed',
      async (client) => {
        await acquireWorkspaceWriteLock(client, workspaceId);
        const run = await client.query<Row>(READ_RUN_ATTEMPT_SQL, [
          workspaceId,
          runId,
        ]);
        if (run.rows.length === 0) return 'not_found';
        const base = await client.query<Row>(LOCK_BASE_BATCH_SQL, [
          workspaceId,
          batchId,
        ]);
        if (base.rows.length === 0) return 'not_found';
        const items = await client.query<Row>(LOCK_ITEMS_SQL, [
          workspaceId,
          batchId,
        ]);
        if (
          items.rows.some(
            (row) => row.status === 'running' && row.claimed_run_id === runId,
          )
        ) {
          return 'stale';
        }
        const failed = items.rows.some((row) => row.status === 'failed');
        const succeeded = items.rows.filter(
          (row) => row.status === 'succeeded',
        ).length;
        const updated = await client.query<Row>(FINISH_RUN_SQL, [
          workspaceId,
          runId,
          failed ? 'failed' : 'succeeded',
          'associations',
          failed
            ? '批量标签或增量联系存在失败项'
            : '批量标签与增量联系执行窗口完成',
          succeeded,
          failed ? 'bulk_enrichment_failed' : null,
        ]);
        expectOneAffected(updated.rowCount);
        return 'applied';
      },
    );
  }
}

function mapBatch(
  workspaceId: string,
  batchId: string,
  base: Row,
  itemRows: readonly Row[],
  exceptionRows: readonly Row[],
): Readonly<BulkIngestionEnrichmentBatch> {
  const exceptions = new Map<number, BulkIngestionEnrichmentException[]>();
  for (const row of exceptionRows) {
    const ordinal = integer(row.item_ordinal);
    const values = exceptions.get(ordinal) ?? [];
    values.push(mapException(row));
    exceptions.set(ordinal, values);
  }
  const items = itemRows.map((row) =>
    mapItem(row, exceptions.get(integer(row.item_ordinal)) ?? []),
  );
  const snapshotCount = integer(base.snapshot_count, 1);
  if (items.length !== snapshotCount) throw new PostgresAdapterError();
  const succeeded = items.filter((item) => item.status === 'succeeded');
  const failed = items.filter((item) => item.status === 'failed');
  const pending = items.filter((item) => item.status === 'pending');
  const running = items.filter((item) => item.status === 'running');
  const status =
    running.length > 0
      ? ('running' as const)
      : succeeded.length === items.length
        ? ('succeeded' as const)
        : failed.length > 0
          ? ('failed' as const)
          : items.every((item) => item.attempt === 0)
            ? ('planned' as const)
            : ('paused' as const);
  return Object.freeze({
    workspaceId,
    batchId,
    privacyScope: enumValue(base.privacy_scope, PROCESSING_PRIVACY_SCOPES),
    status,
    attempt: Math.max(
      integer(base.enrichment_attempt),
      items.reduce((maximum, item) => Math.max(maximum, item.attempt), 0),
    ),
    snapshotCount,
    plannedEntryCount: integer(base.planned_entry_count, 1),
    succeededSnapshotCount: succeeded.length,
    succeededEntryCount: sumOptional(succeeded, 'resultEntryCount'),
    revisedEntryCount: sumOptional(succeeded, 'revisedEntryCount'),
    addedTagCount: sumOptional(succeeded, 'addedTagCount'),
    associationProjectionCount: sumOptional(
      succeeded,
      'associationProjectionCount',
    ),
    exceptionEntryCount: sumOptional(succeeded, 'exceptionEntryCount'),
    failedSnapshotCount: failed.length,
    pendingSnapshotCount: pending.length,
    runningSnapshotCount: running.length,
    items: Object.freeze(items),
  });
}

function mapItem(
  row: Row,
  exceptions: readonly Readonly<BulkIngestionEnrichmentException>[],
): Readonly<BulkIngestionEnrichmentItem> {
  if (typeof row.is_private !== 'boolean') throw new PostgresAdapterError();
  return Object.freeze({
    workspaceId: canonicalUuid(row.workspace_id),
    batchId: canonicalUuid(row.batch_id),
    ordinal: integer(row.item_ordinal),
    snapshotId: canonicalUuid(row.snapshot_id),
    isPrivate: row.is_private,
    plannedEntryCount: integer(row.planned_entry_count, 1),
    status: enumValue(row.status, BULK_INGESTION_ENRICHMENT_ITEM_STATUSES),
    attempt: integer(row.attempt),
    ...(optionalText(row.claimed_run_id) === undefined
      ? {}
      : {claimedRunId: canonicalUuid(row.claimed_run_id)}),
    ...(optionalText(row.rules_sha256) === undefined
      ? {}
      : {rulesSha256: sha256(row.rules_sha256)}),
    ...(row.result_entry_count === null || row.result_entry_count === undefined
      ? {}
      : {resultEntryCount: integer(row.result_entry_count, 1)}),
    ...(row.revised_entry_count === null ||
    row.revised_entry_count === undefined
      ? {}
      : {revisedEntryCount: integer(row.revised_entry_count)}),
    ...(row.added_tag_count === null || row.added_tag_count === undefined
      ? {}
      : {addedTagCount: integer(row.added_tag_count)}),
    ...(row.association_projection_count === null ||
    row.association_projection_count === undefined
      ? {}
      : {
          associationProjectionCount: integer(row.association_projection_count),
        }),
    ...(row.exception_entry_count === null ||
    row.exception_entry_count === undefined
      ? {}
      : {exceptionEntryCount: integer(row.exception_entry_count)}),
    ...(optionalText(row.error_code) === undefined
      ? {}
      : {errorCode: text(row.error_code)}),
    version: integer(row.current_version, 1),
    exceptions: Object.freeze([...exceptions]),
  });
}

function mapException(row: Row): Readonly<BulkIngestionEnrichmentException> {
  return Object.freeze({
    entryId: canonicalUuid(row.entry_id),
    entryRevision: integer(row.entry_revision, 1),
    entryRevisionId: canonicalUuid(row.entry_revision_id),
    code: enumValue(
      row.exception_code,
      BULK_INGESTION_ENRICHMENT_EXCEPTION_CODES,
    ),
  });
}

function validateBegin(
  input: Readonly<{
    workspaceId: string;
    batchId: string;
    runId: string;
    mode: BulkIngestionEnrichmentMode;
    maximumItems: number;
    rulesSha256: string;
  }>,
): void {
  canonicalUuid(input.workspaceId);
  canonicalUuid(input.batchId);
  canonicalUuid(input.runId);
  sha256(input.rulesSha256);
  if (
    !['run', 'resume', 'retry', 'refresh'].includes(input.mode) ||
    !validCount(input.maximumItems, 1, BULK_INGESTION_MAXIMUM_SNAPSHOTS)
  ) {
    throw new PostgresAdapterError();
  }
}

function validateSettlement(
  input: Readonly<{
    workspaceId: string;
    batchId: string;
    ordinal: number;
    runId: string;
    expectedVersion: number;
    status: 'succeeded' | 'failed';
    resultEntryCount?: number;
    revisedEntryCount?: number;
    addedTagCount?: number;
    associationProjectionCount?: number;
    exceptionEntryCount?: number;
    errorCode?: string;
    exceptions: readonly Readonly<BulkIngestionEnrichmentException>[];
  }>,
): void {
  canonicalUuid(input.workspaceId);
  canonicalUuid(input.batchId);
  canonicalUuid(input.runId);
  if (
    !validCount(input.ordinal, 0, 2_147_483_647) ||
    !validCount(input.expectedVersion, 1, 2_147_483_647) ||
    new Set(input.exceptions.map((exception) => exception.entryId)).size !==
      input.exceptions.length
  ) {
    throw new PostgresAdapterError();
  }
  for (const exception of input.exceptions) {
    canonicalUuid(exception.entryId);
    canonicalUuid(exception.entryRevisionId);
    integer(exception.entryRevision, 1);
    enumValue(exception.code, BULK_INGESTION_ENRICHMENT_EXCEPTION_CODES);
  }
  if (input.status === 'succeeded') {
    const counts = [
      input.resultEntryCount,
      input.revisedEntryCount,
      input.addedTagCount,
      input.associationProjectionCount,
      input.exceptionEntryCount,
    ];
    if (
      counts.some(
        (value) => value === undefined || !validCount(value, 0, 2_147_483_647),
      ) ||
      (input.resultEntryCount ?? 0) < 1 ||
      input.exceptionEntryCount !== input.exceptions.length ||
      input.errorCode !== undefined
    ) {
      throw new PostgresAdapterError();
    }
  } else if (
    input.resultEntryCount !== undefined ||
    input.revisedEntryCount !== undefined ||
    input.addedTagCount !== undefined ||
    input.associationProjectionCount !== undefined ||
    input.exceptionEntryCount !== undefined ||
    input.exceptions.length !== 0 ||
    input.errorCode === undefined ||
    input.errorCode.trim() === '' ||
    Array.from(input.errorCode).length > 120
  ) {
    throw new PostgresAdapterError();
  }
}

function requireOne(rows: readonly Row[]): Row {
  if (rows.length !== 1 || rows[0] === undefined) {
    throw new PostgresAdapterError();
  }
  return rows[0];
}

function validCount(
  value: unknown,
  minimum: number,
  maximum: number,
): value is number {
  return (
    typeof value === 'number' &&
    Number.isSafeInteger(value) &&
    value >= minimum &&
    value <= maximum
  );
}

function sumOptional(
  items: readonly Readonly<BulkIngestionEnrichmentItem>[],
  key:
    | 'resultEntryCount'
    | 'revisedEntryCount'
    | 'addedTagCount'
    | 'associationProjectionCount'
    | 'exceptionEntryCount',
): number {
  return items.reduce((total, item) => total + (item[key] ?? 0), 0);
}
