import {AnnotationSummary} from './annotation_summary.js';
import type {
  InformationEntry,
  InformationEntryDocumentView,
} from '../api/m1c_api_contract.js';
import {DOMAIN_LABELS} from './information_entry_shared.js';
import {readingTitle} from '../components/reading_text.js';

interface TagSummary {
  text: string;
  ai: boolean;
  coverage: number;
  manual: boolean;
}

export function DocumentTagOverview({
  document,
  entries,
  focusedEntry,
  loading,
  error,
  onEditTags,
  onSelectEntry,
}: {
  readonly document: Readonly<InformationEntryDocumentView>;
  readonly entries: readonly Readonly<InformationEntry>[];
  readonly focusedEntry?: Readonly<InformationEntry> | undefined;
  readonly loading: boolean;
  readonly error?: string | undefined;
  readonly onEditTags: () => void;
  readonly onSelectEntry: (entryId: string) => void;
}) {
  const visible =
    error || loading ? [] : focusedEntry ? [focusedEntry] : entries;
  const tags = new Map<string, TagSummary>();
  for (const entry of visible) {
    for (const tag of entry.value.contentKeywords) {
      const previous = tags.get(tag.normalizedValue);
      tags.set(tag.normalizedValue, {
        text: previous?.text ?? tag.displayValue,
        ai: (previous?.ai ?? true) && tag.origin === 'ai',
        manual: false,
        coverage: (previous?.coverage ?? 0) + 1,
      });
    }
  }
  if (!focusedEntry && !error && !loading) {
    for (const tag of document.currentTags?.value.tags ?? []) {
      if (tag.origin !== 'manual') continue;
      tags.set(tag.normalizedValue, {
        text: tag.displayValue,
        ai: false,
        manual: true,
        coverage: tags.get(tag.normalizedValue)?.coverage ?? 0,
      });
    }
  }
  const overview = [...tags.values()]
    .filter((tag) => tag.manual || tag.coverage > 1 || visible.length === 1)
    .sort(
      (a, b) => Number(b.manual) - Number(a.manual) || b.coverage - a.coverage,
    );
  const renderTag = (tag: TagSummary) => (
    <span key={tag.text} className="document-tag">
      {tag.text}
      {tag.manual ? <small>文档选定</small> : tag.ai ? <small>AI</small> : null}
      {!focusedEntry && visible.length > 1 && tag.coverage > 0 ? (
        <small>覆盖 {tag.coverage} 条</small>
      ) : null}
    </span>
  );
  return (
    <div className="document-annotation-row">
      <strong>{focusedEntry ? '本条标签' : '文档概览'}</strong>
      <div className="document-annotation-values">
        {overview.slice(0, 6).map(renderTag)}
        {!overview.length ? (
          <span className="annotation-empty">
            {error
              ? '标签读取失败，请刷新文档'
              : loading
                ? '正在读取…'
                : tags.size
                  ? '标签主要属于各条目'
                  : '暂无标签'}
          </span>
        ) : null}
        <button type="button" className="text-action" onClick={onEditTags}>
          编辑标签
        </button>
        {visible.length > 0 || overview.length > 6 ? (
          <details
            className="annotation-overflow document-tag-browser"
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                event.currentTarget.open = false;
                event.currentTarget.querySelector('summary')?.focus();
              }
            }}
          >
            <summary>
              {focusedEntry
                ? `全部内容标签（${tags.size.toString()}）与领域`
                : visible.length
                  ? `按条目查看全部标签 · ${visible.length.toString()} 条`
                  : '更多文档标签'}
            </summary>
            <div>
              {!focusedEntry && overview.slice(6).some((tag) => tag.manual) ? (
                <div className="document-annotation-values">
                  {overview
                    .slice(6)
                    .filter((tag) => tag.manual)
                    .map(renderTag)}
                </div>
              ) : null}
              {visible.map((entry) => (
                <section key={entry.entryId} className="document-tag-entry">
                  {!focusedEntry ? (
                    <button
                      type="button"
                      className="text-action document-tag-entry-title"
                      onClick={() => {
                        onSelectEntry(entry.entryId);
                      }}
                    >
                      {entry.value.documentOrder + 1}.{' '}
                      {readingTitle(entry.value.titlePath)} · 阅读条目
                    </button>
                  ) : null}
                  <div className="document-annotation-values">
                    {entry.value.contentKeywords.map((tag) => (
                      <span key={tag.normalizedValue} className="document-tag">
                        {tag.displayValue}
                        {tag.origin === 'ai' ? <small>AI</small> : null}
                      </span>
                    ))}
                    {!entry.value.contentKeywords.length ? (
                      <span className="annotation-empty">本条暂无内容标签</span>
                    ) : null}
                  </div>
                  {entry.value.domains.length ? (
                    <p className="annotation-empty">
                      领域：
                      {entry.value.domains
                        .map(
                          (domain) =>
                            domain.customName ?? DOMAIN_LABELS[domain.keyword],
                        )
                        .join(' / ')}
                    </p>
                  ) : null}
                </section>
              ))}
            </div>
          </details>
        ) : null}
      </div>
    </div>
  );
}

export function DocumentEntryTags({
  entry,
}: {
  readonly entry: Readonly<InformationEntry>;
}) {
  return (
    <>
      <AnnotationSummary entry={entry} />
      <span
        className="document-boundary-tags"
        role="group"
        aria-label={`第 ${(entry.value.documentOrder + 1).toString()} 条标签`}
      >
        <strong>本条标签</strong>
        <span className="document-annotation-values">
          {entry.value.contentKeywords.map((tag) => (
            <span key={tag.normalizedValue} className="document-tag">
              {tag.displayValue}
              {tag.origin === 'ai' ? <small>AI</small> : null}
            </span>
          ))}
        </span>
      </span>
    </>
  );
}
