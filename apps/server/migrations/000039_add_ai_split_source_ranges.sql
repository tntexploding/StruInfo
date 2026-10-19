-- Preserve existing whole-Fragment proposals; new proposals may cite disjoint
-- code-point ranges of the immutable document Fragment.
ALTER TABLE struinfo.processing_split_proposal_entry_fragment
  ADD COLUMN start_code_point integer,
  ADD COLUMN end_code_point integer,
  DROP CONSTRAINT processing_split_proposal_entry_fragment_identity_uq,
  ADD CONSTRAINT processing_split_proposal_range_ck CHECK (
    (start_code_point IS NULL AND end_code_point IS NULL) OR
    (start_code_point IS NOT NULL AND end_code_point IS NOT NULL AND
     start_code_point >= 0 AND end_code_point > start_code_point)
  );

CREATE UNIQUE INDEX processing_split_proposal_legacy_fragment_uq
  ON struinfo.processing_split_proposal_entry_fragment
    (workspace_id, proposal_id, fragment_id)
  WHERE start_code_point IS NULL;
CREATE UNIQUE INDEX processing_split_proposal_range_start_uq
  ON struinfo.processing_split_proposal_entry_fragment
    (workspace_id, proposal_id, fragment_id, start_code_point)
  WHERE start_code_point IS NOT NULL;
