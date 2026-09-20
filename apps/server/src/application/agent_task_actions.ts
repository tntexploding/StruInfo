import type {DocumentPublicationService} from './document_publication.js';
import {MAXIMUM_AI_SPLIT_ENTRIES} from '../modules/processing/ai_split_proposal.js';
import type {DocumentIntakeService} from './document_intake_service.js';
import type {DocumentIntelligenceProvider} from './document_intake_contract.js';
import {
  intakeSnapshotIds,
  intakeTargetSnapshot,
} from './document_intake_contract.js';
import {
  recallRelationCandidates,
  type RecallAlias,
} from './relation_candidate_recall.js';
import type {BlobStore} from '../storage/blob_store.js';
import {AiSplitProposalService} from '../modules/processing/ai_split_proposal_service.js';
import {
  prepareAiEntryTagRevision,
  prepareInformationEntryGraphRelation,
} from '../modules/entries/index.js';
import {requireOperationValue} from './operation_error.js';
import {materializeEvidenceSnapshot} from '../modules/evidence/index.js';
import type {EvidenceReadRepositoryPort} from '../modules/evidence/index.js';
import type {
  CurrentInformationEntry,
  InformationEntryRepositoryPort,
  InformationEntryEmptySnapshotRepositoryPort,
  InformationEntryAssociationRepositoryPort,
} from '../modules/entries/index.js';
import {AiTagProposalService} from '../modules/processing/ai_tag_proposal_service.js';
import {AiAssociationProposalService} from '../modules/processing/ai_association_proposal_service.js';
import type {AiSplitProposalServicePort} from '../modules/processing/ai_split_proposal_service.js';
import type {AiTagProposalServicePort} from '../modules/processing/ai_tag_proposal_service.js';
import type {AiAssociationProposalServicePort} from '../modules/processing/ai_association_proposal_service.js';
import type {
  AiSplitProposalRepositoryPort,
  AiTagProposalRepositoryPort,
  AiAssociationProposalRepositoryPort,
} from '../modules/processing/processing_repository.js';
import type {ProcessingProposal} from '../modules/processing/processing_contract.js';
import {deriveProcessingRunId} from '../modules/processing/processing_identity.js';
import type {
  AgentTask,
  AgentTaskRequest,
  AgentTaskStep,
} from './agent_task_contract.js';
import {OperationError} from './operation_error.js';

export interface AgentTaskActionsDependencies {
  readonly publication?: DocumentPublicationService;
  readonly knowledgeEntries?: InformationEntryRepositoryPort;
  readonly workspaceId: string;
  readonly intake?: DocumentIntakeService;
  readonly intelligence?: DocumentIntelligenceProvider;
  readonly aliases?: () => Promise<readonly RecallAlias[]>;
  readonly blobStore?: BlobStore;
  readonly splitProcessing?: AiSplitProposalRepositoryPort;
  readonly evidence: EvidenceReadRepositoryPort;
  readonly entries: InformationEntryRepositoryPort &
    InformationEntryEmptySnapshotRepositoryPort;
  readonly associations: InformationEntryAssociationRepositoryPort;
  readonly processing: AiTagProposalRepositoryPort;
  readonly associationProcessing: AiAssociationProposalRepositoryPort;
  readonly split?: AiSplitProposalServicePort;
  readonly tags?: AiTagProposalServicePort;
  readonly relations?: AiAssociationProposalServicePort;
}
export class AgentTaskActions {
  public constructor(private readonly deps: AgentTaskActionsDependencies) {}
  public get model() {
    return this.deps.split?.model;
  }
  public get intakeModel() {
    return this.deps.intelligence?.model;
  }
  public async reviewCheckpointCurrent(task: AgentTask, version: number) {
    if (task.request.kind !== 'document') return true;
    const record = await this.deps.intake?.record(task.request.snapshotId);
    return (
      record?.version === version ||
      (record?.value.receipt === 'accepted' &&
        record.value.receiptTaskId === task.taskId)
    );
  }
  public async requiresReceiptAcceptance(request: AgentTaskRequest) {
    return (
      request.kind === 'document' &&
      Boolean(request.intake) &&
      (await this.deps.intake?.record(request.snapshotId))?.value.receipt ===
        'pending'
    );
  }
  public async preflight(request: AgentTaskRequest) {
    if (request.kind === 'intake') {
      if (!this.deps.intelligence || !this.deps.intake)
        throw new OperationError('rejected', 'ai_not_configured');
      await this.deps.intake.receiptReviewReady(
        request.snapshotId,
        request.expectedVersion,
      );
      return;
    }
    if (request.kind === 'document' || request.kind === 'split') {
      if (
        request.kind === 'document' &&
        (!this.deps.tags ||
          (!request.reprocess && (!this.deps.split || !this.deps.relations)))
      )
        throw new OperationError('rejected', 'ai_not_configured');
      const snapshot = await this.deps.evidence.loadSnapshot(
        this.deps.workspaceId,
        request.snapshotId,
      );
      if (!snapshot)
        throw new OperationError('not_found', 'snapshot_not_found');
      if (snapshot.isPrivate)
        throw new OperationError(
          'forbidden',
          'private_model_transfer_forbidden',
        );
      const record = await this.deps.intake?.record(request.snapshotId);
      const receipt = record?.value.receipt;
      if (
        request.kind === 'document' &&
        request.expectedReceiptVersion !== undefined &&
        record?.version !== request.expectedReceiptVersion
      )
        throw new OperationError('conflict', 'stale_intake_version');
      if (
        receipt &&
        receipt !== 'accepted' &&
        !(
          receipt === 'pending' &&
          request.kind === 'document' &&
          request.intake
        )
      )
        throw new OperationError(
          'rejected',
          receipt === 'pending'
            ? 'intake_receipt_pending'
            : 'intake_receipt_rejected',
        );
      if (
        !(request.kind === 'document' && request.reprocess === 'tags') &&
        (await this.entries()).some((e) => e.snapshotId === request.snapshotId)
      )
        throw new OperationError('conflict', 'snapshot_already_materialized');
    } else {
      const entry = await this.entry(request.entryId);
      if (entry.revision !== request.expectedRevision)
        throw new OperationError('conflict', 'stale_entry_revision');
      if (
        request.kind === 'tags' &&
        !prepareAiEntryTagRevision(entry, {
          contentKeywords: request.result.contentKeywords,
          typeKeyword: request.result.typeKeyword,
          ...(request.result.typeCustomName
            ? {typeCustomName: request.result.typeCustomName}
            : {}),
          domains: request.result.domains.map((d) => ({
            keyword: d.keyword,
            ...(d.customName ? {customName: d.customName} : {}),
          })),
          originVersion: 'external-agent:struinfo.agent-tool.v1',
        })
      )
        throw new OperationError('invalid_input', 'invalid_agent_tags');
      if (
        request.kind === 'relation' &&
        !prepareInformationEntryGraphRelation(
          request.result.relationLabel,
          request.result.direction,
          'ai',
          {
            semanticKind: 'related',
            verificationStatus: 'unreviewed',
            note: request.result.summary,
          },
        )
      )
        throw new OperationError('invalid_input', 'invalid_agent_relation');
      if (request.kind === 'relation') {
        if (request.entryId === request.relatedEntryId)
          throw new OperationError('invalid_input', 'invalid_relation_pair');
        const related = await this.entry(request.relatedEntryId);
        if (
          related.revision !== request.expectedRelatedRevision ||
          (await this.overrideRevision(
            request.entryId,
            request.relatedEntryId,
          )) !== request.expectedOverrideRevision
        )
          throw new OperationError('conflict', 'stale_relation_revision');
      }
    }
  }
  public async guard(task: AgentTask) {
    if (task.request.kind === 'intake') {
      const record = await requireOperationValue(this.deps.intake).record(
        task.request.snapshotId,
      );
      if (
        record?.value.receipt === 'accepted' &&
        record.value.receiptTaskId === task.taskId
      )
        return undefined;
      if (record?.value.receipt !== 'pending')
        return 'intake_receipt_not_pending';
      if (record.value.decision === 'blocked') return 'intake_blocked';
      const reviewedVersion = task.state.steps[0]?.receiptVersion;
      return reviewedVersion !== undefined && reviewedVersion !== record.version
        ? 'stale_intake_version'
        : undefined;
    }
    if (
      !['document', 'split'].includes(task.request.kind) ||
      !('snapshotId' in task.request) ||
      !this.deps.intake
    )
      return undefined;
    const documentGuard = await this.deps.intake.guard(
      task.request.snapshotId,
      task.request.kind === 'document' && Boolean(task.request.intake),
      task.request.kind === 'document' &&
        task.state.phase === 'intake' &&
        Boolean(task.request.intake),
    );
    if (documentGuard) return documentGuard;
    const step = task.state.steps.find((candidate) => !candidate.complete);
    if (step?.kind === 'relation') {
      for (const entryId of [
        step.targetId,
        requireOperationValue(step.relatedEntryId),
      ]) {
        const entry = await this.entry(entryId);
        const candidateGuard = await this.deps.intake.guard(entry.snapshotId);
        if (candidateGuard) return candidateGuard;
      }
    }
    return undefined;
  }
  public async prepareIntake(task: AgentTask) {
    if (
      (task.request.kind !== 'document' && task.request.kind !== 'intake') ||
      !task.request.intake
    )
      throw new OperationError('rejected', 'task_state_incomplete');
    return requireOperationValue(this.deps.intake).needsReview(
      task.request.snapshotId,
      task.request.intake,
    );
  }
  public async reviewIntake(task: AgentTask) {
    if (
      (task.request.kind !== 'document' && task.request.kind !== 'intake') ||
      !task.request.intake
    )
      throw new OperationError('rejected', 'task_state_incomplete');
    const record = await requireOperationValue(this.deps.intake).review(
      task.request.snapshotId,
      task.request.intake,
      task.request.kind === 'intake' ||
        (await this.requiresReceiptAcceptance(task.request)),
    );
    return record?.version;
  }
  public async receiptVersion(task: AgentTask) {
    if (task.request.kind !== 'intake')
      throw new OperationError('rejected', 'task_state_incomplete');
    return requireOperationValue(
      await requireOperationValue(this.deps.intake).record(
        task.request.snapshotId,
      ),
    ).version;
  }
  public async acceptReceipt(task: AgentTask, version: number) {
    if (task.request.kind !== 'intake')
      throw new OperationError('rejected', 'task_state_incomplete');
    return requireOperationValue(this.deps.intake).acceptReviewedReceipt(
      task.request.snapshotId,
      task.taskId,
      version,
    );
  }
  public async finishDocumentIntake(task: AgentTask, reviewedVersion?: number) {
    if (task.request.kind !== 'document') return;
    const intake = requireOperationValue(this.deps.intake);
    const record = await intake.record(task.request.snapshotId);
    if (
      record?.value.receipt === 'pending' &&
      record.value.decision === 'admitted'
    )
      await intake.acceptReviewedReceipt(
        record.snapshotId,
        task.taskId,
        reviewedVersion ?? record.version,
        true,
      );
    await this.intakeTarget(task);
  }
  public async publish(task: AgentTask) {
    await this.deps.publication?.completeTask(task);
  }
  public async validateRecovery(task: AgentTask) {
    if (task.request.kind !== 'document')
      throw new OperationError('rejected', 'invalid_task_request');
    const guard = await this.guard(task);
    if (guard) throw new OperationError('rejected', guard);
    const record = await this.deps.intake?.record(task.request.snapshotId);
    if (record?.value.publication?.draft)
      throw new OperationError(
        'conflict',
        'document_manual_confirmation_required',
      );
    const split = task.state.steps.find((step) => step.kind === 'split');
    if (record && split && intakeTargetSnapshot(record) !== split.targetId)
      throw new OperationError('conflict', 'intake_body_not_selected');
    if (!split?.complete) return;
    const entries = (await this.entries()).filter(
      (entry) => entry.snapshotId === split.targetId,
    );
    const tags = task.state.steps.filter((step) => step.kind === 'tags');
    if (!tags.length) {
      await this.tagSteps(task);
      return;
    }
    if (
      entries.length !== tags.length ||
      entries.some(
        (entry) =>
          !tags.some(
            (step) =>
              step.targetId === entry.entryId &&
              entry.revision ===
                (step.expectedRevision ?? 0) + (step.complete ? 1 : 0),
          ),
      )
    )
      throw new OperationError('conflict', 'document_changed_after_tags');
  }
  public async validateCompletion(task: AgentTask) {
    if (task.request.kind !== 'document') return;
    const entries = (await this.entries()).filter(
      (entry) => entry.snapshotId === this.documentTarget(task),
    );
    const tags = task.state.steps.filter(
      (step) => step.kind === 'tags' && step.complete,
    );
    if (
      !entries.length ||
      entries.length !== tags.length ||
      entries.some(
        (entry) =>
          !tags.some(
            (step) =>
              step.targetId === entry.entryId &&
              entry.revision === (step.expectedRevision ?? 0) + 1,
          ),
      )
    )
      throw new OperationError('conflict', 'document_changed_after_tags');
  }
  public async intakeTarget(task: AgentTask) {
    if (task.request.kind !== 'document')
      throw new OperationError('rejected', 'task_state_incomplete');
    const record = await requireOperationValue(this.deps.intake).record(
      task.request.snapshotId,
    );
    if (record?.value.decision !== 'admitted')
      throw new OperationError(
        'rejected',
        record?.value.decision === 'blocked' ? 'intake_blocked' : 'intake_held',
      );
    return intakeTargetSnapshot(record);
  }
  public async recallSteps(task: AgentTask): Promise<AgentTaskStep[]> {
    if (
      task.request.kind !== 'document' ||
      !task.request.maxRelationCandidates ||
      !task.request.maxRelations
    )
      return [];
    return Promise.all(
      task.state.steps
        .filter((s) => s.kind === 'tags' && s.complete)
        .map(async (s) => {
          const entry = await this.entry(s.targetId);
          if (entry.revision !== (s.expectedRevision ?? 0) + 1)
            throw new OperationError('conflict', 'document_changed_after_tags');
          return {
            kind: 'recall' as const,
            targetId: entry.entryId,
            expectedRevision: entry.revision,
            attempt: 0,
            complete: false,
          };
        }),
    );
  }
  public async recallGroup(
    task: AgentTask,
    first: AgentTaskStep,
  ): Promise<AgentTaskStep[]> {
    if (!this.deps.intelligence?.planRecalls) return [first];
    const candidates = task.state.steps.filter(
      (s) =>
        s.kind === 'recall' && !s.complete && !s.recallPlan && s.attempt < 3,
    );
    const group: AgentTaskStep[] = [];
    const entries = new Map(
      (await this.entries()).map((entry) => [entry.entryId, entry]),
    );
    let length = 0;
    for (const step of candidates.slice(0, 4)) {
      const entry = entries.get(step.targetId);
      if (!entry)
        throw new OperationError('not_found', 'public_entry_not_found');
      if (entry.revision !== step.expectedRevision)
        throw new OperationError('conflict', 'stale_entry_revision');
      const size = Array.from(
        JSON.stringify({
          title: entry.value.titlePath,
          body: entry.value.body,
          keywords: entry.value.contentKeywords,
        }),
      ).length;
      if (group.length && length + size > 120_000) break;
      group.push(step);
      length += size;
    }
    return group.length && group[0]?.targetId === first.targetId
      ? group
      : [first];
  }
  public async recallGroupPlans(steps: readonly AgentTaskStep[]) {
    if (steps.length === 1)
      return [await this.recall(requireOperationValue(steps[0]))];
    const entries = new Map(
      (await this.entries()).map((entry) => [entry.entryId, entry]),
    );
    const inputs = steps.map((step) => {
      const entry = entries.get(step.targetId);
      if (!entry)
        throw new OperationError('not_found', 'public_entry_not_found');
      if (entry.revision !== step.expectedRevision)
        throw new OperationError('conflict', 'stale_entry_revision');
      return {
        title: entry.value.titlePath,
        body: entry.value.body,
        keywords: entry.value.contentKeywords.map((k) => k.displayValue),
      };
    });
    const intelligence = requireOperationValue(this.deps.intelligence);
    if (!intelligence.planRecalls)
      throw new OperationError('rejected', 'recall_batch_unavailable');
    return intelligence.planRecalls(inputs);
  }
  public async recallCallEstimate(proposal: ProcessingProposal) {
    const count = proposal.splitPayload?.entries.length ?? 0;
    if (
      !this.deps.intelligence?.planRecalls ||
      !this.deps.blobStore ||
      !proposal.targetSnapshotId
    )
      return count;
    const source = await this.deps.evidence.loadSnapshot(
      this.deps.workspaceId,
      proposal.targetSnapshotId,
    );
    if (!source || source.isPrivate)
      throw new OperationError('not_found', 'public_snapshot_not_found');
    const snapshot = await materializeEvidenceSnapshot(
      source,
      this.deps.blobStore,
    );
    // Short collections fit a four-item request including metadata. For long
    // sources reserve the conservative per-entry bound before materialization.
    return Array.from(
      JSON.stringify(snapshot.structures[0]?.normalizedText ?? ''),
    ).length <= 100_000
      ? Math.ceil(count / 4)
      : count;
  }
  public async recall(step: AgentTaskStep) {
    const entry = await this.entry(step.targetId);
    if (entry.revision !== step.expectedRevision)
      throw new OperationError('conflict', 'stale_entry_revision');
    return requireOperationValue(this.deps.intelligence).planRecall({
      title: entry.value.titlePath,
      body: entry.value.body,
      keywords: entry.value.contentKeywords.map((k) => k.displayValue),
    });
  }
  private documentTarget(task: AgentTask) {
    return requireOperationValue(
      task.state.steps.find((s) => s.kind === 'split')?.targetId ??
        (task.request.kind === 'document' && !task.request.intake
          ? task.request.snapshotId
          : undefined),
    );
  }
  public async entries() {
    return (
      await this.deps.entries.loadCurrentEntries(this.deps.workspaceId, false)
    ).filter((e) => !e.value.isPrivate);
  }
  public async entry(id: string) {
    const entry = (await this.entries()).find((e) => e.entryId === id);
    if (!entry) throw new OperationError('not_found', 'public_entry_not_found');
    return entry;
  }
  async overrideRevision(a: string, b: string) {
    const snapshot = await this.deps.associations.loadAssociationSnapshot(
      this.deps.workspaceId,
      false,
    );
    return (
      snapshot.overrides.find(
        (o) =>
          o.entryLowId === [a, b].sort()[0] &&
          o.entryHighId === [a, b].sort()[1],
      )?.revision ?? 0
    );
  }
  public runId(step: AgentTaskStep, key: string) {
    const idempotency =
      step.kind === 'split'
        ? 'ai-split:' + step.targetId + ':' + key
        : step.kind === 'tags'
          ? 'ai-tags:' + step.targetId + ':' + key
          : [
              'ai-association',
              ...[
                step.targetId,
                requireOperationValue(step.relatedEntryId),
              ].sort(),
              key,
            ].join(':');
    return deriveProcessingRunId(this.deps.workspaceId, idempotency);
  }
  public loadRun(step: AgentTaskStep) {
    if (!step.runId) return Promise.resolve(undefined);
    return Promise.resolve(
      (step.kind === 'relation'
        ? this.deps.associationProcessing
        : this.deps.processing
      ).loadRun(this.deps.workspaceId, step.runId),
    );
  }
  public async generate(task: AgentTask, step: AgentTaskStep, key: string) {
    const services = this.services(task);
    if (step.kind === 'split')
      return (
        await requireOperationValue(services.split).start(step.targetId, key)
      ).run;
    // Versions are frozen when a step is planned, before any generation call.
    const entry = await this.entry(step.targetId);
    if (entry.revision !== step.expectedRevision)
      throw new OperationError('conflict', 'stale_entry_revision');
    if (step.kind === 'tags')
      return (
        await requireOperationValue(services.tags).start(step.targetId, key)
      ).run;
    const related = await this.entry(
      requireOperationValue(step.relatedEntryId),
    );
    if (
      related.revision !== step.expectedRelatedRevision ||
      (await this.overrideRevision(entry.entryId, related.entryId)) !==
        step.expectedOverrideRevision
    )
      throw new OperationError('conflict', 'stale_relation_revision');
    return (
      await requireOperationValue(services.relations).start(
        step.targetId,
        requireOperationValue(step.relatedEntryId),
        key,
      )
    ).run;
  }
  public async accept(
    task: AgentTask,
    step: AgentTaskStep,
    proposal: ProcessingProposal,
  ) {
    const services = this.services(task);
    if (step.kind === 'split') {
      if (
        !['document', 'split'].includes(task.request.kind) ||
        !proposal.splitPayload ||
        proposal.splitPayload.entries.length >
          (task.request.kind === 'document'
            ? task.request.maxEntries
            : MAXIMUM_AI_SPLIT_ENTRIES)
      )
        throw new OperationError('rejected', 'entry_budget_exceeded');
      if (task.request.kind === 'split')
        await this.deps.publication?.stage(step.targetId);
      await requireOperationValue(services.split).accept(
        step.targetId,
        proposal.proposalId,
      );
    } else if (step.kind === 'tags') {
      if (proposal.tagPayload?.expectedEntryRevision !== step.expectedRevision)
        throw new OperationError('conflict', 'stale_entry_revision');
      if (
        proposal.status === 'accepted' &&
        (await this.entry(step.targetId)).revision !==
          requireOperationValue(step.expectedRevision) + 1
      )
        throw new OperationError('conflict', 'stale_entry_revision');
      if (task.request.kind === 'tags' && proposal.status !== 'accepted')
        await this.deps.publication?.stage(
          (await this.entry(step.targetId)).snapshotId,
        );
      await requireOperationValue(services.tags).accept(
        step.targetId,
        proposal.proposalId,
      );
    } else {
      const payload = proposal.associationPayload;
      const lowFirst =
        step.targetId < requireOperationValue(step.relatedEntryId);
      if (
        !payload ||
        payload.expectedOverrideRevision !== step.expectedOverrideRevision ||
        payload.expectedEntryLowRevision !==
          (lowFirst ? step.expectedRevision : step.expectedRelatedRevision) ||
        payload.expectedEntryHighRevision !==
          (lowFirst ? step.expectedRelatedRevision : step.expectedRevision)
      )
        throw new OperationError('conflict', 'stale_relation_revision');
      if (task.request.kind === 'relation' && proposal.status !== 'accepted')
        await this.deps.publication?.stage(
          (await this.entry(step.targetId)).snapshotId,
        );
      await requireOperationValue(services.relations).accept(
        step.targetId,
        requireOperationValue(step.relatedEntryId),
        proposal.proposalId,
      );
    }
  }
  public async tagSteps(task: AgentTask): Promise<AgentTaskStep[]> {
    if (task.request.kind !== 'document') return [];
    const snapshotId = this.documentTarget(task);
    const entries = (await this.entries()).filter(
      (e) => e.snapshotId === snapshotId,
    );
    if (
      !entries.length ||
      entries.length > task.request.maxEntries ||
      (!task.request.reprocess &&
        entries.some(
          (e) =>
            e.revision !== 1 ||
            e.value.splitRuleVersion !== 'struinfo.entry-split.ai-group.v1',
        ))
    )
      throw new OperationError('conflict', 'document_structure_changed');
    return entries.map((e) => ({
      kind: 'tags',
      targetId: e.entryId,
      expectedRevision: e.revision,
      attempt: 0,
      complete: false,
    }));
  }
  public async relationSteps(task: AgentTask): Promise<AgentTaskStep[]> {
    if (task.request.kind !== 'document') return [];
    const request = task.request;
    const raw = await this.entries();
    const selected = raw.filter(
      (e) => e.snapshotId === this.documentTarget(task),
    );
    const published = this.deps.knowledgeEntries
      ? await this.deps.knowledgeEntries.loadCurrentEntries(
          this.deps.workspaceId,
          false,
        )
      : raw;
    const all = [
      ...new Map(
        [...published, ...selected].map((entry) => [entry.entryId, entry]),
      ).values(),
    ];
    const tagged = task.state.steps.filter(
      (step) => step.kind === 'tags' && step.complete,
    );
    if (
      selected.length !== tagged.length ||
      selected.some(
        (entry) =>
          !tagged.some(
            (step) =>
              step.targetId === entry.entryId &&
              entry.revision === (step.expectedRevision ?? 0) + 1,
          ),
      )
    ) {
      throw new OperationError('conflict', 'document_changed_after_tags');
    }
    const candidates: {
      a: CurrentInformationEntry;
      b: CurrentInformationEntry;
      score: number;
      reasons?: string[];
    }[] = [];
    const overrides = (
      await this.deps.associations.loadAssociationSnapshot(
        this.deps.workspaceId,
        false,
      )
    ).overrides;
    const seen = new Set<string>();
    if (request.maxRelationCandidates !== undefined) {
      const aliases = (await this.deps.aliases?.()) ?? [];
      const records = (await this.deps.intake?.list()) ?? [];
      const excludedSnapshots = new Set(
        records.flatMap((r) =>
          intakeSnapshotIds(r).filter(
            (id) =>
              r.value.decision !== 'admitted' || id !== intakeTargetSnapshot(r),
          ),
        ),
      );
      const excluded = new Set(
        all
          .filter((e) => excludedSnapshots.has(e.snapshotId))
          .map((e) => e.entryId),
      );
      for (const a of selected) {
        const plan = task.state.steps.find(
          (s) => s.kind === 'recall' && s.targetId === a.entryId && s.complete,
        )?.recallPlan;
        if (
          request.maxRelationCandidates > 0 &&
          request.maxRelations > 0 &&
          !plan
        )
          throw new OperationError('rejected', 'task_state_incomplete');
        const pairExcluded = new Set([
          ...excluded,
          ...overrides
            .filter(
              (o) => o.entryLowId === a.entryId || o.entryHighId === a.entryId,
            )
            .map((o) =>
              o.entryLowId === a.entryId ? o.entryHighId : o.entryLowId,
            ),
        ]);
        for (const hit of recallRelationCandidates(
          a,
          all,
          plan,
          aliases,
          request.maxRelations ? request.maxRelationCandidates : 0,
          pairExcluded,
        )) {
          const key = [a.entryId, hit.entry.entryId].sort().join(':');
          if (!seen.has(key)) {
            candidates.push({
              a,
              b: hit.entry,
              score: hit.score,
              reasons: [...hit.reasons],
            });
            seen.add(key);
          }
        }
      }
    } else
      for (const a of selected)
        for (const b of all) {
          if (a.entryId === b.entryId) continue;
          // Different captures of the same source are versions, not related topics.
          if (
            a.snapshotId !== b.snapshotId &&
            a.canonicalUri !== undefined &&
            a.canonicalUri === b.canonicalUri
          )
            continue;
          const [low, high] = [a.entryId, b.entryId].sort();
          if (!low || !high)
            throw new OperationError('rejected', 'invalid_relation_pair');
          const key = low + ':' + high;
          if (
            seen.has(key) ||
            overrides.some(
              (o) => o.entryLowId === low && o.entryHighId === high,
            )
          )
            continue;
          seen.add(key);
          const terms = new Set(
            a.value.contentKeywords.map((t) => t.normalizedValue),
          );
          const score = b.value.contentKeywords.filter((t) =>
            terms.has(t.normalizedValue),
          ).length;
          if (score > 0) candidates.push({a, b, score});
        }
    return candidates
      .sort(
        (x, y) =>
          y.score - x.score ||
          x.a.entryId.localeCompare(y.a.entryId) ||
          x.b.entryId.localeCompare(y.b.entryId),
      )
      .slice(0, request.maxRelationCandidates ?? request.maxRelations)
      .map(({a, b, reasons}) => ({
        ...(reasons ? {candidateReasons: reasons} : {}),
        kind: 'relation',
        targetId: a.entryId,
        relatedEntryId: b.entryId,
        expectedRevision: a.revision,
        expectedRelatedRevision: b.revision,
        expectedOverrideRevision: 0,
        attempt: 0,
        complete: false,
      }));
  }
  private services(task: AgentTask) {
    const request = task.request;
    if (request.kind === 'intake')
      throw new OperationError('rejected', 'task_state_incomplete');
    if (request.kind === 'document')
      return {
        split: this.deps.split,
        tags: this.deps.tags,
        relations: this.deps.relations,
      };
    const metadata = {
      providerKey: 'external-agent-v1' as const,
      model: 'external-agent',
      promptVersion: 'struinfo.agent-tool.v1',
    };
    if (request.kind === 'split')
      return {
        split: new AiSplitProposalService({
          workspaceId: this.deps.workspaceId,
          evidence: this.deps.evidence,
          entries: this.deps.entries,
          blobStore: requireOperationValue(this.deps.blobStore),
          processing: requireOperationValue(this.deps.splitProcessing),
          provider: {
            ...metadata,
            proposeSplit: () => Promise.resolve(request.result),
          },
        }),
        tags: undefined,
        relations: undefined,
      };
    return request.kind === 'tags'
      ? {
          tags: new AiTagProposalService({
            ...this.deps,
            provider: {
              ...metadata,
              proposeTags: (entry) => {
                if (entry.revision !== request.expectedRevision)
                  return Promise.reject(
                    new OperationError('conflict', 'stale_entry_revision'),
                  );
                return Promise.resolve({
                  summary: request.result.summary,
                  contentKeywords: request.result.contentKeywords,
                  typeKeyword: request.result.typeKeyword,
                  domains: request.result.domains.map((d) => ({
                    keyword: d.keyword,
                    ...(d.customName ? {customName: d.customName} : {}),
                  })),
                  ...(request.result.typeCustomName
                    ? {typeCustomName: request.result.typeCustomName}
                    : {}),
                });
              },
            },
          }),
          relations: undefined,
        }
      : {
          tags: undefined,
          relations: new AiAssociationProposalService({
            ...this.deps,
            processing: this.deps.associationProcessing,
            provider: {
              ...metadata,
              proposeAssociation: () => Promise.resolve(request.result),
            },
          }),
        };
  }
}
