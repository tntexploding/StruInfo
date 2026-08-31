import {createHash} from 'node:crypto';

import {encodeCanonicalJson} from '../../serialization/canonical_json.js';
import type {BlobStore} from '../../storage/blob_store.js';
import {
  prepareSplitInformationEntries,
  type InformationEntryEmptySnapshotRepositoryPort,
} from '../entries/index.js';
import {
  materializeEvidenceSnapshot,
  type EvidenceReadRepositoryPort,
} from '../evidence/index.js';
import {
  BULK_INGESTION_MAXIMUM_ENTRIES,
  BULK_INGESTION_MAXIMUM_SNAPSHOTS,
  type BulkIngestionBatch,
  type BulkIngestionRepositoryPort,
  type ExecuteBulkIngestionRequest,
  type ExecuteBulkIngestionResult,
  type PlanBulkIngestionRequest,
  type PlanBulkIngestionResult,
} from './bulk_ingestion_contract.js';
import {PROCESSING_PRIVACY_SCOPES} from './processing_contract.js';
import {deriveProcessingRunId} from './processing_identity.js';

const CANONICAL_UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;
const MAXIMUM_DIGEST_INPUT_BYTES = 1_048_576;

export type BulkIngestionServiceErrorCode =
  | 'input_invalid'
  | 'batch_conflict'
  | 'batch_not_found'
  | 'batch_invalid_state'
  | 'executor_superseded';

export class BulkIngestionServiceError extends Error {
  public readonly code: BulkIngestionServiceErrorCode;

  public constructor(code: BulkIngestionServiceErrorCode) {
    super('The bulk ingestion operation failed.');
    this.name = 'BulkIngestionServiceError';
    this.code = code;
  }
}

export interface BulkIngestionServiceDependencies {
  readonly workspaceId: string;
  readonly repository: BulkIngestionRepositoryPort;
  readonly evidence: EvidenceReadRepositoryPort;
  readonly entries: InformationEntryEmptySnapshotRepositoryPort;
  readonly blobStore: BlobStore;
}

export class BulkIngestionService {
  readonly #dependencies: Readonly<BulkIngestionServiceDependencies>;

  public constructor(dependencies: Readonly<BulkIngestionServiceDependencies>) {
    if (!CANONICAL_UUID.test(dependencies.workspaceId)) {
      throw new BulkIngestionServiceError('input_invalid');
    }
    this.#dependencies = dependencies;
  }

  public async plan(
    request: Readonly<PlanBulkIngestionRequest>,
  ): Promise<Readonly<PlanBulkIngestionResult>> {
    if (!validPlanRequest(request)) {
      throw new BulkIngestionServiceError('input_invalid');
    }
    const requestSha256 = digest({
      schemaVersion: 'struinfo.bulk-ingestion-request.v1',
      privacyScope: request.privacyScope,
      limit: request.limit,
    });
    const batchId = deriveProcessingRunId(
      this.#dependencies.workspaceId,
      `m2-p0a-batch:${request.idempotencyKey}`,
    );
    const existing = await this.#dependencies.repository.loadBatch(
      this.#dependencies.workspaceId,
      batchId,
    );
    if (existing !== undefined) {
      if (
        existing.idempotencyKey !== request.idempotencyKey ||
        existing.requestSha256 !== requestSha256
      ) {
        throw new BulkIngestionServiceError('batch_conflict');
      }
      return Object.freeze({outcome: 'existing' as const, batch: existing});
    }

    const candidates = await this.#dependencies.repository.listCandidates(
      this.#dependencies.workspaceId,
      request.privacyScope,
      request.limit,
    );
    const selected = [];
    let plannedEntryCount = 0;
    for (const candidate of candidates) {
      if (
        selected.length >= request.limit ||
        plannedEntryCount + candidate.plannedEntryCount >
          BULK_INGESTION_MAXIMUM_ENTRIES
      ) {
        break;
      }
      selected.push(candidate);
      plannedEntryCount += candidate.plannedEntryCount;
    }
    if (selected.length === 0) {
      return Object.freeze({outcome: 'empty' as const});
    }
    const planSha256 = digest({
      schemaVersion: 'struinfo.bulk-ingestion-plan.v1',
      items: selected.map((candidate, ordinal) => ({
        ordinal,
        snapshotId: candidate.snapshotId,
        canonicalContentSha256: candidate.canonicalContentSha256,
        isPrivate: candidate.isPrivate,
        plannedEntryCount: candidate.plannedEntryCount,
      })),
    });
    const initialized = await this.#dependencies.repository.initializeBatch({
      workspaceId: this.#dependencies.workspaceId,
      batchId,
      idempotencyKey: request.idempotencyKey,
      requestSha256,
      planSha256,
      privacyScope: request.privacyScope,
      items: Object.freeze(selected),
    });
    if (initialized === 'conflict') {
      throw new BulkIngestionServiceError('batch_conflict');
    }
    const batch = await this.#loadRequired(batchId);
    return Object.freeze({
      outcome:
        initialized === 'created'
          ? ('created' as const)
          : ('existing' as const),
      batch,
    });
  }

  public load(batchId: string): Promise<Readonly<BulkIngestionBatch>> {
    if (!CANONICAL_UUID.test(batchId)) {
      throw new BulkIngestionServiceError('input_invalid');
    }
    return this.#loadRequired(batchId);
  }

  public async requestPause(
    batchId: string,
  ): Promise<Readonly<BulkIngestionBatch>> {
    if (!CANONICAL_UUID.test(batchId)) {
      throw new BulkIngestionServiceError('input_invalid');
    }
    const outcome = await this.#dependencies.repository.requestPause(
      this.#dependencies.workspaceId,
      batchId,
    );
    if (outcome === 'not_found') {
      throw new BulkIngestionServiceError('batch_not_found');
    }
    if (outcome === 'terminal') {
      throw new BulkIngestionServiceError('batch_invalid_state');
    }
    return this.#loadRequired(batchId);
  }

  public async execute(
    request: Readonly<ExecuteBulkIngestionRequest>,
  ): Promise<Readonly<ExecuteBulkIngestionResult>> {
    if (
      !CANONICAL_UUID.test(request.batchId) ||
      !['run', 'resume', 'retry'].includes(request.mode) ||
      !Number.isSafeInteger(request.maxItems) ||
      request.maxItems < 1 ||
      request.maxItems > BULK_INGESTION_MAXIMUM_SNAPSHOTS
    ) {
      throw new BulkIngestionServiceError('input_invalid');
    }
    const before = await this.#loadRequired(request.batchId);
    if (before.status === 'succeeded') {
      return Object.freeze({outcome: 'succeeded' as const, batch: before});
    }
    const nextAttempt = before.attempt + 1;
    const runId = deriveProcessingRunId(
      this.#dependencies.workspaceId,
      `m2-p0a-run:${request.batchId}:attempt:${nextAttempt.toString()}`,
    );
    const begun = await this.#dependencies.repository.beginAttempt({
      workspaceId: this.#dependencies.workspaceId,
      batchId: request.batchId,
      runId,
      mode: request.mode,
    });
    if (begun === 'not_found') {
      throw new BulkIngestionServiceError('batch_not_found');
    }
    if (begun !== 'started') {
      throw new BulkIngestionServiceError('batch_invalid_state');
    }

    let processed = 0;
    let finishReason: 'drained' | 'pause' | 'window' = 'drained';
    while (processed < request.maxItems) {
      const claimed = await this.#dependencies.repository.claimNextItem(
        this.#dependencies.workspaceId,
        request.batchId,
        runId,
      );
      if (claimed.outcome === 'pause_requested') {
        finishReason = 'pause';
        break;
      }
      if (claimed.outcome === 'drained') {
        finishReason = 'drained';
        break;
      }
      if (claimed.outcome !== 'claimed') {
        throw new BulkIngestionServiceError(
          claimed.outcome === 'not_found'
            ? 'batch_not_found'
            : 'executor_superseded',
        );
      }
      const result = await this.#materializeItem(claimed.item);
      const settled = await this.#dependencies.repository.settleItem({
        workspaceId: this.#dependencies.workspaceId,
        batchId: request.batchId,
        ordinal: claimed.item.ordinal,
        expectedVersion: claimed.item.version,
        runId,
        ...result,
      });
      if (settled !== 'applied') {
        throw new BulkIngestionServiceError(
          settled === 'not_found' ? 'batch_not_found' : 'executor_superseded',
        );
      }
      processed += 1;
    }
    if (processed === request.maxItems) finishReason = 'window';
    const finished = await this.#dependencies.repository.finishAttempt({
      workspaceId: this.#dependencies.workspaceId,
      batchId: request.batchId,
      runId,
      reason: finishReason,
    });
    if (finished !== 'applied') {
      throw new BulkIngestionServiceError(
        finished === 'not_found' ? 'batch_not_found' : 'executor_superseded',
      );
    }
    const batch = await this.#loadRequired(request.batchId);
    return Object.freeze({
      outcome:
        batch.failedSnapshotCount > 0
          ? ('failed' as const)
          : batch.status === 'succeeded'
            ? ('succeeded' as const)
            : ('paused' as const),
      batch,
    });
  }

  async #materializeItem(
    item: Readonly<{
      snapshotId: string;
      canonicalContentSha256: string;
      isPrivate: boolean;
      plannedEntryCount: number;
    }>,
  ): Promise<
    | Readonly<{status: 'succeeded'; resultEntryCount: number}>
    | Readonly<{status: 'failed'; errorCode: string}>
  > {
    try {
      const snapshot = await this.#dependencies.evidence.loadSnapshot(
        this.#dependencies.workspaceId,
        item.snapshotId,
      );
      if (
        snapshot?.canonicalContentSha256 !== item.canonicalContentSha256 ||
        (snapshot.isPrivate === true) !== item.isPrivate
      ) {
        return Object.freeze({
          status: 'failed' as const,
          errorCode: 'snapshot_plan_changed',
        });
      }
      const materialized = await materializeEvidenceSnapshot(
        snapshot,
        this.#dependencies.blobStore,
      );
      const rows = prepareSplitInformationEntries(materialized);
      if (rows.length !== item.plannedEntryCount || rows.length === 0) {
        return Object.freeze({
          status: 'failed' as const,
          errorCode: 'snapshot_plan_changed',
        });
      }
      const write =
        await this.#dependencies.entries.materializeEntriesIfSnapshotEmpty(
          rows,
        );
      if (write.outcome === 'snapshot_not_empty') {
        return Object.freeze({
          status: 'failed' as const,
          errorCode: 'snapshot_structure_conflict',
        });
      }
      return Object.freeze({
        status: 'succeeded' as const,
        resultEntryCount: rows.length,
      });
    } catch {
      return Object.freeze({
        status: 'failed' as const,
        errorCode: 'snapshot_processing_failed',
      });
    }
  }

  async #loadRequired(batchId: string): Promise<Readonly<BulkIngestionBatch>> {
    const batch = await this.#dependencies.repository.loadBatch(
      this.#dependencies.workspaceId,
      batchId,
    );
    if (batch === undefined) {
      throw new BulkIngestionServiceError('batch_not_found');
    }
    return batch;
  }
}

function validPlanRequest(
  request: Readonly<PlanBulkIngestionRequest>,
): boolean {
  return (
    typeof request.idempotencyKey === 'string' &&
    request.idempotencyKey.trim() === request.idempotencyKey &&
    request.idempotencyKey.length > 0 &&
    Array.from(request.idempotencyKey).length <= 160 &&
    !containsControlCharacter(request.idempotencyKey) &&
    PROCESSING_PRIVACY_SCOPES.includes(request.privacyScope) &&
    Number.isSafeInteger(request.limit) &&
    request.limit >= 1 &&
    request.limit <= BULK_INGESTION_MAXIMUM_SNAPSHOTS
  );
}

function containsControlCharacter(value: string): boolean {
  return Array.from(value).some((character) => {
    const codePoint = character.codePointAt(0);
    return codePoint !== undefined && (codePoint <= 0x1f || codePoint === 0x7f);
  });
}

function digest(value: unknown): string {
  const bytes = encodeCanonicalJson(value, MAXIMUM_DIGEST_INPUT_BYTES);
  return createHash('sha256').update(bytes).digest('hex');
}
