import {describe, expect, it, vi} from 'vitest';

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
  });
  return {
    service,
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
