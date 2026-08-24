import {type ComponentProps, useMemo, useState} from 'react';

import {ActionNotice} from '../components/action_notice.js';
import {InformationEntryAiSplit} from './information_entry_ai_split.js';
import {
  InformationEntryManualSplit,
  type InformationEntryManualSplitProps,
} from './information_entry_manual_split.js';
import type {ActionFeedback} from '../components/product_types.js';
import {
  InformationEntryReadOnlyDetail,
  InformationEntryResults,
  type InformationEntryServices,
} from './information_entry_components.js';
import {
  InformationDocumentNavigator,
  InformationEntryBatchMaterializer,
} from './information_entry_document_navigation.js';
import {useInformationEntryController} from './use_information_entry_controller.js';
import {describeInformationEntryFailure} from './information_entry_shared.js';

export interface InformationEntrySplitWorkspaceProps extends Pick<
  InformationEntryServices,
  | 'onListDocuments'
  | 'onMaterialize'
  | 'onMaterializeManual'
  | 'onOpenEvidence'
  | 'onSearch'
> {
  readonly aiEnabled: boolean;
  readonly onLoadEvidenceSnapshot: InformationEntryManualSplitProps['onLoadSnapshot'];
  readonly onListAiSplitProposals: ComponentProps<
    typeof InformationEntryAiSplit
  >['onList'];
  readonly onStartAiSplitProposal: ComponentProps<
    typeof InformationEntryAiSplit
  >['onStart'];
  readonly onAcceptAiSplitProposal: ComponentProps<
    typeof InformationEntryAiSplit
  >['onAccept'];
  readonly onRejectAiSplitProposal: ComponentProps<
    typeof InformationEntryAiSplit
  >['onReject'];
}

export function InformationEntrySplitWorkspace({
  aiEnabled,
  onAcceptAiSplitProposal,
  onListAiSplitProposals,
  onListDocuments,
  onLoadEvidenceSnapshot,
  onMaterialize,
  onMaterializeManual,
  onOpenEvidence,
  onRejectAiSplitProposal,
  onSearch,
  onStartAiSplitProposal,
}: InformationEntrySplitWorkspaceProps) {
  const controller = useInformationEntryController({
    loadDocuments: true,
    onListDocuments,
    onSearch,
  });
  const [feedback, setFeedback] = useState<ActionFeedback>();
  const [materializing, setMaterializing] = useState(false);
  const [selectedBatchSnapshotIds, setSelectedBatchSnapshotIds] = useState<
    readonly string[]
  >(Object.freeze([]));

  const selectedDocument = useMemo(
    () =>
      controller.documentView.status === 'ready'
        ? controller.documentView.response.documents.find(
            (document) => document.snapshotId === controller.snapshotId,
          )
        : undefined,
    [controller.documentView, controller.snapshotId],
  );

  const availableBatchDocuments = useMemo(
    () =>
      controller.documentView.status === 'ready'
        ? controller.documentView.response.documents.filter(
            (document) => document.entryCount === 0,
          )
        : Object.freeze([]),
    [controller.documentView],
  );
  const availableBatchSnapshotIds = useMemo(() => {
    const availableIds = new Set(
      availableBatchDocuments.map((document) => document.snapshotId),
    );
    return Object.freeze(
      selectedBatchSnapshotIds.filter((snapshotId) =>
        availableIds.has(snapshotId),
      ),
    );
  }, [availableBatchDocuments, selectedBatchSnapshotIds]);

  async function materialize(snapshotId: string) {
    if (snapshotId === '' || materializing) {
      setFeedback({
        kind: 'error',
        title: '请选择来源文档',
        detail: 'Entry 必须从当前工作区中的一个精确 Snapshot 生成。',
      });
      return;
    }
    setMaterializing(true);
    setFeedback(undefined);
    try {
      const response = await onMaterialize({
        snapshotId,
        chunkMode: 'split',
        includePrivate: controller.includePrivate,
      });
      if (
        response.body.status !== 'created' &&
        response.body.status !== 'existing'
      ) {
        setFeedback({
          kind: 'error',
          title: '条目没有生成',
          detail: describeInformationEntryFailure(response.body),
        });
        return;
      }
      setFeedback({
        kind: 'success',
        title:
          response.body.status === 'created'
            ? '信息条目已生成'
            : '相同条目已经存在',
        detail:
          response.body.status === 'created'
            ? `新增 ${response.body.createdCount.toString()} 个可追溯 Entry。`
            : '幂等重试没有创建重复条目。',
      });
      await controller.executeSearch();
      await controller.refreshDocuments();
    } catch {
      setFeedback({
        kind: 'error',
        title: '本地接口不可达',
        detail: 'Entry 没有生成；Evidence 与正式知识保持不变。',
      });
    } finally {
      setMaterializing(false);
    }
  }

  async function materializeBatch() {
    if (availableBatchSnapshotIds.length === 0 || materializing) {
      setFeedback({
        kind: 'error',
        title: '请选择尚未生成的文档',
        detail: '只有明确勾选的 Snapshot 才会构建 Entry。',
      });
      return;
    }
    const selectedIds = new Set(availableBatchSnapshotIds);
    const documents = availableBatchDocuments.filter((document) =>
      selectedIds.has(document.snapshotId),
    );
    setMaterializing(true);
    setFeedback(undefined);
    let createdDocuments = 0;
    let existingDocuments = 0;
    let createdEntries = 0;
    const failedDocuments: string[] = [];
    try {
      for (const document of documents) {
        try {
          const response = await onMaterialize({
            snapshotId: document.snapshotId,
            chunkMode: 'split',
            includePrivate: controller.includePrivate,
          });
          if (response.body.status === 'created') {
            createdDocuments += 1;
            createdEntries += response.body.createdCount;
          } else if (response.body.status === 'existing') {
            existingDocuments += 1;
          } else {
            failedDocuments.push(document.snapshotId);
          }
        } catch {
          failedDocuments.push(document.snapshotId);
        }
      }
      setSelectedBatchSnapshotIds(Object.freeze(failedDocuments));
      setFeedback(
        failedDocuments.length === 0
          ? {
              kind: 'success',
              title: '所选文档已完成 Entry 构建',
              detail: `${createdDocuments.toString()} 份新增 ${createdEntries.toString()} 个 Entry；${existingDocuments.toString()} 份保持既有状态。`,
            }
          : {
              kind: 'error',
              title: '部分文档尚未完成',
              detail: `已完成 ${(documents.length - failedDocuments.length).toString()} / ${documents.length.toString()} 份；失败项仍保持选中，可安全重试。`,
            },
      );
      await controller.executeSearch();
      await controller.refreshDocuments();
    } finally {
      setMaterializing(false);
    }
  }

  function toggleBatchSnapshot(snapshotId: string, selected: boolean) {
    setSelectedBatchSnapshotIds((current) =>
      selected
        ? current.includes(snapshotId)
          ? current
          : Object.freeze([...current, snapshotId])
        : Object.freeze(current.filter((value) => value !== snapshotId)),
    );
  }

  return (
    <div
      className="workspace-view entry-workspace workflow-stage-workspace"
      data-workflow-page="split"
    >
      <header className="workflow-page-heading">
        <div>
          <p className="section-index">02 / DOCUMENT SPLIT</p>
          <h1>拆分</h1>
          <p>选择来源文档，检查结构拆分，并生成可编辑的信息条目。</p>
        </div>
        <span className="origin-label origin-label--deterministic">
          {aiEnabled ? '结构规则 + AI 人工确认' : '结构规则 · 可离线使用'}
        </span>
      </header>

      <section className="workflow-capability-strip" aria-label="拆分能力">
        <div className="workflow-capability-strip__primary">
          <p className="section-index">SPLIT MODE</p>
          <strong>人工分组优先，确定性规则随时可用</strong>
          <span>在 Fragment 边界合并或拆开；原始 Snapshot 始终不变。</span>
        </div>
        <div className="workflow-capability-strip__options">
          <span data-active="true">人工拆分 / 合并</span>
          <span data-active="true">结构规则</span>
          <span data-active="true">明确批量选择</span>
          <span data-active={aiEnabled}>OpenAI 提案 · 手动接受</span>
        </div>
      </section>

      <InformationDocumentNavigator
        state={controller.documentView}
        selectedSnapshotId={controller.snapshotId}
        onSelect={(snapshotId) => {
          setFeedback(undefined);
          controller.setSnapshotId(snapshotId);
        }}
        onRetry={() => void controller.refreshDocuments()}
      />

      <InformationEntryManualSplit
        snapshotId={controller.snapshotId}
        isPrivate={selectedDocument?.isPrivate === true}
        includePrivate={controller.includePrivate}
        alreadyMaterialized={(selectedDocument?.entryCount ?? 0) > 0}
        onLoadSnapshot={onLoadEvidenceSnapshot}
        onMaterialize={onMaterializeManual}
        onCommitted={async () => {
          await controller.executeSearch();
          await controller.refreshDocuments();
        }}
      />
      <InformationEntryBatchMaterializer
        state={controller.documentView}
        busy={materializing}
        selectedSnapshotIds={availableBatchSnapshotIds}
        onClear={() => {
          setSelectedBatchSnapshotIds(Object.freeze([]));
        }}
        onSelectAll={() => {
          setSelectedBatchSnapshotIds(
            Object.freeze(
              availableBatchDocuments.map((document) => document.snapshotId),
            ),
          );
        }}
        onSubmit={() => void materializeBatch()}
        onToggle={toggleBatchSnapshot}
      />

      <section
        className="entry-command-panel"
        aria-labelledby="split-command-title"
      >
        <header className="console-heading">
          <div>
            <p className="section-index">SPLIT / SELECTED DOCUMENT</p>
            <h2 id="split-command-title">生成当前文档的条目</h2>
          </div>
        </header>
        <div className="entry-search-form">
          <label className="privacy-query-toggle entry-private-toggle">
            <input
              type="checkbox"
              checked={controller.includePrivate}
              onChange={(event) => {
                controller.setIncludePrivate(event.currentTarget.checked);
                controller.setOnlyPrivate(false);
              }}
            />
            查看并处理隐私文档
          </label>
          <div className="entry-command-actions">
            <button
              className="primary-action entry-materialize-action"
              type="button"
              disabled={
                materializing ||
                controller.snapshotId === '' ||
                (selectedDocument?.entryCount ?? 0) > 0
              }
              onClick={() => void materialize(controller.snapshotId)}
            >
              {materializing ? '正在生成…' : '按结构生成条目'}
            </button>
          </div>
        </div>
        <ActionNotice feedback={feedback} />
      </section>

      <InformationEntryAiSplit
        enabled={aiEnabled}
        snapshotId={controller.snapshotId}
        isPrivate={selectedDocument?.isPrivate === true}
        alreadyMaterialized={(selectedDocument?.entryCount ?? 0) > 0}
        onLoadSnapshot={onLoadEvidenceSnapshot}
        onList={onListAiSplitProposals}
        onStart={onStartAiSplitProposal}
        onAccept={onAcceptAiSplitProposal}
        onReject={onRejectAiSplitProposal}
        onAccepted={async () => {
          await controller.executeSearch();
          await controller.refreshDocuments();
        }}
      />

      <InformationEntryResults
        ariaLabel="拆分条目预览"
        emptyDescription="选择尚未生成 Entry 的文档并执行拆分。"
        state={controller.view}
        selectedEntryId={controller.selectedEntryId}
        pageIndex={controller.pageIndex}
        onSelectEntry={controller.setSelectedEntryId}
        onRetry={() => void controller.executeSearch()}
        onPreviousPage={() => {
          controller.showPreviousPage();
        }}
        onNextPage={() => {
          controller.showNextPage();
        }}
      >
        {controller.selectedEntry === undefined ? undefined : (
          <InformationEntryReadOnlyDetail
            entry={controller.selectedEntry}
            variant="split"
            onOpenEvidence={onOpenEvidence}
          />
        )}
      </InformationEntryResults>
    </div>
  );
}
