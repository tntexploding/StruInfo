import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';

import {
  decodeCanonicalJson,
  encodeCanonicalJson,
  type JsonObject,
  type JsonValue,
} from '../../serialization/canonical_json.js';
import {
  DEFAULT_REVIEW_ASSOCIATION_POLICY_PREFERENCES,
  type ReviewPreferencesStore,
} from '../../storage/review_preferences_store.js';
import {
  buildIncrementalInformationEntryAssociationProjection,
  deriveInformationEntryRevisionId,
  ENTRY_DOMAIN_KEYWORDS,
  ENTRY_TYPE_KEYWORDS,
  INFORMATION_ENTRY_ASSOCIATION_POLICY,
  prepareAiEntryTagRevision,
  type EntryDomainKeyword,
  type EntryTypeKeyword,
  type InformationEntryAssociationIncrementalRepositoryPort,
  type InformationEntryAssociationPolicy,
  type InformationEntryBulkRevisionRepositoryPort,
  type InformationEntryRepositoryPort,
  type InformationEntryRevisionWrite,
} from '../entries/index.js';
import type {
  BulkIngestionAdjudicationException,
  BulkIngestionAdjudicationExactDecision,
} from './bulk_ingestion_adjudication_contract.js';
import type {BulkIngestionAdjudicationService} from './bulk_ingestion_adjudication_service.js';
import {
  BULK_INGESTION_CODEX_REVIEW_ACTIONS,
  type ApplyBulkIngestionCodexReviewRequest,
  type ApplyBulkIngestionCodexReviewResult,
  type BulkIngestionCodexAnnotation,
  type BulkIngestionCodexReviewDecision,
  type BulkIngestionCodexReviewResultFile,
  type DecodedBulkIngestionCodexReviewFiles,
} from './bulk_ingestion_codex_apply_contract.js';
import {
  BULK_INGESTION_CODEX_LEGACY_PACKET_MAXIMUM_ITEMS,
  BULK_INGESTION_CODEX_PACKET_MAXIMUM_BYTES,
  BULK_INGESTION_CODEX_PACKET_MAXIMUM_ITEMS,
  BULK_INGESTION_CODEX_PACKET_SCHEMA_VERSION,
  BULK_INGESTION_CODEX_RESULT_MAXIMUM_BYTES,
  BULK_INGESTION_CODEX_RESULT_SCHEMA_VERSION,
  isBulkIngestionCodexClassificationExceptionCode,
  type BulkIngestionCodexReviewFileStorePort,
  type BulkIngestionCodexReviewPacket,
  type BulkIngestionCodexReviewPacketItem,
} from './bulk_ingestion_codex_review_contract.js';
import {BULK_INGESTION_ENRICHMENT_EXCEPTION_CODES} from './bulk_ingestion_enrichment_contract.js';
import {deriveProcessingRunId} from './processing_identity.js';

const CANONICAL_UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;
const SHA256 = /^[0-9a-f]{64}$/u;
const ORIGIN_PREFIX = 'struinfo.m2-p0f.codex-review.v1';

export type BulkIngestionCodexApplyServiceErrorCode =
  | 'input_invalid'
  | 'files_invalid'
  | 'packet_stale'
  | 'entry_revision_failed'
  | 'adjudication_stale'
  | 'association_rebuild_failed'
  | 'storage_failed';

export class BulkIngestionCodexApplyServiceError extends Error {
  public readonly code: BulkIngestionCodexApplyServiceErrorCode;

  public constructor(code: BulkIngestionCodexApplyServiceErrorCode) {
    super('The bulk ingestion Codex result application failed.');
    this.name = 'BulkIngestionCodexApplyServiceError';
    this.code = code;
  }
}

export interface BulkIngestionCodexApplyServiceDependencies {
  readonly workspaceId: string;
  readonly fileStore: BulkIngestionCodexReviewFileStorePort;
  readonly entries: InformationEntryRepositoryPort &
    InformationEntryBulkRevisionRepositoryPort;
  readonly adjudication: Pick<
    BulkIngestionAdjudicationService,
    'list' | 'decideExact'
  >;
  readonly associations: InformationEntryAssociationIncrementalRepositoryPort;
  readonly preferences: ReviewPreferencesStore;
}

export class BulkIngestionCodexApplyService {
  readonly #dependencies: Readonly<BulkIngestionCodexApplyServiceDependencies>;

  public constructor(
    dependencies: Readonly<BulkIngestionCodexApplyServiceDependencies>,
  ) {
    if (!CANONICAL_UUID.test(dependencies.workspaceId)) {
      throw new BulkIngestionCodexApplyServiceError('input_invalid');
    }
    this.#dependencies = dependencies;
  }

  public async apply(
    request: Readonly<ApplyBulkIngestionCodexReviewRequest>,
  ): Promise<Readonly<ApplyBulkIngestionCodexReviewResult>> {
    if (!CANONICAL_UUID.test(request.packetId)) {
      throw new BulkIngestionCodexApplyServiceError('input_invalid');
    }
    let files: Readonly<DecodedBulkIngestionCodexReviewFiles>;
    try {
      files = decodeBulkIngestionCodexReviewFiles(
        await this.#dependencies.fileStore.readPacket(request.packetId),
        await this.#dependencies.fileStore.readResult(request.packetId),
        this.#dependencies.workspaceId,
      );
    } catch (error) {
      if (error instanceof BulkIngestionCodexApplyServiceError) throw error;
      throw new BulkIngestionCodexApplyServiceError('storage_failed');
    }
    const {packet, result} = files;
    const currentEntries = await this.#dependencies.entries.loadCurrentEntries(
      this.#dependencies.workspaceId,
      packet.includePrivate,
    );
    const entryById = new Map(
      currentEntries.map((entry) => [entry.entryId, entry] as const),
    );
    const writes: InformationEntryRevisionWrite[] = [];
    const annotatedEntryIds: string[] = [];
    for (const [index, item] of packet.items.entries()) {
      const decision = result.decisions[index];
      if (decision === undefined) {
        throw new BulkIngestionCodexApplyServiceError('files_invalid');
      }
      const current = entryById.get(item.entryId);
      if (current?.value.isPrivate !== item.isPrivate) {
        throw new BulkIngestionCodexApplyServiceError('packet_stale');
      }
      if (decision.action === 'annotate') {
        const desired = prepareAiEntryTagRevision(current, {
          ...decision.annotation,
          originVersion: `${ORIGIN_PREFIX}:${packet.packetSha256}`,
        });
        const targetRevisionId = deriveInformationEntryRevisionId(
          item.entryId,
          item.entryRevision + 1,
        );
        if (desired === undefined) {
          throw new BulkIngestionCodexApplyServiceError('files_invalid');
        }
        if (
          current.revision === item.entryRevision &&
          current.revisionId === item.entryRevisionId
        ) {
          writes.push(
            Object.freeze({
              workspaceId: this.#dependencies.workspaceId,
              entryId: item.entryId,
              expectedRevision: item.entryRevision,
              revisionId: targetRevisionId,
              value: desired,
            }),
          );
        } else if (
          current.revision !== item.entryRevision + 1 ||
          current.revisionId !== targetRevisionId ||
          !isDeepStrictEqual(current.value, desired)
        ) {
          throw new BulkIngestionCodexApplyServiceError('packet_stale');
        }
        annotatedEntryIds.push(item.entryId);
      } else if (
        current.revision !== item.entryRevision ||
        current.revisionId !== item.entryRevisionId
      ) {
        throw new BulkIngestionCodexApplyServiceError('packet_stale');
      }
    }

    let revisedEntryCount = 0;
    if (writes.length > 0) {
      const revised = await this.#dependencies.entries.reviseEntriesAtomically(
        Object.freeze(writes),
      );
      if (revised.outcome === 'not_found' || revised.outcome === 'stale') {
        throw new BulkIngestionCodexApplyServiceError('entry_revision_failed');
      }
      revisedEntryCount = revised.appliedCount;
    }
    await this.#verifyAnnotatedEntries(packet, result);

    const exceptions = await this.#dependencies.adjudication.list(
      packet.batchId,
    );
    const transitions = prepareTransitions(packet, result, exceptions);
    let adjudicatedCount = 0;
    if (transitions.length > 0) {
      const adjudicated = await this.#dependencies.adjudication.decideExact({
        batchId: packet.batchId,
        decisions: transitions,
      });
      if (adjudicated.outcome !== 'applied') {
        throw new BulkIngestionCodexApplyServiceError('adjudication_stale');
      }
      adjudicatedCount = adjudicated.appliedCount;
    }

    let associationProjectionCount = 0;
    if (annotatedEntryIds.length > 0) {
      try {
        const entries = await this.#dependencies.entries.loadCurrentEntries(
          this.#dependencies.workspaceId,
          packet.includePrivate,
        );
        const policy = resolveAssociationPolicy(
          await this.#dependencies.preferences.load(
            this.#dependencies.workspaceId,
          ),
        );
        const projections =
          buildIncrementalInformationEntryAssociationProjection(
            entries,
            annotatedEntryIds,
            policy,
          );
        associationProjectionCount =
          await this.#dependencies.associations.replaceAssociationProjectionsForEntries(
            this.#dependencies.workspaceId,
            Object.freeze([...new Set(annotatedEntryIds)]),
            projections,
            packet.includePrivate,
          );
      } catch {
        throw new BulkIngestionCodexApplyServiceError(
          'association_rebuild_failed',
        );
      }
    }
    return Object.freeze({
      outcome:
        revisedEntryCount > 0 || adjudicatedCount > 0
          ? ('applied' as const)
          : ('unchanged' as const),
      packetId: packet.packetId,
      itemCount: packet.items.length,
      annotatedCount: countActions(result, 'annotate'),
      acceptedCount: countActions(result, 'accept'),
      manualReviewCount: countActions(result, 'manual_review'),
      deferredCount: countActions(result, 'deferred'),
      revisedEntryCount,
      adjudicatedCount,
      associationProjectionCount,
    });
  }

  async #verifyAnnotatedEntries(
    packet: Readonly<BulkIngestionCodexReviewPacket>,
    result: Readonly<BulkIngestionCodexReviewResultFile>,
  ): Promise<void> {
    const current = await this.#dependencies.entries.loadCurrentEntries(
      this.#dependencies.workspaceId,
      packet.includePrivate,
    );
    const byId = new Map(
      current.map((entry) => [entry.entryId, entry] as const),
    );
    for (const [index, item] of packet.items.entries()) {
      const decision = result.decisions[index];
      if (decision?.action !== 'annotate') continue;
      const entry = byId.get(item.entryId);
      if (
        entry?.revision !== item.entryRevision + 1 ||
        entry.revisionId !==
          deriveInformationEntryRevisionId(item.entryId, item.entryRevision + 1)
      ) {
        throw new BulkIngestionCodexApplyServiceError('entry_revision_failed');
      }
      const desired = prepareAiEntryTagRevision(entry, {
        ...decision.annotation,
        originVersion: `${ORIGIN_PREFIX}:${packet.packetSha256}`,
      });
      if (desired === undefined || !isDeepStrictEqual(entry.value, desired)) {
        throw new BulkIngestionCodexApplyServiceError('entry_revision_failed');
      }
    }
  }
}

export function decodeBulkIngestionCodexReviewFiles(
  packetBytes: Uint8Array,
  resultBytes: Uint8Array,
  expectedWorkspaceId: string,
): Readonly<DecodedBulkIngestionCodexReviewFiles> {
  try {
    const packet = decodePacket(
      decodeCanonicalJson(
        packetBytes,
        BULK_INGESTION_CODEX_PACKET_MAXIMUM_BYTES,
      ),
    );
    if (packet.workspaceId !== expectedWorkspaceId)
      throw new Error('workspace');
    verifyPacketIdentity(packet);
    const result = decodeResult(
      decodeCanonicalJson(
        resultBytes,
        BULK_INGESTION_CODEX_RESULT_MAXIMUM_BYTES,
      ),
      packet,
    );
    return Object.freeze({packet, result});
  } catch {
    throw new BulkIngestionCodexApplyServiceError('files_invalid');
  }
}

function prepareTransitions(
  packet: Readonly<BulkIngestionCodexReviewPacket>,
  result: Readonly<BulkIngestionCodexReviewResultFile>,
  exceptions: readonly Readonly<BulkIngestionAdjudicationException>[],
): readonly Readonly<BulkIngestionAdjudicationExactDecision>[] {
  const byIdentity = new Map(
    exceptions.map(
      (exception) =>
        [
          `${exception.ordinal.toString()}:${exception.entryId}`,
          exception,
        ] as const,
    ),
  );
  const transitions: BulkIngestionAdjudicationExactDecision[] = [];
  for (const [index, item] of packet.items.entries()) {
    const decision = result.decisions[index];
    const exception = byIdentity.get(
      `${item.ordinal.toString()}:${item.entryId}`,
    );
    if (decision === undefined || exception === undefined) {
      throw new BulkIngestionCodexApplyServiceError('adjudication_stale');
    }
    const target =
      decision.action === 'manual_review'
        ? ('manual_review' as const)
        : decision.action === 'deferred'
          ? ('deferred' as const)
          : ('accepted' as const);
    if (
      exception.entryRevision !== item.entryRevision ||
      exception.entryRevisionId !== item.entryRevisionId ||
      exception.exceptionCode !== item.exceptionCode
    ) {
      throw new BulkIngestionCodexApplyServiceError('adjudication_stale');
    }
    if (
      exception.status === target &&
      exception.version === item.adjudicationVersion + 1
    ) {
      continue;
    }
    if (
      exception.status !== 'pending' ||
      exception.version !== item.adjudicationVersion ||
      (decision.action !== 'annotate' && !exception.isCurrent)
    ) {
      throw new BulkIngestionCodexApplyServiceError('adjudication_stale');
    }
    transitions.push(
      Object.freeze({
        ordinal: item.ordinal,
        entryId: item.entryId,
        entryRevision: item.entryRevision,
        entryRevisionId: item.entryRevisionId,
        expectedVersion: item.adjudicationVersion,
        fromStatus: 'pending' as const,
        toStatus: target,
        expectedCurrentEntryRevision:
          decision.action === 'annotate'
            ? item.entryRevision + 1
            : item.entryRevision,
        expectedCurrentEntryRevisionId:
          decision.action === 'annotate'
            ? deriveInformationEntryRevisionId(
                item.entryId,
                item.entryRevision + 1,
              )
            : item.entryRevisionId,
      }),
    );
  }
  return Object.freeze(transitions);
}

function resolveAssociationPolicy(
  preferences: Readonly<{
    associationPolicy?: Readonly<{
      revision: number;
      contentWeight: number;
      typeWeight: number;
      domainWeight: number;
      threshold: number;
    }>;
  }>,
): Readonly<InformationEntryAssociationPolicy> {
  const stored =
    preferences.associationPolicy ??
    DEFAULT_REVIEW_ASSOCIATION_POLICY_PREFERENCES;
  return Object.freeze({
    ...INFORMATION_ENTRY_ASSOCIATION_POLICY,
    revision: stored.revision,
    contentWeight: stored.contentWeight,
    typeWeight: stored.typeWeight,
    domainWeight: stored.domainWeight,
    threshold: stored.threshold,
  });
}

function countActions(
  result: Readonly<BulkIngestionCodexReviewResultFile>,
  action: BulkIngestionCodexReviewDecision['action'],
): number {
  return result.decisions.filter((decision) => decision.action === action)
    .length;
}

function decodePacket(
  value: JsonValue,
): Readonly<BulkIngestionCodexReviewPacket> {
  const root = exactObject(value, [
    'schemaVersion',
    'packetId',
    'packetSha256',
    'workspaceId',
    'batchId',
    'includePrivate',
    'items',
  ]);
  const items = exactArray(
    root.items,
    1,
    BULK_INGESTION_CODEX_PACKET_MAXIMUM_ITEMS,
  ).map(decodePacketItem);
  if (
    items.length > BULK_INGESTION_CODEX_LEGACY_PACKET_MAXIMUM_ITEMS &&
    items.some(
      (item) =>
        !isBulkIngestionCodexClassificationExceptionCode(item.exceptionCode),
    )
  ) {
    throw new Error('packet item limit');
  }
  return Object.freeze({
    schemaVersion: exactLiteral(
      root.schemaVersion,
      BULK_INGESTION_CODEX_PACKET_SCHEMA_VERSION,
    ),
    packetId: exactUuid(root.packetId),
    packetSha256: exactSha256(root.packetSha256),
    workspaceId: exactUuid(root.workspaceId),
    batchId: exactUuid(root.batchId),
    includePrivate: exactBoolean(root.includePrivate),
    items: Object.freeze(items),
  });
}

function decodePacketItem(
  value: JsonValue,
): Readonly<BulkIngestionCodexReviewPacketItem> {
  const item = exactObject(value, [
    'ordinal',
    'snapshotId',
    'isPrivate',
    'entryId',
    'entryRevision',
    'entryRevisionId',
    'adjudicationVersion',
    'exceptionCode',
    'titlePath',
    'body',
    'currentAnnotations',
  ]);
  const annotations = exactObject(
    item.currentAnnotations,
    ['contentKeywords', 'domains'],
    ['typeKeyword', 'typeCustomName'],
  );
  const typeKeyword = optionalEntryType(annotations.typeKeyword);
  const typeCustomName = optionalBoundedString(annotations.typeCustomName, 80);
  validateType(typeKeyword, typeCustomName, true);
  return Object.freeze({
    ordinal: exactInteger(item.ordinal, 0),
    snapshotId: exactUuid(item.snapshotId),
    isPrivate: exactBoolean(item.isPrivate),
    entryId: exactUuid(item.entryId),
    entryRevision: exactInteger(item.entryRevision, 1),
    entryRevisionId: exactUuid(item.entryRevisionId),
    adjudicationVersion: exactInteger(item.adjudicationVersion, 1),
    exceptionCode: exactEnum(
      item.exceptionCode,
      BULK_INGESTION_ENRICHMENT_EXCEPTION_CODES,
    ),
    titlePath: exactString(item.titlePath),
    body: exactString(item.body),
    currentAnnotations: Object.freeze({
      contentKeywords: Object.freeze(
        exactArray(annotations.contentKeywords, 0, 32).map((keyword) =>
          boundedString(keyword, 80),
        ),
      ),
      ...(typeKeyword === undefined ? {} : {typeKeyword}),
      ...(typeCustomName === undefined ? {} : {typeCustomName}),
      domains: Object.freeze(
        exactArray(annotations.domains, 0, 3).map(decodeDomain),
      ),
    }),
  });
}

function decodeResult(
  value: JsonValue,
  packet: Readonly<BulkIngestionCodexReviewPacket>,
): Readonly<BulkIngestionCodexReviewResultFile> {
  const root = exactObject(value, [
    'schemaVersion',
    'packetId',
    'packetSha256',
    'decisions',
  ]);
  exactLiteral(root.schemaVersion, BULK_INGESTION_CODEX_RESULT_SCHEMA_VERSION);
  if (
    exactUuid(root.packetId) !== packet.packetId ||
    exactSha256(root.packetSha256) !== packet.packetSha256
  ) {
    throw new Error('binding');
  }
  const values = exactArray(
    root.decisions,
    packet.items.length,
    packet.items.length,
  );
  const decisions = values.map((decision, index) =>
    decodeDecision(decision, requirePacketItem(packet, index)),
  );
  return Object.freeze({
    schemaVersion: BULK_INGESTION_CODEX_RESULT_SCHEMA_VERSION,
    packetId: packet.packetId,
    packetSha256: packet.packetSha256,
    decisions: Object.freeze(decisions),
  });
}

function decodeDecision(
  value: JsonValue,
  item: Readonly<BulkIngestionCodexReviewPacketItem>,
): Readonly<BulkIngestionCodexReviewDecision> {
  const preliminary = exactObject(
    value,
    [
      'entryId',
      'entryRevision',
      'entryRevisionId',
      'adjudicationVersion',
      'action',
    ],
    ['annotation'],
  );
  const action = exactEnum(
    preliminary.action,
    BULK_INGESTION_CODEX_REVIEW_ACTIONS,
  );
  if (
    exactUuid(preliminary.entryId) !== item.entryId ||
    exactInteger(preliminary.entryRevision, 1) !== item.entryRevision ||
    exactUuid(preliminary.entryRevisionId) !== item.entryRevisionId ||
    exactInteger(preliminary.adjudicationVersion, 1) !==
      item.adjudicationVersion
  ) {
    throw new Error('decision identity');
  }
  const identity = {
    entryId: item.entryId,
    entryRevision: item.entryRevision,
    entryRevisionId: item.entryRevisionId,
    adjudicationVersion: item.adjudicationVersion,
  } as const;
  if (action !== 'annotate') {
    if (preliminary.annotation !== undefined) throw new Error('annotation');
    return Object.freeze({...identity, action});
  }
  if (preliminary.annotation === undefined) throw new Error('annotation');
  return Object.freeze({
    ...identity,
    action,
    annotation: decodeAnnotation(preliminary.annotation),
  });
}

function decodeAnnotation(
  value: JsonValue,
): Readonly<BulkIngestionCodexAnnotation> {
  const annotation = exactObject(
    value,
    ['contentKeywords', 'typeKeyword', 'domains'],
    ['typeCustomName'],
  );
  const typeKeyword = exactEnum(annotation.typeKeyword, ENTRY_TYPE_KEYWORDS);
  const typeCustomName = optionalBoundedString(annotation.typeCustomName, 80);
  validateType(typeKeyword, typeCustomName, false);
  const contentKeywords = exactArray(annotation.contentKeywords, 1, 32).map(
    (keyword) => boundedNormalizedString(keyword, 80),
  );
  if (
    new Set(contentKeywords.map((value_) => value_.toLowerCase())).size !==
    contentKeywords.length
  ) {
    throw new Error('duplicate keyword');
  }
  return Object.freeze({
    contentKeywords: Object.freeze(contentKeywords),
    typeKeyword,
    ...(typeCustomName === undefined ? {} : {typeCustomName}),
    domains: Object.freeze(
      exactArray(annotation.domains, 1, 3).map(decodeDomain),
    ),
  });
}

function decodeDomain(value: JsonValue) {
  const domain = exactObject(value, ['keyword'], ['customName']);
  const keyword = exactEnum(domain.keyword, ENTRY_DOMAIN_KEYWORDS);
  const customName = optionalBoundedString(domain.customName, 80);
  validateType(keyword, customName, false);
  return Object.freeze({
    keyword,
    ...(customName === undefined ? {} : {customName}),
  });
}

function verifyPacketIdentity(
  packet: Readonly<BulkIngestionCodexReviewPacket>,
): void {
  const content = Object.freeze({
    schemaVersion: packet.schemaVersion,
    workspaceId: packet.workspaceId,
    batchId: packet.batchId,
    includePrivate: packet.includePrivate,
    items: packet.items,
  });
  const digest = createHash('sha256')
    .update(
      encodeCanonicalJson(content, BULK_INGESTION_CODEX_PACKET_MAXIMUM_BYTES),
    )
    .digest('hex');
  const packetId = deriveProcessingRunId(
    packet.workspaceId,
    `m2-p0e-codex-review:${digest}`,
  );
  if (digest !== packet.packetSha256 || packetId !== packet.packetId) {
    throw new Error('packet identity');
  }
}

function exactObject(
  value: JsonValue | undefined,
  required: readonly string[],
  optional: readonly string[] = [],
): JsonObject {
  if (value === null || Array.isArray(value) || typeof value !== 'object') {
    throw new Error('object');
  }
  const keys = Object.keys(value);
  const allowed = new Set([...required, ...optional]);
  if (
    required.some((key) => !Object.hasOwn(value, key)) ||
    keys.some((key) => !allowed.has(key))
  ) {
    throw new Error('keys');
  }
  return value as JsonObject;
}

function exactArray(
  value: JsonValue | undefined,
  minimum: number,
  maximum: number,
): readonly JsonValue[] {
  if (
    !Array.isArray(value) ||
    value.length < minimum ||
    value.length > maximum
  ) {
    throw new Error('array');
  }
  return value as readonly JsonValue[];
}

function exactString(value: JsonValue | undefined): string {
  if (typeof value !== 'string') throw new Error('string');
  return value;
}

function boundedString(value: JsonValue, maximum: number): string {
  const text = exactString(value);
  if (text.length === 0 || Array.from(text).length > maximum)
    throw new Error('bounded');
  return text;
}

function boundedNormalizedString(value: JsonValue, maximum: number): string {
  const text = boundedString(value, maximum);
  if (text !== text.trim().normalize('NFC')) throw new Error('normalized');
  return text;
}

function optionalBoundedString(
  value: JsonValue | undefined,
  maximum: number,
): string | undefined {
  return value === undefined
    ? undefined
    : boundedNormalizedString(value, maximum);
}

function exactBoolean(value: JsonValue | undefined): boolean {
  if (typeof value !== 'boolean') throw new Error('boolean');
  return value;
}

function exactInteger(value: JsonValue | undefined, minimum: number): number {
  if (
    !Number.isSafeInteger(value) ||
    typeof value !== 'number' ||
    value < minimum
  ) {
    throw new Error('integer');
  }
  return value;
}

function exactUuid(value: JsonValue | undefined): string {
  const text = exactString(value);
  if (!CANONICAL_UUID.test(text)) throw new Error('uuid');
  return text;
}

function exactSha256(value: JsonValue | undefined): string {
  const text = exactString(value);
  if (!SHA256.test(text)) throw new Error('sha');
  return text;
}

function exactLiteral<Value extends string>(
  value: JsonValue | undefined,
  expected: Value,
): Value {
  if (value !== expected) throw new Error('literal');
  return expected;
}

function exactEnum<Value extends string>(
  value: JsonValue | undefined,
  values: readonly Value[],
): Value {
  if (typeof value !== 'string' || !values.includes(value as Value)) {
    throw new Error('enum');
  }
  return value as Value;
}

function optionalEntryType(
  value: JsonValue | undefined,
): EntryTypeKeyword | undefined {
  return value === undefined
    ? undefined
    : exactEnum(value, ENTRY_TYPE_KEYWORDS);
}

function validateType(
  keyword: EntryTypeKeyword | EntryDomainKeyword | undefined,
  customName: string | undefined,
  allowMissing: boolean,
): void {
  if (keyword === undefined) {
    if (!allowMissing || customName !== undefined) throw new Error('keyword');
    return;
  }
  if ((keyword === 'other') !== (customName !== undefined))
    throw new Error('custom');
}

function requirePacketItem(
  packet: Readonly<BulkIngestionCodexReviewPacket>,
  index: number,
): Readonly<BulkIngestionCodexReviewPacketItem> {
  const item = packet.items[index];
  if (item === undefined) throw new Error('item');
  return item;
}
