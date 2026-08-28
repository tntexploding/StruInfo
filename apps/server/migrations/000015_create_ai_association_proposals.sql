ALTER TABLE struinfo.information_entry_association_override
  DROP CONSTRAINT entry_assoc_override_graph_origin_ck,
  ADD CONSTRAINT entry_assoc_override_graph_origin_ck
    CHECK (graph_origin IS NULL OR graph_origin IN ('association', 'user', 'ai'));

CREATE TABLE struinfo.processing_association_proposal (
  workspace_id uuid NOT NULL,
  proposal_id uuid NOT NULL,
  expected_entry_low_revision integer NOT NULL,
  expected_entry_high_revision integer NOT NULL,
  expected_override_revision integer NOT NULL,
  provider_model varchar(120) NOT NULL,
  prompt_version varchar(120) NOT NULL,
  relation_label varchar(80) NOT NULL,
  graph_direction varchar(20) NOT NULL,
  CONSTRAINT processing_association_proposal_pk
    PRIMARY KEY (workspace_id, proposal_id),
  CONSTRAINT processing_association_proposal_proposal_fk
    FOREIGN KEY (workspace_id, proposal_id)
    REFERENCES struinfo.processing_proposal (workspace_id, proposal_id),
  CONSTRAINT processing_association_proposal_entry_revision_ck
    CHECK (
      expected_entry_low_revision >= 1
      AND expected_entry_high_revision >= 1
    ),
  CONSTRAINT processing_association_proposal_override_revision_ck
    CHECK (expected_override_revision >= 0),
  CONSTRAINT processing_association_proposal_model_ck
    CHECK (btrim(provider_model) <> ''),
  CONSTRAINT processing_association_proposal_prompt_ck
    CHECK (btrim(prompt_version) <> ''),
  CONSTRAINT processing_association_proposal_label_ck
    CHECK (btrim(relation_label) <> '' AND char_length(relation_label) <= 80),
  CONSTRAINT processing_association_proposal_direction_ck
    CHECK (graph_direction IN ('symmetric', 'low_to_high', 'high_to_low'))
);