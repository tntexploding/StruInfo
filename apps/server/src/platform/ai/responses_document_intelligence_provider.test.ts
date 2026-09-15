import {describe, expect, it, vi} from 'vitest';
import {ResponsesDocumentIntelligenceProvider} from './responses_document_intelligence_provider.js';
import {intakePolicySchema} from '../../application/document_intake_contract.js';
const config = {
  providerKey: 'deepseek-responses-v1' as const,
  model: 'synthetic-model',
  apiKey: 'synthetic-secret',
  maxOutputTokens: 800 as const,
  timeoutMs: 60000 as const,
};
const response = (value: unknown) =>
  new Response(
    JSON.stringify({
      status: 'completed',
      output: [
        {
          type: 'message',
          content: [{type: 'output_text', text: JSON.stringify(value)}],
        },
      ],
    }),
  );
describe('closed document intelligence adapter', () => {
  it('uses the configured Responses provider with no storage or tools and enforces incomplete holds', async () => {
    const fetcher = vi.fn<typeof fetch>(() =>
      Promise.resolve(
        response({
          completeness: 'summary',
          contentKind: 'article',
          decision: 'admit',
          reason: 'Only a synthetic summary.',
        }),
      ),
    );
    const provider = new ResponsesDocumentIntelligenceProvider(config, fetcher);
    expect(
      (
        await provider.reviewIntake({
          text: 'Synthetic',
          preparation: 'received',
          policy: intakePolicySchema.parse({}),
        })
      ).decision,
    ).toBe('hold');
    const requestBody = fetcher.mock.calls[0]?.[1]?.body;
    if (typeof requestBody !== 'string')
      throw new Error('missing request body');
    const call = JSON.parse(requestBody) as Record<string, unknown>;
    expect(call).toMatchObject({
      store: false,
      model: 'synthetic-model',
      reasoning: {effort: 'none'},
    });
    expect(call).not.toHaveProperty('tools');
  });
  it('accepts only bounded typed recall plans and never surfaces provider errors', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        response({
          concepts: [
            {
              term: 'Starvine buffer',
              english: 'starvine buffering',
              chinese: '星藤缓冲',
            },
          ],
        }),
      )
      .mockResolvedValueOnce(response({concepts: [], arbitrary: true}))
      .mockRejectedValueOnce(new Error('synthetic-secret raw failure'));
    const provider = new ResponsesDocumentIntelligenceProvider(config, fetcher);
    expect(
      await provider.planRecall({
        title: 'Synthetic',
        body: 'Synthetic',
        keywords: [],
      }),
    ).toMatchObject({
      concepts: [{variants: ['starvine buffering', '星藤缓冲']}],
    });
    await expect(
      provider.planRecall({title: 'Synthetic', body: '', keywords: []}),
    ).rejects.toMatchObject({code: 'ai_provider_invalid_response'});
    await expect(
      provider.planRecall({title: 'Synthetic', body: '', keywords: []}),
    ).rejects.toThrow('ai_provider_unavailable');
  });
});
