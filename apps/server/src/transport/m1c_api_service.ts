import {Buffer} from 'node:buffer';

import {
  ENTRY_CHUNK_MODES,
  ENTRY_DOMAIN_KEYWORDS,
  ENTRY_TEXT_SEARCH_FIELDS,
  ENTRY_TEXT_SEARCH_MODES,
  ENTRY_RETRIEVAL_MODES,
  ENTRY_TYPE_KEYWORDS,
  INFORMATION_ENTRY_ASSOCIATION_ACTIONS,
  INFORMATION_ENTRY_ASSOCIATION_POLICY,
  INFORMATION_ENTRY_EXPLORATION_POLICY_VERSION,
  INFORMATION_ENTRY_GRAPH_DIRECTIONS,
  INFORMATION_ENTRY_GRAPH_SEMANTIC_KINDS,
  INFORMATION_ENTRY_GRAPH_VERIFICATION_STATUSES,
  INFORMATION_ENTRY_GRAPH_MAXIMUM_NEIGHBORS,
  InformationEntrySearchCursorError,
  InformationEntryRetrievalServiceError,
  InformationEntryQuerySynthesisServiceError,
  buildInformationEntryKnowledgeGraph,
  buildInformationEntryAssociationProjection,
  deriveEditedInformationDocumentResourceId,
  deriveEditedInformationDocumentSnapshotId,
  exploreCurrentInformationEntries,
  deriveInformationDocumentTagRevisionId,
  deriveInformationEntryAssociationOverrideRevisionId,
  deriveInformationEntryRevisionId,
  deriveInformationEntryRestructureGroups,
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
  prepareInformationEntryRestructure,
  prepareSplitInformationEntries,
  decodeEntrySplitRuleProfile,
  decodeEntrySplitRuleSettings,
  DEFAULT_ENTRY_SPLIT_RULE_PROFILE,
  planInformationEntrySplitRule,
  searchCurrentInformationEntries,
  scoreInformationEntrySearchText,
  suggestInformationEntryPreferenceRules,
  trialInformationEntryAutomationPolicy,
  trialInformationEntryPreferenceProfile,
  validateInformationDocumentWorkingCopyText,
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
  type InformationEntryGraphSemanticKind,
  type InformationEntryGraphVerificationStatus,
  type InformationEntryPreferenceTrialExpectedEntry,
  type InformationDocumentTagRepositoryPort,
  type InformationDocumentWorkingCopyRepositoryPort,
  type InformationEntryDocumentView,
  type InformationEntryEmptySnapshotRepositoryPort,
  type InformationEntrySearchRequest,
  type InformationEntryQuerySynthesisRequest,
  type InformationEntryQuerySynthesisServicePort,
  type InformationEntryRetrievalServicePort,
  type InformationEntrySearchEvaluationCase,
  type InformationEntryRestructurePreparation,
  type InformationEntryRestructureRepositoryPort,
  type CurrentInformationDocumentTags,
  type MaterializedEvidenceSnapshot,
  type EntrySplitRuleProfile,
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
  executeEntryAutomationRunActions,
  executeEntryAutomationWorkItemAction,
  executeInformationEntryAutomation,
  listEntryAutomationWorkQueue,
  updateEntryAutomationWorkItem,
  type AiAssociationProposalServicePort,
  type AiSplitProposalServicePort,
  type AiTagProposalServicePort,
  type EntryAutomationExecution,
  type EntryAutomationExecutionRepositoryPort,
  type EntryAutomationActionRepositoryPort,
  type EntryAutomationWorkQueueRepositoryPort,
  type ExecuteEntryAutomationResult,
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
  decodeEntryAutomationPolicy,
  decodeEntryPreferenceProfile,
  decodeReviewExplorationPolicyPreferences,
  decodeReviewSourceSubscriptionPreferences,
  decodeReviewQuickTags,
  decodeReviewVocabularyPreferences,
  DEFAULT_ENTRY_AUTOMATION_POLICY,
  DEFAULT_ENTRY_PREFERENCE_PROFILE,
  DEFAULT_REVIEW_ASSOCIATION_POLICY_PREFERENCES,
  DEFAULT_REVIEW_AUTOMATIC_KEYWORD_PREFERENCES,
  DEFAULT_REVIEW_EXPLORATION_POLICY_PREFERENCES,
  DEFAULT_REVIEW_VOCABULARY_PREFERENCES,
  patchReviewPreferences,
  updateReviewPreferences,
  type ReviewAssociationPolicyPreferences,
  type ReviewExplorationPolicyPreferences,
  type EntryAutomationPolicy,
  type EntryPreferenceProfile,
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
  readonly informationDocumentWorkingCopyRepository: InformationDocumentWorkingCopyRepositoryPort;
  readonly informationEntryAssociationRepository: InformationEntryAssociationRepositoryPort;
  readonly informationEntryRetrieval?: InformationEntryRetrievalServicePort;
  readonly informationEntryRestructureRepository?: InformationEntryRestructureRepositoryPort;
  readonly processingRunRepository: ProcessingRunRepositoryPort;
  readonly entryAutomationExecutionRepository?: EntryAutomationExecutionRepositoryPort;
  readonly entryAutomationWorkQueueRepository?: EntryAutomationWorkQueueRepositoryPort;
  readonly entryAutomationActionRepository?: EntryAutomationActionRepositoryPort;
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

interface InformationEntryRestructureInput {
  readonly snapshotId: string;
  readonly includePrivate: boolean;
  readonly groups?: readonly Readonly<ManualEntryFragmentGroupInput>[];
  readonly planSha256?: string;
  readonly acknowledgeAnnotationChanges: boolean;
  readonly acknowledgeRelationshipChanges: boolean;
}

type LoadedInformationEntryRestructure =
  | Readonly<{kind: 'response'; response: Readonly<M1cHttpResult>}>
  | Readonly<{
      kind: 'loaded';
      materialized: Readonly<MaterializedEvidenceSnapshot>;
      allEntries: readonly Readonly<CurrentInformationEntry>[];
      currentDocumentTags?: Readonly<CurrentInformationDocumentTags>;
      preparation: Readonly<InformationEntryRestructurePreparation>;
    }>;

export interface M1cApiServicePort {
  workspace(): M1cHttpResult;
  listEvidence(): Promise<M1cHttpResult>;
  loadEvidenceSnapshot(
    snapshotId: string,
    includePrivate?: unknown,
  ): Promise<M1cHttpResult>;
  loadInformationDocumentWorkingCopy(
    snapshotId: string,
    includePrivate?: unknown,
  ): Promise<M1cHttpResult>;
  saveInformationDocumentWorkingCopy(
    snapshotId: string,
    body: unknown,
  ): Promise<M1cHttpResult>;
  restoreInformationDocumentWorkingCopy(
    snapshotId: string,
    body: unknown,
  ): Promise<M1cHttpResult>;
  commitInformationDocumentWorkingCopy(
    snapshotId: string,
    body: unknown,
  ): Promise<M1cHttpResult>;
  loadReviewPreferences(): Promise<M1cHttpResult>;
  saveReviewPreferences(body: unknown): Promise<M1cHttpResult>;
  loadInformationEntryPreferenceProfile(): Promise<M1cHttpResult>;
  saveInformationEntryPreferenceProfile(body: unknown): Promise<M1cHttpResult>;
  suggestInformationEntryPreferenceProfile(
    body: unknown,
  ): Promise<M1cHttpResult>;
  trialInformationEntryPreferenceProfile(body: unknown): Promise<M1cHttpResult>;
  loadInformationEntryAutomationPolicy(): Promise<M1cHttpResult>;
  saveInformationEntryAutomationPolicy(body: unknown): Promise<M1cHttpResult>;
  trialInformationEntryAutomationPolicy(body: unknown): Promise<M1cHttpResult>;
  executeInformationEntryAutomation(body: unknown): Promise<M1cHttpResult>;
  listInformationEntryAutomationExecutions(
    limit?: unknown,
  ): Promise<M1cHttpResult>;
  loadInformationEntryAutomationExecution(
    runId: string,
  ): Promise<M1cHttpResult>;
  listInformationEntryAutomationWorkQueue(
    includePrivate?: unknown,
  ): Promise<M1cHttpResult>;
  updateInformationEntryAutomationWorkItem(
    runId: string,
    claimOrdinal: string,
    body: unknown,
  ): Promise<M1cHttpResult>;
  executeInformationEntryAutomationWorkItemAction(
    runId: string,
    claimOrdinal: string,
    body: unknown,
  ): Promise<M1cHttpResult>;
  importMarkdown(body: unknown): Promise<M1cHttpResult>;
  importDocument(body: unknown): Promise<M1cHttpResult>;
  materializeInformationEntries(body: unknown): Promise<M1cHttpResult>;
  materializeManualInformationEntries(body: unknown): Promise<M1cHttpResult>;
  loadInformationEntrySplitRuleProfile(): Promise<M1cHttpResult>;
  saveInformationEntrySplitRuleProfile(body: unknown): Promise<M1cHttpResult>;
  trialInformationEntrySplitRule(body: unknown): Promise<M1cHttpResult>;
  applyInformationEntrySplitRule(body: unknown): Promise<M1cHttpResult>;
  previewInformationEntryRestructure(body: unknown): Promise<M1cHttpResult>;
  applyInformationEntryRestructure(body: unknown): Promise<M1cHttpResult>;
  reviseInformationEntry(
    entryId: string,
    body: unknown,
  ): Promise<M1cHttpResult>;
  searchInformationEntries(body: unknown): Promise<M1cHttpResult>;
  informationEntrySearchIndexStatus(): Promise<M1cHttpResult>;
  rebuildInformationEntrySearchIndex(): Promise<M1cHttpResult>;
  evaluateInformationEntrySearch(body: unknown): Promise<M1cHttpResult>;
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
        'information_document_working_copy',
        'information_document_tags',
        'information_entry_knowledge_graph',
        'information_entry_association_policy',
        ...(this.#dependencies.entryAutomationExecutionRepository === undefined
          ? []
          : ['entry_automation']),
        'information_entry_exploration',
        ...(this.#dependencies.informationEntryRetrieval === undefined
          ? []
          : ['information_entry_search_index']),
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
        ...(this.#dependencies.informationEntryRetrieval
          ?.semanticSearchAvailable === true
          ? ['semantic_entry_search']
          : []),
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

  public async loadInformationDocumentWorkingCopy(
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
      const source = await this.#loadEditableInformationDocument(
        snapshotId,
        includePrivate,
      );
      if (source.kind === 'response') return source.response;
      const workingCopy =
        await this.#dependencies.informationDocumentWorkingCopyRepository.load(
          this.#dependencies.workspaceId,
          snapshotId,
        );
      if (workingCopy?.state === 'committed') {
        const derivedSnapshotId = workingCopy.derivedSnapshotId;
        const derivedResourceId = workingCopy.derivedResourceId;
        if (
          derivedSnapshotId === undefined ||
          derivedResourceId === undefined
        ) {
          throw new Error('Committed working copy identity missing.');
        }
        const derived =
          await this.#dependencies.evidenceReadRepository.loadSnapshot(
            this.#dependencies.workspaceId,
            derivedSnapshotId,
          );
        if (derived === undefined) throw new Error('Derived Snapshot missing.');
        const materialized = await materializeEvidenceSnapshot(
          derived,
          this.#dependencies.blobStore,
        );
        return httpResult(200, {
          status: 'ok',
          workingCopy: Object.freeze({
            sourceSnapshotId: snapshotId,
            revision: workingCopy.revision,
            state: 'committed',
            originalText: source.originalText,
            currentText: informationDocumentText(materialized),
            bodySha256: workingCopy.bodySha256,
            changed: true,
            derivedResourceId,
            derivedSnapshotId,
          }),
        });
      }
      const currentText = workingCopy?.draftBody ?? source.originalText;
      return httpResult(200, {
        status: 'ok',
        workingCopy: Object.freeze({
          sourceSnapshotId: snapshotId,
          revision: workingCopy?.revision ?? 0,
          state: workingCopy?.state ?? 'original',
          originalText: source.originalText,
          currentText,
          bodySha256: workingCopy?.bodySha256,
          changed: currentText !== source.originalText,
        }),
      });
    } catch {
      return repositoryFailure();
    }
  }

  public async saveInformationDocumentWorkingCopy(
    snapshotId: string,
    body: unknown,
  ): Promise<M1cHttpResult> {
    const input = decodeInformationDocumentWorkingCopyWrite(body, true);
    if (!CANONICAL_UUID.test(snapshotId)) {
      return inputFailure('path.snapshotId');
    }
    if (input?.text === undefined) {
      return inputFailure('body');
    }
    const validated = validateInformationDocumentWorkingCopyText(input.text);
    if (validated === undefined) return inputFailure('body.text');
    try {
      const source = await this.#loadEditableInformationDocument(
        snapshotId,
        input.includePrivate,
      );
      if (source.kind === 'response') return source.response;
      if (validated.text === source.originalText) {
        if (input.expectedRevision === 0) {
          return httpResult(200, {
            status: 'unchanged',
            workingCopy: Object.freeze({
              sourceSnapshotId: snapshotId,
              revision: 0,
              state: 'original',
              originalText: source.originalText,
              currentText: source.originalText,
              changed: false,
            }),
          });
        }
        const restored =
          await this.#dependencies.informationDocumentWorkingCopyRepository.restore(
            this.#dependencies.workspaceId,
            snapshotId,
            input.expectedRevision,
          );
        return restored === 'restored'
          ? httpResult(200, {
              status: 'restored',
              workingCopy: Object.freeze({
                sourceSnapshotId: snapshotId,
                revision: 0,
                state: 'original',
                originalText: source.originalText,
                currentText: source.originalText,
                changed: false,
              }),
            })
          : workingCopyWriteFailure(restored);
      }
      const result =
        await this.#dependencies.informationDocumentWorkingCopyRepository.save({
          workspaceId: this.#dependencies.workspaceId,
          sourceSnapshotId: snapshotId,
          expectedRevision: input.expectedRevision,
          draftBody: validated.text,
          bodySha256: validated.sha256,
        });
      if (
        result.outcome === 'stale' ||
        result.outcome === 'committed' ||
        result.outcome === 'source_materialized'
      ) {
        return workingCopyWriteFailure(result.outcome);
      }
      const saved = result.value;
      if (saved?.state !== 'editing' || saved.draftBody === undefined) {
        throw new Error('Saved working copy missing.');
      }
      return httpResult(200, {
        status: result.outcome,
        workingCopy: Object.freeze({
          sourceSnapshotId: snapshotId,
          revision: saved.revision,
          state: 'editing',
          originalText: source.originalText,
          currentText: saved.draftBody,
          bodySha256: saved.bodySha256,
          changed: true,
        }),
      });
    } catch {
      return repositoryFailure();
    }
  }

  public async restoreInformationDocumentWorkingCopy(
    snapshotId: string,
    body: unknown,
  ): Promise<M1cHttpResult> {
    const input = decodeInformationDocumentWorkingCopyWrite(body, false);
    if (!CANONICAL_UUID.test(snapshotId))
      return inputFailure('path.snapshotId');
    if (input === undefined) return inputFailure('body');
    try {
      const source = await this.#loadEditableInformationDocument(
        snapshotId,
        input.includePrivate,
      );
      if (source.kind === 'response') return source.response;
      const result =
        await this.#dependencies.informationDocumentWorkingCopyRepository.restore(
          this.#dependencies.workspaceId,
          snapshotId,
          input.expectedRevision,
        );
      if (result !== 'restored') return workingCopyWriteFailure(result);
      return httpResult(200, {
        status: 'restored',
        workingCopy: Object.freeze({
          sourceSnapshotId: snapshotId,
          revision: 0,
          state: 'original',
          originalText: source.originalText,
          currentText: source.originalText,
          changed: false,
        }),
      });
    } catch {
      return repositoryFailure();
    }
  }

  public async commitInformationDocumentWorkingCopy(
    snapshotId: string,
    body: unknown,
  ): Promise<M1cHttpResult> {
    const input = decodeInformationDocumentWorkingCopyWrite(body, false);
    if (!CANONICAL_UUID.test(snapshotId))
      return inputFailure('path.snapshotId');
    if (input === undefined) return inputFailure('body');
    try {
      const source = await this.#loadEditableInformationDocument(
        snapshotId,
        input.includePrivate,
      );
      if (source.kind === 'response') return source.response;
      const workingCopy =
        await this.#dependencies.informationDocumentWorkingCopyRepository.load(
          this.#dependencies.workspaceId,
          snapshotId,
        );
      if (
        workingCopy?.state !== 'editing' ||
        workingCopy.draftBody === undefined
      ) {
        return httpResult(409, {
          status: 'rejected',
          issue: Object.freeze({
            code: 'information_document_working_copy_not_editing',
          }),
        });
      }
      if (workingCopy.revision !== input.expectedRevision) {
        return workingCopyWriteFailure('stale');
      }
      const derivedResourceId =
        deriveEditedInformationDocumentResourceId(snapshotId);
      const derivedSnapshotId = deriveEditedInformationDocumentSnapshotId(
        snapshotId,
        workingCopy.bodySha256,
      );
      const imported = await importMarkdownEvidence(
        {
          blobStore: this.#dependencies.blobStore,
          evidenceRepository: this.#dependencies.evidenceRepository,
        },
        {
          workspaceId: this.#dependencies.workspaceId,
          commandIdempotencyKey: `document-edit:${snapshotId}:${workingCopy.revision.toString()}:${workingCopy.bodySha256}`,
          resource: Object.freeze({
            workspaceId: this.#dependencies.workspaceId,
            resourceId: derivedResourceId,
            resourceKind: 'manual_text',
            sourceKey: `edited-${snapshotId}`,
            ...(source.snapshot.isPrivate === true
              ? {isPrivate: true as const}
              : {}),
          }),
          snapshot: Object.freeze({
            workspaceId: this.#dependencies.workspaceId,
            snapshotId: derivedSnapshotId,
            resourceId: derivedResourceId,
            capturedAt: source.snapshot.capturedAt,
            mediaType: 'text/markdown; charset=utf-8',
            ...(source.snapshot.publication === undefined
              ? {}
              : {publication: source.snapshot.publication}),
          }),
          gitObservations: Object.freeze([]),
          profile: 'commonmark-v1',
          sourceUtf8: new TextEncoder().encode(workingCopy.draftBody),
        },
      );
      if (imported.status !== 'created' && imported.status !== 'existing') {
        return httpResult(statusForImport(imported.status), imported);
      }
      const committed =
        await this.#dependencies.informationDocumentWorkingCopyRepository.commit(
          {
            workspaceId: this.#dependencies.workspaceId,
            sourceSnapshotId: snapshotId,
            expectedRevision: input.expectedRevision,
            bodySha256: workingCopy.bodySha256,
            derivedResourceId,
            derivedSnapshotId,
          },
        );
      if (
        committed.outcome !== 'committed' &&
        committed.outcome !== 'existing'
      ) {
        return workingCopyWriteFailure(committed.outcome);
      }
      return httpResult(200, {
        status: committed.outcome,
        sourceSnapshotId: snapshotId,
        derivedResourceId,
        derivedSnapshotId,
      });
    } catch {
      return repositoryFailure();
    }
  }

  async #loadEditableInformationDocument(
    snapshotId: string,
    includePrivate: boolean,
  ): Promise<
    | Readonly<{kind: 'response'; response: Readonly<M1cHttpResult>}>
    | Readonly<{
        kind: 'loaded';
        snapshot: Readonly<EvidenceSnapshotSummary>;
        originalText: string;
      }>
  > {
    const snapshot =
      await this.#dependencies.evidenceReadRepository.loadSnapshot(
        this.#dependencies.workspaceId,
        snapshotId,
      );
    if (snapshot === undefined) {
      return Object.freeze({
        kind: 'response',
        response: httpResult(404, {
          status: 'not_found',
          issue: Object.freeze({code: 'snapshot_not_found'}),
        }),
      });
    }
    if (snapshot.isPrivate === true && !includePrivate) {
      return Object.freeze({
        kind: 'response',
        response: httpResult(403, {
          status: 'rejected',
          issue: Object.freeze({
            code: 'private_content_requires_opt_in',
            path: 'body.includePrivate',
          }),
        }),
      });
    }
    const materialized = await materializeEvidenceSnapshot(
      snapshot,
      this.#dependencies.blobStore,
    );
    return Object.freeze({
      kind: 'loaded',
      snapshot,
      originalText: informationDocumentText(materialized),
    });
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
      const update = await updateReviewPreferences<
        Readonly<{
          associationPolicy: Readonly<ReviewAssociationPolicyPreferences>;
          explorationPolicy: Readonly<ReviewExplorationPolicyPreferences>;
        }>
      >(
        this.#dependencies.reviewPreferences,
        this.#dependencies.workspaceId,
        (current) => {
          const effectiveAssociationPolicy =
            associationPolicy ??
            current.associationPolicy ??
            DEFAULT_REVIEW_ASSOCIATION_POLICY_PREFERENCES;
          const effectiveExplorationPolicy =
            explorationPolicy ??
            current.explorationPolicy ??
            DEFAULT_REVIEW_EXPLORATION_POLICY_PREFERENCES;
          return Object.freeze({
            next: patchReviewPreferences(current, {
              quickTags,
              automaticKeywords,
              vocabulary,
              associationPolicy: effectiveAssociationPolicy,
              explorationPolicy: effectiveExplorationPolicy,
            }),
            result: Object.freeze({
              associationPolicy: effectiveAssociationPolicy,
              explorationPolicy: effectiveExplorationPolicy,
            }),
          });
        },
      );
      const preferences = update.preferences;
      return httpResult(200, {
        status: 'ok',
        workspaceId: preferences.workspaceId,
        quickTags: preferences.quickTags,
        automaticKeywords: preferences.automaticKeywords ?? automaticKeywords,
        vocabulary: preferences.vocabulary ?? vocabulary,
        associationPolicy:
          preferences.associationPolicy ?? update.result.associationPolicy,
        explorationPolicy:
          preferences.explorationPolicy ?? update.result.explorationPolicy,
      });
    } catch {
      return reviewPreferencesFailure();
    }
  }

  public async loadInformationEntryPreferenceProfile(): Promise<M1cHttpResult> {
    try {
      const preferences = await this.#dependencies.reviewPreferences.load(
        this.#dependencies.workspaceId,
      );
      return httpResult(200, {
        status: 'ok',
        profile:
          preferences.entryPreferenceProfile ??
          DEFAULT_ENTRY_PREFERENCE_PROFILE,
      });
    } catch {
      return entryPreferenceProfileFailure();
    }
  }

  public async saveInformationEntryPreferenceProfile(
    body: unknown,
  ): Promise<M1cHttpResult> {
    if (
      !isRecord(body) ||
      typeof body.expectedRevision !== 'number' ||
      !Number.isSafeInteger(body.expectedRevision) ||
      body.expectedRevision < 0
    ) {
      return inputFailure('body.expectedRevision');
    }
    const draft = decodeEntryPreferenceProfile({
      revision: body.expectedRevision,
      enabled: body.enabled,
      rules: body.rules,
    });
    if (draft === undefined) return inputFailure('body');

    try {
      const update = await updateReviewPreferences<
        Readonly<{
          outcome: 'applied' | 'stale' | 'unchanged';
          profile: Readonly<EntryPreferenceProfile>;
        }>
      >(
        this.#dependencies.reviewPreferences,
        this.#dependencies.workspaceId,
        (preferences) => {
          const current =
            preferences.entryPreferenceProfile ??
            DEFAULT_ENTRY_PREFERENCE_PROFILE;
          if (current.revision !== body.expectedRevision) {
            return Object.freeze({
              next: preferences,
              result: Object.freeze({
                outcome: 'stale' as const,
                profile: current,
              }),
            });
          }
          const unchanged = entryPreferenceProfilesHaveSameValue(
            current,
            draft,
          );
          const next: Readonly<EntryPreferenceProfile> = unchanged
            ? current
            : Object.freeze({
                revision: current.revision + 1,
                enabled: draft.enabled,
                rules: draft.rules,
              });
          return Object.freeze({
            next: unchanged
              ? preferences
              : patchReviewPreferences(preferences, {
                  entryPreferenceProfile: next,
                }),
            result: Object.freeze({
              outcome: unchanged
                ? ('unchanged' as const)
                : ('applied' as const),
              profile: next,
            }),
          });
        },
      );
      if (update.result.outcome === 'stale') {
        return httpResult(409, {
          status: 'rejected',
          issue: Object.freeze({
            code: 'stale_entry_preference_profile_revision',
          }),
        });
      }
      return httpResult(200, {
        status: update.result.outcome,
        profile: update.result.profile,
      });
    } catch {
      return entryPreferenceProfileFailure();
    }
  }

  public async suggestInformationEntryPreferenceProfile(
    body: unknown,
  ): Promise<M1cHttpResult> {
    if (!isRecord(body) || typeof body.includePrivate !== 'boolean') {
      return inputFailure('body.includePrivate');
    }
    try {
      const entries =
        await this.#dependencies.informationEntryRepository.loadCurrentEntries(
          this.#dependencies.workspaceId,
          body.includePrivate,
        );
      return httpResult(200, {
        status: 'ok',
        ...suggestInformationEntryPreferenceRules(entries, {
          includePrivate: body.includePrivate,
        }),
      });
    } catch {
      return entryPreferenceProfileFailure();
    }
  }

  public async trialInformationEntryPreferenceProfile(
    body: unknown,
  ): Promise<M1cHttpResult> {
    if (
      !isRecord(body) ||
      typeof body.includePrivate !== 'boolean' ||
      typeof body.expectedProfileRevision !== 'number' ||
      !Number.isSafeInteger(body.expectedProfileRevision) ||
      body.expectedProfileRevision < 0 ||
      (body.expectedEntries !== undefined &&
        !Array.isArray(body.expectedEntries))
    ) {
      return inputFailure('body');
    }
    try {
      const [preferences, entries] = await Promise.all([
        this.#dependencies.reviewPreferences.load(
          this.#dependencies.workspaceId,
        ),
        this.#dependencies.informationEntryRepository.loadCurrentEntries(
          this.#dependencies.workspaceId,
          body.includePrivate,
        ),
      ]);
      const currentProfile =
        preferences.entryPreferenceProfile ?? DEFAULT_ENTRY_PREFERENCE_PROFILE;
      const result = trialInformationEntryPreferenceProfile(
        entries,
        currentProfile.revision,
        body.profile,
        {
          includePrivate: body.includePrivate,
          expectedProfileRevision: body.expectedProfileRevision,
          ...(body.expectedEntries === undefined
            ? {}
            : {
                expectedEntries:
                  body.expectedEntries as readonly Readonly<InformationEntryPreferenceTrialExpectedEntry>[],
              }),
        },
      );
      if (result.status === 'invalid_profile') {
        return httpResult(422, {
          status: 'rejected',
          issue: Object.freeze({
            code: 'invalid_entry_preference_profile',
            path: 'body.profile',
          }),
        });
      }
      if (result.status === 'invalid_request') {
        return inputFailure('body');
      }
      return httpResult(result.status === 'complete' ? 200 : 409, result);
    } catch {
      return entryPreferenceProfileFailure();
    }
  }

  public async loadInformationEntryAutomationPolicy(): Promise<M1cHttpResult> {
    try {
      const preferences = await this.#dependencies.reviewPreferences.load(
        this.#dependencies.workspaceId,
      );
      const profile =
        preferences.entryPreferenceProfile ?? DEFAULT_ENTRY_PREFERENCE_PROFILE;
      return httpResult(200, {
        status: 'ok',
        policy:
          preferences.entryAutomationPolicy ?? DEFAULT_ENTRY_AUTOMATION_POLICY,
        profile: Object.freeze({
          revision: profile.revision,
          enabled: profile.enabled,
          ruleCount: profile.rules.length,
        }),
      });
    } catch {
      return entryAutomationFailure();
    }
  }

  public async saveInformationEntryAutomationPolicy(
    body: unknown,
  ): Promise<M1cHttpResult> {
    if (
      !isRecord(body) ||
      typeof body.expectedRevision !== 'number' ||
      !Number.isSafeInteger(body.expectedRevision) ||
      body.expectedRevision < 0
    ) {
      return inputFailure('body.expectedRevision');
    }
    const draft = decodeEntryAutomationPolicy({
      revision: body.expectedRevision,
      enabled: body.enabled,
      paused: body.paused,
      profileRevision: body.profileRevision,
      minimumMatchedRuleCount: body.minimumMatchedRuleCount,
      advanceThresholds: body.advanceThresholds,
      deferThresholds: body.deferThresholds,
      budgets: body.budgets,
      advanceActions: body.advanceActions,
      failureMode: body.failureMode,
    });
    if (draft === undefined) return inputFailure('body');

    try {
      const update = await updateReviewPreferences<
        Readonly<{
          outcome: 'applied' | 'stale' | 'stale_profile' | 'unchanged';
          policy: Readonly<EntryAutomationPolicy>;
          profile: Readonly<EntryPreferenceProfile>;
        }>
      >(
        this.#dependencies.reviewPreferences,
        this.#dependencies.workspaceId,
        (preferences) => {
          const current =
            preferences.entryAutomationPolicy ??
            DEFAULT_ENTRY_AUTOMATION_POLICY;
          const profile =
            preferences.entryPreferenceProfile ??
            DEFAULT_ENTRY_PREFERENCE_PROFILE;
          if (current.revision !== body.expectedRevision) {
            return Object.freeze({
              next: preferences,
              result: Object.freeze({
                outcome: 'stale' as const,
                policy: current,
                profile,
              }),
            });
          }
          if (draft.profileRevision !== profile.revision) {
            return Object.freeze({
              next: preferences,
              result: Object.freeze({
                outcome: 'stale_profile' as const,
                policy: current,
                profile,
              }),
            });
          }
          const unchanged = entryAutomationPoliciesHaveSameValue(
            current,
            draft,
          );
          if (unchanged) {
            return Object.freeze({
              next: preferences,
              result: Object.freeze({
                outcome: 'unchanged' as const,
                policy: current,
                profile,
              }),
            });
          }
          if (current.revision >= Number.MAX_SAFE_INTEGER) {
            throw new Error('Entry automation policy revision exhausted.');
          }
          const nextPolicy = Object.freeze({
            ...draft,
            revision: current.revision + 1,
          });
          return Object.freeze({
            next: patchReviewPreferences(preferences, {
              entryAutomationPolicy: nextPolicy,
            }),
            result: Object.freeze({
              outcome: 'applied' as const,
              policy: nextPolicy,
              profile,
            }),
          });
        },
      );
      if (update.result.outcome === 'stale') {
        return httpResult(409, {
          status: 'rejected',
          issue: Object.freeze({
            code: 'stale_entry_automation_policy_revision',
          }),
        });
      }
      if (update.result.outcome === 'stale_profile') {
        return httpResult(409, {
          status: 'rejected',
          issue: Object.freeze({
            code: 'stale_entry_preference_profile_revision',
          }),
        });
      }
      return httpResult(200, {
        status: update.result.outcome,
        policy: update.result.policy,
        profile: Object.freeze({
          revision: update.result.profile.revision,
          enabled: update.result.profile.enabled,
          ruleCount: update.result.profile.rules.length,
        }),
      });
    } catch {
      return entryAutomationFailure();
    }
  }

  public async trialInformationEntryAutomationPolicy(
    body: unknown,
  ): Promise<M1cHttpResult> {
    if (
      !isRecord(body) ||
      typeof body.includePrivate !== 'boolean' ||
      typeof body.expectedPolicyRevision !== 'number' ||
      !Number.isSafeInteger(body.expectedPolicyRevision) ||
      body.expectedPolicyRevision < 0 ||
      typeof body.expectedProfileRevision !== 'number' ||
      !Number.isSafeInteger(body.expectedProfileRevision) ||
      body.expectedProfileRevision < 0 ||
      (body.expectedEntries !== undefined &&
        !Array.isArray(body.expectedEntries)) ||
      (body.manualTakeoverEntryIds !== undefined &&
        !Array.isArray(body.manualTakeoverEntryIds))
    ) {
      return inputFailure('body');
    }
    try {
      const [preferences, entries] = await Promise.all([
        this.#dependencies.reviewPreferences.load(
          this.#dependencies.workspaceId,
        ),
        this.#dependencies.informationEntryRepository.loadCurrentEntries(
          this.#dependencies.workspaceId,
          true,
        ),
      ]);
      const currentPolicy =
        preferences.entryAutomationPolicy ?? DEFAULT_ENTRY_AUTOMATION_POLICY;
      const currentProfile =
        preferences.entryPreferenceProfile ?? DEFAULT_ENTRY_PREFERENCE_PROFILE;
      const result = trialInformationEntryAutomationPolicy(
        entries,
        currentPolicy.revision,
        currentProfile.revision,
        body.policy,
        currentProfile,
        {
          includePrivate: body.includePrivate,
          expectedPolicyRevision: body.expectedPolicyRevision,
          expectedProfileRevision: body.expectedProfileRevision,
          ...(body.expectedEntries === undefined
            ? {}
            : {
                expectedEntries:
                  body.expectedEntries as readonly Readonly<InformationEntryPreferenceTrialExpectedEntry>[],
              }),
          ...(body.manualTakeoverEntryIds === undefined
            ? {}
            : {
                manualTakeoverEntryIds:
                  body.manualTakeoverEntryIds as readonly string[],
              }),
        },
      );
      if (result.status === 'invalid_policy') {
        return httpResult(422, {
          status: 'rejected',
          issue: Object.freeze({
            code: 'invalid_entry_automation_policy',
            path: 'body.policy',
          }),
        });
      }
      if (
        result.status === 'invalid_profile' ||
        result.status === 'invalid_request'
      ) {
        return inputFailure('body');
      }
      return httpResult(result.status === 'complete' ? 200 : 409, result);
    } catch {
      return entryAutomationFailure();
    }
  }

  public async executeInformationEntryAutomation(
    body: unknown,
  ): Promise<M1cHttpResult> {
    const repository = this.#dependencies.entryAutomationExecutionRepository;
    if (repository === undefined) return entryAutomationUnavailable();
    if (
      !isRecord(body) ||
      typeof body.idempotencyKey !== 'string' ||
      typeof body.includePrivate !== 'boolean' ||
      typeof body.expectedPolicyRevision !== 'number' ||
      typeof body.expectedProfileRevision !== 'number' ||
      (body.expectedEntries !== undefined &&
        !Array.isArray(body.expectedEntries)) ||
      (body.manualTakeoverEntryIds !== undefined &&
        !Array.isArray(body.manualTakeoverEntryIds))
    ) {
      return inputFailure('body');
    }
    try {
      const result = await executeInformationEntryAutomation(
        {
          repository,
          entries: this.#dependencies.informationEntryRepository,
          preferences: this.#dependencies.reviewPreferences,
        },
        {
          workspaceId: this.#dependencies.workspaceId,
          idempotencyKey: body.idempotencyKey,
          includePrivate: body.includePrivate,
          expectedPolicyRevision: body.expectedPolicyRevision,
          expectedProfileRevision: body.expectedProfileRevision,
          ...(body.expectedEntries === undefined
            ? {}
            : {
                expectedEntries:
                  body.expectedEntries as readonly Readonly<InformationEntryPreferenceTrialExpectedEntry>[],
              }),
          ...(body.manualTakeoverEntryIds === undefined
            ? {}
            : {
                manualTakeoverEntryIds:
                  body.manualTakeoverEntryIds as readonly string[],
              }),
        },
      );
      if (result.status === 'invalid_request') return inputFailure('body');
      let actions:
        | Readonly<{
            status: 'complete';
            appliedCount: number;
            unchangedCount: number;
          }>
        | undefined;
      if (
        result.status === 'succeeded' &&
        this.#dependencies.entryAutomationActionRepository !== undefined
      ) {
        const workQueue = this.#dependencies.entryAutomationWorkQueueRepository;
        if (workQueue === undefined) return entryAutomationUnavailable();
        const actionResult = await executeEntryAutomationRunActions(
          {
            repository: this.#dependencies.entryAutomationActionRepository,
            workQueue,
            entries: this.#dependencies.informationEntryRepository,
            associations:
              this.#dependencies.informationEntryAssociationRepository,
            preferences: this.#dependencies.reviewPreferences,
          },
          {
            workspaceId: this.#dependencies.workspaceId,
            runId: result.runId,
            includePrivate: body.includePrivate,
          },
        );
        if (actionResult.status !== 'complete') {
          return httpResult(503, {
            status: 'failed',
            issue: Object.freeze({code: 'entry_automation_action_failed'}),
            runId: result.runId,
          });
        }
        actions = actionResult;
      }
      const execution =
        'runId' in result
          ? await repository.loadExecution(
              this.#dependencies.workspaceId,
              result.runId,
            )
          : undefined;
      return httpResult(entryAutomationExecutionStatus(result), {
        ...result,
        ...(actions === undefined ? {} : {actions}),
        ...(execution === undefined
          ? {}
          : {execution: entryAutomationExecutionResponse(execution)}),
      });
    } catch {
      return entryAutomationFailure();
    }
  }

  public async listInformationEntryAutomationExecutions(
    limitInput: unknown = 10,
  ): Promise<M1cHttpResult> {
    const repository = this.#dependencies.entryAutomationExecutionRepository;
    if (repository === undefined) return entryAutomationUnavailable();
    const limit = decodeProcessingRunLimit(limitInput);
    if (limit === undefined || limit > 20) return inputFailure('query.limit');
    try {
      const runs =
        await this.#dependencies.processingRunRepository.listRecentRuns(
          this.#dependencies.workspaceId,
          100,
        );
      const runIds = runs
        .filter(
          (run) =>
            run.origin === 'deterministic' &&
            run.currentStage === 'tags' &&
            run.currentStep?.startsWith('automation_') === true,
        )
        .slice(0, limit)
        .map((run) => run.runId);
      const loaded = await Promise.all(
        runIds.map((runId) =>
          repository.loadExecution(this.#dependencies.workspaceId, runId),
        ),
      );
      const executions = loaded.filter(
        (execution): execution is Readonly<EntryAutomationExecution> =>
          execution !== undefined,
      );
      return httpResult(200, {
        status: 'ok',
        executions: Object.freeze(
          executions.map(entryAutomationExecutionResponse),
        ),
      });
    } catch {
      return entryAutomationFailure();
    }
  }

  public async loadInformationEntryAutomationExecution(
    runId: string,
  ): Promise<M1cHttpResult> {
    const repository = this.#dependencies.entryAutomationExecutionRepository;
    if (repository === undefined) return entryAutomationUnavailable();
    if (!CANONICAL_UUID.test(runId)) return inputFailure('path.runId');
    try {
      const execution = await repository.loadExecution(
        this.#dependencies.workspaceId,
        runId,
      );
      return execution === undefined
        ? httpResult(404, {
            status: 'not_found',
            issue: Object.freeze({code: 'entry_automation_run_not_found'}),
          })
        : httpResult(200, {
            status: 'ok',
            execution: entryAutomationExecutionResponse(execution),
          });
    } catch {
      return entryAutomationFailure();
    }
  }

  public async listInformationEntryAutomationWorkQueue(
    includePrivateInput: unknown = false,
  ): Promise<M1cHttpResult> {
    const repository = this.#dependencies.entryAutomationWorkQueueRepository;
    if (repository === undefined) return entryAutomationUnavailable();
    if (typeof includePrivateInput !== 'boolean') {
      return inputFailure('query.includePrivate');
    }
    try {
      const result = await listEntryAutomationWorkQueue(
        {
          repository,
          entries: this.#dependencies.informationEntryRepository,
        },
        this.#dependencies.workspaceId,
        includePrivateInput,
      );
      return result.status === 'complete'
        ? httpResult(200, {...result, status: 'ok'})
        : inputFailure('query.includePrivate');
    } catch {
      return entryAutomationFailure();
    }
  }

  public async updateInformationEntryAutomationWorkItem(
    runId: string,
    claimOrdinalInput: string,
    body: unknown,
  ): Promise<M1cHttpResult> {
    const repository = this.#dependencies.entryAutomationWorkQueueRepository;
    if (repository === undefined) return entryAutomationUnavailable();
    const claimOrdinal = decodeNonNegativeInteger(claimOrdinalInput);
    if (
      !CANONICAL_UUID.test(runId) ||
      claimOrdinal === undefined ||
      !isRecord(body) ||
      typeof body.expectedVersion !== 'number' ||
      typeof body.state !== 'string' ||
      typeof body.includePrivate !== 'boolean'
    ) {
      return inputFailure('body');
    }
    try {
      const result = await updateEntryAutomationWorkItem(
        {
          repository,
          entries: this.#dependencies.informationEntryRepository,
        },
        {
          workspaceId: this.#dependencies.workspaceId,
          runId,
          claimOrdinal,
          expectedVersion: body.expectedVersion,
          state: body.state as 'pending' | 'completed' | 'dismissed',
          includePrivate: body.includePrivate,
        },
      );
      if (result.status === 'invalid_request') return inputFailure('body');
      if (result.status === 'not_found') {
        return httpResult(404, {
          status: 'not_found',
          issue: Object.freeze({code: 'entry_automation_work_item_not_found'}),
        });
      }
      if (result.status === 'stale') {
        return httpResult(409, {
          status: 'stale',
          issue: Object.freeze({code: 'stale_entry_automation_work_item'}),
        });
      }
      return httpResult(200, result);
    } catch {
      return entryAutomationFailure();
    }
  }

  public async executeInformationEntryAutomationWorkItemAction(
    runId: string,
    claimOrdinalInput: string,
    body: unknown,
  ): Promise<M1cHttpResult> {
    const repository = this.#dependencies.entryAutomationActionRepository;
    const workQueue = this.#dependencies.entryAutomationWorkQueueRepository;
    const claimOrdinal = decodeNonNegativeInteger(claimOrdinalInput);
    if (repository === undefined || workQueue === undefined) {
      return entryAutomationUnavailable();
    }
    if (
      !CANONICAL_UUID.test(runId) ||
      claimOrdinal === undefined ||
      !isRecord(body) ||
      typeof body.expectedVersion !== 'number' ||
      typeof body.includePrivate !== 'boolean' ||
      (body.operation !== 'apply' && body.operation !== 'undo')
    ) {
      return inputFailure('body');
    }
    try {
      const result = await executeEntryAutomationWorkItemAction(
        {
          repository,
          workQueue,
          entries: this.#dependencies.informationEntryRepository,
          associations:
            this.#dependencies.informationEntryAssociationRepository,
          preferences: this.#dependencies.reviewPreferences,
        },
        {
          workspaceId: this.#dependencies.workspaceId,
          runId,
          claimOrdinal,
          expectedVersion: body.expectedVersion,
          includePrivate: body.includePrivate,
          operation: body.operation,
        },
      );
      if (result.status === 'invalid_request') return inputFailure('body');
      if (result.status === 'not_found') {
        return httpResult(404, {
          status: 'not_found',
          issue: Object.freeze({code: 'entry_automation_work_item_not_found'}),
        });
      }
      if (result.status === 'not_enabled') {
        return httpResult(409, {
          status: 'not_enabled',
          issue: Object.freeze({code: 'entry_automation_action_not_enabled'}),
        });
      }
      if (result.status === 'stale') {
        return httpResult(409, {
          status: 'stale',
          issue: Object.freeze({code: 'stale_entry_automation_action'}),
        });
      }
      if (result.status === 'failed') return entryAutomationFailure();
      return httpResult(200, result);
    } catch {
      return entryAutomationFailure();
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

  public async loadInformationEntrySplitRuleProfile(): Promise<M1cHttpResult> {
    try {
      const preferences = await this.#dependencies.reviewPreferences.load(
        this.#dependencies.workspaceId,
      );
      return httpResult(200, {
        status: 'ok',
        profile:
          preferences.entrySplitRuleProfile ?? DEFAULT_ENTRY_SPLIT_RULE_PROFILE,
      });
    } catch {
      return entrySplitRuleFailure();
    }
  }

  public async saveInformationEntrySplitRuleProfile(
    body: unknown,
  ): Promise<M1cHttpResult> {
    if (
      !isRecord(body) ||
      !Number.isSafeInteger(body.expectedRevision) ||
      (body.expectedRevision as number) < 0
    ) {
      return inputFailure('body.expectedRevision');
    }
    const settings = decodeEntrySplitRuleSettings({
      mode: body.mode,
      minimumGroupCodePoints: body.minimumGroupCodePoints,
      maximumGroupCodePoints: body.maximumGroupCodePoints,
      maximumFragmentsPerGroup: body.maximumFragmentsPerGroup,
    });
    if (settings === undefined) return inputFailure('body');
    try {
      const update = await updateReviewPreferences<
        Readonly<{
          outcome: 'applied' | 'stale' | 'unchanged';
          profile: Readonly<EntrySplitRuleProfile>;
        }>
      >(
        this.#dependencies.reviewPreferences,
        this.#dependencies.workspaceId,
        (preferences) => {
          const current =
            preferences.entrySplitRuleProfile ??
            DEFAULT_ENTRY_SPLIT_RULE_PROFILE;
          if (current.revision !== body.expectedRevision) {
            return Object.freeze({
              next: preferences,
              result: Object.freeze({
                outcome: 'stale' as const,
                profile: current,
              }),
            });
          }
          const unchanged =
            current.mode === settings.mode &&
            current.minimumGroupCodePoints ===
              settings.minimumGroupCodePoints &&
            current.maximumGroupCodePoints ===
              settings.maximumGroupCodePoints &&
            current.maximumFragmentsPerGroup ===
              settings.maximumFragmentsPerGroup;
          const next = unchanged
            ? current
            : Object.freeze({
                revision: current.revision + 1,
                ...settings,
              });
          return Object.freeze({
            next: unchanged
              ? preferences
              : patchReviewPreferences(preferences, {
                  entrySplitRuleProfile: next,
                }),
            result: Object.freeze({
              outcome: unchanged
                ? ('unchanged' as const)
                : ('applied' as const),
              profile: next,
            }),
          });
        },
      );
      if (update.result.outcome === 'stale') {
        return httpResult(409, {
          status: 'rejected',
          issue: Object.freeze({
            code: 'stale_entry_split_rule_profile_revision',
          }),
        });
      }
      return httpResult(200, {
        status: update.result.outcome,
        profile: update.result.profile,
      });
    } catch {
      return entrySplitRuleFailure();
    }
  }

  public async trialInformationEntrySplitRule(
    body: unknown,
  ): Promise<M1cHttpResult> {
    if (
      !isRecord(body) ||
      typeof body.snapshotId !== 'string' ||
      !CANONICAL_UUID.test(body.snapshotId) ||
      typeof body.includePrivate !== 'boolean'
    ) {
      return inputFailure('body');
    }
    const profile = decodeEntrySplitRuleProfile(body.profile);
    if (profile === undefined) return inputFailure('body.profile');
    try {
      const snapshot =
        await this.#dependencies.evidenceReadRepository.loadSnapshot(
          this.#dependencies.workspaceId,
          body.snapshotId,
        );
      if (
        snapshot === undefined ||
        (snapshot.isPrivate === true && !body.includePrivate)
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
      const plan = planInformationEntrySplitRule(materialized, profile);
      if (plan === undefined) {
        return httpResult(422, {
          status: 'rejected',
          issue: Object.freeze({code: 'entry_split_rule_invalid'}),
        });
      }
      return httpResult(200, {status: 'previewed', trial: plan.trial});
    } catch {
      return repositoryFailure();
    }
  }

  public async applyInformationEntrySplitRule(
    body: unknown,
  ): Promise<M1cHttpResult> {
    if (
      !isRecord(body) ||
      typeof body.snapshotId !== 'string' ||
      !CANONICAL_UUID.test(body.snapshotId) ||
      typeof body.includePrivate !== 'boolean' ||
      !Number.isSafeInteger(body.expectedProfileRevision) ||
      (body.expectedProfileRevision as number) < 0
    ) {
      return inputFailure('body');
    }
    try {
      const workingCopy =
        await this.#dependencies.informationDocumentWorkingCopyRepository.load(
          this.#dependencies.workspaceId,
          body.snapshotId,
        );
      if (workingCopy?.state === 'editing') {
        return httpResult(409, {
          status: 'rejected',
          issue: Object.freeze({code: 'document_working_copy_pending'}),
        });
      }
      const preferences = await this.#dependencies.reviewPreferences.load(
        this.#dependencies.workspaceId,
      );
      const profile =
        preferences.entrySplitRuleProfile ?? DEFAULT_ENTRY_SPLIT_RULE_PROFILE;
      if (profile.revision !== body.expectedProfileRevision) {
        return httpResult(409, {
          status: 'rejected',
          issue: Object.freeze({
            code: 'stale_entry_split_rule_profile_revision',
          }),
        });
      }
      const snapshot =
        await this.#dependencies.evidenceReadRepository.loadSnapshot(
          this.#dependencies.workspaceId,
          body.snapshotId,
        );
      if (
        snapshot === undefined ||
        (snapshot.isPrivate === true && !body.includePrivate)
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
      const plan = planInformationEntrySplitRule(materialized, profile);
      if (plan === undefined || plan.rows.length === 0) {
        return httpResult(422, {
          status: 'rejected',
          issue: Object.freeze({code: 'entry_split_rule_invalid'}),
        });
      }
      const persisted =
        await this.#dependencies.informationEntryRepository.materializeEntriesIfSnapshotEmpty(
          plan.rows,
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
          body.includePrivate,
        );
      const entryIds = new Set(plan.rows.map((entry) => entry.entryId));
      return httpResult(persisted.outcome === 'created' ? 201 : 200, {
        status: persisted.outcome,
        snapshotId: body.snapshotId,
        profileRevision: profile.revision,
        createdCount: persisted.createdCount,
        entries: Object.freeze(
          current.filter((entry) => entryIds.has(entry.entryId)),
        ),
      });
    } catch {
      return repositoryFailure();
    }
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

  public async previewInformationEntryRestructure(
    body: unknown,
  ): Promise<M1cHttpResult> {
    const input = decodeInformationEntryRestructureBody(body, false);
    if (input === undefined) return inputFailure('body');
    try {
      const loaded = await this.#loadInformationEntryRestructure(input);
      if (loaded.kind === 'response') return loaded.response;
      return httpResult(
        200,
        informationEntryRestructurePreview(loaded.preparation),
      );
    } catch {
      return repositoryFailure();
    }
  }

  public async applyInformationEntryRestructure(
    body: unknown,
  ): Promise<M1cHttpResult> {
    const input = decodeInformationEntryRestructureBody(body, true);
    if (input === undefined) return inputFailure('body');
    const repository = this.#dependencies.informationEntryRestructureRepository;
    if (repository === undefined) return repositoryFailure();
    try {
      const loaded = await this.#loadInformationEntryRestructure(input);
      if (loaded.kind === 'response') return loaded.response;
      const preparation = loaded.preparation;
      if (input.planSha256 !== preparation.planSha256) {
        return httpResult(409, {
          status: 'rejected',
          issue: Object.freeze({code: 'stale_entry_restructure_preview'}),
        });
      }
      if (preparation.conflictingRelationshipCount > 0) {
        return httpResult(409, {
          status: 'rejected',
          issue: Object.freeze({
            code: 'entry_restructure_relationship_conflict',
          }),
        });
      }
      if (
        preparation.annotationReviewCount > 0 &&
        !input.acknowledgeAnnotationChanges
      ) {
        return httpResult(422, {
          status: 'rejected',
          issue: Object.freeze({
            code: 'entry_restructure_annotation_ack_required',
          }),
        });
      }
      if (
        (preparation.transferredRelationshipCount > 0 ||
          preparation.collapsedRelationshipCount > 0) &&
        !input.acknowledgeRelationshipChanges
      ) {
        return httpResult(422, {
          status: 'rejected',
          issue: Object.freeze({
            code: 'entry_restructure_relationship_ack_required',
          }),
        });
      }
      if (!preparation.hasChanges) {
        return httpResult(200, {
          ...informationEntryRestructurePreview(preparation),
          status: 'unchanged',
        });
      }
      const policy = await this.#loadInformationEntryAssociationPolicy();
      const visibleCurrentEntries = input.includePrivate
        ? loaded.allEntries
        : loaded.allEntries.filter((entry) => !entry.value.isPrivate);
      const resultingEntries = Object.freeze([
        ...visibleCurrentEntries.filter(
          (entry) => entry.snapshotId !== preparation.snapshotId,
        ),
        ...preparation.resultingEntries,
      ]);
      const projections = buildInformationEntryAssociationProjection(
        resultingEntries,
        policy,
      );
      const documentTags = prepareRestructuredDocumentTags(
        loaded.materialized,
        preparation.resultingEntries,
        loaded.currentDocumentTags,
      );
      const outcome = await repository.applyEntryRestructure({
        workspaceId: this.#dependencies.workspaceId,
        snapshotId: preparation.snapshotId,
        includePrivate: input.includePrivate,
        expectedEntries: preparation.expectedEntries,
        expectedOverrides: preparation.expectedOverrides,
        successors: preparation.successors,
        retiredEntryIds: preparation.retiredEntryIds,
        lineage: preparation.lineage,
        overrideTransfers: preparation.overrideTransfers,
        projections,
        ...(documentTags === undefined ? {} : {documentTags}),
      });
      if (outcome === 'stale') {
        return httpResult(409, {
          status: 'rejected',
          issue: Object.freeze({code: 'stale_entry_restructure_preview'}),
        });
      }
      const refreshed =
        await this.#dependencies.informationEntryRepository.loadCurrentEntries(
          this.#dependencies.workspaceId,
          input.includePrivate,
        );
      return httpResult(200, {
        ...informationEntryRestructurePreview(preparation),
        status: outcome,
        entries: Object.freeze(
          refreshed.filter(
            (entry) => entry.snapshotId === preparation.snapshotId,
          ),
        ),
      });
    } catch {
      return repositoryFailure();
    }
  }

  async #loadInformationEntryRestructure(
    input: Readonly<InformationEntryRestructureInput>,
  ): Promise<LoadedInformationEntryRestructure> {
    const snapshot =
      await this.#dependencies.evidenceReadRepository.loadSnapshot(
        this.#dependencies.workspaceId,
        input.snapshotId,
      );
    if (
      snapshot === undefined ||
      (snapshot.isPrivate === true && !input.includePrivate)
    ) {
      return Object.freeze({
        kind: 'response' as const,
        response: httpResult(404, {
          status: 'not_found',
          issue: Object.freeze({code: 'snapshot_not_found'}),
        }),
      });
    }
    const materialized = await materializeEvidenceSnapshot(
      snapshot,
      this.#dependencies.blobStore,
    );
    const [allEntries, associationSnapshot, documentTags] = await Promise.all([
      this.#dependencies.informationEntryRepository.loadCurrentEntries(
        this.#dependencies.workspaceId,
        true,
      ),
      this.#dependencies.informationEntryAssociationRepository.loadAssociationSnapshot(
        this.#dependencies.workspaceId,
        true,
      ),
      this.#dependencies.informationDocumentTagRepository.loadCurrentDocumentTags(
        this.#dependencies.workspaceId,
        true,
      ),
    ]);
    const snapshotEntries = allEntries.filter(
      (entry) => entry.snapshotId === input.snapshotId,
    );
    if (snapshotEntries.length === 0) {
      return Object.freeze({
        kind: 'response' as const,
        response: httpResult(409, {
          status: 'rejected',
          issue: Object.freeze({code: 'entry_structure_not_materialized'}),
        }),
      });
    }
    const snapshotEntryIds = new Set(
      snapshotEntries.map((entry) => entry.entryId),
    );
    const entryById = new Map(
      allEntries.map((entry) => [entry.entryId, entry]),
    );
    const touchesHiddenRelationship = associationSnapshot.overrides.some(
      (override) =>
        (snapshotEntryIds.has(override.entryLowId) ||
          snapshotEntryIds.has(override.entryHighId)) &&
        (entryById.get(override.entryLowId)?.value.isPrivate === true ||
          entryById.get(override.entryHighId)?.value.isPrivate === true),
    );
    if (!input.includePrivate && touchesHiddenRelationship) {
      return Object.freeze({
        kind: 'response' as const,
        response: httpResult(409, {
          status: 'rejected',
          issue: Object.freeze({
            code: 'entry_restructure_private_relationship_scope_required',
          }),
        }),
      });
    }
    const groups =
      input.groups ??
      deriveInformationEntryRestructureGroups(materialized, snapshotEntries);
    if (groups === undefined) {
      return Object.freeze({
        kind: 'response' as const,
        response: httpResult(422, {
          status: 'rejected',
          issue: Object.freeze({code: 'entry_restructure_invalid'}),
        }),
      });
    }
    const preparation = prepareInformationEntryRestructure(
      materialized,
      snapshotEntries,
      groups,
      associationSnapshot.overrides,
    );
    if (preparation === undefined) {
      return Object.freeze({
        kind: 'response' as const,
        response: httpResult(422, {
          status: 'rejected',
          issue: Object.freeze({code: 'entry_restructure_invalid'}),
        }),
      });
    }
    const currentDocumentTags = documentTags.find(
      (value) => value.snapshotId === input.snapshotId,
    );
    return Object.freeze({
      kind: 'loaded' as const,
      materialized,
      allEntries,
      preparation,
      ...(currentDocumentTags === undefined ? {} : {currentDocumentTags}),
    });
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
      const retrievalMode = request.retrievalMode ?? 'lexical';
      if (
        this.#dependencies.informationEntryRetrieval !== undefined &&
        retrievalMode !== 'lexical'
      ) {
        const result =
          await this.#dependencies.informationEntryRetrieval.search(request);
        return httpResult(200, {
          status: 'ok',
          ...result,
          privateDocuments: Object.freeze({
            totalCount: 0,
            items: Object.freeze([]),
          }),
        });
      }
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
      if (error instanceof InformationEntryRetrievalServiceError) {
        return informationEntryRetrievalFailure(error);
      }
      return repositoryFailure();
    }
  }

  public async informationEntrySearchIndexStatus(): Promise<M1cHttpResult> {
    const retrieval = this.#dependencies.informationEntryRetrieval;
    if (retrieval === undefined) return httpResult(404, {status: 'not_found'});
    try {
      return httpResult(200, {status: 'ok', index: await retrieval.status()});
    } catch {
      return repositoryFailure();
    }
  }

  public async rebuildInformationEntrySearchIndex(): Promise<M1cHttpResult> {
    const retrieval = this.#dependencies.informationEntryRetrieval;
    if (retrieval === undefined) return httpResult(404, {status: 'not_found'});
    try {
      return httpResult(200, {status: 'ok', index: await retrieval.rebuild()});
    } catch (error) {
      return error instanceof InformationEntryRetrievalServiceError
        ? informationEntryRetrievalFailure(error)
        : repositoryFailure();
    }
  }

  public async evaluateInformationEntrySearch(
    body: unknown,
  ): Promise<M1cHttpResult> {
    const retrieval = this.#dependencies.informationEntryRetrieval;
    if (retrieval === undefined) return httpResult(404, {status: 'not_found'});
    const input = decodeInformationEntrySearchEvaluation(body);
    if (input === undefined) return inputFailure('body');
    try {
      return httpResult(200, {
        status: 'ok',
        evaluation: await retrieval.evaluate(
          input.retrievalMode,
          input.k,
          input.cases,
        ),
      });
    } catch (error) {
      return error instanceof InformationEntryRetrievalServiceError
        ? informationEntryRetrievalFailure(error)
        : repositoryFailure();
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
      if (error instanceof InformationEntryRetrievalServiceError) {
        return informationEntryRetrievalFailure(error);
      }
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
          {
            semanticKind: input.semanticKind,
            verificationStatus: input.verificationStatus,
            note: input.note,
          },
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
      const update = await updateReviewPreferences<
        Readonly<{
          outcome: 'applied' | 'stale' | 'unchanged';
          policy: Readonly<ReviewAssociationPolicyPreferences>;
        }>
      >(
        this.#dependencies.reviewPreferences,
        this.#dependencies.workspaceId,
        (preferences) => {
          const current =
            preferences.associationPolicy ??
            DEFAULT_REVIEW_ASSOCIATION_POLICY_PREFERENCES;
          if (current.revision !== input.expectedRevision) {
            return Object.freeze({
              next: preferences,
              result: Object.freeze({
                outcome: 'stale' as const,
                policy: current,
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
          return Object.freeze({
            next: unchanged
              ? preferences
              : patchReviewPreferences(preferences, {
                  associationPolicy: next,
                }),
            result: Object.freeze({
              outcome: unchanged
                ? ('unchanged' as const)
                : ('applied' as const),
              policy: next,
            }),
          });
        },
      );
      if (update.result.outcome === 'stale') {
        return httpResult(409, {
          status: 'rejected',
          issue: Object.freeze({
            code: 'stale_association_policy_revision',
          }),
        });
      }
      return httpResult(200, {
        status: update.result.outcome,
        policy: informationEntryAssociationPolicyFromPreferences(
          update.result.policy,
        ),
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
      const update = await updateReviewPreferences<
        Readonly<{
          outcome: 'applied' | 'stale' | 'unchanged';
          policy: Readonly<ReviewExplorationPolicyPreferences>;
        }>
      >(
        this.#dependencies.reviewPreferences,
        this.#dependencies.workspaceId,
        (preferences) => {
          const current =
            preferences.explorationPolicy ??
            DEFAULT_REVIEW_EXPLORATION_POLICY_PREFERENCES;
          if (current.revision !== input.expectedRevision) {
            return Object.freeze({
              next: preferences,
              result: Object.freeze({
                outcome: 'stale' as const,
                policy: current,
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
          return Object.freeze({
            next: unchanged
              ? preferences
              : patchReviewPreferences(preferences, {
                  explorationPolicy: next,
                }),
            result: Object.freeze({
              outcome: unchanged
                ? ('unchanged' as const)
                : ('applied' as const),
              policy: next,
            }),
          });
        },
      );
      if (update.result.outcome === 'stale') {
        return httpResult(409, {
          status: 'rejected',
          issue: Object.freeze({
            code: 'stale_exploration_policy_revision',
          }),
        });
      }
      return httpResult(200, {
        status: update.result.outcome,
        policy: informationEntryExplorationPolicyFromPreferences(
          update.result.policy,
        ),
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
      const [snapshots, entries, currentTags, workingCopies] =
        await Promise.all([
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
          this.#dependencies.informationDocumentWorkingCopyRepository.list(
            this.#dependencies.workspaceId,
          ),
        ]);
      const workingCopyBySource = new Map(
        workingCopies.map((workingCopy) => [
          workingCopy.sourceSnapshotId,
          workingCopy,
        ]),
      );
      const sourceByDerived = new Map(
        workingCopies.flatMap((workingCopy) =>
          workingCopy.derivedSnapshotId === undefined
            ? []
            : [
                [
                  workingCopy.derivedSnapshotId,
                  workingCopy.sourceSnapshotId,
                ] as const,
              ],
        ),
      );
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
          const workingCopy = workingCopyBySource.get(snapshot.snapshotId);
          const derivedFromSnapshotId = sourceByDerived.get(
            snapshot.snapshotId,
          );
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
            ...(workingCopy === undefined ? {} : {workingCopy}),
            ...(derivedFromSnapshotId === undefined
              ? {}
              : {derivedFromSnapshotId}),
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
      return httpResult(200, {
        status: 'ok',
        ...value,
        connectors: service.connectorCapabilities?.() ?? Object.freeze([]),
      });
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

function entryPreferenceProfileFailure(): M1cHttpResult {
  return httpResult(503, {
    status: 'failed',
    issue: Object.freeze({code: 'entry_preference_profile_failed'}),
  });
}

function entrySplitRuleFailure(): M1cHttpResult {
  return httpResult(503, {
    status: 'failed',
    issue: Object.freeze({code: 'entry_split_rule_profile_failed'}),
  });
}

function entryAutomationFailure(): M1cHttpResult {
  return httpResult(503, {
    status: 'failed',
    issue: Object.freeze({code: 'entry_automation_failed'}),
  });
}

function entryAutomationUnavailable(): M1cHttpResult {
  return httpResult(503, {
    status: 'failed',
    issue: Object.freeze({code: 'entry_automation_unavailable'}),
  });
}

function entryPreferenceProfilesHaveSameValue(
  current: Readonly<EntryPreferenceProfile>,
  draft: Readonly<EntryPreferenceProfile>,
): boolean {
  if (
    current.enabled !== draft.enabled ||
    current.rules.length !== draft.rules.length
  ) {
    return false;
  }
  return current.rules.every((rule, index) => {
    const candidate = draft.rules[index];
    return (
      candidate?.ruleId === rule.ruleId &&
      rule.dimension === candidate.dimension &&
      rule.featureKind === candidate.featureKind &&
      rule.featureIdentity === candidate.featureIdentity &&
      rule.displayValue === candidate.displayValue &&
      rule.effect === candidate.effect &&
      rule.weight === candidate.weight
    );
  });
}

function entryAutomationPoliciesHaveSameValue(
  current: Readonly<EntryAutomationPolicy>,
  draft: Readonly<EntryAutomationPolicy>,
): boolean {
  const currentActions =
    current.advanceActions ??
    Object.freeze({deterministicTags: false, rebuildAssociations: false});
  const draftActions =
    draft.advanceActions ??
    Object.freeze({deterministicTags: false, rebuildAssociations: false});
  return (
    current.enabled === draft.enabled &&
    current.paused === draft.paused &&
    current.profileRevision === draft.profileRevision &&
    current.minimumMatchedRuleCount === draft.minimumMatchedRuleCount &&
    current.advanceThresholds.usefulness ===
      draft.advanceThresholds.usefulness &&
    current.advanceThresholds.interest === draft.advanceThresholds.interest &&
    current.advanceThresholds.requiredDimensions ===
      draft.advanceThresholds.requiredDimensions &&
    current.deferThresholds.usefulness === draft.deferThresholds.usefulness &&
    current.deferThresholds.interest === draft.deferThresholds.interest &&
    current.deferThresholds.requiredDimensions ===
      draft.deferThresholds.requiredDimensions &&
    current.budgets.maximumEntriesPerRun ===
      draft.budgets.maximumEntriesPerRun &&
    current.budgets.maximumAdvanceCandidatesPerRun ===
      draft.budgets.maximumAdvanceCandidatesPerRun &&
    current.budgets.maximumDeferCandidatesPerRun ===
      draft.budgets.maximumDeferCandidatesPerRun &&
    currentActions.deterministicTags === draftActions.deterministicTags &&
    currentActions.rebuildAssociations === draftActions.rebuildAssociations
  );
}

function entryAutomationExecutionStatus(
  result: Readonly<ExecuteEntryAutomationResult>,
): number {
  if (result.status === 'succeeded') return 200;
  if (result.status === 'failed') return 500;
  return 409;
}

function entryAutomationExecutionResponse(
  execution: Readonly<EntryAutomationExecution>,
) {
  return Object.freeze({
    runId: execution.runId,
    status: execution.status,
    version: execution.version,
    policyRevision: execution.policyRevision,
    profileRevision: execution.profileRevision,
    includePrivate: execution.includePrivate,
    ...(execution.errorCode === undefined
      ? {}
      : {errorCode: execution.errorCode}),
    claims: Object.freeze(
      execution.claims.map((claim) =>
        Object.freeze({
          ordinal: claim.ordinal,
          entryId: claim.entryId,
          entryRevision: claim.entryRevision,
          route: claim.route,
          reason: claim.reason,
          status: claim.status,
          ...(claim.errorCode === undefined
            ? {}
            : {errorCode: claim.errorCode}),
          createdAt: claim.createdAt,
          ...(claim.finishedAt === undefined
            ? {}
            : {finishedAt: claim.finishedAt}),
        }),
      ),
    ),
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

function decodeInformationEntryRestructureBody(
  body: unknown,
  requirePlan: boolean,
): Readonly<InformationEntryRestructureInput> | undefined {
  if (
    !isRecord(body) ||
    typeof body.snapshotId !== 'string' ||
    !CANONICAL_UUID.test(body.snapshotId) ||
    typeof (body.includePrivate ?? false) !== 'boolean' ||
    typeof (body.acknowledgeAnnotationChanges ?? false) !== 'boolean' ||
    typeof (body.acknowledgeRelationshipChanges ?? false) !== 'boolean' ||
    (body.planSha256 !== undefined &&
      (typeof body.planSha256 !== 'string' ||
        !/^[0-9a-f]{64}$/u.test(body.planSha256)))
  ) {
    return undefined;
  }
  const groups =
    body.groups === undefined
      ? undefined
      : decodeManualEntrySplitBody({
          snapshotId: body.snapshotId,
          includePrivate: body.includePrivate,
          groups: body.groups,
        })?.groups;
  if (
    (body.groups !== undefined && groups === undefined) ||
    (requirePlan &&
      (groups === undefined || typeof body.planSha256 !== 'string'))
  ) {
    return undefined;
  }
  return Object.freeze({
    snapshotId: body.snapshotId,
    includePrivate: body.includePrivate === true,
    ...(groups === undefined ? {} : {groups}),
    ...(body.planSha256 === undefined ? {} : {planSha256: body.planSha256}),
    acknowledgeAnnotationChanges: body.acknowledgeAnnotationChanges === true,
    acknowledgeRelationshipChanges:
      body.acknowledgeRelationshipChanges === true,
  });
}

function informationEntryRestructurePreview(
  preparation: Readonly<InformationEntryRestructurePreparation>,
): Readonly<Record<string, unknown>> {
  return Object.freeze({
    status: 'preview',
    snapshotId: preparation.snapshotId,
    planSha256: preparation.planSha256,
    currentGroups: preparation.currentGroups,
    hasChanges: preparation.hasChanges,
    currentEntryCount: preparation.expectedEntries.length,
    resultingEntryCount: preparation.successors.length,
    insertedEntryCount: preparation.successors.filter(
      (successor) => successor.operation === 'insert',
    ).length,
    revisedEntryCount: preparation.successors.filter(
      (successor) => successor.operation === 'revise',
    ).length,
    unchangedEntryCount: preparation.successors.filter(
      (successor) => successor.operation === 'unchanged',
    ).length,
    retiredEntryCount: preparation.retiredEntryIds.length,
    annotationReviewCount: preparation.annotationReviewCount,
    transferredRelationshipCount: preparation.transferredRelationshipCount,
    collapsedRelationshipCount: preparation.collapsedRelationshipCount,
    conflictingRelationshipCount: preparation.conflictingRelationshipCount,
    successors: Object.freeze(
      preparation.successors.map((successor) =>
        Object.freeze({
          entryId: successor.row.entryId,
          operation: successor.operation,
          titlePath: successor.row.value.titlePath,
          documentOrder: successor.row.value.documentOrder,
          predecessorEntryIds: successor.predecessorEntryIds,
          annotationStatus: successor.annotationStatus,
        }),
      ),
    ),
  });
}

function prepareRestructuredDocumentTags(
  materialized: Readonly<MaterializedEvidenceSnapshot>,
  entries: readonly Readonly<CurrentInformationEntry>[],
  current: Readonly<CurrentInformationDocumentTags> | undefined,
):
  | Readonly<{
      resourceId: string;
      expectedRevision: number;
      revisionId: string;
      value: NonNullable<
        ReturnType<typeof prepareAggregatedInformationDocumentTags>
      >;
    }>
  | undefined {
  if (current === undefined) return undefined;
  const normalizedText = materialized.structures[0]?.normalizedText;
  if (normalizedText === undefined) return undefined;
  const input = Object.freeze({
    normalizedText,
    isPrivate: materialized.isPrivate === true,
    entries,
  });
  const value =
    current.value.revisionKind === 'manual'
      ? prepareManualInformationDocumentTags(
          input,
          current.value.tags.map((tag) => tag.displayValue),
        )
      : prepareAggregatedInformationDocumentTags(input);
  if (value === undefined) return undefined;
  return Object.freeze({
    resourceId: materialized.resourceId,
    expectedRevision: current.revision,
    revisionId: deriveInformationDocumentTagRevisionId(
      materialized.snapshotId,
      current.revision + 1,
    ),
    value,
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
  const retrievalMode = body.retrievalMode ?? 'lexical';
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
    typeof retrievalMode !== 'string' ||
    !ENTRY_RETRIEVAL_MODES.includes(
      retrievalMode as (typeof ENTRY_RETRIEVAL_MODES)[number],
    ) ||
    (retrievalMode !== 'lexical' &&
      (textValue === undefined || textValue.trim() === '')) ||
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
    retrievalMode: retrievalMode as (typeof ENTRY_RETRIEVAL_MODES)[number],
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
  'retrievalMode',
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

function decodeInformationEntrySearchEvaluation(body: unknown):
  | Readonly<{
      retrievalMode: 'semantic' | 'hybrid';
      k: number;
      cases: readonly Readonly<InformationEntrySearchEvaluationCase>[];
    }>
  | undefined {
  if (
    !isRecord(body) ||
    (body.retrievalMode !== 'semantic' && body.retrievalMode !== 'hybrid') ||
    typeof body.k !== 'number' ||
    !Number.isSafeInteger(body.k) ||
    body.k < 1 ||
    body.k > 20 ||
    !Array.isArray(body.cases) ||
    body.cases.length < 1 ||
    body.cases.length > 20
  ) {
    return undefined;
  }
  const cases = body.cases.flatMap((candidate) => {
    if (!isRecord(candidate)) return [];
    const query = optionalBoundedText(candidate.query, 300);
    if (
      typeof candidate.caseId !== 'string' ||
      !/^[A-Za-z0-9._:-]{1,80}$/u.test(candidate.caseId) ||
      query === undefined ||
      query === null ||
      query.trim() === '' ||
      !Array.isArray(candidate.expectedEntryIds) ||
      candidate.expectedEntryIds.length < 1 ||
      candidate.expectedEntryIds.length > 20 ||
      !isCanonicalUuidArray(candidate.expectedEntryIds) ||
      new Set(candidate.expectedEntryIds).size !==
        candidate.expectedEntryIds.length
    ) {
      return [];
    }
    return [
      Object.freeze({
        caseId: candidate.caseId,
        query,
        expectedEntryIds: Object.freeze([...candidate.expectedEntryIds]),
      }),
    ];
  });
  if (cases.length !== body.cases.length) return undefined;
  return Object.freeze({
    retrievalMode: body.retrievalMode,
    k: body.k,
    cases: Object.freeze(cases),
  });
}

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
          semanticKind: InformationEntryGraphSemanticKind;
          verificationStatus: InformationEntryGraphVerificationStatus;
          note: string;
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
    const semanticKind = body.semanticKind ?? 'related';
    const verificationStatus = body.verificationStatus ?? 'unreviewed';
    const note = body.note ?? '';
    if (
      typeof body.label !== 'string' ||
      typeof body.direction !== 'string' ||
      !INFORMATION_ENTRY_GRAPH_DIRECTIONS.includes(
        body.direction as InformationEntryGraphDirection,
      ) ||
      typeof semanticKind !== 'string' ||
      !INFORMATION_ENTRY_GRAPH_SEMANTIC_KINDS.includes(
        semanticKind as InformationEntryGraphSemanticKind,
      ) ||
      typeof verificationStatus !== 'string' ||
      !INFORMATION_ENTRY_GRAPH_VERIFICATION_STATUSES.includes(
        verificationStatus as InformationEntryGraphVerificationStatus,
      ) ||
      typeof note !== 'string'
    ) {
      return undefined;
    }
    return Object.freeze({
      expectedRevision: body.expectedRevision,
      includePrivate,
      operation: 'edit' as const,
      label: body.label,
      direction: body.direction as InformationEntryGraphDirection,
      semanticKind: semanticKind as InformationEntryGraphSemanticKind,
      verificationStatus:
        verificationStatus as InformationEntryGraphVerificationStatus,
      note,
    });
  }
  if (
    (body.operation !== 'block' && body.operation !== 'restore') ||
    body.label !== undefined ||
    body.direction !== undefined ||
    body.semanticKind !== undefined ||
    body.verificationStatus !== undefined ||
    body.note !== undefined
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

function decodeInformationDocumentWorkingCopyWrite(
  body: unknown,
  requireText: boolean,
):
  | Readonly<{
      expectedRevision: number;
      includePrivate: boolean;
      text?: string;
    }>
  | undefined {
  if (
    !isRecord(body) ||
    typeof body.expectedRevision !== 'number' ||
    !Number.isSafeInteger(body.expectedRevision) ||
    body.expectedRevision < 0 ||
    body.expectedRevision >= 2_147_483_647 ||
    typeof (body.includePrivate ?? false) !== 'boolean' ||
    (requireText && typeof body.text !== 'string') ||
    (!requireText && body.text !== undefined)
  ) {
    return undefined;
  }
  return Object.freeze({
    expectedRevision: body.expectedRevision,
    includePrivate: (body.includePrivate ?? false) as boolean,
    ...(typeof body.text === 'string' ? {text: body.text} : {}),
  });
}

function informationDocumentText(
  snapshot: Readonly<MaterializedEvidenceSnapshot>,
): string {
  if (snapshot.structures.length !== 1) {
    throw new Error('Editable document requires one materialized structure.');
  }
  const structure = snapshot.structures[0];
  if (structure === undefined) {
    throw new Error('Editable document structure is unavailable.');
  }
  const normalizedText = structure.normalizedText;
  if (typeof normalizedText !== 'string') {
    throw new Error('Editable document text is unavailable.');
  }
  return normalizedText;
}

function workingCopyWriteFailure(outcome: string): M1cHttpResult {
  const code =
    outcome === 'stale'
      ? 'stale_information_document_working_copy'
      : outcome === 'committed'
        ? 'information_document_working_copy_committed'
        : outcome === 'source_materialized'
          ? 'split_structure_already_materialized'
          : 'information_document_working_copy_not_found';
  return httpResult(outcome === 'not_found' ? 404 : 409, {
    status: outcome === 'not_found' ? 'not_found' : 'rejected',
    issue: Object.freeze({code}),
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

function decodeNonNegativeInteger(value: unknown): number | undefined {
  const candidate =
    typeof value === 'string' && /^(?:0|[1-9][0-9]*)$/u.test(value)
      ? Number(value)
      : value;
  return typeof candidate === 'number' &&
    Number.isSafeInteger(candidate) &&
    candidate >= 0
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
  const githubKeys = [
    'enabled',
    'intervalMinutes',
    'isPrivate',
    'kind',
    'label',
    'profile',
    'repositoryPath',
    'repositoryRef',
    'repositoryUri',
    'routeAfterImport',
    'sourceAlias',
    'subscriptionId',
  ];
  const legacyGithubKeys = githubKeys.filter((key) => key !== 'kind');
  const rssKeys = [
    'enabled',
    'feedUrl',
    'intervalMinutes',
    'isPrivate',
    'itemLimit',
    'kind',
    'label',
    'routeAfterImport',
    'sourceAlias',
    'subscriptionId',
  ];
  const jsonRequiredKeys = [
    'authentication',
    'bodyPath',
    'enabled',
    'endpointUrl',
    'externalIdPath',
    'intervalMinutes',
    'isPrivate',
    'kind',
    'label',
    'recordLimit',
    'recordsPath',
    'routeAfterImport',
    'sourceAlias',
    'subscriptionId',
    'titlePath',
  ];
  const jsonAllowedKeys = [
    ...jsonRequiredKeys,
    'canonicalUriPath',
    'incrementalCursor',
    'pageCursor',
    'publishedAtPath',
    'versionPath',
  ];
  const webKeys = [
    'additionalPaths',
    'enabled',
    'intervalMinutes',
    'isPrivate',
    'kind',
    'label',
    'pageUrl',
    'routeAfterImport',
    'sourceAlias',
    'subscriptionId',
  ];
  const pluginKeys = [
    'configurationRef',
    'connectorId',
    'enabled',
    'intervalMinutes',
    'isPrivate',
    'kind',
    'label',
    'routeAfterImport',
    'sourceAlias',
    'subscriptionId',
  ];
  if (
    body.subscriptions.some((subscription) => {
      if (!isRecord(subscription)) return true;
      const keys = Object.keys(subscription).sort().join('\\u0000');
      if (subscription.kind === 'rss_atom') {
        return keys !== rssKeys.join('\\u0000');
      }
      if (subscription.kind === 'json_api') {
        const ownKeys = Object.keys(subscription);
        return (
          jsonRequiredKeys.some((key) => !Object.hasOwn(subscription, key)) ||
          ownKeys.some((key) => !jsonAllowedKeys.includes(key))
        );
      }
      if (subscription.kind === 'web') {
        return keys !== webKeys.join('\\u0000');
      }
      if (subscription.kind === 'plugin') {
        return keys !== pluginKeys.join('\\u0000');
      }
      return (
        keys !== githubKeys.join('\\u0000') &&
        keys !== legacyGithubKeys.join('\\u0000')
      );
    })
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
        subscription.kind === 'rss_atom'
          ? Object.freeze({
              kind: subscription.kind,
              subscriptionId: subscription.subscriptionId,
              label: subscription.label,
              enabled: subscription.enabled,
              feedUrl: subscription.feedUrl,
              itemLimit: subscription.itemLimit,
              sourceAlias: subscription.sourceAlias,
              isPrivate: subscription.isPrivate,
              routeAfterImport: subscription.routeAfterImport,
              intervalMinutes: subscription.intervalMinutes,
            })
          : subscription.kind === 'json_api'
            ? Object.freeze({
                kind: subscription.kind,
                subscriptionId: subscription.subscriptionId,
                label: subscription.label,
                enabled: subscription.enabled,
                endpointUrl: subscription.endpointUrl,
                recordsPath: subscription.recordsPath,
                externalIdPath: subscription.externalIdPath,
                titlePath: subscription.titlePath,
                bodyPath: subscription.bodyPath,
                ...(subscription.canonicalUriPath === undefined
                  ? {}
                  : {canonicalUriPath: subscription.canonicalUriPath}),
                ...(subscription.publishedAtPath === undefined
                  ? {}
                  : {publishedAtPath: subscription.publishedAtPath}),
                ...(subscription.versionPath === undefined
                  ? {}
                  : {versionPath: subscription.versionPath}),
                recordLimit: subscription.recordLimit,
                ...(subscription.pageCursor === undefined
                  ? {}
                  : {
                      pageCursor: Object.freeze({
                        ...subscription.pageCursor,
                      }),
                    }),
                ...(subscription.incrementalCursor === undefined
                  ? {}
                  : {
                      incrementalCursor: Object.freeze({
                        ...subscription.incrementalCursor,
                      }),
                    }),
                authentication: Object.freeze({
                  ...subscription.authentication,
                }),
                sourceAlias: subscription.sourceAlias,
                isPrivate: subscription.isPrivate,
                routeAfterImport: subscription.routeAfterImport,
                intervalMinutes: subscription.intervalMinutes,
              })
            : subscription.kind === 'web'
              ? Object.freeze({
                  kind: subscription.kind,
                  subscriptionId: subscription.subscriptionId,
                  label: subscription.label,
                  enabled: subscription.enabled,
                  pageUrl: subscription.pageUrl,
                  additionalPaths: Object.freeze([
                    ...subscription.additionalPaths,
                  ]),
                  sourceAlias: subscription.sourceAlias,
                  isPrivate: subscription.isPrivate,
                  routeAfterImport: subscription.routeAfterImport,
                  intervalMinutes: subscription.intervalMinutes,
                })
              : subscription.kind === 'plugin'
                ? Object.freeze({
                    kind: subscription.kind,
                    subscriptionId: subscription.subscriptionId,
                    label: subscription.label,
                    enabled: subscription.enabled,
                    connectorId: subscription.connectorId,
                    configurationRef: subscription.configurationRef,
                    sourceAlias: subscription.sourceAlias,
                    isPrivate: subscription.isPrivate,
                    routeAfterImport: subscription.routeAfterImport,
                    intervalMinutes: subscription.intervalMinutes,
                  })
                : Object.freeze({
                    kind: 'github_markdown' as const,
                    subscriptionId: subscription.subscriptionId,
                    label: subscription.label,
                    enabled: subscription.enabled,
                    repositoryUri: subscription.repositoryUri,
                    repositoryRef: subscription.repositoryRef,
                    repositoryPath: subscription.repositoryPath,
                    profile: subscription.profile,
                    sourceAlias: subscription.sourceAlias,
                    isPrivate: subscription.isPrivate,
                    routeAfterImport: subscription.routeAfterImport,
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

function informationEntryRetrievalFailure(
  error: InformationEntryRetrievalServiceError,
): M1cHttpResult {
  if (
    error.code === 'semantic_search_private_scope_forbidden' ||
    error.code === 'semantic_search_text_required'
  ) {
    return httpResult(422, {
      status: 'rejected',
      issue: Object.freeze({code: error.code}),
    });
  }
  if (
    error.code === 'semantic_search_not_configured' ||
    error.code === 'semantic_search_index_not_ready'
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

function isCanonicalUuidArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.every(
      (entryId: unknown) =>
        typeof entryId === 'string' && CANONICAL_UUID.test(entryId),
    )
  );
}
