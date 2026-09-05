import {createHash} from 'node:crypto';

import {describe, expect, it, vi} from 'vitest';

import type {BlobStore} from '../../storage/blob_store.js';
import type {InformationEntryEmptySnapshotRepositoryPort} from '../entries/index.js';
import type {
  EvidenceReadRepositoryPort,
  EvidenceSnapshotReadState,
} from '../evidence/index.js';
import type {
  BulkIngestionBatch,
  BulkIngestionRepositoryPort,
} from './bulk_ingestion_contract.js';
import {BulkIngestionService} from './bulk_ingestion_service.js';

const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';
const BATCH_ID = '5a15dfd0-7e6d-52b0-8351-05bd27ef31bf';
const RUN_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const SNAPSHOT_ID = '22222222-2222-4222-8222-222222222222';
const RESOURCE_ID = '33333333-3333-4333-8333-333333333333';
const STRUCTURE_ID = '44444444-4444-4444-8444-444444444444';
const FRAGMENT_ID = '55555555-5555-4555-8555-555555555555';
const NODE_ID = '66666666-6666-4666-8666-666666666666';
const TEXT = '# Synthetic section\n\nSynthetic material.';
const TEXT_BYTES = new TextEncoder().encode(TEXT);
const TEXT_SHA = sha(TEXT);

describe('BulkIngestionService', () => {
  it('freezes an idempotent bounded Snapshot plan', async () => {
    const after = batch({status: 'planned'});
    const loadBatch = vi
      .fn<BulkIngestionRepositoryPort['loadBatch']>()
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(after);
    const initializeBatch = vi
      .fn<BulkIngestionRepositoryPort['initializeBatch']>()
      .mockResolvedValue('created');
    const repository = repositoryFixture({
      loadBatch,
      initializeBatch,
      listCandidates: vi.fn(() =>
        Promise.resolve([
          {
            workspaceId: WORKSPACE_ID,
            snapshotId: SNAPSHOT_ID,
            canonicalContentSha256: 'b'.repeat(64),
            isPrivate: false,
            plannedEntryCount: 1,
          },
        ]),
      ),
    });
    const service = serviceFixture(repository).service;

    await expect(
      service.plan({
        idempotencyKey: 'synthetic-batch-001',
        privacyScope: 'public_only',
        limit: 100,
      }),
    ).resolves.toEqual({outcome: 'created', batch: after});
    expect(initializeBatch).toHaveBeenCalledWith(
      expect.objectContaining({
        idempotencyKey: 'synthetic-batch-001',
        privacyScope: 'public_only',
        items: [expect.objectContaining({snapshotId: SNAPSHOT_ID})],
      }),
    );
    expect(initializeBatch.mock.calls[0]?.[0].requestSha256).toMatch(
      /^[0-9a-f]{64}$/u,
    );
    expect(initializeBatch.mock.calls[0]?.[0].planSha256).toMatch(
      /^[0-9a-f]{64}$/u,
    );
  });

  it('materializes one Snapshot atomically and settles only stable counts', async () => {
    const before = batch({status: 'planned'});
    const plannedItem = before.items[0];
    if (plannedItem === undefined)
      throw new Error('Synthetic item is missing.');
    const after = batch({
      status: 'succeeded',
      attempt: 1,
      succeededSnapshotCount: 1,
      succeededEntryCount: 1,
      pending: false,
    });
    const settleItem = vi
      .fn<BulkIngestionRepositoryPort['settleItem']>()
      .mockResolvedValue('applied');
    const repository = repositoryFixture({
      loadBatch: vi
        .fn<BulkIngestionRepositoryPort['loadBatch']>()
        .mockResolvedValueOnce(before)
        .mockResolvedValueOnce(after),
      beginAttempt: vi
        .fn<BulkIngestionRepositoryPort['beginAttempt']>()
        .mockResolvedValue('started'),
      claimNextItem: vi
        .fn<BulkIngestionRepositoryPort['claimNextItem']>()
        .mockResolvedValueOnce({
          outcome: 'claimed',
          item: plannedItem,
        })
        .mockResolvedValueOnce({outcome: 'drained'}),
      settleItem,
      finishAttempt: vi
        .fn<BulkIngestionRepositoryPort['finishAttempt']>()
        .mockResolvedValue('applied'),
    });
    const fixture = serviceFixture(repository);

    await expect(
      fixture.service.execute({batchId: BATCH_ID, mode: 'run', maxItems: 10}),
    ).resolves.toEqual({outcome: 'succeeded', batch: after});
    const materializedRows = fixture.materializeEntries.mock.calls[0]?.[0];
    expect(materializedRows).toHaveLength(1);
    expect(materializedRows?.[0]?.workspaceId).toBe(WORKSPACE_ID);
    expect(materializedRows?.[0]?.snapshotId).toBe(SNAPSHOT_ID);
    expect(materializedRows?.[0]?.value.body).toBe(TEXT);
    expect(materializedRows?.[0]?.value.splitRuleVersion).toBe(
      'struinfo.entry-split.section.v1',
    );
    expect(settleItem).toHaveBeenCalledWith(
      expect.objectContaining({status: 'succeeded', resultEntryCount: 1}),
    );
  });

  it('records a changed Snapshot as a retryable failed shard without leaking content', async () => {
    const before = batch({status: 'planned'});
    const plannedItem = before.items[0];
    if (plannedItem === undefined)
      throw new Error('Synthetic item is missing.');
    const after = batch({
      status: 'failed',
      attempt: 1,
      failedSnapshotCount: 1,
      pending: false,
      itemStatus: 'failed',
      errorCode: 'snapshot_plan_changed',
    });
    const settleItem = vi
      .fn<BulkIngestionRepositoryPort['settleItem']>()
      .mockResolvedValue('applied');
    const repository = repositoryFixture({
      loadBatch: vi
        .fn<BulkIngestionRepositoryPort['loadBatch']>()
        .mockResolvedValueOnce(before)
        .mockResolvedValueOnce(after),
      beginAttempt: vi
        .fn<BulkIngestionRepositoryPort['beginAttempt']>()
        .mockResolvedValue('started'),
      claimNextItem: vi
        .fn<BulkIngestionRepositoryPort['claimNextItem']>()
        .mockResolvedValueOnce({outcome: 'claimed', item: plannedItem})
        .mockResolvedValueOnce({outcome: 'drained'}),
      settleItem,
      finishAttempt: vi
        .fn<BulkIngestionRepositoryPort['finishAttempt']>()
        .mockResolvedValue('applied'),
    });
    const fixture = serviceFixture(repository, {
      ...snapshot(),
      canonicalContentSha256: 'c'.repeat(64),
    });

    await expect(
      fixture.service.execute({batchId: BATCH_ID, mode: 'run', maxItems: 10}),
    ).resolves.toMatchObject({outcome: 'failed'});
    expect(settleItem).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'failed',
        errorCode: 'snapshot_plan_changed',
      }),
    );
    expect(JSON.stringify(settleItem.mock.calls)).not.toContain(TEXT);
  });

  it('reports a bounded window as failed when a settled shard failed and work remains', async () => {
    const before = batch({status: 'planned'});
    const plannedItem = before.items[0];
    if (plannedItem === undefined)
      throw new Error('Synthetic item is missing.');
    const after = batch({
      status: 'paused',
      attempt: 1,
      failedSnapshotCount: 1,
      itemStatus: 'failed',
      errorCode: 'snapshot_processing_failed',
    });
    const repository = repositoryFixture({
      loadBatch: vi
        .fn<BulkIngestionRepositoryPort['loadBatch']>()
        .mockResolvedValueOnce(before)
        .mockResolvedValueOnce(after),
      beginAttempt: vi
        .fn<BulkIngestionRepositoryPort['beginAttempt']>()
        .mockResolvedValue('started'),
      claimNextItem: vi
        .fn<BulkIngestionRepositoryPort['claimNextItem']>()
        .mockResolvedValueOnce({outcome: 'claimed', item: plannedItem}),
      settleItem: vi
        .fn<BulkIngestionRepositoryPort['settleItem']>()
        .mockResolvedValue('applied'),
      finishAttempt: vi
        .fn<BulkIngestionRepositoryPort['finishAttempt']>()
        .mockResolvedValue('applied'),
    });
    const fixture = serviceFixture(repository, {
      ...snapshot(),
      canonicalContentSha256: 'c'.repeat(64),
    });

    await expect(
      fixture.service.execute({batchId: BATCH_ID, mode: 'run', maxItems: 1}),
    ).resolves.toEqual({outcome: 'failed', batch: after});
  });
});

function serviceFixture(
  repository: BulkIngestionRepositoryPort,
  evidenceSnapshot: Readonly<EvidenceSnapshotReadState> = snapshot(),
) {
  const materializeEntries = vi
    .fn<InformationEntryEmptySnapshotRepositoryPort['materializeEntries']>()
    .mockResolvedValue({outcome: 'created', createdCount: 1});
  const evidence: EvidenceReadRepositoryPort = {
    listSnapshots: () => Promise.resolve([]),
    loadSnapshot: () => Promise.resolve(evidenceSnapshot),
  };
  const entries: InformationEntryEmptySnapshotRepositoryPort = {
    materializeEntries,
    materializeEntriesIfSnapshotEmpty: materializeEntries,
    reviseEntry: () => Promise.resolve('not_found'),
    loadCurrentEntries: () => Promise.resolve([]),
  };
  const blobStore: BlobStore = {
    read: () => Promise.resolve(TEXT_BYTES),
    put: () => Promise.reject(new Error('not used')),
  };
  return {
    service: new BulkIngestionService({
      workspaceId: WORKSPACE_ID,
      repository,
      evidence,
      entries,
      blobStore,
    }),
    materializeEntries,
  };
}

function repositoryFixture(
  overrides: Partial<BulkIngestionRepositoryPort> = {},
): BulkIngestionRepositoryPort {
  return {
    listCandidates: () => Promise.resolve([]),
    initializeBatch: () => Promise.resolve('created'),
    loadBatch: () => Promise.resolve(undefined),
    beginAttempt: () => Promise.resolve('started'),
    requestPause: () => Promise.resolve('applied'),
    claimNextItem: () => Promise.resolve({outcome: 'drained'}),
    settleItem: () => Promise.resolve('applied'),
    finishAttempt: () => Promise.resolve('applied'),
    ...overrides,
  };
}

function batch(
  input: Readonly<{
    status: BulkIngestionBatch['status'];
    attempt?: number;
    succeededSnapshotCount?: number;
    succeededEntryCount?: number;
    failedSnapshotCount?: number;
    pending?: boolean;
    itemStatus?: BulkIngestionBatch['items'][number]['status'];
    errorCode?: string;
  }>,
): Readonly<BulkIngestionBatch> {
  const itemStatus =
    input.itemStatus ?? (input.pending === false ? 'succeeded' : 'pending');
  return Object.freeze({
    workspaceId: WORKSPACE_ID,
    batchId: BATCH_ID,
    idempotencyKey: 'synthetic-batch-001',
    requestSha256: 'a'.repeat(64),
    planSha256: 'd'.repeat(64),
    privacyScope: 'public_only',
    status: input.status,
    attempt: input.attempt ?? 0,
    snapshotCount: 1,
    plannedEntryCount: 1,
    succeededSnapshotCount: input.succeededSnapshotCount ?? 0,
    succeededEntryCount: input.succeededEntryCount ?? 0,
    failedSnapshotCount: input.failedSnapshotCount ?? 0,
    version: 1,
    createdAt: '2040-01-01T00:00:00.000Z',
    updatedAt: '2040-01-01T00:00:00.000Z',
    items: Object.freeze([
      Object.freeze({
        workspaceId: WORKSPACE_ID,
        batchId: BATCH_ID,
        ordinal: 0,
        snapshotId: SNAPSHOT_ID,
        canonicalContentSha256: 'b'.repeat(64),
        isPrivate: false,
        plannedEntryCount: 1,
        status: itemStatus,
        attempt: input.attempt ?? 0,
        ...(itemStatus === 'running' ? {claimedRunId: RUN_ID} : {}),
        ...(input.errorCode === undefined ? {} : {errorCode: input.errorCode}),
        version: 2,
      }),
    ]),
  });
}

function snapshot(): Readonly<EvidenceSnapshotReadState> {
  return Object.freeze({
    workspaceId: WORKSPACE_ID,
    snapshotId: SNAPSHOT_ID,
    resourceId: RESOURCE_ID,
    resourceKind: 'uploaded_file',
    sourceKey: 'synthetic.md',
    capturedAt: '2040-01-01T00:00:00.000Z',
    fragmentCount: 1,
    rawSha256: '1'.repeat(64),
    canonicalContentSha256: 'b'.repeat(64),
    canonicalizationVersion: 'synthetic.v1',
    mediaType: 'text/markdown',
    structures: Object.freeze([
      Object.freeze({
        structureId: STRUCTURE_ID,
        parserName: 'synthetic',
        parserVersion: '1',
        textNormalizationVersion: '1',
        structureSha256: '2'.repeat(64),
        textBlob: Object.freeze({
          algorithm: 'sha256' as const,
          digest: TEXT_SHA,
          byteLength: TEXT_BYTES.byteLength,
        }),
        fragments: Object.freeze([
          Object.freeze({
            fragmentId: FRAGMENT_ID,
            structureId: STRUCTURE_ID,
            nodeId: NODE_ID,
            nodeKind: 'section' as const,
            codePointRange: Object.freeze({
              start: 0,
              end: Array.from(TEXT).length,
            }),
            selectedTextSha256: TEXT_SHA,
          }),
        ]),
      }),
    ]),
  });
}

function sha(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}
