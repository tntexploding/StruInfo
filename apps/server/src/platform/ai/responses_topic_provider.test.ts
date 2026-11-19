import {describe, it, expect, vi} from 'vitest';
import {
  ResponsesTopicProvider,
  topicModelEntries,
  topicModelReferences,
} from './responses_topic_provider.js';
import {modelUsageScope} from './model_usage_scope.js';
import {
  topicScopeSchema,
  type TopicInput,
} from '../../modules/entries/content_topics.js';
const id = '00000000-0000-4000-8000-000000000001';
const input: TopicInput = {
  ruleVersion: 'topics.v1',
  scope: topicScopeSchema.parse({entryId: id}),
  vocabularyRevision: 0,
  entries: [
    {
      entryId: id,
      revision: 1,
      snapshotId: id,
      source: 'synthetic.invalid',
      title: 'Synthetic',
      body: 'Synthetic complete body.',
      publishedAt: null,
      labels: [],
    },
  ],
  topics: [],
  protectedPairs: [],
};
describe('topic model adapter', () => {
  it('prioritizes issue and matching vector passages over repeated entity mentions', () => {
    const [first] = input.entries;
    if (!first) throw new Error('Missing fixture entry');
    const issue =
      'Reasoning effort selects the number of internal reasoning steps.';
    const evaluation = 'The evaluation used the model as a judge.';
    const parts = [
      'Overview of a model.',
      ...Array.from(
        {length: 10},
        (_, i) => `Model product mention ${i.toString()}.`,
      ),
      issue,
      evaluation,
    ];
    const body = parts.join('\n\n');
    const labels = [
      {id: 'model', label: 'model', role: 'entity', evidence: 'Model'},
      {
        id: 'effort',
        label: 'reasoning effort',
        role: 'issue',
        evidence: issue,
      },
    ];
    const p = topicModelEntries({
      ...input,
      entries: [
        {
          ...first,
          body,
          labels,
          evidenceRanges: [
            {start: body.indexOf(issue), end: body.indexOf(evaluation)},
          ],
        },
        {...first, entryId: '00000000-0000-4000-8000-000000000002', labels},
      ],
    })[0];
    if (!p) throw new Error('Missing model entry');
    expect(p.passages.map((v) => v.text)).toContain(issue);
    expect(p.passages.length).toBeLessThanOrEqual(6);
    expect(p).not.toHaveProperty('evidenceRanges');
  });
  it('sends old topic identity and manual constraints without historical claims', () => {
    const other = '00000000-0000-4000-8000-000000000002';
    const [first] = input.entries;
    if (!first) throw new Error('Missing fixture entry');
    const refs = topicModelReferences({
      ...input,
      entries: [...input.entries, {...first, entryId: other}],
      topics: [
        {
          id,
          version: 1,
          value: {
            kind: 'topic',
            name: 'Saved',
            scope: 'Question',
            origin: 'ai',
            summary: 'unsupported old summary',
            summaryVersions: [],
            ruleVersion: 'old',
            members: [
              {
                entryId: id,
                revision: 1,
                quote: 'old quote',
                reason: 'old reason',
                decision: 'pinned',
                origin: 'manual',
              },
              {
                entryId: other,
                revision: 1,
                quote: 'old quote',
                reason: 'old reason',
                decision: 'included',
                origin: 'ai',
              },
            ],
            relations: [],
          },
        },
      ],
    });
    expect(refs).toEqual([
      {
        topicId: id,
        name: 'Saved',
        scope: 'Question',
        pinnedEntryIds: [id],
        excludedEntryIds: [],
      },
    ]);
  });
  it('starts with label evidence, then reads requested original text once within the same budget', async () => {
    const first = input.entries[0];
    if (!first) throw new Error('Missing fixture');
    const body = Array.from(
      {length: 24},
      (_, i) => `Original paragraph ${String(i)}: ${'facts '.repeat(30)}`,
    ).join('\n\n');
    const sample = {
      ...input,
      entries: [
        {
          ...first,
          body,
          labels: [
            {
              id: 'memory',
              role: 'entity',
              label: 'memory',
              evidence: 'Original paragraph 18:',
            },
          ],
        },
      ],
    };
    const excerpts = topicModelEntries(sample)[0];
    expect(
      excerpts?.passages.some((p) => p.text.includes('paragraph 18:')),
    ).toBe(true);
    expect(excerpts?.complete).toBe(false);
    const supplied: ReturnType<typeof topicModelEntries>[] = [];
    const fetcher = vi.fn<typeof fetch>((_url, init) => {
      expect(modelUsageScope.getStore()?.batchId).toBe('synthetic-batch');
      const req = JSON.parse(
        typeof init?.body === 'string' ? init.body : '',
      ) as {input: string};
      const payload = JSON.parse(req.input) as {
        entries: ReturnType<typeof topicModelEntries>;
      };
      supplied.push(payload.entries);
      return Promise.resolve(
        new Response(
          JSON.stringify({
            status: 'completed',
            output: [
              {
                type: 'message',
                content: [
                  {
                    type: 'output_text',
                    text: JSON.stringify({
                      topics: [],
                      relations: [],
                      note: '',
                      ...(supplied.length === 1
                        ? {readMoreEntryIds: [id]}
                        : {}),
                    }),
                  },
                ],
              },
            ],
          }),
        ),
      );
    });
    const provider = new ResponsesTopicProvider(
      {
        providerKey: 'deepseek-responses-v1',
        model: 'synthetic',
        apiKey: 'synthetic',
        timeoutMs: 60000,
        maxOutputTokens: 800,
      },
      fetcher,
    );
    await provider.generate(sample, 'synthetic-batch', () => Promise.resolve());
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(supplied[0]?.[0]?.passages.length).toBeLessThan(6);
    expect(supplied[1]?.[0]?.passages).toHaveLength(24);
    expect(sample.entries[0]?.body).toBe(body);
  });
  it('sends one bounded group with the existing budget context and accepts no-topic output', async () => {
    const fetcher = vi.fn<typeof fetch>((_url, init) => {
      expect(modelUsageScope.getStore()?.batchId).toBe('synthetic-batch');
      const request = JSON.parse(
        typeof init?.body === 'string' ? init.body : '',
      ) as {
        input: string;
        max_output_tokens: number;
        instructions: string;
        store: boolean;
        text: {format: {schema: {properties: {relations: {maxItems: number}}}}};
      };
      const supplied = JSON.parse(request.input) as {
        entries: {body?: string; passages: {text: string}[]}[];
      };
      expect(supplied.entries[0]?.body).toBeUndefined();
      expect(supplied.entries[0]?.passages[0]?.text).toBe(
        input.entries[0]?.body,
      );
      expect(request.max_output_tokens).toBe(8192);
      expect(request.store).toBe(false);
      expect(request.instructions).toContain('not proof');
      expect(request.instructions).toContain('members lists distinct entries');
      expect(request.text.format.schema.properties.relations.maxItems).toBe(0);
      return Promise.resolve(
        new Response(
          JSON.stringify({
            status: 'completed',
            output: [
              {
                type: 'message',
                content: [
                  {
                    type: 'output_text',
                    text: JSON.stringify({
                      topics: [],
                      relations: [],
                      note: '无合适主题',
                    }),
                  },
                ],
              },
            ],
          }),
        ),
      );
    });
    const provider = new ResponsesTopicProvider(
      {
        providerKey: 'deepseek-responses-v1',
        model: 'synthetic',
        apiKey: 'synthetic',
        timeoutMs: 60000,
        maxOutputTokens: 800,
      },
      fetcher,
    );
    expect(
      await provider.generate(input, 'synthetic-batch', () =>
        Promise.resolve(),
      ),
    ).toEqual({topics: [], relations: [], note: '无合适主题'});
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(modelUsageScope.getStore()).toBeUndefined();
  });
  it('resolves source IDs to exact quotations, ignores unused metadata and rejects foreign IDs', async () => {
    const first = input.entries[0];
    if (!first) throw new Error('Missing fixture entry');
    const other = {
      ...first,
      entryId: '00000000-0000-4000-8000-000000000002',
    };
    const pair = {...input, entries: [first, other]};
    let invalid = false;
    const fetcher = vi.fn<typeof fetch>(() =>
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
                    text: JSON.stringify({
                      topics: [
                        {
                          topicId: null,
                          name: 'Synthetic',
                          scope: 'Synthetic scope',
                          summary: '',
                          relations: [],
                          members: pair.entries.map((e, i) => ({
                            entryId: e.entryId,
                            revision: e.revision,
                            evidenceId: invalid
                              ? 'foreign'
                              : `E${String(i)}:A:0:0`,
                            reason: 'Shared mechanism',
                            reason_: 'Unused metadata',
                          })),
                        },
                      ],
                      relations: [],
                      note: '',
                    }),
                  },
                ],
              },
            ],
          }),
        ),
      ),
    );
    const provider = new ResponsesTopicProvider(
      {
        providerKey: 'deepseek-responses-v1',
        model: 'synthetic',
        apiKey: 'synthetic',
        timeoutMs: 60000,
        maxOutputTokens: 800,
      },
      fetcher,
    );
    const result = await provider.generate(pair, 'synthetic-batch', () =>
      Promise.resolve(),
    );
    expect(result.topics[0]?.members.map((m) => m.quote)).toEqual(
      pair.entries.map((e) => e.body),
    );
    expect(result.topics[0]).not.toHaveProperty('relations');
    invalid = true;
    await expect(
      provider.generate(pair, 'synthetic-batch', () => Promise.resolve()),
    ).rejects.toMatchObject({code: 'topic_evidence_invalid'});
  });
});
