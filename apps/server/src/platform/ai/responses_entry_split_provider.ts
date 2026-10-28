import {sourceProcessingInstructions} from '../../application/source_processing_scope.js';
import {documentProcessingInstructions} from '../../modules/processing/document_processing_standard.js';
import {splitSourceTitle} from './split_source_title.js';
import {parseResponseJson} from './response_json.js';
import {isPublicationOnly} from '../../modules/processing/publication_context.js';
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

export const OPENAI_SPLIT_PROMPT_VERSION = 'struinfo.openai-entry-split.v16';
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
      payload = parseResponseJson(outputText);
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
  const publicationOnlyOrdinals = sections
    .filter((s) => isPublicationOnly(s.text))
    .map((s) => s.ordinal);
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
      documentProcessingInstructions('split'),
      sourceProcessingInstructions('split'),
      'Return a single JSON object without Markdown fences, commentary or schema-definition fields. Encode documentMode whole or independent_entries. Every group has exactly titlePath, startOrdinal, role and context. Return only the first ordinal of each group in strictly increasing order, starting with 0; do not emit endOrdinal. The application derives each end as the next start minus one, and the final end as the last source ordinal, so every section remains covered.',
      'Classify each span role before deciding independence: content means a substantive reading contribution; framing means a preface, cover, table of contents, sponsor or purchase invitation, recurring author catalogue, archive navigation, credits or subscription footer supporting the publication. Use framing even when it has a descriptive title. The application attaches framing to adjacent content and never creates a standalone Entry from it. Do not label a substantive product review, technical explanation or curated reference directory framing merely because it contains links or a brand. A mixed span containing substantive explanation remains content; do not discard its evidence.',
      'Mark each group context self, previous or next; the application merges adjacent dependencies. With a whole document return one group starting at 0. In an independent collection, separate self-contained linked stories or tools even if they share a category heading. For example, three unrelated source-linked recommendations in packets 1, 2 and 3 need separate starts, not one broad Tools group. linkedItemStarts, when present, identifies source-linked numbered packets, not proof that numbered steps in a tutorial are independent.',
      RESPONSE_METADATA_INSTRUCTIONS,
    ].join(' '),
    input: JSON.stringify({
      sections,
      ...numberedCollectionHints(sections),
      ...linkedCollectionHints(sections),
      ...(publicationOnlyOrdinals.length > 0 ? {publicationOnlyOrdinals} : {}),
    }),
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
              // Framing spans do not consume the final 64-Entry allowance.
              maxItems: sections.length,
              items: {
                type: 'object',
                additionalProperties: false,
                required: ['titlePath', 'startOrdinal', 'role', 'context'],
                properties: {
                  titlePath: {type: 'string', minLength: 1, maxLength: 200},
                  startOrdinal: {
                    type: 'integer',
                    minimum: 0,
                    maximum: sections.length - 1,
                  },
                  context: {type: 'string', enum: ['self', 'previous', 'next']},
                  role: {type: 'string', enum: ['content', 'framing']},
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
    value.groups.length > sectionCount
  )
    fail();
  const boundaries = value.groups.map((candidate) => {
    if (
      !isClosedRecord(candidate, [
        'titlePath',
        'startOrdinal',
        'role',
        'context',
      ]) ||
      !['content', 'framing'].includes(String(candidate.role)) ||
      !['self', 'previous', 'next'].includes(String(candidate.context)) ||
      typeof candidate.startOrdinal !== 'number' ||
      !Number.isSafeInteger(candidate.startOrdinal) ||
      candidate.startOrdinal < 0 ||
      candidate.startOrdinal >= sectionCount
    )
      fail();
    return Object.freeze({
      titlePath: boundedText(candidate.titlePath, 200),
      context: candidate.context as 'self' | 'previous' | 'next',
      role: candidate.role as 'content' | 'framing',
      startOrdinal: candidate.startOrdinal,
    });
  });
  if (
    boundaries.some(
      (group, index) =>
        index > 0 &&
        group.startOrdinal <= (boundaries[index - 1]?.startOrdinal ?? -1),
    )
  )
    fail();
  const initial = boundaries[0];
  if (!initial) fail();
  if (initial.startOrdinal !== 0) {
    // Only a verifiable title-only prefix may be attached. Missing prose is an
    // invalid response, even if it looks like a plausible editorial preface.
    if (
      !sections.slice(0, initial.startOrdinal).every((s) => headingOnly(s.text))
    )
      fail();
    boundaries[0] = {...initial, startOrdinal: 0};
  }
  // Model selects cuts, not two competing endpoints. Derivation preserves every
  // source ordinal exactly once, including a final appendix or continuation.
  const groups = boundaries.map((boundary, index) => ({
    ...boundary,
    endOrdinal: (boundaries[index + 1]?.startOrdinal ?? sectionCount) - 1,
  }));
  // Do not trust “self” for explicitly named framing material. Its evidence is
  // retained in the adjacent item, even when the collection is not numbered.
  if (groups.length > 1) {
    groups.forEach((group, index) => {
      const text = sections
        .slice(group.startOrdinal, group.endOrdinal + 1)
        .map((section) => section.text)
        .join('\n')
        .trim();
      if (isPublicationOnly(text)) {
        groups[index] = {
          ...group,
          role: 'framing',
          context: index === 0 ? 'next' : 'previous',
        };
        return;
      }
      if (headingOnly(text)) {
        groups[index] = {
          ...group,
          role: 'framing',
          context: index === groups.length - 1 ? 'previous' : 'next',
        };
      }
    });
    const opening = groups[0];
    if (
      opening &&
      /^(?:前言(?:与说明)?|引言|导言|作者介绍|编者按|preface|introduction|editorial introduction)$/iu.test(
        opening.titlePath.trim(),
      )
    )
      groups[0] = {...opening, role: 'framing', context: 'next'};
    const closing = groups.at(-1);
    if (
      closing &&
      /^(?:订阅(?:与原始条目链接)?|订阅与来源链接|订阅信息|尾注|参考文献|参考资料|bibliography|references|subscribe|subscription(?: and source links?)?)$/iu.test(
        closing.titlePath.trim(),
      )
    )
      groups[groups.length - 1] = {
        ...closing,
        role: 'framing',
        context: 'previous',
      };
  }
  if (!groups.some((group) => group.role === 'content')) fail();
  // Attach an entire ancillary run to one neighbour. Mixed previous/next
  // directions must not form a bridge that collapses two unrelated stories.
  for (let index = 0; index < groups.length; index++) {
    const opening = groups[index];
    if (opening?.role !== 'framing') continue;
    let end = index + 1;
    while (groups[end]?.role === 'framing') end++;
    const context =
      index === 0 || (end < groups.length && opening.context === 'next')
        ? 'next'
        : 'previous';
    for (let i = index; i < end; i++) {
      const group = groups[i];
      if (group) groups[i] = {...group, context};
    }
    index = end - 1;
  }
  const firstGroup = groups[0];
  if (!firstGroup) fail();
  const explanation = boundedText(value.summary, 240);
  if (value.documentMode === 'whole') {
    const sourceTitle = sections[0]?.text
      .trimStart()
      .match(/^#{1,6}\s+([^\n]+)/u)?.[1];
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
          : groups[index - 1]?.context === 'next' && group.role === 'content'
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
  if (merged.length > MAXIMUM_AI_SPLIT_ENTRIES) fail();
  const framingOrdinals = new Set(
    groups
      .filter((group) => group.role === 'framing')
      .flatMap((group) =>
        Array.from(
          {length: group.endOrdinal - group.startOrdinal + 1},
          (_, offset) => group.startOrdinal + offset,
        ),
      ),
  );
  return Object.freeze({
    summary: decisionSummary(
      `独立合集：${merged.length.toString()} 条；相邻上下文合并 ${(groups.length - merged.length).toString()} 处` +
        (numberedMerges
          ? `；编号边界归组 ${numberedMerges.toString()} 处`
          : ''),
      explanation,
    ),
    groups: Object.freeze(
      merged.map((group) =>
        Object.freeze({
          ...group,
          titlePath: splitSourceTitle(sections, group, framingOrdinals),
        }),
      ),
    ),
  });
}

function decisionSummary(decision: string, explanation: string): string {
  return Array.from(`${decision}。${explanation}`).slice(0, 240).join('');
}

function headingOnly(text: string): boolean {
  const lines = text.split('\n').filter((line) => line.trim());
  return (
    lines.length > 0 && lines.every((line) => /^\s*#{1,6}\s+\S/u.test(line))
  );
}

/** Only suggest source boundaries; numbering alone does not establish independence. */
function numberedCollectionHints(sections: readonly AiSplitProposalSection[]) {
  const byDepth = new Map<number, {number: number; ordinal: number}[]>();
  for (const section of sections) {
    const heading = /^(#{1,6})\s+(?:\*\*)?(\d{1,2})[.、．）)]\s*\S/u.exec(
      section.text.trimStart(),
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
      const heading = /^(#{1,6})\s+/u.exec(section.text.trimStart())?.[1];
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

/** A source hint only: a linked list may still be one context-dependent article. */
function linkedCollectionHints(sections: readonly AiSplitProposalSection[]) {
  const linkedItemStarts = sections
    .filter((section) =>
      /^\d{1,2}[.、．）)][ \t]*\[[^\]\n]+\]\(https?:\/\/[^\s)]+\)/u.test(
        section.text.trimStart(),
      ),
    )
    .map((section) => section.ordinal);
  return linkedItemStarts.length >= 2 ? {linkedItemStarts} : {};
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
