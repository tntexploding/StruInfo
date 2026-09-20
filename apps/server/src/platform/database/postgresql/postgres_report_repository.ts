import {
  reportStateSchema,
  type ReportRecord,
  type ReportRepository,
  type ReportState,
} from '../../../application/report_contract.js';
import {validateReportState} from '../../../application/report_content.js';
import {OperationError} from '../../../application/operation_error.js';
import type {PostgresPoolBoundary} from './postgres_pool.js';

export class PostgresReportRepository implements ReportRepository {
  public constructor(
    private readonly pool: PostgresPoolBoundary,
    private readonly workspaceId: string,
  ) {}
  public async read(reportId: string) {
    const result = await this.pool.query(
      'SELECT * FROM struinfo.processing_report WHERE workspace_id=$1 AND report_id=$2',
      [this.workspaceId, reportId],
    );
    return result.rows[0] ? decode(result.rows[0]) : undefined;
  }
  public async list(prioritizeActive = false) {
    const result = await this.pool.query(
      'SELECT * FROM struinfo.processing_report WHERE workspace_id=$1 ORDER BY ' +
        (prioritizeActive
          ? "CASE state_text::jsonb->>'status' WHEN 'running' THEN 0 WHEN 'queued' THEN 1 WHEN 'failed' THEN 2 ELSE 3 END,"
          : '') +
        'updated_at DESC,report_id LIMIT 100',
      [this.workspaceId],
    );
    return result.rows.map(decode);
  }
  public async listPriceDeferred() {
    const result = await this.pool.query(
      "SELECT * FROM struinfo.processing_report WHERE workspace_id=$1 AND state_text::jsonb->>'status'='queued' AND state_text::jsonb->>'errorCode' IN ('ai_price_window_closed','ai_operations_paused') ORDER BY updated_at,report_id LIMIT 8",
      [this.workspaceId],
    );
    return result.rows.map(decode);
  }
  public async save(
    reportId: string,
    expectedVersion: number,
    input: ReportState,
  ) {
    const state = reportStateSchema.parse(input);
    validateReportState(state);
    const args = [this.workspaceId, reportId, JSON.stringify(state)];
    const result =
      expectedVersion === 0
        ? await this.pool.query(
            'INSERT INTO struinfo.processing_report (workspace_id,report_id,state_text) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING',
            args,
          )
        : await this.pool.query(
            'UPDATE struinfo.processing_report SET state_text=$3,current_version=current_version+1,updated_at=CURRENT_TIMESTAMP WHERE workspace_id=$1 AND report_id=$2 AND current_version=$4',
            [...args, expectedVersion],
          );
    return result.rowCount === 1;
  }
  public async withLock<T>(id: string, action: () => Promise<T>): Promise<T> {
    const client = await this.pool.connect(),
      key = 'report:' + this.workspaceId + ':' + id;
    let locked = false;
    try {
      locked =
        (
          await client.query(
            'SELECT pg_try_advisory_lock(hashtextextended($1,0)) AS locked',
            [key],
          )
        ).rows[0]?.locked === true;
      if (!locked) throw new OperationError('conflict', 'report_busy');
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
function decode(row: Readonly<Record<string, unknown>>): ReportRecord {
  const state = reportStateSchema.parse(JSON.parse(String(row.state_text)));
  validateReportState(state);
  const timestamp = (value: unknown) =>
    value instanceof Date ? value.toISOString() : String(value);
  return {
    reportId: String(row.report_id),
    version: Number(row.current_version),
    createdAt: timestamp(row.created_at),
    updatedAt: timestamp(row.updated_at),
    state,
  };
}
