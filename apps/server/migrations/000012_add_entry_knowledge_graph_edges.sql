ALTER TABLE struinfo.information_entry_association_override
  ADD COLUMN graph_origin text,
  ADD COLUMN graph_label text,
  ADD COLUMN graph_direction text,
  ADD CONSTRAINT entry_assoc_override_graph_origin_ck
    CHECK (graph_origin IS NULL OR graph_origin IN ('association', 'user')),
  ADD CONSTRAINT entry_assoc_override_graph_label_ck
    CHECK (
      graph_label IS NULL
      OR (
        btrim(graph_label) <> ''
        AND char_length(graph_label) <= 80
      )
    ),
  ADD CONSTRAINT entry_assoc_override_graph_direction_ck
    CHECK (
      graph_direction IS NULL
      OR graph_direction IN ('symmetric', 'low_to_high', 'high_to_low')
    ),
  ADD CONSTRAINT entry_assoc_override_graph_shape_ck
    CHECK (
      (graph_origin IS NULL AND graph_label IS NULL AND graph_direction IS NULL)
      OR (
        graph_origin IS NOT NULL
        AND graph_label IS NOT NULL
        AND graph_direction IS NOT NULL
      )
    );
