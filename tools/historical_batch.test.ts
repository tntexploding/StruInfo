import {describe, it, expect} from 'vitest';
import {createHash} from 'node:crypto';
import {
  SourceHistoryService,
  type historySchemas,
} from '../apps/server/src/application/source_history_service.js';
import {
  attachManifest,
  type HistoryCommand,
} from './historical_batch_runner.js';
import {
  prepareManifest,
  validateManifest,
  type Candidate,
  type PreparationInput,
} from './historical_batch_plan.js';

function required<T>(v: T | undefined): T {
  if (v === undefined) throw new Error('missing synthetic value');
  return v;
}
const source = '11111111-1111-4111-8111-111111111111';
const other = '22222222-2222-4222-8222-222222222222';
function candidate(i: number, subscriptionId = source): Candidate {
  return {
    id: i.toString(16).padStart(64, '0'),
    subscriptionId,
    url: `https://example.invalid/story/${String(i)}`,
    title: `Synthetic item ${String(i)}`,
    publishedAt: `2025-${String((i % 12) + 1).padStart(2, '0')}-02T00:00:00Z`,
    access: 'public',
    completeness: 'unchecked',
  };
}
function input(): PreparationInput {
  return {
    id: 'synthetic',
    workspaceId: source,
    from: '2024-01-01',
    to: '2026-09-26',
    batchSize: 2,
    sources: [
      {
        subscriptionId: source,
        label: 'Synthetic source',
        limit: 5,
        previouslyAccepted: 1,
      },
    ],
    candidates: Array.from({length: 8}, (_, i) => candidate(i + 1)),
    previouslyReviewedUrls: [],
    task: {
      maxModelCalls: 64,
    },
  };
}
describe('historical batch preparation', () => {
  it('attaches a CLI manifest to the same frozen selection as the web page', async () => {
    const i = input();
    const rows = [candidate(1), candidate(2)].map((r) => ({
      ...r,
      id: createHash('sha256')
        .update(source + '\0' + r.url)
        .digest('hex'),
    }));
    i.candidates = rows;
    const m = prepareManifest(i);
    const service = new SourceHistoryService({
      publicReceipts: () => Promise.resolve([]),
      sources: () =>
        Promise.resolve([
          {
            subscriptionId: source,
            label: 'Example',
            kind: 'rss_atom',
            sourceAlias: 'example',
            isPrivate: false,
            enabled: false,
            intervalMinutes: 60,
            itemLimit: 2,
            feedUrl: 'https://example.invalid/feed',
          },
        ]),
      reader: {
        read: () => Promise.resolve({articles: rows, next: [], method: 'RSS'}),
        article: () => {
          throw Error('capture was not authorized');
        },
      },
      importArticle: () => {
        throw Error('capture was not authorized');
      },
    });
    const call: HistoryCommand = <T>(name: string, body?: unknown) =>
      service.execute(
        name as keyof typeof historySchemas,
        body ?? {},
      ) as Promise<T>;
    const opened = await call<{sessionId: string}>('history_open', {
      sources: [{subscriptionId: source}],
    });
    await call('history_scan', {
      sessionId: opened.sessionId,
      subscriptionId: source,
    });
    const selection = {ids: rows.map((r) => r.id), from: m.from, to: m.to};
    const web = await call<{sessionId: string; planId: string}>(
      'history_prepare_import',
      {sessionId: opened.sessionId, ...selection},
    );
    expect(await attachManifest(m, 1, call)).toBe(web.sessionId);
    expect(await attachManifest(m, 1, call)).toBe(web.sessionId);
    expect(await call('history_status')).toMatchObject({
      sessions: [
        {
          sessionId: web.sessionId,
          batchKey: 'synthetic-1',
          plan: {planId: web.planId, pending: 2, submitted: 0},
        },
      ],
    });
    await service.drain();
  });
  it('applies the cumulative cap across all batches and does not fill exclusions with paid content', () => {
    const i = input();
    i.previouslyReviewedUrls = [required(i.candidates[0]).url];
    required(i.candidates[1]).access = 'restricted';
    required(i.candidates[2]).completeness = 'incomplete';
    const m = prepareManifest(i);
    expect(m.articles).toHaveLength(4);
    expect(m.articles.map((a) => a.batch)).toEqual([1, 1, 2, 2]);
    expect(m.reserve).toHaveLength(1);
    expect(m.excluded.map((a) => a.reason)).toEqual([
      'previously_received_or_reviewed',
      'restricted',
      'incomplete',
    ]);
    expect(m.articles.every((a) => a.completeness === 'unchecked')).toBe(true);
  });
  it('deduplicates across sources and tracking links but preserves meaningful query strings', () => {
    const i = input();
    i.sources.push({
      subscriptionId: other,
      label: 'Other source',
      limit: 5,
      previouslyAccepted: 0,
    });
    i.candidates = [
      candidate(1),
      {...candidate(2, other), url: candidate(1).url + '?utm_source=synthetic'},
      {...candidate(3), url: 'https://example.invalid/read?id=1'},
      {...candidate(4), url: 'https://example.invalid/read?id=2'},
    ];
    const m = prepareManifest(i);
    expect(m.articles).toHaveLength(3);
    expect(m.excluded[0]?.reason).toBe('duplicate_url');
  });
  it('keeps unknown dates and retrieval failures out of the execution manifest', () => {
    const i = input();
    delete required(i.candidates[0]).publishedAt;
    required(i.candidates[1]).completeness = 'unavailable';
    required(i.candidates[2]).publishedAt = '2023-01-01T00:00:00Z';
    const m = prepareManifest(i);
    expect(m.excluded.map((a) => a.reason)).toEqual([
      'unknown_publication_date',
      'needs_fetch_review',
      'outside_date_range',
    ]);
    required(m.sources[0]).previouslyAccepted = 5;
    expect(() => {
      validateManifest(m);
    }).toThrow('cumulative_source_cap_exceeded');
  });
  it('interleaves sources and samples throughout the date range rather than only newest material', () => {
    const i = input();
    i.sources.push({
      subscriptionId: other,
      label: 'Other',
      limit: 2,
      previouslyAccepted: 0,
    });
    i.candidates.push(candidate(20, other), candidate(21, other));
    const m = prepareManifest(i);
    expect(m.articles.slice(0, 4).map((a) => a.subscriptionId)).toEqual([
      source,
      other,
      source,
      other,
    ]);
    expect(
      m.articles.filter((a) => a.subscriptionId === source).map((a) => a.id),
    ).not.toEqual(i.candidates.slice(0, 4).map((a) => a.id));
  });
});
