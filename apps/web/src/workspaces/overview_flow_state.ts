import type {ProductSection} from '../components/product_types.js';
import type {AiActivityData, AiActivityItem} from './ai_activity_state.js';

export const FLOW_STAGES = [
  {
    id: 'intake',
    label: '接收',
    caption: '订阅与文档审核',
    destination: 'import',
    action: '打开文档入口',
    description: '新收到的文档在这里等待审核；接受后进入整理流程。',
  },
  {
    id: 'split',
    label: '拆分',
    caption: '保留上下文与结构',
    destination: 'documents',
    action: '打开工作台',
    description:
      '连贯文章整篇保留；可独立理解的合集按内容拆分，原文与证据始终可回溯。',
  },
  {
    id: 'tags',
    label: '标签',
    caption: '提取主题与概念',
    destination: 'documents',
    action: '打开工作台',
    description: '为条目提取标签，保留人工修改，形成可检索的主题标记。',
  },
  {
    id: 'relations',
    label: '联系',
    caption: '召回与关联资料',
    destination: 'query',
    action: '打开数据阅览',
    description:
      '查找相关资料并判断联系。没有合适的联系也可完成；整理完毕后发布知识版本。',
  },
  {
    id: 'store',
    label: '入库',
    caption: '原文保存与发布',
    destination: 'documents',
    action: '打开工作台',
    description:
      '接收原文先保存到工作台。拆分、标签与联系完成后，确认发布的版本才进入查询和报告。',
  },
  {
    id: 'report',
    label: '报告',
    caption: '汇总与阅读输出',
    destination: 'reports',
    action: '打开报告',
    description: '从已发布的知识生成报告，保留引用，供阅览、核对与导出。',
  },
] as const satisfies readonly {
  id: string;
  label: string;
  caption: string;
  destination: ProductSection;
  action: string;
  description: string;
}[];
export type FlowStageId = (typeof FLOW_STAGES)[number]['id'];
export type FlowTone =
  'idle' | 'working' | 'waiting' | 'review' | 'failed' | 'done' | 'unknown';
export const FLOW_LABELS: Record<FlowTone, string> = {
  idle: '暂无任务',
  working: '运行中',
  waiting: '等待调度',
  review: '待你复核',
  failed: '故障待处理',
  done: '已完成',
  unknown: '状态待刷新',
};
export function itemStage(item: AiActivityItem): FlowStageId {
  if (item.destination === 'reports') return 'report';
  if (item.state === 'review' || item.destination === 'import') return 'intake';
  switch (item.phase) {
    case 'intake':
      return 'intake';
    case 'split':
      return 'split';
    case 'tags':
      return 'tags';
    case 'recall':
    case 'relations':
    case 'complete':
      return 'relations';
    default:
      return 'store';
  }
}
export function itemTone(item: AiActivityItem): FlowTone {
  if (item.state === 'working') return 'working';
  if (
    item.state === 'failed' ||
    (item.state === 'attention' && item.interrupted)
  )
    return 'failed';
  if (item.state === 'review' || item.state === 'attention') return 'review';
  if (item.state === 'done' || item.state === 'settled') return 'done';
  return 'waiting';
}

/** Old attempts never keep a recovered or cancelled document red. */
export function currentOverviewItems(
  data: AiActivityData,
  items: AiActivityItem[],
): AiActivityItem[] {
  const aliases = new Map<string, string>();
  for (const record of data.intakeRecords) {
    for (const id of [
      record.snapshotId,
      record.value.preparedSnapshotId,
      ...(record.value.previousPreparedSnapshotIds ?? []),
    ]) {
      if (id) aliases.set(id, record.snapshotId);
    }
  }
  const latest = new Map<string, string>();
  const tasks = [...data.tasks].filter((t) =>
    ['intake', 'document'].includes(t.request.kind),
  );
  tasks.sort((a, b) =>
    (b.createdAt ?? b.updatedAt ?? '').localeCompare(
      a.createdAt ?? a.updatedAt ?? '',
    ),
  );
  for (const task of tasks) {
    const id = task.request.snapshotId ?? task.taskId;
    const key = aliases.get(id) ?? id;
    if (!latest.has(key)) latest.set(key, task.taskId);
  }
  const latestIds = new Set(latest.values());
  const taskIds = new Set(tasks.map((t) => t.taskId));
  const activeIds = new Set(
    tasks
      .filter(
        (t) =>
          t.runtimeStatus === 'running' &&
          !['succeeded', 'cancelled'].includes(t.state.status),
      )
      .map((t) => t.taskId),
  );
  return items.filter(
    (i) => !taskIds.has(i.id) || latestIds.has(i.id) || activeIds.has(i.id),
  );
}

export function overviewFlow(
  data: AiActivityData | undefined,
  items: AiActivityItem[],
  stale = false,
) {
  const pending =
    data?.intakeRecords.filter(
      (r) => r.value.receipt === 'pending' && r.value.decision !== 'blocked',
    ).length ?? 0;
  return FLOW_STAGES.map((stage) => {
    const completedStage = {
      intake: '审核',
      store: '入库',
      split: '结构',
      tags: '标签',
      relations: '联系',
      report: '报告',
    }[stage.id];
    const stageItems = items.filter(
      (i) =>
        i.state !== 'settled' &&
        (itemStage(i) === stage.id ||
          (i.state === 'done' &&
            i.stages?.some(
              (s) => s.label === completedStage && s.state === 'done',
            ))),
    );
    const counts = {working: 0, waiting: 0, review: 0, failed: 0, done: 0};
    for (const item of stageItems) {
      const tone = itemTone(item);
      if (tone !== 'idle' && tone !== 'unknown') counts[tone]++;
    }
    let tone: FlowTone = counts.failed
      ? 'failed'
      : counts.working
        ? 'working'
        : counts.review
          ? 'review'
          : counts.waiting
            ? 'waiting'
            : counts.done
              ? 'done'
              : 'idle';
    if (
      stage.id === 'intake' &&
      pending &&
      (tone === 'idle' || tone === 'done')
    )
      tone = 'review';
    if (!data || stale) tone = 'unknown';
    return {
      ...stage,
      tone,
      counts,
      items: stageItems,
      pending: stage.id === 'intake' ? pending : 0,
    };
  });
}
