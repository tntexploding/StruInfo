import {
  aiError,
  type AiTask,
  type IntakeRecord,
} from '../api/ai_workflow_client.js';

export type ProcessingStageId = 'intake' | 'split' | 'tags' | 'relations';
export interface ProcessingStage {
  id: ProcessingStageId;
  label: string;
  detail: string;
  state: 'done' | 'waiting' | 'active' | 'attention' | 'idle';
}
export interface DocumentProcessing {
  task?: AiTask | undefined;
  intake?: IntakeRecord | undefined;
  targetSnapshotId: string;
  historical: boolean;
  label: string;
  tone: 'quiet' | 'active' | 'attention' | 'done';
  reason: string;
  stages: ProcessingStage[];
}
export function intakeForDocument(
  snapshotId: string,
  records: readonly IntakeRecord[],
) {
  return records.find(
    (r) =>
      r.snapshotId === snapshotId ||
      r.value.preparedSnapshotId === snapshotId ||
      r.value.previousPreparedSnapshotIds?.includes(snapshotId),
  );
}
export function processingForDocument(
  snapshotId: string,
  tasks: readonly AiTask[],
  records: readonly IntakeRecord[],
): DocumentProcessing {
  const intake = intakeForDocument(snapshotId, records);
  const ids = new Set([snapshotId, intake?.snapshotId]);
  // Root and selected full text share a task; old captures must not inherit new results.
  if (intake?.value.preparedSnapshotId)
    ids.add(intake.value.preparedSnapshotId);
  const task = tasks
    .filter((t) => t.request.snapshotId && ids.has(t.request.snapshotId))
    .sort(
      (a, b) =>
        (b.createdAt ?? '').localeCompare(a.createdAt ?? '') ||
        b.taskId.localeCompare(a.taskId),
    )[0];
  const split = task?.state.steps.find((s) => s.kind === 'split');
  const targetSnapshotId =
    split?.targetId ??
    (intake?.value.bodySource === 'received'
      ? intake.snapshotId
      : (intake?.value.preparedSnapshotId ?? snapshotId));
  const historical = Boolean(
    intake?.value.previousPreparedSnapshotIds?.includes(snapshotId),
  );
  let label = '尚无 AI 文档任务',
    tone: DocumentProcessing['tone'] = 'quiet',
    reason = '这份资料仍可人工整理。';
  if (task) {
    if (task.state.status === 'succeeded') {
      label =
        task.request.kind === 'intake'
          ? 'AI 已接受 · 未启动整理'
          : 'AI 处理完成';
      tone = task.request.kind === 'intake' ? 'quiet' : 'done';
      reason =
        task.request.kind === 'intake'
          ? '仅完成接收审核；拆分、标签与联系尚未启动。'
          : '处理记录不等于内容已经人工核查。';
    } else if (task.cancelRequested || task.state.status === 'cancelled') {
      label = 'AI 已取消';
      reason = '已完成的条目和标注保留。';
    } else if (task.pauseRequested) {
      label = 'AI 已手动暂停';
      tone = 'attention';
      reason = '已完成的结果保留，等待手动继续。';
    } else if (task.state.errorCode === 'ai_operations_paused') {
      label = 'AI 已全局暂停';
      reason = '在总览允许继续后，仍按原任务范围和价格时段处理。';
    } else if (task.state.errorCode === 'ai_price_window_closed') {
      label = 'AI 等待低价时段';
      reason = '到允许时段后自动续跑；等待本身不消耗调用额度。';
    } else if (task.runtimeStatus === 'interrupted') {
      label = 'AI 待恢复';
      tone = 'attention';
      reason = '任务未在运行，请在 AI 设置中检查并继续。';
    } else if (['paused', 'failed'].includes(task.state.status)) {
      label = task.state.steps.some((s) => s.complete)
        ? 'AI 部分完成'
        : 'AI 需要处理';
      tone = 'attention';
      reason = task.state.errorCode
        ? aiError(new Error(task.state.errorCode))
        : '任务已暂停，请检查后继续。';
    } else {
      label = task.state.status === 'queued' ? 'AI 已排队' : 'AI 处理中';
      tone = 'active';
      reason = '状态来自已保存任务，完成的结果会自动更新。';
    }
    if (task.request.kind === 'split') label = label.replace('AI', 'Agent');
  }
  if (intake && ['held', 'blocked'].includes(intake.value.decision)) {
    label = intake.value.decision === 'blocked' ? '整理已拦截' : '整理已暂缓';
    tone = 'attention';
    reason = intake.value.reason;
  }
  const steps = task?.state.steps ?? [];
  const tags = steps.filter((s) => s.kind === 'tags');
  const tagged = tags.filter((s) => s.complete).length;
  const relations = steps.filter((s) => s.kind === 'relation');
  const completedRelations = relations.filter((s) => s.complete);
  const edges = completedRelations.filter(
    (s) => s.proposalId && !s.outcome,
  ).length;
  const noRelations = completedRelations.filter(
    (s) => s.outcome === 'no_relation',
  ).length;
  const skipped = completedRelations.filter(
    (s) => s.outcome === 'edge_budget_reached',
  ).length;
  const done = task?.state.status === 'succeeded';
  const stageState = (
    id: ProcessingStageId,
    complete: boolean,
  ): ProcessingStage['state'] => {
    if (complete) return 'done';
    if (!task) return 'idle';
    if (
      id !== task.state.phase &&
      !(id === 'relations' && task.state.phase === 'recall')
    )
      return 'idle';
    return tone === 'active'
      ? 'active'
      : tone === 'attention'
        ? 'attention'
        : 'waiting';
  };
  const awaiting = task && task.request.kind !== 'intake' ? '待处理' : '未启动';
  const intakeDone =
    intake?.value.decision === 'admitted' ||
    steps.some((s) => s.kind === 'intake' && s.complete);
  const stages: ProcessingStage[] = [
    {
      id: 'intake',
      label: '接收审核',
      state:
        intake && ['held', 'blocked'].includes(intake.value.decision)
          ? 'attention'
          : stageState('intake', intakeDone),
      detail:
        intake?.value.decision === 'blocked'
          ? '已拦截'
          : intake?.value.decision === 'held'
            ? '已暂缓'
            : intakeDone
              ? intake?.value.origin === 'manual'
                ? '人工放行'
                : '已放行'
              : done
                ? '未请求'
                : awaiting,
    },
    {
      id: 'split',
      label: '拆分',
      state: stageState('split', Boolean(split?.complete)),
      detail: split?.complete
        ? tags.length === 1
          ? '整篇保留'
          : tags.length > 1
            ? `${tags.length.toString()} 个条目`
            : '已生成条目'
        : awaiting,
    },
    {
      id: 'tags',
      label: '标签',
      state: stageState('tags', tags.length > 0 && tagged === tags.length),
      detail: tags.length
        ? `${tagged.toString()} / ${tags.length.toString()} 条完成`
        : done
          ? '未请求'
          : awaiting,
    },
    {
      id: 'relations',
      label: '联系',
      state: stageState(
        'relations',
        Boolean(
          (done && task.request.kind !== 'intake') ||
          (relations.length && completedRelations.length === relations.length),
        ),
      ),
      detail: relations.length
        ? `已建 ${edges.toString()} · 未建 ${noRelations.toString()}${skipped ? ` · ${skipped.toString()} 未评估` : ''}`
        : done
          ? task.request.kind === 'document'
            ? '无候选'
            : '未请求'
          : awaiting,
    },
  ];
  return {
    task,
    intake,
    targetSnapshotId,
    historical,
    label,
    tone,
    reason,
    stages,
  };
}
