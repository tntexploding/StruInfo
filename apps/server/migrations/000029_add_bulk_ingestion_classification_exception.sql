ALTER TABLE struinfo.processing_bulk_ingestion_exception
  DROP CONSTRAINT processing_bulk_ingestion_exception_code_ck;

ALTER TABLE struinfo.processing_bulk_ingestion_exception
  ADD CONSTRAINT processing_bulk_ingestion_exception_code_ck
  CHECK (exception_code IN (
    'automatic_tagging_disabled',
    'no_deterministic_tags',
    'keyword_capacity_reached',
    'classification_incomplete'
  ));
