import {request, attempt} from './api.js';

import {
  $,
  all,
  escapeHtml,
  openDialog,
  closeDialog,
  toast,
  field,
} from './sample-ui.js';
export async function initSavedQueries({read, apply}) {
  let records = [],
    revision = 0;
  const load = async () => {
    const r = await request('entries/saved-queries');
    records = r.savedQueries.views;
    revision = r.savedQueries.revision;
  };
  const save = async (body) => {
    const r = await request('entries/saved-queries', {
      expectedRevision: revision,
      ...body,
    });
    records = r.savedQueries.views;
    revision = r.savedQueries.revision;
    render();
  };
  const list = $('#saved-list');
  const render = () => {
    list.innerHTML = records.length
      ? records
          .map(
            (r, i) =>
              '<div class="saved-row"><button type="button" class="saved-open" data-open="' +
              i +
              '">' +
              escapeHtml(r.name) +
              '</button><button type="button" class="quiet-button saved-more" data-edit="' +
              i +
              '" aria-label="管理 ' +
              escapeHtml(r.name) +
              '">···</button></div>',
          )
          .join('')
      : '<p class="field-note">暂无保存的查询</p>';
    all('[data-open]', list).forEach((button) =>
      button.addEventListener('click', () => {
        apply(structuredClone(records[Number(button.dataset.open)].query));
        toast('已打开查询，隐私范围需重新选择。');
      }),
    );
    all('[data-edit]', list).forEach((button) =>
      button.addEventListener('click', () => edit(Number(button.dataset.edit))),
    );
  };
  const validName = (input, except = -1) => {
    const value = input.value.trim();
    input.setCustomValidity(
      !value
        ? '请输入名称。'
        : records.some((r, i) => i !== except && r.name === value)
          ? '这个名称已存在。'
          : '',
    );
    return input.reportValidity();
  };
  $('#save-query').addEventListener('click', () => {
    const query = read();
    if (!query) return;
    if (records.length >= 20) {
      toast('最多保存 20 个查询。');
      return;
    }
    openDialog(
      '保存查询',
      '<form id="save-query-form" class="dialog-form">' +
        field(
          '查询名称',
          '<input name="name" maxlength="80" required autocomplete="off">',
        ) +
        '<p class="field-note">查询条件保存在工作区。</p><footer class="form-footer"><button class="primary-action compact-action" type="submit">保存</button></footer></form>',
      (root) => {
        const form = $('#save-query-form', root),
          input = form.elements.namedItem('name');
        input.addEventListener('input', () => input.setCustomValidity(''));
        form.addEventListener('submit', async (e) => {
          e.preventDefault();
          if (!validName(input)) return;
          await attempt(async () => {
            await save({
              operation: 'save',
              viewId: crypto.randomUUID(),
              name: input.value.trim(),
              query,
            });
            closeDialog();
            toast('查询已保存');
          }, toast);
        });
      },
    );
  });
  function edit(index) {
    const record = records[index];
    openDialog(
      '管理查询',
      '<form id="edit-query-form" class="dialog-form">' +
        field(
          '查询名称',
          '<input name="name" maxlength="80" required value="' +
            escapeHtml(record.name) +
            '">',
        ) +
        '<div class="action-list"><button class="secondary-action compact-action" id="replace-query" type="button">更新为当前条件</button><button class="quiet-button" id="delete-query" type="button">删除查询</button></div><footer class="form-footer"><button class="primary-action compact-action" type="submit">保存名称</button></footer></form>',
      (root) => {
        const form = $('#edit-query-form', root),
          input = form.elements.namedItem('name');
        input.addEventListener('input', () => input.setCustomValidity(''));
        form.addEventListener('submit', async (e) => {
          e.preventDefault();
          if (!validName(input, index)) return;
          await attempt(async () => {
            await save({
              operation: 'rename',
              viewId: record.viewId,
              name: input.value.trim(),
            });
            closeDialog();
            toast('名称已更新');
          }, toast);
        });
        $('#replace-query').addEventListener('click', () => {
          const next = read();
          if (!next) return;
          void attempt(async () => {
            await save({
              operation: 'save',
              viewId: record.viewId,
              name: record.name,
              query: next,
            });
            closeDialog();
            toast('查询条件已更新');
          }, toast);
        });
        $('#delete-query').addEventListener('click', () => {
          void attempt(async () => {
            await save({operation: 'delete', viewId: record.viewId});
            closeDialog();
            toast('查询已删除');
          }, toast);
        });
      },
    );
  }
  await attempt(load, toast);
  render();
}
