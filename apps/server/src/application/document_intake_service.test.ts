import {describe, expect, it, vi} from 'vitest';
import {DocumentIntakeService} from './document_intake_service.js';
import {
  intakePolicySchema,
  intakeTargetSnapshot,
  type DocumentIntakeRepository,
  type IntakeRecord,
  type IntakeAssessment,
  type IntakeReviewInput,
} from './document_intake_contract.js';
import type {
  EvidenceReadRepositoryPort,
  EvidenceRepositoryPort,
} from '../modules/evidence/index.js';
import type {BlobStore} from '../storage/blob_store.js';
import {importMarkdownEvidence} from '../modules/evidence/index.js';
import type {SourceConnectorReadResult} from '../modules/subscriptions/source_connector.js';
import {OperationError, requireOperationValue} from './operation_error.js';

const texts = vi.hoisted(() => new Map<string, string>());

vi.mock('../modules/evidence/index.js', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  importMarkdownEvidence: vi.fn(),
  materializeEvidenceSnapshot: vi.fn((snapshot: {snapshotId: string}) =>
    Promise.resolve({
      structures: [
        {
          normalizedText:
            texts.get(snapshot.snapshotId) ??
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
function fixture(isPrivate = false, mediaType = 'text/markdown') {
  texts.clear();
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
    mediaType,
  };
  const snapshots = [snapshot, {...snapshot, snapshotId: P}];
  const evidence = {
    loadSnapshot: (_w: string, id: string) =>
      Promise.resolve(snapshots.find((s) => s.snapshotId === id)),
    listSnapshots: () => Promise.resolve(snapshots),
  } as unknown as EvidenceReadRepositoryPort;
  const readWeb = vi.fn<() => Promise<SourceConnectorReadResult>>(() =>
    Promise.reject(new Error('synthetic-fetch-failure')),
  );
  const assertBodyChangeAllowed = vi.fn<
    (ids: readonly string[]) => Promise<void>
  >(() => Promise.resolve());
  vi.mocked(importMarkdownEvidence).mockImplementation((_deps, input) => {
    snapshots.push({
      ...snapshot,
      snapshotId: input.snapshot.snapshotId,
      mediaType: input.snapshot.mediaType ?? mediaType,
    });
    texts.set(
      input.snapshot.snapshotId,
      new TextDecoder().decode(input.sourceUtf8),
    );
    return Promise.resolve({status: 'created'} as Awaited<
      ReturnType<typeof importMarkdownEvidence>
    >);
  });
  const provider = {
    model: 'synthetic-model',
    reviewIntake: vi.fn<
      (input: IntakeReviewInput) => Promise<IntakeAssessment>
    >(() =>
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
    assertBodyChangeAllowed,
  });
  return {
    snapshot,
    snapshots,
    service,
    rows,
    repository,
    readWeb,
    provider,
    assertBodyChangeAllowed,
  };
}
const fetched = (body: string): SourceConnectorReadResult => ({
  status: 'changed',
  cursor: 'synthetic',
  documents: [
    {
      externalId: 'synthetic',
      version: '1',
      canonicalUri: 'https://example.invalid/synthetic',
      mediaType: 'text/markdown',
      profile: 'commonmark-v1',
      sourceUtf8: new TextEncoder().encode(body),
    },
  ],
});
describe('document intake decisions', () => {
  it('accepts only complete model-reviewed receipts, records provenance and defers further automation', async () => {
    const f = fixture();
    await f.service.receive([{snapshotId: S, expectedVersion: 0}], 'reset');
    await f.service.receiptReviewReady(S, 1);
    await expect(f.service.receiptReviewReady(S, 2)).rejects.toMatchObject({
      code: 'stale_intake_version',
    });
    const reviewed = requireOperationValue(
      await f.service.review(S, policy, true),
    );
    expect(await f.service.acceptReviewedReceipt(S, P, reviewed.version)).toBe(
      'accepted',
    );
    expect(f.rows.get(S)?.value).toMatchObject({
      receipt: 'accepted',
      receiptOrigin: 'model',
      receiptTaskId: P,
      deferProcessing: true,
    });
    expect(await f.service.acceptReviewedReceipt(S, P, reviewed.version)).toBe(
      'accepted',
    );
    expect(f.rows.get(S)?.version).toBe(3);
    expect(f.provider.reviewIntake).toHaveBeenCalledTimes(1);
  });
  it('holds uncertain material and never overwrites a manual rejection during review', async () => {
    const f = fixture();
    await f.service.receive([{snapshotId: S, expectedVersion: 0}], 'reset');
    f.provider.reviewIntake.mockResolvedValueOnce({
      decision: 'hold',
      completeness: 'uncertain',
      contentKind: 'article',
      reason: 'Synthetic context is incomplete.',
    });
    await f.service.review(S, policy, true);
    expect(await f.service.acceptReviewedReceipt(S, P, 2)).toBe('held');
    expect(f.rows.get(S)?.value.receipt).toBe('pending');
    await f.service.control(S, 2, 'reset', 'Synthetic retry');
    const response = requireOperationValue(
      f.provider.reviewIntake.getMockImplementation(),
    );
    f.provider.reviewIntake.mockImplementationOnce(async () => {
      await f.service.receive([{snapshotId: S, expectedVersion: 3}], 'reject');
      return response({
        text: 'Synthetic current article',
        preparation: 'received',
        policy,
      });
    });
    await expect(f.service.review(S, policy, true)).rejects.toMatchObject({
      code: 'stale_intake_version',
    });
    expect(f.rows.get(S)?.value.receipt).toBe('rejected');
    await expect(
      f.service.acceptReviewedReceipt(S, P, 3),
    ).rejects.toMatchObject({code: 'stale_intake_version'});
  });
  it('preserves a newer owner decision between review and acceptance', async () => {
    const f = fixture();
    await f.service.receive([{snapshotId: S, expectedVersion: 0}], 'reset');
    await f.service.review(S, policy, true);
    await f.service.receive([{snapshotId: S, expectedVersion: 2}], 'accept');
    await expect(
      f.service.acceptReviewedReceipt(S, P, 2),
    ).rejects.toMatchObject({code: 'stale_intake_version'});
    expect(f.rows.get(S)?.value).toMatchObject({
      receipt: 'accepted',
      receiptOrigin: 'manual',
    });
    expect(f.rows.get(S)?.value.receiptTaskId).toBeUndefined();
  });

  it('treats explicit owner acceptance as admission without a model call', async () => {
    const f = fixture();
    await f.service.receive([{snapshotId: S, expectedVersion: 0}], 'reset');
    expect(await f.service.guard(S)).toBe('intake_receipt_pending');
    const receipt = requireOperationValue(f.rows.get(S));
    f.rows.set(S, {
      ...receipt,
      value: {
        ...receipt.value,
        captureOrigin: {kind: 'subscription', subscriptionId: P},
      },
    });
    const accepted = await f.service.receive(
      [{snapshotId: S, expectedVersion: 1}],
      'accept',
    );
    expect(accepted.records[0]?.value).toMatchObject({
      receipt: 'accepted',
      decision: 'admitted',
      origin: 'manual',
      captureOrigin: {kind: 'subscription', subscriptionId: P},
    });
    expect(await f.service.needsReview(S, policy)).toBe(false);
    expect(f.provider.reviewIntake).not.toHaveBeenCalled();
    await f.service.receive([{snapshotId: S, expectedVersion: 2}], 'reject');
    expect(await f.service.guard(S)).toBe('intake_receipt_rejected');
    await f.service.receive([{snapshotId: S, expectedVersion: 3}], 'reset');
    expect(f.rows.get(S)?.value.receipt).toBe('pending');
  });
  it('reports partial success, rejects stale decisions and cannot hide processed or private documents', async () => {
    const f = fixture();
    await f.service.receive([{snapshotId: S, expectedVersion: 0}], 'reset');
    const result = await f.service.receive(
      [
        {snapshotId: S, expectedVersion: 0},
        {snapshotId: P, expectedVersion: 0},
      ],
      'accept',
    );
    expect(result.failed).toEqual([
      {snapshotId: S, code: 'stale_intake_version'},
    ]);
    expect(result.records.map((r) => r.snapshotId)).toEqual([P]);
    f.assertBodyChangeAllowed.mockRejectedValue(
      new OperationError('conflict', 'intake_body_already_processed'),
    );
    expect(
      (await f.service.receive([{snapshotId: P, expectedVersion: 1}], 'reject'))
        .failed[0]?.code,
    ).toBe('intake_body_already_processed');
    expect(f.rows.get(P)?.value.receipt).toBe('accepted');
    const hidden = fixture(true);
    expect(
      (
        await hidden.service.receive(
          [{snapshotId: S, expectedVersion: 0}],
          'accept',
        )
      ).failed[0]?.code,
    ).toBe('private_model_transfer_forbidden');
    expect(hidden.rows.size).toBe(0);
  });

  it('reviews complete received text when the web projection contains only a title', async () => {
    const f = fixture();
    const full =
      '# Synthetic received article\n\n' +
      '完整合成材料含有背景与论述。'.repeat(60) +
      '\n\n' +
      '第二部分包含充分论据与结论。'.repeat(60);
    texts.set(S, full);
    f.readWeb.mockResolvedValue(fetched('# Unavailable site'));
    expect(
      await f.service.needsReview(S, {...policy, fetchFullText: true}),
    ).toBe(true);
    expect(f.rows.get(S)?.value).toMatchObject({
      decision: 'pending',
      bodySource: 'received',
    });
    const prepared = f.rows.get(S)?.value.preparedSnapshotId;
    expect(prepared).toBeDefined();
    expect(f.provider.reviewIntake).not.toHaveBeenCalled();
    const record = await f.service.review(S, {...policy, fetchFullText: true});
    expect(record && intakeTargetSnapshot(record)).toBe(S);
    expect(f.provider.reviewIntake).toHaveBeenCalledWith(
      expect.objectContaining({text: full, preparation: 'received'}),
    );
    expect(await f.service.guard(requireOperationValue(prepared))).toBe(
      'intake_body_not_selected',
    );
  });
  it('keeps a real web body as the candidate and does not treat feed length as admission', async () => {
    const f = fixture();
    texts.set(
      S,
      'Feed paragraph '.repeat(200) +
        '\n\n' +
        'Feed second paragraph '.repeat(200),
    );
    f.readWeb.mockResolvedValue(
      fetched('# Article\n\n' + 'Web reasoning '.repeat(100)),
    );
    const record = await f.service.prepare(S, {...policy, fetchFullText: true});
    expect(record?.value).toMatchObject({
      decision: 'pending',
      bodySource: 'web_article',
    });
    expect(f.provider.reviewIntake).not.toHaveBeenCalled();
  });
  it('switches held evidence to received text without manual admission or a new model call', async () => {
    const f = fixture();
    await f.repository.save(S, 0, {
      decision: 'held',
      origin: 'model',
      reason: 'Summary',
      preparation: 'web_article',
      preparedSnapshotId: P,
      assessment: {
        decision: 'hold',
        completeness: 'summary',
        contentKind: 'article',
        reason: 'Synthetic summary',
      },
      policy,
      model: 'old-model',
    });
    const r = await f.service.prepare(
      P,
      {...policy, fetchFullText: true},
      {source: 'received', expectedVersion: 1, refresh: false},
    );
    expect(r?.value).toEqual({
      decision: 'pending',
      origin: 'system',
      reason: '正文选择已更新，等待重新审核。',
      preparation: 'received',
      bodySource: 'received',
      preparedSnapshotId: P,
    });
    expect(f.readWeb).not.toHaveBeenCalled();
    expect(f.provider.reviewIntake).not.toHaveBeenCalled();
    expect(
      await f.service.needsReview(S, {...policy, fetchFullText: true}),
    ).toBe(true);
    expect(f.readWeb).not.toHaveBeenCalled();
    await f.service.review(S, policy);
    expect(f.rows.get(S)?.value.decision).toBe('admitted');
  });
  it('captures a distinct refreshed body and retains the old link, with stale retry protection', async () => {
    const f = fixture();
    await f.repository.save(S, 0, {
      decision: 'held',
      origin: 'model',
      reason: 'Summary',
      preparation: 'web_article',
      preparedSnapshotId: P,
    });
    f.readWeb.mockResolvedValue(
      fetched('# Full text\n\n' + 'Synthetic paragraph '.repeat(100)),
    );
    const selection = {
      source: 'web_article' as const,
      expectedVersion: 1,
      refresh: true,
    };
    const r = await f.service.prepare(
      P,
      {...policy, fetchFullText: true},
      selection,
    );
    expect(r?.value).toMatchObject({
      decision: 'pending',
      bodySource: 'web_article',
      previousPreparedSnapshotIds: [P],
    });
    expect(r?.value.preparedSnapshotId).not.toBe(P);
    expect((await f.service.record(P))?.snapshotId).toBe(S);
    expect(await f.service.guard(P)).toBe('intake_body_not_selected');
    await expect(f.service.prepare(S, policy, selection)).rejects.toMatchObject(
      {code: 'stale_intake_version'},
    );
    await f.service.prepare(S, {...policy, fetchFullText: true});
    expect(f.readWeb).toHaveBeenCalledTimes(1);
    expect(f.provider.reviewIntake).not.toHaveBeenCalled();
  });
  it('rejects source changes on active/processed or blocked material', async () => {
    const f = fixture();
    for (const code of [
      'intake_task_active',
      'intake_body_already_processed',
    ]) {
      f.assertBodyChangeAllowed.mockRejectedValueOnce(
        new OperationError('conflict', code),
      );
      await expect(
        f.service.prepare(S, policy, {
          source: 'received',
          expectedVersion: 0,
          refresh: false,
        }),
      ).rejects.toMatchObject({code});
    }
    await f.service.control(S, 0, 'block', 'Manual block');
    await expect(
      f.service.prepare(S, policy, {
        source: 'received',
        expectedVersion: 1,
        refresh: false,
      }),
    ).rejects.toMatchObject({code: 'intake_blocked'});
    expect(f.readWeb).not.toHaveBeenCalled();
    expect(f.rows.get(S)?.value.decision).toBe('blocked');
  });
  it('preserves a manual decision arriving during a refresh and never links the stale capture', async () => {
    const f = fixture();
    f.readWeb.mockImplementationOnce(async () => {
      await f.service.control(S, 0, 'block', 'Do not continue');
      return fetched('# Synthetic complete body');
    });
    await expect(
      f.service.prepare(
        S,
        {...policy, fetchFullText: true},
        {source: 'web_article', expectedVersion: 0, refresh: true},
      ),
    ).rejects.toMatchObject({code: 'stale_intake_version'});
    expect(f.rows.get(S)?.value).toMatchObject({
      decision: 'blocked',
      reason: 'Do not continue',
    });
    expect(f.rows.get(S)?.value.preparedSnapshotId).toBeUndefined();
  });
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
  it('reviews substantial syndicated prose before any web request while keeping exact evidence', async () => {
    const f = fixture(false, 'application/rss+xml');
    const body =
      '# Synthetic bulletin\n\n' +
      '星藤观察站记录完整背景和方法。'.repeat(50) +
      '\n\n' +
      '月岩观测结果与后续讨论均在此。'.repeat(50);
    const full =
      body + '\n\n[查看原始条目](https://example.invalid/synthetic)\n';
    texts.set(S, full);
    await f.service.receive([{snapshotId: S, expectedVersion: 0}], 'reset');
    expect(
      await f.service.needsReview(S, {...policy, fetchFullText: true}),
    ).toBe(true);
    expect(f.rows.get(S)?.value).toMatchObject({
      receipt: 'pending',
      decision: 'pending',
      bodySource: 'received',
    });
    expect(f.readWeb).not.toHaveBeenCalled();
    expect(f.provider.reviewIntake).not.toHaveBeenCalled();
    await f.service.review(S, {...policy, fetchFullText: true}, true);
    expect(f.provider.reviewIntake).toHaveBeenCalledWith(
      expect.objectContaining({text: body}),
    );
    expect(texts.get(S)).toBe(full);
  });
  it('reviews readable feed text after a failed fetch but still holds a genuine teaser', async () => {
    const f = fixture(false, 'application/xml');
    const body =
      '# Synthetic teaser\n\n' +
      '星藤实验室发布了简短预告，详细结果尚未提供。'.repeat(8);
    texts.set(
      S,
      body + '\n\n[查看原始条目](https://example.invalid/synthetic)\n',
    );
    f.provider.reviewIntake.mockResolvedValueOnce({
      completeness: 'summary',
      contentKind: 'research',
      decision: 'hold',
      reason: '合成预告缺少研究正文',
    });
    expect(
      await f.service.needsReview(S, {...policy, fetchFullText: true}),
    ).toBe(true);
    expect(f.rows.get(S)?.value).toMatchObject({
      decision: 'pending',
      bodySource: 'received',
    });
    expect(f.readWeb).toHaveBeenCalledTimes(1);
    expect(f.provider.reviewIntake).not.toHaveBeenCalled();
    await f.service.review(S, {...policy, fetchFullText: true});
    expect(f.provider.reviewIntake).toHaveBeenCalledWith(
      expect.objectContaining({text: body}),
    );
    expect(f.rows.get(S)?.value).toMatchObject({
      decision: 'held',
      assessment: {completeness: 'summary'},
    });
    await f.service.needsReview(S, {...policy, fetchFullText: true});
    expect(f.readWeb).toHaveBeenCalledTimes(1);
  });
  it('preserves an explicit web selection and a newer owner decision when fetching fails', async () => {
    const f = fixture(false, 'application/rss+xml');
    texts.set(
      S,
      '# Synthetic\n\n' +
        'Readable received prose. '.repeat(100) +
        '\n\n[查看原始条目](https://example.invalid/synthetic)',
    );
    const r = await f.service.prepare(
      S,
      {...policy, fetchFullText: true},
      {source: 'web_article', expectedVersion: 0, refresh: true},
    );
    expect(r?.value.decision).toBe('held');
    expect(r?.value.bodySource).toBeUndefined();
    await f.service.control(S, 1, 'reset', 'Synthetic retry');
    f.readWeb.mockImplementationOnce(async () => {
      await f.service.control(S, 2, 'block', 'Owner decision during fetch');
      throw new Error('synthetic-fetch-failure');
    });
    await expect(
      f.service.prepare(S, {...policy, fetchFullText: true}),
    ).rejects.toMatchObject({code: 'stale_intake_version'});
    expect(f.rows.get(S)?.value).toMatchObject({
      decision: 'blocked',
      origin: 'manual',
    });
    expect(f.provider.reviewIntake).not.toHaveBeenCalled();
  });
  it('removes only an exact RSS return footer, including escaped destinations', async () => {
    const f = fixture(false, 'application/atom+xml; charset=utf-8');
    f.snapshot.canonicalUri = 'https://example.invalid/synthetic)';
    const body =
      '# Synthetic\n\n[查看原始条目](https://example.invalid/another)\n\n星藤观测站公布了完整观测结果。';
    texts.set(
      S,
      body + '\n\n[查看原始条目](https://example.invalid/synthetic%29)\n',
    );
    await f.service.review(S, policy);
    expect(f.provider.reviewIntake).toHaveBeenCalledWith(
      expect.objectContaining({text: body}),
    );
  });
  it.each(['text/html', 'application/rss+xml'])(
    'preserves publisher links that are not an exact feed footer: %s',
    async (mediaType) => {
      const f = fixture(false, mediaType);
      const text =
        '# Synthetic\n\n[查看原始条目](https://example.invalid/synthetic)\n\nA publisher paragraph after the link.\n\n[查看原始条目](https://example.invalid/another)\n';
      texts.set(S, text);
      await f.service.review(S, policy);
      expect(f.provider.reviewIntake).toHaveBeenCalledWith(
        expect.objectContaining({text}),
      );
    },
  );
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

it('accepts a reviewed receipt into the same continuing document task as unpublished progress', async () => {
  const f = fixture();
  await f.service.receive([{snapshotId: S, expectedVersion: 0}], 'reset');
  const reviewed = requireOperationValue(
    await f.service.review(S, policy, true),
  );
  expect(
    await f.service.acceptReviewedReceipt(S, P, reviewed.version, true),
  ).toBe('accepted');
  expect(f.rows.get(S)?.value).toMatchObject({
    receipt: 'accepted',
    deferProcessing: false,
    publication: {origin: 'internal_ai', entries: []},
  });
  expect(await f.service.guard(S)).toBeUndefined();
});

it.each(['accept', 'reject'] as const)(
  'retains the explicit reason when confirming %s, but clears it on reversal',
  async (action) => {
    const f = fixture();
    const previous = requireOperationValue(
      f.snapshots.find((s) => s.snapshotId === P),
    );
    previous.canonicalUri = 'https://example.invalid/previous';
    await f.service.control(
      P,
      0,
      action === 'accept' ? 'admit' : 'block',
      'Explicit synthetic reading reason',
    );
    await f.service.receive([{snapshotId: P, expectedVersion: 1}], action);
    await f.service.review(S, policy);
    expect(f.provider.reviewIntake.mock.calls[0]?.[0].manualReviews).toEqual([
      {
        decision: action,
        excerpt: 'A complete synthetic article about starvine mechanics.',
        ownerReason: 'Explicit synthetic reading reason',
      },
    ]);
    await f.service.receive(
      [{snapshotId: P, expectedVersion: 2}],
      action === 'accept' ? 'reject' : 'accept',
    );
    expect(f.rows.get(P)?.value.manualReviewNote).toBeUndefined();
  },
);

it('uses explicit public manual decisions as examples without treating old AI reasons as owner reasons', async () => {
  const f = fixture();
  const previous = requireOperationValue(
    f.snapshots.find((s) => s.snapshotId === P),
  );
  previous.canonicalUri = 'https://example.invalid/previous';
  f.rows.set(P, {
    snapshotId: P,
    version: 1,
    updatedAt: '2040-01-01T00:00:00Z',
    value: {
      decision: 'held',
      origin: 'model',
      preparation: 'received',
      reason: 'Previous model reason',
      assessment: {
        completeness: 'summary',
        contentKind: 'article',
        decision: 'hold',
        reason: 'Old AI assessment',
      },
      receipt: 'pending',
    },
  });
  await f.service.receive([{snapshotId: P, expectedVersion: 1}], 'reject');
  const result = await f.service.review(S, policy);
  expect(f.provider.reviewIntake.mock.calls[0]?.[0].manualReviews).toEqual([
    {
      decision: 'reject',
      excerpt: 'A complete synthetic article about starvine mechanics.',
      previousAiAssessment: {
        completeness: 'summary',
        contentKind: 'article',
        decision: 'hold',
        reason: 'Old AI assessment',
      },
    },
  ]);
  expect(result?.value.appliedManualReviews).toEqual([
    {snapshotId: P, version: 2},
  ]);
  previous.isPrivate = true;
  await f.service.receive(
    [{snapshotId: S, expectedVersion: result?.version ?? 0}],
    'reset',
  );
  await f.service.review(S, policy);
  expect(
    f.provider.reviewIntake.mock.calls[1]?.[0].manualReviews,
  ).toBeUndefined();
});
