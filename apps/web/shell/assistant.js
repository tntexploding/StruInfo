import template from './assistant.html?raw';
import '../shared/assistant-surfaces.css';
import {icon, paintIcons, escape as e} from '../data.js';
import {request, reports, tasks} from '../runtime/api.js';
import {preference, savePreference} from '../runtime/preferences.js';
import {documentPage, download, titleOf} from '../runtime/documents.js';
import {bindDivider} from '../layout-controls.js';
import {openContentDialog} from '../shared/content-dialog.js';
import {showReportReader} from '../shared/report-reader.js';
import {bindWindowGeometry} from '../shared/window-geometry.js';
import {sessionView, startView, errorText, button} from './assistant-render.js';

export function mountAssistant(trigger) {
  // The formal route host replaces the prototype's demonstration reader.
  const host = document.querySelector('#page-host');
  const area = document.createElement('div');
  area.className = 'work-area assistant-ui';
  area.dataset.open = 'false';
  host.before(area);
  area.append(host);
  area.insertAdjacentHTML(
    'beforeend',
    '<div id="assistant-divider"><span></span></div>' + template,
  );
  const $ = (s) => area.querySelector(s);
  const panel = $('#assistant-panel'),
    log = $('#conversation'),
    input = $('#message'),
    status = $('#assistant-status');
  paintIcons(panel);
  const geometry = bindWindowGeometry(panel, {
    handle: $('.assistant-head'),
    controls: $('.assistant-tools'),
    key: 'assistant-window',
  });
  let token = '',
    connected = false,
    busy = false,
    current = null,
    timer;
  let attachment = null,
    preferredExpanded = preference('assistant-expanded', false);
  const drafts = new Map();
  let renderedHTML = '';
  const call = async (operation, value = {}) =>
    (
      await request('assistant/commands', {operation, input: value}, 'POST', {
        authorization: 'Bearer ' + token,
      })
    ).result;
  const setStatus = (text = '', error = false) => {
    status.textContent = text;
    status.hidden = !text;
    status.dataset.error = String(error);
  };
  function controls() {
    const pending = current?.turn?.status === 'confirmation',
      active = current?.active;
    const blocked = busy || active || pending || !connected;
    $('#composer').hidden = !connected;
    $('#attachment-row').hidden = !connected || !attachment;
    if (attachment) $('#attachment-label').textContent = titleOf(attachment);
    input.disabled = Boolean(blocked);
    input.placeholder = pending
      ? '先完成上方的确认'
      : '输入任务，例如“查找最近的技术资料”…';
    $('#send').hidden = Boolean(active);
    $('#stop').hidden = !active;
    $('#stop').disabled = busy || current?.stopRequested;
    $('#send').disabled = Boolean(blocked || !input.value.trim());
    $('#attach-document').disabled = Boolean(blocked);
    $('#remove-attachment').disabled = Boolean(blocked);
    $('#composer-hint').textContent = blocked ? '' : 'Enter 发送';
    $('#new-chat').disabled = !connected || busy || active;
    $('#history').disabled = !connected || busy || active;
    log
      .querySelectorAll(
        '[data-action=confirm],[data-action=dismiss],[data-action=resume],[data-action=refresh]',
      )
      .forEach((b) => {
        b.disabled = busy;
      });
    log
      .querySelector('.assistant-auth button')
      ?.toggleAttribute('disabled', busy);
    log.querySelectorAll('[data-action=control]').forEach((b) => {
      b.disabled = Boolean(blocked);
    });
  }
  async function run(work) {
    if (busy) return;
    busy = true;
    controls();
    setStatus();
    try {
      await work();
    } catch (error) {
      setStatus(errorText(error), true);
    } finally {
      busy = false;
      controls();
      schedule();
    }
  }
  function schedule() {
    clearTimeout(timer);
    if (
      area.dataset.open !== 'true' ||
      !connected ||
      !current ||
      document.hidden
    )
      return;
    if (current.active || current.jobs?.length)
      timer = setTimeout(() => void run(refresh), 2000);
  }
  function render(s) {
    const changedSession = current?.sessionId !== s.sessionId;
    const newTurn = current?.turn?.id !== s.turn?.id;
    if (changedSession) {
      if (current)
        drafts.set(current.sessionId, {text: input.value, attachment});
      const draft = drafts.get(s.sessionId);
      input.value = draft?.text || '';
      attachment = draft?.attachment || null;
    }
    const follow =
      changedSession ||
      current?.turn?.id !== s.turn?.id ||
      log.scrollHeight - log.scrollTop - log.clientHeight < 60;
    const top = log.scrollTop;
    current = s;
    savePreference('assistant-session', s.sessionId);
    $('#session-title').textContent = s.messages?.[0]?.message || '新对话';
    const html = sessionView(s);
    if (renderedHTML !== html) {
      const action = log.contains(document.activeElement)
        ? document.activeElement.dataset.action
        : null;
      log.innerHTML = html;
      renderedHTML = html;
      if (newTurn) log.lastElementChild?.classList.add('new-turn');
      if (action)
        log
          .querySelector(`[data-action="${action}"]`)
          ?.focus({preventScroll: true});
      log.scrollTop = follow ? log.scrollHeight : top;
    }
    controls();
    schedule();
  }
  async function refresh() {
    if (!current) return;
    try {
      render(await call('read', {sessionId: current.sessionId}));
    } catch (error) {
      if (error.code !== 'assistant_session_not_found') throw error;
      clearConversation();
      setStatus('这段对话已删除。');
    }
  }
  function clearConversation() {
    if (current) drafts.delete(current.sessionId);
    current = null;
    attachment = null;
    clearTimeout(timer);
    savePreference('assistant-session', null);
    input.value = '';
    input.style.height = 'auto';
    $('#session-title').textContent = '新对话';
    renderedHTML = startView();
    log.innerHTML = renderedHTML;
    controls();
  }
  async function openNew() {
    render(
      await call('open', {channel: 'web', conversationId: crypto.randomUUID()}),
    );
  }
  function authView() {
    renderedHTML = '';
    log.innerHTML =
      '<div class="start-state"><h3>连接系统助手</h3><form class="assistant-auth"><label>助手访问密钥<input id="assistant-token" type="password" autocomplete="off" required></label><p class="modal-note">密钥仅保存在当前页面。</p><div class="operation-actions"><button class="primary-action">连接</button></div></form></div>';
    $('.assistant-auth').onsubmit = (event) => {
      event.preventDefault();
      void run(async () => {
        token = $('#assistant-token').value.trim();
        await call('status');
        const selected = preference('assistant-session', null);
        if (selected) {
          try {
            render(await call('read', {sessionId: selected}));
          } catch (error) {
            if (error.code !== 'assistant_session_not_found') throw error;
            await openNew();
          }
        } else await openNew();
        connected = true;
      }).then(() => {
        if (connected && area.dataset.open === 'true') input.focus();
      });
    };
    controls();
  }
  function setExpanded(full, remember = false) {
    if (remember) {
      preferredExpanded = full;
      savePreference('assistant-expanded', full);
    }
    area.dataset.expanded = String(full);
    panel.classList.toggle('ef-glass', full);
    const control = $('#expand'),
      label = full ? '返回并排阅读' : '展开助手';
    control.setAttribute('aria-pressed', String(full));
    control.setAttribute('aria-label', label);
    control.title = label;
    control.innerHTML =
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="' +
      (full
        ? 'M3 8h5V3m8 0v5h5M8 21v-5H3m13 5v-5h5'
        : 'M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5') +
      '"/></svg>';
    geometry.setEnabled(full && area.dataset.open === 'true');
  }
  function closeAssistant() {
    geometry.setEnabled(false);
    area.dataset.open = 'false';
    setExpanded(false);
    clearTimeout(timer);
    trigger.setAttribute('aria-expanded', 'false');
    trigger.focus({preventScroll: true});
  }
  function showDocument() {
    if (area.dataset.expanded === 'true') setExpanded(false);
    if (innerWidth <= 1100) closeAssistant();
  }
  function send(text) {
    if (
      !text.trim() ||
      !connected ||
      busy ||
      current?.active ||
      current?.turn?.pending
    )
      return;
    const message =
      text.trim() +
      (attachment
        ? `\n\n参考文档：${titleOf(attachment)}（snapshotId: ${attachment.snapshotId}）。`
        : '');
    if (message.length > 8000) {
      setStatus('指令连同参考文档名称需在 8000 字符内。', true);
      return;
    }
    void run(async () => {
      if (!current) {
        current = await call('open', {
          channel: 'web',
          conversationId: crypto.randomUUID(),
        });
        savePreference('assistant-session', current.sessionId);
      }
      const s = await call('ask', {
        sessionId: current.sessionId,
        messageId: crypto.randomUUID(),
        message,
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      });
      input.value = '';
      input.style.height = 'auto';
      attachment = null;
      render(s);
    });
  }
  async function chooseDocument() {
    const surface = openContentDialog(
      '附加参考文档',
      '<form id="assistant-find-form"><input class="modal-search" id="assistant-find-document" type="search" placeholder="搜索公开文档" aria-label="搜索公开文档"><button class="secondary-action">搜索</button></form><div id="doc-options"></div>',
    );
    const root = surface.element,
      list = root.querySelector('#doc-options');
    let sequence = 0;
    async function search() {
      const seq = ++sequence;
      list.textContent = '正在读取…';
      try {
        const r = await documentPage(false, {
          query: root.querySelector('#assistant-find-document').value.trim(),
          limit: 30,
        });
        if (seq !== sequence || !list.isConnected) return;
        list.innerHTML =
          r.documents
            .map((d) =>
              button(
                'attach',
                icon('file') +
                  `<span><strong>${e(titleOf(d))}</strong><small>${e(d.capturedAt?.slice(0, 10) || '')}</small></span>` +
                  icon('chevron'),
                'modal-row',
                `data-doc="${e(d.snapshotId)}"`,
              ),
            )
            .join('') || '<p class="modal-note">没有匹配的文档。</p>';
        list.querySelectorAll('[data-doc]').forEach(
          (b) =>
            (b.onclick = () => {
              attachment = r.documents.find(
                (d) => d.snapshotId === b.dataset.doc,
              );
              surface.close();
              controls();
              input.focus();
            }),
        );
      } catch (error) {
        if (seq === sequence && list.isConnected)
          list.textContent = errorText(error);
      }
    }
    root.querySelector('form').onsubmit = (event) => {
      event.preventDefault();
      void search();
    };
    await search();
  }
  async function history() {
    let rows = await call('sessions');
    if (area.dataset.open !== 'true') return;
    openContentDialog(
      '历史对话',
      '<div id="history-list"></div><p id="history-error" class="modal-note assistant-error" role="alert" hidden></p>',
      {
        trigger: $('#history'),
        actions: button('disconnect', '断开连接', 'quiet-button'),
        setup(root, close) {
          const list = root.querySelector('#history-list');
          const feedback = root.querySelector('#history-error');
          let confirming = null,
            working = false;
          function draw() {
            if (!list.isConnected) return;
            list.innerHTML =
              rows
                .map((s) => {
                  const attrs = `data-session="${e(s.sessionId)}"`;
                  return `<div class="history-entry">${button(
                    'session',
                    icon('clock') +
                      `<span><strong>${e(s.title)}</strong><small>${e(s.channel === 'web' ? '网页' : s.channel)} · ${e(s.updatedAt?.slice(0, 10) || '')}${s.active ? ' · 正在执行' : ''}</small></span>` +
                      icon(
                        s.sessionId === current?.sessionId
                          ? 'check'
                          : 'chevron',
                      ),
                    'modal-row',
                    `${attrs} aria-current="${s.sessionId === current?.sessionId}"`,
                  )}${button(
                    'delete-session',
                    '删除',
                    'secondary-action history-delete',
                    `${attrs} aria-label="删除对话：${e(s.title)}" ${s.active ? 'disabled title="对话正在执行，停止后可删除"' : ''}`,
                  )}${confirming === s.sessionId ? `<div class="history-confirm"><p>删除这段对话？已有文档、报告和任务保留。</p><div class="operation-actions">${button('cancel-delete', '取消', 'secondary-action', attrs)}${button('confirm-delete', '确认删除', 'secondary-action history-delete', attrs)}</div></div>` : ''}</div>`;
                })
                .join('') || '<p>暂无对话。</p>';
            if (working)
              list
                .querySelectorAll('button')
                .forEach((b) => (b.disabled = true));
            root.querySelector('[data-action=disconnect]').disabled = working;
          }
          draw();
          list.onclick = (event) => {
            const b = event.target.closest('[data-action]');
            if (!b || busy || working) return;
            const s = rows.find((row) => row.sessionId === b.dataset.session);
            if (!s) return;
            const action = b.dataset.action;
            feedback.hidden = true;
            if (action === 'delete-session' || action === 'cancel-delete') {
              confirming = action === 'delete-session' ? s.sessionId : null;
              draw();
              list
                .querySelector(
                  `[data-action="${confirming ? 'cancel-delete' : 'delete-session'}"][data-session="${s.sessionId}"]`,
                )
                ?.focus();
              return;
            }
            void run(async () => {
              working = true;
              draw();
              try {
                if (action === 'session') {
                  render(await call('read', {sessionId: s.sessionId}));
                  close();
                  return;
                }
                await call('delete', {
                  sessionId: s.sessionId,
                  expectedVersion: s.version,
                });
                rows = rows.filter((row) => row.sessionId !== s.sessionId);
                confirming = null;
                drafts.delete(s.sessionId);
                if (current?.sessionId === s.sessionId) clearConversation();
              } catch (error) {
                if (
                  [
                    'assistant_session_changed',
                    'assistant_busy',
                    'assistant_session_not_found',
                  ].includes(error.code)
                ) {
                  rows = await call('sessions');
                  confirming = null;
                }
                feedback.textContent = errorText(error);
                feedback.hidden = false;
              } finally {
                working = false;
                draw();
                if (root.open && list.isConnected)
                  (
                    list.querySelector('[data-action=session]') ||
                    root.querySelector('#close-modal')
                  )?.focus();
              }
            });
          };
          root.querySelector('[data-action=disconnect]').onclick = () => {
            close();
            clearTimeout(timer);
            token = '';
            connected = false;
            current = null;
            attachment = null;
            drafts.clear();
            input.value = '';
            setStatus();
            authView();
          };
        },
      },
    );
  }
  log.onclick = (event) => {
    if (event.target.closest('a[href^="#/"]')) {
      showDocument();
      return;
    }
    const b = event.target.closest('[data-action]');
    if (!b) return;
    const action = b.dataset.action;
    if (action === 'prompt') {
      send(b.dataset.prompt);
      return;
    }
    if (action === 'parameters') {
      openContentDialog(
        '操作参数',
        `<pre>${e(JSON.stringify(current.turn.pending.input, null, 2))}</pre>`,
      );
      return;
    }
    const ev = current?.turn?.events.find(
      (x) => String(x.sequence) === b.dataset.event,
    );
    if (action === 'result' && ev) {
      openContentDialog(
        ev.text,
        `<pre>${e(JSON.stringify(ev.result, null, 2))}</pre>`,
      );
      return;
    }
    if (action === 'download' && ev) {
      download(ev.result.fileName, ev.result.markdown);
      return;
    }
    void run(async () => {
      if (action === 'control') {
        const isReport = b.dataset.kind === 'report';
        const id = b.dataset.task;
        const result = isReport
          ? await reports('report_read', {reportId: id})
          : await tasks('task_read', {taskId: id});
        const record = result.report || result.task || result;
        const operation = isReport
          ? b.dataset.control === 'cancel'
            ? 'report_cancel'
            : 'report_generate'
          : 'task_control';
        render(
          await call('invoke', {
            sessionId: current.sessionId,
            messageId: crypto.randomUUID(),
            operation,
            input: {
              expectedVersion: record.version,
              ...(isReport
                ? {reportId: id}
                : {taskId: id, action: b.dataset.control}),
            },
          }),
        );
        return;
      }
      if (action === 'report') {
        const result = await reports('report_read', {
          reportId: b.dataset.report,
        });
        if (area.dataset.open === 'true')
          showReportReader(result, {onDocument: showDocument});
        return;
      }
      if (action === 'refresh') {
        await refresh();
        return;
      }
      if (!['confirm', 'dismiss', 'resume'].includes(action)) return;
      const value = {sessionId: current.sessionId};
      if (action !== 'resume')
        Object.assign(value, {
          turnId: current.turn.id,
          confirmationId: current.turn.pending.id,
        });
      render(await call(action, value));
    });
  };
  $('#composer').onsubmit = (event) => {
    event.preventDefault();
    send(input.value);
  };
  input.oninput = () => {
    controls();
    input.style.height = 'auto';
    input.style.height = Math.min(140, input.scrollHeight) + 'px';
  };
  input.onkeydown = (event) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      send(input.value);
    }
  };
  $('#stop').onclick = () =>
    void run(async () =>
      render(await call('cancel', {sessionId: current.sessionId})),
    );
  $('#new-chat').onclick = () => void run(openNew);
  $('#history').onclick = () => void run(history);
  $('#attach-document').onclick = () => void chooseDocument();
  $('#remove-attachment').onclick = () => {
    attachment = null;
    controls();
    input.focus();
  };
  $('#attached-document').onclick = () => {
    showDocument();
    location.hash =
      '#/reading?doc=' + encodeURIComponent(attachment.snapshotId);
  };
  $('#close-assistant').onclick = closeAssistant;
  $('#expand').onclick = () =>
    setExpanded(area.dataset.expanded !== 'true', true);
  trigger.setAttribute('aria-controls', 'assistant-panel');
  trigger.setAttribute('aria-expanded', 'false');
  trigger.onclick = () => {
    if (area.dataset.open === 'true') {
      closeAssistant();
      return;
    }
    area.dataset.open = 'true';
    setExpanded(preferredExpanded);
    trigger.setAttribute('aria-expanded', 'true');
    if (connected) void run(refresh);
    (connected ? input : $('#assistant-token'))?.focus();
  };
  document.addEventListener('keydown', (event) => {
    if (
      event.key === 'Escape' &&
      !document.querySelector('dialog[open]') &&
      area.dataset.open === 'true'
    ) {
      event.preventDefault();
      closeAssistant();
    }
  });
  document.addEventListener('visibilitychange', () =>
    document.hidden ? clearTimeout(timer) : schedule(),
  );
  let width = preference('assistant-width', 460);
  const applyWidth = (value) => {
    width = value;
    area.style.setProperty('--assistant-width', value + 'px');
  };
  applyWidth(width);
  bindDivider($('#assistant-divider'), {
    label: '助手宽度',
    getValue: () => width,
    getBounds: () => [380, Math.max(380, Math.min(640, innerWidth - 740))],
    setValue: applyWidth,
    direction: -1,
    commit: () => savePreference('assistant-width', width),
    reset: () => applyWidth(460),
  });
  window.addEventListener('workspace-ready', () => {
    preferredExpanded = preference('assistant-expanded', false);
    applyWidth(preference('assistant-width', 460));
    if (area.dataset.open === 'true') setExpanded(preferredExpanded);
  });
  setExpanded(false);
  authView();
}
