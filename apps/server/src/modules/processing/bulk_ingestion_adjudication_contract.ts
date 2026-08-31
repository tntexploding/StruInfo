import type {
  BulkIngestionEnrichmentExceptionCode,
  BulkIngestionEnrichmentRepositoryPort,
} from './bulk_ingestion_enrichment_contract.js';

export const BULK_INGESTION_ADJUDICATION_STATUSES = [
  'pending',
  'accepted',
  'manual_review',
  'deferred',
] as const;

export type BulkIngestionAdjudicationStatus =
  (typeof BULK_INGESTION_ADJUDICATION_STATUSES)[number];
export type BulkIngestionAdjudicationSampleScope = 'current' | 'stale' | 'all';

export interface BulkIngestionAdjudicationException {
  readonly workspaceId: string;
  readonly batchId: string;
  readonly ordinal: number;
  readonly snapshotId: string;
  readonly isPrivate: boolean;
  readonly entryId: string;
  readonly entryRevision: number;
  readonly entryRevisionId: string;
  readonly currentEntryRevision: number;
  readonly currentEntryRevisionId: string;
  readonly isCurrent: boolean;
  readonly exceptionCode: BulkIngestionEnrichmentExceptionCode;
  readonly status: BulkIngestionAdjudicationStatus;
  readonly version: number;
}

export interface BulkIngestionAdjudicationGroup {
  readonly exceptionCode: BulkIngestionEnrichmentExceptionCode;
  readonly totalCount: number;
  readonly currentCount: number;
  readonly staleCount: number;
  readonly pendingCount: number;
  readonly acceptedCount: number;
  readonly manualReviewCount: number;
  readonly deferredCount: number;
}

export interface BulkIngestionAdjudicationSummary {
  readonly batchId: string;
  readonly totalExceptionCount: number;
  readonly currentExceptionCount: number;
  readonly staleExceptionCount: number;
  readonly pendingCount: number;
  readonly acceptedCount: number;
  readonly manualReviewCount: number;
  readonly deferredCount: number;
  readonly reviewComplete: boolean;
  readonly groups: readonly Readonly<BulkIngestionAdjudicationGroup>[];
}

export interface BulkIngestionAdjudicationSample {
  readonly sampleRank: number;
  readonly ordinal: number;
  readonly snapshotId: string;
  readonly isPrivate: boolean;
  readonly entryId: string;
  readonly entryRevision: number;
  readonly entryRevisionId: string;
  readonly isCurrent: boolean;
  readonly exceptionCode: BulkIngestionEnrichmentExceptionCode;
  readonly status: BulkIngestionAdjudicationStatus;
  readonly version: number;
}

export type BulkIngestionAdjudicationWriteOutcome =
  'applied' | 'not_found' | 'stale';

export interface BulkIngestionAdjudicationRepositoryPort {
  ensureAdjudications(workspaceId: string, batchId: string): Promise<boolean>;
  loadExceptions(
    workspaceId: string,
    batchId: string,
  ): Promise<readonly Readonly<BulkIngestionAdjudicationException>[]>;
  transition(
    input: Readonly<{
      workspaceId: string;
      batchId: string;
      exceptionCode: BulkIngestionEnrichmentExceptionCode;
      fromStatus: BulkIngestionAdjudicationStatus;
      toStatus: BulkIngestionAdjudicationStatus;
      expectedCount: number;
    }>,
  ): Promise<
    Readonly<{
      outcome: BulkIngestionAdjudicationWriteOutcome;
      appliedCount: number;
    }>
  >;
  transitionExact(
    input: Readonly<{
      workspaceId: string;
      batchId: string;
      decisions: readonly Readonly<BulkIngestionAdjudicationExactDecision>[];
    }>,
  ): Promise<
    Readonly<{
      outcome: BulkIngestionAdjudicationWriteOutcome;
      appliedCount: number;
    }>
  >;
}

export interface BulkIngestionAdjudicationExactDecision {
  readonly ordinal: number;
  readonly entryId: string;
  readonly entryRevision: number;
  readonly entryRevisionId: string;
  readonly expectedVersion: number;
  readonly fromStatus: BulkIngestionAdjudicationStatus;
  readonly toStatus: BulkIngestionAdjudicationStatus;
  readonly expectedCurrentEntryRevision: number;
  readonly expectedCurrentEntryRevisionId: string;
}

export interface SampleBulkIngestionAdjudicationRequest {
  readonly batchId: string;
  readonly exceptionCode?: BulkIngestionEnrichmentExceptionCode;
  readonly status?: BulkIngestionAdjudicationStatus;
  readonly scope: BulkIngestionAdjudicationSampleScope;
  readonly limit: number;
}

export interface DecideBulkIngestionAdjudicationRequest {
  readonly batchId: string;
  readonly exceptionCode: BulkIngestionEnrichmentExceptionCode;
  readonly fromStatus: BulkIngestionAdjudicationStatus;
  readonly toStatus: BulkIngestionAdjudicationStatus;
  readonly expectedCount: number;
}

export interface DecideBulkIngestionAdjudicationResult {
  readonly outcome: 'applied' | 'stale';
  readonly appliedCount: number;
  readonly summary: Readonly<BulkIngestionAdjudicationSummary>;
}

export interface DecideExactBulkIngestionAdjudicationRequest {
  readonly batchId: string;
  readonly decisions: readonly Readonly<BulkIngestionAdjudicationExactDecision>[];
}

export type BulkIngestionAdjudicationPrerequisite = Pick<
  BulkIngestionEnrichmentRepositoryPort,
  'ensureItems'
>;
