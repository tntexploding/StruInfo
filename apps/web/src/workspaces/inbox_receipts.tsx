import {
  intakeReviewKind,
  intakeReviewHint,
  inboxReceiptPresentation,
  type InboxReviewTarget,
} from './inbox_review_state.js';
import {useInboxPreviews} from './use_inbox_previews.js';
import {InboxDocumentPreview} from './inbox_document_preview.js';
import {useRememberedDisclosure} from '../components/use_remembered_disclosure.js';
import {useInboxAiReview} from './use_inbox_ai_review.js';
import {useRef, useState} from 'react';
import {
  aiWorkflowCommand,
  aiError,
  type IntakeRecord,
} from '../api/ai_workflow_client.js';
import type {EvidenceSnapshotSummary} from '../api/m1c_api_contract.js';
import type {Loadable} from '../components/product_types.js';
import {sourceDisplayName} from '../components/reading_text.js';

type ReceiptAction = 'accept' | 'reject' | 'reset';
type ReceiptTarget =
  'selected' | 'all' | {snapshotId: string; expectedVersion: number};
const labels = {pending: '待接受', accepted: '已接受', rejected: '已拒绝'};

export function InboxReceipts({
  reviewTarget,
  snapshots,
  records,
  ready,
  error,
  showPrivate,
  onReload,
  onChanged,
  onRead,
  onOpenDocument,
  onReview,
}: {
  readonly reviewTarget?: InboxReviewTarget | undefined;
  readonly snapshots: Loadable<readonly Readonly<EvidenceSnapshotSummary>[]>;
  readonly records: readonly IntakeRecord[];
  readonly ready: boolean;
  readonly error: string;
  readonly showPrivate: boolean;
  readonly onReload: () => void;
  readonly onChanged: (records: IntakeRecord[]) => Promise<void>;
  readonly onRead: (
    id: string,
    target: HTMLElement,
    includePrivate?: boolean,
  ) => void;
  readonly onOpenDocument?:
    ((id: string, includePrivate: boolean) => void) | undefined;
  readonly onReview: (snapshot: EvidenceSnapshotSummary) => void;
}) {
  const [filter, setFilter] = useState(
    reviewTarget?.snapshotId ? 'all' : reviewTarget ? 'review' : 'pending',
  );
  const [focusedSnapshotId, setFocusedSnapshotId] = useState(
    reviewTarget?.snapshotId,
  );
  const [query, setQuery] = useState('');
  const [summaryEnabled, setSummaryEnabled] =
    useRememberedDisclosure('inbox-ai-summary');
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState<ReadonlyMap<string, number>>(
    new Map(),
  );
  const [busy, setBusy] = useState(false);
  const running = useRef(false);
  const [message, setMessage] = useState('');
  const byId = new Map(records.map((record) => [record.snapshotId, record]));
  const prepared = new Set(
    records.flatMap((record) => [
      ...(record.value.preparedSnapshotId
        ? [record.value.preparedSnapshotId]
        : []),
      ...(record.value.previousPreparedSnapshotIds ?? []),
    ]),
  );
  const visible =
    snapshots.status === 'ready'
      ? snapshots.value.filter(
          (s) => (!s.isPrivate || showPrivate) && !prepared.has(s.snapshotId),
        )
      : [];
  const filtered = visible.filter((snapshot) => {
    const record = byId.get(snapshot.snapshotId);
    const receipt = record?.value.receipt ?? 'accepted';
    return (
      (!focusedSnapshotId ||
        snapshot.snapshotId === focusedSnapshotId ||
        record?.value.preparedSnapshotId === focusedSnapshotId ||
        record?.value.previousPreparedSnapshotIds?.includes(
          focusedSnapshotId,
        )) &&
      (filter === 'all' ||
        (filter === 'review'
          ? Boolean(intakeReviewKind(record))
          : receipt === filter)) &&
      [
        sourceDisplayName(snapshot),
        snapshot.sourceKey,
        snapshot.canonicalUri ?? '',
      ].some((s) => s.toLowerCase().includes(query.trim().toLowerCase()))
    );
  });
  const pending = filtered.filter(
    (s) => byId.get(s.snapshotId)?.value.receipt === 'pending',
  );
  const pages = Math.max(1, Math.ceil(filtered.length / 20));
  const currentPage = Math.min(page, pages - 1);
  const current = filtered.slice(currentPage * 20, currentPage * 20 + 20);
  const preview = useInboxPreviews(
    current.map((s) => s.snapshotId),
    showPrivate,
    summaryEnabled,
  );
  const summaryItems = filtered
    .filter((s) => selected.has(s.snapshotId) && !s.isPrivate)
    .map((s) => s.snapshotId);
  const selectable = current.filter(
    (s) => !s.isPrivate && byId.get(s.snapshotId)?.value.receipt,
  );
  const selectedItems = filtered.filter(
    (s) => selected.has(s.snapshotId) && byId.get(s.snapshotId)?.value.receipt,
  );
  const ai = useInboxAiReview(
    current.map((s) => s.snapshotId),
    () => {
      void onChanged([]);
    },
  );
  const aiItems = selectedItems
    .filter((s) => byId.get(s.snapshotId)?.value.receipt === 'pending')
    .flatMap((s) => {
      const version = selected.get(s.snapshotId);
      return version === undefined
        ? []
        : [{snapshotId: s.snapshotId, expectedVersion: version}];
    });
  const canAct = ready && !error && !busy && !ai.busy;
  const changedFilter = () => {
    setFocusedSnapshotId(undefined);
    setSelected(new Map());
    setPage(0);
    setMessage('');
  };
  function select(id: string, checked: boolean) {
    const record = byId.get(id);
    if (!record) return;
    setSelected((previous) => {
      const next = new Map(previous);
      if (checked) next.set(id, record.version);
      else next.delete(id);
      return next;
    });
  }
  async function decide(
    action: ReceiptAction,
    target: ReceiptTarget = 'selected',
  ) {
    if (running.current || !canAct) return;
    const items =
      typeof target === 'object'
        ? [target]
        : (target === 'all' ? pending : selectedItems).flatMap((s) => {
            const expectedVersion =
              target === 'all'
                ? byId.get(s.snapshotId)?.version
                : selected.get(s.snapshotId);
            return expectedVersion === undefined
              ? []
              : [{snapshotId: s.snapshotId, expectedVersion}];
          });
    if (!items.length) return;
    running.current = true;
    setBusy(true);
    setMessage('');
    const saved: IntakeRecord[] = [];
    const failed: {snapshotId: string; code: string}[] = [];
    try {
      for (let start = 0; start < items.length; start += 100) {
        const result = await aiWorkflowCommand<{
          records: IntakeRecord[];
          failed: {snapshotId: string; code: string}[];
        }>('intake_receive', {
          action,
          items: items.slice(start, start + 100),
          processAccepted: action === 'accept',
        });
        saved.push(...result.records);
        failed.push(...result.failed);
      }
      const verb = {accept: '接受', reject: '拒绝', reset: '恢复为待接受'}[
        action
      ];
      setMessage(
        '已' +
          verb +
          ' ' +
          saved.length.toString() +
          ' 份。' +
          (failed.length
            ? failed.length.toString() +
              ' 份未完成：' +
              aiError(new Error(failed[0]?.code))
            : action === 'accept'
              ? saved.some(
                  (record) =>
                    record.value.decision === 'held' ||
                    record.value.decision === 'blocked',
                )
                ? '已加入资料库；仍暂缓或拦截的资料请先核对原因，再决定是否放行整理。'
                : '可到资料库继续阅读与整理。'
              : '原文保留，可随时重新选择。'),
      );
    } catch (cause) {
      setMessage(
        (saved.length
          ? '已保存 ' + saved.length.toString() + ' 份决定。'
          : '') +
          aiError(cause) +
          ' 请刷新核对后重试。',
      );
    } finally {
      setSelected((previous) => {
        if (typeof target !== 'object') return new Map();
        const next = new Map(previous);
        next.delete(target.snapshotId);
        return next;
      });
      await onChanged(saved);
      running.current = false;
      setBusy(false);
    }
  }
  if (snapshots.status === 'loading' || (!ready && !error))
    return <p role="status">正在读取收件箱…</p>;
  if (snapshots.status === 'error')
    return <p role="alert">{snapshots.message}</p>;
  return (
    <>
      {focusedSnapshotId ? (
        <div className="inbox-review-context" role="status">
          <span>正在查看 AI 提醒对应的资料。</span>
          <button
            type="button"
            className="text-action"
            disabled={busy}
            onClick={() => {
              setFilter('review');
              changedFilter();
            }}
          >
            查看全部待核对
          </button>
        </div>
      ) : filter === 'review' ? (
        <p className="inbox-review-context">
          琥珀色资料需要人工核对。待接受的资料可选择接受或拒绝；已接收资料可在“核对原因”中决定是否继续整理。
        </p>
      ) : null}
      <div className="inbox-receipt-filters">
        <label className="field">
          <span>接收状态</span>
          <select
            value={filter}
            disabled={busy}
            onChange={(e) => {
              setFilter(e.currentTarget.value);
              changedFilter();
            }}
          >
            <option value="review">
              需人工核对 ·{' '}
              {
                visible.filter((s) => intakeReviewKind(byId.get(s.snapshotId)))
                  .length
              }
            </option>
            {Object.entries(labels).map(([value, label]) => (
              <option key={value} value={value}>
                {label} ·{' '}
                {
                  visible.filter(
                    (s) =>
                      (byId.get(s.snapshotId)?.value.receipt ?? 'accepted') ===
                      value,
                  ).length
                }
              </option>
            ))}
            <option value="all">全部记录</option>
          </select>
        </label>
        <label className="field">
          <span>筛选资料</span>
          <input
            type="search"
            value={query}
            disabled={busy}
            placeholder="来源名称或地址"
            onChange={(e) => {
              setQuery(e.currentTarget.value);
              changedFilter();
            }}
          />
        </label>
      </div>
      <div
        className="inbox-receipt-actions"
        role="group"
        aria-label="批量接收决定"
        aria-busy={busy}
      >
        <label>
          <input
            type="checkbox"
            aria-label="选择本页资料"
            disabled={!canAct || !selectable.length}
            checked={
              selectable.length > 0 &&
              selectable.every((s) => selected.has(s.snapshotId))
            }
            onChange={(e) => {
              for (const s of selectable)
                select(s.snapshotId, e.currentTarget.checked);
            }}
          />
          全选本页
        </label>
        <span>已选 {selectedItems.length} 份</span>
        <button
          type="button"
          className="primary-action"
          disabled={!canAct || !pending.length}
          onClick={() => {
            void decide('accept', 'all');
          }}
        >
          全部接受（{pending.length}）
        </button>
        <button
          type="button"
          className="secondary-action"
          disabled={!canAct || !selectedItems.length}
          onClick={() => {
            void decide('accept');
          }}
        >
          接受所选
        </button>
        <button
          type="button"
          className="secondary-action"
          disabled={
            !canAct || !ai.ready || !ai.modelConfigured || !aiItems.length
          }
          onClick={() => {
            void ai.start(aiItems).then((started) => {
              if (started) setSelected(new Map());
            });
          }}
        >
          AI 审核所选
        </button>
        {filter === 'rejected' ? (
          <button
            type="button"
            className="secondary-action"
            disabled={!canAct || !selectedItems.length}
            onClick={() => {
              void decide('reset');
            }}
          >
            恢复待接受
          </button>
        ) : (
          <button
            type="button"
            className="secondary-action"
            disabled={!canAct || !selectedItems.length}
            onClick={() => {
              void decide('reject');
            }}
          >
            拒绝所选
          </button>
        )}
      </div>
      <div className="inbox-summary-controls">
        <label>
          <input
            type="checkbox"
            checked={summaryEnabled}
            onChange={(event) => {
              setSummaryEnabled(event.currentTarget.checked);
            }}
          />
          AI 简短摘要
        </label>
        {summaryEnabled ? (
          <>
            <button
              type="button"
              className="secondary-action"
              disabled={
                preview.busy || !ai.modelConfigured || !summaryItems.length
              }
              onClick={() => {
                void preview.summarize(summaryItems);
              }}
            >
              生成所选摘要
            </button>
            <span>
              按需生成，每篇最多一次调用；已有摘要直接复用。遵守 AI
              许可与价格时段。
            </span>
          </>
        ) : (
          <span>
            开启后，可为单篇或勾选的文章生成摘要。接收与整理需另行操作。
          </span>
        )}
        {preview.errors.size ? (
          <button
            type="button"
            className="text-action"
            onClick={() => {
              void preview.load();
            }}
          >
            重读来源与预览
          </button>
        ) : null}
      </div>
      {preview.message ? (
        <p className="inbox-receipt-help" role="status">
          {preview.message}
        </p>
      ) : null}
      <p className="inbox-receipt-help">
        全部接受包含当前筛选下的待接受资料，跨页生效。接受不启用
        AI；拒绝后可恢复。
      </p>
      <p className="inbox-receipt-help">
        AI
        按已保存的接收规则审核，遵守价格时段；通过后继续拆分、标签、联系，完成后入库。
        {ai.ready && !ai.modelConfigured ? '模型尚未配置。' : ''}
      </p>
      {ai.message ? <p role="status">{ai.message}</p> : null}
      {error ? (
        <p role="alert">
          {error}{' '}
          <button type="button" className="text-action" onClick={onReload}>
            重新读取收件状态
          </button>
        </p>
      ) : null}
      <p className="record-list-range" role="status">
        {busy
          ? '正在保存接收决定…'
          : message ||
            (filtered.length
              ? '共 ' + filtered.length.toString() + ' 份'
              : filter === 'pending'
                ? '没有待接受的新资料。新的订阅内容会先出现在这里。'
                : '没有符合条件的资料。')}
      </p>
      <ol
        className="record-list inbox-receipt-list"
        aria-label="本页文档"
        tabIndex={0}
        key={filter + ':' + currentPage.toString()}
      >
        {current.map((snapshot) => {
          const record = byId.get(snapshot.snapshotId);
          const receipt = record?.value.receipt;
          const reviewKind = intakeReviewKind(record);
          const reviewTask = ai.tasks.find(
            (t) => t.request.snapshotId === snapshot.snapshotId,
          );
          const presentation = inboxReceiptPresentation(
            record,
            reviewTask,
            ai.ready,
          );
          return (
            <li
              key={snapshot.snapshotId}
              data-active={selected.has(snapshot.snapshotId)}
              data-review={Boolean(reviewKind)}
              data-tone={presentation.tone}
            >
              <input
                type="checkbox"
                aria-label={
                  '选择 ' +
                  (preview.previews.get(snapshot.snapshotId)?.title ??
                    sourceDisplayName(snapshot))
                }
                checked={selected.has(snapshot.snapshotId)}
                disabled={!canAct || !receipt || snapshot.isPrivate}
                onChange={(e) => {
                  select(snapshot.snapshotId, e.currentTarget.checked);
                }}
              />
              <div className="record-list__main">
                <span className="inbox-review-badge">{presentation.label}</span>
                <InboxDocumentPreview
                  snapshot={snapshot}
                  preview={preview.previews.get(snapshot.snapshotId)}
                  showSummary={summaryEnabled}
                  loading={preview.loading}
                  error={preview.errors.get(snapshot.snapshotId)}
                  summaryError={preview.summaryErrors.get(snapshot.snapshotId)}
                />

                <p className="inbox-receipt-reason">
                  <strong>{presentation.reasonLabel}：</strong>
                  {presentation.reason}
                </p>
                {reviewKind && record ? (
                  <p className="inbox-receipt-help">
                    {intakeReviewHint(record)}
                  </p>
                ) : null}
              </div>
              <div className="record-list-actions">
                <div
                  className="inbox-receipt-main-actions"
                  role="group"
                  aria-label="本篇接收决定"
                >
                  {record && receipt === 'pending' && !snapshot.isPrivate ? (
                    <>
                      <button
                        type="button"
                        className="secondary-action inbox-receipt-accept"
                        disabled={!canAct}
                        onClick={() => {
                          void decide('accept', {
                            snapshotId: snapshot.snapshotId,
                            expectedVersion: record.version,
                          });
                        }}
                      >
                        <span aria-hidden="true">✓</span> 接受
                      </button>
                      <button
                        type="button"
                        className="secondary-action inbox-receipt-reject"
                        disabled={!canAct}
                        onClick={() => {
                          void decide('reject', {
                            snapshotId: snapshot.snapshotId,
                            expectedVersion: record.version,
                          });
                        }}
                      >
                        <span aria-hidden="true">×</span> 拒绝
                      </button>
                    </>
                  ) : null}
                  {record && receipt === 'rejected' && !snapshot.isPrivate ? (
                    <button
                      type="button"
                      className="secondary-action inbox-receipt-accept"
                      disabled={!canAct}
                      onClick={() => {
                        void decide('reset', {
                          snapshotId: snapshot.snapshotId,
                          expectedVersion: record.version,
                        });
                      }}
                    >
                      恢复待接受
                    </button>
                  ) : null}
                  <button
                    type="button"
                    className="secondary-action"
                    onClick={(event) => {
                      onRead(
                        snapshot.snapshotId,
                        event.currentTarget,
                        snapshot.isPrivate === true,
                      );
                    }}
                  >
                    查看原文
                  </button>
                </div>
                <div className="inbox-receipt-more-actions">
                  {summaryEnabled && !snapshot.isPrivate ? (
                    <button
                      type="button"
                      className="secondary-action inbox-summary-action"
                      disabled={
                        preview.busy ||
                        !ai.modelConfigured ||
                        Boolean(
                          preview.previews.get(snapshot.snapshotId)?.summary,
                        )
                      }
                      onClick={() => {
                        void preview.summarize([snapshot.snapshotId]);
                      }}
                    >
                      {preview.activeId === snapshot.snapshotId
                        ? '正在生成摘要…'
                        : preview.previews.get(snapshot.snapshotId)?.summary
                          ? '摘要已生成'
                          : '生成 AI 摘要'}
                    </button>
                  ) : null}
                  {receipt === 'accepted' || !receipt ? (
                    <button
                      type="button"
                      className="text-action"
                      onClick={() => {
                        onOpenDocument?.(
                          snapshot.snapshotId,
                          snapshot.isPrivate === true,
                        );
                      }}
                    >
                      在资料库整理
                    </button>
                  ) : null}
                  {!snapshot.isPrivate ? (
                    <button
                      type="button"
                      className="text-action"
                      onClick={() => {
                        onReview(snapshot);
                      }}
                    >
                      {reviewKind ? '核对原因' : '接收审核'}
                    </button>
                  ) : null}
                </div>
              </div>
            </li>
          );
        })}
      </ol>
      <div className="record-list-pagination" aria-label="文档列表分页">
        <button
          type="button"
          className="secondary-action"
          disabled={busy || currentPage === 0}
          onClick={() => {
            setPage(currentPage - 1);
          }}
        >
          上一页
        </button>
        <select
          aria-label="文档列表页码"
          value={currentPage}
          disabled={busy}
          onChange={(event) => {
            setPage(Number(event.currentTarget.value));
          }}
        >
          {Array.from({length: pages}, (_, index) => (
            <option key={index} value={index}>
              第 {index + 1} / {pages} 页
            </option>
          ))}
        </select>
        <button
          type="button"
          className="secondary-action"
          disabled={busy || currentPage + 1 >= pages}
          onClick={() => {
            setPage(currentPage + 1);
          }}
        >
          下一页
        </button>
      </div>
    </>
  );
}
