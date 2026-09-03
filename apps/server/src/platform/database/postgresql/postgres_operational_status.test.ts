import {describe, expect, it} from 'vitest';

import {INFORMATION_ENTRY_TERM_TOKENIZER_VERSION} from '../../../modules/entries/information_entry_search_index_contract.js';
import {
  PostgresOperationalStatusReader,
  READ_POSTGRES_OPERATIONAL_STATUS_SQL,
} from './postgres_operational_status.js';
import type {
  PostgresClientBoundary,
  PostgresPoolBoundary,
  PostgresQueryResult,
} from './postgres_pool.js';
import {
  BEGIN_REPEATABLE_READ_ONLY_SQL,
  COMMIT_TRANSACTION_SQL,
} from './postgres_transaction.js';

const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';

describe('Postgres operational status reader', () => {
  it('reads one parameterized repeatable-read snapshot and owns mapped counts', async () => {
    const row = operationalRow();
    const client = new FakeClient(row);
    const reader = new PostgresOperationalStatusReader(
      new FakePool(client),
      WORKSPACE_ID,
    );

    await expect(reader.read(60)).resolves.toEqual({
      databaseBytes: '4096',
      evidenceBlobBytes: '2048',
      resourceCount: 2,
      snapshotCount: 3,
      fragmentCount: 8,
      currentEntryCount: 5,
      associationProjectionCount: 4,
      currentSearchProjectionCount: 5,
      missingSearchProjectionCount: 0,
      processingRunCount: 6,
      failedProcessingRunCount: 1,
      staleRunningProcessingRunCount: 2,
      failedBulkIngestionBatchCount: 3,
      pendingProposalCount: 4,
      pendingOwnerWorkItemCount: 5,
    });
    expect(client.calls).toEqual([
      {sql: BEGIN_REPEATABLE_READ_ONLY_SQL, parameters: []},
      {
        sql: READ_POSTGRES_OPERATIONAL_STATUS_SQL,
        parameters: [
          WORKSPACE_ID,
          60,
          INFORMATION_ENTRY_TERM_TOKENIZER_VERSION,
        ],
      },
      {sql: COMMIT_TRANSACTION_SQL, parameters: []},
    ]);
    expect(client.releaseCount).toBe(1);
    expect(READ_POSTGRES_OPERATIONAL_STATUS_SQL).not.toMatch(
      /\b(?:INSERT|UPDATE|DELETE|TRUNCATE)\b/iu,
    );
  });

  it('rejects invalid thresholds and malformed database values', async () => {
    const reader = new PostgresOperationalStatusReader(
      new FakePool(new FakeClient({...operationalRow(), fragment_count: '-1'})),
      WORKSPACE_ID,
    );
    expect(() => reader.read(0)).toThrow(
      'PostgreSQL adapter operation failed.',
    );
    await expect(reader.read(60)).rejects.toThrow(
      'PostgreSQL transaction failed.',
    );
  });
});

function operationalRow(): Readonly<Record<string, unknown>> {
  return Object.freeze({
    database_bytes: '4096',
    evidence_blob_bytes: '2048',
    resource_count: '2',
    snapshot_count: '3',
    fragment_count: '8',
    current_entry_count: '5',
    association_projection_count: '4',
    current_search_projection_count: '5',
    missing_search_projection_count: '0',
    processing_run_count: '6',
    failed_processing_run_count: '1',
    stale_running_processing_run_count: '2',
    failed_bulk_ingestion_batch_count: '3',
    pending_proposal_count: '4',
    pending_owner_work_item_count: '5',
  });
}

class FakePool implements PostgresPoolBoundary {
  readonly #client: FakeClient;

  public constructor(client: FakeClient) {
    this.#client = client;
  }

  public query<Row extends Readonly<Record<string, unknown>>>(): Promise<
    PostgresQueryResult<Row>
  > {
    return Promise.resolve({rows: [], rowCount: 0});
  }

  public connect(): Promise<PostgresClientBoundary> {
    return Promise.resolve(this.#client);
  }

  public end(): Promise<void> {
    return Promise.resolve();
  }
}

class FakeClient implements PostgresClientBoundary {
  public readonly calls: {
    readonly sql: string;
    readonly parameters: readonly unknown[];
  }[] = [];
  public releaseCount = 0;
  readonly #row: Readonly<Record<string, unknown>>;

  public constructor(row: Readonly<Record<string, unknown>>) {
    this.#row = row;
  }

  public query<Row extends Readonly<Record<string, unknown>>>(
    sql: string,
    parameters: readonly unknown[] = [],
  ): Promise<PostgresQueryResult<Row>> {
    this.calls.push({sql, parameters: [...parameters]});
    const rows =
      sql === READ_POSTGRES_OPERATIONAL_STATUS_SQL ? [this.#row] : [];
    return Promise.resolve({
      rows: rows as readonly Row[],
      rowCount: rows.length,
    });
  }

  public executeSimple<Row extends Readonly<Record<string, unknown>>>(
    statement: string,
    parameters: readonly unknown[],
  ): Promise<PostgresQueryResult<Row>> {
    return this.query(statement, parameters);
  }

  public release(): void {
    this.releaseCount += 1;
  }
}
