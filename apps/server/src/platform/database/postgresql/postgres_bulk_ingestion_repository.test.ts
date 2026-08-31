import {describe, expect, it} from 'vitest';

import {
  expectOptionalSingleAffected,
  FINISH_BULK_INGESTION_BATCH_SQL,
  LIST_BULK_INGESTION_CANDIDATES_SQL,
} from './postgres_bulk_ingestion_repository.js';

describe('Postgres bulk-ingestion repository', () => {
  it('plans only unmaterialized section snapshots through a privacy-scoped read', () => {
    expect(LIST_BULK_INGESTION_CANDIDATES_SQL).toContain(
      "($2 = 'public_only' AND NOT r.is_private)",
    );
    expect(LIST_BULK_INGESTION_CANDIDATES_SQL).toContain(
      "($2 = 'private_only' AND r.is_private)",
    );
    expect(LIST_BULK_INGESTION_CANDIDATES_SQL).toContain(
      "n.node_kind = 'section'",
    );
    expect(LIST_BULK_INGESTION_CANDIDATES_SQL).toContain(
      'entry.is_current_structure',
    );
    expect(LIST_BULK_INGESTION_CANDIDATES_SQL).toContain(
      'ORDER BY s.captured_at, s.snapshot_id',
    );
    expect(LIST_BULK_INGESTION_CANDIDATES_SQL).toContain('LIMIT $3');
    expect(LIST_BULK_INGESTION_CANDIDATES_SQL).not.toMatch(
      /\b(body|selected_text|provider_payload|secret)\b/iu,
    );
  });

  it('casts the reused batch status parameter before PostgreSQL type inference', () => {
    expect(FINISH_BULK_INGESTION_BATCH_SQL).toContain('status = $3::varchar');
    expect(FINISH_BULK_INGESTION_BATCH_SQL).toContain(
      "$3::varchar IN ('succeeded', 'failed')",
    );
  });

  it('recovers a batch after its ProcessingRun was already cancelled', () => {
    expect(() => {
      expectOptionalSingleAffected(0);
    }).not.toThrow();
    expect(() => {
      expectOptionalSingleAffected(1);
    }).not.toThrow();
    expect(() => {
      expectOptionalSingleAffected(2);
    }).toThrow();
    expect(() => {
      expectOptionalSingleAffected(null);
    }).toThrow();
  });
});
