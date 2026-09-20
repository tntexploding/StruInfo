import {DocumentQueueControls} from './document_queue_controls.js';
import {useState, type ReactNode} from 'react';
import type {ProductSection} from '../components/product_types.js';
import {useRememberedDisclosure} from '../components/use_remembered_disclosure.js';
import type {useAiActivity} from './use_ai_activity.js';
import {aiWorkflowCommand, aiError} from '../api/ai_workflow_client.js';
import {
  activitySummary,
  ACTIVITY_LABELS,
  beijingTime,
  type AiActivityItem,
} from './ai_activity_state.js';

type Activity = ReturnType<typeof useAiActivity>;
export function AiActivityPanel({
  activity,
  items,
}: {
  activity: Activity;
  items: AiActivityItem[];
}) {
  const {data, error, saving, saveError, setOperations} = activity;
  const summary = data ? activitySummary(data, items) : undefined;
  const allowed = data?.price?.policy.operationsAllowed !== false;
  const state = error
    ? '状态不可用'
    : !data
      ? '连接中'
      : !data.model
        ? '未连接'
        : !allowed
          ? '已暂停'
          : summary?.working.length
            ? '工作中'
            : summary?.waiting.length
              ? '排队中'
              : summary?.failed.length
                ? '有任务故障'
                : '在线 · 空闲';
  return (
    <section
      className="ai-activity ai-activity--compact"
      data-expanded="false"
      data-tone={
        error
          ? 'error'
          : !allowed
            ? 'paused'
            : summary?.working.length
              ? 'working'
              : 'idle'
      }
      aria-labelledby="ai-activity-title"
    >
      <header className="ai-activity__header">
        <h2 id="ai-activity-title">
          <span className="ai-activity__emblem" aria-hidden="true">
            AI
          </span>{' '}
          AI 工作
        </h2>
        <span className="ai-activity__summary" role="status">
          <span className="ai-activity__dot" aria-hidden="true" />
          {state}
        </span>
      </header>
      <div className="ai-activity__actions" aria-label="内置 AI 总体许可">
        <button
          className="secondary-action"
          aria-pressed={Boolean(data?.price) && allowed}
          disabled={saving || error || !data?.price || allowed}
          onClick={() => void setOperations(true)}
        >
          {allowed ? '已允许 AI 操作' : '允许 AI 操作'}
        </button>
        <button
          className="secondary-action"
          aria-pressed={Boolean(data?.price) && !allowed}
          disabled={saving || error || !data?.price || !allowed}
          onClick={() => void setOperations(false)}
        >
          {allowed ? '禁止 AI 操作' : '已禁止 AI 操作'}
        </button>
        {saving ? <span role="status">保存中…</span> : null}
        {saveError ? <span role="alert">{saveError}</span> : null}
      </div>
      <div className="ai-activity__counts" aria-label="AI 处理统计">
        <span>
          <strong>{summary?.working.length ?? '—'}</strong> 处理中
        </span>
        <span>
          <strong>{summary?.waiting.length ?? '—'}</strong> 排队
        </span>
        <span>
          <strong>
            {summary ? items.filter((i) => i.state === 'done').length : '—'}
          </strong>{' '}
          最近完成
        </span>
      </div>
    </section>
  );
}
export function AiTaskQueue({
  children,
  activity,
  items,
  onNavigate,
  onReviewInbox,
  onOpenDocument,
}: {
  children: ReactNode;
  activity: Activity;
  items: AiActivityItem[];
  onNavigate: (section: ProductSection) => void;
  onReviewInbox: (id?: string) => void;
  onOpenDocument?: ((id: string) => void) | undefined;
}) {
  const [expanded, setExpanded] = useRememberedDisclosure(
    'overview-task-queue',
  );
  const [historyExpanded, setHistoryExpanded] = useRememberedDisclosure(
    'overview-recent-results',
  );
  const [filter, setFilter] = useState('');
  const summary = activity.data
    ? activitySummary(activity.data, items)
    : undefined;
  const visible = items.filter((i) =>
    i.title.toLocaleLowerCase().includes(filter.toLocaleLowerCase()),
  );
  const pending = visible.filter((i) => !['done', 'settled'].includes(i.state));
  const history = visible.filter((i) => ['done', 'settled'].includes(i.state));
  const row = (item: AiActivityItem) => (
    <li key={item.id}>
      <ActivityRow
        item={item}
        activity={activity}
        onNavigate={onNavigate}
        onReviewInbox={onReviewInbox}
        onOpenDocument={onOpenDocument}
      />
    </li>
  );
  return (
    <section
      className="ai-task-queue"
      data-expanded={expanded}
      aria-labelledby="ai-task-queue-title"
    >
      <header>
        <h2>
          <button
            className="overview-panel-toggle"
            aria-expanded={expanded}
            aria-controls="ai-task-queue-content"
            aria-label={expanded ? '收起任务队列' : '展开任务队列'}
            onClick={() => {
              setExpanded((v) => !v);
            }}
          >
            <span className="overview-panel-toggle__copy">
              <strong id="ai-task-queue-title">任务队列</strong>
              <span>
                {activity.error
                  ? '状态待刷新'
                  : String(pending.length) + ' 项未完成'}
              </span>
            </span>
            <span className="overview-panel-toggle__hint" aria-hidden="true">
              {expanded ? '收起' : '展开'}
              <span className="overview-panel-toggle__chevron" />
            </span>
          </button>
        </h2>
      </header>
      <div
        id="ai-task-queue-content"
        className="ai-task-queue__content"
        hidden={!expanded}
      >
        <div className="ai-queue-schedule">
          <strong>逐篇处理 · 模型请求并发 1</strong>
          <span>
            {summary?.nextAllowedAt
              ? '下次低谷：' + beijingTime(summary.nextAllowedAt)
              : activity.data?.price?.policy.operationsAllowed === false
                ? '等待允许 AI 操作'
                : '满足价格时段后按队列执行'}
          </span>
        </div>
        <DocumentQueueControls activity={activity} visible={expanded} />
        <label className="field">
          <span>查找文档或任务</span>
          <input
            type="search"
            value={filter}
            onChange={(e) => {
              setFilter(e.currentTarget.value);
            }}
          />
        </label>
        {activity.error ? (
          <p role="alert">暂时无法刷新，保留上次记录。</p>
        ) : !activity.data ? (
          <p>正在读取任务…</p>
        ) : !pending.length ? (
          <p>当前没有未完成任务。</p>
        ) : null}
        <ul>{pending.map(row)}</ul>
        {history.length ? (
          <details
            open={historyExpanded}
            onToggle={(e) => {
              setHistoryExpanded(e.currentTarget.open);
            }}
          >
            <summary>最近完成与处理记录 · {history.length}</summary>
            <ul>{history.map(row)}</ul>
          </details>
        ) : null}
        {children}
        {activity.data ? (
          <p className="ai-queue-updated">
            更新于 {beijingTime(activity.data.checkedAt)} · 每类最多显示最近 100
            项，未完成优先
          </p>
        ) : null}
      </div>
    </section>
  );
}
function ActivityRow({
  item,
  activity,
  onNavigate,
  onReviewInbox,
  onOpenDocument,
}: {
  item: AiActivityItem;
  activity: Activity;
  onNavigate: (section: ProductSection) => void;
  onReviewInbox: (id?: string) => void;
  onOpenDocument?: ((id: string) => void) | undefined;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const task = activity.data?.tasks.find((t) => t.taskId === item.id);
  async function control(action: 'resume' | 'pause' | 'cancel') {
    if (!task || busy) return;
    setBusy(true);
    setError('');
    try {
      await aiWorkflowCommand('task_control', {
        taskId: task.taskId,
        expectedVersion: task.version,
        action,
      });
      activity.refresh();
    } catch (cause) {
      setError(aiError(cause));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="ai-activity__item">
      <div className="ai-activity__item-meta">
        <span>
          {item.kind} · {item.actor ?? '手动发起'}
        </span>
        <span data-state={item.state}>{ACTIVITY_LABELS[item.state]}</span>
      </div>
      <button
        className="ai-activity__item-link"
        onClick={() => {
          if (item.state === 'review')
            onReviewInbox(item.reviewSnapshotId ?? item.snapshotId);
          else if (item.snapshotId && onOpenDocument)
            onOpenDocument(item.snapshotId);
          else onNavigate(item.destination);
        }}
      >
        {item.title}
      </button>
      <p>{item.detail}</p>
      {item.state === 'price' && activity.data?.price?.nextAllowedAt ? (
        <p>最早 {beijingTime(activity.data.price.nextAllowedAt)} 继续</p>
      ) : null}
      {item.stages ? (
        <ol
          className="ai-article-stages"
          aria-label={item.title + '的处理阶段'}
        >
          {item.stages.map((stage) => (
            <li key={stage.label} data-state={stage.state}>
              <span className="ai-stage-track" aria-hidden="true">
                <i
                  style={{
                    width:
                      stage.state === 'done'
                        ? '100%'
                        : stage.total
                          ? String((stage.completed / stage.total) * 100) + '%'
                          : '0%',
                  }}
                />
              </span>
              <strong>{stage.label}</strong>
              <span>{stage.detail}</span>
            </li>
          ))}
        </ol>
      ) : null}
      {task && !['succeeded', 'cancelled'].includes(task.state.status) ? (
        <div className="ai-queue-controls">
          {['failed', 'attention'].includes(item.state) ? (
            <button
              className="secondary-action"
              disabled={busy || activity.error}
              onClick={() => void control('resume')}
            >
              从断点继续
            </button>
          ) : null}
          {['working', 'queued', 'price', 'paused'].includes(item.state) ? (
            <button
              className="text-action"
              disabled={busy || activity.error}
              onClick={() => void control('pause')}
            >
              暂停任务
            </button>
          ) : null}
          <button
            className="text-action"
            disabled={busy || activity.error}
            onClick={() => void control('cancel')}
          >
            取消任务
          </button>
        </div>
      ) : null}
      {error ? <p role="alert">{error}</p> : null}
    </div>
  );
}
