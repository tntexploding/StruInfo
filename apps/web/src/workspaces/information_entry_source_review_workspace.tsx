import {useEffect, useRef, useState} from 'react';
import type {M1cApiClient} from '../api/m1c_api_client.js';
import type {
  InformationEntryGraphVerificationStatus,
  InformationEntrySourceReview,
  InformationEntrySourceReviewCursor,
  InformationEntrySourceReviewFilter,
  InformationEntrySourceReviewItem,
  InformationEntrySourceReviewListResponse,
  InformationEntrySourceReviewPrivacy,
} from '../api/m1c_api_contract.js';
import type {Loadable} from '../components/product_types.js';
import {
  InformationEntryReadOnlyDetail,
  type InformationEntryServices,
} from './information_entry_components.js';

type Page = Extract<InformationEntrySourceReviewListResponse, {status: 'ok'}>;
interface Services {
  readonly onList: M1cApiClient['listInformationEntrySourceReviews'];
  readonly onReview: M1cApiClient['reviewInformationEntryGraphSources'];
  readonly onOpenEvidence: InformationEntryServices['onOpenEvidence'];
  readonly onCloseEvidence: () => void;
  readonly onBack: () => void;
}
export function InformationEntrySourceReviewWorkspace({
  onList,
  onReview,
  onOpenEvidence,
  onCloseEvidence,
  onBack,
}: Services) {
  const [filter, setFilter] =
    useState<InformationEntrySourceReviewFilter>('pending');
  const [privacyScope, setPrivacyScope] =
    useState<InformationEntrySourceReviewPrivacy>('public');
  const [cursors, setCursors] = useState<
    readonly (Readonly<InformationEntrySourceReviewCursor> | undefined)[]
  >([undefined]);
  const [reload, setReload] = useState(0);
  const [view, setView] = useState<Loadable<Readonly<Page>>>({
    status: 'loading',
  });
  const [selectedKey, setSelectedKey] = useState('');
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState('');
  const generation = useRef(0);
  const after = cursors.at(-1);
  useEffect(() => {
    let active = true;
    const token = ++generation.current;
    const isCurrent = () => active && generation.current === token;
    async function read() {
      if (!isCurrent()) return;
      setView({status: 'loading'});
      try {
        const response = await onList({
          filter,
          privacyScope,
          limit: 20,
          ...(after === undefined ? {} : {after}),
        });
        if (!isCurrent()) return;
        if (response.body.status !== 'ok') {
          setView({status: 'error', message: '复核列表暂时无法读取，请重试。'});
          return;
        }
        const page = response.body;
        setView({status: 'ready', value: page});
        setSelectedKey((current) =>
          page.items.some((item) => pairKey(item) === current)
            ? current
            : page.items[0] === undefined
              ? ''
              : pairKey(page.items[0]),
        );
      } catch {
        if (isCurrent())
          setView({
            status: 'error',
            message: '本地接口不可达，请重试读取复核列表。',
          });
      }
    }
    globalThis.queueMicrotask(() => {
      void read();
    });
    return () => {
      active = false;
      generation.current += 1;
    };
  }, [after, filter, onList, privacyScope, reload]);
  const selected =
    view.status === 'ready'
      ? view.value.items.find((item) => pairKey(item) === selectedKey)
      : undefined;
  function resetScope(
    nextFilter: InformationEntrySourceReviewFilter,
    nextPrivacy: InformationEntrySourceReviewPrivacy,
  ) {
    generation.current += 1;
    onCloseEvidence();
    setSaving(false);
    setView({status: 'loading'});
    setSelectedKey('');
    setFeedback('');
    setFilter(nextFilter);
    setPrivacyScope(nextPrivacy);
    setCursors([undefined]);
  }
  async function save(
    item: Readonly<InformationEntrySourceReviewItem>,
    verificationStatus: InformationEntryGraphVerificationStatus,
    note: string,
  ) {
    if (saving || view.status !== 'ready') return;
    const token = ++generation.current;
    setSaving(true);
    setFeedback('');
    try {
      const response = await onReview(
        item.edge.entryLowId,
        item.edge.entryHighId,
        {
          expectedRevision: item.edge.overrideRevision,
          includePrivate: privacyScope !== 'public',
          expectedEntryRevisions: {
            entryLowRevision: item.entryLow.revision,
            entryHighRevision: item.entryHigh.revision,
          },
          verificationStatus,
          note,
        },
      );
      if (token !== generation.current) return;
      if (
        response.body.status !== 'applied' &&
        response.body.status !== 'unchanged'
      ) {
        setFeedback('关系或条目可能已变化，复核没有保存。请重新读取后核对。');
        return;
      }
      const index = view.value.items.findIndex(
        (row) => pairKey(row) === pairKey(item),
      );
      const next = view.value.items[index + 1];
      setSelectedKey(next === undefined ? '' : pairKey(next));
      if (next === undefined && view.value.nextCursor !== undefined) {
        setCursors((current) => [...current, view.value.nextCursor]);
      }
      setFeedback('复核已保存，可继续下一项。');
      onCloseEvidence();
      setReload((value) => value + 1);
    } catch {
      if (token === generation.current)
        setFeedback('保存结果尚未确认，请重新读取后检查。');
    } finally {
      if (token === generation.current) setSaving(false);
    }
  }
  function refresh() {
    onCloseEvidence();
    setReload((value) => value + 1);
  }
  return (
    <div
      className="workspace-view source-review-workspace"
      data-workflow-page="source-review"
    >
      <header className="workflow-page-heading">
        <div>
          <h1>来源复核</h1>
          <p>逐条回看关系两端的证据，记录核验状态与需要继续检查的问题。</p>
        </div>
        <button type="button" className="secondary-action" onClick={onBack}>
          返回图谱
        </button>
      </header>
      <div className="source-review-toolbar">
        <label className="field">
          <span>核验状态</span>
          <select
            value={filter}
            onChange={(event) => {
              resetScope(
                event.currentTarget.value as InformationEntrySourceReviewFilter,
                privacyScope,
              );
            }}
          >
            <option value="pending">待处理</option>
            <option value="unreviewed">尚未核对</option>
            <option value="needs_review">需要复核</option>
            <option value="source_checked">已核对当前版本</option>
            <option value="all">全部可见关系</option>
          </select>
        </label>
        <label className="field">
          <span>复核隐私范围</span>
          <select
            value={privacyScope}
            onChange={(event) => {
              resetScope(
                filter,
                event.currentTarget
                  .value as InformationEntrySourceReviewPrivacy,
              );
            }}
          >
            <option value="public">仅公开关系</option>
            <option value="include_private">包含隐私关系</option>
            <option value="private_only">仅两端均为隐私</option>
          </select>
        </label>
        <button
          type="button"
          className="secondary-action"
          disabled={saving}
          onClick={refresh}
        >
          重新读取
        </button>
        <p role="status">
          {view.status === 'ready'
            ? view.value.totalCount.toString() +
              ' 条关系 · 第 ' +
              cursors.length.toString() +
              ' 批'
            : view.status === 'loading'
              ? '正在读取…'
              : '读取失败'}
        </p>
      </div>
      {feedback === '' ? null : (
        <p className="source-review-feedback" role="status">
          {feedback}
        </p>
      )}
      {view.status === 'error' ? <p role="alert">{view.message}</p> : null}
      {view.status === 'loading' ? (
        <p role="status">正在读取当前关系与条目版本…</p>
      ) : null}
      {view.status !== 'ready' ? null : (
        <>
          {view.value.items.length === 0 ? (
            <section className="empty-state">
              <h2>当前范围没有符合条件的关系</h2>
              <p>可以切换核验状态，或重新读取当前数据。</p>
              {after === undefined ? null : (
                <button
                  type="button"
                  className="secondary-action"
                  onClick={() => {
                    setCursors([undefined]);
                  }}
                >
                  回到第一批
                </button>
              )}
            </section>
          ) : (
            <div className="source-review-layout">
              <nav className="source-review-list" aria-label="待复核关系">
                {view.value.items.map((item) => (
                  <button
                    type="button"
                    key={pairKey(item)}
                    aria-current={
                      pairKey(item) === selectedKey ? 'true' : undefined
                    }
                    disabled={saving}
                    onClick={() => {
                      onCloseEvidence();
                      setSelectedKey(pairKey(item));
                      setFeedback('');
                    }}
                  >
                    <strong>
                      {item.edge.label === 'similarity'
                        ? '相似联系'
                        : item.edge.label}
                    </strong>
                    <span>
                      {item.entryLow.value.titlePath || '未命名条目'}{' '}
                      {item.edge.direction === 'symmetric'
                        ? '↔'
                        : item.edge.direction === 'low_to_high'
                          ? '→'
                          : '←'}{' '}
                      {item.entryHigh.value.titlePath || '未命名条目'}
                    </span>
                    <span>
                      {reviewLabel(item.review)} ·{' '}
                      {originLabel(item.edge.origin)}
                    </span>
                  </button>
                ))}
              </nav>
              {selected === undefined ? null : (
                <ReviewEditor
                  key={
                    pairKey(selected) +
                    ':' +
                    selected.edge.overrideRevision.toString() +
                    ':' +
                    selected.entryLow.revision.toString() +
                    ':' +
                    selected.entryHigh.revision.toString()
                  }
                  item={selected}
                  saving={saving}
                  onOpenEvidence={onOpenEvidence}
                  onSave={(status, note) => save(selected, status, note)}
                />
              )}
            </div>
          )}
          <div className="source-review-pagination">
            <button
              type="button"
              className="secondary-action"
              disabled={saving || cursors.length === 1}
              onClick={() => {
                onCloseEvidence();
                setCursors((current) => current.slice(0, -1));
              }}
            >
              上一批
            </button>
            <button
              type="button"
              className="secondary-action"
              disabled={saving || view.value.nextCursor === undefined}
              onClick={() => {
                const next = view.value.nextCursor;
                if (next !== undefined) {
                  onCloseEvidence();
                  setCursors((current) => [...current, next]);
                }
              }}
            >
              下一批
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function ReviewEditor({
  item,
  saving,
  onOpenEvidence,
  onSave,
}: {
  readonly item: Readonly<InformationEntrySourceReviewItem>;
  readonly saving: boolean;
  readonly onOpenEvidence: InformationEntryServices['onOpenEvidence'];
  readonly onSave: (
    status: InformationEntryGraphVerificationStatus,
    note: string,
  ) => Promise<void>;
}) {
  const [status, setStatus] = useState(item.review.status);
  const [note, setNote] = useState(item.edge.note);
  const noteLength = Array.from(note).length;
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    heading.current?.focus({preventScroll: true});
  }, []);
  return (
    <section className="source-review-editor" aria-label="关系来源复核">
      <header>
        <h2 tabIndex={-1} ref={heading}>
          {item.edge.label === 'similarity' ? '相似联系' : item.edge.label}
        </h2>
        <p>
          {originLabel(item.edge.origin)} · {reviewLabel(item.review)}
        </p>
        <p>
          方向：
          {item.edge.direction === 'symmetric'
            ? '双向'
            : item.edge.direction === 'low_to_high'
              ? '左端指向右端'
              : '右端指向左端'}
        </p>
        <p>{reviewReason(item.review)}</p>
        {item.review.reviewedRevisions === undefined ? null : (
          <p>
            上次记录版本：左 {item.review.reviewedRevisions.entryLowRevision} /
            右 {item.review.reviewedRevisions.entryHighRevision}
          </p>
        )}
        <p>
          当前条目版本：左 {item.entryLow.revision} / 右{' '}
          {item.entryHigh.revision}
        </p>
      </header>
      <div className="source-review-evidence">
        {[item.entryLow, item.entryHigh].map((entry, index) => (
          <section
            key={entry.entryId}
            aria-label={index === 0 ? '左端条目' : '右端条目'}
          >
            <h3>{index === 0 ? '左端来源' : '右端来源'}</h3>
            <InformationEntryReadOnlyDetail
              entry={entry}
              variant="query"
              headingLevel={4}
              onOpenEvidence={onOpenEvidence}
            />
          </section>
        ))}
      </div>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (noteLength <= 500) void onSave(status, note);
        }}
      >
        <label className="field">
          <span>本次核验状态</span>
          <select
            value={status}
            disabled={saving}
            onChange={(event) => {
              setStatus(
                event.currentTarget
                  .value as InformationEntryGraphVerificationStatus,
              );
            }}
          >
            <option value="unreviewed">尚未核对来源</option>
            <option value="needs_review">需要继续复核</option>
            <option value="source_checked">已核对两端来源</option>
          </select>
        </label>
        <label className="field">
          <span>维护说明</span>
          <textarea
            rows={4}
            value={note}
            maxLength={1000}
            aria-invalid={noteLength > 500}
            aria-describedby="source-review-note-limit"
            disabled={saving}
            onChange={(event) => {
              setNote(event.currentTarget.value);
            }}
            placeholder="记录来源支持情况，或仍需核对的问题"
          />
        </label>
        <p id="source-review-note-limit">
          {noteLength} / 500 字符
          {noteLength > 500 ? '，请缩短说明后保存。' : ''}
        </p>
        <p>“已核对来源”记录本次两端条目的版本，不表示事实已经得到证明。</p>
        <button
          type="submit"
          className="primary-action"
          disabled={saving || noteLength > 500}
        >
          {saving ? '正在保存…' : '保存并继续'}
        </button>
      </form>
    </section>
  );
}
function pairKey(item: Readonly<InformationEntrySourceReviewItem>): string {
  return item.edge.entryLowId + ':' + item.edge.entryHighId;
}
function reviewLabel(review: Readonly<InformationEntrySourceReview>): string {
  return review.status === 'source_checked'
    ? '已核对当前版本'
    : review.status === 'needs_review'
      ? '需要复核'
      : '尚未核对';
}
function reviewReason(review: Readonly<InformationEntrySourceReview>): string {
  if (review.reason === 'entry_changed')
    return '条目版本已变化，请重新核对两端来源。';
  if (review.reason === 'unbound')
    return '已有来源核验记录尚未绑定条目版本，请重新复核。';
  if (review.reason === 'current') return '已记录对当前两端版本的来源核对。';
  if (review.reason === 'owner_requested')
    return '这条关系被标记为需要继续复核。';
  return '这条关系尚未记录来源核对。';
}
function originLabel(
  origin: InformationEntrySourceReviewItem['edge']['origin'],
): string {
  return origin === 'automatically_calculated'
    ? '自动计算'
    : origin === 'ai_assisted'
      ? 'AI 辅助'
      : origin === 'user_created'
        ? '用户创建'
        : '用户编辑';
}
