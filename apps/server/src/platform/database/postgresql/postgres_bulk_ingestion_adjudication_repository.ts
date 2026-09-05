import {
  BULK_INGESTION_ADJUDICATION_STATUSES,
  BULK_INGESTION_CODEX_PACKET_MAXIMUM_ITEMS,
  BULK_INGESTION_ENRICHMENT_EXCEPTION_CODES,
  type BulkIngestionAdjudicationException,
  type BulkIngestionAdjudicationExactDecision,
  type BulkIngestionAdjudicationRepositoryPort,
  type BulkIngestionAdjudicationStatus,
  type BulkIngestionEnrichmentExceptionCode,
} from '../../../modules/processing/index.js';

import type {PostgresPoolBoundary} from './postgres_pool.js';
import {runPostgresTransaction} from './postgres_transaction.js';
import {
  canonicalUuid,
  enumValue,
  expectOneAffected,
  integer,
  PostgresAdapterError,
} from './postgres_values.js';
import {acquireWorkspaceWriteLock} from './workspace_write_lock.js';

function sql(...lines: readonly string[]): string {
  return lines.join(String.fromCharCode(10));
}

const READ_READY_BATCH_SQL = sql(
  'SELECT batch.snapshot_count,',
  '  (SELECT COUNT(*)::integer',
  '   FROM struinfo.processing_bulk_ingestion_enrichment_item AS enrichment',
  '   WHERE enrichment.workspace_id = batch.workspace_id',
  '     AND enrichment.batch_id = batch.batch_id) AS enrichment_count,',
  '  (SELECT COUNT(*)::integer',
  '   FROM struinfo.processing_bulk_ingestion_enrichment_item AS enrichment',
  '   WHERE enrichment.workspace_id = batch.workspace_id',
  '     AND enrichment.batch_id = batch.batch_id',
  "     AND enrichment.status = 'succeeded') AS succeeded_count",
  'FROM struinfo.processing_bulk_ingestion_batch AS batch',
  "WHERE batch.workspace_id = $1 AND batch.batch_id = $2 AND batch.status = 'succeeded'",
);
const INSERT_MISSING_ADJUDICATIONS_SQL = sql(
  'INSERT INTO struinfo.processing_bulk_ingestion_adjudication (',
  '  workspace_id, batch_id, item_ordinal, entry_id',
  ') SELECT exception.workspace_id, exception.batch_id,',
  '  exception.item_ordinal, exception.entry_id',
  'FROM struinfo.processing_bulk_ingestion_exception AS exception',
  'WHERE exception.workspace_id = $1 AND exception.batch_id = $2',
  'ON CONFLICT (workspace_id, batch_id, item_ordinal, entry_id) DO NOTHING',
);
export const READ_BULK_INGESTION_ADJUDICATION_EXCEPTIONS_SQL = sql(
  'SELECT exception.workspace_id::text, exception.batch_id::text,',
  '  exception.item_ordinal, base.snapshot_id::text, base.is_private,',
  '  exception.entry_id::text, exception.entry_revision,',
  '  exception.entry_revision_id::text, exception.exception_code,',
  '  entry.current_revision, entry.current_revision_id::text,',
  '  (entry.is_current_structure',
  '    AND entry.current_revision = exception.entry_revision',
  '    AND entry.current_revision_id = exception.entry_revision_id) AS is_current,',
  '  adjudication.status,',
  '  adjudication.current_version::integer AS current_version',
  'FROM struinfo.processing_bulk_ingestion_exception AS exception',
  'JOIN struinfo.processing_bulk_ingestion_adjudication AS adjudication',
  '  ON adjudication.workspace_id = exception.workspace_id',
  ' AND adjudication.batch_id = exception.batch_id',
  ' AND adjudication.item_ordinal = exception.item_ordinal',
  ' AND adjudication.entry_id = exception.entry_id',
  'JOIN struinfo.processing_bulk_ingestion_item AS base',
  '  ON base.workspace_id = exception.workspace_id',
  ' AND base.batch_id = exception.batch_id',
  ' AND base.item_ordinal = exception.item_ordinal',
  'JOIN struinfo.information_entry AS entry',
  '  ON entry.workspace_id = exception.workspace_id',
  ' AND entry.entry_id = exception.entry_id',
  'WHERE exception.workspace_id = $1 AND exception.batch_id = $2',
  'ORDER BY exception.exception_code, exception.item_ordinal, exception.entry_id',
);
export const LOCK_BULK_INGESTION_ADJUDICATION_TRANSITION_ROWS_SQL = sql(
  'SELECT adjudication.item_ordinal, adjudication.entry_id::text,',
  '  adjudication.current_version::integer AS current_version',
  'FROM struinfo.processing_bulk_ingestion_adjudication AS adjudication',
  'JOIN struinfo.processing_bulk_ingestion_exception AS exception',
  '  ON exception.workspace_id = adjudication.workspace_id',
  ' AND exception.batch_id = adjudication.batch_id',
  ' AND exception.item_ordinal = adjudication.item_ordinal',
  ' AND exception.entry_id = adjudication.entry_id',
  'JOIN struinfo.information_entry AS entry',
  '  ON entry.workspace_id = exception.workspace_id',
  ' AND entry.entry_id = exception.entry_id',
  'WHERE adjudication.workspace_id = $1 AND adjudication.batch_id = $2',
  '  AND exception.exception_code = $3 AND adjudication.status = $4',
  '  AND entry.is_current_structure',
  '  AND entry.current_revision = exception.entry_revision',
  '  AND entry.current_revision_id = exception.entry_revision_id',
  'ORDER BY adjudication.item_ordinal, adjudication.entry_id',
  'FOR UPDATE OF adjudication',
);
export const UPDATE_BULK_INGESTION_ADJUDICATION_SQL = sql(
  'UPDATE struinfo.processing_bulk_ingestion_adjudication SET',
  '  status = $6::varchar, current_version = current_version + 1,',
  "  decided_at = CASE WHEN $6::varchar = 'pending' THEN NULL ELSE CURRENT_TIMESTAMP END,",
  '  updated_at = CURRENT_TIMESTAMP',
  'WHERE workspace_id = $1 AND batch_id = $2 AND item_ordinal = $3',
  '  AND entry_id = $4 AND status = $5 AND current_version = $7',
);
export const LOCK_EXACT_BULK_INGESTION_ADJUDICATION_SQL = sql(
  'SELECT adjudication.status,',
  '  adjudication.current_version::integer AS current_version,',
  '  entry.is_current_structure, entry.current_revision,',
  '  entry.current_revision_id::text',
  'FROM struinfo.processing_bulk_ingestion_adjudication AS adjudication',
  'JOIN struinfo.processing_bulk_ingestion_exception AS exception',
  '  ON exception.workspace_id = adjudication.workspace_id',
  ' AND exception.batch_id = adjudication.batch_id',
  ' AND exception.item_ordinal = adjudication.item_ordinal',
  ' AND exception.entry_id = adjudication.entry_id',
  'JOIN struinfo.information_entry AS entry',
  '  ON entry.workspace_id = exception.workspace_id',
  ' AND entry.entry_id = exception.entry_id',
  'WHERE adjudication.workspace_id = $1 AND adjudication.batch_id = $2',
  '  AND adjudication.item_ordinal = $3 AND adjudication.entry_id = $4',
  '  AND exception.entry_revision = $5',
  '  AND exception.entry_revision_id = $6',
  'FOR UPDATE OF adjudication, entry',
);

type Row = Readonly<Record<string, unknown>>;

export class PostgresBulkIngestionAdjudicationRepository implements BulkIngestionAdjudicationRepositoryPort {
  readonly #pool: PostgresPoolBoundary;

  public constructor(pool: PostgresPoolBoundary) {
    this.#pool = pool;
  }

  public ensureAdjudications(
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
        const ready = await client.query<Row>(READ_READY_BATCH_SQL, [
          workspaceId,
          batchId,
        ]);
        if (ready.rows.length === 0) return false;
        const row = requireOne(ready.rows);
        const snapshotCount = integer(row.snapshot_count, 1);
        if (
          integer(row.enrichment_count) !== snapshotCount ||
          integer(row.succeeded_count) !== snapshotCount
        ) {
          return false;
        }
        await client.query<Row>(INSERT_MISSING_ADJUDICATIONS_SQL, [
          workspaceId,
          batchId,
        ]);
        return true;
      },
    );
  }

  public loadExceptions(
    workspaceIdInput: string,
    batchIdInput: string,
  ): Promise<readonly Readonly<BulkIngestionAdjudicationException>[]> {
    const workspaceId = canonicalUuid(workspaceIdInput);
    const batchId = canonicalUuid(batchIdInput);
    return runPostgresTransaction(
      this.#pool,
      'repeatable_read_only',
      async (client) => {
        const result = await client.query<Row>(
          READ_BULK_INGESTION_ADJUDICATION_EXCEPTIONS_SQL,
          [workspaceId, batchId],
        );
        return Object.freeze(result.rows.map(mapException));
      },
    );
  }

  public transition(
    input: Readonly<{
      workspaceId: string;
      batchId: string;
      exceptionCode: BulkIngestionEnrichmentExceptionCode;
      fromStatus: BulkIngestionAdjudicationStatus;
      toStatus: BulkIngestionAdjudicationStatus;
      expectedCount: number;
    }>,
  ): Promise<
    Readonly<{
      outcome: 'applied' | 'not_found' | 'stale';
      appliedCount: number;
    }>
  > {
    validateTransition(input);
    return runPostgresTransaction(
      this.#pool,
      'read_committed',
      async (client) => {
        await acquireWorkspaceWriteLock(client, input.workspaceId);
        const ready = await client.query<Row>(READ_READY_BATCH_SQL, [
          input.workspaceId,
          input.batchId,
        ]);
        if (ready.rows.length === 0) {
          return Object.freeze({
            outcome: 'not_found' as const,
            appliedCount: 0,
          });
        }
        const locked = await client.query<Row>(
          LOCK_BULK_INGESTION_ADJUDICATION_TRANSITION_ROWS_SQL,
          [
            input.workspaceId,
            input.batchId,
            input.exceptionCode,
            input.fromStatus,
          ],
        );
        if (locked.rows.length !== input.expectedCount) {
          return Object.freeze({outcome: 'stale' as const, appliedCount: 0});
        }
        for (const row of locked.rows) {
          const updated = await client.query<Row>(
            UPDATE_BULK_INGESTION_ADJUDICATION_SQL,
            [
              input.workspaceId,
              input.batchId,
              integer(row.item_ordinal),
              canonicalUuid(row.entry_id),
              input.fromStatus,
              input.toStatus,
              integer(row.current_version, 1),
            ],
          );
          expectOneAffected(updated.rowCount);
        }
        return Object.freeze({
          outcome: 'applied' as const,
          appliedCount: locked.rows.length,
        });
      },
    );
  }

  public transitionExact(
    input: Readonly<{
      workspaceId: string;
      batchId: string;
      decisions: readonly Readonly<BulkIngestionAdjudicationExactDecision>[];
    }>,
  ): Promise<
    Readonly<{
      outcome: 'applied' | 'not_found' | 'stale';
      appliedCount: number;
    }>
  > {
    validateExactTransition(input);
    const decisions = [...input.decisions].sort((left, right) =>
      left.ordinal !== right.ordinal
        ? left.ordinal - right.ordinal
        : left.entryId.localeCompare(right.entryId),
    );
    return runPostgresTransaction(
      this.#pool,
      'read_committed',
      async (client) => {
        await acquireWorkspaceWriteLock(client, input.workspaceId);
        const ready = await client.query<Row>(READ_READY_BATCH_SQL, [
          input.workspaceId,
          input.batchId,
        ]);
        if (ready.rows.length === 0) {
          return Object.freeze({
            outcome: 'not_found' as const,
            appliedCount: 0,
          });
        }
        const locked: Readonly<{
          decision: Readonly<BulkIngestionAdjudicationExactDecision>;
          currentVersion: number;
        }>[] = [];
        for (const decision of decisions) {
          const result = await client.query<Row>(
            LOCK_EXACT_BULK_INGESTION_ADJUDICATION_SQL,
            [
              input.workspaceId,
              input.batchId,
              decision.ordinal,
              decision.entryId,
              decision.entryRevision,
              decision.entryRevisionId,
            ],
          );
          if (result.rows.length !== 1) {
            return Object.freeze({outcome: 'stale' as const, appliedCount: 0});
          }
          const row = requireOne(result.rows);
          if (
            enumValue(row.status, BULK_INGESTION_ADJUDICATION_STATUSES) !==
              decision.fromStatus ||
            integer(row.current_version, 1) !== decision.expectedVersion ||
            row.is_current_structure !== true ||
            integer(row.current_revision, 1) !==
              decision.expectedCurrentEntryRevision ||
            canonicalUuid(row.current_revision_id) !==
              decision.expectedCurrentEntryRevisionId
          ) {
            return Object.freeze({outcome: 'stale' as const, appliedCount: 0});
          }
          locked.push(
            Object.freeze({
              decision,
              currentVersion: integer(row.current_version, 1),
            }),
          );
        }
        for (const item of locked) {
          const updated = await client.query<Row>(
            UPDATE_BULK_INGESTION_ADJUDICATION_SQL,
            [
              input.workspaceId,
              input.batchId,
              item.decision.ordinal,
              item.decision.entryId,
              item.decision.fromStatus,
              item.decision.toStatus,
              item.currentVersion,
            ],
          );
          expectOneAffected(updated.rowCount);
        }
        return Object.freeze({
          outcome: 'applied' as const,
          appliedCount: locked.length,
        });
      },
    );
  }
}

function mapException(row: Row): Readonly<BulkIngestionAdjudicationException> {
  if (
    typeof row.is_private !== 'boolean' ||
    typeof row.is_current !== 'boolean'
  ) {
    throw new PostgresAdapterError();
  }
  return Object.freeze({
    workspaceId: canonicalUuid(row.workspace_id),
    batchId: canonicalUuid(row.batch_id),
    ordinal: integer(row.item_ordinal),
    snapshotId: canonicalUuid(row.snapshot_id),
    isPrivate: row.is_private,
    entryId: canonicalUuid(row.entry_id),
    entryRevision: integer(row.entry_revision, 1),
    entryRevisionId: canonicalUuid(row.entry_revision_id),
    currentEntryRevision: integer(row.current_revision, 1),
    currentEntryRevisionId: canonicalUuid(row.current_revision_id),
    isCurrent: row.is_current,
    exceptionCode: enumValue(
      row.exception_code,
      BULK_INGESTION_ENRICHMENT_EXCEPTION_CODES,
    ),
    status: enumValue(row.status, BULK_INGESTION_ADJUDICATION_STATUSES),
    version: integer(row.current_version, 1),
  });
}

function validateTransition(
  input: Readonly<{
    workspaceId: string;
    batchId: string;
    exceptionCode: BulkIngestionEnrichmentExceptionCode;
    fromStatus: BulkIngestionAdjudicationStatus;
    toStatus: BulkIngestionAdjudicationStatus;
    expectedCount: number;
  }>,
): void {
  canonicalUuid(input.workspaceId);
  canonicalUuid(input.batchId);
  if (
    !BULK_INGESTION_ENRICHMENT_EXCEPTION_CODES.includes(input.exceptionCode) ||
    !BULK_INGESTION_ADJUDICATION_STATUSES.includes(input.fromStatus) ||
    !BULK_INGESTION_ADJUDICATION_STATUSES.includes(input.toStatus) ||
    input.fromStatus === input.toStatus ||
    !Number.isSafeInteger(input.expectedCount) ||
    input.expectedCount < 1 ||
    input.expectedCount > 50_000
  ) {
    throw new PostgresAdapterError();
  }
}

function validateExactTransition(
  input: Readonly<{
    workspaceId: string;
    batchId: string;
    decisions: readonly Readonly<BulkIngestionAdjudicationExactDecision>[];
  }>,
): void {
  canonicalUuid(input.workspaceId);
  canonicalUuid(input.batchId);
  if (
    input.decisions.length < 1 ||
    input.decisions.length > BULK_INGESTION_CODEX_PACKET_MAXIMUM_ITEMS
  ) {
    throw new PostgresAdapterError();
  }
  const identities = new Set<string>();
  for (const decision of input.decisions) {
    const identity = `${decision.ordinal.toString()}:${decision.entryId}`;
    if (
      !Number.isSafeInteger(decision.ordinal) ||
      decision.ordinal < 0 ||
      canonicalUuid(decision.entryId) !== decision.entryId ||
      !Number.isSafeInteger(decision.entryRevision) ||
      decision.entryRevision < 1 ||
      canonicalUuid(decision.entryRevisionId) !== decision.entryRevisionId ||
      !Number.isSafeInteger(decision.expectedVersion) ||
      decision.expectedVersion < 1 ||
      !BULK_INGESTION_ADJUDICATION_STATUSES.includes(decision.fromStatus) ||
      !BULK_INGESTION_ADJUDICATION_STATUSES.includes(decision.toStatus) ||
      decision.fromStatus === decision.toStatus ||
      !Number.isSafeInteger(decision.expectedCurrentEntryRevision) ||
      decision.expectedCurrentEntryRevision < 1 ||
      canonicalUuid(decision.expectedCurrentEntryRevisionId) !==
        decision.expectedCurrentEntryRevisionId ||
      identities.has(identity)
    ) {
      throw new PostgresAdapterError();
    }
    identities.add(identity);
  }
}

function requireOne(rows: readonly Row[]): Row {
  if (rows.length !== 1 || rows[0] === undefined) {
    throw new PostgresAdapterError();
  }
  return rows[0];
}
