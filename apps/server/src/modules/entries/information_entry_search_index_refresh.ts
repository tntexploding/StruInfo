import type {InformationEntryRepositoryPort} from './information_entry_repository.js';
import {
  prepareInformationEntrySearchProjection,
  withInformationEntryEmbedding,
  isUsableInformationEntryEmbedding,
} from './information_entry_search_index.js';
import {
  INFORMATION_ENTRY_EMBEDDING_BATCH_MAXIMUM,
  InformationEntryRetrievalServiceError,
  type InformationEntrySearchIndexRefreshProgress,
  type InformationEntrySearchIndexRepositoryPort,
  type InformationEntryEmbeddingProviderPort,
  type InformationEntrySearchProjection,
  type PreparedInformationEntrySearchProjection,
  type InformationEntryEmbeddingChunk,
} from './information_entry_search_index_contract.js';

interface SearchIndexRefreshDependencies {
  readonly workspaceId: string;
  readonly entries: Pick<
    InformationEntryRepositoryPort,
    'loadCurrentEntriesByIds'
  >;
  readonly index: Pick<
    InformationEntrySearchIndexRepositoryPort,
    'loadRefreshBatch' | 'applyRefreshBatch'
  >;
  readonly embeddingProvider?: InformationEntryEmbeddingProviderPort;
}

/** The committed projection is the checkpoint; each call selects remaining work. */
export async function refreshInformationEntrySearchIndex(
  dependencies: Readonly<SearchIndexRefreshDependencies>,
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
  limit = Math.min(limit, provider?.maximumBatchSize ?? limit);
  const scope =
    provider === undefined
      ? {}
      : {
          embeddingProvider: provider.providerKey,
          embeddingModel: provider.model,
        };
  const batch = await loadBatch(dependencies.workspaceId, {limit, ...scope});
  const entries = await loadEntries(
    dependencies.workspaceId,
    false,
    batch.entryIds,
  );
  const prepared = entries
    .filter((entry) => !entry.value.isPrivate)
    .map(prepareInformationEntrySearchProjection);
  const {projections, reused, providerFailed, embeddingInputCount} =
    await embedSearchProjectionBatch(
      prepared,
      batch.previousProjections,
      provider,
    );
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
    embeddingInputCount,
    remainingEntryCount: remaining.remainingEntryCount,
    remainingObsoleteCount: remaining.remainingObsoleteCount,
  });
}

/** One paid request per checkpoint. Long entries continue in subsequent batches. */
export async function embedSearchProjectionBatch(
  prepared: readonly Readonly<PreparedInformationEntrySearchProjection>[],
  previous: readonly Readonly<InformationEntrySearchProjection>[],
  provider?: InformationEntryEmbeddingProviderPort,
) {
  const prior = new Map(previous.map((p) => [p.entryId, p]));
  const values = new Map<string, InformationEntryEmbeddingChunk[]>();
  const pending: {
    entryId: string;
    chunk: PreparedInformationEntrySearchProjection['chunks'][number];
  }[] = [];
  const reused = new Set<string>();
  for (const item of prepared) {
    const old = prior.get(item.entry.entryId);
    const compatible =
      old &&
      (!provider ||
        (old.embeddingProvider === provider.providerKey &&
          old.embeddingModel === provider.model));
    const cache = new Map(
      (compatible ? (old.embedding ?? []) : []).map((c) => [
        c.inputSha256,
        c.vector,
      ]),
    );
    const chunks: InformationEntryEmbeddingChunk[] = [];
    for (const chunk of item.chunks) {
      const vector = cache.get(chunk.inputSha256);
      if (vector)
        chunks.push({
          start: chunk.start,
          end: chunk.end,
          inputSha256: chunk.inputSha256,
          vector,
        });
      else if (provider) pending.push({entryId: item.entry.entryId, chunk});
    }
    values.set(item.entry.entryId, chunks);
    if (chunks.length === item.chunks.length) reused.add(item.entry.entryId);
  }
  const selected = pending.slice(
    0,
    provider?.maximumBatchSize ?? INFORMATION_ENTRY_EMBEDDING_BATCH_MAXIMUM,
  );
  let providerFailed = false;
  if (provider && selected.length) {
    try {
      const vectors = await provider.embed(selected.map((p) => p.chunk.input));
      if (vectors.length !== selected.length)
        throw new Error('Incomplete embedding batch.');
      if (
        vectors.some(
          (vector) =>
            !isUsableInformationEntryEmbedding(vector) ||
            vector.length !== vectors[0]?.length,
        )
      )
        throw new Error('Invalid embedding batch.');
      selected.forEach((item, i) => {
        const vector = vectors[i];
        if (vector)
          values.get(item.entryId)?.push({
            start: item.chunk.start,
            end: item.chunk.end,
            inputSha256: item.chunk.inputSha256,
            vector,
          });
      });
    } catch {
      providerFailed = true;
    }
  }
  const projections = prepared.map((item) => {
    const chunks = values.get(item.entry.entryId) ?? [];
    const old = prior.get(item.entry.entryId);
    const providerKey = provider?.providerKey ?? old?.embeddingProvider;
    const model = provider?.model ?? old?.embeddingModel;
    return chunks.length && providerKey && model
      ? withInformationEntryEmbedding(
          item.projection,
          providerKey,
          model,
          chunks.sort((a, b) => a.start - b.start),
        )
      : item.projection;
  });
  return {
    projections,
    reused,
    providerFailed,
    embeddingInputCount: selected.length,
  };
}
