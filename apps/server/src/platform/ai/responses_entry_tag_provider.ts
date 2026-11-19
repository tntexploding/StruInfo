import {sourceProcessingInstructions} from '../../application/source_processing_scope.js';
import {z} from 'zod';
import {
  annotationResponseSchema,
  ANNOTATION_INSTRUCTIONS,
  annotationModelContext,
  annotationModelSubject,
  decodeAnnotationResponse,
} from './annotation_response.js';
import {
  EMPTY_ANNOTATION_VOCABULARY,
  withDefaultAnnotationDimensions,
  type AnnotationVocabulary,
} from '../../modules/entries/structured_annotations.js';
import {documentProcessingInstructions} from '../../modules/processing/document_processing_standard.js';
import {parseResponseJson} from './response_json.js';
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
import {type CurrentInformationEntry} from '../../modules/entries/index.js';
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

export const OPENAI_TAG_PROMPT_VERSION = 'struinfo.openai-entry-tags.v15';

const MAXIMUM_RESPONSE_BYTES = 1024 * 1024;

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
    const active = withDefaultAnnotationDimensions(
      (await this.vocabulary?.()) ?? EMPTY_ANNOTATION_VOCABULARY,
    );
    const context = annotationModelContext(active, [entry]);
    return decodePayload(
      await this.request(createRequest(this.#config, entry, context)),
      entry,
      active,
      context.terms,
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
    const active = withDefaultAnnotationDimensions(
      (await this.vocabulary?.()) ?? EMPTY_ANNOTATION_VOCABULARY,
    );
    const firstEntry = entries[0];
    if (!firstEntry) fail();
    const context = annotationModelContext(active, entries);
    const first = createRequest(this.#config, firstEntry, context);
    const input = JSON.stringify({
      annotationVocabulary: modelVocabulary(context),
      items: entries.map((entry) => {
        return {
          expectedRevision: entry.revision,
          ...annotationModelSubject(entry),
        };
      }),
    });
    if (Array.from(input).length > MAXIMUM_TAG_BATCH_CHARACTERS)
      throw new AiTagProposalProviderError('ai_provider_rejected');
    const payload = await this.request({
      ...first,
      max_output_tokens: Math.max(
        this.#config.maxOutputTokens,
        entries.length * 4096 + 128,
      ),
      instructions: [
        ANNOTATION_INSTRUCTIONS,
        documentProcessingInstructions('tags'),
        sourceProcessingInstructions('tags'),
        'Return one JSON object with items. Each item contains entryId, expectedRevision and tags. Each tags object contains summary and annotations. Use the exact response schema. No extra fields.',
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
    if (!isClosedRecord(payload, ['items']) || !Array.isArray(payload.items))
      fail('batch_items');
    const items: unknown[] = payload.items;
    const results = entries.map((entry) => {
      const identity = {
        entryId: entry.entryId,
        expectedRevision: entry.revision,
      };
      const matches = items.filter(
        (item) => isRecord(item) && item.entryId === entry.entryId,
      );
      const item = matches[0];
      try {
        if (
          matches.length !== 1 ||
          !isClosedRecord(item, ['entryId', 'expectedRevision', 'tags']) ||
          item.expectedRevision !== entry.revision
        )
          fail('batch_identity');
        return {
          ...identity,
          result: decodePayload(item.tags, entry, active, context.terms),
        };
      } catch (error) {
        return {
          ...identity,
          errorCode: 'ai_provider_invalid_response' as const,
          errorDetail: validationDetail(error),
        };
      }
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
      fail('response_json');
    }
    return payload;
  }
}

function modelVocabulary(context: ReturnType<typeof annotationModelContext>) {
  return {
    ...context,
    terms: context.terms.map((term, index) => ({
      ...term,
      id: `T${String(index + 1)}`,
    })),
  };
}

function createRequest(
  config: Readonly<AiProposalProviderConfig>,
  entry: Readonly<CurrentInformationEntry>,
  context: ReturnType<typeof annotationModelContext>,
) {
  return {
    model: config.model,
    ...responsesOptions(config),
    store: false,
    max_output_tokens: Math.max(config.maxOutputTokens, 8192),
    instructions: [
      documentProcessingInstructions('tags'),
      sourceProcessingInstructions('tags'),
      ANNOTATION_INSTRUCTIONS,
      'Return exactly one JSON object with summary and annotations. No extra fields.',
      RESPONSE_METADATA_INSTRUCTIONS,
    ].join(' '),
    input: JSON.stringify({
      ...annotationModelSubject(entry),
      annotationVocabulary: modelVocabulary(context),
    }),
    text: {
      format: {
        type: 'json_schema',
        name: 'struinfo_entry_tag_proposal',
        strict: true,
        schema: {
          type: 'object',
          additionalProperties: false,
          required: ['summary', 'annotations'],
          properties: {
            summary: {type: 'string', minLength: 1, maxLength: 240},
            annotations: z.toJSONSchema(annotationResponseSchema),
          },
        },
      },
    },
  };
}
function extractOutputText(value: unknown): string {
  if (isRecord(value) && value.status === 'incomplete')
    fail('response_incomplete');
  if (
    !isRecord(value) ||
    value.status !== 'completed' ||
    !Array.isArray(value.output)
  ) {
    fail('response_envelope');
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
  entry: CurrentInformationEntry,
  vocabulary: AnnotationVocabulary,
  suppliedTerms: AnnotationVocabulary['terms'],
): Readonly<AiTagProposalProviderResult> {
  if (!isClosedRecord(value, ['summary', 'annotations'])) fail('tags_fields');
  const summary = boundedText(value.summary, 240);
  try {
    return {
      summary,
      annotations: decodeAnnotationResponse(
        value.annotations,
        entry,
        vocabulary,
        suppliedTerms,
      ),
    };
  } catch (error) {
    return fail(validationDetail(error));
  }
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

function validationDetail(error: unknown): string {
  if (error instanceof AiTagProposalProviderError)
    return error.detail ?? 'response_format';
  if (error instanceof z.ZodError)
    return error.issues
      .slice(0, 3)
      .map((issue) => `${issue.path.join('.')}:${issue.code}`)
      .join(';')
      .slice(0, 160);
  const known: Record<string, string> = {
    'Unknown annotation evidence.': 'unknown_evidence',
    'Unknown annotation term.': 'unknown_term',
    'Annotation term dimension mismatch.': 'term_dimension_mismatch',
    'Annotation term identity changed.': 'term_identity_changed',
    'Invalid annotation evidence.': 'invalid_evidence_or_labels',
    'Duplicate annotation term.': 'duplicate_term',
    'Unknown annotation dimension.': 'unknown_dimension',
    'Annotation status conflicts with content.': 'status_content_conflict',
  };
  return error instanceof Error
    ? (known[error.message] ?? 'annotation_validation')
    : 'annotation_validation';
}
function fail(detail = 'response_format'): never {
  throw new AiTagProposalProviderError('ai_provider_invalid_response', detail);
}
