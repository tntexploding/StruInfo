import {z} from 'zod';
import type {ExecutionAuthority} from './execution_authority.js';
import {OperationError} from './operation_error.js';
import type {DocumentIntakeService} from './document_intake_service.js';
import type {DocumentIntakeRepository} from './document_intake_contract.js';
import type {CurrentInformationEntry} from '../modules/entries/index.js';
import type {AgentTask} from './agent_task_contract.js';
import {
  intakeSnapshotIds,
  intakeTargetSnapshot,
  type IntakeRecord,
} from './document_intake_contract.js';
import type {InformationEntryRepositoryPort} from '../modules/entries/information_entry_repository.js';

/** Evidence and workbench reads remain complete. Knowledge consumers see finished documents. */
export function unpublishedSnapshots(
  records: readonly IntakeRecord[],
  tasks: readonly AgentTask[],
  entries: readonly CurrentInformationEntry[] = [],
): ReadonlySet<string> {
  const roots = new Map<string, string>();
  const publications = new Map(
    records.flatMap((record) =>
      record.value.publication
        ? [[record.snapshotId, record.value.publication] as const]
        : [],
    ),
  );
  const bySnapshot = new Map<string, CurrentInformationEntry[]>();
  for (const entry of entries)
    bySnapshot.set(entry.snapshotId, [
      ...(bySnapshot.get(entry.snapshotId) ?? []),
      entry,
    ]);
  const blocked = new Set<string>();
  for (const record of records) {
    const ids = intakeSnapshotIds(record);
    for (const id of ids) roots.set(id, record.snapshotId);
    const publication = record.value.publication;
    const current = bySnapshot.get(intakeTargetSnapshot(record)) ?? [];
    const unchanged =
      !publication ||
      (current.length === publication.entries.length &&
        current.every((entry) =>
          publication.entries.some(
            (version) =>
              version.entryId === entry.entryId &&
              version.revision === entry.revision,
          ),
        ));
    const admitted =
      unchanged &&
      record.value.decision === 'admitted' &&
      (!record.value.receipt || record.value.receipt === 'accepted');
    for (const id of ids)
      if (!admitted || id !== intakeTargetSnapshot(record)) blocked.add(id);
  }
  const latest = new Map<string, AgentTask>();
  for (const task of tasks) {
    if (task.request.kind !== 'document') continue;
    const root = roots.get(task.request.snapshotId) ?? task.request.snapshotId;
    const previous = latest.get(root);
    if (
      !previous ||
      task.createdAt > previous.createdAt ||
      (task.createdAt === previous.createdAt && task.taskId > previous.taskId)
    )
      latest.set(root, task);
  }
  for (const [root, task] of latest) {
    const publication = publications.get(root);
    if (
      task.state.status === 'succeeded' ||
      (publication &&
        publication.origin !== 'internal_ai' &&
        publication.confirmedAt >= task.updatedAt)
    )
      continue;
    blocked.add(root);
    for (const [id, parent] of roots) if (parent === root) blocked.add(id);
    for (const step of task.state.steps)
      if (step.kind === 'split') blocked.add(step.targetId);
  }
  return blocked;
}

/** This read view deliberately omits the unfiltered browse acceleration. */
export function publishedEntryRepository(
  raw: InformationEntryRepositoryPort,
  exclusions: (
    entries: readonly CurrentInformationEntry[],
  ) => Promise<ReadonlySet<string>>,
): InformationEntryRepositoryPort {
  return {
    materializeEntries: (rows) => raw.materializeEntries(rows),
    reviseEntry: (write) => raw.reviseEntry(write),
    async loadCurrentEntries(workspaceId, includePrivate) {
      const entries = await raw.loadCurrentEntries(workspaceId, includePrivate);
      const blocked = await exclusions(entries);
      return entries.filter((entry) => !blocked.has(entry.snapshotId));
    },
    async loadCurrentEntriesByIds(workspaceId, includePrivate, ids) {
      const entries = await raw.loadCurrentEntries(workspaceId, includePrivate);
      const blocked = await exclusions(entries);
      return entries.filter(
        (entry) =>
          ids.includes(entry.entryId) && !blocked.has(entry.snapshotId),
      );
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
  ) {}
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
      if (
        !(await this.repository.save(root, current?.version ?? 0, {
          ...(current?.value ?? {
            decision: 'admitted',
            origin: 'manual',
            reason: '',
            preparation: 'received',
          }),
          publication,
        }))
      )
        throw new OperationError('conflict', 'stale_intake_version');
      return {status: 'published' as const, snapshotId: target, publication};
    });
  }
}
