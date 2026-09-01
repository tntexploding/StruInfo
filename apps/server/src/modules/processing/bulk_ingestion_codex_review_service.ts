import {createHash} from 'node:crypto';

import {encodeCanonicalJson} from '../../serialization/canonical_json.js';
import type {
  CurrentInformationEntry,
  InformationEntryRepositoryPort,
} from '../entries/index.js';
import type {BulkIngestionAdjudicationSample} from './bulk_ingestion_adjudication_contract.js';
import type {BulkIngestionAdjudicationService} from './bulk_ingestion_adjudication_service.js';
import {
  BULK_INGESTION_CODEX_CLASSIFICATION_PACKET_MAXIMUM_ITEMS,
  BULK_INGESTION_CODEX_LEGACY_PACKET_MAXIMUM_ITEMS,
  BULK_INGESTION_CODEX_PACKET_MAXIMUM_BYTES,
  BULK_INGESTION_CODEX_PACKET_SCHEMA_VERSION,
  BULK_INGESTION_CODEX_RESULT_SCHEMA_VERSION,
  isBulkIngestionCodexClassificationExceptionCode,
  type BulkIngestionCodexReviewFileStorePort,
  type BulkIngestionCodexReviewPacket,
  type BulkIngestionCodexReviewPacketItem,
  type ExportBulkIngestionCodexReviewRequest,
  type ExportBulkIngestionCodexReviewResult,
} from './bulk_ingestion_codex_review_contract.js';
import {BULK_INGESTION_ENRICHMENT_EXCEPTION_CODES} from './bulk_ingestion_enrichment_contract.js';
import {deriveProcessingRunId} from './processing_identity.js';

const CANONICAL_UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;

export type BulkIngestionCodexReviewServiceErrorCode =
  | 'input_invalid'
  | 'packet_too_large'
  | 'privacy_scope_required'
  | 'entry_snapshot_stale'
  | 'storage_failed';

export class BulkIngestionCodexReviewServiceError extends Error {
  public readonly code: BulkIngestionCodexReviewServiceErrorCode;

  public constructor(code: BulkIngestionCodexReviewServiceErrorCode) {
    super('The bulk ingestion Codex review operation failed.');
    this.name = 'BulkIngestionCodexReviewServiceError';
    this.code = code;
  }
}

export interface BulkIngestionCodexReviewServiceDependencies {
  readonly workspaceId: string;
  readonly adjudication: Pick<BulkIngestionAdjudicationService, 'sample'>;
  readonly entries: Pick<
    InformationEntryRepositoryPort,
    'loadCurrentEntries' | 'loadCurrentEntriesByIds'
  >;
  readonly fileStore: BulkIngestionCodexReviewFileStorePort;
}

export class BulkIngestionCodexReviewService {
  readonly #dependencies: Readonly<BulkIngestionCodexReviewServiceDependencies>;

  public constructor(
    dependencies: Readonly<BulkIngestionCodexReviewServiceDependencies>,
  ) {
    if (!CANONICAL_UUID.test(dependencies.workspaceId)) {
      throw new BulkIngestionCodexReviewServiceError('input_invalid');
    }
    this.#dependencies = dependencies;
  }

  public async export(
    request: Readonly<ExportBulkIngestionCodexReviewRequest>,
  ): Promise<Readonly<ExportBulkIngestionCodexReviewResult>> {
    if (!validRequest(request)) {
      throw new BulkIngestionCodexReviewServiceError('input_invalid');
    }
    const samples = await this.#dependencies.adjudication.sample({
      batchId: request.batchId,
      ...(request.exceptionCode === undefined
        ? {}
        : {exceptionCode: request.exceptionCode}),
      status: 'pending',
      scope: 'current',
      limit: request.limit,
    });
    if (samples.length === 0) {
      return Object.freeze({outcome: 'empty' as const});
    }
    if (!request.includePrivate && samples.some((item) => item.isPrivate)) {
      throw new BulkIngestionCodexReviewServiceError('privacy_scope_required');
    }
    const selectedEntryIds = Object.freeze(
      samples.map((sample) => sample.entryId),
    );
    const loadByIds = this.#dependencies.entries.loadCurrentEntriesByIds?.bind(
      this.#dependencies.entries,
    );
    const currentEntries = await (loadByIds === undefined
      ? this.#dependencies.entries.loadCurrentEntries(
          this.#dependencies.workspaceId,
          request.includePrivate,
        )
      : loadByIds(
          this.#dependencies.workspaceId,
          request.includePrivate,
          selectedEntryIds,
        ));
    const entryById = new Map(
      currentEntries.map((entry) => [entry.entryId, entry] as const),
    );
    const items = samples.map((sample) =>
      preparePacketItem(sample, entryById.get(sample.entryId)),
    );
    if (items.some((item) => item === undefined)) {
      throw new BulkIngestionCodexReviewServiceError('entry_snapshot_stale');
    }
    const definedItems = Object.freeze(
      items.filter(
        (item): item is Readonly<BulkIngestionCodexReviewPacketItem> =>
          item !== undefined,
      ),
    );
    const packetContent = Object.freeze({
      schemaVersion: BULK_INGESTION_CODEX_PACKET_SCHEMA_VERSION,
      workspaceId: this.#dependencies.workspaceId,
      batchId: request.batchId,
      includePrivate: request.includePrivate,
      items: definedItems,
    });
    const packetSha256 = digestCanonical(packetContent);
    const packetId = deriveProcessingRunId(
      this.#dependencies.workspaceId,
      `m2-p0e-codex-review:${packetSha256}`,
    );
    const packet: Readonly<BulkIngestionCodexReviewPacket> = Object.freeze({
      ...packetContent,
      packetId,
      packetSha256,
    });
    let packetBytes: Uint8Array;
    let templateBytes: Uint8Array;
    try {
      packetBytes = encodeCanonicalJson(
        packet,
        BULK_INGESTION_CODEX_PACKET_MAXIMUM_BYTES,
      );
      templateBytes = encodeCanonicalJson(
        prepareResultTemplate(packet),
        BULK_INGESTION_CODEX_PACKET_MAXIMUM_BYTES,
      );
    } catch {
      throw new BulkIngestionCodexReviewServiceError('packet_too_large');
    }
    try {
      const stored = await this.#dependencies.fileStore.writePackage({
        packetId,
        packetBytes,
        resultTemplateBytes: templateBytes,
      });
      return Object.freeze({
        outcome: stored.outcome,
        packetId,
        packetSha256,
        itemCount: packet.items.length,
        privateItemCount: packet.items.filter((item) => item.isPrivate).length,
        packetFileName: stored.packetFileName,
        resultFileName: stored.resultFileName,
        packetByteLength: stored.packetByteLength,
        packetFileSha256: stored.packetFileSha256,
      });
    } catch {
      throw new BulkIngestionCodexReviewServiceError('storage_failed');
    }
  }
}

function preparePacketItem(
  sample: Readonly<BulkIngestionAdjudicationSample>,
  entry: Readonly<CurrentInformationEntry> | undefined,
): Readonly<BulkIngestionCodexReviewPacketItem> | undefined {
  if (
    entry?.entryId !== sample.entryId ||
    entry.snapshotId !== sample.snapshotId ||
    entry.revision !== sample.entryRevision ||
    entry.revisionId !== sample.entryRevisionId ||
    entry.value.isPrivate !== sample.isPrivate ||
    !sample.isCurrent ||
    sample.status !== 'pending'
  ) {
    return undefined;
  }
  return Object.freeze({
    ordinal: sample.ordinal,
    snapshotId: sample.snapshotId,
    isPrivate: sample.isPrivate,
    entryId: sample.entryId,
    entryRevision: sample.entryRevision,
    entryRevisionId: sample.entryRevisionId,
    adjudicationVersion: sample.version,
    exceptionCode: sample.exceptionCode,
    titlePath: entry.value.titlePath,
    body: entry.value.body,
    currentAnnotations: Object.freeze({
      contentKeywords: Object.freeze(
        entry.value.contentKeywords.map((keyword) => keyword.displayValue),
      ),
      ...(entry.value.typeKeyword === undefined
        ? {}
        : {typeKeyword: entry.value.typeKeyword}),
      ...(entry.value.typeCustomName === undefined
        ? {}
        : {typeCustomName: entry.value.typeCustomName}),
      domains: Object.freeze(
        entry.value.domains.map((domain) =>
          Object.freeze({
            keyword: domain.keyword,
            ...(domain.customName === undefined
              ? {}
              : {customName: domain.customName}),
          }),
        ),
      ),
    }),
  });
}

function prepareResultTemplate(
  packet: Readonly<BulkIngestionCodexReviewPacket>,
): unknown {
  return Object.freeze({
    schemaVersion: BULK_INGESTION_CODEX_RESULT_SCHEMA_VERSION,
    packetId: packet.packetId,
    packetSha256: packet.packetSha256,
    decisions: Object.freeze(
      packet.items.map((item) =>
        Object.freeze({
          entryId: item.entryId,
          entryRevision: item.entryRevision,
          entryRevisionId: item.entryRevisionId,
          adjudicationVersion: item.adjudicationVersion,
          action: 'replace_me',
          ...(isBulkIngestionCodexClassificationExceptionCode(
            item.exceptionCode,
          )
            ? {
                annotation: Object.freeze({
                  contentKeywords: Object.freeze([
                    ...item.currentAnnotations.contentKeywords,
                  ]),
                  typeKeyword:
                    item.currentAnnotations.typeKeyword ?? 'replace_me',
                  ...(item.currentAnnotations.typeCustomName === undefined
                    ? {}
                    : {
                        typeCustomName: item.currentAnnotations.typeCustomName,
                      }),
                  domains: Object.freeze(
                    item.currentAnnotations.domains.length === 0
                      ? [Object.freeze({keyword: 'replace_me'})]
                      : item.currentAnnotations.domains.map((domain) =>
                          Object.freeze({...domain}),
                        ),
                  ),
                }),
              }
            : {}),
        }),
      ),
    ),
  });
}

function validRequest(
  request: Readonly<ExportBulkIngestionCodexReviewRequest>,
): boolean {
  const maximumItems = isBulkIngestionCodexClassificationExceptionCode(
    request.exceptionCode,
  )
    ? BULK_INGESTION_CODEX_CLASSIFICATION_PACKET_MAXIMUM_ITEMS
    : BULK_INGESTION_CODEX_LEGACY_PACKET_MAXIMUM_ITEMS;
  return (
    CANONICAL_UUID.test(request.batchId) &&
    (request.exceptionCode === undefined ||
      BULK_INGESTION_ENRICHMENT_EXCEPTION_CODES.includes(
        request.exceptionCode,
      )) &&
    typeof request.includePrivate === 'boolean' &&
    Number.isSafeInteger(request.limit) &&
    request.limit >= 1 &&
    request.limit <= maximumItems
  );
}

function digestCanonical(value: unknown): string {
  return createHash('sha256')
    .update(
      encodeCanonicalJson(value, BULK_INGESTION_CODEX_PACKET_MAXIMUM_BYTES),
    )
    .digest('hex');
}
