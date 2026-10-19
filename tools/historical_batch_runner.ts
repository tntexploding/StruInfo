import type {HistoryArticle} from '../apps/server/src/modules/subscriptions/source_history.js';
import {validateManifest, type BatchManifest} from './historical_batch_plan.js';

export interface BatchTask {
  taskId: string;
  version: number;
  requestKey?: string;
  request: {snapshotId?: string; kind: string};
  state: {
    status: string;
    errorCode?: string;
    calls: number;
    supersededBy?: string;
    automaticRetry?: {limit: number; used: number; notBefore?: string};
  };
  pauseRequested?: boolean;
  cancelRequested?: boolean;
  runtimeStatus?: string;
}
interface Receipt {
  snapshotId: string;
  version: number;
  value: {receipt?: string; origin?: string; decision?: string};
}
export interface ArticleProgress {
  status:
    | 'pending'
    | 'importing'
    | 'imported'
    | 'processing'
    | 'completed'
    | 'rejected'
    | 'held'
    | 'failed'
    | 'existing';
  snapshotId?: string;
  taskId?: string;
  startRequest?: {requestKey: string; request: Record<string, unknown>};
  pausedTaskVersion?: number;
  reason?: string;
  calls?: number;
}
export interface BatchProgress {
  format: string;
  manifestId: string;
  articles: Record<string, ArticleProgress>;
}
export interface BatchPorts {
  call: <T>(operation: string, input?: unknown) => Promise<T>;
  save(progress: BatchProgress): Promise<void>;
  paused(): Promise<boolean>;
  budget(): Promise<{
    batchId: string;
    workspaceId: string;
    model: string;
    paused: boolean;
    limitCny: number;
  }>;
}
export class BatchApiError extends Error {
  public constructor(public readonly code: string) {
    super(code);
  }
}
const active = (t: BatchTask) =>
  ['queued', 'running'].includes(t.state.status) ||
  t.runtimeStatus === 'running';
const retryPending = (t: BatchTask, limit = 2) =>
  t.state.status === 'paused' &&
  Boolean(t.state.automaticRetry?.notBefore) &&
  (t.state.automaticRetry?.used ?? 3) <=
    Math.min(t.state.automaticRetry?.limit ?? 0, limit) &&
  !t.pauseRequested &&
  !t.cancelRequested &&
  !t.state.supersededBy;
const resumableWaits = new Set([
  'ai_price_window_closed',
  'ai_operations_paused',
]);

/** One bounded admission per tick. The application owns model dispatch and retries. */
export async function advanceBatch(
  m: BatchManifest,
  p: BatchProgress,
  batch: number,
  ports: BatchPorts,
): Promise<string> {
  validateManifest(m);
  if (
    p.format !== 'struinfo.historical-progress.v1' ||
    p.manifestId !== m.id ||
    !Number.isInteger(batch)
  )
    throw new Error('batch_progress_mismatch');
  const rows = m.articles.filter((a) => a.batch === batch);
  if (!rows.length) throw new Error('batch_not_found');
  for (const row of rows) p.articles[row.id] ??= {status: 'pending'};
  const tasks = new Map<string, BatchTask>();
  // Read exact task identities, including beyond the overview's recent 100.
  for (const row of rows) {
    const item = p.articles[row.id];
    if (item?.taskId && item.status !== 'completed') {
      const task = await ports.call<BatchTask>('task_read', {
        taskId: item.taskId,
      });
      if (
        task.request.snapshotId !== item.snapshotId ||
        task.request.kind !== 'document'
      )
        throw new Error('batch_task_identity_mismatch');
      tasks.set(row.id, task);
      item.calls = task.state.calls;
      item.status =
        task.state.status === 'succeeded'
          ? 'completed'
          : task.state.status === 'failed'
            ? 'failed'
            : task.state.status === 'cancelled' || task.state.supersededBy
              ? 'held'
              : 'processing';
      if (task.state.errorCode) item.reason = task.state.errorCode;
      else delete item.reason;
    }
  }
  await ports.save(p);
  if (await ports.paused()) {
    let pausing = false;
    for (const [id, t] of tasks) {
      const item = p.articles[id];
      if (active(t) || retryPending(t)) {
        pausing = true;
        if (t.pauseRequested) continue;
        const paused = await ports.call<BatchTask>('task_control', {
          taskId: t.taskId,
          expectedVersion: t.version,
          action: 'pause',
        });
        if (item) item.pausedTaskVersion = paused.version;
        await ports.save(p);
      } else if (
        item?.pausedTaskVersion !== undefined &&
        t.pauseRequested &&
        t.state.status === 'paused'
      ) {
        // The worker may save its final checkpoint after acknowledging pause.
        item.pausedTaskVersion = t.version;
        await ports.save(p);
      }
    }
    return pausing ? 'pausing' : 'paused';
  }
  const system = await ports.call<{
    model: string;
    aiPrice: {
      blocked: boolean;
      policy: {
        operationsAllowed?: boolean;
        maxConcurrentRequests?: number;
        automaticRetryLimit?: number;
      };
    };
  }>('system_status');
  const budget = await ports.budget();
  if (
    budget.workspaceId !== m.workspaceId ||
    budget.batchId !== `${m.id}-${String(batch)}` ||
    budget.model !== system.model ||
    !Number.isFinite(budget.limitCny) ||
    budget.limitCny <= 0
  )
    throw new Error('batch_budget_mismatch');
  if (budget.paused) return 'budget_wait';
  if (
    system.aiPrice.policy.operationsAllowed === false ||
    system.aiPrice.blocked
  )
    return 'dispatch_wait';
  // Exhaustion requires an explicit budget correction and task continuation.
  // Retrying the same reservation must not create an endless resume loop.
  if (
    [...tasks.values()].some(
      (t) =>
        t.state.status === 'paused' &&
        t.state.errorCode === 'ai_batch_budget_paused',
    )
  )
    return 'budget_wait';
  const waitingRetry = (t: BatchTask) =>
    retryPending(t, system.aiPrice.policy.automaticRetryLimit ?? 0);
  const receipts = new Map(
    (await ports.call<{records: Receipt[]}>('intake_status')).records.map(
      (r) => [r.snapshotId, r],
    ),
  );
  for (const row of rows) {
    const item = p.articles[row.id];
    if (!item?.snapshotId) continue;
    const receipt = receipts.get(item.snapshotId);
    if (!receipt) throw new Error('batch_receipt_missing');
    if (receipt.value.receipt === 'rejected') {
      item.status = 'rejected';
      continue;
    }
    if (
      receipt.value.origin === 'manual' &&
      ['held', 'blocked'].includes(receipt.value.decision ?? '')
    ) {
      item.status = 'held';
      item.reason = 'manual_hold';
      continue;
    }
    const task = tasks.get(row.id);
    if (task && waitingRetry(task)) continue;
    if (
      task &&
      !task.pauseRequested &&
      !task.cancelRequested &&
      !task.state.supersededBy &&
      (task.runtimeStatus === 'interrupted' ||
        (task.state.status === 'queued' && task.runtimeStatus === 'idle'))
    ) {
      if (await ports.paused()) return 'pausing';
      await ports.call('task_control', {
        taskId: task.taskId,
        expectedVersion: task.version,
        action: 'resume',
      });
      return 'resumed';
    }
    if (task?.state.status === 'paused') {
      if (
        item.pausedTaskVersion === task.version ||
        (!task.pauseRequested &&
          !task.cancelRequested &&
          !task.state.supersededBy &&
          resumableWaits.has(task.state.errorCode ?? ''))
      ) {
        if (await ports.paused()) return 'pausing';
        await ports.call('task_control', {
          taskId: task.taskId,
          expectedVersion: task.version,
          action: 'resume',
        });
        delete item.pausedTaskVersion;
        await ports.save(p);
        return 'resumed';
      }
      item.status = 'held';
      item.reason = task.state.errorCode ?? 'task_paused';
    }
  }
  await ports.save(p);
  if (
    [...tasks.values()].filter((t) => active(t) || waitingRetry(t)).length >=
    Math.max(1, Math.min(4, system.aiPrice.policy.maxConcurrentRequests ?? 1))
  )
    return 'running';
  const row = rows.find((a) =>
    ['pending', 'importing', 'imported'].includes(
      p.articles[a.id]?.status ?? 'pending',
    ),
  );
  if (!row)
    return [...tasks.values()].some((t) => active(t) || waitingRetry(t))
      ? 'running'
      : 'settled';
  const item = p.articles[row.id];
  if (!item) throw new Error('batch_progress_missing');
  if (!item.snapshotId) {
    const restoredArticle: Omit<HistoryArticle, 'id'> = {
      subscriptionId: row.subscriptionId,
      url: row.url,
      title: row.title,
      access: row.access,
      ...(row.publishedAt !== undefined ? {publishedAt: row.publishedAt} : {}),
      ...(row.dateInferred !== undefined
        ? {dateInferred: row.dateInferred}
        : {}),
      ...(row.titleFromUrl !== undefined
        ? {titleFromUrl: row.titleFromUrl}
        : {}),
    };
    const restoredSession = await ports.call<{sessionId: string}>(
      'history_restore',
      {
        articles: [restoredArticle],
      },
    );
    const opened = {sessionId: restoredSession.sessionId};
    try {
      const listing = await ports.call<{
        articles: (HistoryArticle & {existingSnapshotId?: string})[];
      }>('history_list', opened);
      const restored = listing.articles.find((a) => a.id === row.id);
      if (!restored) throw new Error('restored_article_mismatch');
      if (restored.existingSnapshotId && item.status !== 'importing') {
        item.status = 'existing';
        item.snapshotId = restored.existingSnapshotId;
        await ports.save(p);
        return 'existing';
      }
      if (!restored.existingSnapshotId) {
        const preview = await ports.call<{
          item: HistoryArticle;
          access: string;
        }>('history_preview', {...opened, id: row.id});
        if (preview.access === 'restricted') {
          item.status = 'rejected';
          item.reason = 'restricted';
          await ports.save(p);
          return 'excluded';
        }
        if (
          !preview.item.publishedAt ||
          preview.item.publishedAt.slice(0, 10) < m.from ||
          preview.item.publishedAt.slice(0, 10) > m.to
        ) {
          item.status = 'held';
          item.reason = 'publication_changed';
          await ports.save(p);
          return 'held';
        }
      }
      const plan = await ports.call<{planId: string}>(
        'history_prepare_import',
        {...opened, ids: [row.id], from: m.from, to: m.to, perSourceLimit: 1},
      );
      if (await ports.paused()) return 'pausing';
      item.status = 'importing';
      await ports.save(p);
      const result = await ports.call<{
        results: {status: string; snapshotId?: string; code?: string}[];
      }>('history_import', {...opened, ...plan, ids: [row.id]});
      const imported = result.results[0];
      if (!imported?.snapshotId) {
        item.status = 'failed';
        item.reason = imported?.code ?? 'import_failed';
        await ports.save(p);
        return 'failed';
      }
      item.snapshotId = imported.snapshotId;
      item.status = 'imported';
      await ports.save(p);
    } finally {
      await ports.call('history_close', opened).catch(() => undefined);
    }
  }
  const current = (
    await ports.call<{records: Receipt[]}>('intake_status')
  ).records.find((r) => r.snapshotId === item.snapshotId);
  if (!current) throw new Error('batch_receipt_missing');
  // A saved request is replayed unchanged after a lost HTTP response; no renewed budget.
  if (!item.startRequest) {
    if (
      current.value.receipt !== 'pending' ||
      (current.value.origin === 'manual' &&
        ['held', 'blocked'].includes(current.value.decision ?? ''))
    ) {
      item.status = 'held';
      item.reason = 'receipt_changed';
      await ports.save(p);
      return 'held';
    }
    item.startRequest = {
      requestKey: `${m.id}-${row.id}`,
      request: {
        kind: 'document',
        snapshotId: item.snapshotId,
        expectedReceiptVersion: current.version,
        ...m.task,
        intake: {
          fetchFullText: false,
          blockedKinds: ['promotion', 'event_notice', 'update_notice'],
          preferredTopics: [],
          excludedTopics: [],
        },
      },
    };
    await ports.save(p);
  }
  if (await ports.paused()) return 'pausing';
  const started = await ports.call<BatchTask>('task_start', item.startRequest);
  item.taskId = started.taskId;
  item.status = 'processing';
  await ports.save(p);
  return 'started';
}
