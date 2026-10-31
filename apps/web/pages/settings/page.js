import {pageContext, routeParams, navigate} from '../../runtime/route.js';
import {loadSettings, saveSettings, context} from './store.js';
import {request, failure} from './api.js';
import {escape as e, paintIcons} from '../../data.js';
import {sections, defaults, roles} from './supported-settings.js';
import {page as settingsMarkup, get} from './views.js';
import {extraValidation} from './extra-settings.js';
import {applyAppearance} from '../../runtime/environment.js';
import {notice as announce} from '../../shared/notice.js';
import {bindDialog} from '../../shared/dialog.js';
import {dialogTitles, dialogContent, readOnlyDialogs} from './dialogs.js';
const page = pageContext('settings');
export async function mount() {
  const $ = (s) => page.root.querySelector(s);
  const clone = (x) => structuredClone(x);
  let saved = clone(defaults),
    drafts = clone(defaults);
  const groupState = Object.fromEntries(
    sections.map(([id]) => [id, {status: 'loading'}]),
  );
  let active = sections.some(([id]) => id === routeParams().get('section'))
    ? routeParams().get('section')
    : 'appearance';
  let dialogId = '',
    dialogDraft = null;
  const dialog = $('#settings-dialog');
  const settingsDialog = bindDialog(dialog, {
    closeButtons: [$('#close-dialog'), $('#dialog-cancel')],
    closeOnBackdrop: true,
    beforeClose: () => !modalDirty() || confirm('放弃浮窗中未保留的修改？'),
  });
  page.canLeave = settingsDialog.close;
  const set = (obj, path, value) => {
    const keys = path.split('.');
    const last = keys.pop();
    let p = obj;
    for (const k of keys) p = p[k];
    p[last] = value;
  };
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const lines = (s) =>
    s
      .split('\n')
      .map((x) => x.trim())
      .filter(Boolean);
  const dirty = (id) => !same(drafts[id], saved[id]);
  function nav() {
    $('#settings-nav').innerHTML = sections
      .map(
        ([id, title, icon]) =>
          `<a href="#/settings?section=${id}" data-section="${id}" aria-label="${title}" ${active === id ? 'aria-current="page"' : ''}><span data-icon="${icon}"></span><span>${title}</span>${dirty(id) ? '<i aria-label="有未保存修改"></i>' : ''}</a>`,
      )
      .join('');
    paintIcons($('#settings-nav'));
  }
  function state() {
    const changed = dirty(active);
    $('#change-state').textContent = changed
      ? '有未保存的修改'
      : groupState[active].status === 'ready'
        ? '已保存'
        : groupState[active].status === 'loading'
          ? '读取中'
          : '读取失败';
    $('#change-state').dataset.dirty = String(changed);
    $('#save-settings').disabled =
      !changed || groupState[active].status !== 'ready';
    $('#revert-settings').disabled = !changed;
    $('#settings-footer').hidden = active === 'data';
    for (const a of $('#settings-nav').querySelectorAll('a')) {
      let dot = a.querySelector('i');
      if (dirty(a.dataset.section) && !dot) {
        dot = document.createElement('i');
        dot.setAttribute('aria-label', '有未保存修改');
        a.append(dot);
      } else if (!dirty(a.dataset.section)) dot?.remove();
    }
  }
  function theme() {
    applyAppearance(drafts.appearance);
  }
  function render() {
    const sec = sections.find((s) => s[0] === active);
    $('#settings-title').textContent = sec[1];
    $('#settings-subtitle').textContent = sec[3];
    const current = groupState[active];
    $('#settings-content').innerHTML =
      current.status === 'ready'
        ? settingsMarkup(active, drafts[active])
        : current.status === 'loading'
          ? '<p class="region-message" role="status">正在读取设置…</p>'
          : '<div class="region-message" role="alert"><p>' +
            e(failure(current.error)) +
            '</p><button class="secondary-action" data-reload-group>重新读取</button></div>';
    $('#settings-content').scrollTop = 0;
    nav();
    paintIcons($('#settings-content'));
    state();
    if (groupState.appearance.status === 'ready') theme();
  }
  function changeSection(id) {
    if (id === active) return;
    active = id;
    navigate('settings', {section: id}, true);
    render();
  }
  $('#settings-nav').addEventListener('click', (ev) => {
    const a = ev.target.closest('[data-section]');
    if (!a) return;
    ev.preventDefault();
    changeSection(a.dataset.section);
  });
  page.onRoute = (params) => {
    const id = params.get('section');
    if (sections.some(([key]) => key === id) && id !== active) {
      active = id;
      render();
    }
  };
  page.isDirty = () => modalDirty() || sections.some(([id]) => dirty(id));
  function receiveGroup(id, result) {
    const changed = dirty(id);
    groupState[id] = result;
    if (result.status === 'ready') {
      saved[id] = clone(result.value);
      if (!changed) drafts[id] = clone(result.value);
    }
    if (id === active) render();
    else nav();
  }
  function reloadGroup(id) {
    groupState[id] = {status: 'loading'};
    render();
    void loadSettings(receiveGroup, id);
  }
  $('#settings-content').addEventListener('click', (e) => {
    if (e.target.closest('[data-reload-group]')) reloadGroup(active);
  });
  function bind(ev, obj, root) {
    const t = ev.target;
    if (t.matches('[data-bind]')) {
      const val =
        t.type === 'checkbox'
          ? t.checked
          : t.type === 'number' || t.type === 'range'
            ? t.valueAsNumber
            : t.hasAttribute('data-number')
              ? Number(t.value)
              : t.value;
      set(obj, t.dataset.bind, val);
      const out = root.querySelector('[data-output="' + t.dataset.bind + '"]');
      if (out) out.textContent = t.value + (out.dataset.unit || '');
    }
    if (t.matches('[data-list]')) {
      const current = get(obj, t.dataset.list);
      set(
        obj,
        t.dataset.list,
        t.checked
          ? [...new Set([...current, t.value])]
          : current.filter((v) => v !== t.value),
      );
    }
  }
  $('#settings-form').addEventListener('input', (ev) => {
    bind(ev, drafts[active], $('#settings-form'));
    state();
    if (active === 'appearance') {
      const flow = $('#setting-flowMotion');
      if (flow) flow.disabled = !drafts.appearance.motion;
      theme();
    }
  });
  $('#settings-form').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    if (!ev.currentTarget.reportValidity()) return;
    if (
      active === 'automation' &&
      drafts.automation.enabled &&
      !drafts.automation.paused &&
      !drafts.automation.manualUploads &&
      !drafts.automation.subscriptionIds.length
    ) {
      announce('先选择来源，或包含手动导入。');
      return;
    }
    const section = active,
      previous = clone(saved[section]),
      value = clone(drafts[section]);
    $('#save-settings').disabled = true;
    try {
      await saveSettings(section, value, previous);
      saved[section] = value;
      groupState[section] = {status: 'ready'};
      state();
      announce('已保存。');
    } catch (error) {
      saved[section] = previous;
      if (error.kind === 'unknown' || error.kind === 'conflict') {
        groupState[section] = {status: 'error', error};
        if (active === section) render();
      }
      announce(
        (error.completedGroups ? '部分设置已保存。' : '') + failure(error),
        {kind: 'error'},
      );
      if (groupState[section].status === 'error') render();
      else state();
    }
  });
  $('#revert-settings').onclick = () => {
    drafts[active] = clone(saved[active]);
    render();
    announce('已撤销当前分类的修改。');
  };
  function open(id) {
    dialogId = id;
    dialogDraft = clone(drafts[active]);
    $('#dialog-title').textContent = dialogTitles[id];
    $('#dialog-parent').textContent = sections.find((s) => s[0] === active)[1];
    $('#dialog-content').innerHTML = dialogContent(
      id,
      dialogDraft,
      saved[active],
    );
    if (id === 'price')
      $('#dialog-content').innerHTML =
        '<p>' +
        e(context.price?.rule || '未读取规则') +
        '</p><p>时区：' +
        e(context.price?.timeZone || '—') +
        '</p><p>下次允许：' +
        e(context.price?.nextAllowedAt || '当前无时段限制') +
        '</p>';
    const readonly = readOnlyDialogs.includes(id);
    $('#dialog-apply').hidden = readonly && !['backup', 'restore'].includes(id);
    $('#dialog-apply').disabled = false;
    $('#dialog-apply').textContent =
      id === 'backup'
        ? '导出数据'
        : id === 'restore'
          ? '验证并恢复'
          : '保留修改';
    $('#dialog-cancel').textContent = readonly ? '关闭' : '取消';
    $('#dialog-note').textContent = readonly
      ? id === 'backup' || id === 'restore'
        ? '文件保存在服务端。'
        : ''
      : '修改先保留在当前分类，保存后生效。';
    paintIcons($('#dialog-content'));
    weightCheck();
    settingsDialog.open(() =>
      page.root.querySelector('[data-open="' + id + '"]'),
    );
  }
  function refreshDialog() {
    const scroll = $('#dialog-content').scrollTop;
    $('#dialog-content').innerHTML = dialogContent(
      dialogId,
      dialogDraft,
      saved[active],
    );
    paintIcons($('#dialog-content'));
    $('#dialog-content').scrollTop = scroll;
    weightCheck();
  }
  function modalDirty() {
    return (
      dialog.open &&
      !readOnlyDialogs.includes(dialogId) &&
      !same(dialogDraft, drafts[active])
    );
  }
  $('#settings-content').addEventListener('click', (ev) => {
    const openButton = ev.target.closest('[data-open]');
    if (openButton) {
      open(openButton.dataset.open);
      return;
    }
    if (ev.target.closest('[data-preview]')) open('preview');
  });
  function weightCheck() {
    if (dialogId !== 'weights') return;
    const w = dialogDraft.weights,
      total = w.content + w.type + w.domain;
    const out = $('#weight-total');
    if (out) {
      out.textContent =
        '当前合计 ' + total + '%' + (total === 100 ? '' : '，请调整为 100%。');
      out.style.color = total === 100 ? 'var(--muted)' : 'var(--warn)';
    }
    $('#dialog-apply').disabled = total !== 100;
  }
  $('#dialog-form').addEventListener('input', (ev) => {
    bind(ev, dialogDraft, $('#dialog-form'));
    weightCheck();
  });
  $('#dialog-form').addEventListener('change', (ev) => {
    if (ev.target.matches('[data-dimension-enabled]'))
      dialogDraft.dimensions[
        Number(ev.target.dataset.dimensionEnabled)
      ].enabled = ev.target.checked;
  });
  function validateDialog() {
    const extraError = extraValidation(dialogId, dialogDraft);
    if (extraError) {
      announce(extraError);
      return false;
    }
    if (dialogId === 'notice-time') {
      try {
        new Intl.DateTimeFormat('zh-CN', {
          timeZone: dialogDraft.notices.timeZone,
        }).format();
      } catch {
        announce('请填写有效时区，例如 Asia/Shanghai。');
        return false;
      }
    }
    if (dialogId === 'intake') {
      if (
        [
          dialogDraft.intake.preferredTopics,
          dialogDraft.intake.excludedTopics,
        ].some(
          (s) => lines(s).length > 16 || lines(s).some((t) => t.length > 100),
        )
      ) {
        announce('话题最多 16 个，每个不超过 100 字。');
        return false;
      }
    }
    if (dialogId === 'notice-scope') {
      const ss = lines(dialogDraft.notices.sources),
        tt = lines(dialogDraft.notices.urgentTerms);
      if (ss.length > 32 || ss.some((x) => x.length > 200)) {
        announce('来源最多 32 个，每个不超过 200 字。');
        return false;
      }
      if (tt.length > 16 || tt.some((x) => x.length < 2 || x.length > 80)) {
        announce('紧急关键词最多 16 个，每个 2—80 字。');
        return false;
      }
    }
    if (dialogId === 'keywords') {
      if (
        lines(dialogDraft.quickTags).length > 24 ||
        lines(dialogDraft.excludedKeywords).length > 64 ||
        [
          ...lines(dialogDraft.quickTags),
          ...lines(dialogDraft.excludedKeywords),
        ].some((s) => Array.from(s).length > 120)
      ) {
        announce('快捷标签最多 24 个，排除词最多 64 个，每项最多 120 字。');
        return false;
      }
    }
    return true;
  }
  $('#dialog-form').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    if (['backup', 'restore'].includes(dialogId)) {
      if (!ev.currentTarget.reportValidity()) return;
      $('#dialog-apply').disabled = true;
      try {
        const result = await request(
          'workspace-bundles/' + (dialogId === 'backup' ? 'export' : 'restore'),
          dialogId === 'backup' ? {} : {fileName: $('#bundle-file').value},
        );
        $('#dialog-note').textContent =
          dialogId === 'backup' ? '已导出：' + result.fileName : '已恢复';
      } catch (error) {
        announce(failure(error));
      } finally {
        $('#dialog-apply').disabled = false;
      }
      return;
    }
    if (
      readOnlyDialogs.includes(dialogId) ||
      !ev.currentTarget.reportValidity() ||
      !validateDialog()
    )
      return;
    if (
      dialogId === 'weights' &&
      dialogDraft.weights.content +
        dialogDraft.weights.type +
        dialogDraft.weights.domain !==
        100
    )
      return;
    drafts[active] = clone(dialogDraft);
    render();
    settingsDialog.close();
    announce('修改已保留，保存当前分类后生效。');
  });
  function add(kind) {
    const val = (name) =>
      $('#dialog-content [name="' + name + '"]')?.value.trim() || '';
    const d = dialogDraft;
    if (kind === 'dimension') {
      const name = val('dimension-name');
      if (!name) {
        announce('填写维度名称。');
        return;
      }
      if (d.dimensions.length >= 32) {
        announce('最多保存 32 个维度。');
        return;
      }
      if (d.dimensions.some((x) => x.name === name)) {
        announce('该维度已存在。');
        return;
      }
      d.dimensions.push({
        id: crypto.randomUUID(),
        name,
        role: val('dimension-role'),
        description: val('dimension-description'),
        enabled: true,
      });
    }
    if (kind === 'term') {
      const label = val('term-label'),
        dimensionId = val('term-dimension');
      if (!label || !dimensionId) {
        announce('填写词条并选择维度。');
        return;
      }
      if (d.terms.length >= 4096) {
        announce('词条数量已达上限。');
        return;
      }
      d.terms.push({
        id: crypto.randomUUID(),
        dimensionId,
        label,
        meaning: val('term-meaning'),
      });
    }
    if (kind === 'alias') {
      const text = val('alias-text'),
        termId = val('alias-term');
      if (!text || !termId) {
        announce('填写别名并选择对应词条。');
        return;
      }
      if (d.aliases.length >= 4096) {
        announce('别名数量已达上限。');
        return;
      }
      if (d.aliases.some((x) => x.text === text && x.termId === termId)) {
        announce('该别名已存在。');
        return;
      }
      d.aliases.push({termId, text, status: 'confirmed'});
    }
    if (kind === 'relation') {
      const from = val('relation-from'),
        to = val('relation-to'),
        kind = val('relation-kind');
      if (!from || !to || from === to) {
        announce('请选择两个不同的词条。');
        return;
      }
      if (
        kind === 'equivalent' &&
        d.terms.find((t) => t.id === from).dimensionId !==
          d.terms.find((t) => t.id === to).dimensionId
      ) {
        announce('等同关系需要属于同一维度。');
        return;
      }
      if (
        d.relations.some(
          (x) => x.from === from && x.to === to && x.kind === kind,
        )
      ) {
        announce('该关系已存在。');
        return;
      }
      if (d.relations.length >= 4096) {
        announce('词条关系数量已达上限。');
        return;
      }
      d.relations.push({from, to, kind, status: 'confirmed'});
    }
    refreshDialog();
  }
  $('#dialog-content').addEventListener('click', (ev) => {
    const extraAdd = ev.target.closest('[data-extra-add]');
    if (extraAdd) {
      if (dialogDraft.localAliases.length >= 128) {
        announce('最多 128 条别名。');
        return;
      }
      dialogDraft.localAliases.push({source: '', canonical: ''});
      refreshDialog();
      return;
    }
    const extraRemove = ev.target.closest('[data-extra-remove]');
    if (extraRemove) {
      const [path, i] = extraRemove.dataset.extraRemove.split(':');
      get(dialogDraft, path).splice(Number(i), 1);
      refreshDialog();
      return;
    }

    const ad = ev.target.closest('[data-add]');
    if (ad) {
      add(ad.dataset.add);
      return;
    }
    if (ev.target.closest('[data-add-defaults]')) {
      dialogDraft.dimensions = Object.entries(roles)
        .filter(([r]) => r !== 'custom')
        .map(([role, name]) => ({
          id: crypto.randomUUID(),
          name,
          role,
          description: '',
          enabled: true,
        }));
      refreshDialog();
      return;
    }
    const rem = ev.target.closest('[data-remove]');
    if (rem) {
      const [kind, idx] = rem.dataset.remove.split(':');
      const value = dialogDraft[kind][Number(idx)];
      if (
        ['terms', 'dimensions'].includes(kind) &&
        saved[active][kind].some((x) => x.id === value.id)
      ) {
        announce('已保存的词条或维度需要保留。');
        return;
      }
      if (
        kind === 'dimensions' &&
        dialogDraft.terms.some((t) => t.dimensionId === value.id)
      ) {
        announce('此维度下仍有词条，请先调整词条。');
        return;
      }
      if (kind === 'terms') {
        dialogDraft.aliases = dialogDraft.aliases.filter(
          (a) => a.termId !== value.id,
        );
        dialogDraft.relations = dialogDraft.relations.filter(
          (r) => r.from !== value.id && r.to !== value.id,
        );
      }
      dialogDraft[kind].splice(Number(idx), 1);
      refreshDialog();
      return;
    }
    const conf = ev.target.closest('[data-confirm]');
    if (conf) {
      const [kind, idx] = conf.dataset.confirm.split(':');
      dialogDraft[kind][Number(idx)].status = 'confirmed';
      refreshDialog();
    }
  });
  page.on(matchMedia('(prefers-color-scheme:light)'), 'change', theme);
  render();
  paintIcons(page.root);
  let firstStart = true;
  void loadSettings(receiveGroup);
  page.onStart(() => {
    if (firstStart) {
      firstStart = false;
      return;
    }
    for (const [id, state] of Object.entries(groupState))
      if (state.status === 'loading') void loadSettings(receiveGroup, id);
  });
}
