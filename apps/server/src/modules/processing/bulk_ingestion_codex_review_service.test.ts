import {describe, expect, it, vi} from 'vitest';

import type {
  CurrentInformationEntry,
  InformationEntryRepositoryPort,
} from '../entries/index.js';
import type {BulkIngestionAdjudicationService} from './bulk_ingestion_adjudication_service.js';
import type {BulkIngestionCodexReviewFileStorePort} from './bulk_ingestion_codex_review_contract.js';
import {
  BulkIngestionCodexReviewService,
  BulkIngestionCodexReviewServiceError,
} from './bulk_ingestion_codex_review_service.js';

const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';
const BATCH_ID = '22222222-2222-4222-8222-222222222222';
const SNAPSHOT_ID = '33333333-3333-4333-8333-333333333333';
const ENTRY_ID = '44444444-4444-4444-8444-444444444444';
const REVISION_ID = '55555555-5555-4555-8555-555555555555';

describe('M2-P0E Codex review package export', () => {
  it('writes a deterministic external packet and an invalid-by-default result template', async () => {
    const memory = createMemoryStore();
    const sample =
      vi.fn<Pick<BulkIngestionAdjudicationService, 'sample'>['sample']>();
    sample.mockResolvedValue([adjudicationSample(false)]);
    const loadCurrentEntries = vi
      .fn<InformationEntryRepositoryPort['loadCurrentEntries']>()
      .mockResolvedValue([currentEntry(false)]);
    const service = new BulkIngestionCodexReviewService({
      workspaceId: WORKSPACE_ID,
      adjudication: {sample},
      entries: {loadCurrentEntries},
      fileStore: memory.store,
    });

    const first = await service.export({
      batchId: BATCH_ID,
      includePrivate: false,
      limit: 12,
    });
    const second = await service.export({
      batchId: BATCH_ID,
      includePrivate: false,
      limit: 12,
    });

    expect(first).toMatchObject({
      outcome: 'created',
      itemCount: 1,
      privateItemCount: 0,
    });
    expect(second).toMatchObject({
      outcome: 'existing',
      packetId: first.outcome === 'empty' ? '' : first.packetId,
    });
    const packet = JSON.parse(
      new TextDecoder().decode(memory.packetBytes),
    ) as Record<string, unknown>;
    const result = JSON.parse(
      new TextDecoder().decode(memory.resultBytes),
    ) as Record<string, unknown>;
    expect(packet).toMatchObject({
      schemaVersion: 'struinfo.m2-p0e.codex-review-packet.v1',
      workspaceId: WORKSPACE_ID,
      batchId: BATCH_ID,
      includePrivate: false,
      items: [
        {
          entryId: ENTRY_ID,
          entryRevision: 3,
          adjudicationVersion: 1,
          titlePath: 'Synthetic title',
          body: 'Synthetic body for local Codex review.',
          currentAnnotations: {
            contentKeywords: ['Existing'],
            typeKeyword: 'factual_material',
            domains: [{keyword: 'engineering_computing'}],
          },
        },
      ],
    });
    expect(result).toMatchObject({
      schemaVersion: 'struinfo.m2-p0f.codex-review-result.v1',
      packetId: packet.packetId,
      packetSha256: packet.packetSha256,
      decisions: [{entryId: ENTRY_ID, action: 'replace_me'}],
    });
    expect(sample).toHaveBeenCalledWith({
      batchId: BATCH_ID,
      status: 'pending',
      scope: 'current',
      limit: 12,
    });
    expect(loadCurrentEntries).toHaveBeenCalledWith(WORKSPACE_ID, false);
  });

  it('requires an explicit private-content export scope', async () => {
    const memory = createMemoryStore();
    const service = new BulkIngestionCodexReviewService({
      workspaceId: WORKSPACE_ID,
      adjudication: {
        sample: vi.fn().mockResolvedValue([adjudicationSample(true)]),
      },
      entries: {
        loadCurrentEntries: vi.fn().mockResolvedValue([currentEntry(true)]),
      },
      fileStore: memory.store,
    });

    await expect(
      service.export({
        batchId: BATCH_ID,
        includePrivate: false,
        limit: 1,
      }),
    ).rejects.toEqual(
      new BulkIngestionCodexReviewServiceError('privacy_scope_required'),
    );
    expect(memory.packetBytes).toBeUndefined();

    await expect(
      service.export({
        batchId: BATCH_ID,
        includePrivate: true,
        limit: 1,
      }),
    ).resolves.toMatchObject({itemCount: 1, privateItemCount: 1});
  });

  it('exports 100-item classification batches with existing annotations prefilled', async () => {
    const memory = createMemoryStore();
    const sample =
      vi.fn<Pick<BulkIngestionAdjudicationService, 'sample'>['sample']>();
    const samples = Object.freeze(
      Array.from({length: 100}, (_, index) =>
        Object.freeze({
          ...adjudicationSample(false, 'classification_type_missing'),
          sampleRank: index + 1,
          ordinal: index,
          entryId: classificationEntryId(index),
          entryRevisionId: classificationRevisionId(index),
        }),
      ),
    );
    sample.mockResolvedValue(samples);
    const loadCurrentEntries = vi
      .fn<InformationEntryRepositoryPort['loadCurrentEntries']>()
      .mockRejectedValue(new Error('complete load must not run'));
    const loadCurrentEntriesByIds = vi
      .fn<
        NonNullable<InformationEntryRepositoryPort['loadCurrentEntriesByIds']>
      >()
      .mockResolvedValue(
        samples.map((sampleValue) =>
          Object.freeze({
            ...currentEntry(false, false),
            entryId: sampleValue.entryId,
            revisionId: sampleValue.entryRevisionId,
          }),
        ),
      );
    const service = new BulkIngestionCodexReviewService({
      workspaceId: WORKSPACE_ID,
      adjudication: {sample},
      entries: {loadCurrentEntries, loadCurrentEntriesByIds},
      fileStore: memory.store,
    });

    await expect(
      service.export({
        batchId: BATCH_ID,
        exceptionCode: 'classification_type_missing',
        includePrivate: false,
        limit: 100,
      }),
    ).resolves.toMatchObject({itemCount: 100});

    const result = JSON.parse(new TextDecoder().decode(memory.resultBytes)) as {
      decisions: unknown[];
    };
    expect(result.decisions).toHaveLength(100);
    expect(result.decisions[0]).toMatchObject({
      entryId: classificationEntryId(0),
      action: 'replace_me',
      annotation: {
        contentKeywords: ['Existing'],
        typeKeyword: 'replace_me',
        domains: [{keyword: 'engineering_computing'}],
      },
    });
    expect(result.decisions[99]).toMatchObject({
      entryId: classificationEntryId(99),
      action: 'replace_me',
      annotation: {
        contentKeywords: ['Existing'],
        typeKeyword: 'replace_me',
        domains: [{keyword: 'engineering_computing'}],
      },
    });
    expect(sample).toHaveBeenCalledWith({
      batchId: BATCH_ID,
      exceptionCode: 'classification_type_missing',
      status: 'pending',
      scope: 'current',
      limit: 100,
    });
    expect(loadCurrentEntriesByIds).toHaveBeenCalledWith(
      WORKSPACE_ID,
      false,
      samples.map((sampleValue) => sampleValue.entryId),
    );
    expect(loadCurrentEntries).not.toHaveBeenCalled();
  });

  it('keeps legacy packets at 20 items and classification packets at 100', async () => {
    const service = new BulkIngestionCodexReviewService({
      workspaceId: WORKSPACE_ID,
      adjudication: {sample: vi.fn().mockResolvedValue([])},
      entries: {loadCurrentEntries: vi.fn().mockResolvedValue([])},
      fileStore: createMemoryStore().store,
    });

    await expect(
      service.export({
        batchId: BATCH_ID,
        includePrivate: false,
        limit: 21,
      }),
    ).rejects.toEqual(
      new BulkIngestionCodexReviewServiceError('input_invalid'),
    );
    await expect(
      service.export({
        batchId: BATCH_ID,
        exceptionCode: 'classification_domain_missing',
        includePrivate: false,
        limit: 101,
      }),
    ).rejects.toEqual(
      new BulkIngestionCodexReviewServiceError('input_invalid'),
    );
  });

  it('fails closed when the sampled Entry revision is no longer current', async () => {
    const service = new BulkIngestionCodexReviewService({
      workspaceId: WORKSPACE_ID,
      adjudication: {
        sample: vi.fn().mockResolvedValue([adjudicationSample(false)]),
      },
      entries: {
        loadCurrentEntries: vi
          .fn()
          .mockResolvedValue([{...currentEntry(false), revision: 4}]),
      },
      fileStore: createMemoryStore().store,
    });

    await expect(
      service.export({
        batchId: BATCH_ID,
        includePrivate: false,
        limit: 1,
      }),
    ).rejects.toEqual(
      new BulkIngestionCodexReviewServiceError('entry_snapshot_stale'),
    );
  });
});

function classificationEntryId(index: number): string {
  return '00000000-0000-4000-8000-' + index.toString().padStart(12, '0');
}

function classificationRevisionId(index: number): string {
  return '10000000-0000-4000-8000-' + index.toString().padStart(12, '0');
}

function adjudicationSample(
  isPrivate: boolean,
  exceptionCode:
    | 'no_deterministic_tags'
    | 'classification_type_missing' = 'no_deterministic_tags',
) {
  return Object.freeze({
    sampleRank: 1,
    ordinal: 0,
    snapshotId: SNAPSHOT_ID,
    isPrivate,
    entryId: ENTRY_ID,
    entryRevision: 3,
    entryRevisionId: REVISION_ID,
    isCurrent: true,
    exceptionCode,
    status: 'pending' as const,
    version: 1,
  });
}

function currentEntry(
  isPrivate: boolean,
  includeType = true,
): Readonly<CurrentInformationEntry> {
  return Object.freeze({
    workspaceId: WORKSPACE_ID,
    entryId: ENTRY_ID,
    resourceId: '66666666-6666-4666-8666-666666666666',
    snapshotId: SNAPSHOT_ID,
    revision: 3,
    revisionId: REVISION_ID,
    sourceKey: 'synthetic-source',
    capturedAt: '2026-08-31T00:00:00.000Z',
    value: Object.freeze({
      documentOrder: 0,
      titlePath: 'Synthetic title',
      body: 'Synthetic body for local Codex review.',
      bodySha256: 'a'.repeat(64),
      chunkMode: 'split' as const,
      splitRuleVersion: 'synthetic.v1',
      isPrivate,
      ...(includeType ? {typeKeyword: 'factual_material' as const} : {}),
      contentKeywords: Object.freeze([
        Object.freeze({
          displayValue: 'Existing',
          normalizedValue: 'existing',
          origin: 'rule' as const,
          originVersion: 'synthetic.v1',
        }),
      ]),
      domains: Object.freeze([
        Object.freeze({
          keyword: 'engineering_computing' as const,
          origin: 'rule' as const,
          originVersion: 'synthetic.v1',
        }),
      ]),
      fragmentIds: Object.freeze(['77777777-7777-4777-8777-777777777777']),
    }),
  });
}

function createMemoryStore(): {
  packetBytes?: Uint8Array;
  resultBytes?: Uint8Array;
  store: BulkIngestionCodexReviewFileStorePort;
} {
  const memory: {
    packetBytes?: Uint8Array;
    resultBytes?: Uint8Array;
    store: BulkIngestionCodexReviewFileStorePort;
  } = {
    store: {
      writePackage(input) {
        const outcome =
          memory.packetBytes === undefined ? 'created' : 'existing';
        memory.packetBytes ??= Uint8Array.from(input.packetBytes);
        memory.resultBytes ??= Uint8Array.from(input.resultTemplateBytes);
        return Promise.resolve(
          Object.freeze({
            outcome,
            packetFileName: `${input.packetId}.codex-review.json`,
            resultFileName: `${input.packetId}.codex-result.json`,
            packetByteLength: input.packetBytes.byteLength,
            packetFileSha256: 'a'.repeat(64),
          }),
        );
      },
      readPacket() {
        if (memory.packetBytes === undefined) throw new Error('missing');
        return Promise.resolve(Uint8Array.from(memory.packetBytes));
      },
      readResult() {
        if (memory.resultBytes === undefined) throw new Error('missing');
        return Promise.resolve(Uint8Array.from(memory.resultBytes));
      },
    },
  };
  return memory;
}
