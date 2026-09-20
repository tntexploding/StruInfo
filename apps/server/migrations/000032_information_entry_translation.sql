-- Reading aid only: original evidence and current Entry content remain unchanged.
CREATE TABLE struinfo.information_entry_translation (
  workspace_id uuid NOT NULL,
  entry_id uuid NOT NULL,
  target_language varchar(16) NOT NULL CHECK (target_language = 'zh-CN'),
  source_revision integer NOT NULL CHECK (source_revision > 0),
  source_revision_id uuid NOT NULL,
  title text NOT NULL CHECK (char_length(title) <= 2000),
  body text NOT NULL CHECK (char_length(body) BETWEEN 1 AND 48000),
  provider_key varchar(64) NOT NULL CHECK (provider_key = 'openai-responses-v1'),
  model varchar(200) NOT NULL,
  prompt_version varchar(200) NOT NULL,
  translated_at timestamptz NOT NULL,
  PRIMARY KEY (workspace_id, entry_id, target_language),
  FOREIGN KEY (workspace_id, entry_id)
    REFERENCES struinfo.information_entry (workspace_id, entry_id)
);
