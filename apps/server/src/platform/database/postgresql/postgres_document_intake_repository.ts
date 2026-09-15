import {
  intakeRecordValueSchema,
  type DocumentIntakeRepository,
  type IntakeRecord,
  type IntakeRecordValue,
} from '../../../application/document_intake_contract.js';
import type {PostgresPoolBoundary} from './postgres_pool.js';
import {OperationError} from '../../../application/operation_error.js';

export class PostgresDocumentIntakeRepository implements DocumentIntakeRepository {
  public constructor(
    private readonly pool: PostgresPoolBoundary,
    private readonly workspaceId: string,
  ) {}
  public async read(snapshotId: string) {
    const result = await this.pool.query(
      'SELECT * FROM struinfo.processing_document_intake WHERE workspace_id=$1 AND snapshot_id=$2',
      [this.workspaceId, snapshotId],
    );
    return result.rows[0] ? decode(result.rows[0]) : undefined;
  }
  public async list() {
    const result = await this.pool.query(
      'SELECT * FROM struinfo.processing_document_intake WHERE workspace_id=$1 ORDER BY updated_at DESC,snapshot_id',
      [this.workspaceId],
    );
    return result.rows.map(decode);
  }
  public async save(
    snapshotId: string,
    expectedVersion: number,
    value: IntakeRecordValue,
  ) {
    const state = intakeRecordValueSchema.parse(value);
    const args = [
      this.workspaceId,
      snapshotId,
      state.preparedSnapshotId ?? null,
      JSON.stringify(state),
    ];
    const result =
      expectedVersion === 0
        ? await this.pool.query(
            'INSERT INTO struinfo.processing_document_intake (workspace_id,snapshot_id,prepared_snapshot_id,state_text) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING',
            args,
          )
        : await this.pool.query(
            'UPDATE struinfo.processing_document_intake SET prepared_snapshot_id=$3,state_text=$4,current_version=current_version+1,updated_at=CURRENT_TIMESTAMP WHERE workspace_id=$1 AND snapshot_id=$2 AND current_version=$5',
            [...args, expectedVersion],
          );
    return result.rowCount === 1;
  }
  public async withLock<T>(
    snapshotId: string,
    action: () => Promise<T>,
  ): Promise<T> {
    const client = await this.pool.connect();
    const key = 'document-intake:' + this.workspaceId + ':' + snapshotId;
    let locked = false;
    try {
      const result = await client.query(
        'SELECT pg_try_advisory_lock(hashtextextended($1,0)) AS locked',
        [key],
      );
      locked = result.rows[0]?.locked === true;
      if (!locked) throw new OperationError('conflict', 'intake_busy');
      return await action();
    } finally {
      try {
        if (locked)
          await client.query(
            'SELECT pg_advisory_unlock(hashtextextended($1,0))',
            [key],
          );
      } finally {
        client.release();
      }
    }
  }
}
function decode(row: Readonly<Record<string, unknown>>): IntakeRecord {
  const value = intakeRecordValueSchema.parse(
    JSON.parse(String(row.state_text)),
  );
  if ((value.preparedSnapshotId ?? null) !== (row.prepared_snapshot_id ?? null))
    throw new OperationError('rejected', 'invalid_intake_record');
  return {
    snapshotId: String(row.snapshot_id),
    version: Number(row.current_version),
    value,
    updatedAt:
      row.updated_at instanceof Date
        ? row.updated_at.toISOString()
        : String(row.updated_at),
  };
}
