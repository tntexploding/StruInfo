import {documentModelInputLimit} from './document_model_capacity.js';
import {isAiDispatchWait} from '../../modules/processing/ai_price_policy.js';
import {
  responsesEndpoint,
  responsesOptions,
  responsesPromptVersion,
} from './responses_configuration.js';
import type {AiProposalProviderConfig} from '../../config/runtime_config.js';
import {
  MAXIMUM_AI_SPLIT_ENTRIES,
  MAXIMUM_AI_SPLIT_FRAGMENTS,
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

export const OPENAI_SPLIT_PROMPT_VERSION = 'struinfo.openai-entry-split.v6';
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
    if (sections.length < 1 || sections.length > MAXIMUM_AI_SPLIT_FRAGMENTS)
      fail();
    if (
      Array.from(JSON.stringify(sections)).length >
      documentModelInputLimit(this.#config)
    )
      throw new AiSplitProposalProviderError('ai_split_input_unsupported');
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
      if (isAiDispatchWait(error)) throw error;
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
    // Large collections need room for grouping metadata; other AI operations keep their budgets.
    max_output_tokens: Math.max(
      config.maxOutputTokens,
      Math.min(
        8192,
        256 + 128 * Math.min(sections.length, MAXIMUM_AI_SPLIT_ENTRIES),
      ),
    ),
    instructions: [
      'Choose the appropriate reading unit for the complete public document.',
      'Default documentMode to whole for a coherent article, news story, essay, case study, tutorial, paper or report.',
      'Use independent_entries only when the source is already a collection of separate, independently understandable items, such as a digest or unrelated resource list.',
      'Paragraphs, headings, changes of subtopic and model context limits do not justify separate Entries.',
      'Input sections are technical reading packets, not proposed Entries. A packet can include a full chapter, table or the complete article. Never invent finer ordinals inside a packet. With one packet, return one group with both ordinals 0.',
      'Reference lists and bibliography belong to their article; never split them into independent knowledge entries.',
      'Never isolate author introductions, captions, narrative steps or conclusions. Attach a collection preface to its first item.',
      'A standalone Entry must identify its subject and preserve the context of pronouns, examples, comparisons and conclusions without its siblings.',
      'Decide the genre of the complete document first. A numbered news digest remains a collection even when all news shares a broad industry or date. Short but complete news briefs are independent items, not incomplete paragraphs.',
      'numberedItemStarts are structural candidate boundaries, not a command to split: tutorial steps, arguments and sections of one coherent report must remain together.',
      'For a collection, group each headline with ALL of its following body paragraphs, captions and source links up to the next independent item. A title-only block is not a separate item.',
      'Attach opening editorial context to the first item and closing credits or return links to the last item. A preface or footer must not turn an otherwise independent collection into whole.',
      'Prefer already self-contained groups. If a remaining group needs its adjacent context, set context to previous or next as appropriate; self means no dependency. Merge locally, not across unrelated news. A first group cannot depend on previous and a last group cannot depend on next.',
      'Choose whole for a coherent document or if its overall genre cannot be determined; do not choose whole just because one group needs its neighbour.',
      'Explain the genre and the grouping reason briefly in Chinese in summary, rather than summarizing the news.',
      'Every section ordinal must appear exactly once, in its original order.',
      'Groups must be contiguous and cover ordinal 0 through the final ordinal.',
      'Do not rewrite, summarize, omit, duplicate, or reorder source text.',
      'Return concise entry titles and only the requested JSON schema.',
      RESPONSE_METADATA_INSTRUCTIONS,
    ].join(' '),
    input: JSON.stringify({sections, ...numberedCollectionHints(sections)}),
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
              maxItems: Math.min(MAXIMUM_AI_SPLIT_ENTRIES, sections.length),
              items: {
                type: 'object',
                additionalProperties: false,
                required: [
                  'titlePath',
                  'startOrdinal',
                  'endOrdinal',
                  'context',
                ],
                properties: {
                  titlePath: {type: 'string', minLength: 1, maxLength: 200},
                  startOrdinal: {
                    type: 'integer',
                    minimum: 0,
                    maximum: MAXIMUM_AI_SPLIT_FRAGMENTS - 1,
                  },
                  endOrdinal: {
                    type: 'integer',
                    minimum: 0,
                    maximum: MAXIMUM_AI_SPLIT_FRAGMENTS - 1,
                  },
                  context: {type: 'string', enum: ['self', 'previous', 'next']},
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
    value.groups.length > Math.min(MAXIMUM_AI_SPLIT_ENTRIES, sectionCount)
  )
    fail();
  const groups = value.groups.map((candidate) => {
    if (
      !isClosedRecord(candidate, [
        'titlePath',
        'startOrdinal',
        'endOrdinal',
        'context',
      ]) ||
      !['self', 'previous', 'next'].includes(String(candidate.context)) ||
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
      context: candidate.context as 'self' | 'previous' | 'next',
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
  // Do not trust “self” for explicitly named framing material. Its evidence is
  // retained in the adjacent item, even when the collection is not numbered.
  if (groups.length > 1) {
    const opening = groups[0];
    if (
      /^(?:前言(?:与说明)?|引言|导言|作者介绍|编者按|preface|introduction|editorial introduction)$/iu.test(
        opening.titlePath.trim(),
      )
    )
      groups[0] = {...opening, context: 'next'};
    const closing = groups.at(-1);
    if (
      closing &&
      /^(?:订阅(?:与原始条目链接)?|订阅与来源链接|订阅信息|尾注|参考文献|参考资料|bibliography|references|subscribe|subscription(?: and source links?)?)$/iu.test(
        closing.titlePath.trim(),
      )
    )
      groups[groups.length - 1] = {...closing, context: 'previous'};
  }
  const firstGroup = groups[0];
  const explanation = boundedText(value.summary, 240);
  if (value.documentMode === 'whole') {
    const sourceTitle = sections[0]?.text.match(/^#{1,6}\s+([^\n]+)/u)?.[1];
    return Object.freeze({
      summary: decisionSummary('整篇保留（模型选择）', explanation),
      groups: Object.freeze([
        Object.freeze({
          titlePath: responseMetadata(sourceTitle, 200) ?? firstGroup.titlePath,
          startOrdinal: 0,
          endOrdinal: sectionCount - 1,
        }),
      ]),
    });
  }
  if (firstGroup.context === 'previous' || groups.at(-1)?.context === 'next')
    fail();
  const numberedStarts = numberedCollectionHints(sections).numberedItemStarts;
  const numberedBoundaries = new Set(numberedStarts?.slice(1));
  let numberedMerges = 0;
  const merged: {
    titlePath: string;
    startOrdinal: number;
    endOrdinal: number;
  }[] = [];
  groups.forEach((group, index) => {
    const previous = merged.at(-1);
    // After the model identifies an independent numbered collection, a preface,
    // body continuation or footer is not another news item, even if called self.
    const withinNumberedItem =
      numberedStarts !== undefined &&
      !numberedBoundaries.has(group.startOrdinal);
    if (
      previous &&
      (withinNumberedItem ||
        group.context === 'previous' ||
        groups[index - 1]?.context === 'next')
    ) {
      if (withinNumberedItem) numberedMerges++;
      previous.endOrdinal = group.endOrdinal;
      // An opening preface takes the first actual item's title, not its own heading.
      if (
        numberedStarts
          ? group.startOrdinal === numberedStarts[0] &&
            previous.startOrdinal < group.startOrdinal
          : groups[index - 1]?.context === 'next'
      )
        previous.titlePath = group.titlePath;
    } else {
      merged.push({
        titlePath: group.titlePath,
        startOrdinal: group.startOrdinal,
        endOrdinal: group.endOrdinal,
      });
    }
  });
  return Object.freeze({
    summary: decisionSummary(
      `独立合集：${merged.length.toString()} 条；相邻上下文合并 ${(groups.length - merged.length).toString()} 处` +
        (numberedMerges
          ? `；编号边界归组 ${numberedMerges.toString()} 处`
          : ''),
      explanation,
    ),
    groups: Object.freeze(merged.map((group) => Object.freeze(group))),
  });
}

function decisionSummary(decision: string, explanation: string): string {
  return Array.from(`${decision}。${explanation}`).slice(0, 240).join('');
}

/** Only suggest source boundaries; numbering alone does not establish independence. */
function numberedCollectionHints(sections: readonly AiSplitProposalSection[]) {
  const byDepth = new Map<number, {number: number; ordinal: number}[]>();
  for (const section of sections) {
    const heading = /^(#{1,6})\s+(?:\*\*)?(\d{1,2})[.、．）)]\s*\S/u.exec(
      section.text,
    );
    const [, marker, number] = heading ?? [];
    if (!marker || !number) continue;
    const depth = marker.length;
    const items = byDepth.get(depth) ?? [];
    items.push({number: Number(number), ordinal: section.ordinal});
    byDepth.set(depth, items);
  }
  const sequence = [...byDepth.entries()].find(([depth, items]) => {
    if (
      items.length < 3 ||
      !items.every((item, index) => item.number === index + 1)
    )
      return false;
    const numberedOrdinals = new Set(items.map((item) => item.ordinal));
    // A numbered subsection inside one item must not absorb other, unnumbered
    // stories. Allow the document title, but require a uniform item-heading level.
    return sections.every((section, index) => {
      const heading = /^(#{1,6})\s+/u.exec(section.text)?.[1];
      return (
        index === 0 ||
        !heading ||
        heading.length > depth ||
        numberedOrdinals.has(section.ordinal)
      );
    });
  })?.[1];
  return sequence
    ? {numberedItemStarts: sequence.map((item) => item.ordinal)}
    : {};
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
