CREATE TABLE struinfo.information_entry (
  workspace_id uuid NOT NULL,
  entry_id uuid NOT NULL,
  resource_id uuid NOT NULL,
  snapshot_id uuid NOT NULL,
  current_revision integer NOT NULL,
  current_revision_id uuid NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT information_entry_pk
    PRIMARY KEY (workspace_id, entry_id),
  CONSTRAINT information_entry_snapshot_fk
    FOREIGN KEY (workspace_id, resource_id, snapshot_id)
    REFERENCES struinfo.snapshot (workspace_id, resource_id, snapshot_id),
  CONSTRAINT information_entry_current_revision_ck
    CHECK (current_revision >= 1),
  CONSTRAINT information_entry_snapshot_order_uq
    UNIQUE (workspace_id, snapshot_id, entry_id)
);

CREATE TABLE struinfo.information_entry_revision (
  workspace_id uuid NOT NULL,
  entry_id uuid NOT NULL,
  revision_number integer NOT NULL,
  revision_id uuid NOT NULL,
  previous_revision_id uuid,
  document_order integer NOT NULL,
  title_path text NOT NULL,
  body text NOT NULL,
  body_sha256 text NOT NULL,
  chunk_mode text NOT NULL,
  split_rule_version text NOT NULL,
  is_private boolean NOT NULL,
  type_keyword text,
  type_custom_name text,
  created_at timestamp with time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT information_entry_revision_pk
    PRIMARY KEY (workspace_id, entry_id, revision_number),
  CONSTRAINT information_entry_revision_id_uq
    UNIQUE (workspace_id, revision_id),
  CONSTRAINT information_entry_revision_entry_id_uq
    UNIQUE (workspace_id, entry_id, revision_id),
  CONSTRAINT information_entry_revision_pointer_uq
    UNIQUE (workspace_id, entry_id, revision_number, revision_id),
  CONSTRAINT information_entry_revision_entry_fk
    FOREIGN KEY (workspace_id, entry_id)
    REFERENCES struinfo.information_entry (workspace_id, entry_id)
    DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT information_entry_revision_previous_fk
    FOREIGN KEY (workspace_id, entry_id, previous_revision_id)
    REFERENCES struinfo.information_entry_revision (
      workspace_id,
      entry_id,
      revision_id
    ),
  CONSTRAINT information_entry_revision_number_ck
    CHECK (revision_number >= 1),
  CONSTRAINT information_entry_revision_previous_ck
    CHECK (
      (revision_number = 1 AND previous_revision_id IS NULL)
      OR (revision_number > 1 AND previous_revision_id IS NOT NULL)
    ),
  CONSTRAINT information_entry_revision_order_ck
    CHECK (document_order >= 0),
  CONSTRAINT information_entry_revision_body_ck
    CHECK (body <> ''),
  CONSTRAINT information_entry_revision_body_sha256_ck
    CHECK (body_sha256 ~ '^[0-9a-f]{64}$'),
  CONSTRAINT information_entry_revision_chunk_mode_ck
    CHECK (chunk_mode IN ('split', 'whole')),
  CONSTRAINT information_entry_revision_split_rule_ck
    CHECK (btrim(split_rule_version) <> ''),
  CONSTRAINT information_entry_revision_type_ck
    CHECK (
      type_keyword IS NULL
      OR type_keyword IN (
        'factual_material',
        'knowledge_explanation',
        'operating_guideline',
        'investigation_analysis',
        'argument',
        'personal_experience',
        'interactive_collaboration',
        'public_communication',
        'literary_creation',
        'other'
      )
    ),
  CONSTRAINT information_entry_revision_type_custom_ck
    CHECK (
      (
        type_keyword = 'other'
        AND type_custom_name IS NOT NULL
        AND btrim(type_custom_name) <> ''
      )
      OR (type_keyword IS DISTINCT FROM 'other' AND type_custom_name IS NULL)
    )
);

ALTER TABLE struinfo.information_entry
  ADD CONSTRAINT information_entry_current_revision_fk
  FOREIGN KEY (
    workspace_id,
    entry_id,
    current_revision,
    current_revision_id
  )
  REFERENCES struinfo.information_entry_revision (
    workspace_id,
    entry_id,
    revision_number,
    revision_id
  )
  DEFERRABLE INITIALLY DEFERRED;

CREATE TABLE struinfo.information_entry_fragment_input (
  workspace_id uuid NOT NULL,
  entry_id uuid NOT NULL,
  revision_number integer NOT NULL,
  revision_id uuid NOT NULL,
  input_ordinal integer NOT NULL,
  fragment_id uuid NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT information_entry_fragment_input_pk
    PRIMARY KEY (
      workspace_id,
      entry_id,
      revision_number,
      input_ordinal
    ),
  CONSTRAINT information_entry_fragment_input_revision_fk
    FOREIGN KEY (
      workspace_id,
      entry_id,
      revision_number,
      revision_id
    )
    REFERENCES struinfo.information_entry_revision (
      workspace_id,
      entry_id,
      revision_number,
      revision_id
    ),
  CONSTRAINT information_entry_fragment_input_fragment_fk
    FOREIGN KEY (workspace_id, fragment_id)
    REFERENCES struinfo.fragment (workspace_id, fragment_id),
  CONSTRAINT information_entry_fragment_input_ordinal_ck
    CHECK (input_ordinal >= 0),
  CONSTRAINT information_entry_fragment_input_fragment_uq
    UNIQUE (
      workspace_id,
      entry_id,
      revision_number,
      fragment_id
    )
);

CREATE TABLE struinfo.information_entry_content_keyword (
  workspace_id uuid NOT NULL,
  entry_id uuid NOT NULL,
  revision_number integer NOT NULL,
  revision_id uuid NOT NULL,
  keyword_ordinal integer NOT NULL,
  display_value text NOT NULL,
  normalized_value text NOT NULL,
  origin text NOT NULL,
  origin_version text NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT information_entry_content_keyword_pk
    PRIMARY KEY (
      workspace_id,
      entry_id,
      revision_number,
      keyword_ordinal
    ),
  CONSTRAINT information_entry_content_keyword_revision_fk
    FOREIGN KEY (
      workspace_id,
      entry_id,
      revision_number,
      revision_id
    )
    REFERENCES struinfo.information_entry_revision (
      workspace_id,
      entry_id,
      revision_number,
      revision_id
    ),
  CONSTRAINT information_entry_content_keyword_ordinal_ck
    CHECK (keyword_ordinal >= 0),
  CONSTRAINT information_entry_content_keyword_display_ck
    CHECK (btrim(display_value) <> ''),
  CONSTRAINT information_entry_content_keyword_normalized_ck
    CHECK (btrim(normalized_value) <> ''),
  CONSTRAINT information_entry_content_keyword_origin_ck
    CHECK (origin IN ('manual', 'rule', 'ai')),
  CONSTRAINT information_entry_content_keyword_origin_version_ck
    CHECK (btrim(origin_version) <> ''),
  CONSTRAINT information_entry_content_keyword_value_uq
    UNIQUE (
      workspace_id,
      entry_id,
      revision_number,
      normalized_value
    )
);

CREATE TABLE struinfo.information_entry_domain_keyword (
  workspace_id uuid NOT NULL,
  entry_id uuid NOT NULL,
  revision_number integer NOT NULL,
  revision_id uuid NOT NULL,
  domain_ordinal integer NOT NULL,
  domain_keyword text NOT NULL,
  custom_name text,
  origin text NOT NULL,
  origin_version text NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT information_entry_domain_keyword_pk
    PRIMARY KEY (
      workspace_id,
      entry_id,
      revision_number,
      domain_ordinal
    ),
  CONSTRAINT information_entry_domain_keyword_revision_fk
    FOREIGN KEY (
      workspace_id,
      entry_id,
      revision_number,
      revision_id
    )
    REFERENCES struinfo.information_entry_revision (
      workspace_id,
      entry_id,
      revision_number,
      revision_id
    ),
  CONSTRAINT information_entry_domain_keyword_ordinal_ck
    CHECK (domain_ordinal BETWEEN 0 AND 2),
  CONSTRAINT information_entry_domain_keyword_value_ck
    CHECK (
      domain_keyword IN (
        'mathematics_formal',
        'nature_environment',
        'engineering_computing',
        'life_health',
        'society_public_affairs',
        'economy_business',
        'law_policy_governance',
        'humanities_history',
        'language_education',
        'culture_arts',
        'daily_life',
        'other'
      )
    ),
  CONSTRAINT information_entry_domain_keyword_custom_ck
    CHECK (
      (
        domain_keyword = 'other'
        AND custom_name IS NOT NULL
        AND btrim(custom_name) <> ''
      )
      OR (domain_keyword <> 'other' AND custom_name IS NULL)
    ),
  CONSTRAINT information_entry_domain_keyword_origin_ck
    CHECK (origin IN ('manual', 'rule', 'ai')),
  CONSTRAINT information_entry_domain_keyword_origin_version_ck
    CHECK (btrim(origin_version) <> ''),
  CONSTRAINT information_entry_domain_keyword_value_uq
    UNIQUE NULLS NOT DISTINCT (
      workspace_id,
      entry_id,
      revision_number,
      domain_keyword,
      custom_name
    )
);

CREATE TABLE struinfo.information_entry_lineage (
  workspace_id uuid NOT NULL,
  successor_entry_id uuid NOT NULL,
  predecessor_entry_id uuid NOT NULL,
  lineage_kind text NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT information_entry_lineage_pk
    PRIMARY KEY (
      workspace_id,
      successor_entry_id,
      predecessor_entry_id
    ),
  CONSTRAINT information_entry_lineage_successor_fk
    FOREIGN KEY (workspace_id, successor_entry_id)
    REFERENCES struinfo.information_entry (workspace_id, entry_id),
  CONSTRAINT information_entry_lineage_predecessor_fk
    FOREIGN KEY (workspace_id, predecessor_entry_id)
    REFERENCES struinfo.information_entry (workspace_id, entry_id),
  CONSTRAINT information_entry_lineage_not_self_ck
    CHECK (successor_entry_id <> predecessor_entry_id),
  CONSTRAINT information_entry_lineage_kind_ck
    CHECK (lineage_kind IN ('split_from', 'merged_from', 'boundary_from'))
);

CREATE INDEX information_entry_snapshot_order_idx
  ON struinfo.information_entry (workspace_id, snapshot_id, entry_id);

CREATE INDEX information_entry_content_keyword_lookup_idx
  ON struinfo.information_entry_content_keyword (
    workspace_id,
    normalized_value,
    entry_id,
    revision_number
  );

CREATE INDEX information_entry_domain_keyword_lookup_idx
  ON struinfo.information_entry_domain_keyword (
    workspace_id,
    domain_keyword,
    entry_id,
    revision_number
  );
