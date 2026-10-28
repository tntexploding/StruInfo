-- Personal search limits, schedules, report runs and in-app publication records.
CREATE TABLE struinfo.research_pipeline_record (
 workspace_id uuid NOT NULL REFERENCES struinfo.workspace(workspace_id),
 record_id uuid NOT NULL,
 kind text NOT NULL CHECK(kind IN ('settings','schedule','run','notice','charge')),
 value_text text NOT NULL CHECK(octet_length(value_text)<=1048576 AND value_text::jsonb->>'kind'=kind),
 current_version integer NOT NULL DEFAULT 1 CHECK(current_version>0),
 updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
 PRIMARY KEY(workspace_id,record_id)
);
CREATE INDEX research_pipeline_kind ON struinfo.research_pipeline_record(workspace_id,kind,updated_at);
