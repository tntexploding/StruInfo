import {describe, expect, it, vi} from 'vitest';
import {ResponsesReportProvider} from './responses_report_provider.js';
const config = {
  providerKey: 'deepseek-responses-v1' as const,
  model: 'synthetic',
  apiKey: 'synthetic-secret',
  maxOutputTokens: 800 as const,
  timeoutMs: 60000 as const,
};
const response = (value: unknown, status = 'completed') =>
  new Response(
    JSON.stringify({
      status,
      output: [
        {
          type: 'message',
          content: [{type: 'output_text', text: JSON.stringify(value)}],
        },
      ],
    }),
  );
const source = {
  handle: 1,
  title: 'Synthetic',
  excerpt: 'Synthetic excerpt',
  keywords: [],
  reason: 'Synthetic selection',
};
const summaryInput = {
  kind: 'daily' as const,
  title: 'Synthetic',
  period: {from: '2040-01-02', to: '2040-01-02'},
  timeField: 'received' as const,
  sources: [
    {
      handle: 1,
      title: 'Synthetic',
      text: 'Complete synthetic article.',
      receivedDate: '2040-01-02',
      publishedDate: '2039-12-01',
    },
  ],
};
const story = {
  title: '合成摘要',
  points: [{text: '证据内容', sources: [1], role: 'finding'}],
};
describe('report Responses adapter', () => {
  it('identifies every independent event without a story quota in the model input', async () => {
    const sources = Array.from({length: 10}, (_, i) => ({
      ...source,
      handle: i + 1,
    }));
    const groups = sources.map((s) => ({
      title: s.title,
      sources: [s.handle],
      recommended: true,
    }));
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response({groups}));
    const provider = new ResponsesReportProvider(config, fetcher);
    expect((await provider.plan({kind: 'daily', sources})).groups).toHaveLength(
      10,
    );
    const raw = fetcher.mock.calls[0]?.[1]?.body;
    if (typeof raw !== 'string') throw new Error('missing request');
    const request = JSON.parse(raw) as {
      input: string;
      text: {format: {schema: unknown}};
    };
    expect(JSON.parse(request.input)).not.toHaveProperty('maxItems');
    expect(request.text.format.schema).toMatchObject({
      properties: {groups: {maxItems: 10}},
    });
  });
  it('produces a cited finding and preserves source dates without tools or storage', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      response({
        ...story,
        points: [
          ...story.points,
          {text: '此结论仅适用于合成样本。', sources: [1], role: 'limitation'},
          {text: '合成统计属于 2039 年。', sources: [1], role: 'evidence'},
        ],
      }),
    );
    const result = await new ResponsesReportProvider(config, fetcher).summarize(
      summaryInput,
    );
    expect(result.points.map((p) => p.role)).toEqual([
      'finding',
      'limitation',
      'evidence',
    ]);
    const raw = fetcher.mock.calls[0]?.[1]?.body;
    if (typeof raw !== 'string') throw new Error('missing request');
    const body = JSON.parse(raw) as Record<string, unknown>;
    expect(body).toMatchObject({
      store: false,
      model: 'synthetic',
      max_output_tokens: 800,
    });
    expect(body).not.toHaveProperty('tools');
    expect(body.instructions).toContain('untrusted');
    expect(body.instructions).toContain('forecasts');
    expect(JSON.parse(String(body.input))).toMatchObject({
      period: summaryInput.period,
      sources: [
        {
          publishedDate: '2039-12-01',
          receivedDate: '2040-01-02',
          text: 'Complete synthetic article.',
        },
      ],
    });
  });
  it('allows a complete one-paragraph briefing without filler sections', async () => {
    const provider = new ResponsesReportProvider(
      config,
      vi.fn<typeof fetch>().mockResolvedValue(response(story)),
    );
    expect(await provider.summarize(summaryInput)).toEqual(story);
  });
  it.each([
    {
      ...story,
      points: [{text: '字'.repeat(141), sources: [1], role: 'finding'}],
    },
    {...story, points: []},
    {...story, points: Array.from({length: 5}, () => story.points[0])},
    {...story, points: [{text: '缺少来源', sources: [], role: 'finding'}]},
    {...story, points: [{text: '缺少角色', sources: [1]}]},
    {...story, extra: 'invented'},
  ])(
    'rejects invalid structured summaries without clipping evidence',
    async (value) => {
      const provider = new ResponsesReportProvider(
        config,
        vi.fn<typeof fetch>().mockResolvedValue(response(value)),
      );
      await expect(provider.summarize(summaryInput)).rejects.toMatchObject({
        code: 'ai_provider_invalid_response',
      });
    },
  );
  it('rejects truncation, invented fields, oversized input and raw provider failures', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(response({groups: []}, 'incomplete'))
      .mockResolvedValueOnce(response({groups: [], secret: true}))
      .mockRejectedValueOnce(new Error('synthetic-secret'));
    const provider = new ResponsesReportProvider(config, fetcher);
    const input = {kind: 'daily' as const, sources: [source]};
    for (let i = 0; i < 2; i++)
      await expect(provider.plan(input)).rejects.toMatchObject({
        code: 'ai_provider_invalid_response',
      });
    await expect(provider.plan(input)).rejects.toThrow(
      'ai_provider_unavailable',
    );
    await expect(
      provider.summarize({
        ...summaryInput,
        sources: [{handle: 1, title: 'Synthetic', text: 'x'.repeat(160001)}],
      }),
    ).rejects.toMatchObject({code: 'ai_intake_input_too_large'});
    expect(fetcher).toHaveBeenCalledTimes(3);
  });
});
