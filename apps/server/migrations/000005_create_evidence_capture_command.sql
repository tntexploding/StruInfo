CREATE TABLE struinfo.evidence_capture_command (
  workspace_id uuid NOT NULL,
  command_idempotency_key text NOT NULL,
  request_sha256 text NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT evidence_capture_command_pk
    PRIMARY KEY (workspace_id, command_idempotency_key),
  CONSTRAINT evidence_capture_command_workspace_fk
    FOREIGN KEY (workspace_id)
    REFERENCES struinfo.workspace (workspace_id),
  CONSTRAINT evidence_capture_command_key_ck
    CHECK (btrim(command_idempotency_key) <> ''),
  CONSTRAINT evidence_capture_command_request_sha256_ck
    CHECK (request_sha256 ~ '^[0-9a-f]{64}$')
);
