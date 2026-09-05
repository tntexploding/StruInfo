import {INFORMATION_ENTRY_TERM_TOKENIZER_VERSION} from '../../../modules/entries/information_entry_search_index_contract.js';
import type {M2P5cDatabaseObservation} from '../../../operations/m2_p5c_operational_status.js';
import type {PostgresPoolBoundary} from './postgres_pool.js';
import {runPostgresTransaction} from './postgres_transaction.js';
import {PostgresAdapterError} from './postgres_values.js';

export const READ_POSTGRES_OPERATIONAL_STATUS_SQL = [
  'SELECT',
  '  pg_database_size(current_database())::text AS database_bytes,',
  '  (SELECT COALESCE(sum(byte_length), 0)::text FROM struinfo.evidence_blob WHERE workspace_id = $1) AS evidence_blob_bytes,',
  '  (SELECT count(*)::text FROM struinfo.resource WHERE workspace_id = $1) AS resource_count,',
  '  (SELECT count(*)::text FROM struinfo.snapshot WHERE workspace_id = $1) AS snapshot_count,',
  '  (SELECT count(*)::text FROM struinfo.fragment WHERE workspace_id = $1) AS fragment_count,',
  '  (SELECT count(*)::text FROM struinfo.information_entry WHERE workspace_id = $1 AND is_current_structure) AS current_entry_count,',
  '  (SELECT count(*)::text FROM struinfo.information_entry_association_projection WHERE workspace_id = $1) AS association_projection_count,',
  '  (SELECT count(*)::text',
  '     FROM struinfo.information_entry AS entry',
  '     JOIN struinfo.information_entry_search_projection AS projection',
  '       ON projection.workspace_id = entry.workspace_id',
  '      AND projection.entry_id = entry.entry_id',
  '      AND projection.entry_revision = entry.current_revision',
  '      AND projection.entry_revision_id = entry.current_revision_id',
  '      AND projection.tokenizer_version = $3',
  '    WHERE entry.workspace_id = $1 AND entry.is_current_structure) AS current_search_projection_count,',
  '  (SELECT count(*)::text',
  '     FROM struinfo.information_entry AS entry',
  '     LEFT JOIN struinfo.information_entry_search_projection AS projection',
  '       ON projection.workspace_id = entry.workspace_id',
  '      AND projection.entry_id = entry.entry_id',
  '      AND projection.entry_revision = entry.current_revision',
  '      AND projection.entry_revision_id = entry.current_revision_id',
  '      AND projection.tokenizer_version = $3',
  '    WHERE entry.workspace_id = $1',
  '      AND entry.is_current_structure',
  '      AND projection.entry_id IS NULL) AS missing_search_projection_count,',
  '  (SELECT count(*)::text FROM struinfo.processing_run WHERE workspace_id = $1) AS processing_run_count,',
  "  (SELECT count(*)::text FROM struinfo.processing_run WHERE workspace_id = $1 AND status = 'failed') AS failed_processing_run_count,",
  "  (SELECT count(*)::text FROM struinfo.processing_run WHERE workspace_id = $1 AND status = 'running' AND updated_at < CURRENT_TIMESTAMP - ($2::integer * INTERVAL '1 minute')) AS stale_running_processing_run_count,",
  "  (SELECT count(*)::text FROM struinfo.processing_bulk_ingestion_batch WHERE workspace_id = $1 AND status = 'failed') AS failed_bulk_ingestion_batch_count,",
  "  (SELECT count(*)::text FROM struinfo.processing_proposal WHERE workspace_id = $1 AND status = 'pending_review') AS pending_proposal_count,",
  "  (SELECT count(*)::text FROM struinfo.processing_entry_automation_work_item WHERE workspace_id = $1 AND state = 'pending') AS pending_owner_work_item_count",
].join('\n');

interface OperationalStatusRow extends Readonly<Record<string, unknown>> {
  readonly database_bytes: unknown;
  readonly evidence_blob_bytes: unknown;
  readonly resource_count: unknown;
  readonly snapshot_count: unknown;
  readonly fragment_count: unknown;
  readonly current_entry_count: unknown;
  readonly association_projection_count: unknown;
  readonly current_search_projection_count: unknown;
  readonly missing_search_projection_count: unknown;
  readonly processing_run_count: unknown;
  readonly failed_processing_run_count: unknown;
  readonly stale_running_processing_run_count: unknown;
  readonly failed_bulk_ingestion_batch_count: unknown;
  readonly pending_proposal_count: unknown;
  readonly pending_owner_work_item_count: unknown;
}

export class PostgresOperationalStatusReader {
  readonly #pool: PostgresPoolBoundary;
  readonly #workspaceId: string;

  public constructor(pool: PostgresPoolBoundary, workspaceId: string) {
    this.#pool = pool;
    this.#workspaceId = workspaceId;
  }

  public read(
    maxRunningAgeMinutes: number,
  ): Promise<Readonly<M2P5cDatabaseObservation>> {
    if (
      !Number.isSafeInteger(maxRunningAgeMinutes) ||
      maxRunningAgeMinutes < 1 ||
      maxRunningAgeMinutes > 10_080
    ) {
      throw new PostgresAdapterError();
    }
    return runPostgresTransaction(
      this.#pool,
      'repeatable_read_only',
      async (client) => {
        const result = await client.query<OperationalStatusRow>(
          READ_POSTGRES_OPERATIONAL_STATUS_SQL,
          [
            this.#workspaceId,
            maxRunningAgeMinutes,
            INFORMATION_ENTRY_TERM_TOKENIZER_VERSION,
          ],
        );
        if (result.rows.length !== 1) throw new PostgresAdapterError();
        return mapOperationalStatus(result.rows[0]);
      },
    );
  }
}

function mapOperationalStatus(
  row: OperationalStatusRow | undefined,
): Readonly<M2P5cDatabaseObservation> {
  if (row === undefined) throw new PostgresAdapterError();
  return Object.freeze({
    databaseBytes: decimal(row.database_bytes),
    evidenceBlobBytes: decimal(row.evidence_blob_bytes),
    resourceCount: count(row.resource_count),
    snapshotCount: count(row.snapshot_count),
    fragmentCount: count(row.fragment_count),
    currentEntryCount: count(row.current_entry_count),
    associationProjectionCount: count(row.association_projection_count),
    currentSearchProjectionCount: count(row.current_search_projection_count),
    missingSearchProjectionCount: count(row.missing_search_projection_count),
    processingRunCount: count(row.processing_run_count),
    failedProcessingRunCount: count(row.failed_processing_run_count),
    staleRunningProcessingRunCount: count(
      row.stale_running_processing_run_count,
    ),
    failedBulkIngestionBatchCount: count(row.failed_bulk_ingestion_batch_count),
    pendingProposalCount: count(row.pending_proposal_count),
    pendingOwnerWorkItemCount: count(row.pending_owner_work_item_count),
  });
}

function decimal(value: unknown): string {
  if (typeof value !== 'string' || !/^(0|[1-9][0-9]*)$/u.test(value)) {
    throw new PostgresAdapterError();
  }
  return value;
}

function count(value: unknown): number {
  const canonical = decimal(value);
  const parsed = BigInt(canonical);
  if (parsed > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new PostgresAdapterError();
  }
  return Number(parsed);
}
