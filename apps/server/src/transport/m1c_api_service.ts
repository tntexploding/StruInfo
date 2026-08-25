import {Buffer} from 'node:buffer';

import {
  ENTRY_CHUNK_MODES,
  ENTRY_DOMAIN_KEYWORDS,
  ENTRY_TEXT_SEARCH_FIELDS,
  ENTRY_TEXT_SEARCH_MODES,
  ENTRY_TYPE_KEYWORDS,
  INFORMATION_ENTRY_ASSOCIATION_ACTIONS,
  INFORMATION_ENTRY_ASSOCIATION_POLICY,
  INFORMATION_ENTRY_EXPLORATION_POLICY_VERSION,
  INFORMATION_ENTRY_GRAPH_DIRECTIONS,
  INFORMATION_ENTRY_GRAPH_MAXIMUM_NEIGHBORS,
  InformationEntrySearchCursorError,
  InformationEntryQuerySynthesisServiceError,
  buildInformationEntryKnowledgeGraph,
  buildInformationEntryAssociationProjection,
  exploreCurrentInformationEntries,
  deriveInformationDocumentTagRevisionId,
  deriveInformationEntryAssociationOverrideRevisionId,
  deriveInformationEntryRevisionId,
  informationEntrySearchKey,
  listInformationEntryAssociations as selectInformationEntryAssociations,
  orderedInformationEntryAssociationPair,
  prepareAggregatedInformationDocumentTags,
  prepareInformationEntryAssociationOverride,
  prepareInformationEntryGraphEdit,
  prepareInformationEntryGraphRelation,
  prepareInformationEntryGraphVisibility,
  prepareManualInformationDocumentTags,
  prepareManualEntryRevision,
  prepareManualSplitInformationEntries,
  prepareSplitInformationEntries,
  searchCurrentInformationEntries,
  scoreInformationEntrySearchText,
  type CurrentInformationEntry,
  type EntryDomainKeyword,
  type EntryTextSearchField,
  type EntryTextSearchMode,
  type EntryTypeKeyword,
  type ManualEntryFragmentGroupInput,
  type InformationEntryAssociationAction,
  type InformationEntryAssociationPolicy,
  type InformationEntryExplorationPolicy,
  type InformationEntryExplorationRequest,
  type InformationEntryAssociationRepositoryPort,
  type InformationEntryAssociationRepositorySnapshot,
  type InformationEntryGraphDirection,
  type InformationDocumentTagRepositoryPort,
  type InformationEntryDocumentView,
  type InformationEntryEmptySnapshotRepositoryPort,
  type InformationEntrySearchRequest,
  type InformationEntryQuerySynthesisRequest,
  type InformationEntryQuerySynthesisServicePort,
} from '../modules/entries/index.js';
import {
  importMarkdownEvidence,
  importStructuredDocumentEvidence,
  materializeEvidenceSnapshot,
  type EvidenceReadRepositoryPort,
  type EvidenceRepositoryPort,
  type EvidenceSnapshotSummary,
  type ImportMarkdownEvidenceInput,
  type ImportStructuredDocumentEvidenceInput,
} from '../modules/evidence/index.js';
import {
  AiAssociationProposalServiceError,
  AiSplitProposalServiceError,
  AiTagProposalServiceError,
  type AiAssociationProposalServicePort,
  type AiSplitProposalServicePort,
  type AiTagProposalServicePort,
  type ProcessingProposal,
  type ProcessingRun,
  type ProcessingRunRepositoryPort,
} from '../modules/processing/index.js';
import {
  SourceSubscriptionServiceError,
  type SourceSubscriptionServicePort,
  type SourceSubscriptionWrite,
} from '../modules/subscriptions/index.js';
import type {BlobStore} from '../storage/blob_store.js';
import {
  decodeReviewAssociationPolicyPreferences,
  decodeReviewAutomaticKeywordPreferences,
  decodeReviewExplorationPolicyPreferences,
  decodeReviewSourceSubscriptionPreferences,
  decodeReviewQuickTags,
  decodeReviewVocabularyPreferences,
  DEFAULT_REVIEW_ASSOCIATION_POLICY_PREFERENCES,
  DEFAULT_REVIEW_AUTOMATIC_KEYWORD_PREFERENCES,
  DEFAULT_REVIEW_EXPLORATION_POLICY_PREFERENCES,
  DEFAULT_REVIEW_SOURCE_SUBSCRIPTION_PREFERENCES,
  DEFAULT_REVIEW_VOCABULARY_PREFERENCES,
  type ReviewAssociationPolicyPreferences,
  type ReviewExplorationPolicyPreferences,
  type ReviewPreferencesStore,
} from '../storage/review_preferences_store.js';
import {
  M1cWorkspaceTransferError,
  type M1cWorkspaceTransferPort,
} from '../workspace_transfer/m1c_workspace_transfer.js';

const CANONICAL_UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;

export interface M1cApiServiceDependencies {
  readonly workspaceId: string;
  readonly blobStore: BlobStore;
  readonly reviewPreferences: ReviewPreferencesStore;
  readonly evidenceRepository: EvidenceRepositoryPort;
  readonly evidenceReadRepository: EvidenceReadRepositoryPort;
  readonly informationEntryRepository: InformationEntryEmptySnapshotRepositoryPort;
  readonly informationDocumentTagRepository: InformationDocumentTagRepositoryPort;
  readonly informationEntryAssociationRepository: InformationEntryAssociationRepositoryPort;
  readonly processingRunRepository: ProcessingRunRepositoryPort;
  readonly sourceSubscriptions?: SourceSubscriptionServicePort;
  readonly aiSplitProposals?: AiSplitProposalServicePort;
  readonly aiTagProposals?: AiTagProposalServicePort;
  readonly aiAssociationProposals?: AiAssociationProposalServicePort;
  readonly aiQuerySynthesis?: InformationEntryQuerySynthesisServicePort;
  readonly workspaceTransfer: M1cWorkspaceTransferPort;
}

export interface M1cHttpResult {
  readonly statusCode: number;
  readonly body: unknown;
}

export interface M1cApiServicePort {
  workspace(): M1cHttpResult;
  listEvidence(): Promise<M1cHttpResult>;
  loadEvidenceSnapshot(
    snapshotId: string,
    includePrivate?: unknown,
  ): Promise<M1cHttpResult>;
  loadReviewPreferences(): Promise<M1cHttpResult>;
  saveReviewPreferences(body: unknown): Promise<M1cHttpResult>;
  importMarkdown(body: unknown): Promise<M1cHttpResult>;
  importDocument(body: unknown): Promise<M1cHttpResult>;
  materializeInformationEntries(body: unknown): Promise<M1cHttpResult>;
  materializeManualInformationEntries(body: unknown): Promise<M1cHttpResult>;
  reviseInformationEntry(
    entryId: string,
    body: unknown,
  ): Promise<M1cHttpResult>;
  searchInformationEntries(body: unknown): Promise<M1cHttpResult>;
  exploreInformationEntries(body: unknown): Promise<M1cHttpResult>;
  synthesizeInformationEntryQuery(body: unknown): Promise<M1cHttpResult>;
  readInformationEntryKnowledgeGraph(body: unknown): Promise<M1cHttpResult>;
  reviseInformationEntryKnowledgeGraphEdge(
    entryId: string,
    relatedEntryId: string,
    body: unknown,
  ): Promise<M1cHttpResult>;
  rebuildInformationEntryAssociations(body: unknown): Promise<M1cHttpResult>;
  reviseInformationEntryAssociationPolicy(
    body: unknown,
  ): Promise<M1cHttpResult>;
  reviseInformationEntryExplorationPolicy(
    body: unknown,
  ): Promise<M1cHttpResult>;
  listInformationEntryAssociations(
    entryId: string,
    includePrivate?: unknown,
  ): Promise<M1cHttpResult>;
  reviseInformationEntryAssociation(
    entryId: string,
    relatedEntryId: string,
    body: unknown,
  ): Promise<M1cHttpResult>;
  listInformationEntryDocuments(
    includePrivate?: unknown,
  ): Promise<M1cHttpResult>;
  aggregateInformationDocumentTags(
    snapshotId: string,
    body: unknown,
  ): Promise<M1cHttpResult>;
  reviseInformationDocumentTags(
    snapshotId: string,
    body: unknown,
  ): Promise<M1cHttpResult>;
  listProcessingRuns(limit?: unknown): Promise<M1cHttpResult>;
  cancelProcessingRun(runId: string, body: unknown): Promise<M1cHttpResult>;
  listSourceSubscriptions(): Promise<M1cHttpResult>;
  replaceSourceSubscriptions(body: unknown): Promise<M1cHttpResult>;
  runSourceSubscription(
    subscriptionId: string,
    body: unknown,
  ): Promise<M1cHttpResult>;
  listAiSplitProposals(snapshotId: string): Promise<M1cHttpResult>;
  startAiSplitProposal(
    snapshotId: string,
    body: unknown,
  ): Promise<M1cHttpResult>;
  acceptAiSplitProposal(
    snapshotId: string,
    proposalId: string,
  ): Promise<M1cHttpResult>;
  rejectAiSplitProposal(
    snapshotId: string,
    proposalId: string,
  ): Promise<M1cHttpResult>;
  listAiTagProposals(entryId: string): Promise<M1cHttpResult>;
  startAiTagProposal(entryId: string, body: unknown): Promise<M1cHttpResult>;
  acceptAiTagProposal(
    entryId: string,
    proposalId: string,
  ): Promise<M1cHttpResult>;
  rejectAiTagProposal(
    entryId: string,
    proposalId: string,
  ): Promise<M1cHttpResult>;
  listAiAssociationProposals(
    entryId: string,
    relatedEntryId: string,
  ): Promise<M1cHttpResult>;
  startAiAssociationProposal(
    entryId: string,
    relatedEntryId: string,
    body: unknown,
  ): Promise<M1cHttpResult>;
  acceptAiAssociationProposal(
    entryId: string,
    relatedEntryId: string,
    proposalId: string,
  ): Promise<M1cHttpResult>;
  rejectAiAssociationProposal(
    entryId: string,
    relatedEntryId: string,
    proposalId: string,
  ): Promise<M1cHttpResult>;
  exportWorkspaceBundle(): Promise<M1cHttpResult>;
  restoreWorkspaceBundle(body: unknown): Promise<M1cHttpResult>;
}

/** Thin local HTTP application layer over the accepted domain commands. */
export class M1cApiService implements M1cApiServicePort {
  readonly #dependencies: Readonly<M1cApiServiceDependencies>;

  public constructor(dependencies: Readonly<M1cApiServiceDependencies>) {
    this.#dependencies = dependencies;
  }

  async #loadInformationEntryAssociationPolicy(): Promise<
    Readonly<InformationEntryAssociationPolicy>
  > {
    const preferences = await this.#dependencies.reviewPreferences.load(
      this.#dependencies.workspaceId,
    );
    return informationEntryAssociationPolicyFromPreferences(
      preferences.associationPolicy ??
        DEFAULT_REVIEW_ASSOCIATION_POLICY_PREFERENCES,
    );
  }

  async #loadInformationEntryExplorationPolicy(): Promise<
    Readonly<InformationEntryExplorationPolicy>
  > {
    const preferences = await this.#dependencies.reviewPreferences.load(
      this.#dependencies.workspaceId,
    );
    return informationEntryExplorationPolicyFromPreferences(
      preferences.explorationPolicy ??
        DEFAULT_REVIEW_EXPLORATION_POLICY_PREFERENCES,
    );
  }

  async #searchPrivateDocuments(
    request: Readonly<InformationEntrySearchRequest>,
    entries: readonly Readonly<CurrentInformationEntry>[],
    associationSnapshot: Readonly<InformationEntryAssociationRepositorySnapshot>,
  ): Promise<
    Readonly<{
      totalCount: number;
      items: readonly Readonly<Record<string, unknown>>[];
    }>
  > {
    if (!request.includePrivate) {
      return Object.freeze({totalCount: 0, items: Object.freeze([])});
    }
    const textMode = request.textMode ?? 'substring';
    const textFields = request.textFields ?? ENTRY_TEXT_SEARCH_FIELDS;
    const requiresStructuralEntryMatch =
      request.contentKeyword !== undefined ||
      request.typeKeyword !== undefined ||
      request.typeCustomName !== undefined ||
      request.domainKeyword !== undefined ||
      request.domainCustomName !== undefined ||
      request.chunkMode !== undefined ||
      request.association !== undefined;
    const {
      text: ignoredText,
      textMode: ignoredTextMode,
      textFields: ignoredTextFields,
      after: ignoredAfter,
      ...structuralRequest
    } = request;
    void ignoredText;
    void ignoredTextMode;
    void ignoredTextFields;
    void ignoredAfter;
    const structuralEntryMatches = requiresStructuralEntryMatch
      ? searchCurrentInformationEntries(
          entries,
          {
            ...structuralRequest,
            limit: Math.max(1, entries.length),
          },
          associationSnapshot,
        ).items
      : Object.freeze([]);
    const structuralEntryMatchCounts = entryMatchCountsBySnapshot(
      structuralEntryMatches,
    );
    const query = informationEntrySearchKey(request.text ?? '');
    const tagEntryMatches =
      query !== '' && textFields.includes('tags')
        ? searchCurrentInformationEntries(
            entries,
            {
              ...structuralRequest,
              text: request.text ?? '',
              textMode,
              textFields: Object.freeze(['tags']),
              limit: Math.max(1, entries.length),
            },
            associationSnapshot,
          ).items
        : Object.freeze([]);
    const tagEntryMatchesBySnapshot = new Map<
      string,
      Readonly<{count: number; score: number}>
    >();
    for (const match of tagEntryMatches) {
      if (!match.entry.value.isPrivate || match.textMatch === undefined)
        continue;
      const previous = tagEntryMatchesBySnapshot.get(match.entry.snapshotId);
      tagEntryMatchesBySnapshot.set(
        match.entry.snapshotId,
        Object.freeze({
          count: (previous?.count ?? 0) + 1,
          score: Math.max(previous?.score ?? 0, match.textMatch.score),
        }),
      );
    }
    const summaries = (
      await this.#dependencies.evidenceReadRepository.listSnapshots(
        this.#dependencies.workspaceId,
      )
    )
      .filter((snapshot) => snapshot.isPrivate === true)
      .filter((snapshot) =>
        privateDocumentMatchesStructuralFilters(
          snapshot,
          request,
          requiresStructuralEntryMatch ? structuralEntryMatchCounts : undefined,
        ),
      )
      .sort((left, right) => {
        const captured = right.capturedAt.localeCompare(left.capturedAt);
        return captured === 0
          ? left.snapshotId.localeCompare(right.snapshotId)
          : captured;
      });
    const items: Readonly<Record<string, unknown>>[] = [];
    for (const summary of summaries) {
      const matchReasons: string[] = [];
      let excerpt: string | undefined;
      let textScore = 0;
      if (query !== '') {
        if (textFields.includes('title')) {
          const sourceScore = scoreInformationEntrySearchText(
            summary.sourceKey,
            query,
            textMode,
          );
          if (sourceScore !== undefined) {
            matchReasons.push('source');
            textScore = Math.max(textScore, sourceScore);
          }
          if (summary.canonicalUri !== undefined) {
            const uriScore = scoreInformationEntrySearchText(
              summary.canonicalUri,
              query,
              textMode,
            );
            if (uriScore !== undefined) {
              matchReasons.push('uri');
              textScore = Math.max(textScore, uriScore);
            }
          }
        }
        if (textFields.includes('tags')) {
          const tagMatch = tagEntryMatchesBySnapshot.get(summary.snapshotId);
          if (tagMatch !== undefined) {
            matchReasons.push('entry_tags');
            textScore = Math.max(textScore, tagMatch.score);
          }
        }
        if (textFields.includes('body')) {
          const snapshot =
            await this.#dependencies.evidenceReadRepository.loadSnapshot(
              this.#dependencies.workspaceId,
              summary.snapshotId,
            );
          if (snapshot === undefined) {
            throw new Error(
              'Private evidence Snapshot disappeared during search.',
            );
          }
          const materialized = await materializeEvidenceSnapshot(
            snapshot,
            this.#dependencies.blobStore,
          );
          const documentText = materialized.structures
            .map((structure) =>
              typeof structure.normalizedText === 'string'
                ? structure.normalizedText
                : '',
            )
            .join('\n');
          const bodyScore = scoreInformationEntrySearchText(
            documentText,
            query,
            textMode,
          );
          if (bodyScore !== undefined) {
            matchReasons.push('body');
            textScore = Math.max(textScore, bodyScore);
            excerpt = privateDocumentExcerpt(documentText);
          }
        }
        if (matchReasons.length === 0) continue;
      }
      const structuralCount =
        structuralEntryMatchCounts.get(summary.snapshotId) ?? 0;
      const tagCount =
        tagEntryMatchesBySnapshot.get(summary.snapshotId)?.count ?? 0;
      items.push(
        Object.freeze({
          snapshot: summary,
          matchReasons: Object.freeze(matchReasons),
          entryMatchCount: Math.max(structuralCount, tagCount),
          ...(query === ''
            ? {}
            : {textMatch: Object.freeze({mode: textMode, score: textScore})}),
          ...(excerpt === undefined ? {} : {excerpt}),
        }),
      );
    }
    return Object.freeze({
      totalCount: items.length,
      items: Object.freeze(items),
    });
  }
  public workspace(): M1cHttpResult {
    return httpResult(200, {
      status: 'ok',
      workspaceId: this.#dependencies.workspaceId,
      capabilities: Object.freeze([
        'markdown_import',
        'evidence_read',
        'information_entries',
        'information_document_tags',
        'information_entry_knowledge_graph',
        'information_entry_association_policy',
        'information_entry_exploration',
        'private_documents',
        'processing_runs',
        'review_preferences',
        'workspace_bundle_export',
        'workspace_bundle_restore',
        ...(this.#dependencies.sourceSubscriptions === undefined
          ? []
          : ['source_subscriptions']),
        ...(this.#dependencies.aiSplitProposals === undefined
          ? []
          : ['ai_split']),
        ...(this.#dependencies.aiTagProposals === undefined ? [] : ['ai_tags']),
        ...(this.#dependencies.aiAssociationProposals === undefined
          ? []
          : ['ai_associations']),
        ...(this.#dependencies.aiQuerySynthesis === undefined
          ? []
          : ['ai_query_synthesis']),
      ]),
    });
  }

  public async listEvidence(): Promise<M1cHttpResult> {
    try {
      const snapshots =
        await this.#dependencies.evidenceReadRepository.listSnapshots(
          this.#dependencies.workspaceId,
        );
      return httpResult(200, {status: 'ok', snapshots});
    } catch {
      return repositoryFailure();
    }
  }

  public async loadEvidenceSnapshot(
    snapshotId: string,
    includePrivate: unknown = false,
  ): Promise<M1cHttpResult> {
    if (!CANONICAL_UUID.test(snapshotId)) {
      return inputFailure('path.snapshotId');
    }
    if (typeof includePrivate !== 'boolean') {
      return inputFailure('query.includePrivate');
    }
    try {
      const snapshot =
        await this.#dependencies.evidenceReadRepository.loadSnapshot(
          this.#dependencies.workspaceId,
          snapshotId,
        );
      if (snapshot === undefined) {
        return httpResult(404, {
          status: 'not_found',
          issue: Object.freeze({code: 'snapshot_not_found'}),
        });
      }
      if (snapshot.isPrivate === true && !includePrivate) {
        return httpResult(403, {
          status: 'rejected',
          issue: Object.freeze({
            code: 'private_content_requires_opt_in',
            path: 'query.includePrivate',
          }),
        });
      }
      return httpResult(200, {
        status: 'ok',
        snapshot: await materializeEvidenceSnapshot(
          snapshot,
          this.#dependencies.blobStore,
        ),
      });
    } catch {
      return httpResult(503, {
        status: 'failed',
        issue: Object.freeze({code: 'evidence_read_failed'}),
      });
    }
  }

  public async loadReviewPreferences(): Promise<M1cHttpResult> {
    try {
      const preferences = await this.#dependencies.reviewPreferences.load(
        this.#dependencies.workspaceId,
      );
      return httpResult(200, {
        status: 'ok',
        workspaceId: preferences.workspaceId,
        quickTags: preferences.quickTags,
        automaticKeywords:
          preferences.automaticKeywords ??
          DEFAULT_REVIEW_AUTOMATIC_KEYWORD_PREFERENCES,
        vocabulary:
          preferences.vocabulary ?? DEFAULT_REVIEW_VOCABULARY_PREFERENCES,
        associationPolicy:
          preferences.associationPolicy ??
          DEFAULT_REVIEW_ASSOCIATION_POLICY_PREFERENCES,
        explorationPolicy:
          preferences.explorationPolicy ??
          DEFAULT_REVIEW_EXPLORATION_POLICY_PREFERENCES,
      });
    } catch {
      return reviewPreferencesFailure();
    }
  }

  public async saveReviewPreferences(body: unknown): Promise<M1cHttpResult> {
    if (!isRecord(body)) return inputFailure('body');
    const quickTags = decodeReviewQuickTags(body.quickTags);
    if (quickTags === undefined) return inputFailure('body.quickTags');
    const automaticKeywords =
      body.automaticKeywords === undefined
        ? DEFAULT_REVIEW_AUTOMATIC_KEYWORD_PREFERENCES
        : decodeReviewAutomaticKeywordPreferences(body.automaticKeywords);
    if (automaticKeywords === undefined) {
      return inputFailure('body.automaticKeywords');
    }
    const vocabulary =
      body.vocabulary === undefined
        ? DEFAULT_REVIEW_VOCABULARY_PREFERENCES
        : decodeReviewVocabularyPreferences(body.vocabulary);
    if (vocabulary === undefined) {
      return inputFailure('body.vocabulary');
    }
    const associationPolicy =
      body.associationPolicy === undefined
        ? undefined
        : decodeReviewAssociationPolicyPreferences(body.associationPolicy);
    if (
      body.associationPolicy !== undefined &&
      associationPolicy === undefined
    ) {
      return inputFailure('body.associationPolicy');
    }
    const explorationPolicy =
      body.explorationPolicy === undefined
        ? undefined
        : decodeReviewExplorationPolicyPreferences(body.explorationPolicy);
    if (
      body.explorationPolicy !== undefined &&
      explorationPolicy === undefined
    ) {
      return inputFailure('body.explorationPolicy');
    }
    try {
      const current = await this.#dependencies.reviewPreferences.load(
        this.#dependencies.workspaceId,
      );
      const effectiveAssociationPolicy =
        associationPolicy ??
        current.associationPolicy ??
        DEFAULT_REVIEW_ASSOCIATION_POLICY_PREFERENCES;
      const effectiveExplorationPolicy =
        explorationPolicy ??
        current.explorationPolicy ??
        DEFAULT_REVIEW_EXPLORATION_POLICY_PREFERENCES;
      const preferences = await this.#dependencies.reviewPreferences.save(
        this.#dependencies.workspaceId,
        quickTags,
        automaticKeywords,
        vocabulary,
        effectiveAssociationPolicy,
        effectiveExplorationPolicy,
        current.sourceSubscriptions ??
          DEFAULT_REVIEW_SOURCE_SUBSCRIPTION_PREFERENCES,
      );
      return httpResult(200, {
        status: 'ok',
        workspaceId: preferences.workspaceId,
        quickTags: preferences.quickTags,
        automaticKeywords: preferences.automaticKeywords ?? automaticKeywords,
        vocabulary: preferences.vocabulary ?? vocabulary,
        associationPolicy:
          preferences.associationPolicy ?? effectiveAssociationPolicy,
        explorationPolicy:
          preferences.explorationPolicy ?? effectiveExplorationPolicy,
      });
    } catch {
      return reviewPreferencesFailure();
    }
  }

  public async importMarkdown(body: unknown): Promise<M1cHttpResult> {
    const input = mapMarkdownImportBody(body, this.#dependencies.workspaceId);
    if (input === undefined) return inputFailure('body');
    const result = await importMarkdownEvidence(
      {
        blobStore: this.#dependencies.blobStore,
        evidenceRepository: this.#dependencies.evidenceRepository,
      },
      input,
    );
    return httpResult(statusForImport(result.status), result);
  }

  public async importDocument(body: unknown): Promise<M1cHttpResult> {
    if (
      isRecord(body) &&
      (body.documentFormat === 'html' || body.documentFormat === 'pdf')
    ) {
      const input = mapStructuredDocumentImportBody(
        body,
        this.#dependencies.workspaceId,
      );
      if (input === undefined) return inputFailure('body');
      const result = await importStructuredDocumentEvidence(
        {
          blobStore: this.#dependencies.blobStore,
          evidenceRepository: this.#dependencies.evidenceRepository,
        },
        input,
      );
      return httpResult(statusForImport(result.status), result);
    }
    return this.importMarkdown(body);
  }

  public async materializeInformationEntries(
    body: unknown,
  ): Promise<M1cHttpResult> {
    if (
      !isRecord(body) ||
      typeof body.snapshotId !== 'string' ||
      !CANONICAL_UUID.test(body.snapshotId)
    ) {
      return inputFailure('body.snapshotId');
    }
    if (body.chunkMode !== undefined && body.chunkMode !== 'split') {
      return inputFailure('body.chunkMode');
    }
    const includePrivate = body.includePrivate ?? false;
    if (typeof includePrivate !== 'boolean') {
      return inputFailure('body.includePrivate');
    }
    const snapshotId = body.snapshotId;
    try {
      const snapshot =
        await this.#dependencies.evidenceReadRepository.loadSnapshot(
          this.#dependencies.workspaceId,
          snapshotId,
        );
      if (
        snapshot === undefined ||
        (snapshot.isPrivate === true && !includePrivate)
      ) {
        return httpResult(404, {
          status: 'not_found',
          issue: Object.freeze({code: 'snapshot_not_found'}),
        });
      }
      const materialized = await materializeEvidenceSnapshot(
        snapshot,
        this.#dependencies.blobStore,
      );
      const entries = prepareSplitInformationEntries(materialized);
      if (entries.length === 0) {
        return httpResult(422, {
          status: 'rejected',
          issue: Object.freeze({code: 'entry_sections_not_found'}),
        });
      }
      const persisted =
        await this.#dependencies.informationEntryRepository.materializeEntriesIfSnapshotEmpty(
          entries,
        );
      if (persisted.outcome === 'snapshot_not_empty') {
        return httpResult(409, {
          status: 'rejected',
          issue: Object.freeze({code: 'split_structure_already_materialized'}),
        });
      }
      const current =
        await this.#dependencies.informationEntryRepository.loadCurrentEntries(
          this.#dependencies.workspaceId,
          includePrivate,
        );
      const entryIds = new Set(entries.map((entry) => entry.entryId));
      return httpResult(persisted.outcome === 'created' ? 201 : 200, {
        status: persisted.outcome,
        snapshotId,
        createdCount: persisted.createdCount,
        entries: Object.freeze(
          current.filter((entry) => entryIds.has(entry.entryId)),
        ),
      });
    } catch {
      return repositoryFailure();
    }
  }

  public async materializeManualInformationEntries(
    body: unknown,
  ): Promise<M1cHttpResult> {
    const input = decodeManualEntrySplitBody(body);
    if (input === undefined) return inputFailure('body');
    try {
      const snapshot =
        await this.#dependencies.evidenceReadRepository.loadSnapshot(
          this.#dependencies.workspaceId,
          input.snapshotId,
        );
      if (
        snapshot === undefined ||
        (snapshot.isPrivate === true && !input.includePrivate)
      ) {
        return httpResult(404, {
          status: 'not_found',
          issue: Object.freeze({code: 'snapshot_not_found'}),
        });
      }
      const materialized = await materializeEvidenceSnapshot(
        snapshot,
        this.#dependencies.blobStore,
      );
      const entries = prepareManualSplitInformationEntries(
        materialized,
        input.groups,
      );
      if (entries === undefined || entries.length === 0) {
        return httpResult(422, {
          status: 'rejected',
          issue: Object.freeze({code: 'manual_split_invalid'}),
        });
      }
      const persisted =
        await this.#dependencies.informationEntryRepository.materializeEntriesIfSnapshotEmpty(
          entries,
        );
      if (persisted.outcome === 'snapshot_not_empty') {
        return httpResult(409, {
          status: 'rejected',
          issue: Object.freeze({code: 'split_structure_already_materialized'}),
        });
      }
      const current =
        await this.#dependencies.informationEntryRepository.loadCurrentEntries(
          this.#dependencies.workspaceId,
          input.includePrivate,
        );
      const entryIds = new Set(entries.map((entry) => entry.entryId));
      return httpResult(persisted.outcome === 'created' ? 201 : 200, {
        status: persisted.outcome,
        snapshotId: input.snapshotId,
        createdCount: persisted.createdCount,
        entries: Object.freeze(
          current.filter((entry) => entryIds.has(entry.entryId)),
        ),
      });
    } catch {
      return repositoryFailure();
    }
  }
  public async reviseInformationEntry(
    entryId: string,
    body: unknown,
  ): Promise<M1cHttpResult> {
    if (!CANONICAL_UUID.test(entryId)) return inputFailure('path.entryId');
    const input = decodeEntryRevisionBody(body);
    if (input === undefined) return inputFailure('body');
    try {
      const entries =
        await this.#dependencies.informationEntryRepository.loadCurrentEntries(
          this.#dependencies.workspaceId,
          input.includePrivate,
        );
      const current = entries.find((entry) => entry.entryId === entryId);
      if (current === undefined) {
        return httpResult(404, {
          status: 'not_found',
          issue: Object.freeze({code: 'information_entry_not_found'}),
        });
      }
      const value = prepareManualEntryRevision(current, input.annotation);
      if (value === undefined) return inputFailure('body.annotation');
      const outcome =
        await this.#dependencies.informationEntryRepository.reviseEntry({
          workspaceId: this.#dependencies.workspaceId,
          entryId,
          expectedRevision: input.expectedRevision,
          revisionId: deriveInformationEntryRevisionId(
            entryId,
            input.expectedRevision + 1,
          ),
          value,
        });
      if (outcome === 'not_found') {
        return httpResult(404, {
          status: 'not_found',
          issue: Object.freeze({code: 'information_entry_not_found'}),
        });
      }
      if (outcome === 'stale') {
        return httpResult(409, {
          status: 'rejected',
          issue: Object.freeze({code: 'stale_entry_revision'}),
        });
      }
      const refreshed =
        await this.#dependencies.informationEntryRepository.loadCurrentEntries(
          this.#dependencies.workspaceId,
          input.includePrivate,
        );
      return httpResult(200, {
        status: outcome,
        entry: refreshed.find((entry) => entry.entryId === entryId),
      });
    } catch {
      return repositoryFailure();
    }
  }

  public async searchInformationEntries(body: unknown): Promise<M1cHttpResult> {
    const request = decodeEntrySearchBody(body);
    if (request === undefined) return inputFailure('body');
    try {
      const [entries, associationSnapshot] = await Promise.all([
        this.#dependencies.informationEntryRepository.loadCurrentEntries(
          this.#dependencies.workspaceId,
          request.includePrivate,
        ),
        request.association === undefined
          ? Promise.resolve({projections: [], overrides: []})
          : this.#dependencies.informationEntryAssociationRepository.loadAssociationSnapshot(
              this.#dependencies.workspaceId,
              request.includePrivate,
            ),
      ]);
      const result = searchCurrentInformationEntries(
        entries,
        request,
        associationSnapshot,
      );
      const privateDocuments = await this.#searchPrivateDocuments(
        request,
        entries,
        associationSnapshot,
      );
      return httpResult(200, {
        status: 'ok',
        ...result,
        privateDocuments,
      });
    } catch (error) {
      if (error instanceof InformationEntrySearchCursorError) {
        return httpResult(422, {
          status: 'rejected',
          issue: Object.freeze({
            code: 'invalid_entry_search_cursor',
            path: 'body.after',
          }),
        });
      }
      return repositoryFailure();
    }
  }

  public async exploreInformationEntries(
    body: unknown,
  ): Promise<M1cHttpResult> {
    const request = decodeInformationEntryExplorationRequest(body);
    if (request === undefined) return inputFailure('body');
    try {
      const [entries, associationSnapshot, policy] = await Promise.all([
        this.#dependencies.informationEntryRepository.loadCurrentEntries(
          this.#dependencies.workspaceId,
          request.includePrivate,
        ),
        this.#dependencies.informationEntryAssociationRepository.loadAssociationSnapshot(
          this.#dependencies.workspaceId,
          request.includePrivate,
        ),
        this.#loadInformationEntryExplorationPolicy(),
      ]);
      const result = exploreCurrentInformationEntries(
        entries,
        associationSnapshot,
        request,
        policy,
      );
      if (result === undefined) {
        return httpResult(404, {
          status: 'not_found',
          issue: Object.freeze({code: 'information_entry_not_found'}),
        });
      }
      return httpResult(200, {status: 'ok', ...result});
    } catch {
      return repositoryFailure();
    }
  }

  public async synthesizeInformationEntryQuery(
    body: unknown,
  ): Promise<M1cHttpResult> {
    if (querySynthesisRequestsPrivateScope(body)) {
      return httpResult(409, {
        status: 'rejected',
        issue: Object.freeze({code: 'ai_query_private_scope_forbidden'}),
      });
    }
    const input = decodeInformationEntryQuerySynthesisBody(body);
    if (input === undefined) return inputFailure('body');
    const service = this.#dependencies.aiQuerySynthesis;
    if (service === undefined) return aiProviderNotConfigured();
    try {
      const result = await service.synthesize(input);
      return httpResult(200, {status: 'ok', ...result});
    } catch (error) {
      return informationEntryQuerySynthesisFailure(error);
    }
  }

  public async readInformationEntryKnowledgeGraph(
    body: unknown,
  ): Promise<M1cHttpResult> {
    const input = decodeInformationEntryKnowledgeGraphRequest(body);
    if (input === undefined) return inputFailure('body');
    try {
      const [loadedEntries, associationSnapshot] = await Promise.all([
        this.#dependencies.informationEntryRepository.loadCurrentEntries(
          this.#dependencies.workspaceId,
          input.includePrivate,
        ),
        this.#dependencies.informationEntryAssociationRepository.loadAssociationSnapshot(
          this.#dependencies.workspaceId,
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
        return httpResult(404, {
          status: 'not_found',
          issue: Object.freeze({code: 'information_entry_not_found'}),
        });
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
      return httpResult(200, {
        status: 'ok',
        querySha256: searchResult.querySha256,
        candidateTotalCount: searchResult.totalCount,
        candidates: searchResult.items,
        graph: graph ?? null,
      });
    } catch {
      return repositoryFailure();
    }
  }

  public async reviseInformationEntryKnowledgeGraphEdge(
    entryId: string,
    relatedEntryId: string,
    body: unknown,
  ): Promise<M1cHttpResult> {
    if (!CANONICAL_UUID.test(entryId)) return inputFailure('path.entryId');
    if (!CANONICAL_UUID.test(relatedEntryId)) {
      return inputFailure('path.relatedEntryId');
    }
    const input = decodeInformationEntryKnowledgeGraphEdgeWrite(body);
    const pair = orderedInformationEntryAssociationPair(
      entryId,
      relatedEntryId,
    );
    if (input === undefined || pair === undefined) return inputFailure('body');
    try {
      const [entries, snapshot] = await Promise.all([
        this.#dependencies.informationEntryRepository.loadCurrentEntries(
          this.#dependencies.workspaceId,
          input.includePrivate,
        ),
        this.#dependencies.informationEntryAssociationRepository.loadAssociationSnapshot(
          this.#dependencies.workspaceId,
          input.includePrivate,
        ),
      ]);
      if (
        !entries.some((entry) => entry.entryId === entryId) ||
        !entries.some((entry) => entry.entryId === relatedEntryId)
      ) {
        return httpResult(404, {
          status: 'not_found',
          issue: Object.freeze({code: 'information_entry_not_found'}),
        });
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
        return httpResult(404, {
          status: 'not_found',
          issue: Object.freeze({
            code: 'information_entry_graph_edge_not_found',
          }),
        });
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
        );
        if (graph === undefined) return inputFailure('body.label');
        value = prepareInformationEntryGraphEdit(
          current?.value,
          projection !== undefined,
          graph,
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
            workspaceId: this.#dependencies.workspaceId,
            ...pair,
            expectedRevision: input.expectedRevision,
            revisionId: deriveInformationEntryAssociationOverrideRevisionId(
              pair.entryLowId,
              pair.entryHighId,
              input.expectedRevision + 1,
            ),
            includePrivate: input.includePrivate,
            value,
          },
        );
      if (outcome === 'not_found') {
        return httpResult(404, {
          status: 'not_found',
          issue: Object.freeze({code: 'information_entry_not_found'}),
        });
      }
      if (outcome === 'stale') {
        return httpResult(409, {
          status: 'rejected',
          issue: Object.freeze({code: 'stale_association_override_revision'}),
        });
      }
      return httpResult(200, {status: outcome});
    } catch {
      return repositoryFailure();
    }
  }

  public async rebuildInformationEntryAssociations(
    body: unknown,
  ): Promise<M1cHttpResult> {
    const includePrivate = decodeInformationEntryAssociationScope(body);
    if (includePrivate === undefined) return inputFailure('body');
    try {
      const [entries, policy] = await Promise.all([
        this.#dependencies.informationEntryRepository.loadCurrentEntries(
          this.#dependencies.workspaceId,
          includePrivate,
        ),
        this.#loadInformationEntryAssociationPolicy(),
      ]);
      const projections = buildInformationEntryAssociationProjection(
        entries,
        policy,
      );
      const projectedCount =
        await this.#dependencies.informationEntryAssociationRepository.replaceAssociationProjections(
          this.#dependencies.workspaceId,
          projections,
          includePrivate,
        );
      return httpResult(200, {
        status: 'rebuilt',
        entryCount: entries.length,
        projectedCount,
        policy,
      });
    } catch {
      return repositoryFailure();
    }
  }

  public async reviseInformationEntryAssociationPolicy(
    body: unknown,
  ): Promise<M1cHttpResult> {
    const input = decodeInformationEntryAssociationPolicyWrite(body);
    if (input === undefined) return inputFailure('body');
    try {
      const preferences = await this.#dependencies.reviewPreferences.load(
        this.#dependencies.workspaceId,
      );
      const current =
        preferences.associationPolicy ??
        DEFAULT_REVIEW_ASSOCIATION_POLICY_PREFERENCES;
      if (current.revision !== input.expectedRevision) {
        return httpResult(409, {
          status: 'rejected',
          issue: Object.freeze({
            code: 'stale_association_policy_revision',
          }),
        });
      }
      const unchanged =
        current.contentWeight === input.contentWeight &&
        current.typeWeight === input.typeWeight &&
        current.domainWeight === input.domainWeight &&
        current.threshold === input.threshold;
      const next = unchanged
        ? current
        : Object.freeze({
            revision: current.revision + 1,
            contentWeight: input.contentWeight,
            typeWeight: input.typeWeight,
            domainWeight: input.domainWeight,
            threshold: input.threshold,
          });
      if (!unchanged) {
        await this.#dependencies.reviewPreferences.save(
          this.#dependencies.workspaceId,
          preferences.quickTags,
          preferences.automaticKeywords ??
            DEFAULT_REVIEW_AUTOMATIC_KEYWORD_PREFERENCES,
          preferences.vocabulary ?? DEFAULT_REVIEW_VOCABULARY_PREFERENCES,
          next,
          preferences.explorationPolicy ??
            DEFAULT_REVIEW_EXPLORATION_POLICY_PREFERENCES,
          preferences.sourceSubscriptions ??
            DEFAULT_REVIEW_SOURCE_SUBSCRIPTION_PREFERENCES,
        );
      }
      return httpResult(200, {
        status: unchanged ? 'unchanged' : 'applied',
        policy: informationEntryAssociationPolicyFromPreferences(next),
      });
    } catch {
      return reviewPreferencesFailure();
    }
  }

  public async reviseInformationEntryExplorationPolicy(
    body: unknown,
  ): Promise<M1cHttpResult> {
    const input = decodeInformationEntryExplorationPolicyWrite(body);
    if (input === undefined) return inputFailure('body');
    try {
      const preferences = await this.#dependencies.reviewPreferences.load(
        this.#dependencies.workspaceId,
      );
      const current =
        preferences.explorationPolicy ??
        DEFAULT_REVIEW_EXPLORATION_POLICY_PREFERENCES;
      if (current.revision !== input.expectedRevision) {
        return httpResult(409, {
          status: 'rejected',
          issue: Object.freeze({
            code: 'stale_exploration_policy_revision',
          }),
        });
      }
      const unchanged =
        current.enabled === input.enabled &&
        current.resultShare === input.resultShare &&
        current.neighborExpansion === input.neighborExpansion &&
        current.crossDomain === input.crossDomain &&
        current.serendipity === input.serendipity;
      const next = unchanged
        ? current
        : Object.freeze({
            revision: current.revision + 1,
            enabled: input.enabled,
            resultShare: input.resultShare,
            neighborExpansion: input.neighborExpansion,
            crossDomain: input.crossDomain,
            serendipity: input.serendipity,
          });
      if (!unchanged) {
        await this.#dependencies.reviewPreferences.save(
          this.#dependencies.workspaceId,
          preferences.quickTags,
          preferences.automaticKeywords ??
            DEFAULT_REVIEW_AUTOMATIC_KEYWORD_PREFERENCES,
          preferences.vocabulary ?? DEFAULT_REVIEW_VOCABULARY_PREFERENCES,
          preferences.associationPolicy ??
            DEFAULT_REVIEW_ASSOCIATION_POLICY_PREFERENCES,
          next,
          preferences.sourceSubscriptions ??
            DEFAULT_REVIEW_SOURCE_SUBSCRIPTION_PREFERENCES,
        );
      }
      return httpResult(200, {
        status: unchanged ? 'unchanged' : 'applied',
        policy: informationEntryExplorationPolicyFromPreferences(next),
      });
    } catch {
      return reviewPreferencesFailure();
    }
  }

  public async listInformationEntryAssociations(
    entryId: string,
    includePrivate: unknown = false,
  ): Promise<M1cHttpResult> {
    if (!CANONICAL_UUID.test(entryId)) return inputFailure('path.entryId');
    if (typeof includePrivate !== 'boolean') {
      return inputFailure('query.includePrivate');
    }
    try {
      const [entries, snapshot, policy] = await Promise.all([
        this.#dependencies.informationEntryRepository.loadCurrentEntries(
          this.#dependencies.workspaceId,
          includePrivate,
        ),
        this.#dependencies.informationEntryAssociationRepository.loadAssociationSnapshot(
          this.#dependencies.workspaceId,
          includePrivate,
        ),
        this.#loadInformationEntryAssociationPolicy(),
      ]);
      if (!entries.some((entry) => entry.entryId === entryId)) {
        return httpResult(404, {
          status: 'not_found',
          issue: Object.freeze({code: 'information_entry_not_found'}),
        });
      }
      const associations = selectInformationEntryAssociations(
        entryId,
        entries,
        snapshot,
      );
      return httpResult(200, {
        status: 'ok',
        entryId,
        totalCount: associations.length,
        policy,
        associations,
      });
    } catch {
      return repositoryFailure();
    }
  }

  public async reviseInformationEntryAssociation(
    entryId: string,
    relatedEntryId: string,
    body: unknown,
  ): Promise<M1cHttpResult> {
    if (!CANONICAL_UUID.test(entryId)) return inputFailure('path.entryId');
    if (!CANONICAL_UUID.test(relatedEntryId)) {
      return inputFailure('path.relatedEntryId');
    }
    const input = decodeInformationEntryAssociationOverride(body);
    const pair = orderedInformationEntryAssociationPair(
      entryId,
      relatedEntryId,
    );
    if (input === undefined || pair === undefined) return inputFailure('body');
    try {
      const [entries, snapshot] = await Promise.all([
        this.#dependencies.informationEntryRepository.loadCurrentEntries(
          this.#dependencies.workspaceId,
          input.includePrivate,
        ),
        this.#dependencies.informationEntryAssociationRepository.loadAssociationSnapshot(
          this.#dependencies.workspaceId,
          input.includePrivate,
        ),
      ]);
      if (
        !entries.some((entry) => entry.entryId === entryId) ||
        !entries.some((entry) => entry.entryId === relatedEntryId)
      ) {
        return httpResult(404, {
          status: 'not_found',
          issue: Object.freeze({code: 'information_entry_not_found'}),
        });
      }
      const current = snapshot.overrides.find(
        (candidate) =>
          candidate.entryLowId === pair.entryLowId &&
          candidate.entryHighId === pair.entryHighId,
      );
      const scoreValue = prepareInformationEntryAssociationOverride(
        input.action,
      );
      const value = Object.freeze({
        ...scoreValue,
        ...(current?.value.graph === undefined
          ? {}
          : {graph: current.value.graph}),
      });
      const outcome =
        await this.#dependencies.informationEntryAssociationRepository.writeAssociationOverride(
          {
            workspaceId: this.#dependencies.workspaceId,
            ...pair,
            expectedRevision: input.expectedRevision,
            revisionId: deriveInformationEntryAssociationOverrideRevisionId(
              pair.entryLowId,
              pair.entryHighId,
              input.expectedRevision + 1,
            ),
            includePrivate: input.includePrivate,
            value,
          },
        );
      if (outcome === 'not_found') {
        return httpResult(404, {
          status: 'not_found',
          issue: Object.freeze({code: 'information_entry_not_found'}),
        });
      }
      if (outcome === 'stale') {
        return httpResult(409, {
          status: 'rejected',
          issue: Object.freeze({code: 'stale_association_override_revision'}),
        });
      }
      return httpResult(200, {status: outcome});
    } catch {
      return repositoryFailure();
    }
  }

  public async listInformationEntryDocuments(
    includePrivate: unknown = false,
  ): Promise<M1cHttpResult> {
    if (typeof includePrivate !== 'boolean') {
      return inputFailure('query.includePrivate');
    }
    try {
      const [snapshots, entries, currentTags] = await Promise.all([
        this.#dependencies.evidenceReadRepository.listSnapshots(
          this.#dependencies.workspaceId,
        ),
        this.#dependencies.informationEntryRepository.loadCurrentEntries(
          this.#dependencies.workspaceId,
          includePrivate,
        ),
        this.#dependencies.informationDocumentTagRepository.loadCurrentDocumentTags(
          this.#dependencies.workspaceId,
          includePrivate,
        ),
      ]);
      const documents = snapshots
        .filter((snapshot) => includePrivate || snapshot.isPrivate !== true)
        .map((snapshot): Readonly<InformationEntryDocumentView> => {
          const documentEntries = entries.filter(
            (entry) => entry.snapshotId === snapshot.snapshotId,
          );
          const tags = currentTags.find(
            (candidate) => candidate.snapshotId === snapshot.snapshotId,
          );
          if (tags !== undefined && tags.resourceId !== snapshot.resourceId) {
            throw new Error('Document tag source identity mismatch.');
          }
          return Object.freeze({
            ...snapshot,
            entryCount: documentEntries.length,
            annotatedEntryCount: documentEntries.filter(
              (entry) =>
                entry.value.contentKeywords.length > 0 ||
                entry.value.typeKeyword !== undefined ||
                entry.value.domains.length > 0,
            ).length,
            ...(tags === undefined ? {} : {currentTags: tags}),
          });
        });
      return httpResult(200, {
        status: 'ok',
        totalCount: documents.length,
        documents: Object.freeze(documents),
      });
    } catch {
      return repositoryFailure();
    }
  }

  public async aggregateInformationDocumentTags(
    snapshotId: string,
    body: unknown,
  ): Promise<M1cHttpResult> {
    const input = decodeDocumentTagWriteBody(body, false);
    if (!CANONICAL_UUID.test(snapshotId)) {
      return inputFailure('path.snapshotId');
    }
    if (input === undefined) return inputFailure('body');
    return this.#writeInformationDocumentTags(snapshotId, input);
  }

  public async reviseInformationDocumentTags(
    snapshotId: string,
    body: unknown,
  ): Promise<M1cHttpResult> {
    const input = decodeDocumentTagWriteBody(body, true);
    if (!CANONICAL_UUID.test(snapshotId)) {
      return inputFailure('path.snapshotId');
    }
    if (input === undefined) return inputFailure('body');
    return this.#writeInformationDocumentTags(snapshotId, input);
  }

  async #writeInformationDocumentTags(
    snapshotId: string,
    input: Readonly<{
      expectedRevision: number;
      includePrivate: boolean;
      tags?: readonly string[];
    }>,
  ): Promise<M1cHttpResult> {
    try {
      const snapshot =
        await this.#dependencies.evidenceReadRepository.loadSnapshot(
          this.#dependencies.workspaceId,
          snapshotId,
        );
      if (
        snapshot === undefined ||
        (snapshot.isPrivate === true && !input.includePrivate)
      ) {
        return httpResult(404, {
          status: 'not_found',
          issue: Object.freeze({code: 'snapshot_not_found'}),
        });
      }
      const materialized = await materializeEvidenceSnapshot(
        snapshot,
        this.#dependencies.blobStore,
      );
      const normalizedText = materialized.structures[0]?.normalizedText;
      if (normalizedText === undefined) {
        return httpResult(422, {
          status: 'rejected',
          issue: Object.freeze({code: 'document_text_not_found'}),
        });
      }
      const entries = (
        await this.#dependencies.informationEntryRepository.loadCurrentEntries(
          this.#dependencies.workspaceId,
          input.includePrivate,
        )
      ).filter((entry) => entry.snapshotId === snapshotId);
      const aggregationInput = Object.freeze({
        normalizedText,
        isPrivate: snapshot.isPrivate === true,
        entries: Object.freeze(entries),
      });
      const value =
        input.tags === undefined
          ? prepareAggregatedInformationDocumentTags(aggregationInput)
          : prepareManualInformationDocumentTags(aggregationInput, input.tags);
      if (value === undefined) return inputFailure('body.tags');
      const outcome =
        await this.#dependencies.informationDocumentTagRepository.writeDocumentTags(
          {
            workspaceId: this.#dependencies.workspaceId,
            resourceId: snapshot.resourceId,
            snapshotId,
            expectedRevision: input.expectedRevision,
            revisionId: deriveInformationDocumentTagRevisionId(
              snapshotId,
              input.expectedRevision + 1,
            ),
            value,
          },
        );
      if (outcome === 'stale') {
        return httpResult(409, {
          status: 'rejected',
          issue: Object.freeze({code: 'stale_document_tag_revision'}),
        });
      }
      const current =
        await this.#dependencies.informationDocumentTagRepository.loadCurrentDocumentTags(
          this.#dependencies.workspaceId,
          input.includePrivate,
        );
      const documentTags = current.find(
        (candidate) => candidate.snapshotId === snapshotId,
      );
      if (documentTags === undefined) {
        throw new Error('Committed document tags were not readable.');
      }
      return httpResult(200, {
        status: outcome,
        documentTags,
      });
    } catch {
      return repositoryFailure();
    }
  }

  public async listProcessingRuns(
    limitInput: unknown = 20,
  ): Promise<M1cHttpResult> {
    const limit = decodeProcessingRunLimit(limitInput);
    if (limit === undefined) return inputFailure('query.limit');
    try {
      const runs =
        await this.#dependencies.processingRunRepository.listRecentRuns(
          this.#dependencies.workspaceId,
          limit,
        );
      return httpResult(200, {
        status: 'ok',
        runs: Object.freeze(runs.map(processingRunResponse)),
      });
    } catch {
      return repositoryFailure();
    }
  }

  public async cancelProcessingRun(
    runId: string,
    body: unknown,
  ): Promise<M1cHttpResult> {
    if (!CANONICAL_UUID.test(runId)) return inputFailure('path.runId');
    if (
      !isRecord(body) ||
      Object.keys(body).length !== 1 ||
      !Number.isSafeInteger(body.expectedVersion) ||
      (body.expectedVersion as number) < 1
    ) {
      return inputFailure('body.expectedVersion');
    }
    try {
      const outcome =
        await this.#dependencies.processingRunRepository.cancelRun(
          this.#dependencies.workspaceId,
          runId,
          body.expectedVersion as number,
        );
      if (outcome === 'not_found') {
        return httpResult(404, {
          status: 'not_found',
          issue: Object.freeze({code: 'processing_run_not_found'}),
        });
      }
      if (outcome === 'stale') {
        return httpResult(409, {
          status: 'rejected',
          issue: Object.freeze({code: 'stale_processing_run_version'}),
        });
      }
      if (outcome === 'terminal') {
        return httpResult(409, {
          status: 'rejected',
          issue: Object.freeze({code: 'processing_run_terminal'}),
        });
      }
      if (outcome !== 'applied') return repositoryFailure();
      return httpResult(200, {
        status: 'cancelled',
        runId,
        version: (body.expectedVersion as number) + 1,
      });
    } catch {
      return repositoryFailure();
    }
  }

  public async listSourceSubscriptions(): Promise<M1cHttpResult> {
    const service = this.#dependencies.sourceSubscriptions;
    if (service === undefined) return sourceSubscriptionUnavailable();
    try {
      const value = await service.list();
      return httpResult(200, {status: 'ok', ...value});
    } catch (error) {
      return sourceSubscriptionFailure(error);
    }
  }

  public async replaceSourceSubscriptions(
    body: unknown,
  ): Promise<M1cHttpResult> {
    const service = this.#dependencies.sourceSubscriptions;
    if (service === undefined) return sourceSubscriptionUnavailable();
    const write = decodeSourceSubscriptionReplace(body);
    if (write === undefined) return inputFailure('body');
    try {
      const result = await service.replace(
        write.expectedRevision,
        write.subscriptions,
      );
      return httpResult(200, {
        status: result.outcome,
        ...result.value,
      });
    } catch (error) {
      return sourceSubscriptionFailure(error);
    }
  }

  public async runSourceSubscription(
    subscriptionId: string,
    body: unknown,
  ): Promise<M1cHttpResult> {
    const service = this.#dependencies.sourceSubscriptions;
    if (service === undefined) return sourceSubscriptionUnavailable();
    if (
      !CANONICAL_UUID.test(subscriptionId) ||
      !isRecord(body) ||
      Object.keys(body).length !== 1 ||
      typeof body.requestKey !== 'string'
    ) {
      return inputFailure('body');
    }
    try {
      const result = await service.runNow(subscriptionId, body.requestKey);
      return httpResult(result.outcome === 'imported' ? 201 : 200, {
        status: result.outcome,
        ...result,
      });
    } catch (error) {
      return sourceSubscriptionFailure(error);
    }
  }

  public async listAiSplitProposals(
    snapshotId: string,
  ): Promise<M1cHttpResult> {
    if (!CANONICAL_UUID.test(snapshotId))
      return inputFailure('path.snapshotId');
    const service = this.#dependencies.aiSplitProposals;
    if (service === undefined) return aiProviderNotConfigured();
    try {
      const proposals = await service.listForSnapshot(snapshotId);
      return httpResult(200, {
        status: 'ok',
        proposals: Object.freeze(proposals.map(processingProposalResponse)),
      });
    } catch (error) {
      return aiSplitProposalFailure(error);
    }
  }

  public async startAiSplitProposal(
    snapshotId: string,
    body: unknown,
  ): Promise<M1cHttpResult> {
    if (!CANONICAL_UUID.test(snapshotId))
      return inputFailure('path.snapshotId');
    const input = decodeAiTagProposalStart(body);
    if (input === undefined) return inputFailure('body.requestKey');
    const service = this.#dependencies.aiSplitProposals;
    if (service === undefined) return aiProviderNotConfigured();
    try {
      const result = await service.start(snapshotId, input.requestKey);
      const response = processingRunResponse(result.run);
      if (result.run.status === 'failed') {
        return httpResult(502, {
          status: 'failed',
          issue: Object.freeze({
            code: result.run.errorCode ?? 'ai_provider_unavailable',
          }),
          run: response,
        });
      }
      return httpResult(result.outcome === 'created' ? 201 : 200, {
        status: result.outcome,
        run: response,
      });
    } catch (error) {
      return aiSplitProposalFailure(error);
    }
  }

  public async acceptAiSplitProposal(
    snapshotId: string,
    proposalId: string,
  ): Promise<M1cHttpResult> {
    return this.#decideAiSplitProposal(snapshotId, proposalId, 'accepted');
  }

  public async rejectAiSplitProposal(
    snapshotId: string,
    proposalId: string,
  ): Promise<M1cHttpResult> {
    return this.#decideAiSplitProposal(snapshotId, proposalId, 'rejected');
  }

  async #decideAiSplitProposal(
    snapshotId: string,
    proposalId: string,
    decision: 'accepted' | 'rejected',
  ): Promise<M1cHttpResult> {
    if (!CANONICAL_UUID.test(snapshotId))
      return inputFailure('path.snapshotId');
    if (!CANONICAL_UUID.test(proposalId))
      return inputFailure('path.proposalId');
    const service = this.#dependencies.aiSplitProposals;
    if (service === undefined) return aiProviderNotConfigured();
    try {
      const result =
        decision === 'accepted'
          ? await service.accept(snapshotId, proposalId)
          : await service.reject(snapshotId, proposalId);
      return httpResult(200, {
        status: result.outcome,
        proposal: processingProposalResponse(result.proposal),
        ...(result.entries === undefined ? {} : {entries: result.entries}),
      });
    } catch (error) {
      return aiSplitProposalFailure(error);
    }
  }
  public async listAiTagProposals(entryId: string): Promise<M1cHttpResult> {
    if (!CANONICAL_UUID.test(entryId)) return inputFailure('path.entryId');
    const service = this.#dependencies.aiTagProposals;
    if (service === undefined) return aiProviderNotConfigured();
    try {
      const proposals = await service.listForEntry(entryId);
      return httpResult(200, {
        status: 'ok',
        proposals: Object.freeze(proposals.map(processingProposalResponse)),
      });
    } catch (error) {
      return aiTagProposalFailure(error);
    }
  }

  public async startAiTagProposal(
    entryId: string,
    body: unknown,
  ): Promise<M1cHttpResult> {
    if (!CANONICAL_UUID.test(entryId)) return inputFailure('path.entryId');
    const input = decodeAiTagProposalStart(body);
    if (input === undefined) return inputFailure('body.requestKey');
    const service = this.#dependencies.aiTagProposals;
    if (service === undefined) return aiProviderNotConfigured();
    try {
      const result = await service.start(entryId, input.requestKey);
      const response = processingRunResponse(result.run);
      if (result.run.status === 'failed') {
        return httpResult(502, {
          status: 'failed',
          issue: Object.freeze({
            code: result.run.errorCode ?? 'ai_provider_unavailable',
          }),
          run: response,
        });
      }
      return httpResult(result.outcome === 'created' ? 201 : 200, {
        status: result.outcome,
        run: response,
      });
    } catch (error) {
      return aiTagProposalFailure(error);
    }
  }

  public async acceptAiTagProposal(
    entryId: string,
    proposalId: string,
  ): Promise<M1cHttpResult> {
    return this.#decideAiTagProposal(entryId, proposalId, 'accepted');
  }

  public async rejectAiTagProposal(
    entryId: string,
    proposalId: string,
  ): Promise<M1cHttpResult> {
    return this.#decideAiTagProposal(entryId, proposalId, 'rejected');
  }

  async #decideAiTagProposal(
    entryId: string,
    proposalId: string,
    decision: 'accepted' | 'rejected',
  ): Promise<M1cHttpResult> {
    if (!CANONICAL_UUID.test(entryId)) return inputFailure('path.entryId');
    if (!CANONICAL_UUID.test(proposalId)) {
      return inputFailure('path.proposalId');
    }
    const service = this.#dependencies.aiTagProposals;
    if (service === undefined) return aiProviderNotConfigured();
    try {
      const result =
        decision === 'accepted'
          ? await service.accept(entryId, proposalId)
          : await service.reject(entryId, proposalId);
      return httpResult(200, {
        status: result.outcome,
        proposal: processingProposalResponse(result.proposal),
        ...(result.entry === undefined ? {} : {entry: result.entry}),
      });
    } catch (error) {
      return aiTagProposalFailure(error);
    }
  }

  public async listAiAssociationProposals(
    entryId: string,
    relatedEntryId: string,
  ): Promise<M1cHttpResult> {
    if (!CANONICAL_UUID.test(entryId)) return inputFailure('path.entryId');
    if (!CANONICAL_UUID.test(relatedEntryId)) {
      return inputFailure('path.relatedEntryId');
    }
    const service = this.#dependencies.aiAssociationProposals;
    if (service === undefined) return aiProviderNotConfigured();
    try {
      const proposals = await service.listForPair(entryId, relatedEntryId);
      return httpResult(200, {
        status: 'ok',
        proposals: Object.freeze(proposals.map(processingProposalResponse)),
      });
    } catch (error) {
      return aiAssociationProposalFailure(error);
    }
  }

  public async startAiAssociationProposal(
    entryId: string,
    relatedEntryId: string,
    body: unknown,
  ): Promise<M1cHttpResult> {
    if (!CANONICAL_UUID.test(entryId)) return inputFailure('path.entryId');
    if (!CANONICAL_UUID.test(relatedEntryId)) {
      return inputFailure('path.relatedEntryId');
    }
    const input = decodeAiTagProposalStart(body);
    if (input === undefined) return inputFailure('body.requestKey');
    const service = this.#dependencies.aiAssociationProposals;
    if (service === undefined) return aiProviderNotConfigured();
    try {
      const result = await service.start(
        entryId,
        relatedEntryId,
        input.requestKey,
      );
      const response = processingRunResponse(result.run);
      if (result.run.status === 'failed') {
        return httpResult(502, {
          status: 'failed',
          issue: Object.freeze({
            code: result.run.errorCode ?? 'ai_provider_unavailable',
          }),
          run: response,
        });
      }
      return httpResult(result.outcome === 'created' ? 201 : 200, {
        status: result.outcome,
        run: response,
      });
    } catch (error) {
      return aiAssociationProposalFailure(error);
    }
  }

  public async acceptAiAssociationProposal(
    entryId: string,
    relatedEntryId: string,
    proposalId: string,
  ): Promise<M1cHttpResult> {
    return this.#decideAiAssociationProposal(
      entryId,
      relatedEntryId,
      proposalId,
      'accepted',
    );
  }

  public async rejectAiAssociationProposal(
    entryId: string,
    relatedEntryId: string,
    proposalId: string,
  ): Promise<M1cHttpResult> {
    return this.#decideAiAssociationProposal(
      entryId,
      relatedEntryId,
      proposalId,
      'rejected',
    );
  }

  async #decideAiAssociationProposal(
    entryId: string,
    relatedEntryId: string,
    proposalId: string,
    decision: 'accepted' | 'rejected',
  ): Promise<M1cHttpResult> {
    if (!CANONICAL_UUID.test(entryId)) return inputFailure('path.entryId');
    if (!CANONICAL_UUID.test(relatedEntryId)) {
      return inputFailure('path.relatedEntryId');
    }
    if (!CANONICAL_UUID.test(proposalId)) {
      return inputFailure('path.proposalId');
    }
    const service = this.#dependencies.aiAssociationProposals;
    if (service === undefined) return aiProviderNotConfigured();
    try {
      const result =
        decision === 'accepted'
          ? await service.accept(entryId, relatedEntryId, proposalId)
          : await service.reject(entryId, relatedEntryId, proposalId);
      return httpResult(200, {
        status: result.outcome,
        proposal: processingProposalResponse(result.proposal),
      });
    } catch (error) {
      return aiAssociationProposalFailure(error);
    }
  }
  public async exportWorkspaceBundle(): Promise<M1cHttpResult> {
    try {
      const summary =
        await this.#dependencies.workspaceTransfer.exportWorkspace(
          this.#dependencies.workspaceId,
        );
      return httpResult(201, {status: 'exported', ...summary});
    } catch (error) {
      return workspaceTransferFailure(error);
    }
  }

  public async restoreWorkspaceBundle(body: unknown): Promise<M1cHttpResult> {
    if (!isRecord(body) || typeof body.fileName !== 'string') {
      return inputFailure('body.fileName');
    }
    try {
      const summary =
        await this.#dependencies.workspaceTransfer.restoreWorkspace(
          this.#dependencies.workspaceId,
          body.fileName,
        );
      return httpResult(200, {status: 'restored', ...summary});
    } catch (error) {
      return workspaceTransferFailure(error);
    }
  }
}

function reviewPreferencesFailure(): M1cHttpResult {
  return httpResult(503, {
    status: 'failed',
    issue: Object.freeze({code: 'review_preferences_failed'}),
  });
}

function mapStructuredDocumentImportBody(
  body: Readonly<Record<string, unknown>>,
  workspaceId: string,
): Readonly<ImportStructuredDocumentEvidenceInput> | undefined {
  if (!isRecord(body.resource) || !isRecord(body.snapshot)) return undefined;
  if (body.resource.resourceKind !== 'uploaded_file') return undefined;
  if (
    !Array.isArray(body.gitObservations) ||
    body.gitObservations.length !== 0
  ) {
    return undefined;
  }
  if (body.gitResource !== undefined || body.sourceText !== undefined) {
    return undefined;
  }
  if (body.profile !== undefined && body.profile !== 'commonmark-v1') {
    return undefined;
  }
  if (
    body.sourcePreface !== undefined &&
    (typeof body.sourcePreface !== 'string' ||
      Array.from(body.sourcePreface).length > 20_000)
  ) {
    return undefined;
  }
  const sourceBytes = decodeMarkdownImportSource(body);
  if (sourceBytes === undefined) return undefined;
  const expectedMediaType =
    body.documentFormat === 'html' ? 'text/html' : 'application/pdf';
  if (body.snapshot.mediaType !== expectedMediaType) return undefined;
  const snapshot = Object.freeze({...body.snapshot, workspaceId});
  const input = {
    workspaceId,
    commandIdempotencyKey: body.commandIdempotencyKey,
    resource: Object.freeze({...body.resource, workspaceId}),
    snapshot,
    gitObservations: Object.freeze([]),
    documentFormat: body.documentFormat,
    sourceBytes,
    ...(body.sourcePreface === undefined
      ? {}
      : {sourcePreface: body.sourcePreface}),
    ...(body.documentBaseUri === undefined
      ? {}
      : {documentBaseUri: body.documentBaseUri}),
  };
  return Object.freeze(
    input as unknown as Readonly<ImportStructuredDocumentEvidenceInput>,
  );
}

function mapMarkdownImportBody(
  body: unknown,
  workspaceId: string,
): Readonly<ImportMarkdownEvidenceInput> | undefined {
  if (!isRecord(body)) return undefined;
  if (!isRecord(body.resource) || !isRecord(body.snapshot)) return undefined;
  if (!Array.isArray(body.gitObservations)) return undefined;
  if (!body.gitObservations.every(isRecord)) return undefined;
  if (body.gitResource !== undefined && !isRecord(body.gitResource)) {
    return undefined;
  }
  const sourceUtf8 = decodeMarkdownImportSource(body);
  if (sourceUtf8 === undefined) return undefined;
  const hasUploadBytes = body.sourceBase64 !== undefined;
  if ((body.resource.resourceKind === 'uploaded_file') !== hasUploadBytes) {
    return undefined;
  }
  const resource = Object.freeze({...body.resource, workspaceId});
  const snapshot = Object.freeze({...body.snapshot, workspaceId});
  const gitObservations = Object.freeze(
    body.gitObservations.map((observation) =>
      Object.freeze({...observation, workspaceId}),
    ),
  );
  const candidate = {
    workspaceId,
    commandIdempotencyKey: body.commandIdempotencyKey,
    resource,
    ...(body.gitResource === undefined
      ? {}
      : {gitResource: Object.freeze({...body.gitResource, workspaceId})}),
    snapshot,
    gitObservations,
    profile: body.profile,
    sourceUtf8,
    ...(body.documentBaseUri === undefined
      ? {}
      : {documentBaseUri: body.documentBaseUri}),
  };
  return Object.freeze(
    candidate as unknown as Readonly<ImportMarkdownEvidenceInput>,
  );
}

function decodeMarkdownImportSource(
  body: Readonly<Record<string, unknown>>,
): Uint8Array | undefined {
  const text = body.sourceText;
  const encoded = body.sourceBase64;
  if (
    (text !== undefined && typeof text !== 'string') ||
    (encoded !== undefined && typeof encoded !== 'string') ||
    (text === undefined) === (encoded === undefined)
  ) {
    return undefined;
  }
  if (typeof text === 'string') return new TextEncoder().encode(text);
  if (
    typeof encoded !== 'string' ||
    encoded.length % 4 !== 0 ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(
      encoded,
    )
  ) {
    return undefined;
  }
  const decoded = Buffer.from(encoded, 'base64');
  return decoded.toString('base64') === encoded
    ? Uint8Array.from(decoded)
    : undefined;
}

function decodeManualEntrySplitBody(body: unknown):
  | Readonly<{
      snapshotId: string;
      includePrivate: boolean;
      groups: readonly Readonly<ManualEntryFragmentGroupInput>[];
    }>
  | undefined {
  if (
    !isRecord(body) ||
    typeof body.snapshotId !== 'string' ||
    !CANONICAL_UUID.test(body.snapshotId) ||
    (typeof body.includePrivate !== 'boolean' &&
      body.includePrivate !== undefined) ||
    !Array.isArray(body.groups) ||
    body.groups.length < 1
  ) {
    return undefined;
  }
  const groups: Readonly<ManualEntryFragmentGroupInput>[] = [];
  for (const value of body.groups) {
    if (
      !isRecord(value) ||
      typeof value.titlePath !== 'string' ||
      !Array.isArray(value.fragments) ||
      value.fragments.length < 1
    ) {
      return undefined;
    }
    const fragments = [];
    for (const rawFragment of value.fragments) {
      if (
        !isRecord(rawFragment) ||
        typeof rawFragment.fragmentId !== 'string' ||
        !CANONICAL_UUID.test(rawFragment.fragmentId) ||
        !Number.isSafeInteger(rawFragment.startCodePoint) ||
        !Number.isSafeInteger(rawFragment.endCodePoint) ||
        (rawFragment.startCodePoint as number) < 0 ||
        (rawFragment.endCodePoint as number) <=
          (rawFragment.startCodePoint as number)
      ) {
        return undefined;
      }
      fragments.push(
        Object.freeze({
          fragmentId: rawFragment.fragmentId,
          startCodePoint: rawFragment.startCodePoint as number,
          endCodePoint: rawFragment.endCodePoint as number,
        }),
      );
    }
    groups.push(
      Object.freeze({
        titlePath: value.titlePath,
        fragments: Object.freeze(fragments),
      }),
    );
  }
  return Object.freeze({
    snapshotId: body.snapshotId,
    includePrivate: body.includePrivate === true,
    groups: Object.freeze(groups),
  });
}
function decodeEntryRevisionBody(body: unknown):
  | Readonly<{
      expectedRevision: number;
      includePrivate: boolean;
      annotation: Readonly<{
        body: string;
        contentKeywords: readonly string[];
        typeKeyword: EntryTypeKeyword;
        typeCustomName?: string;
        usefulnessScore?: 1 | 2 | 3 | 4 | 5;
        interestScore?: 1 | 2 | 3 | 4 | 5;
        domains: readonly Readonly<{
          keyword: EntryDomainKeyword;
          customName?: string;
        }>[];
      }>;
    }>
  | undefined {
  if (!isRecord(body) || !isRecord(body.annotation)) return undefined;
  if (
    typeof body.expectedRevision !== 'number' ||
    !Number.isSafeInteger(body.expectedRevision) ||
    body.expectedRevision < 1 ||
    typeof (body.includePrivate ?? false) !== 'boolean'
  ) {
    return undefined;
  }
  const annotation = body.annotation;
  if (
    typeof annotation.body !== 'string' ||
    !Array.isArray(annotation.contentKeywords) ||
    !annotation.contentKeywords.every((value) => typeof value === 'string') ||
    typeof annotation.typeKeyword !== 'string' ||
    !ENTRY_TYPE_KEYWORDS.includes(annotation.typeKeyword as EntryTypeKeyword) ||
    (annotation.typeCustomName !== undefined &&
      typeof annotation.typeCustomName !== 'string') ||
    !isOptionalAssessmentScore(annotation.usefulnessScore) ||
    !isOptionalAssessmentScore(annotation.interestScore) ||
    !Array.isArray(annotation.domains)
  ) {
    return undefined;
  }
  const domains = annotation.domains.flatMap((value) => {
    if (
      !isRecord(value) ||
      typeof value.keyword !== 'string' ||
      !ENTRY_DOMAIN_KEYWORDS.includes(value.keyword as EntryDomainKeyword) ||
      (value.customName !== undefined && typeof value.customName !== 'string')
    ) {
      return [];
    }
    return [
      Object.freeze({
        keyword: value.keyword as EntryDomainKeyword,
        ...(value.customName === undefined
          ? {}
          : {customName: value.customName}),
      }),
    ];
  });
  if (domains.length !== annotation.domains.length) return undefined;
  return Object.freeze({
    expectedRevision: body.expectedRevision,
    includePrivate: (body.includePrivate ?? false) as boolean,
    annotation: Object.freeze({
      body: annotation.body,
      contentKeywords: Object.freeze([
        ...annotation.contentKeywords,
      ] as string[]),
      typeKeyword: annotation.typeKeyword as EntryTypeKeyword,
      ...(annotation.typeCustomName === undefined
        ? {}
        : {typeCustomName: annotation.typeCustomName}),
      ...(annotation.usefulnessScore === undefined
        ? {}
        : {usefulnessScore: annotation.usefulnessScore}),
      ...(annotation.interestScore === undefined
        ? {}
        : {interestScore: annotation.interestScore}),
      domains: Object.freeze(domains),
    }),
  });
}

function decodeEntrySearchBody(
  body: unknown,
): Readonly<InformationEntrySearchRequest> | undefined {
  if (!isRecord(body)) return undefined;
  const textValue = optionalBoundedText(body.text, 300);
  const textMode = body.textMode ?? 'substring';
  const textFields = decodeEntrySearchTextFields(body.textFields);
  const contentKeyword = optionalBoundedText(body.contentKeyword, 80);
  const sourceKey = optionalBoundedText(body.sourceKey, 2_048);
  const snapshotId = body.snapshotId ?? undefined;
  const typeKeyword = body.typeKeyword ?? undefined;
  const typeCustomName = optionalBoundedText(body.typeCustomName, 80);
  const domainKeyword = body.domainKeyword ?? undefined;
  const domainCustomName = optionalBoundedText(body.domainCustomName, 80);
  const domainScope = body.domainScope ?? 'any';
  const chunkMode = body.chunkMode ?? undefined;
  const includePrivate = body.includePrivate ?? false;
  const onlyPrivate = body.onlyPrivate ?? false;
  const limit = body.limit ?? 25;
  const time = decodeEntrySearchTime(body.time);
  const association = decodeEntrySearchAssociation(body.association);
  const after = decodeEntrySearchCursor(body.after);
  if (
    textValue === null ||
    typeof textMode !== 'string' ||
    !ENTRY_TEXT_SEARCH_MODES.includes(textMode as EntryTextSearchMode) ||
    textFields === undefined ||
    (textValue === undefined &&
      (body.textMode !== undefined || body.textFields !== undefined)) ||
    contentKeyword === null ||
    sourceKey === null ||
    typeCustomName === null ||
    domainCustomName === null ||
    (snapshotId !== undefined &&
      (typeof snapshotId !== 'string' || !CANONICAL_UUID.test(snapshotId))) ||
    (typeKeyword !== undefined &&
      (typeof typeKeyword !== 'string' ||
        !ENTRY_TYPE_KEYWORDS.includes(typeKeyword as EntryTypeKeyword))) ||
    (typeCustomName !== undefined && typeKeyword !== 'other') ||
    (typeKeyword === 'other' && typeCustomName === undefined) ||
    (domainKeyword !== undefined &&
      (typeof domainKeyword !== 'string' ||
        !ENTRY_DOMAIN_KEYWORDS.includes(
          domainKeyword as EntryDomainKeyword,
        ))) ||
    (domainScope !== 'any' &&
      domainScope !== 'primary' &&
      domainScope !== 'secondary') ||
    (domainCustomName !== undefined && domainKeyword !== 'other') ||
    (domainKeyword === 'other' && domainCustomName === undefined) ||
    (domainKeyword === undefined && domainScope !== 'any') ||
    (chunkMode !== undefined &&
      (typeof chunkMode !== 'string' ||
        !ENTRY_CHUNK_MODES.includes(chunkMode as 'split' | 'whole'))) ||
    (body.time !== undefined && time === undefined) ||
    (body.association !== undefined && association === undefined) ||
    (body.after !== undefined && after === undefined) ||
    typeof includePrivate !== 'boolean' ||
    typeof onlyPrivate !== 'boolean' ||
    (onlyPrivate && !includePrivate) ||
    typeof limit !== 'number' ||
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    limit > 100
  ) {
    return undefined;
  }
  return Object.freeze({
    ...(textValue === undefined
      ? {}
      : {
          text: textValue,
          textMode: textMode as EntryTextSearchMode,
          textFields,
        }),
    ...(contentKeyword === undefined ? {} : {contentKeyword}),
    ...(sourceKey === undefined ? {} : {sourceKey}),
    ...(snapshotId === undefined ? {} : {snapshotId}),
    ...(typeKeyword === undefined
      ? {}
      : {typeKeyword: typeKeyword as EntryTypeKeyword}),
    ...(typeCustomName === undefined ? {} : {typeCustomName}),
    ...(domainKeyword === undefined
      ? {}
      : {domainKeyword: domainKeyword as EntryDomainKeyword}),
    ...(domainCustomName === undefined ? {} : {domainCustomName}),
    domainScope,
    ...(chunkMode === undefined
      ? {}
      : {chunkMode: chunkMode as 'split' | 'whole'}),
    ...(time === undefined ? {} : {time}),
    ...(association === undefined ? {} : {association}),
    includePrivate,
    onlyPrivate,
    limit,
    ...(after === undefined ? {} : {after}),
  });
}

const INFORMATION_ENTRY_QUERY_SYNTHESIS_QUERY_KEYS = new Set([
  'text',
  'textMode',
  'textFields',
  'contentKeyword',
  'sourceKey',
  'snapshotId',
  'typeKeyword',
  'typeCustomName',
  'domainKeyword',
  'domainCustomName',
  'domainScope',
  'chunkMode',
  'time',
  'association',
  'includePrivate',
  'onlyPrivate',
]);

function decodeInformationEntryQuerySynthesisBody(
  body: unknown,
): Readonly<InformationEntryQuerySynthesisRequest> | undefined {
  if (
    !isRecord(body) ||
    Object.keys(body).length !== 3 ||
    !Object.hasOwn(body, 'requestId') ||
    !Object.hasOwn(body, 'question') ||
    !Object.hasOwn(body, 'query') ||
    typeof body.requestId !== 'string' ||
    !/^[A-Za-z0-9._:-]{1,80}$/u.test(body.requestId) ||
    !isRecord(body.query) ||
    Object.keys(body.query).some(
      (key) => !INFORMATION_ENTRY_QUERY_SYNTHESIS_QUERY_KEYS.has(key),
    )
  ) {
    return undefined;
  }
  const question = optionalBoundedText(body.question, 600);
  const query = decodeEntrySearchBody({...body.query, limit: 8});
  if (question === undefined || question === null || query === undefined) {
    return undefined;
  }
  return Object.freeze({requestId: body.requestId, question, query});
}

function querySynthesisRequestsPrivateScope(body: unknown): boolean {
  return (
    isRecord(body) &&
    isRecord(body.query) &&
    (body.query.includePrivate === true || body.query.onlyPrivate === true)
  );
}

function decodeEntrySearchTextFields(
  value: unknown,
): readonly EntryTextSearchField[] | undefined {
  const fields = value ?? ENTRY_TEXT_SEARCH_FIELDS;
  if (
    !Array.isArray(fields) ||
    fields.length < 1 ||
    fields.length > ENTRY_TEXT_SEARCH_FIELDS.length ||
    !fields.every(
      (field) =>
        typeof field === 'string' &&
        ENTRY_TEXT_SEARCH_FIELDS.includes(field as EntryTextSearchField),
    ) ||
    new Set(fields).size !== fields.length
  ) {
    return undefined;
  }
  return Object.freeze(
    ENTRY_TEXT_SEARCH_FIELDS.filter((field) => fields.includes(field)),
  );
}
function isOptionalAssessmentScore(
  value: unknown,
): value is 1 | 2 | 3 | 4 | 5 | undefined {
  return (
    value === undefined ||
    (typeof value === 'number' &&
      Number.isInteger(value) &&
      value >= 1 &&
      value <= 5)
  );
}

function optionalBoundedText(
  value: unknown,
  maximumCodePoints: number,
): string | undefined | null {
  if (value === undefined) return undefined;
  if (typeof value !== 'string') return null;
  const normalized = value.trim().normalize('NFC');
  if (normalized.length === 0) return undefined;
  return Array.from(normalized).length <= maximumCodePoints ? normalized : null;
}

function decodeEntrySearchTime(body: unknown):
  | Readonly<{
      field: 'published' | 'captured';
      from?: string;
      to?: string;
    }>
  | undefined {
  if (body === undefined) return undefined;
  if (!isRecord(body)) return undefined;
  const from = body.from ?? undefined;
  const to = body.to ?? undefined;
  if (
    (body.field !== 'published' && body.field !== 'captured') ||
    (from !== undefined && (typeof from !== 'string' || !isIsoDate(from))) ||
    (to !== undefined && (typeof to !== 'string' || !isIsoDate(to))) ||
    (from === undefined && to === undefined) ||
    (typeof from === 'string' && typeof to === 'string' && from > to)
  ) {
    return undefined;
  }
  return Object.freeze({
    field: body.field,
    ...(typeof from === 'string' ? {from} : {}),
    ...(typeof to === 'string' ? {to} : {}),
  });
}

function decodeEntrySearchAssociation(body: unknown):
  | Readonly<{
      entryId: string;
      maximumDepth: 1 | 2;
      minimumScore: number;
    }>
  | undefined {
  if (body === undefined) return undefined;
  if (
    !isRecord(body) ||
    typeof body.entryId !== 'string' ||
    !CANONICAL_UUID.test(body.entryId) ||
    (body.maximumDepth !== 1 && body.maximumDepth !== 2) ||
    typeof body.minimumScore !== 'number' ||
    !Number.isSafeInteger(body.minimumScore) ||
    body.minimumScore < 0 ||
    body.minimumScore > 10_000
  ) {
    return undefined;
  }
  return Object.freeze({
    entryId: body.entryId,
    maximumDepth: body.maximumDepth,
    minimumScore: body.minimumScore,
  });
}

function decodeEntrySearchCursor(
  body: unknown,
): Readonly<NonNullable<InformationEntrySearchRequest['after']>> | undefined {
  if (body === undefined) return undefined;
  if (
    !isRecord(body) ||
    body.schemaVersion !== 2 ||
    typeof body.querySha256 !== 'string' ||
    !/^[0-9a-f]{64}$/u.test(body.querySha256) ||
    typeof body.associationDepth !== 'number' ||
    !Number.isSafeInteger(body.associationDepth) ||
    body.associationDepth < 0 ||
    body.associationDepth > 2 ||
    typeof body.textScore !== 'number' ||
    !Number.isSafeInteger(body.textScore) ||
    body.textScore < 0 ||
    body.textScore > 10_000 ||
    typeof body.matchReasonCount !== 'number' ||
    !Number.isSafeInteger(body.matchReasonCount) ||
    body.matchReasonCount < 0 ||
    body.matchReasonCount > 5 ||
    typeof body.associationScore !== 'number' ||
    !Number.isSafeInteger(body.associationScore) ||
    body.associationScore < 0 ||
    body.associationScore > 10_000 ||
    typeof body.capturedAt !== 'string' ||
    Number.isNaN(Date.parse(body.capturedAt)) ||
    typeof body.documentOrder !== 'number' ||
    !Number.isSafeInteger(body.documentOrder) ||
    body.documentOrder < 0 ||
    typeof body.entryId !== 'string' ||
    !CANONICAL_UUID.test(body.entryId)
  ) {
    return undefined;
  }
  return Object.freeze({
    schemaVersion: 2 as const,
    querySha256: body.querySha256,
    associationDepth: body.associationDepth,
    textScore: body.textScore,
    matchReasonCount: body.matchReasonCount,
    associationScore: body.associationScore,
    capturedAt: new Date(body.capturedAt).toISOString(),
    documentOrder: body.documentOrder,
    entryId: body.entryId,
  });
}

function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value)) return false;
  const date = new Date(value + 'T00:00:00.000Z');
  return (
    !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value
  );
}
function decodeInformationEntryKnowledgeGraphRequest(body: unknown):
  | Readonly<{
      query?: string;
      centerEntryId?: string;
      includePrivate: boolean;
      onlyPrivate: boolean;
      candidateLimit: number;
      neighborLimit: number;
    }>
  | undefined {
  if (!isRecord(body)) return undefined;
  const query = optionalBoundedText(body.query, 300);
  const centerEntryId = body.centerEntryId ?? undefined;
  const includePrivate = body.includePrivate ?? false;
  const onlyPrivate = body.onlyPrivate ?? false;
  const candidateLimit = body.candidateLimit ?? 8;
  const neighborLimit = body.neighborLimit ?? 12;
  if (
    query === null ||
    (centerEntryId !== undefined &&
      (typeof centerEntryId !== 'string' ||
        !CANONICAL_UUID.test(centerEntryId))) ||
    typeof includePrivate !== 'boolean' ||
    typeof onlyPrivate !== 'boolean' ||
    (onlyPrivate && !includePrivate) ||
    typeof candidateLimit !== 'number' ||
    !Number.isSafeInteger(candidateLimit) ||
    candidateLimit < 1 ||
    candidateLimit > 12 ||
    typeof neighborLimit !== 'number' ||
    !Number.isSafeInteger(neighborLimit) ||
    neighborLimit < 1 ||
    neighborLimit > INFORMATION_ENTRY_GRAPH_MAXIMUM_NEIGHBORS
  ) {
    return undefined;
  }
  return Object.freeze({
    ...(query === undefined ? {} : {query}),
    ...(centerEntryId === undefined ? {} : {centerEntryId}),
    includePrivate,
    onlyPrivate,
    candidateLimit,
    neighborLimit,
  });
}

function decodeInformationEntryKnowledgeGraphEdgeWrite(body: unknown):
  | Readonly<
      | {
          expectedRevision: number;
          includePrivate: boolean;
          operation: 'edit';
          label: string;
          direction: InformationEntryGraphDirection;
        }
      | {
          expectedRevision: number;
          includePrivate: boolean;
          operation: 'block' | 'restore';
        }
    >
  | undefined {
  if (!isRecord(body)) return undefined;
  const includePrivate = body.includePrivate ?? false;
  if (
    typeof body.expectedRevision !== 'number' ||
    !Number.isSafeInteger(body.expectedRevision) ||
    body.expectedRevision < 0 ||
    body.expectedRevision >= 2_147_483_647 ||
    typeof includePrivate !== 'boolean'
  ) {
    return undefined;
  }
  if (body.operation === 'edit') {
    if (
      typeof body.label !== 'string' ||
      typeof body.direction !== 'string' ||
      !INFORMATION_ENTRY_GRAPH_DIRECTIONS.includes(
        body.direction as InformationEntryGraphDirection,
      )
    ) {
      return undefined;
    }
    return Object.freeze({
      expectedRevision: body.expectedRevision,
      includePrivate,
      operation: 'edit' as const,
      label: body.label,
      direction: body.direction as InformationEntryGraphDirection,
    });
  }
  if (
    (body.operation !== 'block' && body.operation !== 'restore') ||
    body.label !== undefined ||
    body.direction !== undefined
  ) {
    return undefined;
  }
  return Object.freeze({
    expectedRevision: body.expectedRevision,
    includePrivate,
    operation: body.operation,
  });
}

function decodeInformationEntryAssociationScope(
  body: unknown,
): boolean | undefined {
  if (!isRecord(body)) return undefined;
  const includePrivate = body.includePrivate ?? false;
  return typeof includePrivate === 'boolean' ? includePrivate : undefined;
}

function decodeInformationEntryAssociationOverride(body: unknown):
  | Readonly<{
      expectedRevision: number;
      includePrivate: boolean;
      action: InformationEntryAssociationAction;
    }>
  | undefined {
  if (!isRecord(body)) return undefined;
  const includePrivate = body.includePrivate ?? false;
  if (
    typeof body.expectedRevision !== 'number' ||
    !Number.isSafeInteger(body.expectedRevision) ||
    body.expectedRevision < 0 ||
    body.expectedRevision >= 2_147_483_647 ||
    typeof body.action !== 'string' ||
    !INFORMATION_ENTRY_ASSOCIATION_ACTIONS.includes(
      body.action as InformationEntryAssociationAction,
    ) ||
    typeof includePrivate !== 'boolean'
  ) {
    return undefined;
  }
  return Object.freeze({
    expectedRevision: body.expectedRevision,
    includePrivate,
    action: body.action as InformationEntryAssociationAction,
  });
}

function decodeDocumentTagWriteBody(
  body: unknown,
  requireTags: boolean,
):
  | Readonly<{
      expectedRevision: number;
      includePrivate: boolean;
      tags?: readonly string[];
    }>
  | undefined {
  if (!isRecord(body)) return undefined;
  const includePrivate = body.includePrivate ?? false;
  if (
    typeof body.expectedRevision !== 'number' ||
    !Number.isSafeInteger(body.expectedRevision) ||
    body.expectedRevision < 0 ||
    body.expectedRevision > 2_147_483_647 ||
    typeof includePrivate !== 'boolean'
  ) {
    return undefined;
  }
  if (!requireTags) {
    if (body.tags !== undefined) return undefined;
    return Object.freeze({
      expectedRevision: body.expectedRevision,
      includePrivate,
    });
  }
  if (
    !Array.isArray(body.tags) ||
    !body.tags.every((value) => typeof value === 'string')
  ) {
    return undefined;
  }
  return Object.freeze({
    expectedRevision: body.expectedRevision,
    includePrivate,
    tags: Object.freeze([...body.tags] as string[]),
  });
}

function entryMatchCountsBySnapshot(
  matches: readonly Readonly<{entry: Readonly<CurrentInformationEntry>}>[],
): ReadonlyMap<string, number> {
  const counts = new Map<string, number>();
  for (const match of matches) {
    if (!match.entry.value.isPrivate) continue;
    counts.set(
      match.entry.snapshotId,
      (counts.get(match.entry.snapshotId) ?? 0) + 1,
    );
  }
  return counts;
}
function privateDocumentMatchesStructuralFilters(
  snapshot: Readonly<EvidenceSnapshotSummary>,
  request: Readonly<InformationEntrySearchRequest>,
  entryMatchCounts?: ReadonlyMap<string, number>,
): boolean {
  if (
    request.sourceKey !== undefined &&
    snapshot.sourceKey !== request.sourceKey
  ) {
    return false;
  }
  if (
    request.snapshotId !== undefined &&
    snapshot.snapshotId !== request.snapshotId
  ) {
    return false;
  }
  if (request.time !== undefined) {
    const value =
      request.time.field === 'published'
        ? snapshot.publication?.instant
        : snapshot.capturedAt;
    if (value === undefined) return false;
    const date = value.slice(0, 10);
    if (
      (request.time.from !== undefined && date < request.time.from) ||
      (request.time.to !== undefined && date > request.time.to)
    ) {
      return false;
    }
  }
  return (
    entryMatchCounts === undefined ||
    (entryMatchCounts.get(snapshot.snapshotId) ?? 0) > 0
  );
}

function privateDocumentExcerpt(value: string): string {
  const normalized = value.replace(/\s+/gu, ' ').trim();
  const codePoints = Array.from(normalized);
  return codePoints.length <= 280
    ? normalized
    : `${codePoints.slice(0, 277).join('')}…`;
}

function decodeInformationEntryAssociationPolicyWrite(body: unknown):
  | Readonly<{
      expectedRevision: number;
      contentWeight: number;
      typeWeight: number;
      domainWeight: number;
      threshold: number;
    }>
  | undefined {
  if (!isRecord(body)) return undefined;
  const values = [
    body.expectedRevision,
    body.contentWeight,
    body.typeWeight,
    body.domainWeight,
    body.threshold,
  ];
  if (
    values.some(
      (candidate) =>
        typeof candidate !== 'number' || !Number.isSafeInteger(candidate),
    ) ||
    (body.expectedRevision as number) < 0 ||
    (body.contentWeight as number) < 0 ||
    (body.typeWeight as number) < 0 ||
    (body.domainWeight as number) < 0 ||
    (body.contentWeight as number) +
      (body.typeWeight as number) +
      (body.domainWeight as number) !==
      100 ||
    (body.threshold as number) < 0 ||
    (body.threshold as number) > 10_000
  ) {
    return undefined;
  }
  return Object.freeze({
    expectedRevision: body.expectedRevision as number,
    contentWeight: body.contentWeight as number,
    typeWeight: body.typeWeight as number,
    domainWeight: body.domainWeight as number,
    threshold: body.threshold as number,
  });
}

function decodeInformationEntryExplorationRequest(
  body: unknown,
): Readonly<InformationEntryExplorationRequest> | undefined {
  if (!isRecord(body)) return undefined;
  const excludeEntryIds = decodeExplorationExcludedEntryIds(
    body.excludeEntryIds,
  );
  if (
    typeof body.anchorEntryId !== 'string' ||
    !CANONICAL_UUID.test(body.anchorEntryId) ||
    excludeEntryIds === undefined ||
    typeof body.pageResultCount !== 'number' ||
    !Number.isSafeInteger(body.pageResultCount) ||
    body.pageResultCount < 0 ||
    body.pageResultCount > 100 ||
    typeof body.includePrivate !== 'boolean' ||
    (body.onlyPrivate !== undefined && typeof body.onlyPrivate !== 'boolean') ||
    (body.onlyPrivate === true && !body.includePrivate)
  ) {
    return undefined;
  }
  return Object.freeze({
    anchorEntryId: body.anchorEntryId,
    excludeEntryIds,
    pageResultCount: body.pageResultCount,
    includePrivate: body.includePrivate,
    onlyPrivate: body.onlyPrivate === true,
  });
}

function decodeExplorationExcludedEntryIds(
  value: unknown,
): readonly string[] | undefined {
  if (!Array.isArray(value) || value.length > 100) return undefined;
  const decoded: string[] = [];
  for (const entryId of value as readonly unknown[]) {
    if (typeof entryId !== 'string' || !CANONICAL_UUID.test(entryId)) {
      return undefined;
    }
    decoded.push(entryId);
  }
  return new Set(decoded).size === decoded.length
    ? Object.freeze(decoded)
    : undefined;
}

function decodeInformationEntryExplorationPolicyWrite(body: unknown):
  | Readonly<{
      expectedRevision: number;
      enabled: boolean;
      resultShare: number;
      neighborExpansion: boolean;
      crossDomain: boolean;
      serendipity: boolean;
    }>
  | undefined {
  if (
    !isRecord(body) ||
    typeof body.expectedRevision !== 'number' ||
    !Number.isSafeInteger(body.expectedRevision) ||
    body.expectedRevision < 0
  ) {
    return undefined;
  }
  const decoded = decodeReviewExplorationPolicyPreferences({
    revision: body.expectedRevision,
    enabled: body.enabled,
    resultShare: body.resultShare,
    neighborExpansion: body.neighborExpansion,
    crossDomain: body.crossDomain,
    serendipity: body.serendipity,
  });
  return decoded === undefined
    ? undefined
    : Object.freeze({
        expectedRevision: decoded.revision,
        enabled: decoded.enabled,
        resultShare: decoded.resultShare,
        neighborExpansion: decoded.neighborExpansion,
        crossDomain: decoded.crossDomain,
        serendipity: decoded.serendipity,
      });
}

function informationEntryAssociationPolicyFromPreferences(
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

function informationEntryExplorationPolicyFromPreferences(
  preferences: Readonly<ReviewExplorationPolicyPreferences>,
): Readonly<InformationEntryExplorationPolicy> {
  return Object.freeze({
    ...preferences,
    version: INFORMATION_ENTRY_EXPLORATION_POLICY_VERSION,
  });
}

function statusForImport(status: string): number {
  if (status === 'created') return 201;
  if (status === 'existing') return 200;
  if (status === 'conflict') return 409;
  if (status === 'persistence_failed') return 503;
  return 422;
}

function inputFailure(path: string): M1cHttpResult {
  return httpResult(422, {
    status: 'rejected',
    issue: Object.freeze({code: 'invalid_http_input', path}),
  });
}

function decodeProcessingRunLimit(value: unknown): number | undefined {
  const candidate =
    typeof value === 'string' && /^[1-9][0-9]{0,2}$/u.test(value)
      ? Number(value)
      : value;
  return typeof candidate === 'number' &&
    Number.isSafeInteger(candidate) &&
    candidate >= 1 &&
    candidate <= 100
    ? candidate
    : undefined;
}

function decodeSourceSubscriptionReplace(body: unknown):
  | Readonly<{
      expectedRevision: number;
      subscriptions: readonly Readonly<SourceSubscriptionWrite>[];
    }>
  | undefined {
  if (
    !isRecord(body) ||
    Object.keys(body).length !== 2 ||
    !Number.isSafeInteger(body.expectedRevision) ||
    (body.expectedRevision as number) < 0 ||
    !Array.isArray(body.subscriptions)
  ) {
    return undefined;
  }
  const expectedKeys = [
    'enabled',
    'intervalMinutes',
    'isPrivate',
    'label',
    'profile',
    'repositoryPath',
    'repositoryRef',
    'repositoryUri',
    'sourceAlias',
    'subscriptionId',
  ];
  if (
    body.subscriptions.some(
      (subscription) =>
        !isRecord(subscription) ||
        Object.keys(subscription).sort().join('\\u0000') !==
          expectedKeys.join('\\u0000'),
    )
  ) {
    return undefined;
  }
  const decoded = decodeReviewSourceSubscriptionPreferences({
    revision: (body.expectedRevision as number) + 1,
    subscriptions: body.subscriptions,
  });
  if (decoded === undefined) return undefined;
  return Object.freeze({
    expectedRevision: body.expectedRevision as number,
    subscriptions: Object.freeze(
      decoded.subscriptions.map((subscription) =>
        Object.freeze({
          subscriptionId: subscription.subscriptionId,
          label: subscription.label,
          enabled: subscription.enabled,
          repositoryUri: subscription.repositoryUri,
          repositoryRef: subscription.repositoryRef,
          repositoryPath: subscription.repositoryPath,
          profile: subscription.profile,
          sourceAlias: subscription.sourceAlias,
          isPrivate: subscription.isPrivate,
          intervalMinutes: subscription.intervalMinutes,
        }),
      ),
    ),
  });
}

function sourceSubscriptionFailure(error: unknown): M1cHttpResult {
  if (!(error instanceof SourceSubscriptionServiceError)) {
    return sourceSubscriptionUnavailable();
  }
  if (error.code === 'source_subscription_not_found') {
    return httpResult(404, {
      status: 'not_found',
      issue: Object.freeze({code: error.code}),
    });
  }
  if (
    error.code === 'source_subscription_stale' ||
    error.code === 'source_subscription_changed' ||
    error.code === 'source_subscription_run_conflict' ||
    error.code === 'source_subscription_run_invalid'
  ) {
    return httpResult(409, {
      status: 'rejected',
      issue: Object.freeze({code: error.code}),
    });
  }
  if (
    error.code === 'source_subscription_invalid' ||
    error.code === 'source_import_rejected'
  ) {
    return httpResult(422, {
      status: 'rejected',
      issue: Object.freeze({code: error.code}),
    });
  }
  if (
    error.code === 'source_not_found' ||
    error.code === 'source_too_large' ||
    error.code === 'source_invalid' ||
    error.code === 'source_unavailable'
  ) {
    return httpResult(502, {
      status: 'failed',
      issue: Object.freeze({code: error.code}),
    });
  }
  return sourceSubscriptionUnavailable();
}

function sourceSubscriptionUnavailable(): M1cHttpResult {
  return httpResult(503, {
    status: 'failed',
    issue: Object.freeze({code: 'source_subscription_unavailable'}),
  });
}

function processingRunResponse(
  run: Readonly<ProcessingRun>,
): Readonly<Record<string, unknown>> {
  return Object.freeze({
    runId: run.runId,
    origin: run.origin,
    ...(run.providerKey === undefined ? {} : {providerKey: run.providerKey}),
    status: run.status,
    ...(run.targetSnapshotId === undefined
      ? {}
      : {targetSnapshotId: run.targetSnapshotId}),
    privacyScope: run.privacyScope,
    currentStage: run.currentStage,
    ...(run.currentStep === undefined ? {} : {currentStep: run.currentStep}),
    completedUnits: run.completedUnits,
    ...(run.totalUnits === undefined ? {} : {totalUnits: run.totalUnits}),
    attempt: run.attempt,
    version: run.version,
    ...(run.errorCode === undefined ? {} : {errorCode: run.errorCode}),
    createdAt: run.createdAt,
    ...(run.startedAt === undefined ? {} : {startedAt: run.startedAt}),
    ...(run.finishedAt === undefined ? {} : {finishedAt: run.finishedAt}),
    updatedAt: run.updatedAt,
    proposals: Object.freeze(run.proposals.map(processingProposalResponse)),
  });
}

function processingProposalResponse(
  proposal: Readonly<ProcessingProposal>,
): Readonly<Record<string, unknown>> {
  return Object.freeze({
    proposalId: proposal.proposalId,
    runId: proposal.runId,
    ordinal: proposal.ordinal,
    stage: proposal.stage,
    kind: proposal.kind,
    ...(proposal.targetSnapshotId === undefined
      ? {}
      : {targetSnapshotId: proposal.targetSnapshotId}),
    ...(proposal.targetEntryId === undefined
      ? {}
      : {targetEntryId: proposal.targetEntryId}),
    ...(proposal.relatedEntryId === undefined
      ? {}
      : {relatedEntryId: proposal.relatedEntryId}),
    status: proposal.status,
    summary: proposal.summary,
    fragmentIds: proposal.fragmentIds,
    ...(proposal.splitPayload === undefined
      ? {}
      : {splitPayload: proposal.splitPayload}),
    ...(proposal.tagPayload === undefined
      ? {}
      : {tagPayload: proposal.tagPayload}),
    ...(proposal.associationPayload === undefined
      ? {}
      : {associationPayload: proposal.associationPayload}),
    createdAt: proposal.createdAt,
    ...(proposal.decidedAt === undefined
      ? {}
      : {decidedAt: proposal.decidedAt}),
  });
}

function decodeAiTagProposalStart(
  body: unknown,
): Readonly<{requestKey: string}> | undefined {
  if (
    !isRecord(body) ||
    Object.keys(body).length !== 1 ||
    typeof body.requestKey !== 'string' ||
    !/^[A-Za-z0-9._:-]{1,80}$/u.test(body.requestKey)
  ) {
    return undefined;
  }
  return Object.freeze({requestKey: body.requestKey});
}

function aiProviderNotConfigured(): M1cHttpResult {
  return httpResult(409, {
    status: 'rejected',
    issue: Object.freeze({code: 'ai_provider_not_configured'}),
  });
}

function informationEntryQuerySynthesisFailure(error: unknown): M1cHttpResult {
  if (!(error instanceof InformationEntryQuerySynthesisServiceError)) {
    return repositoryFailure();
  }
  if (error.code === 'ai_query_private_scope_forbidden') {
    return httpResult(409, {
      status: 'rejected',
      issue: Object.freeze({code: error.code}),
    });
  }
  if (error.code === 'ai_query_no_evidence') {
    return httpResult(422, {
      status: 'rejected',
      issue: Object.freeze({code: error.code}),
    });
  }
  return httpResult(502, {
    status: 'failed',
    issue: Object.freeze({code: error.code}),
  });
}

function aiSplitProposalFailure(error: unknown): M1cHttpResult {
  if (!(error instanceof AiSplitProposalServiceError))
    return repositoryFailure();
  if (
    error.code === 'ai_snapshot_not_found' ||
    error.code === 'ai_proposal_not_found'
  ) {
    return httpResult(404, {
      status: 'not_found',
      issue: Object.freeze({code: error.code}),
    });
  }
  if (
    error.code === 'ai_split_input_unsupported' ||
    error.code === 'ai_proposal_invalid'
  ) {
    return httpResult(422, {
      status: 'rejected',
      issue: Object.freeze({code: error.code}),
    });
  }
  if (
    error.code === 'ai_private_snapshot_forbidden' ||
    error.code === 'ai_snapshot_already_materialized' ||
    error.code === 'ai_run_conflict' ||
    error.code === 'ai_run_invalid_state' ||
    error.code === 'ai_proposal_terminal' ||
    error.code === 'stale_split_materialization'
  ) {
    return httpResult(409, {
      status: 'rejected',
      issue: Object.freeze({code: error.code}),
    });
  }
  return httpResult(502, {
    status: 'failed',
    issue: Object.freeze({code: error.code}),
  });
}
function aiTagProposalFailure(error: unknown): M1cHttpResult {
  if (!(error instanceof AiTagProposalServiceError)) {
    return repositoryFailure();
  }
  if (
    error.code === 'ai_entry_not_found' ||
    error.code === 'ai_proposal_not_found'
  ) {
    return httpResult(404, {
      status: 'not_found',
      issue: Object.freeze({code: error.code}),
    });
  }
  if (error.code === 'ai_proposal_invalid') {
    return httpResult(422, {
      status: 'rejected',
      issue: Object.freeze({code: error.code}),
    });
  }
  if (
    error.code === 'ai_private_entry_forbidden' ||
    error.code === 'ai_run_conflict' ||
    error.code === 'ai_run_invalid_state' ||
    error.code === 'ai_proposal_terminal' ||
    error.code === 'stale_entry_revision'
  ) {
    return httpResult(409, {
      status: 'rejected',
      issue: Object.freeze({code: error.code}),
    });
  }
  return httpResult(502, {
    status: 'failed',
    issue: Object.freeze({code: error.code}),
  });
}

function aiAssociationProposalFailure(error: unknown): M1cHttpResult {
  if (!(error instanceof AiAssociationProposalServiceError)) {
    return repositoryFailure();
  }
  if (
    error.code === 'ai_association_entry_not_found' ||
    error.code === 'ai_proposal_not_found'
  ) {
    return httpResult(404, {
      status: 'not_found',
      issue: Object.freeze({code: error.code}),
    });
  }
  if (error.code === 'ai_proposal_invalid') {
    return httpResult(422, {
      status: 'rejected',
      issue: Object.freeze({code: error.code}),
    });
  }
  if (
    error.code === 'ai_private_entry_forbidden' ||
    error.code === 'ai_run_conflict' ||
    error.code === 'ai_run_invalid_state' ||
    error.code === 'ai_proposal_terminal' ||
    error.code === 'stale_entry_revision' ||
    error.code === 'stale_association_revision'
  ) {
    return httpResult(409, {
      status: 'rejected',
      issue: Object.freeze({code: error.code}),
    });
  }
  return httpResult(502, {
    status: 'failed',
    issue: Object.freeze({code: error.code}),
  });
}
function repositoryFailure(): M1cHttpResult {
  return httpResult(503, {
    status: 'failed',
    issue: Object.freeze({code: 'repository_failed'}),
  });
}

function workspaceTransferFailure(error: unknown): M1cHttpResult {
  if (!(error instanceof M1cWorkspaceTransferError)) {
    return httpResult(503, {
      status: 'failed',
      issue: Object.freeze({code: 'workspace_transfer_failed'}),
    });
  }
  if (
    error.code === 'bundle_not_found' ||
    error.code === 'workspace_not_found'
  ) {
    return httpResult(404, {
      status: 'rejected',
      issue: Object.freeze({code: error.code}),
    });
  }
  if (
    error.code === 'workspace_mismatch' ||
    error.code === 'workspace_not_empty'
  ) {
    return httpResult(409, {
      status: 'rejected',
      issue: Object.freeze({code: error.code}),
    });
  }
  if (error.code === 'bundle_invalid') {
    return httpResult(422, {
      status: 'rejected',
      issue: Object.freeze({code: error.code}),
    });
  }
  return httpResult(503, {
    status: 'failed',
    issue: Object.freeze({code: error.code}),
  });
}

function httpResult(statusCode: number, body: unknown): M1cHttpResult {
  return Object.freeze({statusCode, body});
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
