import type {CurrentInformationEntry} from '../entries/index.js';

export type AiAssociationProposalProviderErrorCode =
  | 'ai_provider_timeout'
  | 'ai_provider_unavailable'
  | 'ai_provider_rejected'
  | 'ai_provider_invalid_response';

export class AiAssociationProposalProviderError extends Error {
  public readonly code: AiAssociationProposalProviderErrorCode;

  public constructor(code: AiAssociationProposalProviderErrorCode) {
    super('The AI association proposal provider operation failed.');
    this.name = 'AiAssociationProposalProviderError';
    this.code = code;
  }
}

export interface AiAssociationProposalProviderResult {
  readonly summary: string;
  readonly relationLabel: string;
  readonly direction: 'symmetric' | 'low_to_high' | 'high_to_low';
}

export interface AiAssociationProposalProviderPort {
  readonly providerKey: 'openai-responses-v1';
  readonly model: string;
  readonly promptVersion: string;

  proposeAssociation(
    entryLow: Readonly<CurrentInformationEntry>,
    entryHigh: Readonly<CurrentInformationEntry>,
  ): Promise<Readonly<AiAssociationProposalProviderResult>>;
}
