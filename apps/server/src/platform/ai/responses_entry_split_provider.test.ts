import {
  responsesEndpoint,
  responsesPromptVersion,
} from './responses_configuration.js';
import {describe, expect, it, vi} from 'vitest';

import {
  AiSplitProposalProviderError,
  type AiSplitProposalSection,
} from '../../modules/processing/index.js';
import {
  OPENAI_SPLIT_PROMPT_VERSION,
  ResponsesEntrySplitProvider,
} from './responses_entry_split_provider.js';
import {type OpenAiFetch} from './responses_entry_tag_provider.js';

const BASE_CONFIG = Object.freeze({
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

describe.each([
  BASE_CONFIG,
  {
    ...BASE_CONFIG,
    providerKey: 'deepseek-responses-v1' as const,
    model: 'deepseek-synthetic',
  },
])('$providerKey $model', (CONFIG) => {
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
    const provider = new ResponsesEntrySplitProvider(
      CONFIG,
      fetchImplementation,
    );

    await expect(provider.proposeSplit(SECTIONS)).resolves.toEqual({
      summary: 'Synthetic grouping',
      groups: [
        {titlePath: 'Combined A and B', startOrdinal: 0, endOrdinal: 1},
        {titlePath: 'Section C', startOrdinal: 2, endOrdinal: 2},
      ],
    });
    expect(provider.promptVersion).toBe(
      responsesPromptVersion(CONFIG, OPENAI_SPLIT_PROMPT_VERSION),
    );
    expect(fetchImplementation).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImplementation.mock.calls[0] ?? [];
    expect(url).toBe(responsesEndpoint(CONFIG));
    expect(init?.method).toBe('POST');
    expect(init?.headers).toEqual({
      Authorization: 'Bearer synthetic-api-key',
      'Content-Type': 'application/json',
    });
    if (typeof init?.body !== 'string') throw new Error('missing request body');
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
    expect(String(request.input)).toContain('Synthetic public section A.');
    expect(String(request.input)).not.toContain('snapshotId');
    expect(String(request.input)).not.toContain('fragmentId');
  });

  it.each(['whole', 'independent_entries'])(
    'retains a continuous or context-dependent document as a single reading unit (%s)',
    async (documentMode) => {
      const sections = [
        {
          ordinal: 0,
          text: '# Synthetic experiment\n\nAn introduction to an experiment.',
        },
        {
          ordinal: 1,
          text: 'Next, the same objects were measured. These results depend on the introduction.',
        },
        {ordinal: 2, text: 'The conclusion explains this experiment.'},
      ];
      const provider = new ResponsesEntrySplitProvider(CONFIG, () =>
        Promise.resolve(
          responseEnvelope({
            summary: 'Preserve\ncontext',
            documentMode,
            groups: [
              {
                titlePath: 'Introduction',
                startOrdinal: 0,
                endOrdinal: 0,
                selfContained: false,
              },
              {
                titlePath: 'Procedure',
                startOrdinal: 1,
                endOrdinal: 2,
                selfContained: false,
              },
            ],
          }),
        ),
      );
      await expect(provider.proposeSplit(sections)).resolves.toEqual({
        summary: 'Preserve context',
        groups: [
          {titlePath: 'Synthetic experiment', startOrdinal: 0, endOrdinal: 2},
        ],
      });
    },
  );

  it('retains a whole article even when all proposed subsections claim independence', async () => {
    const provider = new ResponsesEntrySplitProvider(CONFIG, () =>
      Promise.resolve(
        responseEnvelope({
          summary: 'Coherent source',
          documentMode: 'whole',
          groups: SECTIONS.map((s) => ({
            titlePath: 'Section',
            startOrdinal: s.ordinal,
            endOrdinal: s.ordinal,
          })),
        }),
      ),
    );
    expect((await provider.proposeSplit(SECTIONS)).groups).toHaveLength(1);
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
    const provider = new ResponsesEntrySplitProvider(CONFIG, () =>
      Promise.resolve(responseEnvelope({summary: 'Invalid grouping', groups})),
    );

    await expect(provider.proposeSplit(SECTIONS)).rejects.toEqual(
      new AiSplitProposalProviderError('ai_provider_invalid_response'),
    );
  });
});

function responseEnvelope(payload: Record<string, unknown>): Response {
  const normalized = {
    documentMode: 'independent_entries',
    ...payload,
    ...(Array.isArray(payload.groups)
      ? {
          groups: payload.groups.map((group: Record<string, unknown>) => ({
            selfContained: true,
            ...group,
          })),
        }
      : {}),
  };
  return new Response(
    JSON.stringify({
      status: 'completed',
      output: [
        {
          type: 'message',
          content: [{type: 'output_text', text: JSON.stringify(normalized)}],
        },
      ],
    }),
    {status: 200, headers: {'content-type': 'application/json'}},
  );
}
