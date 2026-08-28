import type {BlobStore} from '../../storage/blob_store.js';
import {
  prepareAiSplitInformationEntries,
  type CurrentInformationEntry,
  type InformationEntryEmptySnapshotRepositoryPort,
} from '../entries/index.js';
import {
  materializeEvidenceSnapshot,
  type EvidenceReadRepositoryPort,
} from '../evidence/index.js';
import type {
  AiSplitProposalProviderErrorCode,
  AiSplitProposalProviderPort,
  AiSplitProposalSection,
} from './ai_split_proposal.js';
import type {
  ProcessingProposal,
  ProcessingRun,
  ProcessingSplitProposalPayload,
} from './processing_contract.js';
import {
  deriveProcessingProposalId,
  deriveProcessingRunId,
} from './processing_identity.js';
import type {AiSplitProposalRepositoryPort} from './processing_repository.js';

export type AiSplitProposalServiceErrorCode =
  | AiSplitProposalProviderErrorCode
  | 'ai_snapshot_not_found'
  | 'ai_private_snapshot_forbidden'
  | 'ai_split_input_unsupported'
  | 'ai_snapshot_already_materialized'
  | 'ai_run_conflict'
  | 'ai_run_invalid_state'
  | 'ai_proposal_not_found'
  | 'ai_proposal_invalid'
  | 'ai_proposal_terminal'
  | 'stale_split_materialization';

export class AiSplitProposalServiceError extends Error {
  public readonly code: AiSplitProposalServiceErrorCode;
  public constructor(code: AiSplitProposalServiceErrorCode) {
    super('The AI split proposal operation failed.');
    this.name = 'AiSplitProposalServiceError';
    this.code = code;
  }
}

export interface AiSplitProposalStartResult {
  readonly outcome: 'created' | 'existing';
  readonly run: Readonly<ProcessingRun>;
}
export interface AiSplitProposalDecisionResult {
  readonly outcome: 'accepted' | 'rejected' | 'unchanged';
  readonly proposal: Readonly<ProcessingProposal>;
  readonly entries?: readonly Readonly<CurrentInformationEntry>[];
}
export interface AiSplitProposalServicePort {
  readonly providerKey: 'openai-responses-v1';
  readonly model: string;
  listForSnapshot(
    snapshotId: string,
  ): Promise<readonly Readonly<ProcessingProposal>[]>;
  start(
    snapshotId: string,
    requestKey: string,
  ): Promise<Readonly<AiSplitProposalStartResult>>;
  accept(
    snapshotId: string,
    proposalId: string,
  ): Promise<Readonly<AiSplitProposalDecisionResult>>;
  reject(
    snapshotId: string,
    proposalId: string,
  ): Promise<Readonly<AiSplitProposalDecisionResult>>;
}
export interface AiSplitProposalServiceDependencies {
  readonly workspaceId: string;
  readonly blobStore: BlobStore;
  readonly evidence: EvidenceReadRepositoryPort;
  readonly entries: InformationEntryEmptySnapshotRepositoryPort;
  readonly processing: AiSplitProposalRepositoryPort;
  readonly provider: AiSplitProposalProviderPort;
}

export class AiSplitProposalService implements AiSplitProposalServicePort {
  public readonly providerKey = 'openai-responses-v1' as const;
  public readonly model: string;
  readonly #dependencies: Readonly<AiSplitProposalServiceDependencies>;
  public constructor(
    dependencies: Readonly<AiSplitProposalServiceDependencies>,
  ) {
    this.#dependencies = dependencies;
    this.model = dependencies.provider.model;
  }
  public listForSnapshot(snapshotId: string) {
    return this.#dependencies.processing.listSplitProposalsForSnapshot(
      this.#dependencies.workspaceId,
      snapshotId,
      20,
    );
  }
  public async start(snapshotId: string, requestKey: string) {
    const snapshot = await this.#loadPublicSnapshot(snapshotId);
    if ((await this.#snapshotEntries(snapshotId)).length > 0) {
      throw new AiSplitProposalServiceError('ai_snapshot_already_materialized');
    }
    const materialized = await materializeEvidenceSnapshot(
      snapshot,
      this.#dependencies.blobStore,
    );
    const sectionFragments = orderedSectionFragments(materialized);
    const sections = providerSections(sectionFragments);
    const idempotencyKey = `ai-split:${snapshotId}:${requestKey}`;
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
      targetSnapshotId: snapshotId,
      privacyScope: 'public_only',
      initialStage: 'split',
      initialStep: '等待 OpenAI 拆分提案',
    });
    if (created === 'conflict')
      throw new AiSplitProposalServiceError('ai_run_conflict');
    if (created === 'unchanged') {
      const existing = await this.#dependencies.processing.loadRun(
        this.#dependencies.workspaceId,
        runId,
      );
      if (existing === undefined)
        throw new AiSplitProposalServiceError('ai_run_invalid_state');
      return Object.freeze({outcome: 'existing' as const, run: existing});
    }
    if (created !== 'applied')
      throw new AiSplitProposalServiceError('ai_run_invalid_state');
    await requireRunWrite(
      this.#dependencies.processing.writeProgress({
        workspaceId: this.#dependencies.workspaceId,
        runId,
        expectedVersion: 1,
        status: 'running',
        currentStage: 'split',
        currentStep: 'OpenAI 正在按连续原文片段生成拆分建议',
        completedUnits: 0,
        totalUnits: 1,
      }),
    );
    try {
      const generated =
        await this.#dependencies.provider.proposeSplit(sections);
      const payload = storedPayload(
        this.#dependencies.provider,
        generated.groups.map((group) => ({
          titlePath: group.titlePath,
          fragmentIds: sectionFragments
            .slice(group.startOrdinal, group.endOrdinal + 1)
            .map((fragment) => fragment.fragmentId),
        })),
      );
      const proposalId = deriveProcessingProposalId(runId, 0);
      const appended = await this.#dependencies.processing.appendSplitProposal({
        workspaceId: this.#dependencies.workspaceId,
        proposalId,
        runId,
        ordinal: 0,
        stage: 'split',
        kind: 'split',
        targetSnapshotId: snapshotId,
        summary: generated.summary,
        fragmentIds: sectionFragments.map((fragment) => fragment.fragmentId),
        splitPayload: payload,
      });
      if (appended !== 'applied' && appended !== 'unchanged') {
        throw new AiSplitProposalServiceError('ai_run_invalid_state');
      }
      await requireRunWrite(
        this.#dependencies.processing.writeProgress({
          workspaceId: this.#dependencies.workspaceId,
          runId,
          expectedVersion: 2,
          status: 'succeeded',
          currentStage: 'split',
          currentStep: '拆分提案等待人工确认',
          completedUnits: 1,
          totalUnits: 1,
        }),
      );
    } catch (error) {
      const failed = await this.#dependencies.processing.writeProgress({
        workspaceId: this.#dependencies.workspaceId,
        runId,
        expectedVersion: 2,
        status: 'failed',
        currentStage: 'split',
        currentStep: '拆分提案生成失败',
        completedUnits: 0,
        totalUnits: 1,
        errorCode: providerErrorCode(error),
      });
      if (failed !== 'applied') throw error;
    }
    const run = await this.#dependencies.processing.loadRun(
      this.#dependencies.workspaceId,
      runId,
    );
    if (run === undefined)
      throw new AiSplitProposalServiceError('ai_run_invalid_state');
    return Object.freeze({outcome: 'created' as const, run});
  }
  public accept(snapshotId: string, proposalId: string) {
    return this.#decide(snapshotId, proposalId, 'accepted');
  }
  public reject(snapshotId: string, proposalId: string) {
    return this.#decide(snapshotId, proposalId, 'rejected');
  }
  async #decide(
    snapshotId: string,
    proposalId: string,
    decision: 'accepted' | 'rejected',
  ) {
    const proposal = (await this.listForSnapshot(snapshotId)).find(
      (candidate) => candidate.proposalId === proposalId,
    );
    if (proposal === undefined)
      throw new AiSplitProposalServiceError('ai_proposal_not_found');
    if (proposal.status === decision) {
      return Object.freeze({
        outcome: 'unchanged' as const,
        proposal,
        ...(decision === 'accepted'
          ? {entries: await this.#snapshotEntries(snapshotId)}
          : {}),
      });
    }
    if (proposal.status !== 'pending_review')
      throw new AiSplitProposalServiceError('ai_proposal_terminal');
    if (decision === 'rejected') {
      const outcome = await this.#dependencies.processing.decideProposal(
        this.#dependencies.workspaceId,
        proposalId,
        'rejected',
      );
      if (outcome !== 'applied' && outcome !== 'unchanged')
        throw new AiSplitProposalServiceError('ai_proposal_terminal');
      return Object.freeze({
        outcome:
          outcome === 'applied'
            ? ('rejected' as const)
            : ('unchanged' as const),
        proposal: Object.freeze({...proposal, status: 'rejected' as const}),
      });
    }
    const payload = proposal.splitPayload;
    if (payload === undefined)
      throw new AiSplitProposalServiceError('ai_proposal_invalid');
    const snapshot = await this.#loadPublicSnapshot(snapshotId);
    const materialized = await materializeEvidenceSnapshot(
      snapshot,
      this.#dependencies.blobStore,
    );
    const rows = prepareAiSplitInformationEntries(
      materialized,
      payload.entries,
    );
    if (rows === undefined || rows.length === 0)
      throw new AiSplitProposalServiceError('ai_proposal_invalid');
    const persisted =
      await this.#dependencies.entries.materializeEntriesIfSnapshotEmpty(rows);
    if (persisted.outcome === 'snapshot_not_empty')
      throw new AiSplitProposalServiceError('stale_split_materialization');
    const decided = await this.#dependencies.processing.decideProposal(
      this.#dependencies.workspaceId,
      proposalId,
      'accepted',
    );
    if (decided !== 'applied' && decided !== 'unchanged')
      throw new AiSplitProposalServiceError('ai_proposal_terminal');
    const entryIds = new Set(rows.map((row) => row.entryId));
    const entries = (await this.#snapshotEntries(snapshotId)).filter((entry) =>
      entryIds.has(entry.entryId),
    );
    return Object.freeze({
      outcome:
        decided === 'applied' ? ('accepted' as const) : ('unchanged' as const),
      proposal: Object.freeze({...proposal, status: 'accepted' as const}),
      entries: Object.freeze(entries),
    });
  }
  async #loadPublicSnapshot(snapshotId: string) {
    const snapshot = await this.#dependencies.evidence.loadSnapshot(
      this.#dependencies.workspaceId,
      snapshotId,
    );
    if (snapshot === undefined)
      throw new AiSplitProposalServiceError('ai_snapshot_not_found');
    if (snapshot.isPrivate === true)
      throw new AiSplitProposalServiceError('ai_private_snapshot_forbidden');
    return snapshot;
  }
  async #snapshotEntries(snapshotId: string) {
    const entries = await this.#dependencies.entries.loadCurrentEntries(
      this.#dependencies.workspaceId,
      false,
    );
    return Object.freeze(
      entries.filter((entry) => entry.snapshotId === snapshotId),
    );
  }
}

function orderedSectionFragments(
  snapshot: Awaited<ReturnType<typeof materializeEvidenceSnapshot>>,
) {
  const structure = snapshot.structures[0];
  if (structure === undefined)
    throw new AiSplitProposalServiceError('ai_split_input_unsupported');
  const sections = structure.fragments
    .filter((fragment) => fragment.nodeKind === 'section')
    .sort((left, right) =>
      left.codePointRange.start !== right.codePointRange.start
        ? left.codePointRange.start - right.codePointRange.start
        : left.fragmentId.localeCompare(right.fragmentId),
    );
  const codePoints = sections.reduce(
    (total, fragment) => total + Array.from(fragment.selectedText).length,
    0,
  );
  if (sections.length < 1 || sections.length > 64 || codePoints > 120_000) {
    throw new AiSplitProposalServiceError('ai_split_input_unsupported');
  }
  return sections;
}
function providerSections(
  fragments: ReturnType<typeof orderedSectionFragments>,
): readonly Readonly<AiSplitProposalSection>[] {
  return Object.freeze(
    fragments.map((fragment, ordinal) =>
      Object.freeze({ordinal, text: fragment.selectedText}),
    ),
  );
}
function storedPayload(
  provider: AiSplitProposalProviderPort,
  entries: readonly Readonly<{
    titlePath: string;
    fragmentIds: readonly string[];
  }>[],
): Readonly<ProcessingSplitProposalPayload> {
  return Object.freeze({
    providerModel: provider.model,
    promptVersion: provider.promptVersion,
    splitRuleVersion: 'struinfo.entry-split.ai-group.v1' as const,
    entries: Object.freeze(
      entries.map((entry) =>
        Object.freeze({
          titlePath: entry.titlePath,
          fragmentIds: Object.freeze([...entry.fragmentIds]),
        }),
      ),
    ),
  });
}
async function requireRunWrite(
  write: Promise<
    'applied' | 'unchanged' | 'conflict' | 'not_found' | 'stale' | 'terminal'
  >,
): Promise<void> {
  if ((await write) !== 'applied')
    throw new AiSplitProposalServiceError('ai_run_invalid_state');
}
function providerErrorCode(error: unknown): AiSplitProposalServiceErrorCode {
  if (
    error instanceof Error &&
    'code' in error &&
    (error.code === 'ai_provider_timeout' ||
      error.code === 'ai_provider_unavailable' ||
      error.code === 'ai_provider_rejected' ||
      error.code === 'ai_provider_invalid_response')
  )
    return error.code;
  if (error instanceof AiSplitProposalServiceError) return error.code;
  return 'ai_provider_unavailable';
}
