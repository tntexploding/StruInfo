CREATE TABLE struinfo.processing_entry_automation_action (
  workspace_id uuid NOT NULL,
  run_id uuid NOT NULL,
  claim_ordinal integer NOT NULL,
  deterministic_tags_enabled boolean NOT NULL,
  rebuild_associations_enabled boolean NOT NULL,
  state varchar(24) NOT NULL DEFAULT 'pending',
  origin_version text NOT NULL,
  result_entry_revision integer,
  result_entry_revision_id uuid,
  added_tag_count integer NOT NULL DEFAULT 0,
  association_projection_count integer,
  current_version bigint NOT NULL DEFAULT 1,
  created_at timestamp with time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamp with time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at timestamp with time zone,
  CONSTRAINT processing_entry_automation_action_pk
    PRIMARY KEY (workspace_id, run_id, claim_ordinal),
  CONSTRAINT processing_entry_automation_action_claim_fk
    FOREIGN KEY (workspace_id, run_id, claim_ordinal)
    REFERENCES struinfo.processing_entry_automation_claim (
      workspace_id,
      run_id,
      claim_ordinal
    ),
  CONSTRAINT processing_entry_automation_action_enabled_ck
    CHECK (deterministic_tags_enabled OR rebuild_associations_enabled),
  CONSTRAINT processing_entry_automation_action_state_ck
    CHECK (
      state IN (
        'pending',
        'tags_applied',
        'applied',
        'undo_pending',
        'undone',
        'cancelled'
      )
    ),
  CONSTRAINT processing_entry_automation_action_origin_ck
    CHECK (btrim(origin_version) <> ''),
  CONSTRAINT processing_entry_automation_action_result_ck
    CHECK (
      (state IN ('pending', 'cancelled')
        AND result_entry_revision IS NULL
        AND result_entry_revision_id IS NULL
        AND added_tag_count = 0)
      OR
      (state IN ('tags_applied', 'applied', 'undo_pending', 'undone')
        AND result_entry_revision >= 1
        AND result_entry_revision_id IS NOT NULL
        AND added_tag_count >= 0)
    ),
  CONSTRAINT processing_entry_automation_action_projection_ck
    CHECK (
      association_projection_count IS NULL
      OR association_projection_count >= 0
    ),
  CONSTRAINT processing_entry_automation_action_version_ck
    CHECK (current_version >= 1),
  CONSTRAINT processing_entry_automation_action_completed_ck
    CHECK (
      (state IN ('applied', 'undone', 'cancelled') AND completed_at IS NOT NULL)
      OR
      (state IN ('pending', 'tags_applied', 'undo_pending')
        AND completed_at IS NULL)
    )
);

CREATE INDEX processing_entry_automation_action_state_idx
  ON struinfo.processing_entry_automation_action (
    workspace_id,
    state,
    updated_at DESC,
    run_id,
    claim_ordinal
  );
