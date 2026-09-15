import {useCallback, useEffect, useRef, useState} from 'react';
import {
  aiWorkflowCommand,
  aiError,
  INTAKE_LABELS,
  DEFAULT_INTAKE_POLICY,
  type AiWorkflowClient,
  type IntakeRecord,
  type AiTask,
} from '../api/ai_workflow_client.js';
import {createCommandKey} from '../components/client_identity.js';

export function DocumentIntakePanel({
  snapshotId,
  title,
  client = aiWorkflowCommand,
  onChanged,
  onOpenDocument,
}: {
  readonly snapshotId: string;
  readonly title: string;
  readonly client?: AiWorkflowClient;
  readonly onChanged: () => void;
  readonly onOpenDocument: (id: string) => void;
}) {
  const [record, setRecord] = useState<IntakeRecord>();
  const [task, setTask] = useState<AiTask>();
  const [ready, setReady] = useState(false);
  const [reason, setReason] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const taskKey = useRef(createCommandKey('intake'));
  const generation = useRef(0);
  const load = useCallback(async () => {
    const request = ++generation.current;
    try {
      const [intake, tasks] = await Promise.all([
        client<{records: IntakeRecord[]}>('intake_status'),
        client<AiTask[]>('tasks_list'),
      ]);
      if (request !== generation.current) return;
      const row = intake.records.find(
        (r) =>
          r.snapshotId === snapshotId ||
          r.value.preparedSnapshotId === snapshotId,
      );
      setRecord(row);
      setTask(
        tasks.find(
          (t) => t.request.snapshotId === (row?.snapshotId ?? snapshotId),
        ),
      );
      setReady(true);
    } catch (error) {
      if (request === generation.current) setMessage(aiError(error));
    }
  }, [snapshotId, client]);
  const invalidate = useCallback(() => {
    generation.current++;
  }, []);
  useEffect(() => {
    const timer = globalThis.setTimeout(() => {
      void load();
    }, 0);
    return () => {
      invalidate();
      globalThis.clearTimeout(timer);
    };
  }, [load, invalidate]);
  async function act(operation: string, input: unknown, success: string) {
    if (busy) return;
    setBusy(true);
    setMessage('');
    try {
      await client(operation, input);
      setMessage(success);
      onChanged();
    } catch (error) {
      setMessage(aiError(error));
    } finally {
      await load();
      setBusy(false);
    }
  }
  const root = record?.snapshotId ?? snapshotId;
  const decision = record?.value.decision ?? 'pending';
  return (
    <section className="ai-workflow-panel" aria-busy={busy}>
      <h3>{title}</h3>
      <p>
        <strong>{ready ? INTAKE_LABELS[decision] : '正在读取…'}</strong>
        {record?.value.origin === 'manual'
          ? ' · 人工决定'
          : record?.value.origin === 'model'
            ? ' · AI 审核'
            : ''}
      </p>
      {record?.value.reason ? (
        <p>{record.value.reason}</p>
      ) : (
        <p>
          可先获取全文，再审核完整性与内容价值。拒收保留已接收的原文和已完成的条目。
        </p>
      )}
      {record?.value.assessment ? (
        <p>
          正文：
          {
            {complete: '完整', summary: '摘要或节选', uncertain: '待核对'}[
              record.value.assessment.completeness
            ]
          }
        </p>
      ) : null}
      <div className="entry-command-actions">
        <button
          type="button"
          className="secondary-action"
          onClick={() => {
            onOpenDocument(root);
          }}
        >
          阅读接收原文
        </button>
        {record?.value.preparedSnapshotId ? (
          <button
            type="button"
            className="secondary-action"
            onClick={() => {
              onOpenDocument(record.value.preparedSnapshotId ?? snapshotId);
            }}
          >
            阅读网页正文
          </button>
        ) : null}
      </div>
      <label className="field">
        <span>人工决定的原因（选填）</span>
        <textarea
          rows={2}
          maxLength={500}
          value={reason}
          onChange={(e) => {
            setReason(e.currentTarget.value);
          }}
        />
      </label>
      <div className="entry-command-actions">
        <button
          type="button"
          className="secondary-action"
          disabled={busy || !ready || decision === 'blocked'}
          onClick={() => {
            void act(
              'intake_control',
              {
                snapshotId: root,
                expectedVersion: record?.version ?? 0,
                action: 'block',
                reason: reason.trim() || '人工拒收：停止本篇后续自动处理。',
              },
              '已拒收，原文与已有处理结果保留。',
            );
          }}
        >
          拒收 / 拦截
        </button>
        <button
          type="button"
          className="secondary-action"
          disabled={busy || !ready}
          onClick={() => {
            void act(
              'intake_control',
              {
                snapshotId: root,
                expectedVersion: record?.version ?? 0,
                action: 'admit',
                reason: reason.trim() || '人工核对后放行。',
              },
              '已人工放行。需要时可继续下方任务。',
            );
          }}
        >
          人工放行
        </button>
        <button
          type="button"
          className="text-action"
          disabled={busy || !ready || !record}
          onClick={() => {
            void act(
              'intake_control',
              {
                snapshotId: root,
                expectedVersion: record?.version ?? 0,
                action: 'reset',
                reason: reason.trim() || '恢复待审核状态。',
              },
              '已恢复待审核，可重新获取全文并审核。',
            );
          }}
        >
          恢复待审核
        </button>
      </div>
      <p className="workflow-boundary-note">
        人工放行会跳过本篇的 AI
        接收判断；恢复待审核会再次判断。两者都不会自行启动任务。
      </p>
      <div className="entry-command-actions">
        <button
          type="button"
          className="secondary-action"
          disabled={
            busy ||
            !ready ||
            decision === 'blocked' ||
            decision === 'held' ||
            Boolean(record?.value.preparedSnapshotId)
          }
          onClick={() => {
            void act(
              'intake_prepare',
              {snapshotId: root},
              '全文获取已完成，请查看接收状态。',
            );
          }}
        >
          获取网页正文
        </button>
        {task && !['succeeded', 'cancelled'].includes(task.state.status) ? (
          <button
            type="button"
            className="primary-action"
            disabled={
              busy ||
              !['failed', 'paused'].includes(task.state.status) ||
              decision === 'blocked' ||
              decision === 'held'
            }
            onClick={() => {
              void act(
                'task_control',
                {
                  taskId: task.taskId,
                  expectedVersion: task.version,
                  action: 'resume',
                },
                '已继续本篇任务。',
              );
            }}
          >
            继续整理任务
          </button>
        ) : (
          <button
            type="button"
            className="primary-action"
            disabled={
              busy ||
              !ready ||
              decision === 'blocked' ||
              decision === 'held' ||
              task?.state.status === 'succeeded'
            }
            onClick={() => {
              void act(
                'task_start',
                {
                  requestKey: taskKey.current,
                  request: {
                    kind: 'document',
                    snapshotId: root,
                    intake: DEFAULT_INTAKE_POLICY,
                    maxEntries: 12,
                    maxRelations: 3,
                    maxRelationCandidates: 12,
                    maxModelCalls: 24,
                  },
                },
                '已创建审核与整理任务，可刷新查看进度。',
              );
            }}
          >
            审核并自动整理
          </button>
        )}
        <button
          type="button"
          className="text-action"
          disabled={busy}
          onClick={() => {
            void load();
          }}
        >
          刷新状态
        </button>
      </div>
      {task ? (
        <p>
          本篇任务：
          {{
            queued: '等待运行',
            running: '处理中',
            paused: '已暂停',
            failed: '失败',
            succeeded: '已完成',
            cancelled: '已取消',
          }[task.state.status] ?? task.state.status}{' '}
          · {task.state.calls} 次调用尝试
          {task.state.errorCode
            ? ' · ' + aiError(new Error(task.state.errorCode))
            : ''}
        </p>
      ) : null}
      <p role="status">{message}</p>
    </section>
  );
}
