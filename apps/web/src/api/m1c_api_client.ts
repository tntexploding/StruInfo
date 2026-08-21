import {KNOWLEDGE_KINDS} from './m1c_api_contract.js';
import type {
  CurationState,
  DomainCommandResponse,
  EvidenceSnapshot,
  EvidenceSnapshotSummary,
  InformationEntryListResponse,
  InformationEntryDocumentListResponse,
  InformationEntryMaterializeResponse,
  InformationEntryRevisionResponse,
  InformationEntrySearchResponse,
  InformationDocumentTagWriteResponse,
  KnowledgeItemReadResponse,
  KnowledgeSearchResponse,
  M1cHttpResponse,
  MarkdownImportResponse,
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
  loadCuration(
    options?: M1cApiRequestOptions,
  ): Promise<M1cHttpResponse<Readonly<{status: 'ok'; state: CurationState}>>>;
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
  putCurationTerm(
    body: unknown,
    options?: M1cApiRequestOptions,
  ): Promise<M1cHttpResponse<DomainCommandResponse>>;
  applyCuration(
    body: unknown,
    options?: M1cApiRequestOptions,
  ): Promise<M1cHttpResponse<DomainCommandResponse>>;
  applyKnowledgeChangeSet(
    body: unknown,
    options?: M1cApiRequestOptions,
  ): Promise<M1cHttpResponse<DomainCommandResponse>>;
  loadKnowledgeItem(
    itemId: string,
    options?: M1cApiRequestOptions,
  ): Promise<M1cHttpResponse<KnowledgeItemReadResponse>>;
  search(
    body: unknown,
    options?: M1cApiRequestOptions,
  ): Promise<M1cHttpResponse<KnowledgeSearchResponse>>;
  materializeInformationEntries(
    body: unknown,
    options?: M1cApiRequestOptions,
  ): Promise<M1cHttpResponse<InformationEntryMaterializeResponse>>;
  listInformationEntries(
    snapshotId?: string,
    options?: M1cApiRequestOptions,
  ): Promise<M1cHttpResponse<InformationEntryListResponse>>;
  reviseInformationEntry(
    entryId: string,
    body: unknown,
    options?: M1cApiRequestOptions,
  ): Promise<M1cHttpResponse<InformationEntryRevisionResponse>>;
  searchInformationEntries(
    body: unknown,
    options?: M1cApiRequestOptions,
  ): Promise<M1cHttpResponse<InformationEntrySearchResponse>>;
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
    loadCuration: reject,
    loadReviewPreferences: reject,
    saveReviewPreferences: reject,
    importMarkdown: reject,
    putCurationTerm: reject,
    applyCuration: reject,
    applyKnowledgeChangeSet: reject,
    loadKnowledgeItem: reject,
    search: reject,
    materializeInformationEntries: reject,
    listInformationEntries: reject,
    reviseInformationEntry: reject,
    searchInformationEntries: reject,
    listInformationEntryDocuments: reject,
    aggregateInformationDocumentTags: reject,
    reviseInformationDocumentTags: reject,
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
    loadCuration: (options) =>
      get<Readonly<{status: 'ok'; state: CurationState}>>(
        'api/v1/curation',
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
    putCurationTerm: (body, options) =>
      post<DomainCommandResponse>('api/v1/curation/terms', body, options),
    applyCuration: (body, options) =>
      post<DomainCommandResponse>('api/v1/curation/apply', body, options),
    applyKnowledgeChangeSet: (body, options) =>
      post<DomainCommandResponse>(
        'api/v1/knowledge/change-sets',
        body,
        options,
      ),
    loadKnowledgeItem: (itemId, options) =>
      get<KnowledgeItemReadResponse>(
        `api/v1/knowledge/items/${encodeURIComponent(itemId)}${options?.includePrivate === true ? '?includePrivate=true' : ''}`,
        options,
      ),
    search: (body, options) =>
      post<KnowledgeSearchResponse>('api/v1/search', body, options),
    materializeInformationEntries: (body, options) =>
      post<InformationEntryMaterializeResponse>(
        'api/v1/entries/materialize',
        body,
        options,
      ),
    listInformationEntries: (snapshotId, options) =>
      get<InformationEntryListResponse>(
        `api/v1/entries${entryQuery(snapshotId, options?.includePrivate === true)}`,
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

function entryQuery(
  snapshotId: string | undefined,
  includePrivate: boolean,
): string {
  const parameters = new URLSearchParams();
  if (snapshotId !== undefined) parameters.set('snapshotId', snapshotId);
  if (includePrivate) parameters.set('includePrivate', 'true');
  const value = parameters.toString();
  return value === '' ? '' : `?${value}`;
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
    !isReviewVocabularyPreferences(body.vocabulary)
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
        links: Object.freeze(
          body.vocabulary.links.map((rule) => Object.freeze({...rule})),
        ),
        knowledgeKinds: Object.freeze(
          body.vocabulary.knowledgeKinds.map((rule) =>
            Object.freeze({...rule}),
          ),
        ),
      }),
    }),
  });
}

function isReviewVocabularyPreferences(value: unknown): value is Readonly<{
  aliases: {source: string; canonical: string}[];
  links: {left: string; right: string; kind: 'related' | 'translation'}[];
  knowledgeKinds: {
    keyword: string;
    knowledgeKind: (typeof KNOWLEDGE_KINDS)[number];
  }[];
}> {
  return (
    isRecord(value) &&
    Array.isArray(value.aliases) &&
    value.aliases.every(
      (rule) =>
        isRecord(rule) &&
        typeof rule.source === 'string' &&
        typeof rule.canonical === 'string',
    ) &&
    Array.isArray(value.links) &&
    value.links.every(
      (rule) =>
        isRecord(rule) &&
        typeof rule.left === 'string' &&
        typeof rule.right === 'string' &&
        (rule.kind === 'related' || rule.kind === 'translation'),
    ) &&
    Array.isArray(value.knowledgeKinds) &&
    value.knowledgeKinds.every(
      (rule) =>
        isRecord(rule) &&
        typeof rule.keyword === 'string' &&
        typeof rule.knowledgeKind === 'string' &&
        KNOWLEDGE_KINDS.includes(
          rule.knowledgeKind as (typeof KNOWLEDGE_KINDS)[number],
        ),
    )
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
