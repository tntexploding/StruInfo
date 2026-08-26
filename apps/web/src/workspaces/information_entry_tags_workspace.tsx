import type {SyntheticEvent} from 'react';
import {useState} from 'react';

import type {
  InformationEntryPreferenceProfileResponse,
  ReviewPreferencesResponse,
  ReviewPreferencesWrite,
} from '../api/m1c_api_contract.js';
import {ActionNotice} from '../components/action_notice.js';
import type {ActionFeedback, Loadable} from '../components/product_types.js';
import {
  InformationEntryResults,
  type InformationEntryServices,
} from './information_entry_components.js';
import {InformationEntryAiTags} from './information_entry_ai_tags.js';
import {InformationEntryAutomationPolicyPanel} from './information_entry_automation_policy_panel.js';
import {InformationEntryPreferenceProfilePanel} from './information_entry_preference_profile_panel.js';
import {InformationDocumentNavigator} from './information_entry_document_navigation.js';
import {
  InformationDocumentPanel,
  InformationEntryEditor,
} from './information_entry_tag_editor.js';
import {useInformationEntryController} from './use_information_entry_controller.js';

export interface InformationEntryTagsWorkspaceProps extends Pick<
  InformationEntryServices,
  | 'onAcceptAiTagProposal'
  | 'onAggregateDocumentTags'
  | 'onExecuteEntryAutomation'
  | 'onListAiTagProposals'
  | 'onListDocuments'
  | 'onListEntryAutomationExecutions'
  | 'onLoadEntryAutomationExecution'
  | 'onLoadEntryAutomationPolicy'
  | 'onOpenEvidence'
  | 'onRejectAiTagProposal'
  | 'onRevise'
  | 'onReviseDocumentTags'
  | 'onSaveEntryAutomationPolicy'
  | 'onSaveEntryPreferenceProfile'
  | 'onSaveReviewPreferences'
  | 'onSearch'
  | 'onSuggestEntryPreferenceProfile'
  | 'onStartAiTagProposal'
  | 'onTrialEntryAutomationPolicy'
  | 'onTrialEntryPreferenceProfile'
> {
  readonly aiEnabled: boolean;
  readonly automationEnabled: boolean;
  readonly entryPreferenceProfile: Loadable<
    Readonly<InformationEntryPreferenceProfileResponse>
  >;
  readonly onReloadEntryPreferenceProfile: () => void;
  readonly reviewPreferences: Loadable<Readonly<ReviewPreferencesResponse>>;
  readonly reviewPreferencesOverride?:
    Readonly<ReviewPreferencesWrite> | undefined;
  readonly onReviewPreferencesChange: (
    value: Readonly<ReviewPreferencesWrite>,
  ) => void;
}

export function InformationEntryTagsWorkspace({
  aiEnabled,
  automationEnabled,
  onAcceptAiTagProposal,
  onAggregateDocumentTags,
  onExecuteEntryAutomation,
  onListAiTagProposals,
  onListDocuments,
  onListEntryAutomationExecutions,
  onLoadEntryAutomationExecution,
  onLoadEntryAutomationPolicy,
  onOpenEvidence,
  onRejectAiTagProposal,
  onRevise,
  onReviseDocumentTags,
  onSaveEntryAutomationPolicy,
  onSaveEntryPreferenceProfile,
  onSaveReviewPreferences,
  onSearch,
  onSuggestEntryPreferenceProfile,
  onStartAiTagProposal,
  onTrialEntryAutomationPolicy,
  onTrialEntryPreferenceProfile,
  entryPreferenceProfile,
  onReloadEntryPreferenceProfile,
  reviewPreferences,
  reviewPreferencesOverride,
  onReviewPreferencesChange,
}: InformationEntryTagsWorkspaceProps) {
  const controller = useInformationEntryController({
    loadDocuments: true,
    onListDocuments,
    onSearch,
  });
  const [feedback, setFeedback] = useState<ActionFeedback>();

  function submitSearch(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    setFeedback(undefined);
    void controller.executeSearch();
  }

  const canGoPrevious =
    controller.selectedEntryIndex > 0 || controller.pageIndex > 0;
  const canGoNext =
    (controller.view.status === 'ready' &&
      controller.selectedEntryIndex >= 0 &&
      controller.selectedEntryIndex <
        controller.view.response.items.length - 1) ||
    (controller.view.status === 'ready' &&
      controller.view.response.nextCursor !== undefined);

  function showPreviousEntry() {
    if (controller.view.status !== 'ready') return;
    if (controller.selectedEntryIndex > 0) {
      controller.setSelectedEntryId(
        controller.view.response.items[controller.selectedEntryIndex - 1]?.entry
          .entryId,
      );
      return;
    }
    controller.showPreviousPage('last');
  }

  function showNextEntry() {
    if (controller.view.status !== 'ready') return;
    if (
      controller.selectedEntryIndex >= 0 &&
      controller.selectedEntryIndex < controller.view.response.items.length - 1
    ) {
      controller.setSelectedEntryId(
        controller.view.response.items[controller.selectedEntryIndex + 1]?.entry
          .entryId,
      );
      return;
    }
    controller.showNextPage('first');
  }

  return (
    <div
      className="workspace-view entry-workspace workflow-stage-workspace"
      data-workflow-page="tags"
    >
      <header className="workflow-page-heading">
        <div>
          <p className="section-index">03 / ENTRY TAGGING</p>
          <h1>标签</h1>
          <p>在一个连续审核队列中完成评分、关键词、类型和领域标注。</p>
        </div>
        <span className="origin-label origin-label--manual">
          {aiEnabled
            ? '确定性候选 + OpenAI 提案 + 人工接受'
            : '确定性候选 · 无需 AI'}
        </span>
      </header>

      <section className="workflow-capability-strip" aria-label="标签能力">
        <div className="workflow-capability-strip__primary">
          <p className="section-index">REVIEW MODE</p>
          <strong>完整人工审核体系</strong>
          <span>
            有用与有趣评分、自动确定性候选、别名归并和个人快捷标记在同一处完成。
          </span>
        </div>
        <div className="workflow-capability-strip__options">
          <span data-active="true">Entry 标签</span>
          <span data-active="true">全文标签</span>
          <span data-active="true">个人词汇规则</span>
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

      <section
        className="entry-command-panel"
        aria-labelledby="tag-filter-title"
      >
        <header className="console-heading">
          <div>
            <p className="section-index">REVIEW / SELECT</p>
            <h2 id="tag-filter-title">选择要审核的条目</h2>
          </div>
          <span className="record-count">
            {controller.view.status === 'ready'
              ? `${controller.view.response.totalCount.toString()} 条`
              : '读取中'}
          </span>
        </header>
        <form
          className="entry-search-form"
          role="search"
          onSubmit={submitSearch}
        >
          <label className="field entry-search-query">
            <span>正文或关键词</span>
            <input
              type="search"
              value={controller.query}
              onChange={(event) => {
                controller.setQuery(event.currentTarget.value);
              }}
              placeholder="留空按文档顺序审核"
            />
          </label>
          <label className="privacy-query-toggle entry-private-toggle">
            <input
              type="checkbox"
              checked={controller.includePrivate}
              onChange={(event) => {
                controller.setIncludePrivate(event.currentTarget.checked);
                controller.setOnlyPrivate(false);
              }}
            />
            查看隐私文档
          </label>
          <div className="entry-command-actions">
            <button className="primary-action entry-query-action" type="submit">
              刷新审核队列
            </button>
          </div>
        </form>
        <ActionNotice feedback={feedback} />
      </section>

      {controller.selectedDocument === undefined ? null : (
        <InformationDocumentPanel
          key={`${controller.selectedDocument.snapshotId}:${controller.selectedDocument.currentTags?.revision.toString() ?? '0'}`}
          document={controller.selectedDocument}
          includePrivate={controller.includePrivate}
          onOpenDocument={() => {
            onOpenEvidence(
              controller.selectedDocument?.snapshotId ?? '',
              undefined,
              controller.selectedDocument?.isPrivate === true,
            );
          }}
          onAggregate={onAggregateDocumentTags}
          onRevise={onReviseDocumentTags}
          onChanged={async (nextFeedback) => {
            setFeedback(nextFeedback);
            await controller.refreshDocuments();
          }}
        />
      )}

      <InformationEntryResults
        ariaLabel="待审核信息条目"
        emptyDescription="当前筛选范围没有可审核条目；可切换来源文档或隐私范围。"
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
          <>
            <InformationEntryAiTags
              key={`ai:${controller.selectedEntry.entryId}:${controller.selectedEntry.revision.toString()}`}
              enabled={aiEnabled}
              entry={controller.selectedEntry}
              onListAiTagProposals={onListAiTagProposals}
              onStartAiTagProposal={onStartAiTagProposal}
              onAcceptAiTagProposal={onAcceptAiTagProposal}
              onRejectAiTagProposal={onRejectAiTagProposal}
              onAccepted={async () => {
                await controller.executeSearch();
                await controller.refreshDocuments();
              }}
            />
            <InformationEntryEditor
              key={`${controller.selectedEntry.entryId}:${controller.selectedEntry.revision.toString()}`}
              entry={controller.selectedEntry}
              includePrivate={controller.includePrivate}
              onOpenEvidence={onOpenEvidence}
              onLocateDocument={() => {
                controller.setSnapshotId(
                  controller.selectedEntry?.snapshotId ?? '',
                );
              }}
              onPrevious={canGoPrevious ? showPreviousEntry : undefined}
              onNext={canGoNext ? showNextEntry : undefined}
              onRevise={onRevise}
              onSavePreferences={onSaveReviewPreferences}
              reviewPreferences={reviewPreferences}
              onPreferencesChange={onReviewPreferencesChange}
              overridePreferences={reviewPreferencesOverride}
              onSaved={async (nextFeedback) => {
                setFeedback(nextFeedback);
                await controller.executeSearch();
                await controller.refreshDocuments();
              }}
            />
          </>
        )}
      </InformationEntryResults>

      <InformationEntryPreferenceProfilePanel
        state={entryPreferenceProfile}
        onReload={onReloadEntryPreferenceProfile}
        onSave={onSaveEntryPreferenceProfile}
        onSuggest={onSuggestEntryPreferenceProfile}
        onTrial={onTrialEntryPreferenceProfile}
      />

      <InformationEntryAutomationPolicyPanel
        enabled={automationEnabled}
        onLoad={onLoadEntryAutomationPolicy}
        onSave={onSaveEntryAutomationPolicy}
        onTrial={onTrialEntryAutomationPolicy}
        onExecute={onExecuteEntryAutomation}
        onListRuns={onListEntryAutomationExecutions}
        onLoadRun={onLoadEntryAutomationExecution}
      />
    </div>
  );
}
