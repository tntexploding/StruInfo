-- Evidence-bound annotations share the Entry revision and publication boundary.
CREATE TABLE struinfo.information_entry_annotation (
  workspace_id uuid NOT NULL,
  entry_id uuid NOT NULL,
  value_text text NOT NULL CHECK (jsonb_typeof(value_text::jsonb) = 'object'),
  PRIMARY KEY (workspace_id, entry_id),
  FOREIGN KEY (workspace_id, entry_id)
    REFERENCES struinfo.information_entry (workspace_id, entry_id) ON DELETE CASCADE
);

CREATE TABLE struinfo.processing_tag_annotation_payload (
  workspace_id uuid NOT NULL,
  proposal_id uuid NOT NULL,
  value_text text NOT NULL CHECK (jsonb_typeof(value_text::jsonb) = 'object'),
  PRIMARY KEY (workspace_id, proposal_id),
  FOREIGN KEY (workspace_id, proposal_id)
    REFERENCES struinfo.processing_proposal (workspace_id, proposal_id) ON DELETE CASCADE
);
