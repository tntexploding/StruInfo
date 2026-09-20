import {FloatingToolPanel} from '../components/floating_tool_panel.js';
import {sourceDisplayName} from '../components/reading_text.js';
import {InformationEntryTranslation} from './information_entry_translation.js';
import type {EntryTranslationServices} from './use_entry_translation.js';
import {
  InformationEntrySavedQueries,
  type EntrySavedQueryServices,
} from './information_entry_saved_queries.js';
import {
  InformationEntryMarkdownExport,
  type EntryMarkdownExportServices,
} from './information_entry_markdown_export.js';
import {InformationEntryRestoredSelection} from './information_entry_restored_selection.js';
import {useEffect, useState, type ReactNode, type SyntheticEvent} from 'react';

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
  readonly renderGraph?: (entry: Readonly<InformationEntry>) => ReactNode;
  readonly initialContext?: Readonly<EntryQueryContext> | undefined;
  readonly onContextChange?: (context: Readonly<EntryQueryContext>) => void;
  readonly onOpenGraph?: (entry: Readonly<InformationEntry>) => void;
  readonly aiQuerySynthesisEnabled: boolean;
  readonly translationServices?: Readonly<EntryTranslationServices>;
  readonly semanticSearchEnabled?: boolean;
  readonly onLoadSearchIndex?: InformationEntryServices['onLoadSearchIndex'];
  readonly onRefreshSearchIndex?: InformationEntryServices['onRefreshSearchIndex'];
  readonly onRebuildSearchIndex?: InformationEntryServices['onRebuildSearchIndex'];
  readonly onSynthesize: InformationEntryQuerySynthesisAction;
  readonly reviewPreferences: Loadable<Readonly<ReviewPreferencesResponse>>;
  readonly snapshots: readonly Readonly<EvidenceSnapshotSummary>[];
}

export function InformationEntryQueryWorkspace({
  renderGraph,
  onPreviewMarkdownExport,
  onGenerateMarkdownExport,
  initialContext,
  onContextChange,
  onOpenGraph,
  onLoadSavedQueries,
  onWriteSavedQuery,
  onReadQueryContext,
  aiQuerySynthesisEnabled,
  translationServices,
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
  const [readingMode, setReadingMode] = useState<'search' | 'ask'>('search');
  const [showGraph, setShowGraph] = useState(false);
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
          <h1>数据阅览</h1>
          <p>检索已确认的内容，沿联系阅读，或向 AI 提问并核对引用。</p>
        </div>
      </header>

      <div
        className="reading-segments reading-mode-switch"
        role="group"
        aria-label="阅览方式"
      >
        <button
          aria-pressed={readingMode === 'search'}
          onClick={() => {
            setReadingMode('search');
          }}
        >
          搜索与关系图
        </button>
        <button
          aria-pressed={readingMode === 'ask'}
          onClick={() => {
            setReadingMode('ask');
          }}
        >
          向资料提问
        </button>
      </div>
      <details className="workflow-mode-summary" aria-label="查询页操作指南">
        <summary>操作指南 · 查询条目</summary>
        <span>1. 输入关键词，按需展开筛选</span>
        <span>2. 从结果列表选择一个条目</span>
        <span>3. 阅读正文并查看来源</span>
      </details>

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
      <section
        className="reading-answer-workspace"
        hidden={readingMode !== 'ask'}
      >
        <InformationEntryQuerySynthesis
          retrieveForQuestion
          enabled={aiQuerySynthesisEnabled}
          retrievalMode={
            semanticSearchEnabled && semanticIndexReady ? 'hybrid' : 'lexical'
          }
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
      </section>
      <div className="query-studio-grid" hidden={readingMode !== 'search'}>
        <form
          className="query-studio-form"
          role="search"
          onSubmit={submitSearch}
        >
          <section className="query-studio-search" aria-label="主搜索">
            <label className="field entry-search-query">
              <span className="query-search-label">
                搜索信息条目{' '}
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
              </span>
              <input
                type="search"
                value={controller.query}
                onChange={(event) => {
                  controller.setQuery(event.currentTarget.value);
                }}
                placeholder="输入标题、正文或标签；留空浏览全部条目"
              />
            </label>
            <button className="primary-action entry-query-action" type="submit">
              搜索
            </button>{' '}
            {controller.selectedEntry === undefined ||
            controller.searchDirty ||
            onOpenGraph === undefined ? null : (
              <div className="entry-command-actions">
                <button
                  type="button"
                  className="secondary-action"
                  onClick={() => {
                    if (controller.selectedEntry !== undefined)
                      setShowGraph(true);
                  }}
                >
                  {controller.selectedEntry.value.isPrivate
                    ? '含隐私在图谱中查看'
                    : '在图谱中查看'}
                </button>
              </div>
            )}
          </section>
          <aside className="query-studio-settings" aria-label="搜索与显示设置">
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
            <FloatingToolPanel
              className="query-filter-drawer"
              title="筛选与匹配方式"
            >
              <div className="query-filter-drawer__body">
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
                      <option
                        key={snapshot.snapshotId}
                        value={snapshot.snapshotId}
                      >
                        {sourceDisplayName(snapshot)}
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
                    className="primary-action"
                    type="button"
                    onClick={(event) => {
                      event.currentTarget
                        .closest<HTMLElement>('[popover]')
                        ?.hidePopover();
                      void controller.executeSearch();
                    }}
                  >
                    应用筛选并搜索
                  </button>
                  <button
                    className="secondary-action"
                    type="button"
                    onClick={controller.clearSearchFilters}
                  >
                    清除筛选
                  </button>
                </div>
              </div>
            </FloatingToolPanel>
            <FloatingToolPanel title="索引维护">
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
            </FloatingToolPanel>
          </aside>
        </form>

        <section className="query-studio-results">
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
          <div className="reading-result-switch">
            <button
              className="secondary-action"
              aria-pressed={!showGraph}
              onClick={() => {
                setShowGraph(false);
              }}
            >
              阅读正文
            </button>
            <button
              className="secondary-action"
              disabled={!selectedItem}
              aria-pressed={showGraph}
              onClick={() => {
                setShowGraph(true);
              }}
            >
              联系星图
            </button>
          </div>
          {showGraph && selectedItem && renderGraph ? (
            <div
              className="reading-graph-frame"
              key={comparisonScopeKey + selectedItem.entry.entryId}
            >
              {renderGraph(selectedItem.entry)}
            </div>
          ) : null}
          <div className="reading-results-view" hidden={showGraph}>
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
              {...(translationServices === undefined
                ? {}
                : {translationServices})}
            />
          </div>
        </section>
      </div>
    </div>
  );
}

function InformationEntryQueryResults({
  graphContent,
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
  translationServices,
}: {
  readonly graphContent?: ReactNode;
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
  readonly translationServices?: Readonly<EntryTranslationServices>;
}) {
  const [languageControls, setLanguageControls] =
    useState<HTMLDivElement | null>(null);
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

  const renderSidebarSection = (id: string) => (
    <FloatingToolPanel
      key={id}
      title={
        {language: '阅读设置', export: '资料清单与导出', tools: '更多工具'}[
          id
        ] ?? id
      }
      preferredWidth={600}
    >
      {id === 'language' ? (
        <>
          <div ref={setLanguageControls} />
          {controller.selectedEntry === undefined ? (
            <p>选择条目后切换阅读语言。</p>
          ) : (
            <button
              type="button"
              className="text-action"
              onClick={() => {
                const entry = controller.selectedEntry;
                if (entry !== undefined)
                  onOpenEvidence(
                    entry.snapshotId,
                    entry.value.fragmentIds[0],
                    entry.value.isPrivate,
                  );
              }}
            >
              出处与文档
            </button>
          )}
        </>
      ) : null}
      {id === 'export' ? (
        <>
          {' '}
          {onPreviewMarkdownExport === undefined ||
          onGenerateMarkdownExport === undefined ? null : (
            <InformationEntryMarkdownExport
              embedded
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
        </>
      ) : null}
      {id === 'tools' ? (
        <>
          {' '}
          <details
            className="workflow-tool-drawer query-result-tools-drawer"
            open
            data-embedded="true"
          >
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
                key={explorationPolicyIdentity(reviewPreferences)}
                scopeKey={
                  explorationScopeKey +
                  ':' +
                  (selectedItem?.entry.entryId ?? 'none')
                }
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
      ) : null}
    </FloatingToolPanel>
  );

  return (
    <div className="query-reading-layout">
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
        {graphContent ??
          (controller.selectedEntry === undefined ? undefined : (
            <InformationEntryReadOnlyDetail
              entry={controller.selectedEntry}
              variant="query"
              hideSourceAction
              bodyContent={
                translationServices === undefined ? undefined : (
                  <InformationEntryTranslation
                    preferTranslation
                    controlsContainer={languageControls}
                    descriptiveLabels
                    key={
                      comparisonScopeKey +
                      ':' +
                      controller.selectedEntry.entryId +
                      ':' +
                      controller.selectedEntry.revisionId +
                      ':' +
                      String(controller.selectedEntry.value.isPrivate)
                    }
                    entry={controller.selectedEntry}
                    services={translationServices}
                  />
                )
              }
              onOpenEvidence={onOpenEvidence}
            />
          ))}
      </InformationEntryResults>

      <aside className="query-reading-sidebar" aria-label="阅读与资料工具">
        {['language', 'export', 'tools'].map(renderSidebarSection)}
      </aside>
    </div>
  );
}

function explorationPolicyIdentity(
  preferences: Loadable<Readonly<ReviewPreferencesResponse>>,
): string {
  return preferences.status === 'ready'
    ? `ready:${(preferences.value.explorationPolicy?.revision ?? 0).toString()}`
    : preferences.status;
}
