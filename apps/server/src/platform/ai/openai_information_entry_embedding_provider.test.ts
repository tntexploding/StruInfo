import {describe, expect, it, vi} from 'vitest';

import {
  OPENAI_EMBEDDINGS_ENDPOINT,
  OpenAiInformationEntryEmbeddingProvider,
} from './openai_information_entry_embedding_provider.js';
import type {OpenAiFetch} from './openai_entry_tag_provider.js';

const CONFIG = Object.freeze({
  providerKey: 'openai-embeddings-v1' as const,
  model: 'text-embedding-synthetic',
  apiKey: 'synthetic-api-key',
  maximumBatchSize: 32 as const,
  timeoutMs: 60_000 as const,
});

describe('OpenAiInformationEntryEmbeddingProvider', () => {
  it('uses the official embeddings shape and restores vectors by response index', async () => {
    const fetchImplementation = vi.fn<OpenAiFetch>(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            data: [
              {index: 1, embedding: [0, 1]},
              {index: 0, embedding: [1, 0]},
            ],
          }),
          {status: 200, headers: {'content-type': 'application/json'}},
        ),
      ),
    );
    const provider = new OpenAiInformationEntryEmbeddingProvider(
      CONFIG,
      fetchImplementation,
    );

    await expect(provider.embed(['alpha', 'beta'])).resolves.toEqual([
      [1, 0],
      [0, 1],
    ]);
    const [url, init] = fetchImplementation.mock.calls[0] ?? [];
    expect(url).toBe(OPENAI_EMBEDDINGS_ENDPOINT);
    expect(init?.headers).toMatchObject({
      Authorization: 'Bearer synthetic-api-key',
      'Content-Type': 'application/json',
    });
    if (typeof init?.body !== 'string') {
      throw new Error('Expected the embedding request body to be JSON text.');
    }
    expect(JSON.parse(init.body)).toEqual({
      model: 'text-embedding-synthetic',
      input: ['alpha', 'beta'],
      encoding_format: 'float',
    });
  });

  it('rejects malformed count, duplicate indexes and inconsistent dimensions', async () => {
    for (const data of [
      [{index: 0, embedding: [1, 0]}],
      [
        {index: 0, embedding: [1, 0]},
        {index: 0, embedding: [0, 1]},
      ],
      [
        {index: 0, embedding: [1, 0]},
        {index: 1, embedding: [0]},
      ],
    ]) {
      const provider = new OpenAiInformationEntryEmbeddingProvider(CONFIG, () =>
        Promise.resolve(
          new Response(JSON.stringify({data}), {
            status: 200,
            headers: {'content-type': 'application/json'},
          }),
        ),
      );
      await expect(provider.embed(['alpha', 'beta'])).rejects.toThrow(
        /invalid response/u,
      );
    }
  });

  it('rejects empty input, transport failures and rejected responses without exposing content', async () => {
    const unused = new OpenAiInformationEntryEmbeddingProvider(CONFIG, vi.fn());
    await expect(unused.embed([])).rejects.toThrow(/Invalid embedding input/u);

    const unavailable = new OpenAiInformationEntryEmbeddingProvider(
      CONFIG,
      () => Promise.reject(new Error('synthetic sensitive transport detail')),
    );
    await expect(unavailable.embed(['alpha'])).rejects.toThrow(
      'Embedding provider unavailable.',
    );

    const rejected = new OpenAiInformationEntryEmbeddingProvider(CONFIG, () =>
      Promise.resolve(new Response('synthetic sensitive body', {status: 429})),
    );
    await expect(rejected.embed(['alpha'])).rejects.toThrow(
      'Embedding provider rejected request.',
    );
  });
});
