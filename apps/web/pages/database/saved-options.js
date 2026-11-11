import {request, ingestion, attempt} from './api.js';
import {
  $,
  all,
  escapeHtml as e,
  openDialog,
  closeDialog,
  toast,
  field,
} from './sample-ui.js';

export async function initSavedQueries({read, apply}) {
  let records = [],
    revision = 0,
    editing;
  const list = $('#saved-list'),
    saveButton = $('#save-query');
  const cancel = document.createElement('button');
  cancel.type = 'button';
  cancel.className = 'quiet-button';
  cancel.textContent = '取消修改';
  cancel.hidden = true;
  saveButton.after(cancel);
  const stopEditing = () => {
    editing = undefined;
    saveButton.textContent = '保存为聚合';
    cancel.hidden = true;
  };
  cancel.onclick = stopEditing;
  const save = async (body) => {
    const r = await request('entries/saved-queries', {
      expectedRevision: revision,
      ...body,
    });
    records = r.savedQueries.views;
    revision = r.savedQueries.revision;
    stopEditing();
    render();
  };
  function conditions(query) {
    const labels = [];
    const label = (name, selected) =>
      [...($('#scope-form').elements.namedItem(name)?.options || [])].find(
        (o) => o.value === selected,
      )?.textContent || selected;
    if (query.text) labels.push('关键词：' + query.text);
    for (const [key, title] of [
      ['typeKeyword', '类型'],
      ['domainKeyword', '领域'],
      ['sourceKey', '来源'],
      ['contentKeyword', '标签'],
    ])
      if (query[key]) labels.push(title + '：' + label(key, query[key]));
    if (query.annotationFilter?.dimensionId)
      labels.push(
        '维度：' + label('dimensionId', query.annotationFilter.dimensionId),
      );
    if (query.annotationFilter?.termIds?.length)
      labels.push(
        '词条：' +
          query.annotationFilter.termIds
            .map((id) => label('termId', id))
            .join('、'),
      );
    if (query.annotationFilter?.readingState)
      labels.push(
        '状态：' + label('readingState', query.annotationFilter.readingState),
      );
    if (query.time)
      labels.push(
        (query.time.field === 'published' ? '发布' : '接收') +
          '日期：' +
          (query.time.from || '不限') +
          ' 至 ' +
          (query.time.to || '不限'),
      );
    labels.push(
      query.onlyPrivate
        ? '仅隐私条目'
        : query.includePrivate
          ? '包含隐私条目'
          : '公开条目',
    );
    return labels.join('；');
  }
  function render() {
    list.innerHTML = records.length
      ? records
          .map(
            (r, i) =>
              `<div class="saved-row"><button type="button" class="saved-open" data-open="${i}" title="${e(r.name)}">${e(r.name)}</button><small class="saved-count">${r.aggregation ? r.aggregation.entryIds.length + ' 条' : '待更新'}</small><button type="button" class="icon-action saved-more" data-edit="${i}" aria-label="管理 ${e(r.name)}">⋯</button></div>`,
          )
          .join('')
      : '<p class="field-note">暂无聚合</p>';
    all('[data-open]', list).forEach(
      (button) =>
        (button.onclick = () => {
          const record = records[Number(button.dataset.open)];
          void apply(
            structuredClone(record.query),
            record.aggregation ? {viewId: record.viewId} : undefined,
          );
          if (!record.aggregation)
            toast('已打开原有查询。更新后将保存条目引用。');
        }),
    );
    all('[data-edit]', list).forEach(
      (button) =>
        (button.onclick = () => edit(records[Number(button.dataset.edit)])),
    );
  }
  function form(record, query) {
    const topicId = record?.aggregation?.topicIds[0] || '';
    const date = record?.aggregation?.updatedAt;
    openDialog(
      record ? '管理聚合' : '新建聚合',
      '<form id="aggregation-form" class="dialog-form">' +
        '<div class="form-grid">' +
        field(
          '名称',
          `<input name="name" maxlength="80" required autocomplete="off" value="${e(record?.name || '')}">`,
        ) +
        field(
          '主题',
          '<select name="topicId" disabled><option value="">不限主题</option></select>',
        ) +
        '</div>' +
        `<p class="form-status">${e(conditions(query))}</p>` +
        '<p class="field-note">实验版。保存条件和条目引用，点击更新后重新匹配。</p>' +
        (date
          ? `<p class="field-note">上次更新：${e(new Date(date).toLocaleString())} · ${record.aggregation.entryIds.length} 条引用</p>`
          : '') +
        '<div class="action-list">' +
        (record
          ? '<button class="secondary-action compact-action" type="button" id="edit-conditions">调整筛选条件</button><button class="quiet-button" type="button" id="delete-aggregation">删除聚合</button>'
          : '') +
        '</div><footer class="form-footer"><button class="primary-action compact-action" type="submit">' +
        (record ? '保存并更新引用' : '保存聚合') +
        '</button></footer></form>',
      (root) => {
        const formEl = $('#aggregation-form', root),
          name = formEl.elements.namedItem('name'),
          topics = formEl.elements.namedItem('topicId');
        if (topicId) topics.add(new Option('已保存主题', topicId));
        topics.value = topicId;
        name.oninput = () => name.setCustomValidity('');
        void attempt(async () => {
          const response = await ingestion('topics_list');
          if (!root.contains(topics)) return;
          topics.replaceChildren(
            new Option('不限主题', ''),
            ...response.topics.map((t) => new Option(t.value.name, t.id)),
          );
          if (topicId && ![...topics.options].some((o) => o.value === topicId))
            topics.add(new Option('原主题已不可用', topicId));
          topics.value = topicId;
          topics.disabled = false;
        }, toast);
        formEl.onsubmit = async (event) => {
          event.preventDefault();
          name.setCustomValidity(
            records.some(
              (r) =>
                r.viewId !== record?.viewId && r.name === name.value.trim(),
            )
              ? '这个名称已存在。'
              : '',
          );
          if (!formEl.reportValidity()) return;
          if ((query.retrievalMode || 'lexical') !== 'lexical') {
            toast('聚合使用文字筛选，请先将搜索方式改为文字搜索。');
            return;
          }
          if (query.includePrivate && !read()?.includePrivate) {
            toast('此聚合包含隐私条目，请先选择对应的查看范围再更新。');
            return;
          }
          const submit = formEl.querySelector('[type=submit]');
          submit.disabled = true;
          await attempt(async () => {
            await save({
              operation: 'aggregate',
              viewId: record?.viewId || crypto.randomUUID(),
              name: name.value.trim(),
              query,
              topicIds: topics.value ? [topics.value] : [],
            });
            closeDialog();
            toast('聚合已保存');
          }, toast);
          submit.disabled = false;
        };
        if (record) {
          $('#edit-conditions', root).onclick = () => {
            closeDialog();
            editing = record;
            apply(structuredClone(record.query), undefined, false);
            saveButton.textContent = '保存聚合修改';
            cancel.hidden = false;
            toast('调整左侧筛选条件后，点击保存聚合修改。');
          };
          $('#delete-aggregation', root).onclick = () =>
            attempt(async () => {
              await save({operation: 'delete', viewId: record.viewId});
              closeDialog();
              toast('聚合已删除，原文保留。');
            }, toast);
        }
      },
    );
  }
  function edit(record) {
    form(record, structuredClone(record.query));
  }
  saveButton.onclick = () => {
    const query = read();
    if (!query) return;
    if (!editing && records.length >= 20) {
      toast('最多保存 20 个聚合。');
      return;
    }
    form(editing, query);
  };
  await attempt(async () => {
    const r = await request('entries/saved-queries');
    records = r.savedQueries.views;
    revision = r.savedQueries.revision;
  }, toast);
  render();
}
