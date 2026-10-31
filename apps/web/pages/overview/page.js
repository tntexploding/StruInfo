import {request} from './api.js';
import {pageContext} from '../../runtime/route.js';
import {icon, paintIcons, escape as e} from '../../data.js';
import {createDialog} from '../../shared/dialog.js';
import {notice as toast} from '../../shared/notice.js';
import {stages, statisticNames} from './model.js';
import {createMotion} from './motion.js';
import {
  ingestion,
  tasks,
  price,
  reports,
  research,
  attempt,
  failure,
} from './api.js';
import {titleOf} from '../../runtime/documents.js';
const page = pageContext('overview');
export async function mount() {
  const $ = (s, r = page.root) => r.querySelector(s),
    $$ = (s, r = page.root) => [...r.querySelectorAll(s)];
  const {dialog, closeDialog} = createDialog(page.root);

  let data,
    observed,
    counts = {},
    pending = [],
    animation,
    polling = false,
    inventoryAt = 0,
    taskSignature = '';
  const state = {stage: 0, running: false};
  const readCache = {};
  let readFailures = [];
  $('#hero-stats').innerHTML = Object.entries(statisticNames)
    .map(
      ([key, name]) =>
        `<button class="hero-stat" data-stat="${key}" aria-label="查看${name}统计"><strong>—</strong><span>${name}</span><em class="stat-delta" aria-hidden="true"></em></button>`,
    )
    .join('');
  $('#pipeline').innerHTML = stages
    .map(
      (s, i) =>
        `<li class="ov-step" data-step="${i}"><button aria-label="${s.name}：查看状态"><span class="flow-node"><span class="ef-stage-ai-label">AI 自动</span><canvas class="ef-node-ring" aria-hidden="true"></canvas><span class="ov-node-content">${icon(s.icon)}<span class="ov-step-title">${s.name}</span></span></span><span class="ov-step-summary">读取中</span></button>${i < 5 ? '<span class="flow-connector" aria-hidden="true"></span>' : ''}</li>`,
    )
    .join('');
  const motion = createMotion(
    $('#overview-sample'),
    () => state,
    (stage) => {
      if (!animation) return;
      counts[animation.key] = animation.value;
      renderCounts();
      const el = $(`[data-stat="${animation.key}"]`);
      $('.stat-delta', el).textContent = '+' + animation.amount;
      el.classList.add('bump');
      setTimeout(() => el.classList.remove('bump'), 1400);
      $('#sample-announcement').textContent =
        `${stages[stage].name}完成，${statisticNames[animation.key]}增加 ${animation.amount}`;
    },
    (playing) => {
      if (!playing) {
        animation = null;
        nextAnimation();
      }
    },
  );
  function nextAnimation() {
    if (animation || !pending.length) return;
    animation = pending.shift();
    motion.play(
      animation.stage,
      animation.stage < 5 ? animation.stage + 1 : -1,
    );
  }
  const labels = {
    running: '处理中',
    queued: '排队',
    waiting: '等待',
    waiting_price: '等待价格时段',
    paused: '已暂停',
    failed: '失败',
    completed: '已完成',
    succeeded: '已完成',
    cancelled: '已取消',
    ready: '已完成',
    reviewed: '已核对',
    generating: '生成中',
    review: '待核对',
  };
  const taskState = (t) =>
    t.runtimeStatus === 'running' || t.state?.status === 'generating'
      ? 'running'
      : t.state?.status || t.status || 'waiting';
  const terminal = (t) =>
    ['completed', 'succeeded', 'cancelled', 'ready', 'reviewed'].includes(
      taskState(t),
    );
  const phase = (t) =>
    ({
      intake: 0,
      prepare: 0,
      split: 2,
      tags: 3,
      annotation: 3,
      publish: 1,
      recall: 4,
      relation: 4,
      relations: 4,
      report: 5,
    })[t.state?.phase || t.request?.kind] ?? 2;
  const activeTasks = () => data?.tasks.filter((t) => !terminal(t)) || [];
  const taskTitle = (t) =>
    t.title ||
    titleOf(
      data.snapshots.find((s) => s.snapshotId === t.request?.snapshotId) || {
        title: '文档任务',
      },
    );
  function taskRow(t) {
    const status = taskState(t),
      steps = t.state?.steps || [];
    return `<button class="task-item" data-task="${t.taskId}" data-status="${status === 'failed' ? 'failed' : status === 'running' ? 'running' : terminal(t) ? 'done' : 'waiting'}"><span class="task-icon">${icon(status === 'failed' ? 'alert' : 'file')}</span><span class="task-copy"><strong>${e(taskTitle(t))}</strong><small>${e(t.state?.errorCode || stages[phase(t)].name)}</small><span class="task-progress" aria-label="已完成 ${steps.filter((s) => s.complete).length} / ${steps.length}">${steps.map((s) => `<i class="${s.complete ? 'done' : status === 'running' ? 'now' : ''}"></i>`).join('')}</span></span><span class="task-stage">${e(labels[status] || status)}${icon('chevron')}</span></button>`;
  }
  function renderCounts() {
    $$('.hero-stat').forEach(
      (el) => ($('strong', el).textContent = counts[el.dataset.stat] ?? '—'),
    );
  }
  function notices() {
    if (!data) return [];
    const items = [];
    const held = {length: data.summary.pendingCount};
    if (held.length)
      items.push({
        id: 'intake',
        title: `${held.length} 篇文档待审核`,
        body: '在源管理中查看原文并接受或拒绝。',
        action: '审核',
        icon: 'eye',
        tone: 'warn',
      });
    for (const t of activeTasks().filter((t) => taskState(t) === 'failed'))
      items.push({
        id: t.taskId,
        title: taskTitle(t),
        body: t.state?.errorCode || '任务执行失败',
        action: '查看',
        icon: 'alert',
        tone: 'bad',
      });
    for (const q of data.quality?.sources || []) {
      if (q.needsReview)
        items.push({
          id: 'source:' + q.subscriptionId,
          title: q.label || '来源需要复核',
          body: `最近 ${q.reviewed} 篇中，${q.manualRejected + q.aiHeld} 篇未接受。`,
          action: '查看',
          icon: 'sources',
          tone: 'warn',
        });
    }
    for (const n of data.pipeline.notices || []) {
      if (!n.value.read)
        items.push({
          id: 'notice:' + n.id,
          title: n.value.title || '内容更新',
          body:
            n.value.category === 'report' ? '报告已更新。' : '资料已有新内容。',
          action: '查看',
          icon: 'file',
          tone: 'good',
        });
    }
    return items;
  }
  function render() {
    renderCounts();
    const list = activeTasks(),
      current = list.find((t) => taskState(t) === 'running') || list[0];
    state.stage = current ? phase(current) : 0;
    state.running = Boolean(current && taskState(current) === 'running');
    const awaiting = data.summary.pendingCount;
    $$('.ov-step').forEach((el, i) => {
      const active = list.filter((t) => phase(t) === i),
        node = $('.flow-node', el),
        failed = active.some((t) => taskState(t) === 'failed'),
        running = active.some((t) => taskState(t) === 'running');
      node.className =
        'flow-node' +
        (failed
          ? ' failed'
          : running
            ? ' running'
            : active.length
              ? ' waiting'
              : '');
      el.className = 'ov-step' + (running ? ' running' : '');
      $('.ov-step-summary', el).textContent =
        i === 0 && awaiting
          ? `${awaiting} 篇待审核`
          : failed
            ? '需要检查'
            : running
              ? '正在处理'
              : active.length
                ? `${active.length} 个任务等待`
                : '暂无任务';
      $('.ef-stage-ai-label', el).textContent = failed
        ? '处理异常'
        : running
          ? 'AI 自动'
          : '等待执行';
    });
    $('#flow-status').innerHTML =
      `<i class="status-dot ${state.running ? 'ai' : 'good'}"></i>${state.running ? '正在' + stages[state.stage].name : '等待任务'}`;
    $('#flow-document').textContent = current
      ? taskTitle(current)
      : '暂无处理任务';
    $('#current-task').hidden = !current;
    $('#ai-state').textContent = !data.ingestion.modelConfigured
      ? '未配置'
      : data.price.policy.operationsAllowed === false
        ? '已停止'
        : state.running
          ? '处理中'
          : '待机';
    $('#ai-control').innerHTML =
      icon(data.price.policy.operationsAllowed === false ? 'play' : 'pause') +
      (data.price.policy.operationsAllowed === false ? '允许 AI' : '停止 AI');
    $('#ai-control').disabled = false;
    $('#queue-summary').textContent =
      `运行 ${list.filter((t) => taskState(t) === 'running').length} / ${data.price.policy.maxConcurrentRequests ?? 1} · 等待 ${list.filter((t) => !['running', 'failed'].includes(taskState(t))).length}`;
    $('#task-list').innerHTML = list.length
      ? list.slice(0, 6).map(taskRow).join('')
      : '<div class="list-empty"><strong>暂无处理任务</strong></div>';
    const n = notices();
    $('#message-count').textContent = n.length + ' 条';
    $('#message-list').innerHTML =
      n
        .map(
          (n) =>
            `<div class="notice-item" data-tone="${n.tone}">${icon(n.icon)}<div><p>${e(n.title)}</p><small>${e(n.body)}</small></div><button data-message="${n.id}">${n.action}</button></div>`,
        )
        .join('') ||
      '<div class="list-empty"><strong>暂无新消息</strong></div>';
  }
  async function refresh() {
    if (polling || document.hidden) return;
    polling = true;
    try {
      const reads = [
        [
          'jobs',
          '文档任务',
          () => tasks('tasks_list', {prioritizeActive: true}),
          [],
        ],
        [
          'pricing',
          'AI 许可',
          () => price('ai_price_status'),
          {policy: {operationsAllowed: false}},
        ],
        [
          'reportList',
          '报告任务',
          () => reports('reports_list', {prioritizeActive: true}),
          {reports: []},
        ],
        [
          'topicList',
          '主题与联系',
          () => ingestion('topics_list'),
          {topics: [], jobs: []},
        ],
        [
          'policy',
          '自动处理',
          () => ingestion('ingestion_status'),
          {modelConfigured: false},
        ],
        [
          'quality',
          '来源质量',
          () => ingestion('source_quality_status'),
          {sources: []},
        ],
        [
          'pipeline',
          '报告消息',
          () => research('report_pipeline_status'),
          {notices: []},
        ],
      ];
      const responses = await Promise.allSettled(
        reads.map(async ([key, label, read]) => ({
          key,
          label,
          value: await read(),
        })),
      );
      if (!page.active) return;
      readFailures = [];
      responses.forEach((response, i) => {
        const [key, label, , fallback] = reads[i];
        if (response.status === 'fulfilled')
          readCache[key] = {value: response.value.value, at: Date.now()};
        else
          readFailures.push({
            key,
            label,
            error: response.reason,
            last: readCache[key]?.at,
          });
        if (!readCache[key]) readCache[key] = {value: fallback, at: 0};
      });
      const {jobs, pricing, reportList, topicList, policy, quality, pipeline} =
        Object.fromEntries(
          Object.entries(readCache).map(([k, v]) => [k, v.value]),
        );
      const signature = JSON.stringify([
        jobs.map((t) => [t.taskId, t.version]),
        topicList.jobs.map((t) => [t.id, t.version]),
        reportList.reports.map((t) => [t.reportId, t.version]),
      ]);
      const reload =
        !data ||
        Date.now() - inventoryAt > 60000 ||
        signature !== taskSignature;
      let summary = data?.summary;
      if (reload)
        try {
          summary = await request('entry-documents/summary');
        } catch (error) {
          if (error.name === 'AbortError') return;
          readFailures.push({
            key: 'summary',
            label: '内容统计',
            error,
            last: inventoryAt,
          });
        }
      summary ||= {recentDocuments: [], pendingCount: 0};
      if (!page.active) return;
      const snapshots = summary.recentDocuments;
      if (reload && !readFailures.some((r) => r.key === 'summary'))
        inventoryAt = Date.now();
      taskSignature = signature;
      const topicJobs = topicList.jobs.map((t) => ({
        ...t,
        taskId: 'topic:' + t.id,
        kind: 'topic',
        title: t.entries.map((e) => e.title).join('、') || '主题归组',
        state: {
          status: t.status,
          phase: 'relations',
          errorCode: t.errorCode,
          steps: [],
        },
      }));
      const reportJobs = reportList.reports.map((t) => ({
        ...t,
        taskId: 'report:' + t.reportId,
        kind: 'report',
        state: {status: t.status, phase: 'report', steps: []},
      }));
      data = {
        snapshots: snapshots.filter((s) => !s.isPrivate),
        summary,
        tasks: [...jobs, ...topicJobs, ...reportJobs],
        price: pricing,
        reports: reportList.reports,
        topics: topicList,
        ingestion: policy,
        quality,
        pipeline,
      };
      const metrics = {
        documents: summary.documents,
        entries: summary.entries,
        tags: summary.tags,
        relations: new Set(
          (topicList.topics || []).flatMap((t) =>
            t.value.relations
              .filter((r) => !r.blocked)
              .map((r) =>
                JSON.stringify([r.from.entryId, r.to.entryId, r.kind]),
              ),
          ),
        ).size,
        reports: data.reports.filter((r) =>
          ['ready', 'reviewed'].includes(r.status),
        ).length,
      };
      for (const [key, value] of Object.entries(metrics)) {
        if (
          value === undefined ||
          ((key === 'relations' || key === 'reports') &&
            readCache[key === 'relations' ? 'topicList' : 'reportList'].at ===
              0)
        )
          continue;
        const delta = value - (observed?.[key] ?? value);
        if (observed && delta > 0) {
          pending.push({
            key,
            value,
            amount: delta,
            stage:
              key === 'documents'
                ? 0
                : key === 'entries'
                  ? 2
                  : key === 'tags'
                    ? 3
                    : key === 'relations'
                      ? 4
                      : 5,
          });
        } else if (
          !pending.some((c) => c.key === key) &&
          animation?.key !== key
        )
          counts[key] = value;
      }
      observed = metrics;
      render();
      for (const issue of readFailures) {
        const item = document.createElement('div');
        item.className = 'notice-item';
        item.dataset.tone = 'bad';
        item.innerHTML =
          icon('alert') +
          '<div><p>' +
          e(issue.label) +
          '读取失败</p><small>' +
          e(
            issue.last
              ? '显示 ' + new Date(issue.last).toLocaleTimeString() + ' 的结果'
              : failure(issue.error),
          ) +
          '</small></div><button data-retry>重新读取</button>';
        $('#message-list').prepend(item);
      }
      if (
        readFailures.some((r) => ['jobs', 'pricing', 'policy'].includes(r.key))
      ) {
        $('#ai-state').textContent = '状态读取失败';
        $('#ai-control').disabled = true;
        $('#flow-status').textContent = '部分状态未更新';
      }
      $('#message-count').textContent =
        notices().length + readFailures.length + ' 条';
      $('#statistics-note').textContent = readFailures.some(
        (r) => r.key === 'summary',
      )
        ? '统计未更新'
        : '当前工作区';
      nextAnimation();
    } catch (error) {
      $('#flow-status').textContent = '状态读取失败';
      if (error.name === 'AbortError') return;
      $('#message-list').innerHTML =
        `<div class="list-empty">${e(failure(error))}<button class="secondary-action" data-retry>重新读取</button></div>`;
      $('#ai-control').disabled = true;
    } finally {
      polling = false;
    }
  }
  function openTask(id) {
    const t = data.tasks.find((t) => t.taskId === id);
    if (!t) return;
    const done = terminal(t),
      running = taskState(t) === 'running';
    const action = t.kind ? 'resume' : running ? 'pause' : 'resume';
    const controls = done
      ? ''
      : `${t.kind && running ? '' : `<button class="secondary-action" data-task-action="${action}">${action === 'pause' ? '暂停' : '从断点继续'}</button>`}<button class="danger-text" data-task-action="cancel">取消任务</button>`;
    $('#dialog-eyebrow').textContent = '任务详情';
    dialog(
      taskTitle(t),
      `<div class="dialog-meta"><span class="pill ai">${e(labels[taskState(t)] || taskState(t))}</span></div><ol class="task-timeline">${(t.state?.steps || []).map((s) => `<li class="${s.complete ? 'done' : ''}">${e({intake: '审核', split: '拆分', tags: '标注', relation: '联系', relations: '联系', recall: '候选检索', publish: '发布'}[s.kind] || s.kind)}</li>`).join('')}</ol><p>${e(t.state?.errorCode || '')}</p><div class="dialog-actions">${controls}${t.request?.snapshotId ? `<a class="primary-action" href="#/reading?doc=${t.request.snapshotId}">阅读文档</a>` : t.kind === 'report' ? '<a class="primary-action" href="#/database">查看报告</a>' : ''}</div>`,
      (d) => {
        $$('[data-task-action]', d).forEach(
          (b) =>
            (b.onclick = () =>
              attempt(async () => {
                b.disabled = true;
                const action = b.dataset.taskAction;
                if (t.kind === 'topic')
                  await ingestion('topic_job_control', {
                    jobId: t.id,
                    expectedVersion: t.version,
                    action,
                  });
                else if (t.kind === 'report')
                  await reports(
                    action === 'cancel' ? 'report_cancel' : 'report_generate',
                    {reportId: t.reportId, expectedVersion: t.version},
                  );
                else
                  await tasks('task_control', {
                    taskId: t.taskId,
                    expectedVersion: t.version,
                    action,
                  });
                closeDialog();
                await refresh();
              }, toast).finally(() => (b.disabled = false))),
        );
      },
    );
  }
  function showMessage(id) {
    if (id === 'intake') location.assign('#/sources');
    else if (id.startsWith('source:'))
      location.assign('#/sources?source=' + encodeURIComponent(id.slice(7)));
    else if (id.startsWith('notice:')) {
      const n = data.pipeline.notices.find((n) => n.id === id.slice(7));
      if (n)
        dialog(
          n.value.title || '内容更新',
          `<p>${e(n.value.markdown || n.value.title)}</p><a class="secondary-action" href="#/database">打开数据库</a><button class="secondary-action" id="notice-read">标为已读</button>`,
          (d) =>
            ($('#notice-read', d).onclick = () =>
              attempt(async () => {
                await research('notice_read', {
                  id: n.id,
                  expectedVersion: n.version,
                });
                closeDialog();
                await refresh();
              }, toast)),
        );
    } else openTask(id);
  }
  $('#task-list').onclick = (ev) => {
    const b = ev.target.closest('[data-task]');
    if (b) openTask(b.dataset.task);
  };
  $('#message-list').onclick = (ev) => {
    if (ev.target.closest('[data-retry]')) {
      void refresh();
      return;
    }
    const b = ev.target.closest('[data-message]');
    if (b) showMessage(b.dataset.message);
  };
  $('#current-task').onclick = () => {
    const t =
      activeTasks().find((t) => taskState(t) === 'running') || activeTasks()[0];
    if (t) openTask(t.taskId);
  };
  $('#queue-all').onclick = () =>
    dialog(
      '全部任务',
      data
        ? data.tasks.map(taskRow).join('') || '<p>暂无任务</p>'
        : '<p>尚未连接服务</p>',
      (d) =>
        (d.onclick = (ev) => {
          const b = ev.target.closest('[data-task]');
          if (b) openTask(b.dataset.task);
        }),
    );
  $('#messages-all').onclick = () =>
    dialog(
      '消息',
      notices()
        .map(
          (n) =>
            `<button class="dialog-article" data-message="${n.id}"><span><strong>${e(n.title)}</strong><small>${e(n.body)}</small></span>${icon('chevron')}</button>`,
        )
        .join('') || '<p>暂无新消息</p>',
      (d) =>
        (d.onclick = (ev) => {
          const b = ev.target.closest('[data-message]');
          if (b) showMessage(b.dataset.message);
        }),
    );
  $('#pipeline').onclick = (ev) => {
    const b = ev.target.closest('[data-step]');
    if (!b) return;
    const n = Number(b.dataset.step),
      t = activeTasks().find((t) => phase(t) === n);
    if (t) openTask(t.taskId);
    else
      location.href =
        n === 0 ? '#/sources' : n === 5 ? '#/database' : '#/reading';
  };
  $('#hero-stats').onclick = (ev) => {
    const b = ev.target.closest('[data-stat]');
    if (b)
      location.href =
        b.dataset.stat === 'documents' ? '#/reading' : '#/database';
  };
  $('#ai-control').disabled = true;
  $('#ai-control').onclick = () =>
    attempt(async () => {
      await price('ai_operations_save', {
        revision: data.price.policy.revision,
        operationsAllowed: data.price.policy.operationsAllowed === false,
      });
      await refresh();
    }, toast);
  paintIcons(page.root);
  page.poll(refresh, () => (state.running ? 5000 : 30000));
}
