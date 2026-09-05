import type {
  DeterministicClassificationDiagnosticReason,
  EntryTypeKeyword,
} from '../entries/index.js';
import type {
  BulkIngestionEnrichmentExceptionCode,
  BulkIngestionEnrichmentMode,
  BulkIngestionEnrichmentStatus,
} from './bulk_ingestion_enrichment_contract.js';
import type {ProcessingPrivacyScope} from './processing_contract.js';

export const BULK_INGESTION_TYPE_COMPLETION_NEXT_ACTIONS = [
  'none',
  'apply_type_completion',
  'continue_apply',
  'export_codex_review',
] as const;

export type BulkIngestionTypeCompletionNextAction =
  (typeof BULK_INGESTION_TYPE_COMPLETION_NEXT_ACTIONS)[number];

export interface PreviewBulkIngestionTypeCompletionRequest {
  readonly batchId: string;
  readonly privacyScope: ProcessingPrivacyScope;
  readonly sampleLimit: number;
}

export interface BulkIngestionTypeCompletionSample {
  readonly sampleRank: number;
  readonly entryId: string;
  readonly entryRevision: number;
  readonly exceptionCode: BulkIngestionEnrichmentExceptionCode;
  readonly reason: DeterministicClassificationDiagnosticReason;
  readonly predictedType?: EntryTypeKeyword;
  readonly winnerScore: number;
  readonly runnerUpScore: number;
  readonly evidenceSource?: 'neighbor_consensus' | 'learned_type_model';
  readonly referenceCount?: number;
  readonly consensusBasisPoints?: number;
}

export interface BulkIngestionTypeCompletionPreview {
  readonly batchId: string;
  readonly privacyScope: ProcessingPrivacyScope;
  readonly ruleVersion: string;
  readonly profileRevision: number;
  readonly candidateExceptionCount: number;
  readonly staleExceptionCount: number;
  readonly protectedDecisionCount: number;
  readonly scopeExcludedCount: number;
  readonly staleEntryCount: number;
  readonly alreadyClassifiedCount: number;
  readonly missingTypeCount: number;
  readonly assignableCount: number;
  readonly neighborAssignableCount?: number;
  readonly unresolvedCount: number;
  readonly byPredictedType: readonly Readonly<{
    typeKeyword: EntryTypeKeyword;
    count: number;
  }>[];
  readonly byReason: readonly Readonly<{
    reason: DeterministicClassificationDiagnosticReason;
    count: number;
  }>[];
  readonly byExceptionCode: readonly Readonly<{
    exceptionCode: BulkIngestionEnrichmentExceptionCode;
    count: number;
  }>[];
  readonly samples: readonly Readonly<BulkIngestionTypeCompletionSample>[];
  readonly nextAction: Exclude<
    BulkIngestionTypeCompletionNextAction,
    'continue_apply'
  >;
}

export interface ApplyBulkIngestionTypeCompletionRequest {
  readonly batchId: string;
  readonly maxItems: number;
  readonly sampleLimit: number;
}

export interface ApplyBulkIngestionTypeCompletionResult {
  readonly outcome: 'unchanged' | 'succeeded' | 'paused' | 'failed';
  readonly enrichmentMode?: BulkIngestionEnrichmentMode;
  readonly enrichmentStatus: BulkIngestionEnrichmentStatus;
  readonly rulesSha256?: string;
  readonly before: Readonly<BulkIngestionTypeCompletionPreview>;
  readonly after: Readonly<BulkIngestionTypeCompletionPreview>;
  readonly nextAction: BulkIngestionTypeCompletionNextAction;
}
