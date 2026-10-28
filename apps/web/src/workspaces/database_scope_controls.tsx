import type {ReactNode} from 'react';
import {
  ENTRY_TYPE_KEYWORDS,
  ENTRY_DOMAIN_KEYWORDS,
  type EntryTypeKeyword,
  type EntryDomainKeyword,
  type EvidenceSnapshotSummary,
} from '../api/m1c_api_contract.js';
import {TYPE_LABELS, DOMAIN_LABELS} from './information_entry_shared.js';
import {AnnotationSearchFields} from './annotation_search_fields.js';
import {InformationEntryPrivacyScope} from './information_entry_components.js';
import {sourceDisplayName} from '../components/reading_text.js';
import type {useInformationEntryController} from './use_information_entry_controller.js';
export function DatabaseScopeControls({
  controller: c,
  snapshots,
  saved,
}: {
  controller: ReturnType<typeof useInformationEntryController>;
  snapshots: readonly EvidenceSnapshotSummary[];
  saved: ReactNode;
}) {
  const change = (key: string, value: string) => {
    c.setAdvancedFilters({...c.advancedFilters, [key]: value});
  };
  return (
    <>
      <div className="side-scroll">
        <details className="filter-group">
          <summary>
            分类与标签 <span>⌄</span>
          </summary>
          <div className="filter-fields">
            <label className="sample-field">
              <span>内容类型</span>
              <select
                value={c.typeKeyword}
                onChange={(e) => {
                  c.setTypeKeyword(e.target.value as '' | EntryTypeKeyword);
                }}
              >
                <option value="">全部类型</option>
                {ENTRY_TYPE_KEYWORDS.map((v) => (
                  <option key={v} value={v}>
                    {TYPE_LABELS[v]}
                  </option>
                ))}
              </select>
            </label>
            {c.typeKeyword === 'other' ? (
              <label className="sample-field">
                <span>类型名称</span>
                <input
                  maxLength={80}
                  value={c.advancedFilters.typeCustomName}
                  onChange={(e) => {
                    change('typeCustomName', e.target.value);
                  }}
                />
              </label>
            ) : null}
            <label className="sample-field">
              <span>领域</span>
              <select
                value={c.domainKeyword}
                onChange={(e) => {
                  c.setDomainKeyword(e.target.value as '' | EntryDomainKeyword);
                }}
              >
                <option value="">全部领域</option>
                {ENTRY_DOMAIN_KEYWORDS.map((v) => (
                  <option key={v} value={v}>
                    {DOMAIN_LABELS[v]}
                  </option>
                ))}
              </select>
            </label>
            {c.domainKeyword === 'other' ? (
              <label className="sample-field">
                <span>领域名称</span>
                <input
                  maxLength={80}
                  value={c.advancedFilters.domainCustomName}
                  onChange={(e) => {
                    change('domainCustomName', e.target.value);
                  }}
                />
              </label>
            ) : null}
            <label className="sample-field">
              <span>标签</span>
              <input
                maxLength={80}
                value={c.advancedFilters.contentKeyword}
                onChange={(e) => {
                  change('contentKeyword', e.target.value);
                }}
              />
            </label>
            <details className="nested-options">
              <summary>
                结构化标注 <span>⌄</span>
              </summary>
              <AnnotationSearchFields
                value={c.advancedFilters.annotationFilter}
                onChange={(annotationFilter) => {
                  c.setAdvancedFilters({
                    ...c.advancedFilters,
                    annotationFilter,
                  });
                }}
              />
            </details>
          </div>
        </details>
        <details className="filter-group">
          <summary>
            来源 <span>⌄</span>
          </summary>
          <div className="filter-fields">
            <label className="sample-field">
              <span>来源文档</span>
              <select
                value={c.snapshotId}
                onChange={(e) => {
                  c.setSnapshotId(e.target.value);
                }}
              >
                <option value="">全部来源</option>
                {snapshots
                  .filter((s) => c.includePrivate || !s.isPrivate)
                  .map((s) => (
                    <option key={s.snapshotId} value={s.snapshotId}>
                      {sourceDisplayName(s)}
                    </option>
                  ))}
              </select>
            </label>
          </div>
        </details>
        <details className="filter-group">
          <summary>
            时间 <span>⌄</span>
          </summary>
          <div className="filter-fields">
            <label className="sample-field">
              <span>日期依据</span>
              <select
                value={c.advancedFilters.timeField}
                onChange={(e) => {
                  change('timeField', e.target.value);
                }}
              >
                <option value="published">发布日期</option>
                <option value="captured">接收日期</option>
              </select>
            </label>
            {(['timeFrom', 'timeTo'] as const).map((key, i) => (
              <label className="sample-field" key={key}>
                <span>{i ? '至' : '从'}</span>
                <input
                  type="date"
                  value={c.advancedFilters[key]}
                  onChange={(e) => {
                    change(key, e.target.value);
                  }}
                />
              </label>
            ))}
          </div>
        </details>
        <details className="filter-group">
          <summary>
            阅读状态 <span>⌄</span>
          </summary>
          <div className="filter-fields">
            <label className="sample-field">
              <span>阅读状态</span>
              <select
                value={c.advancedFilters.annotationFilter?.readingState ?? ''}
                onChange={(e) => {
                  const next = {...c.advancedFilters.annotationFilter};
                  if (e.target.value)
                    next.readingState = e.target.value as NonNullable<
                      typeof next.readingState
                    >;
                  else delete next.readingState;
                  c.setAdvancedFilters({
                    ...c.advancedFilters,
                    annotationFilter: next,
                  });
                }}
              >
                <option value="">全部</option>
                <option value="unread">未读</option>
                <option value="reading">在读</option>
                <option value="read">已读</option>
                <option value="archived">已归档</option>
              </select>
            </label>
          </div>
        </details>
        <details className="filter-group">
          <summary>
            保存的查询 <span>⌄</span>
          </summary>
          <div className="filter-fields">{saved}</div>
        </details>
        <details className="filter-group">
          <summary>
            更多筛选 <span>⌄</span>
          </summary>
          <div className="filter-fields">
            <label className="sample-field">
              <span>来源键（精确）</span>
              <input
                value={c.advancedFilters.sourceKey}
                onChange={(e) => {
                  change('sourceKey', e.target.value);
                }}
              />
            </label>
            <label className="sample-field">
              <span>领域位置</span>
              <select
                value={c.advancedFilters.domainScope}
                disabled={!c.domainKeyword}
                onChange={(e) => {
                  change('domainScope', e.target.value);
                }}
              >
                <option value="any">主、副领域均可</option>
                <option value="primary">仅主领域</option>
                <option value="secondary">仅副领域</option>
              </select>
            </label>
            <label className="sample-field">
              <span>拆分方式</span>
              <select
                value={c.advancedFilters.chunkMode}
                onChange={(e) => {
                  change('chunkMode', e.target.value);
                }}
              >
                <option value="">全部</option>
                <option value="split">按结构拆分</option>
                <option value="whole">全文单条</option>
              </select>
            </label>
            {c.advancedFilters.association ? (
              <div className="filter-fields">
                <span>关联起点：{c.advancedFilters.association.label}</span>
                <label className="sample-field">
                  <span>最大跳数</span>
                  <select
                    value={c.advancedFilters.association.maximumDepth}
                    onChange={(e) => {
                      const a = c.advancedFilters.association;
                      if (a)
                        c.setAdvancedFilters({
                          ...c.advancedFilters,
                          association: {
                            ...a,
                            maximumDepth: Number(e.target.value) as 1 | 2,
                          },
                        });
                    }}
                  >
                    <option value={1}>1 跳</option>
                    <option value={2}>2 跳</option>
                  </select>
                </label>
                <label className="sample-field">
                  <span>最低关联分</span>
                  <select
                    value={c.advancedFilters.association.minimumScore}
                    onChange={(e) => {
                      const a = c.advancedFilters.association;
                      if (a)
                        c.setAdvancedFilters({
                          ...c.advancedFilters,
                          association: {
                            ...a,
                            minimumScore: Number(e.target.value),
                          },
                        });
                    }}
                  >
                    {[0, 2500, 5000, 7500].map((v) => (
                      <option key={v} value={v}>
                        {v === 0 ? '不设下限' : String(v / 100) + '%'}
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  onClick={() => {
                    const f = {...c.advancedFilters};
                    delete f.association;
                    c.setAdvancedFilters(f);
                  }}
                >
                  清除关联起点
                </button>
              </div>
            ) : null}
            <InformationEntryPrivacyScope
              includePrivate={c.includePrivate}
              onlyPrivate={c.onlyPrivate}
              onChange={c.setPrivacyScope}
            />
          </div>
        </details>
      </div>
      <footer className="scope-footer">
        <span>
          {c.onlyPrivate
            ? '仅私密资料'
            : c.includePrivate
              ? '包含私密资料'
              : '公开资料'}
        </span>
        <button
          type="button"
          className="quiet-button"
          onClick={c.clearSearchFilters}
        >
          清除筛选
        </button>
      </footer>
    </>
  );
}
