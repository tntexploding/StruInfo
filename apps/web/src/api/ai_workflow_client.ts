export interface AiPolicySettings {
  enabled: boolean;
  paused: boolean;
  subscriptionIds: string[];
  manualUploads: boolean;
  model: string;
  maxEntries: number;
  maxRelations: number;
  maxModelCalls: number;
  maxDocumentsPerDay: number;
}
export interface AiPolicy {
  revision: number;
  settings: AiPolicySettings;
}
export interface AiTask {
  taskId: string;
  version: number;
  model: string;
  actorKind: string;
  request: {kind: string; snapshotId?: string; entryId?: string};
  state: {
    status: string;
    phase: string;
    calls: number;
    steps: {complete: boolean}[];
    errorCode?: string;
  };
}
export interface AiQueueItem {
  snapshotId: string;
  sourceLabel?: string;
  version: number;
  status: string;
  taskId?: string;
  errorCode?: string;
  task?: {status: string; phase?: string; calls?: number; errorCode?: string};
}
export interface AiQueueCursor {
  snapshotId: string;
  createdAt: string;
}
export interface AiQueueStatus {
  policy: AiPolicy;
  modelConfigured: boolean;
  items: AiQueueItem[];
  nextCursor?: AiQueueCursor;
  summary?: {
    counts: Record<string, number>;
    admittedToday: number;
    modelAttempts: number;
  };
}
export interface AiRuntimeStatus {
  model?: string;
  role: string;
  agentEnabled: boolean;
  grants: string[];
}
export interface AiSource {
  subscriptionId: string;
  label: string;
  enabled: boolean;
}
export type AiWorkflowClient = <T>(
  operation: string,
  input?: unknown,
) => Promise<T>;
export const aiWorkflowCommand: AiWorkflowClient = async <T>(
  operation: string,
  input: unknown = {},
) => {
  const path =
    operation.startsWith('ingestion_') || operation === 'subscriptions_list'
      ? '/api/v1/ingestion/commands'
      : '/api/v1/ai-tasks/commands';
  const response = await fetch(path, {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({operation, input}),
  });
  const body: unknown = await response.json();
  if (body && typeof body === 'object' && 'error' in body) {
    const error = body.error;
    throw new Error(
      error &&
        typeof error === 'object' &&
        'code' in error &&
        typeof error.code === 'string'
        ? error.code
        : 'ai_operation_failed',
    );
  }
  if (!response.ok || !body || typeof body !== 'object' || !('result' in body))
    throw new Error('ai_operation_failed');
  return body.result as T;
};
export function aiError(error: unknown): string {
  const code = error instanceof Error ? error.message : '';
  const messages: Record<string, string> = {
    stale_ingestion_policy:
      '策略已被其他操作修改。草稿已保留，请重新读取后再保存。',
    stale_ingestion_item: '文档处理状态已更新，请刷新后重试。',
    stale_task_version: '任务已更新，请刷新后重试。',
    snapshot_already_materialized:
      '这份文档已经有条目，请在资料库中整理现有结构。',
    ingestion_model_not_configured:
      '模型尚未配置，或模型名称与服务配置不一致。',
    ingestion_scope_required: '请选择至少一个订阅，或勾选手动导入。',
    task_queue_unavailable: '处理队列暂时已满，请稍后重试。',
    ai_provider_unavailable: '模型服务暂时不可用，原文和已完成步骤仍保留。',
    ai_provider_timeout: '模型响应超时，可以重试或接管。',
    ai_split_input_unsupported: '文档超出自动拆分的范围，请在资料库调整结构。',
    daily_document_budget_reached:
      '今日新文档额度已用完，将在下一 UTC 日继续。',
    ai_not_configured: '模型尚未配置，人工整理仍可使用。',
    model_call_budget_exhausted: '本篇模型调用额度已用尽，请接管处理。',
    ingestion_scope_removed: '这份文档已移出授权范围。',
    ingestion_budget_changed: '当前额度比任务创建时更小，请核对策略或接管。',
    task_execution_failed: '任务执行失败，可以查看原因并重试或接管。',
    ai_operation_failed: '暂时无法读取 AI 工作流，请确认服务已升级并重试。',
  };
  return (
    messages[code] ??
    (code && /^[a-z][a-z0-9_]{0,119}$/.test(code)
      ? '操作未完成：' + code
      : '暂时无法连接服务，请重试。')
  );
}
