import {useRef, useState, type ReactNode} from 'react';
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
  type FlowStageId,
} from './overview_flow_state.js';
import {FloatingToolPanel} from '../components/floating_tool_panel.js';
import {SourceQualityPanel} from './source_quality_panel.js';

interface Props {
  activity: ReturnType<typeof useAiActivity>;
  items: AiActivityItem[];
  children: ReactNode;
  recent: ReactNode;
  onNavigate: (section: ProductSection) => void;
  onReviewInbox: (snapshotId?: string) => void;
  onReviewSource?: ((subscriptionId: string) => void) | undefined;
  onOpenDocument?: ((snapshotId: string) => void) | undefined;
}
const ICONS: Record<FlowStageId, string> = {
  intake: 'M4 4h16v16H4z M4 14h5l2 3h2l2-3h5 M12 3v8 m-3-3 3 3 3-3',
  store: 'M4 6c0-4 16-4 16 0s-16 4-16 0v12c0 4 16 4 16 0V6 M4 12c0 4 16 4 16 0',
  split: 'M5 3h10l4 4v14H5z M15 3v5h4 M8 12h8 M8 17h3 m3 0h2',
  tags: 'M3 4h8l10 10-7 7L3 10z M7 8h.01',
  relations:
    'M8 6h8 M6 8v8 m2 2h8 M18 8v8 M8 8l8 8 M8 16l8-8 M4 4h4v4H4z M16 4h4v4h-4z M4 16h4v4H4z M16 16h4v4h-4z',
  report: 'M5 3h10l4 4v14H5z M15 3v5h4 M8 11h8 M8 15h8 M8 18h5',
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
    recent,
  } = props;
  const [selected, setSelected] = useState<FlowStageId>('intake');
  const [queueOpen, setQueueOpen] = useState(false);
  const queueDialog = useRef<HTMLDialogElement>(null);
  const stageDialog = useRef<HTMLDialogElement>(null);
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
  const messages = items
    .filter((i) => ['failed', 'review', 'attention'].includes(i.state))
    .slice(0, 3);
  function openQueue() {
    setQueueOpen(true);
    queueDialog.current?.showModal();
  }
  function navigateItem(item: AiActivityItem) {
    if (item.state === 'review' || item.destination === 'import')
      onReviewInbox(item.reviewSnapshotId ?? item.snapshotId);
    else if (item.snapshotId && onOpenDocument) onOpenDocument(item.snapshotId);
    else onNavigate(item.destination);
  }
  function navigateStage() {
    if (current?.id === 'intake' && !current.pending) onReviewInbox();
    else if (current) onNavigate(current.destination);
  }
  const liveLabel = activity.error
    ? '连接异常 · 保留上次记录'
    : !activity.data
      ? '正在连接'
      : !activity.data.model
        ? 'AI 未配置'
        : summary?.working.length
          ? `${String(summary.working.length)} 项正在运行`
          : !allowed
            ? 'AI 已暂停'
            : waiting
              ? `${String(waiting)} 项等待调度`
              : 'AI 在线 · 空闲';
  return (
    <>
      <section className="ov-flow" aria-labelledby="overview-flow-title">
        <header className="ov-section-head">
          <div>
            <h3 id="overview-flow-title">文档处理流程</h3>
            <p role="status">{liveLabel}</p>
          </div>
          <button
            className="ov-permission"
            role="switch"
            aria-checked={Boolean(activity.data?.price) && allowed}
            disabled={
              activity.saving || activity.error || !activity.data?.price
            }
            onClick={() => void activity.setOperations(!allowed)}
          >
            {activity.saving
              ? '保存中…'
              : allowed
                ? '暂停 AI 操作'
                : '允许 AI 操作'}
            <span className="ov-switch" aria-hidden="true">
              <i />
            </span>
          </button>
        </header>
        {activity.saveError ? (
          <p role="alert">{activity.saveError}</p>
        ) : activity.saveMessage ? (
          <p role="status">{activity.saveMessage}</p>
        ) : null}
        <ol className="ov-pipeline" aria-label="文档处理工序">
          {stages.map((stage) => {
            const automated = stage.items.some(
              (item) =>
                item.actor === '自动任务' &&
                !['done', 'settled'].includes(item.state),
            );
            return (
              <li
                className={`ov-step ${stage.tone === 'working' ? 'running' : stage.tone === 'done' ? 'complete' : stage.tone}`}
                key={stage.id}
              >
                <button
                  aria-pressed={selected === stage.id}
                  aria-haspopup="dialog"
                  aria-controls="overview-stage-dialog"
                  onClick={() => {
                    setSelected(stage.id);
                    stageDialog.current?.showModal();
                  }}
                >
                  <span
                    className={`flow-node ${stage.tone === 'working' ? 'running' : stage.tone}`}
                    data-flow-stage={stage.id}
                    data-tone={stage.tone}
                    data-flowing={stage.counts.working > 0 && !activity.error}
                  >
                    <span className="ov-node-content">
                      <svg
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        aria-hidden="true"
                      >
                        <path d={ICONS[stage.id]} />
                      </svg>
                      <span className="ov-step-title">{stage.label}</span>
                    </span>
                    {stage.counts.working > 0 && !activity.error ? (
                      <span className="ef-stage-ai-label">
                        <strong>AI</strong>{' '}
                        <span>{automated ? '自动' : '处理'}</span>
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
              </li>
            );
          })}
        </ol>
      </section>
      <div className="ov-bottom">
        {recent}
        <aside className="ov-queue" aria-label="任务概况">
          <header className="ov-section-head">
            <h3>
              任务队列 <span>{unfinished}</span>
            </h3>
            <button
              className="ov-text-link muted"
              onClick={openQueue}
              aria-haspopup="dialog"
              aria-label="展开任务队列"
            >
              查看全部 ↗
            </button>
          </header>
          <div className="ov-task-list">
            {items
              .filter((i) => !['done', 'settled'].includes(i.state))
              .slice(0, 4)
              .map((item) => (
                <button
                  key={item.id}
                  className={`ov-task-row ${item.state === 'working' ? 'running' : itemTone(item)}`}
                  onClick={() => {
                    navigateItem(item);
                  }}
                >
                  <span className="ov-task-top">
                    <span className="ov-task-state">
                      <i />
                      {ACTIVITY_LABELS[item.state]}
                    </span>
                    <span>
                      {item.actor === '自动任务' ? 'AI 自动' : item.actor}
                    </span>
                  </span>
                  <strong>{item.title}</strong>
                  <span className="ov-task-description">{item.detail}</span>
                  <span className="ov-stage-progress" aria-label="处理进度">
                    {item.stages?.map((stage, i) => (
                      <i
                        key={i}
                        className={
                          stage.state === 'done'
                            ? 'done'
                            : stage.state === 'active'
                              ? 'current'
                              : ''
                        }
                        title={stage.label}
                      />
                    ))}
                  </span>
                </button>
              ))}
          </div>
          {!unfinished ? (
            <div className="ov-queue-empty">
              <strong>
                {activity.data ? '当前没有待执行任务' : '正在读取队列…'}
              </strong>
              <p>新任务的进度会显示在这里。</p>
            </div>
          ) : null}
          <FloatingToolPanel title="AI 消息与运行设置" preferredWidth={460}>
            <div className="overview-flow__message-scroll">
              <p className="overview-concurrency">
                模型请求并发上限{' '}
                <strong>
                  {activity.data?.price
                    ? (activity.data.price.policy.maxConcurrentRequests ?? 1)
                    : '—'}
                </strong>
              </p>
              {activity.error ? (
                <p role="alert">
                  状态刷新失败，节点暂停动态显示。请刷新总览重试。
                </p>
              ) : (
                <p>
                  {summary?.nextAllowedAt
                    ? `下一允许时段：${beijingTime(summary.nextAllowedAt)}`
                    : !allowed
                      ? '后续 AI 操作已暂停，已发出的请求允许完成。'
                      : waiting
                        ? '队列按并发上限、任务授权和价格时段继续。'
                        : '没有正在等候的任务。新进展和需要你决定的事项会显示在这里。'}
                </p>
              )}
              {messages.map((item) => (
                <button
                  key={item.id}
                  className="overview-message"
                  data-tone={itemTone(item)}
                  data-actor={
                    item.actor === '自动任务' ? 'automation' : undefined
                  }
                  onClick={() => {
                    navigateItem(item);
                  }}
                >
                  {item.actor === '自动任务' ? (
                    <span className="ai-task-origin">AI 自动任务</span>
                  ) : null}
                  <strong>
                    {ACTIVITY_LABELS[item.state]}{' '}
                    <span aria-hidden="true">↗</span>
                  </strong>
                  <span>{item.title}</span>
                  <small>{item.detail}</small>
                </button>
              ))}
              <SourceQualityPanel
                onReviewSource={onReviewSource}
                onReviewInbox={onReviewInbox}
              />
            </div>
          </FloatingToolPanel>
        </aside>
      </div>
      <dialog
        ref={stageDialog}
        id="overview-stage-dialog"
        className="overview-queue-dialog overview-stage-dialog"
        aria-labelledby="overview-stage-dialog-heading"
      >
        <header>
          <h2 id="overview-stage-dialog-heading">{current.label} · 工序状态</h2>
          <button
            className="secondary-action"
            onClick={() => stageDialog.current?.close()}
          >
            关闭工序详情
          </button>
        </header>
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
      </dialog>
      <dialog
        ref={queueDialog}
        className="overview-queue-dialog"
        aria-labelledby="overview-queue-heading"
        onClose={(event) => {
          if (event.target === event.currentTarget) setQueueOpen(false);
        }}
      >
        <header>
          <h2 id="overview-queue-heading">任务队列</h2>
          <button
            className="secondary-action"
            onClick={() => queueDialog.current?.close()}
          >
            关闭队列
          </button>
        </header>
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
      </dialog>
    </>
  );
}
