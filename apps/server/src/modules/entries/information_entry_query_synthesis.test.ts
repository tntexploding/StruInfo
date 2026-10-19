import {InformationEntryRetrievalService} from './information_entry_retrieval.js';
import {describe, expect, it, vi} from 'vitest';

import type {CurrentInformationEntry} from './information_entry_contract.js';
import {
  InformationEntryQuerySynthesisService,
  prepareInformationEntryQuerySynthesisEvidence,
} from './information_entry_query_synthesis.js';
import {
  InformationEntryQuerySynthesisServiceError,
  type InformationEntryQuerySynthesisProviderPort,
} from './information_entry_query_synthesis_contract.js';

const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';

describe('InformationEntryQuerySynthesisService', () => {
  it('reruns the public query and maps top evidence through request-local handles', async () => {
    const entries = Array.from({length: 9}, (_, index) => entry(index));
    const synthesize = vi.fn<
      InformationEntryQuerySynthesisProviderPort['synthesize']
    >(() =>
      Promise.resolve({
        answer: '只基于合成资料的回答',
        evidenceStatus: 'supported',
        claims: [{statement: '第一项事实', evidenceRefs: ['E01']}],
        limitations: [],
      }),
    );
    const service = new InformationEntryQuerySynthesisService({
      workspaceId: WORKSPACE_ID,
      entries: entryRepository(entries),
      associations: associationRepository(),
      provider: provider(synthesize),
    });

    const result = await service.synthesize({
      requestId: 'query-synthesis:1',
      question: '这些资料说明了什么？',
      query: {includePrivate: false, onlyPrivate: false, limit: 8},
    });

    expect(result.requestId).toBe('query-synthesis:1');
    expect(result.evidence).toHaveLength(8);
    expect(result.evidence.map((item) => item.handle)).toEqual([
      'E01',
      'E02',
      'E03',
      'E04',
      'E05',
      'E06',
      'E07',
      'E08',
    ]);
    expect(result.evidence.every((item) => item.excerpt.length === 3_000)).toBe(
      true,
    );
    expect(
      result.evidence.reduce(
        (total, item) => total + Array.from(item.excerpt).length,
        0,
      ),
    ).toBe(24_000);
    const providerEvidence = synthesize.mock.calls[0]?.[1];
    expect(JSON.stringify(providerEvidence)).not.toContain(WORKSPACE_ID);
    expect(JSON.stringify(providerEvidence)).not.toContain('synthetic:source');
    expect(result.evidence[0]).toMatchObject({
      entryId: '00000000-0000-4000-8000-000000000001',
      entryRevision: 1,
      snapshotId: '10000000-0000-4000-8000-000000000001',
    });
  });

  it('uses the same confirmed alias retrieval for RAG and retains original tags and factual excerpts', async () => {
    const original = entry(0);
    const entries = entryRepository([original, entry(1, true)]);
    const associations = associationRepository();
    const retrieval = new InformationEntryRetrievalService({
      workspaceId: WORKSPACE_ID,
      entries,
      associations,
      index: {
        loadSearchIndex: () => Promise.resolve({projections: [], postings: []}),
        replaceSearchIndex: () => Promise.reject(new Error('no write')),
      },
      aliases: () =>
        Promise.resolve([{source: 'Synthetic label', canonical: '合成关键词'}]),
    });
    const synthesize = vi.fn<
      InformationEntryQuerySynthesisProviderPort['synthesize']
    >(() =>
      Promise.resolve({
        answer: '材料不足',
        evidenceStatus: 'insufficient',
        claims: [],
        limitations: ['标签本身不是事实证据'],
      }),
    );
    const service = new InformationEntryQuerySynthesisService({
      workspaceId: WORKSPACE_ID,
      entries,
      associations,
      retrieval,
      provider: provider(synthesize),
    });
    const result = await service.synthesize({
      requestId: 'synthetic-alias-rag',
      question: '有哪些事实？',
      query: {
        text: 'Synthetic label',
        textFields: ['tags'],
        includePrivate: false,
        limit: 8,
      },
    });
    expect(result.evidence).toHaveLength(1);
    expect(result.evidence[0]).toMatchObject({
      entryId: original.entryId,
      contentKeywords: ['合成关键词'],
    });
    expect(result.evidence[0]?.excerpt).toBe(original.value.body);
    expect(synthesize.mock.calls[0]?.[1]?.[0]?.contentKeywords).toEqual([
      '合成关键词',
    ]);
  });

  it('rejects private scope before repository and Provider access', async () => {
    const loadCurrentEntries = vi.fn(() => Promise.resolve([]));
    const synthesize =
      vi.fn<InformationEntryQuerySynthesisProviderPort['synthesize']>();
    const service = new InformationEntryQuerySynthesisService({
      workspaceId: WORKSPACE_ID,
      entries: entryRepository([], loadCurrentEntries),
      associations: associationRepository(),
      provider: provider(synthesize),
    });

    await expect(
      service.synthesize({
        requestId: 'query-synthesis:private',
        question: '不应发送',
        query: {includePrivate: true, onlyPrivate: true, limit: 8},
      }),
    ).rejects.toEqual(
      new InformationEntryQuerySynthesisServiceError(
        'ai_query_private_scope_forbidden',
      ),
    );
    expect(loadCurrentEntries).not.toHaveBeenCalled();
    expect(synthesize).not.toHaveBeenCalled();
  });

  it('rejects empty evidence and provider references outside the local map', async () => {
    const emptyService = new InformationEntryQuerySynthesisService({
      workspaceId: WORKSPACE_ID,
      entries: entryRepository([]),
      associations: associationRepository(),
      provider: provider(() => Promise.reject(new Error('unreachable'))),
    });
    await expect(
      emptyService.synthesize({
        requestId: 'query-synthesis:empty',
        question: '没有资料',
        query: {includePrivate: false, onlyPrivate: false, limit: 8},
      }),
    ).rejects.toMatchObject({code: 'ai_query_no_evidence'});

    const invalidService = new InformationEntryQuerySynthesisService({
      workspaceId: WORKSPACE_ID,
      entries: entryRepository([entry(0)]),
      associations: associationRepository(),
      provider: provider(() =>
        Promise.resolve({
          answer: '伪造引用',
          evidenceStatus: 'supported',
          claims: [{statement: '伪造', evidenceRefs: ['E09']}],
          limitations: [],
        }),
      ),
    });
    await expect(
      invalidService.synthesize({
        requestId: 'query-synthesis:invalid',
        question: '检查引用',
        query: {includePrivate: false, onlyPrivate: false, limit: 8},
      }),
    ).rejects.toMatchObject({code: 'ai_query_invalid_citations'});
  });

  it('rejects private records if a repository violates its public-read contract', () => {
    expect(() =>
      prepareInformationEntryQuerySynthesisEvidence([entry(0, true)]),
    ).toThrow(
      new InformationEntryQuerySynthesisServiceError(
        'ai_query_private_scope_forbidden',
      ),
    );
  });
});

function provider(
  synthesize: InformationEntryQuerySynthesisProviderPort['synthesize'],
): InformationEntryQuerySynthesisProviderPort {
  return {
    providerKey: 'openai-responses-v1',
    model: 'gpt-5-mini',
    promptVersion: 'synthetic-query-v1',
    synthesize,
  };
}

function entryRepository(
  entries: readonly Readonly<CurrentInformationEntry>[],
  loadCurrentEntries = vi.fn(() => Promise.resolve(entries)),
) {
  return {
    materializeEntries: () =>
      Promise.resolve({outcome: 'existing' as const, createdCount: 0}),
    reviseEntry: () => Promise.resolve('not_found' as const),
    loadCurrentEntries,
  };
}

function associationRepository() {
  return {
    replaceAssociationProjections: () => Promise.resolve(0),
    loadAssociationSnapshot: () =>
      Promise.resolve({projections: [], overrides: []}),
    writeAssociationOverride: () => Promise.resolve('not_found' as const),
  };
}

function entry(
  index: number,
  isPrivate = false,
): Readonly<CurrentInformationEntry> {
  const suffix = String(index + 1).padStart(12, '0');
  return Object.freeze({
    workspaceId: WORKSPACE_ID,
    entryId: `00000000-0000-4000-8000-${suffix}`,
    resourceId: '20000000-0000-4000-8000-000000000001',
    snapshotId: `10000000-0000-4000-8000-${suffix}`,
    revision: 1,
    revisionId: `30000000-0000-4000-8000-${suffix}`,
    sourceKey: `synthetic:source:${String(index)}`,
    capturedAt: '2040-01-02T03:04:05.000Z',
    value: Object.freeze({
      documentOrder: index,
      titlePath: `合成条目 ${String(index + 1)}`,
      body: '文'.repeat(3_500),
      bodySha256: 'a'.repeat(64),
      chunkMode: 'split',
      splitRuleVersion: 'synthetic-v1',
      isPrivate,
      typeKeyword: 'knowledge_explanation',
      contentKeywords: Object.freeze([
        Object.freeze({
          displayValue: '合成关键词',
          normalizedValue: '合成关键词',
          origin: 'rule',
          originVersion: 'synthetic-v1',
        }),
      ]),
      domains: Object.freeze([]),
      fragmentIds: Object.freeze([`40000000-0000-4000-8000-${suffix}`]),
    }),
  });
}

it('retrieves for the new question instead of taking recent unrelated documents, and excludes private matches', async () => {
  const source = entry(0);
  const relevant = {
    ...source,
    value: {
      ...source.value,
      titlePath: 'Synthetic battery study',
      body: 'Battery storage retains energy with a measured capacity limit.',
    },
  };
  const unrelated = {
    ...entry(1),
    value: {
      ...entry(1).value,
      titlePath: 'Synthetic gardening',
      body: 'Planting in spring.',
    },
  };
  const hidden = {
    ...entry(2, true),
    value: {
      ...entry(2, true).value,
      titlePath: 'Private battery study',
      body: 'Battery details that stay private.',
    },
  };
  const synthesize = vi.fn<
    InformationEntryQuerySynthesisProviderPort['synthesize']
  >(() =>
    Promise.resolve({
      answer: 'Storage has limits.',
      evidenceStatus: 'supported',
      claims: [{statement: 'Capacity is limited.', evidenceRefs: ['E01']}],
      limitations: [],
    }),
  );
  const service = new InformationEntryQuerySynthesisService({
    workspaceId: WORKSPACE_ID,
    entries: entryRepository([unrelated, hidden, relevant]),
    associations: associationRepository(),
    provider: provider(synthesize),
  });
  const result = await service.synthesize({
    requestId: 'question-recall',
    retrieveForQuestion: true,
    question: 'What are the battery storage limits?',
    query: {includePrivate: false, limit: 8},
  });
  expect(result.evidence.map((e) => e.entryId)).toEqual([relevant.entryId]);
  expect(JSON.stringify(synthesize.mock.calls)).not.toContain('stay private');
  await expect(
    service.synthesize({
      requestId: 'no-match',
      retrieveForQuestion: true,
      question: 'Tell me about zebras',
      query: {includePrivate: false, limit: 8},
    }),
  ).rejects.toMatchObject({code: 'ai_query_no_evidence'});
  expect(synthesize).toHaveBeenCalledTimes(1);
});
