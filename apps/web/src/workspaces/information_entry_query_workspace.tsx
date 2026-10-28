import {useDatabaseResearch} from './use_database_research.js';
import {ContentDialog} from '../components/content_dialog.js';
import {DatabaseScopeControls} from './database_scope_controls.js';
import {DatabaseResearchResults} from './database_research.js';
import {VisualSettings} from './visual_settings.js';
import {DatabaseWorkspaceFrame} from '../components/database_workspace_frame.js';
import {ContentTopicsPanel} from './content_topics_panel.js';
import {createPortal} from 'react-dom';
import {FloatingToolPanel} from '../components/floating_tool_panel.js';
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
import {
  useEffect,
  useState,
  type ReactNode,
  type SyntheticEvent,
  type CSSProperties,
} from 'react';

import {
  type EntryQueryContext,
  type InformationEntry,
  type EvidenceSnapshotSummary,
  type ReviewPreferencesResponse,
} from '../api/m1c_api_contract.js';
import type {Loadable} from '../components/product_types.js';
import {
  InformationEntryReadOnlyDetail,
  InformationEntryResults,
  type InformationEntryServices,
} from './information_entry_components.js';
import {
  InformationEntryRetrievalOptions,
  InformationEntryTextSearchOptions,
} from './information_entry_search_controls.js';
import {InformationEntrySearchIndexPanel} from './information_entry_search_index_panel.js';
import {InformationEntryQueryComparison} from './information_entry_query_comparison.js';
import {InformationEntryExploration} from './information_entry_exploration.js';
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
  readonly reports?: ReactNode;
  readonly initialContext?: Readonly<EntryQueryContext> | undefined;
  readonly onContextChange?: (context: Readonly<EntryQueryContext>) => void;
  readonly onOpenGraph?: (entry: Readonly<InformationEntry>) => void;
  readonly aiQuerySynthesisEnabled: boolean;
  readonly translationServices?: Readonly<EntryTranslationServices>;
  readonly semanticSearchEnabled?: boolean;
  readonly onLoadSearchIndex?: InformationEntryServices['onLoadSearchIndex'];
  readonly onRefreshSearchIndex?: InformationEntryServices['onRefreshSearchIndex'];
  readonly onRebuildSearchIndex?: InformationEntryServices['onRebuildSearchIndex'];
  readonly reviewPreferences: Loadable<Readonly<ReviewPreferencesResponse>>;
  readonly snapshots: readonly Readonly<EvidenceSnapshotSummary>[];
}

export function InformationEntryQueryWorkspace({
  renderGraph,
  reports,
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
  reviewPreferences,
  snapshots,
}: InformationEntryQueryWorkspaceProps) {
  const [searchElement, setSearchElement] = useState<HTMLDivElement | null>(
    null,
  );
  const [searchHeight, setSearchHeight] = useState(186);
  useEffect(() => {
    if (!searchElement) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry)
        setSearchHeight(
          entry.borderBoxSize[0]?.blockSize ?? entry.contentRect.height,
        );
    });
    observer.observe(searchElement);
    return () => {
      observer.disconnect();
    };
  }, [searchElement]);
  const [readingMode, setReadingMode] = useState<'search' | 'ask'>('search');
  const [showGraph, setShowGraph] = useState(false);
  const [topicsOpen, setTopicsOpen] = useState(false);
  const [searched, setSearched] = useState(
    Boolean(initialContext?.query.text) ||
      Boolean(initialContext?.selectedEntryId),
  );
  const [configOpen, setConfigOpen] = useState(false);
  const [evidenceMode, setEvidenceMode] = useState<'local' | 'web' | 'mixed'>(
    'local',
  );
  const [webQuery, setWebQuery] = useState('');
  const [toolbarContainer, setToolbarContainer] =
    useState<HTMLDivElement | null>(null);
  const controller = useInformationEntryController({
    ...(initialContext === undefined
      ? {}
      : {initialQueryContext: initialContext}),
    autoSearchDelayMs: 300,
    autoSearch:
      searched && readingMode === 'search' && evidenceMode === 'local',
    onSearch,
  });
  const [semanticIndexReady, setSemanticIndexReady] = useState(false);
  const research = useDatabaseResearch({
    operation: readingMode,
    mode: evidenceMode,
    text: controller.query,
    webQuery,
    query: controller.searchRequest,
  });
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
    setSearched(true);
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
    setSearched(true);
    if (readingMode === 'ask' || evidenceMode !== 'local') void research.run();
    else if (searched) void controller.executeSearch();
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

  const displayControls = (
    <div
      className="reading-segments reading-result-switch"
      role="group"
      aria-label="结果显示"
    >
      <button
        type="button"
        aria-pressed={!showGraph}
        onClick={() => {
          setShowGraph(false);
        }}
      >
        阅读正文
      </button>
      <button
        type="button"
        disabled={!selectedItem}
        aria-pressed={showGraph}
        onClick={() => {
          setShowGraph(true);
        }}
      >
        联系星图
      </button>
    </div>
  );

  return (
    <div
      className="workspace-view reading-sample database-blank database-options db-main"
      data-workflow-page="query"
      style={
        {'--db-search-space': `${String(searchHeight + 34)}px`} as CSSProperties
      }
    >
      <DatabaseWorkspaceFrame
        searched={searched}
        reports={reports}
        categories={
          <DatabaseScopeControls
            controller={controller}
            snapshots={snapshots}
            saved={
              onLoadSavedQueries && onWriteSavedQuery ? (
                <InformationEntrySavedQueries
                  embedded
                  context={{
                    query: currentQuery,
                    ...(currentSelection
                      ? {selectedEntryId: currentSelection}
                      : {}),
                  }}
                  onLoad={onLoadSavedQueries}
                  onWrite={onWriteSavedQuery}
                  onOpen={openContext}
                />
              ) : (
                <p>查询保存暂不可用。</p>
              )
            }
          />
        }
      >
        <div className="search-module" ref={setSearchElement}>
          <h1>数据库</h1>
          <form className="search-form" role="search" onSubmit={submitSearch}>
            <span className="search-symbol" aria-hidden="true">
              ⌕
            </span>
            <input
              id="search-input"
              type="search"
              maxLength={readingMode === 'ask' ? 600 : 300}
              aria-label="关键词或问题"
              placeholder={
                readingMode === 'ask' ? '输入想了解的问题' : '输入关键词'
              }
              value={controller.query}
              onChange={(e) => {
                controller.setQuery(e.target.value);
              }}
            />
            {controller.query ? (
              <button
                className="clear-query"
                type="button"
                aria-label="清空搜索"
                onClick={() => {
                  controller.setQuery('');
                }}
              >
                ×
              </button>
            ) : null}
            <button
              className="primary-action submit-search"
              disabled={
                research.busy ||
                (readingMode === 'ask' && !aiQuerySynthesisEnabled)
              }
              type="submit"
            >
              {research.busy
                ? '查询中…'
                : readingMode === 'ask'
                  ? '提问'
                  : '搜索'}
            </button>
          </form>
          <div className="search-secondary">
            <div className="query-mode" role="group" aria-label="查询操作">
              <button
                type="button"
                aria-pressed={readingMode === 'search'}
                onClick={() => {
                  setReadingMode('search');
                  if (evidenceMode === 'mixed') setEvidenceMode('local');
                }}
              >
                搜索
              </button>
              <button
                type="button"
                aria-pressed={readingMode === 'ask'}
                onClick={() => {
                  setReadingMode('ask');
                }}
              >
                AI 提问
              </button>
            </div>
            <button
              className="search-config-toggle"
              aria-expanded={configOpen}
              onClick={() => {
                setConfigOpen(true);
              }}
            >
              搜索设置 ⌄
            </button>
          </div>
          {pendingContext ? (
            <section
              className="query-notice"
              role="region"
              aria-label="重新选择隐私范围"
            >
              <span>此查询包含私密资料。</span>
              <button
                className="text-action"
                onClick={() => {
                  applyContext(pendingContext);
                }}
              >
                按保存范围打开
              </button>
              <button
                className="text-action"
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
                仅公开资料
              </button>
            </section>
          ) : null}
        </div>
        <section
          className="result-space"
          aria-label="查询结果"
          hidden={!searched}
        >
          <header className="result-heading">
            <h2>
              {readingMode === 'ask' ? '回答与引用' : '查询结果'}
              {readingMode === 'search' &&
              evidenceMode === 'local' &&
              controller.view.status === 'ready'
                ? ' · ' + String(controller.view.response.totalCount) + ' 条'
                : ''}
            </h2>
            <span>
              {evidenceMode === 'local'
                ? '库内资料'
                : evidenceMode === 'web'
                  ? '网页资料'
                  : '库内＋网页'}
            </span>
            <div ref={setToolbarContainer} />
            <FloatingToolPanel
              title="主题与联系"
              preferredWidth={720}
              onOpenChange={setTopicsOpen}
            >
              <ContentTopicsPanel
                active={topicsOpen}
                {...(selectedItem ? {entry: selectedItem.entry} : {})}
                onRead={(id) => {
                  setShowGraph(false);
                  setResumeEntryId(id);
                  controller.setSelectedEntryId(id);
                }}
              />
            </FloatingToolPanel>
          </header>
          {readingMode === 'ask' || evidenceMode !== 'local' ? (
            <DatabaseResearchResults
              value={research}
              onRead={(id) => {
                setReadingMode('search');
                setEvidenceMode('local');
                setResumeEntryId(id);
                controller.setSelectedEntryId(id);
              }}
            />
          ) : (
            <>
              <section className="query-studio-results">
                {controller.view.status === 'ready' &&
                controller.includePrivate ? (
                  <PrivateDocumentResults
                    items={controller.view.response.privateDocuments.items}
                    totalCount={
                      controller.view.response.privateDocuments.totalCount
                    }
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
                    toolbarContainer={toolbarContainer}
                    displayControls={displayControls}
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
            </>
          )}
        </section>
      </DatabaseWorkspaceFrame>
      <ContentDialog
        open={configOpen}
        title="搜索设置"
        onClose={() => {
          setConfigOpen(false);
        }}
        className="blank-config"
      >
        <div className="config-form">
          <label className="sample-field">
            <span>资料来源</span>
            <select
              value={evidenceMode}
              onChange={(e) => {
                setEvidenceMode(e.target.value as typeof evidenceMode);
              }}
            >
              <option value="local">库内资料</option>
              <option value="web">网页资料</option>
              {readingMode === 'ask' ? (
                <option value="mixed">库内＋网页</option>
              ) : null}
            </select>
          </label>
          {evidenceMode !== 'web' ? (
            <>
              <InformationEntryRetrievalOptions
                mode={controller.retrievalMode}
                semanticAvailable={semanticSearchEnabled}
                semanticReady={semanticIndexReady}
                publicScope={
                  !controller.includePrivate && !controller.onlyPrivate
                }
                queryPresent={Boolean(controller.query.trim())}
                onChange={controller.setRetrievalMode}
              />
              <details className="nested-options">
                <summary>文字匹配 ⌄</summary>
                <InformationEntryTextSearchOptions
                  mode={controller.textMode}
                  fields={controller.textFields}
                  onModeChange={controller.setTextMode}
                  onFieldsChange={controller.setTextFields}
                />
              </details>
            </>
          ) : null}
          {evidenceMode !== 'local' ? (
            <label className="sample-field">
              <span>公开搜索词</span>
              <input
                maxLength={128}
                value={webQuery}
                onChange={(e) => {
                  setWebQuery(e.target.value);
                }}
                placeholder="填写用于联网的关键词"
              />
              <small>库内筛选只对库内资料生效。</small>
            </label>
          ) : null}
          {onLoadSearchIndex && onRebuildSearchIndex ? (
            <details className="nested-options">
              <summary>索引维护 ⌄</summary>
              <InformationEntrySearchIndexPanel
                semanticEnabled={semanticSearchEnabled}
                onLoad={onLoadSearchIndex}
                onReadyChange={setSemanticIndexReady}
                {...(onRefreshSearchIndex
                  ? {onRefresh: onRefreshSearchIndex}
                  : {})}
                onRebuild={onRebuildSearchIndex}
              />
            </details>
          ) : null}
          <footer className="config-footer">
            <button
              className="primary-action compact-action"
              onClick={() => {
                setConfigOpen(false);
              }}
            >
              完成
            </button>
          </footer>
        </div>
      </ContentDialog>
    </div>
  );
}

function InformationEntryQueryResults({
  graphContent,
  displayControls,
  toolbarContainer,
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
  readonly displayControls: ReactNode;
  readonly toolbarContainer: HTMLElement | null;
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
      embedded
      key={id}
      title={
        {language: '阅读设置', export: '资料清单与导出', tools: '比较与探索'}[
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

  const readingTools = (
    <aside className="query-reading-sidebar" aria-label="阅读与资料工具">
      <FloatingToolPanel title="阅读与导出" preferredWidth={600}>
        {displayControls}
        {['language', 'export', 'tools'].map(renderSidebarSection)}
        <details>
          <summary>字号与正文宽度</summary>
          <VisualSettings readingOnly />
        </details>
      </FloatingToolPanel>
    </aside>
  );

  return (
    <div className="query-reading-layout">
      {controller.view.status === 'error' ? (
        <div className="query-error-actions">
          {controller.retrievalMode !== 'lexical' ? (
            <button
              className="secondary-action"
              onClick={() => {
                controller.setRetrievalMode('lexical');
              }}
            >
              改用文字查询
            </button>
          ) : null}
          {controller.advancedFilters.association ? (
            <button
              className="secondary-action"
              onClick={() => {
                onAssociationToggle(false);
              }}
            >
              清除关联中心后查询
            </button>
          ) : null}
        </div>
      ) : null}
      <InformationEntryResults
        ariaLabel="条目查询结果"
        layoutName="query"
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

      {toolbarContainer === null
        ? readingTools
        : createPortal(readingTools, toolbarContainer)}
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
