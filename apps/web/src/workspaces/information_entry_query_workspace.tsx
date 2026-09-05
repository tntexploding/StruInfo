import {
  InformationEntrySavedQueries,
  type EntrySavedQueryServices,
} from './information_entry_saved_queries.js';
import {
  InformationEntryMarkdownExport,
  type EntryMarkdownExportServices,
} from './information_entry_markdown_export.js';
import {InformationEntryRestoredSelection} from './information_entry_restored_selection.js';
import {useEffect, useState, type SyntheticEvent} from 'react';

import {
  type EntryQueryContext,
  type InformationEntry,
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

export interface InformationEntryQueryWorkspaceProps
  extends
    Pick<
      InformationEntryServices,
      'onExplore' | 'onOpenEvidence' | 'onReviseExplorationPolicy' | 'onSearch'
    >,
    Partial<EntrySavedQueryServices>,
    Partial<EntryMarkdownExportServices> {
  readonly initialContext?: Readonly<EntryQueryContext> | undefined;
  readonly onContextChange?: (context: Readonly<EntryQueryContext>) => void;
  readonly onOpenGraph?: (entry: Readonly<InformationEntry>) => void;
  readonly aiQuerySynthesisEnabled: boolean;
  readonly semanticSearchEnabled?: boolean;
  readonly onLoadSearchIndex?: InformationEntryServices['onLoadSearchIndex'];
  readonly onRefreshSearchIndex?: InformationEntryServices['onRefreshSearchIndex'];
  readonly onRebuildSearchIndex?: InformationEntryServices['onRebuildSearchIndex'];
  readonly onSynthesize: InformationEntryQuerySynthesisAction;
  readonly reviewPreferences: Loadable<Readonly<ReviewPreferencesResponse>>;
  readonly snapshots: readonly Readonly<EvidenceSnapshotSummary>[];
}

export function InformationEntryQueryWorkspace({
  onPreviewMarkdownExport,
  onGenerateMarkdownExport,
  initialContext,
  onContextChange,
  onOpenGraph,
  onLoadSavedQueries,
  onWriteSavedQuery,
  onReadQueryContext,
  aiQuerySynthesisEnabled,
  semanticSearchEnabled = false,
  onExplore,
  onLoadSearchIndex,
  onOpenEvidence,
  onReviseExplorationPolicy,
  onSearch,
  onRefreshSearchIndex,
  onRebuildSearchIndex,
  onSynthesize,
  reviewPreferences,
  snapshots,
}: InformationEntryQueryWorkspaceProps) {
  const controller = useInformationEntryController({
    ...(initialContext === undefined
      ? {}
      : {initialQueryContext: initialContext}),
    autoSearchDelayMs: 300,
    onSearch,
  });
  const [semanticIndexReady, setSemanticIndexReady] = useState(false);
  const [pendingContext, setPendingContext] = useState<
    Readonly<EntryQueryContext> | undefined
  >(initialContext?.query.includePrivate ? initialContext : undefined);
  const [resumeEntryId, setResumeEntryId] = useState(
    initialContext?.query.includePrivate
      ? undefined
      : initialContext?.selectedEntryId,
  );
  const currentQuery = controller.searchRequest;
  const currentSelection =
    controller.searchDirty || controller.view.status !== 'ready'
      ? undefined
      : controller.selectedEntryId;
  useEffect(() => {
    onContextChange?.(
      pendingContext ?? {
        query: currentQuery,
        ...(currentSelection === undefined
          ? {}
          : {selectedEntryId: currentSelection}),
      },
    );
  }, [currentQuery, currentSelection, onContextChange, pendingContext]);
  function applyContext(context: Readonly<EntryQueryContext>) {
    setPendingContext(undefined);
    setResumeEntryId(context.selectedEntryId);
    controller.restoreQueryContext(context);
  }
  function openContext(context: Readonly<EntryQueryContext>) {
    if (context.query.includePrivate) {
      setPendingContext(context);
      setResumeEntryId(undefined);
      controller.restoreQueryContext({query: {includePrivate: false}});
    } else {
      applyContext(context);
    }
  }
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
          <h1>查询</h1>
        </div>
      </header>

      <aside className="workflow-mode-summary" aria-label="查询页操作指南">
        <strong>查询条目</strong>
        <span>1. 输入关键词并调整右侧条件</span>
        <span>2. 从结果列表选择一个条目</span>
        <span>3. 在中间查看正文与来源</span>
      </aside>

      {pendingContext === undefined ? null : (
        <section className="query-context-notice" aria-label="重新选择隐私范围">
          <strong>此查询包含隐私范围</strong>
          <p>打开前请选择本次可见范围。保存查询不会自动显示隐私内容。</p>
          <div className="entry-command-actions">
            <button
              type="button"
              className="primary-action"
              onClick={() => {
                applyContext(pendingContext);
              }}
            >
              按保存的隐私范围打开
            </button>
            <button
              type="button"
              className="secondary-action"
              onClick={() => {
                applyContext({
                  ...pendingContext,
                  query: {
                    ...pendingContext.query,
                    includePrivate: false,
                    onlyPrivate: false,
                  },
                });
              }}
            >
              仅公开范围打开
            </button>
            <button
              type="button"
              className="secondary-action"
              onClick={() => {
                setPendingContext(undefined);
              }}
            >
              取消打开
            </button>
          </div>
        </section>
      )}
      {controller.view.status !== 'error' ? null : (
        <div className="query-context-notice">
          <div className="entry-command-actions">
            {controller.retrievalMode === 'lexical' ? null : (
              <button
                type="button"
                className="secondary-action"
                onClick={() => {
                  controller.setRetrievalMode('lexical');
                }}
              >
                改用文字查询
              </button>
            )}
            {controller.advancedFilters.association === undefined ? null : (
              <button
                type="button"
                className="secondary-action"
                onClick={clearAssociationAnchor}
              >
                清除关联中心后查询
              </button>
            )}
          </div>
        </div>
      )}
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
                placeholder="输入标题、正文或标签；留空浏览全部条目"
              />
            </label>
            <span className="record-count" role="status" aria-live="polite">
              {controller.searchDirty
                ? '条件已更改'
                : controller.view.status === 'ready'
                  ? controller.includePrivate
                    ? `${controller.view.response.totalCount.toString()} 条 · ${controller.view.response.privateDocuments.totalCount.toString()} 份完整隐私文档`
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
              <h2>搜索与显示设置</h2>
            </header>
            {onLoadSavedQueries === undefined ||
            onWriteSavedQuery === undefined ? null : (
              <InformationEntrySavedQueries
                context={{
                  query: currentQuery,
                  ...(currentSelection === undefined
                    ? {}
                    : {selectedEntryId: currentSelection}),
                }}
                onLoad={onLoadSavedQueries}
                onWrite={onWriteSavedQuery}
                onOpen={openContext}
              />
            )}
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
                <option value="">全部来源文档</option>
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
                {...(onRefreshSearchIndex === undefined
                  ? {}
                  : {onRefresh: onRefreshSearchIndex})}
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

          {controller.view.status !== 'ready' ||
          controller.searchDirty ||
          resumeEntryId === undefined ||
          controller.selectedEntryId !== resumeEntryId ||
          controller.selectedEntry !== undefined ||
          onReadQueryContext === undefined ? null : (
            <InformationEntryRestoredSelection
              key={comparisonScopeKey + resumeEntryId}
              entryId={resumeEntryId}
              includePrivate={controller.includePrivate}
              onlyPrivate={controller.onlyPrivate}
              onRead={onReadQueryContext}
              onOpenEvidence={onOpenEvidence}
              {...(onOpenGraph === undefined ? {} : {onOpenGraph})}
            />
          )}
          {controller.selectedEntry === undefined ||
          controller.searchDirty ||
          onOpenGraph === undefined ? null : (
            <div className="entry-command-actions">
              <button
                type="button"
                className="secondary-action"
                onClick={() => {
                  if (controller.selectedEntry !== undefined)
                    onOpenGraph(controller.selectedEntry);
                }}
              >
                {controller.selectedEntry.value.isPrivate
                  ? '含隐私在图谱中查看'
                  : '在图谱中查看'}
              </button>
            </div>
          )}
          <InformationEntryQueryResults
            key={comparisonScopeKey}
            comparisonScopeKey={comparisonScopeKey}
            {...(onPreviewMarkdownExport === undefined
              ? {}
              : {onPreviewMarkdownExport})}
            {...(onGenerateMarkdownExport === undefined
              ? {}
              : {onGenerateMarkdownExport})}
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
  onPreviewMarkdownExport,
  onGenerateMarkdownExport,
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
  readonly onPreviewMarkdownExport?: EntryMarkdownExportServices['onPreviewMarkdownExport'];
  readonly onGenerateMarkdownExport?: EntryMarkdownExportServices['onGenerateMarkdownExport'];
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
        ariaLabel="条目查询结果"
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

      {onPreviewMarkdownExport === undefined ||
      onGenerateMarkdownExport === undefined ? null : (
        <InformationEntryMarkdownExport
          selectedEntry={selectedItem?.entry}
          privacyScope={
            controller.onlyPrivate
              ? 'private_only'
              : controller.includePrivate
                ? 'include_private'
                : 'public'
          }
          onPreviewMarkdownExport={onPreviewMarkdownExport}
          onGenerateMarkdownExport={onGenerateMarkdownExport}
        />
      )}

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
