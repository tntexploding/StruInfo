import {describe, it, expect, vi} from 'vitest';
import {ResponsesTopicProvider} from './responses_topic_provider.js';
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
      };
      expect(JSON.parse(request.input)).toEqual(input);
      expect(request.max_output_tokens).toBe(8192);
      expect(request.store).toBe(false);
      expect(request.instructions).toContain('not proof');
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
});
