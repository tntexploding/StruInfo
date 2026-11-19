import {afterEach, expect, it, vi} from 'vitest';
import {mkdtemp, rm, readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {
  AliyunInformationEntryEmbeddingProvider,
  ALIYUN_EMBEDDING_MODEL,
} from './aliyun_information_entry_embedding_provider.js';
import {
  LocalModelUsageJournal,
  type ModelUsageBudget,
} from './model_usage_journal.js';
import {priceAwareFetch} from './price_aware_fetch.js';

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0))
    await rm(root, {recursive: true, force: true});
});
const W = '00000000-0000-4000-8000-000000000001';
const settings = {
  enabled: true,
  baseUrl: 'https://maas.qianwenaiapi.com/compatible-mode/v1',
  limitCny: 1,
};
it('uses one bounded index batch, restores response order, and isolates embedding cost', async () => {
  const root = await mkdtemp(join(tmpdir(), 'struinfo-embedding-'));
  roots.push(root);
  const budget: ModelUsageBudget = {
    format: 'struinfo.ai-batch-budget.v1',
    workspaceId: W,
    batchId: 'embedding',
    model: ALIYUN_EMBEDDING_MODEL,
    limitCny: 1,
    paused: false,
    offPeakOnly: false,
    inputCnyPerMillion: 0.5,
    cachedInputCnyPerMillion: 0.5,
    outputCnyPerMillion: 0,
  };
  const journal = new LocalModelUsageJournal(root, W, undefined, {
    readBudget: () => Promise.resolve(budget),
    pause: () => {
      budget.paused = true;
      return Promise.resolve();
    },
  });
  const network = vi.fn<typeof fetch>((url, init) => {
    expect(url).toBe(settings.baseUrl + '/embeddings');
    expect(init?.redirect).toBe('error');
    const request = JSON.parse(
      typeof init?.body === 'string' ? init.body : '',
    ) as {
      input: string[];
      model: string;
      dimensions: number;
    };
    expect(request.model).toBe(ALIYUN_EMBEDDING_MODEL);
    expect(request.dimensions).toBe(1024);
    expect(request.input.length).toBeLessThanOrEqual(20);
    return Promise.resolve(
      new Response(
        JSON.stringify({
          data: request.input
            .map((text, index) => ({
              index,
              embedding: Array.from({length: 1024}, () => Number(text)),
            }))
            .reverse(),
          usage: {prompt_tokens: 100, total_tokens: 100},
        }),
      ),
    );
  });
  const gate = {assertAllowed: vi.fn(() => Promise.resolve())};
  const provider = new AliyunInformationEntryEmbeddingProvider(
    'synthetic-secret',
    () => Promise.resolve(settings),
    priceAwareFetch(gate, network, journal),
  );
  const vectors = await provider.embed(
    Array.from({length: provider.maximumBatchSize}, (_, i) => String(i + 1)),
  );
  expect(vectors.map((v) => v[0])).toEqual(
    Array.from({length: provider.maximumBatchSize}, (_, i) => i + 1),
  );
  expect(network).toHaveBeenCalledTimes(1);
  expect((await journal.budgetStatus())?.remainingCny).toBeCloseTo(0.99995, 8);
  const log = await readFile(join(root, W + '.embedding-usage.jsonl'), 'utf8');
  expect(log).not.toContain('synthetic-secret');
  expect(log).not.toContain('input":');
  budget.limitCny = 0;
  await expect(provider.embed(['1'])).rejects.toMatchObject({
    code: 'ai_batch_budget_paused',
  });
  expect(network).toHaveBeenCalledTimes(1);
});
it('blocks disabled settings, foreign endpoints, oversized input, and wrong vector dimensions', async () => {
  const network = vi.fn<typeof fetch>(() =>
    Promise.resolve(
      new Response(JSON.stringify({data: [{index: 0, embedding: [1, 2]}]})),
    ),
  );
  let current = {...settings, enabled: false};
  const provider = new AliyunInformationEntryEmbeddingProvider(
    'synthetic',
    () => Promise.resolve(current),
    network,
  );
  await expect(provider.embed(['test'])).rejects.toMatchObject({
    code: 'embedding_disabled',
  });
  current = {...settings, baseUrl: 'https://example.invalid'};
  await expect(provider.embed(['test'])).rejects.toThrow();
  expect(network).not.toHaveBeenCalled();
  current = settings;
  await expect(provider.embed(['测'.repeat(50_000)])).rejects.toMatchObject({
    code: 'embedding_input_too_large',
  });
  await expect(provider.embed(['test'])).rejects.toMatchObject({
    code: 'embedding_dimensions_mismatch',
  });
  expect(network).toHaveBeenCalledTimes(1);
});
