import {describe, expect, it, vi} from 'vitest';

import {
  AiSplitProposalProviderError,
  type AiSplitProposalSection,
} from '../../modules/processing/index.js';
import {
  OPENAI_SPLIT_PROMPT_VERSION,
  OpenAiEntrySplitProvider,
} from './openai_entry_split_provider.js';
import {
  OPENAI_RESPONSES_ENDPOINT,
  type OpenAiFetch,
} from './openai_entry_tag_provider.js';

const CONFIG = Object.freeze({
  providerKey: 'openai-responses-v1' as const,
  model: 'gpt-5-mini',
  apiKey: 'synthetic-api-key',
  maxOutputTokens: 800 as const,
  timeoutMs: 60_000 as const,
});

const SECTIONS: readonly Readonly<AiSplitProposalSection>[] = Object.freeze([
  Object.freeze({ordinal: 0, text: 'Synthetic public section A.'}),
  Object.freeze({ordinal: 1, text: 'Synthetic public section B.'}),
  Object.freeze({ordinal: 2, text: 'Synthetic public section C.'}),
]);

describe('OpenAiEntrySplitProvider', () => {
  it('sends only ordered public section text and requires a closed contiguous grouping', async () => {
    const fetchImplementation = vi.fn<OpenAiFetch>(() =>
      Promise.resolve(
        responseEnvelope({
          summary: 'Synthetic grouping',
          groups: [
            {titlePath: 'Combined A and B', startOrdinal: 0, endOrdinal: 1},
            {titlePath: 'Section C', startOrdinal: 2, endOrdinal: 2},
          ],
        }),
      ),
    );
    const provider = new OpenAiEntrySplitProvider(CONFIG, fetchImplementation);

    await expect(provider.proposeSplit(SECTIONS)).resolves.toEqual({
      summary: 'Synthetic grouping',
      groups: [
        {titlePath: 'Combined A and B', startOrdinal: 0, endOrdinal: 1},
        {titlePath: 'Section C', startOrdinal: 2, endOrdinal: 2},
      ],
    });
    expect(provider.promptVersion).toBe(OPENAI_SPLIT_PROMPT_VERSION);
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
    expect(String(request.input)).toContain('Synthetic public section A.');
    expect(String(request.input)).not.toContain('snapshotId');
    expect(String(request.input)).not.toContain('fragmentId');
  });

  it.each([
    {groups: [{titlePath: 'Gap', startOrdinal: 1, endOrdinal: 2}]},
    {
      groups: [
        {titlePath: 'Overlap A', startOrdinal: 0, endOrdinal: 1},
        {titlePath: 'Overlap B', startOrdinal: 1, endOrdinal: 2},
      ],
    },
    {groups: [{titlePath: 'Incomplete', startOrdinal: 0, endOrdinal: 1}]},
  ])('rejects a non-contiguous or incomplete grouping', async ({groups}) => {
    const provider = new OpenAiEntrySplitProvider(CONFIG, () =>
      Promise.resolve(responseEnvelope({summary: 'Invalid grouping', groups})),
    );

    await expect(provider.proposeSplit(SECTIONS)).rejects.toEqual(
      new AiSplitProposalProviderError('ai_provider_invalid_response'),
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
