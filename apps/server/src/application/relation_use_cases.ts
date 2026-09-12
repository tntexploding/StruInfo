import {
  INFORMATION_ENTRY_ASSOCIATION_POLICY,
  INFORMATION_ENTRY_GRAPH_MAXIMUM_NEIGHBORS,
  buildInformationEntryKnowledgeGraph,
  decodeSourceReviewRevisions,
  deriveInformationEntryAssociationOverrideRevisionId,
  orderedInformationEntryAssociationPair,
  prepareInformationEntryGraphEdit,
  prepareInformationEntryGraphRelation,
  prepareInformationEntryGraphVisibility,
  searchCurrentInformationEntries,
  listInformationEntryAssociations as selectInformationEntryAssociations,
  type CurrentInformationEntry,
  type InformationEntryAssociationPolicy,
  type InformationEntryAssociationRepositoryPort,
  type InformationEntryAssociationRepositorySnapshot,
  type InformationEntryGraphDirection,
  type InformationEntryGraphSemanticKind,
  type InformationEntryGraphVerificationStatus,
  type InformationEntryRepositoryPort,
  type InformationEntryRetrievalServicePort,
  type InformationEntrySourceReviewRevisions,
} from '../modules/entries/index.js';
import {
  DEFAULT_REVIEW_ASSOCIATION_POLICY_PREFERENCES,
  type ReviewAssociationPolicyPreferences,
  type ReviewPreferencesStore,
} from '../storage/review_preferences_store.js';

import type {ExecutionAuthority} from './execution_authority.js';
import {
  OperationError,
  assertOperationId,
  assertOperationVersion,
} from './operation_error.js';
export type GraphReadRequest = Readonly<{
  query?: string;
  centerEntryId?: string;
  includePrivate: boolean;
  onlyPrivate: boolean;
  candidateLimit: number;
  neighborLimit: number;
}>;
export type GraphEdgeWriteRequest = Readonly<
  | {
      expectedRevision: number;
      includePrivate: boolean;
      operation: 'edit';
      expectedEntryRevisions?: Readonly<InformationEntrySourceReviewRevisions>;
      label: string;
      direction: InformationEntryGraphDirection;
      semanticKind: InformationEntryGraphSemanticKind;
      verificationStatus: InformationEntryGraphVerificationStatus;
      note: string;
    }
  | {
      expectedRevision: number;
      includePrivate: boolean;
      operation: 'block' | 'restore';
    }
>;
export interface RelationUseCasesDependencies {
  readonly informationEntryRepository: InformationEntryRepositoryPort;
  readonly informationEntryAssociationRepository: InformationEntryAssociationRepositoryPort;
  readonly informationEntryRetrieval?: InformationEntryRetrievalServicePort;
  readonly reviewPreferences: ReviewPreferencesStore;
}

export class RelationUseCases {
  readonly #dependencies: Readonly<RelationUseCasesDependencies>;
  readonly #authority: ExecutionAuthority;
  public constructor(
    authority: ExecutionAuthority,
    dependencies: Readonly<RelationUseCasesDependencies>,
  ) {
    this.#authority = authority;
    this.#dependencies = dependencies;
  }
  public async readGraph(input: GraphReadRequest) {
    this.#authority.require('relations.read', input.includePrivate);
    if (input.centerEntryId !== undefined)
      assertOperationId(input.centerEntryId, 'centerEntryId');
    if (
      typeof input.onlyPrivate !== 'boolean' ||
      (input.onlyPrivate && !input.includePrivate) ||
      !Number.isSafeInteger(input.candidateLimit) ||
      input.candidateLimit < 1 ||
      input.candidateLimit > 12 ||
      !Number.isSafeInteger(input.neighborLimit) ||
      input.neighborLimit < 1 ||
      input.neighborLimit > INFORMATION_ENTRY_GRAPH_MAXIMUM_NEIGHBORS ||
      (input.query !== undefined &&
        (typeof input.query !== 'string' ||
          Array.from(input.query).length > 300))
    )
      throw new OperationError('invalid_input', 'invalid_request');

    const retrieval = this.#dependencies.informationEntryRetrieval;
    if (
      retrieval !== undefined &&
      this.#dependencies.informationEntryRepository.loadCurrentEntriesByIds !==
        undefined &&
      this.#dependencies.informationEntryAssociationRepository
        .loadAssociationSnapshotForEntries !== undefined
    ) {
      const searchResult = await retrieval.search({
        retrievalMode: 'lexical',
        ...(input.query === undefined ? {} : {text: input.query}),
        includePrivate: input.includePrivate,
        onlyPrivate: input.onlyPrivate,
        limit: input.candidateLimit,
      });
      const centerEntryId =
        input.centerEntryId ?? searchResult.items[0]?.entry.entryId;
      if (centerEntryId === undefined) {
        return {
          status: 'ok' as const,
          querySha256: searchResult.querySha256,
          candidateTotalCount: searchResult.totalCount,
          candidates: searchResult.items,
          graph: null,
        };
      }
      const neighborhood =
        await this.#loadInformationEntryAssociationNeighborhood(
          [centerEntryId],
          input.includePrivate,
        );
      const entries = input.onlyPrivate
        ? neighborhood.entries.filter((entry) => entry.value.isPrivate)
        : neighborhood.entries;
      if (!entries.some((entry) => entry.entryId === centerEntryId)) {
        throw new OperationError('not_found', 'information_entry_not_found');
      }
      const graph = buildInformationEntryKnowledgeGraph(
        centerEntryId,
        entries,
        neighborhood.snapshot,
        input.neighborLimit,
      );
      return {
        status: 'ok' as const,
        querySha256: searchResult.querySha256,
        candidateTotalCount: searchResult.totalCount,
        candidates: searchResult.items,
        graph: graph ?? null,
      };
    }
    const [loadedEntries, associationSnapshot] = await Promise.all([
      this.#dependencies.informationEntryRepository.loadCurrentEntries(
        this.#authority.workspaceId,
        input.includePrivate,
      ),
      this.#dependencies.informationEntryAssociationRepository.loadAssociationSnapshot(
        this.#authority.workspaceId,
        input.includePrivate,
      ),
    ]);
    const entries = input.onlyPrivate
      ? loadedEntries.filter((entry) => entry.value.isPrivate)
      : loadedEntries;
    const searchResult = searchCurrentInformationEntries(entries, {
      ...(input.query === undefined ? {} : {text: input.query}),
      includePrivate: input.includePrivate,
      onlyPrivate: input.onlyPrivate,
      limit: input.candidateLimit,
    });
    const centerEntryId =
      input.centerEntryId ?? searchResult.items[0]?.entry.entryId;
    if (
      input.centerEntryId !== undefined &&
      !entries.some((entry) => entry.entryId === input.centerEntryId)
    ) {
      throw new OperationError('not_found', 'information_entry_not_found');
    }
    const graph =
      centerEntryId === undefined
        ? undefined
        : buildInformationEntryKnowledgeGraph(
            centerEntryId,
            entries,
            associationSnapshot,
            input.neighborLimit,
          );
    return {
      status: 'ok' as const,
      querySha256: searchResult.querySha256,
      candidateTotalCount: searchResult.totalCount,
      candidates: searchResult.items,
      graph: graph ?? null,
    };
  }
  public async list(entryId: string, includePrivate = false) {
    this.#authority.require('relations.read', includePrivate);
    assertOperationId(entryId, 'entryId');

    const [neighborhood, policy] = await Promise.all([
      this.#loadInformationEntryAssociationNeighborhood(
        [entryId],
        includePrivate,
      ),
      this.#loadInformationEntryAssociationPolicy(),
    ]);
    const {entries, snapshot} = neighborhood;
    if (!entries.some((entry) => entry.entryId === entryId)) {
      throw new OperationError('not_found', 'information_entry_not_found');
    }
    const associations = selectInformationEntryAssociations(
      entryId,
      entries,
      snapshot,
    );
    return {
      status: 'ok' as const,
      entryId,
      totalCount: associations.length,
      policy,
      associations,
    };
  }
  public async reviseEdge(
    entryId: string,
    relatedEntryId: string,
    input: GraphEdgeWriteRequest,
  ) {
    this.#authority.require('relations.revise', input.includePrivate);
    assertOperationId(entryId, 'entryId');
    assertOperationId(relatedEntryId, 'relatedEntryId');
    assertOperationVersion(input.expectedRevision, 'expectedRevision', 0);
    const pair = orderedInformationEntryAssociationPair(
      entryId,
      relatedEntryId,
    );
    if (
      pair === undefined ||
      !['edit', 'block', 'restore'].includes(input.operation)
    )
      throw new OperationError('invalid_input', 'invalid_request');
    if (
      input.operation === 'edit' &&
      (input.expectedEntryRevisions !== undefined ||
        input.verificationStatus === 'source_checked') &&
      decodeSourceReviewRevisions(input.expectedEntryRevisions) === undefined
    )
      throw new OperationError('invalid_input', 'invalid_request');

    const [entries, snapshot] = await Promise.all([
      this.#dependencies.informationEntryRepository.loadCurrentEntries(
        this.#authority.workspaceId,
        input.includePrivate,
      ),
      this.#dependencies.informationEntryAssociationRepository.loadAssociationSnapshot(
        this.#authority.workspaceId,
        input.includePrivate,
      ),
    ]);
    if (
      !entries.some((entry) => entry.entryId === entryId) ||
      !entries.some((entry) => entry.entryId === relatedEntryId)
    ) {
      throw new OperationError('not_found', 'information_entry_not_found');
    }
    const projection = snapshot.projections.find(
      (candidate) =>
        candidate.entryLowId === pair.entryLowId &&
        candidate.entryHighId === pair.entryHighId,
    );
    const current = snapshot.overrides.find(
      (candidate) =>
        candidate.entryLowId === pair.entryLowId &&
        candidate.entryHighId === pair.entryHighId,
    );
    if (
      input.operation !== 'edit' &&
      projection === undefined &&
      current?.value.graph === undefined
    ) {
      throw new OperationError(
        'not_found',
        'information_entry_graph_edge_not_found',
      );
    }
    let value;
    if (input.operation === 'edit') {
      const origin =
        current?.value.graph?.origin === 'ai'
          ? projection === undefined
            ? 'user'
            : 'association'
          : (current?.value.graph?.origin ??
            (projection === undefined ? 'user' : 'association'));
      const graph = prepareInformationEntryGraphRelation(
        input.label,
        input.direction,
        origin,
        {
          semanticKind: input.semanticKind,
          verificationStatus: input.verificationStatus,
          note: input.note,
        },
      );
      if (graph === undefined)
        throw new OperationError('invalid_input', 'invalid_request', 'label');
      value = prepareInformationEntryGraphEdit(
        current?.value,
        projection !== undefined,
        input.expectedEntryRevisions === undefined
          ? graph
          : Object.freeze({
              ...graph,
              reviewedRevisions: input.expectedEntryRevisions,
            }),
      );
    } else {
      value = prepareInformationEntryGraphVisibility(
        current?.value,
        projection !== undefined,
        input.operation === 'block',
      );
    }
    const outcome =
      await this.#dependencies.informationEntryAssociationRepository.writeAssociationOverride(
        {
          workspaceId: this.#authority.workspaceId,
          ...pair,
          expectedRevision: input.expectedRevision,
          revisionId: deriveInformationEntryAssociationOverrideRevisionId(
            pair.entryLowId,
            pair.entryHighId,
            input.expectedRevision + 1,
          ),
          includePrivate: input.includePrivate,
          ...(input.operation === 'edit' &&
          input.expectedEntryRevisions !== undefined
            ? {expectedEntryRevisions: input.expectedEntryRevisions}
            : {}),
          value,
        },
      );
    if (outcome === 'not_found') {
      throw new OperationError('not_found', 'information_entry_not_found');
    }
    if (outcome === 'stale') {
      throw new OperationError(
        'conflict',
        'stale_association_override_revision',
      );
    }
    return {status: outcome};
  }
  async #loadInformationEntryAssociationNeighborhood(
    entryIds: readonly string[],
    includePrivate: boolean,
  ): Promise<
    Readonly<{
      entries: readonly Readonly<CurrentInformationEntry>[];
      snapshot: Readonly<InformationEntryAssociationRepositorySnapshot>;
    }>
  > {
    const associationRepository =
      this.#dependencies.informationEntryAssociationRepository;
    const loadTargeted =
      associationRepository.loadAssociationSnapshotForEntries?.bind(
        associationRepository,
      );
    const loadEntriesByIds =
      this.#dependencies.informationEntryRepository.loadCurrentEntriesByIds?.bind(
        this.#dependencies.informationEntryRepository,
      );
    if (loadTargeted === undefined || loadEntriesByIds === undefined) {
      const [entries, snapshot] = await Promise.all([
        this.#dependencies.informationEntryRepository.loadCurrentEntries(
          this.#authority.workspaceId,
          includePrivate,
        ),
        associationRepository.loadAssociationSnapshot(
          this.#authority.workspaceId,
          includePrivate,
        ),
      ]);
      return Object.freeze({entries, snapshot});
    }
    const snapshot = await loadTargeted(
      this.#authority.workspaceId,
      includePrivate,
      entryIds,
    );
    const endpointIds = new Set(entryIds);
    for (const projection of snapshot.projections) {
      endpointIds.add(projection.entryLowId);
      endpointIds.add(projection.entryHighId);
    }
    for (const override of snapshot.overrides) {
      endpointIds.add(override.entryLowId);
      endpointIds.add(override.entryHighId);
    }
    const entries = await loadEntriesByIds(
      this.#authority.workspaceId,
      includePrivate,
      [...endpointIds],
    );
    return Object.freeze({entries, snapshot});
  }
  async #loadInformationEntryAssociationPolicy(): Promise<
    Readonly<InformationEntryAssociationPolicy>
  > {
    const preferences = await this.#dependencies.reviewPreferences.load(
      this.#authority.workspaceId,
    );
    return informationEntryAssociationPolicyFromPreferences(
      preferences.associationPolicy ??
        DEFAULT_REVIEW_ASSOCIATION_POLICY_PREFERENCES,
    );
  }
}

export function informationEntryAssociationPolicyFromPreferences(
  preferences: Readonly<ReviewAssociationPolicyPreferences>,
): Readonly<InformationEntryAssociationPolicy> {
  return Object.freeze({
    revision: preferences.revision,
    version: INFORMATION_ENTRY_ASSOCIATION_POLICY.version,
    contentWeight: preferences.contentWeight,
    typeWeight: preferences.typeWeight,
    domainWeight: preferences.domainWeight,
    threshold: preferences.threshold,
    candidateLimit: INFORMATION_ENTRY_ASSOCIATION_POLICY.candidateLimit,
    adjustmentStep: INFORMATION_ENTRY_ASSOCIATION_POLICY.adjustmentStep,
  });
}
