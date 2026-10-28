import {OverviewNotices} from './overview_notices.js';
import {useState, type ReactNode} from 'react';
import type {ProductSection} from '../components/product_types.js';
import type {useAiActivity} from './use_ai_activity.js';
import {
  activitySummary,
  beijingTime,
  ACTIVITY_LABELS,
  type AiActivityItem,
} from './ai_activity_state.js';
import {AiTaskQueue, ActivityRow} from './ai_activity_panel.js';
import {
  FLOW_LABELS,
  overviewFlow,
  itemTone,
  itemStage,
  type FlowStageId,
} from './overview_flow_state.js';
import {ContentDialog} from '../components/content_dialog.js';
import {SourceQualityPanel} from './source_quality_panel.js';

interface Props {
  activity: ReturnType<typeof useAiActivity>;
  items: AiActivityItem[];
  children: ReactNode;
  workspaceConnected: boolean;
  statisticsError: boolean;
  onRefresh: () => void;
  onNavigate: (section: ProductSection) => void;
  onReviewInbox: (snapshotId?: string) => void;
  onReviewSource?: ((subscriptionId: string) => void) | undefined;
  onOpenDocument?: ((snapshotId: string) => void) | undefined;
}
const ICONS = {
  arrow: 'M4 12h16m-6-6 6 6-6 6',
  chevron: 'm9 5 7 7-7 7',
  play: 'm8 4 12 8-12 8z',
  pause: 'M8 5v14M16 5v14',
  file: 'M5 3h10l4 4v14H5z M15 3v5h4 M8 12h8 M8 16h6',
  alert: 'm12 3 10 18H2z M12 9v5m0 3v.1',
  review:
    'M2 12s4-7 10-7 10 7 10 7-4 7-10 7-10-7-10-7m7 0a3 3 0 1 0 6 0 3 3 0 1 0-6 0',
  intake: 'M4 4h16v16H4z M4 14h5l2 3h2l2-3h5 M12 2v9 m-3-3 3 3 3-3',
  store: 'M4 6c0-4 16-4 16 0s-16 4-16 0v12c0 4 16 4 16 0V6 M4 12c0 4 16 4 16 0',
  split: 'M5 3h14v18H5z M8 8h8 M3 12h4m3 0h4m3 0h4 M8 17h8',
  tags: 'M3 3h8l10 10-8 8L3 11z M7 7h.01',
  relations:
    'm9 15 6-6 M8 6l2-2a5 5 0 0 1 7 7l-2 2M9 11l-2 2a5 5 0 0 0 7 7l2-2',
  report: 'M5 3h14v18H5z M8 7h8M8 11h8 M8 15h4 M8 18h6',
};

export function OverviewFlow(props: Props) {
  const {
    activity,
    items,
    onNavigate,
    onReviewInbox,
    onReviewSource,
    onOpenDocument,
    children,
    workspaceConnected,
    statisticsError,
    onRefresh,
  } = props;
  const [selected, setSelected] = useState<FlowStageId>('intake');
  const [queueOpen, setQueueOpen] = useState(false);
  const [stageOpen, setStageOpen] = useState(false);
  const [messagesOpen, setMessagesOpen] = useState(false);
  const [taskId, setTaskId] = useState<string>();
  const selectedTask = items.find((item) => item.id === taskId);
  const stages = overviewFlow(activity.data, items, activity.error);
  const current = stages.find((stage) => stage.id === selected);
  if (!current) return null;
  const summary = activity.data
    ? activitySummary(activity.data, items)
    : undefined;
  const allowed = activity.data?.price?.policy.operationsAllowed !== false;
  const waiting = summary?.waiting.length ?? 0;
  const unfinished = items.filter(
    (i) => !['done', 'settled'].includes(i.state),
  ).length;
  const messages = items.filter((i) =>
    ['failed', 'review', 'attention'].includes(i.state),
  );
  const pendingReceipts =
    stages.find((stage) => stage.id === 'intake')?.pending ?? 0;
  const activeTask = items.find((item) => item.state === 'working');
  const previewTasks = items
    .filter((item) => !['done', 'settled'].includes(item.state))
    .slice(0, 3);
  function openQueue() {
    setQueueOpen(true);
  }
  function navigateItem(item: AiActivityItem) {
    setMessagesOpen(false);
    if (item.state === 'review' || item.destination === 'import')
      onReviewInbox(item.reviewSnapshotId ?? item.snapshotId);
    else if (item.snapshotId && onOpenDocument) onOpenDocument(item.snapshotId);
    else onNavigate(item.destination);
  }
  function navigateStage() {
    setStageOpen(false);
    if (current?.id === 'intake') onReviewInbox();
    else if (current) onNavigate(current.destination);
  }
  const liveLabel = activity.error
    ? '连接异常'
    : !activity.data
      ? '正在连接'
      : !activity.data.model
        ? '未配置'
        : summary?.working.length
          ? '处理中'
          : !allowed
            ? '已暂停'
            : waiting
              ? '等待调度'
              : '待机';
  const flowLabel = activity.error
    ? '状态更新失败'
    : activeTask
      ? `正在${stages.find((stage) => stage.id === itemStage(activeTask))?.label ?? '处理'}`
      : !activity.data
        ? '正在读取状态'
        : !allowed
          ? 'AI 已暂停'
          : waiting
            ? '等待执行'
            : '暂无运行任务';
  const messageContent = (
    <>
      {activity.error || statisticsError || !workspaceConnected ? (
        <div className="notice-item" data-tone="bad">
          <OverviewIcon name="alert" />
          <div>
            <p>
              {!workspaceConnected
                ? '工作区未连接'
                : activity.error
                  ? '任务状态更新失败'
                  : '统计更新失败'}
            </p>
            <small>保留上次结果，可重新读取。</small>
          </div>
          <button onClick={onRefresh}>重试</button>
        </div>
      ) : null}
      {pendingReceipts > 0 ? (
        <div className="notice-item" data-tone="warn">
          <OverviewIcon name="review" />
          <div>
            <p>{pendingReceipts} 份文档待审核</p>
            <small>查看收到的原文，决定接受或拒绝。</small>
          </div>
          <button
            onClick={() => {
              setMessagesOpen(false);
              onReviewInbox();
            }}
          >
            查看
          </button>
        </div>
      ) : null}
      {messages.map((item) => (
        <div
          key={item.id}
          className="notice-item"
          data-tone={itemTone(item) === 'failed' ? 'bad' : 'warn'}
        >
          <OverviewIcon
            name={itemTone(item) === 'failed' ? 'alert' : 'review'}
          />
          <div>
            <p>{item.title}</p>
            <small>
              {ACTIVITY_LABELS[item.state]} · {item.detail}
            </small>
          </div>
          <button
            onClick={() => {
              navigateItem(item);
            }}
          >
            查看<span className="sr-only">：{item.title}</span>
          </button>
        </div>
      ))}
      <OverviewNotices />
      <SourceQualityPanel
        onReviewSource={onReviewSource}
        onReviewInbox={onReviewInbox}
      />
      <p className="messages-empty">暂无新消息</p>
    </>
  );
  return (
    <>
      <section className="flow-zone" aria-labelledby="overview-flow-title">
        <header className="flow-zone-heading">
          <h2 id="overview-flow-title">处理流程</h2>
          <span role="status">
            <i
              className={`status-dot ${activity.error ? 'bad' : activeTask ? 'ai' : waiting || !allowed ? 'warn' : 'good'}`}
            />
            {flowLabel}
          </span>
        </header>
        <ol className="ov-pipeline" aria-label="文档处理工序">
          {stages.map((stage, index) => {
            const automated = stage.items.some(
              (item) => item.actor === '自动任务' && item.state === 'working',
            );
            const tone =
              stage.tone === 'working'
                ? 'running'
                : stage.tone === 'done'
                  ? 'complete'
                  : stage.tone;
            return (
              <li className={`ov-step ${tone}`} key={stage.id}>
                <button
                  aria-label={`${stage.label}：查看状态`}
                  aria-haspopup="dialog"
                  onClick={() => {
                    setSelected(stage.id);
                    setStageOpen(true);
                  }}
                >
                  <span
                    className={`flow-node ${tone}`}
                    data-flow-stage={stage.id}
                    data-tone={stage.tone}
                    data-flowing={stage.counts.working > 0 && !activity.error}
                  >
                    <span className="ov-node-content">
                      <OverviewIcon name={stage.id} />
                      <span className="ov-step-title">{stage.label}</span>
                    </span>
                    {stage.counts.working > 0 && !activity.error ? (
                      <span className="ef-stage-ai-label">
                        AI {automated ? '自动' : '处理'}
                      </span>
                    ) : null}
                    <canvas className="ef-node-ring" aria-hidden="true" />
                  </span>
                  <span className="ov-step-summary">
                    {stage.tone === 'unknown'
                      ? '等待状态更新'
                      : stage.pending
                        ? `${String(stage.pending)} 份待审核`
                        : stage.counts.working
                          ? `${String(stage.counts.working)} 项运行`
                          : stage.counts.failed
                            ? `${String(stage.counts.failed)} 项需处理`
                            : stage.counts.waiting
                              ? `${String(stage.counts.waiting)} 项等候`
                              : stage.counts.review
                                ? `${String(stage.counts.review)} 项需复核`
                                : stage.counts.done
                                  ? `${String(stage.counts.done)} 项近期完成`
                                  : '等待新任务'}
                  </span>
                </button>
                {index < stages.length - 1 ? (
                  <span className="flow-connector" aria-hidden="true" />
                ) : null}
              </li>
            );
          })}
        </ol>
        <div className="flow-context">
          <span>
            {activeTask?.title ??
              (summary?.nextAllowedAt
                ? `下次允许执行：${beijingTime(summary.nextAllowedAt)}`
                : '')}
          </span>
          {activeTask ? (
            <button
              className="text-button"
              onClick={() => {
                setTaskId(activeTask.id);
              }}
            >
              查看当前任务 <OverviewIcon name="arrow" />
            </button>
          ) : null}
        </div>
      </section>
      <div className="overview-bottom">
        <section
          className="control-panel"
          aria-labelledby="overview-ai-heading"
        >
          <header className="panel-heading">
            <div className="panel-heading-title">
              <h2 id="overview-ai-heading">AI 中控</h2>
              <span
                role="status"
                className={`state-text ${activity.error ? 'error-text' : activeTask ? 'ai-text' : !allowed || waiting ? 'warn-text' : 'ai-text'}`}
              >
                {liveLabel}
              </span>
            </div>
            <button
              className="secondary-action ov-ai-control"
              data-ai-action="true"
              role="switch"
              aria-label="允许 AI 操作"
              aria-checked={Boolean(activity.data?.price) && allowed}
              disabled={
                activity.saving || activity.error || !activity.data?.price
              }
              onClick={() => void activity.setOperations(!allowed)}
            >
              <OverviewIcon name={allowed ? 'pause' : 'play'} />
              {activity.saving ? '保存中…' : allowed ? '停止 AI' : '允许 AI'}
            </button>
          </header>
          <div className="queue-heading">
            <p>
              运行 {summary?.working.length ?? '—'} · 等待{' '}
              {summary ? waiting : '—'} · 并发上限{' '}
              {activity.data?.price
                ? (activity.data.price.policy.maxConcurrentRequests ?? 1)
                : '—'}
            </p>
            <button
              className="text-button"
              onClick={openQueue}
              aria-haspopup="dialog"
              aria-label="展开任务队列"
            >
              全部任务 <OverviewIcon name="arrow" />
            </button>
          </div>
          {activity.saveError ? (
            <p role="alert" className="error-text">
              {activity.saveError}
            </p>
          ) : activity.saveMessage ? (
            <p role="status" className="permission-feedback">
              {allowed ? '已允许后续 AI 操作。' : '当前请求完成后暂停。'}
            </p>
          ) : null}
          <div className="task-list">
            {previewTasks.map((item) => (
              <button
                key={item.id}
                className="task-item"
                data-status={item.state === 'working' ? 'running' : item.state}
                aria-haspopup="dialog"
                onClick={() => {
                  setTaskId(item.id);
                }}
              >
                <span className="task-icon">
                  <OverviewIcon
                    name={item.state === 'failed' ? 'alert' : 'file'}
                  />
                </span>
                <span className="task-copy">
                  <strong>{item.title}</strong>
                  <small>
                    {item.actor === '自动任务' ? 'AI 自动 · ' : ''}
                    {item.detail}
                  </small>
                  {item.stages ? (
                    <span className="task-progress" aria-label="处理进度">
                      {item.stages.map((stage, i) => (
                        <i
                          key={i}
                          className={
                            stage.state === 'done'
                              ? 'done'
                              : stage.state === 'active'
                                ? 'now'
                                : ''
                          }
                          title={stage.label}
                        />
                      ))}
                    </span>
                  ) : null}
                </span>
                <span className="task-stage">
                  {item.state === 'working'
                    ? stages.find((stage) => stage.id === itemStage(item))
                        ?.label
                    : ACTIVITY_LABELS[item.state]}
                  <OverviewIcon name="chevron" />
                </span>
              </button>
            ))}
            {!unfinished ? (
              <div className="list-empty">
                <strong>
                  {activity.data ? '当前没有待执行任务' : '正在读取队列…'}
                </strong>
                收到文档后，处理进度会显示在这里。
              </div>
            ) : null}
          </div>
        </section>
        <section
          className="messages-panel"
          aria-labelledby="overview-messages-heading"
        >
          <header className="panel-heading">
            <div className="panel-heading-title">
              <h2 id="overview-messages-heading">消息</h2>
            </div>
            <button
              className="text-button"
              onClick={() => {
                setMessagesOpen(true);
              }}
              aria-haspopup="dialog"
            >
              全部消息 <OverviewIcon name="arrow" />
            </button>
          </header>
          <div className="message-list">
            {messagesOpen ? null : messageContent}
          </div>
        </section>
      </div>
      <ContentDialog
        open={messagesOpen}
        title="全部消息"
        onClose={() => {
          setMessagesOpen(false);
        }}
      >
        <div className="message-list">
          {messagesOpen ? messageContent : null}
        </div>
        <button className="secondary-action" onClick={onRefresh}>
          刷新总览
        </button>
      </ContentDialog>
      <ContentDialog
        open={selectedTask !== undefined}
        title="任务详情"
        onClose={() => {
          setTaskId(undefined);
        }}
        className="content-task-dialog"
      >
        {selectedTask ? (
          <ActivityRow
            item={selectedTask}
            activity={activity}
            onNavigate={onNavigate}
            onReviewInbox={onReviewInbox}
            onOpenDocument={onOpenDocument}
          />
        ) : null}
      </ContentDialog>
      <ContentDialog
        open={stageOpen}
        title={`${current.label} · 工序状态`}
        onClose={() => {
          setStageOpen(false);
        }}
        className="overview-stage-dialog"
      >
        <p>{current.description}</p>
        <div className="overview-stage-dialog__actions">
          <span data-tone={current.tone}>
            {FLOW_LABELS[current.tone]}
            {current.pending ? ` · ${String(current.pending)} 份待审核` : ''}
          </span>
          <button className="secondary-action" onClick={navigateStage}>
            {current.action} ↗
          </button>
        </div>
        <div className="overview-stage-dialog__tasks">
          {current.items.length ? (
            current.items.map((item) => (
              <ActivityRow
                key={item.id}
                item={item}
                activity={activity}
                onNavigate={onNavigate}
                onReviewInbox={onReviewInbox}
                onOpenDocument={onOpenDocument}
              />
            ))
          ) : (
            <p>
              {current.pending
                ? '打开文档入口，查看待审核文档与来源。'
                : activity.error
                  ? '状态刷新失败，请关闭后刷新总览。'
                  : '当前没有这道工序的任务。'}
            </p>
          )}
        </div>
      </ContentDialog>
      <ContentDialog
        open={queueOpen}
        title="任务队列"
        onClose={() => {
          setQueueOpen(false);
        }}
        className="overview-queue-dialog"
      >
        {queueOpen ? (
          <AiTaskQueue
            activity={activity}
            items={items}
            onNavigate={onNavigate}
            onReviewInbox={onReviewInbox}
            onOpenDocument={onOpenDocument}
            embedded
          >
            {children}
          </AiTaskQueue>
        ) : null}
      </ContentDialog>
    </>
  );
}

function OverviewIcon({name}: {name: keyof typeof ICONS}) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={ICONS[name]} />
    </svg>
  );
}
