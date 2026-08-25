import type {AiProposalProviderConfig} from '../../config/runtime_config.js';
import {
  AiQuerySynthesisProviderError,
  INFORMATION_ENTRY_QUERY_SYNTHESIS_EVIDENCE_STATUSES,
  type InformationEntryQuerySynthesisClaim,
  type InformationEntryQuerySynthesisProviderEvidence,
  type InformationEntryQuerySynthesisProviderPort,
  type InformationEntryQuerySynthesisProviderResult,
} from '../../modules/entries/index.js';
import {
  OPENAI_RESPONSES_ENDPOINT,
  type OpenAiFetch,
} from './openai_entry_tag_provider.js';

export const OPENAI_QUERY_SYNTHESIS_PROMPT_VERSION =
  'struinfo.openai-entry-query-synthesis.v1';
const MAXIMUM_RESPONSE_BYTES = 1024 * 1024;

export class OpenAiInformationEntryQuerySynthesisProvider implements InformationEntryQuerySynthesisProviderPort {
  public readonly providerKey = 'openai-responses-v1' as const;
  public readonly promptVersion = OPENAI_QUERY_SYNTHESIS_PROMPT_VERSION;
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

  public async synthesize(
    question: string,
    evidence: readonly Readonly<InformationEntryQuerySynthesisProviderEvidence>[],
  ): Promise<Readonly<InformationEntryQuerySynthesisProviderResult>> {
    if (evidence.length < 1 || evidence.length > 8) fail();
    let response: Response;
    try {
      response = await this.#fetch(OPENAI_RESPONSES_ENDPOINT, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.#config.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(createRequest(this.#config, question, evidence)),
        signal: AbortSignal.timeout(this.#config.timeoutMs),
      });
    } catch (error) {
      const name = error instanceof Error ? error.name : '';
      throw new AiQuerySynthesisProviderError(
        name === 'AbortError' || name === 'TimeoutError'
          ? 'ai_provider_timeout'
          : 'ai_provider_unavailable',
      );
    }
    if (!response.ok) {
      throw new AiQuerySynthesisProviderError('ai_provider_rejected');
    }
    const length = Number(response.headers.get('content-length') ?? '0');
    if (Number.isFinite(length) && length > MAXIMUM_RESPONSE_BYTES) fail();
    let source: string;
    try {
      source = await response.text();
    } catch {
      throw new AiQuerySynthesisProviderError('ai_provider_unavailable');
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
    return decodePayload(payload, new Set(evidence.map((item) => item.handle)));
  }
}

function createRequest(
  config: Readonly<AiProposalProviderConfig>,
  question: string,
  evidence: readonly Readonly<InformationEntryQuerySynthesisProviderEvidence>[],
): Readonly<Record<string, unknown>> {
  const handles = evidence.map((item) => item.handle);
  return Object.freeze({
    model: config.model,
    store: false,
    max_output_tokens: config.maxOutputTokens,
    instructions: [
      'Answer the user question using only the supplied public evidence records.',
      'Do not use external knowledge, browse, call tools, or invent missing facts.',
      'Every returned claim must cite one or more supplied E-handles.',
      'Use supported only when the evidence directly supports the answer, partial when important gaps remain, and insufficient when the evidence cannot answer the question.',
      'State important gaps in limitations and return only the requested JSON schema.',
    ].join(' '),
    input: JSON.stringify({question, evidence}),
    text: {
      format: {
        type: 'json_schema',
        name: 'struinfo_information_entry_query_synthesis',
        strict: true,
        schema: {
          type: 'object',
          additionalProperties: false,
          required: ['answer', 'evidenceStatus', 'claims', 'limitations'],
          properties: {
            answer: {type: 'string', minLength: 1, maxLength: 4_000},
            evidenceStatus: {
              type: 'string',
              enum: INFORMATION_ENTRY_QUERY_SYNTHESIS_EVIDENCE_STATUSES,
            },
            claims: {
              type: 'array',
              maxItems: 12,
              items: {
                type: 'object',
                additionalProperties: false,
                required: ['statement', 'evidenceRefs'],
                properties: {
                  statement: {type: 'string', minLength: 1, maxLength: 500},
                  evidenceRefs: {
                    type: 'array',
                    minItems: 1,
                    maxItems: 8,
                    uniqueItems: true,
                    items: {type: 'string', enum: handles},
                  },
                },
              },
            },
            limitations: {
              type: 'array',
              maxItems: 6,
              items: {type: 'string', minLength: 1, maxLength: 300},
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
  handles: ReadonlySet<string>,
): Readonly<InformationEntryQuerySynthesisProviderResult> {
  if (
    !isClosedRecord(value, [
      'answer',
      'evidenceStatus',
      'claims',
      'limitations',
    ]) ||
    typeof value.evidenceStatus !== 'string' ||
    !INFORMATION_ENTRY_QUERY_SYNTHESIS_EVIDENCE_STATUSES.includes(
      value.evidenceStatus as (typeof INFORMATION_ENTRY_QUERY_SYNTHESIS_EVIDENCE_STATUSES)[number],
    ) ||
    !Array.isArray(value.claims) ||
    value.claims.length > 12 ||
    !Array.isArray(value.limitations) ||
    value.limitations.length > 6
  )
    fail();
  const claims = value.claims.map((candidate) =>
    decodeClaim(candidate, handles),
  );
  const evidenceStatus =
    value.evidenceStatus as (typeof INFORMATION_ENTRY_QUERY_SYNTHESIS_EVIDENCE_STATUSES)[number];
  if (evidenceStatus !== 'insufficient' && claims.length === 0) fail();
  return Object.freeze({
    answer: boundedText(value.answer, 4_000),
    evidenceStatus,
    claims: Object.freeze(claims),
    limitations: Object.freeze(
      value.limitations.map((item) => boundedText(item, 300)),
    ),
  });
}

function decodeClaim(
  value: unknown,
  handles: ReadonlySet<string>,
): Readonly<InformationEntryQuerySynthesisClaim> {
  if (!isClosedRecord(value, ['statement', 'evidenceRefs'])) fail();
  const rawEvidenceRefs: unknown = value.evidenceRefs;
  if (
    !Array.isArray(rawEvidenceRefs) ||
    rawEvidenceRefs.length < 1 ||
    rawEvidenceRefs.length > 8
  )
    fail();
  const evidenceRefs = rawEvidenceRefs.map((item: unknown) => {
    if (typeof item !== 'string' || !handles.has(item)) fail();
    return item;
  });
  if (new Set(evidenceRefs).size !== evidenceRefs.length) fail();
  return Object.freeze({
    statement: boundedText(value.statement, 500),
    evidenceRefs: Object.freeze(evidenceRefs),
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
  throw new AiQuerySynthesisProviderError('ai_provider_invalid_response');
}
