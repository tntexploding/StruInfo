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
  InformationEntryAssociationListResponse,
  InformationEntryAssociationOverrideResponse,
  InformationEntryAssociationPolicyWriteResponse,
  InformationEntryAssociationRebuildResponse,
  InformationEntryDocumentListResponse,
  InformationEntryKnowledgeGraphEdgeWriteResponse,
  InformationEntryKnowledgeGraphResponse,
  InformationEntryMaterializeResponse,
  InformationEntryRevisionResponse,
  InformationEntrySearchResponse,
  InformationDocumentTagWriteResponse,
  M1cHttpResponse,
  DocumentImportResponse,
  MarkdownImportResponse,
  ProcessingRunCancelResponse,
  ProcessingRunListResponse,
  ReviewPreferencesWrite,
  ReviewPreferencesResponse,
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
  loadReviewPreferences(
    options?: M1cApiRequestOptions,
  ): Promise<M1cHttpResponse<ReviewPreferencesResponse>>;
  saveReviewPreferences(
    preferences: Readonly<ReviewPreferencesWrite>,
    options?: M1cApiRequestOptions,
  ): Promise<M1cHttpResponse<ReviewPreferencesResponse>>;
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
  reviseInformationEntry(
    entryId: string,
    body: unknown,
    options?: M1cApiRequestOptions,
  ): Promise<M1cHttpResponse<InformationEntryRevisionResponse>>;
  searchInformationEntries(
    body: unknown,
    options?: M1cApiRequestOptions,
  ): Promise<M1cHttpResponse<InformationEntrySearchResponse>>;
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
    loadReviewPreferences: reject,
    saveReviewPreferences: reject,
    importMarkdown: reject,
    importDocument: reject,
    materializeInformationEntries: reject,
    materializeManualInformationEntries: reject,
    reviseInformationEntry: reject,
    searchInformationEntries: reject,
    readInformationEntryKnowledgeGraph: reject,
    reviseInformationEntryKnowledgeGraphEdge: reject,
    rebuildInformationEntryAssociations: reject,
    reviseInformationEntryAssociationPolicy: reject,
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
    loadReviewPreferences: async (options) =>
      decodeReviewPreferencesResponse(
        await get<unknown>('api/v1/preferences/review', options),
      ),
    saveReviewPreferences: async (preferences, options) =>
      decodeReviewPreferencesResponse(
        await put<unknown>('api/v1/preferences/review', preferences, options),
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
    !isReviewAssociationPolicyPreferences(body.associationPolicy)
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
    }),
  });
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
