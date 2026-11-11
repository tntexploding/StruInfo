ALTER TABLE struinfo.document_organization_work
  ADD COLUMN budget_id text CHECK (budget_id ~ '^[a-zA-Z0-9_-]{1,100}$');
