import {useEffect, useState, useMemo} from 'react';
import type {ReactNode} from 'react';
import type {
  InformationEntry,
  InformationEntryDocumentView,
} from '../api/m1c_api_contract.js';
import {documentRelationPresentation} from './document_relation_presentation.js';
import type {DocumentLink} from './document_relation_presentation.js';
import type {Loadable} from '../components/product_types.js';
import type {DocumentWorkspaceApi} from './use_document_workspace.js';
import {DocumentTagOverview} from './document_tag_overview.js';

export function DocumentAnnotations({
  document,
  entries,
  focusedEntry,
  onSelectEntry,
  loading,
  error,
  active,
  includePrivate,
  api,
  onOpenDocument,
  onEditTags,
}: {
  readonly document: Readonly<InformationEntryDocumentView>;
  readonly entries: readonly Readonly<InformationEntry>[];
  readonly focusedEntry?: Readonly<InformationEntry> | undefined;
  readonly onSelectEntry: (entryId: string) => void;
  readonly loading: boolean;
  readonly error?: string | undefined;
  readonly active: boolean;
  readonly includePrivate: boolean;
  readonly api: Pick<DocumentWorkspaceApi, 'listInformationEntryAssociations'>;
  readonly onOpenDocument: (id: string, entryId: string) => void;
  readonly onEditTags: () => void;
}) {
  const relationEntries = useMemo(
    () => (focusedEntry ? [focusedEntry] : entries),
    [focusedEntry, entries],
  );
  const [reload, setReload] = useState(0);
  const [links, setLinks] = useState<{
    entries: typeof entries;
    includePrivate: boolean;
    value: Loadable<readonly DocumentLink[]>;
  }>();
  useEffect(() => {
    if (!active || loading || error) return;
    const request = new AbortController();
    void (async () => {
      const found = new Map<string, DocumentLink>();
      for (let i = 0; i < relationEntries.length; i += 4) {
        const responses = await Promise.all(
          relationEntries.slice(i, i + 4).map(async (entry) => ({
            entry,
            response: await api.listInformationEntryAssociations(
              entry.entryId,
              {includePrivate, signal: request.signal},
            ),
          })),
        );
        if (request.signal.aborted) return;
        for (const {entry, response} of responses) {
          if (
            response.body.status !== 'ok' ||
            response.body.entryId !== entry.entryId
          )
            throw new Error('relation_read_failed');
          for (const relation of response.body.associations) {
            const other = relation.relatedEntry;
            if (
              relation.isBlocked ||
              (!includePrivate && other.value.isPrivate)
            )
              continue;
            const graph = relation.override?.value.graph;
            if (!relation.projection && !graph) continue;
            const link = documentRelationPresentation(entry, relation);
            found.set(other.entryId + ':' + link.label, link);
          }
        }
      }
      if (!request.signal.aborted)
        setLinks({
          entries: relationEntries,
          includePrivate,
          value: {
            status: 'ready',
            value: [...found.values()].sort(
              (a, b) =>
                ['人工', 'AI', '相似度'].indexOf(a.origin) -
                  ['人工', 'AI', '相似度'].indexOf(b.origin) ||
                Number(a.broad) - Number(b.broad),
            ),
          },
        });
    })().catch(() => {
      if (!request.signal.aborted)
        setLinks({
          entries: relationEntries,
          includePrivate,
          value: {status: 'error', message: '联系暂时无法读取'},
        });
    });
    return () => {
      request.abort();
    };
  }, [active, api, relationEntries, includePrivate, loading, error, reload]);
  const linkState =
    links?.entries === relationEntries &&
    links.includePrivate === includePrivate
      ? links.value
      : undefined;
  const renderLink = (link: DocumentLink) => (
    <li key={link.entryId + ':' + link.label} className="document-relation">
      <div className="document-relation-heading">
        <button
          type="button"
          className="document-relation-title"
          onClick={() => {
            onOpenDocument(link.snapshotId, link.entryId);
          }}
        >
          {link.title}
        </button>
        {link.isExcerpt ? (
          <span className="document-relation-excerpt">正文摘录</span>
        ) : null}
      </div>
      <p className="document-relation-reason">
        <span>{link.reasonLabel}：</span>
        {link.reason}
      </p>
      <div className="document-relation-meta">
        <span>
          {link.origin === '相似度' ? '相似度关联' : link.origin + ' 建立'} ·{' '}
          {link.review}
        </span>
        {link.broad ? <span>宽泛关联</span> : null}
        <AnnotationOverflow label="查看依据">
          <dl className="document-relation-evidence">
            <div>
              <dt>原始关系说明</dt>
              <dd>{link.label}</dd>
            </div>
            <div>
              <dt>{link.origin === 'AI' ? 'AI 记录的依据' : '记录的依据'}</dt>
              <dd>{link.note || '没有额外说明。'}</dd>
            </div>
            {link.isExcerpt ? (
              <div>
                <dt>原标题</dt>
                <dd>{link.originalTitle}</dd>
              </div>
            ) : null}
          </dl>
          <p className="document-relation-caution">
            关系说明用于比较两篇资料，事实请结合原文核对。
          </p>
        </AnnotationOverflow>
      </div>
    </li>
  );
  return (
    <section className="document-annotations" aria-label="文首标签与联系">
      <DocumentTagOverview
        document={document}
        entries={entries}
        focusedEntry={focusedEntry}
        loading={loading}
        error={error}
        onEditTags={onEditTags}
        onSelectEntry={onSelectEntry}
      />
      <div className="document-annotation-row document-relations-row">
        <strong>联系</strong>
        <div className="document-relations">
          {error ? (
            <span className="annotation-empty">联系尚未读取</span>
          ) : loading || !linkState ? (
            <span className="annotation-empty">正在读取…</span>
          ) : linkState.status === 'error' ? (
            <button
              type="button"
              className="text-action"
              onClick={() => {
                setReload((n) => n + 1);
              }}
            >
              {linkState.message} · 重试
            </button>
          ) : linkState.status === 'ready' ? (
            <>
              <ul className="document-relation-list">
                {linkState.value.slice(0, 2).map(renderLink)}
              </ul>
              {linkState.value.length > 2 ? (
                <AnnotationOverflow
                  label={
                    '其余 ' +
                    (linkState.value.length - 2).toString() +
                    ' 条联系'
                  }
                >
                  <ul className="document-relation-list">
                    {linkState.value.slice(2).map(renderLink)}
                  </ul>
                </AnnotationOverflow>
              ) : null}
              {!linkState.value.length ? (
                <span className="annotation-empty">暂无联系</span>
              ) : null}
            </>
          ) : null}
        </div>
      </div>
    </section>
  );
}
function AnnotationOverflow({
  label,
  children,
}: {
  readonly label: string;
  readonly children: ReactNode;
}) {
  return (
    <details
      className="annotation-overflow"
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.currentTarget.open = false;
          event.currentTarget.querySelector('summary')?.focus();
        }
      }}
    >
      <summary>{label}</summary>
      <div>{children}</div>
    </details>
  );
}
