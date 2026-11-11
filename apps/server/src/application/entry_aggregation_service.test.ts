import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterEach, describe, expect, it} from 'vitest';
import {EntryAggregationService} from './entry_aggregation_service.js';
import {ExecutionAuthority} from './execution_authority.js';
import {LocalReviewPreferencesStore} from '../platform/storage/local_review_preferences_store.js';
import {patchReviewPreferences} from '../storage/review_preferences_store.js';
import {informationEntryBodySha256} from '../modules/entries/information_entry_identity.js';
import type {CurrentInformationEntry} from '../modules/entries/information_entry_contract.js';
import type {TopicRecord} from '../modules/entries/content_topics.js';
import {decodeEntrySavedQueries} from '../modules/entries/information_entry_saved_queries.js';

const id = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const owner = ExecutionAuthority.owner(id(1));
const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0))
    await rm(root, {recursive: true, force: true});
});
function entry(n: number): CurrentInformationEntry {
  const body = 'Synthetic HBM bandwidth explanation.';
  return {
    workspaceId: id(1),
    entryId: id(n),
    resourceId: id(n + 20),
    snapshotId: id(n + 40),
    revision: 1,
    revisionId: id(n + 60),
    sourceKey: 'synthetic-source',
    capturedAt: '2026-10-31T00:00:00.000Z',
    publishedAt: '2026-10-01T00:00:00.000Z',
    value: {
      titlePath: 'Synthetic HBM',
      body,
      bodySha256: informationEntryBodySha256(body),
      documentOrder: n,
      chunkMode: 'whole',
      splitRuleVersion: 'synthetic',
      isPrivate: false,
      fragmentIds: [id(n + 80)],
      contentKeywords: [],
      domains: [],
      annotations: {
        schemaVersion: 1,
        vocabularyRevision: 1,
        inputRevision: 1,
        inputBodySha256: informationEntryBodySha256(body),
        origin: 'manual',
        originVersion: 'synthetic',
        status: 'complete',
        note: '',
        readingState: 'unread',
        claims: [],
        dimensions: [
          {
            id: id(300),
            name: '实体',
            role: 'entity',
            description: '',
            enabled: true,
          },
        ],
        labels: [
          {
            dimensionId: id(300),
            term: {
              id: id(301),
              dimensionId: id(300),
              label: 'HBM',
              meaning: '',
            },
            wording: 'HBM',
            primary: true,
            evidence: {start: 10, end: 13, quote: 'HBM'},
          },
        ],
      },
    },
  };
}
async function setup() {
  const root = await mkdtemp(join(tmpdir(), 'struinfo-aggregation-'));
  roots.push(root);
  const store = new LocalReviewPreferencesStore(root);
  const rows = [entry(2), entry(3), entry(4)];
  const topic: TopicRecord = {
    id: id(500),
    version: 1,
    updatedAt: '2026-10-31T00:00:00.000Z',
    value: {
      kind: 'topic',
      name: 'Synthetic bandwidth',
      scope: 'Synthetic HBM',
      origin: 'manual',
      members: rows.map((e) => ({
        entryId: e.entryId,
        revision: 1,
        quote: 'HBM',
        reason: 'Synthetic evidence',
        decision: e.entryId === id(4) ? 'excluded' : 'included',
        origin: 'manual',
      })),
      relations: [],
      summary: '',
      summaryVersions: [],
      ruleVersion: 'synthetic',
    },
  };
  const service = new EntryAggregationService(owner, {
    preferences: store,
    entries: {loadCurrentEntries: () => Promise.resolve(rows)},
    associations: {
      loadAssociationSnapshot: () =>
        Promise.resolve({projections: [], overrides: []}),
    },
    topics: {list: () => Promise.resolve([topic])},
  });
  const capture = (extra = {}) =>
    service.capture({
      operation: 'aggregate',
      expectedRevision: 0,
      viewId: id(900),
      name: 'Synthetic aggregation',
      query: {
        sourceKey: 'synthetic-source',
        annotationFilter: {
          dimensionId: id(300),
          termIds: [id(301)],
          readingState: 'unread',
        },
        time: {field: 'published', from: '2026-10-01', to: '2026-10-31'},
      },
      topicIds: [id(500)],
      ...extra,
    });
  return {root, store, rows, service, capture};
}

describe('entry aggregation experiment', () => {
  it('combines filters with current topic membership and persists references only', async () => {
    const {root, capture} = await setup();
    const result = await capture();
    const view = result.savedQueries.views[0];
    expect(view?.aggregation?.entryIds).toEqual([id(2), id(3)]);
    expect(view?.query.annotationFilter).toEqual({
      dimensionId: id(300),
      termIds: [id(301)],
      readingState: 'unread',
    });
    const reopened = await new LocalReviewPreferencesStore(root).load(id(1));
    expect(reopened.entrySavedQueries).toEqual(result.savedQueries);
    expect(JSON.stringify(reopened.entrySavedQueries)).not.toContain(
      'Synthetic HBM bandwidth explanation.',
    );
    expect(decodeEntrySavedQueries(result.savedQueries)).toEqual(
      result.savedQueries,
    );
  });

  it('keeps membership until explicit refresh, pages references and rejects stale writes', async () => {
    const {service, capture, rows, store} = await setup();
    await capture({topicIds: []});
    rows.push(entry(5));
    const first = await service.read({viewId: id(900), limit: 2});
    expect(first.totalCount).toBe(3);
    const second = await service.read({
      viewId: id(900),
      limit: 2,
      after: first.nextCursor,
    });
    expect(second.items.map((i) => i.entry.entryId)).toEqual([id(4)]);
    await expect(capture({topicIds: []})).rejects.toMatchObject({
      code: 'saved_queries_revision_conflict',
    });
    await capture({expectedRevision: 1, topicIds: []});
    expect((await service.read({viewId: id(900)})).totalCount).toBe(4);
    rows.splice(0, 1);
    const afterRemoval = await service.read({viewId: id(900)});
    expect(afterRemoval.totalCount).toBe(3);
    expect(afterRemoval.unavailableCount).toBe(1);
    expect(
      (await store.load(id(1))).entrySavedQueries?.views[0]?.aggregation
        ?.entryIds,
    ).toHaveLength(4);
  });

  it('requires current privacy opt-in and excludes stale topic members without model calls', async () => {
    const {capture, service, rows} = await setup();
    const privateEntry = entry(2);
    rows[0] = {
      ...privateEntry,
      value: {...privateEntry.value, isPrivate: true},
    };
    rows[1] = {...entry(3), revision: 2};
    await capture({query: {includePrivate: true}});
    expect((await service.read({viewId: id(900)})).totalCount).toBe(0);
    expect(
      (await service.read({viewId: id(900), includePrivate: true})).items.map(
        (i) => i.entry.entryId,
      ),
    ).toEqual([id(2)]);
    await expect(
      capture({
        expectedRevision: 1,
        query: {text: 'HBM', retrievalMode: 'semantic'},
      }),
    ).rejects.toMatchObject({code: 'aggregation_requires_text_search'});
    await expect(
      capture({expectedRevision: 1, topicIds: [id(501)]}),
    ).rejects.toMatchObject({code: 'aggregation_topic_not_found'});
  });

  it('continues to read existing saved queries without creating references implicitly', async () => {
    const {store, service} = await setup();
    await store.update(id(1), (current) => ({
      next: patchReviewPreferences(current, {
        entrySavedQueries: {
          version: 1,
          revision: 1,
          views: [
            {
              viewId: id(900),
              name: 'Existing query',
              query: {
                includePrivate: false,
                annotationFilter: {dimensionId: id(300), termIds: [id(301)]},
              },
            },
          ],
        },
      }),
      result: undefined,
    }));
    await expect(service.read({viewId: id(900)})).rejects.toMatchObject({
      code: 'aggregation_not_collected',
    });
    expect(
      (await store.load(id(1))).entrySavedQueries?.views[0]?.query
        .annotationFilter?.termIds,
    ).toEqual([id(301)]);
  });
});
