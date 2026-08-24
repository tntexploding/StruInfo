import {useCallback, useEffect, useRef, useState} from 'react';

import type {
  AiTagProposalDecisionResponse,
  AiTagProposalListResponse,
  AiTagProposalStartResponse,
  EvidenceSnapshotSummary,
  InformationEntryAssociationListResponse,
  InformationEntryAssociationOverrideResponse,
  InformationEntryAssociationPolicyWriteResponse,
  InformationEntryAssociationRebuildResponse,
  InformationEntryKnowledgeGraphEdgeWriteResponse,
  InformationEntryKnowledgeGraphResponse,
  InformationEntryMaterializeResponse,
  InformationEntryDocumentListResponse,
  InformationEntryRevisionResponse,
  InformationEntrySearchResponse,
  InformationDocumentTagWriteResponse,
  M1cHttpResponse,
  ProcessingRunCancelResponse,
  ProcessingRunListResponse,
  MarkdownImportResponse,
  ReviewPreferencesResponse,
  ReviewPreferencesWrite,
  WorkspaceResponse,
  WorkspaceBundleTransferResponse,
} from './api/m1c_api_contract.js';
import type {M1cApiClient} from './api/m1c_api_client.js';
import {EvidenceRail} from './components/evidence_rail.js';
import {ProductAppShell} from './components/product_app_shell.js';
import type {
  ActionFeedback,
  EvidencePanelState,
  Loadable,
  ProductSection,
  WorkspaceTransferFeedback,
} from './components/product_types.js';
import type {HealthClient} from './health/health_client.js';
import type {HealthTransportMode} from './health/health_runtime.js';
import {useOperationalHealth} from './health/use_operational_health.js';
import {MaterialsWorkspace} from './workspaces/materials_workspace.js';
import {InformationEntryAssociationsWorkspace} from './workspaces/information_entry_associations_workspace.js';
import {InformationEntryQueryWorkspace} from './workspaces/information_entry_query_workspace.js';
import {InformationEntrySplitWorkspace} from './workspaces/information_entry_split_workspace.js';
import {InformationEntryTagsWorkspace} from './workspaces/information_entry_tags_workspace.js';
import {WorkflowOverview} from './workspaces/workflow_overview.js';
import {FormalKnowledgeWorkspace} from './workspaces/formal_knowledge_workspace.js';

export interface AppProps {
  readonly apiClient: M1cApiClient;
  readonly healthClient: HealthClient;
  readonly transportMode: HealthTransportMode;
}

export function App({apiClient, healthClient, transportMode}: AppProps) {
  const health = useOperationalHealth(healthClient);
  const [activeSection, setActiveSection] =
    useState<ProductSection>('overview');
  const [workspace, setWorkspace] = useState<
    Loadable<Readonly<WorkspaceResponse>>
  >({status: 'loading'});
  const [snapshots, setSnapshots] = useState<
    Loadable<readonly Readonly<EvidenceSnapshotSummary>[]>
  >({status: 'loading'});
  const [reviewPreferences, setReviewPreferences] = useState<
    Loadable<Readonly<ReviewPreferencesResponse>>
  >({status: 'loading'});
  const [reviewPreferencesOverride, setReviewPreferencesOverride] = useState<
    Readonly<ReviewPreferencesWrite> | undefined
  >();
  const [evidencePanel, setEvidencePanel] = useState<EvidencePanelState>({
    status: 'closed',
  });
  const [selectedEvidence, setSelectedEvidence] =
    useState<
      Readonly<Extract<EvidencePanelState, {status: 'ready'}>['snapshot']>
    >();
  const evidenceReturnTarget = useRef<HTMLElement | undefined>(undefined);

  const refreshWorkspace = useCallback(
    async (signal?: AbortSignal) => {
      try {
        const response = await apiClient.workspace(
          signal === undefined ? undefined : {signal},
        );
        if (!signal?.aborted) {
          setWorkspace({status: 'ready', value: response.body});
        }
      } catch {
        if (!signal?.aborted) {
          setWorkspace({
            status: 'error',
            message: '无法读取当前工作区。请确认本机 API 配置与运行状态。',
          });
        }
      }
    },
    [apiClient],
  );

  const refreshEvidence = useCallback(
    async (signal?: AbortSignal) => {
      try {
        const response = await apiClient.listEvidence(
          signal === undefined ? undefined : {signal},
        );
        if (signal?.aborted) return;
        setSnapshots(
          response.body.snapshots.length === 0
            ? {status: 'empty'}
            : {status: 'ready', value: response.body.snapshots},
        );
      } catch {
        if (!signal?.aborted) {
          setSnapshots({
            status: 'error',
            message: '数据库或材料读模型当前不可用；已保存数据没有被修改。',
          });
        }
      }
    },
    [apiClient],
  );

  const refreshReviewPreferences = useCallback(
    async (signal?: AbortSignal) => {
      try {
        const response = await apiClient.loadReviewPreferences(
          signal === undefined ? undefined : {signal},
        );
        if (!signal?.aborted) {
          setReviewPreferences({status: 'ready', value: response.body});
        }
      } catch {
        if (!signal?.aborted) {
          setReviewPreferences({
            status: 'error',
            message: '无法读取外部个人标签设置；Entry 数据仍可继续查看。',
          });
        }
      }
    },
    [apiClient],
  );

  const saveReviewPreferences = useCallback(
    async (value: Readonly<ReviewPreferencesWrite>) => {
      const response = await apiClient.saveReviewPreferences(value);
      setReviewPreferences({status: 'ready', value: response.body});
      return response;
    },
    [apiClient],
  );

  useEffect(() => {
    const controller = new AbortController();
    globalThis.queueMicrotask(() => {
      void refreshWorkspace(controller.signal);
      void refreshEvidence(controller.signal);
      void refreshReviewPreferences(controller.signal);
    });
    return () => {
      controller.abort();
    };
  }, [refreshEvidence, refreshReviewPreferences, refreshWorkspace]);

  const openEvidence = useCallback(
    async (
      snapshotId: string,
      returnFocus?: HTMLElement,
      selectedFragmentId?: string,
      includePrivate = false,
    ) => {
      if (returnFocus !== undefined) evidenceReturnTarget.current = returnFocus;
      setEvidencePanel({
        status: 'loading',
        snapshotId,
        selectedFragmentId,
        includePrivate,
      });
      try {
        const response = await apiClient.loadEvidenceSnapshot(snapshotId, {
          includePrivate,
        });
        if (response.body.status === 'ok') {
          setSelectedEvidence(response.body.snapshot);
          setEvidencePanel({
            status: 'ready',
            snapshot: response.body.snapshot,
            selectedFragmentId,
          });
          return;
        }
        setEvidencePanel({
          status: 'error',
          snapshotId,
          selectedFragmentId,
          includePrivate,
          message: '该 Snapshot 不存在于当前工作区，或已切换到其他外部资料集。',
        });
      } catch {
        setEvidencePanel({
          status: 'error',
          snapshotId,
          selectedFragmentId,
          includePrivate,
          message: 'Blob 或数据库当前不可用；没有修改任何材料。',
        });
      }
    },
    [apiClient],
  );

  const materializeInformationEntries = useCallback(
    (
      body: unknown,
    ): Promise<M1cHttpResponse<InformationEntryMaterializeResponse>> =>
      apiClient.materializeInformationEntries(body),
    [apiClient],
  );

  const reviseInformationEntry = useCallback(
    (
      entryId: string,
      body: unknown,
    ): Promise<M1cHttpResponse<InformationEntryRevisionResponse>> =>
      apiClient.reviseInformationEntry(entryId, body),
    [apiClient],
  );

  const searchInformationEntries = useCallback(
    (body: unknown): Promise<M1cHttpResponse<InformationEntrySearchResponse>> =>
      apiClient.searchInformationEntries(body),
    [apiClient],
  );

  const readInformationEntryKnowledgeGraph = useCallback(
    (
      body: unknown,
    ): Promise<M1cHttpResponse<InformationEntryKnowledgeGraphResponse>> =>
      apiClient.readInformationEntryKnowledgeGraph(body),
    [apiClient],
  );

  const reviseInformationEntryKnowledgeGraphEdge = useCallback(
    (
      entryId: string,
      relatedEntryId: string,
      body: unknown,
    ): Promise<
      M1cHttpResponse<InformationEntryKnowledgeGraphEdgeWriteResponse>
    > =>
      apiClient.reviseInformationEntryKnowledgeGraphEdge(
        entryId,
        relatedEntryId,
        body,
      ),
    [apiClient],
  );

  const rebuildInformationEntryAssociations = useCallback(
    (
      body: unknown,
    ): Promise<M1cHttpResponse<InformationEntryAssociationRebuildResponse>> =>
      apiClient.rebuildInformationEntryAssociations(body),
    [apiClient],
  );

  const reviseInformationEntryAssociationPolicy = useCallback(
    (
      body: unknown,
    ): Promise<
      M1cHttpResponse<InformationEntryAssociationPolicyWriteResponse>
    > => apiClient.reviseInformationEntryAssociationPolicy(body),
    [apiClient],
  );

  const listInformationEntryAssociations = useCallback(
    (
      entryId: string,
      includePrivate: boolean,
    ): Promise<M1cHttpResponse<InformationEntryAssociationListResponse>> =>
      apiClient.listInformationEntryAssociations(entryId, {includePrivate}),
    [apiClient],
  );

  const reviseInformationEntryAssociation = useCallback(
    (
      entryId: string,
      relatedEntryId: string,
      body: unknown,
    ): Promise<M1cHttpResponse<InformationEntryAssociationOverrideResponse>> =>
      apiClient.reviseInformationEntryAssociation(
        entryId,
        relatedEntryId,
        body,
      ),
    [apiClient],
  );

  const listInformationEntryDocuments = useCallback(
    (
      includePrivate: boolean,
    ): Promise<M1cHttpResponse<InformationEntryDocumentListResponse>> =>
      apiClient.listInformationEntryDocuments({includePrivate}),
    [apiClient],
  );

  const aggregateInformationDocumentTags = useCallback(
    (
      snapshotId: string,
      body: unknown,
    ): Promise<M1cHttpResponse<InformationDocumentTagWriteResponse>> =>
      apiClient.aggregateInformationDocumentTags(snapshotId, body),
    [apiClient],
  );

  const reviseInformationDocumentTags = useCallback(
    (
      snapshotId: string,
      body: unknown,
    ): Promise<M1cHttpResponse<InformationDocumentTagWriteResponse>> =>
      apiClient.reviseInformationDocumentTags(snapshotId, body),
    [apiClient],
  );

  const listAiTagProposals = useCallback(
    (entryId: string): Promise<M1cHttpResponse<AiTagProposalListResponse>> =>
      apiClient.listAiTagProposals(entryId),
    [apiClient],
  );

  const startAiTagProposal = useCallback(
    (
      entryId: string,
      requestKey: string,
    ): Promise<M1cHttpResponse<AiTagProposalStartResponse>> =>
      apiClient.startAiTagProposal(entryId, requestKey),
    [apiClient],
  );

  const acceptAiTagProposal = useCallback(
    (
      entryId: string,
      proposalId: string,
    ): Promise<M1cHttpResponse<AiTagProposalDecisionResponse>> =>
      apiClient.acceptAiTagProposal(entryId, proposalId),
    [apiClient],
  );

  const rejectAiTagProposal = useCallback(
    (
      entryId: string,
      proposalId: string,
    ): Promise<M1cHttpResponse<AiTagProposalDecisionResponse>> =>
      apiClient.rejectAiTagProposal(entryId, proposalId),
    [apiClient],
  );

  const listProcessingRuns = useCallback(
    (limit: number): Promise<M1cHttpResponse<ProcessingRunListResponse>> =>
      apiClient.listProcessingRuns(limit),
    [apiClient],
  );

  const cancelProcessingRun = useCallback(
    (
      runId: string,
      expectedVersion: number,
    ): Promise<M1cHttpResponse<ProcessingRunCancelResponse>> =>
      apiClient.cancelProcessingRun(runId, expectedVersion),
    [apiClient],
  );

  function closeEvidence() {
    setEvidencePanel({status: 'closed'});
    const target = evidenceReturnTarget.current;
    evidenceReturnTarget.current = undefined;
    globalThis.setTimeout(() => target?.focus(), 0);
  }

  function selectEvidenceFragment(fragmentId: string) {
    setEvidencePanel((current) =>
      current.status === 'ready'
        ? {...current, selectedFragmentId: fragmentId}
        : current,
    );
  }

  async function importMarkdown(body: unknown): Promise<ActionFeedback> {
    try {
      const response = await apiClient.importMarkdown(body);
      const feedback = importFeedback(response.body);
      if (
        response.body.status === 'created' ||
        response.body.status === 'existing'
      ) {
        await refreshEvidence();
        await openEvidence(
          response.body.snapshotId,
          undefined,
          undefined,
          response.body.isPrivate === true,
        );
      }
      return feedback;
    } catch {
      return connectionFeedback(
        '材料没有写入；可以在服务恢复后使用同一表单重试。',
      );
    }
  }

  async function exportWorkspaceBundle(): Promise<WorkspaceTransferFeedback> {
    try {
      const response = await apiClient.exportWorkspaceBundle();
      return workspaceTransferFeedback(response.body, 'exported');
    } catch {
      return connectionFeedback(
        '个人数据包没有生成；数据库、原始文件和个人配置均未被修改。',
      );
    }
  }

  async function restoreWorkspaceBundle(
    fileName: string,
  ): Promise<WorkspaceTransferFeedback> {
    try {
      const response = await apiClient.restoreWorkspaceBundle(fileName);
      const feedback = workspaceTransferFeedback(response.body, 'restored');
      if (feedback.kind === 'success') {
        setEvidencePanel({status: 'closed'});
        setSelectedEvidence(undefined);
        await refreshEvidence();
        await refreshReviewPreferences();
      }
      return feedback;
    } catch {
      return connectionFeedback(
        '个人数据恢复没有执行；当前工作区内容保持不变。',
      );
    }
  }

  const snapshotValues = snapshots.status === 'ready' ? snapshots.value : [];
  return (
    <ProductAppShell
      activeSection={activeSection}
      health={health.state}
      transportMode={transportMode}
      workspace={workspace.status === 'ready' ? workspace.value : undefined}
      onNavigate={setActiveSection}
      evidencePanel={
        <EvidenceRail
          state={evidencePanel}
          onClose={closeEvidence}
          onRetry={(snapshotId) => {
            const selectedFragmentId =
              evidencePanel.status === 'error'
                ? evidencePanel.selectedFragmentId
                : undefined;
            const includePrivate =
              evidencePanel.status === 'error'
                ? evidencePanel.includePrivate
                : false;
            void openEvidence(
              snapshotId,
              undefined,
              selectedFragmentId,
              includePrivate,
            );
          }}
          onSelectFragment={selectEvidenceFragment}
        />
      }
    >
      <RuntimeNotice
        health={health.state}
        workspace={workspace}
        onRetry={() => {
          health.retry();
          void refreshWorkspace();
          void refreshEvidence();
          void refreshReviewPreferences();
        }}
      />
      {activeSection === 'overview' ? (
        <WorkflowOverview
          snapshots={snapshots}
          workspace={workspace.status === 'ready' ? workspace.value : undefined}
          onListDocuments={listInformationEntryDocuments}
          onListProcessingRuns={listProcessingRuns}
          onCancelProcessingRun={cancelProcessingRun}
          onNavigate={setActiveSection}
        />
      ) : null}
      {activeSection === 'import' ? (
        <MaterialsWorkspace
          snapshots={snapshots}
          selectedSnapshotId={selectedEvidence?.snapshotId}
          onImport={importMarkdown}
          onOpenEvidence={(snapshotId, target, includePrivate) =>
            void openEvidence(snapshotId, target, undefined, includePrivate)
          }
          onRefresh={() => void refreshEvidence()}
          onExport={exportWorkspaceBundle}
          onRestore={restoreWorkspaceBundle}
        />
      ) : null}
      {activeSection === 'split' ? (
        <InformationEntrySplitWorkspace
          aiEnabled={
            workspace.status === 'ready' &&
            workspace.value.capabilities.includes('ai')
          }
          onListDocuments={listInformationEntryDocuments}
          onMaterialize={materializeInformationEntries}
          onSearch={searchInformationEntries}
          onOpenEvidence={(snapshotId, fragmentId, includePrivate) =>
            void openEvidence(snapshotId, undefined, fragmentId, includePrivate)
          }
        />
      ) : null}
      {activeSection === 'tags' ? (
        <InformationEntryTagsWorkspace
          aiEnabled={
            workspace.status === 'ready' &&
            workspace.value.capabilities.includes('ai_tags')
          }
          reviewPreferences={reviewPreferences}
          reviewPreferencesOverride={reviewPreferencesOverride}
          onReviewPreferencesChange={setReviewPreferencesOverride}
          onAcceptAiTagProposal={acceptAiTagProposal}
          onAggregateDocumentTags={aggregateInformationDocumentTags}
          onListAiTagProposals={listAiTagProposals}
          onListDocuments={listInformationEntryDocuments}
          onRejectAiTagProposal={rejectAiTagProposal}
          onRevise={reviseInformationEntry}
          onReviseDocumentTags={reviseInformationDocumentTags}
          onSaveReviewPreferences={saveReviewPreferences}
          onSearch={searchInformationEntries}
          onStartAiTagProposal={startAiTagProposal}
          onOpenEvidence={(snapshotId, fragmentId, includePrivate) =>
            void openEvidence(snapshotId, undefined, fragmentId, includePrivate)
          }
        />
      ) : null}
      {activeSection === 'associations' ? (
        <InformationEntryAssociationsWorkspace
          aiEnabled={
            workspace.status === 'ready' &&
            workspace.value.capabilities.includes('ai')
          }
          onListAssociations={listInformationEntryAssociations}
          onRebuildAssociations={rebuildInformationEntryAssociations}
          onReviseAssociationPolicy={reviseInformationEntryAssociationPolicy}
          onReviseAssociation={reviseInformationEntryAssociation}
          onSearch={searchInformationEntries}
          onOpenEvidence={(snapshotId, fragmentId, includePrivate) =>
            void openEvidence(snapshotId, undefined, fragmentId, includePrivate)
          }
        />
      ) : null}
      {activeSection === 'query' ? (
        <InformationEntryQueryWorkspace
          aiEnabled={
            workspace.status === 'ready' &&
            workspace.value.capabilities.includes('ai')
          }
          snapshots={snapshotValues}
          onSearch={searchInformationEntries}
          onOpenEvidence={(snapshotId, fragmentId, includePrivate) =>
            void openEvidence(snapshotId, undefined, fragmentId, includePrivate)
          }
        />
      ) : null}
      {activeSection === 'knowledge' ? (
        <FormalKnowledgeWorkspace
          onReadGraph={readInformationEntryKnowledgeGraph}
          onReviseEdge={reviseInformationEntryKnowledgeGraphEdge}
          onOpenEvidence={(snapshotId, fragmentId, includePrivate) =>
            void openEvidence(snapshotId, undefined, fragmentId, includePrivate)
          }
        />
      ) : null}
    </ProductAppShell>
  );
}

function RuntimeNotice({
  health,
  onRetry,
  workspace,
}: {
  readonly health: ReturnType<typeof useOperationalHealth>['state'];
  readonly onRetry: () => void;
  readonly workspace: Loadable<Readonly<WorkspaceResponse>>;
}) {
  if (health.kind === 'ready' && workspace.status === 'ready') return null;
  if (health.kind === 'loading' || workspace.status === 'loading') {
    return (
      <div className="runtime-notice" role="status" aria-live="polite">
        正在确认本机服务与当前外部工作区…
      </div>
    );
  }
  const workspaceError =
    workspace.status === 'error' ? workspace.message : undefined;
  return (
    <div className="runtime-notice runtime-notice--warning" role="alert">
      <div>
        <strong>部分运行状态不可用</strong>
        <span>
          {workspaceError ??
            (health.kind === 'not_ready'
              ? '服务尚未就绪；表单不会把失败解释为已写入。'
              : '健康响应无法验证；请检查本机配置。')}
        </span>
      </div>
      <button className="secondary-action" type="button" onClick={onRetry}>
        重新检查
      </button>
    </div>
  );
}

function importFeedback(body: MarkdownImportResponse): ActionFeedback {
  if (body.status === 'created') {
    return {
      kind: 'success',
      title: '材料已保存并拆解',
      detail: `生成 ${body.fragmentIds.length.toString()} 个 Fragment；来源档案已打开。`,
    };
  }
  if (body.status === 'existing') {
    return {
      kind: 'success',
      title: '相同导入已存在',
      detail: '幂等重放没有创建重复材料；来源档案已打开。',
    };
  }
  return {
    kind: 'error',
    title: body.status === 'conflict' ? '导入命令发生冲突' : '材料未写入',
    detail: describeWireIssue(body),
  };
}

function connectionFeedback(detail: string): ActionFeedback {
  return {kind: 'error', title: '本地接口不可达', detail};
}

function workspaceTransferFeedback(
  body: WorkspaceBundleTransferResponse,
  expectedStatus: 'exported' | 'restored',
): WorkspaceTransferFeedback {
  if ('fileName' in body && body.status === expectedStatus) {
    const snapshotCount = body.tableCounts.snapshot ?? 0;
    return {
      kind: 'success',
      title:
        expectedStatus === 'exported'
          ? '全部个人数据已导出'
          : '全部个人数据已恢复',
      detail: `${snapshotCount.toString()} 个文档版本 · ${body.blobCount.toString()} 份原始 Blob · 标签、联系与个人偏好${body.personalDataIncluded ? '已包含' : '未包含'} · ${formatByteCount(body.byteLength)}`,
      fileName: body.fileName,
    };
  }
  const issue = 'issue' in body ? body.issue : {code: 'unexpected_status'};
  return {
    kind: 'error',
    title: expectedStatus === 'exported' ? '导出未完成' : '恢复未执行',
    detail: describeWireIssue(issue),
  };
}

function formatByteCount(value: number): string {
  return value < 1024
    ? `${value.toString()} B`
    : `${(value / 1024).toFixed(1)} KiB`;
}

function describeWireIssue(value: Readonly<Record<string, unknown>>): string {
  const code = typeof value.code === 'string' ? value.code : 'unknown_failure';
  const path = typeof value.path === 'string' ? ` · ${value.path}` : '';
  const budget =
    typeof value.budget === 'string' ? ` · 上限 ${value.budget}` : '';
  return `${code}${path}${budget}`;
}
