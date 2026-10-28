import {sourceProcessingInstructions} from '../../application/source_processing_scope.js';
import {z} from 'zod';
import {
  annotationResponseSchema,
  ANNOTATION_INSTRUCTIONS,
  annotationModelContext,
  decodeAnnotationResponse,
} from './annotation_response.js';
import type {AnnotationVocabulary} from '../../modules/entries/structured_annotations.js';
import {documentProcessingInstructions} from '../../modules/processing/document_processing_standard.js';
import {parseResponseJson} from './response_json.js';
import {entryTagSubject} from './entry_tag_subject.js';
import {
  MAXIMUM_AI_BATCH_ENTRIES,
  MAXIMUM_TAG_BATCH_CHARACTERS,
  tagBatchEntrySize,
} from '../../modules/processing/ai_entry_batch.js';
import {isAiDispatchWait} from '../../modules/processing/ai_price_policy.js';
import {
  responsesEndpoint,
  responsesOptions,
  responsesPromptVersion,
} from './responses_configuration.js';
import {
  ENTRY_DOMAIN_KEYWORDS,
  ENTRY_TYPE_KEYWORDS,
  informationEntrySearchKey,
  type CurrentInformationEntry,
} from '../../modules/entries/index.js';
import {
  AiTagProposalProviderError,
  type AiTagProposalProviderPort,
  type AiTagProposalProviderResult,
} from '../../modules/processing/index.js';
import type {AiProposalProviderConfig} from '../../config/runtime_config.js';

export {OPENAI_RESPONSES_ENDPOINT} from './responses_configuration.js';
import {
  responseMetadata,
  RESPONSE_METADATA_INSTRUCTIONS,
} from './responses_metadata.js';

export const OPENAI_TAG_PROMPT_VERSION = 'struinfo.openai-entry-tags.v11';

const MAXIMUM_RESPONSE_BYTES = 1024 * 1024;
const TYPE_VALUES = [...ENTRY_TYPE_KEYWORDS];
const DOMAIN_VALUES = [...ENTRY_DOMAIN_KEYWORDS];

export type OpenAiFetch = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

export class ResponsesEntryTagProvider implements AiTagProposalProviderPort {
  public readonly providerKey: AiProposalProviderConfig['providerKey'];
  public readonly promptVersion: string;
  public readonly model: string;
  readonly #config: Readonly<AiProposalProviderConfig>;
  readonly #fetch: OpenAiFetch;

  public constructor(
    config: Readonly<AiProposalProviderConfig>,
    fetchImplementation: OpenAiFetch = globalThis.fetch,
    private readonly vocabulary?: () => Promise<AnnotationVocabulary>,
  ) {
    this.#config = config;
    this.#fetch = fetchImplementation;
    this.model = config.model;
    this.providerKey = config.providerKey;
    this.promptVersion = responsesPromptVersion(
      config,
      OPENAI_TAG_PROMPT_VERSION,
    );
  }

  public async proposeTags(
    entry: Readonly<CurrentInformationEntry>,
  ): Promise<Readonly<AiTagProposalProviderResult>> {
    if (entry.value.isPrivate) {
      throw new AiTagProposalProviderError('ai_provider_rejected');
    }
    const vocabulary = await this.vocabulary?.();
    const active = vocabulary?.dimensions.some((d) => d.enabled)
      ? vocabulary
      : undefined;
    return decodePayload(
      await this.request(createRequest(this.#config, entry, active)),
      entry,
      active,
    );
  }

  public async proposeTagsBatch(
    entries: readonly Readonly<CurrentInformationEntry>[],
  ) {
    if (
      !entries.length ||
      entries.length > MAXIMUM_AI_BATCH_ENTRIES ||
      new Set(entries.map((entry) => entry.entryId)).size !== entries.length ||
      new Set(entries.map((entry) => entry.snapshotId)).size !== 1 ||
      entries.some((entry) => entry.value.isPrivate) ||
      entries.reduce((total, entry) => total + tagBatchEntrySize(entry), 0) >
        MAXIMUM_TAG_BATCH_CHARACTERS
    )
      throw new AiTagProposalProviderError('ai_provider_rejected');
    const vocabulary = await this.vocabulary?.();
    const active = vocabulary?.dimensions.some((d) => d.enabled)
      ? vocabulary
      : undefined;
    const requests = entries.map((entry) =>
      createRequest(this.#config, entry, active),
    );
    const first = requests[0];
    if (!first) fail();
    const input = JSON.stringify({
      ...(active ? {annotationVocabulary: annotationModelContext(active)} : {}),
      items: entries.map((entry, index) => {
        const subject = JSON.parse(String(requests[index]?.input)) as Record<
          string,
          unknown
        >;
        delete subject.annotationVocabulary;
        return {
          entryId: entry.entryId,
          expectedRevision: entry.revision,
          ...subject,
        };
      }),
    });
    if (Array.from(input).length > MAXIMUM_TAG_BATCH_CHARACTERS)
      throw new AiTagProposalProviderError('ai_provider_rejected');
    const payload = await this.request({
      ...first,
      max_output_tokens: Math.max(
        this.#config.maxOutputTokens,
        entries.length * 1000 + 128,
      ),
      instructions: [
        ...(active
          ? [
              ANNOTATION_INSTRUCTIONS,
              'Each tags object also contains annotations as specified in the response schema.',
            ]
          : []),
        documentProcessingInstructions('tags'),
        sourceProcessingInstructions('tags'),
        active
          ? 'Return one JSON object with items. Each item contains entryId, expectedRevision and tags. Each tags object contains summary, contentKeywords, type, domains and annotations, using the exact response schema. No fences or extra fields.'
          : 'Return exactly one JSON object {"items":[{"entryId":"...","expectedRevision":1,"tags":{"summary":"...","contentKeywords":["..."],"type":{"keyword":"...","customName":null},"domains":[{"keyword":"...","customName":null}]}}]}. No fences or extra fields. domains is always an array. Use customName only for other; otherwise null.',
        'Return every supplied entryId and expectedRevision exactly once. Each tags object describes only that Entry. Never pool keywords across items, borrow a neighbouring item subject, or tag the collection preface or advertisements. Existing tags are hints, not evidence.',
        RESPONSE_METADATA_INSTRUCTIONS,
      ].join(' '),
      input,
      text: {
        format: {
          type: 'json_schema',
          name: 'struinfo_entry_tag_batch',
          strict: true,
          schema: {
            type: 'object',
            additionalProperties: false,
            required: ['items'],
            properties: {
              items: {
                type: 'array',
                minItems: entries.length,
                maxItems: entries.length,
                items: {
                  type: 'object',
                  additionalProperties: false,
                  required: ['entryId', 'expectedRevision', 'tags'],
                  properties: {
                    entryId: {
                      type: 'string',
                      enum: entries.map((entry) => entry.entryId),
                    },
                    expectedRevision: {type: 'integer', minimum: 1},
                    tags: first.text.format.schema,
                  },
                },
              },
            },
          },
        },
      },
    });
    if (
      !isClosedRecord(payload, ['items']) ||
      !Array.isArray(payload.items) ||
      payload.items.length !== entries.length
    )
      fail();
    const seen = new Set<string>();
    const results = payload.items.map((item: unknown) => {
      if (
        !isClosedRecord(item, ['entryId', 'expectedRevision', 'tags']) ||
        typeof item.entryId !== 'string'
      )
        fail();
      const entry = entries.find((entry) => entry.entryId === item.entryId);
      if (
        !entry ||
        seen.has(entry.entryId) ||
        item.expectedRevision !== entry.revision
      )
        fail();
      seen.add(entry.entryId);
      return {
        entryId: entry.entryId,
        expectedRevision: entry.revision,
        result: decodePayload(item.tags, entry, active),
      };
    });
    return results;
  }

  private async request(
    request: Readonly<Record<string, unknown>>,
  ): Promise<unknown> {
    let response: Response;
    try {
      response = await this.#fetch(responsesEndpoint(this.#config), {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.#config.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(request),
        signal: AbortSignal.timeout(this.#config.timeoutMs),
      });
    } catch (error) {
      if (isAiDispatchWait(error)) throw error;
      const name = error instanceof Error ? error.name : '';
      throw new AiTagProposalProviderError(
        name === 'AbortError' || name === 'TimeoutError'
          ? 'ai_provider_timeout'
          : 'ai_provider_unavailable',
      );
    }
    if (!response.ok) {
      throw new AiTagProposalProviderError('ai_provider_rejected');
    }
    const length = Number(response.headers.get('content-length') ?? '0');
    if (Number.isFinite(length) && length > MAXIMUM_RESPONSE_BYTES) {
      throw new AiTagProposalProviderError('ai_provider_invalid_response');
    }
    let source: string;
    try {
      source = await response.text();
    } catch {
      throw new AiTagProposalProviderError('ai_provider_unavailable');
    }
    if (new TextEncoder().encode(source).byteLength > MAXIMUM_RESPONSE_BYTES) {
      throw new AiTagProposalProviderError('ai_provider_invalid_response');
    }
    let envelope: unknown;
    try {
      envelope = JSON.parse(source) as unknown;
    } catch {
      throw new AiTagProposalProviderError('ai_provider_invalid_response');
    }
    const outputText = extractOutputText(envelope);
    let payload: unknown;
    try {
      payload = parseResponseJson(outputText);
    } catch {
      throw new AiTagProposalProviderError('ai_provider_invalid_response');
    }
    return payload;
  }
}

function createRequest(
  config: Readonly<AiProposalProviderConfig>,
  entry: Readonly<CurrentInformationEntry>,
  vocabulary?: AnnotationVocabulary,
) {
  const subject = entryTagSubject(entry);
  return Object.freeze({
    model: config.model,
    ...responsesOptions(config),
    store: false,
    max_output_tokens: config.maxOutputTokens,
    instructions: [
      documentProcessingInstructions('tags'),
      sourceProcessingInstructions('tags'),
      'Use customName only when keyword is other; otherwise return null.',
      ...(vocabulary ? [ANNOTATION_INSTRUCTIONS] : []),
      vocabulary
        ? 'Return one JSON object with summary, contentKeywords, type, domains and annotations using the exact response schema. No fences or extra fields.'
        : 'Return one JSON object with summary, contentKeywords, type and domains. No Markdown fences, comments, $schema or placeholder fields. domains MUST be an array of objects even for ONE domain; type is one object. Do not put a quotation mark after an array closing bracket.',
      'Shape example for a synthetic database-index explanation only: {"summary":"解释数据库索引的查找机制","contentKeywords":["数据库索引"],"type":{"keyword":"knowledge_explanation","customName":null},"domains":[{"keyword":"engineering_computing","customName":null}]}. This example shows JSON structure, not tags or taxonomy to copy into unrelated material. Select all values from the current Entry and allowed enums.',
      RESPONSE_METADATA_INSTRUCTIONS,
    ].join(' '),
    input: JSON.stringify({
      ...subject,
      ...(vocabulary
        ? {annotationVocabulary: annotationModelContext(vocabulary)}
        : {}),
      existingContentKeywords: (subject.documentContext ||
      subject.body !== entry.value.body
        ? []
        : entry.value.contentKeywords
      ).map((keyword) => keyword.displayValue),
      existingType: entry.value.typeKeyword ?? null,
      existingDomains: entry.value.domains.map((domain) => ({
        keyword: domain.keyword,
        customName: domain.customName ?? null,
      })),
    }),
    text: {
      format: {
        type: 'json_schema',
        name: 'struinfo_entry_tag_proposal',
        strict: true,
        schema: {
          type: 'object',
          additionalProperties: false,
          required: [
            'summary',
            'contentKeywords',
            'type',
            'domains',
            ...(vocabulary ? ['annotations'] : []),
          ],
          properties: {
            ...(vocabulary
              ? {annotations: z.toJSONSchema(annotationResponseSchema)}
              : {}),
            summary: {type: 'string', minLength: 1, maxLength: 240},
            contentKeywords: {
              type: 'array',
              minItems: vocabulary ? 0 : 1,
              maxItems: 12,
              items: {type: 'string', minLength: 1, maxLength: 80},
            },
            type: {
              type: 'object',
              additionalProperties: false,
              required: ['keyword', 'customName'],
              properties: {
                keyword: {type: 'string', enum: TYPE_VALUES},
                customName: {type: ['string', 'null'], maxLength: 80},
              },
            },
            domains: {
              type: 'array',
              minItems: vocabulary ? 0 : 1,
              maxItems: 3,
              items: {
                type: 'object',
                additionalProperties: false,
                required: ['keyword', 'customName'],
                properties: {
                  keyword: {type: 'string', enum: DOMAIN_VALUES},
                  customName: {type: ['string', 'null'], maxLength: 80},
                },
              },
            },
          },
        },
      },
    },
  });
}

function extractOutputText(value: unknown): string {
  if (
    !isRecord(value) ||
    value.status !== 'completed' ||
    !Array.isArray(value.output)
  ) {
    fail();
  }
  const texts: string[] = [];
  for (const item of value.output) {
    if (
      !isRecord(item) ||
      item.type !== 'message' ||
      !Array.isArray(item.content)
    ) {
      continue;
    }
    for (const content of item.content) {
      if (
        isRecord(content) &&
        content.type === 'output_text' &&
        typeof content.text === 'string'
      ) {
        texts.push(content.text);
      }
    }
  }
  if (texts.length !== 1) fail();
  const [text] = texts;
  if (text === undefined) fail();
  return text;
}

function decodePayload(
  value: unknown,
  entry?: CurrentInformationEntry,
  vocabulary?: AnnotationVocabulary,
): Readonly<AiTagProposalProviderResult> {
  if (
    !isClosedRecord(value, [
      'summary',
      'contentKeywords',
      'type',
      'domains',
      ...(vocabulary ? ['annotations'] : []),
    ])
  )
    fail();
  const summary = boundedText(value.summary, 240);
  if (
    !Array.isArray(value.contentKeywords) ||
    value.contentKeywords.length < (vocabulary ? 0 : 1) ||
    value.contentKeywords.length > 12
  )
    fail();
  const contentKeywords = value.contentKeywords.map((item) =>
    boundedText(item, 80),
  );
  const identities = contentKeywords.map(informationEntrySearchKey);
  if (new Set(identities).size !== identities.length) fail();
  const type = decodeFixedOrOther(value.type, ENTRY_TYPE_KEYWORDS);
  if (
    !Array.isArray(value.domains) ||
    value.domains.length < (vocabulary ? 0 : 1) ||
    value.domains.length > 3
  )
    fail();
  const domains = value.domains.map((item) =>
    decodeFixedOrOther(item, ENTRY_DOMAIN_KEYWORDS),
  );
  const domainIdentities = domains.map(
    (domain) =>
      `${domain.keyword}:${informationEntrySearchKey(domain.customName ?? '')}`,
  );
  if (new Set(domainIdentities).size !== domainIdentities.length) fail();
  let annotations;
  if (vocabulary && entry) {
    try {
      annotations = decodeAnnotationResponse(
        value.annotations,
        entry,
        vocabulary,
      );
    } catch {
      fail();
    }
  }
  return Object.freeze({
    ...(annotations ? {annotations} : {}),
    summary,
    contentKeywords: Object.freeze(contentKeywords),
    typeKeyword: type.keyword,
    ...(type.customName === undefined ? {} : {typeCustomName: type.customName}),
    domains: Object.freeze(
      domains.map((domain) =>
        Object.freeze({
          keyword: domain.keyword,
          ...(domain.customName === undefined
            ? {}
            : {customName: domain.customName}),
        }),
      ),
    ),
  });
}

function decodeFixedOrOther<T extends string>(
  value: unknown,
  allowed: readonly T[],
): Readonly<{keyword: T; customName?: string}> {
  if (
    !isClosedRecord(value, ['keyword', 'customName']) ||
    typeof value.keyword !== 'string' ||
    !allowed.includes(value.keyword as T)
  )
    fail();
  const keyword = value.keyword as T;
  if (keyword === 'other') {
    return Object.freeze({
      keyword,
      customName: boundedText(value.customName, 80),
    });
  }
  if (value.customName !== null) fail();
  return Object.freeze({keyword});
}

function boundedText(value: unknown, maximum: number): string {
  const normalized = responseMetadata(value, maximum);
  if (normalized === undefined) fail();
  return normalized;
}

function isClosedRecord(
  value: unknown,
  keys: readonly string[],
): value is Record<string, unknown> {
  if (!isRecord(value)) return false;
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return (
    actual.length === expected.length &&
    actual.every((key, index) => key === expected[index])
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function fail(): never {
  throw new AiTagProposalProviderError('ai_provider_invalid_response');
}
