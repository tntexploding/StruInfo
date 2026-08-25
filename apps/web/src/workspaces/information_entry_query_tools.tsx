import type {EntrySearchAssociationFilter} from './information_entry_search_controls.js';
import type {InformationEntrySearchItem} from './information_entry_query_state.js';

export function InformationEntryQueryTools({
  association,
  comparisonCount,
  comparisonFull,
  selectedItem,
  selectedIsCompared,
  onAssociationToggle,
  onClearComparisons,
  onReplaceAssociationAnchor,
  onToggleComparison,
}: {
  readonly association: Readonly<EntrySearchAssociationFilter> | undefined;
  readonly comparisonCount: number;
  readonly comparisonFull: boolean;
  readonly selectedItem: Readonly<InformationEntrySearchItem> | undefined;
  readonly selectedIsCompared: boolean;
  readonly onAssociationToggle: (enabled: boolean) => void;
  readonly onClearComparisons: () => void;
  readonly onReplaceAssociationAnchor: () => void;
  readonly onToggleComparison: () => void;
}) {
  const selectedEntry = selectedItem?.entry;
  const associationEnabled = association !== undefined;
  const canEnableAssociation =
    associationEnabled || selectedEntry !== undefined;
  const canToggleComparison =
    selectedEntry !== undefined && (!comparisonFull || selectedIsCompared);
  const selectedIsAnchor =
    selectedEntry !== undefined &&
    selectedEntry.entryId === association?.entryId;

  return (
    <section
      className="entry-query-tools"
      aria-labelledby="entry-query-tools-title"
    >
      <header>
        <div>
          <p className="section-index">RESULT TOOLS</p>
          <h2 id="entry-query-tools-title">结果操作</h2>
        </div>
        <span className="record-count">
          比较 {comparisonCount.toString()} / 2
        </span>
      </header>

      <div className="entry-query-tool">
        <div>
          <strong>关联联想</strong>
          <p>
            只沿本地已计算或用户保留的联系展开，不调用 AI，也不代表语义等价。
          </p>
        </div>
        <label className="entry-query-association-switch">
          <input
            type="checkbox"
            aria-label="开启或关闭关联联想"
            checked={associationEnabled}
            disabled={!canEnableAssociation}
            onChange={(event) => {
              onAssociationToggle(event.currentTarget.checked);
            }}
          />
          <span>{associationEnabled ? '已开启' : '未开启'}</span>
        </label>
        <p className="entry-query-tool__status" aria-live="polite">
          {association === undefined
            ? selectedEntry === undefined
              ? '先选择一条查询结果，再开启关联联想。'
              : '将以“' +
                entryTitle(selectedEntry.value.titlePath) +
                '”作为起点。'
            : '当前起点：' +
              association.label +
              ' · ' +
              association.maximumDepth.toString() +
              ' 跳'}
        </p>
        {associationEnabled &&
        selectedEntry !== undefined &&
        !selectedIsAnchor ? (
          <button
            className="secondary-action"
            type="button"
            onClick={onReplaceAssociationAnchor}
          >
            改用当前条目作为起点
          </button>
        ) : null}
      </div>

      <div className="entry-query-tool">
        <div>
          <strong>条目比较</strong>
          <p>最多保留两条当前查询结果；修改查询或隐私范围后自动清空显示。</p>
        </div>
        <div className="entry-query-tool__actions">
          <button
            className="secondary-action"
            type="button"
            disabled={!canToggleComparison}
            onClick={onToggleComparison}
          >
            {selectedIsCompared ? '移出比较' : '加入比较'}
          </button>
          <button
            className="text-action"
            type="button"
            disabled={comparisonCount === 0}
            onClick={onClearComparisons}
          >
            清空比较
          </button>
        </div>
        <p className="entry-query-tool__status" aria-live="polite">
          {comparisonFull && !selectedIsCompared
            ? '比较栏已满；先移除一条，再加入当前条目。'
            : selectedEntry === undefined
              ? '当前没有可比较的 Entry。'
              : '当前选中：' + entryTitle(selectedEntry.value.titlePath)}
        </p>
      </div>
    </section>
  );
}

function entryTitle(value: string): string {
  return value === '' ? '未命名条目' : value;
}
