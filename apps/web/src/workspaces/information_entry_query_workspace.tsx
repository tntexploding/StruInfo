import type {SyntheticEvent} from 'react';

import {
  ENTRY_DOMAIN_KEYWORDS,
  ENTRY_TYPE_KEYWORDS,
  type EntryDomainKeyword,
  type EntryTypeKeyword,
  type EvidenceSnapshotSummary,
} from '../api/m1c_api_contract.js';
import {
  InformationEntryPrivacyScope,
  InformationEntryReadOnlyDetail,
  InformationEntryResults,
  type InformationEntryServices,
} from './information_entry_components.js';
import {DOMAIN_LABELS, TYPE_LABELS} from './information_entry_shared.js';
import {InformationEntryAdvancedSearchFields} from './information_entry_search_controls.js';
import {useInformationEntryController} from './use_information_entry_controller.js';
import {PrivateDocumentResults} from './private_document_results.js';

export interface InformationEntryQueryWorkspaceProps extends Pick<
  InformationEntryServices,
  'onOpenEvidence' | 'onSearch'
> {
  readonly aiEnabled: boolean;
  readonly snapshots: readonly Readonly<EvidenceSnapshotSummary>[];
}

export function InformationEntryQueryWorkspace({
  aiEnabled,
  onOpenEvidence,
  onSearch,
  snapshots,
}: InformationEntryQueryWorkspaceProps) {
  const controller = useInformationEntryController({onSearch});

  function submitSearch(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    void controller.executeSearch();
  }

  return (
    <div
      className="workspace-view entry-workspace workflow-stage-workspace"
      data-workflow-page="query"
    >
      <header className="workflow-page-heading">
        <div>
          <p className="section-index">05 / DETERMINISTIC QUERY</p>
          <h1>查询</h1>
          <p>按正文、标签、来源、时间与有限邻域检索，并返回精确来源。</p>
        </div>
        <span className="origin-label origin-label--deterministic">
          {aiEnabled ? '确定性搜索 · AI 联想未接入' : '确定性搜索 · 可离线使用'}
        </span>
      </header>

      <section className="workflow-capability-strip" aria-label="查询能力">
        <div className="workflow-capability-strip__primary">
          <p className="section-index">QUERY MODE</p>
          <strong>文本与结构化筛选联合查询</strong>
          <span>隐私范围在计数、排序、分页和关联遍历之前生效。</span>
        </div>
        <div className="workflow-capability-strip__options">
          <span data-active="true">标题 / 正文 / 标签</span>
          <span data-active="true">精确结构筛选</span>
          <span data-active="false">模糊 / 联想 · 待接入</span>
        </div>
      </section>

      <section
        className="entry-command-panel"
        aria-labelledby="query-command-title"
      >
        <header className="console-heading">
          <div>
            <p className="section-index">QUERY / FILTER</p>
            <h2 id="query-command-title">搜索信息条目</h2>
          </div>
          <span className="record-count">
            {controller.view.status === 'ready'
              ? controller.includePrivate
                ? `${controller.view.response.totalCount.toString()} Entry · ${controller.view.response.privateDocuments.totalCount.toString()} 完整隐私文档`
                : `${controller.view.response.totalCount.toString()} 条`
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
              placeholder="留空浏览当前 Entry"
            />
          </label>
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
            <button className="primary-action entry-query-action" type="submit">
              {controller.includePrivate
                ? '查找 Entry 与完整文档'
                : '查找 Entry'}
            </button>
          </div>
        </form>
      </section>

      {controller.view.status === 'ready' && controller.includePrivate ? (
        <PrivateDocumentResults
          items={controller.view.response.privateDocuments.items}
          totalCount={controller.view.response.privateDocuments.totalCount}
          onOpenEvidence={onOpenEvidence}
        />
      ) : null}

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
    </div>
  );
}
