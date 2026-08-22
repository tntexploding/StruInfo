import {describe, expect, it} from 'vitest';

import type {
  CurrentInformationEntry,
  InformationEntryAssociationProjection,
  InformationEntryAssociationRepositorySnapshot,
} from './index.js';
import {
  InformationEntrySearchCursorError,
  searchCurrentInformationEntries,
} from './information_entry_search.js';

const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';
const RESOURCE_ID = '22222222-2222-4222-8222-222222222222';
const SNAPSHOT_ID = '33333333-3333-4333-8333-333333333333';

describe('complete InformationEntry search', () => {
  it('combines keyword, source, document, custom type/domain, chunk and published-time filters', () => {
    const entry = currentEntry('00000000-0000-4000-8000-000000000001', {
      publishedAt: '2040-01-03T00:00:00.000Z',
      typeKeyword: 'other',
      typeCustomName: 'Tool note',
      domains: [
        domain('engineering_computing'),
        domain('other', 'Database systems'),
      ],
    });

    const result = searchCurrentInformationEntries([entry], {
      text: 'postgresql',
      contentKeyword: 'POSTGRESQL',
      sourceKey: entry.sourceKey,
      snapshotId: entry.snapshotId,
      typeKeyword: 'other',
      typeCustomName: 'tool note',
      domainKeyword: 'other',
      domainCustomName: 'database systems',
      domainScope: 'secondary',
      chunkMode: 'split',
      time: {field: 'published', from: '2040-01-01', to: '2040-01-31'},
      includePrivate: false,
      limit: 25,
    });

    expect(result.totalCount).toBe(1);
    expect(result.items[0]).toMatchObject({
      entry: {entryId: entry.entryId},
      matchReasons: ['body', 'content_keyword'],
      filterReasons: [
        'content_keyword',
        'source',
        'document',
        'type',
        'domain',
        'chunk_mode',
        'published_time',
      ],
    });
    expect(result.querySha256).toMatch(/^[0-9a-f]{64}$/u);
  });

  it('uses a query-bound exclusive cursor for stable pages', () => {
    const entries = [1, 2, 3].map((value) =>
      currentEntry(
        `00000000-0000-4000-8000-${value.toString().padStart(12, '0')}`,
        {documentOrder: value - 1},
      ),
    );
    const first = searchCurrentInformationEntries(entries, {
      includePrivate: false,
      limit: 2,
    });
    expect(first.items.map((item) => item.entry.entryId)).toEqual([
      entries[0]?.entryId,
      entries[1]?.entryId,
    ]);
    expect(first.nextCursor).toBeDefined();
    if (first.nextCursor === undefined) throw new Error('cursor missing');
    const nextCursor = first.nextCursor;

    const second = searchCurrentInformationEntries(entries, {
      includePrivate: false,
      limit: 2,
      after: nextCursor,
    });
    expect(second.totalCount).toBe(3);
    expect(second.items.map((item) => item.entry.entryId)).toEqual([
      entries[2]?.entryId,
    ]);
    expect(second.nextCursor).toBeUndefined();
    expect(() =>
      searchCurrentInformationEntries(entries, {
        includePrivate: true,
        limit: 2,
        after: nextCursor,
      }),
    ).toThrow(InformationEntrySearchCursorError);
  });

  it('traverses at most two visible association hops and explains the path', () => {
    const entryA = currentEntry('00000000-0000-4000-8000-000000000001');
    const entryB = currentEntry('00000000-0000-4000-8000-000000000002');
    const entryC = currentEntry('00000000-0000-4000-8000-000000000003');
    const openSnapshot = associationSnapshot([
      projection(entryA, entryB, 8_000),
      projection(entryB, entryC, 6_000),
    ]);

    const result = searchCurrentInformationEntries(
      [entryA, entryB, entryC],
      {
        association: {
          entryId: entryA.entryId,
          maximumDepth: 2,
          minimumScore: 5_000,
        },
        includePrivate: false,
        limit: 25,
      },
      openSnapshot,
    );
    expect(
      result.items.map((item) => ({
        entryId: item.entry.entryId,
        depth: item.association?.depth,
        score: item.association?.effectiveScore,
        pathLength: item.association?.path.length,
      })),
    ).toEqual([
      {entryId: entryB.entryId, depth: 1, score: 8_000, pathLength: 1},
      {entryId: entryC.entryId, depth: 2, score: 6_000, pathLength: 2},
    ]);

    const blocked = searchCurrentInformationEntries(
      [entryA, entryB, entryC],
      {
        association: {
          entryId: entryA.entryId,
          maximumDepth: 2,
          minimumScore: 5_000,
        },
        includePrivate: false,
        limit: 25,
      },
      associationSnapshot(openSnapshot.projections, [
        {
          workspaceId: WORKSPACE_ID,
          entryLowId: entryB.entryId,
          entryHighId: entryC.entryId,
          revision: 1,
          revisionId: '90000000-0000-4000-8000-000000000001',
          value: {action: 'block', manualAdjustment: 0, isBlocked: true},
        },
      ]),
    );
    expect(blocked.items.map((item) => item.entry.entryId)).toEqual([
      entryB.entryId,
    ]);
  });
});

function currentEntry(
  entryId: string,
  overrides: Readonly<{
    documentOrder?: number;
    publishedAt?: string;
    typeKeyword?: 'knowledge_explanation' | 'other';
    typeCustomName?: string;
    domains?: CurrentInformationEntry['value']['domains'];
  }> = {},
): Readonly<CurrentInformationEntry> {
  return Object.freeze({
    workspaceId: WORKSPACE_ID,
    entryId,
    resourceId: RESOURCE_ID,
    snapshotId: SNAPSHOT_ID,
    revision: 1,
    revisionId: entryId.replace('00000000-', '10000000-'),
    sourceKey: 'synthetic:entry-source',
    capturedAt: '2040-01-04T00:00:00.000Z',
    ...(overrides.publishedAt === undefined
      ? {}
      : {publishedAt: overrides.publishedAt}),
    value: Object.freeze({
      documentOrder: overrides.documentOrder ?? 0,
      titlePath: 'Synthetic Entry',
      body: 'PostgreSQL-backed searchable body',
      bodySha256: 'a'.repeat(64),
      chunkMode: 'split' as const,
      splitRuleVersion: 'struinfo.entry-split.section.v1',
      isPrivate: false,
      typeKeyword: overrides.typeKeyword ?? 'knowledge_explanation',
      ...(overrides.typeCustomName === undefined
        ? {}
        : {typeCustomName: overrides.typeCustomName}),
      contentKeywords: Object.freeze([
        Object.freeze({
          displayValue: 'PostgreSQL',
          normalizedValue: 'postgresql',
          origin: 'manual' as const,
          originVersion: 'manual-entry-editor.v1',
        }),
      ]),
      domains:
        overrides.domains ?? Object.freeze([domain('engineering_computing')]),
      fragmentIds: Object.freeze(['55555555-5555-4555-8555-555555555555']),
    }),
  });
}

function domain(
  keyword: 'engineering_computing' | 'other',
  customName?: string,
) {
  return Object.freeze({
    keyword,
    ...(customName === undefined ? {} : {customName}),
    origin: 'manual' as const,
    originVersion: 'manual-entry-editor.v1',
  });
}

function projection(
  first: Readonly<CurrentInformationEntry>,
  second: Readonly<CurrentInformationEntry>,
  baseScore: number,
): Readonly<InformationEntryAssociationProjection> {
  const [low, high] =
    first.entryId < second.entryId ? [first, second] : [second, first];
  return Object.freeze({
    workspaceId: WORKSPACE_ID,
    entryLowId: low.entryId,
    entryHighId: high.entryId,
    entryLowRevision: low.revision,
    entryLowRevisionId: low.revisionId,
    entryHighRevision: high.revision,
    entryHighRevisionId: high.revisionId,
    contentSimilarity: baseScore,
    typeSimilarity: 10_000,
    domainSimilarity: 10_000,
    baseScore,
    algorithmVersion: 'synthetic.v1',
    candidateBasis: Object.freeze(['content_keyword' as const]),
    candidateRank: 1,
  });
}

function associationSnapshot(
  projections: InformationEntryAssociationRepositorySnapshot['projections'],
  overrides: InformationEntryAssociationRepositorySnapshot['overrides'] = [],
): Readonly<InformationEntryAssociationRepositorySnapshot> {
  return Object.freeze({projections, overrides});
}
