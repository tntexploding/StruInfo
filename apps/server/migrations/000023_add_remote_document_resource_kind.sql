ALTER TABLE struinfo.resource
  DROP CONSTRAINT resource_kind_ck;

ALTER TABLE struinfo.resource
  ADD CONSTRAINT resource_kind_ck
    CHECK (
      resource_kind IN (
        'git_file',
        'manual_text',
        'uploaded_file',
        'remote_document'
      )
    );
