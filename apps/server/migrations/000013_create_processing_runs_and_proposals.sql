CREATE TABLE struinfo.processing_run (
  workspace_id uuid NOT NULL,
  run_id uuid NOT NULL,
  idempotency_key varchar(200) NOT NULL,
  origin varchar(20) NOT NULL,
  provider_key varchar(120),
  status varchar(20) NOT NULL,
  target_snapshot_id uuid,
  privacy_scope varchar(20) NOT NULL,
  current_stage varchar(20) NOT NULL,
  current_step varchar(240),
  completed_units integer NOT NULL DEFAULT 0,
  total_units integer,
  attempt integer NOT NULL DEFAULT 1,
  current_version integer NOT NULL DEFAULT 1,
  error_code varchar(120),
  created_at timestamp with time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
  started_at timestamp with time zone,
  finished_at timestamp with time zone,
  updated_at timestamp with time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT processing_run_pk PRIMARY KEY (workspace_id, run_id),
  CONSTRAINT processing_run_idempotency_uq
    UNIQUE (workspace_id, idempotency_key),
  CONSTRAINT processing_run_workspace_fk
    FOREIGN KEY (workspace_id)
    REFERENCES struinfo.workspace (workspace_id),
  CONSTRAINT processing_run_snapshot_fk
    FOREIGN KEY (workspace_id, target_snapshot_id)
    REFERENCES struinfo.snapshot (workspace_id, snapshot_id),
  CONSTRAINT processing_run_origin_ck
    CHECK (origin IN ('deterministic', 'ai')),
  CONSTRAINT processing_run_provider_ck
    CHECK (
      (origin = 'deterministic' AND provider_key IS NULL)
      OR (origin = 'ai' AND provider_key IS NOT NULL AND btrim(provider_key) <> '')
    ),
  CONSTRAINT processing_run_status_ck
    CHECK (status IN ('queued', 'running', 'succeeded', 'failed', 'cancelled')),
  CONSTRAINT processing_run_privacy_scope_ck
    CHECK (privacy_scope IN ('public_only', 'include_private', 'private_only')),
  CONSTRAINT processing_run_stage_ck
    CHECK (current_stage IN ('import', 'split', 'tags', 'associations', 'query')),
  CONSTRAINT processing_run_step_ck
    CHECK (current_step IS NULL OR btrim(current_step) <> ''),
  CONSTRAINT processing_run_progress_ck
    CHECK (
      completed_units >= 0
      AND (total_units IS NULL OR total_units >= 1)
      AND (total_units IS NULL OR completed_units <= total_units)
    ),
  CONSTRAINT processing_run_version_ck CHECK (current_version >= 1),
  CONSTRAINT processing_run_attempt_ck CHECK (attempt >= 1),
  CONSTRAINT processing_run_error_ck
    CHECK (
      (status = 'failed' AND error_code IS NOT NULL AND btrim(error_code) <> '')
      OR (status <> 'failed' AND error_code IS NULL)
    ),
  CONSTRAINT processing_run_time_ck
    CHECK (
      (status = 'queued' AND started_at IS NULL AND finished_at IS NULL)
      OR (status = 'running' AND started_at IS NOT NULL AND finished_at IS NULL)
      OR (status IN ('succeeded', 'failed', 'cancelled') AND finished_at IS NOT NULL)
    )
);

CREATE TABLE struinfo.processing_proposal (
  workspace_id uuid NOT NULL,
  proposal_id uuid NOT NULL,
  run_id uuid NOT NULL,
  proposal_ordinal integer NOT NULL,
  stage varchar(20) NOT NULL,
  proposal_kind varchar(20) NOT NULL,
  target_snapshot_id uuid,
  target_entry_id uuid,
  related_entry_id uuid,
  status varchar(20) NOT NULL DEFAULT 'pending_review',
  summary varchar(240) NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
  decided_at timestamp with time zone,
  CONSTRAINT processing_proposal_pk PRIMARY KEY (workspace_id, proposal_id),
  CONSTRAINT processing_proposal_ordinal_uq
    UNIQUE (workspace_id, run_id, proposal_ordinal),
  CONSTRAINT processing_proposal_run_fk
    FOREIGN KEY (workspace_id, run_id)
    REFERENCES struinfo.processing_run (workspace_id, run_id),
  CONSTRAINT processing_proposal_snapshot_fk
    FOREIGN KEY (workspace_id, target_snapshot_id)
    REFERENCES struinfo.snapshot (workspace_id, snapshot_id),
  CONSTRAINT processing_proposal_entry_fk
    FOREIGN KEY (workspace_id, target_entry_id)
    REFERENCES struinfo.information_entry (workspace_id, entry_id),
  CONSTRAINT processing_proposal_related_entry_fk
    FOREIGN KEY (workspace_id, related_entry_id)
    REFERENCES struinfo.information_entry (workspace_id, entry_id),
  CONSTRAINT processing_proposal_ordinal_ck CHECK (proposal_ordinal >= 0),
  CONSTRAINT processing_proposal_stage_ck
    CHECK (stage IN ('split', 'tags', 'associations')),
  CONSTRAINT processing_proposal_kind_ck
    CHECK (proposal_kind IN ('split', 'tags', 'association')),
  CONSTRAINT processing_proposal_status_ck
    CHECK (status IN ('pending_review', 'accepted', 'rejected', 'superseded')),
  CONSTRAINT processing_proposal_summary_ck CHECK (btrim(summary) <> ''),
  CONSTRAINT processing_proposal_decision_ck
    CHECK (
      (status = 'pending_review' AND decided_at IS NULL)
      OR (status <> 'pending_review' AND decided_at IS NOT NULL)
    ),
  CONSTRAINT processing_proposal_target_ck
    CHECK (
      (proposal_kind = 'split' AND stage = 'split'
        AND target_snapshot_id IS NOT NULL
        AND target_entry_id IS NULL AND related_entry_id IS NULL)
      OR (proposal_kind = 'tags' AND stage = 'tags'
        AND target_snapshot_id IS NULL
        AND target_entry_id IS NOT NULL AND related_entry_id IS NULL)
      OR (proposal_kind = 'association' AND stage = 'associations'
        AND target_snapshot_id IS NULL
        AND target_entry_id IS NOT NULL AND related_entry_id IS NOT NULL
        AND target_entry_id <> related_entry_id)
    )
);

CREATE TABLE struinfo.processing_proposal_fragment_input (
  workspace_id uuid NOT NULL,
  proposal_id uuid NOT NULL,
  input_ordinal integer NOT NULL,
  fragment_id uuid NOT NULL,
  CONSTRAINT processing_proposal_fragment_input_pk
    PRIMARY KEY (workspace_id, proposal_id, input_ordinal),
  CONSTRAINT processing_proposal_fragment_input_identity_uq
    UNIQUE (workspace_id, proposal_id, fragment_id),
  CONSTRAINT processing_proposal_fragment_input_proposal_fk
    FOREIGN KEY (workspace_id, proposal_id)
    REFERENCES struinfo.processing_proposal (workspace_id, proposal_id),
  CONSTRAINT processing_proposal_fragment_input_fragment_fk
    FOREIGN KEY (workspace_id, fragment_id)
    REFERENCES struinfo.fragment (workspace_id, fragment_id),
  CONSTRAINT processing_proposal_fragment_input_ordinal_ck
    CHECK (input_ordinal >= 0)
);

CREATE INDEX processing_run_recent_idx
  ON struinfo.processing_run (workspace_id, created_at DESC, run_id DESC);

CREATE INDEX processing_proposal_run_idx
  ON struinfo.processing_proposal (workspace_id, run_id, proposal_ordinal);
