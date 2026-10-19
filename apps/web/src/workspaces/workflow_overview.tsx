import {useEffect, useMemo, useRef, useState} from 'react';
import type {
  EvidenceSnapshotSummary,
  InformationEntryDocumentListResponse,
  M1cHttpResponse,
  ProcessingRunCancelResponse,
  ProcessingRunListResponse,
  WorkspaceResponse,
} from '../api/m1c_api_contract.js';
import type {Loadable, ProductSection} from '../components/product_types.js';
import {useRememberedDisclosure} from '../components/use_remembered_disclosure.js';
import {ProcessingRunRail} from './processing_run_rail.js';
import {useAiActivity} from './use_ai_activity.js';
import {useInboxPreviews} from './use_inbox_previews.js';
import {FloatingToolPanel} from '../components/floating_tool_panel.js';
import {sourceDisplayName} from '../components/reading_text.js';
import {activityItems} from './ai_activity_state.js';
import {currentOverviewItems} from './overview_flow_state.js';
import {OverviewFlow} from './overview_flow.js';
import {useOverviewMotion} from './use_overview_motion.js';
import type {MetricId, OverviewMetrics} from './overview_motion_state.js';

export interface WorkflowOverviewProps {
  readonly snapshots: Loadable<readonly Readonly<EvidenceSnapshotSummary>[]>;
  readonly workspace?: Readonly<WorkspaceResponse> | undefined;
  readonly onRefreshEvidence?: (() => Promise<void>) | undefined;
  readonly onListDocuments: (
    includePrivate: boolean,
  ) => Promise<M1cHttpResponse<InformationEntryDocumentListResponse>>;
  readonly onListProcessingRuns: (
    limit: number,
  ) => Promise<M1cHttpResponse<ProcessingRunListResponse>>;
  readonly onCancelProcessingRun: (
    runId: string,
    expectedVersion: number,
  ) => Promise<M1cHttpResponse<ProcessingRunCancelResponse>>;
  readonly onNavigate: (section: ProductSection) => void;
  readonly onReviewInbox: (snapshotId?: string) => void;
  readonly onReviewSource?: (subscriptionId: string) => void;
  readonly onOpenDocument?: (snapshotId: string) => void;
}

export function WorkflowOverview({
  onListDocuments,
  onNavigate,
  onReviewInbox,
  onReviewSource,
  onOpenDocument,
  snapshots,
  onCancelProcessingRun,
  workspace,
  onListProcessingRuns,
  onRefreshEvidence,
}: WorkflowOverviewProps) {
  const [documents, setDocuments] =
    useState<Extract<InformationEntryDocumentListResponse, {status: 'ok'}>>();
  const root = useRef<HTMLDivElement>(null);
  const [documentsAt, setDocumentsAt] = useState<string>();
  const [dataError, setDataError] = useState(false);
  const [processingRefreshToken, setProcessingRefreshToken] = useState(0);
  const [historyExpanded, setHistoryExpanded] = useRememberedDisclosure(
    'overview-run-history',
  );
  const activity = useAiActivity(processingRefreshToken);
  const items = useMemo(
    () =>
      activity.data
        ? currentOverviewItems(
            activity.data,
            activityItems(
              activity.data,
              snapshots.status === 'ready' ? snapshots.value : [],
            ),
          )
        : [],
    [activity.data, snapshots],
  );

  useEffect(() => {
    let disposed = false;
    const checkedAt = activity.data?.checkedAt;
    void Promise.all([onListDocuments(false), onRefreshEvidence?.()])
      .then(([response]) => {
        if (disposed) return;
        if (response.body.status === 'ok') {
          setDocuments(response.body);
          setDocumentsAt(checkedAt);
          setDataError(false);
        } else setDataError(true);
      })
      .catch(() => {
        if (!disposed) setDataError(true);
      });
    return () => {
      disposed = true;
    };
  }, [onListDocuments, onRefreshEvidence, activity.data?.checkedAt]);

  const metrics = useMemo<OverviewMetrics>(() => {
    const values =
      snapshots.status === 'ready'
        ? snapshots.value.filter((s) => !s.isPrivate)
        : [];
    return {
      reports: activity.data?.reports.filter((report) =>
        ['ready', 'reviewed'].includes(report.status),
      ).length,
      documents:
        snapshots.status === 'ready' || snapshots.status === 'empty'
          ? values.length
          : undefined,
      fragments:
        snapshots.status === 'ready' || snapshots.status === 'empty'
          ? values.reduce((n, s) => n + s.fragmentCount, 0)
          : undefined,
      entries: documents?.documents.reduce((n, d) => n + d.entryCount, 0),
      annotated: documents?.documents.reduce(
        (n, d) => n + d.annotatedEntryCount,
        0,
      ),
      tags: documents?.documents.reduce(
        (n, d) => n + (d.currentTags?.value.tags.length ?? 0),
        0,
      ),
    };
  }, [documents, snapshots, activity.data]);
  const observation = useMemo(
    () =>
      documentsAt &&
      documentsAt === activity.data?.checkedAt &&
      (snapshots.status === 'ready' || snapshots.status === 'empty')
        ? {items, metrics}
        : undefined,
    [documentsAt, activity.data?.checkedAt, snapshots.status, items, metrics],
  );
  useOverviewMotion(
    root,
    observation,
    dataError || activity.error || snapshots.status === 'error',
  );
  const recent = useMemo(
    () =>
      [...(documents?.documents ?? [])]
        .sort((a, b) => b.capturedAt.localeCompare(a.capturedAt))
        .slice(0, 5),
    [documents],
  );
  const previews = useInboxPreviews(
    recent.map((d) => d.snapshotId),
    false,
    true,
  );
  const pending = activity.data?.intakeRecords.filter(
    (r) => r.value.receipt === 'pending' && r.value.decision !== 'blocked',
  ).length;
  const attention = items.find((i) =>
    ['failed', 'review', 'attention'].includes(i.state),
  );
  return (
    <div ref={root} className="workspace-view editorial-overview overview">
      <header className="workflow-page-heading">
        <div>
          <h1>运行总览</h1>
          <p>查看待办资料与处理进度。</p>
        </div>
        <div className="workspace-page-actions">
          <button
            className="secondary-action"
            onClick={() => {
              setProcessingRefreshToken((v) => v + 1);
            }}
          >
            刷新总览
          </button>
        </div>
      </header>
      <section className="ov-home-top" aria-label="项目概况">
        <div className="ov-project-brand">
          <div className="ov-wordmark">
            <div className="ov-logo" aria-hidden="true">
              <div className="logo-face">
                <span>SI</span>
              </div>
            </div>
            <div>
              <h2>StruInfo</h2>
              <p>收集、整理与检索文档</p>
            </div>
          </div>
        </div>
        <div className="ov-project-activity">
          <section className="ov-next-tasks" aria-label="当前待办">
            <h3>接下来</h3>
            <button
              className="ov-next-task"
              onClick={() => {
                onReviewInbox();
              }}
            >
              <span className="ov-next-icon" aria-hidden="true">
                ↓
              </span>
              <span className="ov-next-copy">
                <strong>
                  审核新资料{' '}
                  <span>
                    {pending === undefined ? '读取中' : `${String(pending)} 份`}
                  </span>
                </strong>
                <small>查看来源与正文，决定接受或拒绝。</small>
              </span>
              <span className="ov-next-action">打开 ↗</span>
            </button>
            <button
              className={`ov-next-task ${attention ? 'failed' : 'settled'}`}
              onClick={() => {
                if (
                  attention?.state === 'review' ||
                  attention?.destination === 'import'
                )
                  onReviewInbox(
                    attention.reviewSnapshotId ?? attention.snapshotId,
                  );
                else if (attention?.snapshotId && onOpenDocument)
                  onOpenDocument(attention.snapshotId);
                else onNavigate(attention?.destination ?? 'documents');
              }}
            >
              <span className="ov-next-icon" aria-hidden="true">
                {attention ? '!' : '✓'}
              </span>
              <span className="ov-next-copy">
                <strong>
                  {attention ? '查看待处理任务' : '继续阅读与整理'}
                </strong>
                <small>
                  {attention?.detail ?? '在工作台查看原文、标签和联系。'}
                </small>
              </span>
              <span className="ov-next-action">打开 ↗</span>
            </button>
          </section>
          <section className="ov-statistics" aria-label="当前项目数据">
            <FloatingToolPanel
              title="统计说明"
              preferredWidth={380}
              className="ov-statistics-detail"
            >
              <p>
                原文版本包含待审与已接收资料；文档标签按每份文档累计。报告显示近期已生成的记录。
              </p>
              <Metric
                id="fragments"
                label="来源片段"
                value={metrics.fragments}
                unit="段"
              />
              <Metric
                id="annotated"
                label="已有标签的条目"
                value={metrics.annotated}
                unit="条"
              />
            </FloatingToolPanel>
            <div className="ov-metrics">
              <Metric
                id="documents"
                label="原文版本"
                value={metrics.documents}
                unit="份"
              />
              <Metric
                id="entries"
                label="信息条目"
                value={metrics.entries}
                unit="条"
              />
              <Metric
                id="tags"
                label="文档标签"
                value={metrics.tags}
                unit="个"
              />
              <Metric
                id="reports"
                label="近期报告"
                value={metrics.reports}
                unit="份"
              />
            </div>
          </section>
          <div className="ov-system">
            <dl className="ov-system-list">
              <div>
                <dt>工作区</dt>
                <dd>
                  <i
                    className={`ov-state-dot ${workspace ? 'connected' : ''}`}
                  />
                  {workspace ? '已连接' : '读取中'}
                </dd>
              </div>
              <div className={activity.error ? 'failed' : ''}>
                <dt>服务</dt>
                <dd>
                  <i
                    className={`ov-state-dot ${activity.data && !activity.error ? 'connected' : ''}`}
                  />
                  {activity.error
                    ? '连接异常'
                    : activity.data
                      ? '就绪'
                      : '连接中'}
                </dd>
              </div>
              <div
                className={
                  items.some((i) => i.state === 'working') ? 'running' : ''
                }
              >
                <dt>AI</dt>
                <dd>
                  <i className="ov-state-dot" />
                  {activity.error
                    ? '状态未知'
                    : !activity.data
                      ? '读取中'
                      : !activity.data.model
                        ? '未配置'
                        : activity.data.price?.policy.operationsAllowed ===
                            false
                          ? '已暂停'
                          : items.some((i) => i.state === 'working')
                            ? '运行中'
                            : '等待任务'}
                </dd>
              </div>
            </dl>
          </div>
        </div>
      </section>
      {dataError || snapshots.status === 'error' ? (
        <p className="overview-data-error" role="alert">
          统计刷新失败，保留上次结果；可继续使用各工作页面。
        </p>
      ) : null}
      <OverviewFlow
        recent={
          <section className="ov-recent" aria-label="最近文档">
            <header className="ov-section-head">
              <h3>最近文档</h3>
              <button
                className="ov-text-link muted"
                onClick={() => {
                  onNavigate('documents');
                }}
              >
                查看全部 ↗
              </button>
            </header>
            <div className="ov-recent-list">
              {recent.length ? (
                recent.map((d, i) => (
                  <button
                    key={d.snapshotId}
                    className="ov-document-row"
                    onClick={() => {
                      if (onOpenDocument) onOpenDocument(d.snapshotId);
                      else onNavigate('documents');
                    }}
                  >
                    <span className="ov-row-number">
                      {String(i + 1).padStart(2, '0')}
                    </span>
                    <span className="ov-document-info">
                      <strong>
                        {previews.previews.get(d.snapshotId)?.title ??
                          sourceDisplayName(d)}
                      </strong>
                      <span>
                        {previews.previews.get(d.snapshotId)?.source.name ??
                          sourceDisplayName(d)}
                        <i>·</i>
                        {d.entryCount} 个条目
                      </span>
                    </span>
                    <time>
                      {new Date(d.capturedAt).toLocaleDateString('zh-CN')}
                    </time>
                  </button>
                ))
              ) : (
                <p className="ov-empty">
                  {documents
                    ? '还没有文档。可从文档入口开始收集。'
                    : '正在读取文档…'}
                </p>
              )}
            </div>
          </section>
        }
        activity={activity}
        items={items}
        onNavigate={onNavigate}
        onReviewInbox={onReviewInbox}
        onReviewSource={onReviewSource}
        onOpenDocument={onOpenDocument}
      >
        <details
          className="overview-run-history"
          open={historyExpanded}
          onToggle={(event) => {
            setHistoryExpanded(event.currentTarget.open);
          }}
        >
          <summary>独立调用记录</summary>
          {historyExpanded ? (
            <ProcessingRunRail
              workspace={workspace}
              refreshToken={processingRefreshToken}
              onListRuns={onListProcessingRuns}
              onCancelRun={onCancelProcessingRun}
            />
          ) : null}
        </details>
      </OverviewFlow>
    </div>
  );
}
function Metric({
  id,
  label,
  unit,
  value,
}: {
  id: MetricId;
  label: string;
  unit: string;
  value: number | undefined;
}) {
  return (
    <article className="ov-metric" data-kind={id} data-overview-metric={id}>
      <span className="ov-metric-label">{label}</span>
      <strong className="stat-value">
        <span className="ef-stat-number" data-overview-number>
          {value === undefined ? '—' : value.toLocaleString('zh-CN')}
        </span>
        <small>{value === undefined ? '读取中' : unit}</small>
      </strong>
    </article>
  );
}
