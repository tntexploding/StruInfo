import type {
  InformationEntryAutomationReason,
  InformationEntryAutomationRoute,
  InformationEntryPreferenceTrialExpectedEntry,
} from '../entries/index.js';
import type {
  ProcessingRunStatus,
  ProcessingRunWriteOutcome,
} from './processing_contract.js';
import type {EntryAutomationAdvanceActions} from '../../storage/review_preferences_store.js';

export const ENTRY_AUTOMATION_CLAIM_STATUSES = [
  'claimed',
  'completed',
  'compensated',
] as const;

export type EntryAutomationClaimStatus =
  (typeof ENTRY_AUTOMATION_CLAIM_STATUSES)[number];

export interface EntryAutomationClaimInput {
  readonly ordinal: number;
  readonly entryId: string;
  readonly entryRevision: number;
  readonly entryRevisionId: string;
  readonly route: InformationEntryAutomationRoute;
  readonly reason: InformationEntryAutomationReason;
}

export interface EntryAutomationClaim extends EntryAutomationClaimInput {
  readonly workspaceId: string;
  readonly runId: string;
  readonly status: EntryAutomationClaimStatus;
  readonly errorCode?: string;
  readonly createdAt: string;
  readonly finishedAt?: string;
}

export interface EntryAutomationExecution {
  readonly workspaceId: string;
  readonly runId: string;
  readonly idempotencyKey: string;
  readonly requestSha256: string;
  readonly planSha256: string;
  readonly policyRevision: number;
  readonly profileRevision: number;
  readonly includePrivate: boolean;
  readonly status: ProcessingRunStatus;
  readonly version: number;
  readonly errorCode?: string;
  readonly claims: readonly Readonly<EntryAutomationClaim>[];
}

export interface EntryAutomationExecutionInitialize {
  readonly workspaceId: string;
  readonly runId: string;
  readonly idempotencyKey: string;
  readonly requestSha256: string;
  readonly planSha256: string;
  readonly policyRevision: number;
  readonly profileRevision: number;
  readonly includePrivate: boolean;
  readonly advanceActions?: Readonly<EntryAutomationAdvanceActions>;
  readonly claims: readonly Readonly<EntryAutomationClaimInput>[];
}

export interface EntryAutomationExecutionSettle {
  readonly workspaceId: string;
  readonly runId: string;
  readonly expectedVersion: number;
  readonly status: 'succeeded' | 'failed';
  readonly errorCode?:
    'automation_revalidation_failed' | 'automation_execution_failed';
}

export interface EntryAutomationExecutionRepositoryPort {
  loadExecution(
    workspaceId: string,
    runId: string,
  ): Promise<Readonly<EntryAutomationExecution> | undefined>;

  initializeExecution(
    initialize: Readonly<EntryAutomationExecutionInitialize>,
  ): Promise<ProcessingRunWriteOutcome>;

  startExecution(
    workspaceId: string,
    runId: string,
    expectedVersion: number,
  ): Promise<ProcessingRunWriteOutcome>;

  settleExecution(
    settle: Readonly<EntryAutomationExecutionSettle>,
  ): Promise<ProcessingRunWriteOutcome>;
}

export interface ExecuteEntryAutomationRequest {
  readonly workspaceId: string;
  readonly idempotencyKey: string;
  readonly includePrivate: boolean;
  readonly expectedPolicyRevision: number;
  readonly expectedProfileRevision: number;
  readonly expectedEntries?: readonly Readonly<InformationEntryPreferenceTrialExpectedEntry>[];
  readonly manualTakeoverEntryIds?: readonly string[];
}

export type EntryAutomationPolicyPauseOutcome =
  'applied' | 'superseded' | 'failed';

export type ExecuteEntryAutomationResult =
  | Readonly<{status: 'invalid_request'}>
  | Readonly<{
      status: 'not_ready';
      reason:
        | 'disabled'
        | 'paused'
        | 'profile_disabled'
        | 'profile_revision_mismatch'
        | 'stale_policy'
        | 'stale_profile'
        | 'stale_entries'
        | 'invalid_state'
        | 'no_entries';
    }>
  | Readonly<{status: 'conflict'; runId: string}>
  | Readonly<{
      status: 'succeeded';
      runId: string;
      replayed: boolean;
      counts: Readonly<Record<InformationEntryAutomationRoute, number>>;
    }>
  | Readonly<{
      status: 'failed';
      runId: string;
      replayed: boolean;
      errorCode:
        'automation_revalidation_failed' | 'automation_execution_failed';
      policyPause: EntryAutomationPolicyPauseOutcome;
      recoveryPending: boolean;
    }>;
