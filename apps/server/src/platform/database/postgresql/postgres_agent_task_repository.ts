import {
  agentTaskRequestSchema,
  agentTaskStateSchema,
  type AgentTask,
  type AgentTaskRepository,
  type AgentTaskState,
} from '../../../application/agent_task_contract.js';
import {OperationError} from '../../../application/operation_error.js';
import type {PostgresPoolBoundary} from './postgres_pool.js';

export class PostgresAgentTaskRepository implements AgentTaskRepository {
  public constructor(private readonly pool: PostgresPoolBoundary) {}
  public async create(task: AgentTask) {
    const result = await this.pool.query(
      'INSERT INTO struinfo.processing_agent_task (workspace_id,task_id,actor_kind,actor_id,policy_version,request_key,request_text,model,state_text) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT DO NOTHING',
      [
        task.workspaceId,
        task.taskId,
        task.actorKind,
        task.actorId,
        task.policyVersion,
        task.requestKey,
        JSON.stringify(task.request),
        task.model,
        JSON.stringify(task.state),
      ],
    );
    return result.rowCount === 1;
  }
  public async read(workspaceId: string, taskId: string) {
    const result = await this.pool.query(
      'SELECT * FROM struinfo.processing_agent_task WHERE workspace_id=$1 AND task_id=$2',
      [workspaceId, taskId],
    );
    return result.rows[0] === undefined ? undefined : decode(result.rows[0]);
  }
  public async list(
    workspaceId: string,
    snapshotIds?: readonly string[],
    prioritizeActive = false,
  ) {
    const result = await this.pool.query(
      'SELECT * FROM struinfo.processing_agent_task WHERE workspace_id=$1' +
        (snapshotIds === undefined
          ? ''
          : " AND request_text::jsonb->>'snapshotId'=ANY($2::text[])") +
        (prioritizeActive
          ? " ORDER BY CASE state_text::jsonb->>'status' WHEN 'running' THEN 0 WHEN 'queued' THEN 1 WHEN 'paused' THEN 2 WHEN 'failed' THEN 3 ELSE 4 END,updated_at DESC,task_id DESC LIMIT 100"
          : ' ORDER BY created_at DESC,task_id DESC LIMIT 100'),
      snapshotIds === undefined ? [workspaceId] : [workspaceId, snapshotIds],
    );
    return result.rows.map(decode);
  }
  public async listPublicationTasks(workspaceId: string) {
    const result = await this.pool.query(
      "SELECT DISTINCT ON (request_text::jsonb->>'snapshotId',COALESCE(request_text::jsonb->>'reprocess','')) * FROM struinfo.processing_agent_task WHERE workspace_id=$1 AND request_text::jsonb->>'kind'='document' ORDER BY request_text::jsonb->>'snapshotId',COALESCE(request_text::jsonb->>'reprocess',''),created_at DESC,task_id DESC",
      [workspaceId],
    );
    return result.rows.map(decode);
  }
  public async listPriceDeferred(workspaceId: string) {
    const result = await this.pool.query(
      "SELECT * FROM struinfo.processing_agent_task WHERE workspace_id=$1 AND NOT pause_requested AND NOT cancel_requested AND state_text::jsonb->>'status'='paused' AND state_text::jsonb->>'errorCode' IN ('ai_price_window_closed','ai_operations_paused') ORDER BY updated_at,task_id LIMIT 32",
      [workspaceId],
    );
    return result.rows.map(decode);
  }
  public async listForSnapshots(
    workspaceId: string,
    snapshotIds: readonly string[],
  ) {
    const result = await this.pool.query(
      "SELECT * FROM struinfo.processing_agent_task WHERE workspace_id=$1 AND request_text::jsonb->>'kind'='document' AND request_text::jsonb->>'snapshotId'=ANY($2::text[])",
      [workspaceId, snapshotIds],
    );
    return result.rows.map(decode);
  }
  /** Only the holder of withLock may update progress. Control flags are separate. */
  public async saveState(
    workspaceId: string,
    taskId: string,
    state: AgentTaskState,
  ) {
    await this.pool.query(
      'UPDATE struinfo.processing_agent_task SET state_text=$3,current_version=current_version+1,updated_at=CURRENT_TIMESTAMP WHERE workspace_id=$1 AND task_id=$2',
      [workspaceId, taskId, JSON.stringify(agentTaskStateSchema.parse(state))],
    );
  }
  public async control(
    workspaceId: string,
    taskId: string,
    version: number,
    action: 'pause' | 'resume' | 'cancel',
  ) {
    const result = await this.pool.query(
      'UPDATE struinfo.processing_agent_task SET pause_requested=$4,cancel_requested=$5,current_version=current_version+1,updated_at=CURRENT_TIMESTAMP WHERE workspace_id=$1 AND task_id=$2 AND current_version=$3',
      [workspaceId, taskId, version, action !== 'resume', action === 'cancel'],
    );
    return result.rowCount === 1;
  }
  public async withLock<T>(
    workspaceId: string,
    taskId: string,
    action: () => Promise<T>,
  ): Promise<T> {
    const client = await this.pool.connect();
    const key = 'agent-task:' + workspaceId + ':' + taskId;
    let locked = false;
    try {
      const result = await client.query(
        'SELECT pg_try_advisory_lock(hashtextextended($1, 0)) AS locked',
        [key],
      );
      locked = result.rows[0]?.locked === true;
      if (!locked) throw new OperationError('conflict', 'task_busy');
      return await action();
    } finally {
      try {
        if (locked)
          await client.query(
            'SELECT pg_advisory_unlock(hashtextextended($1, 0))',
            [key],
          );
      } finally {
        client.release();
      }
    }
  }
}
function decode(row: Readonly<Record<string, unknown>>): AgentTask {
  const date = (value: unknown) =>
    value instanceof Date ? value.toISOString() : String(value);
  if (
    !['owner', 'external_agent', 'automation'].includes(
      String(row.actor_kind),
    ) ||
    row.policy_version !== 'struinfo.agent-task.v1'
  )
    throw new OperationError('rejected', 'invalid_task_record');
  return {
    workspaceId: String(row.workspace_id),
    taskId: String(row.task_id),
    actorKind: row.actor_kind as AgentTask['actorKind'],
    actorId: String(row.actor_id),
    policyVersion: 'struinfo.agent-task.v1',
    requestKey: String(row.request_key),
    request: agentTaskRequestSchema.parse(
      JSON.parse(String(row.request_text)) as unknown,
    ),
    model: String(row.model),
    state: agentTaskStateSchema.parse(
      JSON.parse(String(row.state_text)) as unknown,
    ),
    pauseRequested: row.pause_requested === true,
    cancelRequested: row.cancel_requested === true,
    version: Number(row.current_version),
    createdAt: date(row.created_at),
    updatedAt: date(row.updated_at),
  };
}
