import {sourceProcessingInstructions} from '../../application/source_processing_scope.js';
import {documentProcessingInstructions} from '../../modules/processing/document_processing_standard.js';
import {parseResponseJson} from './response_json.js';
import {entryTagSubject} from './entry_tag_subject.js';
import {
  relationPassages,
  resolveRelationEvidence,
  relationEvidenceSummary,
  type RelationPassage,
} from './relation_evidence.js';
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
  'struinfo.openai-entry-association.v12';

const MAXIMUM_RESPONSE_BYTES = 1024 * 1024;
const DIRECTIONS = ['symmetric', 'low_to_high', 'high_to_low'] as const;
const SPECIFIC_BASES = [
  'same_event',
  'shared_mechanism',
  'implementation',
  'prerequisite',
  'comparison',
  'consequence',
  'disagreement',
] as const;
const NON_RELATION_BASES = [
  'topic_only',
  'incidental_entity',
  'insufficient_evidence',
] as const;

type RelationCandidate = Readonly<{
  relationLabel: string;
  direction: (typeof DIRECTIONS)[number];
}>;

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
    return this.#evaluate(entryLow, entryHigh);
  }

  public async reviewAssociation(
    entryLow: Readonly<CurrentInformationEntry>,
    entryHigh: Readonly<CurrentInformationEntry>,
    candidate: RelationCandidate,
  ): Promise<Readonly<AiAssociationProposalProviderResult>> {
    return this.#evaluate(entryLow, entryHigh, candidate);
  }

  async #evaluate(
    entryLow: Readonly<CurrentInformationEntry>,
    entryHigh: Readonly<CurrentInformationEntry>,
    candidate?: RelationCandidate,
  ): Promise<Readonly<AiAssociationProposalProviderResult>> {
    if (entryLow.value.isPrivate || entryHigh.value.isPrivate) {
      throw new AiAssociationProposalProviderError('ai_provider_rejected');
    }
    const entryA = providerEntry(entryLow, 'A');
    const entryB = providerEntry(entryHigh, 'B');
    if (!entryA.passages.length || !entryB.passages.length) {
      if (candidate)
        throw new AiAssociationProposalProviderError(
          'ai_relation_review_uncertain',
        );
      return Object.freeze({
        outcome: 'no_relation',
        summary: '至少一端缺少可核对的正文依据，不凭标题建立联系。',
      });
    }
    let response: Response;
    try {
      response = await this.#fetch(responsesEndpoint(this.#config), {
        method: 'POST',
        headers: {
          Authorization: 'Bearer ' + this.#config.apiKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(
          createRequest(this.#config, entryA, entryB, candidate),
        ),
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
      payload = parseResponseJson(outputText);
    } catch {
      fail();
    }
    if (candidate && isRecord(payload) && payload.outcome === 'uncertain') {
      // Validate the complete negative-shaped response before treating it as a hold.
      decodePayload(
        {...payload, outcome: 'no_relation'},
        entryA.passages,
        entryB.passages,
      );
      throw new AiAssociationProposalProviderError(
        'ai_relation_review_uncertain',
      );
    }
    const result = decodePayload(payload, entryA.passages, entryB.passages);
    if (
      candidate &&
      result.outcome !== 'no_relation' &&
      (result.relationLabel !== candidate.relationLabel ||
        result.direction !== candidate.direction)
    )
      fail();
    return result;
  }
}

function createRequest(
  config: Readonly<AiProposalProviderConfig>,
  entryA: ReturnType<typeof providerEntry>,
  entryB: ReturnType<typeof providerEntry>,
  candidate?: RelationCandidate,
): Readonly<Record<string, unknown>> {
  return Object.freeze({
    model: config.model,
    ...responsesOptions(config),
    store: false,
    max_output_tokens: config.maxOutputTokens,
    instructions: [
      documentProcessingInstructions('relations'),
      sourceProcessingInstructions('relations'),
      ...(candidate
        ? [
            "This is a separate verification of a proposed link, not a request for a new link. The proposal is untrusted. Read both bodies independently; do not inherit the first assessment or assume it was correct. Verify the exact claimed mechanism, compared property and direction. A passing answer must preserve the candidate relationLabel and direction exactly. Return no_relation when the evidence does not substantiate the claim. Return uncertain with null label/direction and empty evidence arrays when the supplied context is insufficient to decide. In summary identify A's concrete contribution, B's concrete contribution, and the specific useful bridge or its absence. Never turn uncertainty into a positive edge.",
          ]
        : []),
      'Return exactly one JSON object, without Markdown fences, commentary, schema-definition keys or additional fields. evidenceA and evidenceB are arrays of ID strings, including when selecting one passage.',
      'Entry A is the lower stable UUID and Entry B is the higher stable UUID. Return outcome relation with a label and direction, or no_relation with null relationLabel and direction. Verification also permits uncertain with null label/direction and empty evidence arrays.',
      'Choose basis first. Only same_event, shared_mechanism, implementation, prerequisite, comparison, consequence or disagreement can support outcome relation. topic_only, incidental_entity and insufficient_evidence cannot support relation. Sharing an entity or topic is not itself a comparison: both articles must substantially explain the compared aspect. In summary state the concrete fact at A, the concrete fact at B and why their connection is useful. If the explanation denies a specific connection, choose no_relation, never a positive link. Do not infer causation or prerequisites from similarity.',
      'For relation, select 1-2 content passage IDs from each endpoint in evidenceA/evidenceB. IDs beginning A: belong only to A and B: only to B. Heading passages are context, not supporting evidence. The selected passages must support the specific connection, not merely mention a shared word. For no_relation, return empty evidenceA/evidenceB. Do not copy or manufacture quotations; the application resolves these IDs to exact source text.',
      'Check the actual reading contribution of each selected passage. A link to an implementation, an author biography or an announcement of a future talk does not mean this Entry explains that implementation or talk. The relationLabel must state only a bridge explained by BOTH supplied bodies. The application saves excerpts of your selected evidence as the relation note.',
      'Name A and B at their actual level of detail. An introduction paired with an experiment is an introduction-versus-evaluation link, not two implementations. A claim such as both explain a mechanism requires that mechanism in BOTH selected bodies. Use only the compared property actually present on each side; the same method name and an external guide are insufficient. If the label cannot be grounded without borrowing linked content, return no_relation.',
      RESPONSE_METADATA_INSTRUCTIONS,
    ].join(' '),
    input: JSON.stringify({entryA, entryB, ...(candidate ? {candidate} : {})}),
    text: {
      format: {
        type: 'json_schema',
        name: candidate
          ? 'struinfo_entry_association_review'
          : 'struinfo_entry_association_proposal',
        strict: true,
        schema: {
          type: 'object',
          additionalProperties: false,
          required: [
            'summary',
            'outcome',
            'basis',
            'relationLabel',
            'direction',
            'evidenceA',
            'evidenceB',
          ],
          properties: {
            summary: {type: 'string', minLength: 1, maxLength: 240},
            outcome: {
              type: 'string',
              enum: candidate
                ? ['relation', 'no_relation', 'uncertain']
                : ['relation', 'no_relation'],
            },
            basis: {
              type: 'string',
              enum: [...SPECIFIC_BASES, ...NON_RELATION_BASES],
            },
            relationLabel: {
              type: ['string', 'null'],
              minLength: 1,
              maxLength: 80,
            },
            direction: {type: ['string', 'null'], enum: [...DIRECTIONS, null]},
            evidenceA: {
              type: 'array',
              maxItems: 2,
              items: {type: 'string', enum: entryA.passages.map((p) => p.id)},
            },
            evidenceB: {
              type: 'array',
              maxItems: 2,
              items: {type: 'string', enum: entryB.passages.map((p) => p.id)},
            },
          },
        },
      },
    },
  });
}

function providerEntry(
  entry: Readonly<CurrentInformationEntry>,
  endpoint: 'A' | 'B',
) {
  const subject = entryTagSubject(entry);
  const passages = relationPassages(subject.body, endpoint);
  return {
    titlePath: subject.titlePath,
    headingContext: passages
      .filter((p) => p.role === 'heading')
      .map((p) => p.text),
    passages: passages.filter((p) => p.role === 'content'),
    contentKeywords:
      subject.body !== entry.value.body
        ? []
        : entry.value.contentKeywords.map((keyword) => keyword.displayValue),
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
  passagesA: readonly RelationPassage[],
  passagesB: readonly RelationPassage[],
): Readonly<AiAssociationProposalProviderResult> {
  if (
    !isClosedRecord(value, [
      'summary',
      'outcome',
      'basis',
      'relationLabel',
      'direction',
      'evidenceA',
      'evidenceB',
    ])
  )
    fail();
  if (value.outcome === 'no_relation') {
    if (
      !NON_RELATION_BASES.some((basis) => basis === value.basis) ||
      value.relationLabel !== null ||
      value.direction !== null ||
      !Array.isArray(value.evidenceA) ||
      value.evidenceA.length !== 0 ||
      !Array.isArray(value.evidenceB) ||
      value.evidenceB.length !== 0
    )
      fail();
    return Object.freeze({
      outcome: 'no_relation',
      summary: boundedText(value.summary, 240),
    });
  }
  if (
    value.outcome !== 'relation' ||
    !SPECIFIC_BASES.some((basis) => basis === value.basis) ||
    typeof value.direction !== 'string' ||
    !DIRECTIONS.includes(value.direction as (typeof DIRECTIONS)[number])
  )
    fail();
  const evidenceA = resolveRelationEvidence(value.evidenceA, passagesA);
  const evidenceB = resolveRelationEvidence(value.evidenceB, passagesB);
  if (!evidenceA || !evidenceB) fail();
  boundedText(value.summary, 240);
  return Object.freeze({
    summary: relationEvidenceSummary(evidenceA, evidenceB),
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
