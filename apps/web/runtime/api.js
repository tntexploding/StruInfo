// Framework §6: distinguish rejected, conflicted and uncertain writes.
export class ApiError extends Error {
  constructor(message, {kind = 'rejected', status = 0, code, detail} = {}) {
    super(message);
    Object.assign(this, {kind, status, code: code || message, detail});
  }
}
const readCommands = new Set([
  'system_status',
  'ai_price_status',
  'ingestion_status',
  'intake_status',
  'intake_origins',
  'source_quality_status',
  'annotation_vocabulary',
  'tasks_list',
  'document_publication_status',
  'topics_list',
  'research_status',
  'report_pipeline_status',
  'reports_list',
  'report_read',
  'history_list',
  'history_status',
  'history_items',
  'history_select',
  'split_source_read',
  'split_source_sample',
  'split_source_status',
  'split_recipes_read',
  'split_recipe_preview',
]);
const readPosts = new Set([
  'entries/aggregations/read',
  'entries/search',
  'entries/query-context',
  'knowledge-graph/view',
]);
export function isRead(path, body, method) {
  const route = path.replace(/^\/api\/v1\//, '').split('?')[0];
  return (
    (route === 'assistant/commands' &&
      ['status', 'tools', 'sessions', 'read', 'events'].includes(
        body?.operation,
      )) ||
    method === 'GET' ||
    readPosts.has(route) ||
    (route.endsWith('/commands') && readCommands.has(body?.operation))
  );
}
function check(value, status) {
  if (
    value?.error ||
    [
      'rejected',
      'unavailable',
      'not_found',
      'failed',
      'stale',
      'conflict',
    ].includes(value?.status)
  ) {
    const code = value.error?.code || value.issue?.code || value.status;
    throw new ApiError(code, {
      status,
      code,
      detail: value,
      kind: /stale|conflict/.test(code) ? 'conflict' : 'rejected',
    });
  }
  return value;
}
const uncertainWrites = new Set();
export async function request(
  path,
  body,
  method = body === undefined ? 'GET' : 'POST',
  options = {},
) {
  const reading = isRead(path, body, method);
  const writeKey = method + ' ' + path;
  if (!reading && uncertainWrites.has(writeKey))
    throw new ApiError('上次操作结果待确认。请刷新页面核对当前状态后再操作。', {
      kind: 'unknown',
    });
  let timer;
  const timeout = new AbortController();
  const signal = reading
    ? AbortSignal.any([
        timeout.signal,
        ...(options.signal ? [options.signal] : []),
      ])
    : timeout.signal;
  timer = setTimeout(
    () => timeout.abort(new DOMException('请求超时', 'TimeoutError')),
    reading ? 15000 : 120000,
  );
  try {
    const response = await fetch(
      path.startsWith('/health')
        ? path
        : '/api/v1/' + path.replace(/^\/api\/v1\//, ''),
      {
        method,
        credentials: 'same-origin',
        signal,
        headers: {
          ...(body === undefined ? {} : {'Content-Type': 'application/json'}),
          ...(options.authorization
            ? {Authorization: options.authorization}
            : {}),
        },
        ...(body === undefined ? {} : {body: JSON.stringify(body)}),
      },
    );
    const text = await response.text();
    let value;
    try {
      value = text ? JSON.parse(text) : {};
    } catch {
      throw new ApiError('服务返回格式有误', {
        status: response.status,
        kind: reading ? 'rejected' : 'unknown',
      });
    }
    check(value, response.status);
    if (!response.ok)
      throw new ApiError('请求失败（' + response.status + '）', {
        status: response.status,
        detail: value,
      });
    return value;
  } catch (error) {
    if (
      !reading &&
      (!(error instanceof ApiError) || error.kind === 'unknown')
    ) {
      uncertainWrites.add(writeKey);
      throw new ApiError(
        '连接中断，操作结果待确认。请刷新页面核对当前状态后再操作。',
        {kind: 'unknown'},
      );
    }
    if (error instanceof ApiError || (reading && options.signal?.aborted))
      throw error;
    if (timeout.signal.aborted)
      throw new ApiError('读取超时，请重新读取', {kind: 'timeout'});
    throw new ApiError(
      reading
        ? '连接失败，请重新读取'
        : '连接中断，操作结果待确认。请先重新读取状态。',
      {kind: reading ? 'network' : 'unknown'},
    );
  } finally {
    clearTimeout(timer);
  }
}
export function createClient(getOptions = () => ({})) {
  const read = (path, body, method) =>
    request(path, body, method, getOptions());
  const command = async (route, operation, input = {}) =>
    check((await read(route + '/commands', {operation, input})).result);
  return {
    request: read,
    command,
    ingestion: (operation, input) => command('ingestion', operation, input),
    tasks: (operation, input) => command('ai-tasks', operation, input),
    price: (operation, input) => command('ai-price', operation, input),
    research: (operation, input) => command('research', operation, input),
    reports: (operation, input) => command('reports', operation, input),
  };
}
export const {command, ingestion, tasks, price, research, reports} =
  createClient();
export const safeUrl = (value) => {
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) ? url.href : '';
  } catch {
    return '';
  }
};
export const lines = (value) =>
  String(value || '')
    .split(/[,，\n]/)
    .map((s) => s.trim())
    .filter(Boolean);
export function failure(error) {
  const names = {
    history_batch_busy: '批次正在运行。请先暂停再修改清单。',
    history_budget_required: '当前批次预算不可用，请核对预算、模型和余额。',
    entry_budget_exceeded: '拆分结果超过本篇条目上限。',
    recipe_entry_capacity: '规则拆分超过本篇条目上限。',
    history_budget_changed: '此批次已绑定其他预算。',
    history_preexisting: '已有资料，沿用原审核决定。',
    history_receipt_changed: '已有审核决定或文档任务。',
    history_checkpoint_failed: '批次进度保存失败。请检查数据卷后继续。',
    history_article_restricted: '正文有访问限制',
    history_session_limit: '已有 8 个未完成的批次，请先完成或移除其中一个。',
    history_source_changed: '来源配置已变更，请重新选择来源。',
    recipe_ai_required: '这是 AI 处理方案，请通过文档任务生成切点',
    split_recipe_invalid: '模板参数未通过检查，请核对数量范围与匹配条件',
    recipe_trials_required: '样本数量、分数或预期结果未通过检查，请重新试读',
    recipe_samples_required: '该格式的样本数量不足，请继续接收或调整取样数量',
    recipe_mixed_sample_formats: '样本包含不同结构，请分组生成模板',
    recipe_source_mismatch: '样本与模板的来源不一致',
    recipe_text_capacity: '样本超出处理容量，请减少本次样本数量',
    recipe_sample_unavailable: '样本已被拒绝或只有摘要，请重新取样',
    recipe_rule_unverified: '可用规则还不能在这组已确认文档上重现正文和标题。',
    recipe_observation_changed: '这次匹配记录已更新，请重新打开模板面板。',
    recipe_review_unavailable: '当前任务没有等待复核的拆分步骤。',
    recipe_review_unresolved:
      '现有模板仍未通过匹配，请调整模板或仅将本篇交给 AI。',
    stale_split_recipes: '模板目录已更新，请重新打开后操作',
    recipe_copy_required: '使用中的模板需要保存为新版本',
    aggregation_requires_text_search:
      '聚合使用文字筛选，请先将搜索方式改为文字搜索',
    aggregation_topics_unavailable: '主题服务暂不可用',
    aggregation_topic_not_found: '所选主题已不可用，请重新选择',
    aggregation_not_collected: '请先更新聚合，生成引用清单',
    aggregation_changed: '聚合已更新，请重新打开',
    saved_queries_revision_conflict: '聚合已被修改，请刷新后再操作',
    saved_query_name_exists: '这个聚合名称已存在',
    saved_query_limit: '最多保存 20 个聚合',
    stale_task_version: '任务已更新，请重新读取后操作',
    source_subscription_stale: '来源已更新，请重新读取后合并修改',
    stale_document_publication: '文档已更新，请重新读取后确认',
    ai_not_configured: '尚未配置 AI',
    ai_operations_paused: 'AI 已暂停',
    ai_price_window_closed: '等待允许的调用时段',
    invalid_agent_input: '参数未通过校验',
    invalid_request: '参数未通过校验',
    invalid_http_input: '参数未通过校验，请检查必填值与范围',
    service_unavailable: '服务暂不可用，请稍后重新读取',
  };
  return names[error.code || error.message] || error.message || '操作未完成';
}
export async function attempt(action, announce) {
  try {
    return await action();
  } catch (error) {
    if (error.name === 'AbortError') return undefined;
    announce(failure(error), {kind: 'error'});
    return undefined;
  }
}
