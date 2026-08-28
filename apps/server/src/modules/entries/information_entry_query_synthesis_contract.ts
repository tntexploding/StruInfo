import type {
  EntryDomainKeyword,
  EntryTypeKeyword,
  InformationEntrySearchRequest,
} from './information_entry_contract.js';

export const INFORMATION_ENTRY_QUERY_SYNTHESIS_MAXIMUM_EVIDENCE = 8;
export const INFORMATION_ENTRY_QUERY_SYNTHESIS_MAXIMUM_QUESTION_CODE_POINTS = 600;
export const INFORMATION_ENTRY_QUERY_SYNTHESIS_MAXIMUM_EXCERPT_CODE_POINTS = 4_000;
export const INFORMATION_ENTRY_QUERY_SYNTHESIS_MAXIMUM_TOTAL_EXCERPT_CODE_POINTS = 24_000;

export const INFORMATION_ENTRY_QUERY_SYNTHESIS_EVIDENCE_STATUSES = [
  'supported',
  'partial',
  'insufficient',
] as const;

export type InformationEntryQuerySynthesisEvidenceStatus =
  (typeof INFORMATION_ENTRY_QUERY_SYNTHESIS_EVIDENCE_STATUSES)[number];

export type AiQuerySynthesisProviderErrorCode =
  | 'ai_provider_timeout'
  | 'ai_provider_unavailable'
  | 'ai_provider_rejected'
  | 'ai_provider_invalid_response';

export class AiQuerySynthesisProviderError extends Error {
  public readonly code: AiQuerySynthesisProviderErrorCode;

  public constructor(code: AiQuerySynthesisProviderErrorCode) {
    super('The AI query synthesis provider operation failed.');
    this.name = 'AiQuerySynthesisProviderError';
    this.code = code;
  }
}

export interface InformationEntryQuerySynthesisProviderEvidence {
  readonly handle: string;
  readonly titlePath: string;
  readonly excerpt: string;
  readonly truncated: boolean;
  readonly contentKeywords: readonly string[];
  readonly typeKeyword?: Readonly<{
    keyword: EntryTypeKeyword;
    customName?: string;
  }>;
  readonly domains: readonly Readonly<{
    keyword: EntryDomainKeyword;
    customName?: string;
  }>[];
}

export interface InformationEntryQuerySynthesisClaim {
  readonly statement: string;
  readonly evidenceRefs: readonly string[];
}

export interface InformationEntryQuerySynthesisProviderResult {
  readonly answer: string;
  readonly evidenceStatus: InformationEntryQuerySynthesisEvidenceStatus;
  readonly claims: readonly Readonly<InformationEntryQuerySynthesisClaim>[];
  readonly limitations: readonly string[];
}

export interface InformationEntryQuerySynthesisProviderPort {
  readonly providerKey: 'openai-responses-v1';
  readonly model: string;
  readonly promptVersion: string;

  synthesize(
    question: string,
    evidence: readonly Readonly<InformationEntryQuerySynthesisProviderEvidence>[],
  ): Promise<Readonly<InformationEntryQuerySynthesisProviderResult>>;
}

export interface InformationEntryQuerySynthesisRequest {
  readonly requestId: string;
  readonly question: string;
  readonly query: Readonly<InformationEntrySearchRequest>;
}

export interface InformationEntryQuerySynthesisEvidence extends InformationEntryQuerySynthesisProviderEvidence {
  readonly entryId: string;
  readonly entryRevision: number;
  readonly snapshotId: string;
  readonly fragmentIds: readonly string[];
}

export interface InformationEntryQuerySynthesisResult {
  readonly requestId: string;
  readonly querySha256: string;
  readonly providerKey: 'openai-responses-v1';
  readonly model: string;
  readonly promptVersion: string;
  readonly answer: string;
  readonly evidenceStatus: InformationEntryQuerySynthesisEvidenceStatus;
  readonly claims: readonly Readonly<InformationEntryQuerySynthesisClaim>[];
  readonly limitations: readonly string[];
  readonly evidence: readonly Readonly<InformationEntryQuerySynthesisEvidence>[];
}

export type InformationEntryQuerySynthesisServiceErrorCode =
  | AiQuerySynthesisProviderErrorCode
  | 'ai_query_private_scope_forbidden'
  | 'ai_query_no_evidence';

export class InformationEntryQuerySynthesisServiceError extends Error {
  public readonly code: InformationEntryQuerySynthesisServiceErrorCode;

  public constructor(code: InformationEntryQuerySynthesisServiceErrorCode) {
    super('The Information Entry query synthesis operation failed.');
    this.name = 'InformationEntryQuerySynthesisServiceError';
    this.code = code;
  }
}

export interface InformationEntryQuerySynthesisServicePort {
  readonly providerKey: 'openai-responses-v1';
  readonly model: string;
  readonly promptVersion: string;

  synthesize(
    request: Readonly<InformationEntryQuerySynthesisRequest>,
  ): Promise<Readonly<InformationEntryQuerySynthesisResult>>;
}
