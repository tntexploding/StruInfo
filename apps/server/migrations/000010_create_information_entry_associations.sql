CREATE TABLE struinfo.information_entry_association_projection (
  workspace_id uuid NOT NULL,
  entry_low_id uuid NOT NULL,
  entry_high_id uuid NOT NULL,
  entry_low_revision integer NOT NULL,
  entry_low_revision_id uuid NOT NULL,
  entry_high_revision integer NOT NULL,
  entry_high_revision_id uuid NOT NULL,
  content_similarity integer NOT NULL,
  type_similarity integer NOT NULL,
  domain_similarity integer NOT NULL,
  base_score integer NOT NULL,
  algorithm_version text NOT NULL,
  candidate_basis text NOT NULL,
  candidate_rank integer NOT NULL,
  generated_at timestamp with time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT entry_assoc_projection_pk
    PRIMARY KEY (workspace_id, entry_low_id, entry_high_id),
  CONSTRAINT entry_assoc_projection_low_revision_fk
    FOREIGN KEY (
      workspace_id,
      entry_low_id,
      entry_low_revision,
      entry_low_revision_id
    )
    REFERENCES struinfo.information_entry_revision (
      workspace_id,
      entry_id,
      revision_number,
      revision_id
    ),
  CONSTRAINT entry_assoc_projection_high_revision_fk
    FOREIGN KEY (
      workspace_id,
      entry_high_id,
      entry_high_revision,
      entry_high_revision_id
    )
    REFERENCES struinfo.information_entry_revision (
      workspace_id,
      entry_id,
      revision_number,
      revision_id
    ),
  CONSTRAINT entry_assoc_projection_order_ck
    CHECK (entry_low_id < entry_high_id),
  CONSTRAINT entry_assoc_projection_low_revision_ck
    CHECK (entry_low_revision >= 1),
  CONSTRAINT entry_assoc_projection_high_revision_ck
    CHECK (entry_high_revision >= 1),
  CONSTRAINT entry_assoc_projection_content_ck
    CHECK (content_similarity BETWEEN 0 AND 10000),
  CONSTRAINT entry_assoc_projection_type_ck
    CHECK (type_similarity BETWEEN 0 AND 10000),
  CONSTRAINT entry_assoc_projection_domain_ck
    CHECK (domain_similarity BETWEEN 0 AND 10000),
  CONSTRAINT entry_assoc_projection_base_ck
    CHECK (base_score BETWEEN 0 AND 10000),
  CONSTRAINT entry_assoc_projection_algorithm_ck
    CHECK (btrim(algorithm_version) <> ''),
  CONSTRAINT entry_assoc_projection_basis_ck
    CHECK (btrim(candidate_basis) <> ''),
  CONSTRAINT entry_assoc_projection_rank_ck
    CHECK (candidate_rank >= 1)
);

CREATE INDEX entry_assoc_projection_high_lookup_idx
  ON struinfo.information_entry_association_projection (
    workspace_id,
    entry_high_id,
    base_score DESC,
    entry_low_id
  );

CREATE TABLE struinfo.information_entry_association_override (
  workspace_id uuid NOT NULL,
  entry_low_id uuid NOT NULL,
  entry_high_id uuid NOT NULL,
  current_revision integer NOT NULL,
  current_revision_id uuid NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT entry_assoc_override_pk
    PRIMARY KEY (workspace_id, entry_low_id, entry_high_id),
  CONSTRAINT entry_assoc_override_low_entry_fk
    FOREIGN KEY (workspace_id, entry_low_id)
    REFERENCES struinfo.information_entry (workspace_id, entry_id),
  CONSTRAINT entry_assoc_override_high_entry_fk
    FOREIGN KEY (workspace_id, entry_high_id)
    REFERENCES struinfo.information_entry (workspace_id, entry_id),
  CONSTRAINT entry_assoc_override_order_ck
    CHECK (entry_low_id < entry_high_id),
  CONSTRAINT entry_assoc_override_revision_ck
    CHECK (current_revision >= 1)
);

CREATE TABLE struinfo.information_entry_association_override_revision (
  workspace_id uuid NOT NULL,
  entry_low_id uuid NOT NULL,
  entry_high_id uuid NOT NULL,
  revision_number integer NOT NULL,
  revision_id uuid NOT NULL,
  previous_revision_id uuid,
  action text NOT NULL,
  manual_adjustment integer NOT NULL,
  is_blocked boolean NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT entry_assoc_override_revision_pk
    PRIMARY KEY (
      workspace_id,
      entry_low_id,
      entry_high_id,
      revision_number
    ),
  CONSTRAINT entry_assoc_override_revision_id_uq
    UNIQUE (workspace_id, revision_id),
  CONSTRAINT entry_assoc_override_revision_pair_id_uq
    UNIQUE (
      workspace_id,
      entry_low_id,
      entry_high_id,
      revision_id
    ),
  CONSTRAINT entry_assoc_override_revision_pointer_uq
    UNIQUE (
      workspace_id,
      entry_low_id,
      entry_high_id,
      revision_number,
      revision_id
    ),
  CONSTRAINT entry_assoc_override_revision_set_fk
    FOREIGN KEY (workspace_id, entry_low_id, entry_high_id)
    REFERENCES struinfo.information_entry_association_override (
      workspace_id,
      entry_low_id,
      entry_high_id
    )
    DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT entry_assoc_override_revision_previous_fk
    FOREIGN KEY (
      workspace_id,
      entry_low_id,
      entry_high_id,
      previous_revision_id
    )
    REFERENCES struinfo.information_entry_association_override_revision (
      workspace_id,
      entry_low_id,
      entry_high_id,
      revision_id
    ),
  CONSTRAINT entry_assoc_override_revision_number_ck
    CHECK (revision_number >= 1),
  CONSTRAINT entry_assoc_override_revision_previous_ck
    CHECK (
      (revision_number = 1 AND previous_revision_id IS NULL)
      OR (revision_number > 1 AND previous_revision_id IS NOT NULL)
    ),
  CONSTRAINT entry_assoc_override_revision_action_ck
    CHECK (action IN ('enhance', 'weaken', 'block', 'restore')),
  CONSTRAINT entry_assoc_override_revision_adjustment_ck
    CHECK (manual_adjustment BETWEEN -10000 AND 10000),
  CONSTRAINT entry_assoc_override_revision_block_ck
    CHECK (
      (action = 'block' AND is_blocked AND manual_adjustment = 0)
      OR (action <> 'block' AND NOT is_blocked)
    )
);

ALTER TABLE struinfo.information_entry_association_override
  ADD CONSTRAINT entry_assoc_override_current_revision_fk
  FOREIGN KEY (
    workspace_id,
    entry_low_id,
    entry_high_id,
    current_revision,
    current_revision_id
  )
  REFERENCES struinfo.information_entry_association_override_revision (
    workspace_id,
    entry_low_id,
    entry_high_id,
    revision_number,
    revision_id
  )
  DEFERRABLE INITIALLY DEFERRED;

CREATE INDEX entry_assoc_override_high_lookup_idx
  ON struinfo.information_entry_association_override (
    workspace_id,
    entry_high_id,
    entry_low_id
  );
