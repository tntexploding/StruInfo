import {describe, expect, it, vi} from 'vitest';
import {ResponsesEntryTranslationProvider} from './responses_entry_translation_provider.js';

const SOURCE = {
  title: 'Synthetic text',
  body: 'One paragraph.\n\nAnother paragraph. 12 `x`',
};
const TRANSLATED = {title: '合成文本', body: '第一段。\n\n另一段。12 `x`'};
function response(payload: unknown = TRANSLATED, status = 'completed') {
  return new Response(
    JSON.stringify({
      status,
      output: [
        {
          type: 'message',
          content: [{type: 'output_text', text: JSON.stringify(payload)}],
        },
      ],
    }),
  );
}

describe.each(['openai-responses-v1', 'deepseek-responses-v1'] as const)(
  '%s Entry translation adapter',
  (providerKey) => {
    function provider(fetchImplementation: typeof fetch) {
      return new ResponsesEntryTranslationProvider(
        {apiKey: 'synthetic-key', model: 'synthetic-model', providerKey},
        fetchImplementation,
      );
    }
    it('uses a bounded no-store Responses request containing only title and body', async () => {
      const fetchMock = vi.fn<typeof fetch>(() => Promise.resolve(response()));
      expect(await provider(fetchMock).translate(SOURCE)).toEqual(TRANSLATED);
      const init = fetchMock.mock.calls[0]?.[1];
      if (typeof init?.body !== 'string')
        throw new Error('Missing synthetic request');
      const request = JSON.parse(init.body) as Record<string, unknown>;
      expect(request.store).toBe(false);
      expect(request.model).toBe('synthetic-model');
      expect(request.max_output_tokens).toBe(16_384);
      expect(request.input).toBe(JSON.stringify({source: SOURCE}));
      expect(request.tools).toBeUndefined();
      expect(request.reasoning).toEqual(
        providerKey === 'deepseek-responses-v1' ? {effort: 'none'} : undefined,
      );
      expect(fetchMock.mock.calls[0]?.[0]).toBe(
        providerKey === 'deepseek-responses-v1'
          ? 'https://api.deepseek.com/responses'
          : 'https://api.openai.com/v1/responses',
      );
      expect(request.text).toMatchObject({
        format: {type: 'json_schema', strict: true},
      });
      expect(init.signal).toBeInstanceOf(AbortSignal);
    });
    it.each([
      () => response(TRANSLATED, 'incomplete'),
      () => response({...TRANSLATED, extra: 'opaque'}),
      () => response({...TRANSLATED, body: ''}),
      () => new Response('not JSON'),
      () =>
        new Response(
          JSON.stringify({
            status: 'completed',
            output: [
              {type: 'message', content: [{type: 'refusal', refusal: 'text'}]},
            ],
          }),
        ),
      () => new Response('x'.repeat(1_048_577)),
    ])(
      'rejects malformed, refused, oversized or incomplete responses',
      async (makeResponse) => {
        await expect(
          provider(() => Promise.resolve(makeResponse())).translate(SOURCE),
        ).rejects.toMatchObject({code: 'ai_provider_invalid_response'});
      },
    );
    it('does not expose provider errors or credentials', async () => {
      await expect(
        provider(() =>
          Promise.resolve(new Response('secret details', {status: 429})),
        ).translate(SOURCE),
      ).rejects.toMatchObject({message: 'ai_provider_rejected'});
      await expect(
        provider(() => Promise.reject(new Error('secret details'))).translate(
          SOURCE,
        ),
      ).rejects.toMatchObject({message: 'ai_provider_unavailable'});
    });
  },
);
