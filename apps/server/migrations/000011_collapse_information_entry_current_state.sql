ALTER TABLE struinfo.information_entry
  ADD COLUMN document_order integer,
  ADD COLUMN title_path text,
  ADD COLUMN body text,
  ADD COLUMN body_sha256 text,
  ADD COLUMN chunk_mode text,
  ADD COLUMN split_rule_version text,
  ADD COLUMN is_private boolean,
  ADD COLUMN type_keyword text,
  ADD COLUMN type_custom_name text,
  ADD COLUMN usefulness_score smallint,
  ADD COLUMN interest_score smallint,
  ADD COLUMN updated_at timestamp with time zone;

UPDATE struinfo.information_entry AS entry
SET
  document_order = revision.document_order,
  title_path = revision.title_path,
  body = revision.body,
  body_sha256 = revision.body_sha256,
  chunk_mode = revision.chunk_mode,
  split_rule_version = revision.split_rule_version,
  is_private = revision.is_private,
  type_keyword = revision.type_keyword,
  type_custom_name = revision.type_custom_name,
  updated_at = revision.created_at
FROM struinfo.information_entry_revision AS revision
WHERE revision.workspace_id = entry.workspace_id
  AND revision.entry_id = entry.entry_id
  AND revision.revision_number = entry.current_revision
  AND revision.revision_id = entry.current_revision_id;

WITH ranked_legacy_scores AS (
  SELECT
    input.workspace_id,
    input.entry_id,
    assessment.dimension,
    (assessment_revision.score + 1)::smallint AS score,
    row_number() OVER (
      PARTITION BY input.workspace_id, input.entry_id, assessment.dimension
      ORDER BY input.input_ordinal, assessment.assessment_id
    ) AS precedence
  FROM struinfo.information_entry AS entry
  JOIN struinfo.information_entry_fragment_input AS input
    ON input.workspace_id = entry.workspace_id
    AND input.entry_id = entry.entry_id
    AND input.revision_number = entry.current_revision
    AND input.revision_id = entry.current_revision_id
  JOIN struinfo.curation_target AS target
    ON target.workspace_id = input.workspace_id
    AND target.target_kind = 'fragment'
    AND target.fragment_id = input.fragment_id
  JOIN struinfo.assessment AS assessment
    ON assessment.workspace_id = target.workspace_id
    AND assessment.target_id = target.target_id
  JOIN struinfo.assessment_revision AS assessment_revision
    ON assessment_revision.workspace_id = assessment.workspace_id
    AND assessment_revision.assessment_id = assessment.assessment_id
    AND assessment_revision.revision_number = assessment.current_revision
    AND assessment_revision.assessment_revision_id = assessment.current_assessment_revision_id
  WHERE assessment.dimension IN ('information_density', 'current_interest')
    AND assessment_revision.assessment_state = 'rated'
),
legacy_scores AS (
  SELECT
    workspace_id,
    entry_id,
    max(score) FILTER (WHERE dimension = 'information_density') AS usefulness_score,
    max(score) FILTER (WHERE dimension = 'current_interest') AS interest_score
  FROM ranked_legacy_scores
  WHERE precedence = 1
  GROUP BY workspace_id, entry_id
)
UPDATE struinfo.information_entry AS entry
SET
  usefulness_score = coalesce(entry.usefulness_score, legacy.usefulness_score),
  interest_score = coalesce(entry.interest_score, legacy.interest_score)
FROM legacy_scores AS legacy
WHERE legacy.workspace_id = entry.workspace_id
  AND legacy.entry_id = entry.entry_id;

-- Flush deferred foreign-key checks raised by the compatibility updates before
-- changing the participating table shape in the same transaction.
SET CONSTRAINTS ALL IMMEDIATE;

ALTER TABLE struinfo.information_entry
  ALTER COLUMN document_order SET NOT NULL,
  ALTER COLUMN title_path SET NOT NULL,
  ALTER COLUMN body SET NOT NULL,
  ALTER COLUMN body_sha256 SET NOT NULL,
  ALTER COLUMN chunk_mode SET NOT NULL,
  ALTER COLUMN split_rule_version SET NOT NULL,
  ALTER COLUMN is_private SET NOT NULL,
  ALTER COLUMN updated_at SET NOT NULL,
  ALTER COLUMN updated_at SET DEFAULT CURRENT_TIMESTAMP,
  ADD CONSTRAINT information_entry_order_ck CHECK (document_order >= 0),
  ADD CONSTRAINT information_entry_body_ck CHECK (body <> ''),
  ADD CONSTRAINT information_entry_body_sha256_ck
    CHECK (body_sha256 ~ '^[0-9a-f]{64}$'),
  ADD CONSTRAINT information_entry_chunk_mode_ck
    CHECK (chunk_mode IN ('split', 'whole')),
  ADD CONSTRAINT information_entry_split_rule_ck
    CHECK (btrim(split_rule_version) <> ''),
  ADD CONSTRAINT information_entry_type_ck
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
  ADD CONSTRAINT information_entry_type_custom_ck
    CHECK (
      (
        type_keyword = 'other'
        AND type_custom_name IS NOT NULL
        AND btrim(type_custom_name) <> ''
      )
      OR (type_keyword IS DISTINCT FROM 'other' AND type_custom_name IS NULL)
    ),
  ADD CONSTRAINT information_entry_usefulness_ck
    CHECK (usefulness_score IS NULL OR usefulness_score BETWEEN 1 AND 5),
  ADD CONSTRAINT information_entry_interest_ck
    CHECK (interest_score IS NULL OR interest_score BETWEEN 1 AND 5);

ALTER TABLE struinfo.information_document_tag_set
  ADD COLUMN revision_kind text,
  ADD COLUMN rule_version text,
  ADD COLUMN is_private boolean,
  ADD COLUMN entry_count integer,
  ADD COLUMN updated_at timestamp with time zone;

UPDATE struinfo.information_document_tag_set AS tag_set
SET
  revision_kind = revision.revision_kind,
  rule_version = revision.rule_version,
  is_private = revision.is_private,
  entry_count = revision.entry_count,
  updated_at = revision.created_at
FROM struinfo.information_document_tag_revision AS revision
WHERE revision.workspace_id = tag_set.workspace_id
  AND revision.snapshot_id = tag_set.snapshot_id
  AND revision.revision_number = tag_set.current_revision
  AND revision.revision_id = tag_set.current_revision_id;

ALTER TABLE struinfo.information_document_tag_set
  ALTER COLUMN revision_kind SET NOT NULL,
  ALTER COLUMN rule_version SET NOT NULL,
  ALTER COLUMN is_private SET NOT NULL,
  ALTER COLUMN entry_count SET NOT NULL,
  ALTER COLUMN updated_at SET NOT NULL,
  ALTER COLUMN updated_at SET DEFAULT CURRENT_TIMESTAMP,
  ADD CONSTRAINT information_document_tag_set_kind_ck
    CHECK (revision_kind IN ('aggregate', 'manual')),
  ADD CONSTRAINT information_document_tag_set_rule_ck
    CHECK (btrim(rule_version) <> ''),
  ADD CONSTRAINT information_document_tag_set_entry_count_ck
    CHECK (entry_count >= 0);

ALTER TABLE struinfo.information_entry_association_override
  ADD COLUMN action text,
  ADD COLUMN manual_adjustment integer,
  ADD COLUMN is_blocked boolean,
  ADD COLUMN updated_at timestamp with time zone;

UPDATE struinfo.information_entry_association_override AS manual_override
SET
  action = revision.action,
  manual_adjustment = revision.manual_adjustment,
  is_blocked = revision.is_blocked,
  updated_at = revision.created_at
FROM struinfo.information_entry_association_override_revision AS revision
WHERE revision.workspace_id = manual_override.workspace_id
  AND revision.entry_low_id = manual_override.entry_low_id
  AND revision.entry_high_id = manual_override.entry_high_id
  AND revision.revision_number = manual_override.current_revision
  AND revision.revision_id = manual_override.current_revision_id;

ALTER TABLE struinfo.information_entry_association_override
  ALTER COLUMN action SET NOT NULL,
  ALTER COLUMN manual_adjustment SET NOT NULL,
  ALTER COLUMN is_blocked SET NOT NULL,
  ALTER COLUMN updated_at SET NOT NULL,
  ALTER COLUMN updated_at SET DEFAULT CURRENT_TIMESTAMP,
  ADD CONSTRAINT entry_assoc_override_action_ck
    CHECK (action IN ('enhance', 'weaken', 'block', 'restore')),
  ADD CONSTRAINT entry_assoc_override_adjustment_ck
    CHECK (manual_adjustment BETWEEN -10000 AND 10000),
  ADD CONSTRAINT entry_assoc_override_block_ck
    CHECK (
      (action = 'block' AND is_blocked AND manual_adjustment = 0)
      OR (action <> 'block' AND NOT is_blocked)
    );

DELETE FROM struinfo.information_entry_fragment_input AS input
USING struinfo.information_entry AS entry
WHERE input.workspace_id = entry.workspace_id
  AND input.entry_id = entry.entry_id
  AND (
    input.revision_number <> entry.current_revision
    OR input.revision_id <> entry.current_revision_id
  );

DELETE FROM struinfo.information_entry_content_keyword AS keyword
USING struinfo.information_entry AS entry
WHERE keyword.workspace_id = entry.workspace_id
  AND keyword.entry_id = entry.entry_id
  AND (
    keyword.revision_number <> entry.current_revision
    OR keyword.revision_id <> entry.current_revision_id
  );
WITH legacy_keyword_candidates AS (
  SELECT
    input.workspace_id,
    input.entry_id,
    entry.current_revision AS revision_number,
    entry.current_revision_id AS revision_id,
    input.input_ordinal,
    assignment.assignment_id,
    term.term_id,
    term_revision.display_name,
    translate(
      btrim(term_revision.display_name),
      'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
      'abcdefghijklmnopqrstuvwxyz'
    ) AS normalized_value,
    row_number() OVER (
      PARTITION BY
        input.workspace_id,
        input.entry_id,
        translate(
          btrim(term_revision.display_name),
          'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
          'abcdefghijklmnopqrstuvwxyz'
        )
      ORDER BY input.input_ordinal, assignment.assignment_id, term.term_id
    ) AS duplicate_precedence
  FROM struinfo.information_entry AS entry
  JOIN struinfo.information_entry_fragment_input AS input
    ON input.workspace_id = entry.workspace_id
    AND input.entry_id = entry.entry_id
    AND input.revision_number = entry.current_revision
    AND input.revision_id = entry.current_revision_id
  JOIN struinfo.curation_target AS target
    ON target.workspace_id = input.workspace_id
    AND target.target_kind = 'fragment'
    AND target.fragment_id = input.fragment_id
  JOIN struinfo.classification_assignment AS assignment
    ON assignment.workspace_id = target.workspace_id
    AND assignment.target_id = target.target_id
  JOIN struinfo.classification_assignment_revision AS assignment_revision
    ON assignment_revision.workspace_id = assignment.workspace_id
    AND assignment_revision.assignment_id = assignment.assignment_id
    AND assignment_revision.revision_number = assignment.current_revision
    AND assignment_revision.assignment_revision_id = assignment.current_assignment_revision_id
  JOIN struinfo.vocabulary_term AS term
    ON term.workspace_id = assignment.workspace_id
    AND term.term_id = assignment.term_id
  JOIN struinfo.vocabulary_term_revision AS term_revision
    ON term_revision.workspace_id = term.workspace_id
    AND term_revision.term_id = term.term_id
    AND term_revision.revision_number = term.current_revision
    AND term_revision.term_revision_id = term.current_term_revision_id
  WHERE assignment_revision.assignment_state = 'assigned'
    AND term_revision.lifecycle = 'active'
),
missing_legacy_keywords AS (
  SELECT
    candidate.*,
    coalesce(max(existing.keyword_ordinal), -1) AS maximum_ordinal
  FROM legacy_keyword_candidates AS candidate
  LEFT JOIN struinfo.information_entry_content_keyword AS existing
    ON existing.workspace_id = candidate.workspace_id
    AND existing.entry_id = candidate.entry_id
  WHERE candidate.duplicate_precedence = 1
    AND NOT EXISTS (
      SELECT 1
      FROM struinfo.information_entry_content_keyword AS duplicate
      WHERE duplicate.workspace_id = candidate.workspace_id
        AND duplicate.entry_id = candidate.entry_id
        AND duplicate.normalized_value = candidate.normalized_value
    )
  GROUP BY
    candidate.workspace_id,
    candidate.entry_id,
    candidate.revision_number,
    candidate.revision_id,
    candidate.input_ordinal,
    candidate.assignment_id,
    candidate.term_id,
    candidate.display_name,
    candidate.normalized_value,
    candidate.duplicate_precedence
)
INSERT INTO struinfo.information_entry_content_keyword (
  workspace_id,
  entry_id,
  revision_number,
  revision_id,
  keyword_ordinal,
  display_value,
  normalized_value,
  origin,
  origin_version
)
SELECT
  workspace_id,
  entry_id,
  revision_number,
  revision_id,
  (
    maximum_ordinal
    + row_number() OVER (
      PARTITION BY workspace_id, entry_id
      ORDER BY input_ordinal, assignment_id, term_id
    )
  )::integer,
  display_name,
  normalized_value,
  'manual',
  'legacy-curation-import.v1'
FROM missing_legacy_keywords;

DELETE FROM struinfo.information_entry_domain_keyword AS domain
USING struinfo.information_entry AS entry
WHERE domain.workspace_id = entry.workspace_id
  AND domain.entry_id = entry.entry_id
  AND (
    domain.revision_number <> entry.current_revision
    OR domain.revision_id <> entry.current_revision_id
  );

DELETE FROM struinfo.information_document_tag_value AS value
USING struinfo.information_document_tag_set AS tag_set
WHERE value.workspace_id = tag_set.workspace_id
  AND value.snapshot_id = tag_set.snapshot_id
  AND (
    value.revision_number <> tag_set.current_revision
    OR value.revision_id <> tag_set.current_revision_id
  );

DELETE FROM struinfo.information_entry_association_projection AS projection
USING struinfo.information_entry AS low_entry,
      struinfo.information_entry AS high_entry
WHERE low_entry.workspace_id = projection.workspace_id
  AND low_entry.entry_id = projection.entry_low_id
  AND high_entry.workspace_id = projection.workspace_id
  AND high_entry.entry_id = projection.entry_high_id
  AND (
    projection.entry_low_revision <> low_entry.current_revision
    OR projection.entry_low_revision_id <> low_entry.current_revision_id
    OR projection.entry_high_revision <> high_entry.current_revision
    OR projection.entry_high_revision_id <> high_entry.current_revision_id
  );

ALTER TABLE struinfo.information_entry_association_projection
  DROP CONSTRAINT entry_assoc_projection_low_revision_fk,
  DROP CONSTRAINT entry_assoc_projection_high_revision_fk,
  ADD CONSTRAINT entry_assoc_projection_low_entry_fk
    FOREIGN KEY (workspace_id, entry_low_id)
    REFERENCES struinfo.information_entry (workspace_id, entry_id),
  ADD CONSTRAINT entry_assoc_projection_high_entry_fk
    FOREIGN KEY (workspace_id, entry_high_id)
    REFERENCES struinfo.information_entry (workspace_id, entry_id);

ALTER TABLE struinfo.information_entry
  DROP CONSTRAINT information_entry_current_revision_fk;

ALTER TABLE struinfo.information_entry_fragment_input
  DROP CONSTRAINT information_entry_fragment_input_pk,
  DROP CONSTRAINT information_entry_fragment_input_revision_fk,
  DROP CONSTRAINT information_entry_fragment_input_fragment_uq,
  DROP COLUMN revision_number,
  DROP COLUMN revision_id,
  ADD CONSTRAINT information_entry_fragment_input_entry_fk
    FOREIGN KEY (workspace_id, entry_id)
    REFERENCES struinfo.information_entry (workspace_id, entry_id),
  ADD CONSTRAINT information_entry_fragment_input_pk
    PRIMARY KEY (workspace_id, entry_id, input_ordinal),
  ADD CONSTRAINT information_entry_fragment_input_fragment_uq
    UNIQUE (workspace_id, entry_id, fragment_id);

DROP INDEX struinfo.information_entry_content_keyword_lookup_idx;

ALTER TABLE struinfo.information_entry_content_keyword
  DROP CONSTRAINT information_entry_content_keyword_pk,
  DROP CONSTRAINT information_entry_content_keyword_revision_fk,
  DROP CONSTRAINT information_entry_content_keyword_value_uq,
  DROP COLUMN revision_number,
  DROP COLUMN revision_id,
  ADD CONSTRAINT information_entry_content_keyword_entry_fk
    FOREIGN KEY (workspace_id, entry_id)
    REFERENCES struinfo.information_entry (workspace_id, entry_id),
  ADD CONSTRAINT information_entry_content_keyword_pk
    PRIMARY KEY (workspace_id, entry_id, keyword_ordinal),
  ADD CONSTRAINT information_entry_content_keyword_value_uq
    UNIQUE (workspace_id, entry_id, normalized_value);

CREATE INDEX information_entry_content_keyword_lookup_idx
  ON struinfo.information_entry_content_keyword (
    workspace_id,
    normalized_value,
    entry_id
  );

DROP INDEX struinfo.information_entry_domain_keyword_lookup_idx;

ALTER TABLE struinfo.information_entry_domain_keyword
  DROP CONSTRAINT information_entry_domain_keyword_pk,
  DROP CONSTRAINT information_entry_domain_keyword_revision_fk,
  DROP CONSTRAINT information_entry_domain_keyword_value_uq,
  DROP COLUMN revision_number,
  DROP COLUMN revision_id,
  ADD CONSTRAINT information_entry_domain_keyword_entry_fk
    FOREIGN KEY (workspace_id, entry_id)
    REFERENCES struinfo.information_entry (workspace_id, entry_id),
  ADD CONSTRAINT information_entry_domain_keyword_pk
    PRIMARY KEY (workspace_id, entry_id, domain_ordinal),
  ADD CONSTRAINT information_entry_domain_keyword_value_uq
    UNIQUE NULLS NOT DISTINCT (
      workspace_id,
      entry_id,
      domain_keyword,
      custom_name
    );

CREATE INDEX information_entry_domain_keyword_lookup_idx
  ON struinfo.information_entry_domain_keyword (
    workspace_id,
    domain_keyword,
    entry_id
  );

ALTER TABLE struinfo.information_document_tag_set
  DROP CONSTRAINT information_document_tag_set_current_revision_fk;

DROP INDEX struinfo.information_document_tag_value_lookup_idx;

ALTER TABLE struinfo.information_document_tag_value
  DROP CONSTRAINT information_document_tag_value_pk,
  DROP CONSTRAINT information_document_tag_value_revision_fk,
  DROP CONSTRAINT information_document_tag_value_normalized_uq,
  DROP COLUMN revision_number,
  DROP COLUMN revision_id,
  ADD CONSTRAINT information_document_tag_value_set_fk
    FOREIGN KEY (workspace_id, snapshot_id)
    REFERENCES struinfo.information_document_tag_set (
      workspace_id,
      snapshot_id
    ),
  ADD CONSTRAINT information_document_tag_value_pk
    PRIMARY KEY (workspace_id, snapshot_id, tag_ordinal),
  ADD CONSTRAINT information_document_tag_value_normalized_uq
    UNIQUE (workspace_id, snapshot_id, normalized_value);

CREATE INDEX information_document_tag_value_lookup_idx
  ON struinfo.information_document_tag_value (
    workspace_id,
    normalized_value,
    snapshot_id
  );

ALTER TABLE struinfo.information_entry_association_override
  DROP CONSTRAINT entry_assoc_override_current_revision_fk;

DROP TABLE struinfo.information_entry_association_override_revision;
DROP TABLE struinfo.information_document_tag_revision;
DROP TABLE struinfo.information_entry_revision;
