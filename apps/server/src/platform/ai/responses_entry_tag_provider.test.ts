import {documentProcessingInstructions} from '../../modules/processing/document_processing_standard.js';
import {
  responsesEndpoint,
  responsesPromptVersion,
} from './responses_configuration.js';
import {describe, expect, it, vi} from 'vitest';

import type {CurrentInformationEntry} from '../../modules/entries/index.js';
import {AiTagProposalProviderError} from '../../modules/processing/index.js';
import {
  OPENAI_TAG_PROMPT_VERSION,
  ResponsesEntryTagProvider,
  type OpenAiFetch,
} from './responses_entry_tag_provider.js';

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
    const provider = new ResponsesEntryTagProvider(CONFIG, fetchImplementation);

    await expect(provider.proposeTags(entry())).resolves.toEqual({
      summary: '可检查的标签建议',
      contentKeywords: ['PostgreSQL', '全文检索'],
      typeKeyword: 'knowledge_explanation',
      domains: [{keyword: 'engineering_computing'}],
    });
    expect(provider.promptVersion).toBe(
      responsesPromptVersion(CONFIG, OPENAI_TAG_PROMPT_VERSION),
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
      documentProcessingInstructions('tags'),
    );
    expect(provider.providerKey).toBe(CONFIG.providerKey);
    expect(request.reasoning).toEqual(
      CONFIG.providerKey === 'deepseek-responses-v1'
        ? {effort: 'none'}
        : undefined,
    );
    expect(String(request.input)).toContain('Synthetic public body');
  });

  it('separates a digest preface from the first numbered news item without mutating evidence', async () => {
    const source = entry();
    const body =
      '# Synthetic digest: orbital cameras; marine sensors\n\nToday we cover unrelated news.\n\n## 1. Orbital camera released\n\nThe camera records infrared spectra.';
    const selected = {
      ...source,
      value: {
        ...source.value,
        titlePath: 'Synthetic opening and camera',
        body,
        contentKeywords: [
          {
            displayValue: 'marine sensors',
            normalizedValue: 'marine sensors',
            origin: 'ai' as const,
            originVersion: 'synthetic-old',
          },
        ],
      },
    };
    const fetcher = vi.fn<OpenAiFetch>(() =>
      Promise.resolve(
        responseEnvelope({
          summary: '合成标签',
          contentKeywords: ['Orbital camera', 'Infrared spectra'],
          type: {keyword: 'knowledge_explanation', customName: null},
          domains: [{keyword: 'engineering_computing', customName: null}],
        }),
      ),
    );
    await new ResponsesEntryTagProvider(CONFIG, fetcher).proposeTags(selected);
    const sentBody = fetcher.mock.calls[0]?.[1]?.body;
    if (typeof sentBody !== 'string')
      throw new Error('missing synthetic request');
    const request = JSON.parse(sentBody) as {
      input: string;
    };
    const input = JSON.parse(request.input) as {
      titlePath: string;
      body: string;
      documentContext: {preface: string};
      existingContentKeywords: string[];
    };
    expect(input.titlePath).toBe('Orbital camera released');
    expect(input.body).toBe(
      '## 1. Orbital camera released\n\nThe camera records infrared spectra.',
    );
    expect(input.documentContext.preface).toContain('marine sensors');
    expect(input.existingContentKeywords).toEqual([]);
    expect(selected.value.body).toBe(body);
    expect(selected.value.contentKeywords[0]?.displayValue).toBe(
      'marine sensors',
    );
  });

  it.each([
    {
      chunkMode: 'whole' as const,
      body: '# Synthetic guide\n\nContext matters.\n\n## 1. Measure\n\nInstruction.',
    },
    {
      chunkMode: 'split' as const,
      body: '# Synthetic guide\n\n## 1. Measure\n\nInstruction.\n\n## 2. Compare\n\nDependent instruction.',
    },
    {
      chunkMode: 'split' as const,
      body: '# Synthetic guide\n\n```md\n## 1. An example heading\n```\n\nActual discussion.',
    },
    {
      chunkMode: 'split' as const,
      body: '# Synthetic article\n\nEssential context.\n\n## Discussion\n\nCoherent prose.',
    },
  ])(
    'retains complete context when a single digest item is not established: $chunkMode $body',
    async (value) => {
      const selected = {...entry(), value: {...entry().value, ...value}};
      const fetcher = vi.fn<OpenAiFetch>(() =>
        Promise.resolve(
          responseEnvelope({
            summary: '合成标签',
            contentKeywords: ['Synthetic'],
            type: {keyword: 'knowledge_explanation', customName: null},
            domains: [{keyword: 'engineering_computing', customName: null}],
          }),
        ),
      );
      await new ResponsesEntryTagProvider(CONFIG, fetcher).proposeTags(
        selected,
      );
      const sentBody = fetcher.mock.calls[0]?.[1]?.body;
      if (typeof sentBody !== 'string')
        throw new Error('missing synthetic request');
      const request = JSON.parse(sentBody) as {
        input: string;
      };
      expect(JSON.parse(request.input)).toMatchObject({
        body: value.body,
        titlePath: selected.value.titlePath,
      });
      expect(JSON.parse(request.input)).not.toHaveProperty('documentContext');
    },
  );

  it('rejects private Entries before calling the Provider', async () => {
    const fetchImplementation = vi.fn<OpenAiFetch>();
    const provider = new ResponsesEntryTagProvider(CONFIG, fetchImplementation);

    await expect(provider.proposeTags(entry(true))).rejects.toMatchObject({
      code: 'ai_provider_rejected',
    });
    expect(fetchImplementation).not.toHaveBeenCalled();
  });

  it('does not send publication appendices or their stale topic labels for tagging', async () => {
    const original = entry();
    const selected = {
      ...original,
      value: {
        ...original.value,
        body: 'A complete queue mechanism.\n\n# Colophon\n\nUpcoming books and subscription channels.',
      },
    };
    const fetcher = vi.fn<OpenAiFetch>(() =>
      Promise.resolve(
        responseEnvelope({
          summary: 'Queue mechanism.',
          contentKeywords: ['Queue'],
          type: {keyword: 'knowledge_explanation', customName: null},
          domains: [{keyword: 'engineering_computing', customName: null}],
        }),
      ),
    );
    await new ResponsesEntryTagProvider(CONFIG, fetcher).proposeTags(selected);
    const body = fetcher.mock.calls[0]?.[1]?.body;
    if (typeof body !== 'string') throw new Error('missing request');
    const request = JSON.parse(body) as {input: string};
    expect(JSON.parse(request.input)).toMatchObject({
      body: 'A complete queue mechanism.\n\n',
      existingContentKeywords: [],
    });
    expect(request.input).not.toContain('Upcoming books');
    expect(selected.value.body).toContain('Upcoming books');
  });

  it('fails closed on duplicate normalized keywords and invalid envelopes', async () => {
    const duplicateProvider = new ResponsesEntryTagProvider(CONFIG, () =>
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

    const incompleteProvider = new ResponsesEntryTagProvider(CONFIG, () =>
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

function batchEntries() {
  return [0, 1, 2, 3].map((index) => ({
    ...entry(),
    entryId: `22222222-2222-4222-8222-${String(index).padStart(12, '0')}`,
    revision: index + 1,
    value: {
      ...entry().value,
      titlePath: `Subject ${index.toString()}`,
      body: `Evidence for subject ${index.toString()}.`,
    },
  }));
}
function batchOutput() {
  return {
    items: batchEntries().map((selected, index) => ({
      entryId: selected.entryId,
      expectedRevision: selected.revision,
      tags: {
        summary: 'Synthetic independent classification',
        contentKeywords: ['Concept ' + index.toString()],
        type: {keyword: 'knowledge_explanation', customName: null},
        domains: [{keyword: 'engineering_computing', customName: null}],
      },
    })),
  };
}
it('classifies four independent entries in one request and binds reordered results by identity', async () => {
  const output = batchOutput();
  output.items.reverse();
  const fetcher = vi.fn<OpenAiFetch>(() =>
    Promise.resolve(responseEnvelope(output)),
  );
  const results = await new ResponsesEntryTagProvider(
    BASE_CONFIG,
    fetcher,
  ).proposeTagsBatch(batchEntries());
  expect(
    results.find((result) => result.entryId === batchEntries()[0]?.entryId)
      ?.result.contentKeywords,
  ).toEqual(['Concept 0']);
  expect(fetcher).toHaveBeenCalledTimes(1);
  const body = fetcher.mock.calls[0]?.[1]?.body;
  if (typeof body !== 'string') throw new Error('missing request');
  const request = JSON.parse(body) as {
    input: string;
    max_output_tokens: number;
    instructions: string;
  };
  expect(JSON.parse(request.input)).toMatchObject({
    items: batchEntries().map((item) => ({
      entryId: item.entryId,
      expectedRevision: item.revision,
      body: item.value.body,
    })),
  });
  expect(request.max_output_tokens).toBe(4128);
  expect(request.instructions).toContain(
    documentProcessingInstructions('tags'),
  );
});
it.each(['missing', 'duplicate', 'foreign', 'stale', 'invalid-tags'] as const)(
  'rejects the entire tag batch for %s',
  async (problem) => {
    const output = batchOutput();
    const first = output.items[0];
    const second = output.items[1];
    if (!first || !second) throw new Error('fixture');
    if (problem === 'missing') output.items.pop();
    if (problem === 'duplicate') output.items[1] = first;
    if (problem === 'foreign') first.entryId = 'unknown';
    if (problem === 'stale') first.expectedRevision++;
    if (problem === 'invalid-tags') second.tags.contentKeywords = [];
    const fetcher = vi.fn<OpenAiFetch>(() =>
      Promise.resolve(responseEnvelope(output)),
    );
    await expect(
      new ResponsesEntryTagProvider(BASE_CONFIG, fetcher).proposeTagsBatch(
        batchEntries(),
      ),
    ).rejects.toMatchObject({code: 'ai_provider_invalid_response'});
    expect(fetcher).toHaveBeenCalledTimes(1);
  },
);

it('accepts a complete fenced tag batch but keeps identity checks after normalization', async () => {
  for (const stale of [false, true]) {
    const output = batchOutput();
    if (stale && output.items[0]) output.items[0].expectedRevision++;
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
                    text: '```json\n' + JSON.stringify(output) + '\n```',
                  },
                ],
              },
            ],
          }),
        ),
      ),
    );
    const result = new ResponsesEntryTagProvider(
      BASE_CONFIG,
      fetcher,
    ).proposeTagsBatch(batchEntries());
    if (stale)
      await expect(result).rejects.toMatchObject({
        code: 'ai_provider_invalid_response',
      });
    else await expect(result).resolves.toHaveLength(4);
    expect(fetcher).toHaveBeenCalledTimes(1);
  }
});

it('does not repair a missing quote in a tag batch or silently retry', async () => {
  const broken = JSON.stringify(batchOutput()).replace(
    '"domains":',
    'domains":',
  );
  const fetcher = vi.fn<OpenAiFetch>(() =>
    Promise.resolve(
      new Response(
        JSON.stringify({
          status: 'completed',
          output: [
            {type: 'message', content: [{type: 'output_text', text: broken}]},
          ],
        }),
      ),
    ),
  );
  await expect(
    new ResponsesEntryTagProvider(BASE_CONFIG, fetcher).proposeTagsBatch(
      batchEntries(),
    ),
  ).rejects.toMatchObject({code: 'ai_provider_invalid_response'});
  expect(fetcher).toHaveBeenCalledTimes(1);
});
it.each([
  'private',
  'duplicate',
  'too-many',
  'oversized',
  'different-document',
] as const)('does not dispatch an invalid tag batch: %s', async (problem) => {
  const entries = batchEntries();
  const first = entries[0];
  if (!first) throw new Error('fixture');
  if (problem === 'private')
    entries[0] = {...first, value: {...first.value, isPrivate: true}};
  if (problem === 'duplicate') entries[1] = first;
  if (problem === 'too-many') entries.push({...first, entryId: 'extra'});
  if (problem === 'oversized')
    entries[0] = {...first, value: {...first.value, body: 'x'.repeat(100_000)}};
  if (problem === 'different-document')
    entries[0] = {...first, snapshotId: 'other'};
  const fetcher = vi.fn<OpenAiFetch>();
  await expect(
    new ResponsesEntryTagProvider(BASE_CONFIG, fetcher).proposeTagsBatch(
      entries,
    ),
  ).rejects.toMatchObject({code: 'ai_provider_rejected'});
  expect(fetcher).not.toHaveBeenCalled();
});

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
