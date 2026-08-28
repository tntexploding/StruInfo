ALTER TABLE struinfo.intake_decision
  ADD CONSTRAINT intake_decision_target_identity_uq
  UNIQUE (workspace_id, target_id, decision_id);

CREATE TABLE struinfo.knowledge_change_set (
  workspace_id uuid NOT NULL,
  change_set_id uuid NOT NULL,
  command_idempotency_key text NOT NULL,
  request_sha256 text NOT NULL,
  command_kind text NOT NULL,
  authority text NOT NULL,
  operation_origin text NOT NULL,
  authorization_kind text NOT NULL,
  target_id uuid,
  decision_id uuid,
  decision_revision integer,
  decision_revision_id uuid,
  original_outcome text NOT NULL,
  operation_count integer NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT knowledge_change_set_pk
    PRIMARY KEY (workspace_id, change_set_id),
  CONSTRAINT knowledge_change_set_workspace_fk
    FOREIGN KEY (workspace_id)
    REFERENCES struinfo.workspace (workspace_id),
  CONSTRAINT knowledge_change_set_target_fk
    FOREIGN KEY (workspace_id, target_id)
    REFERENCES struinfo.curation_target (workspace_id, target_id),
  CONSTRAINT knowledge_change_set_decision_fk
    FOREIGN KEY (workspace_id, target_id, decision_id)
    REFERENCES struinfo.intake_decision (
      workspace_id,
      target_id,
      decision_id
    ),
  CONSTRAINT knowledge_change_set_decision_revision_fk
    FOREIGN KEY (
      workspace_id,
      decision_id,
      decision_revision,
      decision_revision_id
    )
    REFERENCES struinfo.intake_decision_revision (
      workspace_id,
      decision_id,
      revision_number,
      decision_revision_id
    ),
  CONSTRAINT knowledge_change_set_command_uq
    UNIQUE (workspace_id, command_idempotency_key),
  CONSTRAINT knowledge_change_set_idempotency_key_ck
    CHECK (command_idempotency_key ~ '^[A-Za-z0-9._:-]{1,200}$'),
  CONSTRAINT knowledge_change_set_request_sha256_ck
    CHECK (request_sha256 ~ '^[0-9a-f]{64}$'),
  CONSTRAINT knowledge_change_set_command_kind_ck
    CHECK (command_kind = 'apply_manual_knowledge_change_set'),
  CONSTRAINT knowledge_change_set_authority_ck
    CHECK (authority = 'manual_user'),
  CONSTRAINT knowledge_change_set_origin_ck
    CHECK (operation_origin = 'manual_user'),
  CONSTRAINT knowledge_change_set_authorization_kind_ck
    CHECK (authorization_kind IN ('eligible_target', 'manual_edit')),
  CONSTRAINT knowledge_change_set_authorization_branch_ck
    CHECK (
      (
        authorization_kind = 'eligible_target'
        AND target_id IS NOT NULL
        AND decision_id IS NOT NULL
        AND decision_revision IS NOT NULL
        AND decision_revision_id IS NOT NULL
      )
      OR (
        authorization_kind = 'manual_edit'
        AND target_id IS NULL
        AND decision_id IS NULL
        AND decision_revision IS NULL
        AND decision_revision_id IS NULL
      )
    ),
  CONSTRAINT knowledge_change_set_decision_revision_ck
    CHECK (decision_revision IS NULL OR decision_revision >= 1),
  CONSTRAINT knowledge_change_set_outcome_ck
    CHECK (original_outcome IN ('applied', 'unchanged')),
  CONSTRAINT knowledge_change_set_operation_count_ck
    CHECK (operation_count >= 1 AND operation_count <= 64)
);

CREATE TABLE struinfo.knowledge_item (
  workspace_id uuid NOT NULL,
  item_id uuid NOT NULL,
  current_revision integer NOT NULL,
  current_revision_id uuid NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT knowledge_item_pk PRIMARY KEY (workspace_id, item_id),
  CONSTRAINT knowledge_item_workspace_fk
    FOREIGN KEY (workspace_id)
    REFERENCES struinfo.workspace (workspace_id),
  CONSTRAINT knowledge_item_current_revision_ck
    CHECK (current_revision >= 1),
  CONSTRAINT knowledge_item_current_identity_uq
    UNIQUE (
      workspace_id,
      item_id,
      current_revision,
      current_revision_id
    )
);

CREATE TABLE struinfo.knowledge_revision (
  workspace_id uuid NOT NULL,
  item_id uuid NOT NULL,
  revision_id uuid NOT NULL,
  revision_number integer NOT NULL,
  knowledge_kind text NOT NULL,
  epistemic_role text NOT NULL,
  review_state text NOT NULL,
  title text NOT NULL,
  body text,
  change_set_id uuid NOT NULL,
  operation_index integer NOT NULL,
  previous_revision_id uuid,
  created_at timestamp with time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT knowledge_revision_pk
    PRIMARY KEY (workspace_id, item_id, revision_id),
  CONSTRAINT knowledge_revision_item_fk
    FOREIGN KEY (workspace_id, item_id)
    REFERENCES struinfo.knowledge_item (workspace_id, item_id),
  CONSTRAINT knowledge_revision_change_set_fk
    FOREIGN KEY (workspace_id, change_set_id)
    REFERENCES struinfo.knowledge_change_set (workspace_id, change_set_id),
  CONSTRAINT knowledge_revision_previous_fk
    FOREIGN KEY (workspace_id, item_id, previous_revision_id)
    REFERENCES struinfo.knowledge_revision (
      workspace_id,
      item_id,
      revision_id
    ),
  CONSTRAINT knowledge_revision_number_ck
    CHECK (revision_number >= 1),
  CONSTRAINT knowledge_revision_kind_ck
    CHECK (
      knowledge_kind IN (
        'entity',
        'concept',
        'assertion',
        'event',
        'method',
        'framework',
        'resource',
        'work'
      )
    ),
  CONSTRAINT knowledge_revision_role_ck
    CHECK (
      epistemic_role IN (
        'source_excerpt',
        'source_claim',
        'summary',
        'inference',
        'user_assertion'
      )
    ),
  CONSTRAINT knowledge_revision_review_state_ck
    CHECK (
      review_state IN (
        'draft',
        'pending_review',
        'confirmed',
        'disputed',
        'rejected',
        'withdrawn'
      )
    ),
  CONSTRAINT knowledge_revision_title_ck CHECK (btrim(title) <> ''),
  CONSTRAINT knowledge_revision_body_ck
    CHECK (body IS NULL OR btrim(body) <> ''),
  CONSTRAINT knowledge_revision_operation_index_ck
    CHECK (operation_index >= 0 AND operation_index < 64),
  CONSTRAINT knowledge_revision_predecessor_shape_ck
    CHECK (
      (revision_number = 1 AND previous_revision_id IS NULL)
      OR (revision_number > 1 AND previous_revision_id IS NOT NULL)
    ),
  CONSTRAINT knowledge_revision_ordinal_uq
    UNIQUE (workspace_id, item_id, revision_number),
  CONSTRAINT knowledge_revision_exact_uq
    UNIQUE (workspace_id, item_id, revision_number, revision_id)
);

ALTER TABLE struinfo.knowledge_item
  ADD CONSTRAINT knowledge_item_current_revision_fk
  FOREIGN KEY (
    workspace_id,
    item_id,
    current_revision,
    current_revision_id
  )
  REFERENCES struinfo.knowledge_revision (
    workspace_id,
    item_id,
    revision_number,
    revision_id
  )
  DEFERRABLE INITIALLY DEFERRED;

CREATE TABLE struinfo.knowledge_relation (
  workspace_id uuid NOT NULL,
  relation_id uuid NOT NULL,
  subject_item_id uuid NOT NULL,
  relation_type_key text NOT NULL,
  object_item_id uuid NOT NULL,
  current_revision integer NOT NULL,
  current_revision_id uuid NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT knowledge_relation_pk
    PRIMARY KEY (workspace_id, relation_id),
  CONSTRAINT knowledge_relation_workspace_fk
    FOREIGN KEY (workspace_id)
    REFERENCES struinfo.workspace (workspace_id),
  CONSTRAINT knowledge_relation_subject_fk
    FOREIGN KEY (workspace_id, subject_item_id)
    REFERENCES struinfo.knowledge_item (workspace_id, item_id),
  CONSTRAINT knowledge_relation_object_fk
    FOREIGN KEY (workspace_id, object_item_id)
    REFERENCES struinfo.knowledge_item (workspace_id, item_id),
  CONSTRAINT knowledge_relation_not_self_ck
    CHECK (subject_item_id <> object_item_id),
  CONSTRAINT knowledge_relation_type_key_ck
    CHECK (btrim(relation_type_key) <> ''),
  CONSTRAINT knowledge_relation_current_revision_ck
    CHECK (current_revision >= 1),
  CONSTRAINT knowledge_relation_stable_identity_uq
    UNIQUE (
      workspace_id,
      relation_id,
      subject_item_id,
      relation_type_key,
      object_item_id
    ),
  CONSTRAINT knowledge_relation_current_identity_uq
    UNIQUE (
      workspace_id,
      relation_id,
      current_revision,
      current_revision_id
    )
);

CREATE TABLE struinfo.knowledge_relation_revision (
  workspace_id uuid NOT NULL,
  relation_id uuid NOT NULL,
  revision_id uuid NOT NULL,
  revision_number integer NOT NULL,
  subject_item_id uuid NOT NULL,
  relation_type_key text NOT NULL,
  object_item_id uuid NOT NULL,
  epistemic_role text NOT NULL,
  review_state text NOT NULL,
  qualifier text,
  change_set_id uuid NOT NULL,
  operation_index integer NOT NULL,
  previous_revision_id uuid,
  created_at timestamp with time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT knowledge_relation_revision_pk
    PRIMARY KEY (workspace_id, relation_id, revision_id),
  CONSTRAINT knowledge_relation_revision_relation_fk
    FOREIGN KEY (
      workspace_id,
      relation_id,
      subject_item_id,
      relation_type_key,
      object_item_id
    )
    REFERENCES struinfo.knowledge_relation (
      workspace_id,
      relation_id,
      subject_item_id,
      relation_type_key,
      object_item_id
    ),
  CONSTRAINT knowledge_relation_revision_subject_fk
    FOREIGN KEY (workspace_id, subject_item_id)
    REFERENCES struinfo.knowledge_item (workspace_id, item_id),
  CONSTRAINT knowledge_relation_revision_object_fk
    FOREIGN KEY (workspace_id, object_item_id)
    REFERENCES struinfo.knowledge_item (workspace_id, item_id),
  CONSTRAINT knowledge_relation_revision_change_set_fk
    FOREIGN KEY (workspace_id, change_set_id)
    REFERENCES struinfo.knowledge_change_set (workspace_id, change_set_id),
  CONSTRAINT knowledge_relation_revision_previous_fk
    FOREIGN KEY (workspace_id, relation_id, previous_revision_id)
    REFERENCES struinfo.knowledge_relation_revision (
      workspace_id,
      relation_id,
      revision_id
    ),
  CONSTRAINT knowledge_relation_revision_number_ck
    CHECK (revision_number >= 1),
  CONSTRAINT knowledge_relation_revision_not_self_ck
    CHECK (subject_item_id <> object_item_id),
  CONSTRAINT knowledge_relation_revision_type_key_ck
    CHECK (btrim(relation_type_key) <> ''),
  CONSTRAINT knowledge_relation_revision_role_ck
    CHECK (
      epistemic_role IN (
        'source_claim',
        'summary',
        'inference',
        'user_assertion'
      )
    ),
  CONSTRAINT knowledge_relation_revision_review_state_ck
    CHECK (
      review_state IN (
        'draft',
        'pending_review',
        'confirmed',
        'disputed',
        'rejected',
        'withdrawn'
      )
    ),
  CONSTRAINT knowledge_relation_revision_qualifier_ck
    CHECK (qualifier IS NULL OR btrim(qualifier) <> ''),
  CONSTRAINT knowledge_relation_revision_operation_index_ck
    CHECK (operation_index >= 0 AND operation_index < 64),
  CONSTRAINT knowledge_relation_revision_predecessor_shape_ck
    CHECK (
      (revision_number = 1 AND previous_revision_id IS NULL)
      OR (revision_number > 1 AND previous_revision_id IS NOT NULL)
    ),
  CONSTRAINT knowledge_relation_revision_ordinal_uq
    UNIQUE (workspace_id, relation_id, revision_number),
  CONSTRAINT knowledge_relation_revision_exact_uq
    UNIQUE (workspace_id, relation_id, revision_number, revision_id)
);

ALTER TABLE struinfo.knowledge_relation
  ADD CONSTRAINT knowledge_relation_current_revision_fk
  FOREIGN KEY (
    workspace_id,
    relation_id,
    current_revision,
    current_revision_id
  )
  REFERENCES struinfo.knowledge_relation_revision (
    workspace_id,
    relation_id,
    revision_number,
    revision_id
  )
  DEFERRABLE INITIALLY DEFERRED;

CREATE TABLE struinfo.knowledge_change_operation (
  workspace_id uuid NOT NULL,
  change_set_id uuid NOT NULL,
  operation_index integer NOT NULL,
  operation_kind text NOT NULL,
  item_id uuid,
  relation_id uuid,
  operation_outcome text NOT NULL,
  resulting_revision integer NOT NULL,
  resulting_revision_id uuid NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT knowledge_change_operation_pk
    PRIMARY KEY (workspace_id, change_set_id, operation_index),
  CONSTRAINT knowledge_change_operation_change_set_fk
    FOREIGN KEY (workspace_id, change_set_id)
    REFERENCES struinfo.knowledge_change_set (workspace_id, change_set_id),
  CONSTRAINT knowledge_change_operation_item_fk
    FOREIGN KEY (workspace_id, item_id)
    REFERENCES struinfo.knowledge_item (workspace_id, item_id),
  CONSTRAINT knowledge_change_operation_relation_fk
    FOREIGN KEY (workspace_id, relation_id)
    REFERENCES struinfo.knowledge_relation (workspace_id, relation_id),
  CONSTRAINT knowledge_change_operation_index_ck
    CHECK (operation_index >= 0 AND operation_index < 64),
  CONSTRAINT knowledge_change_operation_kind_ck
    CHECK (operation_kind IN ('put_item', 'put_relation')),
  CONSTRAINT knowledge_change_operation_branch_ck
    CHECK (
      (
        operation_kind = 'put_item'
        AND item_id IS NOT NULL
        AND relation_id IS NULL
      )
      OR (
        operation_kind = 'put_relation'
        AND item_id IS NULL
        AND relation_id IS NOT NULL
      )
    ),
  CONSTRAINT knowledge_change_operation_outcome_ck
    CHECK (operation_outcome IN ('applied', 'unchanged')),
  CONSTRAINT knowledge_change_operation_revision_ck
    CHECK (resulting_revision >= 1)
);

CREATE UNIQUE INDEX knowledge_change_operation_item_uq
  ON struinfo.knowledge_change_operation (
    workspace_id,
    change_set_id,
    item_id
  )
  WHERE operation_kind = 'put_item';

CREATE UNIQUE INDEX knowledge_change_operation_relation_uq
  ON struinfo.knowledge_change_operation (
    workspace_id,
    change_set_id,
    relation_id
  )
  WHERE operation_kind = 'put_relation';

ALTER TABLE struinfo.knowledge_revision
  ADD CONSTRAINT knowledge_revision_change_operation_fk
  FOREIGN KEY (workspace_id, change_set_id, operation_index)
  REFERENCES struinfo.knowledge_change_operation (
    workspace_id,
    change_set_id,
    operation_index
  )
  DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE struinfo.knowledge_relation_revision
  ADD CONSTRAINT knowledge_relation_revision_change_operation_fk
  FOREIGN KEY (workspace_id, change_set_id, operation_index)
  REFERENCES struinfo.knowledge_change_operation (
    workspace_id,
    change_set_id,
    operation_index
  )
  DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE struinfo.knowledge_change_operation
  ADD CONSTRAINT knowledge_change_operation_item_revision_fk
  FOREIGN KEY (
    workspace_id,
    item_id,
    resulting_revision,
    resulting_revision_id
  )
  REFERENCES struinfo.knowledge_revision (
    workspace_id,
    item_id,
    revision_number,
    revision_id
  )
  DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE struinfo.knowledge_change_operation
  ADD CONSTRAINT knowledge_change_operation_relation_revision_fk
  FOREIGN KEY (
    workspace_id,
    relation_id,
    resulting_revision,
    resulting_revision_id
  )
  REFERENCES struinfo.knowledge_relation_revision (
    workspace_id,
    relation_id,
    revision_number,
    revision_id
  )
  DEFERRABLE INITIALLY DEFERRED;

CREATE TABLE struinfo.knowledge_revision_fragment_input (
  workspace_id uuid NOT NULL,
  item_id uuid NOT NULL,
  revision_number integer NOT NULL,
  revision_id uuid NOT NULL,
  input_kind text NOT NULL,
  input_ordinal integer NOT NULL,
  fragment_id uuid NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT knowledge_revision_fragment_input_pk
    PRIMARY KEY (
      workspace_id,
      item_id,
      revision_id,
      input_kind,
      input_ordinal
    ),
  CONSTRAINT knowledge_revision_fragment_input_revision_fk
    FOREIGN KEY (workspace_id, item_id, revision_number, revision_id)
    REFERENCES struinfo.knowledge_revision (
      workspace_id,
      item_id,
      revision_number,
      revision_id
    ),
  CONSTRAINT knowledge_revision_fragment_input_fragment_fk
    FOREIGN KEY (workspace_id, fragment_id)
    REFERENCES struinfo.fragment (workspace_id, fragment_id),
  CONSTRAINT knowledge_revision_fragment_input_kind_ck
    CHECK (input_kind IN ('citation', 'derivation')),
  CONSTRAINT knowledge_revision_fragment_input_ordinal_ck
    CHECK (input_ordinal >= 0 AND input_ordinal < 64),
  CONSTRAINT knowledge_revision_fragment_input_identity_uq
    UNIQUE (workspace_id, item_id, revision_id, fragment_id)
);

CREATE TABLE struinfo.knowledge_revision_item_input (
  workspace_id uuid NOT NULL,
  item_id uuid NOT NULL,
  revision_number integer NOT NULL,
  revision_id uuid NOT NULL,
  input_ordinal integer NOT NULL,
  input_item_id uuid NOT NULL,
  input_revision_number integer NOT NULL,
  input_revision_id uuid NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT knowledge_revision_item_input_pk
    PRIMARY KEY (workspace_id, item_id, revision_id, input_ordinal),
  CONSTRAINT knowledge_revision_item_input_output_fk
    FOREIGN KEY (workspace_id, item_id, revision_number, revision_id)
    REFERENCES struinfo.knowledge_revision (
      workspace_id,
      item_id,
      revision_number,
      revision_id
    ),
  CONSTRAINT knowledge_revision_item_input_input_fk
    FOREIGN KEY (
      workspace_id,
      input_item_id,
      input_revision_number,
      input_revision_id
    )
    REFERENCES struinfo.knowledge_revision (
      workspace_id,
      item_id,
      revision_number,
      revision_id
    ),
  CONSTRAINT knowledge_revision_item_input_ordinal_ck
    CHECK (input_ordinal >= 0 AND input_ordinal < 64),
  CONSTRAINT knowledge_revision_item_input_identity_uq
    UNIQUE (
      workspace_id,
      item_id,
      revision_id,
      input_item_id,
      input_revision_number
    )
);

CREATE TABLE struinfo.knowledge_revision_relation_input (
  workspace_id uuid NOT NULL,
  item_id uuid NOT NULL,
  revision_number integer NOT NULL,
  revision_id uuid NOT NULL,
  input_ordinal integer NOT NULL,
  input_relation_id uuid NOT NULL,
  input_revision_number integer NOT NULL,
  input_revision_id uuid NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT knowledge_revision_relation_input_pk
    PRIMARY KEY (workspace_id, item_id, revision_id, input_ordinal),
  CONSTRAINT knowledge_revision_relation_input_output_fk
    FOREIGN KEY (workspace_id, item_id, revision_number, revision_id)
    REFERENCES struinfo.knowledge_revision (
      workspace_id,
      item_id,
      revision_number,
      revision_id
    ),
  CONSTRAINT knowledge_revision_relation_input_input_fk
    FOREIGN KEY (
      workspace_id,
      input_relation_id,
      input_revision_number,
      input_revision_id
    )
    REFERENCES struinfo.knowledge_relation_revision (
      workspace_id,
      relation_id,
      revision_number,
      revision_id
    ),
  CONSTRAINT knowledge_revision_relation_input_ordinal_ck
    CHECK (input_ordinal >= 0 AND input_ordinal < 64),
  CONSTRAINT knowledge_revision_relation_input_identity_uq
    UNIQUE (
      workspace_id,
      item_id,
      revision_id,
      input_relation_id,
      input_revision_number
    )
);

CREATE TABLE struinfo.relation_revision_fragment_input (
  workspace_id uuid NOT NULL,
  relation_id uuid NOT NULL,
  revision_number integer NOT NULL,
  revision_id uuid NOT NULL,
  input_kind text NOT NULL,
  input_ordinal integer NOT NULL,
  fragment_id uuid NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT relation_revision_fragment_input_pk
    PRIMARY KEY (
      workspace_id,
      relation_id,
      revision_id,
      input_kind,
      input_ordinal
    ),
  CONSTRAINT relation_revision_fragment_input_revision_fk
    FOREIGN KEY (workspace_id, relation_id, revision_number, revision_id)
    REFERENCES struinfo.knowledge_relation_revision (
      workspace_id,
      relation_id,
      revision_number,
      revision_id
    ),
  CONSTRAINT relation_revision_fragment_input_fragment_fk
    FOREIGN KEY (workspace_id, fragment_id)
    REFERENCES struinfo.fragment (workspace_id, fragment_id),
  CONSTRAINT relation_revision_fragment_input_kind_ck
    CHECK (input_kind IN ('citation', 'derivation')),
  CONSTRAINT relation_revision_fragment_input_ordinal_ck
    CHECK (input_ordinal >= 0 AND input_ordinal < 64),
  CONSTRAINT relation_revision_fragment_input_identity_uq
    UNIQUE (workspace_id, relation_id, revision_id, fragment_id)
);

CREATE TABLE struinfo.relation_revision_item_input (
  workspace_id uuid NOT NULL,
  relation_id uuid NOT NULL,
  revision_number integer NOT NULL,
  revision_id uuid NOT NULL,
  input_ordinal integer NOT NULL,
  input_item_id uuid NOT NULL,
  input_revision_number integer NOT NULL,
  input_revision_id uuid NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT relation_revision_item_input_pk
    PRIMARY KEY (workspace_id, relation_id, revision_id, input_ordinal),
  CONSTRAINT relation_revision_item_input_output_fk
    FOREIGN KEY (workspace_id, relation_id, revision_number, revision_id)
    REFERENCES struinfo.knowledge_relation_revision (
      workspace_id,
      relation_id,
      revision_number,
      revision_id
    ),
  CONSTRAINT relation_revision_item_input_input_fk
    FOREIGN KEY (
      workspace_id,
      input_item_id,
      input_revision_number,
      input_revision_id
    )
    REFERENCES struinfo.knowledge_revision (
      workspace_id,
      item_id,
      revision_number,
      revision_id
    ),
  CONSTRAINT relation_revision_item_input_ordinal_ck
    CHECK (input_ordinal >= 0 AND input_ordinal < 64),
  CONSTRAINT relation_revision_item_input_identity_uq
    UNIQUE (
      workspace_id,
      relation_id,
      revision_id,
      input_item_id,
      input_revision_number
    )
);

CREATE TABLE struinfo.relation_revision_relation_input (
  workspace_id uuid NOT NULL,
  relation_id uuid NOT NULL,
  revision_number integer NOT NULL,
  revision_id uuid NOT NULL,
  input_ordinal integer NOT NULL,
  input_relation_id uuid NOT NULL,
  input_revision_number integer NOT NULL,
  input_revision_id uuid NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT relation_revision_relation_input_pk
    PRIMARY KEY (workspace_id, relation_id, revision_id, input_ordinal),
  CONSTRAINT relation_revision_relation_input_output_fk
    FOREIGN KEY (workspace_id, relation_id, revision_number, revision_id)
    REFERENCES struinfo.knowledge_relation_revision (
      workspace_id,
      relation_id,
      revision_number,
      revision_id
    ),
  CONSTRAINT relation_revision_relation_input_input_fk
    FOREIGN KEY (
      workspace_id,
      input_relation_id,
      input_revision_number,
      input_revision_id
    )
    REFERENCES struinfo.knowledge_relation_revision (
      workspace_id,
      relation_id,
      revision_number,
      revision_id
    ),
  CONSTRAINT relation_revision_relation_input_ordinal_ck
    CHECK (input_ordinal >= 0 AND input_ordinal < 64),
  CONSTRAINT relation_revision_relation_input_identity_uq
    UNIQUE (
      workspace_id,
      relation_id,
      revision_id,
      input_relation_id,
      input_revision_number
    )
);

CREATE TABLE struinfo.knowledge_change_event (
  workspace_id uuid NOT NULL,
  event_id uuid NOT NULL,
  event_kind text NOT NULL,
  event_schema_version integer NOT NULL,
  change_set_id uuid NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT knowledge_change_event_pk
    PRIMARY KEY (workspace_id, event_id),
  CONSTRAINT knowledge_change_event_change_set_fk
    FOREIGN KEY (workspace_id, change_set_id)
    REFERENCES struinfo.knowledge_change_set (workspace_id, change_set_id),
  CONSTRAINT knowledge_change_event_change_set_uq
    UNIQUE (workspace_id, change_set_id),
  CONSTRAINT knowledge_change_event_kind_ck
    CHECK (event_kind = 'knowledge_change_set_committed'),
  CONSTRAINT knowledge_change_event_schema_version_ck
    CHECK (event_schema_version = 1)
);

CREATE INDEX knowledge_revision_change_operation_idx
  ON struinfo.knowledge_revision (
    workspace_id,
    change_set_id,
    operation_index
  );

CREATE INDEX knowledge_relation_revision_change_operation_idx
  ON struinfo.knowledge_relation_revision (
    workspace_id,
    change_set_id,
    operation_index
  );

CREATE INDEX knowledge_revision_fragment_input_fragment_idx
  ON struinfo.knowledge_revision_fragment_input (workspace_id, fragment_id);

CREATE INDEX relation_revision_fragment_input_fragment_idx
  ON struinfo.relation_revision_fragment_input (workspace_id, fragment_id);
