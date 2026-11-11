import {z} from 'zod';
import type {ExecutionAuthority} from './execution_authority.js';
import {OperationError} from './operation_error.js';
import type {DocumentIntakeService} from './document_intake_service.js';
import type {DocumentIntakeRepository} from './document_intake_contract.js';
import type {AgentTask} from './agent_task_contract.js';
import {
  intakeSnapshotIds,
  intakeTargetSnapshot,
} from './document_intake_contract.js';
import type {InformationEntryRepositoryPort} from '../modules/entries/information_entry_repository.js';
import type {DocumentPublicationRepository} from './document_publication_contract.js';

export function publishedEntryRepository(
  raw: InformationEntryRepositoryPort,
  publications: DocumentPublicationRepository,
): InformationEntryRepositoryPort {
  return {
    materializeEntries: (rows) => raw.materializeEntries(rows),
    reviseEntry: (write) => raw.reviseEntry(write),
    async loadCurrentEntries(workspaceId, includePrivate) {
      return (await publications.loadPublished(workspaceId, includePrivate))
        .entries;
    },
    async loadCurrentEntriesByIds(workspaceId, includePrivate, ids) {
      if (!ids.length) return [];
      return (
        await publications.loadPublished(workspaceId, includePrivate, ids)
      ).entries;
    },
  };
}

export const documentPublishSchema = z
  .object({
    snapshotId: z.uuid(),
    expectedEntries: z
      .array(
        z
          .object({entryId: z.uuid(), revision: z.number().int().min(1)})
          .strict(),
      )
      .min(1)
      .max(512),
  })
  .strict();

/** Explicit owner/Agent confirmation and successful internal tasks share this boundary. */
export class DocumentPublicationService {
  public constructor(
    private readonly workspaceId: string,
    private readonly repository: DocumentIntakeRepository,
    private readonly intake: DocumentIntakeService,
    private readonly entries: InformationEntryRepositoryPort,
    private readonly tasks: () => Promise<readonly AgentTask[]>,
    private readonly publications: DocumentPublicationRepository,
  ) {}
  public async status(authority: ExecutionAuthority, snapshotId: string) {
    if (authority.workspaceId !== this.workspaceId)
      throw new OperationError('forbidden', 'workspace_mismatch');
    authority.require('documents.read');
    await this.intake.publicSnapshot(snapshotId);
    const record = await this.intake.record(snapshotId);
    const confirmed = await this.publications.read(
      record?.snapshotId ?? snapshotId,
    );
    const readable =
      confirmed &&
      (
        await this.publications.loadPublished(
          this.workspaceId,
          false,
          confirmed.entries.map((e) => e.entryId),
        )
      ).entries.some((entry) => entry.snapshotId === confirmed.snapshotId);
    return {
      snapshotId,
      visibility: readable ? 'published' : 'unpublished',
      hasDraft: record?.value.publication?.draft === true,
      confirmed: confirmed ?? null,
      organizationExecution: confirmed?.organization.status ?? 'unpublished',
    };
  }
  public async stage(
    snapshotId: string,
    origin: 'manual' | 'external_agent' = 'external_agent',
  ) {
    const record = await this.intake.record(snapshotId);
    const root = record?.snapshotId ?? snapshotId;
    await this.repository.withLock(root, async () => {
      const current = await this.intake.record(root);
      if (
        !(await this.repository.save(root, current?.version ?? 0, {
          ...(current?.value ?? {
            decision: 'admitted',
            origin: 'manual',
            reason: '',
            preparation: 'received',
          }),
          publication: {
            origin,
            draft: true,
            confirmedAt: new Date().toISOString(),
            entries: [],
          },
        }))
      )
        throw new OperationError('conflict', 'stale_intake_version');
    });
  }
  public async confirm(
    authority: ExecutionAuthority,
    input: z.infer<typeof documentPublishSchema>,
  ) {
    if (authority.workspaceId !== this.workspaceId)
      throw new OperationError('forbidden', 'workspace_mismatch');
    authority.require(
      authority.identity.kind === 'owner' ? 'documents.split' : 'agent.split',
    );
    return this.publish(
      input.snapshotId,
      input.expectedEntries,
      authority.identity.kind === 'owner' ? 'manual' : 'external_agent',
    );
  }
  public async completeTask(task: AgentTask) {
    if (task.request.kind !== 'document') return;
    const target =
      task.state.steps.find((s) => s.kind === 'split')?.targetId ??
      task.request.snapshotId;
    const current = (
      await this.entries.loadCurrentEntries(this.workspaceId, false)
    ).filter((e) => e.snapshotId === target);
    return this.publish(
      task.request.snapshotId,
      current.map((e) => ({entryId: e.entryId, revision: e.revision})),
      'internal_ai',
      task,
    );
  }
  private async publish(
    snapshotId: string,
    expected: readonly {entryId: string; revision: number}[],
    origin: 'manual' | 'external_agent' | 'internal_ai',
    task?: AgentTask,
  ) {
    await this.intake.publicSnapshot(snapshotId);
    const record = await this.intake.record(snapshotId);
    const root = record?.snapshotId ?? snapshotId;
    return this.repository.withLock(root, async () => {
      const current = await this.intake.record(root);
      if (
        (current?.value.receipt && current.value.receipt !== 'accepted') ||
        (current && current.value.decision !== 'admitted')
      )
        throw new OperationError('rejected', 'document_not_admitted');
      if (
        task &&
        current?.value.publication?.draft === true &&
        current.value.publication.confirmedAt >
          (task.state.recovery?.firstStartedAt ?? task.createdAt)
      )
        throw new OperationError(
          'conflict',
          'document_manual_confirmation_required',
        );
      const ids = current ? intakeSnapshotIds(current) : [root];
      if (
        (await this.tasks()).some(
          (t) =>
            t.taskId !== task?.taskId &&
            t.request.kind === 'document' &&
            t.state.workflow === 'confirmed-content-v1' &&
            ids.includes(t.request.snapshotId) &&
            ['running', 'queued'].includes(t.state.status),
        )
      )
        throw new OperationError('conflict', 'intake_task_active');
      const target = current ? intakeTargetSnapshot(current) : root;
      const entries = (
        await this.entries.loadCurrentEntries(this.workspaceId, false)
      ).filter((e) => e.snapshotId === target);
      if (
        !entries.length ||
        entries.length !== expected.length ||
        new Set(expected.map((e) => e.entryId)).size !== expected.length ||
        entries.some(
          (e) =>
            !expected.some(
              (v) => v.entryId === e.entryId && v.revision === e.revision,
            ),
        )
      )
        throw new OperationError('conflict', 'stale_document_publication');
      const publication = {
        origin,
        confirmedAt: new Date().toISOString(),
        entries: expected.map((v) => ({...v})),
      };
      const nextIntake = {
        ...(current?.value ?? {
          decision: 'admitted' as const,
          origin: 'manual' as const,
          reason: '',
          preparation: 'received' as const,
        }),
        publication,
      };
      const committed = await this.publications.commit({
        ...(task?.request.kind === 'document' && task.request.budgetId
          ? {organizationBudgetId: task.request.budgetId}
          : {}),
        documentId: root,
        snapshotId: target,
        expectedIntakeVersion: current?.version ?? 0,
        intake: nextIntake,
        expectedEntries: expected,
      });
      if (committed.status === 'not_admitted')
        throw new OperationError('rejected', 'document_not_admitted');
      if (committed.status !== 'published')
        throw new OperationError('conflict', 'stale_document_publication');
      return {
        status: 'published' as const,
        snapshotId: target,
        publication: {
          ...publication,
          confirmedAt: committed.publication.confirmedAt,
        },
        confirmedVersion: committed.publication,
      };
    });
  }
}
