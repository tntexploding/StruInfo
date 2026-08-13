CREATE TABLE struinfo.curation_target (
  workspace_id uuid NOT NULL,
  target_id uuid NOT NULL,
  target_kind text NOT NULL,
  resource_id uuid,
  snapshot_id uuid,
  fragment_id uuid,
  current_version integer NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT curation_target_pk PRIMARY KEY (workspace_id, target_id),
  CONSTRAINT curation_target_workspace_fk
    FOREIGN KEY (workspace_id)
    REFERENCES struinfo.workspace (workspace_id),
  CONSTRAINT curation_target_snapshot_fk
    FOREIGN KEY (workspace_id, resource_id, snapshot_id)
    REFERENCES struinfo.snapshot (workspace_id, resource_id, snapshot_id),
  CONSTRAINT curation_target_fragment_fk
    FOREIGN KEY (workspace_id, fragment_id)
    REFERENCES struinfo.fragment (workspace_id, fragment_id),
  CONSTRAINT curation_target_kind_ck
    CHECK (target_kind IN ('snapshot', 'fragment')),
  CONSTRAINT curation_target_branch_ck
    CHECK (
      (
        target_kind = 'snapshot'
        AND resource_id IS NOT NULL
        AND snapshot_id IS NOT NULL
        AND fragment_id IS NULL
      )
      OR (
        target_kind = 'fragment'
        AND resource_id IS NULL
        AND snapshot_id IS NULL
        AND fragment_id IS NOT NULL
      )
    ),
  CONSTRAINT curation_target_version_ck CHECK (current_version >= 0)
);

CREATE UNIQUE INDEX curation_target_snapshot_uq
  ON struinfo.curation_target (workspace_id, resource_id, snapshot_id)
  WHERE target_kind = 'snapshot';

CREATE UNIQUE INDEX curation_target_fragment_uq
  ON struinfo.curation_target (workspace_id, fragment_id)
  WHERE target_kind = 'fragment';

CREATE TABLE struinfo.vocabulary_term (
  workspace_id uuid NOT NULL,
  term_id uuid NOT NULL,
  current_revision integer NOT NULL,
  current_term_revision_id uuid NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT vocabulary_term_pk PRIMARY KEY (workspace_id, term_id),
  CONSTRAINT vocabulary_term_workspace_fk
    FOREIGN KEY (workspace_id)
    REFERENCES struinfo.workspace (workspace_id),
  CONSTRAINT vocabulary_term_revision_ck CHECK (current_revision >= 1),
  CONSTRAINT vocabulary_term_current_identity_uq
    UNIQUE (
      workspace_id,
      term_id,
      current_revision,
      current_term_revision_id
    )
);

CREATE TABLE struinfo.vocabulary_term_revision (
  workspace_id uuid NOT NULL,
  term_id uuid NOT NULL,
  term_revision_id uuid NOT NULL,
  revision_number integer NOT NULL,
  display_name text NOT NULL,
  description text,
  parent_term_id uuid,
  lifecycle text NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT vocabulary_term_revision_pk
    PRIMARY KEY (workspace_id, term_id, term_revision_id),
  CONSTRAINT vocabulary_term_revision_term_fk
    FOREIGN KEY (workspace_id, term_id)
    REFERENCES struinfo.vocabulary_term (workspace_id, term_id),
  CONSTRAINT vocabulary_term_revision_parent_fk
    FOREIGN KEY (workspace_id, parent_term_id)
    REFERENCES struinfo.vocabulary_term (workspace_id, term_id),
  CONSTRAINT vocabulary_term_revision_ordinal_ck
    CHECK (revision_number >= 1),
  CONSTRAINT vocabulary_term_revision_display_ck
    CHECK (btrim(display_name) <> ''),
  CONSTRAINT vocabulary_term_revision_description_ck
    CHECK (description IS NULL OR btrim(description) <> ''),
  CONSTRAINT vocabulary_term_revision_parent_not_self_ck
    CHECK (parent_term_id IS NULL OR parent_term_id <> term_id),
  CONSTRAINT vocabulary_term_revision_lifecycle_ck
    CHECK (lifecycle IN ('active', 'retired')),
  CONSTRAINT vocabulary_term_revision_ordinal_uq
    UNIQUE (workspace_id, term_id, revision_number),
  CONSTRAINT vocabulary_term_revision_exact_uq
    UNIQUE (
      workspace_id,
      term_id,
      revision_number,
      term_revision_id
    )
);

ALTER TABLE struinfo.vocabulary_term
  ADD CONSTRAINT vocabulary_term_current_revision_fk
  FOREIGN KEY (
    workspace_id,
    term_id,
    current_revision,
    current_term_revision_id
  )
  REFERENCES struinfo.vocabulary_term_revision (
    workspace_id,
    term_id,
    revision_number,
    term_revision_id
  )
  DEFERRABLE INITIALLY DEFERRED;

CREATE TABLE struinfo.classification_assignment (
  workspace_id uuid NOT NULL,
  assignment_id uuid NOT NULL,
  target_id uuid NOT NULL,
  term_id uuid NOT NULL,
  current_revision integer NOT NULL,
  current_assignment_revision_id uuid NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT classification_assignment_pk
    PRIMARY KEY (workspace_id, assignment_id),
  CONSTRAINT classification_assignment_target_fk
    FOREIGN KEY (workspace_id, target_id)
    REFERENCES struinfo.curation_target (workspace_id, target_id),
  CONSTRAINT classification_assignment_term_fk
    FOREIGN KEY (workspace_id, term_id)
    REFERENCES struinfo.vocabulary_term (workspace_id, term_id),
  CONSTRAINT classification_assignment_revision_ck
    CHECK (current_revision >= 1),
  CONSTRAINT classification_assignment_target_term_uq
    UNIQUE (workspace_id, target_id, term_id),
  CONSTRAINT classification_assignment_exact_term_uq
    UNIQUE (workspace_id, assignment_id, term_id),
  CONSTRAINT classification_assignment_current_identity_uq
    UNIQUE (
      workspace_id,
      assignment_id,
      current_revision,
      current_assignment_revision_id
    )
);

CREATE TABLE struinfo.classification_assignment_revision (
  workspace_id uuid NOT NULL,
  assignment_id uuid NOT NULL,
  assignment_revision_id uuid NOT NULL,
  revision_number integer NOT NULL,
  assignment_state text NOT NULL,
  term_id uuid NOT NULL,
  term_revision_number integer NOT NULL,
  term_revision_id uuid NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT classification_assignment_revision_pk
    PRIMARY KEY (workspace_id, assignment_id, assignment_revision_id),
  CONSTRAINT classification_assignment_revision_assignment_fk
    FOREIGN KEY (workspace_id, assignment_id, term_id)
    REFERENCES struinfo.classification_assignment (
      workspace_id,
      assignment_id,
      term_id
    ),
  CONSTRAINT classification_assignment_revision_term_revision_fk
    FOREIGN KEY (
      workspace_id,
      term_id,
      term_revision_number,
      term_revision_id
    )
    REFERENCES struinfo.vocabulary_term_revision (
      workspace_id,
      term_id,
      revision_number,
      term_revision_id
    ),
  CONSTRAINT classification_assignment_revision_ordinal_ck
    CHECK (revision_number >= 1),
  CONSTRAINT classification_assignment_revision_state_ck
    CHECK (assignment_state IN ('assigned', 'removed')),
  CONSTRAINT classification_assignment_revision_ordinal_uq
    UNIQUE (workspace_id, assignment_id, revision_number),
  CONSTRAINT classification_assignment_revision_exact_uq
    UNIQUE (
      workspace_id,
      assignment_id,
      revision_number,
      assignment_revision_id
    )
);

ALTER TABLE struinfo.classification_assignment
  ADD CONSTRAINT classification_assignment_current_revision_fk
  FOREIGN KEY (
    workspace_id,
    assignment_id,
    current_revision,
    current_assignment_revision_id
  )
  REFERENCES struinfo.classification_assignment_revision (
    workspace_id,
    assignment_id,
    revision_number,
    assignment_revision_id
  )
  DEFERRABLE INITIALLY DEFERRED;

CREATE TABLE struinfo.intake_decision (
  workspace_id uuid NOT NULL,
  decision_id uuid NOT NULL,
  target_id uuid NOT NULL,
  current_revision integer NOT NULL,
  current_decision_revision_id uuid NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT intake_decision_pk PRIMARY KEY (workspace_id, decision_id),
  CONSTRAINT intake_decision_target_fk
    FOREIGN KEY (workspace_id, target_id)
    REFERENCES struinfo.curation_target (workspace_id, target_id),
  CONSTRAINT intake_decision_revision_ck CHECK (current_revision >= 1),
  CONSTRAINT intake_decision_target_uq UNIQUE (workspace_id, target_id),
  CONSTRAINT intake_decision_current_identity_uq
    UNIQUE (
      workspace_id,
      decision_id,
      current_revision,
      current_decision_revision_id
    )
);

CREATE TABLE struinfo.intake_decision_revision (
  workspace_id uuid NOT NULL,
  decision_id uuid NOT NULL,
  decision_revision_id uuid NOT NULL,
  revision_number integer NOT NULL,
  intake_action text NOT NULL,
  note text,
  created_at timestamp with time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT intake_decision_revision_pk
    PRIMARY KEY (workspace_id, decision_id, decision_revision_id),
  CONSTRAINT intake_decision_revision_decision_fk
    FOREIGN KEY (workspace_id, decision_id)
    REFERENCES struinfo.intake_decision (workspace_id, decision_id),
  CONSTRAINT intake_decision_revision_ordinal_ck
    CHECK (revision_number >= 1),
  CONSTRAINT intake_decision_revision_action_ck
    CHECK (
      intake_action IN (
        'full',
        'split',
        'condense',
        'source_only',
        'ignore',
        'needs_review'
      )
    ),
  CONSTRAINT intake_decision_revision_note_ck
    CHECK (note IS NULL OR btrim(note) <> ''),
  CONSTRAINT intake_decision_revision_ordinal_uq
    UNIQUE (workspace_id, decision_id, revision_number),
  CONSTRAINT intake_decision_revision_exact_uq
    UNIQUE (
      workspace_id,
      decision_id,
      revision_number,
      decision_revision_id
    )
);

ALTER TABLE struinfo.intake_decision
  ADD CONSTRAINT intake_decision_current_revision_fk
  FOREIGN KEY (
    workspace_id,
    decision_id,
    current_revision,
    current_decision_revision_id
  )
  REFERENCES struinfo.intake_decision_revision (
    workspace_id,
    decision_id,
    revision_number,
    decision_revision_id
  )
  DEFERRABLE INITIALLY DEFERRED;

CREATE TABLE struinfo.intake_decision_reason (
  workspace_id uuid NOT NULL,
  decision_id uuid NOT NULL,
  decision_revision_id uuid NOT NULL,
  reason_ordinal integer NOT NULL,
  reason_code text NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT intake_decision_reason_pk
    PRIMARY KEY (
      workspace_id,
      decision_id,
      decision_revision_id,
      reason_ordinal
    ),
  CONSTRAINT intake_decision_reason_revision_fk
    FOREIGN KEY (workspace_id, decision_id, decision_revision_id)
    REFERENCES struinfo.intake_decision_revision (
      workspace_id,
      decision_id,
      decision_revision_id
    ),
  CONSTRAINT intake_decision_reason_ordinal_ck
    CHECK (reason_ordinal >= 0 AND reason_ordinal < 10),
  CONSTRAINT intake_decision_reason_code_ck
    CHECK (
      reason_code IN (
        'already_known',
        'low_information_value',
        'high_noise_or_marketing',
        'unreliable_source',
        'insufficient_evidence',
        'temporarily_not_needed',
        'not_interested',
        'worth_exploring',
        'recommendation_direction_right_sample_wrong',
        'other'
      )
    ),
  CONSTRAINT intake_decision_reason_code_uq
    UNIQUE (
      workspace_id,
      decision_id,
      decision_revision_id,
      reason_code
    )
);

CREATE TABLE struinfo.assessment (
  workspace_id uuid NOT NULL,
  assessment_id uuid NOT NULL,
  target_id uuid NOT NULL,
  dimension text NOT NULL,
  current_revision integer NOT NULL,
  current_assessment_revision_id uuid NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT assessment_pk PRIMARY KEY (workspace_id, assessment_id),
  CONSTRAINT assessment_target_fk
    FOREIGN KEY (workspace_id, target_id)
    REFERENCES struinfo.curation_target (workspace_id, target_id),
  CONSTRAINT assessment_dimension_ck
    CHECK (
      dimension IN (
        'information_density',
        'breadth',
        'depth',
        'novelty',
        'current_interest',
        'neighborhood_expansion',
        'cross_domain_connection',
        'foundational_gap',
        'emerging_signal',
        'viewpoint_source_diversity',
        'serendipity',
        'noise_marketing',
        'cognitive_cost',
        'traceability',
        'source_reliability',
        'extraction_confidence',
        'identity_confidence',
        'corroboration',
        'freshness'
      )
    ),
  CONSTRAINT assessment_revision_ck CHECK (current_revision >= 1),
  CONSTRAINT assessment_target_dimension_uq
    UNIQUE (workspace_id, target_id, dimension),
  CONSTRAINT assessment_current_identity_uq
    UNIQUE (
      workspace_id,
      assessment_id,
      current_revision,
      current_assessment_revision_id
    )
);

CREATE TABLE struinfo.assessment_revision (
  workspace_id uuid NOT NULL,
  assessment_id uuid NOT NULL,
  assessment_revision_id uuid NOT NULL,
  revision_number integer NOT NULL,
  assessment_state text NOT NULL,
  score integer,
  note text,
  created_at timestamp with time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT assessment_revision_pk
    PRIMARY KEY (workspace_id, assessment_id, assessment_revision_id),
  CONSTRAINT assessment_revision_assessment_fk
    FOREIGN KEY (workspace_id, assessment_id)
    REFERENCES struinfo.assessment (workspace_id, assessment_id),
  CONSTRAINT assessment_revision_ordinal_ck CHECK (revision_number >= 1),
  CONSTRAINT assessment_revision_state_ck
    CHECK (assessment_state IN ('rated', 'cleared')),
  CONSTRAINT assessment_revision_value_ck
    CHECK (
      (
        assessment_state = 'rated'
        AND score IS NOT NULL
        AND score >= 0
        AND score <= 4
        AND (note IS NULL OR btrim(note) <> '')
      )
      OR (
        assessment_state = 'cleared'
        AND score IS NULL
        AND note IS NULL
      )
    ),
  CONSTRAINT assessment_revision_ordinal_uq
    UNIQUE (workspace_id, assessment_id, revision_number),
  CONSTRAINT assessment_revision_exact_uq
    UNIQUE (
      workspace_id,
      assessment_id,
      revision_number,
      assessment_revision_id
    )
);

ALTER TABLE struinfo.assessment
  ADD CONSTRAINT assessment_current_revision_fk
  FOREIGN KEY (
    workspace_id,
    assessment_id,
    current_revision,
    current_assessment_revision_id
  )
  REFERENCES struinfo.assessment_revision (
    workspace_id,
    assessment_id,
    revision_number,
    assessment_revision_id
  )
  DEFERRABLE INITIALLY DEFERRED;

CREATE TABLE struinfo.curation_command (
  workspace_id uuid NOT NULL,
  command_idempotency_key text NOT NULL,
  request_sha256 text NOT NULL,
  command_kind text NOT NULL,
  authority text NOT NULL,
  target_id uuid,
  term_id uuid,
  outcome text NOT NULL,
  resulting_version integer NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT curation_command_pk
    PRIMARY KEY (workspace_id, command_idempotency_key),
  CONSTRAINT curation_command_workspace_fk
    FOREIGN KEY (workspace_id)
    REFERENCES struinfo.workspace (workspace_id),
  CONSTRAINT curation_command_target_fk
    FOREIGN KEY (workspace_id, target_id)
    REFERENCES struinfo.curation_target (workspace_id, target_id),
  CONSTRAINT curation_command_term_fk
    FOREIGN KEY (workspace_id, term_id)
    REFERENCES struinfo.vocabulary_term (workspace_id, term_id),
  CONSTRAINT curation_command_sha256_ck
    CHECK (request_sha256 ~ '^[0-9a-f]{64}$'),
  CONSTRAINT curation_command_key_ck
    CHECK (command_idempotency_key ~ '^[A-Za-z0-9._:-]{1,200}$'),
  CONSTRAINT curation_command_kind_ck
    CHECK (
      command_kind IN (
        'put_content_classification_term',
        'apply_manual_curation'
      )
    ),
  CONSTRAINT curation_command_authority_ck CHECK (authority = 'manual_user'),
  CONSTRAINT curation_command_subject_ck
    CHECK (
      (
        command_kind = 'put_content_classification_term'
        AND term_id IS NOT NULL
        AND target_id IS NULL
      )
      OR (
        command_kind = 'apply_manual_curation'
        AND target_id IS NOT NULL
        AND term_id IS NULL
      )
    ),
  CONSTRAINT curation_command_outcome_ck
    CHECK (outcome IN ('applied', 'unchanged')),
  CONSTRAINT curation_command_resulting_version_ck
    CHECK (
      resulting_version >= 0
      AND (outcome <> 'applied' OR resulting_version >= 1)
      AND (
        command_kind <> 'put_content_classification_term'
        OR resulting_version >= 1
      )
    )
);
