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
import {ProcessingRunRail} from './processing_run_rail.js';

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
}

const STAGES: readonly Readonly<{
  section: Exclude<ProductSection, 'overview' | 'knowledge'>;
  index: string;
  label: string;
  detail: string;
}>[] = Object.freeze([
  {
    section: 'import',
    index: '01',
    label: '导入',
    detail: '保存来源、全文与不可变 Snapshot',
  },
  {
    section: 'split',
    index: '02',
    label: '拆分',
    detail: '从文档结构生成可编辑 Entry',
  },
  {
    section: 'tags',
    index: '03',
    label: '标签',
    detail: '内容、类型、领域三个维度',
  },
  {
    section: 'associations',
    index: '04',
    label: '联系',
    detail: '可解释候选与人工覆盖',
  },
  {
    section: 'query',
    index: '05',
    label: '查询',
    detail: '确定性检索并返回精确来源',
  },
]);

export function WorkflowOverview({
  onListDocuments,
  onNavigate,
  snapshots,
  onCancelProcessingRun,
  workspace,
  onListProcessingRuns,
}: WorkflowOverviewProps) {
  const [data, setData] = useState<OverviewDataState>({status: 'loading'});
  const [processingRefreshToken, setProcessingRefreshToken] = useState(0);

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
          <p className="section-index">00 / WORKSPACE OVERVIEW</p>
          <h1>总览</h1>
          <p>
            从来源证据到可检索条目的五段处理链。数字只来自当前外部工作区，不包含隐私正文或个人偏好内容。
          </p>
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
        <ProcessingRunRail
          workspace={workspace}
          refreshToken={processingRefreshToken}
          onListRuns={onListProcessingRuns}
          onCancelRun={onCancelProcessingRun}
        />

        <div className="workflow-overview__main">
          <section
            className="project-intro"
            aria-labelledby="project-intro-title"
          >
            <div className="project-intro__mark" aria-hidden="true">
              SI
            </div>
            <div>
              <p className="section-index">STRUIINFO / LOCAL WORKSPACE</p>
              <h2 id="project-intro-title">
                把一份文档变成可以查找、修改和追溯的信息
              </h2>
              <p>
                Snapshot 保留证据，Entry 承担日常拆分、标签与联系；知识页将用
                Entry 组成由相似联系与用户关系共同维护的可编辑图谱。
              </p>
            </div>
          </section>

          <section className="project-metrics" aria-label="当前项目数据">
            <Metric label="文档" value={metrics.documents} unit="份" />
            <Metric label="来源片段" value={metrics.fragments} unit="段" />
            <Metric label="信息条目" value={metrics.entries} unit="条" />
            <Metric label="已标注条目" value={metrics.annotated} unit="条" />
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
                <p className="section-index">MAIN FLOW / 05 STAGES</p>
                <h2 id="stage-board-title">继续当前工作</h2>
              </div>
              <span className="origin-label origin-label--deterministic">
                无 AI 也完整可用
              </span>
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
  section: Exclude<ProductSection, 'overview' | 'knowledge'>,
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
    case 'split':
      return metrics.entries === undefined
        ? '读取中'
        : `${metrics.entries.toString()} 条 Entry`;
    case 'tags':
      return metrics.annotated === undefined || metrics.entries === undefined
        ? '读取中'
        : `${metrics.annotated.toString()} / ${metrics.entries.toString()} 已标注`;
    case 'associations':
      return '按需重建';
    case 'query':
      return metrics.entries === undefined ? '读取中' : '确定性查询可用';
  }
}
