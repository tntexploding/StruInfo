import {useState, type SyntheticEvent} from 'react';

import {
  ENTRY_DOMAIN_KEYWORDS,
  ENTRY_TYPE_KEYWORDS,
  type EntryDomainKeyword,
  type EntryTypeKeyword,
  type EvidenceSnapshotSummary,
  type ReviewPreferencesResponse,
} from '../api/m1c_api_contract.js';
import type {Loadable} from '../components/product_types.js';
import {
  InformationEntryPrivacyScope,
  InformationEntryReadOnlyDetail,
  InformationEntryResults,
  type InformationEntryServices,
} from './information_entry_components.js';
import {DOMAIN_LABELS, TYPE_LABELS} from './information_entry_shared.js';
import {
  InformationEntryRetrievalOptions,
  InformationEntryAdvancedSearchFields,
  InformationEntryTextSearchOptions,
} from './information_entry_search_controls.js';
import {InformationEntrySearchIndexPanel} from './information_entry_search_index_panel.js';
import {InformationEntryQueryComparison} from './information_entry_query_comparison.js';
import {InformationEntryExploration} from './information_entry_exploration.js';
import {InformationEntryQuerySynthesis} from './information_entry_query_synthesis.js';
import type {InformationEntryQuerySynthesisAction} from './use_information_entry_query_synthesis.js';
import {
  EMPTY_INFORMATION_ENTRY_COMPARISON_STATE,
  clearInformationEntryComparisons,
  informationEntryQueryScopeKey,
  removeInformationEntryComparison,
  toggleInformationEntryComparison,
  visibleInformationEntryComparisons,
  type InformationEntrySearchItem,
} from './information_entry_query_state.js';
import {InformationEntryQueryTools} from './information_entry_query_tools.js';
import {useInformationEntryController} from './use_information_entry_controller.js';
import {PrivateDocumentResults} from './private_document_results.js';

export interface InformationEntryQueryWorkspaceProps extends Pick<
  InformationEntryServices,
  'onExplore' | 'onOpenEvidence' | 'onReviseExplorationPolicy' | 'onSearch'
> {
  readonly aiQuerySynthesisEnabled: boolean;
  readonly semanticSearchEnabled?: boolean;
  readonly onLoadSearchIndex?: InformationEntryServices['onLoadSearchIndex'];
  readonly onRebuildSearchIndex?: InformationEntryServices['onRebuildSearchIndex'];
  readonly onSynthesize: InformationEntryQuerySynthesisAction;
  readonly reviewPreferences: Loadable<Readonly<ReviewPreferencesResponse>>;
  readonly snapshots: readonly Readonly<EvidenceSnapshotSummary>[];
}

export function InformationEntryQueryWorkspace({
  aiQuerySynthesisEnabled,
  semanticSearchEnabled = false,
  onExplore,
  onLoadSearchIndex,
  onOpenEvidence,
  onReviseExplorationPolicy,
  onSearch,
  onRebuildSearchIndex,
  onSynthesize,
  reviewPreferences,
  snapshots,
}: InformationEntryQueryWorkspaceProps) {
  const controller = useInformationEntryController({
    autoSearchDelayMs: 300,
    onSearch,
  });
  const [semanticIndexReady, setSemanticIndexReady] = useState(false);
  const comparisonScopeKey = informationEntryQueryScopeKey({
    query: controller.query,
    retrievalMode: controller.retrievalMode,
    textMode: controller.textMode,
    textFields: controller.textFields,
    snapshotId: controller.snapshotId,
    typeKeyword: controller.typeKeyword,
    domainKeyword: controller.domainKeyword,
    advancedFilters: controller.advancedFilters,
    includePrivate: controller.includePrivate,
    onlyPrivate: controller.onlyPrivate,
  });
  const selectedItem =
    controller.view.status === 'ready'
      ? controller.view.response.items.find(
          (item) => item.entry.entryId === controller.selectedEntryId,
        )
      : undefined;
  function submitSearch(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    void controller.executeSearch();
  }

  function setSelectedAssociationAnchor(): void {
    if (selectedItem === undefined) return;
    const currentAssociation = controller.advancedFilters.association;
    controller.setAdvancedFilters(
      Object.freeze({
        ...controller.advancedFilters,
        association: Object.freeze({
          entryId: selectedItem.entry.entryId,
          label: selectedItem.entry.value.titlePath || '未命名条目',
          maximumDepth: currentAssociation?.maximumDepth ?? 2,
          minimumScore: currentAssociation?.minimumScore ?? 0,
        }),
      }),
    );
  }

  function clearAssociationAnchor(): void {
    const next = {...controller.advancedFilters};
    delete next.association;
    controller.setAdvancedFilters(Object.freeze(next));
  }

  return (
    <div
      className="workspace-view entry-workspace workflow-stage-workspace"
      data-workflow-page="query"
    >
      <header className="workflow-page-heading">
        <div>
          <p className="section-index">05 / RETRIEVAL</p>
          <h1>查询</h1>
          <p>按正文、标签、来源、时间与有限邻域检索，并返回精确来源。</p>
        </div>
        <span className="origin-label origin-label--deterministic">
          {semanticSearchEnabled
            ? '本地词法 · 可选语义召回'
            : '本地词法搜索 · 可离线使用'}
        </span>
      </header>

      <aside className="workflow-mode-summary" aria-label="查询页操作指南">
        <strong>查询条目</strong>
        <span>1. 输入关键词并调整右侧条件</span>
        <span>2. 从结果列表选择一个条目</span>
        <span>3. 在中间查看正文与来源</span>
      </aside>

      <div className="query-studio-grid">
        <form
          className="query-studio-form"
          role="search"
          onSubmit={submitSearch}
        >
          <section className="query-studio-search" aria-label="主搜索">
            <label className="field entry-search-query">
              <span>搜索信息条目</span>
              <input
                type="search"
                value={controller.query}
                onChange={(event) => {
                  controller.setQuery(event.currentTarget.value);
                }}
                placeholder="输入标题、正文或标签；留空浏览当前 Entry"
              />
            </label>
            <span className="record-count" role="status" aria-live="polite">
              {controller.searchDirty
                ? '条件已更改'
                : controller.view.status === 'ready'
                  ? controller.includePrivate
                    ? `${controller.view.response.totalCount.toString()} Entry · ${controller.view.response.privateDocuments.totalCount.toString()} 完整隐私文档`
                    : `${controller.view.response.totalCount.toString()} 条`
                  : controller.view.status === 'loading'
                    ? '正在搜索…'
                    : '搜索失败'}
            </span>
            <button className="primary-action entry-query-action" type="submit">
              搜索
            </button>
          </section>
          <aside className="query-studio-settings" aria-label="搜索与显示设置">
            <header>
              <p className="section-index">SEARCH / DISPLAY</p>
              <h2>搜索与显示设置</h2>
            </header>
            <InformationEntryTextSearchOptions
              mode={controller.textMode}
              fields={controller.textFields}
              onModeChange={controller.setTextMode}
              onFieldsChange={controller.setTextFields}
            />
            <InformationEntryRetrievalOptions
              mode={controller.retrievalMode}
              semanticAvailable={semanticSearchEnabled}
              semanticReady={semanticIndexReady}
              publicScope={
                !controller.includePrivate && !controller.onlyPrivate
              }
              queryPresent={controller.query.trim() !== ''}
              onChange={controller.setRetrievalMode}
            />
            <label className="field entry-source-filter">
              <span>来源文档</span>
              <select
                value={controller.snapshotId}
                onChange={(event) => {
                  controller.setSnapshotId(event.currentTarget.value);
                }}
              >
                <option value="">全部 Snapshot</option>
                {snapshots.map((snapshot) => (
                  <option key={snapshot.snapshotId} value={snapshot.snapshotId}>
                    {snapshot.sourceKey}
                    {snapshot.isPrivate === true ? '（私密）' : ''}
                  </option>
                ))}
              </select>
            </label>
            <label className="field entry-type-filter">
              <span>类型关键词</span>
              <select
                value={controller.typeKeyword}
                onChange={(event) => {
                  controller.setTypeKeyword(
                    event.currentTarget.value as '' | EntryTypeKeyword,
                  );
                }}
              >
                <option value="">全部类型</option>
                {ENTRY_TYPE_KEYWORDS.map((keyword) => (
                  <option key={keyword} value={keyword}>
                    {TYPE_LABELS[keyword]}
                  </option>
                ))}
              </select>
            </label>
            <label className="field entry-domain-filter">
              <span>领域关键词</span>
              <select
                value={controller.domainKeyword}
                onChange={(event) => {
                  controller.setDomainKeyword(
                    event.currentTarget.value as '' | EntryDomainKeyword,
                  );
                }}
              >
                <option value="">全部领域</option>
                {ENTRY_DOMAIN_KEYWORDS.map((keyword) => (
                  <option key={keyword} value={keyword}>
                    {DOMAIN_LABELS[keyword]}
                  </option>
                ))}
              </select>
            </label>
            <InformationEntryAdvancedSearchFields
              snapshots={snapshots}
              typeKeyword={controller.typeKeyword}
              domainKeyword={controller.domainKeyword}
              filters={controller.advancedFilters}
              onChange={controller.setAdvancedFilters}
            />
            <InformationEntryPrivacyScope
              includePrivate={controller.includePrivate}
              onlyPrivate={controller.onlyPrivate}
              onChange={controller.setPrivacyScope}
            />
            <div className="entry-command-actions">
              <button
                className="secondary-action"
                type="button"
                onClick={controller.clearSearchFilters}
              >
                清除筛选
              </button>
            </div>
            {onLoadSearchIndex === undefined ||
            onRebuildSearchIndex === undefined ? null : (
              <InformationEntrySearchIndexPanel
                semanticEnabled={semanticSearchEnabled}
                onLoad={onLoadSearchIndex}
                onReadyChange={setSemanticIndexReady}
                onRebuild={onRebuildSearchIndex}
              />
            )}
          </aside>
        </form>

        <main className="query-studio-results">
          {controller.view.status === 'ready' && controller.includePrivate ? (
            <PrivateDocumentResults
              items={controller.view.response.privateDocuments.items}
              totalCount={controller.view.response.privateDocuments.totalCount}
              onOpenEvidence={onOpenEvidence}
            />
          ) : null}

          <InformationEntryQueryResults
            key={comparisonScopeKey}
            comparisonScopeKey={comparisonScopeKey}
            controller={controller}
            selectedItem={selectedItem}
            onAssociationToggle={(enabled) => {
              if (enabled) {
                setSelectedAssociationAnchor();
              } else {
                clearAssociationAnchor();
              }
            }}
            onOpenEvidence={onOpenEvidence}
            onExplore={onExplore}
            onReviseExplorationPolicy={onReviseExplorationPolicy}
            reviewPreferences={reviewPreferences}
            onReplaceAssociationAnchor={setSelectedAssociationAnchor}
            aiQuerySynthesisEnabled={aiQuerySynthesisEnabled}
            onSynthesize={onSynthesize}
          />
        </main>
      </div>
    </div>
  );
}

function InformationEntryQueryResults({
  comparisonScopeKey,
  controller,
  selectedItem,
  onAssociationToggle,
  onExplore,
  onOpenEvidence,
  onReviseExplorationPolicy,
  onReplaceAssociationAnchor,
  reviewPreferences,
  aiQuerySynthesisEnabled,
  onSynthesize,
}: {
  readonly comparisonScopeKey: string;
  readonly controller: ReturnType<typeof useInformationEntryController>;
  readonly selectedItem: Readonly<InformationEntrySearchItem> | undefined;
  readonly onAssociationToggle: (enabled: boolean) => void;
  readonly onExplore: InformationEntryServices['onExplore'];
  readonly onOpenEvidence: InformationEntryServices['onOpenEvidence'];
  readonly onReviseExplorationPolicy: InformationEntryServices['onReviseExplorationPolicy'];
  readonly onReplaceAssociationAnchor: () => void;
  readonly reviewPreferences: Loadable<Readonly<ReviewPreferencesResponse>>;
  readonly aiQuerySynthesisEnabled: boolean;
  readonly onSynthesize: InformationEntryQuerySynthesisAction;
}) {
  const [comparisonState, setComparisonState] = useState(
    EMPTY_INFORMATION_ENTRY_COMPARISON_STATE,
  );
  const comparisonItems = visibleInformationEntryComparisons(
    comparisonState,
    comparisonScopeKey,
  );
  const selectedIsCompared =
    selectedItem !== undefined &&
    comparisonItems.some(
      (item) => item.entry.entryId === selectedItem.entry.entryId,
    );
  const explorationScopeKey =
    controller.view.status === 'ready'
      ? [
          comparisonScopeKey,
          controller.pageIndex.toString(),
          ...controller.view.response.items.map((item) => item.entry.entryId),
        ].join(':')
      : `${comparisonScopeKey}:${controller.pageIndex.toString()}:${controller.view.status}`;

  return (
    <>
      <InformationEntryResults
        ariaLabel="Entry 查询结果"
        emptyDescription="当前查询没有匹配条目；可清除部分筛选后重试。"
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
            variant="query"
            onOpenEvidence={onOpenEvidence}
          />
        )}
      </InformationEntryResults>

      <details className="workflow-tool-drawer query-result-tools-drawer">
        <summary>更多结果工具</summary>
        <div className="query-result-tools-drawer__body">
          <InformationEntryQueryTools
            association={controller.advancedFilters.association}
            comparisonCount={comparisonItems.length}
            comparisonFull={comparisonItems.length >= 2}
            selectedItem={selectedItem}
            selectedIsCompared={selectedIsCompared}
            onAssociationToggle={onAssociationToggle}
            onReplaceAssociationAnchor={onReplaceAssociationAnchor}
            onToggleComparison={() => {
              if (selectedItem === undefined) return;
              setComparisonState((current) =>
                toggleInformationEntryComparison(
                  current,
                  comparisonScopeKey,
                  selectedItem,
                ),
              );
            }}
            onClearComparisons={() => {
              setComparisonState(
                clearInformationEntryComparisons(comparisonScopeKey),
              );
            }}
          />

          <InformationEntryExploration
            key={`${explorationScopeKey}:${selectedItem?.entry.entryId ?? 'none'}:${explorationPolicyIdentity(reviewPreferences)}`}
            includePrivate={controller.includePrivate}
            onlyPrivate={controller.onlyPrivate}
            pageItems={
              controller.view.status === 'ready'
                ? controller.view.response.items
                : Object.freeze([])
            }
            reviewPreferences={reviewPreferences}
            selectedItem={selectedItem}
            onExplore={onExplore}
            onOpenEvidence={onOpenEvidence}
            onReviseExplorationPolicy={onReviseExplorationPolicy}
          />

          <InformationEntryQuerySynthesis
            key={comparisonScopeKey}
            enabled={aiQuerySynthesisEnabled}
            retrievalMode={controller.retrievalMode}
            includePrivate={controller.includePrivate}
            onlyPrivate={controller.onlyPrivate}
            resultCount={
              controller.view.status === 'ready'
                ? controller.view.response.totalCount
                : 0
            }
            searchRequest={controller.searchRequest}
            onOpenEvidence={onOpenEvidence}
            onSynthesize={onSynthesize}
          />

          <InformationEntryQueryComparison
            items={comparisonItems}
            onOpenEvidence={onOpenEvidence}
            onRemove={(entryId) => {
              setComparisonState((current) =>
                removeInformationEntryComparison(
                  current,
                  comparisonScopeKey,
                  entryId,
                ),
              );
            }}
          />
        </div>
      </details>
    </>
  );
}

function explorationPolicyIdentity(
  preferences: Loadable<Readonly<ReviewPreferencesResponse>>,
): string {
  return preferences.status === 'ready'
    ? `ready:${(preferences.value.explorationPolicy?.revision ?? 0).toString()}`
    : preferences.status;
}
