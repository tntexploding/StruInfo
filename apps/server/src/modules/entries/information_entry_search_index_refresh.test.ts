import {describe, expect, it, vi} from 'vitest';

import type {CurrentInformationEntry} from './information_entry_contract.js';
import {InformationEntryRetrievalService} from './information_entry_retrieval.js';
import type {InformationEntryRepositoryPort} from './information_entry_repository.js';
import {
  type InformationEntrySearchIndexRepositoryPort,
  type InformationEntrySearchIndexSnapshot,
  type InformationEntrySearchProjection,
} from './information_entry_search_index_contract.js';

const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';

describe('incremental Entry index maintenance', () => {
  it('hydrates finite windows and resumes from committed projections in a new service', async () => {
    const fixture = harness();
    const first = await fixture.service().refresh(2);
    expect(first.progress).toMatchObject({
      outcome: 'more',
      loadedEntryCount: 2,
      updatedEntryCount: 2,
      embeddingInputCount: 2,
      remainingEntryCount: 1,
    });
    const second = await fixture.service().refresh(2);
    expect(second.progress).toMatchObject({
      outcome: 'complete',
      loadedEntryCount: 1,
      updatedEntryCount: 1,
      embeddingInputCount: 1,
    });
    fixture.embed.mockClear();
    const replay = await fixture.service().refresh(2);
    expect(replay.progress).toMatchObject({
      outcome: 'complete',
      loadedEntryCount: 0,
      updatedEntryCount: 0,
      embeddingInputCount: 0,
    });
    expect(fixture.embed).not.toHaveBeenCalled();
    expect(fixture.loadAll).not.toHaveBeenCalled();
    expect(
      fixture.loadByIds.mock.calls.flatMap((call) => call[2]),
    ).not.toContain(entryId(4));
    expect(fixture.snapshot.projections).toHaveLength(3);
  });

  it('refreshes only changed input and reuses a vector when a revision has the same input', async () => {
    const fixture = harness();
    await fixture.service().refresh(32);
    const untouched = fixture.snapshot.projections.find(
      (projection) => projection.entryId === entryId(3),
    );
    fixture.embed.mockClear();
    fixture.revise(1, {body: 'synthetic changed body'});
    await expect(fixture.service().refresh(1)).resolves.toMatchObject({
      progress: {
        loadedEntryCount: 1,
        updatedEntryCount: 1,
        embeddingInputCount: 1,
      },
    });
    expect(fixture.embed.mock.calls[0]?.[0]).toEqual([
      expect.stringContaining('synthetic changed body'),
    ]);
    expect(
      fixture.snapshot.projections.find(
        (projection) => projection.entryId === entryId(3),
      ),
    ).toBe(untouched);
    fixture.embed.mockClear();
    fixture.revise(2, {});
    await expect(fixture.service().refresh(1)).resolves.toMatchObject({
      progress: {
        updatedEntryCount: 1,
        reusedEmbeddingCount: 1,
        embeddingInputCount: 0,
      },
    });
    expect(fixture.embed).not.toHaveBeenCalled();
    expect(
      fixture.snapshot.projections.find(
        (projection) => projection.entryId === entryId(2),
      )?.entryRevision,
    ).toBe(2);
  });

  it('keeps completed windows and local terms after provider failure, then retries only missing vectors', async () => {
    const fixture = harness();
    await fixture.service().refresh(2);
    fixture.embed.mockRejectedValueOnce(
      new Error('synthetic provider failure'),
    );
    const failed = await fixture.service().refresh(2);
    expect(failed.progress).toMatchObject({
      outcome: 'provider_failed',
      updatedEntryCount: 1,
      remainingEntryCount: 1,
    });
    expect(failed.index).toMatchObject({
      currentProjectionCount: 3,
      embeddedProjectionCount: 2,
      semanticSearchReady: false,
    });
    expect(
      fixture.snapshot.postings.some(
        (posting) => posting.entryId === entryId(3),
      ),
    ).toBe(true);
    fixture.embed.mockClear();
    await expect(fixture.service().refresh(2)).resolves.toMatchObject({
      progress: {outcome: 'complete', embeddingInputCount: 1},
    });
    expect(fixture.embed).toHaveBeenCalledTimes(1);
    expect(fixture.embed.mock.calls[0]?.[0]).toHaveLength(1);
  });

  it('discards output for a changed revision and removes an endpoint made private in flight', async () => {
    const fixture = harness();
    await fixture.service().refresh(32);
    fixture.revise(1, {body: 'synthetic before generation'});
    fixture.embed.mockImplementationOnce((inputs) => {
      fixture.revise(1, {body: 'synthetic after generation'});
      return Promise.resolve(inputs.map(() => [1, 0]));
    });
    await expect(fixture.service().refresh(1)).resolves.toMatchObject({
      progress: {outcome: 'more', updatedEntryCount: 0, staleEntryCount: 1},
    });
    expect(
      fixture.snapshot.projections.find(
        (projection) => projection.entryId === entryId(1),
      )?.entryRevision,
    ).toBe(1);
    fixture.embed.mockImplementationOnce((inputs) => {
      fixture.revise(1, {isPrivate: true});
      return Promise.resolve(inputs.map(() => [1, 0]));
    });
    await expect(fixture.service().refresh(1)).resolves.toMatchObject({
      progress: {
        updatedEntryCount: 0,
        staleEntryCount: 1,
        removedProjectionCount: 1,
      },
    });
    expect(
      fixture.snapshot.projections.some(
        (projection) => projection.entryId === entryId(1),
      ),
    ).toBe(false);
    expect(
      fixture.snapshot.postings.some(
        (posting) => posting.entryId === entryId(1),
      ),
    ).toBe(false);
  });

  it('cleans retired and private projections within the same finite budget without provider input', async () => {
    const fixture = harness();
    await fixture.service().refresh(32);
    fixture.retired.add(entryId(1));
    fixture.revise(2, {isPrivate: true});
    fixture.embed.mockClear();
    await expect(fixture.service().refresh(1)).resolves.toMatchObject({
      progress: {
        removedProjectionCount: 1,
        loadedEntryCount: 0,
        remainingObsoleteCount: 1,
      },
    });
    await expect(fixture.service().refresh(1)).resolves.toMatchObject({
      progress: {
        outcome: 'complete',
        removedProjectionCount: 1,
        loadedEntryCount: 0,
      },
    });
    expect(fixture.embed).not.toHaveBeenCalled();
    expect(
      fixture.snapshot.projections.map((projection) => projection.entryId),
    ).toEqual([entryId(3)]);
  });

  it('supports lexical-only restoration, changed models and explicit full repair', async () => {
    const fixture = harness();
    await expect(fixture.service(false).refresh(32)).resolves.toMatchObject({
      index: {semanticSearchAvailable: false},
      progress: {outcome: 'complete', embeddingInputCount: 0},
    });
    expect(fixture.embed).not.toHaveBeenCalled();
    await fixture.service().refresh(32);
    fixture.embed.mockClear();
    const changedModel = fixture.service(true, 'synthetic-next-model');
    await expect(changedModel.refresh(1)).resolves.toMatchObject({
      progress: {embeddingInputCount: 1, remainingEntryCount: 2},
    });
    await expect(
      fixture.service(true, 'synthetic-next-model').refresh(32),
    ).resolves.toMatchObject({
      progress: {outcome: 'complete', embeddingInputCount: 2},
    });
    fixture.setSnapshot({...fixture.snapshot, postings: []});
    await fixture.service(false).rebuild();
    expect(fixture.snapshot.postings.length).toBeGreaterThan(0);
  });

  it('reports a busy maintenance request and releases the guard after failure', async () => {
    const fixture = harness();
    const service = fixture.service();
    let release: () => void = () => {
      throw new Error('Missing synthetic gate');
    };
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    fixture.embed.mockImplementationOnce(async () => {
      await gate;
      throw new Error('synthetic failure');
    });
    const pending = service.refresh(1);
    await vi.waitFor(() => {
      expect(fixture.embed).toHaveBeenCalledTimes(1);
    });
    await expect(service.refresh(1)).rejects.toMatchObject({
      code: 'search_index_maintenance_busy',
    });
    await expect(service.rebuild()).rejects.toMatchObject({
      code: 'search_index_maintenance_busy',
    });
    release();
    await expect(pending).resolves.toMatchObject({
      progress: {outcome: 'provider_failed'},
    });
    await expect(service.refresh(1)).resolves.toMatchObject({
      progress: {embeddingInputCount: 1},
    });
  });

  it('rejects invalid window sizes before reading Entry contents or invoking the provider', async () => {
    const fixture = harness();
    for (const limit of [0, -1, 33, 1.5, Number.NaN]) {
      await expect(fixture.service().refresh(limit)).rejects.toMatchObject({
        code: 'search_index_invalid_refresh_limit',
      });
    }
    expect(fixture.loadByIds).not.toHaveBeenCalled();
    expect(fixture.embed).not.toHaveBeenCalled();
  });
});

function harness() {
  const entries = new Map(
    [1, 2, 3, 4].map((number) => [entryId(number), currentEntry(number)]),
  );
  const retired = new Set<string>();
  let snapshot: Readonly<InformationEntrySearchIndexSnapshot> = {
    projections: [],
    postings: [],
  };
  const isPublic = (entry: Readonly<CurrentInformationEntry>) =>
    !entry.value.isPrivate && !retired.has(entry.entryId);
  const currentPublic = () => [...entries.values()].filter(isPublic);
  const isCurrent = (
    projection: Readonly<InformationEntrySearchProjection>,
  ) => {
    const entry = entries.get(projection.entryId);
    return (
      entry !== undefined &&
      isPublic(entry) &&
      entry.revision === projection.entryRevision &&
      entry.revisionId === projection.entryRevisionId
    );
  };
  const hasEmbedding = (
    projection: Readonly<InformationEntrySearchProjection>,
    provider: string,
    model: string,
  ) =>
    projection.embeddingProvider === provider &&
    projection.embeddingModel === model &&
    projection.embedding !== undefined &&
    projection.embedding.length > 0 &&
    projection.embedding.every(Number.isFinite);
  const loadAll = vi.fn(() => Promise.resolve(currentPublic()));
  const loadByIds = vi.fn(
    (_workspaceId: string, _includePrivate: boolean, ids: readonly string[]) =>
      Promise.resolve(
        currentPublic().filter((entry) => ids.includes(entry.entryId)),
      ),
  );
  const repository: InformationEntryRepositoryPort = {
    materializeEntries: () =>
      Promise.reject(new Error('Unexpected Entry write')),
    reviseEntry: () => Promise.reject(new Error('Unexpected Entry write')),
    loadCurrentEntries: loadAll,
    loadCurrentEntriesByIds: loadByIds,
  };
  const index: InformationEntrySearchIndexRepositoryPort = {
    loadSearchIndex: () => Promise.resolve(snapshot),
    loadSearchIndexMetrics: (_workspaceId, provider, model) => {
      const current = snapshot.projections.filter(isCurrent);
      return Promise.resolve({
        publicEntryCount: currentPublic().length,
        currentProjectionCount: current.length,
        embeddedProjectionCount:
          provider === undefined || model === undefined
            ? 0
            : current.filter((projection) =>
                hasEmbedding(projection, provider, model),
              ).length,
        staleProjectionCount: snapshot.projections.length - current.length,
        postingCount: snapshot.postings.length,
      });
    },
    replaceSearchIndex: (_workspaceId, next) => {
      const accepted = next.projections.filter(isCurrent);
      const ids = new Set(accepted.map((projection) => projection.entryId));
      snapshot = {
        projections: accepted,
        postings: next.postings.filter((posting) => ids.has(posting.entryId)),
      };
      return Promise.resolve();
    },
    loadRefreshBatch: (_workspaceId, request) => {
      const previous = new Map(
        snapshot.projections.map((projection) => [
          projection.entryId,
          projection,
        ]),
      );
      const remaining = currentPublic()
        .filter((entry) => {
          const projection = previous.get(entry.entryId);
          return (
            projection === undefined ||
            !isCurrent(projection) ||
            (request.embeddingProvider !== undefined &&
              request.embeddingModel !== undefined &&
              !hasEmbedding(
                projection,
                request.embeddingProvider,
                request.embeddingModel,
              ))
          );
        })
        .map((entry) => entry.entryId);
      const obsolete = snapshot.projections
        .filter((projection) => {
          const entry = entries.get(projection.entryId);
          return entry !== undefined && !isPublic(entry);
        })
        .map((projection) => projection.entryId);
      const obsoleteEntryIds = obsolete.slice(0, request.limit);
      const selected = remaining.slice(
        0,
        request.limit - obsoleteEntryIds.length,
      );
      return Promise.resolve({
        entryIds: selected,
        obsoleteEntryIds,
        previousProjections: snapshot.projections.filter((projection) =>
          selected.includes(projection.entryId),
        ),
        remainingEntryCount: remaining.length,
        remainingObsoleteCount: obsolete.length,
      });
    },
    applyRefreshBatch: (_workspaceId, next, obsolete) => {
      const accepted = next.projections.filter(isCurrent);
      const removed = [
        ...new Set([
          ...obsolete,
          ...next.projections.map((projection) => projection.entryId),
        ]),
      ].filter((id) => {
        const entry = entries.get(id);
        return entry !== undefined && !isPublic(entry);
      });
      const removedCount = snapshot.projections.filter((projection) =>
        removed.includes(projection.entryId),
      ).length;
      const updatedEntryIds = accepted.map((projection) => projection.entryId);
      const replaced = new Set([...updatedEntryIds, ...removed]);
      snapshot = {
        projections: [
          ...snapshot.projections.filter(
            (projection) => !replaced.has(projection.entryId),
          ),
          ...accepted,
        ],
        postings: [
          ...snapshot.postings.filter(
            (posting) => !replaced.has(posting.entryId),
          ),
          ...next.postings.filter((posting) =>
            updatedEntryIds.includes(posting.entryId),
          ),
        ],
      };
      return Promise.resolve({updatedEntryIds, removedCount});
    },
  };
  const embed = vi.fn((inputs: readonly string[]) =>
    Promise.resolve(inputs.map(() => [1, 0])),
  );
  return {
    loadAll,
    loadByIds,
    embed,
    retired,
    get snapshot() {
      return snapshot;
    },
    setSnapshot(next: Readonly<InformationEntrySearchIndexSnapshot>) {
      snapshot = next;
    },
    revise(number: number, patch: Partial<CurrentInformationEntry['value']>) {
      const id = entryId(number);
      const entry = entries.get(id);
      if (entry === undefined) throw new Error('Missing synthetic Entry');
      const revision = entry.revision + 1;
      entries.set(id, {
        ...entry,
        revision,
        revisionId:
          '55555555-5555-4555-8555-' +
          (number * 100 + revision).toString().padStart(12, '0'),
        value: {...entry.value, ...patch},
      });
    },
    service(withProvider = true, model = 'synthetic-model') {
      return new InformationEntryRetrievalService({
        workspaceId: WORKSPACE_ID,
        entries: repository,
        index,
        associations: {
          loadAssociationSnapshot: () =>
            Promise.resolve({
              projections: [],
              overrides: [],
            }),
          replaceAssociationProjections: () =>
            Promise.reject(new Error('Unexpected Association write')),
          writeAssociationOverride: () =>
            Promise.reject(new Error('Unexpected Association write')),
        },
        ...(withProvider
          ? {
              embeddingProvider: {
                providerKey: 'synthetic-provider',
                model,
                embed,
              },
            }
          : {}),
      });
    },
  };
}

function entryId(number: number): string {
  return '22222222-2222-4222-8222-' + number.toString().padStart(12, '0');
}

function currentEntry(number: number): Readonly<CurrentInformationEntry> {
  return {
    workspaceId: WORKSPACE_ID,
    entryId: entryId(number),
    resourceId: '33333333-3333-4333-8333-333333333333',
    snapshotId: '44444444-4444-4444-8444-444444444444',
    revision: 1,
    revisionId:
      '55555555-5555-4555-8555-' + number.toString().padStart(12, '0'),
    sourceKey: 'synthetic:index-maintenance',
    capturedAt: '2040-01-01T00:00:00.000Z',
    value: {
      documentOrder: number,
      titlePath: 'Synthetic Entry ' + number.toString(),
      body: 'Synthetic text ' + number.toString(),
      bodySha256: 'a'.repeat(64),
      chunkMode: 'split',
      splitRuleVersion: 'struinfo.entry-split.section.v1',
      isPrivate: number === 4,
      typeKeyword: 'knowledge_explanation',
      contentKeywords: [],
      domains: [],
      fragmentIds: ['66666666-6666-4666-8666-666666666666'],
    },
  };
}
