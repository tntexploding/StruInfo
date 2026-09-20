CREATE TABLE struinfo.processing_ingestion_policy (
  workspace_id uuid PRIMARY KEY REFERENCES struinfo.workspace(workspace_id),
  current_version integer NOT NULL CHECK (current_version >= 1),
  authorized_by_kind varchar(20) NOT NULL CHECK (authorized_by_kind IN ('owner','external_agent')),
  authorized_by_id varchar(128) NOT NULL CHECK (btrim(authorized_by_id) <> ''),
  settings_text text NOT NULL CHECK (octet_length(settings_text) <= 16384),
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE struinfo.processing_ingestion_item (
  workspace_id uuid NOT NULL,
  snapshot_id uuid NOT NULL,
  source_kind varchar(16) NOT NULL CHECK (source_kind IN ('upload','subscription')),
  subscription_id uuid,
  policy_revision integer NOT NULL CHECK (policy_revision >= 1),
  authorized_by_kind varchar(20) NOT NULL CHECK (authorized_by_kind IN ('owner','external_agent')),
  authorized_by_id varchar(128) NOT NULL CHECK (btrim(authorized_by_id) <> ''),
  settings_text text NOT NULL CHECK (octet_length(settings_text) <= 16384),
  status varchar(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','running','paused','attention','completed','taken_over')),
  task_id uuid,
  error_code varchar(120),
  current_version integer NOT NULL DEFAULT 1 CHECK (current_version >= 1),
  created_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  admitted_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (workspace_id, snapshot_id),
  FOREIGN KEY (workspace_id, snapshot_id) REFERENCES struinfo.snapshot(workspace_id, snapshot_id),
  FOREIGN KEY (workspace_id, task_id) REFERENCES struinfo.processing_agent_task(workspace_id, task_id),
  CHECK ((source_kind = 'upload' AND subscription_id IS NULL) OR (source_kind = 'subscription' AND subscription_id IS NOT NULL))
);
