import {z} from 'zod';
import type {AgentCommandDependencies} from './agent_commands.js';
import type {AgentTask} from './agent_task_contract.js';
import {isLegacyDocumentTask, taskNeedsRestart} from './agent_task_service.js';
import {
  intakeSnapshotIds,
  type IntakeRecord,
} from './document_intake_contract.js';
import type {ExecutionAuthority} from './execution_authority.js';
import {OperationError} from './operation_error.js';

export const documentQueueApplySchema = z
  .object({
    action: z.enum(['resume', 'restart', 'start', 'cancel']),
    items: z
      .array(
        z
          .object({
            snapshotId: z.uuid(),
            expectedVersion: z.number().int().min(0),
            taskId: z.uuid().optional(),
          })
          .strict(),
      )
      .min(1)
      .max(32)
      .refine(
        (items) =>
          new Set(items.map((item) => item.snapshotId)).size === items.length,
      ),
  })
  .strict();
export interface DocumentQueueItem {
  snapshotId: string;
  expectedVersion: number;
  taskId?: string;
  title: string;
  canonicalUri?: string;
  action: 'resume' | 'restart' | 'start' | 'cancel';
  taskStatus?: AgentTask['state']['status'];
  errorCode?: string;
}
/** Explicit, owner-scoped recovery and backlog admission; never changes the unattended policy. */
export class DocumentQueue {
  public constructor(
    private readonly authority: ExecutionAuthority,
    private readonly deps: AgentCommandDependencies,
  ) {}
  private authorize(action?: DocumentQueueItem['action']) {
    if (this.authority.identity.kind !== 'owner')
      throw new OperationError('forbidden', 'operation_not_authorized');
    this.authority.require('documents.read');
    this.authority.require('processing.read');
    if (action) {
      this.authority.require('tasks.control');
      if (action !== 'cancel') this.authority.require('models.use');
    }
  }
  public async status() {
    this.authorize();
    const [documents, tasks, records] = await Promise.all([
      this.deps.documents.list(false, true),
      this.deps.tasks.latestDocuments(this.authority),
      this.deps.intake?.list() ?? [],
    ]);
    const bySnapshot = new Map<string, IntakeRecord>();
    for (const record of records)
      for (const id of intakeSnapshotIds(record)) bySnapshot.set(id, record);
    const root = (id: string) => bySnapshot.get(id)?.snapshotId ?? id;
    const latest = new Map<string, AgentTask & {runtimeStatus: string}>();
    for (const task of [...tasks].sort(
      (a, b) =>
        b.createdAt.localeCompare(a.createdAt) ||
        b.taskId.localeCompare(a.taskId),
    )) {
      if (
        task.request.kind !== 'document' ||
        task.state.supersededBy ||
        isLegacyDocumentTask(task)
      )
        continue;
      const key = root(task.request.snapshotId);
      if (!latest.has(key)) latest.set(key, task);
    }
    const items: DocumentQueueItem[] = [];
    let held = 0,
      duplicates = 0;
    const seen = new Set<string>();
    const processedSources = new Set(
      documents.documents
        .filter((d) => d.entryCount > 0)
        .map((d) => d.canonicalUri ?? d.sourceKey),
    );
    const settledSources = new Set(
      documents.documents
        .filter((doc) => {
          const value = bySnapshot.get(doc.snapshotId)?.value;
          return value?.receipt === 'rejected' || value?.decision === 'blocked';
        })
        .map((doc) => doc.canonicalUri ?? doc.sourceKey),
    );
    const blockedSources = new Set(
      documents.documents
        .filter((doc) => {
          const value = bySnapshot.get(doc.snapshotId)?.value;
          return (
            value?.receipt === 'rejected' ||
            value?.receipt === 'pending' ||
            value?.publication?.draft === true ||
            value?.decision === 'blocked' ||
            value?.decision === 'held'
          );
        })
        .map((doc) => doc.canonicalUri ?? doc.sourceKey),
    );
    for (const doc of documents.documents)
      if (latest.has(root(doc.snapshotId)))
        processedSources.add(doc.canonicalUri ?? doc.sourceKey);
    for (const doc of [...documents.documents].sort(
      (a, b) =>
        b.capturedAt.localeCompare(a.capturedAt) ||
        b.snapshotId.localeCompare(a.snapshotId),
    )) {
      const snapshotId = root(doc.snapshotId),
        record = bySnapshot.get(snapshotId),
        task = latest.get(snapshotId);
      if (seen.has(snapshotId)) continue;
      seen.add(snapshotId);
      const settled =
        record?.value.receipt === 'rejected' ||
        record?.value.decision === 'blocked';
      // Rejected history is settled, but an in-flight writer must still be stoppable.
      if (
        task &&
        !task.cancelRequested &&
        (!settled ||
          task.runtimeStatus === 'running' ||
          ['running', 'queued'].includes(task.state.status)) &&
        !['succeeded', 'cancelled'].includes(task.state.status)
      ) {
        items.push({
          snapshotId,
          expectedVersion: task.version,
          taskId: task.taskId,
          title: doc.sourceKey,
          ...(doc.canonicalUri ? {canonicalUri: doc.canonicalUri} : {}),
          action: 'cancel',
          taskStatus: task.state.status,
          ...(task.state.errorCode ? {errorCode: task.state.errorCode} : {}),
        });
      }
      if (
        blockedSources.has(doc.canonicalUri ?? doc.sourceKey) ||
        record?.value.receipt === 'rejected' ||
        record?.value.receipt === 'pending' ||
        record?.value.decision === 'blocked' ||
        record?.value.decision === 'held' ||
        record?.value.publication?.draft
      ) {
        if (
          !settledSources.has(doc.canonicalUri ?? doc.sourceKey) &&
          (!doc.entryCount ||
            (task && !['succeeded', 'cancelled'].includes(task.state.status)))
        )
          held++;
        continue;
      }
      if (task) {
        if (
          task.runtimeStatus === 'running' ||
          task.cancelRequested ||
          ['succeeded', 'cancelled'].includes(task.state.status)
        )
          continue;
        if (
          task.state.status === 'paused' &&
          !task.pauseRequested &&
          ['ai_price_window_closed', 'ai_operations_paused'].includes(
            task.state.errorCode ?? '',
          )
        )
          continue;
        // Changed content and grant/model conflicts require resolving their cause first.
        const retryable =
          !task.state.errorCode ||
          task.state.errorCode.startsWith('ai_provider_') ||
          [
            'intake_held',
            'model_call_budget_exhausted',
            'step_attempt_budget_exhausted',
            'proposal_generation_incomplete',
            'task_execution_failed',
          ].includes(task.state.errorCode);
        if (!retryable) {
          held++;
          continue;
        }
        items.push({
          snapshotId,
          expectedVersion: task.version,
          taskId: task.taskId,
          title: doc.sourceKey,
          ...(doc.canonicalUri ? {canonicalUri: doc.canonicalUri} : {}),
          action: taskNeedsRestart(task) ? 'restart' : 'resume',
          taskStatus: task.state.status,
          ...(task.state.errorCode ? {errorCode: task.state.errorCode} : {}),
        });
      } else if (!doc.entryCount) {
        const source = doc.canonicalUri ?? doc.sourceKey;
        if (processedSources.has(source)) {
          duplicates++;
          continue;
        }
        processedSources.add(source);
        items.push({
          snapshotId,
          expectedVersion: record?.version ?? 0,
          title: doc.sourceKey,
          ...(doc.canonicalUri ? {canonicalUri: doc.canonicalUri} : {}),
          action: 'start',
        });
      }
    }
    return {items, held, duplicates, batchLimit: 32};
  }
  public async apply(input: z.infer<typeof documentQueueApplySchema>) {
    this.authorize(input.action);
    const status = await this.status();
    const policy =
      input.action === 'start'
        ? await this.deps.ingestion?.status(this.authority, {limit: 1})
        : undefined;
    const queued: {snapshotId: string; taskId: string}[] = [],
      cancelled: {snapshotId: string; taskId: string}[] = [],
      failed: {snapshotId: string; code: string}[] = [];
    for (const item of input.items) {
      try {
        const current = status.items.find(
          (candidate) =>
            candidate.snapshotId === item.snapshotId &&
            candidate.action === input.action,
        );
        if (
          current?.expectedVersion !== item.expectedVersion ||
          current.taskId !== item.taskId
        )
          throw new OperationError('conflict', 'document_queue_changed');
        let task: AgentTask;
        if (input.action === 'start') {
          if (!policy?.modelConfigured)
            throw new OperationError('rejected', 'ai_not_configured');
          const settings = policy.policy.settings;
          task = await this.deps.tasks.start(
            this.authority,
            'backlog-' + item.snapshotId + '-' + String(item.expectedVersion),
            {
              kind: 'document',
              snapshotId: item.snapshotId,
              ...(item.expectedVersion
                ? {expectedReceiptVersion: item.expectedVersion}
                : {}),
              maxEntries: settings.maxEntries,
              maxModelCalls: settings.maxModelCalls,
              intake: settings.intake ?? {fetchFullText: true},
            },
          );
        } else {
          if (!item.taskId)
            throw new OperationError('invalid_input', 'invalid_task_request');
          task =
            input.action === 'restart'
              ? await this.deps.tasks.restart(
                  this.authority,
                  item.taskId,
                  item.expectedVersion,
                )
              : await this.deps.tasks.control(
                  this.authority,
                  item.taskId,
                  item.expectedVersion,
                  input.action === 'cancel' ? 'cancel' : 'resume',
                );
        }
        (input.action === 'cancel' ? cancelled : queued).push({
          snapshotId: item.snapshotId,
          taskId: task.taskId,
        });
      } catch (error) {
        failed.push({
          snapshotId: item.snapshotId,
          code:
            error instanceof OperationError ? error.code : 'task_start_failed',
        });
      }
    }
    return {queued, cancelled, failed};
  }
}
