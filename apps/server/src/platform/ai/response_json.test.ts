import {describe, expect, it, vi} from 'vitest';
import {z} from 'zod';
import {parseResponseJson} from './response_json.js';
import {requestStructuredResponse} from './responses_structured_request.js';

describe('bounded structured output normalization', () => {
  it.each([
    '{"summary":"完整的合成说明"}',
    ' \n```json\n{"summary":"完整的合成说明"}\n```\n',
    '```JSON\r\n{"summary":"完整的合成说明"}\r\n```',
    '```\n{"summary":"完整的合成说明"}\n```',
  ])('accepts bare JSON or exactly one complete fence', (text) => {
    expect(parseResponseJson(text)).toEqual({summary: '完整的合成说明'});
  });

  it.each([
    'Here is the result:\n```json\n{}\n```',
    '```json\n{}\n```\nDone.',
    '```json\n{}\n```\n```json\n{}\n```',
    '```json\n{}',
    '```javascript\n{}\n```',
    '```json\n{domains: []}\n```',
    '```json\n{"summary": "broken"text"}\n```',
    '{} {}',
  ])(
    'does not repair invalid syntax or extract JSON from prose: %s',
    (text) => {
      expect(() => parseResponseJson(text)).toThrow();
    },
  );

  it('still checks closed schemas after unwrapping and does not retry', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          status: 'completed',
          output: [
            {
              type: 'message',
              content: [
                {
                  type: 'output_text',
                  text: '```json\n{"summary":"Synthetic", "extra":true}\n```',
                },
              ],
            },
          ],
        }),
      ),
    );
    await expect(
      requestStructuredResponse(
        {
          providerKey: 'deepseek-responses-v1',
          model: 'synthetic',
          apiKey: 'synthetic',
          timeoutMs: 60000,
          maxOutputTokens: 800,
        },
        fetcher,
        'synthetic',
        'Synthetic schema.',
        {},
        z.object({summary: z.string()}).strict(),
        'detailed',
      ),
    ).rejects.toMatchObject({code: 'ai_provider_invalid_schema'});
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
