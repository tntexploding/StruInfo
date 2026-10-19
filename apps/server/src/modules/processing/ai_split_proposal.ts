export const MAXIMUM_AI_SPLIT_ENTRIES = 64;
export const MAXIMUM_AI_SPLIT_FRAGMENTS = 128;

export type AiSplitProposalProviderErrorCode =
  | 'ai_operations_paused'
  | 'ai_batch_budget_paused'
  | 'ai_price_window_closed'
  | 'ai_split_input_unsupported'
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
  readonly providerKey:
    'openai-responses-v1' | 'deepseek-responses-v1' | 'external-agent-v1';
  readonly model: string;
  readonly promptVersion: string;
  proposeSplit(
    sections: readonly Readonly<AiSplitProposalSection>[],
  ): Promise<Readonly<AiSplitProposalProviderResult>>;
}
