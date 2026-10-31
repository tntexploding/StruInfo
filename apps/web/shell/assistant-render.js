import {icon, escape as e} from '../data.js';
import {failure} from '../runtime/api.js';
import {titleOf} from '../runtime/documents.js';

const errors = {
  assistant_not_configured: '尚未启用系统助手。请配置助手访问密钥。',
  assistant_authentication_required: '访问密钥不正确。',
  assistant_invalid_plan: '模型返回格式有误，已保留执行记录。',
  assistant_confirmation_expired: '待确认操作已变更，请重新读取。',
  assistant_busy: '上一条指令仍在处理或等待确认。',
  assistant_operation_failed: '操作未完成，请查看返回信息。',
  assistant_step_limit: '本条指令已达到处理上限。可查看结果后发起新指令。',
  assistant_write_needs_review: '上一步修改结果待核对，请先查阅目标内容。',
  assistant_session_full: '此会话已满，请新建会话。',
  assistant_session_changed: '对话已更新，请重新确认删除。',
  assistant_session_not_found: '这段对话已删除。',
  ai_operations_paused: 'AI 总开关已关闭。可发送“恢复 AI”。',
  ai_price_window_closed: '等待低价时段。到时可继续这条指令。',
  ai_not_configured: '尚未配置模型。',
  ai_provider_unavailable: '模型服务暂时无法连接。',
};
export const stateName = (state) =>
  ({
    running: '处理中',
    confirmation: '等待确认',
    completed: '已完成',
    succeeded: '已完成',
    failed: '未完成',
    interrupted: '已中断',
    cancelled: '已停止',
    queued: '排队',
    ready: '已生成',
    reviewed: '已审阅',
    paused: '已暂停',
    generating: '生成中',
    'waiting-window': '等待价格时段',
  })[state] ||
  state ||
  '';
export const errorText = (error) =>
  errors[error.code || error] ||
  failure(typeof error === 'string' ? {code: error, message: error} : error);
export const button = (
  action,
  label,
  className = 'secondary-action',
  attrs = '',
) =>
  `<button type="button" class="${className}" data-action="${action}" ${attrs}>${label}</button>`;
const documentLink = (id, title, note = '', index = 0) =>
  `<a class="doc-result" href="#/reading?doc=${encodeURIComponent(id)}"><span class="result-number">${String(index + 1).padStart(2, '0')}</span><span><strong>${e(title)}</strong>${note ? `<small>${e(note)}</small>` : ''}</span>${icon('chevron')}</a>`;
const turn = (content) =>
  `<div class="turn assistant-turn" role="group" aria-label="助手回复">${content}</div>`;
function userTurn(message) {
  const ref = message.match(/\n\n参考文档：(.+)（snapshotId: ([^\n]+)）。$/u);
  return `<div class="turn user-turn">${e(ref ? message.slice(0, ref.index) : message)}${ref ? `<div class="sent-reference"><a class="object-link" href="#/reading?doc=${encodeURIComponent(ref[2])}">${icon('file')}<span>${e(ref[1])}</span>${icon('external')}</a></div>` : ''}</div>`;
}
export const startView = () =>
  `<div class="start-state"><h3>需要处理什么？</h3><div class="start-prompts">${['查找最近的技术资料', '查看处理队列', '用本周资料生成报告'].map((p) => button('prompt', e(p) + icon('arrow'), 'suggestion', `data-prompt="${e(p)}"`)).join('')}</div></div>`;

function taskView(result, operation) {
  const t = result.task || result.report || result;
  const s = t.state || t;
  const isReport = operation.startsWith('report_') || Boolean(t.reportId);
  const id = t.reportId || t.taskId || t.id;
  const title =
    s.title ||
    t.title ||
    t.request?.title ||
    (isReport ? '报告任务' : '文档任务');
  const status = s.status || t.status;
  const doc = t.request?.snapshotId || s.request?.snapshotId || t.snapshotId;
  const detail = s.waitReason || s.reason || s.stage || t.stage || '';
  let controls =
    isReport && id
      ? button(
          'report',
          '打开报告',
          'secondary-action',
          `data-report="${e(id)}"`,
        )
      : doc
        ? `<a class="secondary-action" href="#/reading?doc=${encodeURIComponent(doc)}">查看文档</a>`
        : '<a class="secondary-action" href="#/overview">查看队列</a>';
  if (
    id &&
    [
      'failed',
      'paused',
      'interrupted',
      'queued',
      'running',
      'generating',
      'waiting-window',
    ].includes(status)
  ) {
    const attrs = `data-task="${e(id)}" data-kind="${isReport ? 'report' : 'task'}"`;
    if (['failed', 'paused', 'interrupted'].includes(status))
      controls += button(
        'control',
        '从断点继续…',
        'secondary-action',
        attrs + ' data-control="resume"',
      );
    controls += button(
      'control',
      '取消这个任务…',
      'secondary-action task-cancel',
      attrs + ' data-control="cancel"',
    );
  }
  return `<div class="task-card" data-state="${e(status)}"><div class="task-state">${icon(status === 'failed' ? 'alert' : ['completed', 'ready', 'reviewed'].includes(status) ? 'check' : 'clock')}<span>${e(stateName(status))}</span><small>${isReport ? '报告任务' : '文档任务'}</small></div><h3>${e(title)}</h3>${detail ? `<p>${e(typeof detail === 'string' ? detail : JSON.stringify(detail))}</p>` : ''}${['running', 'generating'].includes(status) ? '<progress aria-label="正在处理"></progress>' : ''}<div class="operation-actions">${controls}</div></div>`;
}

function resultView(event) {
  const r = event.result,
    op = event.operation || '';
  if (!r) return `<p>${e(event.text)}</p>`;
  if (op === 'entries_search')
    return `<div class="doc-results">${(r.items || []).map(({entry}, i) => documentLink(entry.snapshotId, entry.value?.titlePath || titleOf(entry), entry.sourceKey, i)).join('') || '<p>没有匹配的条目。</p>'}</div>`;
  if (op === 'documents_list' || op === 'documents_browse')
    return `<div class="doc-results">${(r.documents || []).map((d, i) => documentLink(d.snapshotId, titleOf(d), d.capturedAt?.slice(0, 10), i)).join('') || '<p>没有匹配的文档。</p>'}</div>`;
  if (['subscriptions_list', 'subscriptions_read', 'sources_read'].includes(op))
    return `<div class="doc-results">${(Array.isArray(r) ? r : r.subscriptions || []).map((s) => `<a class="modal-row" href="#/sources?source=${encodeURIComponent(s.subscriptionId)}">${icon('sources')}<span><strong>${e(s.label)}</strong><small>${s.enabled ? '已启用' : '已暂停'}</small></span>${icon('chevron')}</a>`).join('') || '<p>尚无来源。</p>'}</div>`;
  if (r.report || r.task || op === 'task_read' || op === 'report_read')
    return taskView(r, op);
  if (op === 'tasks_list')
    return (
      (Array.isArray(r) ? r : r.tasks || [])
        .map((t) => taskView(t, 'task_read'))
        .join('') || '<p>暂无任务。</p>'
    );
  if (op === 'reports_list')
    return (
      (r.reports || []).map((t) => taskView(t, 'report_read')).join('') ||
      '<p>暂无报告。</p>'
    );
  if (op === 'report_export' && r.markdown)
    return `<p>报告已准备好。</p>${button('download', '导出 Markdown', 'secondary-action', `data-event="${event.sequence}"`)}`;
  if (op === 'queue_control')
    return `<div class="operation-card" data-state="done"><h3>${icon('check')}队列设置已更新</h3></div>`;
  return `<p>${e(event.text)}</p>${button('result', '查看返回内容', 'text-button', `data-event="${event.sequence}"`)}`;
}

export function sessionView(session) {
  const t = session.turn;
  if (!t) return startView();
  let html = (session.messages || [])
    .filter((m) => m.id !== t.id)
    .map(
      (m) =>
        `${userTurn(m.message)}${turn(`<p>${e(m.answer || stateName(m.status))}</p>`)}`,
    )
    .join('');
  html += userTurn(t.message);
  // A background task has one current card even when its status was read repeatedly.
  const jobKey = (ev) =>
    ev.result?.report?.reportId ||
    ev.result?.task?.taskId ||
    ev.result?.taskId ||
    ev.result?.reportId ||
    ev.text;
  const events = t.events || [];
  const latestJob = new Map(
    events
      .filter((ev) => ev.kind === 'job')
      .map((ev) => [jobKey(ev), ev.sequence]),
  );
  html += events
    .filter(
      (ev) =>
        ['result', 'answer', 'error', 'job'].includes(ev.kind) &&
        (ev.kind !== 'job' || latestJob.get(jobKey(ev)) === ev.sequence),
    )
    .map((ev) =>
      turn(
        ev.kind === 'answer'
          ? `<p>${e(ev.text)}</p>`
          : ev.kind === 'error'
            ? `<p class="assistant-error">${e(errorText(ev.text))}</p>`
            : resultView(ev),
      ),
    )
    .join('');
  if (t.pending) {
    const p = t.pending;
    const label =
      p.operation === 'queue_control'
        ? p.input.paused
          ? '暂停后台队列'
          : '恢复后台队列'
        : p.label;
    html += turn(
      `<div class="operation-card" data-state="pending"><div class="operation-status">${icon('pause')}等待确认</div><h3>${e(label)}</h3>${button('parameters', '查看操作参数', 'text-button')}<div class="operation-actions">${button('confirm', '确认执行', 'primary-action')}${button('dismiss', '取消这次操作')}</div></div>`,
    );
  }
  if (t.uncertain)
    html += turn(
      '<p class="assistant-error">上一步修改结果待核对。先查看目标内容，再决定后续操作。</p>',
    );
  if (session.active)
    html += turn(
      `<div class="progress-message"><span><i class="thinking-dot"></i>${e(session.stopRequested ? '等待当前操作结束…' : t.inFlight?.effect === 'model' ? '正在确定下一步…' : events.at(-1)?.text || '正在处理…')}</span></div>`,
    );
  else if (
    ['failed', 'interrupted'].includes(t.status) &&
    !t.uncertain &&
    events.at(-1)?.text !== 'assistant_step_limit'
  )
    html += turn(
      button('resume', '从记录继续') +
        button('refresh', '重新读取', 'quiet-button'),
    );
  return html;
}
