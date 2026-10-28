-- Personal topics and bounded background work; no source text or defaults are seeded.
CREATE TABLE struinfo.content_organization_record (
  workspace_id uuid NOT NULL REFERENCES struinfo.workspace(workspace_id),
  record_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('topic','job')),
  value_text text NOT NULL CHECK (octet_length(value_text) <= 1048576 AND value_text::jsonb->>'kind'=kind),
  current_version integer NOT NULL DEFAULT 1 CHECK (current_version>0),
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (workspace_id,record_id)
);
CREATE INDEX content_organization_kind ON struinfo.content_organization_record(workspace_id,kind,updated_at);
