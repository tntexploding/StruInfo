import {describe, expect, it} from 'vitest';

import {
  FAIL_ORPHANED_BULK_INGESTION_ENRICHMENT_RUNS_SQL,
  READ_BULK_INGESTION_ENRICHMENT_BASE_BATCH_SQL,
} from './postgres_bulk_ingestion_enrichment_repository.js';

describe('Postgres bulk-ingestion enrichment repository', () => {
  it('counts durable ProcessingRun attempts even before an item was claimed', () => {
    expect(READ_BULK_INGESTION_ENRICHMENT_BASE_BATCH_SQL).toContain(
      'SELECT max(run.attempt)',
    );
    expect(READ_BULK_INGESTION_ENRICHMENT_BASE_BATCH_SQL).toContain(
      "run.idempotency_key LIKE ('m2-p0b:' || batch.batch_id::text || ':%')",
    );
    expect(READ_BULK_INGESTION_ENRICHMENT_BASE_BATCH_SQL).toContain(
      'AS enrichment_attempt',
    );
  });

  it('closes only orphaned running P0B attempts for the exact batch', () => {
    expect(FAIL_ORPHANED_BULK_INGESTION_ENRICHMENT_RUNS_SQL).toContain(
      "status = 'running'",
    );
    expect(FAIL_ORPHANED_BULK_INGESTION_ENRICHMENT_RUNS_SQL).toContain(
      "idempotency_key LIKE ('m2-p0b:' || $2::uuid::text || ':%')",
    );
  });
});
