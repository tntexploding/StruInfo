export type AiSplitProposalProviderErrorCode =
  | 'ai_provider_timeout'
  | 'ai_provider_unavailable'
  | 'ai_provider_rejected'
  | 'ai_provider_invalid_response';

export class AiSplitProposalProviderError extends Error {
  public readonly code: AiSplitProposalProviderErrorCode;
  public constructor(code: AiSplitProposalProviderErrorCode) {
    super('The AI split proposal provider operation failed.');
    this.name = 'AiSplitProposalProviderError';
    this.code = code;
  }
}
export interface AiSplitProposalSection {
  readonly ordinal: number;
  readonly text: string;
}
export interface AiSplitProposalProviderGroup {
  readonly titlePath: string;
  readonly startOrdinal: number;
  readonly endOrdinal: number;
}
export interface AiSplitProposalProviderResult {
  readonly summary: string;
  readonly groups: readonly Readonly<AiSplitProposalProviderGroup>[];
}
export interface AiSplitProposalProviderPort {
  readonly providerKey: 'openai-responses-v1';
  readonly model: string;
  readonly promptVersion: string;
  proposeSplit(
    sections: readonly Readonly<AiSplitProposalSection>[],
  ): Promise<Readonly<AiSplitProposalProviderResult>>;
}
