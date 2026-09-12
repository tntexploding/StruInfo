import {useCallback, useEffect, useRef, useState} from 'react';
import {
  aiWorkflowCommand,
  aiError,
  type AiWorkflowClient,
  type AiQueueStatus,
  type AiQueueCursor,
  type AiRuntimeStatus,
  type AiSource,
  type AiTask,
  type AiPolicySettings,
} from '../api/ai_workflow_client.js';
import {createCommandKey} from '../components/client_identity.js';
import {AiPolicyEditor} from './ai_policy_editor.js';
import './ai_workflow_panel.css';
const labels: Record<string, string> = {
  pending: '等待处理',
  running: '处理中',
  paused: '已暂停',
  attention: '需要处理',
  completed: '已完成',
  taken_over: '已接管',
  queued: '等待运行',
  failed: '失败',
  succeeded: '已完成',
  cancelled: '已取消',
  split: '拆分',
  tags: '标签',
  relations: '联系',
  complete: '完成',
};
const statuses = [
  'pending',
  'running',
  'attention',
  'paused',
  'completed',
  'taken_over',
];
interface View {
  scope: string;
  queue: AiQueueStatus;
  runtime: AiRuntimeStatus;
  sources: AiSource[];
  tasks: AiTask[];
}
export function AiWorkflowPanel({
  mode = 'settings',
  client = aiWorkflowCommand,
  onOpenDocument,
  documents = [],
}: {
  readonly mode?: 'settings' | 'queue';
  readonly client?: AiWorkflowClient;
  readonly onOpenDocument?: (id: string) => void;
  readonly documents?: readonly {
    snapshotId: string;
    sourceKey: string;
    isPrivate?: boolean;
  }[];
}) {
  const [view, setView] = useState<View>();
  const [filter, setFilter] = useState('');
  const [cursor, setCursor] = useState<AiQueueCursor>();
  const [history, setHistory] = useState<(AiQueueCursor | undefined)[]>([]);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const generation = useRef(0);
  const load = useCallback(async () => {
    const request = ++generation.current;
    try {
      const [queue, runtime, sources, tasks] = await Promise.all([
        client<AiQueueStatus>('ingestion_status', {
          limit: 20,
          ...(filter ? {status: filter} : {}),
          ...(cursor ? {after: cursor} : {}),
        }),
        client<AiRuntimeStatus>('system_status'),
        client<AiSource[]>('subscriptions_list'),
        client<AiTask[]>('tasks_list'),
      ]);
      if (request === generation.current)
        setView({
          scope: JSON.stringify([filter, cursor]),
          queue,
          runtime,
          sources,
          tasks,
        });
    } catch (error) {
      if (request === generation.current) setMessage(aiError(error));
    }
  }, [client, filter, cursor]);
  const invalidate = useCallback(() => {
    generation.current++;
  }, []);
  useEffect(() => {
    const initial = globalThis.setTimeout(() => {
      void load();
    }, 0);
    const timer = globalThis.setInterval(() => {
      if (document.visibilityState !== 'hidden') void load();
    }, 10000);
    return () => {
      invalidate();
      globalThis.clearTimeout(initial);
      globalThis.clearInterval(timer);
    };
  }, [load, invalidate]);
  async function act(operation: string, input: unknown, success: string) {
    if (busy) return false;
    setBusy(true);
    setMessage('');
    try {
      await client(operation, input);
      setMessage(success);
      await load();
      return true;
    } catch (error) {
      setMessage(aiError(error));
      await load();
      return false;
    } finally {
      setBusy(false);
    }
  }
  async function save(revision: number, settings: AiPolicySettings) {
    return act(
      'ingestion_policy_save',
      {expectedRevision: revision, settings},
      '处理策略已保存。',
    );
  }
  function selectFilter(value: string) {
    generation.current++;
    setFilter(value);
    setCursor(undefined);
    setHistory([]);
  }
  const policy = view?.queue.policy;
  const currentQueue = view?.scope === JSON.stringify([filter, cursor]);
  return (
    <section className="ai-workflow-panel">
      <header className="ai-workflow-heading">
        <div>
          <h2>{mode === 'settings' ? 'AI 自动处理' : '自动处理队列'}</h2>
          <p>
            {policy
              ? !policy.settings.enabled
                ? '自动处理关闭'
                : policy.settings.paused
                  ? '已暂停处理，继续保存新资料'
                  : '按已保存范围自动整理新资料'
              : '正在读取处理状态…'}
          </p>
        </div>
        <div className="entry-command-actions">
          <button
            type="button"
            className="secondary-action"
            disabled={busy}
            onClick={() => {
              void load();
            }}
          >
            刷新处理状态
          </button>
          {policy?.settings.enabled ? (
            <button
              type="button"
              className="secondary-action"
              disabled={busy}
              onClick={() => {
                void save(policy.revision, {
                  ...policy.settings,
                  paused: !policy.settings.paused,
                });
              }}
            >
              {policy.settings.paused ? '恢复自动处理' : '暂停自动处理'}
            </button>
          ) : null}
        </div>
      </header>
      <p role="status" className="ai-workflow-message">
        {message}
      </p>
      {view ? (
        <>
          {mode === 'settings' ? (
            <div className="ai-runtime-status">
              <span>内部模型：{view.runtime.model ?? '未配置'}</span>
              <span>
                外部 Agent：{view.runtime.agentEnabled ? '已配置' : '未配置'}
              </span>
              {view.runtime.agentEnabled ? (
                <span>授权：{view.runtime.grants.join(' / ')}</span>
              ) : null}
            </div>
          ) : null}
          {view.queue.summary ? (
            <dl className="ai-usage-summary">
              <div>
                <dt>等待处理</dt>
                <dd>{view.queue.summary.counts.pending ?? 0}</dd>
              </div>
              <div>
                <dt>需要处理</dt>
                <dd>{view.queue.summary.counts.attention ?? 0}</dd>
              </div>
              <div>
                <dt>今日启动 / 额度</dt>
                <dd>
                  {view.queue.summary.admittedToday} /{' '}
                  {view.queue.policy.settings.maxDocumentsPerDay}
                </dd>
              </div>
              <div>
                <dt>累计调用尝试</dt>
                <dd>{view.queue.summary.modelAttempts}</dd>
              </div>
            </dl>
          ) : null}
          {mode === 'settings' ? (
            <>
              <details className="workflow-tool-drawer">
                <summary>处理范围与预算</summary>
                <AiPolicyEditor
                  policy={view.queue.policy}
                  sources={view.sources}
                  model={view.runtime.model}
                  busy={busy}
                  onSave={save}
                />
              </details>
              <details className="workflow-tool-drawer">
                <summary>手动启动一份文档</summary>
                <SingleDocumentTask
                  documents={documents}
                  disabled={busy || !view.runtime.model}
                  onStart={(snapshotId, key) =>
                    act(
                      'task_start',
                      {
                        requestKey: key,
                        request: {
                          kind: 'document',
                          snapshotId,
                          maxEntries: view.queue.policy.settings.maxEntries,
                          maxRelations: view.queue.policy.settings.maxRelations,
                          maxModelCalls:
                            view.queue.policy.settings.maxModelCalls,
                        },
                      },
                      '文档处理任务已保存。',
                    )
                  }
                />
              </details>
            </>
          ) : null}
          <div className="ai-queue-heading">
            <h3>资料处理记录</h3>
            <label>
              状态{' '}
              <select
                aria-label="自动处理状态筛选"
                value={filter}
                onChange={(e) => {
                  selectFilter(e.currentTarget.value);
                }}
              >
                <option value="">全部状态</option>
                {statuses.map((status) => (
                  <option key={status} value={status}>
                    {labels[status]}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {!currentQueue ? <p role="status">正在读取这一页记录…</p> : null}
          <ul className="ai-queue-items" aria-label="自动处理文档">
            {(currentQueue ? view.queue.items : []).map((item) => (
              <li key={item.snapshotId}>
                <div className="ai-item-text">
                  <strong>
                    {item.sourceLabel ?? '文档 ' + item.snapshotId.slice(0, 8)}
                  </strong>
                  <span>
                    {labels[item.status] ?? item.status}
                    {item.task?.phase
                      ? ' · ' + (labels[item.task.phase] ?? item.task.phase)
                      : ''}
                    {item.task?.calls !== undefined
                      ? ' · ' + item.task.calls.toString() + ' 次调用尝试'
                      : ''}
                  </span>
                  {(item.errorCode ?? item.task?.errorCode) ? (
                    <span>
                      {aiError(
                        new Error(item.errorCode ?? item.task?.errorCode),
                      )}
                    </span>
                  ) : null}
                </div>
                <div className="entry-command-actions">
                  {onOpenDocument ? (
                    <button
                      type="button"
                      className="text-action"
                      onClick={() => {
                        onOpenDocument(item.snapshotId);
                      }}
                    >
                      阅读文档
                    </button>
                  ) : null}
                  {!['completed', 'taken_over'].includes(item.status) ? (
                    <>
                      <button
                        type="button"
                        className="secondary-action"
                        disabled={busy}
                        onClick={() => {
                          void act(
                            'ingestion_item_control',
                            {
                              snapshotId: item.snapshotId,
                              expectedVersion: item.version,
                              action: ['paused', 'attention'].includes(
                                item.status,
                              )
                                ? 'retry'
                                : 'pause',
                            },
                            '文档处理状态已更新。',
                          );
                        }}
                      >
                        {['paused', 'attention'].includes(item.status)
                          ? '重试 / 继续'
                          : '暂停本篇'}
                      </button>
                      <button
                        type="button"
                        className="secondary-action"
                        disabled={busy}
                        onClick={() => {
                          void act(
                            'ingestion_item_control',
                            {
                              snapshotId: item.snapshotId,
                              expectedVersion: item.version,
                              action: 'take_over',
                            },
                            '已转交人工处理，完成的内容保留。',
                          );
                        }}
                      >
                        人工接管
                      </button>
                    </>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
          {currentQueue && !view.queue.items.length ? (
            <p>
              当前没有
              {filter === 'attention' ? '需要处理的异常' : '符合条件的记录'}
              。新资料进入授权范围后会出现在这里。
            </p>
          ) : null}
          <div className="entry-command-actions">
            <button
              type="button"
              className="secondary-action"
              disabled={busy || !currentQueue || !history.length}
              onClick={() => {
                generation.current++;
                setCursor(history.at(-1));
                setHistory((current) => current.slice(0, -1));
              }}
            >
              上一页
            </button>
            <button
              type="button"
              className="secondary-action"
              disabled={busy || !currentQueue || !view.queue.nextCursor}
              onClick={() => {
                generation.current++;
                setHistory((current) => [...current, cursor]);
                setCursor(view.queue.nextCursor);
              }}
            >
              下一页
            </button>
          </div>
          {mode === 'settings' ? (
            <details className="workflow-tool-drawer">
              <summary>独立任务与阶段明细 · {view.tasks.length}</summary>
              <ul className="ai-queue-items" aria-label="独立 AI 与 Agent 任务">
                {view.tasks.map((task) => (
                  <li key={task.taskId}>
                    <div className="ai-item-text">
                      <strong>
                        {task.request.kind === 'document'
                          ? '整篇自动处理'
                          : task.request.kind === 'split'
                            ? '外部拆分'
                            : task.request.kind === 'tags'
                              ? '外部标签'
                              : '外部联系'}{' '}
                        · {task.taskId.slice(0, 8)}
                      </strong>
                      <span>
                        {labels[task.state.status]} · {labels[task.state.phase]}{' '}
                        · {task.state.steps.filter((s) => s.complete).length}/
                        {task.state.steps.length} 步 · {task.state.calls}{' '}
                        次调用尝试
                      </span>
                      {task.state.errorCode ? (
                        <span>{aiError(new Error(task.state.errorCode))}</span>
                      ) : null}
                    </div>
                    {!['succeeded', 'cancelled'].includes(task.state.status) ? (
                      <div className="entry-command-actions">
                        <button
                          type="button"
                          className="secondary-action"
                          disabled={busy}
                          onClick={() => {
                            void act(
                              'task_control',
                              {
                                taskId: task.taskId,
                                expectedVersion: task.version,
                                action: ['paused', 'failed'].includes(
                                  task.state.status,
                                )
                                  ? 'resume'
                                  : 'pause',
                              },
                              '任务状态已更新。',
                            );
                          }}
                        >
                          {['paused', 'failed'].includes(task.state.status)
                            ? '继续任务'
                            : '暂停任务'}
                        </button>
                        <button
                          type="button"
                          className="secondary-action"
                          disabled={busy}
                          onClick={() => {
                            void act(
                              'task_control',
                              {
                                taskId: task.taskId,
                                expectedVersion: task.version,
                                action: 'cancel',
                              },
                              '已请求取消，完成的内容保留。',
                            );
                          }}
                        >
                          取消任务
                        </button>
                      </div>
                    ) : null}
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
        </>
      ) : null}
    </section>
  );
}
function SingleDocumentTask({
  documents,
  disabled,
  onStart,
}: {
  readonly documents: readonly {
    snapshotId: string;
    sourceKey: string;
    isPrivate?: boolean;
  }[];
  readonly disabled: boolean;
  readonly onStart: (id: string, key: string) => Promise<boolean>;
}) {
  const [selected, setSelected] = useState('');
  const key = useRef<string | undefined>(undefined);
  return (
    <form
      className="entry-command-actions"
      onSubmit={(event) => {
        event.preventDefault();
        key.current ??= createCommandKey('document-task');
        void onStart(selected, key.current).then((saved) => {
          if (saved) {
            key.current = undefined;
            setSelected('');
          }
        });
      }}
    >
      <label className="field">
        <span>选择尚无条目的公开文档</span>
        <select
          value={selected}
          onChange={(e) => {
            setSelected(e.currentTarget.value);
            key.current = undefined;
          }}
        >
          <option value="">选择一份文档</option>
          {documents
            .filter((d) => !d.isPrivate)
            .map((d) => (
              <option key={d.snapshotId} value={d.snapshotId}>
                {d.sourceKey}
              </option>
            ))}
        </select>
      </label>
      <button
        type="submit"
        className="primary-action"
        disabled={disabled || !selected}
      >
        开始自动整理
      </button>
    </form>
  );
}
