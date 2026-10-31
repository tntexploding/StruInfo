import {inbox} from './api.js';
import {documentRead} from './api.js';
import {ingestion, request} from './api.js';
import {textOf, titleOf} from '../../runtime/documents.js';
import {escape as e, sourceRecord} from './store.js';
let rows = [],
  selected = 0,
  sessionId,
  privateScope = false,
  generation = 0,
  readSequence = 0;
export const receipts = () => rows;
export async function renderReceipts(id, root, includePrivate = false) {
  const token = ++generation;
  ++readSequence;
  privateScope = includePrivate;
  const items = await inbox(includePrivate);
  const origins = [];
  for (let i = 0; i < items.length; i += 100) {
    const out = await ingestion('intake_origins', {
      snapshotIds: items.slice(i, i + 100).map((s) => s.snapshotId),
      includePrivate: privateScope,
    });
    origins.push(...(out.origins || out.items || []));
  }
  if (token !== generation || !root.isConnected) return;
  rows = items.filter((s) =>
    origins.some(
      (o) =>
        o.snapshotId === s.snapshotId &&
        (id === 'manual'
          ? ['upload', 'manual_text', 'uploaded_file'].includes(o.kind)
          : o.subscriptionId === id),
    ),
  );
  const source = sourceRecord(id),
    next = source?.receivingStatus?.nextCheckAt;
  root.innerHTML = `<div class="dock-layout"><header class="dock-top"><div><span class="live-dot"></span>下次检查 <strong>${next ? e(new Date(next).toLocaleString()) : id === 'manual' ? '手动放入' : source?.enabled ? '按接收计划执行' : '已暂停'}</strong></div><button class="compact-button" data-action="check-now" ${id === 'manual' ? 'hidden' : ''}>立即检查</button></header><div class="recent-body"><section class="receipt-list" aria-label="最近接收">${rows.map((a, i) => `<button data-article="${i}" aria-pressed="${i === 0}"><small>${e(new Date(a.capturedAt).toLocaleDateString())} · ${receiptLabel(a)}</small><strong>${e(titleOf(a))}</strong><span>${e(source?.label || '')}</span></button>`).join('') || '<p>暂无接收记录</p>'}</section><article class="receipt-reader"><header><small id="receipt-kind"></small><h3 id="receipt-title"></h3></header><div id="receipt-body"></div><footer><span id="receipt-status"></span><button class="compact-button" data-review="拒绝" ${rows.length ? '' : 'disabled'}>拒绝</button><button class="compact-button primary" data-review="接受" ${rows.length ? '' : 'disabled'}>接受</button></footer></article></div></div>`;
  if (rows.length) await selectReceipt(0, root);
}
const receiptLabel = (a) =>
  ({accepted: '已接受', rejected: '已拒绝', pending: '待审核'})[
    a.intake?.value.receipt
  ] || '待审核';
export async function selectReceipt(index, root) {
  const token = ++readSequence;
  selected = index;
  const a = rows[index];
  if (!a) return;
  const result = await documentRead(a.snapshotId, privateScope);
  if (token !== readSequence || !root.isConnected) return;
  root.querySelector('#receipt-title').textContent = titleOf(a);
  root.querySelector('#receipt-body').innerHTML = textOf(result.snapshot)
    .split('\n\n')
    .map((p) => `<p>${e(p).replaceAll('\n', '<br>')}</p>`)
    .join('');
  root.querySelector('#receipt-status').textContent = receiptLabel(a);
  root.querySelectorAll('[data-review]').forEach((button) => {
    button.disabled = a.intake?.value.receipt !== 'pending';
  });
  root
    .querySelectorAll('[data-article]')
    .forEach((b) =>
      b.setAttribute(
        'aria-pressed',
        String(Number(b.dataset.article) === index),
      ),
    );
}
export async function reviewReceipt(action) {
  const a = rows[selected];
  await ingestion('intake_receive', {
    items: [
      {snapshotId: a.snapshotId, expectedVersion: a.intake?.version || 0},
    ],
    action: action === '接受' ? 'accept' : 'reject',
    processAccepted: action === '接受',
  });
}
export async function checkSource(id) {
  await request(`source-subscriptions/${id}/run`, {});
}
export async function searchHistory(root) {
  const ids = [...root.querySelectorAll('[name="history-source"]:checked')].map(
    (i) => i.value,
  );
  if (!ids.length) throw new Error('先选择来源');
  if (sessionId) await ingestion('history_close', {sessionId});
  const archiveUrl = root.querySelector('[data-archive]')?.value;
  const opened = await ingestion('history_open', {
    sources: ids.map((subscriptionId) => ({
      subscriptionId,
      ...(archiveUrl ? {archiveUrl} : {}),
    })),
  });
  sessionId = opened.sessionId;
  for (const subscriptionId of ids)
    await ingestion('history_scan', {sessionId, subscriptionId});
  const filter = historyFilter(root);
  const found = await ingestion('history_select', {sessionId, ...filter});
  const chosen = new Set(found.ids),
    articles = [];
  const listFilter = {...filter};
  delete listFilter.perSourceLimit;
  let offset = 0,
    total = Infinity;
  while (offset < total) {
    const page = await ingestion('history_list', {
      sessionId,
      ...listFilter,
      offset,
    });
    articles.push(...page.articles.filter((a) => chosen.has(a.id)));
    total = page.total;
    offset += page.articles.length;
    if (!page.articles.length) break;
  }
  root.querySelector('#history-results').hidden = false;
  root.querySelector('#history-results').innerHTML =
    articles
      .map(
        (a) =>
          `<label><input type="checkbox" name="history-result" value="${a.id}"><span>${e(a.title)} · ${e(sourceRecord(a.subscriptionId)?.label || a.subscriptionId)}</span></label>`,
      )
      .join('') || '<p>未找到符合条件的往期资料</p>';
}
const historyFilter = (root) => ({
  from: root.querySelector('#history-from').value || undefined,
  to: root.querySelector('#history-to').value || undefined,
  text: root.querySelector('#history-query').value,
  perSourceLimit: Number(root.querySelector('#history-limit').value),
});
export async function importHistory(root) {
  const ids = [...root.querySelectorAll('[name="history-result"]:checked')].map(
    (i) => i.value,
  );
  const plan = await ingestion('history_prepare_import', {
    sessionId,
    ids,
    ...historyFilter(root),
  });
  for (let i = 0; i < ids.length; i += 8)
    await ingestion('history_import', {
      sessionId,
      planId: plan.planId,
      ids: ids.slice(i, i + 8),
    });
  return ids.length;
}
