ALTER TABLE struinfo.information_entry_association_override
  ADD COLUMN graph_reviewed_entry_low_revision integer,
  ADD COLUMN graph_reviewed_entry_high_revision integer,
  ADD CONSTRAINT entry_assoc_override_review_revisions_ck
    CHECK (
      (graph_reviewed_entry_low_revision IS NULL
       AND graph_reviewed_entry_high_revision IS NULL)
      OR
      (graph_origin IS NOT NULL
       AND graph_reviewed_entry_low_revision IS NOT NULL
       AND graph_reviewed_entry_high_revision IS NOT NULL
       AND graph_reviewed_entry_low_revision > 0
       AND graph_reviewed_entry_high_revision > 0)
    );

-- Existing source checks have no known endpoint versions. Do not backfill them.
