import {useState} from 'react';

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
  const [selectedRightEntryId, setSelectedRightEntryId] = useState<string>();
  const selectedRightEntry =
    controller.view.status === 'ready'
      ? controller.view.response.items.find(
          ({entry}) => entry.entryId === selectedRightEntryId,
        )?.entry
      : undefined;

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

      <aside className="workflow-mode-summary" aria-label="联系页操作指南">
        <strong>建立联系</strong>
        <span>1. 分别从两侧选择条目</span>
        <span>2. 在中间检查或编辑关系</span>
        <span>3. 确认后保存联系与权重</span>
      </aside>

      <div className="association-studio-grid">
        <AssociationEntryPicker
          label="联系起点"
          state={controller.view}
          selectedEntryId={controller.selectedEntryId}
          disabledEntryId={undefined}
          onSelect={controller.setSelectedEntryId}
        />
        <main className="association-studio-grid__editor">
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
              <p>左右两侧使用同一批查询结果；选中后会在中区编辑这对联系。</p>
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
              onSelectRelated={(entry) => {
                setSelectedRightEntryId(entry.entryId);
              }}
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
        </main>
        <AssociationEntryPicker
          label="联系终点"
          state={controller.view}
          selectedEntryId={selectedRightEntryId}
          disabledEntryId={controller.selectedEntryId}
          onSelect={setSelectedRightEntryId}
        />
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
        <ol>
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
                <strong>{entry.value.titlePath || '未命名条目'}</strong>
                <small>{entry.sourceKey}</small>
              </button>
            </li>
          ))}
        </ol>
      )}
    </aside>
  );
}
