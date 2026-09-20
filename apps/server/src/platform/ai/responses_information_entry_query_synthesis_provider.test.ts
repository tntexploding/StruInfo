import {
  responsesEndpoint,
  responsesPromptVersion,
} from './responses_configuration.js';
import {describe, expect, it, vi} from 'vitest';

import {
  AiQuerySynthesisProviderError,
  type InformationEntryQuerySynthesisProviderEvidence,
} from '../../modules/entries/index.js';
import {
  OPENAI_QUERY_SYNTHESIS_PROMPT_VERSION,
  ResponsesInformationEntryQuerySynthesisProvider,
} from './responses_information_entry_query_synthesis_provider.js';
import {type OpenAiFetch} from './responses_entry_tag_provider.js';

const BASE_CONFIG = Object.freeze({
  providerKey: 'openai-responses-v1' as const,
  model: 'gpt-5-mini',
  apiKey: 'synthetic-api-key',
  maxOutputTokens: 800 as const,
  timeoutMs: 60_000 as const,
});

describe.each([
  BASE_CONFIG,
  {
    ...BASE_CONFIG,
    providerKey: 'deepseek-responses-v1' as const,
    model: 'deepseek-synthetic',
  },
])('$providerKey $model', (CONFIG) => {
  it('sends only bounded evidence handles and uses a stored-off tool-free Responses request', async () => {
    const fetchImplementation = vi.fn<OpenAiFetch>(() =>
      Promise.resolve(
        responseEnvelope({
          answer: '合成答案',
          evidenceStatus: 'supported',
          claims: [{statement: '合成事实', evidenceRefs: ['E01']}],
          limitations: [],
        }),
      ),
    );
    const provider = new ResponsesInformationEntryQuerySynthesisProvider(
      CONFIG,
      fetchImplementation,
    );

    await expect(
      provider.synthesize('合成问题？', evidence()),
    ).resolves.toMatchObject({
      answer: '合成答案',
      evidenceStatus: 'supported',
    });
    expect(provider.promptVersion).toBe(
      responsesPromptVersion(CONFIG, OPENAI_QUERY_SYNTHESIS_PROMPT_VERSION),
    );
    const [url, init] = fetchImplementation.mock.calls[0] ?? [];
    expect(url).toBe(responsesEndpoint(CONFIG));
    if (typeof init?.body !== 'string') throw new Error('missing body');
    const request = JSON.parse(init.body) as Record<string, unknown>;
    expect(request).toMatchObject({
      model: CONFIG.model,
      store: false,
      max_output_tokens: 800,
    });
    expect(request).not.toHaveProperty('tools');
    expect(provider.providerKey).toBe(CONFIG.providerKey);
    expect(request.reasoning).toEqual(
      CONFIG.providerKey === 'deepseek-responses-v1'
        ? {effort: 'none'}
        : undefined,
    );
    expect(String(request.instructions)).toContain(
      'navigation metadata, not factual evidence',
    );
    expect(String(request.instructions)).toContain('body excerpt');
    expect(String(request.input)).toContain('E01');
    expect(String(request.input)).toContain('合成公开正文');
    expect(String(request.input)).not.toContain(
      '11111111-1111-4111-8111-111111111111',
    );
    expect(String(request.input)).not.toContain('synthetic:source');
  });

  it('fails closed on unknown evidence handles and uncited supported output', async () => {
    const unknown = new ResponsesInformationEntryQuerySynthesisProvider(
      CONFIG,
      () =>
        Promise.resolve(
          responseEnvelope({
            answer: '错误答案',
            evidenceStatus: 'supported',
            claims: [{statement: '错误事实', evidenceRefs: ['E09']}],
            limitations: [],
          }),
        ),
    );
    await expect(unknown.synthesize('问题', evidence())).rejects.toEqual(
      new AiQuerySynthesisProviderError('ai_provider_invalid_response'),
    );

    const uncited = new ResponsesInformationEntryQuerySynthesisProvider(
      CONFIG,
      () =>
        Promise.resolve(
          responseEnvelope({
            answer: '无引用答案',
            evidenceStatus: 'partial',
            claims: [],
            limitations: ['资料有限'],
          }),
        ),
    );
    await expect(uncited.synthesize('问题', evidence())).rejects.toMatchObject({
      code: 'ai_provider_invalid_response',
    });
  });

  it('distinguishes timeout and HTTP rejection from malformed output', async () => {
    const timeout = new ResponsesInformationEntryQuerySynthesisProvider(
      CONFIG,
      () =>
        Promise.reject(new DOMException('synthetic timeout', 'TimeoutError')),
    );
    await expect(timeout.synthesize('问题', evidence())).rejects.toEqual(
      new AiQuerySynthesisProviderError('ai_provider_timeout'),
    );

    const rejected = new ResponsesInformationEntryQuerySynthesisProvider(
      CONFIG,
      () => Promise.resolve(new Response('', {status: 429})),
    );
    await expect(rejected.synthesize('问题', evidence())).rejects.toEqual(
      new AiQuerySynthesisProviderError('ai_provider_rejected'),
    );

    const malformed = new ResponsesInformationEntryQuerySynthesisProvider(
      CONFIG,
      () =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              status: 'completed',
              output: [
                {
                  type: 'message',
                  content: [{type: 'output_text', text: '{not-json'}],
                },
              ],
            }),
            {status: 200, headers: {'content-type': 'application/json'}},
          ),
        ),
    );
    await expect(malformed.synthesize('问题', evidence())).rejects.toEqual(
      new AiQuerySynthesisProviderError('ai_provider_invalid_response'),
    );
  });
});

function evidence(): readonly Readonly<InformationEntryQuerySynthesisProviderEvidence>[] {
  return Object.freeze([
    Object.freeze({
      handle: 'E01',
      titlePath: '合成公开标题',
      excerpt: '合成公开正文',
      truncated: false,
      contentKeywords: Object.freeze(['合成关键词']),
      domains: Object.freeze([]),
    }),
  ]);
}

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
