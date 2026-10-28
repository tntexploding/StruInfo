import type {DocumentPublicationService} from './document_publication.js';
import type {SourceSplitService} from './source_split_service.js';
import {SOURCE_RECIPE_SPLIT_VERSION} from '../modules/entries/source_split_recipe.js';
import {
  tagBatchEntrySize,
  entryBatchPrefix,
  entryBatchCallEstimate,
  entryBatchSizeForAttempt,
  MAXIMUM_TAG_BATCH_CHARACTERS,
} from '../modules/processing/ai_entry_batch.js';
import {MAXIMUM_AI_SPLIT_ENTRIES} from '../modules/processing/ai_split_proposal.js';
import type {DocumentIntakeService} from './document_intake_service.js';
import type {DocumentIntelligenceProvider} from './document_intake_contract.js';
import {intakeTargetSnapshot} from './document_intake_contract.js';
import type {RecallAlias} from './relation_candidate_recall.js';
import type {BlobStore} from '../storage/blob_store.js';
import {AiSplitProposalService} from '../modules/processing/ai_split_proposal_service.js';
import {
  prepareAiEntryTagRevision,
  prepareAiSplitInformationEntries,
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
  readonly sourceSplit?: SourceSplitService;
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
  public freezeSourceSplit(request: AgentTaskRequest) {
    return request.kind === 'document'
      ? this.deps.sourceSplit?.freeze(request.snapshotId)
      : undefined;
  }
  public decideSourceSplit(task: AgentTask, step: AgentTaskStep) {
    return requireOperationValue(this.deps.sourceSplit).decide(
      step.targetId,
      requireOperationValue(task.state.sourceSplit),
    );
  }
  public async applySourceSplit(task: AgentTask, step: AgentTaskStep) {
    const request = task.request;
    if (request.kind !== 'document')
      throw new OperationError('rejected', 'task_state_incomplete');
    const recipe = requireOperationValue(
      task.state.sourceSplit?.recipes.find(
        (r) => r.recipeId === step.sourceSplit?.recipeId,
      ),
    );
    await requireOperationValue(this.deps.sourceSplit).apply(
      step.targetId,
      recipe,
      false,
      true,
      (rows) => {
        if (rows.length > request.maxEntries)
          throw new OperationError('rejected', 'recipe_entry_capacity');
        const tags = this.deps.tags?.supportsTagBatch
          ? entryBatchCallEstimate(
              rows,
              tagBatchEntrySize,
              MAXIMUM_TAG_BATCH_CHARACTERS,
            )
          : rows.length;
        if (task.state.calls + tags > request.maxModelCalls)
          throw new OperationError(
            'rejected',
            'insufficient_document_call_budget',
          );
      },
    );
  }
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
        (!this.deps.tags || (!request.reprocess && !this.deps.split))
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
  public async tagGroup(
    task: AgentTask,
    first: AgentTaskStep,
  ): Promise<AgentTaskStep[]> {
    if (
      task.request.kind !== 'document' ||
      !this.deps.tags?.supportsTagBatch ||
      !this.deps.tags.startBatch
    )
      return [first];
    const candidates: {step: AgentTaskStep; entry: CurrentInformationEntry}[] =
      [];
    const entries = new Map(
      (await this.entries()).map((entry) => [entry.entryId, entry]),
    );
    const maximum = entryBatchSizeForAttempt(first.attempt);
    for (const step of task.state.steps) {
      if (
        step.kind !== 'tags' ||
        step.complete ||
        step.attempt !== first.attempt ||
        step.attempt >= 3
      )
        continue;
      if ((await this.loadRun(step))?.proposals.length) continue;
      const entry = entries.get(step.targetId);
      if (!entry)
        throw new OperationError('not_found', 'public_entry_not_found');
      if (entry.revision !== step.expectedRevision)
        throw new OperationError('conflict', 'stale_entry_revision');
      candidates.push({step, entry});
      if (candidates.length >= maximum) break;
    }
    const group = entryBatchPrefix(
      candidates,
      ({entry}) => tagBatchEntrySize(entry),
      MAXIMUM_TAG_BATCH_CHARACTERS,
      maximum,
    ).map(({step}) => step);
    return group[0]?.targetId === first.targetId ? group : [first];
  }
  public async generateTagGroup(
    steps: readonly AgentTaskStep[],
    keys: ReadonlyMap<string, string>,
  ) {
    const tags = requireOperationValue(this.deps.tags);
    if (!tags.supportsTagBatch || !tags.startBatch)
      throw new OperationError('rejected', 'tag_batch_unavailable');
    return tags.startBatch(
      steps.map((step) => ({
        entryId: step.targetId,
        expectedRevision: requireOperationValue(step.expectedRevision),
        requestKey: requireOperationValue(keys.get(step.targetId)),
      })),
    );
  }
  public async tagCallEstimate(proposal: ProcessingProposal) {
    const payload = proposal.splitPayload;
    const count = payload?.entries.length ?? 0;
    if (
      !this.deps.tags?.supportsTagBatch ||
      !this.deps.tags.startBatch ||
      !this.deps.blobStore ||
      !proposal.targetSnapshotId ||
      !payload
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
    const entries = prepareAiSplitInformationEntries(snapshot, payload.entries);
    if (!entries) throw new OperationError('rejected', 'ai_proposal_invalid');
    return entryBatchCallEstimate(
      entries,
      tagBatchEntrySize,
      MAXIMUM_TAG_BATCH_CHARACTERS,
    );
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
    const entries = (await this.entries())
      .filter((e) => e.snapshotId === snapshotId)
      .sort((a, b) => a.value.documentOrder - b.value.documentOrder);
    if (
      !entries.length ||
      entries.length > task.request.maxEntries ||
      (!task.request.reprocess &&
        entries.some(
          (e) =>
            e.revision !== 1 ||
            (e.value.splitRuleVersion !== 'struinfo.entry-split.ai-group.v1' &&
              !(
                task.state.steps.some(
                  (s) =>
                    s.kind === 'split' && s.sourceSplit?.outcome === 'rule',
                ) && e.value.splitRuleVersion === SOURCE_RECIPE_SPLIT_VERSION
              )),
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
  private services(task: AgentTask) {
    const request = task.request;
    if (request.kind === 'intake')
      throw new OperationError('rejected', 'task_state_incomplete');
    if (request.kind === 'document')
      return {
        split: this.deps.split,
        tags: this.deps.tags,
        relations: undefined,
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
