import {useCallback, useEffect, useMemo, useState} from 'react';

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
import {activityItems} from './ai_activity_state.js';
import {AiActivityPanel, AiTaskQueue} from './ai_activity_panel.js';

type OverviewDataState =
  | Readonly<{status: 'loading'}>
  | Readonly<{
      status: 'ready';
      response: Extract<InformationEntryDocumentListResponse, {status: 'ok'}>;
    }>
  | Readonly<{status: 'error'; message: string}>;

export interface WorkflowOverviewProps {
  readonly snapshots: Loadable<readonly Readonly<EvidenceSnapshotSummary>[]>;
  readonly workspace?: Readonly<WorkspaceResponse> | undefined;
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
  readonly onOpenDocument?: (snapshotId: string) => void;
}

const STAGES: readonly Readonly<{
  section: 'import' | 'documents' | 'query' | 'reports';
  index: string;
  label: string;
  detail: string;
}>[] = Object.freeze([
  {
    section: 'import',
    index: '01',
    label: '文档入口',
    detail: '查看来源，审核新文档',
  },
  {
    section: 'documents',
    index: '02',
    label: '工作台',
    detail: '在全文中整理分段、标签与联系',
  },
  {
    section: 'query',
    index: '03',
    label: '数据阅览',
    detail: '搜索、浏览关系或向资料提问',
  },
  {
    section: 'reports',
    index: '04',
    label: '报告',
    detail: '配置生成任务，阅读与导出报告',
  },
]);

export function WorkflowOverview({
  onListDocuments,
  onNavigate,
  onReviewInbox,
  onOpenDocument,
  snapshots,
  onCancelProcessingRun,
  workspace,
  onListProcessingRuns,
}: WorkflowOverviewProps) {
  const [data, setData] = useState<OverviewDataState>({status: 'loading'});
  const [processingRefreshToken, setProcessingRefreshToken] = useState(0);
  const [historyExpanded, setHistoryExpanded] = useRememberedDisclosure(
    'overview-run-history',
  );

  const activity = useAiActivity(processingRefreshToken);
  const items = useMemo(
    () =>
      activity.data
        ? activityItems(
            activity.data,
            snapshots.status === 'ready' ? snapshots.value : [],
          )
        : [],
    [activity.data, snapshots],
  );

  const refresh = useCallback(async () => {
    setData({status: 'loading'});
    setProcessingRefreshToken((value) => value + 1);
    try {
      const response = await onListDocuments(false);
      setData(
        response.body.status === 'ok'
          ? {status: 'ready', response: response.body}
          : {
              status: 'error',
              message: '条目汇总当前不可用；来源和既有数据没有被修改。',
            },
      );
    } catch {
      setData({
        status: 'error',
        message: '无法读取当前工作区统计；可以继续使用各工作页面。',
      });
    }
  }, [onListDocuments]);

  useEffect(() => {
    globalThis.queueMicrotask(() => void refresh());
  }, [refresh]);

  const metrics = useMemo(() => {
    const snapshotValues = snapshots.status === 'ready' ? snapshots.value : [];
    const documents = snapshotValues.length;
    const fragments = snapshotValues.reduce(
      (sum, snapshot) => sum + snapshot.fragmentCount,
      0,
    );
    const entries =
      data.status === 'ready'
        ? data.response.documents.reduce(
            (sum, document) => sum + document.entryCount,
            0,
          )
        : undefined;
    const annotated =
      data.status === 'ready'
        ? data.response.documents.reduce(
            (sum, document) => sum + document.annotatedEntryCount,
            0,
          )
        : undefined;
    const documentTags =
      data.status === 'ready'
        ? data.response.documents.reduce(
            (sum, document) =>
              sum + (document.currentTags?.value.tags.length ?? 0),
            0,
          )
        : undefined;
    return {documents, fragments, entries, annotated, documentTags};
  }, [data, snapshots]);

  return (
    <div className="workspace-view workflow-overview">
      <header className="workflow-page-heading">
        <div>
          <h1>总览</h1>
        </div>
        <button
          className="secondary-action"
          type="button"
          onClick={() => void refresh()}
        >
          刷新总览
        </button>
      </header>

      <div className="workflow-overview__layout">
        <aside className="overview-task-sidebar" aria-label="工作任务">
          <AiTaskQueue
            activity={activity}
            items={items}
            onNavigate={onNavigate}
            onReviewInbox={onReviewInbox}
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
              <ProcessingRunRail
                workspace={workspace}
                refreshToken={processingRefreshToken}
                onListRuns={onListProcessingRuns}
                onCancelRun={onCancelProcessingRun}
              />
            </details>
          </AiTaskQueue>
        </aside>

        <div className="workflow-overview__main">
          <section
            className="project-intro"
            aria-labelledby="project-intro-title"
          >
            <div>
              <h2 id="project-intro-title">知识工作区</h2>
              <p>
                原始文档始终保留。拆分后的条目可以添加标签和联系，并在数据阅览中查看可编辑的关系图谱。
              </p>
            </div>
          </section>

          <section className="project-metrics" aria-label="当前项目数据">
            <Metric label="文档" value={metrics.documents} unit="份" />
            <Metric label="来源片段" value={metrics.fragments} unit="段" />
            <Metric label="信息条目" value={metrics.entries} unit="条" />
            <Metric
              label="已有标签的条目"
              value={metrics.annotated}
              unit="条"
            />
            <Metric label="文档标签" value={metrics.documentTags} unit="个" />
          </section>

          {data.status === 'error' ? (
            <div className="workflow-inline-error" role="alert">
              <strong>部分统计不可用</strong>
              <span>{data.message}</span>
            </div>
          ) : null}

          <section
            className="workflow-stage-board"
            aria-labelledby="stage-board-title"
          >
            <header>
              <div>
                <h2 id="stage-board-title">继续当前工作</h2>
              </div>
            </header>
            <ol>
              {STAGES.map((stage) => (
                <li key={stage.section}>
                  <button
                    type="button"
                    onClick={() => {
                      onNavigate(stage.section);
                    }}
                  >
                    <span className="workflow-stage-board__index">
                      {stage.index}
                    </span>
                    <span>
                      <strong>{stage.label}</strong>
                      <small>{stage.detail}</small>
                    </span>
                    <span className="workflow-stage-board__status">
                      {stageStatus(stage.section, metrics)}
                    </span>
                  </button>
                </li>
              ))}
            </ol>
          </section>
          <AiActivityPanel activity={activity} items={items} />
        </div>
      </div>
    </div>
  );
}

function Metric({
  label,
  unit,
  value,
}: {
  readonly label: string;
  readonly unit: string;
  readonly value: number | undefined;
}) {
  return (
    <article>
      <span>{label}</span>
      <strong>
        {value === undefined ? '—' : value.toLocaleString('zh-CN')}
      </strong>
      <small>{value === undefined ? '读取中' : unit}</small>
    </article>
  );
}

function stageStatus(
  section: 'import' | 'documents' | 'query' | 'reports',
  metrics: Readonly<{
    documents: number;
    fragments: number;
    entries: number | undefined;
    annotated: number | undefined;
    documentTags: number | undefined;
  }>,
): string {
  switch (section) {
    case 'import':
      return `${metrics.documents.toString()} 份文档`;
    case 'documents':
      return metrics.entries === undefined
        ? '读取中'
        : `${metrics.entries.toString()} 条条目`;
    case 'reports':
      return '生成与导出';
    case 'query':
      return metrics.entries === undefined ? '读取中' : '可以查询';
  }
}
