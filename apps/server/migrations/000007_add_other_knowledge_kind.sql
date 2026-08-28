ALTER TABLE struinfo.knowledge_revision
  DROP CONSTRAINT knowledge_revision_kind_ck;

ALTER TABLE struinfo.knowledge_revision
  ADD CONSTRAINT knowledge_revision_kind_ck
  CHECK (
    knowledge_kind IN (
      'entity',
      'concept',
      'assertion',
      'event',
      'method',
      'framework',
      'resource',
      'work',
      'other'
    )
  );
