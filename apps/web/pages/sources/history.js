import {ingestion, failure} from './api.js';
import {escape as e, sourceRecord} from './store.js';

export function historyPanel(root, currentSource) {
  const $ = (s) => root.querySelector(s);
  const batches = $('#history-batch'),
    area = $('#history-results'),
    progress = $('#history-progress');
  let id = '',
    state,
    articles = [],
    chosen = new Set(),
    page = 0,
    itemOffset = 0,
    detailsOpen = false,
    listed = false,
    busy = false,
    requestNumber = 0,
    reading = false;
  const active = () => root.isConnected && batches.isConnected;
  const button = (name, label) =>
    `<button class="compact-button" data-history="${name}">${label}</button>`;
  function renderRows() {
    area.hidden = false;
    const rows = articles.slice(page * 50, (page + 1) * 50);
    area.innerHTML = articles.length
      ? `<div class="history-toolbar"><span>共 ${articles.length} 篇</span>${button('all', '全选筛选结果')}${button('none', '清空选择')}</div>${rows.map((a) => `<label><input type="checkbox" name="history-result" value="${a.id}" ${chosen.has(a.id) ? 'checked' : ''}><span>${e(a.title)} · ${e(sourceRecord(a.subscriptionId)?.label || '')}</span></label>`).join('')}${articles.length > 50 ? `<div class="history-toolbar">${page ? button('prev', '上一页') : ''}<span>${page + 1} / ${Math.ceil(articles.length / 50)}</span>${(page + 1) * 50 < articles.length ? button('next', '下一页') : ''}</div>` : ''}`
      : '<p>当前筛选内没有可补收的资料。</p>';
    syncAdd();
  }
  function syncAdd() {
    const b = $('#history-add');
    b.disabled =
      busy || !chosen.size || Boolean(state?.plan) || Boolean(state?.work);
    b.textContent = chosen.size
      ? '加入待审核队列（' + chosen.size + '）'
      : '加入待审核队列';
  }
  function show() {
    const p = state?.plan,
      sources = state?.sources || [];
    $('#history-filters').hidden = Boolean(id);
    $('#history-search').hidden = Boolean(id);
    $('.history-steps').hidden = Boolean(id && (p || state?.work));
    root.querySelector('[data-history="discard"]').hidden =
      !id || Boolean(state?.work);
    if (!state) {
      progress.replaceChildren();
      area.hidden = true;
      syncAdd();
      return;
    }
    const counts = sources
      .map((s) => e(s.label) + ' ' + s.count + ' 篇')
      .join(' · ');
    const problems = sources.flatMap((s) =>
      s.errors.map((err) => e(s.label) + ' · ' + e(err.code)),
    );
    const pending = sources.some(
      (s) => s.pending > 0 || s.status === 'waiting',
    );
    let message = p
      ? `选定 ${p.selected} · 新接收 ${p.imported} · 已存在 ${p.existing} · 接收失败 ${p.failed} · 待接收 ${p.pending}`
      : counts;
    if (state.work === 'scan') message = '正在读取目录 · ' + message;
    if (state.work === 'import') message = '正在补收 · ' + message;
    if (state.work === 'process')
      message =
        ({
          budget_wait: '等待批次预算',
          dispatch_wait: '等待 AI 许可或价格时段',
          running: 'AI 正在处理',
        }[p?.processing?.wait] || 'AI 审核与整理') +
        ' · ' +
        message;
    let controls;
    const available =
      state.budget &&
      !state.budget.paused &&
      state.budget.remainingCny > 0 &&
      (!state.batchKey || state.batchKey === state.budget.batchId) &&
      (!p?.processing || p.processing.budgetId === state.budget.batchId);
    if (state.work) controls = button('pause', '暂停');
    else if (p)
      controls =
        (p.pending ? button('continue', '继续补收') : '') +
        (p.failed ? button('retry', '重试失败项') : '') +
        ((p.processing?.state !== 'finished' || p.submissionFailures) &&
        (p.imported || p.pending) &&
        available
          ? button(
              'process',
              p.submissionFailures
                ? '重试未提交的任务'
                : p.processing
                  ? '继续本批 AI 处理'
                  : 'AI 审核并整理本批',
            )
          : '');
    else
      controls =
        (pending ? button('scan', '继续查询') : '') +
        (problems.length ? button('scanRetry', '重试未读取目录') : '');
    progress.innerHTML = `<div class="history-toolbar"><strong>${message}</strong>${controls}</div>${state.problem ? `<p>${e(failure({message: state.problem}))}</p>` : ''}${problems.length ? `<details><summary>有 ${problems.length} 条目录读取提示</summary><ul>${problems.map((v) => '<li>' + v + '</li>').join('')}</ul></details>` : ''}${p?.failures?.length ? `<details><summary>查看失败原因</summary><ul>${p.failures.map((f) => '<li>' + e(f.title || f.id) + ' · ' + e(failure({message: f.code})) + '</li>').join('')}</ul></details>` : ''}`;
    if (p)
      progress.insertAdjacentHTML(
        'beforeend',
        `<p>批次编号 <code>${e(id)}</code></p>${p.processing ? '<p>已提交 ' + p.submitted + ' 篇给 AI · ' + {running: '处理中', paused: '已暂停', finished: '本批已结束'}[p.processing.state] + (p.taskAttention ? ' · ' + p.taskAttention + ' 篇需查看' : '') + '</p>' : ''}${state.budget ? '<p>批次预算 ' + e(state.budget.batchId) + ' · 剩余 ' + Number(state.budget.remainingCny).toFixed(2) + ' 元</p>' : '<p>配置批次预算后，可交给 AI 审核并整理。</p>'}` +
          button('items', detailsOpen ? '收起逐篇记录' : '查看逐篇记录') +
          '<div class="history-items"></div>',
      );
    area.hidden = !listed || Boolean(p) || Boolean(state.work);
    syncAdd();
  }
  async function loadItems(target) {
    const where = root.querySelector('.history-items');
    if (!detailsOpen || !where) return;
    const result = await ingestion('history_items', {
      sessionId: target,
      offset: itemOffset,
    });
    if (!where.isConnected || id !== target || !detailsOpen) return;
    const statuses = {
      imported: '新接收',
      existing: '已存在',
      failed: '失败',
      pending: '待处理',
    };
    const phases = {
      intake: '审核',
      split: '拆分',
      tags: '标注',
      publish: '发布',
      complete: '完成',
    };
    where.innerHTML =
      '<ul>' +
      result.items
        .map((row) => {
          const d = row.document,
            stage =
              d?.publishedEntries !== undefined
                ? '已发布 ' + d.publishedEntries + ' 条'
                : d?.status === 'failed'
                  ? '文档任务失败'
                  : d?.status === 'paused'
                    ? '文档任务已暂停'
                    : d?.phase
                      ? phases[d.phase] || d.phase
                      : d?.receipt === 'rejected'
                        ? '已拒绝'
                        : d?.receipt === 'accepted'
                          ? '已接受'
                          : '待审核';
          const title = row.snapshotId
            ? '<a href="#/reading?doc=' +
              row.snapshotId +
              '">' +
              e(row.title) +
              '</a>'
            : e(row.title);
          return (
            '<li>' +
            title +
            '<small>' +
            statuses[row.status] +
            ' · ' +
            e(
              row.code
                ? failure({message: row.code})
                : d?.errorCode && ['failed', 'paused'].includes(d.status)
                  ? failure({message: d.errorCode})
                  : row.job?.reason && !row.job.taskId
                    ? failure({message: row.job.reason})
                    : d
                      ? stage
                      : '等待接收',
            ) +
            (d?.entryLimit ? ' · 本篇上限 ' + d.entryLimit + ' 条' : '') +
            (d?.calls ? ' · ' + d.calls + ' 次模型调用' : '') +
            '</small></li>'
          );
        })
        .join('') +
      '</ul>' +
      (itemOffset ? button('items-prev', '上一页') : '') +
      (itemOffset + 25 < result.total ? button('items-next', '下一页') : '');
  }
  async function refresh() {
    const target = id;
    if (!target) return;
    const serial = ++requestNumber;
    reading = true;
    try {
      const out = await ingestion('history_status', {sessionId: target});
      if (!active() || id !== target || serial !== requestNumber) return;
      state = out.sessions[0];
      if (!state) throw new Error('此批次已不可查看');
      state.budget = out.budget;
      show();
      if (state.plan && detailsOpen) await loadItems(target);
      if (!state.plan && !state.work && !listed) {
        const out = await ingestion('history_select', {
          sessionId: target,
          ...state.selection,
        });
        if (!active() || id !== target || serial !== requestNumber) return;
        articles = out.articles;
        listed = true;
        renderRows();
      }
    } finally {
      if (serial === requestNumber) reading = false;
    }
  }
  async function select(next) {
    id = next;
    state = undefined;
    detailsOpen = false;
    itemOffset = 0;
    listed = false;
    articles = [];
    chosen = new Set();
    page = 0;
    show();
    if (id) await refresh();
  }
  function listBatches(sessions) {
    const options =
      '<option value="">新查询</option>' +
      sessions
        .map(
          (s) =>
            `<option value="${s.sessionId}">${e(s.sources.map((v) => v.label).join('、'))} · ${e(new Date(s.updatedAt).toLocaleString())}</option>`,
        )
        .join('');
    if (batches.innerHTML !== options) {
      batches.innerHTML = options;
      batches.value = id;
    }
  }
  async function load(preferred) {
    const out = await ingestion('history_status');
    if (!active()) return;
    listBatches(out.sessions);
    batches.value = preferred ?? out.sessions[0]?.sessionId ?? '';
    const source = root.querySelector(
      '[name="history-source"][value="' + currentSource + '"]',
    );
    if (source) source.checked = true;
    await select(batches.value);
  }
  async function action(name) {
    if (busy) return;
    busy = true;
    batches.disabled = true;
    try {
      if (name === 'items' || name === 'items-prev' || name === 'items-next') {
        if (name === 'items') detailsOpen = !detailsOpen;
        else itemOffset += name === 'items-next' ? 25 : -25;
        show();
        await loadItems(id);
        return;
      }
      if (name === 'search') {
        const ids = [
          ...root.querySelectorAll('[name="history-source"]:checked'),
        ].map((i) => i.value);
        if (!ids.length) throw new Error('先选择来源');
        const limit = $('#history-limit');
        if (!limit.reportValidity()) return;
        const archive = $('[data-archive]').value.trim();
        if (archive && ids.length !== 1)
          throw new Error('填写归档地址时请选择一个来源');
        const selection = {
          from: $('#history-from').value || undefined,
          to: $('#history-to').value || undefined,
          text: $('#history-query').value,
          perSourceLimit: Number(limit.value),
        };
        const out = await ingestion('history_open', {
          sources: ids.map((subscriptionId) => ({
            subscriptionId,
            ...(archive ? {archiveUrl: archive} : {}),
          })),
          selection,
        });
        await ingestion('history_run', {
          sessionId: out.sessionId,
          action: 'scan',
        });
        await load(out.sessionId);
      } else if (name === 'discard') {
        await ingestion('history_close', {sessionId: id});
        await load('');
      } else if (name === 'all' || name === 'none') {
        chosen = new Set(name === 'all' ? articles.map((a) => a.id) : []);
        renderRows();
      } else if (name === 'next' || name === 'prev') {
        page += name === 'next' ? 1 : -1;
        renderRows();
      } else if (name === 'add') {
        const plan = await ingestion('history_prepare_import', {
          sessionId: id,
          ids: [...chosen],
          ...state.selection,
        });
        await ingestion('history_run', {
          sessionId: plan.sessionId,
          planId: plan.planId,
          action: 'import',
        });
        await load(plan.sessionId);
      } else if (name === 'process') {
        await ingestion('history_run', {
          sessionId: id,
          planId: state.plan.planId,
          action: 'process',
          budgetId: state.plan.processing?.budgetId ?? state.budget.batchId,
          retryFailed: Boolean(state.plan.submissionFailures),
        });
        await refresh();
      } else {
        const op = ['scan', 'scanRetry'].includes(name)
          ? {action: 'scan', retryFailed: name === 'scanRetry'}
          : name === 'pause'
            ? {action: 'pause'}
            : {
                action: 'import',
                planId: state.plan.planId,
                retryFailed: name === 'retry',
              };
        if (op.action === 'scan') listed = false;
        await ingestion('history_run', {sessionId: id, ...op});
        await refresh();
      }
    } finally {
      busy = false;
      batches.disabled = false;
      syncAdd();
    }
  }
  return {
    load,
    action,
    poll: async () => {
      if (busy || reading || !active()) return;
      const target = id;
      const out = await ingestion('history_status');
      if (!active() || busy || target !== id) return;
      listBatches(out.sessions);
      const current = out.sessions.find((s) => s.sessionId === id);
      if (id && !current) await select('');
      else if (
        id &&
        (current.updatedAt !== state?.updatedAt || detailsOpen || state?.work)
      )
        await refresh();
    },
    change: async (el) => {
      if (el === batches) await select(el.value);
      if (el.name === 'history-result') {
        if (el.checked) chosen.add(el.value);
        else chosen.delete(el.value);
        syncAdd();
      }
    },
  };
}
