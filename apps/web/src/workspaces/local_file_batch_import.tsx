import {useEffect, useRef, useState} from 'react';
import type {DragEvent} from 'react';

import {
  createClientUuid,
  createCommandKey,
} from '../components/client_identity.js';
import type {ActionFeedback} from '../components/product_types.js';
import {
  LOCAL_DOCUMENT_BATCH_MAX_FILES,
  composeLocalDocumentImportRequest,
  describeLocalDocumentFileIssue,
  formatLocalDocumentFileBytes,
  prepareLocalDocumentFile,
  type LocalDocumentImportIdentity,
  type PreparedLocalDocumentFile,
} from './local_file_import.js';

type BatchItemStatus =
  | 'preparing'
  | 'ready'
  | 'importing'
  | 'succeeded'
  | 'failed'
  | 'cancelled'
  | 'invalid';

interface LocalFileBatchItem {
  readonly itemId: string;
  readonly fileName: string;
  readonly identity: Readonly<LocalDocumentImportIdentity>;
  readonly status: BatchItemStatus;
  readonly file?: Readonly<PreparedLocalDocumentFile>;
  readonly requestBody?: Readonly<Record<string, unknown>>;
  readonly feedback?: Readonly<ActionFeedback>;
}

export interface LocalFileBatchImportProps {
  readonly isPrivate: boolean;
  readonly publicationDate: string;
  readonly profile: 'commonmark-v1' | 'ruanyf-weekly-v1';
  readonly sourcePreface: string;
  readonly onImport: (body: unknown) => Promise<ActionFeedback>;
  readonly onCompleted: () => Promise<void> | void;
  readonly onStateChange: (
    state: Readonly<{hasItems: boolean; busy: boolean}>,
  ) => void;
}

export function LocalFileBatchImport({
  isPrivate,
  publicationDate,
  profile,
  sourcePreface,
  onImport,
  onCompleted,
  onStateChange,
}: LocalFileBatchImportProps) {
  const input = useRef<HTMLInputElement>(null);
  const cancelRequested = useRef(false);
  const [items, setItems] = useState<readonly LocalFileBatchItem[]>([]);
  const [running, setRunning] = useState(false);
  const [selectionMessage, setSelectionMessage] = useState('');

  const preparing = items.some((item) => item.status === 'preparing');
  const busy = running || preparing;
  const readyCount = items.filter((item) => item.status === 'ready').length;
  const succeededCount = items.filter(
    (item) => item.status === 'succeeded',
  ).length;
  const failedCount = items.filter(
    (item) => item.status === 'failed' || item.status === 'invalid',
  ).length;
  const cancelledCount = items.filter(
    (item) => item.status === 'cancelled',
  ).length;
  const finishedCount = succeededCount + failedCount + cancelledCount;
  const retryable = items.some(
    (item) => item.status === 'failed' || item.status === 'cancelled',
  );

  useEffect(() => {
    onStateChange({hasItems: items.length > 0, busy});
  }, [busy, items.length, onStateChange]);

  useEffect(
    () => () => {
      onStateChange({hasItems: false, busy: false});
    },
    [onStateChange],
  );

  async function addFiles(fileList: FileList | readonly File[]) {
    if (running || preparing) return;
    const incoming = Array.from(fileList);
    if (incoming.length === 0) return;
    const available = Math.max(
      0,
      LOCAL_DOCUMENT_BATCH_MAX_FILES - items.length,
    );
    const accepted = incoming.slice(0, available);
    const omitted = incoming.length - accepted.length;
    setSelectionMessage(
      omitted > 0
        ? `已忽略 ${omitted.toString()} 个超出 ${LOCAL_DOCUMENT_BATCH_MAX_FILES.toString()} 份上限的选择。`
        : '',
    );
    if (accepted.length === 0) return;
    const placeholders = accepted.map<LocalFileBatchItem>((file) => ({
      itemId: createClientUuid(),
      fileName: file.name,
      identity: createImportIdentity(),
      status: 'preparing',
    }));
    setItems((current) => [...current, ...placeholders]);
    for (const [index, file] of accepted.entries()) {
      const placeholder = placeholders[index];
      if (placeholder === undefined) continue;
      try {
        const prepared = prepareLocalDocumentFile(
          file.name,
          new Uint8Array(await file.arrayBuffer()),
        );
        if (prepared.status === 'rejected') {
          updateItem(placeholder.itemId, {
            ...placeholder,
            status: 'invalid',
            feedback: {
              kind: 'error',
              title: '文件未加入导入队列',
              detail: describeLocalDocumentFileIssue(prepared.code),
            },
          });
        } else {
          updateItem(placeholder.itemId, {
            ...placeholder,
            status: 'ready',
            file: prepared.value,
          });
        }
      } catch {
        updateItem(placeholder.itemId, {
          ...placeholder,
          status: 'invalid',
          feedback: {
            kind: 'error',
            title: '文件读取失败',
            detail: '没有向本地服务发送任何内容。',
          },
        });
      }
    }
    if (input.current !== null) input.current.value = '';
  }

  function updateItem(itemId: string, value: LocalFileBatchItem) {
    setItems((current) =>
      current.map((item) => (item.itemId === itemId ? value : item)),
    );
  }

  async function runBatch(mode: 'ready' | 'retry') {
    if (running || preparing) return;
    const candidateIds = items
      .filter((item) =>
        mode === 'ready'
          ? item.status === 'ready'
          : item.status === 'failed' || item.status === 'cancelled',
      )
      .map((item) => item.itemId);
    if (candidateIds.length === 0) return;
    cancelRequested.current = false;
    setRunning(true);
    setSelectionMessage('');
    let working = [...items];
    let imported = false;
    try {
      for (const itemId of candidateIds) {
        const index = working.findIndex((item) => item.itemId === itemId);
        const item = working[index];
        if (item === undefined) continue;
        if (isCancellationRequested(cancelRequested)) {
          working = replaceItem(working, index, {...item, status: 'cancelled'});
          setItems(working);
          continue;
        }
        if (item.file === undefined) continue;
        let requestBody = item.requestBody;
        if (requestBody === undefined) {
          const request = await composeLocalDocumentImportRequest({
            identity: item.identity,
            file: item.file,
            isPrivate,
            publicationDate,
            profile,
            sourcePreface,
          });
          if (request.status === 'rejected') {
            working = replaceItem(working, index, {
              ...item,
              status: 'failed',
              feedback: {
                kind: 'error',
                title: '组合后的文档超过上限',
                detail:
                  '文件与批次前置文字合计不得超过 1 MiB；没有写入任何数据。',
              },
            });
            setItems(working);
            continue;
          }
          requestBody = request.body;
        }
        working = replaceItem(working, index, {
          ...item,
          requestBody,
          status: 'importing',
        });
        setItems(working);
        let feedback: ActionFeedback;
        try {
          feedback = await onImport(requestBody);
        } catch {
          feedback = {
            kind: 'error',
            title: '本地服务没有完成导入',
            detail: '服务恢复后可以重试，不会重复导入该文件。',
          };
        }
        const latest = working[index];
        if (latest === undefined) continue;
        working = replaceItem(working, index, {
          ...latest,
          status: feedback.kind === 'success' ? 'succeeded' : 'failed',
          feedback,
        });
        setItems(working);
        if (feedback.kind === 'success') imported = true;
      }
      if (imported) await onCompleted();
    } finally {
      setRunning(false);
    }
  }

  function stopAfterCurrentFile() {
    cancelRequested.current = true;
    setSelectionMessage('停止请求已记录；当前文件结束后不会再开始后续导入。');
  }

  function clearBatch() {
    if (running || preparing) return;
    setItems([]);
    setSelectionMessage('');
    if (input.current !== null) input.current.value = '';
  }

  return (
    <section className="local-file-batch" aria-labelledby="local-batch-title">
      <header className="local-file-batch__heading">
        <div>
          <h4 id="local-batch-title">多文件导入队列</h4>
          <p>
            一次最多选择 {LOCAL_DOCUMENT_BATCH_MAX_FILES}{' '}
            份文件，可单独重试失败项。
          </p>
        </div>
        <button
          className="text-action"
          type="button"
          disabled={items.length === 0 || running || preparing}
          onClick={clearBatch}
        >
          清空批次
        </button>
      </header>
      <input
        ref={input}
        className="local-file-input"
        id="local-document-batch-files"
        type="file"
        multiple
        disabled={
          running || preparing || items.length >= LOCAL_DOCUMENT_BATCH_MAX_FILES
        }
        accept=".md,.markdown,.txt,.html,.htm,.pdf,text/markdown,text/plain,text/html,application/pdf"
        onChange={(event) => {
          if (event.currentTarget.files !== null) {
            void addFiles(event.currentTarget.files);
          }
        }}
      />
      <div
        className="local-file-dropzone local-file-dropzone--batch"
        onDragOver={(event) => {
          event.preventDefault();
          event.dataTransfer.dropEffect = 'copy';
        }}
        onDrop={(event: DragEvent<HTMLDivElement>) => {
          event.preventDefault();
          void addFiles(event.dataTransfer.files);
        }}
      >
        <label
          className="secondary-action"
          htmlFor="local-document-batch-files"
        >
          选择多份文件
        </label>
        <span>或把明确选中的多份文件拖到这里</span>
      </div>
      {selectionMessage === '' ? null : (
        <p className="local-file-batch__message" role="status">
          {selectionMessage}
        </p>
      )}
      {items.length === 0 ? (
        <p className="local-file-batch__empty">
          尚未选择文件。批次不会读取文件夹、子目录或机器路径。
        </p>
      ) : (
        <>
          <div className="local-file-batch__progress" aria-live="polite">
            <div>
              <strong>
                {finishedCount.toString()} / {items.length.toString()}
              </strong>
              <span>
                成功 {succeededCount.toString()} · 失败 {failedCount.toString()}{' '}
                · 已停止 {cancelledCount.toString()}
              </span>
            </div>
            <progress
              aria-label="批次导入进度"
              max={items.length}
              value={finishedCount}
            />
          </div>
          <ol className="local-file-batch__list">
            {items.map((item) => (
              <li key={item.itemId} data-status={item.status}>
                <div className="local-file-batch__item-main">
                  <strong>{item.fileName}</strong>
                  <span>{describeBatchStatus(item.status)}</span>
                </div>
                <div className="local-file-batch__item-meta">
                  <span>
                    {item.file === undefined
                      ? '等待文件校验'
                      : `${item.file.mediaType} · ${formatLocalDocumentFileBytes(item.file.byteLength)}`}
                  </span>
                  {item.feedback === undefined ? null : (
                    <span>{item.feedback.detail}</span>
                  )}
                </div>
                <button
                  className="text-action"
                  type="button"
                  disabled={running || item.status === 'importing'}
                  onClick={() => {
                    setItems((current) =>
                      current.filter(
                        (candidate) => candidate.itemId !== item.itemId,
                      ),
                    );
                  }}
                >
                  移除
                </button>
              </li>
            ))}
          </ol>
        </>
      )}
      <footer className="local-file-batch__actions">
        <p>
          开始导入后，当前选项会分别用于每个文件；失败后重试不会重复创建文档。
        </p>
        <div>
          {running ? (
            <button
              className="secondary-action"
              type="button"
              onClick={stopAfterCurrentFile}
            >
              停止后续导入
            </button>
          ) : null}
          {!running && retryable ? (
            <button
              className="secondary-action"
              type="button"
              onClick={() => {
                void runBatch('retry');
              }}
            >
              重试失败与已停止项
            </button>
          ) : null}
          <button
            className="primary-action"
            type="button"
            disabled={running || preparing || readyCount === 0}
            onClick={() => {
              void runBatch('ready');
            }}
          >
            {running
              ? '批次导入中…'
              : `导入 ${readyCount.toString()} 份就绪文件`}
          </button>
        </div>
      </footer>
    </section>
  );
}

function isCancellationRequested(
  signal: Readonly<{readonly current: boolean}>,
): boolean {
  return signal.current;
}

function replaceItem(
  items: readonly LocalFileBatchItem[],
  index: number,
  item: LocalFileBatchItem,
): LocalFileBatchItem[] {
  const next = [...items];
  next[index] = item;
  return next;
}

function createImportIdentity(): Readonly<LocalDocumentImportIdentity> {
  return Object.freeze({
    commandIdempotencyKey: createCommandKey('import'),
    capturedAt: new Date().toISOString(),
    resourceId: createClientUuid(),
    snapshotId: createClientUuid(),
  });
}

function describeBatchStatus(status: BatchItemStatus): string {
  if (status === 'preparing') return '正在本机校验';
  if (status === 'ready') return '就绪';
  if (status === 'importing') return '正在写入';
  if (status === 'succeeded') return '已导入';
  if (status === 'failed') return '导入失败';
  if (status === 'cancelled') return '未开始 · 已停止';
  return '文件无效';
}
