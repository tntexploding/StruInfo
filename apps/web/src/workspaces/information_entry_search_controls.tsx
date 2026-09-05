import type {
  EntryDomainKeyword,
  EntryRetrievalMode,
  EntryTextSearchField,
  EntryTextSearchMode,
  EntryTypeKeyword,
  EvidenceSnapshotSummary,
} from '../api/m1c_api_contract.js';

export function InformationEntryRetrievalOptions({
  mode,
  publicScope,
  queryPresent,
  semanticAvailable,
  semanticReady,
  onChange,
}: {
  readonly mode: EntryRetrievalMode;
  readonly publicScope: boolean;
  readonly queryPresent: boolean;
  readonly semanticAvailable: boolean;
  readonly semanticReady: boolean;
  readonly onChange: (mode: EntryRetrievalMode) => void;
}) {
  const semanticUsable =
    semanticAvailable && semanticReady && publicScope && queryPresent;
  return (
    <fieldset className="entry-text-search-options entry-retrieval-options">
      <legend>搜索方式</legend>
      <div className="entry-text-search-options__choices">
        {(
          [
            ['lexical', '文字搜索'],
            ['semantic', '内容相似'],
            ['hybrid', '综合搜索'],
          ] as const
        ).map(([value, label]) => (
          <label key={value}>
            <input
              type="radio"
              name="entry-retrieval-mode"
              value={value}
              checked={mode === value}
              disabled={value !== 'lexical' && !semanticUsable}
              onChange={() => {
                onChange(value);
              }}
            />
            <span>{label}</span>
          </label>
        ))}
      </div>
      <p>
        {!semanticAvailable
          ? '未配置语义搜索模型，目前使用文字搜索。'
          : !semanticReady
            ? '内容相似索引尚未就绪，请先刷新索引。'
            : !publicScope
              ? '隐私内容只在本机进行文字搜索，不会发送给外部 AI 服务。'
              : queryPresent
                ? '内容相似和综合搜索会按相似度排序，不代表事实正确性。'
                : '输入搜索文字后可使用内容相似或综合搜索。'}
      </p>
    </fieldset>
  );
}

const TEXT_SEARCH_MODE_OPTIONS: readonly Readonly<{
  value: EntryTextSearchMode;
  label: string;
}>[] = Object.freeze([
  Object.freeze({value: 'exact', label: '精确一致'}),
  Object.freeze({value: 'substring', label: '包含文字'}),
  Object.freeze({value: 'fuzzy', label: '近似匹配'}),
]);

const TEXT_SEARCH_FIELD_OPTIONS: readonly Readonly<{
  value: EntryTextSearchField;
  label: string;
}>[] = Object.freeze([
  Object.freeze({value: 'title', label: '标题'}),
  Object.freeze({value: 'body', label: '正文'}),
  Object.freeze({value: 'tags', label: '标签'}),
]);

export function InformationEntryTextSearchOptions({
  fields,
  mode,
  onFieldsChange,
  onModeChange,
}: {
  readonly fields: readonly EntryTextSearchField[];
  readonly mode: EntryTextSearchMode;
  readonly onFieldsChange: (fields: readonly EntryTextSearchField[]) => void;
  readonly onModeChange: (mode: EntryTextSearchMode) => void;
}) {
  return (
    <fieldset className="entry-text-search-options">
      <legend>文本匹配</legend>
      <div className="entry-text-search-options__group">
        <span>方式</span>
        <div className="entry-text-search-options__choices">
          {TEXT_SEARCH_MODE_OPTIONS.map((option) => (
            <label key={option.value}>
              <input
                type="radio"
                name="entry-text-search-mode"
                value={option.value}
                checked={mode === option.value}
                onChange={() => {
                  onModeChange(option.value);
                }}
              />
              <span>{option.label}</span>
            </label>
          ))}
        </div>
      </div>
      <div className="entry-text-search-options__group">
        <span>范围</span>
        <div className="entry-text-search-options__choices">
          {TEXT_SEARCH_FIELD_OPTIONS.map((option) => {
            const checked = fields.includes(option.value);
            return (
              <label key={option.value}>
                <input
                  type="checkbox"
                  value={option.value}
                  checked={checked}
                  disabled={checked && fields.length === 1}
                  onChange={() => {
                    onFieldsChange(
                      Object.freeze(
                        checked
                          ? fields.filter((field) => field !== option.value)
                          : [...fields, option.value],
                      ),
                    );
                  }}
                />
                <span>{option.label}</span>
              </label>
            );
          })}
        </div>
      </div>
      <p>近似匹配会寻找拼写相近的文字，不调用 AI，也不表示含义相同。</p>
    </fieldset>
  );
}
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
            placeholder="例如：git:example.invalid/synthetic-source"
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
            先在结果中选择一个条目，再于“结果操作”开启关联联想。
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
