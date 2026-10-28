import {
  receptionSchema,
  type Reception,
} from '../../../modules/subscriptions/source_receiving.js';
import {
  EMPTY_INGESTION_POLICY,
  ingestionScopeMatches,
  ingestionSettingsSchema,
  decodeStoredIngestionSettings,
  type IngestionRepository,
  type IngestionOrigin,
  type IngestionPolicy,
  type IngestionItem,
  type IngestionSettings,
  type IngestionStatus,
  type IngestionStatusQuery,
} from '../../../application/ingestion_contract.js';
import type {ValidatedCaptureEvidence} from '../../../modules/evidence/index.js';
import {OperationError} from '../../../application/operation_error.js';
import type {
  PostgresPoolBoundary,
  PostgresClientBoundary,
} from './postgres_pool.js';
import {deriveWorkspaceWriteLockKey} from './workspace_write_lock.js';
import {PostgresAgentTaskRepository} from './postgres_agent_task_repository.js';

export async function recordIngestionCapture(
  client: PostgresClientBoundary,
  capture: ValidatedCaptureEvidence,
  origin: IngestionOrigin,
  options: {reviewOnly?: boolean; reception?: Reception} = {},
) {
  if (capture.resource.isPrivate) return;
  // Persist the inbox choice in the same transaction as the new source evidence,
  // including when model automation is disabled. Duplicate captures never reset it.
  await client.query(
    'INSERT INTO struinfo.processing_document_intake (workspace_id,snapshot_id,state_text) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING',
    [
      capture.workspaceId,
      capture.snapshot.snapshotId,
      JSON.stringify({
        reception: options.reception ?? {
          channel: origin.kind === 'upload' ? 'manual' : 'live',
        },
        captureOrigin: origin,
        receipt: 'pending',
        decision: 'pending',
        origin: 'system',
        reason: '',
        preparation: 'received',
      }),
    ],
  );
  if (options.reviewOnly) return;
  const result = await client.query(
    'SELECT current_version,settings_text,authorized_by_kind,authorized_by_id FROM struinfo.processing_ingestion_policy WHERE workspace_id=$1',
    [capture.workspaceId],
  );
  if (!result.rows[0]) return;
  const policy = decodePolicy(result.rows[0]);
  if (
    !policy.settings.enabled ||
    !ingestionScopeMatches(policy.settings, origin)
  )
    return;
  await client.query(
    `INSERT INTO struinfo.processing_ingestion_item
    (workspace_id,snapshot_id,source_kind,subscription_id,policy_revision,settings_text,authorized_by_kind,authorized_by_id)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT DO NOTHING`,
    [
      capture.workspaceId,
      capture.snapshot.snapshotId,
      origin.kind,
      origin.kind === 'subscription' ? origin.subscriptionId : null,
      policy.revision,
      JSON.stringify(policy.settings),
      policy.authorizedBy?.kind,
      policy.authorizedBy?.id,
    ],
  );
}

export class PostgresIngestionRepository implements IngestionRepository {
  public constructor(
    private readonly pool: PostgresPoolBoundary,
    private readonly workspaceId: string,
  ) {}

  public async pendingSourceCounts(): Promise<
    Readonly<Record<string, number>>
  > {
    const result = await this.pool.query(
      `SELECT d.state_text::jsonb->'captureOrigin'->>'subscriptionId' AS source_id, count(*)::int AS total
      FROM struinfo.processing_document_intake d
      JOIN struinfo.snapshot s USING(workspace_id,snapshot_id)
      JOIN struinfo.resource r USING(workspace_id,resource_id)
      WHERE d.workspace_id=$1 AND NOT r.is_private AND d.state_text::jsonb->>'receipt'='pending'
      GROUP BY source_id`,
      [this.workspaceId],
    );
    return Object.fromEntries(
      result.rows
        .filter((r) => typeof r.source_id === 'string')
        .map((r) => [String(r.source_id), Number(r.total)]),
    );
  }

  public async dispatchCandidates(
    limit: number,
  ): Promise<readonly IngestionItem[]> {
    const result = await this.pool.query(
      `WITH eligible AS (
      SELECT i.*, d.state_text::jsonb->'reception' AS reception,
        r.source_key AS source_label,
        EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP-i.created_at))/3600
          + CASE d.state_text::jsonb->'reception'->'strategy'->>'urgency' WHEN 'high' THEN 24 WHEN 'low' THEN -12 ELSE 0 END
          + (COALESCE((d.state_text::jsonb->'reception'->'strategy'->>'preference')::int,50)-50)/5.0
          - CASE WHEN d.state_text::jsonb->'reception'->>'channel'='history' THEN 12 ELSE 0 END AS priority
      FROM struinfo.processing_ingestion_item i
      JOIN struinfo.snapshot s USING(workspace_id,snapshot_id)
      JOIN struinfo.resource r USING(workspace_id,resource_id)
      LEFT JOIN struinfo.processing_document_intake d ON d.workspace_id=i.workspace_id AND d.snapshot_id=i.snapshot_id
      WHERE i.workspace_id=$1 AND i.status IN ('pending','running') AND NOT r.is_private
        AND (i.task_id IS NOT NULL OR (COALESCE(d.state_text::jsonb->>'receipt','') <> 'rejected'
          AND COALESCE(d.state_text::jsonb->>'deferProcessing','') <> 'true'))
    ), ranked AS (
      SELECT *, row_number() OVER (PARTITION BY COALESCE(subscription_id::text,'manual'),
        COALESCE(reception->>'channel','live') ORDER BY (task_id IS NOT NULL) DESC, priority DESC, snapshot_id) AS source_turn
      FROM eligible
    ) SELECT * FROM ranked ORDER BY source_turn, priority DESC, snapshot_id LIMIT $2`,
      [this.workspaceId, limit],
    );
    return result.rows.map(decodeItem);
  }
  public async summary() {
    const result = await this.pool.query(
      "SELECT i.status, count(*) AS count, count(*) FILTER (WHERE i.admitted_at >= date_trunc('day', CURRENT_TIMESTAMP AT TIME ZONE 'UTC') AT TIME ZONE 'UTC') AS today, COALESCE(sum((t.state_text::jsonb->>'calls')::integer),0) AS attempts FROM struinfo.processing_ingestion_item i LEFT JOIN struinfo.processing_agent_task t USING(workspace_id,task_id) WHERE i.workspace_id=$1 GROUP BY i.status",
      [this.workspaceId],
    );
    return {
      counts: Object.fromEntries(
        result.rows.map((row) => [String(row.status), Number(row.count)]),
      ),
      admittedToday: result.rows.reduce((n, row) => n + Number(row.today), 0),
      modelAttempts: result.rows.reduce(
        (n, row) => n + Number(row.attempts),
        0,
      ),
    };
  }
  public async policy() {
    const result = await this.pool.query(
      'SELECT current_version,settings_text,authorized_by_kind,authorized_by_id FROM struinfo.processing_ingestion_policy WHERE workspace_id=$1',
      [this.workspaceId],
    );
    return result.rows[0]
      ? decodePolicy(result.rows[0])
      : EMPTY_INGESTION_POLICY;
  }
  public async savePolicy(
    expectedRevision: number,
    settings: IngestionSettings,
    authorizedBy: NonNullable<IngestionPolicy['authorizedBy']>,
  ) {
    return this.transaction(async (client) => {
      await client.query(
        'INSERT INTO struinfo.workspace(workspace_id) VALUES ($1) ON CONFLICT DO NOTHING',
        [this.workspaceId],
      );
      const result =
        expectedRevision === 0
          ? await client.query(
              'INSERT INTO struinfo.processing_ingestion_policy(workspace_id,current_version,settings_text,authorized_by_kind,authorized_by_id) VALUES ($1,1,$2,$3,$4) ON CONFLICT DO NOTHING',
              [
                this.workspaceId,
                JSON.stringify(ingestionSettingsSchema.parse(settings)),
                authorizedBy.kind,
                authorizedBy.id,
              ],
            )
          : await client.query(
              'UPDATE struinfo.processing_ingestion_policy SET settings_text=$2,authorized_by_kind=$4,authorized_by_id=$5,current_version=current_version+1,updated_at=CURRENT_TIMESTAMP WHERE workspace_id=$1 AND current_version=$3',
              [
                this.workspaceId,
                JSON.stringify(ingestionSettingsSchema.parse(settings)),
                expectedRevision,
                authorizedBy.kind,
                authorizedBy.id,
              ],
            );
      return result.rowCount === 1;
    });
  }
  public async read(snapshotId: string) {
    const result = await this.pool.query(
      'SELECT * FROM struinfo.processing_ingestion_item WHERE workspace_id=$1 AND snapshot_id=$2',
      [this.workspaceId, snapshotId],
    );
    return result.rows[0] ? decodeItem(result.rows[0]) : undefined;
  }
  public async list(
    activeOnly: boolean,
    limit: number,
    after?: IngestionStatusQuery['after'],
    status?: IngestionStatus,
  ) {
    const result = await this.pool.query(
      `SELECT i.*, (SELECT d.state_text::jsonb->'reception' FROM struinfo.processing_document_intake d WHERE d.workspace_id=i.workspace_id AND d.snapshot_id=i.snapshot_id) AS reception, (SELECT r.source_key FROM struinfo.snapshot s JOIN struinfo.resource r USING(workspace_id,resource_id) WHERE s.workspace_id=i.workspace_id AND s.snapshot_id=i.snapshot_id) AS source_label FROM struinfo.processing_ingestion_item i WHERE workspace_id=$1
      AND ($2::boolean = false OR status IN ('pending','running'))
      AND ($2::boolean = false OR i.task_id IS NOT NULL OR NOT EXISTS (
        SELECT 1 FROM struinfo.processing_document_intake d WHERE d.workspace_id=i.workspace_id AND d.snapshot_id=i.snapshot_id
        AND (d.state_text::jsonb->>'receipt' = 'rejected'
          OR d.state_text::jsonb->>'deferProcessing' = 'true')))
      AND ($4::timestamptz IS NULL OR (created_at,snapshot_id) < ($4::timestamptz,$5::uuid))
      AND ($6::text IS NULL OR status=$6)
      ORDER BY created_at ${activeOnly ? 'ASC' : 'DESC'},snapshot_id ${activeOnly ? 'ASC' : 'DESC'} LIMIT $3`,
      [
        this.workspaceId,
        activeOnly,
        limit,
        after?.createdAt ?? null,
        after?.snapshotId ?? null,
        status ?? null,
      ],
    );
    return result.rows.map(decodeItem);
  }
  public async update(
    snapshotId: string,
    expectedVersion: number,
    status: IngestionStatus,
    taskId?: string,
    errorCode?: string,
  ) {
    const result = await this.pool.query(
      `UPDATE struinfo.processing_ingestion_item
      SET status=$4,task_id=COALESCE(task_id,$5),error_code=$6,current_version=current_version+1,updated_at=CURRENT_TIMESTAMP
      WHERE workspace_id=$1 AND snapshot_id=$2 AND current_version=$3`,
      [
        this.workspaceId,
        snapshotId,
        expectedVersion,
        status,
        taskId ?? null,
        errorCode ?? null,
      ],
    );
    return result.rowCount === 1;
  }
  public async reserve(snapshotId: string, maximum: number) {
    return this.transaction(async (client) => {
      const rows = await client.query(
        'SELECT status,admitted_at FROM struinfo.processing_ingestion_item WHERE workspace_id=$1 AND snapshot_id=$2',
        [this.workspaceId, snapshotId],
      );
      const item = rows.rows[0];
      if (!item || !['pending', 'running'].includes(String(item.status)))
        return false;
      if (item.admitted_at) return true;
      const policy = await client.query(
        'SELECT current_version,settings_text,authorized_by_kind,authorized_by_id FROM struinfo.processing_ingestion_policy WHERE workspace_id=$1',
        [this.workspaceId],
      );
      if (!policy.rows[0]) return false;
      const current = decodePolicy(policy.rows[0]);
      if (!current.settings.enabled || current.settings.paused) return false;
      const result = await client.query(
        `UPDATE struinfo.processing_ingestion_item
        SET admitted_at=CURRENT_TIMESTAMP,current_version=current_version+1,updated_at=CURRENT_TIMESTAMP
        WHERE workspace_id=$1 AND snapshot_id=$2 AND status IN ('pending','running') AND admitted_at IS NULL AND
        (SELECT count(*) FROM struinfo.processing_ingestion_item WHERE workspace_id=$1
         AND admitted_at >= date_trunc('day', CURRENT_TIMESTAMP AT TIME ZONE 'UTC') AT TIME ZONE 'UTC') < $3`,
        [
          this.workspaceId,
          snapshotId,
          Math.min(maximum, current.settings.maxDocumentsPerDay),
        ],
      );
      return result.rowCount === 1;
    });
  }
  public async withPollLock(action: () => Promise<void>) {
    try {
      await new PostgresAgentTaskRepository(this.pool).withLock(
        this.workspaceId,
        'ingestion-poll',
        action,
      );
    } catch (error) {
      if (!(error instanceof OperationError && error.code === 'task_busy'))
        throw error;
    }
  }
  private async transaction<T>(
    action: (client: PostgresClientBoundary) => Promise<T>,
  ): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock($1::bigint)', [
        deriveWorkspaceWriteLockKey(this.workspaceId),
      ]);
      const value = await action(client);
      await client.query('COMMIT');
      return value;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
}
function decodePolicy(row: Readonly<Record<string, unknown>>): IngestionPolicy {
  if (
    !['owner', 'external_agent'].includes(String(row.authorized_by_kind)) ||
    typeof row.authorized_by_id !== 'string'
  )
    throw new OperationError('rejected', 'invalid_ingestion_policy_record');
  return {
    authorizedBy: {
      kind: row.authorized_by_kind as 'owner' | 'external_agent',
      id: row.authorized_by_id,
    },
    revision: Number(row.current_version),
    settings: decodeStoredIngestionSettings(
      JSON.parse(String(row.settings_text)) as unknown,
    ),
  };
}
function decodeItem(row: Readonly<Record<string, unknown>>): IngestionItem {
  if (
    ![
      'pending',
      'running',
      'paused',
      'attention',
      'completed',
      'taken_over',
    ].includes(String(row.status)) ||
    !['upload', 'subscription'].includes(String(row.source_kind))
  )
    throw new OperationError('rejected', 'invalid_ingestion_item');
  const date = (v: unknown) =>
    v instanceof Date ? v.toISOString() : String(v);
  return {
    snapshotId: String(row.snapshot_id),
    ...(row.reception ? {reception: receptionSchema.parse(row.reception)} : {}),
    ...(row.priority !== undefined ? {priority: Number(row.priority)} : {}),
    ...(typeof row.source_label === 'string'
      ? {sourceLabel: row.source_label}
      : {}),
    origin:
      row.source_kind === 'upload'
        ? {kind: 'upload'}
        : {kind: 'subscription', subscriptionId: String(row.subscription_id)},
    policy: decodePolicy({...row, current_version: row.policy_revision}),
    status: row.status as IngestionStatus,
    version: Number(row.current_version),
    createdAt: date(row.created_at),
    ...(typeof row.task_id === 'string' ? {taskId: row.task_id} : {}),
    ...(typeof row.error_code === 'string' ? {errorCode: row.error_code} : {}),
    ...(row.admitted_at ? {admittedAt: date(row.admitted_at)} : {}),
  };
}
