CREATE TABLE struinfo.information_entry_search_projection (
  workspace_id uuid NOT NULL,
  entry_id uuid NOT NULL,
  entry_revision integer NOT NULL,
  entry_revision_id uuid NOT NULL,
  projection_sha256 char(64) NOT NULL,
  tokenizer_version text NOT NULL,
  embedding_provider text,
  embedding_model text,
  embedding_dimensions integer,
  embedding double precision[],
  rebuilt_at timestamp with time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT information_entry_search_projection_pk
    PRIMARY KEY (workspace_id, entry_id),
  CONSTRAINT information_entry_search_projection_entry_fk
    FOREIGN KEY (workspace_id, entry_id)
    REFERENCES struinfo.information_entry (workspace_id, entry_id),
  CONSTRAINT information_entry_search_projection_revision_ck
    CHECK (entry_revision >= 1),
  CONSTRAINT information_entry_search_projection_sha_ck
    CHECK (projection_sha256 ~ '^[0-9a-f]{64}$'),
  CONSTRAINT information_entry_search_projection_tokenizer_ck
    CHECK (tokenizer_version = 'struinfo.entry-terms.unicode-v1'),
  CONSTRAINT information_entry_search_projection_embedding_ck
    CHECK (
      (
        embedding_provider IS NULL
        AND embedding_model IS NULL
        AND embedding_dimensions IS NULL
        AND embedding IS NULL
      )
      OR (
        char_length(embedding_provider) BETWEEN 1 AND 120
        AND char_length(embedding_model) BETWEEN 1 AND 120
        AND embedding_dimensions BETWEEN 1 AND 16384
        AND cardinality(embedding) = embedding_dimensions
      )
    )
);

CREATE TABLE struinfo.information_entry_term_posting (
  workspace_id uuid NOT NULL,
  entry_id uuid NOT NULL,
  field text NOT NULL,
  term text NOT NULL,
  occurrences integer NOT NULL,
  CONSTRAINT information_entry_term_posting_pk
    PRIMARY KEY (workspace_id, entry_id, field, term),
  CONSTRAINT information_entry_term_posting_projection_fk
    FOREIGN KEY (workspace_id, entry_id)
    REFERENCES struinfo.information_entry_search_projection (workspace_id, entry_id),
  CONSTRAINT information_entry_term_posting_field_ck
    CHECK (field IN ('title', 'body', 'tags')),
  CONSTRAINT information_entry_term_posting_term_ck
    CHECK (char_length(term) BETWEEN 1 AND 80),
  CONSTRAINT information_entry_term_posting_occurrences_ck
    CHECK (occurrences BETWEEN 1 AND 2147483647)
);

CREATE INDEX information_entry_term_posting_lookup_idx
  ON struinfo.information_entry_term_posting (workspace_id, term, field, entry_id);
