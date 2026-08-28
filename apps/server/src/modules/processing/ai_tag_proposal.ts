import type {
  CurrentInformationEntry,
  EntryDomainKeyword,
  EntryTypeKeyword,
} from '../entries/index.js';

export type AiTagProposalProviderErrorCode =
  | 'ai_provider_timeout'
  | 'ai_provider_unavailable'
  | 'ai_provider_rejected'
  | 'ai_provider_invalid_response';

export class AiTagProposalProviderError extends Error {
  public readonly code: AiTagProposalProviderErrorCode;

  public constructor(code: AiTagProposalProviderErrorCode) {
    super('The AI tag proposal provider operation failed.');
    this.name = 'AiTagProposalProviderError';
    this.code = code;
  }
}

export interface AiTagProposalProviderResult {
  readonly summary: string;
  readonly contentKeywords: readonly string[];
  readonly typeKeyword: EntryTypeKeyword;
  readonly typeCustomName?: string;
  readonly domains: readonly Readonly<{
    keyword: EntryDomainKeyword;
    customName?: string;
  }>[];
}

export interface AiTagProposalProviderPort {
  readonly providerKey: 'openai-responses-v1';
  readonly model: string;
  readonly promptVersion: string;

  proposeTags(
    entry: Readonly<CurrentInformationEntry>,
  ): Promise<Readonly<AiTagProposalProviderResult>>;
}
