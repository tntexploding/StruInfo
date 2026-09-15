import {isAiPriceWait} from '../../modules/processing/ai_price_policy.js';
import {
  responsesEndpoint,
  responsesOptions,
  responsesPromptVersion,
} from './responses_configuration.js';
import type {AiProposalProviderConfig} from '../../config/runtime_config.js';
import {
  AiSplitProposalProviderError,
  type AiSplitProposalProviderPort,
  type AiSplitProposalProviderResult,
  type AiSplitProposalSection,
} from '../../modules/processing/index.js';
import {type OpenAiFetch} from './responses_entry_tag_provider.js';
import {
  responseMetadata,
  RESPONSE_METADATA_INSTRUCTIONS,
} from './responses_metadata.js';

export const OPENAI_SPLIT_PROMPT_VERSION = 'struinfo.openai-entry-split.v2';
const MAXIMUM_RESPONSE_BYTES = 1024 * 1024;

export class ResponsesEntrySplitProvider implements AiSplitProposalProviderPort {
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
      OPENAI_SPLIT_PROMPT_VERSION,
    );
  }
  public async proposeSplit(
    sections: readonly Readonly<AiSplitProposalSection>[],
  ): Promise<Readonly<AiSplitProposalProviderResult>> {
    if (sections.length < 1 || sections.length > 64) fail();
    let response: Response;
    try {
      response = await this.#fetch(responsesEndpoint(this.#config), {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.#config.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(createRequest(this.#config, sections)),
        signal: AbortSignal.timeout(this.#config.timeoutMs),
      });
    } catch (error) {
      if (isAiPriceWait(error)) throw error;
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
    return decodePayload(payload, sections);
  }
}

function createRequest(
  config: Readonly<AiProposalProviderConfig>,
  sections: readonly Readonly<AiSplitProposalSection>[],
): Readonly<Record<string, unknown>> {
  return Object.freeze({
    model: config.model,
    ...responsesOptions(config),
    store: false,
    max_output_tokens: config.maxOutputTokens,
    instructions: [
      'Choose the appropriate reading unit for the complete public document.',
      'Default documentMode to whole for a coherent article, news story, essay, case study, tutorial, paper or report.',
      'Use independent_entries only when the source is already a collection of separate, independently understandable items, such as a digest or unrelated resource list.',
      'Paragraphs, headings, changes of subtopic and model context limits do not justify separate Entries.',
      'Never isolate author introductions, captions, narrative steps or conclusions. Attach a collection preface to its first item.',
      'A standalone Entry must identify its subject and preserve the context of pronouns, examples, comparisons and conclusions without its siblings.',
      'If uncertain, choose whole. Whole means one group containing every section; it is a successful result.',
      'Every section ordinal must appear exactly once, in its original order.',
      'Groups must be contiguous and cover ordinal 0 through the final ordinal.',
      'Do not rewrite, summarize, omit, duplicate, or reorder source text.',
      'Return concise entry titles and only the requested JSON schema.',
      RESPONSE_METADATA_INSTRUCTIONS,
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
          required: ['summary', 'documentMode', 'groups'],
          properties: {
            summary: {type: 'string', minLength: 1, maxLength: 240},
            documentMode: {
              type: 'string',
              enum: ['whole', 'independent_entries'],
            },
            groups: {
              type: 'array',
              minItems: 1,
              maxItems: 64,
              items: {
                type: 'object',
                additionalProperties: false,
                required: [
                  'titlePath',
                  'startOrdinal',
                  'endOrdinal',
                  'selfContained',
                ],
                properties: {
                  titlePath: {type: 'string', minLength: 1, maxLength: 200},
                  startOrdinal: {type: 'integer', minimum: 0, maximum: 63},
                  endOrdinal: {type: 'integer', minimum: 0, maximum: 63},
                  selfContained: {type: 'boolean'},
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
  sections: readonly Readonly<AiSplitProposalSection>[],
): Readonly<AiSplitProposalProviderResult> {
  const sectionCount = sections.length;
  if (
    !isClosedRecord(value, ['summary', 'documentMode', 'groups']) ||
    !['whole', 'independent_entries'].includes(String(value.documentMode)) ||
    !Array.isArray(value.groups) ||
    value.groups.length < 1 ||
    value.groups.length > Math.min(64, sectionCount)
  )
    fail();
  const groups = value.groups.map((candidate) => {
    if (
      !isClosedRecord(candidate, [
        'titlePath',
        'startOrdinal',
        'endOrdinal',
        'selfContained',
      ]) ||
      typeof candidate.selfContained !== 'boolean' ||
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
  // Source coverage is necessary but does not make narrative chunks independent.
  // A doubtful proposal retains the complete document.
  if (
    value.documentMode === 'whole' ||
    value.groups.some(
      (group) => isRecord(group) && group.selfContained === false,
    )
  ) {
    const sourceTitle = sections[0]?.text.match(/^#{1,6}\s+([^\n]+)/u)?.[1];
    const firstGroup = groups[0];
    return Object.freeze({
      summary: boundedText(value.summary, 240),
      groups: Object.freeze([
        Object.freeze({
          titlePath: responseMetadata(sourceTitle, 200) ?? firstGroup.titlePath,
          startOrdinal: 0,
          endOrdinal: sectionCount - 1,
        }),
      ]),
    });
  }
  return Object.freeze({
    summary: boundedText(value.summary, 240),
    groups: Object.freeze(groups),
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
  throw new AiSplitProposalProviderError('ai_provider_invalid_response');
}
