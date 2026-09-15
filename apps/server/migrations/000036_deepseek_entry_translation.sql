-- Preserve existing translations while admitting explicitly configured DeepSeek output.
ALTER TABLE struinfo.information_entry_translation
  DROP CONSTRAINT information_entry_translation_provider_key_check;
ALTER TABLE struinfo.information_entry_translation
  ADD CONSTRAINT information_entry_translation_provider_key_check
  CHECK (provider_key IN ('openai-responses-v1', 'deepseek-responses-v1', 'provided-translation-v1'));
