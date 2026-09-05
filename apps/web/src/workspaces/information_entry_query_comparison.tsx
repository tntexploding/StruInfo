import type {InformationEntry} from '../api/m1c_api_contract.js';
import type {InformationEntryServices} from './information_entry_components.js';
import type {InformationEntrySearchItem} from './information_entry_query_state.js';
import {DOMAIN_LABELS, TYPE_LABELS} from './information_entry_shared.js';

export function InformationEntryQueryComparison({
  items,
  onOpenEvidence,
  onRemove,
}: {
  readonly items: readonly Readonly<InformationEntrySearchItem>[];
  readonly onOpenEvidence: InformationEntryServices['onOpenEvidence'];
  readonly onRemove: (entryId: string) => void;
}) {
  return (
    <section
      className="entry-query-comparison"
      aria-labelledby="entry-query-comparison-title"
    >
      <header className="console-heading">
        <div>
          <h2 id="entry-query-comparison-title">结果比较</h2>
          <p>最多选择两个结果并排查看。</p>
        </div>
        <span className="record-count">{items.length.toString()} / 2</span>
      </header>
      {items.length === 0 ? (
        <div className="entry-query-comparison__empty">
          <strong>尚未选择比较条目</strong>
          <p>在结果列表中选中条目，再使用“加入比较”。</p>
        </div>
      ) : (
        <div className="entry-query-comparison__grid">
          {items.map((item, index) => (
            <ComparisonCard
              key={item.entry.entryId}
              index={index}
              item={item}
              onOpenEvidence={onOpenEvidence}
              onRemove={onRemove}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function ComparisonCard({
  index,
  item,
  onOpenEvidence,
  onRemove,
}: {
  readonly index: number;
  readonly item: Readonly<InformationEntrySearchItem>;
  readonly onOpenEvidence: InformationEntryServices['onOpenEvidence'];
  readonly onRemove: (entryId: string) => void;
}) {
  const entry = item.entry;
  const titleId = 'entry-query-comparison-' + entry.entryId;
  return (
    <article className="entry-query-comparison-card" aria-labelledby={titleId}>
      <header>
        <div>
          <span>条目 {(index + 1).toString()}</span>
          <h3 id={titleId}>{entryTitle(entry)}</h3>
          <p>
            {entry.sourceKey} · v{entry.revision.toString()}
            {entry.value.isPrivate ? ' · 隐私内容' : ' · 公开内容'}
          </p>
        </div>
        <button
          className="text-action"
          type="button"
          onClick={() => {
            onRemove(entry.entryId);
          }}
        >
          移出比较
        </button>
      </header>

      <dl className="entry-query-comparison-card__facts">
        <Fact label="文本命中" value={textMatchLabel(item)} />
        <Fact
          label="拆分方式"
          value={entry.value.chunkMode === 'split' ? '按结构拆分' : '全文条目'}
        />
        <Fact
          label="有用 / 有趣"
          value={
            scoreLabel(entry.value.usefulnessScore) +
            ' / ' +
            scoreLabel(entry.value.interestScore)
          }
        />
        <Fact label="类型" value={typeLabel(entry)} />
        <Fact label="领域" value={domainLabel(entry)} />
        <Fact
          label="关联路径"
          value={
            item.association === undefined
              ? '未通过关联筛选'
              : item.association.depth.toString() +
                ' 跳 · 最低分 ' +
                percentage(item.association.effectiveScore) +
                '%'
          }
        />
      </dl>

      <div
        className="entry-query-comparison-card__keywords"
        aria-label={entryTitle(entry) + '的内容关键词'}
      >
        {entry.value.contentKeywords.length === 0 ? (
          <span>尚无内容关键词</span>
        ) : (
          entry.value.contentKeywords.map((keyword) => (
            <span key={keyword.normalizedValue}>{keyword.displayValue}</span>
          ))
        )}
      </div>

      <details className="entry-query-comparison-card__body">
        <summary>查看正文</summary>
        <div>{entry.value.body}</div>
      </details>

      <footer>
        <button
          className="secondary-action"
          type="button"
          onClick={() => {
            onOpenEvidence(
              entry.snapshotId,
              entry.value.fragmentIds[0],
              entry.value.isPrivate,
            );
          }}
        >
          查看原文
        </button>
      </footer>
    </article>
  );
}

function Fact({
  label,
  value,
}: {
  readonly label: string;
  readonly value: string;
}) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function entryTitle(entry: Readonly<InformationEntry>): string {
  return entry.value.titlePath === '' ? '未命名条目' : entry.value.titlePath;
}

function textMatchLabel(item: Readonly<InformationEntrySearchItem>): string {
  if (item.textMatch === undefined) return '无文字筛选';
  return (
    textModeLabel(item.textMatch.mode) +
    ' · 匹配度 ' +
    percentage(item.textMatch.score) +
    '/100'
  );
}

function textModeLabel(mode: string): string {
  switch (mode) {
    case 'exact':
      return '精确';
    case 'substring':
      return '包含';
    case 'fuzzy':
      return '近似';
    default:
      return mode;
  }
}

function scoreLabel(value: number | undefined): string {
  return value === undefined ? '未评估' : value.toString() + ' / 5';
}

function typeLabel(entry: Readonly<InformationEntry>): string {
  if (entry.value.typeKeyword === undefined) return '未标注';
  return entry.value.typeCustomName ?? TYPE_LABELS[entry.value.typeKeyword];
}

function domainLabel(entry: Readonly<InformationEntry>): string {
  if (entry.value.domains.length === 0) return '未标注';
  return entry.value.domains
    .map((domain) => domain.customName ?? DOMAIN_LABELS[domain.keyword])
    .join(' / ');
}

function percentage(value: number): string {
  return (value / 100).toFixed(value % 100 === 0 ? 0 : 1);
}
