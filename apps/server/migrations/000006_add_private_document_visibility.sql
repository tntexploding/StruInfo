ALTER TABLE struinfo.resource
  ADD COLUMN is_private boolean NOT NULL DEFAULT false;

ALTER TABLE struinfo.knowledge_revision
  ADD COLUMN is_private boolean NOT NULL DEFAULT false;

ALTER TABLE struinfo.knowledge_relation_revision
  ADD COLUMN is_private boolean NOT NULL DEFAULT false;
