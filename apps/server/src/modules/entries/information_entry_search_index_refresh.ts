import type {InformationEntryRetrievalServiceDependencies} from './information_entry_retrieval.js';
import {
  prepareInformationEntrySearchProjection,
  withInformationEntryEmbedding,
} from './information_entry_search_index.js';
import {
  INFORMATION_ENTRY_EMBEDDING_BATCH_MAXIMUM,
  InformationEntryRetrievalServiceError,
  type InformationEntrySearchIndexRefreshProgress,
} from './information_entry_search_index_contract.js';

/** The committed projection is the checkpoint; each call selects remaining work. */
export async function refreshInformationEntrySearchIndex(
  dependencies: Readonly<InformationEntryRetrievalServiceDependencies>,
  limit: number,
): Promise<Readonly<InformationEntrySearchIndexRefreshProgress>> {
  const loadBatch = dependencies.index.loadRefreshBatch?.bind(
    dependencies.index,
  );
  const applyBatch = dependencies.index.applyRefreshBatch?.bind(
    dependencies.index,
  );
  const loadEntries = dependencies.entries.loadCurrentEntriesByIds?.bind(
    dependencies.entries,
  );
  if (
    loadBatch === undefined ||
    applyBatch === undefined ||
    loadEntries === undefined
  ) {
    throw new InformationEntryRetrievalServiceError(
      'search_index_refresh_unavailable',
    );
  }
  if (
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    limit > INFORMATION_ENTRY_EMBEDDING_BATCH_MAXIMUM
  ) {
    throw new InformationEntryRetrievalServiceError(
      'search_index_invalid_refresh_limit',
    );
  }
  const provider = dependencies.embeddingProvider;
  const scope =
    provider === undefined
      ? {}
      : {
          embeddingProvider: provider.providerKey,
          embeddingModel: provider.model,
        };
  const batch = await loadBatch(dependencies.workspaceId, {limit, ...scope});
  const previous = new Map(
    batch.previousProjections.map((item) => [item.entryId, item]),
  );
  const entries = await loadEntries(
    dependencies.workspaceId,
    false,
    batch.entryIds,
  );
  const prepared = entries
    .filter((entry) => !entry.value.isPrivate)
    .map(prepareInformationEntrySearchProjection);
  const reused = new Set<string>();
  let projections = prepared.map((item) => {
    const prior = previous.get(item.entry.entryId);
    if (
      prior?.projectionSha256 === item.projection.projectionSha256 &&
      prior.embedding !== undefined &&
      prior.embeddingProvider !== undefined &&
      prior.embeddingModel !== undefined &&
      (provider === undefined ||
        (prior.embeddingProvider === provider.providerKey &&
          prior.embeddingModel === provider.model))
    ) {
      try {
        const projection = withInformationEntryEmbedding(
          item.projection,
          prior.embeddingProvider,
          prior.embeddingModel,
          prior.embedding,
        );
        reused.add(item.entry.entryId);
        return projection;
      } catch {
        // A damaged derived vector is regenerated from the current public Entry.
      }
    }
    return item.projection;
  });
  const needsEmbedding =
    provider === undefined
      ? []
      : prepared.filter((item) => !reused.has(item.entry.entryId));
  let providerFailed = false;
  if (provider !== undefined && needsEmbedding.length > 0) {
    try {
      const vectors = await provider.embed(
        needsEmbedding.map((item) => item.input),
      );
      if (vectors.length !== needsEmbedding.length)
        throw new Error('Incomplete embedding batch.');
      const embedded = new Map(
        needsEmbedding.map((item, position) => {
          const vector = vectors[position];
          if (vector === undefined) throw new Error('Missing embedding.');
          return [
            item.entry.entryId,
            withInformationEntryEmbedding(
              item.projection,
              provider.providerKey,
              provider.model,
              vector,
            ),
          ] as const;
        }),
      );
      projections = projections.map(
        (projection) => embedded.get(projection.entryId) ?? projection,
      );
    } catch {
      providerFailed = true;
    }
  }
  const committed = await applyBatch(
    dependencies.workspaceId,
    {
      projections,
      postings: prepared.flatMap((item) => item.postings),
    },
    batch.obsoleteEntryIds,
  );
  const remaining = await loadBatch(dependencies.workspaceId, {
    limit: 0,
    ...scope,
  });
  return Object.freeze({
    outcome: providerFailed
      ? 'provider_failed'
      : remaining.remainingEntryCount + remaining.remainingObsoleteCount === 0
        ? 'complete'
        : 'more',
    loadedEntryCount: entries.length,
    updatedEntryCount: committed.updatedEntryIds.length,
    staleEntryCount: batch.entryIds.length - committed.updatedEntryIds.length,
    removedProjectionCount: committed.removedCount,
    reusedEmbeddingCount: committed.updatedEntryIds.filter((entryId) =>
      reused.has(entryId),
    ).length,
    embeddingInputCount: needsEmbedding.length,
    remainingEntryCount: remaining.remainingEntryCount,
    remainingObsoleteCount: remaining.remainingObsoleteCount,
  });
}
