import type {ProcessingPrivacyScope} from './processing_contract.js';

export const BULK_INGESTION_BATCH_STATUSES = [
  'planned',
  'running',
  'pause_requested',
  'paused',
  'succeeded',
  'failed',
] as const;
export const BULK_INGESTION_ITEM_STATUSES = [
  'pending',
  'running',
  'succeeded',
  'failed',
] as const;
export const BULK_INGESTION_MAXIMUM_SNAPSHOTS = 500;
export const BULK_INGESTION_MAXIMUM_ENTRIES = 50_000;

export type BulkIngestionBatchStatus =
  (typeof BULK_INGESTION_BATCH_STATUSES)[number];
export type BulkIngestionItemStatus =
  (typeof BULK_INGESTION_ITEM_STATUSES)[number];
export type BulkIngestionExecutionMode = 'run' | 'resume' | 'retry';

export interface BulkIngestionSnapshotCandidate {
  readonly workspaceId: string;
  readonly snapshotId: string;
  readonly canonicalContentSha256: string;
  readonly isPrivate: boolean;
  readonly plannedEntryCount: number;
}

export interface BulkIngestionItem extends BulkIngestionSnapshotCandidate {
  readonly batchId: string;
  readonly ordinal: number;
  readonly status: BulkIngestionItemStatus;
  readonly attempt: number;
  readonly claimedRunId?: string;
  readonly resultEntryCount?: number;
  readonly errorCode?: string;
  readonly version: number;
}

export interface BulkIngestionBatch {
  readonly workspaceId: string;
  readonly batchId: string;
  readonly idempotencyKey: string;
  readonly requestSha256: string;
  readonly planSha256: string;
  readonly privacyScope: ProcessingPrivacyScope;
  readonly status: BulkIngestionBatchStatus;
  readonly activeRunId?: string;
  readonly attempt: number;
  readonly snapshotCount: number;
  readonly plannedEntryCount: number;
  readonly succeededSnapshotCount: number;
  readonly succeededEntryCount: number;
  readonly failedSnapshotCount: number;
  readonly version: number;
  readonly createdAt: string;
  readonly startedAt?: string;
  readonly finishedAt?: string;
  readonly updatedAt: string;
  readonly items: readonly Readonly<BulkIngestionItem>[];
}

export interface BulkIngestionBatchInitialize {
  readonly workspaceId: string;
  readonly batchId: string;
  readonly idempotencyKey: string;
  readonly requestSha256: string;
  readonly planSha256: string;
  readonly privacyScope: ProcessingPrivacyScope;
  readonly items: readonly Readonly<BulkIngestionSnapshotCandidate>[];
}

export type BulkIngestionInitializeOutcome =
  'created' | 'existing' | 'conflict';
export type BulkIngestionBeginOutcome =
  'started' | 'not_found' | 'invalid_state';
export type BulkIngestionPauseOutcome =
  'applied' | 'unchanged' | 'not_found' | 'terminal';
export type BulkIngestionSettleOutcome = 'applied' | 'not_found' | 'stale';
export type BulkIngestionFinishReason = 'drained' | 'pause' | 'window';

export type BulkIngestionClaimResult =
  | Readonly<{outcome: 'claimed'; item: Readonly<BulkIngestionItem>}>
  | Readonly<{
      outcome: 'drained' | 'pause_requested' | 'not_found' | 'stale';
    }>;

export interface BulkIngestionRepositoryPort {
  listCandidates(
    workspaceId: string,
    privacyScope: ProcessingPrivacyScope,
    limit: number,
  ): Promise<readonly Readonly<BulkIngestionSnapshotCandidate>[]>;
  initializeBatch(
    initialize: Readonly<BulkIngestionBatchInitialize>,
  ): Promise<BulkIngestionInitializeOutcome>;
  loadBatch(
    workspaceId: string,
    batchId: string,
  ): Promise<Readonly<BulkIngestionBatch> | undefined>;
  beginAttempt(
    input: Readonly<{
      workspaceId: string;
      batchId: string;
      runId: string;
      mode: BulkIngestionExecutionMode;
    }>,
  ): Promise<BulkIngestionBeginOutcome>;
  requestPause(
    workspaceId: string,
    batchId: string,
  ): Promise<BulkIngestionPauseOutcome>;
  claimNextItem(
    workspaceId: string,
    batchId: string,
    runId: string,
  ): Promise<Readonly<BulkIngestionClaimResult>>;
  settleItem(
    input: Readonly<{
      workspaceId: string;
      batchId: string;
      ordinal: number;
      expectedVersion: number;
      runId: string;
      status: 'succeeded' | 'failed';
      resultEntryCount?: number;
      errorCode?: string;
    }>,
  ): Promise<BulkIngestionSettleOutcome>;
  finishAttempt(
    input: Readonly<{
      workspaceId: string;
      batchId: string;
      runId: string;
      reason: BulkIngestionFinishReason;
    }>,
  ): Promise<BulkIngestionSettleOutcome>;
}

export interface PlanBulkIngestionRequest {
  readonly idempotencyKey: string;
  readonly privacyScope: ProcessingPrivacyScope;
  readonly limit: number;
}

export type PlanBulkIngestionResult =
  | Readonly<{
      outcome: 'created' | 'existing';
      batch: Readonly<BulkIngestionBatch>;
    }>
  | Readonly<{outcome: 'empty'}>;

export interface ExecuteBulkIngestionRequest {
  readonly batchId: string;
  readonly mode: BulkIngestionExecutionMode;
  readonly maxItems: number;
}

export interface ExecuteBulkIngestionResult {
  readonly outcome: 'succeeded' | 'paused' | 'failed';
  readonly batch: Readonly<BulkIngestionBatch>;
}
