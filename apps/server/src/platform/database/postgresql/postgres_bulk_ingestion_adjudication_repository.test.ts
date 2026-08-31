import {describe, expect, it} from 'vitest';

import {
  LOCK_EXACT_BULK_INGESTION_ADJUDICATION_SQL,
  LOCK_BULK_INGESTION_ADJUDICATION_TRANSITION_ROWS_SQL,
  READ_BULK_INGESTION_ADJUDICATION_EXCEPTIONS_SQL,
  UPDATE_BULK_INGESTION_ADJUDICATION_SQL,
} from './postgres_bulk_ingestion_adjudication_repository.js';

describe('Postgres bulk-ingestion adjudication repository', () => {
  it('derives stale state from current Entry identity without loading content', () => {
    expect(READ_BULK_INGESTION_ADJUDICATION_EXCEPTIONS_SQL).toContain(
      'entry.current_revision = exception.entry_revision',
    );
    expect(READ_BULK_INGESTION_ADJUDICATION_EXCEPTIONS_SQL).toContain(
      'entry.current_revision_id = exception.entry_revision_id',
    );
    expect(READ_BULK_INGESTION_ADJUDICATION_EXCEPTIONS_SQL).toContain(
      'entry.is_current_structure',
    );
    expect(READ_BULK_INGESTION_ADJUDICATION_EXCEPTIONS_SQL).not.toMatch(
      /\b(body|title|source_text|provider_payload|secret|prompt)\b/iu,
    );
  });

  it('locks only current rows matching the exact code and prior status', () => {
    expect(LOCK_BULK_INGESTION_ADJUDICATION_TRANSITION_ROWS_SQL).toContain(
      'exception.exception_code = $3',
    );
    expect(LOCK_BULK_INGESTION_ADJUDICATION_TRANSITION_ROWS_SQL).toContain(
      'adjudication.status = $4',
    );
    expect(LOCK_BULK_INGESTION_ADJUDICATION_TRANSITION_ROWS_SQL).toContain(
      'entry.current_revision = exception.entry_revision',
    );
    expect(LOCK_BULK_INGESTION_ADJUDICATION_TRANSITION_ROWS_SQL).toContain(
      'FOR UPDATE OF adjudication',
    );
  });

  it('casts the reused adjudication status parameter before PostgreSQL type inference', () => {
    expect(UPDATE_BULK_INGESTION_ADJUDICATION_SQL).toContain(
      'status = $6::varchar',
    );
    expect(UPDATE_BULK_INGESTION_ADJUDICATION_SQL).toContain(
      "$6::varchar = 'pending'",
    );
  });

  it('locks one exact exception identity and exposes current-revision fencing', () => {
    expect(LOCK_EXACT_BULK_INGESTION_ADJUDICATION_SQL).toContain(
      'adjudication.item_ordinal = $3 AND adjudication.entry_id = $4',
    );
    expect(LOCK_EXACT_BULK_INGESTION_ADJUDICATION_SQL).toContain(
      'exception.entry_revision = $5',
    );
    expect(LOCK_EXACT_BULK_INGESTION_ADJUDICATION_SQL).toContain(
      'exception.entry_revision_id = $6',
    );
    expect(LOCK_EXACT_BULK_INGESTION_ADJUDICATION_SQL).toContain(
      'entry.current_revision_id::text',
    );
    expect(LOCK_EXACT_BULK_INGESTION_ADJUDICATION_SQL).toContain(
      'FOR UPDATE OF adjudication, entry',
    );
    expect(LOCK_EXACT_BULK_INGESTION_ADJUDICATION_SQL).not.toMatch(
      /\b(body|title|source_text|provider_payload|secret|prompt)\b/iu,
    );
  });
});
