import {describe, expect, it, vi} from 'vitest';

import type {CurrentInformationEntry} from '../../modules/entries/index.js';
import {AiTagProposalProviderError} from '../../modules/processing/index.js';
import {
  OPENAI_RESPONSES_ENDPOINT,
  OPENAI_TAG_PROMPT_VERSION,
  OpenAiEntryTagProvider,
  type OpenAiFetch,
} from './openai_entry_tag_provider.js';

const CONFIG = Object.freeze({
  providerKey: 'openai-responses-v1' as const,
  model: 'gpt-5-mini',
  apiKey: 'synthetic-api-key',
  maxOutputTokens: 800 as const,
  timeoutMs: 60_000 as const,
});

describe('OpenAiEntryTagProvider', () => {
  it('sends one public Entry through the Responses API with storage and tools disabled', async () => {
    const fetchImplementation = vi.fn<OpenAiFetch>(() =>
      Promise.resolve(
        responseEnvelope({
          summary: '可检查的标签建议',
          contentKeywords: ['PostgreSQL', '全文检索'],
          type: {keyword: 'knowledge_explanation', customName: null},
          domains: [{keyword: 'engineering_computing', customName: null}],
        }),
      ),
    );
    const provider = new OpenAiEntryTagProvider(CONFIG, fetchImplementation);

    await expect(provider.proposeTags(entry())).resolves.toEqual({
      summary: '可检查的标签建议',
      contentKeywords: ['PostgreSQL', '全文检索'],
      typeKeyword: 'knowledge_explanation',
      domains: [{keyword: 'engineering_computing'}],
    });
    expect(provider.promptVersion).toBe(OPENAI_TAG_PROMPT_VERSION);
    expect(fetchImplementation).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImplementation.mock.calls[0] ?? [];
    expect(url).toBe(OPENAI_RESPONSES_ENDPOINT);
    expect(init?.method).toBe('POST');
    expect(init?.headers).toEqual({
      Authorization: 'Bearer synthetic-api-key',
      'Content-Type': 'application/json',
    });
    if (typeof init?.body !== 'string') throw new Error('missing request body');
    const request = JSON.parse(init.body) as Record<string, unknown>;
    expect(request).toMatchObject({
      model: 'gpt-5-mini',
      store: false,
      max_output_tokens: 800,
    });
    expect(request).not.toHaveProperty('tools');
    expect(String(request.input)).toContain('Synthetic public body');
  });

  it('rejects private Entries before calling the Provider', async () => {
    const fetchImplementation = vi.fn<OpenAiFetch>();
    const provider = new OpenAiEntryTagProvider(CONFIG, fetchImplementation);

    await expect(provider.proposeTags(entry(true))).rejects.toMatchObject({
      code: 'ai_provider_rejected',
    });
    expect(fetchImplementation).not.toHaveBeenCalled();
  });

  it('fails closed on duplicate normalized keywords and invalid envelopes', async () => {
    const duplicateProvider = new OpenAiEntryTagProvider(CONFIG, () =>
      Promise.resolve(
        responseEnvelope({
          summary: '重复标签',
          contentKeywords: ['PostgreSQL', 'postgresql'],
          type: {keyword: 'knowledge_explanation', customName: null},
          domains: [{keyword: 'engineering_computing', customName: null}],
        }),
      ),
    );
    await expect(duplicateProvider.proposeTags(entry())).rejects.toEqual(
      new AiTagProposalProviderError('ai_provider_invalid_response'),
    );

    const incompleteProvider = new OpenAiEntryTagProvider(CONFIG, () =>
      Promise.resolve(
        new Response('{"status":"incomplete","output":[]}', {status: 200}),
      ),
    );
    await expect(incompleteProvider.proposeTags(entry())).rejects.toMatchObject(
      {
        code: 'ai_provider_invalid_response',
      },
    );
  });
});

function responseEnvelope(payload: unknown): Response {
  return new Response(
    JSON.stringify({
      status: 'completed',
      output: [
        {
          type: 'message',
          content: [{type: 'output_text', text: JSON.stringify(payload)}],
        },
      ],
    }),
    {status: 200, headers: {'content-type': 'application/json'}},
  );
}

function entry(isPrivate = false): Readonly<CurrentInformationEntry> {
  return Object.freeze({
    workspaceId: '11111111-1111-4111-8111-111111111111',
    entryId: '22222222-2222-4222-8222-222222222222',
    resourceId: '33333333-3333-4333-8333-333333333333',
    snapshotId: '44444444-4444-4444-8444-444444444444',
    revision: 1,
    revisionId: '55555555-5555-4555-8555-555555555555',
    sourceKey: 'synthetic:public-entry',
    capturedAt: '2040-01-02T03:04:05.000Z',
    value: Object.freeze({
      documentOrder: 0,
      titlePath: 'Synthetic Entry',
      body: 'Synthetic public body',
      bodySha256: 'a'.repeat(64),
      chunkMode: 'split',
      splitRuleVersion: 'struinfo.entry-split.section.v1',
      isPrivate,
      typeKeyword: 'knowledge_explanation',
      contentKeywords: Object.freeze([]),
      domains: Object.freeze([]),
      fragmentIds: Object.freeze(['66666666-6666-4666-8666-666666666666']),
    }),
  });
}
