import {validateAnnotationEvidence} from '../entries/structured_annotations.js';
import {isDeepStrictEqual} from 'node:util';
import {assertProcessingTagProposalPayload} from './processing.js';
import {
  MAXIMUM_AI_BATCH_ENTRIES,
  MAXIMUM_TAG_BATCH_CHARACTERS,
  tagBatchEntrySize,
} from './ai_entry_batch.js';

import {
  deriveInformationEntryRevisionId,
  informationEntrySearchKey,
  prepareAiEntryTagRevision,
  type CurrentInformationEntry,
  type InformationEntryRepositoryPort,
} from '../entries/index.js';
import {
  deriveProcessingProposalId,
  deriveProcessingRunId,
} from './processing_identity.js';
import type {
  AiTagProposalProviderErrorCode,
  AiTagProposalProviderPort,
} from './ai_tag_proposal.js';
import type {
  ProcessingProposal,
  ProcessingRun,
  ProcessingTagProposalPayload,
} from './processing_contract.js';
import type {AiTagProposalRepositoryPort} from './processing_repository.js';

export type AiTagProposalServiceErrorCode =
  | AiTagProposalProviderErrorCode
  | 'ai_entry_not_found'
  | 'ai_private_entry_forbidden'
  | 'ai_run_conflict'
  | 'ai_run_invalid_state'
  | 'ai_proposal_not_found'
  | 'ai_proposal_invalid'
  | 'ai_proposal_terminal'
  | 'stale_entry_revision';

export class AiTagProposalServiceError extends Error {
  public readonly code: AiTagProposalServiceErrorCode;

  public constructor(code: AiTagProposalServiceErrorCode) {
    super('The AI tag proposal operation failed.');
    this.name = 'AiTagProposalServiceError';
    this.code = code;
  }
}

export interface AiTagProposalStartResult {
  readonly outcome: 'created' | 'existing';
  readonly run: Readonly<ProcessingRun>;
}

export interface AiTagProposalDecisionResult {
  readonly outcome: 'accepted' | 'rejected' | 'unchanged';
  readonly proposal: Readonly<ProcessingProposal>;
  readonly entry?: Readonly<CurrentInformationEntry>;
}

export interface AiTagProposalServicePort {
  readonly providerKey:
    'openai-responses-v1' | 'deepseek-responses-v1' | 'external-agent-v1';
  readonly model: string;
  readonly supportsTagBatch?: boolean;
  startBatch?(
    requests: readonly Readonly<{
      entryId: string;
      expectedRevision: number;
      requestKey: string;
    }>[],
  ): Promise<readonly Readonly<AiTagProposalStartResult>[]>;

  listForEntry(
    entryId: string,
  ): Promise<readonly Readonly<ProcessingProposal>[]>;
  start(
    entryId: string,
    requestKey: string,
  ): Promise<Readonly<AiTagProposalStartResult>>;
  accept(
    entryId: string,
    proposalId: string,
  ): Promise<Readonly<AiTagProposalDecisionResult>>;
  reject(
    entryId: string,
    proposalId: string,
  ): Promise<Readonly<AiTagProposalDecisionResult>>;
}

export interface AiTagProposalServiceDependencies {
  readonly workspaceId: string;
  readonly entries: InformationEntryRepositoryPort;
  readonly processing: AiTagProposalRepositoryPort;
  readonly provider: AiTagProposalProviderPort;
}

export class AiTagProposalService implements AiTagProposalServicePort {
  public readonly providerKey:
    'openai-responses-v1' | 'deepseek-responses-v1' | 'external-agent-v1';
  public readonly model: string;
  readonly #dependencies: Readonly<AiTagProposalServiceDependencies>;

  public constructor(dependencies: Readonly<AiTagProposalServiceDependencies>) {
    this.#dependencies = dependencies;
    this.providerKey = dependencies.provider.providerKey;
    this.model = dependencies.provider.model;
  }

  public listForEntry(
    entryId: string,
  ): Promise<readonly Readonly<ProcessingProposal>[]> {
    return this.#dependencies.processing.listTagProposalsForEntry(
      this.#dependencies.workspaceId,
      entryId,
      20,
    );
  }

  public get supportsTagBatch() {
    return typeof this.#dependencies.provider.proposeTagsBatch === 'function';
  }

  /** Generate once, validate the entire response, then persist ordinary per-entry proposals. */
  public async startBatch(
    requests: readonly Readonly<{
      entryId: string;
      expectedRevision: number;
      requestKey: string;
    }>[],
  ): Promise<readonly Readonly<AiTagProposalStartResult>[]> {
    const provider = this.#dependencies.provider;
    if (
      !provider.proposeTagsBatch ||
      requests.length < 2 ||
      requests.length > MAXIMUM_AI_BATCH_ENTRIES ||
      new Set(requests.map((request) => request.entryId)).size !==
        requests.length
    )
      throw new AiTagProposalServiceError('ai_proposal_invalid');
    const current = new Map(
      (
        await this.#dependencies.entries.loadCurrentEntries(
          this.#dependencies.workspaceId,
          true,
        )
      ).map((entry) => [entry.entryId, entry]),
    );
    const entries = requests.map((request) => {
      const entry = current.get(request.entryId);
      if (!entry) throw new AiTagProposalServiceError('ai_entry_not_found');
      if (entry.value.isPrivate)
        throw new AiTagProposalServiceError('ai_private_entry_forbidden');
      if (entry.revision !== request.expectedRevision)
        throw new AiTagProposalServiceError('stale_entry_revision');
      return entry;
    });
    if (
      new Set(entries.map((entry) => entry.snapshotId)).size !== 1 ||
      entries.reduce((total, entry) => total + tagBatchEntrySize(entry), 0) >
        MAXIMUM_TAG_BATCH_CHARACTERS
    )
      throw new AiTagProposalServiceError('ai_proposal_invalid');
    const existing = await Promise.all(
      requests.map((request) =>
        this.#dependencies.processing.loadRun(
          this.#dependencies.workspaceId,
          deriveProcessingRunId(
            this.#dependencies.workspaceId,
            `ai-tags:${request.entryId}:${request.requestKey}`,
          ),
        ),
      ),
    );
    if (existing.every((run) => run !== undefined))
      return existing.map((run) => ({outcome: 'existing' as const, run}));
    // A partially saved batch is resumed through its individual durable runs.
    if (existing.some((run) => run !== undefined))
      throw new AiTagProposalServiceError('ai_run_conflict');
    const results = await provider.proposeTagsBatch(entries);
    if (
      results.length !== entries.length ||
      new Set(results.map((item) => item.entryId)).size !== entries.length
    )
      throw new AiTagProposalServiceError('ai_provider_invalid_response');
    const byId = new Map(results.map((item) => [item.entryId, item]));
    for (const entry of entries) {
      const item = byId.get(entry.entryId);
      if (item?.expectedRevision !== entry.revision)
        throw new AiTagProposalServiceError('ai_provider_invalid_response');
      // No proposal from a malformed batch may become eligible for acceptance.
      const payload = toStoredPayload(entry, provider, item.result);
      try {
        assertProcessingTagProposalPayload(payload);
        entryValueFromProposal(entry, payload);
      } catch {
        throw new AiTagProposalServiceError('ai_provider_invalid_response');
      }
    }
    const prepared = new AiTagProposalService({
      ...this.#dependencies,
      provider: {
        providerKey: provider.providerKey,
        model: provider.model,
        promptVersion: provider.promptVersion,
        proposeTags: (entry) => {
          const item = byId.get(entry.entryId);
          if (item?.expectedRevision !== entry.revision)
            throw new AiTagProposalServiceError('stale_entry_revision');
          return Promise.resolve(item.result);
        },
      },
    });
    const saved: AiTagProposalStartResult[] = [];
    for (const request of requests)
      saved.push(await prepared.start(request.entryId, request.requestKey));
    return saved;
  }

  public async start(
    entryId: string,
    requestKey: string,
  ): Promise<Readonly<AiTagProposalStartResult>> {
    const entry = await this.#loadEntry(entryId);
    if (entry.value.isPrivate) {
      throw new AiTagProposalServiceError('ai_private_entry_forbidden');
    }
    const idempotencyKey = `ai-tags:${entryId}:${requestKey}`;
    const runId = deriveProcessingRunId(
      this.#dependencies.workspaceId,
      idempotencyKey,
    );
    const created = await this.#dependencies.processing.createRun({
      workspaceId: this.#dependencies.workspaceId,
      runId,
      idempotencyKey,
      origin: 'ai',
      providerKey: this.#dependencies.provider.providerKey,
      targetSnapshotId: entry.snapshotId,
      privacyScope: 'public_only',
      initialStage: 'tags',
      initialStep: '等待 AI 标签提案',
    });
    if (created === 'conflict') {
      throw new AiTagProposalServiceError('ai_run_conflict');
    }
    if (created === 'unchanged') {
      const existing = await this.#dependencies.processing.loadRun(
        this.#dependencies.workspaceId,
        runId,
      );
      if (existing === undefined) {
        throw new AiTagProposalServiceError('ai_run_invalid_state');
      }
      return Object.freeze({outcome: 'existing', run: existing});
    }
    if (created !== 'applied') {
      throw new AiTagProposalServiceError('ai_run_invalid_state');
    }
    const running = await this.#dependencies.processing.writeProgress({
      workspaceId: this.#dependencies.workspaceId,
      runId,
      expectedVersion: 1,
      status: 'running',
      currentStage: 'tags',
      currentStep: 'AI 正在生成关键词、类型和领域建议',
      completedUnits: 0,
      totalUnits: 1,
    });
    if (running !== 'applied') {
      throw new AiTagProposalServiceError('ai_run_invalid_state');
    }

    try {
      const generated = await this.#dependencies.provider.proposeTags(entry);
      const payload = toStoredPayload(
        entry,
        this.#dependencies.provider,
        generated,
      );
      const proposalId = deriveProcessingProposalId(runId, 0);
      const appended = await this.#dependencies.processing.appendTagProposal({
        workspaceId: this.#dependencies.workspaceId,
        proposalId,
        runId,
        ordinal: 0,
        stage: 'tags',
        kind: 'tags',
        targetEntryId: entryId,
        summary: generated.summary,
        fragmentIds: entry.value.fragmentIds,
        tagPayload: payload,
      });
      if (appended !== 'applied' && appended !== 'unchanged') {
        throw new AiTagProposalServiceError('ai_run_invalid_state');
      }
      const completed = await this.#dependencies.processing.writeProgress({
        workspaceId: this.#dependencies.workspaceId,
        runId,
        expectedVersion: 2,
        status: 'succeeded',
        currentStage: 'tags',
        currentStep: '标签提案等待人工确认',
        completedUnits: 1,
        totalUnits: 1,
      });
      if (completed !== 'applied') {
        throw new AiTagProposalServiceError('ai_run_invalid_state');
      }
    } catch (error) {
      const code = providerErrorCode(error);
      const failed = await this.#dependencies.processing.writeProgress({
        workspaceId: this.#dependencies.workspaceId,
        runId,
        expectedVersion: 2,
        status: 'failed',
        currentStage: 'tags',
        currentStep: '标签提案生成失败',
        completedUnits: 0,
        totalUnits: 1,
        errorCode: code,
      });
      if (failed !== 'applied') throw error;
    }
    const run = await this.#dependencies.processing.loadRun(
      this.#dependencies.workspaceId,
      runId,
    );
    if (run === undefined) {
      throw new AiTagProposalServiceError('ai_run_invalid_state');
    }
    return Object.freeze({outcome: 'created', run});
  }

  public accept(
    entryId: string,
    proposalId: string,
  ): Promise<Readonly<AiTagProposalDecisionResult>> {
    return this.#decide(entryId, proposalId, 'accepted');
  }

  public reject(
    entryId: string,
    proposalId: string,
  ): Promise<Readonly<AiTagProposalDecisionResult>> {
    return this.#decide(entryId, proposalId, 'rejected');
  }

  async #decide(
    entryId: string,
    proposalId: string,
    decision: 'accepted' | 'rejected',
  ): Promise<Readonly<AiTagProposalDecisionResult>> {
    const proposal = (await this.listForEntry(entryId)).find(
      (candidate) => candidate.proposalId === proposalId,
    );
    if (proposal === undefined) {
      throw new AiTagProposalServiceError('ai_proposal_not_found');
    }
    if (proposal.status === decision) {
      return Object.freeze({
        outcome: 'unchanged',
        proposal,
        ...(decision === 'accepted'
          ? {entry: await this.#loadEntry(entryId)}
          : {}),
      });
    }
    if (proposal.status !== 'pending_review') {
      throw new AiTagProposalServiceError('ai_proposal_terminal');
    }
    if (decision === 'rejected') {
      const outcome = await this.#dependencies.processing.decideProposal(
        this.#dependencies.workspaceId,
        proposalId,
        'rejected',
      );
      if (outcome !== 'applied' && outcome !== 'unchanged') {
        throw new AiTagProposalServiceError('ai_proposal_terminal');
      }
      return Object.freeze({
        outcome: outcome === 'applied' ? 'rejected' : 'unchanged',
        proposal: Object.freeze({...proposal, status: 'rejected' as const}),
      });
    }

    const payload = proposal.tagPayload;
    if (payload === undefined) {
      throw new AiTagProposalServiceError('ai_proposal_invalid');
    }
    let entry = await this.#loadEntry(entryId);
    if (entry.value.isPrivate) {
      throw new AiTagProposalServiceError('ai_private_entry_forbidden');
    }
    const value = entryValueFromProposal(entry, payload);
    if (entry.revision === payload.expectedEntryRevision) {
      const outcome = await this.#dependencies.entries.reviseEntry({
        workspaceId: this.#dependencies.workspaceId,
        entryId,
        expectedRevision: payload.expectedEntryRevision,
        revisionId: deriveInformationEntryRevisionId(
          entryId,
          payload.expectedEntryRevision + 1,
        ),
        value,
      });
      if (outcome === 'not_found') {
        throw new AiTagProposalServiceError('ai_entry_not_found');
      }
      entry = await this.#loadEntry(entryId);
    }
    if (!isAcceptedTagState(entry, payload)) {
      throw new AiTagProposalServiceError('stale_entry_revision');
    }
    const decided = await this.#dependencies.processing.decideProposal(
      this.#dependencies.workspaceId,
      proposalId,
      'accepted',
    );
    if (decided !== 'applied' && decided !== 'unchanged') {
      throw new AiTagProposalServiceError('ai_proposal_terminal');
    }
    return Object.freeze({
      outcome: decided === 'applied' ? 'accepted' : 'unchanged',
      proposal: Object.freeze({...proposal, status: 'accepted' as const}),
      entry,
    });
  }

  async #loadEntry(
    entryId: string,
  ): Promise<Readonly<CurrentInformationEntry>> {
    const entries = await this.#dependencies.entries.loadCurrentEntries(
      this.#dependencies.workspaceId,
      true,
    );
    const entry = entries.find((candidate) => candidate.entryId === entryId);
    if (entry === undefined) {
      throw new AiTagProposalServiceError('ai_entry_not_found');
    }
    return entry;
  }
}

function toStoredPayload(
  entry: Readonly<CurrentInformationEntry>,
  provider: AiTagProposalProviderPort,
  generated: Awaited<ReturnType<AiTagProposalProviderPort['proposeTags']>>,
): Readonly<ProcessingTagProposalPayload> {
  return Object.freeze({
    ...(generated.annotations ? {annotations: generated.annotations} : {}),
    expectedEntryRevision: entry.revision,
    providerModel: provider.model,
    promptVersion: provider.promptVersion,
    contentKeywords: Object.freeze(
      generated.contentKeywords.map((displayValue) =>
        Object.freeze({
          displayValue,
          normalizedValue: informationEntrySearchKey(displayValue),
        }),
      ),
    ),
    typeKeyword: generated.typeKeyword,
    ...(generated.typeCustomName === undefined
      ? {}
      : {typeCustomName: generated.typeCustomName}),
    domains: Object.freeze(
      generated.domains.map((domain) => Object.freeze({...domain})),
    ),
  });
}

function entryValueFromProposal(
  entry: Readonly<CurrentInformationEntry>,
  payload: Readonly<ProcessingTagProposalPayload>,
) {
  const value = prepareAiEntryTagRevision(
    entry,
    {
      contentKeywords: payload.contentKeywords.map(
        (keyword) => keyword.displayValue,
      ),
      typeKeyword: payload.typeKeyword,
      ...(payload.typeCustomName === undefined
        ? {}
        : {typeCustomName: payload.typeCustomName}),
      domains: payload.domains,
      originVersion: originVersion(payload),
    },
    payload.annotations !== undefined,
  );
  if (value === undefined) {
    throw new AiTagProposalServiceError('ai_proposal_invalid');
  }
  if (payload.annotations) {
    if (
      payload.annotations.inputRevision !== payload.expectedEntryRevision ||
      payload.annotations.inputBodySha256 !== entry.value.bodySha256 ||
      !validateAnnotationEvidence(payload.annotations, entry.value.body)
    )
      throw new AiTagProposalServiceError('ai_proposal_invalid');
    return {
      ...value,
      annotations:
        entry.value.annotations?.origin === 'manual'
          ? entry.value.annotations
          : payload.annotations,
    };
  }
  return value;
}

function isAcceptedTagState(
  entry: Readonly<CurrentInformationEntry>,
  payload: Readonly<ProcessingTagProposalPayload>,
): boolean {
  if (
    entry.revision !== payload.expectedEntryRevision + 1 ||
    entry.value.typeKeyword !== payload.typeKeyword ||
    entry.value.typeCustomName !== payload.typeCustomName
  ) {
    return false;
  }
  const expected = entryValueFromProposal(entry, payload);
  return isDeepStrictEqual(entry.value, expected);
}

function originVersion(
  payload: Readonly<ProcessingTagProposalPayload>,
): string {
  const origin =
    payload.promptVersion === 'struinfo.agent-tool.v1'
      ? 'external-agent'
      : payload.promptVersion.startsWith('struinfo.deepseek-')
        ? 'deepseek'
        : 'openai';
  return origin + ':' + payload.providerModel + ':' + payload.promptVersion;
}

function providerErrorCode(error: unknown): AiTagProposalServiceErrorCode {
  if (
    error instanceof Error &&
    'code' in error &&
    (error.code === 'ai_operations_paused' ||
      error.code === 'ai_batch_budget_paused' ||
      error.code === 'ai_price_window_closed' ||
      error.code === 'ai_provider_timeout' ||
      error.code === 'ai_provider_unavailable' ||
      error.code === 'ai_provider_rejected' ||
      error.code === 'ai_provider_invalid_response')
  ) {
    return error.code;
  }
  if (error instanceof AiTagProposalServiceError) return error.code;
  return 'ai_provider_unavailable';
}
