import assert from 'node:assert/strict';
import {describe, it, expect, vi} from 'vitest';
import {
  ResponsesEntryTagProvider,
  type OpenAiFetch,
} from './responses_entry_tag_provider.js';
import {
  annotationModelContext,
  annotationModelSubject,
} from './annotation_response.js';
import {
  withDefaultAnnotationDimensions,
  EMPTY_ANNOTATION_VOCABULARY,
} from '../../modules/entries/structured_annotations.js';
import type {CurrentInformationEntry} from '../../modules/entries/information_entry_contract.js';
const config = {
  providerKey: 'deepseek-responses-v1' as const,
  model: 'synthetic',
  apiKey: 'synthetic',
  maxOutputTokens: 800 as const,
  timeoutMs: 60000 as const,
};
const vocabulary = withDefaultAnnotationDimensions(EMPTY_ANNOTATION_VOCABULARY);
const dimension = required(
  vocabulary.dimensions.find((d) => d.role === 'entity'),
);
const payload = (evidenceId = 'E0:P0', meaning = 'test material') => ({
  summary: 'Synthetic',
  annotations: {
    status: 'complete',
    note: '',
    labels: [
      {
        dimensionId: dimension.id,
        termId: null,
        label: 'Synthetic',
        meaning,
        wording: 'Synthetic',
        primary: true,
        evidenceId,
      },
    ],
    claims: [],
  },
});
describe('single tag output', () => {
  it('reports the invalid field without retaining model text', async () => {
    const invalid = payload();
    const [label] = invalid.annotations.labels;
    if (!label) throw new Error('Missing fixture label');
    label.wording = 'x'.repeat(121);
    const p = new ResponsesEntryTagProvider(config, () =>
      Promise.resolve(responseEnvelope(invalid)),
    );
    await expect(p.proposeTags(entry())).rejects.toMatchObject({
      code: 'ai_provider_invalid_response',
      detail: 'labels.0.wording:too_big',
    });
    const results = await new ResponsesEntryTagProvider(config, () =>
      Promise.resolve(
        responseEnvelope({
          items: [
            {
              entryId: entry().entryId,
              expectedRevision: entry().revision,
              tags: invalid,
            },
          ],
        }),
      ),
    ).proposeTagsBatch([entry()]);
    expect(results[0]).toMatchObject({errorDetail: 'labels.0.wording:too_big'});
  });
  it('uses stable cross-entry identities and keeps different meanings separate', async () => {
    let output = payload();
    const fetcher = vi.fn<OpenAiFetch>(() =>
      Promise.resolve(responseEnvelope(output)),
    );
    const p = new ResponsesEntryTagProvider(config, fetcher);
    const first = await p.proposeTags(entry());
    const second = await p.proposeTags({
      ...entry(),
      revisionId: '11111111-1111-4111-8111-111111111117',
    });
    expect(required(first.annotations.labels[0]).term.id).toBe(
      required(second.annotations.labels[0]).term.id,
    );
    output = payload('E0:P0', 'different meaning');
    const third = await p.proposeTags(entry());
    expect(required(third.annotations.labels[0]).term.id).not.toBe(
      required(first.annotations.labels[0]).term.id,
    );
    const request = requestBody(fetcher.mock.calls[0]);
    expect(request.text.format.schema.required).toEqual([
      'summary',
      'annotations',
    ]);
    expect(first).not.toHaveProperty('contentKeywords');
  });
  it('selects relevant terms past the old first-128 cutoff', () => {
    const terms = Array.from({length: 300}, (_, i) => ({
      id: '00000000-0000-4000-8000-' + String(i).padStart(12, '0'),
      dimensionId: dimension.id,
      label: 'irrelevant ' + String(i),
      meaning: '',
    }));
    terms.push({
      id: '99999999-9999-4999-8999-999999999999',
      dimensionId: dimension.id,
      label: 'Synthetic',
      meaning: '',
    });
    const context = annotationModelContext({...vocabulary, terms}, [entry()]);
    expect(context.terms.map((t) => t.label)).toEqual(['Synthetic']);
  });
  it.each([
    '# Synthetic public body\n\nSynthetic public body',
    '# Collection\n\nSynthetic public body\n\n## 1. Selected item\n\nSynthetic public body',
  ])(
    'anchors repeated evidence within the selected subject: %s',
    async (body) => {
      const source = {...entry(), value: {...entry().value, body}};
      const fetcher = vi.fn<OpenAiFetch>(() =>
        Promise.resolve(responseEnvelope(payload('E0:P1'))),
      );
      const result = await new ResponsesEntryTagProvider(
        config,
        fetcher,
      ).proposeTags(source);
      const label = required(result.annotations.labels[0]);
      assert('evidence' in label);
      const evidence = label.evidence;
      expect(
        Array.from(body).slice(evidence.start, evidence.end).join(''),
      ).toBe('Synthetic public body');
      if (body.startsWith('# Collection'))
        expect(evidence.start).toBeGreaterThan(
          body.indexOf('## 1. Selected item'),
        );
      expect(source.value.body).toBe(body);
      expect(fetcher).toHaveBeenCalledTimes(1);
    },
  );
  it('rejects foreign evidence, duplicate output fields and private entries without retries', async () => {
    let output: unknown = payload('E9:P0');
    const fetcher = vi.fn<OpenAiFetch>(() =>
      Promise.resolve(responseEnvelope(output)),
    );
    const p = new ResponsesEntryTagProvider(config, fetcher);
    await expect(p.proposeTags(entry())).rejects.toMatchObject({
      code: 'ai_provider_invalid_response',
    });
    output = {...payload(), contentKeywords: ['duplicate']};
    await expect(p.proposeTags(entry())).rejects.toMatchObject({
      code: 'ai_provider_invalid_response',
    });
    await expect(p.proposeTags(entry(true))).rejects.toMatchObject({
      code: 'ai_provider_rejected',
    });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it('binds an eight-entry batch by identity in one call and shares the catalog once', async () => {
    const entries = Array.from({length: 8}, (_, i) => ({
      ...entry(),
      entryId: '00000000-0000-4000-8000-' + String(i).padStart(12, '0'),
      value: {...entry().value, documentOrder: i},
    }));
    const output = {
      items: entries.toReversed().map((e) => ({
        entryId: e.entryId,
        expectedRevision: e.revision,
        tags: payload(`E${String(e.value.documentOrder)}:P0`),
      })),
    };
    const fetcher = vi.fn<OpenAiFetch>(() =>
      Promise.resolve(responseEnvelope(output)),
    );
    const p = new ResponsesEntryTagProvider(config, fetcher);
    expect(await p.proposeTagsBatch(entries)).toHaveLength(8);
    expect(fetcher).toHaveBeenCalledTimes(1);
    const input = JSON.parse(requestBody(fetcher.mock.calls[0]).input) as {
      annotationVocabulary: {dimensions: unknown[]};
      items: Record<string, unknown>[];
    };
    expect(input.annotationVocabulary.dimensions).toHaveLength(6);
    expect(
      input.items.every(
        (e: Record<string, unknown>) => !e.annotationVocabulary,
      ),
    ).toBe(true);
    required(output.items[0]).expectedRevision++;
    const partial = await p.proposeTagsBatch(entries);
    expect(partial.filter((item) => 'result' in item)).toHaveLength(7);
    expect(
      partial.find((item) => item.entryId === output.items[0]?.entryId),
    ).toMatchObject({errorCode: 'ai_provider_invalid_response'});
    required(output.items[0]).expectedRevision--;
    output.items.push(required(output.items[0]));
    const duplicate = await p.proposeTagsBatch(entries);
    expect(duplicate.filter((item) => 'result' in item)).toHaveLength(7);
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it('maps numbered passages to exact Markdown and Unicode source after excluded appendices', async () => {
    const body =
      '# Article\n\n😀 Main result.\n\n## Copyright\n\nLicence only.\n\n## Conclusion\n\nWe use [Profiler](https://example.invalid/a) for this measurement.';
    const source = {...entry(), value: {...entry().value, body}};
    const input = annotationModelSubject(source);
    const passage = required(
      input.passages.find((p) => p.text.startsWith('We use')),
    );
    expect(input.passages.some((p) => p.text.includes('Licence only.'))).toBe(
      false,
    );
    const result = await new ResponsesEntryTagProvider(config, () =>
      Promise.resolve(responseEnvelope(payload(passage.id))),
    ).proposeTags(source);
    const label = required(result.annotations.labels[0]);
    assert('evidence' in label);
    const evidence = label.evidence;
    expect(evidence.quote).toBe(passage.text);
    expect(Array.from(body).slice(evidence.start, evidence.end).join('')).toBe(
      passage.text,
    );
    expect(source.value.body).toBe(body);
  });

  it('retains canonical vocabulary metadata for an explicitly selected known term', async () => {
    const term = {
      id: '99999999-9999-4999-8999-999999999999',
      dimensionId: dimension.id,
      label: 'Synthetic',
      meaning: 'canonical definition',
    };
    const output = payload();
    const label = required(output.annotations.labels[0]);
    const response = {
      ...output,
      annotations: {
        ...output.annotations,
        labels: [{...label, termId: 'T1', meaning: 'contextual description'}],
      },
    };
    const result = await new ResponsesEntryTagProvider(
      config,
      () => Promise.resolve(responseEnvelope(response)),
      () => Promise.resolve({...vocabulary, terms: [term]}),
    ).proposeTags(entry());
    expect(required(result.annotations.labels[0]).term).toEqual(term);
  });

  it('rejects missing and cross-dimension references instead of inventing a vocabulary term', async () => {
    for (const [termId, dimensionId, detail] of [
      ['T2', dimension.id, 'unknown_term'],
      [
        'T1',
        required(vocabulary.dimensions.find((d) => d.id !== dimension.id)).id,
        'term_dimension_mismatch',
      ],
    ]) {
      const output = payload();
      const label = required(output.annotations.labels[0]);
      const p = new ResponsesEntryTagProvider(
        config,
        () =>
          Promise.resolve(
            responseEnvelope({
              ...output,
              annotations: {
                ...output.annotations,
                labels: [{...label, termId, dimensionId}],
              },
            }),
          ),
        () =>
          Promise.resolve({
            ...vocabulary,
            terms: [
              {
                id: '99999999-9999-4999-8999-999999999999',
                dimensionId: dimension.id,
                label: 'Synthetic',
                meaning: 'canonical definition',
              },
            ],
          }),
      );
      await expect(p.proposeTags(entry())).rejects.toMatchObject({detail});
    }
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

function required<T>(value: T | undefined): T {
  assert(value !== undefined);
  return value;
}

function requestBody(call: Parameters<OpenAiFetch> | undefined) {
  const body = required(call)[1]?.body;
  assert(typeof body === 'string');
  return JSON.parse(body) as {
    text: {format: {schema: {required: string[]}}};
    input: string;
  };
}
