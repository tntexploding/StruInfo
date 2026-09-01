import {describe, expect, it} from 'vitest';

import type {
  BulkIngestionAdjudicationException,
  BulkIngestionAdjudicationRepositoryPort,
} from './bulk_ingestion_adjudication_contract.js';
import {
  BulkIngestionAdjudicationService,
  BulkIngestionAdjudicationServiceError,
} from './bulk_ingestion_adjudication_service.js';

const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';
const BATCH_ID = '22222222-2222-4222-8222-222222222222';

describe('M2-P0C bulk ingestion exception adjudication', () => {
  it('summarizes current decisions separately from stale exceptions', async () => {
    const service = createService(new MemoryAdjudicationRepository());

    await expect(service.summarize(BATCH_ID)).resolves.toEqual({
      batchId: BATCH_ID,
      totalExceptionCount: 4,
      currentExceptionCount: 3,
      staleExceptionCount: 1,
      pendingCount: 2,
      acceptedCount: 0,
      manualReviewCount: 1,
      deferredCount: 0,
      reviewComplete: false,
      groups: [
        {
          exceptionCode: 'no_deterministic_tags',
          totalCount: 3,
          currentCount: 2,
          staleCount: 1,
          pendingCount: 2,
          acceptedCount: 0,
          manualReviewCount: 0,
          deferredCount: 0,
        },
        {
          exceptionCode: 'keyword_capacity_reached',
          totalCount: 1,
          currentCount: 1,
          staleCount: 0,
          pendingCount: 0,
          acceptedCount: 0,
          manualReviewCount: 1,
          deferredCount: 0,
        },
      ],
    });
  });

  it('returns a deterministic content-free sample and can isolate stale rows', async () => {
    const service = createService(new MemoryAdjudicationRepository());
    const request = {
      batchId: BATCH_ID,
      exceptionCode: 'no_deterministic_tags' as const,
      status: 'pending' as const,
      scope: 'current' as const,
      limit: 20,
    };

    const first = await service.sample(request);
    const second = await service.sample(request);
    expect(first).toEqual(second);
    expect(first).toHaveLength(2);
    expect(first.map((value) => value.sampleRank)).toEqual([1, 2]);
    expect(first.every((value) => value.isCurrent)).toBe(true);
    expect(JSON.stringify(first)).not.toMatch(/body|title|source|provider/iu);

    await expect(service.sample({...request, scope: 'stale'})).resolves.toEqual(
      [
        expect.objectContaining({
          sampleRank: 1,
          entryId: '77777777-7777-4777-8777-777777777777',
          isCurrent: false,
        }),
      ],
    );
    await expect(
      service.sample({...request, limit: 100}),
    ).resolves.toHaveLength(2);
    await expect(service.sample({...request, limit: 101})).rejects.toEqual(
      new BulkIngestionAdjudicationServiceError('input_invalid'),
    );
  });

  it('guards batch transitions by exact current count and supports reopening', async () => {
    const repository = new MemoryAdjudicationRepository();
    const service = createService(repository);

    await expect(
      service.decide({
        batchId: BATCH_ID,
        exceptionCode: 'no_deterministic_tags',
        fromStatus: 'pending',
        toStatus: 'accepted',
        expectedCount: 1,
      }),
    ).resolves.toMatchObject({outcome: 'stale', appliedCount: 0});

    await expect(
      service.decide({
        batchId: BATCH_ID,
        exceptionCode: 'no_deterministic_tags',
        fromStatus: 'pending',
        toStatus: 'accepted',
        expectedCount: 2,
      }),
    ).resolves.toMatchObject({
      outcome: 'applied',
      appliedCount: 2,
      summary: {pendingCount: 0, acceptedCount: 2, reviewComplete: true},
    });

    await expect(
      service.decide({
        batchId: BATCH_ID,
        exceptionCode: 'no_deterministic_tags',
        fromStatus: 'accepted',
        toStatus: 'pending',
        expectedCount: 2,
      }),
    ).resolves.toMatchObject({
      outcome: 'applied',
      appliedCount: 2,
      summary: {pendingCount: 2, acceptedCount: 0, reviewComplete: false},
    });

    expect(repository.values.find((value) => !value.isCurrent)?.status).toBe(
      'pending',
    );
  });

  it('accepts one exact 100-item classification transition and rejects 101', async () => {
    const repository = new MemoryAdjudicationRepository();
    repository.values = Array.from({length: 100}, (_, index) =>
      classificationException(index),
    );
    const service = createService(repository);
    const decisions = repository.values.map(exactDecision);

    await expect(
      service.decideExact({batchId: BATCH_ID, decisions}),
    ).resolves.toMatchObject({outcome: 'applied', appliedCount: 100});
    expect(
      repository.values.every((value) => value.status === 'accepted'),
    ).toBe(true);

    await expect(
      service.decideExact({
        batchId: BATCH_ID,
        decisions: Array.from({length: 101}, (_, index) =>
          exactDecision(classificationException(index)),
        ),
      }),
    ).rejects.toEqual(
      new BulkIngestionAdjudicationServiceError('input_invalid'),
    );
  });

  it('rejects invalid and unavailable batches before any adjudication write', async () => {
    const repository = new MemoryAdjudicationRepository();
    const service = new BulkIngestionAdjudicationService({
      workspaceId: WORKSPACE_ID,
      prerequisite: {ensureItems: () => Promise.resolve(false)},
      repository,
    });

    await expect(service.summarize(BATCH_ID)).rejects.toEqual(
      new BulkIngestionAdjudicationServiceError('batch_invalid_state'),
    );
    await expect(
      createService(repository).decide({
        batchId: BATCH_ID,
        exceptionCode: 'no_deterministic_tags',
        fromStatus: 'pending',
        toStatus: 'pending',
        expectedCount: 2,
      }),
    ).rejects.toEqual(
      new BulkIngestionAdjudicationServiceError('input_invalid'),
    );
    expect(repository.transitionCalls).toBe(0);
  });
});

function createService(repository: MemoryAdjudicationRepository) {
  return new BulkIngestionAdjudicationService({
    workspaceId: WORKSPACE_ID,
    prerequisite: {ensureItems: () => Promise.resolve(true)},
    repository,
  });
}

class MemoryAdjudicationRepository implements BulkIngestionAdjudicationRepositoryPort {
  public values: BulkIngestionAdjudicationException[] = [
    exception(0, '44444444-4444-4444-8444-444444444444'),
    exception(1, '55555555-5555-4555-8555-555555555555'),
    exception(2, '77777777-7777-4777-8777-777777777777', false),
    exception(
      3,
      '88888888-8888-4888-8888-888888888888',
      true,
      'keyword_capacity_reached',
      'manual_review',
    ),
  ];
  public transitionCalls = 0;

  public ensureAdjudications(): Promise<boolean> {
    return Promise.resolve(true);
  }

  public loadExceptions(): Promise<
    readonly Readonly<BulkIngestionAdjudicationException>[]
  > {
    return Promise.resolve(Object.freeze([...this.values]));
  }

  public transition(
    input: Parameters<BulkIngestionAdjudicationRepositoryPort['transition']>[0],
  ): ReturnType<BulkIngestionAdjudicationRepositoryPort['transition']> {
    this.transitionCalls += 1;
    const matches = this.values.filter(
      (value) =>
        value.isCurrent &&
        value.exceptionCode === input.exceptionCode &&
        value.status === input.fromStatus,
    );
    if (matches.length !== input.expectedCount) {
      return Promise.resolve({outcome: 'stale', appliedCount: 0});
    }
    const identities = new Set(matches.map((value) => value.entryId));
    this.values = this.values.map((value) =>
      identities.has(value.entryId)
        ? Object.freeze({
            ...value,
            status: input.toStatus,
            version: value.version + 1,
          })
        : value,
    );
    return Promise.resolve({outcome: 'applied', appliedCount: matches.length});
  }

  public transitionExact(
    input: Parameters<
      BulkIngestionAdjudicationRepositoryPort['transitionExact']
    >[0],
  ): ReturnType<BulkIngestionAdjudicationRepositoryPort['transitionExact']> {
    const matches = input.decisions.map((decision) =>
      this.values.find(
        (value) =>
          value.ordinal === decision.ordinal &&
          value.entryId === decision.entryId &&
          value.entryRevision === decision.entryRevision &&
          value.entryRevisionId === decision.entryRevisionId &&
          value.status === decision.fromStatus &&
          value.version === decision.expectedVersion &&
          value.currentEntryRevision ===
            decision.expectedCurrentEntryRevision &&
          value.currentEntryRevisionId ===
            decision.expectedCurrentEntryRevisionId,
      ),
    );
    if (matches.some((value) => value === undefined)) {
      return Promise.resolve({outcome: 'stale', appliedCount: 0});
    }
    const decisions = new Map(
      input.decisions.map((decision) => [decision.entryId, decision] as const),
    );
    this.values = this.values.map((value) => {
      const decision = decisions.get(value.entryId);
      return decision === undefined
        ? value
        : Object.freeze({
            ...value,
            status: decision.toStatus,
            version: value.version + 1,
          });
    });
    return Promise.resolve({outcome: 'applied', appliedCount: matches.length});
  }
}

function exception(
  ordinal: number,
  entryId: string,
  isCurrent = true,
  exceptionCode:
    | 'no_deterministic_tags'
    | 'keyword_capacity_reached' = 'no_deterministic_tags',
  status: 'pending' | 'manual_review' = 'pending',
): BulkIngestionAdjudicationException {
  const revision = 1;
  return Object.freeze({
    workspaceId: WORKSPACE_ID,
    batchId: BATCH_ID,
    ordinal,
    snapshotId: '33333333-3333-4333-8333-333333333333',
    isPrivate: false,
    entryId,
    entryRevision: revision,
    entryRevisionId: `66666666-6666-4666-8666-66666666666${String(ordinal)}`,
    currentEntryRevision: isCurrent ? revision : revision + 1,
    currentEntryRevisionId: isCurrent
      ? `66666666-6666-4666-8666-66666666666${String(ordinal)}`
      : `99999999-9999-4999-8999-99999999999${String(ordinal)}`,
    isCurrent,
    exceptionCode,
    status,
    version: 1,
  });
}

function classificationException(
  ordinal: number,
): BulkIngestionAdjudicationException {
  const entryId =
    'a0000000-0000-4000-8000-' + ordinal.toString().padStart(12, '0');
  const revisionId =
    'b0000000-0000-4000-8000-' + ordinal.toString().padStart(12, '0');
  return Object.freeze({
    workspaceId: WORKSPACE_ID,
    batchId: BATCH_ID,
    ordinal,
    snapshotId: '33333333-3333-4333-8333-333333333333',
    isPrivate: false,
    entryId,
    entryRevision: 1,
    entryRevisionId: revisionId,
    currentEntryRevision: 1,
    currentEntryRevisionId: revisionId,
    isCurrent: true,
    exceptionCode: 'classification_type_missing',
    status: 'pending',
    version: 1,
  });
}

function exactDecision(value: Readonly<BulkIngestionAdjudicationException>) {
  return Object.freeze({
    ordinal: value.ordinal,
    entryId: value.entryId,
    entryRevision: value.entryRevision,
    entryRevisionId: value.entryRevisionId,
    expectedVersion: value.version,
    fromStatus: 'pending' as const,
    toStatus: 'accepted' as const,
    expectedCurrentEntryRevision: value.currentEntryRevision,
    expectedCurrentEntryRevisionId: value.currentEntryRevisionId,
  });
}
