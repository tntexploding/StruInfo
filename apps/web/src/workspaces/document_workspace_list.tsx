import {useState} from 'react';

import type {InformationEntryDocumentView} from '../api/m1c_api_contract.js';
import type {Loadable} from '../components/product_types.js';
import {sourceDisplayName} from '../components/reading_text.js';

export function DocumentWorkspaceList({
  state,
  selectedId,
  onSelect,
  onRetry,
}: {
  readonly state: Loadable<readonly Readonly<InformationEntryDocumentView>[]>;
  readonly selectedId?: string | undefined;
  readonly onSelect: (snapshotId: string) => void;
  readonly onRetry: () => void;
}) {
  const [filter, setFilter] = useState('');
  const [page, setPage] = useState(0);
  const documents = state.status === 'ready' ? state.value : [];
  const matching = documents.filter((document) =>
    `${sourceDisplayName(document)} ${document.canonicalUri ?? ''}`
      .toLocaleLowerCase()
      .includes(filter.toLocaleLowerCase().trim()),
  );
  const pages = Math.max(1, Math.ceil(matching.length / 20));
  const currentPage = Math.min(page, pages - 1);
  return (
    <section
      className="document-library-list"
      aria-labelledby="document-library-list-title"
    >
      <header className="document-library-list__header">
        <h2 id="document-library-list-title">文档</h2>
        <span className="record-count">
          {state.status === 'ready'
            ? `${matching.length.toString()} 份`
            : '读取中'}
        </span>
      </header>
      <label className="field">
        <span>查找文档</span>
        <input
          type="search"
          value={filter}
          placeholder="来源名称或地址"
          onChange={(event) => {
            setFilter(event.currentTarget.value);
            setPage(0);
          }}
        />
      </label>
      {state.status === 'loading' ? <p role="status">正在读取文档…</p> : null}
      {state.status === 'error' ? (
        <div role="alert">
          <p>{state.message}</p>
          <button type="button" className="secondary-action" onClick={onRetry}>
            重试文档列表
          </button>
        </div>
      ) : null}
      <div
        className="document-library-list__scroll"
        role="region"
        aria-label="文档列表"
        tabIndex={0}
      >
        {state.status === 'ready' && matching.length === 0 ? (
          <p className="empty-copy">
            {filter === ''
              ? '尚无文档。导入材料后即可开始阅读。'
              : '没有匹配文档，请调整条件。'}
          </p>
        ) : null}
        <ol>
          {matching
            .slice(currentPage * 20, (currentPage + 1) * 20)
            .map((document) => (
              <li key={document.snapshotId}>
                <button
                  type="button"
                  className="document-library-item"
                  aria-pressed={document.snapshotId === selectedId}
                  onClick={() => {
                    onSelect(document.snapshotId);
                  }}
                >
                  <span className="document-library-item__meta">
                    {new Date(document.capturedAt).toLocaleDateString('zh-CN')}
                    {document.isPrivate === true ? ' · 私密' : ''}
                  </span>
                  <strong>{sourceDisplayName(document)}</strong>
                  <span className="document-library-item__meta">
                    {document.entryCount === 0
                      ? '原文已接收 · 尚无条目'
                      : `${document.entryCount.toString()} 个条目 · ${document.annotatedEntryCount.toString()} 个已标注`}
                  </span>
                  {document.snapshotId === selectedId ? (
                    <span className="document-library-item__selected">
                      正在查看
                    </span>
                  ) : null}
                </button>
              </li>
            ))}
        </ol>
      </div>
      <footer className="document-library-list__footer">
        <button
          className="secondary-action"
          type="button"
          disabled={currentPage === 0}
          onClick={() => {
            setPage(currentPage - 1);
          }}
        >
          上一页
        </button>
        <span>
          {currentPage + 1} / {pages}
        </span>
        <button
          className="secondary-action"
          type="button"
          disabled={currentPage + 1 >= pages}
          onClick={() => {
            setPage(currentPage + 1);
          }}
        >
          下一页
        </button>
      </footer>
    </section>
  );
}
