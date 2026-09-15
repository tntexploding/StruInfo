CREATE TABLE struinfo.processing_document_intake (
  workspace_id uuid NOT NULL,
  snapshot_id uuid NOT NULL,
  prepared_snapshot_id uuid,
  state_text text NOT NULL CHECK (octet_length(state_text) <= 16384),
  current_version integer NOT NULL DEFAULT 1 CHECK (current_version >= 1),
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (workspace_id, snapshot_id),
  FOREIGN KEY (workspace_id, snapshot_id) REFERENCES struinfo.snapshot(workspace_id, snapshot_id),
  FOREIGN KEY (workspace_id, prepared_snapshot_id) REFERENCES struinfo.snapshot(workspace_id, snapshot_id)
);
