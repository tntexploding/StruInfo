import type {CurrentInformationEntry} from '../entries/index.js';
import type {ProcessingRun} from './processing_contract.js';

export type AiAssociationProposalProviderErrorCode =
  | 'ai_operations_paused'
  | 'ai_batch_budget_paused'
  | 'ai_price_window_closed'
  | 'ai_provider_timeout'
  | 'ai_provider_unavailable'
  | 'ai_provider_rejected'
  | 'ai_relation_review_uncertain'
  | 'ai_provider_invalid_response';

export class AiAssociationProposalProviderError extends Error {
  public readonly code: AiAssociationProposalProviderErrorCode;

  public constructor(code: AiAssociationProposalProviderErrorCode) {
    super('The AI association proposal provider operation failed.');
    this.name = 'AiAssociationProposalProviderError';
    this.code = code;
  }
}

export type AiAssociationProposalProviderResult = Readonly<{summary: string}> &
  (
    | Readonly<{
        outcome?: 'relation';
        relationLabel: string;
        direction: 'symmetric' | 'low_to_high' | 'high_to_low';
      }>
    | Readonly<{outcome: 'no_relation'}>
  );

export const AI_NO_RELATION_STEP = '未发现有意义的联系';
export function isNoRelationRun(
  run: Readonly<ProcessingRun> | undefined,
): boolean {
  return (
    run?.status === 'succeeded' &&
    run.currentStage === 'associations' &&
    run.currentStep === AI_NO_RELATION_STEP &&
    run.completedUnits === 1 &&
    run.totalUnits === 1 &&
    run.proposals.length === 0
  );
}

export interface AiAssociationProposalProviderPort {
  readonly providerKey:
    'openai-responses-v1' | 'deepseek-responses-v1' | 'external-agent-v1';
  readonly model: string;
  readonly promptVersion: string;

  reviewAssociation?(
    entryLow: Readonly<CurrentInformationEntry>,
    entryHigh: Readonly<CurrentInformationEntry>,
    candidate: Readonly<{
      relationLabel: string;
      direction: 'symmetric' | 'low_to_high' | 'high_to_low';
    }>,
  ): Promise<Readonly<AiAssociationProposalProviderResult>>;

  proposeAssociation(
    entryLow: Readonly<CurrentInformationEntry>,
    entryHigh: Readonly<CurrentInformationEntry>,
  ): Promise<Readonly<AiAssociationProposalProviderResult>>;
}
