import type {PrivateDocumentSearchItem} from '../api/m1c_api_contract.js';
import type {InformationEntryServices} from './information_entry_components.js';

export function PrivateDocumentResults({
  items,
  onOpenEvidence,
  totalCount,
}: {
  readonly items: readonly Readonly<PrivateDocumentSearchItem>[];
  readonly onOpenEvidence: InformationEntryServices['onOpenEvidence'];
  readonly totalCount: number;
}) {
  return (
    <section
      className="private-document-results"
      aria-labelledby="private-document-results-title"
    >
      <header className="console-heading">
        <div>
          <p className="section-index">PRIVATE DOCUMENT CHANNEL</p>
          <h2 id="private-document-results-title">完整隐私文档</h2>
          <p>
            这是独立于 Entry
            的全文结果。正文仅在本次明确放宽的隐私范围内打开，不会混入普通结果。
          </p>
        </div>
        <span className="record-count">{totalCount.toString()} 篇</span>
      </header>
      {items.length === 0 ? (
        <p className="private-document-results__empty">
          当前全文、来源与时间条件没有匹配完整隐私文档。
        </p>
      ) : (
        <ol className="private-document-results__list">
          {items.map((item) => (
            <li key={item.snapshot.snapshotId}>
              <article>
                <header>
                  <div>
                    <strong>{item.snapshot.sourceKey}</strong>
                    <span>隐私文档 · 完整备份</span>
                  </div>
                  <time dateTime={item.snapshot.capturedAt}>
                    捕获于 {item.snapshot.capturedAt}
                  </time>
                </header>
                {item.snapshot.canonicalUri === undefined ? null : (
                  <p className="private-document-results__source">
                    {item.snapshot.canonicalUri}
                  </p>
                )}
                {item.excerpt === undefined ? null : <p>{item.excerpt}</p>}
                <footer>
                  <span>
                    {item.matchReasons.length === 0
                      ? '当前隐私范围内浏览'
                      : item.matchReasons
                          .map(privateDocumentMatchReasonLabel)
                          .join(' · ')}
                  </span>
                  {item.textMatch === undefined ? null : (
                    <span>
                      {privateDocumentTextModeLabel(item.textMatch.mode)}匹配 ·{' '}
                      词法分 {scoreOutOfOneHundred(item.textMatch.score)}/100
                    </span>
                  )}{' '}
                  <span>
                    {item.entryMatchCount > 0
                      ? `${item.entryMatchCount.toString()} 个 Entry 同时符合结构条件`
                      : '完整文档通道'}
                  </span>
                  <button
                    className="secondary-action"
                    type="button"
                    onClick={() => {
                      onOpenEvidence(item.snapshot.snapshotId, undefined, true);
                    }}
                  >
                    查看完整隐私文档
                  </button>
                </footer>
              </article>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function privateDocumentMatchReasonLabel(
  reason: PrivateDocumentSearchItem['matchReasons'][number],
): string {
  switch (reason) {
    case 'body':
      return '全文命中';
    case 'source':
      return '来源命中';
    case 'uri':
      return '来源地址命中';
    case 'entry_tags':
      return '文档内 Entry 标签命中';
  }
}
function privateDocumentTextModeLabel(value: string): string {
  switch (value) {
    case 'exact':
      return '精确';
    case 'substring':
      return '包含';
    case 'fuzzy':
      return '近似';
    default:
      return value;
  }
}

function scoreOutOfOneHundred(value: number): string {
  return (value / 100).toFixed(value % 100 === 0 ? 0 : 1);
}
