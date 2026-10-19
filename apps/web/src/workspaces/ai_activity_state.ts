import {intakeReviewKind, intakeReviewHint} from './inbox_review_state.js';
import type {
  AiTask,
  AiQueueStatus,
  IntakeRecord,
} from '../api/ai_workflow_client.js';
import type {AiPriceStatus} from '../api/ai_price_client.js';
import type {ReportSummary} from '../api/report_client.js';
import type {EvidenceSnapshotSummary} from '../api/m1c_api_contract.js';
import {
  compactDocumentTitle,
  sourceDisplayName,
} from '../components/reading_text.js';
import {aiError} from '../api/ai_workflow_client.js';

export interface AiActivityData {
  model?: string;
  price?: AiPriceStatus;
  tasks: AiTask[];
  intakeRecords: IntakeRecord[];
  reports: ReportSummary[];
  queue: AiQueueStatus;
  checkedAt: string;
}
export type ActivityState =
  | 'working'
  | 'queued'
  | 'price'
  | 'paused'
  | 'review'
  | 'failed'
  | 'attention'
  | 'settled'
  | 'done';
export interface AiActivityItem {
  id: string;
  kind: string;
  title: string;
  detail: string;
  state: ActivityState;
  updatedAt: string;
  snapshotId?: string;
  reviewSnapshotId?: string;
  stages?: AiArticleStage[];
  actor?: string;
  phase?: string;
  interrupted?: boolean;
  createdAt?: string;
  destination: 'import' | 'settings' | 'reports' | 'documents';
}
const PHASES: Record<string, string> = {
  intake: '核对完整性与接收规则',
  split: '整理文档结构',
  tags: '提取与添加标签',
  recall: '查找相关资料',
  relations: '评估并建立联系',
  publish: '确认文档入库',
  complete: '已入库',
};
export const ACTIVITY_LABELS: Record<ActivityState, string> = {
  working: '进行中',
  queued: '排队中',
  price: '等待低价',
  paused: '全局暂停',
  review: '待你决定',
  failed: '失败待重试',
  attention: '待手动继续',
  settled: '决定已更新',
  done: '已完成',
};
export function activityItems(
  data: AiActivityData,
  snapshots: readonly EvidenceSnapshotSummary[],
): AiActivityItem[] {
  const sources = new Map(
    snapshots.filter((s) => !s.isPrivate).map((s) => [s.snapshotId, s]),
  );
  const records = new Map(
    data.intakeRecords.flatMap((record) =>
      [
        record.snapshotId,
        record.value.preparedSnapshotId,
        ...(record.value.previousPreparedSnapshotIds ?? []),
      ]
        .filter((id): id is string => Boolean(id))
        .map((id) => [id, record] as const),
    ),
  );
  const tasks: AiActivityItem[] = data.tasks
    .filter(
      (t) =>
        ['intake', 'document'].includes(t.request.kind) &&
        t.state.status !== 'cancelled' &&
        !t.state.supersededBy,
    )
    .map((task) => {
      const phase = PHASES[task.state.phase] ?? '处理资料';
      const record = records.get(task.request.snapshotId ?? '');
      const held =
        task.state.errorCode === 'intake_held' ||
        task.state.steps.some((s) => s.outcome === 'held');
      const source = sources.get(
        record?.snapshotId ?? task.request.snapshotId ?? '',
      );
      let state: ActivityState = 'attention',
        detail = phase;
      const running =
        task.runtimeStatus === 'running' && task.state.status === 'running';
      if (running) {
        state = 'working';
        if (data.price?.policy.operationsAllowed === false)
          detail += ' · 当前请求结束后全局暂停';
        else if (task.cancelRequested) detail += ' · 本步结束后取消';
        else if (task.pauseRequested) detail += ' · 本步结束后暂停';
      } else if (
        record?.value.receipt === 'rejected' ||
        record?.value.decision === 'blocked'
      ) {
        state = 'settled';
        detail = '你已拒绝或拦截这份资料，原任务记录保留';
      } else if (
        task.runtimeStatus === 'running' &&
        ['queued', 'paused', 'failed'].includes(task.state.status) &&
        !task.pauseRequested &&
        !task.cancelRequested
      ) {
        state = 'queued';
        detail = '等待前序任务完成 · ' + phase;
      } else if (task.state.status === 'failed') {
        state = 'failed';
        detail =
          phase +
          ' · ' +
          (task.state.errorCode
            ? aiError(new Error(task.state.errorCode))
            : '任务未完成，请检查后重试');
      } else if (held) {
        if (!record) {
          detail = '审核曾暂缓，当前接收记录不可用，请到收件箱核对';
        } else if (intakeReviewKind(record)) {
          state = 'review';
          detail = intakeReviewHint(record);
        } else if (task.state.status === 'succeeded') {
          state = 'settled';
          detail = '接收决定已更新，原审核记录保留；整理另行启动';
        } else {
          detail = '接收判断已更新，整理任务需手动继续';
        }
      } else if (task.state.status === 'succeeded') {
        state = 'done';
        detail =
          task.request.kind === 'intake'
            ? '已接受；整理尚未启动'
            : '文档整理已完成';
      } else if (task.cancelRequested || task.pauseRequested) {
        detail = task.cancelRequested
          ? '等待取消完成'
          : '已手动暂停，需要手动继续';
      } else if (task.runtimeStatus === 'interrupted') {
        detail = '运行已中断，需要检查后继续';
      } else if (
        task.actorKind === 'automation' &&
        (!data.queue.policy.settings.enabled ||
          data.queue.policy.settings.paused)
      ) {
        detail = '自动处理策略已关闭或暂停';
      } else if (!data.model || task.model !== data.model) {
        detail = '模型不可用或配置已变化，需要检查后继续';
      } else if (
        task.state.status === 'paused' &&
        task.state.errorCode === 'ai_operations_paused'
      ) {
        state = 'paused';
        detail = '等待允许 AI 继续 · ' + phase;
      } else if (
        task.state.status === 'paused' &&
        task.state.errorCode === 'ai_price_window_closed'
      ) {
        state = 'price';
        detail = '到允许时段后自动继续 · ' + phase;
      } else if (
        task.state.status === 'paused' &&
        task.state.errorCode === 'ai_batch_budget_paused'
      ) {
        state = 'paused';
        detail = aiError(new Error(task.state.errorCode)) + ' · ' + phase;
      } else if (
        task.state.status === 'paused' &&
        task.state.automaticRetry?.notBefore
      ) {
        const retry = task.state.automaticRetry;
        const enabled =
          (data.price?.policy.automaticRetryLimit ?? 0) >= retry.used;
        state = enabled ? 'queued' : 'paused';
        detail = enabled
          ? `自动断点重试 ${String(retry.used)}/${String(retry.limit)} · 最早 ${beijingTime(task.state.automaticRetry.notBefore)} · ${phase}`
          : '自动重试已关闭，等待手动继续';
        if (enabled && data.price?.blocked) detail += ' · 仍需等待低价时段';
        if (enabled && data.price?.policy.operationsAllowed === false) {
          state = 'paused';
          detail = '等待允许 AI 继续 · ' + detail;
        }
      } else {
        detail = task.state.errorCode
          ? aiError(new Error(task.state.errorCode))
          : '尚未运行，需要手动继续';
      }
      return {
        id: task.taskId,
        phase: task.state.phase,
        interrupted: task.runtimeStatus === 'interrupted',
        actor:
          task.actorKind === 'automation'
            ? '自动任务'
            : task.actorKind === 'external_agent'
              ? '外部 Agent'
              : '手动发起',
        ...(task.createdAt ? {createdAt: task.createdAt} : {}),
        ...(task.request.snapshotId
          ? {
              snapshotId:
                task.state.steps.find((step) => step.kind === 'split')
                  ?.targetId ?? task.request.snapshotId,
            }
          : {}),
        ...(state === 'review' && record
          ? {reviewSnapshotId: record.snapshotId}
          : {}),
        stages: articleStages(task).map((stage) =>
          stage.state === 'held' && state !== 'review'
            ? {...stage, detail: '原审核暂缓'}
            : stage,
        ),
        kind: task.request.kind === 'intake' ? '接收审核' : '文档整理',
        title: source
          ? compactDocumentTitle(sourceDisplayName(source))
          : '文档 ' + (task.request.snapshotId ?? task.taskId).slice(0, 8),
        state,
        detail,
        updatedAt: task.updatedAt ?? task.createdAt ?? '',
        destination:
          state === 'review' || task.request.kind === 'intake'
            ? 'import'
            : 'documents',
      };
    });
  // Current intake state owns the decision queue, even when its original task is outside the recent-task limit.
  const reviews = data.intakeRecords.flatMap<AiActivityItem>((record) => {
    const source = sources.get(record.snapshotId);
    if (
      !source ||
      !intakeReviewKind(record) ||
      tasks.some(
        (item) =>
          item.state === 'review' &&
          item.reviewSnapshotId === record.snapshotId,
      )
    )
      return [];
    return [
      {
        id: 'review-' + record.snapshotId,
        snapshotId: record.snapshotId,
        reviewSnapshotId: record.snapshotId,
        kind: intakeReviewKind(record) === 'receipt' ? '接收核对' : '整理核对',
        title: compactDocumentTitle(sourceDisplayName(source)),
        state: 'review',
        detail: intakeReviewHint(record),
        updatedAt: record.updatedAt,
        destination: 'import',
      },
    ];
  });
  const reports: AiActivityItem[] = data.reports
    .filter((r) => !['draft', 'cancelled'].includes(r.status))
    .map((r) => {
      let state: ActivityState = 'attention',
        detail = '生成已中断，需要检查后继续';
      if (['ready', 'reviewed'].includes(r.status)) {
        state = 'done';
        detail =
          r.status === 'ready' ? '报告已生成，等待你阅览与核对' : '报告已核对';
      } else if (r.active && r.status === 'running') {
        state = 'working';
        detail = r.planned
          ? '撰写摘要 · 已完成 ' +
            String(r.completedItemCount ?? 0) +
            ' / ' +
            String(r.itemCount) +
            ' 条'
          : '归并事件与规划选题';
      } else if (
        r.errorCode === 'ai_operations_paused' &&
        r.status === 'queued'
      ) {
        state = 'paused';
        detail = '等待允许 AI 继续生成';
      } else if (
        r.errorCode === 'ai_price_window_closed' &&
        r.status === 'queued' &&
        data.model
      ) {
        state = 'price';
        detail = '到允许时段后自动继续生成';
      } else if (r.active && r.status === 'queued') {
        state = 'queued';
        detail = '等待前序报告完成';
      } else if (r.errorCode) {
        state = 'failed';
        detail = '生成失败，请到报告页检查后重试';
      }
      return {
        id: r.reportId,
        phase: 'report',
        kind: {
          daily: '日报',
          weekly: '周报',
          monthly: '月报',
          topic: '专题报告',
        }[r.kind],
        title: r.title,
        state,
        detail,
        updatedAt: r.updatedAt ?? '',
        destination: 'reports',
      };
    });
  const scheduled: AiActivityItem[] = data.queue.items
    .filter(
      (item) =>
        item.status === 'pending' &&
        !data.tasks.some(
          (task) =>
            task.taskId === item.taskId ||
            task.request.snapshotId === item.snapshotId,
        ) &&
        !['rejected'].includes(
          records.get(item.snapshotId)?.value.receipt ?? '',
        ) &&
        records.get(item.snapshotId)?.value.decision !== 'blocked',
    )
    .map((item) => {
      const enabled =
        data.queue.policy.settings.enabled &&
        !data.queue.policy.settings.paused;
      const source = sources.get(item.snapshotId);
      return {
        id: 'scheduled-' + item.snapshotId,
        snapshotId: item.snapshotId,
        title: source
          ? compactDocumentTitle(sourceDisplayName(source))
          : (item.sourceLabel ?? '等待接收的文档'),
        actor: '自动任务',
        kind: '接收审核',
        phase: 'intake',
        destination: 'import',
        state:
          !enabled || data.price?.policy.operationsAllowed === false
            ? 'paused'
            : data.price?.blocked
              ? 'price'
              : 'queued',
        detail: !enabled
          ? '自动处理策略已暂停，尚未创建整理任务'
          : '已由自动策略安排，等待每日额度、价格时段与队列调度',
        createdAt: item.createdAt ?? '',
        updatedAt: item.createdAt ?? '',
      };
    });
  const rank: Record<ActivityState, number> = {
    working: 0,
    queued: 1,
    price: 2,
    paused: 3,
    review: 4,
    failed: 5,
    attention: 6,
    settled: 7,
    done: 8,
  };
  return [...tasks, ...reviews, ...scheduled, ...reports].sort(
    (a, b) =>
      rank[a.state] - rank[b.state] ||
      (a.state === 'queued'
        ? (a.createdAt ?? a.updatedAt).localeCompare(b.createdAt ?? b.updatedAt)
        : b.updatedAt.localeCompare(a.updatedAt)),
  );
}
export function activitySummary(data: AiActivityData, items: AiActivityItem[]) {
  const working = items.filter((i) => i.state === 'working');
  const queued = items.filter((i) => i.state === 'queued');
  const price = items.filter((i) => i.state === 'price');
  const attention = items.filter((i) => i.state === 'attention');
  const review = [
    ...new Map(
      items
        .filter((i) => i.state === 'review')
        .map((i) => [i.reviewSnapshotId ?? i.snapshotId ?? i.id, i]),
    ).values(),
  ];
  const failed = items.filter((i) => i.state === 'failed');
  const paused = items.filter((i) => i.state === 'paused');
  const allowed = data.price?.policy.operationsAllowed !== false;
  const waiting = [...queued, ...price, ...paused];
  const nextAllowedAt =
    allowed && waiting.length && data.price?.blocked
      ? data.price.nextAllowedAt
      : null;
  const nextKinds = [...new Set(waiting.map((i) => i.kind))].join('、');
  const headline = !allowed
    ? working.length
      ? 'AI 正在收尾，后续操作已禁止'
      : 'AI 后续操作已禁止'
    : working.length
      ? 'AI 正在工作'
      : !data.model
        ? '内置 AI 未配置'
        : nextAllowedAt
          ? 'AI 等待低价时段'
          : waiting.length
            ? 'AI 等待继续'
            : review.length
              ? 'AI 当前空闲，有资料待你决定'
              : failed.length
                ? 'AI 当前空闲，有任务失败待重试'
                : attention.length
                  ? 'AI 当前空闲，有任务待手动继续'
                  : 'AI 当前空闲';
  const next = !allowed
    ? '等待你允许 AI 继续；价格限制仍然有效。'
    : nextAllowedAt
      ? '最早 ' + beijingTime(nextAllowedAt) + ' 起继续；实际开始取决于队列。'
      : waiting.length
        ? working.length
          ? '前序任务结束后继续，暂无确切开始时间。'
          : '等待调度器继续，暂无确切开始时间。'
        : '没有已排队的下一次任务。';
  return {
    working,
    waiting,
    attention,
    review,
    failed,
    nextAllowedAt,
    headline,
    next,
    nextKinds,
  };
}
export function beijingTime(value: string): string {
  return (
    new Intl.DateTimeFormat('zh-CN', {
      timeZone: 'Asia/Shanghai',
      month: 'numeric',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(new Date(value)) + '（北京时间）'
  );
}

export interface AiArticleStage {
  label: string;
  state: 'done' | 'active' | 'pending' | 'held';
  detail: string;
  completed: number;
  total: number;
}
export function articleStages(task: AiTask): AiArticleStage[] {
  return [
    ['intake', '审核'],
    ['split', '结构'],
    ['tags', '标签'],
    ['relation', '联系'],
    ['publish', '入库'],
  ].map(([kind, label]) => {
    const steps = task.state.steps.filter((s) => s.kind === kind);
    const complete = steps.filter((s) => s.complete).length;
    const held = steps.some((s) => s.outcome === 'held');
    const done =
      !held &&
      ((kind === 'publish' &&
        task.request.kind === 'document' &&
        task.state.status === 'succeeded') ||
        (steps.length > 0 && complete === steps.length) ||
        (kind === 'relation' &&
          task.request.kind === 'document' &&
          task.state.status === 'succeeded'));
    const active =
      !done &&
      !held &&
      (task.state.phase === kind ||
        (kind === 'relation' &&
          ['recall', 'relations'].includes(task.state.phase)));
    const state = held ? 'held' : done ? 'done' : active ? 'active' : 'pending';
    let detail = done ? '已完成' : active ? '待继续' : '未启动';
    if (kind === 'intake' && held) detail = '待你决定';
    else if (kind === 'intake' && steps.some((s) => s.outcome === 'accepted'))
      detail = '已接受';
    else if (kind === 'split' && done) detail = '结构已保存';
    else if (kind === 'relation' && done && !steps.length) detail = '无候选';
    else if (steps.length)
      detail = String(complete) + ' / ' + String(steps.length);
    else if (
      task.request.kind === 'document' &&
      task.state.status === 'succeeded' &&
      !done
    )
      detail = '未请求';
    return {
      label: label ?? '',
      state,
      detail,
      completed: complete,
      total: steps.length,
    };
  });
}
/** One newest request per document; earlier attempts remain in the task history. */
export function latestArticleItems(items: AiActivityItem[]): AiActivityItem[] {
  const latest = new Map<string, AiActivityItem>();
  for (const item of [...items].sort((a, b) =>
    b.updatedAt.localeCompare(a.updatedAt),
  )) {
    if (item.snapshotId && !latest.has(item.snapshotId))
      latest.set(item.snapshotId, item);
  }
  return [...latest.values()];
}
