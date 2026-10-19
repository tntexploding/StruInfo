import {describe, it, expect, vi} from 'vitest';
import {SourceHistoryService} from './source_history_service.js';
import {AgentCommands} from './agent_commands.js';
import {ExecutionAuthority} from './execution_authority.js';
import type {EvidenceSnapshotSummary} from '../modules/evidence/index.js';
import type {ReviewSourceSubscription} from '../storage/review_preferences_store.js';
import type {
  HistoryArticle,
  HistoryPageResult,
  SourceHistoryReader,
} from '../modules/subscriptions/source_history.js';
function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error('missing synthetic value');
  return value;
}
const A = '11111111-1111-4111-8111-111111111111',
  B = '22222222-2222-4222-8222-222222222222';
const source = (
  id: string,
): Extract<ReviewSourceSubscription, {kind: 'rss_atom'}> => ({
  subscriptionId: id,
  label: 'Synthetic ' + id,
  kind: 'rss_atom',
  sourceAlias: 'synthetic',
  enabled: false,
  isPrivate: false,
  routeAfterImport: false,
  intervalMinutes: 60,
  feedUrl: 'https://example.invalid/feed',
  itemLimit: 5,
});
const row = (
  url: string,
  date?: string,
): HistoryPageResult['articles'][number] => ({
  url: 'https://example.invalid/' + url,
  title: 'Synthetic ' + url,
  access: 'unknown',
  ...(date ? {publishedAt: date} : {}),
});
function fixture() {
  let sources: ReviewSourceSubscription[] = [source(A), source(B)];
  const snapshots: EvidenceSnapshotSummary[] = [];
  const read = vi.fn<SourceHistoryReader['read']>().mockResolvedValue({
    articles: [
      row('first', '2024-01-02T00:00:00Z'),
      row('second', '2025-01-02T00:00:00Z'),
      row('undated'),
    ],
    next: [],
    method: '站点地图',
  });
  const article = vi
    .fn<SourceHistoryReader['article']>()
    .mockImplementation((a) =>
      Promise.resolve({
        title: a.title,
        access: 'unknown',
        document: {
          externalId: a.id,
          version: 'v1',
          canonicalUri: a.url,
          mediaType: 'text/html',
          profile: 'commonmark-v1',
          sourceUtf8: new TextEncoder().encode('# Synthetic body'),
          publication: {
            inferred: false,
            instant: '2024-01-02T00:00:00Z',
            precision: 'second',
          },
        },
      }),
    );
  const importer = vi.fn(
    async (
      s: ReviewSourceSubscription,
      d: Awaited<ReturnType<typeof article>>['document'],
    ) => {
      await Promise.resolve();
      if (d.canonicalUri.endsWith('undated'))
        throw new Error('synthetic_failure');
      const snapshotId = snapshots.length ? B : A;
      snapshots.push({
        workspaceId: A,
        snapshotId,
        resourceId: B,
        resourceKind: 'remote_document',
        sourceKey: s.label,
        canonicalUri: d.canonicalUri,
        capturedAt: '2026-01-01T00:00:00Z',
        fragmentCount: 1,
      });
      return {snapshotId, outcome: 'created' as const};
    },
  );
  const service = new SourceHistoryService({
    sources: () => Promise.resolve(sources),
    snapshots: () => Promise.resolve(snapshots),
    reader: {read, article},
    importArticle: importer,
  });
  const open = async () => {
    const v = (await service.execute('history_open', {
      sources: [{subscriptionId: A}, {subscriptionId: B}],
    })) as {sessionId: string};
    return v.sessionId;
  };
  const list = async (sessionId: string, input = {}) =>
    service.execute('history_list', {sessionId, ...input}) as Promise<{
      articles: HistoryArticle[];
      total: number;
      undated: number;
      sources: {pending: number; status: string}[];
    }>;
  const prepare = async (input: {
    sessionId: string;
    ids: string[];
    perSourceLimit?: number;
    from?: string;
    to?: string;
    subscriptionIds?: string[];
  }) =>
    service.execute('history_prepare_import', input) as Promise<{
      planId: string;
    }>;
  const importRows = async (input: {sessionId: string; ids: string[]}) =>
    service.execute('history_import', {...input, ...(await prepare(input))});
  return {
    service,
    prepare,
    importRows,
    read,
    article,
    importer,
    open,
    list,
    snapshots,
    setSources: (next: ReviewSourceSubscription[]) => {
      sources = next;
    },
  };
}
describe('owner history backfill', () => {
  it('restores an expired selection without fetching or importing, and retains duplicate checks', async () => {
    const f = fixture(),
      sessionId = await f.open();
    await f.service.execute('history_scan', {sessionId, subscriptionId: A});
    const articles = (await f.list(sessionId)).articles.filter(
      (a) => a.publishedAt,
    );
    const first = required(articles.find((a) => a.url.endsWith('first')));
    await f.importRows({sessionId, ids: [first.id]});
    await f.service.execute('history_close', {sessionId});
    f.read.mockClear();
    f.article.mockClear();
    f.importer.mockClear();
    const restored = (await f.service.execute('history_restore', {
      articles: articles.map((a) => ({
        subscriptionId: a.subscriptionId,
        url: a.url,
        title: a.title,
        access: a.access,
        publishedAt: a.publishedAt,
      })),
    })) as {sessionId: string};
    expect(f.read).not.toHaveBeenCalled();
    expect(f.article).not.toHaveBeenCalled();
    expect(f.importer).not.toHaveBeenCalled();
    expect(
      (await f.list(restored.sessionId)).articles.map((a) => a.id),
    ).toEqual(articles.map((a) => a.id));
    expect(
      await f.importRows({sessionId: restored.sessionId, ids: [first.id]}),
    ).toMatchObject({results: [{status: 'existing'}]});
    expect(f.importer).not.toHaveBeenCalled();
  });
  it('rejects private, changed and foreign restored sources and does not reserve a broken session', async () => {
    const f = fixture();
    for (let i = 0; i < 9; i++)
      await expect(
        f.service.execute('history_restore', {
          articles: [
            {
              ...row('bad'),
              subscriptionId: A,
              url: 'https://foreign.invalid/article',
            },
          ],
        }),
      ).rejects.toMatchObject({code: 'history_article_not_same_site'});
    f.setSources([{...source(A), isPrivate: true}]);
    await expect(
      f.service.execute('history_restore', {
        articles: [{...row('first'), subscriptionId: A}],
      }),
    ).rejects.toMatchObject({code: 'history_source_unsupported'});
    f.setSources([source(A)]);
    const restored = (await f.service.execute('history_restore', {
      articles: [{...row('first'), subscriptionId: A}],
    })) as {sessionId: string};
    const item = required((await f.list(restored.sessionId)).articles[0]);
    f.setSources([{...source(A), feedUrl: 'https://changed.invalid/feed'}]);
    expect(
      await f.importRows({sessionId: restored.sessionId, ids: [item.id]}),
    ).toMatchObject({results: [{code: 'history_source_changed'}]});
    expect(f.importer).not.toHaveBeenCalled();
  });
  it('rechecks publication after restoring directory hints and keeps restore owner-only', async () => {
    const f = fixture();
    const restored = (await f.service.execute('history_restore', {
      articles: [{...row('first', '2025-01-01T00:00:00Z'), subscriptionId: A}],
    })) as {sessionId: string};
    const item = required((await f.list(restored.sessionId)).articles[0]);
    const plan = await f.prepare({
      sessionId: restored.sessionId,
      ids: [item.id],
      from: '2025-01-01',
    });
    expect(
      await f.service.execute('history_import', {
        sessionId: restored.sessionId,
        ...plan,
        ids: [item.id],
      }),
    ).toMatchObject({results: [{code: 'history_selection_changed'}]});
    expect(f.importer).not.toHaveBeenCalled();
    const commands = new AgentCommands(
      ExecutionAuthority.agent(A, 'synthetic', ['documents.read']),
      {} as ConstructorParameters<typeof AgentCommands>[1],
    );
    await expect(commands.execute('history_restore', {})).rejects.toMatchObject(
      {code: 'operation_not_authorized'},
    );
  });
  it('stops the source on rate limits instead of trying more endpoints automatically', async () => {
    const f = fixture(),
      sessionId = await f.open();
    f.read.mockRejectedValueOnce(new Error('history_http_429'));
    await f.service.execute('history_scan', {sessionId, subscriptionId: A});
    const state = (await f.list(sessionId)).sources[0];
    expect(state).toMatchObject({status: 'waiting', pending: 0});
    await f.service.execute('history_scan', {sessionId, subscriptionId: A});
    expect(f.read).toHaveBeenCalledTimes(1);
    await f.service.execute('history_scan', {
      sessionId,
      subscriptionId: A,
      retry: true,
    });
    expect(f.read).toHaveBeenCalledTimes(2);
  });

  it('combines sources and uses publication dates without admitting undated rows into a range', async () => {
    const f = fixture(),
      sessionId = await f.open();
    for (const subscriptionId of [A, B])
      await f.service.execute('history_scan', {sessionId, subscriptionId});
    expect((await f.list(sessionId)).total).toBe(6);
    const result = await f.list(sessionId, {
      from: '2024-01-01',
      to: '2024-12-31',
    });
    expect(result.total).toBe(2);
    expect(result.undated).toBe(2);
    const selection = (await f.service.execute('history_select', {
      sessionId,
      from: '2024-01-01',
      to: '2024-12-31',
    })) as {ids: string[]};
    expect(selection.ids).toHaveLength(2);
    expect(f.importer).not.toHaveBeenCalled();
    await expect(f.list(sessionId, {from: '2025-02-30'})).rejects.toMatchObject(
      {code: 'history_invalid_request'},
    );
    await expect(
      f.list(sessionId, {from: '2025-01-01', to: '2024-01-01'}),
    ).rejects.toMatchObject({code: 'history_invalid_request'});
  });
  it('deduplicates across sources, concurrent selections and retries while keeping per-item failures', async () => {
    const f = fixture(),
      sessionId = await f.open();
    for (const subscriptionId of [A, B])
      await f.service.execute('history_scan', {sessionId, subscriptionId});
    const rows = (await f.list(sessionId)).articles;
    const selected = rows
      .filter((a) => a.url.endsWith('first'))
      .map((a) => a.id);
    const plan = await f.prepare({sessionId, ids: selected});
    const [first, second] = (await Promise.all([
      f.service.execute('history_import', {sessionId, ids: selected, ...plan}),
      f.service.execute('history_import', {sessionId, ids: selected, ...plan}),
    ])) as {results: {status: string}[]}[];
    expect(first?.results.map((r) => r.status)).toEqual([
      'imported',
      'existing',
    ]);
    expect(second?.results.every((r) => r.status === 'existing')).toBe(true);
    expect(f.importer).toHaveBeenCalledTimes(1);
    const errors = (await f.importRows({
      sessionId,
      ids: [
        required(rows.find((a) => a.url.endsWith('undated'))).id,
        required(rows.find((a) => a.url.endsWith('second'))).id,
      ],
    })) as {results: {status: string}[]};
    expect(errors.results.map((r) => r.status)).toEqual(['failed', 'imported']);
    expect(f.importer.mock.calls[0]?.[1].publication?.instant).toBe(
      '2024-01-02T00:00:00Z',
    );
  });
  it('does not overwrite existing evidence or owner rejection, and rejects source changes and foreign item IDs', async () => {
    const f = fixture(),
      sessionId = await f.open();
    await f.service.execute('history_scan', {sessionId, subscriptionId: A});
    const item = required((await f.list(sessionId)).articles[0]);
    f.snapshots.push({
      workspaceId: A,
      snapshotId: A,
      resourceId: A,
      resourceKind: 'remote_document',
      sourceKey: 'already rejected',
      canonicalUri: item.url,
      capturedAt: '2023-01-01T00:00:00Z',
      fragmentCount: 1,
    });
    expect(await f.importRows({sessionId, ids: [item.id]})).toMatchObject({
      results: [{status: 'existing'}],
    });
    expect(f.article).not.toHaveBeenCalled();
    const plan = await f.prepare({sessionId, ids: [item.id]});
    f.setSources([{...source(A), feedUrl: 'https://changed.invalid/feed'}]);
    expect(
      await f.service.execute('history_import', {
        sessionId,
        ids: [item.id],
        ...plan,
      }),
    ).toMatchObject({results: [{code: 'history_source_changed'}]});
    await expect(
      f.service.execute('history_import', {
        sessionId,
        ids: ['f'.repeat(64)],
        ...plan,
      }),
    ).rejects.toMatchObject({code: 'history_selection_changed'});
    await expect(
      f.prepare({sessionId, ids: ['f'.repeat(64)]}),
    ).rejects.toMatchObject({code: 'history_article_not_found'});
    expect(f.importer).not.toHaveBeenCalled();
  });
  it('retains readable rows after one channel fails and permits explicit retry', async () => {
    const f = fixture(),
      sessionId = await f.open();
    await f.service.execute('history_scan', {sessionId, subscriptionId: A});
    f.read.mockRejectedValueOnce(new Error('history_http_503'));
    await f.service.execute('history_scan', {sessionId, subscriptionId: A});
    expect((await f.list(sessionId)).sources[0]?.pending).toBeGreaterThan(0);
    expect((await f.list(sessionId)).total).toBe(3);
    await f.service.execute('history_scan', {
      sessionId,
      subscriptionId: A,
      retry: true,
    });
    expect(f.read).toHaveBeenCalledTimes(3);
  });
  it('selects newest articles under independent source quotas and supports source filtering', async () => {
    const f = fixture(),
      sessionId = await f.open();
    for (const subscriptionId of [A, B])
      await f.service.execute('history_scan', {sessionId, subscriptionId});
    const selected = (await f.service.execute('history_select', {
      sessionId,
      perSourceLimit: 1,
    })) as {articles: Pick<HistoryArticle, 'id' | 'subscriptionId'>[]};
    expect(selected.articles).toHaveLength(2);
    expect(new Set(selected.articles.map((a) => a.subscriptionId))).toEqual(
      new Set([A, B]),
    );
    const rows = (await f.list(sessionId)).articles;
    expect(
      selected.articles.every((a) =>
        rows.find((r) => r.id === a.id)?.url.endsWith('second'),
      ),
    ).toBe(true);
    expect(
      (await f.list(sessionId, {subscriptionIds: [A]})).articles.every(
        (a) => a.subscriptionId === A,
      ),
    ).toBe(true);
    const ids = rows.filter((a) => a.subscriptionId === A).map((a) => a.id);
    await expect(
      f.prepare({sessionId, ids, perSourceLimit: 1}),
    ).rejects.toMatchObject({code: 'history_source_limit_exceeded'});
    await expect(
      f.prepare({sessionId, ids, from: '2025-01-01'}),
    ).rejects.toMatchObject({code: 'history_selection_changed'});
    await expect(
      f.prepare({sessionId, ids, perSourceLimit: 0}),
    ).rejects.toMatchObject({code: 'history_invalid_request'});
    expect(f.importer).not.toHaveBeenCalled();
  });
  it('freezes bounded selection across requests and prevents stale or extra IDs from importing', async () => {
    const f = fixture(),
      sessionId = await f.open();
    await f.service.execute('history_scan', {sessionId, subscriptionId: A});
    const rows = (await f.list(sessionId)).articles;
    const first = required(rows.find((a) => a.url.endsWith('first'))),
      second = required(rows.find((a) => a.url.endsWith('second')));
    const plan = await f.prepare({
      sessionId,
      ids: [first.id],
      perSourceLimit: 1,
    });
    await expect(
      f.service.execute('history_import', {
        sessionId,
        ids: [second.id],
        ...plan,
      }),
    ).rejects.toMatchObject({code: 'history_selection_changed'});
    expect(f.importer).not.toHaveBeenCalled();
    expect(
      await f.service.execute('history_import', {
        sessionId,
        ids: [first.id],
        ...plan,
      }),
    ).toMatchObject({results: [{status: 'imported'}]});
    expect(
      await f.service.execute('history_import', {
        sessionId,
        ids: [first.id],
        ...plan,
      }),
    ).toMatchObject({results: [{status: 'existing'}]});
    await f.prepare({sessionId, ids: [second.id], perSourceLimit: 1});
    await expect(
      f.service.execute('history_import', {
        sessionId,
        ids: [first.id],
        ...plan,
      }),
    ).rejects.toMatchObject({code: 'history_selection_changed'});
    expect(f.importer).toHaveBeenCalledTimes(1);
  });
  it('does not import an article whose resolved publication falls outside the selected range', async () => {
    const f = fixture(),
      sessionId = await f.open();
    await f.service.execute('history_scan', {sessionId, subscriptionId: A});
    const item = required(
      (await f.list(sessionId)).articles.find((a) => a.url.endsWith('second')),
    );
    const plan = await f.prepare({
      sessionId,
      ids: [item.id],
      from: '2025-01-01',
      to: '2025-12-31',
    });
    // The synthetic page resolves to 2024 although its directory says 2025.
    expect(
      await f.service.execute('history_import', {
        sessionId,
        ids: [item.id],
        ...plan,
      }),
    ).toMatchObject({
      results: [{status: 'failed', code: 'history_selection_changed'}],
    });
    expect(f.importer).not.toHaveBeenCalled();
  });
  it('never exposes backfill to an external Agent grant', async () => {
    const commands = new AgentCommands(
      ExecutionAuthority.agent(A, 'synthetic', ['sources.capture']),
      {} as ConstructorParameters<typeof AgentCommands>[1],
    );
    await expect(commands.execute('history_import', {})).rejects.toMatchObject({
      code: 'operation_not_authorized',
    });
  });
  it('restricts custom directories to the source website and closes disposable sessions', async () => {
    const f = fixture();
    await expect(
      f.service.execute('history_open', {
        sources: [
          {subscriptionId: A, archiveUrl: 'https://foreign.invalid/archive'},
        ],
      }),
    ).rejects.toMatchObject({code: 'history_archive_not_same_site'});
    const sessionId = await f.open();
    await f.service.execute('history_close', {sessionId});
    await expect(f.list(sessionId)).rejects.toMatchObject({
      code: 'history_session_expired',
    });
  });
});
