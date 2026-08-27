import type {InformationEntryAssociationRepositoryPort} from './information_entry_association_repository.js';
import type {
  CurrentInformationEntry,
  InformationEntrySearchRequest,
  InformationEntrySearchResult,
} from './information_entry_contract.js';
import type {InformationEntryRepositoryPort} from './information_entry_repository.js';
import {searchCurrentInformationEntries} from './information_entry_search.js';
import {
  cosineSimilarityBasisPoints,
  prepareInformationEntrySearchProjection,
  withInformationEntryEmbedding,
} from './information_entry_search_index.js';
import {
  INFORMATION_ENTRY_EMBEDDING_BATCH_MAXIMUM,
  INFORMATION_ENTRY_SEARCH_INDEX_VERSION,
  INFORMATION_ENTRY_TERM_TOKENIZER_VERSION,
  InformationEntryRetrievalServiceError,
  type InformationEntryEmbeddingProviderPort,
  type InformationEntryRetrievalServicePort,
  type InformationEntrySearchEvaluationCase,
  type InformationEntrySearchEvaluationCaseResult,
  type InformationEntrySearchEvaluationResult,
  type InformationEntrySearchIndexRepositoryPort,
  type InformationEntrySearchIndexSnapshot,
  type InformationEntrySearchIndexStatus,
} from './information_entry_search_index_contract.js';

export interface InformationEntryRetrievalServiceDependencies {
  readonly workspaceId: string;
  readonly entries: InformationEntryRepositoryPort;
  readonly associations: InformationEntryAssociationRepositoryPort;
  readonly index: InformationEntrySearchIndexRepositoryPort;
  readonly embeddingProvider?: InformationEntryEmbeddingProviderPort;
}

export class InformationEntryRetrievalService implements InformationEntryRetrievalServicePort {
  readonly #dependencies: Readonly<InformationEntryRetrievalServiceDependencies>;
  public readonly semanticSearchAvailable: boolean;

  public constructor(
    dependencies: Readonly<InformationEntryRetrievalServiceDependencies>,
  ) {
    this.#dependencies = dependencies;
    this.semanticSearchAvailable = dependencies.embeddingProvider !== undefined;
  }

  public async search(
    request: Readonly<InformationEntrySearchRequest>,
  ): Promise<Readonly<InformationEntrySearchResult>> {
    const mode = request.retrievalMode ?? 'lexical';
    if (mode !== 'lexical') this.#assertSemanticRequest(request);
    const [entries, associations] = await Promise.all([
      this.#dependencies.entries.loadCurrentEntries(
        this.#dependencies.workspaceId,
        request.includePrivate,
      ),
      request.association === undefined
        ? Promise.resolve({projections: [], overrides: []})
        : this.#dependencies.associations.loadAssociationSnapshot(
            this.#dependencies.workspaceId,
            request.includePrivate,
          ),
    ]);
    if (mode === 'lexical') {
      return searchCurrentInformationEntries(entries, request, associations);
    }
    const provider = this.#dependencies.embeddingProvider;
    if (provider === undefined) {
      throw new InformationEntryRetrievalServiceError(
        'semantic_search_not_configured',
      );
    }
    const index = await this.#dependencies.index.loadSearchIndex(
      this.#dependencies.workspaceId,
    );
    const current = currentEmbeddedProjections(entries, index, provider);
    if (entries.length === 0 || current.size !== entries.length) {
      throw new InformationEntryRetrievalServiceError(
        'semantic_search_index_not_ready',
      );
    }
    let queryEmbedding: readonly number[];
    try {
      const vectors = await provider.embed([request.text ?? '']);
      const first = vectors[0];
      if (vectors.length !== 1 || first === undefined) throw new Error();
      queryEmbedding = first;
    } catch {
      throw new InformationEntryRetrievalServiceError(
        'semantic_search_provider_failure',
      );
    }
    const semanticMatches = new Map<
      string,
      Readonly<{
        score: number;
        provider: string;
        model: string;
        indexVersion: string;
      }>
    >();
    for (const [entryId, embedding] of current) {
      const score = cosineSimilarityBasisPoints(queryEmbedding, embedding);
      if (score === 0) continue;
      semanticMatches.set(
        entryId,
        Object.freeze({
          score,
          provider: provider.providerKey,
          model: provider.model,
          indexVersion: INFORMATION_ENTRY_SEARCH_INDEX_VERSION,
        }),
      );
    }
    return searchCurrentInformationEntries(
      entries,
      request,
      associations,
      semanticMatches,
    );
  }

  public async status(): Promise<Readonly<InformationEntrySearchIndexStatus>> {
    const [entries, index] = await Promise.all([
      this.#dependencies.entries.loadCurrentEntries(
        this.#dependencies.workspaceId,
        false,
      ),
      this.#dependencies.index.loadSearchIndex(this.#dependencies.workspaceId),
    ]);
    return indexStatus(entries, index, this.#dependencies.embeddingProvider);
  }

  public async rebuild(): Promise<Readonly<InformationEntrySearchIndexStatus>> {
    const entries = await this.#dependencies.entries.loadCurrentEntries(
      this.#dependencies.workspaceId,
      false,
    );
    const prepared = entries.map(prepareInformationEntrySearchProjection);
    let projections = prepared.map((item) => item.projection);
    const provider = this.#dependencies.embeddingProvider;
    if (provider !== undefined && prepared.length > 0) {
      const embedded = [] as (readonly number[])[];
      try {
        for (
          let offset = 0;
          offset < prepared.length;
          offset += INFORMATION_ENTRY_EMBEDDING_BATCH_MAXIMUM
        ) {
          const batch = prepared.slice(
            offset,
            offset + INFORMATION_ENTRY_EMBEDDING_BATCH_MAXIMUM,
          );
          const vectors = await provider.embed(batch.map((item) => item.input));
          if (vectors.length !== batch.length) throw new Error();
          embedded.push(...vectors);
        }
        projections = prepared.map((item, index) => {
          const vector = embedded[index];
          if (vector === undefined) throw new Error();
          return withInformationEntryEmbedding(
            item.projection,
            provider.providerKey,
            provider.model,
            vector,
          );
        });
      } catch {
        throw new InformationEntryRetrievalServiceError(
          'semantic_search_provider_failure',
        );
      }
    }
    const snapshot = Object.freeze({
      projections: Object.freeze(projections),
      postings: Object.freeze(prepared.flatMap((item) => item.postings)),
    });
    await this.#dependencies.index.replaceSearchIndex(
      this.#dependencies.workspaceId,
      snapshot,
    );
    return indexStatus(entries, snapshot, provider);
  }

  public async evaluate(
    retrievalMode: 'semantic' | 'hybrid',
    k: number,
    cases: readonly Readonly<InformationEntrySearchEvaluationCase>[],
  ): Promise<Readonly<InformationEntrySearchEvaluationResult>> {
    const results: InformationEntrySearchEvaluationCaseResult[] = [];
    for (const item of cases) {
      const search = await this.search(
        Object.freeze({
          text: item.query,
          textMode: 'fuzzy',
          textFields: Object.freeze(['title', 'body', 'tags'] as const),
          retrievalMode,
          includePrivate: false,
          onlyPrivate: false,
          limit: k,
        }),
      );
      const retrieved = search.items.map((result) => result.entry.entryId);
      const expected = new Set(item.expectedEntryIds);
      const retrievedExpected = retrieved.filter((entryId) =>
        expected.has(entryId),
      );
      const firstExpected = retrieved.findIndex((entryId) =>
        expected.has(entryId),
      );
      results.push(
        Object.freeze({
          caseId: item.caseId,
          expectedCount: expected.size,
          retrievedExpectedCount: retrievedExpected.length,
          recallAtK:
            expected.size === 0
              ? 0
              : Math.round((retrievedExpected.length / expected.size) * 10_000),
          reciprocalRank:
            firstExpected < 0 ? 0 : Math.round(10_000 / (firstExpected + 1)),
          retrievedEntryIds: Object.freeze(retrieved),
        }),
      );
    }
    return Object.freeze({
      retrievalMode,
      k,
      meanRecallAtK: mean(results.map((result) => result.recallAtK)),
      meanReciprocalRank: mean(results.map((result) => result.reciprocalRank)),
      cases: Object.freeze(results),
    });
  }

  #assertSemanticRequest(
    request: Readonly<InformationEntrySearchRequest>,
  ): void {
    if (request.includePrivate || request.onlyPrivate) {
      throw new InformationEntryRetrievalServiceError(
        'semantic_search_private_scope_forbidden',
      );
    }
    if ((request.text ?? '').trim() === '') {
      throw new InformationEntryRetrievalServiceError(
        'semantic_search_text_required',
      );
    }
  }
}

function currentEmbeddedProjections(
  entries: readonly Readonly<CurrentInformationEntry>[],
  index: Readonly<InformationEntrySearchIndexSnapshot>,
  provider: Readonly<InformationEntryEmbeddingProviderPort>,
): ReadonlyMap<string, readonly number[]> {
  const current = new Map(entries.map((entry) => [entry.entryId, entry]));
  return new Map(
    index.projections.flatMap((projection) => {
      const entry = current.get(projection.entryId);
      return entry?.revision === projection.entryRevision &&
        entry.revisionId === projection.entryRevisionId &&
        projection.embeddingProvider === provider.providerKey &&
        projection.embeddingModel === provider.model &&
        projection.embedding !== undefined
        ? [[projection.entryId, projection.embedding] as const]
        : [];
    }),
  );
}

function indexStatus(
  entries: readonly Readonly<CurrentInformationEntry>[],
  index: Readonly<InformationEntrySearchIndexSnapshot>,
  provider: Readonly<InformationEntryEmbeddingProviderPort> | undefined,
): Readonly<InformationEntrySearchIndexStatus> {
  const current = new Map(entries.map((entry) => [entry.entryId, entry]));
  const currentProjections = index.projections.filter((projection) => {
    const entry = current.get(projection.entryId);
    return (
      entry?.revision === projection.entryRevision &&
      entry.revisionId === projection.entryRevisionId
    );
  });
  const embedded =
    provider === undefined
      ? []
      : currentProjections.filter(
          (projection) =>
            projection.embeddingProvider === provider.providerKey &&
            projection.embeddingModel === provider.model &&
            projection.embedding !== undefined,
        );
  return Object.freeze({
    indexVersion: INFORMATION_ENTRY_SEARCH_INDEX_VERSION,
    tokenizerVersion: INFORMATION_ENTRY_TERM_TOKENIZER_VERSION,
    publicEntryCount: entries.length,
    currentProjectionCount: currentProjections.length,
    embeddedProjectionCount: embedded.length,
    staleProjectionCount: Math.max(
      0,
      index.projections.length - currentProjections.length,
    ),
    postingCount: index.postings.length,
    semanticSearchAvailable: provider !== undefined,
    semanticSearchReady:
      provider !== undefined &&
      entries.length > 0 &&
      embedded.length === entries.length,
    ...(provider === undefined
      ? {}
      : {
          embeddingProvider: provider.providerKey,
          embeddingModel: provider.model,
        }),
  });
}

function mean(values: readonly number[]): number {
  return values.length === 0
    ? 0
    : Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);
}
