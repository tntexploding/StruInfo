-- New publications finish without scheduling a topic job. Preserve historical work.
ALTER TABLE struinfo.document_organization_work
  DROP CONSTRAINT document_organization_work_status_check;
ALTER TABLE struinfo.document_organization_work
  ADD CONSTRAINT document_organization_work_status_check
  CHECK (status IN ('not_requested','pending','running','succeeded','failed','paused','superseded'));
ALTER TABLE struinfo.document_organization_work
  ALTER COLUMN status SET DEFAULT 'not_requested';

UPDATE struinfo.document_organization_work
  SET status='paused', error_code='topic_on_demand_required',
      current_version=current_version+1, updated_at=CURRENT_TIMESTAMP
  WHERE status IN ('pending','running');

UPDATE struinfo.content_organization_record
  SET value_text=(value_text::jsonb || '{"status":"paused","errorCode":"topic_on_demand_required"}'::jsonb)::text,
      current_version=current_version+1, updated_at=CURRENT_TIMESTAMP
  WHERE kind='job' AND value_text::jsonb ? 'publicationId'
    AND value_text::jsonb->>'status' IN ('queued','running');
