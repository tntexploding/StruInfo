import {type ComponentProps, useMemo, useState} from 'react';

import {ActionNotice} from '../components/action_notice.js';
import {InformationEntryAiSplit} from './information_entry_ai_split.js';
import {
  InformationDocumentWorkingCopy,
  type InformationDocumentWorkingCopyProps,
} from './information_document_working_copy.js';
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
import {InformationEntryRestructure} from './information_entry_restructure.js';
import {
  InformationEntrySplitRule,
  type InformationEntrySplitRuleProps,
} from './information_entry_split_rule.js';

export interface InformationEntrySplitWorkspaceProps extends Pick<
  InformationEntryServices,
  | 'onListDocuments'
  | 'onMaterialize'
  | 'onMaterializeManual'
  | 'onPreviewRestructure'
  | 'onApplyRestructure'
  | 'onOpenEvidence'
  | 'onSearch'
> {
  readonly aiEnabled: boolean;
  readonly onLoadEvidenceSnapshot: InformationEntryManualSplitProps['onLoadSnapshot'];
  readonly onLoadDocumentWorkingCopy: InformationDocumentWorkingCopyProps['onLoad'];
  readonly onSaveDocumentWorkingCopy: InformationDocumentWorkingCopyProps['onSave'];
  readonly onRestoreDocumentWorkingCopy: InformationDocumentWorkingCopyProps['onRestore'];
  readonly onCommitDocumentWorkingCopy: InformationDocumentWorkingCopyProps['onCommit'];
  readonly onLoadSplitRuleProfile: InformationEntrySplitRuleProps['onLoad'];
  readonly onSaveSplitRuleProfile: InformationEntrySplitRuleProps['onSave'];
  readonly onTrialSplitRule: InformationEntrySplitRuleProps['onTrial'];
  readonly onApplySplitRule: InformationEntrySplitRuleProps['onApply'];
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
  onLoadDocumentWorkingCopy,
  onSaveDocumentWorkingCopy,
  onRestoreDocumentWorkingCopy,
  onCommitDocumentWorkingCopy,
  onLoadSplitRuleProfile,
  onSaveSplitRuleProfile,
  onTrialSplitRule,
  onApplySplitRule,
  onMaterialize,
  onMaterializeManual,
  onPreviewRestructure,
  onApplyRestructure,
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
            (document) =>
              document.entryCount === 0 && document.workingCopy === undefined,
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
        detail: '条目必须从当前工作区的一份来源文档生成。',
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
            ? `新增 ${response.body.createdCount.toString()} 个可追溯条目。`
            : '没有重复生成条目。',
      });
      await controller.executeSearch();
      await controller.refreshDocuments();
    } catch {
      setFeedback({
        kind: 'error',
        title: '本地接口不可达',
        detail: '条目没有生成；原文和知识图谱保持不变。',
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
        detail: '只有明确勾选的来源文档才会构建条目。',
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
              title: '所选文档已完成条目构建',
              detail: `${createdDocuments.toString()} 份新增 ${createdEntries.toString()} 个条目；${existingDocuments.toString()} 份保持既有状态。`,
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
          <h1>拆分</h1>
        </div>
      </header>

      <aside className="workflow-mode-summary" aria-label="拆分页操作指南">
        <strong>拆分文档</strong>
        <span>1. 从左侧选择来源文档</span>
        <span>2. 在中间检查条目与正文</span>
        <span>3. 从右侧拆分并保存结构</span>
      </aside>

      <div className="split-studio-grid">
        <aside className="split-studio-grid__documents">
          <InformationDocumentNavigator
            state={controller.documentView}
            selectedSnapshotId={controller.snapshotId}
            onSelect={(snapshotId) => {
              setFeedback(undefined);
              controller.setSnapshotId(snapshotId);
            }}
            onRetry={() => void controller.refreshDocuments()}
          />
        </aside>

        <main className="split-studio-grid__preview">
          <InformationEntryResults
            ariaLabel="拆分条目预览"
            emptyDescription="从左侧选择文档，再在右侧人工拆分或应用结构规则。"
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
          <InformationEntryAiSplit
            enabled={aiEnabled}
            snapshotId={controller.snapshotId}
            isPrivate={selectedDocument?.isPrivate === true}
            alreadyMaterialized={
              (selectedDocument?.entryCount ?? 0) > 0 ||
              selectedDocument?.workingCopy !== undefined
            }
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
        </main>

        <aside className="split-studio-grid__tools">
          <InformationEntryManualSplit
            snapshotId={controller.snapshotId}
            isPrivate={selectedDocument?.isPrivate === true}
            includePrivate={controller.includePrivate}
            alreadyMaterialized={
              (selectedDocument?.entryCount ?? 0) > 0 ||
              selectedDocument?.workingCopy !== undefined
            }
            onLoadSnapshot={onLoadEvidenceSnapshot}
            onMaterialize={onMaterializeManual}
            onCommitted={async () => {
              await controller.executeSearch();
              await controller.refreshDocuments();
            }}
          />

          <section className="split-quick-action" aria-label="构建当前文档条目">
            <header>
              <strong>构建当前文档</strong>
            </header>
            <label className="privacy-query-toggle">
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
            <button
              className="secondary-action"
              type="button"
              disabled={
                materializing ||
                controller.snapshotId === '' ||
                (selectedDocument?.entryCount ?? 0) > 0 ||
                selectedDocument?.workingCopy !== undefined
              }
              onClick={() => void materialize(controller.snapshotId)}
            >
              {materializing ? '正在生成…' : '按结构直接生成'}
            </button>
            <ActionNotice feedback={feedback} />
          </section>

          <details className="workflow-tool-drawer split-batch-drawer">
            <summary>
              <span>批量构建文档条目</span>
              <span className="workflow-tool-drawer__hint" aria-hidden="true">
                <span className="workflow-tool-drawer__hint-closed">
                  点击展开
                </span>
                <span className="workflow-tool-drawer__hint-open">
                  点击收起
                </span>
              </span>
            </summary>
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
                    availableBatchDocuments.map(
                      (document) => document.snapshotId,
                    ),
                  ),
                );
              }}
              onSubmit={() => void materializeBatch()}
              onToggle={toggleBatchSnapshot}
            />
          </details>

          <details className="workflow-tool-drawer">
            <summary>
              <span>拆分前全文修改</span>
              <span className="workflow-tool-drawer__hint" aria-hidden="true">
                <span className="workflow-tool-drawer__hint-closed">
                  点击展开
                </span>
                <span className="workflow-tool-drawer__hint-open">
                  点击收起
                </span>
              </span>
            </summary>
            <InformationDocumentWorkingCopy
              key={`${controller.snapshotId}:${controller.includePrivate ? 'private' : 'public'}:${(selectedDocument?.entryCount ?? 0) > 0 ? 'materialized' : 'editable'}`}
              snapshotId={controller.snapshotId}
              isPrivate={selectedDocument?.isPrivate === true}
              includePrivate={controller.includePrivate}
              alreadyMaterialized={(selectedDocument?.entryCount ?? 0) > 0}
              onLoad={onLoadDocumentWorkingCopy}
              onSave={onSaveDocumentWorkingCopy}
              onRestore={onRestoreDocumentWorkingCopy}
              onCommit={onCommitDocumentWorkingCopy}
              onCommitted={async (derivedSnapshotId) => {
                await controller.refreshDocuments();
                controller.setSnapshotId(derivedSnapshotId);
              }}
            />
          </details>

          <details className="workflow-tool-drawer">
            <summary>
              <span>结构规则</span>
              <span className="workflow-tool-drawer__hint" aria-hidden="true">
                <span className="workflow-tool-drawer__hint-closed">
                  点击展开
                </span>
                <span className="workflow-tool-drawer__hint-open">
                  点击收起
                </span>
              </span>
            </summary>
            <InformationEntrySplitRule
              snapshotId={controller.snapshotId}
              isPrivate={selectedDocument?.isPrivate === true}
              includePrivate={controller.includePrivate}
              alreadyMaterialized={
                (selectedDocument?.entryCount ?? 0) > 0 ||
                selectedDocument?.workingCopy !== undefined
              }
              onLoad={onLoadSplitRuleProfile}
              onSave={onSaveSplitRuleProfile}
              onTrial={onTrialSplitRule}
              onApply={onApplySplitRule}
              onCommitted={async () => {
                await controller.executeSearch();
                await controller.refreshDocuments();
              }}
            />
          </details>

          <details className="workflow-tool-drawer">
            <summary>
              <span>调整已经拆分的结构</span>
              <span className="workflow-tool-drawer__hint" aria-hidden="true">
                <span className="workflow-tool-drawer__hint-closed">
                  点击展开
                </span>
                <span className="workflow-tool-drawer__hint-open">
                  点击收起
                </span>
              </span>
            </summary>
            <InformationEntryRestructure
              snapshotId={controller.snapshotId}
              isPrivate={selectedDocument?.isPrivate === true}
              includePrivate={controller.includePrivate}
              alreadyMaterialized={(selectedDocument?.entryCount ?? 0) > 0}
              onLoadSnapshot={onLoadEvidenceSnapshot}
              onPreview={onPreviewRestructure}
              onApply={onApplyRestructure}
              onCommitted={async () => {
                await controller.executeSearch();
                await controller.refreshDocuments();
              }}
            />
          </details>
        </aside>
      </div>
    </div>
  );
}
