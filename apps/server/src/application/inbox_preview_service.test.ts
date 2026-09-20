import {describe, expect, it, vi} from 'vitest';
import {
  InboxPreviewService,
  inboxTextPreview,
} from './inbox_preview_service.js';
import type {
  DocumentIntakeRepository,
  IntakeRecord,
} from './document_intake_contract.js';
import type {EvidenceReadRepositoryPort} from '../modules/evidence/index.js';
import type {BlobStore} from '../storage/blob_store.js';
import {materializeEvidenceSnapshot} from '../modules/evidence/index.js';
import {requireOperationValue} from './operation_error.js';
import type {IngestionOrigin} from './ingestion_contract.js';
import {AiPriceWindowClosedError} from '../modules/processing/ai_price_policy.js';
vi.mock('../modules/evidence/index.js', async (original) => ({
  ...(await original<object>()),
  materializeEvidenceSnapshot: vi.fn(),
}));
const W = '10000000-0000-4000-8000-000000000001';
const S = '10000000-0000-4000-8000-000000000002';
function fixture(privateSource = false) {
  const rows = new Map<string, IntakeRecord>([
    [
      S,
      {
        snapshotId: S,
        version: 4,
        updatedAt: '2040-01-01T00:00:00Z',
        value: {
          decision: 'held',
          receipt: 'accepted',
          receiptOrigin: 'manual',
          origin: 'manual',
          reason: 'Owner reason',
          preparation: 'received',
        },
      },
    ],
  ]);
  const save = vi.fn<DocumentIntakeRepository['save']>();
  const repository: DocumentIntakeRepository = {
    read: (id) => Promise.resolve(rows.get(id)),
    list: () => Promise.resolve([...rows.values()]),
    save,
    withLock: async (_id, action) => action(),
    saveInboxSummary: (id, summary) => {
      const row = rows.get(id);
      if (row)
        rows.set(id, {...row, value: {...row.value, inboxSummary: summary}});
      return Promise.resolve();
    },
  };
  const loadSnapshot = vi.fn(() =>
    Promise.resolve({
      snapshotId: S,
      workspaceId: W,
      resourceKind: 'remote_document',
      sourceKey: 'opaque-source',
      canonicalUri: 'https://example.invalid/article',
      isPrivate: privateSource,
    }),
  );
  vi.mocked(materializeEvidenceSnapshot).mockReset();
  vi.mocked(materializeEvidenceSnapshot).mockResolvedValue({
    structures: [
      {
        normalizedText:
          '# Synthetic **subject**\n\nAn independently readable explanation.\n\n[查看原始条目](https://example.invalid/article)',
      },
    ],
  } as unknown as Awaited<ReturnType<typeof materializeEvidenceSnapshot>>);
  const provider = {
    model: 'synthetic-model',
    summarizeInbox: vi.fn(() =>
      Promise.resolve({text: '合成材料解释一个完整的机制。'}),
    ),
  };
  const translationProvider = {
    providerKey: 'deepseek-responses-v1' as const,
    model: 'synthetic-model',
    promptVersion: 'synthetic-translation-v1',
    translate: vi.fn(() =>
      Promise.resolve({title: '合成主题', body: '完整合成译文。'}),
    ),
  };
  const checkModelCall = vi.fn(() => Promise.resolve());
  const origin = vi.fn<() => Promise<IngestionOrigin | undefined>>(() =>
    Promise.resolve({kind: 'subscription', subscriptionId: S}),
  );
  const sources = vi.fn(() =>
    Promise.resolve([
      {
        subscriptionId: S,
        label: 'Synthetic journal',
        kind: 'rss_atom',
        sourceAlias: 'synthetic/research',
        isPrivate: false,
      },
    ]),
  );
  const service = new InboxPreviewService({
    workspaceId: W,
    evidence: {loadSnapshot} as unknown as EvidenceReadRepositoryPort,
    blobStore: {} as BlobStore,
    repository,
    origin,
    sources,
    provider,
    translationProvider,
    checkModelCall,
    now: () => '2040-01-01T00:00:00.000Z',
  });
  return {
    service,
    loadSnapshot,
    origin,
    sources,
    rows,
    repository,
    provider,
    translationProvider,
    checkModelCall,
    save,
  };
}
describe('inbox reading previews and explicit summaries', () => {
  it('shows the real heading, source and excerpt without calling a model or interpreting source HTML', async () => {
    const f = fixture();
    const value = await f.service.preview([S]);
    expect(value.failed).toEqual([]);
    expect(value.previews[0]).toMatchObject({
      title: 'Synthetic subject',
      excerpt: 'An independently readable explanation.',
      source: {
        name: 'Synthetic journal',
        kind: 'rss_atom',
        host: 'example.invalid',
      },
    });
    expect(f.provider.summarizeInbox).not.toHaveBeenCalled();
    expect(
      inboxTextPreview('# A\n\n<script>bad()</script>\n\nVisible text.')
        .excerpt,
    ).toBe('Visible text.');
  });
  it('caches one request and preserves the manual choice and its concurrency version', async () => {
    const f = fixture();
    const before = requireOperationValue(f.rows.get(S));
    const [first, second] = await Promise.all([
      f.service.summarize(S),
      f.service.summarize(S),
    ]);
    expect(first).toEqual(second);
    expect(await f.service.summarize(S)).toEqual(first);
    expect(f.provider.summarizeInbox).toHaveBeenCalledTimes(1);
    expect(f.save).not.toHaveBeenCalled();
    expect(f.rows.get(S)).toEqual({
      ...before,
      value: {...before.value, inboxSummary: first},
    });
  });
  it('never transfers private bytes, while explicit local preview remains available', async () => {
    const f = fixture(true);
    await expect(f.service.summarize(S)).rejects.toMatchObject({
      code: 'private_model_transfer_forbidden',
    });
    expect(materializeEvidenceSnapshot).not.toHaveBeenCalled();
    expect(f.provider.summarizeInbox).not.toHaveBeenCalled();
    expect((await f.service.preview([S])).previews).toEqual([]);
    expect((await f.service.preview([S], true)).previews).toHaveLength(1);
  });
  it('stops on the dispatch gate without persisting an empty summary or retrying', async () => {
    const f = fixture();
    f.checkModelCall.mockRejectedValue(new AiPriceWindowClosedError());
    await expect(f.service.summarize(S)).rejects.toMatchObject({
      code: 'ai_price_window_closed',
    });
    expect(f.provider.summarizeInbox).not.toHaveBeenCalled();
    expect(f.rows.get(S)?.value.inboxSummary).toBeUndefined();
  });
  it('merges only derived summary metadata after a concurrent manual decision', async () => {
    const f = fixture();
    f.provider.summarizeInbox.mockImplementation(() => {
      const row = requireOperationValue(f.rows.get(S));
      f.rows.set(S, {
        ...row,
        version: 5,
        value: {...row.value, receipt: 'rejected', reason: 'New manual choice'},
      });
      return Promise.resolve({text: '合成材料的阅读概要。'});
    });
    await f.service.summarize(S);
    expect(f.rows.get(S)).toMatchObject({
      version: 5,
      value: {
        receipt: 'rejected',
        reason: 'New manual choice',
        inboxSummary: {text: '合成材料的阅读概要。'},
      },
    });
  });
  it('rejects oversized and malformed summary output without changing decisions', async () => {
    const f = fixture();
    f.provider.summarizeInbox.mockResolvedValue({text: 'x'.repeat(261)});
    await expect(f.service.summarize(S)).rejects.toThrow();
    expect(f.rows.get(S)?.value.inboxSummary).toBeUndefined();
  });
});

describe('source directory', () => {
  it('keeps capture identity without an automation record, including after source alias changes', async () => {
    const f = fixture();
    f.origin.mockResolvedValue(undefined);
    const record = requireOperationValue(f.rows.get(S));
    f.rows.set(S, {
      ...record,
      value: {
        ...record.value,
        captureOrigin: {kind: 'subscription', subscriptionId: S},
      },
    });
    expect((await f.service.origins([S])).origins[0]).toEqual({
      snapshotId: S,
      kind: 'subscription',
      subscriptionId: S,
    });
    expect((await f.service.preview([S])).previews[0]?.source.name).toBe(
      'Synthetic journal',
    );
    expect(f.origin).not.toHaveBeenCalled();
    expect(f.save).not.toHaveBeenCalled();
  });
  it('recovers older captures only from a unique exact normalized subscription alias', async () => {
    const f = fixture();
    f.origin.mockResolvedValue(undefined);
    const snapshot = await f.loadSnapshot();
    f.loadSnapshot.mockResolvedValue({
      ...snapshot,
      sourceKey: 'synthetic／research#0123456789abcdef01234567',
    });
    expect((await f.service.origins([S])).origins[0]).toEqual({
      snapshotId: S,
      kind: 'subscription',
      subscriptionId: S,
    });
    expect((await f.service.preview([S])).previews[0]?.source.name).toBe(
      'Synthetic journal',
    );
    expect(f.save).not.toHaveBeenCalled();
    expect(f.provider.summarizeInbox).not.toHaveBeenCalled();
  });
  it('does not guess by host or silently select an ambiguous subscription', async () => {
    const f = fixture();
    f.origin.mockResolvedValue(undefined);
    expect((await f.service.origins([S])).origins[0]).toEqual({
      snapshotId: S,
      kind: 'remote_document',
    });
    const snapshot = await f.loadSnapshot();
    f.loadSnapshot.mockResolvedValue({
      ...snapshot,
      sourceKey: 'synthetic／research#0123456789abcdef01234567',
    });
    const [source] = await f.sources();
    if (!source) throw new Error('synthetic source missing');
    f.sources.mockResolvedValue([source, {...source, subscriptionId: W}]);
    expect((await f.service.origins([S])).origins[0]).toEqual({
      snapshotId: S,
      kind: 'remote_document',
    });
    expect((await f.service.preview([S])).previews[0]?.source.name).toBe(
      'example.invalid',
    );
  });
  it('does not expose private subscription labels in a public directory', async () => {
    const f = fixture();
    const [source] = await f.sources();
    if (!source) throw new Error('synthetic source missing');
    f.sources.mockResolvedValue([{...source, isPrivate: true}]);
    expect((await f.service.preview([S])).previews[0]?.source.name).toBe(
      'example.invalid',
    );
    expect((await f.service.preview([S], true)).previews[0]?.source.name).toBe(
      'Synthetic journal',
    );
  });

  it('uses recorded subscription identity without reading body blobs or calling a model', async () => {
    const f = fixture();
    vi.mocked(materializeEvidenceSnapshot).mockClear();
    expect(await f.service.origins([S])).toEqual({
      origins: [{snapshotId: S, subscriptionId: S, kind: 'subscription'}],
    });
    expect(materializeEvidenceSnapshot).not.toHaveBeenCalled();
    expect(f.provider.summarizeInbox).not.toHaveBeenCalled();
  });
  it('requires a fresh visibility opt-in for private source metadata', async () => {
    const f = fixture(true);
    await expect(f.service.origins([S])).rejects.toMatchObject({
      code: 'private_model_transfer_forbidden',
    });
    expect((await f.service.origins([S], true)).origins).toHaveLength(1);
  });
});

it('translates a pending document for reading without accepting or materializing it', async () => {
  const f = fixture();
  const before = structuredClone(f.rows.get(S));
  const [first, second] = await Promise.all([
    f.service.translate(S),
    f.service.translate(S),
  ]);
  expect(first).toEqual(second);
  expect(f.translationProvider.translate).toHaveBeenCalledTimes(1);
  expect(f.rows.get(S)).toEqual(before);
  expect(f.save).not.toHaveBeenCalled();
});
it('keeps translation private and price guards ahead of source transfer', async () => {
  const privateFixture = fixture(true);
  await expect(privateFixture.service.translate(S)).rejects.toMatchObject({
    code: 'private_model_transfer_forbidden',
  });
  expect(materializeEvidenceSnapshot).not.toHaveBeenCalled();
  expect(privateFixture.translationProvider.translate).not.toHaveBeenCalled();
  const gated = fixture();
  gated.checkModelCall.mockRejectedValue(new AiPriceWindowClosedError());
  await expect(gated.service.translate(S)).rejects.toMatchObject({
    code: 'ai_price_window_closed',
  });
  expect(gated.translationProvider.translate).not.toHaveBeenCalled();
});
