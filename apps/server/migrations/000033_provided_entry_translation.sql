-- Supplied reading text is distinct from an OpenAI API generation.
ALTER TABLE struinfo.information_entry_translation
  DROP CONSTRAINT information_entry_translation_provider_key_check;
ALTER TABLE struinfo.information_entry_translation
  ADD CONSTRAINT information_entry_translation_provider_key_check
  CHECK (provider_key IN ('openai-responses-v1', 'provided-translation-v1'));
ALTER TABLE struinfo.information_entry_translation
  ADD CONSTRAINT information_entry_translation_provided_metadata_check
  CHECK (provider_key <> 'provided-translation-v1' OR (model = '' AND prompt_version = ''));
