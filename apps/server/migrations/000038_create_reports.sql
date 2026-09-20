CREATE TABLE struinfo.processing_report (
  workspace_id uuid NOT NULL,
  report_id uuid NOT NULL,
  state_text text NOT NULL CHECK (octet_length(state_text) <= 1048576),
  current_version integer NOT NULL DEFAULT 1 CHECK (current_version >= 1),
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (workspace_id, report_id)
);
