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
import {ContentDialog} from '../components/content_dialog.js';
import {FloatingToolPanel} from '../components/floating_tool_panel.js';
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
  const [selectedMetric, setSelectedMetric] = useState<MetricId>();
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
      relations: activity.data?.topics
        ? new Set(
            activity.data.topics.flatMap((topic) =>
              topic.value.relations
                .filter((relation) => !relation.blocked)
                .map((relation) =>
                  JSON.stringify([
                    relation.from.entryId,
                    relation.to.entryId,
                    relation.kind,
                  ]),
                ),
            ),
          ).size
        : undefined,
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
  return (
    <div
      ref={root}
      className="workspace-view editorial-overview overview overview-home"
      aria-label="总览"
    >
      <header className="overview-hero">
        <div className="overview-brand">
          <span className="si-mark hero-mark" aria-hidden="true">
            SI
          </span>
          <div>
            <h1>StruInfo</h1>
            <p className="hero-subtitle">个人知识库</p>
            <p className="hero-intro">接收资料，整理内容，查询与阅读。</p>
          </div>
        </div>
        <section
          className="hero-statistics"
          aria-labelledby="overview-stats-heading"
        >
          <div className="statistics-heading">
            <h2 id="overview-stats-heading">内容统计</h2>
            <FloatingToolPanel
              title="统计说明"
              preferredWidth={380}
              className="ov-statistics-detail"
            >
              <p>
                文档统计公开原文版本，包含待审核资料；条目按文档累计，标签按文档累计。
              </p>
              <p>
                联系统计当前可见主题中的有效联系，按条目对和类型去重。报告统计近期已生成的记录。
              </p>
              <p>
                来源片段 {metrics.fragments?.toLocaleString('zh-CN') ?? '—'} 段
                · 已有标签的条目{' '}
                {metrics.annotated?.toLocaleString('zh-CN') ?? '—'} 条
              </p>
              {dataError || snapshots.status === 'error' ? (
                <p role="alert">统计刷新失败，保留上次结果。</p>
              ) : null}
            </FloatingToolPanel>
          </div>
          <div className="hero-stats">
            <Metric
              id="documents"
              label="文档"
              value={metrics.documents}
              onOpen={() => {
                setSelectedMetric('documents');
              }}
            />
            <Metric
              id="entries"
              label="条目"
              value={metrics.entries}
              onOpen={() => {
                setSelectedMetric('entries');
              }}
            />
            <Metric
              id="tags"
              label="标签"
              value={metrics.tags}
              onOpen={() => {
                setSelectedMetric('tags');
              }}
            />
            <Metric
              id="relations"
              label="联系"
              value={metrics.relations}
              onOpen={() => {
                setSelectedMetric('relations');
              }}
            />
            <Metric
              id="reports"
              label="报告"
              value={metrics.reports}
              onOpen={() => {
                setSelectedMetric('reports');
              }}
            />
          </div>
        </section>
      </header>
      <ContentDialog
        open={selectedMetric !== undefined}
        title={
          selectedMetric
            ? `${METRIC_DETAILS[selectedMetric].label}统计`
            : '内容统计'
        }
        onClose={() => {
          setSelectedMetric(undefined);
        }}
        className="content-task-dialog"
      >
        {selectedMetric ? (
          <>
            <p>
              {metrics[selectedMetric] === undefined
                ? '统计尚未读取。'
                : `${METRIC_DETAILS[selectedMetric].label}：${metrics[selectedMetric].toLocaleString('zh-CN')}`}
            </p>
            <p>{METRIC_DETAILS[selectedMetric].scope}</p>
            <button
              className="secondary-action"
              onClick={() => {
                onNavigate(METRIC_DETAILS[selectedMetric].destination);
                setSelectedMetric(undefined);
              }}
            >
              {METRIC_DETAILS[selectedMetric].action}
            </button>
          </>
        ) : null}
      </ContentDialog>
      <OverviewFlow
        workspaceConnected={Boolean(workspace)}
        statisticsError={dataError || snapshots.status === 'error'}
        onRefresh={() => {
          setProcessingRefreshToken((v) => v + 1);
        }}
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
  value,
  onOpen,
}: {
  id: MetricId;
  label: string;
  value: number | undefined;
  onOpen: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={`查看${label}统计`}
      onClick={onOpen}
      className="hero-stat"
      data-stat={id}
      data-overview-metric={id}
    >
      <strong className="stat-value">
        <span className="ef-stat-number" data-overview-number>
          {value === undefined ? '—' : value.toLocaleString('zh-CN')}
        </span>
      </strong>
      <span>{label}</span>
    </button>
  );
}

const METRIC_DETAILS: Record<
  MetricId,
  {label: string; scope: string; destination: ProductSection; action: string}
> = {
  documents: {
    label: '文档',
    scope: '公开原文版本，包含待审核和已接受的资料。',
    destination: 'documents',
    action: '打开文档阅读',
  },
  fragments: {
    label: '来源片段',
    scope: '公开原文中保存的来源片段。',
    destination: 'documents',
    action: '打开文档阅读',
  },
  entries: {
    label: '条目',
    scope: '按当前公开文档累计。待确认的整理内容也包含在内。',
    destination: 'documents',
    action: '打开文档阅读',
  },
  annotated: {
    label: '已有标签的条目',
    scope: '当前公开文档中已有标签的条目。',
    destination: 'documents',
    action: '打开文档阅读',
  },
  tags: {
    label: '标签',
    scope: '按当前公开文档累计；不同文档的同名标签分别计数。',
    destination: 'documents',
    action: '打开文档阅读',
  },
  relations: {
    label: '联系',
    scope:
      '当前可见主题中的有效联系，按有向条目对和类型去重。未包含旧图谱联系。',
    destination: 'query',
    action: '打开数据库',
  },
  reports: {
    label: '报告',
    scope: '近期已生成、可阅读或核对的报告。',
    destination: 'reports',
    action: '打开报告',
  },
};
