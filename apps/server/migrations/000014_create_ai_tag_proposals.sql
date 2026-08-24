CREATE TABLE struinfo.processing_tag_proposal (
  workspace_id uuid NOT NULL,
  proposal_id uuid NOT NULL,
  expected_entry_revision integer NOT NULL,
  provider_model varchar(120) NOT NULL,
  prompt_version varchar(120) NOT NULL,
  type_keyword varchar(40) NOT NULL,
  type_custom_name varchar(80),
  CONSTRAINT processing_tag_proposal_pk
    PRIMARY KEY (workspace_id, proposal_id),
  CONSTRAINT processing_tag_proposal_proposal_fk
    FOREIGN KEY (workspace_id, proposal_id)
    REFERENCES struinfo.processing_proposal (workspace_id, proposal_id),
  CONSTRAINT processing_tag_proposal_revision_ck
    CHECK (expected_entry_revision >= 1),
  CONSTRAINT processing_tag_proposal_model_ck
    CHECK (btrim(provider_model) <> ''),
  CONSTRAINT processing_tag_proposal_prompt_ck
    CHECK (btrim(prompt_version) <> ''),
  CONSTRAINT processing_tag_proposal_type_ck
    CHECK (type_keyword IN (
      'factual_material', 'knowledge_explanation', 'operating_guideline',
      'investigation_analysis', 'argument', 'personal_experience',
      'interactive_collaboration', 'public_communication',
      'literary_creation', 'other'
    )),
  CONSTRAINT processing_tag_proposal_type_custom_ck
    CHECK (
      (type_keyword = 'other'
        AND type_custom_name IS NOT NULL
        AND btrim(type_custom_name) <> '')
      OR (type_keyword <> 'other' AND type_custom_name IS NULL)
    )
);

CREATE TABLE struinfo.processing_tag_proposal_content_keyword (
  workspace_id uuid NOT NULL,
  proposal_id uuid NOT NULL,
  keyword_ordinal integer NOT NULL,
  display_value varchar(80) NOT NULL,
  normalized_value varchar(80) NOT NULL,
  CONSTRAINT processing_tag_proposal_content_keyword_pk
    PRIMARY KEY (workspace_id, proposal_id, keyword_ordinal),
  CONSTRAINT processing_tag_proposal_content_keyword_value_uq
    UNIQUE (workspace_id, proposal_id, normalized_value),
  CONSTRAINT processing_tag_proposal_content_keyword_proposal_fk
    FOREIGN KEY (workspace_id, proposal_id)
    REFERENCES struinfo.processing_tag_proposal (workspace_id, proposal_id),
  CONSTRAINT processing_tag_proposal_content_keyword_ordinal_ck
    CHECK (keyword_ordinal >= 0),
  CONSTRAINT processing_tag_proposal_content_keyword_display_ck
    CHECK (btrim(display_value) <> ''),
  CONSTRAINT processing_tag_proposal_content_keyword_normalized_ck
    CHECK (btrim(normalized_value) <> '')
);

CREATE TABLE struinfo.processing_tag_proposal_domain (
  workspace_id uuid NOT NULL,
  proposal_id uuid NOT NULL,
  domain_ordinal integer NOT NULL,
  domain_keyword varchar(40) NOT NULL,
  custom_name varchar(80),
  CONSTRAINT processing_tag_proposal_domain_pk
    PRIMARY KEY (workspace_id, proposal_id, domain_ordinal),
  CONSTRAINT processing_tag_proposal_domain_value_uq
    UNIQUE NULLS NOT DISTINCT (workspace_id, proposal_id, domain_keyword, custom_name),
  CONSTRAINT processing_tag_proposal_domain_proposal_fk
    FOREIGN KEY (workspace_id, proposal_id)
    REFERENCES struinfo.processing_tag_proposal (workspace_id, proposal_id),
  CONSTRAINT processing_tag_proposal_domain_ordinal_ck
    CHECK (domain_ordinal >= 0),
  CONSTRAINT processing_tag_proposal_domain_keyword_ck
    CHECK (domain_keyword IN (
      'mathematics_formal', 'nature_environment', 'engineering_computing',
      'life_health', 'society_public_affairs', 'economy_business',
      'law_policy_governance', 'humanities_history', 'language_education',
      'culture_arts', 'daily_life', 'other'
    )),
  CONSTRAINT processing_tag_proposal_domain_custom_ck
    CHECK (
      (domain_keyword = 'other'
        AND custom_name IS NOT NULL
        AND btrim(custom_name) <> '')
      OR (domain_keyword <> 'other' AND custom_name IS NULL)
    )
);
