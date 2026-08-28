import {searchCurrentInformationEntries} from './information_entry_search.js';
import type {InformationEntryAssociationRepositoryPort} from './information_entry_association_repository.js';
import type {CurrentInformationEntry} from './information_entry_contract.js';
import type {InformationEntryRepositoryPort} from './information_entry_repository.js';
import type {InformationEntryRetrievalServicePort} from './information_entry_search_index_contract.js';
import {
  AiQuerySynthesisProviderError,
  INFORMATION_ENTRY_QUERY_SYNTHESIS_EVIDENCE_STATUSES,
  INFORMATION_ENTRY_QUERY_SYNTHESIS_MAXIMUM_EVIDENCE,
  INFORMATION_ENTRY_QUERY_SYNTHESIS_MAXIMUM_EXCERPT_CODE_POINTS,
  INFORMATION_ENTRY_QUERY_SYNTHESIS_MAXIMUM_TOTAL_EXCERPT_CODE_POINTS,
  InformationEntryQuerySynthesisServiceError,
  type InformationEntryQuerySynthesisClaim,
  type InformationEntryQuerySynthesisEvidence,
  type InformationEntryQuerySynthesisProviderPort,
  type InformationEntryQuerySynthesisProviderResult,
  type InformationEntryQuerySynthesisRequest,
  type InformationEntryQuerySynthesisResult,
  type InformationEntryQuerySynthesisServicePort,
} from './information_entry_query_synthesis_contract.js';

export interface InformationEntryQuerySynthesisServiceDependencies {
  readonly workspaceId: string;
  readonly entries: InformationEntryRepositoryPort;
  readonly associations: InformationEntryAssociationRepositoryPort;
  readonly provider: InformationEntryQuerySynthesisProviderPort;
  readonly retrieval?: InformationEntryRetrievalServicePort;
}

export class InformationEntryQuerySynthesisService implements InformationEntryQuerySynthesisServicePort {
  public readonly providerKey = 'openai-responses-v1' as const;
  public readonly model: string;
  public readonly promptVersion: string;
  readonly #dependencies: Readonly<InformationEntryQuerySynthesisServiceDependencies>;

  public constructor(
    dependencies: Readonly<InformationEntryQuerySynthesisServiceDependencies>,
  ) {
    this.#dependencies = dependencies;
    this.model = dependencies.provider.model;
    this.promptVersion = dependencies.provider.promptVersion;
  }

  public async synthesize(
    request: Readonly<InformationEntryQuerySynthesisRequest>,
  ): Promise<Readonly<InformationEntryQuerySynthesisResult>> {
    if (request.query.includePrivate || request.query.onlyPrivate) {
      throw new InformationEntryQuerySynthesisServiceError(
        'ai_query_private_scope_forbidden',
      );
    }
    const {
      after: ignoredAfter,
      limit: ignoredLimit,
      ...semanticQuery
    } = request.query;
    void ignoredAfter;
    void ignoredLimit;
    const boundedQuery = Object.freeze({
      ...semanticQuery,
      includePrivate: false,
      onlyPrivate: false,
      limit: INFORMATION_ENTRY_QUERY_SYNTHESIS_MAXIMUM_EVIDENCE,
    });
    const search =
      this.#dependencies.retrieval === undefined
        ? searchCurrentInformationEntries(
            await this.#dependencies.entries.loadCurrentEntries(
              this.#dependencies.workspaceId,
              false,
            ),
            boundedQuery,
            semanticQuery.association === undefined
              ? Object.freeze({
                  projections: Object.freeze([]),
                  overrides: Object.freeze([]),
                })
              : await this.#dependencies.associations.loadAssociationSnapshot(
                  this.#dependencies.workspaceId,
                  false,
                ),
          )
        : await this.#dependencies.retrieval.search(boundedQuery);
    if (search.items.length === 0) {
      throw new InformationEntryQuerySynthesisServiceError(
        'ai_query_no_evidence',
      );
    }
    const evidence = prepareInformationEntryQuerySynthesisEvidence(
      search.items.map((item) => item.entry),
    );
    let generated: Readonly<InformationEntryQuerySynthesisProviderResult>;
    try {
      generated = await this.#dependencies.provider.synthesize(
        request.question,
        evidence.map(providerEvidence),
      );
    } catch (error) {
      if (error instanceof AiQuerySynthesisProviderError) {
        throw new InformationEntryQuerySynthesisServiceError(error.code);
      }
      throw error;
    }
    const accepted = acceptProviderResult(
      generated,
      new Set(evidence.map((item) => item.handle)),
    );
    return Object.freeze({
      requestId: request.requestId,
      querySha256: search.querySha256,
      providerKey: this.providerKey,
      model: this.model,
      promptVersion: this.promptVersion,
      ...accepted,
      evidence,
    });
  }
}

export function prepareInformationEntryQuerySynthesisEvidence(
  entries: readonly Readonly<CurrentInformationEntry>[],
): readonly Readonly<InformationEntryQuerySynthesisEvidence>[] {
  const selected = entries.slice(
    0,
    INFORMATION_ENTRY_QUERY_SYNTHESIS_MAXIMUM_EVIDENCE,
  );
  if (selected.some((entry) => entry.value.isPrivate)) {
    throw new InformationEntryQuerySynthesisServiceError(
      'ai_query_private_scope_forbidden',
    );
  }
  const excerptLimit = Math.min(
    INFORMATION_ENTRY_QUERY_SYNTHESIS_MAXIMUM_EXCERPT_CODE_POINTS,
    Math.floor(
      INFORMATION_ENTRY_QUERY_SYNTHESIS_MAXIMUM_TOTAL_EXCERPT_CODE_POINTS /
        Math.max(1, selected.length),
    ),
  );
  return Object.freeze(
    selected.map((entry, index) => {
      const body = Array.from(entry.value.body);
      return Object.freeze({
        handle: `E${String(index + 1).padStart(2, '0')}`,
        entryId: entry.entryId,
        entryRevision: entry.revision,
        snapshotId: entry.snapshotId,
        fragmentIds: Object.freeze([...entry.value.fragmentIds]),
        titlePath: entry.value.titlePath,
        excerpt: body.slice(0, excerptLimit).join(''),
        truncated: body.length > excerptLimit,
        contentKeywords: Object.freeze(
          entry.value.contentKeywords.map((keyword) => keyword.displayValue),
        ),
        ...(entry.value.typeKeyword === undefined
          ? {}
          : {
              typeKeyword: Object.freeze({
                keyword: entry.value.typeKeyword,
                ...(entry.value.typeCustomName === undefined
                  ? {}
                  : {customName: entry.value.typeCustomName}),
              }),
            }),
        domains: Object.freeze(
          entry.value.domains.map((domain) => Object.freeze({...domain})),
        ),
      });
    }),
  );
}

function providerEvidence(
  evidence: Readonly<InformationEntryQuerySynthesisEvidence>,
) {
  return Object.freeze({
    handle: evidence.handle,
    titlePath: evidence.titlePath,
    excerpt: evidence.excerpt,
    truncated: evidence.truncated,
    contentKeywords: evidence.contentKeywords,
    ...(evidence.typeKeyword === undefined
      ? {}
      : {typeKeyword: evidence.typeKeyword}),
    domains: evidence.domains,
  });
}

function acceptProviderResult(
  value: Readonly<InformationEntryQuerySynthesisProviderResult>,
  handles: ReadonlySet<string>,
): Readonly<{
  answer: string;
  evidenceStatus: InformationEntryQuerySynthesisProviderResult['evidenceStatus'];
  claims: readonly Readonly<InformationEntryQuerySynthesisClaim>[];
  limitations: readonly string[];
}> {
  if (
    !INFORMATION_ENTRY_QUERY_SYNTHESIS_EVIDENCE_STATUSES.includes(
      value.evidenceStatus,
    ) ||
    (value.evidenceStatus !== 'insufficient' && value.claims.length === 0) ||
    value.claims.some(
      (claim) =>
        claim.evidenceRefs.length === 0 ||
        new Set(claim.evidenceRefs).size !== claim.evidenceRefs.length ||
        claim.evidenceRefs.some((reference) => !handles.has(reference)),
    )
  ) {
    throw new InformationEntryQuerySynthesisServiceError(
      'ai_provider_invalid_response',
    );
  }
  return Object.freeze({
    answer: value.answer,
    evidenceStatus: value.evidenceStatus,
    claims: Object.freeze(
      value.claims.map((claim) =>
        Object.freeze({
          statement: claim.statement,
          evidenceRefs: Object.freeze([...claim.evidenceRefs]),
        }),
      ),
    ),
    limitations: Object.freeze([...value.limitations]),
  });
}
