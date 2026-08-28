CREATE TABLE struinfo.information_entry_fragment_range (
  workspace_id uuid NOT NULL,
  entry_id uuid NOT NULL,
  input_ordinal integer NOT NULL,
  start_code_point integer NOT NULL,
  end_code_point integer NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT information_entry_fragment_range_pk
    PRIMARY KEY (workspace_id, entry_id, input_ordinal),
  CONSTRAINT information_entry_fragment_range_input_fk
    FOREIGN KEY (workspace_id, entry_id, input_ordinal)
    REFERENCES struinfo.information_entry_fragment_input (
      workspace_id,
      entry_id,
      input_ordinal
    )
    DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT information_entry_fragment_range_start_ck
    CHECK (start_code_point >= 0),
  CONSTRAINT information_entry_fragment_range_end_ck
    CHECK (end_code_point > start_code_point)
);
