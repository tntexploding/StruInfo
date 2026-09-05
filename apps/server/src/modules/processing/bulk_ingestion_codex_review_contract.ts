import type {EntryDomainKeyword, EntryTypeKeyword} from '../entries/index.js';
import type {BulkIngestionEnrichmentExceptionCode} from './bulk_ingestion_enrichment_contract.js';

export const BULK_INGESTION_CODEX_PACKET_SCHEMA_VERSION =
  'struinfo.m2-p0e.codex-review-packet.v1' as const;
export const BULK_INGESTION_CODEX_RESULT_SCHEMA_VERSION =
  'struinfo.m2-p0f.codex-review-result.v1' as const;
export const BULK_INGESTION_CODEX_LEGACY_PACKET_MAXIMUM_ITEMS = 20;
export const BULK_INGESTION_CODEX_CLASSIFICATION_PACKET_MAXIMUM_ITEMS = 100;
export const BULK_INGESTION_CODEX_PACKET_MAXIMUM_ITEMS =
  BULK_INGESTION_CODEX_CLASSIFICATION_PACKET_MAXIMUM_ITEMS;
export const BULK_INGESTION_CODEX_PACKET_MAXIMUM_BYTES = 16 * 1_024 * 1_024;
export const BULK_INGESTION_CODEX_RESULT_MAXIMUM_BYTES = 2 * 1_024 * 1_024;

export const BULK_INGESTION_CODEX_CLASSIFICATION_EXCEPTION_CODES = [
  'classification_no_signal',
  'classification_type_missing',
  'classification_domain_missing',
  'classification_tied',
] as const satisfies readonly BulkIngestionEnrichmentExceptionCode[];

export type BulkIngestionCodexClassificationExceptionCode =
  (typeof BULK_INGESTION_CODEX_CLASSIFICATION_EXCEPTION_CODES)[number];

export function isBulkIngestionCodexClassificationExceptionCode(
  value: unknown,
): value is BulkIngestionCodexClassificationExceptionCode {
  return (
    typeof value === 'string' &&
    (
      BULK_INGESTION_CODEX_CLASSIFICATION_EXCEPTION_CODES as readonly string[]
    ).includes(value)
  );
}

export interface BulkIngestionCodexReviewPacketItem {
  readonly ordinal: number;
  readonly snapshotId: string;
  readonly isPrivate: boolean;
  readonly entryId: string;
  readonly entryRevision: number;
  readonly entryRevisionId: string;
  readonly adjudicationVersion: number;
  readonly exceptionCode: BulkIngestionEnrichmentExceptionCode;
  readonly titlePath: string;
  readonly body: string;
  readonly currentAnnotations: Readonly<{
    contentKeywords: readonly string[];
    typeKeyword?: EntryTypeKeyword;
    typeCustomName?: string;
    domains: readonly Readonly<{
      keyword: EntryDomainKeyword;
      customName?: string;
    }>[];
  }>;
}

export interface BulkIngestionCodexReviewPacket {
  readonly schemaVersion: typeof BULK_INGESTION_CODEX_PACKET_SCHEMA_VERSION;
  readonly packetId: string;
  readonly packetSha256: string;
  readonly workspaceId: string;
  readonly batchId: string;
  readonly includePrivate: boolean;
  readonly items: readonly Readonly<BulkIngestionCodexReviewPacketItem>[];
}

export interface BulkIngestionCodexReviewStoredPackage {
  readonly outcome: 'created' | 'existing';
  readonly packetFileName: string;
  readonly resultFileName: string;
  readonly packetByteLength: number;
  readonly packetFileSha256: string;
}

export interface BulkIngestionCodexReviewFileStorePort {
  writePackage(
    input: Readonly<{
      packetId: string;
      packetBytes: Uint8Array;
      resultTemplateBytes: Uint8Array;
    }>,
  ): Promise<Readonly<BulkIngestionCodexReviewStoredPackage>>;
  readPacket(packetId: string): Promise<Uint8Array>;
  readResult(packetId: string): Promise<Uint8Array>;
}

export interface ExportBulkIngestionCodexReviewRequest {
  readonly batchId: string;
  readonly exceptionCode?: BulkIngestionEnrichmentExceptionCode;
  readonly includePrivate: boolean;
  readonly limit: number;
}

export type ExportBulkIngestionCodexReviewResult =
  | Readonly<{outcome: 'empty'}>
  | Readonly<{
      outcome: 'created' | 'existing';
      packetId: string;
      packetSha256: string;
      itemCount: number;
      privateItemCount: number;
      packetFileName: string;
      resultFileName: string;
      packetByteLength: number;
      packetFileSha256: string;
    }>;
