import type {ProcessingPrivacyScope} from './processing_contract.js';

export type BulkIngestionPipelineStage =
  'materialize' | 'enrich' | 'review' | 'complete';
export type BulkIngestionPipelineOutcome =
  'ready' | 'busy' | 'paused' | 'failed' | 'review_required' | 'complete';
export type BulkIngestionPipelineNextAction =
  'advance' | 'wait' | 'export_review_packet' | 'none';

export interface BulkIngestionPipelineStatus {
  readonly batchId: string;
  readonly stage: BulkIngestionPipelineStage;
  readonly outcome: BulkIngestionPipelineOutcome;
  readonly nextAction: BulkIngestionPipelineNextAction;
  readonly materialization: Readonly<{
    status: string;
    snapshotCount: number;
    succeededSnapshotCount: number;
    succeededEntryCount: number;
    failedSnapshotCount: number;
  }>;
  readonly enrichment?: Readonly<{
    status: string;
    succeededSnapshotCount: number;
    revisedEntryCount: number;
    addedTagCount: number;
    associationProjectionCount: number;
    exceptionEntryCount: number;
    failedSnapshotCount: number;
  }>;
  readonly review?: Readonly<{
    currentExceptionCount: number;
    pendingCount: number;
    acceptedCount: number;
    manualReviewCount: number;
    deferredCount: number;
    reviewComplete: boolean;
  }>;
}

export interface StartBulkIngestionPipelineRequest {
  readonly idempotencyKey: string;
  readonly privacyScope: ProcessingPrivacyScope;
  readonly limit: number;
  readonly maxItems: number;
}

export interface AdvanceBulkIngestionPipelineRequest {
  readonly batchId: string;
  readonly maxItems: number;
}

export type StartBulkIngestionPipelineResult =
  | Readonly<{outcome: 'empty'}>
  | Readonly<{
      outcome: 'started' | 'existing';
      status: BulkIngestionPipelineStatus;
    }>;
