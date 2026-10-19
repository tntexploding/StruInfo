import {documentProcessingInstructions} from '../../modules/processing/document_processing_standard.js';
import {
  responsesEndpoint,
  responsesPromptVersion,
} from './responses_configuration.js';
import {describe, expect, it, vi} from 'vitest';

import type {CurrentInformationEntry} from '../../modules/entries/index.js';
import {AiAssociationProposalProviderError} from '../../modules/processing/index.js';
import {
  OPENAI_ASSOCIATION_PROMPT_VERSION,
  ResponsesEntryAssociationProvider,
} from './responses_entry_association_provider.js';
import {type OpenAiFetch} from './responses_entry_tag_provider.js';

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
  it.each(['relation', 'no_relation', 'uncertain', 'changed'] as const)(
    'independently verifies a candidate: %s',
    async (outcome) => {
      const candidate = {
        relationLabel: '合成缓冲机制比较',
        direction: 'symmetric' as const,
      };
      const positive = outcome === 'relation' || outcome === 'changed';
      const fetcher = vi.fn<OpenAiFetch>(() =>
        Promise.resolve(
          responseEnvelope({
            outcome: outcome === 'changed' ? 'relation' : outcome,
            summary: 'Synthetic A and B evidence comparison.',
            relationLabel: positive
              ? outcome === 'changed'
                ? 'Unrequested replacement'
                : candidate.relationLabel
              : null,
            direction: positive ? candidate.direction : null,
            basis: positive ? 'comparison' : 'insufficient_evidence',
            evidenceA: positive ? ['A:0'] : [],
            evidenceB: positive ? ['B:0'] : [],
          }),
        ),
      );
      const provider = new ResponsesEntryAssociationProvider(CONFIG, fetcher);
      const result = provider.reviewAssociation(
        entry('2', false),
        entry('3', false),
        candidate,
      );
      if (outcome === 'uncertain' || outcome === 'changed')
        await expect(result).rejects.toMatchObject({
          code:
            outcome === 'uncertain'
              ? 'ai_relation_review_uncertain'
              : 'ai_provider_invalid_response',
        });
      else
        expect(await result).toMatchObject(
          outcome === 'relation' ? candidate : {outcome: 'no_relation'},
        );
      expect(fetcher).toHaveBeenCalledTimes(1);
      const body = fetcher.mock.calls[0]?.[1]?.body;
      if (typeof body !== 'string')
        throw new Error('missing synthetic request');
      const request = JSON.parse(body) as {
        input: string;
        text: {format: {name: string}};
      };
      expect(JSON.parse(request.input)).toMatchObject({candidate});
      expect(request.text.format.name).toBe(
        'struinfo_entry_association_review',
      );
    },
  );
  it('sends only the explicitly selected public pair with storage and tools disabled', async () => {
    const fetchImplementation = vi.fn<OpenAiFetch>(() =>
      Promise.resolve(
        responseEnvelope({
          summary: 'A 补充 B 的实现背景。',
          relationLabel: '补充说明',
          direction: 'low_to_high',
        }),
      ),
    );
    const provider = new ResponsesEntryAssociationProvider(
      CONFIG,
      fetchImplementation,
    );

    await expect(
      provider.proposeAssociation(entry('2', false), entry('3', false)),
    ).resolves.toEqual({
      summary: 'A 补充 B 的实现背景。',
      relationLabel: '补充说明',
      direction: 'low_to_high',
    });
    expect(provider.promptVersion).toBe(
      responsesPromptVersion(CONFIG, OPENAI_ASSOCIATION_PROMPT_VERSION),
    );
    const [url, init] = fetchImplementation.mock.calls[0] ?? [];
    expect(url).toBe(responsesEndpoint(CONFIG));
    if (typeof init?.body !== 'string') throw new Error('missing request body');
    const request = JSON.parse(init.body) as Record<string, unknown>;
    expect(request).toMatchObject({
      model: CONFIG.model,
      store: false,
      max_output_tokens: 800,
    });
    expect(request).not.toHaveProperty('tools');
    expect(String(request.instructions)).toContain(
      documentProcessingInstructions('relations'),
    );
    expect(provider.providerKey).toBe(CONFIG.providerKey);
    expect(request.reasoning).toEqual(
      CONFIG.providerKey === 'deepseek-responses-v1'
        ? {effort: 'none'}
        : undefined,
    );
    expect(String(request.input)).toContain('Synthetic body 2');
    expect(String(request.input)).toContain('Synthetic body 3');
    expect(String(request.input)).not.toContain('synthetic:source');
  });

  it('returns no relation for insufficient evidence without inventing a label', async () => {
    const provider = new ResponsesEntryAssociationProvider(CONFIG, () =>
      Promise.resolve(
        responseEnvelope({
          outcome: 'no_relation',
          summary: 'Only a broad topic is shared.',
          relationLabel: null,
          direction: null,
        }),
      ),
    );
    await expect(
      provider.proposeAssociation(entry('2', false), entry('3', false)),
    ).resolves.toEqual({
      outcome: 'no_relation',
      summary: 'Only a broad topic is shared.',
    });
  });

  it('rejects a contradictory no-relation payload', async () => {
    const provider = new ResponsesEntryAssociationProvider(CONFIG, () =>
      Promise.resolve(
        responseEnvelope({
          outcome: 'no_relation',
          summary: 'Insufficient evidence',
          relationLabel: 'Invented link',
          direction: 'symmetric',
        }),
      ),
    );
    await expect(
      provider.proposeAssociation(entry('2', false), entry('3', false)),
    ).rejects.toMatchObject({code: 'ai_provider_invalid_response'});
  });

  it.each([
    'topic_only',
    'incidental_entity',
    'insufficient_evidence',
    undefined,
    'unknown',
  ])(
    'rejects a positive link without a specific relation basis: %s',
    async (basis) => {
      const provider = new ResponsesEntryAssociationProvider(CONFIG, () =>
        Promise.resolve(
          responseEnvelope({
            outcome: 'relation',
            basis,
            summary:
              'Only a broad subject is shared, without a specific mechanism.',
            relationLabel: 'Broad subject',
            direction: 'symmetric',
          }),
        ),
      );
      await expect(
        provider.proposeAssociation(entry('2', false), entry('3', false)),
      ).rejects.toMatchObject({code: 'ai_provider_invalid_response'});
    },
  );

  it('rejects a specific basis contradicted by a no-relation decision', async () => {
    const provider = new ResponsesEntryAssociationProvider(CONFIG, () =>
      Promise.resolve(
        responseEnvelope({
          outcome: 'no_relation',
          basis: 'prerequisite',
          summary: 'A prerequisite is claimed but denied.',
          relationLabel: null,
          direction: null,
        }),
      ),
    );
    await expect(
      provider.proposeAssociation(entry('2', false), entry('3', false)),
    ).rejects.toMatchObject({code: 'ai_provider_invalid_response'});
  });

  it('exposes headings as context without selectable IDs and keeps body evidence IDs stable', async () => {
    const first = entry('2', false);
    const selected = {
      ...first,
      value: {
        ...first.value,
        body: '# Synthetic mechanism\n\nThe mechanism corrects measured drift.',
      },
    };
    const fetcher = vi.fn<OpenAiFetch>(() =>
      Promise.resolve(
        responseEnvelope({
          summary: 'A explains drift correction; B compares an implementation.',
          basis: 'shared_mechanism',
          relationLabel: 'Drift correction',
          direction: 'symmetric',
          evidenceA: ['A:1'],
        }),
      ),
    );
    await expect(
      new ResponsesEntryAssociationProvider(CONFIG, fetcher).proposeAssociation(
        selected,
        entry('3', false),
      ),
    ).resolves.toMatchObject({relationLabel: 'Drift correction'});
    const body = fetcher.mock.calls[0]?.[1]?.body;
    if (typeof body !== 'string') throw new Error('missing request body');
    const request = JSON.parse(body) as {
      input: string;
      text: {
        format: {schema: {properties: {evidenceA: {items: {enum: string[]}}}}};
      };
    };
    expect(JSON.parse(request.input)).toMatchObject({
      entryA: {
        headingContext: ['# Synthetic mechanism'],
        passages: [
          {
            id: 'A:1',
            role: 'content',
            text: 'The mechanism corrects measured drift.',
          },
        ],
      },
    });
    expect(request.text.format.schema.properties.evidenceA.items.enum).toEqual([
      'A:1',
    ]);
    const invalid = new ResponsesEntryAssociationProvider(CONFIG, () =>
      Promise.resolve(
        responseEnvelope({
          summary: 'A heading is not evidence.',
          relationLabel: 'Invented link',
          direction: 'symmetric',
          evidenceA: ['A:0'],
        }),
      ),
    );
    await expect(
      invalid.proposeAssociation(selected, entry('3', false)),
    ).rejects.toMatchObject({code: 'ai_provider_invalid_response'});
    expect(selected.value.body).toBe(
      '# Synthetic mechanism\n\nThe mechanism corrects measured drift.',
    );
  });

  it('does not dispatch a relation request when an endpoint contains only a heading', async () => {
    const first = entry('2', false);
    const fetcher = vi.fn<OpenAiFetch>();
    await expect(
      new ResponsesEntryAssociationProvider(CONFIG, fetcher).proposeAssociation(
        {...first, value: {...first.value, body: '# Only a title'}},
        entry('3', false),
      ),
    ).resolves.toMatchObject({outcome: 'no_relation'});
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('rejects a private pair before calling the Provider', async () => {
    const fetchImplementation = vi.fn<OpenAiFetch>();
    const provider = new ResponsesEntryAssociationProvider(
      CONFIG,
      fetchImplementation,
    );

    await expect(
      provider.proposeAssociation(entry('2', false), entry('3', true)),
    ).rejects.toEqual(
      new AiAssociationProposalProviderError('ai_provider_rejected'),
    );
    expect(fetchImplementation).not.toHaveBeenCalled();
  });

  it.each([
    {evidenceA: ['B:0'], evidenceB: ['B:0']},
    {evidenceA: ['A:999'], evidenceB: ['B:0']},
    {evidenceA: [], evidenceB: ['B:0']},
  ])(
    'rejects a relation with missing or cross-endpoint evidence: $evidenceA',
    async (evidence) => {
      const provider = new ResponsesEntryAssociationProvider(CONFIG, () =>
        Promise.resolve(
          responseEnvelope({
            summary: 'A concrete but unsupported claim.',
            relationLabel: 'comparison',
            direction: 'symmetric',
            ...evidence,
          }),
        ),
      );
      await expect(
        provider.proposeAssociation(entry('2', false), entry('3', false)),
      ).rejects.toMatchObject({code: 'ai_provider_invalid_response'});
    },
  );

  it('cannot cite a publication appendix removed from the pair subject', async () => {
    const first = entry('2', false);
    const selected = {
      ...first,
      value: {
        ...first.value,
        body: 'A concrete mechanism.\n\n# Colophon\n\nFictional publisher catalogue.',
      },
    };
    const fetcher = vi.fn<OpenAiFetch>(() =>
      Promise.resolve(
        responseEnvelope({
          summary: 'Both have a publisher.',
          relationLabel: 'same publisher',
          direction: 'symmetric',
          evidenceA: ['A:2'],
        }),
      ),
    );
    await expect(
      new ResponsesEntryAssociationProvider(CONFIG, fetcher).proposeAssociation(
        selected,
        entry('3', false),
      ),
    ).rejects.toMatchObject({code: 'ai_provider_invalid_response'});
    const sent = fetcher.mock.calls[0]?.[1]?.body;
    expect(sent).not.toContain('Fictional publisher catalogue');
    expect(selected.value.body).toContain('Fictional publisher catalogue');
  });

  it('fails closed when the result contains an unrequested field', async () => {
    const provider = new ResponsesEntryAssociationProvider(CONFIG, () =>
      Promise.resolve(
        responseEnvelope({
          summary: 'Synthetic summary',
          relationLabel: '相关',
          direction: 'symmetric',
          confidence: 1,
        }),
      ),
    );

    await expect(
      provider.proposeAssociation(entry('2', false), entry('3', false)),
    ).rejects.toEqual(
      new AiAssociationProposalProviderError('ai_provider_invalid_response'),
    );
  });
});

function responseEnvelope(payload: Record<string, unknown>): Response {
  return new Response(
    JSON.stringify({
      status: 'completed',
      output: [
        {
          type: 'message',
          content: [
            {
              type: 'output_text',
              text: JSON.stringify({
                outcome: 'relation',
                basis:
                  payload.outcome === 'no_relation'
                    ? 'insufficient_evidence'
                    : 'comparison',
                evidenceA: payload.outcome === 'no_relation' ? [] : ['A:0'],
                evidenceB: payload.outcome === 'no_relation' ? [] : ['B:0'],
                ...payload,
              }),
            },
          ],
        },
      ],
    }),
    {status: 200, headers: {'content-type': 'application/json'}},
  );
}

function entry(
  suffix: '2' | '3',
  isPrivate: boolean,
): Readonly<CurrentInformationEntry> {
  return Object.freeze({
    workspaceId: '11111111-1111-4111-8111-111111111111',
    entryId: `${suffix.repeat(8)}-${suffix.repeat(4)}-4${suffix.repeat(3)}-8${suffix.repeat(3)}-${suffix.repeat(12)}`,
    resourceId: '44444444-4444-4444-8444-444444444444',
    snapshotId: '55555555-5555-4555-8555-555555555555',
    revision: 1,
    revisionId:
      suffix === '2'
        ? '66666666-6666-4666-8666-666666666666'
        : '77777777-7777-4777-8777-777777777777',
    sourceKey: `synthetic:source:${suffix}`,
    capturedAt: '2040-01-02T03:04:05.000Z',
    value: Object.freeze({
      documentOrder: Number(suffix),
      titlePath: `Synthetic Entry ${suffix}`,
      body: `Synthetic body ${suffix}`,
      bodySha256: suffix.repeat(64),
      chunkMode: 'split',
      splitRuleVersion: 'struinfo.entry-split.section.v1',
      isPrivate,
      typeKeyword: 'knowledge_explanation',
      contentKeywords: Object.freeze([
        Object.freeze({
          displayValue: `keyword-${suffix}`,
          normalizedValue: `keyword-${suffix}`,
          origin: 'manual' as const,
          originVersion: 'synthetic',
        }),
      ]),
      domains: Object.freeze([]),
      fragmentIds: Object.freeze([
        suffix === '2'
          ? '88888888-8888-4888-8888-888888888888'
          : '99999999-9999-4999-8999-999999999999',
      ]),
    }),
  });
}
