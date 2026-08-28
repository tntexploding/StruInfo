CREATE TABLE struinfo.processing_entry_automation_work_item (
  workspace_id uuid NOT NULL,
  run_id uuid NOT NULL,
  claim_ordinal integer NOT NULL,
  state varchar(20) NOT NULL DEFAULT 'pending',
  current_version bigint NOT NULL DEFAULT 1,
  created_at timestamp with time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamp with time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
  resolved_at timestamp with time zone,
  CONSTRAINT processing_entry_automation_work_item_pk
    PRIMARY KEY (workspace_id, run_id, claim_ordinal),
  CONSTRAINT processing_entry_automation_work_item_claim_fk
    FOREIGN KEY (workspace_id, run_id, claim_ordinal)
    REFERENCES struinfo.processing_entry_automation_claim (
      workspace_id,
      run_id,
      claim_ordinal
    ),
  CONSTRAINT processing_entry_automation_work_item_state_ck
    CHECK (state IN ('pending', 'completed', 'dismissed')),
  CONSTRAINT processing_entry_automation_work_item_version_ck
    CHECK (current_version >= 1),
  CONSTRAINT processing_entry_automation_work_item_resolved_ck
    CHECK (
      (state = 'pending' AND resolved_at IS NULL)
      OR (state IN ('completed', 'dismissed') AND resolved_at IS NOT NULL)
    )
);

INSERT INTO struinfo.processing_entry_automation_work_item (
  workspace_id,
  run_id,
  claim_ordinal
)
SELECT
  claim.workspace_id,
  claim.run_id,
  claim.claim_ordinal
FROM struinfo.processing_entry_automation_claim AS claim
JOIN struinfo.processing_run AS run
  ON run.workspace_id = claim.workspace_id
  AND run.run_id = claim.run_id
WHERE claim.status = 'completed'
  AND run.status = 'succeeded';

CREATE INDEX processing_entry_automation_work_item_queue_idx
  ON struinfo.processing_entry_automation_work_item (
    workspace_id,
    state,
    updated_at DESC,
    run_id,
    claim_ordinal
  );
