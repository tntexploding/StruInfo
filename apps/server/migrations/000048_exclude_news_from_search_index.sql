-- News retains its original and publication history outside the article index.
CREATE OR REPLACE VIEW struinfo.published_search_entry WITH (security_invoker = true) AS
SELECT p.workspace_id, (e->>'entryId')::uuid AS entry_id,
  (e->>'revision')::integer AS current_revision,
  (e->>'revisionId')::uuid AS current_revision_id,
  true AS is_current_structure, false AS is_private
FROM struinfo.document_publication_pointer p
JOIN struinfo.document_publication_version v USING (workspace_id, document_id, publication_id)
JOIN struinfo.processing_document_intake i ON i.workspace_id=p.workspace_id AND i.snapshot_id=p.document_id
JOIN struinfo.snapshot s ON s.workspace_id=v.workspace_id AND s.snapshot_id=v.snapshot_id
JOIN struinfo.resource r ON r.workspace_id=s.workspace_id AND r.resource_id=s.resource_id
JOIN struinfo.snapshot original ON original.workspace_id=p.workspace_id AND original.snapshot_id=p.document_id
JOIN struinfo.resource original_source ON original_source.workspace_id=original.workspace_id AND original_source.resource_id=original.resource_id
CROSS JOIN LATERAL jsonb_array_elements(v.content_text::jsonb->'entries') e
WHERE i.state_text::jsonb->>'decision'='admitted'
  AND COALESCE(i.state_text::jsonb->>'receipt','accepted')='accepted'
  AND i.state_text::jsonb#>>'{reception,strategy,contentMode}' IS DISTINCT FROM 'news'
  AND NOT r.is_private AND NOT original_source.is_private
  AND NOT (e#>>'{value,isPrivate}')::boolean
  AND NOT EXISTS (SELECT 1 FROM struinfo.information_entry raw
    WHERE raw.workspace_id=v.workspace_id AND raw.snapshot_id=v.snapshot_id AND raw.is_private);
