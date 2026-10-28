-- Confirmed reading is independent of editable entries and background organization.
CREATE TABLE struinfo.document_publication_version (
  workspace_id uuid NOT NULL,
  publication_id uuid NOT NULL,
  document_id uuid NOT NULL,
  snapshot_id uuid NOT NULL,
  content_text text NOT NULL CHECK (octet_length(content_text) <= 33554432),
  confirmed_at timestamptz NOT NULL,
  origin text NOT NULL CHECK (origin IN ('manual','external_agent','internal_ai')),
  PRIMARY KEY (workspace_id, publication_id),
  UNIQUE (workspace_id, document_id, publication_id),
  FOREIGN KEY (workspace_id, document_id) REFERENCES struinfo.snapshot(workspace_id, snapshot_id),
  FOREIGN KEY (workspace_id, snapshot_id) REFERENCES struinfo.snapshot(workspace_id, snapshot_id)
);

CREATE TABLE struinfo.document_publication_pointer (
  workspace_id uuid NOT NULL,
  document_id uuid NOT NULL,
  publication_id uuid NOT NULL,
  PRIMARY KEY (workspace_id, document_id),
  FOREIGN KEY (workspace_id, document_id, publication_id)
    REFERENCES struinfo.document_publication_version(workspace_id, document_id, publication_id)
);

CREATE TABLE struinfo.document_organization_work (
  workspace_id uuid NOT NULL,
  publication_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','running','succeeded','failed','paused','superseded')),
  current_version integer NOT NULL DEFAULT 1 CHECK (current_version > 0),
  error_code text CHECK (length(error_code) <= 160),
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (workspace_id, publication_id),
  FOREIGN KEY (workspace_id, publication_id)
    REFERENCES struinfo.document_publication_version(workspace_id, publication_id)
);
