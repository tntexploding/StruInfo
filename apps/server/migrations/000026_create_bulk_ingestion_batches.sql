CREATE TABLE struinfo.processing_bulk_ingestion_batch (
  workspace_id uuid NOT NULL,
  batch_id uuid NOT NULL,
  idempotency_key varchar(160) NOT NULL,
  request_sha256 varchar(64) NOT NULL,
  plan_sha256 varchar(64) NOT NULL,
  privacy_scope varchar(20) NOT NULL,
  status varchar(24) NOT NULL DEFAULT 'planned',
  active_run_id uuid,
  attempt integer NOT NULL DEFAULT 0,
  snapshot_count integer NOT NULL,
  planned_entry_count integer NOT NULL,
  succeeded_snapshot_count integer NOT NULL DEFAULT 0,
  succeeded_entry_count integer NOT NULL DEFAULT 0,
  failed_snapshot_count integer NOT NULL DEFAULT 0,
  current_version bigint NOT NULL DEFAULT 1,
  created_at timestamp with time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
  started_at timestamp with time zone,
  finished_at timestamp with time zone,
  updated_at timestamp with time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT processing_bulk_ingestion_batch_pk
    PRIMARY KEY (workspace_id, batch_id),
  CONSTRAINT processing_bulk_ingestion_batch_key_uq
    UNIQUE (workspace_id, idempotency_key),
  CONSTRAINT processing_bulk_ingestion_batch_workspace_fk
    FOREIGN KEY (workspace_id)
    REFERENCES struinfo.workspace (workspace_id),
  CONSTRAINT processing_bulk_ingestion_batch_active_run_fk
    FOREIGN KEY (workspace_id, active_run_id)
    REFERENCES struinfo.processing_run (workspace_id, run_id)
    DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT processing_bulk_ingestion_batch_request_sha_ck
    CHECK (request_sha256 ~ '^[0-9a-f]{64}$'),
  CONSTRAINT processing_bulk_ingestion_batch_plan_sha_ck
    CHECK (plan_sha256 ~ '^[0-9a-f]{64}$'),
  CONSTRAINT processing_bulk_ingestion_batch_privacy_ck
    CHECK (privacy_scope IN ('public_only', 'include_private', 'private_only')),
  CONSTRAINT processing_bulk_ingestion_batch_status_ck
    CHECK (status IN (
      'planned', 'running', 'pause_requested', 'paused', 'succeeded', 'failed'
    )),
  CONSTRAINT processing_bulk_ingestion_batch_counts_ck
    CHECK (
      snapshot_count >= 1
      AND planned_entry_count >= 1
      AND succeeded_snapshot_count >= 0
      AND succeeded_snapshot_count <= snapshot_count
      AND succeeded_entry_count >= 0
      AND failed_snapshot_count >= 0
      AND failed_snapshot_count <= snapshot_count
      AND succeeded_snapshot_count + failed_snapshot_count <= snapshot_count
    ),
  CONSTRAINT processing_bulk_ingestion_batch_attempt_ck CHECK (attempt >= 0),
  CONSTRAINT processing_bulk_ingestion_batch_version_ck
    CHECK (current_version >= 1),
  CONSTRAINT processing_bulk_ingestion_batch_active_ck
    CHECK (
      (status IN ('running', 'pause_requested') AND active_run_id IS NOT NULL)
      OR (status NOT IN ('running', 'pause_requested') AND active_run_id IS NULL)
    ),
  CONSTRAINT processing_bulk_ingestion_batch_time_ck
    CHECK (
      (status = 'planned' AND started_at IS NULL AND finished_at IS NULL)
      OR (status IN ('running', 'pause_requested', 'paused')
        AND finished_at IS NULL)
      OR (status IN ('succeeded', 'failed') AND finished_at IS NOT NULL)
    )
);

CREATE TABLE struinfo.processing_bulk_ingestion_item (
  workspace_id uuid NOT NULL,
  batch_id uuid NOT NULL,
  item_ordinal integer NOT NULL,
  snapshot_id uuid NOT NULL,
  canonical_content_sha256 varchar(64) NOT NULL,
  is_private boolean NOT NULL,
  planned_entry_count integer NOT NULL,
  status varchar(20) NOT NULL DEFAULT 'pending',
  attempt integer NOT NULL DEFAULT 0,
  claimed_run_id uuid,
  result_entry_count integer,
  error_code varchar(120),
  current_version bigint NOT NULL DEFAULT 1,
  started_at timestamp with time zone,
  finished_at timestamp with time zone,
  updated_at timestamp with time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT processing_bulk_ingestion_item_pk
    PRIMARY KEY (workspace_id, batch_id, item_ordinal),
  CONSTRAINT processing_bulk_ingestion_item_snapshot_uq
    UNIQUE (workspace_id, batch_id, snapshot_id),
  CONSTRAINT processing_bulk_ingestion_item_batch_fk
    FOREIGN KEY (workspace_id, batch_id)
    REFERENCES struinfo.processing_bulk_ingestion_batch (workspace_id, batch_id),
  CONSTRAINT processing_bulk_ingestion_item_snapshot_fk
    FOREIGN KEY (workspace_id, snapshot_id)
    REFERENCES struinfo.snapshot (workspace_id, snapshot_id),
  CONSTRAINT processing_bulk_ingestion_item_run_fk
    FOREIGN KEY (workspace_id, claimed_run_id)
    REFERENCES struinfo.processing_run (workspace_id, run_id)
    DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT processing_bulk_ingestion_item_ordinal_ck CHECK (item_ordinal >= 0),
  CONSTRAINT processing_bulk_ingestion_item_sha_ck
    CHECK (canonical_content_sha256 ~ '^[0-9a-f]{64}$'),
  CONSTRAINT processing_bulk_ingestion_item_plan_ck
    CHECK (planned_entry_count >= 1),
  CONSTRAINT processing_bulk_ingestion_item_status_ck
    CHECK (status IN ('pending', 'running', 'succeeded', 'failed')),
  CONSTRAINT processing_bulk_ingestion_item_attempt_ck CHECK (attempt >= 0),
  CONSTRAINT processing_bulk_ingestion_item_result_ck
    CHECK (
      (status = 'pending' AND claimed_run_id IS NULL
        AND result_entry_count IS NULL AND error_code IS NULL
        AND started_at IS NULL AND finished_at IS NULL)
      OR (status = 'running' AND claimed_run_id IS NOT NULL
        AND result_entry_count IS NULL AND error_code IS NULL
        AND started_at IS NOT NULL AND finished_at IS NULL)
      OR (status = 'succeeded' AND claimed_run_id IS NOT NULL
        AND result_entry_count = planned_entry_count AND error_code IS NULL
        AND started_at IS NOT NULL AND finished_at IS NOT NULL)
      OR (status = 'failed' AND claimed_run_id IS NOT NULL
        AND result_entry_count IS NULL
        AND error_code IS NOT NULL AND btrim(error_code) <> ''
        AND started_at IS NOT NULL AND finished_at IS NOT NULL)
    ),
  CONSTRAINT processing_bulk_ingestion_item_version_ck
    CHECK (current_version >= 1)
);

CREATE INDEX processing_bulk_ingestion_batch_recent_idx
  ON struinfo.processing_bulk_ingestion_batch (
    workspace_id,
    created_at DESC,
    batch_id DESC
  );

CREATE INDEX processing_bulk_ingestion_item_pending_idx
  ON struinfo.processing_bulk_ingestion_item (
    workspace_id,
    batch_id,
    status,
    item_ordinal
  );
