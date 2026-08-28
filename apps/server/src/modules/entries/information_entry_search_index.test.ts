import {describe, expect, it} from 'vitest';

import type {CurrentInformationEntry} from './information_entry_contract.js';
import {
  cosineSimilarityBasisPoints,
  prepareInformationEntrySearchProjection,
  tokenizeInformationEntryText,
  withInformationEntryEmbedding,
} from './information_entry_search_index.js';
import {INFORMATION_ENTRY_EMBEDDING_INPUT_MAXIMUM_UTF8_BYTES} from './information_entry_search_index_contract.js';

describe('InformationEntry derived search index', () => {
  it('normalizes words and emits local CJK unigrams and bigrams deterministically', () => {
    expect(tokenizeInformationEntryText('PostgreSQL，知识图谱')).toEqual([
      'postgresql',
      '知',
      '知识',
      '识',
      '识图',
      '图',
      '图谱',
      '谱',
    ]);
    expect(tokenizeInformationEntryText('Cafe\u0301 CAFÉ')).toEqual([
      'café',
      'cafÉ',
    ]);
  });

  it('builds a revision-bound, bounded public projection and field postings', () => {
    const prepared = prepareInformationEntrySearchProjection(
      currentEntry({
        titlePath: 'Synthetic Index',
        body: `知识图谱 ${'😀'.repeat(4_000)}`,
      }),
    );

    expect(Buffer.byteLength(prepared.input, 'utf8')).toBeLessThanOrEqual(
      INFORMATION_ENTRY_EMBEDDING_INPUT_MAXIMUM_UTF8_BYTES,
    );
    expect(prepared.projection).toMatchObject({
      entryId: prepared.entry.entryId,
      entryRevision: 1,
      entryRevisionId: prepared.entry.revisionId,
    });
    expect(prepared.projection.projectionSha256).toMatch(/^[0-9a-f]{64}$/u);
    expect(prepared.postings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({field: 'title', term: 'synthetic'}),
        expect.objectContaining({field: 'body', term: '知识'}),
        expect.objectContaining({field: 'tags', term: 'postgresql'}),
      ]),
    );
  });

  it('orders term postings by unsigned UTF-8 bytes rather than host locale', () => {
    const prepared = prepareInformationEntrySearchProjection(
      currentEntry({titlePath: 'Ａ é a'}),
    );

    expect(
      prepared.postings
        .filter((posting) => posting.field === 'title')
        .map((posting) => posting.term),
    ).toEqual(['a', 'é', 'Ａ']);
  });

  it('keeps private Entries out and validates vector shape without retaining caller arrays', () => {
    expect(() =>
      prepareInformationEntrySearchProjection(currentEntry({isPrivate: true})),
    ).toThrow(/Private Entries/u);

    const projection =
      prepareInformationEntrySearchProjection(currentEntry()).projection;
    const vector = [1, 0];
    const embedded = withInformationEntryEmbedding(
      projection,
      'synthetic-provider',
      'synthetic-model',
      vector,
    );
    vector[0] = 0;
    expect(embedded.embedding).toEqual([1, 0]);
    expect(() =>
      withInformationEntryEmbedding(
        projection,
        'synthetic-provider',
        'synthetic-model',
        [Number.NaN],
      ),
    ).toThrow(/Invalid Information Entry embedding/u);
  });

  it('computes bounded cosine similarity known answers', () => {
    expect(cosineSimilarityBasisPoints([1, 0], [1, 0])).toBe(10_000);
    expect(cosineSimilarityBasisPoints([1, 0], [0, 1])).toBe(0);
    expect(cosineSimilarityBasisPoints([1, 1], [1, 0])).toBe(7_071);
    expect(cosineSimilarityBasisPoints([1], [1, 0])).toBe(0);
  });
});

function currentEntry(
  overrides: Readonly<{
    titlePath?: string;
    body?: string;
    isPrivate?: boolean;
  }> = {},
): Readonly<CurrentInformationEntry> {
  return Object.freeze({
    workspaceId: '11111111-1111-4111-8111-111111111111',
    entryId: '22222222-2222-4222-8222-222222222222',
    resourceId: '33333333-3333-4333-8333-333333333333',
    snapshotId: '44444444-4444-4444-8444-444444444444',
    revision: 1,
    revisionId: '55555555-5555-4555-8555-555555555555',
    sourceKey: 'synthetic:index-source',
    capturedAt: '2040-01-01T00:00:00.000Z',
    value: Object.freeze({
      documentOrder: 0,
      titlePath: overrides.titlePath ?? 'Synthetic Entry',
      body: overrides.body ?? 'PostgreSQL search index body',
      bodySha256: 'a'.repeat(64),
      chunkMode: 'split' as const,
      splitRuleVersion: 'struinfo.entry-split.section.v1',
      isPrivate: overrides.isPrivate ?? false,
      typeKeyword: 'knowledge_explanation' as const,
      contentKeywords: Object.freeze([
        Object.freeze({
          displayValue: 'PostgreSQL',
          normalizedValue: 'postgresql',
          origin: 'manual' as const,
          originVersion: 'manual-entry-editor.v1',
        }),
      ]),
      domains: Object.freeze([
        Object.freeze({
          keyword: 'engineering_computing' as const,
          origin: 'manual' as const,
          originVersion: 'manual-entry-editor.v1',
        }),
      ]),
      fragmentIds: Object.freeze(['66666666-6666-4666-8666-666666666666']),
    }),
  });
}
