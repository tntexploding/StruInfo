import {entryTagWords} from '../../runtime/tags.js';
import {pageContext} from '../../runtime/route.js';
const page = pageContext('database');
import {titleOf, textOf, documentRead} from '../../runtime/documents.js';
import {
  request,
  research,
  ingestion,
  safeUrl,
  attempt,
  failure,
} from './api.js';
import {escapeHtml as e, openDialog, toast} from './sample-ui.js';
export const selection = new Map();
let serial = 0,
  lastQuery,
  lastAggregation,
  lastMode,
  nextCursor;
const results = page.root.querySelector('#result-space');
const list = document.createElement('div');
list.id = 'query-results';
list.style.cssText = 'overflow:auto;min-height:0;flex:1';
results.insertBefore(list, page.root.querySelector('#result-tools'));
results.style.cssText = 'display:flex;flex-direction:column;min-height:0';
const empty = results.querySelector('.result-empty');
const toolButtons = [...page.root.querySelectorAll('#result-tools button')];
function tools() {
  toolButtons.forEach((b) => (b.disabled = !selection.size));
}
export async function showRelations(entryId) {
  const [response, preview] = await Promise.all([
    ingestion('topics_list', {entryId}),
    ingestion('topics_preview', {entryId}),
  ]);
  const count = preview.input.entries.length;
  const budget = response.budget;
  const active = response.jobs.find((j) =>
    ['queued', 'running'].includes(j.status),
  );
  const canStart =
    count > 1 && budget && !budget.paused && budget.remainingCny > 0 && !active;
  const reason = active
    ? '主题任务已排队，可在总览查看进度。'
    : count < 2
      ? '没有足够的候选条目。'
      : !budget
        ? '请先在 AI 设置中配置预算。'
        : budget.paused
          ? '当前 AI 预算已暂停。'
          : budget.remainingCny <= 0
            ? '当前 AI 预算已用完。'
            : `本次读取 ${count} 个条目，预算余额 ${budget.remainingCny.toFixed(2)} 元。`;
  openDialog(
    '主题与联系',
    `<div class="form-footer"><button class="primary-action compact-action" data-generate-topic ${canStart ? '' : 'disabled'}>生成主题</button><a class="quiet-button" href="#/overview">查看任务</a></div><p role="status" data-topic-status>${e(reason)}</p>` +
      (response.topics.length
        ? response.topics
            .map(
              (t) =>
                `<article class="search-result"><h3>${e(t.value.name)}</h3><p>${e(t.value.scope)}</p>${t.value.relations
                  .filter((r) => !r.blocked)
                  .map(
                    (r) =>
                      `<p>${e(r.reason)}<br><button class="quiet-button" data-ref="${r.from.entryId}">查看第一篇</button><button class="quiet-button" data-ref="${r.to.entryId}">查看第二篇</button></p>`,
                  )
                  .join('')}</article>`,
            )
            .join('')
        : '<p>暂无已保存的主题与联系</p>'),
    (root) =>
      (root.onclick = async (ev) => {
        const b = ev.target.closest('[data-ref]');
        if (b) void openEntry(b.dataset.ref);
        const generate = ev.target.closest('[data-generate-topic]');
        if (!generate || generate.disabled) return;
        generate.disabled = true;
        try {
          await ingestion('topic_job_start', {
            scope: {entryId},
            budgetId: budget.batchId,
          });
          root.querySelector('[data-topic-status]').textContent =
            '主题任务已提交，可在总览查看进度。';
        } catch (error) {
          root.querySelector('[data-topic-status]').textContent =
            failure(error);
          generate.disabled = false;
        }
      }),
  );
}
export async function openEntry(entryId) {
  const r = await request('entries/query-context', {
    entryId,
    includePrivate: lastQuery?.includePrivate === true,
  });
  openDialog(
    r.entry.value.titlePath,
    `<article class="sample-reading"><p>${e(r.entry.value.body).replaceAll('\n', '<br>')}</p></article><footer class="form-footer"><button class="secondary-action compact-action" data-relations>查看联系</button><a class="primary-action compact-action" href="#/reading?doc=${r.entry.snapshotId}">阅读全文</a></footer>`,
    (root) => {
      root.querySelector('a[href^="#/reading"]').onclick = () => {
        pageContext('reading').state.includePrivate =
          lastQuery?.includePrivate === true;
      };
      return (root.querySelector('[data-relations]').onclick = () =>
        attempt(() => showRelations(entryId), toast));
    },
  );
}
function entryRows(items) {
  return items
    .map(
      ({entry, semanticMatch}) =>
        `<article class="search-result"><div class="result-source"><label class="inline-checks"><input type="checkbox" data-select="${entry.entryId}" ${selection.has(entry.entryId) ? 'checked' : ''}>${e(titleOf(entry))}</label><time>${e((entry.publishedAt || entry.capturedAt).slice(0, 10))}</time></div><h3><button data-entry="${entry.entryId}">${e(entry.value.titlePath)}</button></h3><p>${e(entry.value.body.slice(semanticMatch?.passage?.start ?? 0, (semanticMatch?.passage?.start ?? 0) + 480))}</p><div class="result-tags">${entryTagWords(
          entry.value,
        )
          .map((t) => `<span class="tag-chip">${e(t)}</span>`)
          .join(
            '',
          )}</div><div class="result-actions"><a href="#/reading?doc=${entry.snapshotId}">阅读全文</a><button data-links="${entry.entryId}">查看联系</button></div></article>`,
    )
    .join('');
}
let currentItems = [];
let newsItems = [];
list.addEventListener('change', (ev) => {
  const id = ev.target.dataset.select;
  if (id) {
    ev.target.checked
      ? selection.set(
          id,
          currentItems.find((i) => i.entry.entryId === id).entry,
        )
      : selection.delete(id);
    tools();
  }
});
list.addEventListener('click', (ev) => {
  if (ev.target.closest('a[href^="#/reading"]'))
    pageContext('reading').state.includePrivate =
      lastQuery?.includePrivate === true;
  const b = ev.target.closest('button');
  if (!b) return;
  if (b.dataset.news)
    void attempt(async () => {
      const item = newsItems.find((i) => i.snapshotId === b.dataset.news);
      if (!item) return;
      const result = await documentRead(
        item.bodySnapshotId || item.snapshotId,
        lastQuery?.includePrivate === true,
        {request},
      );
      const url = safeUrl(item.canonicalUri);
      const original = textOf(result.snapshot);
      const heading = /^#\s+([^\r\n]+)\r?\n(?:\r?\n)*/u.exec(original);
      const body =
        heading?.[1].trim() === item.title
          ? original.slice(heading[0].length)
          : original;
      openDialog(
        item.title,
        `<p class="field-note">${e(item.source)} · ${e(new Date(item.publishedAt).toLocaleString())}</p><article class="sample-reading"><p>${e(body).replaceAll('\n', '<br>')}</p></article>${url ? `<footer class="form-footer"><a class="secondary-action compact-action" href="${e(url)}" target="_blank" rel="noreferrer">查看来源</a></footer>` : ''}`,
      );
    }, toast);
  if (b.dataset.entry) void attempt(() => openEntry(b.dataset.entry), toast);
  if (b.dataset.links)
    void attempt(() => showRelations(b.dataset.links), toast);
  if (b.dataset.capture)
    void attempt(async () => {
      await research('web_capture', {
        sessionId: list.dataset.session,
        index: Number(b.dataset.capture) - 1,
      });
      b.disabled = true;
      b.textContent = '已加入待审核';
    }, toast);
  if (b.id === 'next-results')
    void executeSearch(
      {
        mode: lastMode || 'search',
        evidence: 'local',
        query: {...lastQuery, after: nextCursor},
        aggregation: lastAggregation,
      },
      true,
    );
});
toolButtons[0].onclick = () =>
  attempt(() => showRelations(selection.keys().next().value), toast);
toolButtons[1].onclick = () => page.root.querySelector('#new-report').click();
export async function executeSearch(
  {mode, evidence, query, question, webQuery, aggregation},
  append = false,
) {
  const token = ++serial;
  lastMode = mode;
  if (!append) {
    selection.clear();
    tools();
    list.replaceChildren();
  }
  empty.hidden = false;
  page.root.querySelector('#result-note').textContent = '正在读取';
  page.root.querySelector('#result-explanation').textContent = '';
  try {
    if (mode === 'news') {
      lastQuery = query;
      const r = await ingestion('news_list', {...query, limit: 20});
      if (token !== serial) return;
      newsItems = append ? [...newsItems, ...r.items] : r.items;
      nextCursor = r.nextCursor;
      list.querySelector('#next-results')?.remove();
      list.insertAdjacentHTML(
        'beforeend',
        r.items
          .map(
            (item) =>
              `<article class="search-result"><div class="result-source"><span>${e(item.source)}</span><time>${e(new Date(item.publishedAt).toLocaleString())}</time></div><h3><button data-news="${item.snapshotId}">${e(item.title)}</button></h3></article>`,
          )
          .join('') +
          (nextCursor
            ? '<button class="secondary-action compact-action" id="next-results">下一页</button>'
            : ''),
      );
    } else if (mode === 'ask') {
      const r = await research('research_answer', {
        requestKey: crypto.randomUUID(),
        question,
        mode: evidence,
        query,
        webQuery: evidence === 'local' ? undefined : webQuery,
      });
      if (token !== serial) return;
      const answer = r.answer || r.summary || '';
      list.innerHTML = `<article class="answer-card"><h3>回答</h3><p>${e(typeof answer === 'string' ? answer : JSON.stringify(answer)).replaceAll('\n', '<br>')}</p>${(r.points || r.claims || []).map((p) => `<p>${e(p.text || p.statement)} ${(p.evidenceRefs || []).map((n) => `[${e(n)}]`).join(' ')}</p>`).join('')}<div class="answer-references">${(r.evidence || []).map((ref) => `<div>[${e(ref.handle)}] ${ref.entryId ? `<button class="quiet-button" data-entry="${ref.entryId}">${e(ref.titlePath || '引用原文')}</button>` : safeUrl(ref.url) ? `<a href="${e(safeUrl(ref.url))}" target="_blank" rel="noreferrer">${e(ref.titlePath || ref.url)}</a>` : e(ref.titlePath || '网页资料')}</div>`).join('')}</div>${(r.limitations || []).map((t) => `<small>${e(t)}</small>`).join('<br>')}</article>`;
    } else if (evidence === 'web') {
      const r = await research('web_search', {
        requestKey: crypto.randomUUID(),
        query: question,
      });
      if (token !== serial) return;
      list.dataset.session = r.sessionId;
      list.innerHTML = r.results
        .map(
          (a, i) =>
            `<article class="search-result"><h3><a href="${e(safeUrl(a.url))}" target="_blank" rel="noreferrer">${e(a.title)}</a></h3><p>${e(a.summary)}</p><button class="secondary-action compact-action" data-capture="${i + 1}">加入待审核</button></article>`,
        )
        .join('');
    } else {
      lastQuery = query;
      lastAggregation = aggregation;
      const r = aggregation
        ? await request('entries/aggregations/read', {
            viewId: aggregation.viewId,
            includePrivate: query.includePrivate,
            onlyPrivate: query.onlyPrivate ?? false,
            limit: 20,
            ...(query.after ? {after: query.after} : {}),
          })
        : await request('entries/search', {...query, limit: 20});
      if (token !== serial) return;
      page.root.querySelector('#result-explanation').textContent =
        r.retrievalFallback
          ? r.retrievalFallback === 'index_incomplete'
            ? '部分内容尚未生成向量，已同时使用文字搜索。'
            : '向量服务未启用或暂不可用，已使用文字搜索。'
          : '';
      nextCursor = r.nextCursor;
      currentItems = append ? [...currentItems, ...r.items] : r.items;
      list.querySelector('#next-results')?.remove();
      list.insertAdjacentHTML(
        'beforeend',
        entryRows(r.items) +
          (nextCursor
            ? '<button class="secondary-action compact-action" id="next-results">下一页</button>'
            : ''),
      );
      page.root.querySelector('#result-title').textContent =
        `${aggregation ? r.name : '查询结果'} · ${r.totalCount} 条`;
      if (aggregation) {
        page.root.querySelector('#result-scope').textContent =
          '聚合 · 已保存引用';
        if (r.unavailableCount && !append)
          list.insertAdjacentHTML(
            'beforeend',
            `<p class="field-note">${r.unavailableCount} 条引用已移除或在当前范围不可见。</p>`,
          );
      }
    }
    empty.hidden = Boolean(list.textContent.trim());
    page.root.querySelector('#result-note').textContent = '没有匹配的内容';
  } catch (error) {
    if (token !== serial) return;
    empty.hidden = false;
    page.root.querySelector('#result-note').textContent = failure(error);
  }
}
