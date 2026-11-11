-- New proposals store only the structured label set. Historical rows remain readable.
ALTER TABLE struinfo.processing_tag_proposal ALTER COLUMN type_keyword DROP NOT NULL;
