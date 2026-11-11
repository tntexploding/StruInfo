import {pageContext} from '../../runtime/route.js';
const page = pageContext('reading');
import {escape as esc, icon} from '../../data.js';
import {bindDialog} from '../../shared/dialog.js';
import {
  articles,
  original,
  config,
  annotationDraft,
  entryAt,
  tagDimensions,
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
function capture() {
  if (!context || !fieldChanged) return true;
  try {
    if (kind === 'structure')
      working.starts = [
        0,
        ...[...page.root.querySelectorAll('[name="split-start"]:checked')].map(
          (n) => Number(n.value),
        ),
      ];
    if (kind === 'tags' && scope !== 'document') {
      const entry = entryAt(original(context.id), Number(scope));
      if (!entry) return;
      const a = annotationDraft(entry);
      a.labels = [...page.root.querySelectorAll('[data-tag-row]')].map(
        (row) => {
          const val = (name) =>
            row.querySelector('[name=' + name + ']').value.trim();
          const dimensionId = val('dimension'),
            label = val('label'),
            meaning = val('meaning'),
            quote = val('quote');
          const old = a.labels.find(
            (l) =>
              l.dimensionId === dimensionId &&
              l.term.label === label &&
              l.term.meaning === meaning,
          );
          const at = entry.value.body.indexOf(quote);
          if (!quote && old?.legacy) return old;
          if (!label || !quote || at < 0)
            throw new Error('请填写标签，并从本条原文中复制依据。');
          if (!old && entry.value.body.includes(quote, at + 1))
            throw new Error('依据重复出现，请复制更完整的原文片段。');
          const start = Array.from(entry.value.body.slice(0, at)).length;
          return {
            dimensionId,
            term: old?.term || {
              id: crypto.randomUUID(),
              dimensionId,
              label,
              meaning,
            },
            wording: label,
            primary: old?.primary ?? true,
            evidence:
              old?.evidence?.quote === quote
                ? old.evidence
                : {start, end: start + Array.from(quote).length, quote},
          };
        },
      );
      a.status = a.labels.some((l) => l.legacy)
        ? 'partial'
        : a.labels.length || a.claims.length
          ? 'complete'
          : 'none';
      working.sectionAnnotations = {...working.sectionAnnotations, [scope]: a};
    }
    fieldChanged = false;
    return true;
  } catch (error) {
    showEditorError(error);
    return false;
  }
}
function showEditorError(error) {
  let p = $('#editor-error');
  if (!p) {
    p = document.createElement('p');
    p.id = 'editor-error';
    p.setAttribute('role', 'alert');
    $('#editor-fields').prepend(p);
  }
  p.textContent = error.message;
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
  const starts = d.starts || [0];
  if (scope === 'document' || !starts.includes(Number(scope)))
    scope = String(starts[0]);
  const entry = entryAt(d, Number(scope));
  const select =
    '<label class="editor-field scope-field">条目<select id="tag-scope">' +
    starts
      .map(
        (i) =>
          '<option value="' +
          i +
          '">' +
          esc(
            entryAt(d, i)?.value.titlePath ||
              d.paragraphs[i][0] ||
              '条目 ' + (i + 1),
          ) +
          '</option>',
      )
      .join('') +
    '</select></label>';
  if (!entry)
    return select + '<p class="field-hint">请先确认分段，再编辑标签。</p>';
  const a = working.sectionAnnotations?.[scope] || annotationDraft(entry);
  return (
    select +
    '<p class="field-hint">文档标签由各条目汇总。新增或修改标签时，请提供本条原文依据。</p><div id="tag-rows">' +
    a.labels.map((l, i) => tagRow(l, i)).join('') +
    '</div><button type="button" class="secondary-action" id="add-tag">' +
    icon('plus') +
    ' 添加标签</button>'
  );
}
function tagRow(l, i) {
  return (
    '<section class="tag-editor-row" data-tag-row><div class="structured-fields"><label class="editor-field">类别<select name="dimension">' +
    tagDimensions()
      .map(
        (d) =>
          '<option value="' +
          d.id +
          '" ' +
          (d.id === l.dimensionId ? 'selected' : '') +
          '>' +
          esc(d.name) +
          '</option>',
      )
      .join('') +
    '</select></label><label class="editor-field">标签<input name="label" maxlength="120" required value="' +
    esc(l.term.label) +
    '"></label><label class="editor-field">含义（同名词需区分）<input name="meaning" maxlength="400" value="' +
    esc(l.term.meaning) +
    '"></label><label class="editor-field">原文依据<textarea name="quote" rows="2" maxlength="2000" required>' +
    esc(l.evidence?.quote || '') +
    '</textarea>' +
    (l.legacy
      ? '<small>旧标签迁移，未记录原文依据。修改时请补充。</small>'
      : '') +
    '</label></div><button type="button" class="text-button" data-remove-tag="' +
    i +
    '">删除标签</button></section>'
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
    const add = $('#add-tag');
    if (add)
      add.onclick = () => {
        const el = document.createElement('div');
        el.innerHTML = tagRow(
          {term: {label: '', meaning: ''}, evidence: {quote: ''}},
          0,
        );
        $('#tag-rows').append(el.firstChild);
        touched = fieldChanged = true;
        $('#tag-rows').lastElementChild.querySelector('[name=label]').focus();
      };
    $('#tag-rows')?.addEventListener('click', (e) => {
      const b = e.target.closest('[data-remove-tag]');
      if (b) {
        b.closest('[data-tag-row]').remove();
        touched = fieldChanged = true;
      }
    });
    $('#tag-scope').onchange = (e) => {
      if (!capture()) {
        e.target.value = scope;
        return;
      }
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
  if (!capture()) return;
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
  try {
    if (!capture()) return;
    await saveDraft(context.id, working);
    touched = false;
    editorDialog.close();
    context.onSave();
  } catch (error) {
    showEditorError(error);
  }
};
