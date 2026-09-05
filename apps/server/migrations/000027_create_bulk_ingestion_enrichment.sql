CREATE TABLE struinfo.processing_bulk_ingestion_enrichment_item (
  workspace_id uuid NOT NULL,
  batch_id uuid NOT NULL,
  item_ordinal integer NOT NULL,
  status varchar(20) NOT NULL DEFAULT 'pending',
  attempt integer NOT NULL DEFAULT 0,
  claimed_run_id uuid,
  rules_sha256 varchar(64),
  result_entry_count integer,
  revised_entry_count integer,
  added_tag_count integer,
  association_projection_count integer,
  exception_entry_count integer,
  error_code varchar(120),
  current_version bigint NOT NULL DEFAULT 1,
  started_at timestamp with time zone,
  finished_at timestamp with time zone,
  updated_at timestamp with time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT processing_bulk_ingestion_enrichment_item_pk
    PRIMARY KEY (workspace_id, batch_id, item_ordinal),
  CONSTRAINT processing_bulk_ingestion_enrichment_item_batch_item_fk
    FOREIGN KEY (workspace_id, batch_id, item_ordinal)
    REFERENCES struinfo.processing_bulk_ingestion_item (
      workspace_id,
      batch_id,
      item_ordinal
    ),
  CONSTRAINT processing_bulk_ingestion_enrichment_item_run_fk
    FOREIGN KEY (workspace_id, claimed_run_id)
    REFERENCES struinfo.processing_run (workspace_id, run_id)
    DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT processing_bulk_ingestion_enrichment_item_status_ck
    CHECK (status IN ('pending', 'running', 'succeeded', 'failed')),
  CONSTRAINT processing_bulk_ingestion_enrichment_item_attempt_ck
    CHECK (attempt >= 0),
  CONSTRAINT processing_bulk_ingestion_enrichment_item_rules_sha_ck
    CHECK (rules_sha256 IS NULL OR rules_sha256 ~ '^[0-9a-f]{64}$'),
  CONSTRAINT processing_bulk_ingestion_enrichment_item_counts_ck
    CHECK (
      (result_entry_count IS NULL OR result_entry_count >= 1)
      AND (revised_entry_count IS NULL OR revised_entry_count >= 0)
      AND (added_tag_count IS NULL OR added_tag_count >= 0)
      AND (association_projection_count IS NULL
        OR association_projection_count >= 0)
      AND (exception_entry_count IS NULL OR exception_entry_count >= 0)
    ),
  CONSTRAINT processing_bulk_ingestion_enrichment_item_result_ck
    CHECK (
      (status = 'pending'
        AND claimed_run_id IS NULL AND rules_sha256 IS NULL
        AND result_entry_count IS NULL AND revised_entry_count IS NULL
        AND added_tag_count IS NULL AND association_projection_count IS NULL
        AND exception_entry_count IS NULL AND error_code IS NULL
        AND started_at IS NULL AND finished_at IS NULL)
      OR (status = 'running'
        AND claimed_run_id IS NOT NULL AND rules_sha256 IS NOT NULL
        AND result_entry_count IS NULL AND revised_entry_count IS NULL
        AND added_tag_count IS NULL AND association_projection_count IS NULL
        AND exception_entry_count IS NULL AND error_code IS NULL
        AND started_at IS NOT NULL AND finished_at IS NULL)
      OR (status = 'succeeded'
        AND claimed_run_id IS NOT NULL AND rules_sha256 IS NOT NULL
        AND result_entry_count IS NOT NULL AND revised_entry_count IS NOT NULL
        AND added_tag_count IS NOT NULL
        AND association_projection_count IS NOT NULL
        AND exception_entry_count IS NOT NULL AND error_code IS NULL
        AND started_at IS NOT NULL AND finished_at IS NOT NULL)
      OR (status = 'failed'
        AND claimed_run_id IS NOT NULL AND rules_sha256 IS NOT NULL
        AND result_entry_count IS NULL AND revised_entry_count IS NULL
        AND added_tag_count IS NULL AND association_projection_count IS NULL
        AND exception_entry_count IS NULL
        AND error_code IS NOT NULL AND btrim(error_code) <> ''
        AND started_at IS NOT NULL AND finished_at IS NOT NULL)
    ),
  CONSTRAINT processing_bulk_ingestion_enrichment_item_version_ck
    CHECK (current_version >= 1)
);

CREATE TABLE struinfo.processing_bulk_ingestion_exception (
  workspace_id uuid NOT NULL,
  batch_id uuid NOT NULL,
  item_ordinal integer NOT NULL,
  entry_id uuid NOT NULL,
  entry_revision integer NOT NULL,
  entry_revision_id uuid NOT NULL,
  exception_code varchar(80) NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT processing_bulk_ingestion_exception_pk
    PRIMARY KEY (workspace_id, batch_id, item_ordinal, entry_id),
  CONSTRAINT processing_bulk_ingestion_exception_item_fk
    FOREIGN KEY (workspace_id, batch_id, item_ordinal)
    REFERENCES struinfo.processing_bulk_ingestion_enrichment_item (
      workspace_id,
      batch_id,
      item_ordinal
    ),
  CONSTRAINT processing_bulk_ingestion_exception_entry_fk
    FOREIGN KEY (workspace_id, entry_id)
    REFERENCES struinfo.information_entry (workspace_id, entry_id),
  CONSTRAINT processing_bulk_ingestion_exception_revision_ck
    CHECK (entry_revision >= 1),
  CONSTRAINT processing_bulk_ingestion_exception_code_ck
    CHECK (exception_code IN (
      'automatic_tagging_disabled',
      'no_deterministic_tags',
      'keyword_capacity_reached'
    ))
);

CREATE INDEX processing_bulk_ingestion_enrichment_pending_idx
  ON struinfo.processing_bulk_ingestion_enrichment_item (
    workspace_id,
    batch_id,
    status,
    item_ordinal
  );

CREATE INDEX processing_bulk_ingestion_exception_code_idx
  ON struinfo.processing_bulk_ingestion_exception (
    workspace_id,
    batch_id,
    exception_code,
    item_ordinal
  );
