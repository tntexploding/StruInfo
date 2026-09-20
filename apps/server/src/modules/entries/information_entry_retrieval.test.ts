import {describe, expect, it, vi} from 'vitest';
import type {
  EntryTranslation,
  EntryTranslationSearchRepositoryPort,
} from './information_entry_translation.js';

import type {InformationEntryAssociationRepositoryPort} from './information_entry_association_repository.js';
import type {CurrentInformationEntry} from './information_entry_contract.js';
import {InformationEntryRetrievalService} from './information_entry_retrieval.js';
import type {InformationEntryRepositoryPort} from './information_entry_repository.js';
import {
  InformationEntryRetrievalServiceError,
  type InformationEntryEmbeddingProviderPort,
  type InformationEntrySearchIndexRepositoryPort,
  type InformationEntrySearchIndexSnapshot,
} from './information_entry_search_index_contract.js';

const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';

describe('InformationEntryRetrievalService', () => {
  it('keeps alias-only candidates when an accelerated index would return no literal matches', async () => {
    const fixture = harness(false);
    const source = currentEntry(
      '22222222-2222-4222-8222-222222222221',
      'Synthetic network',
      'A public fact.',
    );
    const entries = [
      {
        ...source,
        value: {
          ...source.value,
          contentKeywords: [
            {
              displayValue: '无线网络',
              normalizedValue: '无线网络',
              origin: 'manual' as const,
              originVersion: 'synthetic',
            },
          ],
        },
      },
    ];
    const findCandidates = vi.fn(() => Promise.resolve([] as string[]));
    const aliases = vi.fn(() =>
      Promise.resolve([{source: 'WiFi', canonical: '无线网络'}]),
    );
    const service = new InformationEntryRetrievalService({
      workspaceId: WORKSPACE_ID,
      entries: {
        ...fixture.entryRepository,
        loadCurrentEntries: () => Promise.resolve(entries),
        loadCurrentEntriesByIds: () => Promise.resolve([]),
      },
      associations: fixture.associationRepository,
      index: {
        ...fixture.indexRepository,
        findLexicalCandidateEntryIds: findCandidates,
      },
      aliases,
    });
    const result = await service.search({
      text: 'WiFi',
      textFields: ['tags'],
      includePrivate: false,
      limit: 10,
    });
    expect(result.items[0]?.entry).toBe(entries[0]);
    expect(result.items[0]?.aliasMatches).toEqual([
      {query: 'WiFi', tag: '无线网络'},
    ]);
    expect(findCandidates).not.toHaveBeenCalled();
    expect(aliases).toHaveBeenCalledTimes(1);
    expect(fixture.embed).not.toHaveBeenCalled();
  });

  it('requires an explicit rebuild before treating old embedding input hashes as current', async () => {
    const fixture = harness(true);
    await fixture.service.rebuild();
    const current = fixture.snapshot;
    fixture.replaceSnapshot({
      ...current,
      projections: current.projections.map((projection) => ({
        ...projection,
        projectionSha256: '0'.repeat(64),
      })),
    });
    expect(await fixture.service.status()).toMatchObject({
      semanticSearchReady: false,
      embeddedProjectionCount: 0,
    });
    fixture.embed.mockClear();
    await expect(
      fixture.service.search({
        text: 'Alpha',
        retrievalMode: 'semantic',
        includePrivate: false,
        limit: 10,
      }),
    ).rejects.toMatchObject({code: 'semantic_search_index_not_ready'});
    expect(fixture.embed).not.toHaveBeenCalled();
    await fixture.service.rebuild();
    expect((await fixture.service.status()).semanticSearchReady).toBe(true);
  });

  it('adds cached translation candidates to a ready original index without a rebuild or full Entry load', async () => {
    const fixture = harness(false);
    const source = fixture.entries[0];
    if (source === undefined) throw new Error('Synthetic source is missing.');
    const cached: Readonly<EntryTranslation>[] = [];
    const loadTranslations = vi.fn(() => Promise.resolve(cached));
    const findCandidates = vi.fn(() =>
      Promise.resolve([] as readonly string[]),
    );
    const loadByIds = vi.fn(
      (_workspaceId: string, _private: boolean, ids: readonly string[]) =>
        Promise.resolve(
          fixture.entries.filter((entry) => ids.includes(entry.entryId)),
        ),
    );
    const service = new InformationEntryRetrievalService({
      workspaceId: WORKSPACE_ID,
      entries: {...fixture.entryRepository, loadCurrentEntriesByIds: loadByIds},
      associations: fixture.associationRepository,
      index: {
        ...fixture.indexRepository,
        findLexicalCandidateEntryIds: findCandidates,
      },
      translations: {loadCurrentTranslations: loadTranslations},
    });
    const request = {text: '合成译文', includePrivate: false, limit: 10};
    expect((await service.search(request)).totalCount).toBe(0);
    cached.push(translation(source));
    const result = await service.search(request);
    expect(result.totalCount).toBe(1);
    expect(result.items[0]?.entry).toBe(source);
    expect(result.items[0]?.matchReasons).toEqual([
      'translation_title',
      'translation_body',
    ]);
    expect(loadByIds).toHaveBeenLastCalledWith(WORKSPACE_ID, false, [
      source.entryId,
    ]);
    expect(loadTranslations).toHaveBeenCalledWith(WORKSPACE_ID);
    expect(fixture.loadEntries).not.toHaveBeenCalled();
    expect(fixture.embed).not.toHaveBeenCalled();
    expect(fixture.replacements).toBe(0);

    findCandidates.mockResolvedValue([source.entryId]);
    expect((await service.search(request)).totalCount).toBe(1);
    expect(loadByIds).toHaveBeenLastCalledWith(WORKSPACE_ID, false, [
      source.entryId,
    ]);
  });

  it.each([
    {textMode: 'substring' as const, includePrivate: false},
    {textMode: 'fuzzy' as const, includePrivate: false},
    {textMode: 'substring' as const, includePrivate: true},
  ])(
    'keeps translation matches on the complete fallback path: %j',
    async (scope) => {
      const fixture = harness(false);
      const source = fixture.entries[0];
      if (source === undefined) throw new Error('Synthetic source is missing.');
      const service = new InformationEntryRetrievalService({
        workspaceId: WORKSPACE_ID,
        entries: fixture.entryRepository,
        associations: fixture.associationRepository,
        index: {
          ...fixture.indexRepository,
          findLexicalCandidateEntryIds: () => Promise.resolve(undefined),
        },
        translations: {
          loadCurrentTranslations: () => Promise.resolve([translation(source)]),
        },
      });
      const result = await service.search({
        text: '合成译文',
        ...scope,
        limit: 10,
      });
      expect(result.items.map((item) => item.entry.entryId)).toEqual([
        source.entryId,
      ]);
      expect(fixture.loadEntries).toHaveBeenCalledTimes(1);
      expect(fixture.embed).not.toHaveBeenCalled();
    },
  );

  it('does not load caches for browsing, tag-only matching or private-only search', async () => {
    const fixture = harness(false);
    const loadTranslations = vi.fn(() =>
      Promise.reject(new Error('unnecessary translation read')),
    );
    const service = new InformationEntryRetrievalService({
      workspaceId: WORKSPACE_ID,
      entries: fixture.entryRepository,
      associations: fixture.associationRepository,
      index: fixture.indexRepository,
      translations: {loadCurrentTranslations: loadTranslations},
    });
    for (const request of [
      {text: '', includePrivate: false},
      {text: '   ', includePrivate: false},
      {text: '合成', textFields: ['tags'] as const, includePrivate: false},
      {text: '合成', includePrivate: true, onlyPrivate: true},
    ])
      await service.search({...request, limit: 10});
    expect(loadTranslations).not.toHaveBeenCalled();
    expect(fixture.embed).not.toHaveBeenCalled();
  });

  it('uses cached text only in the lexical lane of hybrid retrieval and never embeds translations', async () => {
    const source = currentEntry(
      '22222222-2222-4222-8222-222222222221',
      'Alpha',
      'first body',
    );
    const loadTranslations = vi.fn(() =>
      Promise.resolve([{...translation(source), body: 'literal-only'}]),
    );
    const fixture = harness(true, [source], {
      loadCurrentTranslations: loadTranslations,
    });
    await fixture.service.rebuild();
    expect(fixture.embed.mock.calls.flat(2).join(' ')).not.toContain(
      '合成译文',
    );
    loadTranslations.mockClear();
    const request = {text: 'literal-only', includePrivate: false, limit: 10};
    expect(
      (await fixture.service.search({...request, retrievalMode: 'semantic'}))
        .totalCount,
    ).toBe(0);
    expect(loadTranslations).not.toHaveBeenCalled();
    const hybrid = await fixture.service.search({
      ...request,
      retrievalMode: 'hybrid',
    });
    expect(hybrid.items[0]).toMatchObject({
      entry: {entryId: source.entryId},
      matchReasons: ['translation_body'],
      retrievalScore: 10_000,
    });
    expect(hybrid.items[0]?.semanticMatch).toBeUndefined();
    expect(fixture.embed).toHaveBeenLastCalledWith(['literal-only']);
  });

  it('rebuilds a wholly replaceable index and reports provider readiness', async () => {
    const fixture = harness();
    const status = await fixture.service.rebuild();

    expect(status).toMatchObject({
      publicEntryCount: 2,
      currentProjectionCount: 2,
      embeddedProjectionCount: 2,
      semanticSearchAvailable: true,
      semanticSearchReady: true,
      embeddingProvider: 'synthetic-embedding-v1',
      embeddingModel: 'synthetic-2d',
    });
    expect(fixture.snapshot.projections).toHaveLength(2);
    expect(fixture.snapshot.postings.length).toBeGreaterThan(2);
    expect(fixture.replacements).toBe(1);
  });

  it('ranks semantic results and keeps lexical-only evidence in hybrid mode', async () => {
    const fixture = harness();
    await fixture.service.rebuild();

    const semantic = await fixture.service.search({
      text: 'concept alpha',
      retrievalMode: 'semantic',
      includePrivate: false,
      onlyPrivate: false,
      limit: 10,
    });
    expect(semantic.items.map((item) => item.entry.entryId)).toEqual([
      fixture.entries[0]?.entryId,
    ]);
    expect(semantic.items[0]).toMatchObject({
      semanticMatch: {score: 10_000, model: 'synthetic-2d'},
      retrievalScore: 10_000,
    });

    const hybrid = await fixture.service.search({
      text: 'literal-only',
      textMode: 'substring',
      retrievalMode: 'hybrid',
      includePrivate: false,
      onlyPrivate: false,
      limit: 10,
    });
    expect(hybrid.items.map((item) => item.entry.entryId)).toEqual([
      fixture.entries[1]?.entryId,
    ]);
    expect(hybrid.items[0]?.semanticMatch).toBeUndefined();
    expect(hybrid.items[0]?.retrievalScore).toBe(9_000);
  });

  it('rejects private semantic scope before loading data or calling a provider', async () => {
    const fixture = harness();
    await expect(
      fixture.service.search({
        text: 'alpha',
        retrievalMode: 'semantic',
        includePrivate: true,
        onlyPrivate: false,
        limit: 10,
      }),
    ).rejects.toEqual(
      new InformationEntryRetrievalServiceError(
        'semantic_search_private_scope_forbidden',
      ),
    );
    expect(fixture.loadEntries).not.toHaveBeenCalled();
    expect(fixture.embed).not.toHaveBeenCalled();
  });

  it('evaluates synthetic recall and reciprocal rank without product expected maps', async () => {
    const fixture = harness();
    await fixture.service.rebuild();
    const alphaEntry = fixture.entries[0];
    const betaEntry = fixture.entries[1];
    if (alphaEntry === undefined || betaEntry === undefined) {
      throw new Error('Synthetic retrieval fixture is incomplete.');
    }
    const result = await fixture.service.evaluate('semantic', 2, [
      {
        caseId: 'alpha',
        query: 'concept alpha',
        expectedEntryIds: [alphaEntry.entryId],
      },
      {
        caseId: 'beta',
        query: 'concept beta',
        expectedEntryIds: [betaEntry.entryId],
      },
    ]);

    expect(result).toMatchObject({
      retrievalMode: 'semantic',
      k: 2,
      meanRecallAtK: 10_000,
      meanReciprocalRank: 10_000,
    });
    expect(result.cases).toHaveLength(2);
  });

  it('preserves lexical search when no embedding provider is configured', async () => {
    const fixture = harness(false);
    expect(fixture.service.semanticSearchAvailable).toBe(false);
    await expect(
      fixture.service.search({
        text: 'literal-only',
        retrievalMode: 'lexical',
        includePrivate: false,
        onlyPrivate: false,
        limit: 10,
      }),
    ).resolves.toMatchObject({totalCount: 1});
    await expect(
      fixture.service.search({
        text: 'alpha',
        retrievalMode: 'semantic',
        includePrivate: false,
        onlyPrivate: false,
        limit: 10,
      }),
    ).rejects.toMatchObject({code: 'semantic_search_not_configured'});
  });

  it('hydrates only indexed lexical candidates and falls back for fuzzy search', async () => {
    const entries = [
      currentEntry(
        '22222222-2222-4222-8222-222222222221',
        'Alpha',
        'first body',
      ),
      currentEntry(
        '22222222-2222-4222-8222-222222222222',
        'Beta',
        'literal-only second body',
      ),
    ];
    const loadAll = vi.fn(() => Promise.resolve(entries));
    const loadByIds = vi.fn(
      (
        _workspaceId: string,
        _includePrivate: boolean,
        entryIds: readonly string[],
      ) =>
        Promise.resolve(
          entries.filter((entry) => entryIds.includes(entry.entryId)),
        ),
    );
    const findCandidates = vi.fn(() =>
      Promise.resolve(Object.freeze([entries[1]?.entryId ?? ''])),
    );
    const service = new InformationEntryRetrievalService({
      workspaceId: WORKSPACE_ID,
      entries: {
        materializeEntries: () => Promise.reject(new Error('unexpected write')),
        reviseEntry: () => Promise.reject(new Error('unexpected write')),
        loadCurrentEntries: loadAll,
        loadCurrentEntriesByIds: loadByIds,
      },
      associations: {
        replaceAssociationProjections: () =>
          Promise.reject(new Error('unexpected write')),
        loadAssociationSnapshot: () =>
          Promise.resolve({
            projections: Object.freeze([]),
            overrides: Object.freeze([]),
          }),
        writeAssociationOverride: () =>
          Promise.reject(new Error('unexpected write')),
      },
      index: {
        loadSearchIndex: () =>
          Promise.resolve({
            projections: Object.freeze([]),
            postings: Object.freeze([]),
          }),
        replaceSearchIndex: () => Promise.reject(new Error('unexpected write')),
        findLexicalCandidateEntryIds: findCandidates,
      },
    });

    await expect(
      service.search({
        text: 'literal-only',
        textMode: 'substring',
        includePrivate: false,
        onlyPrivate: false,
        limit: 20,
      }),
    ).resolves.toMatchObject({
      totalCount: 1,
      items: [{entry: {entryId: entries[1]?.entryId}}],
    });
    expect(findCandidates).toHaveBeenCalledTimes(1);
    expect(loadByIds).toHaveBeenCalledWith(WORKSPACE_ID, false, [
      entries[1]?.entryId,
    ]);
    expect(loadAll).not.toHaveBeenCalled();

    await service.search({
      text: 'literal-onli',
      textMode: 'fuzzy',
      includePrivate: false,
      onlyPrivate: false,
      limit: 20,
    });
    expect(findCandidates).toHaveBeenCalledTimes(1);
    expect(loadAll).toHaveBeenCalledTimes(1);
  });

  it('uses a bounded repository page for an empty chronological browse', async () => {
    const entries = [
      currentEntry(
        '22222222-2222-4222-8222-222222222221',
        'Alpha',
        'first body',
      ),
      currentEntry(
        '22222222-2222-4222-8222-222222222222',
        'Beta',
        'second body',
      ),
    ];
    const loadAll = vi.fn(() => Promise.reject(new Error('unbounded read')));
    const loadPage = vi.fn(() =>
      Promise.resolve(
        Object.freeze({
          totalCount: 14_910,
          entries: Object.freeze(entries),
        }),
      ),
    );
    const service = new InformationEntryRetrievalService({
      workspaceId: WORKSPACE_ID,
      entries: {
        materializeEntries: () => Promise.reject(new Error('unexpected write')),
        reviseEntry: () => Promise.reject(new Error('unexpected write')),
        loadCurrentEntries: loadAll,
        loadCurrentEntryBrowsePage: loadPage,
      },
      associations: {
        replaceAssociationProjections: () =>
          Promise.reject(new Error('unexpected write')),
        loadAssociationSnapshot: () =>
          Promise.reject(new Error('unbounded association read')),
        writeAssociationOverride: () =>
          Promise.reject(new Error('unexpected write')),
      },
      index: {
        loadSearchIndex: () =>
          Promise.reject(new Error('unbounded index read')),
        replaceSearchIndex: () => Promise.reject(new Error('unexpected write')),
      },
    });

    await expect(
      service.search({
        includePrivate: false,
        onlyPrivate: false,
        domainScope: 'any',
        limit: 1,
      }),
    ).resolves.toMatchObject({
      totalCount: 14_910,
      items: [{entry: {entryId: entries[0]?.entryId}}],
      nextCursor: {entryId: entries[0]?.entryId},
    });
    expect(loadPage).toHaveBeenCalledWith(WORKSPACE_ID, 'public', 2, undefined);
    expect(loadAll).not.toHaveBeenCalled();
  });

  it('reports index status from aggregate metrics without loading index rows', async () => {
    const loadAll = vi.fn(() => Promise.reject(new Error('unbounded read')));
    const loadIndex = vi.fn(() =>
      Promise.reject(new Error('unbounded index read')),
    );
    const loadMetrics = vi.fn(() =>
      Promise.resolve(
        Object.freeze({
          publicEntryCount: 14_910,
          currentProjectionCount: 14_910,
          embeddedProjectionCount: 0,
          staleProjectionCount: 0,
          postingCount: 2_989_278,
        }),
      ),
    );
    const service = new InformationEntryRetrievalService({
      workspaceId: WORKSPACE_ID,
      entries: {
        materializeEntries: () => Promise.reject(new Error('unexpected write')),
        reviseEntry: () => Promise.reject(new Error('unexpected write')),
        loadCurrentEntries: loadAll,
      },
      associations: {
        replaceAssociationProjections: () =>
          Promise.reject(new Error('unexpected write')),
        loadAssociationSnapshot: () =>
          Promise.resolve({projections: [], overrides: []}),
        writeAssociationOverride: () =>
          Promise.reject(new Error('unexpected write')),
      },
      index: {
        loadSearchIndex: loadIndex,
        loadSearchIndexMetrics: loadMetrics,
        replaceSearchIndex: () => Promise.reject(new Error('unexpected write')),
      },
    });

    await expect(service.status()).resolves.toMatchObject({
      publicEntryCount: 14_910,
      currentProjectionCount: 14_910,
      postingCount: 2_989_278,
      semanticSearchAvailable: false,
      semanticSearchReady: false,
    });
    expect(loadMetrics).toHaveBeenCalledWith(
      WORKSPACE_ID,
      undefined,
      undefined,
    );
    expect(loadAll).not.toHaveBeenCalled();
    expect(loadIndex).not.toHaveBeenCalled();
  });

  it('does not report an empty workspace as a ready semantic index', async () => {
    const fixture = harness(true, []);

    await expect(fixture.service.rebuild()).resolves.toMatchObject({
      publicEntryCount: 0,
      embeddedProjectionCount: 0,
      semanticSearchAvailable: true,
      semanticSearchReady: false,
    });
  });

  it('rejects a partially current index instead of returning incomplete semantic results', async () => {
    const fixture = harness();
    await fixture.service.rebuild();
    const firstProjection = fixture.snapshot.projections[0];
    if (firstProjection === undefined) {
      throw new Error('Synthetic retrieval index is incomplete.');
    }
    fixture.replaceSnapshot(
      Object.freeze({
        projections: Object.freeze([firstProjection]),
        postings: Object.freeze([]),
      }),
    );
    fixture.embed.mockClear();

    await expect(
      fixture.service.search({
        text: 'alpha',
        retrievalMode: 'semantic',
        includePrivate: false,
        onlyPrivate: false,
        limit: 10,
      }),
    ).rejects.toMatchObject({code: 'semantic_search_index_not_ready'});
    expect(fixture.embed).not.toHaveBeenCalled();
  });
});

function harness(
  withProvider = true,
  entries: readonly Readonly<CurrentInformationEntry>[] = [
    currentEntry('22222222-2222-4222-8222-222222222221', 'Alpha', 'first body'),
    currentEntry(
      '22222222-2222-4222-8222-222222222222',
      'Beta',
      'literal-only second body',
    ),
  ],
  translations?: EntryTranslationSearchRepositoryPort,
) {
  let snapshot: Readonly<InformationEntrySearchIndexSnapshot> = Object.freeze({
    projections: Object.freeze([]),
    postings: Object.freeze([]),
  });
  let replacements = 0;
  const loadEntries = vi.fn(() => Promise.resolve(entries));
  const entryRepository: InformationEntryRepositoryPort = {
    materializeEntries: () => Promise.reject(new Error('unexpected write')),
    reviseEntry: () => Promise.reject(new Error('unexpected write')),
    loadCurrentEntries: loadEntries,
  };
  const associationRepository: InformationEntryAssociationRepositoryPort = {
    replaceAssociationProjections: () =>
      Promise.reject(new Error('unexpected write')),
    loadAssociationSnapshot: () =>
      Promise.resolve({
        projections: Object.freeze([]),
        overrides: Object.freeze([]),
      }),
    writeAssociationOverride: () =>
      Promise.reject(new Error('unexpected write')),
  };
  const indexRepository: InformationEntrySearchIndexRepositoryPort = {
    loadSearchIndex: () => Promise.resolve(snapshot),
    replaceSearchIndex: (_workspaceId, next) => {
      snapshot = next;
      replacements += 1;
      return Promise.resolve();
    },
  };
  const embed = vi.fn((inputs: readonly string[]) =>
    Promise.resolve(
      inputs.map((input) =>
        input.toLowerCase().includes('alpha')
          ? Object.freeze([1, 0])
          : input.toLowerCase().includes('beta')
            ? Object.freeze([0, 1])
            : Object.freeze([0, 0]),
      ),
    ),
  );
  const provider: InformationEntryEmbeddingProviderPort = {
    providerKey: 'synthetic-embedding-v1',
    model: 'synthetic-2d',
    embed,
  };
  const service = new InformationEntryRetrievalService({
    workspaceId: WORKSPACE_ID,
    entries: entryRepository,
    associations: associationRepository,
    index: indexRepository,
    ...(withProvider ? {embeddingProvider: provider} : {}),
    ...(translations === undefined ? {} : {translations}),
  });
  return {
    service,
    entryRepository,
    associationRepository,
    indexRepository,
    entries,
    loadEntries,
    embed,
    replaceSnapshot(next: Readonly<InformationEntrySearchIndexSnapshot>) {
      snapshot = next;
    },
    get snapshot() {
      return snapshot;
    },
    get replacements() {
      return replacements;
    },
  };
}

function currentEntry(
  entryId: string,
  titlePath: string,
  body: string,
): Readonly<CurrentInformationEntry> {
  return Object.freeze({
    workspaceId: WORKSPACE_ID,
    entryId,
    resourceId: '33333333-3333-4333-8333-333333333333',
    snapshotId: '44444444-4444-4444-8444-444444444444',
    revision: 1,
    revisionId: entryId.replace('22222222-', '55555555-'),
    sourceKey: 'synthetic:retrieval-source',
    capturedAt: '2040-01-01T00:00:00.000Z',
    value: Object.freeze({
      documentOrder: titlePath === 'Alpha' ? 0 : 1,
      titlePath,
      body,
      bodySha256: 'a'.repeat(64),
      chunkMode: 'split' as const,
      splitRuleVersion: 'struinfo.entry-split.section.v1',
      isPrivate: false,
      typeKeyword: 'knowledge_explanation' as const,
      contentKeywords: Object.freeze([]),
      domains: Object.freeze([]),
      fragmentIds: Object.freeze(['66666666-6666-4666-8666-666666666666']),
    }),
  });
}

function translation(
  entry: Readonly<CurrentInformationEntry>,
): Readonly<EntryTranslation> {
  return Object.freeze({
    entryId: entry.entryId,
    sourceRevision: entry.revision,
    sourceRevisionId: entry.revisionId,
    targetLanguage: 'zh-CN',
    title: '合成译文标题',
    body: '合成译文正文',
    providerKey: 'openai-responses-v1',
    model: 'synthetic-model',
    promptVersion: 'synthetic-v1',
    translatedAt: '2040-01-04T00:00:00.000Z',
  });
}
