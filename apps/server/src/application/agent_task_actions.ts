import type {BlobStore} from '../storage/blob_store.js';
import {AiSplitProposalService} from '../modules/processing/ai_split_proposal_service.js';
import {
  prepareAiEntryTagRevision,
  prepareInformationEntryGraphRelation,
} from '../modules/entries/index.js';
import {requireOperationValue} from './operation_error.js';
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
  readonly workspaceId: string;
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
  public async preflight(request: AgentTaskRequest) {
    if (request.kind === 'document' || request.kind === 'split') {
      if (
        request.kind === 'document' &&
        (!this.deps.split || !this.deps.tags || !this.deps.relations)
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
      if (
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
          (task.request.kind === 'document' ? task.request.maxEntries : 24)
      )
        throw new OperationError('rejected', 'entry_budget_exceeded');
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
      await requireOperationValue(services.relations).accept(
        step.targetId,
        requireOperationValue(step.relatedEntryId),
        proposal.proposalId,
      );
    }
  }
  public async tagSteps(task: AgentTask): Promise<AgentTaskStep[]> {
    if (task.request.kind !== 'document') return [];
    const snapshotId = task.request.snapshotId;
    const entries = (await this.entries()).filter(
      (e) => e.snapshotId === snapshotId,
    );
    if (
      !entries.length ||
      entries.length > task.request.maxEntries ||
      entries.some(
        (e) =>
          e.revision !== 1 ||
          e.value.splitRuleVersion !== 'struinfo.entry-split.ai-group.v1',
      )
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
    const all = await this.entries();
    const selected = all.filter((e) => e.snapshotId === request.snapshotId);
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
    }[] = [];
    const overrides = (
      await this.deps.associations.loadAssociationSnapshot(
        this.deps.workspaceId,
        false,
      )
    ).overrides;
    const seen = new Set<string>();
    for (const a of selected)
      for (const b of all) {
        if (a.entryId === b.entryId) continue;
        const [low, high] = [a.entryId, b.entryId].sort();
        if (!low || !high)
          throw new OperationError('rejected', 'invalid_relation_pair');
        const key = low + ':' + high;
        if (
          seen.has(key) ||
          overrides.some((o) => o.entryLowId === low && o.entryHighId === high)
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
      .slice(0, request.maxRelations)
      .map(({a, b}) => ({
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
