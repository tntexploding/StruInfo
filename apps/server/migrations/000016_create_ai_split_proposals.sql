CREATE TABLE struinfo.processing_split_proposal (
  workspace_id uuid NOT NULL, proposal_id uuid NOT NULL,
  provider_model varchar(120) NOT NULL, prompt_version varchar(120) NOT NULL,
  split_rule_version varchar(120) NOT NULL,
  CONSTRAINT processing_split_proposal_pk PRIMARY KEY (workspace_id, proposal_id),
  CONSTRAINT processing_split_proposal_proposal_fk FOREIGN KEY (workspace_id, proposal_id) REFERENCES struinfo.processing_proposal (workspace_id, proposal_id),
  CONSTRAINT processing_split_proposal_model_ck CHECK (btrim(provider_model) <> ''),
  CONSTRAINT processing_split_proposal_prompt_ck CHECK (btrim(prompt_version) <> ''),
  CONSTRAINT processing_split_proposal_rule_ck CHECK (split_rule_version = 'struinfo.entry-split.ai-group.v1')
);
CREATE TABLE struinfo.processing_split_proposal_entry (
  workspace_id uuid NOT NULL, proposal_id uuid NOT NULL, entry_ordinal integer NOT NULL,
  title_path varchar(200) NOT NULL,
  CONSTRAINT processing_split_proposal_entry_pk PRIMARY KEY (workspace_id, proposal_id, entry_ordinal),
  CONSTRAINT processing_split_proposal_entry_proposal_fk FOREIGN KEY (workspace_id, proposal_id) REFERENCES struinfo.processing_split_proposal (workspace_id, proposal_id),
  CONSTRAINT processing_split_proposal_entry_ordinal_ck CHECK (entry_ordinal >= 0),
  CONSTRAINT processing_split_proposal_entry_title_ck CHECK (btrim(title_path) <> '')
);
CREATE TABLE struinfo.processing_split_proposal_entry_fragment (
  workspace_id uuid NOT NULL, proposal_id uuid NOT NULL, entry_ordinal integer NOT NULL,
  fragment_ordinal integer NOT NULL, fragment_id uuid NOT NULL,
  CONSTRAINT processing_split_proposal_entry_fragment_pk PRIMARY KEY (workspace_id, proposal_id, entry_ordinal, fragment_ordinal),
  CONSTRAINT processing_split_proposal_entry_fragment_identity_uq UNIQUE (workspace_id, proposal_id, fragment_id),
  CONSTRAINT processing_split_proposal_entry_fragment_entry_fk FOREIGN KEY (workspace_id, proposal_id, entry_ordinal) REFERENCES struinfo.processing_split_proposal_entry (workspace_id, proposal_id, entry_ordinal),
  CONSTRAINT processing_split_proposal_entry_fragment_evidence_fk FOREIGN KEY (workspace_id, fragment_id) REFERENCES struinfo.fragment (workspace_id, fragment_id),
  CONSTRAINT processing_split_proposal_entry_fragment_ordinal_ck CHECK (fragment_ordinal >= 0)
);
