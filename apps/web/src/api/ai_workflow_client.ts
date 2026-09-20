export interface AiIntakePolicy {
  fetchFullText: boolean;
  blockedKinds: string[];
  preferredTopics: string[];
  excludedTopics: string[];
}
export const DEFAULT_INTAKE_POLICY: AiIntakePolicy = {
  fetchFullText: true,
  blockedKinds: ['event_notice', 'promotion', 'update_notice'],
  preferredTopics: [],
  excludedTopics: [],
};
export interface IntakeRecord {
  snapshotId: string;
  version: number;
  updatedAt: string;
  value: {
    receipt?: 'pending' | 'accepted' | 'rejected';
    receiptOrigin?: 'manual' | 'model';
    receiptTaskId?: string;
    deferProcessing?: boolean;
    decision: 'pending' | 'admitted' | 'held' | 'blocked';
    origin: 'manual' | 'model' | 'system';
    reason: string;
    preparedSnapshotId?: string;
    bodySource?: 'received' | 'web_article';
    previousPreparedSnapshotIds?: string[];
    preparation: 'received' | 'web_article';
    assessment?: {
      completeness: 'complete' | 'summary' | 'uncertain';
      contentKind: string;
      reason: string;
    };
  };
}
export const INTAKE_LABELS = {
  pending: '待审核',
  admitted: '已放行',
  held: '已暂缓',
  blocked: '已拒收',
};
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
  intake?: AiIntakePolicy;
  maxRelationCandidates?: number;
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
  createdAt?: string;
  updatedAt?: string;
  runtimeStatus?: 'running' | 'idle' | 'interrupted';
  pauseRequested?: boolean;
  cancelRequested?: boolean;
  request: {kind: string; snapshotId?: string; entryId?: string};
  state: {
    status: string;
    supersededBy?: string;
    recovery?: {
      previousTaskId: string;
      firstStartedAt: string;
      previousCalls: number;
    };
    phase: string;
    calls: number;
    steps: {
      kind?: string;
      targetId?: string;
      relatedEntryId?: string;
      proposalId?: string;
      candidateReasons?: string[];
      recallPlan?: {concepts: {term: string; variants: string[]}[]};
      complete: boolean;
      outcome?: 'no_relation' | 'edge_budget_reached' | 'accepted' | 'held';
    }[];
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
    operation.startsWith('ingestion_') ||
    operation.startsWith('intake_') ||
    operation === 'subscriptions_list'
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
    intake_receipt_pending: '本篇仍在收件箱待接受，请先接受资料。',
    intake_receipt_not_pending:
      '接收决定已改变。AI 不会覆盖新决定，请刷新核对。',
    intake_receipt_rejected: '本篇已拒绝，可在收件箱恢复为待接受。',
    intake_receipt_failed: '接收决定保存失败，请刷新后重试。',
    intake_blocked: '本篇已拒收，后续自动处理停止；可在收件箱恢复。',
    intake_held: '本篇已暂缓，请在收件箱查看原因并决定重试或放行。',
    stale_intake_version: '审核状态已变化，请重新读取后再操作。',
    intake_body_not_selected:
      '这份抓取已保留为历史原文，请使用当前选定的正文。',
    intake_body_already_processed:
      '本篇已进入拆分或已有条目，不能切换整理正文。',
    intake_task_active: '请先暂停本篇整理任务，再切换或重新获取正文。',
    intake_capture_history_limit:
      '本篇已保留 16 次历史抓取，请先从现有正文中选择。',
    intake_busy: '正在获取全文，请稍后重试。',
    intake_fulltext_unavailable:
      '这份材料没有可获取的公开网页正文，请使用接收原文。',
    intake_unavailable: '接收审核服务暂不可用，请确认服务已升级。',
    stale_document_publication: '文档已变化，请重新读取并确认全部条目。',
    document_not_admitted: '请先在文档入口接受这份资料。',
    document_manual_confirmation_required:
      '人工修改已保留，请在工作台确认入库。',
    publication_unavailable: '入库确认服务尚不可用，请刷新后重试。',
    document_queue_changed: '文档或任务状态已改变，请重新选择。',
    task_superseded: '旧任务已由新一轮接续，请操作最新任务。',
    task_restart_not_required: '本任务仍可从断点继续，或需先处理文档冲突。',
    document_changed_after_tags:
      '文档条目已被修改，请在工作台核对并确认，批量操作不会覆盖。',
    stale_task_version: '任务已更新，请刷新后重试。',
    snapshot_already_materialized:
      '这份文档已经有条目，请在资料库中整理现有结构。',
    ingestion_model_not_configured:
      '模型尚未配置，或模型名称与服务配置不一致。',
    ingestion_scope_required: '请选择至少一个订阅，或勾选手动导入。',
    task_queue_unavailable: '处理队列暂时已满，请稍后重试。',
    ai_provider_unavailable: '模型服务暂时不可用，原文和已完成步骤仍保留。',
    stale_ai_price_policy: 'AI 控制已在其他页面修改，请等待状态刷新后重试。',
    ai_operations_paused:
      '内置 AI 后续操作已禁止；可在总览允许继续，已有结果保留。',
    ai_price_window_closed:
      '等待 DeepSeek 低价时段，届时自动续跑；未消耗调用预算。',
    ai_price_resume_required: '此任务由数据包恢复，请确认后手动继续。',
    task_authority_changed:
      '外部 Agent 授权已改变，任务暂停，请确认权限后再继续。',
    ai_provider_timeout: '模型响应超时，可以重试或接管。',
    ai_provider_invalid_response:
      '模型返回的内容未通过校验，已完成步骤保留，可检查后重试。',
    ai_provider_incomplete_response:
      '模型输出未完成，可能达到输出上限；已完成步骤保留，检查后可在剩余额度内重试。',
    ai_provider_invalid_envelope:
      '模型响应缺少完整的结果封装；已完成步骤保留，可重试失败步骤。',
    ai_provider_invalid_json:
      '模型结果不是有效 JSON；没有保存为成功结果，可在剩余额度内重试。',
    ai_provider_invalid_schema:
      '模型结果的字段、数量或长度不符合要求；已完成步骤保留，可重试失败步骤。',
    insufficient_document_call_budget:
      '现有额度不足以覆盖拆分后的标签、召回和候选评估；拆分提案已保留，尚未创建条目，请接管或另行选择处理范围。',
    step_attempt_budget_exhausted:
      '本步骤已达到 3 次尝试上限，可在任务队列中重启新一轮；已完成结果保留。',
    ai_split_input_unsupported:
      '拆分输入超过 128 个证据块或 120,000 字符，或缺少可用结构；需先在工作台调整结构，原样重试无效。',
    ai_intake_input_too_large:
      '审核请求超过 160,000 字符上限；需先调整正文输入，原样重试无效。',
    daily_document_budget_reached:
      '今日新文档额度已用完，将在下一 UTC 日继续。',
    ai_not_configured: '模型尚未配置，人工整理仍可使用。',
    model_call_budget_exhausted:
      '本轮模型调用额度已用尽，可在任务队列中重启新一轮。',
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

export interface DocumentQueueItem {
  snapshotId: string;
  expectedVersion: number;
  taskId?: string;
  title: string;
  canonicalUri?: string;
  action: 'resume' | 'restart' | 'start' | 'cancel';
  taskStatus?: AiTask['state']['status'];
  errorCode?: string;
}
export interface DocumentQueueStatus {
  items: DocumentQueueItem[];
  held: number;
  duplicates: number;
  batchLimit: number;
}
export interface DocumentQueueResult {
  queued: {snapshotId: string; taskId: string}[];
  cancelled: {snapshotId: string; taskId: string}[];
  failed: {snapshotId: string; code: string}[];
}
