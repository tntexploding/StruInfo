/** Metadata-only selection: privacy and current revisions precede counts and paging. */
const REVIEW_CANDIDATES = `
WITH visible_entries AS (
  SELECT entry_id, current_revision, current_revision_id FROM struinfo.information_entry
  WHERE workspace_id = $1 AND is_current_structure
    AND ($2::text <> 'public' OR NOT is_private)
    AND ($2::text <> 'private_only' OR is_private)
), current_projections AS (
  SELECT p.entry_low_id, p.entry_high_id
  FROM struinfo.information_entry_association_projection p
  JOIN visible_entries l ON l.entry_id = p.entry_low_id
    AND l.current_revision = p.entry_low_revision AND l.current_revision_id = p.entry_low_revision_id
  JOIN visible_entries h ON h.entry_id = p.entry_high_id
    AND h.current_revision = p.entry_high_revision AND h.current_revision_id = p.entry_high_revision_id
  WHERE p.workspace_id = $1
), pairs AS (
  SELECT entry_low_id, entry_high_id FROM current_projections
  UNION
  SELECT o.entry_low_id, o.entry_high_id
  FROM struinfo.information_entry_association_override o
  JOIN visible_entries l ON l.entry_id = o.entry_low_id
  JOIN visible_entries h ON h.entry_id = o.entry_high_id
  WHERE o.workspace_id = $1 AND o.graph_origin IS NOT NULL
), candidates AS (
  SELECT pairs.*, CASE
    WHEN o.graph_verification_status = 'source_checked' THEN
      CASE WHEN o.graph_reviewed_entry_low_revision = l.current_revision
        AND o.graph_reviewed_entry_high_revision = h.current_revision
        THEN 'source_checked' ELSE 'needs_review' END
    ELSE COALESCE(o.graph_verification_status, 'unreviewed')
    END AS review_status
  FROM pairs
  JOIN visible_entries l ON l.entry_id = pairs.entry_low_id
  JOIN visible_entries h ON h.entry_id = pairs.entry_high_id
  LEFT JOIN struinfo.information_entry_association_override o
    ON o.workspace_id = $1 AND o.entry_low_id = pairs.entry_low_id AND o.entry_high_id = pairs.entry_high_id
  WHERE NOT COALESCE(o.is_blocked, false)
), filtered AS (
  SELECT * FROM candidates WHERE $3::text = 'all'
    OR ($3::text = 'pending' AND review_status <> 'source_checked')
    OR review_status = $3::text
)
`;
export const COUNT_INFORMATION_ENTRY_SOURCE_REVIEWS_SQL =
  REVIEW_CANDIDATES + 'SELECT count(*)::integer AS total_count FROM filtered';
export const READ_INFORMATION_ENTRY_SOURCE_REVIEW_PAGE_SQL =
  REVIEW_CANDIDATES +
  `
SELECT entry_low_id::text, entry_high_id::text FROM filtered
WHERE $4::uuid IS NULL OR (entry_low_id, entry_high_id) > ($4::uuid, $5::uuid)
ORDER BY entry_low_id, entry_high_id LIMIT $6
`;
