import {useState} from 'react';
import {sourceDisplayName} from '../components/reading_text.js';
import type {InformationDocumentViewState} from './information_entry_components.js';

export function InformationEntryBatchMaterializer({
  busy,
  onClear,
  onSelectAll,
  onSubmit,
  onToggle,
  selectedSnapshotIds,
  state,
}: {
  readonly busy: boolean;
  readonly onClear: () => void;
  readonly onSelectAll: () => void;
  readonly onSubmit: () => void;
  readonly onToggle: (snapshotId: string, selected: boolean) => void;
  readonly selectedSnapshotIds: readonly string[];
  readonly state: InformationDocumentViewState;
}) {
  const documents =
    state.status === 'ready'
      ? state.response.documents.filter(
          (document) =>
            document.entryCount === 0 && document.workingCopy === undefined,
        )
      : Object.freeze([]);
  const selected = new Set(selectedSnapshotIds);

  return (
    <section
      className="entry-batch-panel"
      aria-labelledby="entry-batch-panel-title"
    >
      <header className="console-heading">
        <div>
          <h2 id="entry-batch-panel-title">批量构建文档条目</h2>
        </div>
        <span className="record-count">
          {state.status === 'ready'
            ? `${selectedSnapshotIds.length.toString()} / ${documents.length.toString()} 已选`
            : '等待文档'}
        </span>
      </header>
      <p className="entry-batch-panel__summary">
        只处理明确选中且尚未生成条目的来源文档；重试不会创建重复条目。
      </p>
      {state.status === 'loading' ? (
        <p className="entry-batch-panel__state" role="status">
          正在读取可构建文档…
        </p>
      ) : state.status === 'error' ? (
        <p className="entry-batch-panel__state">
          文档列表恢复后才能批量构建；当前数据没有被修改。
        </p>
      ) : documents.length === 0 ? (
        <p className="entry-batch-panel__state">当前可见文档均已有条目。</p>
      ) : (
        <fieldset className="entry-batch-panel__fieldset">
          <legend>选择来源文档</legend>
          <div className="entry-batch-panel__list">
            {documents.map((document) => (
              <label
                className="entry-batch-panel__option"
                key={document.snapshotId}
              >
                <input
                  type="checkbox"
                  checked={selected.has(document.snapshotId)}
                  onChange={(event) => {
                    onToggle(document.snapshotId, event.currentTarget.checked);
                  }}
                />
                <span>
                  <strong>{sourceDisplayName(document)}</strong>
                  <small>
                    尚未生成{document.isPrivate === true ? ' · 私密文档' : ''}
                  </small>
                </span>
              </label>
            ))}
          </div>
        </fieldset>
      )}
      <div className="entry-batch-panel__actions">
        <button
          className="text-action"
          type="button"
          onClick={onSelectAll}
          disabled={documents.length === 0 || busy}
        >
          全选
        </button>
        <button
          className="text-action"
          type="button"
          onClick={onClear}
          disabled={selectedSnapshotIds.length === 0 || busy}
        >
          清空
        </button>
        <button
          className="primary-action"
          type="button"
          onClick={onSubmit}
          disabled={selectedSnapshotIds.length === 0 || busy}
        >
          {busy ? '正在构建…' : '构建所选文档'}
        </button>
      </div>
    </section>
  );
}

export function InformationDocumentNavigator({
  onRetry,
  onSelect,
  selectedSnapshotId,
  state,
}: {
  readonly onRetry: () => void;
  readonly onSelect: (snapshotId: string) => void;
  readonly selectedSnapshotId: string;
  readonly state: InformationDocumentViewState;
}) {
  const [filter, setFilter] = useState('');
  const documents = state.status === 'ready' ? state.response.documents : [];
  const matching = documents.filter(
    (document) =>
      document.snapshotId === selectedSnapshotId ||
      `${sourceDisplayName(document)} ${document.sourceKey}`
        .toLocaleLowerCase()
        .includes(filter.toLocaleLowerCase()),
  );
  return (
    <section
      className="entry-document-navigator"
      aria-labelledby="entry-document-navigator-title"
    >
      <header className="console-heading">
        <h2 id="entry-document-navigator-title">来源文档导航</h2>
        <span className="record-count">
          {state.status === 'ready'
            ? `${state.response.totalCount.toString()} 份`
            : '读取中'}
        </span>
      </header>
      {state.status === 'error' ? (
        <div className="entry-document-navigator__error" role="alert">
          <span>{state.message}</span>
          <button className="text-action" type="button" onClick={onRetry}>
            重试
          </button>
        </div>
      ) : state.status === 'loading' ? (
        <p role="status">正在汇总文档与条目…</p>
      ) : (
        <div className="document-selection-controls">
          <label className="field">
            <span>筛选来源文档</span>
            <input
              type="search"
              value={filter}
              onChange={(event) => {
                setFilter(event.currentTarget.value);
              }}
              placeholder="按来源名称查找"
            />
          </label>
          <label className="field">
            <span>选择来源文档</span>
            <select
              value={selectedSnapshotId}
              onChange={(event) => {
                onSelect(event.currentTarget.value);
              }}
            >
              <option value="">
                全部文档 ·{' '}
                {documents.reduce(
                  (sum, document) => sum + document.entryCount,
                  0,
                )}{' '}
                条目
              </option>
              {matching.map((document) => (
                <option key={document.snapshotId} value={document.snapshotId}>
                  {sourceDisplayName(document)} · {document.entryCount} 条
                  {document.isPrivate === true ? ' · 私密' : ''}
                </option>
              ))}
            </select>
          </label>
          {filter !== '' && matching.length === 0 ? (
            <p role="status">没有匹配文档，请更换名称。</p>
          ) : null}
        </div>
      )}
    </section>
  );
}
