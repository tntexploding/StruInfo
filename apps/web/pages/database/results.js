import {pageContext} from '../../runtime/route.js';
const page = pageContext('database');
import {titleOf} from '../../runtime/documents.js';
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
  const response = await ingestion('topics_list', {entryId});
  openDialog(
    '主题与联系',
    response.topics.length
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
      : '<p>暂无已保存的主题与联系</p>',
    (root) =>
      (root.onclick = (ev) => {
        const b = ev.target.closest('[data-ref]');
        if (b) void openEntry(b.dataset.ref);
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
      ({entry}) =>
        `<article class="search-result"><div class="result-source"><label class="inline-checks"><input type="checkbox" data-select="${entry.entryId}" ${selection.has(entry.entryId) ? 'checked' : ''}>${e(titleOf(entry))}</label><time>${e((entry.publishedAt || entry.capturedAt).slice(0, 10))}</time></div><h3><button data-entry="${entry.entryId}">${e(entry.value.titlePath)}</button></h3><p>${e(entry.value.body.slice(0, 480))}</p><div class="result-tags">${entry.value.contentKeywords.map((t) => `<span class="tag-chip">${e(t.displayValue)}</span>`).join('')}</div><div class="result-actions"><a href="#/reading?doc=${entry.snapshotId}">阅读全文</a><button data-links="${entry.entryId}">查看联系</button></div></article>`,
    )
    .join('');
}
let currentItems = [];
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
        mode: 'search',
        evidence: 'local',
        query: {...lastQuery, after: nextCursor},
      },
      true,
    );
});
toolButtons[0].onclick = () =>
  attempt(() => showRelations(selection.keys().next().value), toast);
toolButtons[1].onclick = () => page.root.querySelector('#new-report').click();
export async function executeSearch(
  {mode, evidence, query, question, webQuery},
  append = false,
) {
  const token = ++serial;
  if (!append) {
    selection.clear();
    tools();
    list.replaceChildren();
  }
  empty.hidden = false;
  page.root.querySelector('#result-note').textContent = '正在读取';
  page.root.querySelector('#result-explanation').textContent = '';
  try {
    if (mode === 'ask') {
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
      const r = await request('entries/search', {...query, limit: 20});
      if (token !== serial) return;
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
        `查询结果 · ${r.totalCount} 条`;
    }
    empty.hidden = Boolean(list.textContent.trim());
    page.root.querySelector('#result-note').textContent = '没有匹配的内容';
  } catch (error) {
    if (token !== serial) return;
    empty.hidden = false;
    page.root.querySelector('#result-note').textContent = failure(error);
  }
}
