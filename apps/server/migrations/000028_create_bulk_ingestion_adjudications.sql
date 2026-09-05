CREATE TABLE struinfo.processing_bulk_ingestion_adjudication (
  workspace_id uuid NOT NULL,
  batch_id uuid NOT NULL,
  item_ordinal integer NOT NULL,
  entry_id uuid NOT NULL,
  status varchar(24) NOT NULL DEFAULT 'pending',
  current_version bigint NOT NULL DEFAULT 1,
  decided_at timestamp with time zone,
  updated_at timestamp with time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT processing_bulk_ingestion_adjudication_pk
    PRIMARY KEY (workspace_id, batch_id, item_ordinal, entry_id),
  CONSTRAINT processing_bulk_ingestion_adjudication_exception_fk
    FOREIGN KEY (workspace_id, batch_id, item_ordinal, entry_id)
    REFERENCES struinfo.processing_bulk_ingestion_exception (
      workspace_id,
      batch_id,
      item_ordinal,
      entry_id
    ),
  CONSTRAINT processing_bulk_ingestion_adjudication_status_ck
    CHECK (status IN ('pending', 'accepted', 'manual_review', 'deferred')),
  CONSTRAINT processing_bulk_ingestion_adjudication_result_ck
    CHECK (
      (status = 'pending' AND decided_at IS NULL)
      OR (status <> 'pending' AND decided_at IS NOT NULL)
    ),
  CONSTRAINT processing_bulk_ingestion_adjudication_version_ck
    CHECK (current_version >= 1)
);

CREATE INDEX processing_bulk_ingestion_adjudication_status_idx
  ON struinfo.processing_bulk_ingestion_adjudication (
    workspace_id,
    batch_id,
    status,
    item_ordinal,
    entry_id
  );
