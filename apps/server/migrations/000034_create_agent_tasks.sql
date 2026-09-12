CREATE TABLE struinfo.processing_agent_task (
  workspace_id uuid NOT NULL REFERENCES struinfo.workspace (workspace_id),
  task_id uuid NOT NULL,
  actor_kind varchar(20) NOT NULL CHECK (actor_kind IN ('owner','external_agent','automation')),
  actor_id varchar(128) NOT NULL CHECK (btrim(actor_id) <> ''),
  policy_version varchar(80) NOT NULL CHECK (policy_version = 'struinfo.agent-task.v1'),
  request_key varchar(100) NOT NULL,
  request_text text NOT NULL CHECK (octet_length(request_text) <= 32768),
  model varchar(160) NOT NULL,
  state_text text NOT NULL CHECK (octet_length(state_text) <= 65536),
  cancel_requested boolean NOT NULL DEFAULT false,
  pause_requested boolean NOT NULL DEFAULT false,
  current_version integer NOT NULL DEFAULT 1 CHECK (current_version >= 1),
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (workspace_id, task_id),
  UNIQUE (workspace_id, actor_kind, actor_id, request_key)
);
