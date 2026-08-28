CREATE TABLE struinfo.information_document_working_copy (
  workspace_id uuid NOT NULL,
  source_snapshot_id uuid NOT NULL,
  revision integer NOT NULL,
  state text NOT NULL,
  draft_body text,
  body_sha256 text NOT NULL,
  derived_resource_id uuid,
  derived_snapshot_id uuid,
  created_at timestamp with time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamp with time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
  committed_at timestamp with time zone,
  CONSTRAINT information_document_working_copy_pk
    PRIMARY KEY (workspace_id, source_snapshot_id),
  CONSTRAINT information_document_working_copy_source_fk
    FOREIGN KEY (workspace_id, source_snapshot_id)
    REFERENCES struinfo.snapshot (workspace_id, snapshot_id),
  CONSTRAINT information_document_working_copy_derived_fk
    FOREIGN KEY (workspace_id, derived_resource_id, derived_snapshot_id)
    REFERENCES struinfo.snapshot (workspace_id, resource_id, snapshot_id),
  CONSTRAINT information_document_working_copy_revision_ck
    CHECK (revision >= 1),
  CONSTRAINT information_document_working_copy_state_ck
    CHECK (state IN ('editing', 'committed')),
  CONSTRAINT information_document_working_copy_body_sha256_ck
    CHECK (body_sha256 ~ '^[0-9a-f]{64}$'),
  CONSTRAINT information_document_working_copy_shape_ck
    CHECK (
      (
        state = 'editing'
        AND draft_body IS NOT NULL
        AND draft_body <> ''
        AND octet_length(draft_body) <= 1048576
        AND derived_resource_id IS NULL
        AND derived_snapshot_id IS NULL
        AND committed_at IS NULL
      )
      OR (
        state = 'committed'
        AND draft_body IS NULL
        AND derived_resource_id IS NOT NULL
        AND derived_snapshot_id IS NOT NULL
        AND derived_snapshot_id <> source_snapshot_id
        AND committed_at IS NOT NULL
      )
    ),
  CONSTRAINT information_document_working_copy_derived_uq
    UNIQUE (workspace_id, derived_snapshot_id)
);

CREATE INDEX information_document_working_copy_derived_idx
  ON struinfo.information_document_working_copy (
    workspace_id,
    derived_snapshot_id,
    source_snapshot_id
  );
