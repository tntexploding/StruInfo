import {readingTitle, sourceShortName} from '../components/reading_text.js';
import {useState} from 'react';

import type {InformationEntry} from '../api/m1c_api_contract.js';

import {
  type InformationEntryViewState,
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
  onListAssociations,
  onOpenEvidence,
  onRebuildAssociations,
  onReviseAssociationPolicy,
  onReviseAssociation,
  onSearch,
}: InformationEntryAssociationsWorkspaceProps) {
  const controller = useInformationEntryController({onSearch});
  const [relatedSelection, setRelatedSelection] = useState<{
    entry: Readonly<InformationEntry>;
    sourceEntryId: string | undefined;
    scope: typeof controller.searchRequest;
  }>();
  const selectedRightEntry =
    controller.view.status === 'ready' &&
    relatedSelection?.scope === controller.searchRequest &&
    relatedSelection.sourceEntryId === controller.selectedEntryId &&
    relatedSelection.entry.entryId !== controller.selectedEntryId &&
    (controller.includePrivate || !relatedSelection.entry.value.isPrivate)
      ? (controller.view.response.items.find(
          ({entry}) => entry.entryId === relatedSelection.entry.entryId,
        )?.entry ?? relatedSelection.entry)
      : undefined;

  function selectRelated(entry: Readonly<InformationEntry>) {
    setRelatedSelection({
      entry,
      sourceEntryId: controller.selectedEntryId,
      scope: controller.searchRequest,
    });
  }

  return (
    <div
      className="workspace-view entry-workspace workflow-stage-workspace"
      data-workflow-page="associations"
    >
      <header className="workflow-page-heading">
        <div>
          <h1>联系</h1>
        </div>
      </header>

      <details className="workflow-mode-summary" aria-label="联系页操作指南">
        <summary>操作指南 · 建立联系</summary>
        <span>1. 选择起点与终点</span>
        <span>2. 检查或编辑关系</span>
        <span>3. 确认后保存联系与权重</span>
      </details>

      <div className="association-studio-grid">
        <aside
          className="association-studio-selection"
          aria-label="选择联系条目"
        >
          <form
            className="association-selection-search"
            role="search"
            onSubmit={(event) => {
              event.preventDefault();
              void controller.executeSearch();
            }}
          >
            <label className="field">
              <span>查找联系条目</span>
              <input
                type="search"
                value={controller.query}
                onChange={(event) => {
                  controller.setQuery(event.currentTarget.value);
                }}
                placeholder="搜索标题、正文或关键词"
              />
            </label>
            <button className="secondary-action" type="submit">
              查找
            </button>
          </form>
          <AssociationEntryPicker
            label="联系起点"
            state={controller.view}
            selectedEntryId={controller.selectedEntryId}
            disabledEntryId={undefined}
            onSelect={controller.setSelectedEntryId}
          />
          <AssociationEntryPicker
            label="联系终点"
            state={controller.view}
            selectedEntryId={selectedRightEntry?.entryId}
            disabledEntryId={controller.selectedEntryId}
            onSelect={(entryId) => {
              if (controller.view.status !== 'ready') return;
              const entry = controller.view.response.items.find(
                (item) => item.entry.entryId === entryId,
              )?.entry;
              if (entry !== undefined) selectRelated(entry);
            }}
          />
          <div
            className="entry-pagination association-selection-pagination"
            aria-label="联系条目分页"
          >
            <button
              className="secondary-action"
              type="button"
              disabled={
                controller.pageIndex === 0 || controller.view.status !== 'ready'
              }
              onClick={() => {
                controller.showPreviousPage();
              }}
            >
              上一页
            </button>
            <span>第 {controller.pageIndex + 1} 页 · 每页最多 20 条</span>
            <button
              className="secondary-action"
              type="button"
              disabled={
                controller.view.status !== 'ready' ||
                controller.view.response.nextCursor === undefined
              }
              onClick={() => {
                controller.showNextPage();
              }}
            >
              下一页
            </button>
          </div>
        </aside>
        <section
          className="association-studio-grid__editor"
          aria-label="联系编辑"
          tabIndex={0}
        >
          <div className="association-studio-toolbar" aria-label="联系显示范围">
            <label className="privacy-query-toggle association-privacy-toggle">
              <input
                type="checkbox"
                checked={controller.includePrivate}
                onChange={(event) => {
                  controller.setIncludePrivate(event.currentTarget.checked);
                  controller.setOnlyPrivate(false);
                }}
              />
              查看隐私条目与联系
            </label>
            {controller.advancedFilters.association === undefined ? null : (
              <button
                className="text-action"
                type="button"
                onClick={() => {
                  controller.setAdvancedFilters((current) => {
                    const next = {...current};
                    delete next.association;
                    return Object.freeze(next);
                  });
                }}
              >
                返回全部条目
              </button>
            )}
          </div>
          {controller.selectedEntry === undefined ? (
            <section className="entry-state empty-state">
              <h2>先选择联系起点</h2>
              <p>从上方选择起点，再选择终点或一条推荐联系。</p>
            </section>
          ) : (
            <InformationEntryAssociationPanel
              key={`${controller.selectedEntry.entryId}:${controller.selectedEntry.revision.toString()}:${controller.includePrivate ? 'private' : 'public'}`}
              entry={controller.selectedEntry}
              targetEntry={selectedRightEntry}
              includePrivate={controller.includePrivate}
              onList={onListAssociations}
              onOpenEvidence={onOpenEvidence}
              onRebuild={onRebuildAssociations}
              onRevisePolicy={onReviseAssociationPolicy}
              onRevise={onReviseAssociation}
              onSelectRelated={selectRelated}
              onSearchNeighborhood={() => {
                controller.setAdvancedFilters((current) =>
                  Object.freeze({
                    ...current,
                    association: Object.freeze({
                      entryId: controller.selectedEntry?.entryId ?? '',
                      label:
                        controller.selectedEntry?.value.titlePath ??
                        '未命名条目',
                      maximumDepth: 2,
                      minimumScore: 0,
                    }),
                  }),
                );
              }}
            />
          )}
        </section>
      </div>
    </div>
  );
}

function AssociationEntryPicker({
  disabledEntryId,
  label,
  onSelect,
  selectedEntryId,
  state,
}: {
  readonly disabledEntryId: string | undefined;
  readonly label: string;
  readonly onSelect: (entryId: string) => void;
  readonly selectedEntryId: string | undefined;
  readonly state: InformationEntryViewState;
}) {
  return (
    <aside className="association-entry-picker" aria-label={label}>
      <header>
        <strong>{label}</strong>
        <span>
          {state.status === 'ready' ? state.response.totalCount : '—'}
        </span>
      </header>
      {state.status !== 'ready' ? (
        <p>{state.status === 'loading' ? '正在读取…' : state.message}</p>
      ) : (
        <ol aria-label={label + '列表'} tabIndex={0}>
          {state.response.items.map(({entry}) => (
            <li key={entry.entryId}>
              <button
                type="button"
                disabled={entry.entryId === disabledEntryId}
                aria-pressed={entry.entryId === selectedEntryId}
                onClick={() => {
                  onSelect(entry.entryId);
                }}
              >
                <strong>{readingTitle(entry.value.titlePath)}</strong>
                <small>{sourceShortName(entry)}</small>
              </button>
            </li>
          ))}
        </ol>
      )}
    </aside>
  );
}
