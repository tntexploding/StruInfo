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
export function AiTaskQueue({
  children,
  activity,
  items,
  onNavigate,
  onReviewInbox,
  onOpenDocument,
  embedded = false,
}: {
  children: ReactNode;
  activity: Activity;
  items: AiActivityItem[];
  onNavigate: (section: ProductSection) => void;
  onReviewInbox: (id?: string) => void;
  onOpenDocument?: ((id: string) => void) | undefined;
  embedded?: boolean;
}) {
  const [rememberedExpanded, setExpanded] = useRememberedDisclosure(
    'overview-task-queue',
  );
  const expanded = embedded || rememberedExpanded;
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
      <header hidden={embedded}>
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
          <strong>
            模型请求并发上限{' '}
            {activity.data?.price
              ? (activity.data.price.policy.maxConcurrentRequests ?? 1)
              : '—'}
          </strong>
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
export function ActivityRow({
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
  const topic = activity.data?.topicJobs?.find((job) => job.id === item.id);
  async function controlTopic(action: 'resume' | 'cancel') {
    if (!topic || busy) return;
    setBusy(true);
    setError('');
    try {
      await aiWorkflowCommand('topic_job_control', {
        jobId: topic.id,
        expectedVersion: topic.version,
        action,
      });
      activity.refresh();
    } catch (cause) {
      setError(aiError(cause));
    } finally {
      setBusy(false);
    }
  }
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
    <div
      className="ai-activity__item"
      data-state={item.state}
      data-actor={item.actor === '自动任务' ? 'automation' : undefined}
    >
      <div className="ai-activity__item-meta">
        <span>
          {item.kind} ·{' '}
          <span
            className={item.actor === '自动任务' ? 'ai-task-origin' : undefined}
          >
            {item.actor === '自动任务'
              ? 'AI 自动任务'
              : (item.actor ?? '手动发起')}
          </span>
        </span>
        <span data-state={item.state}>{ACTIVITY_LABELS[item.state]}</span>
      </div>
      <button
        className="ai-activity__item-link"
        onClick={() => {
          if (item.state === 'review' || item.destination === 'import')
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
      {topic && !['succeeded', 'cancelled'].includes(topic.status) ? (
        <div className="ai-queue-controls">
          {topic.canResume ? (
            <button
              className="secondary-action"
              disabled={busy}
              onClick={() => void controlTopic('resume')}
            >
              继续归组
            </button>
          ) : null}
          <button
            className="text-action"
            disabled={busy}
            onClick={() => void controlTopic('cancel')}
          >
            取消归组
          </button>
        </div>
      ) : null}
      {task && !['succeeded', 'cancelled'].includes(task.state.status) ? (
        <div className="ai-queue-controls">
          {['failed', 'attention', 'paused'].includes(item.state) ? (
            <button
              className="secondary-action"
              disabled={busy || activity.error}
              onClick={() => void control('resume')}
            >
              从断点继续
            </button>
          ) : null}
          {['working', 'queued', 'price'].includes(item.state) ? (
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
