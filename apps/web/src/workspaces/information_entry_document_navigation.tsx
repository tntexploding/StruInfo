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
          <p className="section-index">EXPLICIT BATCH</p>
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
                  <strong>{document.sourceKey}</strong>
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
  return (
    <section
      className="entry-document-navigator"
      aria-labelledby="entry-document-navigator-title"
    >
      <header className="console-heading">
        <div>
          <p className="section-index">DOCUMENT / ENTRY MAP</p>
          <h2 id="entry-document-navigator-title">来源文档导航</h2>
        </div>
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
        <p className="entry-document-navigator__loading" role="status">
          正在汇总 Document 与 Entry…
        </p>
      ) : (
        <div className="entry-document-navigator__rail">
          <button
            type="button"
            aria-pressed={selectedSnapshotId === ''}
            data-active={selectedSnapshotId === ''}
            onClick={() => {
              onSelect('');
            }}
          >
            <strong>全部文档</strong>
            <small>
              {state.response.documents
                .reduce((sum, document) => sum + document.entryCount, 0)
                .toString()}{' '}
              Entries
            </small>
          </button>
          {state.response.documents.map((document) => (
            <button
              key={document.snapshotId}
              type="button"
              aria-pressed={selectedSnapshotId === document.snapshotId}
              data-active={selectedSnapshotId === document.snapshotId}
              onClick={() => {
                onSelect(document.snapshotId);
              }}
            >
              <strong>{document.sourceKey}</strong>
              <small>
                {document.entryCount.toString()} Entries ·{' '}
                {(document.currentTags?.value.tags.length ?? 0).toString()} 标签
                {document.isPrivate === true ? ' · 私密' : ''}
                {document.workingCopy?.state === 'editing' ? ' · 全文草稿' : ''}
                {document.workingCopy?.state === 'committed'
                  ? ' · 已生成派生文档'
                  : ''}
                {document.derivedFromSnapshotId === undefined
                  ? ''
                  : ' · 派生版本'}
              </small>
            </button>
          ))}
        </div>
      )}
    </section>
  );
}
