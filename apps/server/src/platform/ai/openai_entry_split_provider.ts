import type {AiProposalProviderConfig} from '../../config/runtime_config.js';
import {
  AiSplitProposalProviderError,
  type AiSplitProposalProviderPort,
  type AiSplitProposalProviderResult,
  type AiSplitProposalSection,
} from '../../modules/processing/index.js';
import {
  OPENAI_RESPONSES_ENDPOINT,
  type OpenAiFetch,
} from './openai_entry_tag_provider.js';

export const OPENAI_SPLIT_PROMPT_VERSION = 'struinfo.openai-entry-split.v1';
const MAXIMUM_RESPONSE_BYTES = 1024 * 1024;

export class OpenAiEntrySplitProvider implements AiSplitProposalProviderPort {
  public readonly providerKey = 'openai-responses-v1' as const;
  public readonly promptVersion = OPENAI_SPLIT_PROMPT_VERSION;
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
  }
  public async proposeSplit(
    sections: readonly Readonly<AiSplitProposalSection>[],
  ): Promise<Readonly<AiSplitProposalProviderResult>> {
    if (sections.length < 1 || sections.length > 64) fail();
    let response: Response;
    try {
      response = await this.#fetch(OPENAI_RESPONSES_ENDPOINT, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.#config.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(createRequest(this.#config, sections)),
        signal: AbortSignal.timeout(this.#config.timeoutMs),
      });
    } catch (error) {
      const name = error instanceof Error ? error.name : '';
      throw new AiSplitProposalProviderError(
        name === 'AbortError' || name === 'TimeoutError'
          ? 'ai_provider_timeout'
          : 'ai_provider_unavailable',
      );
    }
    if (!response.ok)
      throw new AiSplitProposalProviderError('ai_provider_rejected');
    const length = Number(response.headers.get('content-length') ?? '0');
    if (Number.isFinite(length) && length > MAXIMUM_RESPONSE_BYTES) fail();
    let source: string;
    try {
      source = await response.text();
    } catch {
      throw new AiSplitProposalProviderError('ai_provider_unavailable');
    }
    if (new TextEncoder().encode(source).byteLength > MAXIMUM_RESPONSE_BYTES)
      fail();
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
    return decodePayload(payload, sections.length);
  }
}

function createRequest(
  config: Readonly<AiProposalProviderConfig>,
  sections: readonly Readonly<AiSplitProposalSection>[],
): Readonly<Record<string, unknown>> {
  return Object.freeze({
    model: config.model,
    store: false,
    max_output_tokens: config.maxOutputTokens,
    instructions: [
      'Group the ordered public document sections into useful InformationEntries.',
      'Every section ordinal must appear exactly once, in its original order.',
      'Groups must be contiguous and cover ordinal 0 through the final ordinal.',
      'Do not rewrite, summarize, omit, duplicate, or reorder source text.',
      'Return concise entry titles and only the requested JSON schema.',
    ].join(' '),
    input: JSON.stringify({sections}),
    text: {
      format: {
        type: 'json_schema',
        name: 'struinfo_entry_split_proposal',
        strict: true,
        schema: {
          type: 'object',
          additionalProperties: false,
          required: ['summary', 'groups'],
          properties: {
            summary: {type: 'string', minLength: 1, maxLength: 240},
            groups: {
              type: 'array',
              minItems: 1,
              maxItems: 64,
              items: {
                type: 'object',
                additionalProperties: false,
                required: ['titlePath', 'startOrdinal', 'endOrdinal'],
                properties: {
                  titlePath: {type: 'string', minLength: 1, maxLength: 200},
                  startOrdinal: {type: 'integer', minimum: 0, maximum: 63},
                  endOrdinal: {type: 'integer', minimum: 0, maximum: 63},
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
  )
    fail();
  const texts: string[] = [];
  for (const item of value.output) {
    if (
      !isRecord(item) ||
      item.type !== 'message' ||
      !Array.isArray(item.content)
    )
      continue;
    for (const content of item.content) {
      if (
        isRecord(content) &&
        content.type === 'output_text' &&
        typeof content.text === 'string'
      )
        texts.push(content.text);
    }
  }
  if (texts.length !== 1 || texts[0] === undefined) fail();
  return texts[0];
}
function decodePayload(
  value: unknown,
  sectionCount: number,
): Readonly<AiSplitProposalProviderResult> {
  if (
    !isClosedRecord(value, ['summary', 'groups']) ||
    !Array.isArray(value.groups) ||
    value.groups.length < 1 ||
    value.groups.length > Math.min(64, sectionCount)
  )
    fail();
  const groups = value.groups.map((candidate) => {
    if (
      !isClosedRecord(candidate, ['titlePath', 'startOrdinal', 'endOrdinal']) ||
      typeof candidate.startOrdinal !== 'number' ||
      !Number.isSafeInteger(candidate.startOrdinal) ||
      typeof candidate.endOrdinal !== 'number' ||
      !Number.isSafeInteger(candidate.endOrdinal) ||
      candidate.startOrdinal < 0 ||
      candidate.endOrdinal < candidate.startOrdinal ||
      candidate.endOrdinal >= sectionCount
    )
      fail();
    return Object.freeze({
      titlePath: boundedText(candidate.titlePath, 200),
      startOrdinal: candidate.startOrdinal,
      endOrdinal: candidate.endOrdinal,
    });
  });
  if (
    groups[0]?.startOrdinal !== 0 ||
    groups.some(
      (group, index) =>
        index > 0 &&
        group.startOrdinal !== (groups[index - 1]?.endOrdinal ?? -2) + 1,
    ) ||
    groups.at(-1)?.endOrdinal !== sectionCount - 1
  )
    fail();
  return Object.freeze({
    summary: boundedText(value.summary, 240),
    groups: Object.freeze(groups),
  });
}
function boundedText(value: unknown, maximum: number): string {
  if (typeof value !== 'string') fail();
  const normalized = value.trim().normalize('NFC');
  if (
    normalized.length === 0 ||
    Array.from(normalized).length > maximum ||
    Array.from(normalized).some((character) => {
      const code = character.codePointAt(0);
      return code !== undefined && (code <= 0x1f || code === 0x7f);
    })
  )
    fail();
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
  throw new AiSplitProposalProviderError('ai_provider_invalid_response');
}
