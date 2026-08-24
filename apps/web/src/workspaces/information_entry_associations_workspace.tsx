import type {SyntheticEvent} from 'react';
import {useState} from 'react';

import {ActionNotice} from '../components/action_notice.js';
import type {ActionFeedback} from '../components/product_types.js';
import {
  InformationEntryResults,
  type InformationEntryServices,
} from './information_entry_components.js';
import {InformationEntryAssociationPanel} from './information_entry_association_panel.js';
import {useInformationEntryController} from './use_information_entry_controller.js';

export interface InformationEntryAssociationsWorkspaceProps extends Pick<
  InformationEntryServices,
  | 'onListAssociations'
  | 'onOpenEvidence'
  | 'onRebuildAssociations'
  | 'onReviseAssociationPolicy'
  | 'onReviseAssociation'
  | 'onSearch'
> {
  readonly aiEnabled: boolean;
}

export function InformationEntryAssociationsWorkspace({
  aiEnabled,
  onListAssociations,
  onOpenEvidence,
  onRebuildAssociations,
  onReviseAssociationPolicy,
  onReviseAssociation,
  onSearch,
}: InformationEntryAssociationsWorkspaceProps) {
  const controller = useInformationEntryController({onSearch});
  const [feedback, setFeedback] = useState<ActionFeedback>();

  function submitSearch(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    setFeedback(undefined);
    void controller.executeSearch();
  }

  return (
    <div
      className="workspace-view entry-workspace workflow-stage-workspace"
      data-workflow-page="associations"
    >
      <header className="workflow-page-heading">
        <div>
          <p className="section-index">04 / ENTRY ASSOCIATION</p>
          <h1>联系</h1>
          <p>选择一个条目，检查可解释候选，并单独增强、削弱或屏蔽联系。</p>
        </div>
        <span className="origin-label origin-label--deterministic">
          {aiEnabled
            ? '确定性相似度 · AI 建议未接入'
            : '确定性相似度 · 人工覆盖'}
        </span>
      </header>

      <section className="workflow-capability-strip" aria-label="联系能力">
        <div className="workflow-capability-strip__primary">
          <p className="section-index">ASSOCIATION MODE</p>
          <strong>候选联系与人工覆盖分离</strong>
          <span>内容、类型和领域评分可解释；投影重建不会覆盖人工决定。</span>
        </div>
        <div className="workflow-capability-strip__options">
          <span data-active="true">一跳候选</span>
          <span data-active="true">人工增强 / 削弱 / 屏蔽</span>
          <span data-active="false">AI 建议 · 待接入</span>
        </div>
      </section>

      <section
        className="entry-command-panel"
        aria-labelledby="association-select-title"
      >
        <header className="console-heading">
          <div>
            <p className="section-index">ASSOCIATION / START</p>
            <h2 id="association-select-title">选择联系起点</h2>
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
            <span>查找条目</span>
            <input
              type="search"
              value={controller.query}
              onChange={(event) => {
                controller.setQuery(event.currentTarget.value);
              }}
              placeholder="标题、正文或关键词"
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
            查看隐私联系
          </label>
          <div className="entry-command-actions">
            {controller.advancedFilters.association === undefined ? null : (
              <button
                className="secondary-action"
                type="button"
                onClick={() => {
                  controller.setAdvancedFilters((current) => {
                    const next = {...current};
                    delete next.association;
                    return Object.freeze(next);
                  });
                }}
              >
                清除邻域筛选
              </button>
            )}
            <button className="primary-action entry-query-action" type="submit">
              查找起点
            </button>
          </div>
        </form>
        <ActionNotice feedback={feedback} />
      </section>

      <InformationEntryResults
        ariaLabel="联系起点条目"
        emptyDescription="当前范围没有可用于联系检查的 Entry。"
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
          <InformationEntryAssociationPanel
            key={`${controller.selectedEntry.entryId}:${controller.selectedEntry.revision.toString()}:${controller.includePrivate ? 'private' : 'public'}`}
            entry={controller.selectedEntry}
            includePrivate={controller.includePrivate}
            onList={onListAssociations}
            onOpenEvidence={onOpenEvidence}
            onRebuild={onRebuildAssociations}
            onRevisePolicy={onReviseAssociationPolicy}
            onRevise={onReviseAssociation}
            onSearchNeighborhood={() => {
              controller.setAdvancedFilters((current) =>
                Object.freeze({
                  ...current,
                  association: Object.freeze({
                    entryId: controller.selectedEntry?.entryId ?? '',
                    label:
                      controller.selectedEntry?.value.titlePath ?? '未命名条目',
                    maximumDepth: 2,
                    minimumScore: 0,
                  }),
                }),
              );
              setFeedback({
                kind: 'success',
                title: '已设为关联搜索起点',
                detail: '当前列表展示最多两跳的有限邻域。',
              });
            }}
          />
        )}
      </InformationEntryResults>
    </div>
  );
}
