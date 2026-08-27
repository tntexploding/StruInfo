ALTER TABLE struinfo.information_entry_association_override
  ADD COLUMN graph_semantic_kind text,
  ADD COLUMN graph_verification_status text,
  ADD COLUMN graph_note text;

UPDATE struinfo.information_entry_association_override
SET
  graph_semantic_kind = CASE
    WHEN graph_label = 'similarity' THEN 'similarity'
    ELSE 'custom'
  END,
  graph_verification_status = 'unreviewed',
  graph_note = ''
WHERE graph_origin IS NOT NULL;

ALTER TABLE struinfo.information_entry_association_override
  ADD CONSTRAINT entry_assoc_override_graph_semantic_kind_ck
    CHECK (
      graph_semantic_kind IS NULL
      OR graph_semantic_kind IN (
        'similarity',
        'related',
        'supports',
        'contradicts',
        'part_of',
        'causes',
        'example_of',
        'custom'
      )
    ),
  ADD CONSTRAINT entry_assoc_override_graph_verification_ck
    CHECK (
      graph_verification_status IS NULL
      OR graph_verification_status IN (
        'unreviewed',
        'source_checked',
        'needs_review'
      )
    ),
  ADD CONSTRAINT entry_assoc_override_graph_note_ck
    CHECK (graph_note IS NULL OR char_length(graph_note) <= 500),
  DROP CONSTRAINT entry_assoc_override_graph_shape_ck,
  ADD CONSTRAINT entry_assoc_override_graph_shape_ck
    CHECK (
      (
        graph_origin IS NULL
        AND graph_label IS NULL
        AND graph_direction IS NULL
        AND graph_semantic_kind IS NULL
        AND graph_verification_status IS NULL
        AND graph_note IS NULL
      )
      OR (
        graph_origin IS NOT NULL
        AND graph_label IS NOT NULL
        AND graph_direction IS NOT NULL
        AND graph_semantic_kind IS NOT NULL
        AND graph_verification_status IS NOT NULL
        AND graph_note IS NOT NULL
      )
    );
