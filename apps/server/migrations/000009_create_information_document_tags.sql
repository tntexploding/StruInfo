CREATE TABLE struinfo.information_document_tag_set (
  workspace_id uuid NOT NULL,
  resource_id uuid NOT NULL,
  snapshot_id uuid NOT NULL,
  current_revision integer NOT NULL,
  current_revision_id uuid NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT information_document_tag_set_pk
    PRIMARY KEY (workspace_id, snapshot_id),
  CONSTRAINT information_document_tag_set_snapshot_fk
    FOREIGN KEY (workspace_id, resource_id, snapshot_id)
    REFERENCES struinfo.snapshot (workspace_id, resource_id, snapshot_id),
  CONSTRAINT information_document_tag_set_current_revision_ck
    CHECK (current_revision >= 1)
);

CREATE TABLE struinfo.information_document_tag_revision (
  workspace_id uuid NOT NULL,
  snapshot_id uuid NOT NULL,
  revision_number integer NOT NULL,
  revision_id uuid NOT NULL,
  previous_revision_id uuid,
  revision_kind text NOT NULL,
  rule_version text NOT NULL,
  is_private boolean NOT NULL,
  entry_count integer NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT information_document_tag_revision_pk
    PRIMARY KEY (workspace_id, snapshot_id, revision_number),
  CONSTRAINT information_document_tag_revision_id_uq
    UNIQUE (workspace_id, revision_id),
  CONSTRAINT information_document_tag_revision_snapshot_id_uq
    UNIQUE (workspace_id, snapshot_id, revision_id),
  CONSTRAINT information_document_tag_revision_pointer_uq
    UNIQUE (workspace_id, snapshot_id, revision_number, revision_id),
  CONSTRAINT information_document_tag_revision_set_fk
    FOREIGN KEY (workspace_id, snapshot_id)
    REFERENCES struinfo.information_document_tag_set (
      workspace_id,
      snapshot_id
    )
    DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT information_document_tag_revision_previous_fk
    FOREIGN KEY (workspace_id, snapshot_id, previous_revision_id)
    REFERENCES struinfo.information_document_tag_revision (
      workspace_id,
      snapshot_id,
      revision_id
    ),
  CONSTRAINT information_document_tag_revision_number_ck
    CHECK (revision_number >= 1),
  CONSTRAINT information_document_tag_revision_previous_ck
    CHECK (
      (revision_number = 1 AND previous_revision_id IS NULL)
      OR (revision_number > 1 AND previous_revision_id IS NOT NULL)
    ),
  CONSTRAINT information_document_tag_revision_kind_ck
    CHECK (revision_kind IN ('aggregate', 'manual')),
  CONSTRAINT information_document_tag_revision_rule_ck
    CHECK (btrim(rule_version) <> ''),
  CONSTRAINT information_document_tag_revision_entry_count_ck
    CHECK (entry_count >= 0)
);

ALTER TABLE struinfo.information_document_tag_set
  ADD CONSTRAINT information_document_tag_set_current_revision_fk
  FOREIGN KEY (
    workspace_id,
    snapshot_id,
    current_revision,
    current_revision_id
  )
  REFERENCES struinfo.information_document_tag_revision (
    workspace_id,
    snapshot_id,
    revision_number,
    revision_id
  )
  DEFERRABLE INITIALLY DEFERRED;

CREATE TABLE struinfo.information_document_tag_value (
  workspace_id uuid NOT NULL,
  snapshot_id uuid NOT NULL,
  revision_number integer NOT NULL,
  revision_id uuid NOT NULL,
  tag_ordinal integer NOT NULL,
  display_value text NOT NULL,
  normalized_value text NOT NULL,
  origin text NOT NULL,
  full_text_occurrences integer NOT NULL,
  entry_coverage_count integer NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT information_document_tag_value_pk
    PRIMARY KEY (
      workspace_id,
      snapshot_id,
      revision_number,
      tag_ordinal
    ),
  CONSTRAINT information_document_tag_value_revision_fk
    FOREIGN KEY (
      workspace_id,
      snapshot_id,
      revision_number,
      revision_id
    )
    REFERENCES struinfo.information_document_tag_revision (
      workspace_id,
      snapshot_id,
      revision_number,
      revision_id
    ),
  CONSTRAINT information_document_tag_value_ordinal_ck
    CHECK (tag_ordinal >= 0),
  CONSTRAINT information_document_tag_value_display_ck
    CHECK (btrim(display_value) <> ''),
  CONSTRAINT information_document_tag_value_normalized_ck
    CHECK (btrim(normalized_value) <> ''),
  CONSTRAINT information_document_tag_value_origin_ck
    CHECK (origin IN ('aggregate', 'manual')),
  CONSTRAINT information_document_tag_value_occurrences_ck
    CHECK (full_text_occurrences >= 0),
  CONSTRAINT information_document_tag_value_coverage_ck
    CHECK (
      entry_coverage_count >= 0
      AND entry_coverage_count <= 2147483647
    ),
  CONSTRAINT information_document_tag_value_normalized_uq
    UNIQUE (
      workspace_id,
      snapshot_id,
      revision_number,
      normalized_value
    )
);

CREATE INDEX information_document_tag_value_lookup_idx
  ON struinfo.information_document_tag_value (
    workspace_id,
    normalized_value,
    snapshot_id,
    revision_number
  );
