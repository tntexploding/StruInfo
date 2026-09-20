import {isAiDispatchWait} from '../../modules/processing/ai_price_policy.js';
import {
  responsesEndpoint,
  responsesOptions,
  responsesPromptVersion,
} from './responses_configuration.js';
import type {AiProposalProviderConfig} from '../../config/runtime_config.js';
import type {CurrentInformationEntry} from '../../modules/entries/index.js';
import {
  AiAssociationProposalProviderError,
  type AiAssociationProposalProviderPort,
  type AiAssociationProposalProviderResult,
} from '../../modules/processing/index.js';
import {type OpenAiFetch} from './responses_entry_tag_provider.js';
import {
  responseMetadata,
  RESPONSE_METADATA_INSTRUCTIONS,
} from './responses_metadata.js';

export const OPENAI_ASSOCIATION_PROMPT_VERSION =
  'struinfo.openai-entry-association.v3';

const MAXIMUM_RESPONSE_BYTES = 1024 * 1024;
const DIRECTIONS = ['symmetric', 'low_to_high', 'high_to_low'] as const;

export class ResponsesEntryAssociationProvider implements AiAssociationProposalProviderPort {
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
      OPENAI_ASSOCIATION_PROMPT_VERSION,
    );
  }

  public async proposeAssociation(
    entryLow: Readonly<CurrentInformationEntry>,
    entryHigh: Readonly<CurrentInformationEntry>,
  ): Promise<Readonly<AiAssociationProposalProviderResult>> {
    if (entryLow.value.isPrivate || entryHigh.value.isPrivate) {
      throw new AiAssociationProposalProviderError('ai_provider_rejected');
    }
    let response: Response;
    try {
      response = await this.#fetch(responsesEndpoint(this.#config), {
        method: 'POST',
        headers: {
          Authorization: 'Bearer ' + this.#config.apiKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(createRequest(this.#config, entryLow, entryHigh)),
        signal: AbortSignal.timeout(this.#config.timeoutMs),
      });
    } catch (error) {
      if (isAiDispatchWait(error)) throw error;
      const name = error instanceof Error ? error.name : '';
      throw new AiAssociationProposalProviderError(
        name === 'AbortError' || name === 'TimeoutError'
          ? 'ai_provider_timeout'
          : 'ai_provider_unavailable',
      );
    }
    if (!response.ok) {
      throw new AiAssociationProposalProviderError('ai_provider_rejected');
    }
    const length = Number(response.headers.get('content-length') ?? '0');
    if (Number.isFinite(length) && length > MAXIMUM_RESPONSE_BYTES) fail();
    let source: string;
    try {
      source = await response.text();
    } catch {
      throw new AiAssociationProposalProviderError('ai_provider_unavailable');
    }
    if (new TextEncoder().encode(source).byteLength > MAXIMUM_RESPONSE_BYTES) {
      fail();
    }
    let envelope: unknown;
    try {
      envelope = JSON.parse(source) as unknown;
    } catch {
      fail();
    }
    const outputText = extractOutputText(envelope);
    let payload: unknown;
    try {
      payload = JSON.parse(outputText) as unknown;
    } catch {
      fail();
    }
    return decodePayload(payload);
  }
}

function createRequest(
  config: Readonly<AiProposalProviderConfig>,
  entryLow: Readonly<CurrentInformationEntry>,
  entryHigh: Readonly<CurrentInformationEntry>,
): Readonly<Record<string, unknown>> {
  return Object.freeze({
    model: config.model,
    ...responsesOptions(config),
    store: false,
    max_output_tokens: config.maxOutputTokens,
    instructions: [
      'Evaluate whether two public InformationEntry records have a specific, useful relationship.',
      'Choose outcome no_relation when evidence is insufficient, the connection is merely a broad domain or generic keyword, or either item lacks the context needed to judge.',
      'Judge the main subject of both articles. Shared publishers, website navigation, recommendations or cited catalog names alone do not establish a useful relation.',
      'A no_relation outcome is a successful decision: return null for relationLabel and direction.',
      'For outcome relation, name the concrete connection grounded in both records. Never invent a connection just to fill a quota.',
      'Entry A is the lower stable UUID and Entry B is the higher stable UUID.',
      'Return only the requested JSON schema.',
      'The relation label must be neutral and no longer than 80 Unicode code points.',
      'Use symmetric when neither direction is justified.',
      'Do not invent facts beyond the two supplied records.',
      RESPONSE_METADATA_INSTRUCTIONS,
    ].join(' '),
    input: JSON.stringify({
      entryA: providerEntry(entryLow),
      entryB: providerEntry(entryHigh),
    }),
    text: {
      format: {
        type: 'json_schema',
        name: 'struinfo_entry_association_proposal',
        strict: true,
        schema: {
          type: 'object',
          additionalProperties: false,
          required: ['summary', 'outcome', 'relationLabel', 'direction'],
          properties: {
            summary: {type: 'string', minLength: 1, maxLength: 240},
            outcome: {type: 'string', enum: ['relation', 'no_relation']},
            relationLabel: {
              type: ['string', 'null'],
              minLength: 1,
              maxLength: 80,
            },
            direction: {type: ['string', 'null'], enum: [...DIRECTIONS, null]},
          },
        },
      },
    },
  });
}

function providerEntry(entry: Readonly<CurrentInformationEntry>) {
  return {
    titlePath: entry.value.titlePath,
    body: entry.value.body,
    contentKeywords: entry.value.contentKeywords.map(
      (keyword) => keyword.displayValue,
    ),
    typeKeyword: entry.value.typeKeyword ?? null,
    domains: entry.value.domains.map((domain) => ({
      keyword: domain.keyword,
      customName: domain.customName ?? null,
    })),
  };
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
  if (texts.length !== 1 || texts[0] === undefined) fail();
  return texts[0];
}

function decodePayload(
  value: unknown,
): Readonly<AiAssociationProposalProviderResult> {
  if (
    !isClosedRecord(value, ['summary', 'outcome', 'relationLabel', 'direction'])
  )
    fail();
  if (value.outcome === 'no_relation') {
    if (value.relationLabel !== null || value.direction !== null) fail();
    return Object.freeze({
      outcome: 'no_relation',
      summary: boundedText(value.summary, 240),
    });
  }
  if (
    value.outcome !== 'relation' ||
    typeof value.direction !== 'string' ||
    !DIRECTIONS.includes(value.direction as (typeof DIRECTIONS)[number])
  )
    fail();
  return Object.freeze({
    summary: boundedText(value.summary, 240),
    relationLabel: boundedText(value.relationLabel, 80),
    direction: value.direction as (typeof DIRECTIONS)[number],
  });
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
  throw new AiAssociationProposalProviderError('ai_provider_invalid_response');
}
