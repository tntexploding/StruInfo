import {
  deriveInformationEntryAssociationOverrideRevisionId,
  orderedInformationEntryAssociationPair,
  prepareInformationEntryGraphEdit,
  prepareInformationEntryGraphRelation,
  type CurrentInformationEntry,
  type InformationEntryAssociationRepositoryPort,
  type InformationEntryAssociationRepositorySnapshot,
  type InformationEntryAssociationOverrideValue,
  type InformationEntryRepositoryPort,
} from '../entries/index.js';
import {
  deriveProcessingProposalId,
  deriveProcessingRunId,
} from './processing_identity.js';
import type {
  AiAssociationProposalProviderErrorCode,
  AiAssociationProposalProviderPort,
} from './ai_association_proposal.js';
import type {
  ProcessingAssociationProposalPayload,
  ProcessingProposal,
  ProcessingRun,
} from './processing_contract.js';
import type {AiAssociationProposalRepositoryPort} from './processing_repository.js';

export type AiAssociationProposalServiceErrorCode =
  | AiAssociationProposalProviderErrorCode
  | 'ai_association_entry_not_found'
  | 'ai_private_entry_forbidden'
  | 'ai_run_conflict'
  | 'ai_run_invalid_state'
  | 'ai_proposal_not_found'
  | 'ai_proposal_invalid'
  | 'ai_proposal_terminal'
  | 'stale_entry_revision'
  | 'stale_association_revision';

export class AiAssociationProposalServiceError extends Error {
  public readonly code: AiAssociationProposalServiceErrorCode;

  public constructor(code: AiAssociationProposalServiceErrorCode) {
    super('The AI association proposal operation failed.');
    this.name = 'AiAssociationProposalServiceError';
    this.code = code;
  }
}

export interface AiAssociationProposalStartResult {
  readonly outcome: 'created' | 'existing';
  readonly run: Readonly<ProcessingRun>;
}

export interface AiAssociationProposalDecisionResult {
  readonly outcome: 'accepted' | 'rejected' | 'unchanged';
  readonly proposal: Readonly<ProcessingProposal>;
}

export interface AiAssociationProposalServicePort {
  readonly providerKey: 'openai-responses-v1';
  readonly model: string;

  listForPair(
    entryId: string,
    relatedEntryId: string,
  ): Promise<readonly Readonly<ProcessingProposal>[]>;
  start(
    entryId: string,
    relatedEntryId: string,
    requestKey: string,
  ): Promise<Readonly<AiAssociationProposalStartResult>>;
  accept(
    entryId: string,
    relatedEntryId: string,
    proposalId: string,
  ): Promise<Readonly<AiAssociationProposalDecisionResult>>;
  reject(
    entryId: string,
    relatedEntryId: string,
    proposalId: string,
  ): Promise<Readonly<AiAssociationProposalDecisionResult>>;
}

export interface AiAssociationProposalServiceDependencies {
  readonly workspaceId: string;
  readonly entries: InformationEntryRepositoryPort;
  readonly associations: InformationEntryAssociationRepositoryPort;
  readonly processing: AiAssociationProposalRepositoryPort;
  readonly provider: AiAssociationProposalProviderPort;
}

interface PublicPair {
  readonly entryLow: Readonly<CurrentInformationEntry>;
  readonly entryHigh: Readonly<CurrentInformationEntry>;
}

export class AiAssociationProposalService implements AiAssociationProposalServicePort {
  public readonly providerKey: 'openai-responses-v1';
  public readonly model: string;
  readonly #dependencies: Readonly<AiAssociationProposalServiceDependencies>;

  public constructor(
    dependencies: Readonly<AiAssociationProposalServiceDependencies>,
  ) {
    this.#dependencies = dependencies;
    this.providerKey = dependencies.provider.providerKey;
    this.model = dependencies.provider.model;
  }

  public listForPair(
    entryId: string,
    relatedEntryId: string,
  ): Promise<readonly Readonly<ProcessingProposal>[]> {
    const pair = requiredPair(entryId, relatedEntryId);
    return this.#dependencies.processing.listAssociationProposalsForPair(
      this.#dependencies.workspaceId,
      pair.entryLowId,
      pair.entryHighId,
      20,
    );
  }

  public async start(
    entryId: string,
    relatedEntryId: string,
    requestKey: string,
  ): Promise<Readonly<AiAssociationProposalStartResult>> {
    const pair = requiredPair(entryId, relatedEntryId);
    const entries = await this.#loadPublicPair(
      pair.entryLowId,
      pair.entryHighId,
    );
    const snapshot =
      await this.#dependencies.associations.loadAssociationSnapshot(
        this.#dependencies.workspaceId,
        false,
      );
    const current = findOverride(snapshot, pair.entryLowId, pair.entryHighId);
    const idempotencyKey = [
      'ai-association',
      pair.entryLowId,
      pair.entryHighId,
      requestKey,
    ].join(':');
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
      privacyScope: 'public_only',
      initialStage: 'associations',
      initialStep: '等待 OpenAI 关系提案',
    });
    if (created === 'conflict') {
      throw new AiAssociationProposalServiceError('ai_run_conflict');
    }
    if (created === 'unchanged') {
      const existing = await this.#dependencies.processing.loadRun(
        this.#dependencies.workspaceId,
        runId,
      );
      if (existing === undefined) {
        throw new AiAssociationProposalServiceError('ai_run_invalid_state');
      }
      return Object.freeze({outcome: 'existing', run: existing});
    }
    if (created !== 'applied') {
      throw new AiAssociationProposalServiceError('ai_run_invalid_state');
    }
    await requireWriteOutcome(
      this.#dependencies.processing.writeProgress({
        workspaceId: this.#dependencies.workspaceId,
        runId,
        expectedVersion: 1,
        status: 'running',
        currentStage: 'associations',
        currentStep: 'OpenAI 正在生成关系名称和方向建议',
        completedUnits: 0,
        totalUnits: 1,
      }),
    );

    try {
      const generated = await this.#dependencies.provider.proposeAssociation(
        entries.entryLow,
        entries.entryHigh,
      );
      const payload: Readonly<ProcessingAssociationProposalPayload> =
        Object.freeze({
          expectedEntryLowRevision: entries.entryLow.revision,
          expectedEntryHighRevision: entries.entryHigh.revision,
          expectedOverrideRevision: current?.revision ?? 0,
          providerModel: this.#dependencies.provider.model,
          promptVersion: this.#dependencies.provider.promptVersion,
          relationLabel: generated.relationLabel,
          direction: generated.direction,
        });
      const proposalId = deriveProcessingProposalId(runId, 0);
      const appended =
        await this.#dependencies.processing.appendAssociationProposal({
          workspaceId: this.#dependencies.workspaceId,
          proposalId,
          runId,
          ordinal: 0,
          stage: 'associations',
          kind: 'association',
          targetEntryId: pair.entryLowId,
          relatedEntryId: pair.entryHighId,
          summary: generated.summary,
          fragmentIds: orderedFragmentUnion(entries),
          associationPayload: payload,
        });
      if (appended !== 'applied' && appended !== 'unchanged') {
        throw new AiAssociationProposalServiceError('ai_run_invalid_state');
      }
      await requireWriteOutcome(
        this.#dependencies.processing.writeProgress({
          workspaceId: this.#dependencies.workspaceId,
          runId,
          expectedVersion: 2,
          status: 'succeeded',
          currentStage: 'associations',
          currentStep: '关系提案等待人工确认',
          completedUnits: 1,
          totalUnits: 1,
        }),
      );
    } catch (error) {
      const code = providerErrorCode(error);
      const failed = await this.#dependencies.processing.writeProgress({
        workspaceId: this.#dependencies.workspaceId,
        runId,
        expectedVersion: 2,
        status: 'failed',
        currentStage: 'associations',
        currentStep: '关系提案生成失败',
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
      throw new AiAssociationProposalServiceError('ai_run_invalid_state');
    }
    return Object.freeze({outcome: 'created', run});
  }

  public accept(
    entryId: string,
    relatedEntryId: string,
    proposalId: string,
  ): Promise<Readonly<AiAssociationProposalDecisionResult>> {
    return this.#decide(entryId, relatedEntryId, proposalId, 'accepted');
  }

  public reject(
    entryId: string,
    relatedEntryId: string,
    proposalId: string,
  ): Promise<Readonly<AiAssociationProposalDecisionResult>> {
    return this.#decide(entryId, relatedEntryId, proposalId, 'rejected');
  }

  async #decide(
    entryId: string,
    relatedEntryId: string,
    proposalId: string,
    decision: 'accepted' | 'rejected',
  ): Promise<Readonly<AiAssociationProposalDecisionResult>> {
    const pair = requiredPair(entryId, relatedEntryId);
    const proposal = (await this.listForPair(entryId, relatedEntryId)).find(
      (candidate) => candidate.proposalId === proposalId,
    );
    if (proposal === undefined) {
      throw new AiAssociationProposalServiceError('ai_proposal_not_found');
    }
    if (proposal.status === decision) {
      return Object.freeze({outcome: 'unchanged', proposal});
    }
    if (proposal.status !== 'pending_review') {
      throw new AiAssociationProposalServiceError('ai_proposal_terminal');
    }
    if (decision === 'rejected') {
      const outcome = await this.#dependencies.processing.decideProposal(
        this.#dependencies.workspaceId,
        proposalId,
        'rejected',
      );
      if (outcome !== 'applied' && outcome !== 'unchanged') {
        throw new AiAssociationProposalServiceError('ai_proposal_terminal');
      }
      return Object.freeze({
        outcome: outcome === 'applied' ? 'rejected' : 'unchanged',
        proposal: Object.freeze({...proposal, status: 'rejected' as const}),
      });
    }

    const payload = proposal.associationPayload;
    if (payload === undefined) {
      throw new AiAssociationProposalServiceError('ai_proposal_invalid');
    }
    const entries = await this.#loadPublicPair(
      pair.entryLowId,
      pair.entryHighId,
    );
    if (
      entries.entryLow.revision !== payload.expectedEntryLowRevision ||
      entries.entryHigh.revision !== payload.expectedEntryHighRevision
    ) {
      throw new AiAssociationProposalServiceError('stale_entry_revision');
    }
    let snapshot =
      await this.#dependencies.associations.loadAssociationSnapshot(
        this.#dependencies.workspaceId,
        false,
      );
    const current = findOverride(snapshot, pair.entryLowId, pair.entryHighId);
    const projection = findProjection(
      snapshot,
      pair.entryLowId,
      pair.entryHighId,
    );
    const graph = prepareInformationEntryGraphRelation(
      payload.relationLabel,
      payload.direction,
      'ai',
      {
        semanticKind: 'related',
        verificationStatus: 'unreviewed',
        note: proposal.summary,
      },
    );
    if (graph === undefined) {
      throw new AiAssociationProposalServiceError('ai_proposal_invalid');
    }
    const value = prepareInformationEntryGraphEdit(
      current?.value,
      projection !== undefined,
      graph,
    );
    if ((current?.revision ?? 0) === payload.expectedOverrideRevision) {
      const outcome =
        await this.#dependencies.associations.writeAssociationOverride({
          workspaceId: this.#dependencies.workspaceId,
          ...pair,
          expectedRevision: payload.expectedOverrideRevision,
          revisionId: deriveInformationEntryAssociationOverrideRevisionId(
            pair.entryLowId,
            pair.entryHighId,
            payload.expectedOverrideRevision + 1,
          ),
          includePrivate: false,
          value,
        });
      if (outcome === 'not_found') {
        throw new AiAssociationProposalServiceError(
          'ai_association_entry_not_found',
        );
      }
      if (outcome === 'stale') {
        throw new AiAssociationProposalServiceError(
          'stale_association_revision',
        );
      }
    } else if (
      current?.revision !== payload.expectedOverrideRevision + 1 ||
      !sameOverrideValue(current.value, value)
    ) {
      throw new AiAssociationProposalServiceError('stale_association_revision');
    }

    snapshot = await this.#dependencies.associations.loadAssociationSnapshot(
      this.#dependencies.workspaceId,
      false,
    );
    const written = findOverride(snapshot, pair.entryLowId, pair.entryHighId);
    if (
      written === undefined ||
      !sameOverrideValue(written.value, value) ||
      (written.revision !== payload.expectedOverrideRevision &&
        written.revision !== payload.expectedOverrideRevision + 1)
    ) {
      throw new AiAssociationProposalServiceError('stale_association_revision');
    }
    const decided = await this.#dependencies.processing.decideProposal(
      this.#dependencies.workspaceId,
      proposalId,
      'accepted',
    );
    if (decided !== 'applied' && decided !== 'unchanged') {
      throw new AiAssociationProposalServiceError('ai_proposal_terminal');
    }
    return Object.freeze({
      outcome: decided === 'applied' ? 'accepted' : 'unchanged',
      proposal: Object.freeze({...proposal, status: 'accepted' as const}),
    });
  }

  async #loadPublicPair(
    entryLowId: string,
    entryHighId: string,
  ): Promise<Readonly<PublicPair>> {
    const entries = await this.#dependencies.entries.loadCurrentEntries(
      this.#dependencies.workspaceId,
      true,
    );
    const entryLow = entries.find((entry) => entry.entryId === entryLowId);
    const entryHigh = entries.find((entry) => entry.entryId === entryHighId);
    if (entryLow === undefined || entryHigh === undefined) {
      throw new AiAssociationProposalServiceError(
        'ai_association_entry_not_found',
      );
    }
    if (entryLow.value.isPrivate || entryHigh.value.isPrivate) {
      throw new AiAssociationProposalServiceError('ai_private_entry_forbidden');
    }
    return Object.freeze({entryLow, entryHigh});
  }
}

function requiredPair(entryId: string, relatedEntryId: string) {
  const pair = orderedInformationEntryAssociationPair(entryId, relatedEntryId);
  if (pair === undefined) {
    throw new AiAssociationProposalServiceError(
      'ai_association_entry_not_found',
    );
  }
  return pair;
}

function findOverride(
  snapshot: Readonly<InformationEntryAssociationRepositorySnapshot>,
  entryLowId: string,
  entryHighId: string,
) {
  return snapshot.overrides.find(
    (candidate) =>
      candidate.entryLowId === entryLowId &&
      candidate.entryHighId === entryHighId,
  );
}

function findProjection(
  snapshot: Readonly<InformationEntryAssociationRepositorySnapshot>,
  entryLowId: string,
  entryHighId: string,
) {
  return snapshot.projections.find(
    (candidate) =>
      candidate.entryLowId === entryLowId &&
      candidate.entryHighId === entryHighId,
  );
}

function orderedFragmentUnion(pair: Readonly<PublicPair>): readonly string[] {
  return Object.freeze(
    [
      ...new Set([
        ...pair.entryLow.value.fragmentIds,
        ...pair.entryHigh.value.fragmentIds,
      ]),
    ].sort(),
  );
}

function sameOverrideValue(
  left: Readonly<InformationEntryAssociationOverrideValue>,
  right: Readonly<InformationEntryAssociationOverrideValue>,
): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

async function requireWriteOutcome(
  promise: Promise<
    'applied' | 'unchanged' | 'conflict' | 'not_found' | 'stale' | 'terminal'
  >,
): Promise<void> {
  const outcome = await promise;
  if (outcome !== 'applied') {
    throw new AiAssociationProposalServiceError('ai_run_invalid_state');
  }
}

function providerErrorCode(
  error: unknown,
): AiAssociationProposalServiceErrorCode {
  if (
    error instanceof Error &&
    'code' in error &&
    (error.code === 'ai_provider_timeout' ||
      error.code === 'ai_provider_unavailable' ||
      error.code === 'ai_provider_rejected' ||
      error.code === 'ai_provider_invalid_response')
  ) {
    return error.code;
  }
  if (error instanceof AiAssociationProposalServiceError) return error.code;
  return 'ai_provider_unavailable';
}
