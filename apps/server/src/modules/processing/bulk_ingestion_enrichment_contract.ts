import type {ProcessingPrivacyScope} from './processing_contract.js';

export const BULK_INGESTION_ENRICHMENT_ITEM_STATUSES = [
  'pending',
  'running',
  'succeeded',
  'failed',
] as const;
export const BULK_INGESTION_ENRICHMENT_EXCEPTION_CODES = [
  'automatic_tagging_disabled',
  'no_deterministic_tags',
  'keyword_capacity_reached',
  'classification_incomplete',
  'classification_no_signal',
  'classification_type_missing',
  'classification_domain_missing',
  'classification_tied',
] as const;

export type BulkIngestionEnrichmentItemStatus =
  (typeof BULK_INGESTION_ENRICHMENT_ITEM_STATUSES)[number];
export type BulkIngestionEnrichmentExceptionCode =
  (typeof BULK_INGESTION_ENRICHMENT_EXCEPTION_CODES)[number];
export type BulkIngestionEnrichmentStatus =
  'planned' | 'running' | 'paused' | 'succeeded' | 'failed';
export type BulkIngestionEnrichmentMode =
  'run' | 'resume' | 'retry' | 'refresh';

export interface BulkIngestionEnrichmentException {
  readonly entryId: string;
  readonly entryRevision: number;
  readonly entryRevisionId: string;
  readonly code: BulkIngestionEnrichmentExceptionCode;
}

export interface BulkIngestionEnrichmentItem {
  readonly workspaceId: string;
  readonly batchId: string;
  readonly ordinal: number;
  readonly snapshotId: string;
  readonly isPrivate: boolean;
  readonly plannedEntryCount: number;
  readonly status: BulkIngestionEnrichmentItemStatus;
  readonly attempt: number;
  readonly claimedRunId?: string;
  readonly rulesSha256?: string;
  readonly resultEntryCount?: number;
  readonly revisedEntryCount?: number;
  readonly addedTagCount?: number;
  readonly associationProjectionCount?: number;
  readonly exceptionEntryCount?: number;
  readonly errorCode?: string;
  readonly version: number;
  readonly exceptions: readonly Readonly<BulkIngestionEnrichmentException>[];
}

export interface BulkIngestionEnrichmentBatch {
  readonly workspaceId: string;
  readonly batchId: string;
  readonly privacyScope: ProcessingPrivacyScope;
  readonly status: BulkIngestionEnrichmentStatus;
  readonly attempt: number;
  readonly snapshotCount: number;
  readonly plannedEntryCount: number;
  readonly succeededSnapshotCount: number;
  readonly succeededEntryCount: number;
  readonly revisedEntryCount: number;
  readonly addedTagCount: number;
  readonly associationProjectionCount: number;
  readonly exceptionEntryCount: number;
  readonly failedSnapshotCount: number;
  readonly pendingSnapshotCount: number;
  readonly runningSnapshotCount: number;
  readonly items: readonly Readonly<BulkIngestionEnrichmentItem>[];
}

export type BulkIngestionEnrichmentBeginOutcome =
  'started' | 'not_found' | 'invalid_state';
export type BulkIngestionEnrichmentWriteOutcome =
  'applied' | 'not_found' | 'stale';

export interface BulkIngestionEnrichmentRepositoryPort {
  ensureItems(workspaceId: string, batchId: string): Promise<boolean>;
  loadBatch(
    workspaceId: string,
    batchId: string,
  ): Promise<Readonly<BulkIngestionEnrichmentBatch> | undefined>;
  beginAttempt(
    input: Readonly<{
      workspaceId: string;
      batchId: string;
      runId: string;
      mode: BulkIngestionEnrichmentMode;
      maximumItems: number;
      rulesSha256: string;
    }>,
  ): Promise<BulkIngestionEnrichmentBeginOutcome>;
  claimItems(
    workspaceId: string,
    batchId: string,
    runId: string,
    maximumItems: number,
    rulesSha256: string,
  ): Promise<readonly Readonly<BulkIngestionEnrichmentItem>[]>;
  settleItem(
    input: Readonly<{
      workspaceId: string;
      batchId: string;
      ordinal: number;
      runId: string;
      expectedVersion: number;
      status: 'succeeded' | 'failed';
      resultEntryCount?: number;
      revisedEntryCount?: number;
      addedTagCount?: number;
      associationProjectionCount?: number;
      exceptionEntryCount?: number;
      errorCode?: string;
      exceptions: readonly Readonly<BulkIngestionEnrichmentException>[];
    }>,
  ): Promise<BulkIngestionEnrichmentWriteOutcome>;
  finishAttempt(
    workspaceId: string,
    batchId: string,
    runId: string,
  ): Promise<BulkIngestionEnrichmentWriteOutcome>;
}

export interface ExecuteBulkIngestionEnrichmentRequest {
  readonly batchId: string;
  readonly mode: BulkIngestionEnrichmentMode;
  readonly maxItems: number;
}

export interface ExecuteBulkIngestionEnrichmentResult {
  readonly outcome: 'succeeded' | 'paused' | 'failed';
  readonly batch: Readonly<BulkIngestionEnrichmentBatch>;
  readonly rulesSha256: string;
}
