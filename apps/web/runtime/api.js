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
]);
const readPosts = new Set([
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
