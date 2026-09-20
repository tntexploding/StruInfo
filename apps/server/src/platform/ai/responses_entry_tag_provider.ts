import {entryTagSubject} from './entry_tag_subject.js';
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

export const OPENAI_TAG_PROMPT_VERSION = 'struinfo.openai-entry-tags.v5';

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
    let response: Response;
    try {
      response = await this.#fetch(responsesEndpoint(this.#config), {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.#config.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(createRequest(this.#config, entry)),
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
      payload = JSON.parse(outputText) as unknown;
    } catch {
      throw new AiTagProposalProviderError('ai_provider_invalid_response');
    }
    return decodePayload(payload);
  }
}

function createRequest(
  config: Readonly<AiProposalProviderConfig>,
  entry: Readonly<CurrentInformationEntry>,
): Readonly<Record<string, unknown>> {
  const subject = entryTagSubject(entry);
  return Object.freeze({
    model: config.model,
    ...responsesOptions(config),
    store: false,
    max_output_tokens: config.maxOutputTokens,
    instructions: [
      'You classify one InformationEntry for a personal knowledge system.',
      'Return only the requested JSON schema. Do not quote or summarize sensitive details.',
      'Choose 3-12 concise content keywords. Merge capitalization-only duplicates.',
      'Use the central article subject. Ignore site navigation, recommended reading, publisher boilerplate and incidental examples. Publisher names are not topical tags unless the article studies the publisher.',
      'When documentContext is present, it is a collection preface, not this item. Classify titlePath and body only; do not import other stories, the digest title or the publication date from documentContext. Existing labels are hints, not evidence.',
      'Preserve useful specific entities, models and concepts supported by this item. Do not merge related but distinct entities or force tags into a smaller fixed count.',
      'A bibliography preserves provenance, not a separate topical catalog. Do not create tags for names or subjects appearing only in references; ground tags in the article itself.',
      'Choose exactly one type and 1-3 ordered domains (primary first).',
      'Use customName only when keyword is other; otherwise return null.',
      RESPONSE_METADATA_INSTRUCTIONS,
    ].join(' '),
    input: JSON.stringify({
      ...subject,
      existingContentKeywords: (subject.documentContext
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
          required: ['summary', 'contentKeywords', 'type', 'domains'],
          properties: {
            summary: {type: 'string', minLength: 1, maxLength: 240},
            contentKeywords: {
              type: 'array',
              minItems: 1,
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
              minItems: 1,
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

function decodePayload(value: unknown): Readonly<AiTagProposalProviderResult> {
  if (!isClosedRecord(value, ['summary', 'contentKeywords', 'type', 'domains']))
    fail();
  const summary = boundedText(value.summary, 240);
  if (
    !Array.isArray(value.contentKeywords) ||
    value.contentKeywords.length < 1 ||
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
    value.domains.length < 1 ||
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
  return Object.freeze({
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
