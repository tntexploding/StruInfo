\set ON_ERROR_STOP on

BEGIN;

REVOKE ALL ON SCHEMA struinfo_meta FROM struinfo_tm2_runtime;
REVOKE ALL ON ALL TABLES IN SCHEMA struinfo_meta FROM struinfo_tm2_runtime;
REVOKE CREATE ON SCHEMA public FROM PUBLIC, struinfo_tm2_runtime;
REVOKE CREATE ON SCHEMA struinfo FROM struinfo_tm2_runtime;

GRANT USAGE ON SCHEMA struinfo TO struinfo_tm2_runtime;
GRANT SELECT, INSERT ON ALL TABLES IN SCHEMA struinfo TO struinfo_tm2_runtime;

GRANT UPDATE ON TABLE
  struinfo.information_entry,
  struinfo.information_document_tag_set,
  struinfo.information_entry_association_override,
  struinfo.information_document_working_copy,
  struinfo.processing_run,
  struinfo.processing_proposal,
  struinfo.processing_entry_automation_claim,
  struinfo.processing_entry_automation_work_item,
  struinfo.processing_entry_automation_action
TO struinfo_tm2_runtime;

GRANT DELETE ON TABLE
  struinfo.information_entry_association_projection,
  struinfo.information_document_tag_value,
  struinfo.information_entry_content_keyword,
  struinfo.information_entry_domain_keyword,
  struinfo.information_entry_fragment_input,
  struinfo.information_entry_fragment_range,
  struinfo.information_document_working_copy,
  struinfo.information_entry_search_projection,
  struinfo.information_entry_term_posting
TO struinfo_tm2_runtime;

GRANT USAGE ON SCHEMA pgboss TO struinfo_tm2_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA pgboss TO struinfo_tm2_runtime;
GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA pgboss TO struinfo_tm2_runtime;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA pgboss TO struinfo_tm2_runtime;

SELECT format(
  'GRANT CONNECT ON DATABASE %I TO struinfo_tm2_runtime',
  current_database()
) \gexec
SELECT format(
  'REVOKE CREATE, TEMPORARY ON DATABASE %I FROM PUBLIC, struinfo_tm2_runtime',
  current_database()
) \gexec

COMMIT;
