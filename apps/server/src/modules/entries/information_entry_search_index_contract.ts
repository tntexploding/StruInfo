import type {
  CurrentInformationEntry,
  InformationEntrySearchRequest,
  InformationEntrySearchResult,
} from './information_entry_contract.js';

export const INFORMATION_ENTRY_SEARCH_INDEX_VERSION =
  'struinfo.entry-search-index.v1' as const;
export const INFORMATION_ENTRY_TERM_TOKENIZER_VERSION =
  'struinfo.entry-terms.unicode-v1' as const;
export const INFORMATION_ENTRY_EMBEDDING_INPUT_MAXIMUM_UTF8_BYTES = 7_500;
export const INFORMATION_ENTRY_EMBEDDING_BATCH_MAXIMUM = 32;
export const INFORMATION_ENTRY_TERM_MAXIMUM_POSTINGS_PER_ENTRY = 4_096;

export type InformationEntrySearchIndexField = 'title' | 'body' | 'tags';

export interface InformationEntryTermPosting {
  readonly entryId: string;
  readonly field: InformationEntrySearchIndexField;
  readonly term: string;
  readonly occurrences: number;
}

export interface InformationEntrySearchProjection {
  readonly entryId: string;
  readonly entryRevision: number;
  readonly entryRevisionId: string;
  readonly projectionSha256: string;
  readonly tokenizerVersion: typeof INFORMATION_ENTRY_TERM_TOKENIZER_VERSION;
  readonly embeddingProvider?: string;
  readonly embeddingModel?: string;
  readonly embedding?: readonly number[];
}

export interface InformationEntrySearchIndexSnapshot {
  readonly projections: readonly Readonly<InformationEntrySearchProjection>[];
  readonly postings: readonly Readonly<InformationEntryTermPosting>[];
}

export interface InformationEntrySearchIndexRepositoryPort {
  loadSearchIndex(
    workspaceId: string,
  ): Promise<Readonly<InformationEntrySearchIndexSnapshot>>;
  replaceSearchIndex(
    workspaceId: string,
    snapshot: Readonly<InformationEntrySearchIndexSnapshot>,
  ): Promise<void>;
}

export interface InformationEntryEmbeddingProviderPort {
  readonly providerKey: string;
  readonly model: string;
  embed(inputs: readonly string[]): Promise<readonly (readonly number[])[]>;
}

export interface InformationEntrySearchIndexStatus {
  readonly indexVersion: typeof INFORMATION_ENTRY_SEARCH_INDEX_VERSION;
  readonly tokenizerVersion: typeof INFORMATION_ENTRY_TERM_TOKENIZER_VERSION;
  readonly publicEntryCount: number;
  readonly currentProjectionCount: number;
  readonly embeddedProjectionCount: number;
  readonly staleProjectionCount: number;
  readonly postingCount: number;
  readonly semanticSearchAvailable: boolean;
  readonly semanticSearchReady: boolean;
  readonly embeddingProvider?: string;
  readonly embeddingModel?: string;
}

export interface InformationEntrySearchEvaluationCase {
  readonly caseId: string;
  readonly query: string;
  readonly expectedEntryIds: readonly string[];
}

export interface InformationEntrySearchEvaluationCaseResult {
  readonly caseId: string;
  readonly expectedCount: number;
  readonly retrievedExpectedCount: number;
  readonly recallAtK: number;
  readonly reciprocalRank: number;
  readonly retrievedEntryIds: readonly string[];
}

export interface InformationEntrySearchEvaluationResult {
  readonly retrievalMode: 'semantic' | 'hybrid';
  readonly k: number;
  readonly meanRecallAtK: number;
  readonly meanReciprocalRank: number;
  readonly cases: readonly Readonly<InformationEntrySearchEvaluationCaseResult>[];
}

export interface InformationEntryRetrievalServicePort {
  readonly semanticSearchAvailable: boolean;
  search(
    request: Readonly<InformationEntrySearchRequest>,
  ): Promise<Readonly<InformationEntrySearchResult>>;
  status(): Promise<Readonly<InformationEntrySearchIndexStatus>>;
  rebuild(): Promise<Readonly<InformationEntrySearchIndexStatus>>;
  evaluate(
    retrievalMode: 'semantic' | 'hybrid',
    k: number,
    cases: readonly Readonly<InformationEntrySearchEvaluationCase>[],
  ): Promise<Readonly<InformationEntrySearchEvaluationResult>>;
}

export interface PreparedInformationEntrySearchProjection {
  readonly entry: Readonly<CurrentInformationEntry>;
  readonly input: string;
  readonly projection: Readonly<InformationEntrySearchProjection>;
  readonly postings: readonly Readonly<InformationEntryTermPosting>[];
}

export type InformationEntryRetrievalServiceErrorCode =
  | 'semantic_search_not_configured'
  | 'semantic_search_private_scope_forbidden'
  | 'semantic_search_text_required'
  | 'semantic_search_index_not_ready'
  | 'semantic_search_provider_failure';

export class InformationEntryRetrievalServiceError extends Error {
  public readonly code: InformationEntryRetrievalServiceErrorCode;

  public constructor(code: InformationEntryRetrievalServiceErrorCode) {
    super(code);
    this.name = 'InformationEntryRetrievalServiceError';
    this.code = code;
  }
}
