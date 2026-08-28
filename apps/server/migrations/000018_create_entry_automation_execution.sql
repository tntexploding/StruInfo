CREATE TABLE struinfo.processing_entry_automation_run (
  workspace_id uuid NOT NULL,
  run_id uuid NOT NULL,
  request_sha256 varchar(64) NOT NULL,
  plan_sha256 varchar(64) NOT NULL,
  policy_revision bigint NOT NULL,
  profile_revision bigint NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT processing_entry_automation_run_pk
    PRIMARY KEY (workspace_id, run_id),
  CONSTRAINT processing_entry_automation_run_run_fk
    FOREIGN KEY (workspace_id, run_id)
    REFERENCES struinfo.processing_run (workspace_id, run_id),
  CONSTRAINT processing_entry_automation_request_sha_ck
    CHECK (request_sha256 ~ '^[0-9a-f]{64}$'),
  CONSTRAINT processing_entry_automation_plan_sha_ck
    CHECK (plan_sha256 ~ '^[0-9a-f]{64}$'),
  CONSTRAINT processing_entry_automation_policy_revision_ck
    CHECK (policy_revision >= 0),
  CONSTRAINT processing_entry_automation_profile_revision_ck
    CHECK (profile_revision >= 0)
);

CREATE TABLE struinfo.processing_entry_automation_claim (
  workspace_id uuid NOT NULL,
  run_id uuid NOT NULL,
  claim_ordinal integer NOT NULL,
  entry_id uuid NOT NULL,
  entry_revision integer NOT NULL,
  entry_revision_id uuid NOT NULL,
  route varchar(30) NOT NULL,
  reason varchar(40) NOT NULL,
  status varchar(20) NOT NULL DEFAULT 'claimed',
  error_code varchar(120),
  created_at timestamp with time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
  finished_at timestamp with time zone,
  CONSTRAINT processing_entry_automation_claim_pk
    PRIMARY KEY (workspace_id, run_id, claim_ordinal),
  CONSTRAINT processing_entry_automation_claim_entry_uq
    UNIQUE (workspace_id, run_id, entry_id),
  CONSTRAINT processing_entry_automation_claim_run_fk
    FOREIGN KEY (workspace_id, run_id)
    REFERENCES struinfo.processing_entry_automation_run (workspace_id, run_id),
  CONSTRAINT processing_entry_automation_claim_entry_fk
    FOREIGN KEY (workspace_id, entry_id)
    REFERENCES struinfo.information_entry (workspace_id, entry_id),
  CONSTRAINT processing_entry_automation_claim_ordinal_ck
    CHECK (claim_ordinal >= 0),
  CONSTRAINT processing_entry_automation_claim_revision_ck
    CHECK (entry_revision >= 1),
  CONSTRAINT processing_entry_automation_claim_route_ck
    CHECK (route IN ('advance_candidate', 'manual_review', 'defer_candidate')),
  CONSTRAINT processing_entry_automation_claim_reason_ck
    CHECK (reason IN (
      'advance_threshold_met',
      'defer_threshold_met',
      'threshold_not_met',
      'insufficient_profile_evidence',
      'mixed_signals',
      'manual_takeover',
      'run_budget_exhausted',
      'advance_budget_exhausted',
      'defer_budget_exhausted'
    )),
  CONSTRAINT processing_entry_automation_claim_status_ck
    CHECK (status IN ('claimed', 'completed', 'compensated')),
  CONSTRAINT processing_entry_automation_claim_finish_ck
    CHECK (
      (status = 'claimed' AND finished_at IS NULL AND error_code IS NULL)
      OR (status = 'completed' AND finished_at IS NOT NULL AND error_code IS NULL)
      OR (status = 'compensated' AND finished_at IS NOT NULL
        AND error_code IS NOT NULL AND btrim(error_code) <> '')
    )
);

CREATE INDEX processing_entry_automation_claim_entry_idx
  ON struinfo.processing_entry_automation_claim (
    workspace_id,
    entry_id,
    created_at DESC,
    run_id
  );
