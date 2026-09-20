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
      summary: '独立合集：2 条；相邻上下文合并 0 处。Synthetic grouping',
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

  it('covers all 128 sections in 64 independent groups with sufficient output room', async () => {
    const sections = Array.from({length: 128}, (_, ordinal) => ({
      ordinal,
      text: 'Synthetic section ' + ordinal.toString(),
    }));
    const groups = Array.from({length: 64}, (_, i) => ({
      titlePath: 'Synthetic item ' + i.toString(),
      startOrdinal: i * 2,
      endOrdinal: i * 2 + 1,
    }));
    const fetchImplementation = vi.fn<OpenAiFetch>(() =>
      Promise.resolve(
        responseEnvelope({summary: 'Synthetic collection', groups}),
      ),
    );
    const result = await new ResponsesEntrySplitProvider(
      CONFIG,
      fetchImplementation,
    ).proposeSplit(sections);
    expect(result.groups).toEqual(groups);
    const body = fetchImplementation.mock.calls[0]?.[1]?.body;
    if (typeof body !== 'string') throw new Error('missing request body');
    const request = JSON.parse(body) as Record<string, unknown>;
    expect(request.max_output_tokens).toBe(8192);
    expect(request).toMatchObject({
      text: {
        format: {
          schema: {
            properties: {
              groups: {
                maxItems: 64,
                items: {properties: {endOrdinal: {maximum: 127}}},
              },
            },
          },
        },
      },
    });
    expect(request.input).toBe(JSON.stringify({sections}));
  });

  it('rejects a 129th input section before dispatch', async () => {
    const fetchImplementation = vi.fn<OpenAiFetch>();
    const sections = Array.from({length: 129}, (_, ordinal) => ({
      ordinal,
      text: 'Synthetic section',
    }));
    await expect(
      new ResponsesEntrySplitProvider(CONFIG, fetchImplementation).proposeSplit(
        sections,
      ),
    ).rejects.toEqual(
      new AiSplitProposalProviderError('ai_provider_invalid_response'),
    );
    expect(fetchImplementation).not.toHaveBeenCalled();
  });

  it('rejects 65 output groups even when they cover every section', async () => {
    const sections = Array.from({length: 128}, (_, ordinal) => ({
      ordinal,
      text: 'Synthetic section',
    }));
    const groups = Array.from({length: 65}, (_, i) => ({
      titlePath: 'Synthetic item',
      startOrdinal: i,
      endOrdinal: i === 64 ? 127 : i,
    }));
    const provider = new ResponsesEntrySplitProvider(CONFIG, () =>
      Promise.resolve(responseEnvelope({summary: 'Too many entries', groups})),
    );
    await expect(provider.proposeSplit(sections)).rejects.toEqual(
      new AiSplitProposalProviderError('ai_provider_invalid_response'),
    );
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
                context: 'next',
              },
              {
                titlePath: 'Procedure',
                startOrdinal: 1,
                endOrdinal: 2,
                context: 'previous',
              },
            ],
          }),
        ),
      );
      await expect(provider.proposeSplit(sections)).resolves.toEqual({
        summary:
          documentMode === 'whole'
            ? '整篇保留（模型选择）。Preserve context'
            : '独立合集：1 条；相邻上下文合并 1 处。Preserve context',
        groups: [
          {
            titlePath:
              documentMode === 'whole' ? 'Synthetic experiment' : 'Procedure',
            startOrdinal: 0,
            endOrdinal: 2,
          },
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

  it('suggests numbered boundaries and merges a preface and footer locally without collapsing unrelated news', async () => {
    const sections = [
      '# Synthetic digest\n\nThree independently reported events.',
      '## 1. Starvine calibrates a sensor',
      'Starvine reports a finished calibration experiment.',
      '## 2. Moonstone opens an archive\n\nMoonstone publishes a searchable index.',
      '## 3. Cloudfern changes its timetable\n\nCloudfern publishes new departure times.',
      'End of digest. Return to source.',
    ].map((text, ordinal) => ({text, ordinal}));
    const fetcher = vi.fn<OpenAiFetch>(() =>
      Promise.resolve(
        responseEnvelope({
          summary: '三条独立新闻，开场和回源信息随相邻正文保留。',
          groups: [
            {
              titlePath: 'Preface',
              startOrdinal: 0,
              endOrdinal: 0,
              context: 'next',
            },
            {titlePath: 'Starvine sensor', startOrdinal: 1, endOrdinal: 2},
            {titlePath: 'Moonstone archive', startOrdinal: 3, endOrdinal: 3},
            {titlePath: 'Cloudfern timetable', startOrdinal: 4, endOrdinal: 4},
            {
              titlePath: 'Footer',
              startOrdinal: 5,
              endOrdinal: 5,
              context: 'previous',
            },
          ],
        }),
      ),
    );
    const result = await new ResponsesEntrySplitProvider(
      CONFIG,
      fetcher,
    ).proposeSplit(sections);
    expect(result.groups).toEqual([
      {titlePath: 'Starvine sensor', startOrdinal: 0, endOrdinal: 2},
      {titlePath: 'Moonstone archive', startOrdinal: 3, endOrdinal: 3},
      {titlePath: 'Cloudfern timetable', startOrdinal: 4, endOrdinal: 5},
    ]);
    expect(result.summary).toContain('独立合集：3 条；相邻上下文合并 2 处');
    const body = fetcher.mock.calls[0]?.[1]?.body;
    if (typeof body !== 'string') throw new Error('missing synthetic request');
    const request = JSON.parse(body) as {
      input: string;
    };
    expect(JSON.parse(request.input)).toEqual({
      sections,
      numberedItemStarts: [1, 3, 4],
    });
  });

  it('keeps a numbered news item intact when the model mislabels the preface, body and footer as standalone', async () => {
    const texts = [
      '# Synthetic digest',
      '## 1. Starvine report',
      'Starvine findings.',
      '## 2. Moonstone report',
      'Moonstone findings.',
      '## 3. Cloudfern report',
      'Cloudfern findings.',
      'End of digest.',
    ];
    const sections = texts.map((text, ordinal) => ({text, ordinal}));
    const provider = new ResponsesEntrySplitProvider(CONFIG, () =>
      Promise.resolve(
        responseEnvelope({
          summary: 'Three independent synthetic reports.',
          groups: sections.map((s) => ({
            titlePath: s.text,
            startOrdinal: s.ordinal,
            endOrdinal: s.ordinal,
            context: 'self',
          })),
        }),
      ),
    );
    const result = await provider.proposeSplit(sections);
    expect(result.groups).toEqual([
      {titlePath: '## 1. Starvine report', startOrdinal: 0, endOrdinal: 2},
      {titlePath: '## 2. Moonstone report', startOrdinal: 3, endOrdinal: 4},
      {titlePath: '## 3. Cloudfern report', startOrdinal: 5, endOrdinal: 7},
    ]);
    expect(result.summary).toContain('编号边界归组 5 处');
  });

  it('does not treat a numbered subsection as the boundaries of a mixed collection', async () => {
    const sections = [
      '# Synthetic digest',
      '## First independent story',
      '### 1. Setup',
      '### 2. Measurement',
      '### 3. Result',
      '## Another independent story',
    ].map((text, ordinal) => ({ordinal, text}));
    const result = await new ResponsesEntrySplitProvider(CONFIG, () =>
      Promise.resolve(
        responseEnvelope({
          summary: '两则独立报道，第一则包含三个连续步骤。',
          documentMode: 'independent_entries',
          groups: [
            {
              titlePath: 'First story',
              startOrdinal: 0,
              endOrdinal: 4,
              context: 'self',
            },
            {
              titlePath: 'Another story',
              startOrdinal: 5,
              endOrdinal: 5,
              context: 'self',
            },
          ],
        }),
      ),
    ).proposeSplit(sections);
    expect(result.groups).toHaveLength(2);
    expect(result.groups[1]).toEqual({
      titlePath: 'Another story',
      startOrdinal: 5,
      endOrdinal: 5,
    });
  });

  it('keeps a numbered procedure whole when its steps share context', async () => {
    const sections = [
      '# Synthetic calibration procedure',
      '## 1. Prepare the same sensor',
      '## 2. Measure that sensor',
      '## 3. Compare those measurements',
    ].map((text, ordinal) => ({text, ordinal}));
    const result = await new ResponsesEntrySplitProvider(CONFIG, () =>
      Promise.resolve(
        responseEnvelope({
          summary: '编号是同一实验的连续步骤。',
          documentMode: 'whole',
          groups: [{titlePath: 'Calibration', startOrdinal: 0, endOrdinal: 3}],
        }),
      ),
    ).proposeSplit(sections);
    expect(result.groups).toEqual([
      {
        titlePath: 'Synthetic calibration procedure',
        startOrdinal: 0,
        endOrdinal: 3,
      },
    ]);
    expect(result.summary).toContain('整篇保留（模型选择）');
  });

  it.each(['previous', 'next'])(
    'rejects a dependency outside the document (%s)',
    async (context) => {
      const provider = new ResponsesEntrySplitProvider(CONFIG, () =>
        Promise.resolve(
          responseEnvelope({
            summary: 'Invalid dependency',
            groups: [
              {titlePath: 'Item', startOrdinal: 0, endOrdinal: 2, context},
            ],
          }),
        ),
      );
      await expect(provider.proposeSplit(SECTIONS)).rejects.toMatchObject({
        code: 'ai_provider_invalid_response',
      });
    },
  );

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
            context: 'self',
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

it('merges unnumbered collection framing even when the model calls it independent', async () => {
  const fetcher = vi.fn<OpenAiFetch>(() =>
    Promise.resolve(
      responseEnvelope({
        summary: 'Synthetic unnumbered collection',
        groups: [
          {titlePath: '前言与说明', startOrdinal: 0, endOrdinal: 0},
          {
            titlePath: 'First independent resource',
            startOrdinal: 1,
            endOrdinal: 1,
          },
          {
            titlePath: 'Second independent resource',
            startOrdinal: 2,
            endOrdinal: 2,
          },
          {titlePath: '订阅与原始条目链接', startOrdinal: 3, endOrdinal: 3},
        ],
      }),
    ),
  );
  const result = await new ResponsesEntrySplitProvider(
    BASE_CONFIG,
    fetcher,
  ).proposeSplit([
    {ordinal: 0, text: 'An editorial introduction to this collection.'},
    {ordinal: 1, text: 'The first standalone resource and its full context.'},
    {ordinal: 2, text: 'The second unrelated resource and its full context.'},
    {ordinal: 3, text: 'Subscribe for more. Return to the original item.'},
  ]);
  expect(result.groups).toEqual([
    {titlePath: 'First independent resource', startOrdinal: 0, endOrdinal: 1},
    {titlePath: 'Second independent resource', startOrdinal: 2, endOrdinal: 3},
  ]);
});

it('keeps known large-context models bounded and leaves unknown models conservative', async () => {
  const source = 'Synthetic chapter and bibliography. '.repeat(7000);
  const fetcher = vi.fn<OpenAiFetch>(() =>
    Promise.resolve(
      responseEnvelope({
        summary: 'Complete synthetic book',
        documentMode: 'whole',
        groups: [{titlePath: 'Synthetic book', startOrdinal: 0, endOrdinal: 0}],
      }),
    ),
  );
  await new ResponsesEntrySplitProvider(
    {
      ...BASE_CONFIG,
      providerKey: 'deepseek-responses-v1',
      model: 'deepseek-flash',
    },
    fetcher,
  ).proposeSplit([{ordinal: 0, text: source}]);
  expect(fetcher).toHaveBeenCalledTimes(1);
  await expect(
    new ResponsesEntrySplitProvider(BASE_CONFIG, fetcher).proposeSplit([
      {ordinal: 0, text: source},
    ]),
  ).rejects.toMatchObject({code: 'ai_split_input_unsupported'});
  expect(fetcher).toHaveBeenCalledTimes(1);
});
