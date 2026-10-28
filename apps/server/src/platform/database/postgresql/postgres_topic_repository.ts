import {
  topicRecordValueSchema,
  type TopicRecord,
  type TopicRepository,
} from '../../../modules/entries/content_topics.js';
import type {PostgresPoolBoundary} from './postgres_pool.js';
import {acquireWorkspaceWriteLock} from './workspace_write_lock.js';

export class PostgresTopicRepository implements TopicRepository {
  private tail: Promise<unknown> = Promise.resolve();
  constructor(
    private readonly pool: PostgresPoolBoundary,
    private readonly workspaceId: string,
  ) {}
  async read(id: string) {
    const r = await this.pool.query(
      'SELECT * FROM struinfo.content_organization_record WHERE workspace_id=$1 AND record_id=$2',
      [this.workspaceId, id],
    );
    return r.rows[0] ? decode(r.rows[0]) : undefined;
  }
  async list(kind: 'topic' | 'job') {
    const r = await this.pool.query(
      'SELECT * FROM struinfo.content_organization_record WHERE workspace_id=$1 AND kind=$2 ORDER BY updated_at DESC,record_id',
      [this.workspaceId, kind],
    );
    return r.rows.map(decode);
  }
  async save(writes: Parameters<TopicRepository['save']>[0]) {
    const c = await this.pool.connect();
    try {
      await c.query('BEGIN');
      await acquireWorkspaceWriteLock(c, this.workspaceId);
      for (const w of writes) {
        const v = topicRecordValueSchema.parse(w.value);
        const args = [this.workspaceId, w.id, v.kind, JSON.stringify(v)];
        const r =
          w.expectedVersion === 0
            ? await c.query(
                'INSERT INTO struinfo.content_organization_record(workspace_id,record_id,kind,value_text) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING',
                args,
              )
            : await c.query(
                'UPDATE struinfo.content_organization_record SET value_text=$4,current_version=current_version+1,updated_at=CURRENT_TIMESTAMP WHERE workspace_id=$1 AND record_id=$2 AND kind=$3 AND current_version=$5',
                [...args, w.expectedVersion],
              );
        if (r.rowCount !== 1) {
          await c.query('ROLLBACK');
          return false;
        }
      }
      await c.query('COMMIT');
      return true;
    } catch (e) {
      await c.query('ROLLBACK');
      throw e;
    } finally {
      c.release();
    }
  }
  withLock<T>(action: () => Promise<T>): Promise<T> {
    // Local waiters must not occupy every pool connection while the holder writes.
    const work = this.tail.then(() => this.locked(action));
    this.tail = work.catch(() => undefined);
    return work;
  }
  private async locked<T>(action: () => Promise<T>): Promise<T> {
    const c = await this.pool.connect(),
      key = 'topics:' + this.workspaceId;
    let locked = false;
    try {
      await c.query('SELECT pg_advisory_lock(hashtextextended($1,0))', [key]);
      locked = true;
      return await action();
    } finally {
      try {
        if (locked)
          await c.query('SELECT pg_advisory_unlock(hashtextextended($1,0))', [
            key,
          ]);
      } finally {
        c.release();
      }
    }
  }
}
function decode(row: Readonly<Record<string, unknown>>): TopicRecord {
  return {
    id: String(row.record_id),
    version: Number(row.current_version),
    updatedAt:
      row.updated_at instanceof Date
        ? row.updated_at.toISOString()
        : String(row.updated_at),
    value: topicRecordValueSchema.parse(JSON.parse(String(row.value_text))),
  };
}
