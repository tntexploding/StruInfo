import type {AnnotationFilter} from '../api/annotation_contract.js';
import type {
  EntryRetrievalMode,
  EntryTextSearchField,
  EntryTextSearchMode,
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
              ? '隐私内容仅在本机进行文字搜索。'
              : queryPresent
                ? '结果按内容相似度排序。可打开原文核对。'
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
      <p>
        文字匹配包含所选字段的原文和已保存的有效中文译文，同一条目只返回一次。未翻译内容可用原文或已有标签查找。
      </p>
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
  readonly annotationFilter?: AnnotationFilter;
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
