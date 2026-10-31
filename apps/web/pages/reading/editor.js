import {pageContext} from '../../runtime/route.js';
const page = pageContext('reading');
import {escape as esc, icon} from '../../data.js';
import {bindDialog} from '../../shared/dialog.js';
import {
  articles,
  original,
  config,
  annotations,
  docLinks,
  saveDraft,
  loadDocument,
} from './documents.js';
const $ = (q, root = page.root) => root.querySelector(q);
let touched = false,
  fieldChanged = false;
let context = null,
  working = {},
  kind = 'structure',
  scope = 'document',
  pendingRelations = [];
const labels = {structure: '分段', tags: '标签', relations: '联系'};
const editorDialog = bindDialog($('#document-editor'), {
  closeButtons: [
    ...page.root.querySelectorAll('[data-close="document-editor"]'),
  ],
  initialFocus: () => $('#tab-' + kind),
  closeOnBackdrop: true,
  beforeClose: () => {
    if (touched && !confirm('放弃编辑窗口内尚未保存的修改？')) return false;
    touched = false;
  },
});
const split = (value) =>
  [
    ...new Set(
      value
        .split(/[，,\n、]/)
        .map((x) => x.trim())
        .filter(Boolean),
    ),
  ].slice(0, 24);

function capture() {
  if (!context || !fieldChanged) return;
  fieldChanged = false;
  if (kind === 'structure')
    working.starts = [
      0,
      ...[...page.root.querySelectorAll('[name="split-start"]:checked')].map(
        (n) => Number(n.value),
      ),
    ];
  if (kind === 'tags') {
    if (scope === 'document')
      working.tags = split($('#document-tags-input').value);
    else {
      working.sectionTags = {
        ...working.sectionTags,
        [scope]: {
          domain: $('#tag-domain').value.trim(),
          subject: $('#tag-subject').value.trim(),
          purpose: $('#tag-purpose').value.trim(),
        },
      };
    }
  }
}
function setTabs() {
  for (const button of $('#editor-tabs').querySelectorAll('[role=tab]')) {
    const active = button.dataset.edit === kind;
    button.setAttribute('aria-selected', String(active));
    button.tabIndex = active ? 0 : -1;
  }
  $('#editor-fields').setAttribute('aria-labelledby', 'tab-' + kind);
}
function structureFields() {
  const d = original(context.id),
    starts = new Set(working.starts || d.starts || [0]);
  return (
    '<p class="editor-intro">勾选新段的起点。取消勾选后，与前一段合并，原文保留。</p><div class="boundary-list">' +
    d.paragraphs
      .map(
        (p, i) =>
          '<label class="boundary-row"><input name="split-start" type="checkbox" value="' +
          i +
          '" ' +
          (starts.has(i) || !i ? 'checked' : '') +
          ' ' +
          (!i ? 'disabled' : '') +
          '><span><strong>' +
          esc(p[0]) +
          '</strong><small>' +
          esc(p[1]) +
          '</small></span><span class="boundary-caption">' +
          (!i ? '文档开头' : '从这里分段') +
          '</span></label>',
      )
      .join('') +
    '</div>'
  );
}
function tagsFields() {
  const d = original(context.id);
  const select =
    '<label class="editor-field scope-field">标注范围<select id="tag-scope"><option value="document">整篇文档</option>' +
    d.paragraphs
      .map(
        (p, i) =>
          '<option value="' +
          i +
          '">' +
          (i + 1) +
          '. ' +
          esc(p[0]) +
          '</option>',
      )
      .join('') +
    '</select></label>';
  if (scope === 'document')
    return (
      select +
      '<label class="editor-field">文档标签<textarea id="document-tags-input" rows="3" maxlength="600" placeholder="用逗号分隔">' +
      esc((working.tags || d.tags).join('，')) +
      '</textarea></label><p class="field-hint">用逗号或换行分隔。重复标签会合并。</p>'
    );
  const a = {
    ...annotations[d.id]?.[Number(scope)],
    ...working.sectionTags?.[scope],
  };
  return (
    select +
    '<div class="structured-fields">' +
    [
      ['domain', '领域', '半导体'],
      ['subject', '主题', 'HBM、先进封装'],
      ['purpose', '用途', '理解系统取舍'],
    ]
      .map(
        ([key, label, placeholder]) =>
          '<label class="editor-field">' +
          label +
          '<input id="tag-' +
          key +
          '" value="' +
          esc(a[key] || '') +
          '" maxlength="160" placeholder="' +
          placeholder +
          '"></label>',
      )
      .join('') +
    '</div>'
  );
}
function relationRows() {
  return (
    pendingRelations
      .map((e, i) => {
        const target = e.a === context.id ? e.b : e.a;
        return (
          '<div class="editable-relation"><div><strong>' +
          esc(original(target)?.title || e.targetTitle || '相关文档') +
          '</strong><p>' +
          esc(e.reason) +
          '</p></div><button type="button" class="icon-action" data-remove-relation="' +
          i +
          '" aria-label="删除与' +
          esc(original(target)?.title || e.targetTitle || '相关文档') +
          '的联系">' +
          icon('close') +
          '</button></div>'
        );
      })
      .join('') || '<p class="quiet-empty">尚未添加联系。</p>'
  );
}
function paragraphOptions(id) {
  return original(id)
    .paragraphs.map(
      (p, i) =>
        '<option value="' + i + '">' + (i + 1) + '. ' + esc(p[0]) + '</option>',
    )
    .join('');
}
function relationsFields() {
  const target = articles.find((d) => d.id !== context.id);
  if (!target) return '<p class="quiet-empty">至少需要两篇文档</p>';
  return (
    '<div class="existing-relations">' +
    relationRows() +
    '</div><section class="new-relation"><h3>添加联系</h3><label class="editor-field">相关文档<select id="relation-target">' +
    articles
      .filter((d) => d.id !== context.id)
      .map((d) => '<option value="' + d.id + '">' + esc(d.title) + '</option>')
      .join('') +
    '</select></label><div class="evidence-fields"><label class="editor-field">本篇依据<select id="relation-own">' +
    paragraphOptions(context.id) +
    '</select></label><label class="editor-field">对方依据<select id="relation-evidence">' +
    paragraphOptions(target.id) +
    '</select></label></div><label class="editor-field">联系类型<select id="relation-kind"><option value="continues">延续</option><option value="supports">支持</option><option value="contradicts">矛盾</option><option value="replaces">替代</option></select></label><label class="editor-field">联系说明<textarea id="relation-reason" rows="2" maxlength="400" placeholder="两段原文在哪一点上有关联"></textarea></label><div class="relation-add-row"><span id="relation-error" role="status"></span><button type="button" class="secondary-action" id="add-relation">' +
    icon('plus') +
    ' 添加联系</button></div></section>'
  );
}
function paint() {
  fieldChanged = false;
  setTabs();
  $('#editor-fields').innerHTML =
    kind === 'structure'
      ? structureFields()
      : kind === 'tags'
        ? tagsFields()
        : relationsFields();
  if (kind === 'tags') {
    $('#tag-scope').value = scope;
    $('#tag-scope').onchange = (e) => {
      capture();
      scope = e.target.value;
      paint();
      $('#tag-scope').focus();
    };
  }
  if (kind === 'relations' && $('#relation-target')) {
    $('#relation-own').value = String(context.section);
    const initialTarget = $('#relation-target').value;
    if (initialTarget)
      void loadDocument(initialTarget)
        .then(() => {
          if ($('#relation-target')?.value === initialTarget)
            $('#relation-evidence').innerHTML = paragraphOptions(initialTarget);
        })
        .catch((error) => {
          $('#relation-error').textContent = error.message;
        });
    $('#relation-target').onchange = async (e) => {
      await loadDocument(e.target.value);
      $('#relation-evidence').innerHTML = paragraphOptions(e.target.value);
    };
    $('#add-relation').onclick = () => {
      const target = $('#relation-target').value,
        ai = Number($('#relation-own').value),
        bi = Number($('#relation-evidence').value),
        reason = $('#relation-reason').value.trim();
      if (!reason) {
        $('#relation-error').textContent = '请填写联系说明。';
        $('#relation-reason').focus();
        return;
      }
      if (
        pendingRelations.some(
          (e) =>
            (e.a === context.id && e.b === target) ||
            (e.b === context.id && e.a === target),
        )
      ) {
        $('#relation-error').textContent = '已添加与这篇文档的联系。';
        return;
      }
      touched = true;
      pendingRelations.push({
        a: context.id,
        ai,
        b: target,
        bi,
        label: reason,
        reason,
        kind: $('#relation-kind').value,
      });
      working.relations = structuredClone(pendingRelations);
      paint();
      $('#relation-target').focus();
    };
    for (const b of page.root.querySelectorAll('[data-remove-relation]'))
      b.onclick = () => {
        touched = true;
        pendingRelations.splice(Number(b.dataset.removeRelation), 1);
        working.relations = structuredClone(pendingRelations);
        paint();
      };
  }
}
export async function openEditor(next) {
  context = next;
  kind = next.kind || 'structure';
  scope = 'document';
  working = structuredClone(config(context.id));
  pendingRelations = docLinks(context.id).map((edge) => ({...edge}));
  $('#editor-document-name').textContent = original(context.id).title;
  touched = false;
  paint();
  editorDialog.open();
}
$('#editor-tabs').onclick = (e) => {
  const b = e.target.closest('[data-edit]');
  if (!b || b.dataset.edit === kind) return;
  capture();
  kind = b.dataset.edit;
  paint();
};
$('#editor-tabs').onkeydown = (e) => {
  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
  e.preventDefault();
  const keys = Object.keys(labels),
    i = keys.indexOf(kind),
    next =
      e.key === 'Home'
        ? 0
        : e.key === 'End'
          ? keys.length - 1
          : (i + (e.key === 'ArrowLeft' ? -1 : 1) + keys.length) % keys.length;
  capture();
  kind = keys[next];
  paint();
  $('#tab-' + kind).focus();
};
export const editorDirty = () =>
  Boolean($('#document-editor')?.open && touched);
export const closeEditor = editorDialog.close;
$('#editor-form').addEventListener('input', () => {
  touched = true;
  fieldChanged = true;
});
$('#editor-form').addEventListener('change', () => {
  touched = true;
  fieldChanged = true;
});
$('#editor-form').onsubmit = async (e) => {
  e.preventDefault();
  capture();
  try {
    await saveDraft(context.id, working);
    touched = false;
    editorDialog.close();
    context.onSave();
  } catch (error) {
    let p = $('#editor-error');
    if (!p) {
      p = document.createElement('p');
      p.id = 'editor-error';
      p.setAttribute('role', 'alert');
      $('#editor-fields').prepend(p);
    }
    p.textContent = error.message;
  }
};
