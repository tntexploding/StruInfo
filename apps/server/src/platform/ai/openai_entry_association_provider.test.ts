import {describe, expect, it, vi} from 'vitest';

import type {CurrentInformationEntry} from '../../modules/entries/index.js';
import {AiAssociationProposalProviderError} from '../../modules/processing/index.js';
import {
  OPENAI_ASSOCIATION_PROMPT_VERSION,
  OpenAiEntryAssociationProvider,
} from './openai_entry_association_provider.js';
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

describe('OpenAiEntryAssociationProvider', () => {
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
    const provider = new OpenAiEntryAssociationProvider(
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
    expect(provider.promptVersion).toBe(OPENAI_ASSOCIATION_PROMPT_VERSION);
    const [url, init] = fetchImplementation.mock.calls[0] ?? [];
    expect(url).toBe(OPENAI_RESPONSES_ENDPOINT);
    if (typeof init?.body !== 'string') throw new Error('missing request body');
    const request = JSON.parse(init.body) as Record<string, unknown>;
    expect(request).toMatchObject({
      model: 'gpt-5-mini',
      store: false,
      max_output_tokens: 800,
    });
    expect(request).not.toHaveProperty('tools');
    expect(String(request.input)).toContain('Synthetic body 2');
    expect(String(request.input)).toContain('Synthetic body 3');
    expect(String(request.input)).not.toContain('synthetic:source');
  });

  it('rejects a private pair before calling the Provider', async () => {
    const fetchImplementation = vi.fn<OpenAiFetch>();
    const provider = new OpenAiEntryAssociationProvider(
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

  it('fails closed when the result contains an unrequested field', async () => {
    const provider = new OpenAiEntryAssociationProvider(CONFIG, () =>
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
