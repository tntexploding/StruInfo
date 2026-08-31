import {readFile} from 'node:fs/promises';

import {describe, expect, it} from 'vitest';

const MIGRATION = new URL(
  '../../../migrations/000026_create_bulk_ingestion_batches.sql',
  import.meta.url,
);
const ENRICHMENT_MIGRATION = new URL(
  '../../../migrations/000027_create_bulk_ingestion_enrichment.sql',
  import.meta.url,
);
const ADJUDICATION_MIGRATION = new URL(
  '../../../migrations/000028_create_bulk_ingestion_adjudications.sql',
  import.meta.url,
);
const CLASSIFICATION_EXCEPTION_MIGRATION = new URL(
  '../../../migrations/000029_add_bulk_ingestion_classification_exception.sql',
  import.meta.url,
);
const CLASSIFICATION_DIAGNOSTIC_MIGRATION = new URL(
  '../../../migrations/000030_refine_bulk_ingestion_classification_exceptions.sql',
  import.meta.url,
);
const RUNTIME_GRANTS = new URL(
  '../../../../../deploy/postgresql/apply-runtime-grants.sql',
  import.meta.url,
);

describe('M2-P0A bulk ingestion migration', () => {
  it('stores recoverable batch control state without source or provider payloads', async () => {
    const sql = await readFile(MIGRATION, 'utf8');

    expect(sql).toContain(
      'CREATE TABLE struinfo.processing_bulk_ingestion_batch',
    );
    expect(sql).toContain(
      'CREATE TABLE struinfo.processing_bulk_ingestion_item',
    );
    expect(sql).toContain("'pause_requested'");
    expect(sql).toContain('UNIQUE (workspace_id, idempotency_key)');
    expect(sql).toContain('UNIQUE (workspace_id, batch_id, snapshot_id)');
    expect(sql).toContain('REFERENCES struinfo.processing_run');
    expect(sql).toContain('REFERENCES struinfo.snapshot');
    expect(sql).not.toMatch(/\bjsonb?\b/iu);
    expect(sql).not.toMatch(/\b(source_text|body|provider_payload|secret)\b/iu);
  });
});

describe('M2-P0B bulk ingestion enrichment migration', () => {
  it('stores recoverable enrichment state and typed exceptions without payload copies', async () => {
    const sql = await readFile(ENRICHMENT_MIGRATION, 'utf8');

    expect(sql).toContain(
      'CREATE TABLE struinfo.processing_bulk_ingestion_enrichment_item',
    );
    expect(sql).toContain(
      'CREATE TABLE struinfo.processing_bulk_ingestion_exception',
    );
    expect(sql).toContain('REFERENCES struinfo.processing_bulk_ingestion_item');
    expect(sql).toContain('REFERENCES struinfo.information_entry');
    expect(sql).not.toContain('information_entry_revision');
    expect(sql).toContain("'automatic_tagging_disabled'");
    expect(sql).toContain("'no_deterministic_tags'");
    expect(sql).toContain("'keyword_capacity_reached'");
    expect(sql).not.toMatch(/\bjsonb?\b/iu);
    expect(sql).not.toMatch(
      /\b(source_text|body|title|url|provider_payload|secret)\b/iu,
    );
  });
});

describe('M2-P0C bulk ingestion adjudication migration', () => {
  it('stores only current exception decisions without copying Entry or Provider payloads', async () => {
    const sql = await readFile(ADJUDICATION_MIGRATION, 'utf8');

    expect(sql).toContain(
      'CREATE TABLE struinfo.processing_bulk_ingestion_adjudication',
    );
    expect(sql).toContain(
      'REFERENCES struinfo.processing_bulk_ingestion_exception',
    );
    expect(sql).toContain("'pending'");
    expect(sql).toContain("'accepted'");
    expect(sql).toContain("'manual_review'");
    expect(sql).toContain("'deferred'");
    expect(sql).not.toMatch(/\bjsonb?\b/iu);
    expect(sql).not.toMatch(
      /\b(source_text|body|title|url|provider_payload|secret|prompt)\b/iu,
    );
  });
});

describe('M2-P1C deterministic classification migration', () => {
  it('admits the closed classification exception without adding payload storage', async () => {
    const sql = await readFile(CLASSIFICATION_EXCEPTION_MIGRATION, 'utf8');

    expect(sql).toContain('processing_bulk_ingestion_exception_code_ck');
    expect(sql).toContain("'classification_incomplete'");
    expect(sql).not.toMatch(/\bjsonb?\b/iu);
    expect(sql).not.toMatch(
      /\b(source_text|body|title|url|provider_payload|secret|prompt)\b/iu,
    );
  });

  it('lets refresh remove stale exception adjudications before rebuilding them', async () => {
    const sql = await readFile(RUNTIME_GRANTS, 'utf8');
    const grantStart = sql.indexOf('GRANT DELETE ON TABLE');
    const deleteGrant = sql.slice(
      grantStart,
      sql.indexOf('TO struinfo_tm2_runtime;', grantStart),
    );

    expect(deleteGrant).toContain(
      'struinfo.processing_bulk_ingestion_exception',
    );
    expect(deleteGrant).toContain(
      'struinfo.processing_bulk_ingestion_adjudication',
    );
  });
});

describe('M2-P2A classification diagnostic migration', () => {
  it('admits only the legacy and refined closed exception codes', async () => {
    const sql = await readFile(CLASSIFICATION_DIAGNOSTIC_MIGRATION, 'utf8');

    expect(sql).toContain('processing_bulk_ingestion_exception_code_ck');
    expect(sql).toContain('classification_incomplete');
    expect(sql).toContain('classification_no_signal');
    expect(sql).toContain('classification_type_missing');
    expect(sql).toContain('classification_domain_missing');
    expect(sql).toContain('classification_tied');
    expect(sql).not.toMatch(/\bjsonb?\b/iu);
    expect(sql).not.toMatch(
      /\b(source_text|body|title|url|provider_payload|secret|prompt)\b/iu,
    );
  });
});
