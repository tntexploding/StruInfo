import {pageContext} from '../../runtime/route.js';
import {
  $,
  all,
  openDialog,
  closeDialog,
  toast,
  field,
  escapeHtml as e,
} from './sample-ui.js';
import {reportForm, scheduleForm} from './report-forms.js';
import {reports, research, ingestion, attempt, lines} from './api.js';
import {showReportReader} from '../../shared/report-reader.js';
import {selection} from './results.js';
const localDate = () => new Intl.DateTimeFormat('en-CA').format(new Date());
const zone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;
let reportDraft = {
  kind: 'daily',
  composition: 'ai',
  selection: 'conditions',
  maxItems: '6',
  date: localDate(),
  timeField: 'received',
  topics: '',
  sources: '',
  timeZone: zone(),
};
let summaries = [];
function restore(form, draft) {
  for (const [name, value] of Object.entries(draft)) {
    const el = form.elements.namedItem(name);
    if (el) {
      if (el.type === 'checkbox') el.checked = value;
      else el.value = value;
    }
  }
}
function read(form) {
  const value = Object.fromEntries(new FormData(form));
  for (const input of all('input[type=checkbox]', form))
    value[input.name] = input.checked;
  return value;
}
function valid(form) {
  const el = form.elements.namedItem('timeZone');
  try {
    new Intl.DateTimeFormat('en', {timeZone: el.value}).format();
    el.setCustomValidity('');
  } catch {
    el.setCustomValidity('请输入有效时区');
  }
  return form.reportValidity();
}
function reportRequest(v) {
  return {
    kind: v.kind || v.cadence,
    composition: v.composition,
    date: v.date || localDate(),
    timeZone: v.timeZone,
    timeField: v.timeField,
    topics: lines(v.topics),
    sources: lines(v.sources),
    maxItems: Number(v.maxItems),
    maxModelCalls: 12,
    ...(v.selection === 'selected'
      ? {selectedEntryIds: [...selection.keys()]}
      : {}),
    ...(v.topicIds ? {topicIds: [v.topicIds]} : {}),
    ...(v.termId || v.dimensionId
      ? {
          annotationFilter: {
            ...(v.dimensionId ? {dimensionId: v.dimensionId} : {}),
            ...(v.termId ? {termIds: [v.termId]} : {}),
          },
        }
      : {}),
  };
}
async function fillVocabulary(form) {
  const [words, topics] = await Promise.all([
    ingestion('annotation_vocabulary'),
    ingestion('topics_list'),
  ]);
  const dimensions = form.elements.namedItem('dimensionId'),
    terms = form.elements.namedItem('termId'),
    topic = form.elements.namedItem('topicIds');
  dimensions.disabled = false;
  dimensions.innerHTML =
    '<option value="">不限维度</option>' +
    words.vocabulary.dimensions
      .filter((d) => d.enabled)
      .map((d) => `<option value="${d.id}">${e(d.name)}</option>`)
      .join('');
  const update = () => {
    terms.disabled = false;
    terms.innerHTML =
      '<option value="">不限词条</option>' +
      words.vocabulary.terms
        .filter((t) => !dimensions.value || t.dimensionId === dimensions.value)
        .map((t) => `<option value="${t.id}">${e(t.label)}</option>`)
        .join('');
  };
  dimensions.onchange = update;
  update();
  topic.disabled = false;
  topic.innerHTML =
    '<option value="">不限主题</option>' +
    topics.topics
      .map((t) => `<option value="${t.id}">${e(t.value.name)}</option>`)
      .join('');
}
async function refresh() {
  summaries = (await reports('reports_list', {prioritizeActive: true})).reports;
  $('.report-history').innerHTML =
    '<h3>已有报告</h3>' +
    (summaries
      .map(
        (r) =>
          `<button class="report-row" data-report="${r.reportId}"><strong>${e(r.title)}</strong><small>${e(r.period?.from || '')} · ${e({queued: '排队', generating: '生成中', ready: '已完成', reviewed: '已核对', failed: '失败', paused: '已暂停'}[r.status] || r.status)}</small></button>`,
      )
      .join('') || '<p class="field-note">暂无报告</p>');
}
async function showReport(id) {
  const result = await reports('report_read', {reportId: id});
  const {report} = result;
  const s = report.state;
  showReportReader(result, {
    actions: `<button class="secondary-action" data-report-action="edit">编辑</button><button class="secondary-action" data-report-action="generate" ${['ready', 'reviewed', 'generating'].includes(s.status) ? 'disabled' : ''}>继续生成</button><button class="secondary-action" data-report-action="cancel" ${['ready', 'reviewed', 'cancelled'].includes(s.status) ? 'disabled' : ''}>取消任务</button><button class="secondary-action" data-report-action="publish" ${!['ready', 'reviewed'].includes(s.status) ? 'disabled' : ''}>发布到站内</button>`,
    async onAction(action, close) {
      if (action === 'edit') {
        close();
        editReport(report);
        return;
      }
      if (action === 'publish')
        await research('report_publish', {
          reportId: id,
          expectedVersion: report.version,
        });
      else
        await reports('report_' + action, {
          reportId: id,
          expectedVersion: report.version,
        });
      await refresh();
      await showReport(id);
    },
  });
}
function editReport(report) {
  const items = report.state.items.map((i) => ({
    included: i.included,
    story: structuredClone(i.edited || i.draft),
  }));
  if (items.some((i) => !i.story)) {
    toast('生成完成后可以编辑');
    return;
  }
  openDialog(
    '编辑报告',
    `<form class="dialog-form" id="edit-report">${field('标题', `<input name="title" value="${e(report.state.title)}" maxlength="200" required>`)}${items.map((i, n) => `<fieldset><legend><label class="inline-checks"><input type="checkbox" name="included-${n}" ${i.included ? 'checked' : ''}>${e(i.story.title)}</label></legend>${i.story.points.map((p, j) => field('正文', `<textarea name="point-${n}-${j}" maxlength="600" required>${e(p.text)}</textarea>`)).join('')}</fieldset>`).join('')}<footer class="form-footer"><button class="primary-action compact-action">保存修改</button></footer></form>`,
    (root) =>
      ($('#edit-report', root).onsubmit = (ev) => {
        ev.preventDefault();
        void attempt(async () => {
          const form = ev.currentTarget;
          for (const [i, item] of items.entries()) {
            item.included = form.elements.namedItem('included-' + i).checked;
            item.story.points.forEach(
              (point, j) =>
                (point.text = form.elements.namedItem(`point-${i}-${j}`).value),
            );
          }
          await reports('report_edit', {
            reportId: report.reportId,
            expectedVersion: report.version,
            edit: {
              title: form.elements.namedItem('title').value,
              items,
              reviewed: true,
            },
          });
          closeDialog();
          await refresh();
        }, toast);
      }),
  );
}
function openNew() {
  openDialog('新建报告', reportForm(), (root) => {
    const form = $('#report-form', root);
    restore(form, reportDraft);
    const selected = form.querySelector(
      '[name=selection] option[value=selected]',
    );
    selected.disabled = !selection.size;
    selected.textContent = `勾选的资料 · ${selection.size} 条`;
    void attempt(() => fillVocabulary(form), toast);
    const update = () => {
      const kind = form.elements.namedItem('kind').value;
      $('#report-date-field').hidden = kind === 'topic';
      form.elements.namedItem('date').required = kind !== 'topic';
      $('#report-date-label').textContent = {
        daily: '报告日期',
        weekly: '选择一周中的日期',
        monthly: '选择月份中的日期',
        topic: '报告日期',
      }[kind];
      $('#report-period-note').textContent = {
        daily: '选取当天资料。',
        weekly: '选取所在周的资料。',
        monthly: '选取所在月份的资料。',
        topic: '专题覆盖全部时间。',
      }[kind];
      $('#report-generate').textContent =
        form.elements.namedItem('composition').value === 'ai'
          ? '加入 AI 生成队列'
          : '生成原文摘录';
      $('#report-generate').disabled = true;
      reportDraft = read(form);
    };
    form.oninput = update;
    form.onchange = update;
    update();
    form.onsubmit = (ev) => {
      ev.preventDefault();
      if (!valid(form)) return;
      void attempt(async () => {
        const r = await reports('report_preview', reportRequest(read(form)));
        $('#report-preview-status').hidden = false;
        $('#report-preview-status').textContent =
          `符合条件 ${r.sources.length} 条`;
        $('#report-generate').disabled = !r.sources.length;
      }, toast);
    };
    $('#report-generate').onclick = () =>
      attempt(async () => {
        const button = $('#report-generate');
        button.disabled = true;
        const r = await reports('report_create', {
          requestKey: crypto.randomUUID(),
          request: reportRequest(read(form)),
        });
        if (r.report.state.status !== 'ready')
          await reports('report_generate', {
            reportId: r.report.reportId,
            expectedVersion: r.report.version,
          });
        closeDialog();
        await refresh();
        toast('报告任务已创建');
      }, toast).finally(() => {
        const button = $('#report-generate');
        if (button) button.disabled = false;
      });
  });
}
async function openSchedules() {
  const pipeline = await research('report_pipeline_status');
  const schedules = pipeline.schedules;
  openDialog(
    '定时生成',
    `<div class="dialog-form"><div class="action-list"><button class="secondary-action compact-action" id="add-schedule">添加计划</button></div>${schedules.map((s) => `<button class="report-row" data-schedule="${s.id}"><strong>${e(s.value.schedule.name)}</strong><small>${e(s.value.schedule.localTime)} · ${s.value.schedule.enabled ? '已启用' : '已暂停'}</small></button>`).join('') || '<p>暂无计划</p>'}</div>`,
    (root) => {
      root.querySelector('#add-schedule').onclick = () => editSchedule();
      all('[data-schedule]', root).forEach(
        (b) =>
          (b.onclick = () =>
            editSchedule(schedules.find((s) => s.id === b.dataset.schedule))),
      );
    },
  );
}
function editSchedule(record) {
  const s = record?.value.schedule;
  const draft = s
    ? {
        ...s,
        ...s.request,
        topics: s.request.topics.join('，'),
        sources: s.request.sources.join('，'),
      }
    : {
        name: '',
        cadence: 'daily',
        localTime: '08:00',
        timeZone: zone(),
        missed: 'once',
        composition: 'ai',
        maxItems: '6',
        topics: '',
        sources: '',
        timeField: 'received',
        enabled: false,
        publish: false,
      };
  openDialog('定时生成', scheduleForm(), (root) => {
    const form = $('#schedule-form', root);
    restore(form, draft);
    void attempt(() => fillVocabulary(form), toast);
    form.onsubmit = (ev) => {
      ev.preventDefault();
      if (!valid(form)) return;
      void attempt(async () => {
        const v = read(form);
        await research('report_schedule_save', {
          id: record?.id || crypto.randomUUID(),
          expectedVersion: record?.version || 0,
          schedule: {
            name: v.name,
            enabled: v.enabled,
            timeZone: v.timeZone,
            localTime: v.localTime,
            cadence: v.cadence,
            missed: v.missed,
            publish: v.publish,
            request: reportRequest(v),
          },
        });
        closeDialog();
        toast('计划已保存');
      }, toast);
    };
  });
}
export function initReports() {
  $('#new-report').onclick = openNew;
  $('#open-schedule').onclick = () => attempt(openSchedules, toast);
  $('.report-history').onclick = (ev) => {
    if (ev.target.closest('[data-reload-reports]')) {
      void attempt(refresh, toast);
      return;
    }
    const b = ev.target.closest('[data-report]');
    if (b) void attempt(() => showReport(b.dataset.report), toast);
  };
  $('#report-actions').onclick = () =>
    openDialog(
      '管理报告',
      summaries
        .map(
          (r) =>
            `<button class="report-row" data-report="${r.reportId}"><strong>${e(r.title)}</strong><small>${e(r.status)}</small></button>`,
        )
        .join('') || '<p>暂无报告</p>',
      (root) =>
        (root.onclick = (ev) => {
          const b = ev.target.closest('[data-report]');
          if (b) void attempt(() => showReport(b.dataset.report), toast);
        }),
    );
  pageContext('database').onStart(() => {
    void attempt(refresh, (message) => {
      $('.report-history').innerHTML =
        '<p>' +
        e(message) +
        '</p><button class="quiet-button" data-reload-reports>重新读取</button>';
    });
  });
}
