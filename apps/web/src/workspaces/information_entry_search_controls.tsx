import type {
  EntryDomainKeyword,
  EntryTypeKeyword,
  EvidenceSnapshotSummary,
} from '../api/m1c_api_contract.js';

export interface EntrySearchAssociationFilter {
  readonly entryId: string;
  readonly label: string;
  readonly maximumDepth: 1 | 2;
  readonly minimumScore: number;
}

export interface EntryAdvancedSearchFilters {
  readonly contentKeyword: string;
  readonly sourceKey: string;
  readonly typeCustomName: string;
  readonly domainCustomName: string;
  readonly domainScope: 'any' | 'primary' | 'secondary';
  readonly chunkMode: '' | 'split' | 'whole';
  readonly timeField: 'published' | 'captured';
  readonly timeFrom: string;
  readonly timeTo: string;
  readonly association?: Readonly<EntrySearchAssociationFilter>;
}

export function InformationEntryAdvancedSearchFields({
  domainKeyword,
  filters,
  onChange,
  snapshots,
  typeKeyword,
}: {
  readonly domainKeyword: '' | EntryDomainKeyword;
  readonly filters: Readonly<EntryAdvancedSearchFilters>;
  readonly onChange: (next: Readonly<EntryAdvancedSearchFilters>) => void;
  readonly snapshots: readonly Readonly<EvidenceSnapshotSummary>[];
  readonly typeKeyword: '' | EntryTypeKeyword;
}) {
  function update(patch: Partial<Readonly<EntryAdvancedSearchFilters>>): void {
    onChange(Object.freeze({...filters, ...patch}));
  }

  const association = filters.association;

  return (
    <details className="entry-search-advanced">
      <summary>精确筛选与有限关联</summary>
      <div className="entry-search-advanced__grid">
        <label className="field">
          <span>内容关键词（精确）</span>
          <input
            value={filters.contentKeyword}
            onChange={(event) => {
              update({contentKeyword: event.currentTarget.value});
            }}
            placeholder="例如：PostgreSQL"
          />
        </label>
        <label className="field">
          <span>来源键（精确）</span>
          <input
            value={filters.sourceKey}
            onChange={(event) => {
              update({sourceKey: event.currentTarget.value});
            }}
            list="entry-source-keys"
            placeholder="例如：git:ruanyf/weekly"
          />
          <datalist id="entry-source-keys">
            {[...new Set(snapshots.map((snapshot) => snapshot.sourceKey))]
              .sort()
              .map((value) => (
                <option key={value} value={value} />
              ))}
          </datalist>
        </label>
        {typeKeyword === 'other' ? (
          <label className="field">
            <span>自定义类型名称</span>
            <input
              value={filters.typeCustomName}
              onChange={(event) => {
                update({typeCustomName: event.currentTarget.value});
              }}
              required
            />
          </label>
        ) : null}
        {domainKeyword === 'other' ? (
          <label className="field">
            <span>自定义领域名称</span>
            <input
              value={filters.domainCustomName}
              onChange={(event) => {
                update({domainCustomName: event.currentTarget.value});
              }}
              required
            />
          </label>
        ) : null}
        <label className="field">
          <span>领域位置</span>
          <select
            value={filters.domainScope}
            disabled={domainKeyword === ''}
            onChange={(event) => {
              update({
                domainScope: event.currentTarget.value as
                  'any' | 'primary' | 'secondary',
              });
            }}
          >
            <option value="any">主、副领域均可</option>
            <option value="primary">仅主领域</option>
            <option value="secondary">仅副领域</option>
          </select>
        </label>
        <label className="field">
          <span>拆分方式</span>
          <select
            value={filters.chunkMode}
            onChange={(event) => {
              update({
                chunkMode: event.currentTarget.value as '' | 'split' | 'whole',
              });
            }}
          >
            <option value="">全部</option>
            <option value="split">按结构拆分</option>
            <option value="whole">全文单条</option>
          </select>
        </label>
        <label className="field">
          <span>时间依据</span>
          <select
            value={filters.timeField}
            onChange={(event) => {
              update({
                timeField: event.currentTarget.value as
                  'published' | 'captured',
              });
            }}
          >
            <option value="published">来源发布日期</option>
            <option value="captured">本地采集时间</option>
          </select>
        </label>
        <label className="field">
          <span>起始日期</span>
          <input
            type="date"
            value={filters.timeFrom}
            max={filters.timeTo || undefined}
            onChange={(event) => {
              update({timeFrom: event.currentTarget.value});
            }}
          />
        </label>
        <label className="field">
          <span>结束日期</span>
          <input
            type="date"
            value={filters.timeTo}
            min={filters.timeFrom || undefined}
            onChange={(event) => {
              update({timeTo: event.currentTarget.value});
            }}
          />
        </label>
        {association === undefined ? (
          <p className="entry-search-association-hint">
            先在结果中选择 Entry，再于“可能相关”区域点击“从此条目展开”。
          </p>
        ) : (
          <div className="entry-search-association-filter">
            <span>关联起点</span>
            <strong>{association.label}</strong>
            <label className="field">
              <span>最大跳数</span>
              <select
                value={association.maximumDepth}
                onChange={(event) => {
                  update({
                    association: Object.freeze({
                      ...association,
                      maximumDepth: Number(event.currentTarget.value) as 1 | 2,
                    }),
                  });
                }}
              >
                <option value={1}>1 跳</option>
                <option value={2}>2 跳</option>
              </select>
            </label>
            <label className="field">
              <span>最低关联分</span>
              <select
                value={association.minimumScore}
                onChange={(event) => {
                  update({
                    association: Object.freeze({
                      ...association,
                      minimumScore: Number(event.currentTarget.value),
                    }),
                  });
                }}
              >
                <option value={0}>不设下限</option>
                <option value={2500}>25%</option>
                <option value={5000}>50%</option>
                <option value={7500}>75%</option>
              </select>
            </label>
            <button
              className="text-action"
              type="button"
              onClick={() => {
                const remaining = {...filters};
                delete remaining.association;
                onChange(Object.freeze(remaining));
              }}
            >
              清除关联起点
            </button>
          </div>
        )}
      </div>
    </details>
  );
}
