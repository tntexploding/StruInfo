import {bindDivider} from '../../layout-controls.js';
import {preference, savePreference} from '../../runtime/preferences.js';
import {pageContext, routeParams, navigate} from '../../runtime/route.js';
import {ingestion, attempt, failure} from './api.js';
import {regionState} from '../../shared/region.js';
import {importDocument} from '../../runtime/import.js';
import {
  renderReceipts,
  selectReceipt,
  reviewReceipt,
  receipts,
  checkSource,
  searchHistory,
  importHistory,
} from './receipts.js';
import {icon} from '../../data.js';
import {
  states,
  initial,
  persist,
  kinds,
  sources,
  resetSource,
  sourceRecord,
  load,
} from './store.js';
import {settingsMarkup, manualMarkup} from './forms.js';
import {panels} from './panels.js';
import {mountRecord} from './record.js';
import {notice as notify} from '../../shared/notice.js';
import {bindDialog} from '../../shared/dialog.js';
const page = pageContext('sources');
export async function mount() {
  let sourcesLoaded = false;
  const $ = (s, r = page.root) => r.querySelector(s),
    $$ = (s, r = page.root) => [...r.querySelectorAll(s)];
  const extra = {
    sliders: 'M4 7h16M4 17h16M8 4v6m8 4v6',
    expand: 'M8 5H5v14h14v-3M13 3h8v8m0-8L11 13',
    history: 'M3 11a9 9 0 1 1 2 7M3 4v7h7M12 7v5l3 2',
    spark: 'm12 3 2.2 6.8L21 12l-6.8 2.2L12 21l-2.2-6.8L3 12l6.8-2.2Z',
  };
  function icons(root = page.root) {
    $$('[data-icon]', root).forEach(
      (el) =>
        (el.innerHTML = extra[el.dataset.icon]
          ? `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${extra[el.dataset.icon]}"/></svg>`
          : icon(el.dataset.icon)),
    );
  }
  let current = $('#sources').dataset.selection || sources[0]?.id,
    mode = 'source';
  const dialog = $('#layout-dialog'),
    dock = $('#receipt-dock'),
    dockBody = $('#dock-content'),
    dockTrigger = $('.recent-trigger');
  const sourceDialog = bindDialog(dialog, {
    closeButtons: [$('.close-dialog')],
    initialFocus: $('#dialog-title'),
    closeOnBackdrop: true,
  });
  const currentState = () => states[current];
  const privateScope = () =>
    mode === 'manual'
      ? $('[data-field=manualPrivacy]')?.value === 'private'
      : currentState()?.privacy === 'private';
  function dirty() {
    currentState().saved = false;
    $('#save-state').textContent = '未保存';
    const card = $(
      '.record-sector[data-source="' + current + '"] .sector-meta',
    );
    if (card) card.textContent = '未保存 · ' + kinds[currentState().kind];
  }
  function accent() {
    const color = currentState().accent;
    $('#source-detail').style.setProperty('--source-accent', color);
    const stops = $$('#record-selected stop');
    stops[0]?.setAttribute('stop-color', color);
    stops[1]?.setAttribute('stop-color', '#353129');
    stops[2]?.setAttribute('stop-color', '#2e2b25');
  }
  function conditional() {
    const s = currentState();
    $('.schedule-field').hidden = s.mode !== 'window';
    $('.interval-field').hidden = s.mode === 'once';
    $$('.receiving-grid input,.receiving-grid select,.weekdays button').forEach(
      (el) => (el.disabled = !s.enabled),
    );
  }
  function render() {
    $('#source-settings-view').innerHTML = settingsMarkup(currentState());
    $('#selection-title').textContent =
      mode === 'new' ? '添加来源' : currentState().name;
    $('#save-state').textContent = currentState().saved ? '已保存' : '未保存';
    icons($('#source-settings-view'));
    conditional();
    accent();
    const source = sourceRecord(current),
      next = source?.receivingStatus?.nextCheckAt;
    $('.recent-trigger small').textContent =
      (sources.find((v) => v.id === current)?.count || 0) +
      ' 篇待审核' +
      (next ? ' · 下次 ' + new Date(next).toLocaleString() : '');
  }
  let dockRatio = preference('source-dock-height', 0.45);
  function applyDockHeight() {
    dock.style.setProperty(
      '--dock-height',
      Math.max(0.25, Math.min(0.7, dockRatio)) * 100 + '%',
    );
  }
  applyDockHeight();
  const dockDivider = bindDivider($('#dock-resize'), {
    axis: 'y',
    direction: -1,
    label: '调整接收区高度',
    getValue: () => $('#source-detail').clientHeight * dockRatio,
    getBounds: () => [
      Math.min(220, $('#source-detail').clientHeight * 0.45),
      $('#source-detail').clientHeight * 0.7,
    ],
    setValue: (v) => {
      dockRatio = v / $('#source-detail').clientHeight;
      applyDockHeight();
    },
    commit: () => savePreference('source-dock-height', dockRatio),
    reset: () => {
      dockRatio = 0.45;
      applyDockHeight();
    },
  });
  function setDock(open, focus = false) {
    dock.classList.toggle('is-open', open);
    $('#dock-resize').hidden = !open;
    if (open) dockDivider.refresh();
    dockTrigger.setAttribute('aria-expanded', String(open));
    $('.dock-state').textContent = open ? '收起' : '展开';
    dockBody.inert = !open;
    dockBody.setAttribute('aria-hidden', String(!open));
    if (focus) dockTrigger.focus();
  }
  function showMode(next) {
    if (next === 'source' && !sources.length) next = 'empty';
    if (next === 'empty') {
      mode = 'empty';
      $('#source-detail').dataset.mode = 'empty';
      setDock(false);
      dock.hidden = true;
      $('.source-save').hidden = true;
      $('#alternate-view').hidden = true;
      $('#source-settings-view').hidden = false;
      $('#selection-title').textContent = '尚无来源';
      regionState($('#source-settings-view'), {
        kind: 'empty',
        title: '添加来源',
        text: '从唱片底部添加来源，或手动放入文档。',
      });
      return;
    }
    mode = next;
    setDock(false);
    const manual = next === 'manual';
    $('#source-settings-view').hidden = manual;
    $('#alternate-view').hidden = !manual;
    $('.source-save').hidden = manual;
    dock.hidden = next === 'new';
    $('#source-detail').dataset.mode = next;
    $$('[data-mode]').forEach((b) =>
      b.setAttribute('aria-pressed', String(b.dataset.mode === next)),
    );
    if (manual) {
      current = 'manual';
      $('#selection-title').textContent = '手动放入';
      if (!$('#alternate-view').children.length)
        $('#alternate-view').innerHTML = manualMarkup();
      icons($('#alternate-view'));
    } else {
      if (next === 'new') {
        current = 'new';
        states.new ||= initial({name: '', kind: 'rss'});
      } else {
        current = $('#sources').dataset.selection || sources[0]?.id;
      }
      render();
    }
  }
  function openPanel(id, trigger) {
    if (!panels[id]) return;
    const panel = panels[id];
    $('#dialog-title').textContent = panel.title;
    $('#dialog-path').textContent = panel.parent;
    $('#dialog-content').innerHTML = panel.content(currentState());
    dialog.dataset.panel = id;
    icons(dialog);
    sourceDialog.open(trigger);
  }
  dockTrigger.onclick = async () => {
    setDock(!dock.classList.contains('is-open'));
    if (dock.classList.contains('is-open'))
      await attempt(
        () => renderReceipts(current, dockBody, privateScope()),
        notify,
      );
  };
  page.on(document, 'keydown', (event) => {
    if (
      event.key === 'Escape' &&
      !dialog.open &&
      dock.classList.contains('is-open')
    ) {
      event.preventDefault();
      setDock(false, true);
    }
  });
  page.on(document, 'input', (event) => {
    const el = event.target,
      key = el.dataset.field;
    if (!key || key.startsWith('manual')) return;
    const previousKind = currentState().kind;
    currentState()[key] =
      el.type === 'checkbox'
        ? el.checked
        : el.type === 'number'
          ? Number(el.value)
          : el.value;
    dirty();
    if (key === 'accent') accent();
    if (key === 'name')
      $('#selection-title').textContent = el.value || '未命名来源';
    if (['mode', 'enabled'].includes(key)) conditional();
    if (key === 'kind') {
      const draft = currentState();
      draft.connectionDrafts ??= {};
      draft.connectionDrafts[previousKind] = draft.connection;
      draft.connection = draft.connectionDrafts[el.value] || {};

      $('#connection-kind').textContent = kinds[el.value];
      $('#connection-address').textContent =
        currentState().connection.url ||
        currentState().connection.component ||
        '地址待填写';
    }
  });
  page.on(document, 'change', (event) => {
    if (event.target.id === 'motion-toggle') {
      document.body.classList.toggle('no-motion', !event.target.checked);
      document.dispatchEvent(new Event('source-layout-motion'));
    }
    if (event.target.matches('#upload-field input'))
      $('#manual-feedback').textContent =
        `已选择 ${event.target.files.length} 个文件`;
    if (event.target.matches('[name="history-result"]'))
      $('#history-add').disabled = !$('[name="history-result"]:checked');
  });
  page.on(document, 'click', async (event) => {
    const target = event.target.closest('button');
    if (!target) return;
    if (target.hasAttribute('data-close')) {
      sourceDialog.close();
      return;
    }
    if (target.dataset.panel) {
      openPanel(target.dataset.panel, target);
      return;
    }
    if (target.dataset.mode) {
      showMode(target.dataset.mode);
      return;
    }
    if (target.dataset.weekday !== undefined) {
      const day = Number(target.dataset.weekday),
        list = currentState().weekdays;
      currentState().weekdays = list.includes(day)
        ? list.filter((d) => d !== day)
        : [...list, day];
      target.setAttribute(
        'aria-pressed',
        String(currentState().weekdays.includes(day)),
      );
      dirty();
      return;
    }
    if (target.dataset.article !== undefined) {
      await attempt(
        () => selectReceipt(Number(target.dataset.article), dockBody),
        notify,
      );
      return;
    }
    if (target.dataset.review) {
      await attempt(async () => {
        await reviewReceipt(target.dataset.review);
        await renderReceipts(current, dockBody, privateScope());
        notify('已' + target.dataset.review);
      }, notify);
      return;
    }
    if (target.dataset.manual) {
      const file = target.dataset.manual === 'file';
      $('#paste-field').hidden = file;
      $('#upload-field').hidden = !file;
      $$('[data-manual]').forEach((b) =>
        b.setAttribute('aria-pressed', String(b === target)),
      );
      return;
    }
    const action = target.dataset.action,
      s = currentState();
    if (action === 'description')
      await attempt(async () => {
        const out = await ingestion('source_description_generate', {
          label: s.name,
          kind: {
            rss: 'rss_atom',
            git: 'github_markdown',
            web: 'web',
            json: 'json_api',
            plugin: 'plugin',
          }[s.kind],
          isPrivate: s.privacy === 'private',
          url: s.connection.url,
          notes: s.description,
        });
        s.description = out.text;
        $('#source-description').value = s.description;
        dirty();
        notify('简介已生成，请保存');
      }, notify);
    if (action === 'generate-plan')
      await attempt(async () => {
        if (!receipts().length)
          await renderReceipts(current, dockBody, privateScope());
        const doc = receipts()[0];
        if (!doc) throw new Error('收到文档后才能生成拆分方案');
        const out = await ingestion('split_recipe_suggest', {
          snapshotId: doc.snapshotId,
          includePrivate: false,
        });
        s.split = out.rationale || out.description || out.name || '';
        s.rules = JSON.stringify(out.settings, null, 2);
        $('#split-text').value = [s.split, s.rules].filter(Boolean).join('\n');
        dirty();
        notify('拆分建议已生成，请检查并保存');
      }, notify);
    if (action === 'save-connection') {
      const invalid = $$('#dialog-content input').find(
        (i) => !i.checkValidity(),
      );
      if (invalid) {
        invalid.reportValidity();
        return;
      }
      $$('[data-connection]').forEach(
        (i) => (s.connection[i.dataset.connection] = i.value),
      );
      $('#connection-address').textContent =
        s.connection.url || s.connection.component || '地址待填写';
      dirty();
      sourceDialog.close();
      notify('参数已填入草稿');
    }
    if (action === 'save-recipe') {
      s.split = $('#recipe-text').value;
      s.rules = $('#recipe-rules').value;
      $('#split-text').value = s.split;
      dirty();
      sourceDialog.close();
      notify('方案已填入草稿');
    }
    if (action === 'cancel-source') {
      resetSource(current);
      render();
      const card = $(
        '.record-sector[data-source="' + current + '"] .sector-meta',
      );
      if (card) card.textContent = kinds[currentState().kind];
    }
    if (action === 'save') {
      const invalid = $$('#source-settings-view input').find(
        (i) => !i.disabled && !i.checkValidity(),
      );
      if (invalid) {
        invalid.reportValidity();
        return;
      }
      if (!s.name.trim()) {
        notify('填写来源名称');
        $('[data-field="name"]').focus();
        return;
      }
      if (
        s.mode === 'window' &&
        s.enabled &&
        (!s.weekdays.length || s.start >= s.end)
      ) {
        notify('选择检查日期，并确认结束时间晚于开始时间');
        return;
      }
      target.disabled = true;
      await attempt(async () => {
        const isNew = mode === 'new',
          id = await persist(current);
        current = id;
        mode = 'source';
        $('#source-detail').dataset.mode = 'source';
        dock.hidden = false;
        document.dispatchEvent(
          new CustomEvent(
            isNew ? 'source-layout-add' : 'source-layout-update',
            {
              detail: {
                id,
                name: s.name,
                kind: s.kind,
                initial: s.name.slice(0, 2),
                connector: kinds[s.kind],
                enabled: s.enabled,
                count: 0,
                dirty: false,
              },
            },
          ),
        );
        render();
        notify('来源设置已保存');
      }, notify);
      target.disabled = false;
    }
    if (action === 'filter') {
      document.dispatchEvent(
        new CustomEvent('source-layout-filter', {
          detail: {
            kind: $('#filter-kind').value,
            sort: $('#filter-sort').value,
          },
        }),
      );
      sourceDialog.close();
    }
    if (action === 'history-search')
      await attempt(() => searchHistory(dialog), notify);
    if (action === 'history-add')
      await attempt(async () => {
        const count = await importHistory(dialog);
        notify(`已补收 ${count} 篇`);
        sourceDialog.close();
      }, notify);
    if (action === 'check-now')
      await attempt(async () => {
        await checkSource(current);
        await renderReceipts(current, dockBody, privateScope());
        notify('检查已完成');
      }, notify);
    if (action === 'manual-import')
      await attempt(async () => {
        const fileMode = $('#paste-field').hidden,
          files = [...$('#upload-field input').files],
          text = $('#paste-field textarea').value;
        if ((fileMode && !files.length) || (!fileMode && !text.trim()))
          throw new Error('先填写正文或选择文件');
        const isPrivate = $('[data-field="manualPrivacy"]').value === 'private',
          name = $('[data-field="manualTitle"]').value;
        target.disabled = true;
        try {
          if (fileMode) {
            for (const file of files)
              await importDocument({file, name: name || file.name, isPrivate});
          } else await importDocument({name, text, isPrivate});
          $('#paste-field textarea').value = '';
          $('#upload-field input').value = '';
          notify('已加入待审核队列');
          $('#manual-feedback').textContent =
            '导入完成，请在底部近期接收中审核。';
          await renderReceipts('manual', dockBody, isPrivate);
          setDock(true);
        } finally {
          target.disabled = false;
        }
      }, notify);
  });
  page.on(document, 'source-layout-selection', () => {
    if (!sourcesLoaded) return;
    if (!$('#sources').dataset.selection) {
      $('#selection-title').textContent = '没有匹配的来源';
      $('#source-settings-view').hidden = false;
      regionState($('#source-settings-view'), {
        kind: 'empty',
        title: '没有匹配的来源',
      });
      const clear = document.createElement('button');
      clear.type = 'button';
      clear.className = 'compact-button';
      clear.textContent = '清除筛选';
      clear.onclick = () => {
        $('#source-search').value = '';
        $('#source-search').dispatchEvent(new Event('input'));
        document.dispatchEvent(
          new CustomEvent('source-layout-filter', {
            detail: {kind: 'all', sort: 'name'},
          }),
        );
      };
      $('#source-settings-view').firstElementChild.append(clear);
      $('.source-save').hidden = true;
      setDock(false);
      dock.hidden = true;
      return;
    }
    showMode('source');
    navigate('sources', {source: current}, true);
  });
  icons();
  $('#source-settings-view').innerHTML = '<p role="status">正在读取来源…</p>';
  mountRecord();
  page.isDirty = () =>
    Object.values(states).some(
      (s) => !s.saved && (s.name || s.connection?.url),
    ) ||
    Boolean(
      $('#paste-field textarea')?.value ||
      $('#upload-field input')?.files?.length,
    );
  async function refreshSources() {
    $('#source-settings-view').hidden = false;
    $('.source-save').hidden = true;
    $('#selection-title').textContent = '读取来源';
    regionState($('#source-settings-view'), {
      kind: 'loading',
      title: '正在读取来源…',
    });
    try {
      await load();
      sourcesLoaded = true;
      current = routeParams().get('source') || sources[0]?.id;
      $('#sources').dataset.selection = current || '';
      document.dispatchEvent(new Event('source-layout-reload'));
      showMode(sources.length ? 'source' : 'empty');
    } catch (error) {
      if (error.name !== 'AbortError') {
        $('#selection-title').textContent = '来源读取失败';
        $('#source-settings-view').hidden = false;
        regionState($('#source-settings-view'), {
          kind: 'error',
          title: failure(error),
          retry: refreshSources,
        });
      }
    }
  }
  page.onStart(() => {
    if (!sourcesLoaded) void refreshSources();
  });
  page.onRoute = (params) => {
    const selected = params.get('source');
    if (selected && states[selected] && selected !== current) {
      $('#sources').dataset.selection = selected;
      current = selected;
      showMode('source');
      document.dispatchEvent(
        new CustomEvent('source-layout-focus', {detail: selected}),
      );
    }
  };
}
