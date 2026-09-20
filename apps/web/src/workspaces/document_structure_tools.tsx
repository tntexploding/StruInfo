import type {InformationEntryDocumentView} from '../api/m1c_api_contract.js';
import {InformationEntryAiSplit} from './information_entry_ai_split.js';
import {InformationDocumentWorkingCopy} from './information_document_working_copy.js';
import {InformationEntryManualSplit} from './information_entry_manual_split.js';
import {InformationEntryRestructure} from './information_entry_restructure.js';
import {InformationEntrySplitRule} from './information_entry_split_rule.js';
import type {InformationEntrySplitWorkspaceProps} from './information_entry_split_workspace.js';

export function DocumentStructureTools({
  document,
  includePrivate,
  services: s,
  onChanged,
}: {
  readonly document: Readonly<InformationEntryDocumentView>;
  readonly includePrivate: boolean;
  readonly services: InformationEntrySplitWorkspaceProps;
  readonly onChanged: (snapshotId: string) => Promise<void>;
}) {
  const snapshotId = document.snapshotId;
  const isPrivate = document.isPrivate === true;
  const materialized = document.entryCount > 0;
  const locked = materialized || document.workingCopy !== undefined;
  const committed = () => onChanged(snapshotId);
  return (
    <div className="document-structure-tools">
      <p className="workflow-boundary-note">
        结构基于原文生成。已有条目需先预览变更影响，再明确提交。
      </p>
      {materialized ? (
        <InformationEntryRestructure
          snapshotId={snapshotId}
          isPrivate={isPrivate}
          includePrivate={includePrivate}
          alreadyMaterialized
          onLoadSnapshot={s.onLoadEvidenceSnapshot}
          onPreview={s.onPreviewRestructure}
          onApply={s.onApplyRestructure}
          onCommitted={committed}
        />
      ) : (
        <InformationEntryManualSplit
          snapshotId={snapshotId}
          isPrivate={isPrivate}
          includePrivate={includePrivate}
          alreadyMaterialized={locked}
          onLoadSnapshot={s.onLoadEvidenceSnapshot}
          onMaterialize={s.onMaterializeManual}
          onCommitted={committed}
        />
      )}
      {!materialized ? (
        <details className="workflow-tool-drawer">
          <summary>拆分前全文修改</summary>
          <InformationDocumentWorkingCopy
            snapshotId={snapshotId}
            isPrivate={isPrivate}
            includePrivate={includePrivate}
            alreadyMaterialized={false}
            onLoad={s.onLoadDocumentWorkingCopy}
            onSave={s.onSaveDocumentWorkingCopy}
            onRestore={s.onRestoreDocumentWorkingCopy}
            onCommit={s.onCommitDocumentWorkingCopy}
            onCommitted={onChanged}
          />
        </details>
      ) : null}
      <details className="workflow-tool-drawer">
        <summary>结构规则</summary>
        <InformationEntrySplitRule
          snapshotId={snapshotId}
          isPrivate={isPrivate}
          includePrivate={includePrivate}
          alreadyMaterialized={locked}
          onLoad={s.onLoadSplitRuleProfile}
          onSave={s.onSaveSplitRuleProfile}
          onTrial={s.onTrialSplitRule}
          onApply={s.onApplySplitRule}
          onCommitted={committed}
        />
      </details>
      <details className="workflow-tool-drawer">
        <summary>AI 拆分建议{s.aiEnabled ? '' : '（未启用）'}</summary>
        <InformationEntryAiSplit
          enabled={s.aiEnabled}
          snapshotId={snapshotId}
          isPrivate={isPrivate}
          alreadyMaterialized={locked}
          onLoadSnapshot={s.onLoadEvidenceSnapshot}
          onList={s.onListAiSplitProposals}
          onStart={s.onStartAiSplitProposal}
          onAccept={s.onAcceptAiSplitProposal}
          onReject={s.onRejectAiSplitProposal}
          onAccepted={committed}
        />
      </details>
    </div>
  );
}
