import type {AiTask, IntakeRecord} from '../api/ai_workflow_client.js';
import {processingForDocument} from './document_processing_state.js';
import {useInboxPreviews} from './use_inbox_previews.js';
import {useState, type ReactNode} from 'react';

import type {InformationEntryDocumentView} from '../api/m1c_api_contract.js';
import type {Loadable} from '../components/product_types.js';
import {sourceDisplayName} from '../components/reading_text.js';

export function DocumentWorkspaceList({
  state,
  selectedId,
  onSelect,
  onRetry,
  renderProcessing,
  processing,
}: {
  readonly processing?: {tasks: AiTask[]; records: IntakeRecord[]} | undefined;
  readonly state: Loadable<readonly Readonly<InformationEntryDocumentView>[]>;
  readonly selectedId?: string | undefined;
  readonly onSelect: (snapshotId: string) => void;
  readonly onRetry: () => void;
  readonly renderProcessing?: (
    document: Readonly<InformationEntryDocumentView>,
  ) => ReactNode;
}) {
  const [filter, setFilter] = useState('');
  const [page, setPage] = useState(0);
  const [status, setStatus] = useState('all');
  const [sort, setSort] = useState('newest');
  const documents = state.status === 'ready' ? state.value : [];
  const matching = documents
    .filter((document) => {
      const p = processing
        ? processingForDocument(
            document.snapshotId,
            processing.tasks,
            processing.records,
          )
        : undefined;
      return (
        (status === 'all' ||
          (status === 'accepted'
            ? !p?.intake || p.intake.value.receipt === 'accepted'
            : status === 'unprocessed'
              ? document.entryCount === 0
              : status === 'completed'
                ? p?.task?.state.status === 'succeeded'
                : ['queued', 'running', 'paused'].includes(
                    p?.task?.state.status ?? '',
                  ))) &&
        `${sourceDisplayName(document)} ${document.canonicalUri ?? ''}`
          .toLocaleLowerCase()
          .includes(filter.toLocaleLowerCase().trim())
      );
    })
    .sort((a, b) =>
      sort === 'source'
        ? sourceDisplayName(a).localeCompare(sourceDisplayName(b), 'zh-CN')
        : sort === 'oldest'
          ? a.capturedAt.localeCompare(b.capturedAt)
          : b.capturedAt.localeCompare(a.capturedAt),
    );
  const pages = Math.max(1, Math.ceil(matching.length / 20));
  const currentPage = Math.min(page, pages - 1);
  const previews = useInboxPreviews(
    matching
      .slice(currentPage * 20, (currentPage + 1) * 20)
      .map((d) => d.snapshotId),
    false,
    false,
  );
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
      <div className="document-list-filters">
        <select
          aria-label="文档处理状态"
          value={status}
          onChange={(e) => {
            setStatus(e.target.value);
            setPage(0);
          }}
        >
          <option value="all">全部文档</option>
          <option value="accepted">已接受</option>
          <option value="unprocessed">尚无条目</option>
          <option value="queued">AI 队列中</option>
          <option value="completed">AI 处理完成</option>
        </select>
        <select
          aria-label="文档排序"
          value={sort}
          onChange={(e) => {
            setSort(e.target.value);
            setPage(0);
          }}
        >
          <option value="newest">最新在前</option>
          <option value="oldest">最早在前</option>
          <option value="source">按来源</option>
        </select>
        {status === 'unprocessed' ? (
          <p className="document-list-filter-hint">
            按当前原文是否生成条目筛选，不代表 AI 排队数量；处理正文可能另存。
          </p>
        ) : null}
      </div>
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
                  <strong>
                    {previews.previews.get(document.snapshotId)?.title ??
                      sourceDisplayName(document)}
                  </strong>
                  <span className="document-library-item__meta">
                    {previews.previews.get(document.snapshotId)?.source.name}
                  </span>
                  <span className="document-library-item__meta">
                    {document.entryCount === 0
                      ? '原文已接收 · 尚无条目'
                      : `${document.entryCount.toString()} 个条目 · ${document.annotatedEntryCount.toString()} 个已标注`}
                  </span>
                  {renderProcessing?.(document)}
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
