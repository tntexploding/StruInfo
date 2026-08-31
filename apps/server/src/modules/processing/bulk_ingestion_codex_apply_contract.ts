import type {EntryDomainKeyword, EntryTypeKeyword} from '../entries/index.js';
import type {BulkIngestionCodexReviewPacket} from './bulk_ingestion_codex_review_contract.js';

export const BULK_INGESTION_CODEX_REVIEW_ACTIONS = [
  'annotate',
  'accept',
  'manual_review',
  'deferred',
] as const;

export type BulkIngestionCodexReviewAction =
  (typeof BULK_INGESTION_CODEX_REVIEW_ACTIONS)[number];

export interface BulkIngestionCodexAnnotation {
  readonly contentKeywords: readonly string[];
  readonly typeKeyword: EntryTypeKeyword;
  readonly typeCustomName?: string;
  readonly domains: readonly Readonly<{
    keyword: EntryDomainKeyword;
    customName?: string;
  }>[];
}

interface BulkIngestionCodexDecisionIdentity {
  readonly entryId: string;
  readonly entryRevision: number;
  readonly entryRevisionId: string;
  readonly adjudicationVersion: number;
}

export type BulkIngestionCodexReviewDecision =
  | Readonly<
      BulkIngestionCodexDecisionIdentity & {
        action: 'annotate';
        annotation: Readonly<BulkIngestionCodexAnnotation>;
      }
    >
  | Readonly<
      BulkIngestionCodexDecisionIdentity & {
        action: 'accept' | 'manual_review' | 'deferred';
      }
    >;

export interface BulkIngestionCodexReviewResultFile {
  readonly schemaVersion: 'struinfo.m2-p0f.codex-review-result.v1';
  readonly packetId: string;
  readonly packetSha256: string;
  readonly decisions: readonly Readonly<BulkIngestionCodexReviewDecision>[];
}

export interface ApplyBulkIngestionCodexReviewRequest {
  readonly packetId: string;
}

export interface ApplyBulkIngestionCodexReviewResult {
  readonly outcome: 'applied' | 'unchanged';
  readonly packetId: string;
  readonly itemCount: number;
  readonly annotatedCount: number;
  readonly acceptedCount: number;
  readonly manualReviewCount: number;
  readonly deferredCount: number;
  readonly revisedEntryCount: number;
  readonly adjudicatedCount: number;
  readonly associationProjectionCount: number;
}

export interface DecodedBulkIngestionCodexReviewFiles {
  readonly packet: Readonly<BulkIngestionCodexReviewPacket>;
  readonly result: Readonly<BulkIngestionCodexReviewResultFile>;
}
