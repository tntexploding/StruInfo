import {
  intakeRecordValueSchema,
  inboxSummarySchema,
  type InboxSummary,
  type DocumentIntakeRepository,
  type IntakeRecord,
  type IntakeRecordValue,
  type NewsQuery,
  type NewsItem,
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
  public async listNews(query: NewsQuery) {
    const result = await this.pool.query(
      `SELECT s.snapshot_id, r.source_key, r.canonical_uri,
      CASE WHEN d.state_text::jsonb->>'bodySource' IS DISTINCT FROM 'received' THEN d.prepared_snapshot_id END AS body_snapshot_id,
      COALESCE(s.published_at,s.captured_at) AS at,
      d.state_text::jsonb #>> '{reception,title}' AS title,
      d.state_text::jsonb #>> '{captureOrigin,subscriptionId}' AS source_id
      FROM struinfo.processing_document_intake d
      JOIN struinfo.snapshot s USING(workspace_id,snapshot_id)
      JOIN struinfo.resource r USING(workspace_id,resource_id)
      WHERE d.workspace_id=$1 AND ($9::boolean OR NOT r.is_private) AND (NOT $10::boolean OR r.is_private)
        AND d.state_text::jsonb #>> '{reception,strategy,contentMode}'='news'
        AND d.state_text::jsonb->>'receipt'='accepted' AND d.state_text::jsonb->>'decision'='admitted'
        AND ($2='' OR strpos(lower(COALESCE(d.state_text::jsonb #>> '{reception,title}',r.source_key)),lower($2))>0)
        AND ($3::text IS NULL OR d.state_text::jsonb #>> '{captureOrigin,subscriptionId}'=$3)
        AND ($4::date IS NULL OR COALESCE(s.published_at,s.captured_at)>=$4::date::timestamp AT TIME ZONE 'UTC')
        AND ($5::date IS NULL OR COALESCE(s.published_at,s.captured_at)<($5::date+1)::timestamp AT TIME ZONE 'UTC')
        AND ($6::timestamptz IS NULL OR (COALESCE(s.published_at,s.captured_at),s.snapshot_id)<($6::timestamptz,$7::uuid))
      ORDER BY at DESC,s.snapshot_id DESC LIMIT $8`,
      [
        this.workspaceId,
        query.text,
        query.sourceId ?? null,
        query.from ?? null,
        query.to ?? null,
        query.after?.at ?? null,
        query.after?.snapshotId ?? null,
        query.limit + 1,
        query.includePrivate,
        query.onlyPrivate,
      ],
    );
    const items: NewsItem[] = result.rows.slice(0, query.limit).map((r) => ({
      snapshotId: String(r.snapshot_id),
      title: String(r.title ?? r.source_key),
      ...(typeof r.body_snapshot_id === 'string'
        ? {bodySnapshotId: r.body_snapshot_id}
        : {}),
      source: String(r.source_key).replace(/#(?:sha256:)?[a-f0-9]+$/u, ''),
      ...(typeof r.source_id === 'string' ? {sourceId: r.source_id} : {}),
      ...(typeof r.canonical_uri === 'string'
        ? {canonicalUri: r.canonical_uri}
        : {}),
      publishedAt: r.at instanceof Date ? r.at.toISOString() : String(r.at),
    }));
    const last = items.at(-1);
    return {
      items,
      ...(result.rows.length > query.limit && last
        ? {nextCursor: {at: last.publishedAt, snapshotId: last.snapshotId}}
        : {}),
    };
  }
  public async list() {
    const result = await this.pool.query(
      'SELECT * FROM struinfo.processing_document_intake WHERE workspace_id=$1 ORDER BY updated_at DESC,snapshot_id',
      [this.workspaceId],
    );
    return result.rows.map(decode);
  }
  public async publicSourceReceipts(
    sourceIds: string[],
    canonicalUri?: string,
  ) {
    const result = await this.pool.query(
      `SELECT s.snapshot_id, r.canonical_uri, d.state_text::jsonb #>> '{captureOrigin,subscriptionId}' AS subscription_id,
              d.state_text::jsonb #>> '{reception,channel}' AS channel,
              d.state_text::jsonb #>> '{reception,historyImportKey}' AS history_key
       FROM struinfo.processing_document_intake d
       JOIN struinfo.snapshot s USING (workspace_id, snapshot_id)
       JOIN struinfo.resource r USING (workspace_id, resource_id)
       WHERE d.workspace_id=$1 AND NOT r.is_private AND r.canonical_uri IS NOT NULL
         AND d.state_text::jsonb #>> '{captureOrigin,kind}'='subscription'
         AND d.state_text::jsonb #>> '{captureOrigin,subscriptionId}'=ANY($2::text[])
       ` +
        (canonicalUri
          ? ' AND r.canonical_uri=$3 ORDER BY s.captured_at DESC,s.snapshot_id LIMIT 1'
          : ' ORDER BY s.captured_at DESC,s.snapshot_id'),
      canonicalUri
        ? [this.workspaceId, sourceIds, canonicalUri]
        : [this.workspaceId, sourceIds],
    );
    return result.rows.map((row) => ({
      snapshotId: String(row.snapshot_id),
      canonicalUri: String(row.canonical_uri),
      subscriptionId: String(row.subscription_id),
      channel: row.channel,
      ...(typeof row.history_key === 'string'
        ? {historyImportKey: row.history_key}
        : {}),
    }));
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
            `UPDATE struinfo.processing_document_intake SET prepared_snapshot_id=$3,
              state_text=($4::jsonb || CASE WHEN state_text::jsonb ? 'inboxSummary'
                THEN jsonb_build_object('inboxSummary',state_text::jsonb->'inboxSummary')
                ELSE '{}'::jsonb END)::text,
              current_version=current_version+1,updated_at=CURRENT_TIMESTAMP
              WHERE workspace_id=$1 AND snapshot_id=$2 AND current_version=$5`,
            [...args, expectedVersion],
          );
    return result.rowCount === 1;
  }
  /** Cached prose is independent of admission/receipt CAS and never changes a decision. */
  public async saveInboxSummary(snapshotId: string, summary: InboxSummary) {
    const value = inboxSummarySchema.parse(summary);
    await this.pool.query(
      `INSERT INTO struinfo.processing_document_intake
        (workspace_id,snapshot_id,state_text) VALUES ($1,$2,$3)
       ON CONFLICT (workspace_id,snapshot_id) DO UPDATE SET
        state_text=(processing_document_intake.state_text::jsonb ||
          jsonb_build_object('inboxSummary',COALESCE(
            processing_document_intake.state_text::jsonb->'inboxSummary',
            EXCLUDED.state_text::jsonb->'inboxSummary')))::text`,
      [
        this.workspaceId,
        snapshotId,
        JSON.stringify({
          decision: 'pending',
          origin: 'system',
          reason: '',
          preparation: 'received',
          inboxSummary: value,
        }),
      ],
    );
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
