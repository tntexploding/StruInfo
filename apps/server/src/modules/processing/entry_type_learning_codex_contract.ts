import type {
  EntryTypeLearningEvaluation,
  EntryTypeTrustedExampleAuthority,
  LearnedEntryTypeKeyword,
} from '../entries/index.js';
import type {
  BulkIngestionCodexReviewFileStorePort,
  BulkIngestionCodexReviewStoredPackage,
} from './bulk_ingestion_codex_review_contract.js';

export const ENTRY_TYPE_LEARNING_CODEX_PACKET_SCHEMA =
  'struinfo.m2-p4.codex-type-training-packet.v1';
export const ENTRY_TYPE_LEARNING_CODEX_RESULT_SCHEMA =
  'struinfo.m2-p4.codex-type-training-result.v1';
export const ENTRY_TYPE_LEARNING_CODEX_MAXIMUM_ITEMS = 100;

export interface EntryTypeLearningCodexPacketItem {
  readonly ordinal: number;
  readonly reason:
    | 'missing_type'
    | 'other_type'
    | 'untrusted_existing_type'
    | 'model_disagreement'
    | 'model_low_margin';
  readonly snapshotId: string;
  readonly isPrivate: boolean;
  readonly entryId: string;
  readonly entryRevision: number;
  readonly entryRevisionId: string;
  readonly titlePath: string;
  readonly body: string;
  readonly contentKeywords: readonly string[];
  readonly currentTypeKeyword?: string;
  readonly targetTypeKeyword?: LearnedEntryTypeKeyword;
}

export interface EntryTypeLearningCodexPacket {
  readonly schemaVersion: typeof ENTRY_TYPE_LEARNING_CODEX_PACKET_SCHEMA;
  readonly packetId: string;
  readonly packetSha256: string;
  readonly workspaceId: string;
  readonly expectedProfileRevision: number;
  readonly includePrivate: boolean;
  readonly items: readonly Readonly<EntryTypeLearningCodexPacketItem>[];
}

export type EntryTypeLearningCodexDecision =
  | Readonly<{
      entryId: string;
      entryRevision: number;
      entryRevisionId: string;
      action: 'trust';
      typeKeyword: LearnedEntryTypeKeyword;
      authority: EntryTypeTrustedExampleAuthority;
    }>
  | Readonly<{
      entryId: string;
      entryRevision: number;
      entryRevisionId: string;
      action: 'reject';
    }>;

export interface EntryTypeLearningCodexResult {
  readonly schemaVersion: typeof ENTRY_TYPE_LEARNING_CODEX_RESULT_SCHEMA;
  readonly packetId: string;
  readonly packetSha256: string;
  readonly decisions: readonly Readonly<EntryTypeLearningCodexDecision>[];
}

export interface ExportEntryTypeLearningCodexRequest {
  readonly includePrivate: boolean;
  readonly limit: number;
}

export type ExportEntryTypeLearningCodexResult =
  | Readonly<{outcome: 'empty'}>
  | Readonly<{
      outcome: BulkIngestionCodexReviewStoredPackage['outcome'];
      packetId: string;
      packetSha256: string;
      itemCount: number;
      privateItemCount: number;
      packetFileName: string;
      resultFileName: string;
      packetByteLength: number;
      packetFileSha256: string;
    }>;

export interface ApplyEntryTypeLearningCodexResult {
  readonly outcome: 'applied' | 'stale';
  readonly profileRevision: number;
  readonly trustedExampleCount: number;
  readonly acceptedCount: number;
  readonly rejectedCount: number;
  readonly evaluation?: Readonly<EntryTypeLearningEvaluation>;
}

export interface ActivateEntryTypeLearningResult {
  readonly outcome: 'activated' | 'stale' | 'not_eligible';
  readonly profileRevision: number;
  readonly trainingDigest?: string;
}

export type EntryTypeLearningCodexFileStorePort =
  BulkIngestionCodexReviewFileStorePort;
