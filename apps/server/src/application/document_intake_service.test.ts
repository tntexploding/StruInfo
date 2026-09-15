import {describe, expect, it, vi} from 'vitest';
import {DocumentIntakeService} from './document_intake_service.js';
import {
  intakePolicySchema,
  type DocumentIntakeRepository,
  type IntakeRecord,
} from './document_intake_contract.js';
import type {
  EvidenceReadRepositoryPort,
  EvidenceRepositoryPort,
} from '../modules/evidence/index.js';
import type {BlobStore} from '../storage/blob_store.js';

vi.mock('../modules/evidence/index.js', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  materializeEvidenceSnapshot: vi.fn(() =>
    Promise.resolve({
      structures: [
        {
          normalizedText:
            'A complete synthetic article about starvine mechanics.',
        },
      ],
    }),
  ),
}));
const W = '10000000-0000-4000-8000-000000000001',
  S = '10000000-0000-4000-8000-000000000002',
  P = '10000000-0000-4000-8000-000000000003';
const policy = intakePolicySchema.parse({fetchFullText: false});
function fixture(isPrivate = false) {
  const rows = new Map<string, IntakeRecord>();
  const repository: DocumentIntakeRepository = {
    read: (id) => Promise.resolve(rows.get(id)),
    list: () => Promise.resolve([...rows.values()]),
    save: (id, expected, value) => {
      if ((rows.get(id)?.version ?? 0) !== expected)
        return Promise.resolve(false);
      rows.set(id, {
        snapshotId: id,
        version: expected + 1,
        value,
        updatedAt: '2040-01-01T00:00:00.000Z',
      });
      return Promise.resolve(true);
    },
    withLock: async (_id, action) => action(),
  };
  const snapshot = {
    snapshotId: S,
    workspaceId: W,
    isPrivate,
    resourceKind: 'remote_document',
    canonicalUri: 'https://example.invalid/synthetic',
  };
  const snapshots = [snapshot, {...snapshot, snapshotId: P}];
  const evidence = {
    loadSnapshot: (_w: string, id: string) =>
      Promise.resolve(snapshots.find((s) => s.snapshotId === id)),
    listSnapshots: () => Promise.resolve(snapshots),
  } as unknown as EvidenceReadRepositoryPort;
  const readWeb = vi.fn(() =>
    Promise.reject(new Error('synthetic-fetch-failure')),
  );
  const provider = {
    model: 'synthetic-model',
    reviewIntake: vi.fn(() =>
      Promise.resolve({
        completeness: 'complete' as const,
        contentKind: 'article' as const,
        decision: 'admit' as const,
        reason: '合成完整文章',
      }),
    ),
    planRecall: vi.fn(),
  };
  const service = new DocumentIntakeService({
    workspaceId: W,
    repository,
    evidence,
    capture: {} as EvidenceRepositoryPort,
    blobStore: {} as BlobStore,
    readWeb,
    provider,
  });
  return {service, rows, repository, readWeb, provider};
}
describe('document intake decisions', () => {
  it('reviews a linked full-text capture through its original intake record', async () => {
    const f = fixture();
    await f.repository.save(S, 0, {
      decision: 'pending',
      origin: 'system',
      reason: 'Synthetic full text captured',
      preparation: 'web_article',
      preparedSnapshotId: P,
    });
    expect((await f.service.review(P, policy))?.value.decision).toBe(
      'admitted',
    );
    expect(f.rows.get(S)).toMatchObject({
      version: 2,
      value: {decision: 'admitted'},
    });
    expect(f.rows.has(P)).toBe(false);
    expect(await f.service.needsReview(P, policy)).toBe(false);
    expect(f.provider.reviewIntake).toHaveBeenCalledTimes(1);
  });
  it('rejects private content before fetching or model access and hides its status', async () => {
    const f = fixture(true);
    await expect(
      f.service.needsReview(S, {...policy, fetchFullText: true}),
    ).rejects.toMatchObject({kind: 'forbidden'});
    await expect(f.service.review(S, policy)).rejects.toMatchObject({
      kind: 'forbidden',
    });
    expect(f.readWeb).not.toHaveBeenCalled();
    expect(f.provider.reviewIntake).not.toHaveBeenCalled();
    expect(await f.service.list()).toEqual([]);
  });
  it('keeps failed full-text fetches on hold without processing the feed summary', async () => {
    const f = fixture();
    expect(
      await f.service.needsReview(S, {...policy, fetchFullText: true}),
    ).toBe(false);
    expect(await f.service.guard(S)).toBe('intake_held');
    expect(f.provider.reviewIntake).not.toHaveBeenCalled();
    await f.service.control(S, 1, 'reset', 'Synthetic retry');
    expect(
      await f.service.needsReview(S, {...policy, fetchFullText: true}),
    ).toBe(false);
    expect(f.readWeb).toHaveBeenCalledTimes(2);
  });
  it('preserves a manual block arriving during a model call and rejects stale controls', async () => {
    const f = fixture();
    f.provider.reviewIntake.mockImplementationOnce(async () => {
      await f.service.control(S, 0, 'block', 'Manual choice');
      return {
        completeness: 'complete',
        contentKind: 'article',
        decision: 'admit',
        reason: 'Synthetic approval',
      };
    });
    expect((await f.service.review(S, policy))?.value).toMatchObject({
      origin: 'manual',
      decision: 'blocked',
      reason: 'Manual choice',
    });
    await expect(
      f.service.control(S, 0, 'admit', 'Stale write'),
    ).rejects.toMatchObject({code: 'stale_intake_version'});
    expect(await f.service.needsReview(S, policy)).toBe(false);
    await f.service.control(S, 1, 'admit', 'Reviewed');
    expect(await f.service.guard(S)).toBeUndefined();
  });
  it('caches a completed assessment and reset explicitly enables another review', async () => {
    const f = fixture();
    expect(await f.service.needsReview(S, policy)).toBe(true);
    await f.service.review(S, policy);
    expect(await f.service.needsReview(S, policy)).toBe(false);
    await f.service.review(S, policy);
    expect(f.provider.reviewIntake).toHaveBeenCalledTimes(1);
    await f.service.control(S, 1, 'reset', 'Review again');
    expect(await f.service.needsReview(S, policy)).toBe(true);
  });
});
