import {useEffect, useRef, useState} from 'react';
import {
  aiWorkflowCommand,
  aiError,
  type DocumentQueueStatus,
  type DocumentQueueItem,
  type DocumentQueueResult,
} from '../api/ai_workflow_client.js';
import type {useAiActivity} from './use_ai_activity.js';
import {sourceDisplayName} from '../components/reading_text.js';
const LABELS = {
  resume: '批量从断点继续',
  cancel: '批量取消任务',
  restart: '为耗尽任务重启一轮',
  start: '处理未开始文档',
};
const TASK_STATES: Record<string, string> = {
  failed: '失败',
  paused: '暂缓',
  queued: '排队',
  running: '进行中',
};
export function DocumentQueueControls({
  activity,
  visible,
}: {
  activity: ReturnType<typeof useAiActivity>;
  visible: boolean;
}) {
  const [data, setData] = useState<DocumentQueueStatus>();
  const [error, setError] = useState(''),
    [message, setMessage] = useState('');
  const [action, setAction] = useState<DocumentQueueItem['action']>();
  const [selection, setSelection] = useState<string[]>([]);
  const [busy, setBusy] = useState(false),
    [refresh, setRefresh] = useState(0);
  const writing = useRef(false);
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (action) dialog.current?.showModal();
    else dialog.current?.close();
  }, [action]);
  useEffect(() => {
    if (!visible || writing.current || action) return;
    let disposed = false;
    void aiWorkflowCommand<DocumentQueueStatus>('document_queue_status')
      .then((result) => {
        if (!Array.isArray(result.items))
          throw new Error('ai_operation_failed');
        if (!disposed) {
          setData(result);
          setError('');
        }
      })
      .catch((cause: unknown) => {
        if (!disposed) setError(aiError(cause));
      });
    return () => {
      disposed = true;
    };
  }, [visible, activity.data?.checkedAt, refresh, action]);
  const candidates = data?.items.filter((item) => item.action === action) ?? [];
  function choose(value: DocumentQueueItem['action']) {
    setAction((current) => (current === value ? undefined : value));
    setSelection(
      value === 'cancel'
        ? []
        : (data?.items
            .filter((item) => item.action === value)
            .slice(0, data.batchLimit)
            .map((item) => item.snapshotId) ?? []),
    );
    setMessage('');
  }
  async function submit() {
    if (!action || !data || writing.current) return;
    const items = candidates.filter((item) =>
      selection.includes(item.snapshotId),
    );
    if (!items.length) return;
    writing.current = true;
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const result = await aiWorkflowCommand<DocumentQueueResult>(
        'document_queue_apply',
        {
          action,
          items: items.map(({snapshotId, taskId, expectedVersion}) => ({
            snapshotId,
            expectedVersion,
            ...(taskId ? {taskId} : {}),
          })),
        },
      );
      setMessage(
        (action === 'cancel'
          ? `已请求取消 ${String(result.cancelled.length)} 篇`
          : `已加入队列 ${String(result.queued.length)} 篇`) +
          (result.failed.length
            ? `；未成功 ${String(result.failed.length)} 篇：` +
              [
                ...new Set(
                  result.failed.map((item) => aiError(new Error(item.code))),
                ),
              ].join('；')
            : action === 'cancel'
              ? '。停止后续步骤，保留原文和已完成结果。'
              : '。按现有许可和价格时段执行。'),
      );
      setAction(undefined);
      setSelection([]);
      activity.refresh();
    } catch (cause) {
      setError(aiError(cause));
    } finally {
      writing.current = false;
      setBusy(false);
      setRefresh((value) => value + 1);
    }
  }
  const actionButton = (value: DocumentQueueItem['action']) => (
    <button
      key={value}
      className={value === 'cancel' ? 'danger-action' : 'secondary-action'}
      disabled={
        busy ||
        Boolean(error) ||
        activity.error ||
        (value !== 'cancel' && !activity.data?.model) ||
        !data?.items.some((item) => item.action === value)
      }
      aria-haspopup="dialog"
      aria-controls="document-queue-selection"
      onClick={() => {
        choose(value);
      }}
    >
      {LABELS[value]}
      {data
        ? `（${String(data.items.filter((item) => item.action === value).length)}）`
        : ''}
    </button>
  );
  return (
    <div className="document-queue-controls" aria-label="文档批量任务">
      <div className="ai-queue-controls">
        {actionButton('resume')}
        {actionButton('cancel')}
      </div>
      <details className="document-queue-more">
        <summary>更多批量操作</summary>
        <div className="ai-queue-controls">
          {actionButton('restart')}
          {actionButton('start')}
        </div>
      </details>
      <dialog
        ref={dialog}
        id="document-queue-selection"
        className="document-queue-dialog"
        aria-labelledby="document-queue-dialog-title"
        aria-describedby="document-queue-dialog-description"
        onCancel={(event) => {
          if (busy) event.preventDefault();
          else setAction(undefined);
        }}
        onClose={() => {
          setAction(undefined);
        }}
      >
        {action ? (
          <>
            <h2 id="document-queue-dialog-title">{LABELS[action]}</h2>
            <p id="document-queue-dialog-description">
              {action === 'resume'
                ? '从上次进度继续，使用剩余额度。容量超限或正文冲突的任务需先修正。'
                : action === 'cancel'
                  ? '只停止所选文档任务的后续步骤；已发出的请求完成后停止。原文、接收决定和已完成结果保留，取消的任务不能直接继续。'
                  : action === 'restart'
                    ? '仅为额度或尝试次数已耗尽的失败任务开启同额度的新一轮；保留已完成步骤，旧记录和消耗仍可追溯。'
                    : '为尚未处理的公开文档启动审核 → 拆分 → 标签与联系 → 入库。'}{' '}
              每批最多 {data?.batchLimit} 篇。
            </p>
            <div className="ai-queue-controls">
              {action === 'cancel' ? (
                <button
                  className="text-action"
                  disabled={
                    busy ||
                    !candidates.some((item) => item.taskStatus === 'failed')
                  }
                  onClick={() => {
                    setSelection(
                      candidates
                        .filter((item) => item.taskStatus === 'failed')
                        .slice(0, data?.batchLimit ?? 32)
                        .map((item) => item.snapshotId),
                    );
                  }}
                >
                  仅选失败任务
                </button>
              ) : null}
              <button
                className="text-action"
                disabled={busy}
                onClick={() => {
                  setSelection(
                    candidates
                      .slice(0, data?.batchLimit ?? 32)
                      .map((item) => item.snapshotId),
                  );
                }}
              >
                选择前 {Math.min(candidates.length, data?.batchLimit ?? 32)} 篇
              </button>
              <button
                className="text-action"
                disabled={busy}
                onClick={() => {
                  setSelection([]);
                }}
              >
                清空选择
              </button>
              <span>已选 {selection.length} 篇</span>
            </div>
            <ul className="document-queue-selection__list">
              {candidates.map((item) => (
                <li key={item.snapshotId}>
                  <label>
                    <input
                      type="checkbox"
                      checked={selection.includes(item.snapshotId)}
                      disabled={
                        busy ||
                        (!selection.includes(item.snapshotId) &&
                          selection.length >= (data?.batchLimit ?? 32))
                      }
                      onChange={(event) => {
                        setSelection((current) =>
                          event.target.checked
                            ? [...current, item.snapshotId]
                            : current.filter((id) => id !== item.snapshotId),
                        );
                      }}
                    />
                    <span className="document-queue-selection__copy">
                      <strong>
                        {sourceDisplayName({
                          sourceKey: item.title,
                          ...(item.canonicalUri
                            ? {canonicalUri: item.canonicalUri}
                            : {}),
                        })}
                      </strong>
                      {item.taskStatus || item.errorCode ? (
                        <small>
                          {item.taskStatus ? TASK_STATES[item.taskStatus] : ''}
                          {item.errorCode
                            ? ' · ' + aiError(new Error(item.errorCode))
                            : ''}
                        </small>
                      ) : null}
                    </span>
                  </label>
                </li>
              ))}
            </ul>
            <div className="ai-queue-controls">
              <button
                className={
                  action === 'cancel' ? 'danger-action' : 'primary-action'
                }
                disabled={busy || !selection.length || Boolean(error)}
                onClick={() => void submit()}
              >
                {busy
                  ? action === 'cancel'
                    ? '正在取消…'
                    : '正在加入队列…'
                  : action === 'cancel'
                    ? `确认取消所选（${String(selection.length)}）`
                    : `确认${LABELS[action]}（${String(selection.length)}）`}
              </button>
              <button
                className="text-action"
                disabled={busy}
                onClick={() => {
                  setAction(undefined);
                }}
              >
                返回队列
              </button>
            </div>
            {error ? (
              <p role="alert">
                {error}{' '}
                <button
                  className="text-action"
                  disabled={busy}
                  onClick={() => {
                    setAction(undefined);
                    setRefresh((value) => value + 1);
                  }}
                >
                  重新读取
                </button>
              </p>
            ) : null}
          </>
        ) : null}
      </dialog>
      {message ? <p role="status">{message}</p> : null}
      {error && !action ? (
        <p role="alert">
          {error}{' '}
          <button
            className="text-action"
            disabled={busy}
            onClick={() => {
              setRefresh((value) => value + 1);
            }}
          >
            重新读取
          </button>
        </p>
      ) : null}
      {data && (data.held > 0 || data.duplicates > 0) ? (
        <p className="ai-queue-updated">
          另有 {data.held} 篇待审、人工暂缓或需修正；跳过 {data.duplicates}{' '}
          份重复来源版本。
        </p>
      ) : null}
    </div>
  );
}
