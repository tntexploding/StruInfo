ALTER TABLE struinfo.information_entry
  ADD COLUMN is_current_structure boolean NOT NULL DEFAULT true;

CREATE UNIQUE INDEX information_entry_current_snapshot_order_uq
  ON struinfo.information_entry (
    workspace_id,
    snapshot_id,
    document_order
  )
  WHERE is_current_structure;

CREATE INDEX information_entry_current_snapshot_idx
  ON struinfo.information_entry (
    workspace_id,
    snapshot_id,
    is_current_structure,
    document_order,
    entry_id
  );
