import {documentProcessingInstructions} from '../../modules/processing/document_processing_standard.js';
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
  it('attaches a heading-only opening despite an unrelated generated title', async () => {
    const provider = new ResponsesEntrySplitProvider(CONFIG, () =>
      Promise.resolve(
        responseEnvelope({
          summary: 'A collection',
          groups: [
            {
              titlePath: 'An invented opening label',
              startOrdinal: 0,
              endOrdinal: 0,
            },
            {
              titlePath: 'Complete first resource',
              startOrdinal: 1,
              endOrdinal: 1,
            },
            {
              titlePath: 'Complete second resource',
              startOrdinal: 2,
              endOrdinal: 2,
            },
          ],
        }),
      ),
    );
    const result = await provider.proposeSplit([
      {ordinal: 0, text: '# Synthetic digest\n'},
      {ordinal: 1, text: 'First independent resource with its explanation.'},
      {ordinal: 2, text: 'Second independent resource with its explanation.'},
    ]);
    expect(result.groups).toEqual([
      {titlePath: 'Complete first resource', startOrdinal: 0, endOrdinal: 1},
      {titlePath: 'Complete second resource', startOrdinal: 2, endOrdinal: 2},
    ]);
  });
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
    expect(String(request.instructions)).toContain(
      documentProcessingInstructions('split'),
    );
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
                maxItems: 128,
                items: {properties: {startOrdinal: {maximum: 127}}},
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
      {
        titlePath: '1. Starvine calibrates a sensor',
        startOrdinal: 0,
        endOrdinal: 2,
      },
      {
        titlePath: '2. Moonstone opens an archive',
        startOrdinal: 3,
        endOrdinal: 3,
      },
      {
        titlePath: '3. Cloudfern changes its timetable',
        startOrdinal: 4,
        endOrdinal: 5,
      },
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
      {titlePath: '1. Starvine report', startOrdinal: 0, endOrdinal: 2},
      {titlePath: '2. Moonstone report', startOrdinal: 3, endOrdinal: 4},
      {titlePath: '3. Cloudfern report', startOrdinal: 5, endOrdinal: 7},
    ]);
    expect(result.summary).toContain('编号边界归组 5 处');
  });

  it('does not treat a numbered subsection as the boundaries of a mixed collection', async () => {
    const sections = [
      '# Synthetic digest',
      '## First independent story',
      '### 1. Setup\n\nThe experiment setup.',
      '### 2. Measurement\n\nIts measurement.',
      '### 3. Result\n\nIts result.',
      '## Another independent story\n\nA complete unrelated report.',
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
      titlePath: 'Another independent story',
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
        {titlePath: 'Overlap B', startOrdinal: 0, endOrdinal: 2},
      ],
    },
    {groups: [{titlePath: 'Outside input', startOrdinal: 3}]},
    {groups: [{titlePath: 'Not an ordinal', startOrdinal: 0.5}]},
    {groups: [{titlePath: 'Negative ordinal', startOrdinal: -1}]},
  ])(
    'rejects missing initial, duplicate or invalid boundaries',
    async ({groups}) => {
      const provider = new ResponsesEntrySplitProvider(CONFIG, () =>
        Promise.resolve(
          responseEnvelope({summary: 'Invalid grouping', groups}),
        ),
      );

      await expect(provider.proposeSplit(SECTIONS)).rejects.toEqual(
        new AiSplitProposalProviderError('ai_provider_invalid_response'),
      );
    },
  );
});

function responseEnvelope(payload: Record<string, unknown>): Response {
  const normalized = {
    documentMode: 'independent_entries',
    ...payload,
    ...(Array.isArray(payload.groups)
      ? {
          groups: payload.groups.map((group: Record<string, unknown>) => ({
            context: 'self',
            role: 'content',
            // Fixtures describe materialized ranges; the model wire selects starts only.
            ...Object.fromEntries(
              Object.entries(group).filter(([key]) => key !== 'endOrdinal'),
            ),
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

it('attaches publication-only source groups even when the model invents substantive titles', async () => {
  const fetcher = vi.fn<OpenAiFetch>(() =>
    Promise.resolve(
      responseEnvelope({
        summary: 'A synthetic essay and appendices.',
        groups: [
          {titlePath: 'Mechanism', startOrdinal: 0, endOrdinal: 0},
          {titlePath: 'Literature and events', startOrdinal: 1, endOrdinal: 1},
          {titlePath: 'Distribution', startOrdinal: 2, endOrdinal: 2},
        ],
      }),
    ),
  );
  const sections = [
    {ordinal: 0, text: '# Mechanism\n\nA complete independent explanation.'},
    {
      ordinal: 1,
      text: '# Colophon ( permalink )\n\nUpcoming books and appearances.',
    },
    {
      ordinal: 2,
      text: '# How to get Synthetic Review\n\nSubscription addresses.',
    },
  ];
  const result = await new ResponsesEntrySplitProvider(
    BASE_CONFIG,
    fetcher,
  ).proposeSplit(sections);
  expect(result.groups).toEqual([
    {titlePath: 'Mechanism', startOrdinal: 0, endOrdinal: 2},
  ]);
  expect(sections[1]?.text).toContain('Upcoming books');
});

it('derives complete non-overlapping ranges from sparse starts and retains trailing evidence', async () => {
  const sections = [
    'First complete explanation.',
    'Its supporting evidence.',
    'A second unrelated explanation.',
    'Its conclusion.',
    'Its final source citation.',
  ].map((text, ordinal) => ({text, ordinal}));
  const fetcher = vi.fn<OpenAiFetch>(() =>
    Promise.resolve(
      responseEnvelope({
        summary: 'Two independent explanations.',
        groups: [
          {titlePath: 'First', startOrdinal: 0},
          {titlePath: 'Second', startOrdinal: 2},
        ],
      }),
    ),
  );
  const result = await new ResponsesEntrySplitProvider(
    BASE_CONFIG,
    fetcher,
  ).proposeSplit(sections);
  expect(result.groups).toEqual([
    {titlePath: 'First', startOrdinal: 0, endOrdinal: 1},
    {titlePath: 'Second', startOrdinal: 2, endOrdinal: 4},
  ]);
  const request = parsedRequest(fetcher.mock.calls[0]?.[1]?.body);
  expect(
    request.text.format.schema.properties.groups.items.properties,
  ).not.toHaveProperty('endOrdinal');
  expect(sections[4]?.text).toBe('Its final source citation.');
});

it('recognizes numbered boundaries after evidence-preserved leading blank lines', async () => {
  const sections = [
    '# Digest',
    '\n\n## 1. First\n\nComplete first story.',
    '\n\n## 2. Second\n\nComplete second story.',
    '\n\n## 3. Third\n\nComplete third story.',
  ].map((text, ordinal) => ({text, ordinal}));
  const fetcher = vi.fn<OpenAiFetch>(() =>
    Promise.resolve(
      responseEnvelope({
        summary: 'Independent reports.',
        groups: sections.map((section) => ({
          titlePath: String(section.ordinal),
          startOrdinal: section.ordinal,
        })),
      }),
    ),
  );
  const result = await new ResponsesEntrySplitProvider(
    BASE_CONFIG,
    fetcher,
  ).proposeSplit(sections);
  expect(result.groups.map((g) => [g.startOrdinal, g.endOrdinal])).toEqual([
    [0, 1],
    [2, 2],
    [3, 3],
  ]);
  const request = parsedRequest(fetcher.mock.calls[0]?.[1]?.body);
  expect(JSON.parse(request.input)).toMatchObject({
    numberedItemStarts: [1, 2, 3],
    sections,
  });
});

it('does not force a linked numbered procedure to become independent entries', async () => {
  const sections = [
    '# One procedure',
    '\n\n1. [Setup](https://example.invalid/setup)\n\nPrepare the instrument.',
    '\n\n2. [Calibration](https://example.invalid/calibration)\n\nCalibrate that instrument.',
  ].map((text, ordinal) => ({text, ordinal}));
  const fetcher = vi.fn<OpenAiFetch>(() =>
    Promise.resolve(
      responseEnvelope({
        summary: 'Context-dependent procedure.',
        documentMode: 'whole',
        groups: [{titlePath: 'Procedure', startOrdinal: 0}],
      }),
    ),
  );
  const result = await new ResponsesEntrySplitProvider(
    BASE_CONFIG,
    fetcher,
  ).proposeSplit(sections);
  expect(result.groups).toEqual([
    {titlePath: 'One procedure', startOrdinal: 0, endOrdinal: 2},
  ]);
  const request = parsedRequest(fetcher.mock.calls[0]?.[1]?.body);
  expect(JSON.parse(request.input)).toMatchObject({linkedItemStarts: [1, 2]});
});

function parsedRequest(body: unknown) {
  if (typeof body !== 'string') throw new Error('missing request');
  return JSON.parse(body) as {
    input: string;
    text: {
      format: {
        schema: {
          properties: {groups: {items: {properties: Record<string, unknown>}}};
        };
      };
    };
  };
}

it('attaches an omitted pure-heading prefix and unwraps a single JSON fence without dropping evidence', async () => {
  const fetcher = vi.fn<OpenAiFetch>(() =>
    Promise.resolve(
      new Response(
        JSON.stringify({
          status: 'completed',
          output: [
            {
              type: 'message',
              content: [
                {
                  type: 'output_text',
                  text:
                    '```json\n' +
                    JSON.stringify({
                      summary: '独立短讯，标题附到首条。',
                      documentMode: 'independent_entries',
                      groups: [
                        {
                          titlePath: 'First transaction',
                          startOrdinal: 1,
                          role: 'content',
                          context: 'self',
                        },
                        {
                          titlePath: 'Second transaction',
                          startOrdinal: 2,
                          role: 'content',
                          context: 'self',
                        },
                      ],
                    }) +
                    '\n```',
                },
              ],
            },
          ],
        }),
      ),
    ),
  );
  const sections = [
    '# Monthly collection',
    'Company A raised a synthetic amount.',
    'Company B built a synthetic instrument.',
  ].map((text, ordinal) => ({text, ordinal}));
  const result = await new ResponsesEntrySplitProvider(
    BASE_CONFIG,
    fetcher,
  ).proposeSplit(sections);
  expect(result.groups).toEqual([
    {titlePath: 'First transaction', startOrdinal: 0, endOrdinal: 1},
    {titlePath: 'Second transaction', startOrdinal: 2, endOrdinal: 2},
  ]);
  expect(
    result.groups.flatMap((g) =>
      sections.slice(g.startOrdinal, g.endOrdinal + 1),
    ),
  ).toEqual(sections);
  expect(fetcher).toHaveBeenCalledTimes(1);
});

it.each([
  'An editorial overview with potentially substantive facts.',
  '# Heading\n\nA substantive first report.',
  '```md\n# A heading inside a code block\n```',
])('never fills an omitted prose or code prefix: %s', async (prefix) => {
  const fetcher = vi.fn<OpenAiFetch>(() =>
    Promise.resolve(
      responseEnvelope({
        summary: 'A missing prefix.',
        groups: [{titlePath: 'Remaining content', startOrdinal: 1}],
      }),
    ),
  );
  await expect(
    new ResponsesEntrySplitProvider(BASE_CONFIG, fetcher).proposeSplit([
      {ordinal: 0, text: prefix},
      {ordinal: 1, text: 'A complete explanation.'},
    ]),
  ).rejects.toMatchObject({code: 'ai_provider_invalid_response'});
});

it('attaches collection bridges locally while retaining distinct brief technical content', async () => {
  const sections = [
    '# Collection',
    'This week introduces several instruments.',
    'The first instrument corrects drift with a reference oscillator.',
    '## Images\n\nToday we introduce the next instruments.',
    'The second instrument measures pressure by capacitance.',
  ].map((text, ordinal) => ({text, ordinal}));
  const roles = ['framing', 'framing', 'content', 'framing', 'content'];
  const fetcher = vi.fn<OpenAiFetch>(() =>
    Promise.resolve(
      responseEnvelope({
        summary: '两个独立技术短讯，栏目引语不成条。',
        groups: sections.map(({ordinal}) => ({
          titlePath: `Span ${String(ordinal)}`,
          startOrdinal: ordinal,
          role: roles[ordinal],
          context: roles[ordinal] === 'framing' ? 'next' : 'self',
        })),
      }),
    ),
  );
  const result = await new ResponsesEntrySplitProvider(
    BASE_CONFIG,
    fetcher,
  ).proposeSplit(sections);
  expect(result.groups).toEqual([
    {titlePath: 'Span 2', startOrdinal: 0, endOrdinal: 2},
    {titlePath: 'Span 4', startOrdinal: 3, endOrdinal: 4},
  ]);
});

it('attaches classified prefaces, advertisements and archive navigation without fusing independent stories', async () => {
  const texts = [
    'This issue introduces several unrelated stories.',
    'Story A explains an independent queue mechanism.',
    'Buy the editors new book.',
    'Browse earlier issues in the archive.',
    'Story B explains an independent optical instrument.',
    'Subscribe to the next issue.',
  ];
  const roles = [
    'framing',
    'content',
    'framing',
    'framing',
    'content',
    'framing',
  ];
  const contexts = ['self', 'self', 'previous', 'next', 'self', 'self'];
  const fetcher = vi.fn<OpenAiFetch>(() =>
    Promise.resolve(
      responseEnvelope({
        summary: 'Two substantive contributions with publication framing.',
        groups: texts.map((_text, startOrdinal) => ({
          titlePath: `Span ${startOrdinal.toString()}`,
          startOrdinal,
          role: roles[startOrdinal],
          context: contexts[startOrdinal],
        })),
      }),
    ),
  );
  const sections = texts.map((text, ordinal) => ({text, ordinal}));
  const before = structuredClone(sections);
  const result = await new ResponsesEntrySplitProvider(
    BASE_CONFIG,
    fetcher,
  ).proposeSplit(sections);
  expect(result.groups).toEqual([
    {titlePath: 'Span 1', startOrdinal: 0, endOrdinal: 3},
    {titlePath: 'Span 4', startOrdinal: 4, endOrdinal: 5},
  ]);
  expect(
    result.groups.flatMap((group) =>
      sections.slice(group.startOrdinal, group.endOrdinal + 1),
    ),
  ).toEqual(before);
  expect(sections).toEqual(before);
});

it.each(['framing', 'unknown', undefined])(
  'rejects an all-framing or undeclared role instead of publishing an empty reading unit: %s',
  async (role) => {
    const fetcher = vi.fn<OpenAiFetch>(() =>
      Promise.resolve(
        responseEnvelope({
          summary: 'Only a sponsor notice.',
          documentMode: 'whole',
          groups: [{titlePath: 'Offer', startOrdinal: 0, role}],
        }),
      ),
    );
    await expect(
      new ResponsesEntrySplitProvider(BASE_CONFIG, fetcher).proposeSplit([
        {ordinal: 0, text: 'Purchase the sponsor subscription.'},
      ]),
    ).rejects.toMatchObject({code: 'ai_provider_invalid_response'});
  },
);

it('keeps a substantive product explanation and an editorial directory when marked content', async () => {
  const sections = [
    {
      ordinal: 0,
      text: 'A branded instrument measures phase using a calibrated reference and corrects drift.',
    },
    {
      ordinal: 1,
      text: 'An editorial directory compares tools and their concrete capabilities.',
    },
  ];
  const fetcher = vi.fn<OpenAiFetch>(() =>
    Promise.resolve(
      responseEnvelope({
        summary: 'Two useful resources.',
        groups: sections.map(({ordinal}) => ({
          titlePath: 'Resource ' + ordinal.toString(),
          startOrdinal: ordinal,
          role: 'content',
        })),
      }),
    ),
  );
  expect(
    (
      await new ResponsesEntrySplitProvider(BASE_CONFIG, fetcher).proposeSplit(
        sections,
      )
    ).groups,
  ).toHaveLength(2);
});

it('retains the 64-Entry capacity when a collection also has framing spans', async () => {
  const texts = [
    'An editorial preface.',
    ...Array.from(
      {length: 64},
      (_, index) => `Independent substantive story ${index.toString()}.`,
    ),
    'A subscription invitation.',
  ];
  const sections = texts.map((text, ordinal) => ({text, ordinal}));
  const fetcher = vi.fn<OpenAiFetch>(() =>
    Promise.resolve(
      responseEnvelope({
        summary: '64 independent stories and publication framing.',
        groups: sections.map(({ordinal}) => ({
          titlePath: `Story ${ordinal.toString()}`,
          startOrdinal: ordinal,
          role: ordinal === 0 || ordinal === 65 ? 'framing' : 'content',
        })),
      }),
    ),
  );
  const result = await new ResponsesEntrySplitProvider(
    BASE_CONFIG,
    fetcher,
  ).proposeSplit(sections);
  expect(result.groups).toHaveLength(64);
  expect(result.groups[0]).toMatchObject({startOrdinal: 0, endOrdinal: 1});
  expect(result.groups.at(-1)).toMatchObject({
    startOrdinal: 64,
    endOrdinal: 65,
  });
});
