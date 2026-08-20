import {useCallback, useEffect, useRef, useState} from 'react';

import type {
  CurationState,
  DomainCommandResponse,
  EvidenceSnapshotSummary,
  KnowledgeSearchResponse,
  M1cHttpResponse,
  MarkdownImportResponse,
  ReviewPreferencesWrite,
  ReviewPreferencesResponse,
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
import {KnowledgeWorkspace} from './workspaces/knowledge_workspace.js';
import {ReviewWorkspace} from './workspaces/review_workspace.js';
import {SearchWorkspace} from './workspaces/search_workspace.js';

export interface AppProps {
  readonly apiClient: M1cApiClient;
  readonly healthClient: HealthClient;
  readonly transportMode: HealthTransportMode;
}

export function App({apiClient, healthClient, transportMode}: AppProps) {
  const health = useOperationalHealth(healthClient);
  const [activeSection, setActiveSection] =
    useState<ProductSection>('materials');
  const [workspace, setWorkspace] = useState<
    Loadable<Readonly<WorkspaceResponse>>
  >({status: 'loading'});
  const [snapshots, setSnapshots] = useState<
    Loadable<readonly Readonly<EvidenceSnapshotSummary>[]>
  >({status: 'loading'});
  const [curation, setCuration] = useState<Loadable<Readonly<CurationState>>>({
    status: 'loading',
  });
  const [reviewPreferences, setReviewPreferences] = useState<
    Loadable<Readonly<ReviewPreferencesResponse>>
  >({status: 'loading'});
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

  const refreshCuration = useCallback(
    async (signal?: AbortSignal) => {
      try {
        const response = await apiClient.loadCuration(
          signal === undefined ? undefined : {signal},
        );
        if (!signal?.aborted) {
          setCuration({status: 'ready', value: response.body.state});
        }
      } catch {
        if (!signal?.aborted) {
          setCuration({
            status: 'error',
            message: '无法读取当前审核版本；请稍后重试，避免基于陈旧状态提交。',
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
            message:
              '个人偏好服务尚未加载；仍可在本次页面会话新增并使用快捷标记、调整自动标签和完成手工分类，重启新版服务后这些设置才会持久化。',
          });
        }
      }
    },
    [apiClient],
  );

  useEffect(() => {
    const controller = new AbortController();
    globalThis.queueMicrotask(() => {
      void refreshWorkspace(controller.signal);
      void refreshEvidence(controller.signal);
      void refreshCuration(controller.signal);
      void refreshReviewPreferences(controller.signal);
    });
    return () => {
      controller.abort();
    };
  }, [
    refreshCuration,
    refreshEvidence,
    refreshReviewPreferences,
    refreshWorkspace,
  ]);

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

  const selectEvidenceForKnowledge = useCallback(
    async (
      snapshotId: string,
      includePrivate: boolean,
    ): Promise<ActionFeedback> => {
      try {
        const response = await apiClient.loadEvidenceSnapshot(snapshotId, {
          includePrivate,
        });
        if (response.body.status !== 'ok') {
          return {
            kind: 'error',
            title: '无法选择审核来源',
            detail: '该 Snapshot 不存在于当前工作区，或隐私查看未被明确启用。',
          };
        }
        setSelectedEvidence(response.body.snapshot);
        return {
          kind: 'success',
          title: '审核来源已切换',
          detail: '正在核对这份文档已经形成的正式知识。',
        };
      } catch {
        return connectionFeedback(
          '无法读取所选 Snapshot；当前正式知识没有被修改。',
        );
      }
    },
    [apiClient],
  );

  const searchKnowledge = useCallback(
    (body: unknown) => apiClient.search(body),
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

  async function putTerm(body: unknown): Promise<ActionFeedback> {
    try {
      const response = await apiClient.putCurationTerm(body);
      const feedback = domainFeedback(response.body, '分类词条已保存');
      if (feedback.kind === 'success') await refreshCuration();
      return feedback;
    } catch {
      return connectionFeedback('分类词条没有写入；当前审核状态保持不变。');
    }
  }

  async function applyCuration(body: unknown): Promise<ActionFeedback> {
    try {
      const response = await apiClient.applyCuration(body);
      const feedback = domainFeedback(response.body, '人工审核已保存');
      if (feedback.kind === 'success') await refreshCuration();
      return feedback;
    } catch {
      return connectionFeedback('审核命令没有写入；当前材料与知识保持不变。');
    }
  }

  async function saveReviewPreferences(
    preferences: Readonly<ReviewPreferencesWrite>,
  ): Promise<ActionFeedback> {
    try {
      const response = await apiClient.saveReviewPreferences(preferences);
      setReviewPreferences({status: 'ready', value: response.body});
      return {
        kind: 'success',
        title: '审核偏好已保存',
        detail: '配置只写入当前外部工作区的个人偏好文件。',
      };
    } catch {
      return connectionFeedback(
        '审核偏好没有保存；当前 Fragment 的审核内容未受影响。',
      );
    }
  }

  async function applyKnowledge(body: unknown): Promise<ActionFeedback> {
    try {
      const response = await apiClient.applyKnowledgeChangeSet(body);
      return domainFeedback(response.body, '知识变更集已提交');
    } catch {
      return connectionFeedback('知识变更集没有写入；可以在服务恢复后重试。');
    }
  }

  async function exportWorkspaceBundle(): Promise<WorkspaceTransferFeedback> {
    try {
      const response = await apiClient.exportWorkspaceBundle();
      return workspaceTransferFeedback(response.body, 'exported');
    } catch {
      return connectionFeedback(
        'Bundle 没有生成；数据库和外部 Blob 均未被修改。',
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
        await refreshCuration();
      }
      return feedback;
    } catch {
      return connectionFeedback('恢复没有执行；当前工作区内容保持不变。');
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
          void refreshCuration();
          void refreshReviewPreferences();
        }}
      />
      {activeSection === 'materials' ? (
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
      {activeSection === 'review' ? (
        <ReviewWorkspace
          curation={curation}
          evidence={selectedEvidence}
          reviewPreferences={reviewPreferences}
          snapshots={snapshotValues}
          onApplyCuration={applyCuration}
          onOpenEvidence={(snapshotId, target, fragmentId) =>
            void openEvidence(
              snapshotId,
              target,
              fragmentId,
              snapshotValues.find(
                (snapshot) => snapshot.snapshotId === snapshotId,
              )?.isPrivate === true,
            )
          }
          onPutTerm={putTerm}
          onSaveReviewPreferences={saveReviewPreferences}
          onRefresh={() => {
            void refreshCuration();
            void refreshReviewPreferences();
          }}
        />
      ) : null}
      {activeSection === 'knowledge' ? (
        <KnowledgeWorkspace
          curation={curation}
          evidence={selectedEvidence}
          snapshots={snapshotValues}
          reviewPreferences={reviewPreferences}
          onApplyCuration={applyCuration}
          onApplyKnowledge={applyKnowledge}
          onLoadKnowledgeItem={(itemId, includePrivate) =>
            apiClient.loadKnowledgeItem(itemId, {includePrivate})
          }
          onOpenEvidence={(snapshotId, fragmentId, includePrivate) =>
            void openEvidence(snapshotId, undefined, fragmentId, includePrivate)
          }
          onPutTerm={putTerm}
          onRefresh={() => {
            void refreshCuration();
            void refreshReviewPreferences();
          }}
          onSearch={searchKnowledge}
          onSelectEvidence={selectEvidenceForKnowledge}
          onSaveReviewPreferences={saveReviewPreferences}
        />
      ) : null}
      {activeSection === 'search' ? (
        <SearchWorkspace
          snapshots={snapshotValues}
          onOpenEvidence={(snapshotId, target, fragmentId, includePrivate) =>
            void openEvidence(snapshotId, target, fragmentId, includePrivate)
          }
          onSearch={searchKnowledge}
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

function domainFeedback(
  body: DomainCommandResponse,
  successTitle: string,
): ActionFeedback {
  if (
    body.status === 'applied' ||
    body.status === 'unchanged' ||
    body.status === 'replayed'
  ) {
    return {
      kind: 'success',
      title: successTitle,
      detail:
        body.status === 'applied'
          ? '新修订已原子提交。'
          : body.status === 'unchanged'
            ? '请求与当前状态相同，没有创建多余修订。'
            : '相同命令已安全重放，返回首次提交凭据。',
    };
  }
  if (!('issue' in body)) {
    return {
      kind: 'error',
      title: '返回协议无法识别',
      detail: '命令结果没有包含可显示的问题信息。',
    };
  }
  return {
    kind: 'error',
    title: body.status === 'rejected' ? '命令未被接受' : '持久化失败',
    detail: describeWireIssue(body.issue),
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
          ? '工作区 Bundle 已导出'
          : '工作区 Bundle 已恢复',
      detail: `${snapshotCount.toString()} 个 Snapshot · ${body.blobCount.toString()} 个 Blob 引用 · ${formatByteCount(body.byteLength)}`,
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

export type M1cSearchHandler = (
  body: unknown,
) => Promise<M1cHttpResponse<KnowledgeSearchResponse>>;
