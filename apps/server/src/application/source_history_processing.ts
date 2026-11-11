import type {HistorySession} from '../modules/subscriptions/source_history.js';
import type {IntakeRecord} from './document_intake_contract.js';
import type {AgentTask} from './agent_task_contract.js';
import {OperationError} from './operation_error.js';

type Task = AgentTask & {runtimeStatus?: string};
export interface HistoryTaskPorts {
  limits(): Promise<{
    model: string;
    allowed: boolean;
    concurrency: number;
    maxModelCalls: number;
    budget: {
      batchId: string;
      model: string;
      paused: boolean;
      remainingCny: number;
    } | null;
  }>;
  receipt(id: string): Promise<IntakeRecord | undefined>;
  tasks(id: string): Promise<readonly Task[]>;
  read(id: string): Promise<Task>;
  start(
    key: string,
    request: {
      kind: 'document';
      snapshotId: string;
      expectedReceiptVersion: number;
      budgetId: string;
      maxModelCalls: number;
      maxEntries?: number;
    },
  ): Promise<Task>;
  control(task: Task, action: 'resume' | 'pause'): Promise<Task>;
}

const active = (t: Task) =>
  t.runtimeStatus === 'running' ||
  ['running', 'queued'].includes(t.state.status);
const retrying = (t: Task) =>
  Boolean(
    t.state.automaticRetry?.notBefore &&
    !t.pauseRequested &&
    !t.cancelRequested,
  );

export async function pauseHistoryTasks(
  session: HistorySession,
  ports: HistoryTaskPorts,
) {
  const plan = session.plan;
  if (!plan) return;
  for (const row of plan.results.values()) {
    const job = row.job;
    if (
      job?.receiptVersion !== undefined &&
      !job.taskId &&
      !job.finished &&
      row.snapshotId
    ) {
      const key = 'history-' + plan.id + '-' + row.snapshotId;
      const previous = (await ports.tasks(row.snapshotId)).find(
        (t) => t.actorKind === 'owner' && t.requestKey === key,
      );
      if (previous) job.taskId = previous.taskId;
    }
    if (!job?.taskId || job.finished) continue;
    const task = await ports.read(job.taskId);
    if (task.pauseRequested || task.cancelRequested || task.state.supersededBy)
      continue;
    if (
      active(task) ||
      retrying(task) ||
      [
        'ai_price_window_closed',
        'ai_operations_paused',
        'ai_batch_budget_paused',
      ].includes(task.state.errorCode ?? '')
    )
      job.pausedVersion = (await ports.control(task, 'pause')).version;
  }
}

// The receipt and the native task own review and publication. A batch stores
// references and the version used for an idempotent admission.
export async function advanceHistoryTasks(
  session: HistorySession,
  ports: HistoryTaskPorts,
  save: () => Promise<void>,
) {
  const plan = session.plan,
    policy = plan?.processing;
  if (!plan || !policy)
    throw new OperationError('conflict', 'history_selection_changed');
  const limits = await ports.limits();
  if (
    limits.budget?.batchId !== policy.budgetId ||
    limits.budget.paused ||
    limits.budget.remainingCny <= 0 ||
    limits.budget.model !== limits.model
  )
    return 'budget_wait';
  if (!limits.allowed) return 'dispatch_wait';
  let running = 0;
  for (const row of plan.results.values()) {
    const job = row.job;
    if (!job?.taskId || job.finished) continue;
    const task = await ports.read(job.taskId);
    if (
      task.request.kind !== 'document' ||
      task.request.snapshotId !== row.snapshotId
    )
      throw new OperationError('conflict', 'history_task_changed');
    if (
      task.state.errorCode === 'ai_batch_budget_paused' &&
      !task.pauseRequested
    )
      return 'budget_wait';
    if (
      task.state.supersededBy ||
      task.cancelRequested ||
      ['succeeded', 'failed', 'cancelled'].includes(task.state.status)
    ) {
      job.finished = true;
      if (task.state.errorCode) job.reason = task.state.errorCode;
      continue;
    }
    if (
      task.runtimeStatus === 'interrupted' ||
      (task.state.status === 'queued' && task.runtimeStatus === 'idle') ||
      (job.pausedVersion !== undefined &&
        task.pauseRequested &&
        task.state.status === 'paused')
    ) {
      if (!task.pauseRequested || job.pausedVersion !== undefined) {
        await ports.control(task, 'resume');
        delete job.pausedVersion;
        await save();
        return 'again';
      }
    }
    if (
      active(task) ||
      retrying(task) ||
      (!task.pauseRequested &&
        ['ai_price_window_closed', 'ai_operations_paused'].includes(
          task.state.errorCode ?? '',
        ))
    )
      running++;
    else {
      job.finished = true;
      job.reason = task.state.errorCode ?? 'task_paused';
    }
  }
  if (running >= limits.concurrency) return 'running';
  const pending = [...plan.results.values()].find(
    (row) =>
      row.snapshotId &&
      (row.status === 'imported' ||
        (session.legacyOwned &&
          Object.hasOwn(session.legacyOwned, row.id) &&
          (!session.legacyOwned[row.id] ||
            session.legacyOwned[row.id] === row.snapshotId))) &&
      !row.job?.taskId &&
      !row.job?.finished,
  );
  if (!pending?.snapshotId) return running ? 'running' : 'finished';
  const id = pending.snapshotId;
  const job = (pending.job ??= {});
  const key = 'history-' + plan.id + '-' + id;
  const receipt = await ports.receipt(id);
  const prior = await ports.tasks(id);
  const legacyKey = session.batchKey
    ? session.batchKey.replace(/-\d+$/u, '') + '-' + pending.id
    : undefined;
  const owned = prior.find(
    (t) =>
      t.request.kind === 'document' &&
      !t.request.reprocess &&
      t.actorKind === 'owner' &&
      (t.requestKey === key ||
        (session.legacyOwned &&
          Object.hasOwn(session.legacyOwned, pending.id) &&
          t.requestKey === legacyKey)),
  );
  if (owned) job.taskId = owned.taskId;
  else if (
    !receipt ||
    receipt.value.captureOrigin?.kind !== 'subscription' ||
    receipt.value.captureOrigin.subscriptionId !==
      session.articles.get(pending.id)?.subscriptionId ||
    receipt.value.receipt !== 'pending' ||
    receipt.value.deferProcessing ||
    (receipt.value.origin === 'manual' &&
      ['held', 'blocked'].includes(receipt.value.decision)) ||
    prior.some(
      (t) =>
        t.request.kind === 'document' &&
        !t.state.supersededBy &&
        t.state.status !== 'cancelled',
    )
  ) {
    job.finished = true;
    job.reason =
      pending.status === 'existing'
        ? 'history_preexisting'
        : 'history_receipt_changed';
  } else {
    job.receiptVersion ??= receipt.version;
    await save();
    try {
      const task = await ports.start(key, {
        kind: 'document',
        snapshotId: id,
        expectedReceiptVersion: job.receiptVersion,
        budgetId: policy.budgetId,
        maxModelCalls: Math.min(policy.maxModelCalls, limits.maxModelCalls),
        ...(policy.legacyEntryLimit
          ? {maxEntries: policy.legacyEntryLimit}
          : {}),
      });
      job.taskId = task.taskId;
    } catch (error) {
      if (!(error instanceof OperationError)) throw error;
      job.finished = true;
      job.reason = error.code;
    }
  }
  return 'again';
}
