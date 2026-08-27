import type {
  AiAssociationProposalDecisionResponse,
  AiAssociationProposalListResponse,
  AiAssociationProposalStartResponse,
  AiSplitProposalDecisionResponse,
  AiSplitProposalListResponse,
  AiSplitProposalStartResponse,
  AiTagProposalDecisionResponse,
  AiTagProposalListResponse,
  AiTagProposalStartResponse,
  EvidenceSnapshot,
  EvidenceSnapshotSummary,
  EntryPreferenceProfile,
  EntryPreferenceRule,
  EntrySplitRuleApplyResponse,
  EntrySplitRuleProfileResponse,
  EntrySplitRuleProfileWriteResponse,
  EntrySplitRuleTrialResponse,
  EntryAutomationPolicy,
  EntryAutomationWorkItemState,
  InformationEntryAutomationActionWriteResponse,
  InformationEntryAutomationExecuteResponse,
  InformationEntryAutomationExecutionListResponse,
  InformationEntryAutomationExecutionResponse,
  InformationEntryAutomationPolicyResponse,
  InformationEntryAutomationPolicyWriteResponse,
  InformationEntryAutomationTrialResponse,
  InformationEntryAutomationWorkItemWriteResponse,
  InformationEntryAutomationWorkQueueResponse,
  InformationEntryAssociationListResponse,
  InformationEntryAssociationOverrideResponse,
  InformationEntryAssociationPolicyWriteResponse,
  InformationEntryExplorationPolicyWriteResponse,
  InformationEntryExplorationResponse,
  InformationEntrySearchIndexResponse,
  InformationEntrySearchEvaluationResponse,
  InformationEntryAssociationRebuildResponse,
  InformationEntryDocumentListResponse,
  InformationEntryKnowledgeGraphEdgeWriteResponse,
  InformationEntryKnowledgeGraphResponse,
  InformationEntryMaterializeResponse,
  InformationEntryRevisionResponse,
  InformationEntryRestructureApplyResponse,
  InformationEntryRestructurePreviewResponse,
  InformationEntrySearchResponse,
  InformationEntryQuerySynthesisResponse,
  InformationEntryPreferenceProfileResponse,
  InformationEntryPreferenceProfileWriteResponse,
  InformationEntryPreferenceSuggestionResponse,
  InformationEntryPreferenceTrialResponse,
  InformationDocumentTagWriteResponse,
  InformationDocumentWorkingCopyCommitResponse,
  InformationDocumentWorkingCopyResponse,
  M1cHttpResponse,
  DocumentImportResponse,
  MarkdownImportResponse,
  ProcessingRunCancelResponse,
  ProcessingRunListResponse,
  ReviewPreferencesWrite,
  ReviewPreferencesResponse,
  SourceSubscriptionListResponse,
  SourceSubscriptionReplaceResponse,
  SourceSubscriptionRunResponse,
  SourceSubscriptionWrite,
  WorkspaceResponse,
  WorkspaceBundleTransferResponse,
} from './m1c_api_contract.js';

export interface M1cApiRequestOptions {
  readonly signal?: AbortSignal;
  readonly includePrivate?: boolean;
}

export type M1cApiFetch = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

export interface M1cApiClient {
  workspace(
    options?: M1cApiRequestOptions,
  ): Promise<M1cHttpResponse<WorkspaceResponse>>;
  listEvidence(
    options?: M1cApiRequestOptions,
  ): Promise<
    M1cHttpResponse<
      Readonly<{status: 'ok'; snapshots: readonly EvidenceSnapshotSummary[]}>
    >
  >;
  loadEvidenceSnapshot(
    snapshotId: string,
    options?: M1cApiRequestOptions,
  ): Promise<
    M1cHttpResponse<
      | Readonly<{status: 'ok'; snapshot: Readonly<EvidenceSnapshot>}>
      | Readonly<{status: 'not_found'}>
      | Readonly<{status: 'rejected'; issue: Readonly<{code: string}>}>
    >
  >;
  loadInformationDocumentWorkingCopy(
    snapshotId: string,
    options?: M1cApiRequestOptions,
  ): Promise<M1cHttpResponse<InformationDocumentWorkingCopyResponse>>;
  saveInformationDocumentWorkingCopy(
    snapshotId: string,
    body: Readonly<{
      expectedRevision: number;
      includePrivate: boolean;
      text: string;
    }>,
    options?: M1cApiRequestOptions,
  ): Promise<M1cHttpResponse<InformationDocumentWorkingCopyResponse>>;
  restoreInformationDocumentWorkingCopy(
    snapshotId: string,
    body: Readonly<{expectedRevision: number; includePrivate: boolean}>,
    options?: M1cApiRequestOptions,
  ): Promise<M1cHttpResponse<InformationDocumentWorkingCopyResponse>>;
  commitInformationDocumentWorkingCopy(
    snapshotId: string,
    body: Readonly<{expectedRevision: number; includePrivate: boolean}>,
    options?: M1cApiRequestOptions,
  ): Promise<M1cHttpResponse<InformationDocumentWorkingCopyCommitResponse>>;
  loadReviewPreferences(
    options?: M1cApiRequestOptions,
  ): Promise<M1cHttpResponse<ReviewPreferencesResponse>>;
  saveReviewPreferences(
    preferences: Readonly<ReviewPreferencesWrite>,
    options?: M1cApiRequestOptions,
  ): Promise<M1cHttpResponse<ReviewPreferencesResponse>>;
  loadInformationEntryPreferenceProfile(
    options?: M1cApiRequestOptions,
  ): Promise<M1cHttpResponse<InformationEntryPreferenceProfileResponse>>;
  saveInformationEntryPreferenceProfile(
    body: Readonly<{
      expectedRevision: number;
      enabled: boolean;
      rules: readonly Readonly<EntryPreferenceRule>[];
    }>,
    options?: M1cApiRequestOptions,
  ): Promise<M1cHttpResponse<InformationEntryPreferenceProfileWriteResponse>>;
  suggestInformationEntryPreferenceProfile(
    includePrivate: boolean,
    options?: M1cApiRequestOptions,
  ): Promise<M1cHttpResponse<InformationEntryPreferenceSuggestionResponse>>;
  trialInformationEntryPreferenceProfile(
    body: Readonly<{
      includePrivate: boolean;
      expectedProfileRevision: number;
      profile: Readonly<EntryPreferenceProfile>;
      expectedEntries?: readonly Readonly<{
        entryId: string;
        revision: number;
      }>[];
    }>,
    options?: M1cApiRequestOptions,
  ): Promise<M1cHttpResponse<InformationEntryPreferenceTrialResponse>>;
  loadInformationEntryAutomationPolicy(
    options?: M1cApiRequestOptions,
  ): Promise<M1cHttpResponse<InformationEntryAutomationPolicyResponse>>;
  saveInformationEntryAutomationPolicy(
    body: Readonly<{
      expectedRevision: number;
      enabled: boolean;
      paused: boolean;
      profileRevision: number;
      minimumMatchedRuleCount: number;
      advanceThresholds: Readonly<EntryAutomationPolicy['advanceThresholds']>;
      deferThresholds: Readonly<EntryAutomationPolicy['deferThresholds']>;
      budgets: Readonly<EntryAutomationPolicy['budgets']>;
      advanceActions?: Readonly<
        NonNullable<EntryAutomationPolicy['advanceActions']>
      >;
      failureMode: 'pause';
    }>,
    options?: M1cApiRequestOptions,
  ): Promise<M1cHttpResponse<InformationEntryAutomationPolicyWriteResponse>>;
  trialInformationEntryAutomationPolicy(
    body: Readonly<{
      includePrivate: boolean;
      expectedPolicyRevision: number;
      expectedProfileRevision: number;
      policy: Readonly<EntryAutomationPolicy>;
      expectedEntries?: readonly Readonly<{
        entryId: string;
        revision: number;
      }>[];
      manualTakeoverEntryIds?: readonly string[];
    }>,
    options?: M1cApiRequestOptions,
  ): Promise<M1cHttpResponse<InformationEntryAutomationTrialResponse>>;
  executeInformationEntryAutomation(
    body: Readonly<{
      idempotencyKey: string;
      includePrivate: boolean;
      expectedPolicyRevision: number;
      expectedProfileRevision: number;
      expectedEntries: readonly Readonly<{
        entryId: string;
        revision: number;
      }>[];
      manualTakeoverEntryIds?: readonly string[];
    }>,
    options?: M1cApiRequestOptions,
  ): Promise<M1cHttpResponse<InformationEntryAutomationExecuteResponse>>;
  listInformationEntryAutomationExecutions(
    limit?: number,
    options?: M1cApiRequestOptions,
  ): Promise<M1cHttpResponse<InformationEntryAutomationExecutionListResponse>>;
  loadInformationEntryAutomationExecution(
    runId: string,
    options?: M1cApiRequestOptions,
  ): Promise<M1cHttpResponse<InformationEntryAutomationExecutionResponse>>;
  listInformationEntryAutomationWorkQueue(
    includePrivate: boolean,
    options?: M1cApiRequestOptions,
  ): Promise<M1cHttpResponse<InformationEntryAutomationWorkQueueResponse>>;
  updateInformationEntryAutomationWorkItem(
    runId: string,
    claimOrdinal: number,
    body: Readonly<{
      expectedVersion: number;
      state: EntryAutomationWorkItemState;
      includePrivate: boolean;
    }>,
    options?: M1cApiRequestOptions,
  ): Promise<M1cHttpResponse<InformationEntryAutomationWorkItemWriteResponse>>;
  executeInformationEntryAutomationWorkItemAction(
    runId: string,
    claimOrdinal: number,
    body: Readonly<{
      expectedVersion: number;
      operation: 'apply' | 'undo';
      includePrivate: boolean;
    }>,
    options?: M1cApiRequestOptions,
  ): Promise<M1cHttpResponse<InformationEntryAutomationActionWriteResponse>>;
  importMarkdown(
    body: unknown,
    options?: M1cApiRequestOptions,
  ): Promise<M1cHttpResponse<MarkdownImportResponse>>;
  importDocument(
    body: unknown,
    options?: M1cApiRequestOptions,
  ): Promise<M1cHttpResponse<DocumentImportResponse>>;
  materializeInformationEntries(
    body: unknown,
    options?: M1cApiRequestOptions,
  ): Promise<M1cHttpResponse<InformationEntryMaterializeResponse>>;
  materializeManualInformationEntries(
    body: unknown,
    options?: M1cApiRequestOptions,
  ): Promise<M1cHttpResponse<InformationEntryMaterializeResponse>>;
  loadInformationEntrySplitRuleProfile(
    options?: M1cApiRequestOptions,
  ): Promise<M1cHttpResponse<EntrySplitRuleProfileResponse>>;
  saveInformationEntrySplitRuleProfile(
    body: unknown,
    options?: M1cApiRequestOptions,
  ): Promise<M1cHttpResponse<EntrySplitRuleProfileWriteResponse>>;
  trialInformationEntrySplitRule(
    body: unknown,
    options?: M1cApiRequestOptions,
  ): Promise<M1cHttpResponse<EntrySplitRuleTrialResponse>>;
  applyInformationEntrySplitRule(
    body: unknown,
    options?: M1cApiRequestOptions,
  ): Promise<M1cHttpResponse<EntrySplitRuleApplyResponse>>;
  previewInformationEntryRestructure(
    body: unknown,
    options?: M1cApiRequestOptions,
  ): Promise<M1cHttpResponse<InformationEntryRestructurePreviewResponse>>;
  applyInformationEntryRestructure(
    body: unknown,
    options?: M1cApiRequestOptions,
  ): Promise<M1cHttpResponse<InformationEntryRestructureApplyResponse>>;
  reviseInformationEntry(
    entryId: string,
    body: unknown,
    options?: M1cApiRequestOptions,
  ): Promise<M1cHttpResponse<InformationEntryRevisionResponse>>;
  searchInformationEntries(
    body: unknown,
    options?: M1cApiRequestOptions,
  ): Promise<M1cHttpResponse<InformationEntrySearchResponse>>;
  loadInformationEntrySearchIndex(
    options?: M1cApiRequestOptions,
  ): Promise<M1cHttpResponse<InformationEntrySearchIndexResponse>>;
  rebuildInformationEntrySearchIndex(
    options?: M1cApiRequestOptions,
  ): Promise<M1cHttpResponse<InformationEntrySearchIndexResponse>>;
  evaluateInformationEntrySearch(
    body: unknown,
    options?: M1cApiRequestOptions,
  ): Promise<M1cHttpResponse<InformationEntrySearchEvaluationResponse>>;
  exploreInformationEntries(
    body: unknown,
    options?: M1cApiRequestOptions,
  ): Promise<M1cHttpResponse<InformationEntryExplorationResponse>>;
  synthesizeInformationEntryQuery(
    body: unknown,
    options?: M1cApiRequestOptions,
  ): Promise<M1cHttpResponse<InformationEntryQuerySynthesisResponse>>;
  readInformationEntryKnowledgeGraph(
    body: unknown,
    options?: M1cApiRequestOptions,
  ): Promise<M1cHttpResponse<InformationEntryKnowledgeGraphResponse>>;
  reviseInformationEntryKnowledgeGraphEdge(
    entryId: string,
    relatedEntryId: string,
    body: unknown,
    options?: M1cApiRequestOptions,
  ): Promise<M1cHttpResponse<InformationEntryKnowledgeGraphEdgeWriteResponse>>;
  rebuildInformationEntryAssociations(
    body: unknown,
    options?: M1cApiRequestOptions,
  ): Promise<M1cHttpResponse<InformationEntryAssociationRebuildResponse>>;
  reviseInformationEntryAssociationPolicy(
    body: unknown,
    options?: M1cApiRequestOptions,
  ): Promise<M1cHttpResponse<InformationEntryAssociationPolicyWriteResponse>>;
  reviseInformationEntryExplorationPolicy(
    body: unknown,
    options?: M1cApiRequestOptions,
  ): Promise<M1cHttpResponse<InformationEntryExplorationPolicyWriteResponse>>;
  listInformationEntryAssociations(
    entryId: string,
    options?: M1cApiRequestOptions,
  ): Promise<M1cHttpResponse<InformationEntryAssociationListResponse>>;
  reviseInformationEntryAssociation(
    entryId: string,
    relatedEntryId: string,
    body: unknown,
    options?: M1cApiRequestOptions,
  ): Promise<M1cHttpResponse<InformationEntryAssociationOverrideResponse>>;
  listInformationEntryDocuments(
    options?: M1cApiRequestOptions,
  ): Promise<M1cHttpResponse<InformationEntryDocumentListResponse>>;
  aggregateInformationDocumentTags(
    snapshotId: string,
    body: unknown,
    options?: M1cApiRequestOptions,
  ): Promise<M1cHttpResponse<InformationDocumentTagWriteResponse>>;
  reviseInformationDocumentTags(
    snapshotId: string,
    body: unknown,
    options?: M1cApiRequestOptions,
  ): Promise<M1cHttpResponse<InformationDocumentTagWriteResponse>>;
  listAiSplitProposals(
    snapshotId: string,
    options?: M1cApiRequestOptions,
  ): Promise<M1cHttpResponse<AiSplitProposalListResponse>>;
  startAiSplitProposal(
    snapshotId: string,
    requestKey: string,
    options?: M1cApiRequestOptions,
  ): Promise<M1cHttpResponse<AiSplitProposalStartResponse>>;
  acceptAiSplitProposal(
    snapshotId: string,
    proposalId: string,
    options?: M1cApiRequestOptions,
  ): Promise<M1cHttpResponse<AiSplitProposalDecisionResponse>>;
  rejectAiSplitProposal(
    snapshotId: string,
    proposalId: string,
    options?: M1cApiRequestOptions,
  ): Promise<M1cHttpResponse<AiSplitProposalDecisionResponse>>;
  listAiTagProposals(
    entryId: string,
    options?: M1cApiRequestOptions,
  ): Promise<M1cHttpResponse<AiTagProposalListResponse>>;
  startAiTagProposal(
    entryId: string,
    requestKey: string,
    options?: M1cApiRequestOptions,
  ): Promise<M1cHttpResponse<AiTagProposalStartResponse>>;
  acceptAiTagProposal(
    entryId: string,
    proposalId: string,
    options?: M1cApiRequestOptions,
  ): Promise<M1cHttpResponse<AiTagProposalDecisionResponse>>;
  rejectAiTagProposal(
    entryId: string,
    proposalId: string,
    options?: M1cApiRequestOptions,
  ): Promise<M1cHttpResponse<AiTagProposalDecisionResponse>>;
  listAiAssociationProposals(
    entryId: string,
    relatedEntryId: string,
    options?: M1cApiRequestOptions,
  ): Promise<M1cHttpResponse<AiAssociationProposalListResponse>>;
  startAiAssociationProposal(
    entryId: string,
    relatedEntryId: string,
    requestKey: string,
    options?: M1cApiRequestOptions,
  ): Promise<M1cHttpResponse<AiAssociationProposalStartResponse>>;
  acceptAiAssociationProposal(
    entryId: string,
    relatedEntryId: string,
    proposalId: string,
    options?: M1cApiRequestOptions,
  ): Promise<M1cHttpResponse<AiAssociationProposalDecisionResponse>>;
  rejectAiAssociationProposal(
    entryId: string,
    relatedEntryId: string,
    proposalId: string,
    options?: M1cApiRequestOptions,
  ): Promise<M1cHttpResponse<AiAssociationProposalDecisionResponse>>;
  listProcessingRuns(
    limit?: number,
    options?: M1cApiRequestOptions,
  ): Promise<M1cHttpResponse<ProcessingRunListResponse>>;
  cancelProcessingRun(
    runId: string,
    expectedVersion: number,
    options?: M1cApiRequestOptions,
  ): Promise<M1cHttpResponse<ProcessingRunCancelResponse>>;
  listSourceSubscriptions(
    options?: M1cApiRequestOptions,
  ): Promise<M1cHttpResponse<SourceSubscriptionListResponse>>;
  replaceSourceSubscriptions(
    expectedRevision: number,
    subscriptions: readonly Readonly<SourceSubscriptionWrite>[],
    options?: M1cApiRequestOptions,
  ): Promise<M1cHttpResponse<SourceSubscriptionReplaceResponse>>;
  runSourceSubscription(
    subscriptionId: string,
    requestKey: string,
    options?: M1cApiRequestOptions,
  ): Promise<M1cHttpResponse<SourceSubscriptionRunResponse>>;
  exportWorkspaceBundle(
    options?: M1cApiRequestOptions,
  ): Promise<M1cHttpResponse<WorkspaceBundleTransferResponse>>;
  restoreWorkspaceBundle(
    fileName: string,
    options?: M1cApiRequestOptions,
  ): Promise<M1cHttpResponse<WorkspaceBundleTransferResponse>>;
}

export class M1cApiClientError extends Error {
  public constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'M1cApiClientError';
  }
}

export function createUnavailableM1cApiClient(cause: unknown): M1cApiClient {
  const reject = () =>
    Promise.reject(
      new M1cApiClientError('产品接口运行配置无效，未发起任何请求。', {
        cause,
      }),
    );
  const client: M1cApiClient = Object.freeze({
    workspace: reject,
    listEvidence: reject,
    loadEvidenceSnapshot: reject,
    loadInformationDocumentWorkingCopy: reject,
    saveInformationDocumentWorkingCopy: reject,
    restoreInformationDocumentWorkingCopy: reject,
    commitInformationDocumentWorkingCopy: reject,
    loadReviewPreferences: reject,
    saveReviewPreferences: reject,
    loadInformationEntryPreferenceProfile: reject,
    saveInformationEntryPreferenceProfile: reject,
    suggestInformationEntryPreferenceProfile: reject,
    trialInformationEntryPreferenceProfile: reject,
    loadInformationEntryAutomationPolicy: reject,
    saveInformationEntryAutomationPolicy: reject,
    trialInformationEntryAutomationPolicy: reject,
    executeInformationEntryAutomation: reject,
    listInformationEntryAutomationExecutions: reject,
    loadInformationEntryAutomationExecution: reject,
    listInformationEntryAutomationWorkQueue: reject,
    updateInformationEntryAutomationWorkItem: reject,
    executeInformationEntryAutomationWorkItemAction: reject,
    importMarkdown: reject,
    importDocument: reject,
    materializeInformationEntries: reject,
    materializeManualInformationEntries: reject,
    loadInformationEntrySplitRuleProfile: reject,
    saveInformationEntrySplitRuleProfile: reject,
    trialInformationEntrySplitRule: reject,
    applyInformationEntrySplitRule: reject,
    previewInformationEntryRestructure: reject,
    applyInformationEntryRestructure: reject,
    reviseInformationEntry: reject,
    searchInformationEntries: reject,
    loadInformationEntrySearchIndex: reject,
    rebuildInformationEntrySearchIndex: reject,
    evaluateInformationEntrySearch: reject,
    exploreInformationEntries: reject,
    synthesizeInformationEntryQuery: reject,
    readInformationEntryKnowledgeGraph: reject,
    reviseInformationEntryKnowledgeGraphEdge: reject,
    rebuildInformationEntryAssociations: reject,
    reviseInformationEntryAssociationPolicy: reject,
    reviseInformationEntryExplorationPolicy: reject,
    listInformationEntryAssociations: reject,
    reviseInformationEntryAssociation: reject,
    listInformationEntryDocuments: reject,
    aggregateInformationDocumentTags: reject,
    reviseInformationDocumentTags: reject,
    listAiSplitProposals: reject,
    startAiSplitProposal: reject,
    acceptAiSplitProposal: reject,
    rejectAiSplitProposal: reject,
    listAiTagProposals: reject,
    startAiTagProposal: reject,
    acceptAiTagProposal: reject,
    rejectAiTagProposal: reject,
    listAiAssociationProposals: reject,
    startAiAssociationProposal: reject,
    acceptAiAssociationProposal: reject,
    rejectAiAssociationProposal: reject,
    listProcessingRuns: reject,
    cancelProcessingRun: reject,
    listSourceSubscriptions: reject,
    replaceSourceSubscriptions: reject,
    runSourceSubscription: reject,
    exportWorkspaceBundle: reject,
    restoreWorkspaceBundle: reject,
  });
  return client;
}

export function createM1cApiClient(
  apiBaseUrl: string,
  fetchImplementation: M1cApiFetch = globalThis.fetch,
): M1cApiClient {
  const root = normalizeBaseUrl(apiBaseUrl);
  const get = <T>(path: string, options?: M1cApiRequestOptions) =>
    request<T>(
      fetchImplementation,
      new URL(path, root),
      'GET',
      undefined,
      options,
    );
  const post = <T>(
    path: string,
    body: unknown,
    options?: M1cApiRequestOptions,
  ) =>
    request<T>(fetchImplementation, new URL(path, root), 'POST', body, options);
  const put = <T>(
    path: string,
    body: unknown,
    options?: M1cApiRequestOptions,
  ) =>
    request<T>(fetchImplementation, new URL(path, root), 'PUT', body, options);

  const client: M1cApiClient = {
    workspace: (options) => get<WorkspaceResponse>('api/v1/workspace', options),
    listEvidence: (options) =>
      get<
        Readonly<{status: 'ok'; snapshots: readonly EvidenceSnapshotSummary[]}>
      >('api/v1/evidence', options),
    loadEvidenceSnapshot: (snapshotId, options) =>
      get<
        | Readonly<{status: 'ok'; snapshot: Readonly<EvidenceSnapshot>}>
        | Readonly<{status: 'not_found'}>
        | Readonly<{status: 'rejected'; issue: Readonly<{code: string}>}>
      >(
        `api/v1/evidence/snapshots/${encodeURIComponent(snapshotId)}${options?.includePrivate === true ? '?includePrivate=true' : ''}`,
        options,
      ),
    loadInformationDocumentWorkingCopy: (snapshotId, options) =>
      get<InformationDocumentWorkingCopyResponse>(
        `api/v1/evidence/snapshots/${encodeURIComponent(snapshotId)}/working-copy${privateOnlyQuery(options?.includePrivate === true)}`,
        options,
      ),
    saveInformationDocumentWorkingCopy: (snapshotId, body, options) =>
      put<InformationDocumentWorkingCopyResponse>(
        `api/v1/evidence/snapshots/${encodeURIComponent(snapshotId)}/working-copy`,
        body,
        options,
      ),
    restoreInformationDocumentWorkingCopy: (snapshotId, body, options) =>
      post<InformationDocumentWorkingCopyResponse>(
        `api/v1/evidence/snapshots/${encodeURIComponent(snapshotId)}/working-copy/restore`,
        body,
        options,
      ),
    commitInformationDocumentWorkingCopy: (snapshotId, body, options) =>
      post<InformationDocumentWorkingCopyCommitResponse>(
        `api/v1/evidence/snapshots/${encodeURIComponent(snapshotId)}/working-copy/commit`,
        body,
        options,
      ),
    loadReviewPreferences: async (options) =>
      decodeReviewPreferencesResponse(
        await get<unknown>('api/v1/preferences/review', options),
      ),
    saveReviewPreferences: async (preferences, options) =>
      decodeReviewPreferencesResponse(
        await put<unknown>('api/v1/preferences/review', preferences, options),
      ),
    loadInformationEntryPreferenceProfile: (options) =>
      get<InformationEntryPreferenceProfileResponse>(
        'api/v1/entries/preferences/profile',
        options,
      ),
    saveInformationEntryPreferenceProfile: (body, options) =>
      put<InformationEntryPreferenceProfileWriteResponse>(
        'api/v1/entries/preferences/profile',
        body,
        options,
      ),
    suggestInformationEntryPreferenceProfile: (includePrivate, options) =>
      post<InformationEntryPreferenceSuggestionResponse>(
        'api/v1/entries/preferences/profile/suggestions',
        {includePrivate},
        options,
      ),
    trialInformationEntryPreferenceProfile: (body, options) =>
      post<InformationEntryPreferenceTrialResponse>(
        'api/v1/entries/preferences/profile/trial',
        body,
        options,
      ),
    loadInformationEntryAutomationPolicy: (options) =>
      get<InformationEntryAutomationPolicyResponse>(
        'api/v1/entries/automation/policy',
        options,
      ),
    saveInformationEntryAutomationPolicy: (body, options) =>
      put<InformationEntryAutomationPolicyWriteResponse>(
        'api/v1/entries/automation/policy',
        body,
        options,
      ),
    trialInformationEntryAutomationPolicy: (body, options) =>
      post<InformationEntryAutomationTrialResponse>(
        'api/v1/entries/automation/trial',
        body,
        options,
      ),
    executeInformationEntryAutomation: (body, options) =>
      post<InformationEntryAutomationExecuteResponse>(
        'api/v1/entries/automation/runs',
        body,
        options,
      ),
    listInformationEntryAutomationExecutions: (limit = 10, options) =>
      get<InformationEntryAutomationExecutionListResponse>(
        `api/v1/entries/automation/runs?limit=${encodeURIComponent(limit.toString())}`,
        options,
      ),
    loadInformationEntryAutomationExecution: (runId, options) =>
      get<InformationEntryAutomationExecutionResponse>(
        `api/v1/entries/automation/runs/${encodeURIComponent(runId)}`,
        options,
      ),
    listInformationEntryAutomationWorkQueue: (includePrivate, options) =>
      get<InformationEntryAutomationWorkQueueResponse>(
        `api/v1/entries/automation/work-queue?includePrivate=${includePrivate ? 'true' : 'false'}`,
        options,
      ),
    updateInformationEntryAutomationWorkItem: (
      runId,
      claimOrdinal,
      body,
      options,
    ) =>
      put<InformationEntryAutomationWorkItemWriteResponse>(
        `api/v1/entries/automation/work-queue/${encodeURIComponent(runId)}/${encodeURIComponent(claimOrdinal.toString())}`,
        body,
        options,
      ),
    executeInformationEntryAutomationWorkItemAction: (
      runId,
      claimOrdinal,
      body,
      options,
    ) =>
      post<InformationEntryAutomationActionWriteResponse>(
        `api/v1/entries/automation/work-queue/${encodeURIComponent(runId)}/${encodeURIComponent(claimOrdinal.toString())}/action`,
        body,
        options,
      ),
    importMarkdown: (body, options) =>
      post<MarkdownImportResponse>('api/v1/imports/markdown', body, options),
    importDocument: (body, options) =>
      post<DocumentImportResponse>('api/v1/imports/document', body, options),
    materializeInformationEntries: (body, options) =>
      post<InformationEntryMaterializeResponse>(
        'api/v1/entries/materialize',
        body,
        options,
      ),
    materializeManualInformationEntries: (body, options) =>
      post<InformationEntryMaterializeResponse>(
        'api/v1/entries/materialize/manual',
        body,
        options,
      ),
    loadInformationEntrySplitRuleProfile: (options) =>
      get<EntrySplitRuleProfileResponse>(
        'api/v1/entries/split-rules/profile',
        options,
      ),
    saveInformationEntrySplitRuleProfile: (body, options) =>
      put<EntrySplitRuleProfileWriteResponse>(
        'api/v1/entries/split-rules/profile',
        body,
        options,
      ),
    trialInformationEntrySplitRule: (body, options) =>
      post<EntrySplitRuleTrialResponse>(
        'api/v1/entries/split-rules/trial',
        body,
        options,
      ),
    applyInformationEntrySplitRule: (body, options) =>
      post<EntrySplitRuleApplyResponse>(
        'api/v1/entries/split-rules/apply',
        body,
        options,
      ),
    previewInformationEntryRestructure: (body, options) =>
      post<InformationEntryRestructurePreviewResponse>(
        'api/v1/entries/restructure/preview',
        body,
        options,
      ),
    applyInformationEntryRestructure: (body, options) =>
      post<InformationEntryRestructureApplyResponse>(
        'api/v1/entries/restructure/apply',
        body,
        options,
      ),
    reviseInformationEntry: (entryId, body, options) =>
      put<InformationEntryRevisionResponse>(
        `api/v1/entries/${encodeURIComponent(entryId)}`,
        body,
        options,
      ),
    searchInformationEntries: (body, options) =>
      post<InformationEntrySearchResponse>(
        'api/v1/entries/search',
        body,
        options,
      ),
    loadInformationEntrySearchIndex: (options) =>
      get<InformationEntrySearchIndexResponse>(
        'api/v1/entries/search/index',
        options,
      ),
    rebuildInformationEntrySearchIndex: (options) =>
      post<InformationEntrySearchIndexResponse>(
        'api/v1/entries/search/index/rebuild',
        {},
        options,
      ),
    evaluateInformationEntrySearch: (body, options) =>
      post<InformationEntrySearchEvaluationResponse>(
        'api/v1/entries/search/index/evaluate',
        body,
        options,
      ),
    exploreInformationEntries: (body, options) =>
      post<InformationEntryExplorationResponse>(
        'api/v1/entries/exploration/candidates',
        body,
        options,
      ),
    synthesizeInformationEntryQuery: (body, options) =>
      post<InformationEntryQuerySynthesisResponse>(
        'api/v1/entries/search/synthesize',
        body,
        options,
      ),
    readInformationEntryKnowledgeGraph: (body, options) =>
      post<InformationEntryKnowledgeGraphResponse>(
        'api/v1/knowledge-graph/view',
        body,
        options,
      ),
    reviseInformationEntryKnowledgeGraphEdge: (
      entryId,
      relatedEntryId,
      body,
      options,
    ) =>
      put<InformationEntryKnowledgeGraphEdgeWriteResponse>(
        `api/v1/knowledge-graph/edges/${encodeURIComponent(entryId)}/${encodeURIComponent(relatedEntryId)}`,
        body,
        options,
      ),
    rebuildInformationEntryAssociations: (body, options) =>
      post<InformationEntryAssociationRebuildResponse>(
        'api/v1/entries/associations/rebuild',
        body,
        options,
      ),
    reviseInformationEntryAssociationPolicy: (body, options) =>
      put<InformationEntryAssociationPolicyWriteResponse>(
        'api/v1/entries/associations/policy',
        body,
        options,
      ),
    reviseInformationEntryExplorationPolicy: (body, options) =>
      put<InformationEntryExplorationPolicyWriteResponse>(
        'api/v1/entries/exploration/policy',
        body,
        options,
      ),
    listInformationEntryAssociations: (entryId, options) =>
      get<InformationEntryAssociationListResponse>(
        `api/v1/entries/${encodeURIComponent(entryId)}/associations${privateOnlyQuery(options?.includePrivate === true)}`,
        options,
      ),
    reviseInformationEntryAssociation: (
      entryId,
      relatedEntryId,
      body,
      options,
    ) =>
      put<InformationEntryAssociationOverrideResponse>(
        `api/v1/entries/${encodeURIComponent(entryId)}/associations/${encodeURIComponent(relatedEntryId)}`,
        body,
        options,
      ),
    listInformationEntryDocuments: (options) =>
      get<InformationEntryDocumentListResponse>(
        `api/v1/entry-documents${privateOnlyQuery(options?.includePrivate === true)}`,
        options,
      ),
    aggregateInformationDocumentTags: (snapshotId, body, options) =>
      post<InformationDocumentTagWriteResponse>(
        `api/v1/entry-documents/${encodeURIComponent(snapshotId)}/tags/aggregate`,
        body,
        options,
      ),
    reviseInformationDocumentTags: (snapshotId, body, options) =>
      put<InformationDocumentTagWriteResponse>(
        `api/v1/entry-documents/${encodeURIComponent(snapshotId)}/tags`,
        body,
        options,
      ),
    listAiSplitProposals: (snapshotId, options) =>
      get<AiSplitProposalListResponse>(
        'api/v1/evidence/snapshots/' +
          encodeURIComponent(snapshotId) +
          '/split-proposals',
        options,
      ),
    startAiSplitProposal: (snapshotId, requestKey, options) =>
      post<AiSplitProposalStartResponse>(
        'api/v1/evidence/snapshots/' +
          encodeURIComponent(snapshotId) +
          '/split-proposals/start',
        {requestKey},
        options,
      ),
    acceptAiSplitProposal: (snapshotId, proposalId, options) =>
      post<AiSplitProposalDecisionResponse>(
        'api/v1/evidence/snapshots/' +
          encodeURIComponent(snapshotId) +
          '/split-proposals/' +
          encodeURIComponent(proposalId) +
          '/accept',
        {},
        options,
      ),
    rejectAiSplitProposal: (snapshotId, proposalId, options) =>
      post<AiSplitProposalDecisionResponse>(
        'api/v1/evidence/snapshots/' +
          encodeURIComponent(snapshotId) +
          '/split-proposals/' +
          encodeURIComponent(proposalId) +
          '/reject',
        {},
        options,
      ),
    listAiTagProposals: (entryId, options) =>
      get<AiTagProposalListResponse>(
        `api/v1/entries/${encodeURIComponent(entryId)}/tag-proposals`,
        options,
      ),
    startAiTagProposal: (entryId, requestKey, options) =>
      post<AiTagProposalStartResponse>(
        `api/v1/entries/${encodeURIComponent(entryId)}/tag-proposals/start`,
        {requestKey},
        options,
      ),
    acceptAiTagProposal: (entryId, proposalId, options) =>
      post<AiTagProposalDecisionResponse>(
        `api/v1/entries/${encodeURIComponent(entryId)}/tag-proposals/${encodeURIComponent(proposalId)}/accept`,
        {},
        options,
      ),
    rejectAiTagProposal: (entryId, proposalId, options) =>
      post<AiTagProposalDecisionResponse>(
        `api/v1/entries/${encodeURIComponent(entryId)}/tag-proposals/${encodeURIComponent(proposalId)}/reject`,
        {},
        options,
      ),
    listAiAssociationProposals: (entryId, relatedEntryId, options) =>
      get<AiAssociationProposalListResponse>(
        'api/v1/knowledge-graph/edges/' +
          encodeURIComponent(entryId) +
          '/' +
          encodeURIComponent(relatedEntryId) +
          '/proposals',
        options,
      ),
    startAiAssociationProposal: (
      entryId,
      relatedEntryId,
      requestKey,
      options,
    ) =>
      post<AiAssociationProposalStartResponse>(
        'api/v1/knowledge-graph/edges/' +
          encodeURIComponent(entryId) +
          '/' +
          encodeURIComponent(relatedEntryId) +
          '/proposals/start',
        {requestKey},
        options,
      ),
    acceptAiAssociationProposal: (
      entryId,
      relatedEntryId,
      proposalId,
      options,
    ) =>
      post<AiAssociationProposalDecisionResponse>(
        'api/v1/knowledge-graph/edges/' +
          encodeURIComponent(entryId) +
          '/' +
          encodeURIComponent(relatedEntryId) +
          '/proposals/' +
          encodeURIComponent(proposalId) +
          '/accept',
        {},
        options,
      ),
    rejectAiAssociationProposal: (
      entryId,
      relatedEntryId,
      proposalId,
      options,
    ) =>
      post<AiAssociationProposalDecisionResponse>(
        'api/v1/knowledge-graph/edges/' +
          encodeURIComponent(entryId) +
          '/' +
          encodeURIComponent(relatedEntryId) +
          '/proposals/' +
          encodeURIComponent(proposalId) +
          '/reject',
        {},
        options,
      ),
    listProcessingRuns: (limit = 20, options) =>
      get<ProcessingRunListResponse>(
        `api/v1/processing-runs?limit=${encodeURIComponent(limit.toString())}`,
        options,
      ),
    cancelProcessingRun: (runId, expectedVersion, options) =>
      post<ProcessingRunCancelResponse>(
        `api/v1/processing-runs/${encodeURIComponent(runId)}/cancel`,
        {expectedVersion},
        options,
      ),
    listSourceSubscriptions: (options) =>
      get<SourceSubscriptionListResponse>(
        'api/v1/source-subscriptions',
        options,
      ),
    replaceSourceSubscriptions: (expectedRevision, subscriptions, options) =>
      put<SourceSubscriptionReplaceResponse>(
        'api/v1/source-subscriptions',
        {expectedRevision, subscriptions},
        options,
      ),
    runSourceSubscription: (subscriptionId, requestKey, options) =>
      post<SourceSubscriptionRunResponse>(
        `api/v1/source-subscriptions/${encodeURIComponent(subscriptionId)}/run`,
        {requestKey},
        options,
      ),
    exportWorkspaceBundle: (options) =>
      post<WorkspaceBundleTransferResponse>(
        'api/v1/workspace-bundles/export',
        {},
        options,
      ),
    restoreWorkspaceBundle: (fileName, options) =>
      post<WorkspaceBundleTransferResponse>(
        'api/v1/workspace-bundles/restore',
        {fileName},
        options,
      ),
  };
  return Object.freeze(client);
}

function privateOnlyQuery(includePrivate: boolean): string {
  return includePrivate ? '?includePrivate=true' : '';
}

async function request<T>(
  fetchImplementation: M1cApiFetch,
  url: URL,
  method: 'GET' | 'POST' | 'PUT',
  body: unknown,
  options?: M1cApiRequestOptions,
): Promise<M1cHttpResponse<T>> {
  const requestInit: RequestInit = {
    cache: 'no-store',
    credentials: 'omit',
    headers: {
      Accept: 'application/json',
      ...(method === 'GET' ? {} : {'Content-Type': 'application/json'}),
    },
    method,
    redirect: 'error',
    ...(body === undefined ? {} : {body: JSON.stringify(body)}),
    ...(options?.signal === undefined ? {} : {signal: options.signal}),
  };
  let response: Response;
  try {
    response = await fetchImplementation(url, requestInit);
  } catch (cause) {
    throw new M1cApiClientError('本地产品接口当前不可达。', {cause});
  }
  if (
    response.headers
      .get('content-type')
      ?.toLowerCase()
      .includes('application/json') !== true
  ) {
    throw new M1cApiClientError('本地产品接口返回了无法识别的内容类型。');
  }
  let responseBody: T;
  try {
    responseBody = (await response.json()) as T;
  } catch (cause) {
    throw new M1cApiClientError('本地产品接口返回了无效 JSON。', {cause});
  }
  return Object.freeze({statusCode: response.status, body: responseBody});
}

function normalizeBaseUrl(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch (cause) {
    throw new M1cApiClientError('产品接口基础地址必须是绝对 HTTP(S) URL。', {
      cause,
    });
  }
  if (
    (url.protocol !== 'http:' && url.protocol !== 'https:') ||
    url.username !== '' ||
    url.password !== '' ||
    url.search !== '' ||
    url.hash !== ''
  ) {
    throw new M1cApiClientError('产品接口基础地址不符合本地 HTTP(S) 边界。');
  }
  if (!url.pathname.endsWith('/')) url.pathname = `${url.pathname}/`;
  return url;
}

function decodeReviewPreferencesResponse(
  response: M1cHttpResponse<unknown>,
): M1cHttpResponse<ReviewPreferencesResponse> {
  const body = response.body;
  if (
    response.statusCode !== 200 ||
    !isRecord(body) ||
    body.status !== 'ok' ||
    typeof body.workspaceId !== 'string' ||
    !Array.isArray(body.quickTags) ||
    !body.quickTags.every((value) => typeof value === 'string') ||
    !isRecord(body.automaticKeywords) ||
    typeof body.automaticKeywords.enabled !== 'boolean' ||
    typeof body.automaticKeywords.includeLinkDomains !== 'boolean' ||
    !Array.isArray(body.automaticKeywords.excludedKeywords) ||
    !body.automaticKeywords.excludedKeywords.every(
      (value) => typeof value === 'string',
    ) ||
    !isReviewVocabularyPreferences(body.vocabulary) ||
    !isReviewAssociationPolicyPreferences(body.associationPolicy) ||
    !isReviewExplorationPolicyPreferences(body.explorationPolicy)
  ) {
    throw new M1cApiClientError('本地产品接口未提供可识别的个人审核偏好。');
  }
  return Object.freeze({
    statusCode: response.statusCode,
    body: Object.freeze({
      status: 'ok',
      workspaceId: body.workspaceId,
      quickTags: Object.freeze([...body.quickTags]),
      automaticKeywords: Object.freeze({
        enabled: body.automaticKeywords.enabled,
        includeLinkDomains: body.automaticKeywords.includeLinkDomains,
        excludedKeywords: Object.freeze([
          ...body.automaticKeywords.excludedKeywords,
        ]),
      }),
      vocabulary: Object.freeze({
        aliases: Object.freeze(
          body.vocabulary.aliases.map((rule) => Object.freeze({...rule})),
        ),
      }),
      associationPolicy: Object.freeze({...body.associationPolicy}),
      explorationPolicy: Object.freeze({...body.explorationPolicy}),
    }),
  });
}

function isReviewExplorationPolicyPreferences(
  value: unknown,
): value is Readonly<{
  revision: number;
  enabled: boolean;
  resultShare: number;
  neighborExpansion: boolean;
  crossDomain: boolean;
  serendipity: boolean;
}> {
  return (
    isRecord(value) &&
    typeof value.revision === 'number' &&
    Number.isSafeInteger(value.revision) &&
    value.revision >= 0 &&
    typeof value.enabled === 'boolean' &&
    typeof value.resultShare === 'number' &&
    Number.isSafeInteger(value.resultShare) &&
    value.resultShare >= 0 &&
    value.resultShare <= 50 &&
    typeof value.neighborExpansion === 'boolean' &&
    typeof value.crossDomain === 'boolean' &&
    typeof value.serendipity === 'boolean'
  );
}

function isReviewAssociationPolicyPreferences(
  value: unknown,
): value is Readonly<{
  revision: number;
  contentWeight: number;
  typeWeight: number;
  domainWeight: number;
  threshold: number;
}> {
  if (!isRecord(value)) return false;
  const numbers = [
    value.revision,
    value.contentWeight,
    value.typeWeight,
    value.domainWeight,
    value.threshold,
  ];
  return (
    numbers.every(
      (candidate) =>
        typeof candidate === 'number' && Number.isSafeInteger(candidate),
    ) &&
    (value.revision as number) >= 0 &&
    (value.contentWeight as number) >= 0 &&
    (value.typeWeight as number) >= 0 &&
    (value.domainWeight as number) >= 0 &&
    (value.contentWeight as number) +
      (value.typeWeight as number) +
      (value.domainWeight as number) ===
      100 &&
    (value.threshold as number) >= 0 &&
    (value.threshold as number) <= 10_000
  );
}

function isReviewVocabularyPreferences(value: unknown): value is Readonly<{
  aliases: {source: string; canonical: string}[];
}> {
  return (
    isRecord(value) &&
    Array.isArray(value.aliases) &&
    value.aliases.every(
      (rule) =>
        isRecord(rule) &&
        typeof rule.source === 'string' &&
        typeof rule.canonical === 'string',
    )
  );
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
