import {useCallback, useEffect, useRef, useState} from 'react';
import {
  aiWorkflowCommand,
  aiError,
  DEFAULT_INTAKE_POLICY,
  type AiQueueStatus,
  type AiTask,
} from '../api/ai_workflow_client.js';

export function useInboxAiReview(
  snapshotIds: readonly string[],
  onChanged: () => void,
) {
  const [tasks, setTasks] = useState<AiTask[]>([]);
  const [modelConfigured, setModelConfigured] = useState(false);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const changed = useRef(onChanged);
  useEffect(() => {
    changed.current = onChanged;
  }, [onChanged]);
  const scope = snapshotIds.join(',');
  const generation = useRef(0);
  const versions = useRef<{scope: string; signature: string} | undefined>(
    undefined,
  );
  const submitting = useRef(false);
  const load = useCallback(async () => {
    const current = ++generation.current;
    try {
      const [status, rows] = await Promise.all([
        aiWorkflowCommand<AiQueueStatus>('ingestion_status'),
        scope
          ? aiWorkflowCommand<AiTask[]>('tasks_list', {
              snapshotIds: scope.split(','),
            })
          : Promise.resolve([]),
      ]);
      if (current !== generation.current) return;
      const reviewTasks = rows.filter((t) =>
        ['intake', 'document'].includes(t.request.kind),
      );
      const signature = reviewTasks
        .map((t) => t.taskId + ':' + t.version.toString())
        .join(',');
      if (scope) {
        const previous = versions.current;
        versions.current = {scope, signature};
        if (previous?.scope === scope && previous.signature !== signature)
          changed.current();
      }
      setTasks(reviewTasks);
      setModelConfigured(status.modelConfigured);
      setReady(true);
    } catch (error) {
      if (current === generation.current) {
        setReady(false);
        setMessage(aiError(error));
      }
    }
  }, [scope]);
  const invalidate = useCallback(() => {
    generation.current++;
  }, []);
  useEffect(() => {
    const timer = globalThis.setTimeout(() => {
      void load();
    }, 0);
    const interval = globalThis.setInterval(() => {
      if (document.visibilityState === 'visible') void load();
    }, 5000);
    return () => {
      invalidate();
      globalThis.clearTimeout(timer);
      globalThis.clearInterval(interval);
    };
  }, [load, invalidate]);
  async function start(
    items: readonly {snapshotId: string; expectedVersion: number}[],
  ) {
    if (submitting.current || !items.length) return false;
    if (items.length > 32) {
      setMessage('每批最多审核 32 份，请减少选择后继续。');
      return false;
    }
    submitting.current = true;
    setBusy(true);
    setMessage('');
    let started = 0;
    const failed: string[] = [];
    try {
      const status = await aiWorkflowCommand<AiQueueStatus>('ingestion_status');
      if (!status.modelConfigured) throw new Error('ai_not_configured');
      for (const item of items) {
        try {
          await aiWorkflowCommand<AiTask>('task_start', {
            requestKey:
              'receipt-' +
              item.snapshotId +
              '-' +
              item.expectedVersion.toString(),
            request: {
              kind: 'document',
              snapshotId: item.snapshotId,
              expectedReceiptVersion: item.expectedVersion,
              maxEntries: status.policy.settings.maxEntries,
              intake: status.policy.settings.intake ?? DEFAULT_INTAKE_POLICY,
              maxModelCalls: status.policy.settings.maxModelCalls,
            },
          });
          started++;
        } catch (error) {
          failed.push(aiError(error));
        }
      }
      setMessage(
        '已提交 ' +
          started.toString() +
          ' 份 AI 审核与整理任务。' +
          (failed.length
            ? failed.length.toString() + ' 份未提交：' + (failed[0] ?? '')
            : 'AI 审核通过后拆分、标注并确认入库。主题与联系单独处理；不确定的资料留待你决定。'),
      );
    } catch (error) {
      setMessage(aiError(error));
    } finally {
      submitting.current = false;
      setBusy(false);
      await load();
      changed.current();
    }
    return started > 0;
  }
  return {tasks, modelConfigured, ready, busy, message, start};
}

export function receiptTaskStatus(task: AiTask): string {
  if (task.request.kind === 'document' && task.state.status === 'succeeded')
    return '已入库';
  if (task.state.status === 'succeeded')
    return task.state.steps.some((s) => s.outcome === 'accepted')
      ? 'AI 已接受 · 未启动整理'
      : 'AI 暂缓 · 请查看原因';
  if (task.state.errorCode === 'ai_operations_paused' && !task.pauseRequested)
    return 'AI 已全局暂停';
  if (task.state.errorCode === 'ai_price_window_closed' && !task.pauseRequested)
    return 'AI 审核等待低价时段';
  if (task.request.kind === 'document' && task.state.status === 'running')
    return (
      (
        {
          intake: '正在审核',
          split: '正在拆分',
          tags: '正在标注',
          recall: '正在寻找联系',
          relations: '正在建立联系',
          publish: '正在入库',
        } as Record<string, string>
      )[task.state.phase] ?? '正在处理'
    );
  if (
    task.state.errorCode === 'intake_held' ||
    task.state.errorCode === 'intake_blocked'
  )
    return 'AI 暂缓 · 请查看原因';
  return (
    (
      {
        queued: 'AI 审核已排队',
        running: 'AI 正在审核',
        paused: 'AI 审核已暂停',
        failed: 'AI 审核未完成',
        cancelled: 'AI 审核已取消',
      } as Record<string, string>
    )[task.state.status] ?? 'AI 接收审核'
  );
}
