import {useEffect, useRef, useState} from 'react';
import type {SyntheticEvent} from 'react';

import {
  ENTRY_TYPE_KEYWORDS,
  type EntryTypeKeyword,
  type InformationEntry,
  type InformationEntryTypeReviewCursor,
  type InformationEntryTypeReviewFilter,
  type InformationEntryTypeReviewResponse,
} from '../api/m1c_api_contract.js';
import {ActionNotice} from '../components/action_notice.js';
import type {ActionFeedback, Loadable} from '../components/product_types.js';
import type {InformationEntryServices} from './information_entry_components.js';
import {
  TYPE_LABELS,
  describeInformationEntryFailure,
} from './information_entry_shared.js';

type TypeReviewView = Loadable<Readonly<InformationEntryTypeReviewResponse>>;
type SettledTypeReviewView = Exclude<
  TypeReviewView,
  Readonly<{status: 'loading'}>
>;

const LOADING_TYPE_REVIEW_VIEW = {status: 'loading'} as const;

export function InformationEntryTypeReviewPanel({
  onOpenEvidence,
  onReviewTypes,
  onRevise,
}: {
  readonly onOpenEvidence: InformationEntryServices['onOpenEvidence'];
  readonly onReviewTypes: InformationEntryServices['onReviewTypes'];
  readonly onRevise: InformationEntryServices['onRevise'];
}) {
  const [filter, setFilter] =
    useState<InformationEntryTypeReviewFilter>('missing');
  const [includePrivate, setIncludePrivate] = useState(false);
  const [after, setAfter] = useState<
    Readonly<InformationEntryTypeReviewCursor> | undefined
  >();
  const [history, setHistory] = useState<
    readonly (Readonly<InformationEntryTypeReviewCursor> | undefined)[]
  >([]);
  const [refreshVersion, setRefreshVersion] = useState(0);
  const [settledView, setSettledView] =
    useState<Readonly<{requestKey: string; view: SettledTypeReviewView}>>();
  const [selectedEntryId, setSelectedEntryId] = useState<string>();
  const requestGeneration = useRef(0);
  const requestKey = JSON.stringify([
    filter,
    includePrivate,
    after?.capturedAt ?? null,
    after?.snapshotId ?? null,
    after?.documentOrder ?? null,
    after?.entryId ?? null,
    refreshVersion,
  ]);
  const view: TypeReviewView =
    settledView?.requestKey === requestKey
      ? settledView.view
      : LOADING_TYPE_REVIEW_VIEW;

  useEffect(() => {
    const generation = requestGeneration.current + 1;
    requestGeneration.current = generation;
    const abortController = new AbortController();
    void onReviewTypes(
      {
        includePrivate,
        filter,
        limit: 20,
        ...(after === undefined ? {} : {after}),
      },
      abortController.signal,
    )
      .then((response) => {
        if (
          abortController.signal.aborted ||
          requestGeneration.current !== generation
        ) {
          return;
        }
        if (response.statusCode !== 200) {
          setSettledView({
            requestKey,
            view: {
              status: 'error',
              message: '类型覆盖状态暂时无法读取。',
            },
          });
          return;
        }
        setSettledView({
          requestKey,
          view: {status: 'ready', value: response.body},
        });
      })
      .catch(() => {
        if (
          !abortController.signal.aborted &&
          requestGeneration.current === generation
        ) {
          setSettledView({
            requestKey,
            view: {
              status: 'error',
              message: '本地接口不可达，类型状态没有改变。',
            },
          });
        }
      });
    return () => {
      abortController.abort();
    };
  }, [after, filter, includePrivate, onReviewTypes, requestKey]);

  const items = view.status === 'ready' ? view.value.items : [];
  const selectedEntry =
    items.find((entry) => entry.entryId === selectedEntryId) ?? items[0];

  function resetPage(nextFilter: InformationEntryTypeReviewFilter) {
    setFilter(nextFilter);
    setAfter(undefined);
    setHistory([]);
    setSelectedEntryId(undefined);
  }

  return (
    <section
      className="type-review-workbench"
      aria-labelledby="type-review-title"
    >
      <header className="console-heading type-review-workbench__heading">
        <div>
          <h2 id="type-review-title">类型覆盖与快速纠错</h2>
          <p>这里只修改类型，其他内容不会改变。</p>
        </div>
        <button
          className="secondary-action"
          type="button"
          onClick={() => {
            setRefreshVersion((current) => current + 1);
          }}
        >
          刷新统计
        </button>
      </header>

      {view.status === 'ready' ? (
        <TypeCoverageSummary response={view.value} />
      ) : null}

      <div className="type-review-workbench__controls">
        <label className="field">
          <span>纠错队列</span>
          <select
            value={filter}
            onChange={(event) => {
              resetPage(
                event.currentTarget.value as InformationEntryTypeReviewFilter,
              );
            }}
          >
            <option value="missing">未分类（优先处理）</option>
            {ENTRY_TYPE_KEYWORDS.map((typeKeyword) => (
              <option key={typeKeyword} value={typeKeyword}>
                已标为：{TYPE_LABELS[typeKeyword]}
              </option>
            ))}
          </select>
        </label>
        <label className="privacy-query-toggle">
          <input
            type="checkbox"
            checked={includePrivate}
            onChange={(event) => {
              setIncludePrivate(event.currentTarget.checked);
              setAfter(undefined);
              setHistory([]);
              setSelectedEntryId(undefined);
            }}
          />
          包含隐私条目
        </label>
      </div>

      {view.status === 'loading' ? (
        <p className="empty-state">正在读取类型覆盖率与当前队列…</p>
      ) : view.status === 'error' ? (
        <div className="empty-state">
          <p>{view.message}</p>
          <button
            className="secondary-action"
            type="button"
            onClick={() => {
              setRefreshVersion((current) => current + 1);
            }}
          >
            重试
          </button>
        </div>
      ) : view.status === 'ready' && view.value.items.length === 0 ? (
        <p className="empty-state">
          {filter === 'missing'
            ? '当前隐私范围内已经没有缺失类型的条目。'
            : '当前隐私范围内没有这一类型的条目。'}
        </p>
      ) : selectedEntry === undefined ? null : (
        <div className="type-review-workbench__body">
          <nav
            className="type-review-workbench__queue"
            aria-label="类型纠错条目"
          >
            {items.map((entry, index) => (
              <button
                className={
                  entry.entryId === selectedEntry.entryId
                    ? 'type-review-queue-item type-review-queue-item--active'
                    : 'type-review-queue-item'
                }
                aria-current={
                  entry.entryId === selectedEntry.entryId ? 'true' : undefined
                }
                key={entry.entryId}
                type="button"
                onClick={() => {
                  setSelectedEntryId(entry.entryId);
                }}
              >
                <span>{(index + 1).toString().padStart(2, '0')}</span>
                <strong>{entry.value.titlePath || '未命名条目'}</strong>
                <small>
                  {entry.value.typeKeyword === undefined
                    ? '尚未分类'
                    : TYPE_LABELS[entry.value.typeKeyword]}
                </small>
              </button>
            ))}
          </nav>
          <TypeCorrectionEditor
            key={`${selectedEntry.entryId}:${selectedEntry.revision.toString()}`}
            entry={selectedEntry}
            includePrivate={includePrivate}
            onOpenEvidence={onOpenEvidence}
            onRevise={onRevise}
            onSaved={() => {
              const currentIndex = items.findIndex(
                (entry) => entry.entryId === selectedEntry.entryId,
              );
              setSelectedEntryId(items[currentIndex + 1]?.entryId);
              setRefreshVersion((current) => current + 1);
            }}
          />
        </div>
      )}

      {view.status === 'ready' ? (
        <footer className="type-review-workbench__pagination">
          <button
            className="secondary-action"
            type="button"
            disabled={history.length === 0}
            onClick={() => {
              const previous = history.at(-1);
              setHistory((current) => current.slice(0, -1));
              setAfter(previous);
              setSelectedEntryId(undefined);
            }}
          >
            上一页
          </button>
          <span>每页最多 20 条</span>
          <button
            className="secondary-action"
            type="button"
            disabled={view.value.nextCursor === undefined}
            onClick={() => {
              if (view.value.nextCursor === undefined) return;
              setHistory((current) => Object.freeze([...current, after]));
              setAfter(view.value.nextCursor);
              setSelectedEntryId(undefined);
            }}
          >
            下一页
          </button>
        </footer>
      ) : null}
    </section>
  );
}

function TypeCoverageSummary({
  response,
}: {
  readonly response: Readonly<InformationEntryTypeReviewResponse>;
}) {
  const {coverage} = response;
  const percentage =
    coverage.totalCount === 0
      ? 100
      : Math.round((coverage.classifiedCount / coverage.totalCount) * 100);
  return (
    <div className="type-coverage-summary">
      <div>
        <span>类型覆盖率</span>
        <strong>{percentage.toString()}%</strong>
        <small>
          {coverage.classifiedCount.toLocaleString()} /{' '}
          {coverage.totalCount.toLocaleString()}
        </small>
      </div>
      <div className="type-coverage-summary__missing">
        <span>待补类型</span>
        <strong>{coverage.missingCount.toLocaleString()}</strong>
        <small>保存后立即退出未分类队列</small>
      </div>
      <ul aria-label="各类型数量">
        {coverage.byType.map(({typeKeyword, count}) => (
          <li key={typeKeyword}>
            <span>{TYPE_LABELS[typeKeyword]}</span>
            <strong>{count.toLocaleString()}</strong>
          </li>
        ))}
      </ul>
    </div>
  );
}

function TypeCorrectionEditor({
  entry,
  includePrivate,
  onOpenEvidence,
  onRevise,
  onSaved,
}: {
  readonly entry: Readonly<InformationEntry>;
  readonly includePrivate: boolean;
  readonly onOpenEvidence: InformationEntryServices['onOpenEvidence'];
  readonly onRevise: InformationEntryServices['onRevise'];
  readonly onSaved: () => void;
}) {
  const [typeKeyword, setTypeKeyword] = useState<EntryTypeKeyword>(
    entry.value.typeKeyword ?? 'factual_material',
  );
  const [typeCustomName, setTypeCustomName] = useState(
    entry.value.typeCustomName ?? '',
  );
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<ActionFeedback>();

  async function save(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;
    if (typeKeyword === 'other' && typeCustomName.trim() === '') {
      setFeedback({
        kind: 'error',
        title: '请填写自定义类型',
        detail: '“其他”必须附带一个便于以后识别的名称。',
      });
      return;
    }
    setSaving(true);
    setFeedback(undefined);
    try {
      const response = await onRevise(entry.entryId, {
        expectedRevision: entry.revision,
        includePrivate,
        annotation: {
          body: entry.value.body,
          contentKeywords: entry.value.contentKeywords.map(
            (keyword) => keyword.displayValue,
          ),
          typeKeyword,
          ...(typeKeyword === 'other'
            ? {typeCustomName: typeCustomName.trim()}
            : {}),
          ...(entry.value.usefulnessScore === undefined
            ? {}
            : {usefulnessScore: entry.value.usefulnessScore}),
          ...(entry.value.interestScore === undefined
            ? {}
            : {interestScore: entry.value.interestScore}),
          domains: entry.value.domains.map((domain) => ({
            keyword: domain.keyword,
            ...(domain.customName === undefined
              ? {}
              : {customName: domain.customName}),
          })),
        },
      });
      if (
        response.body.status !== 'applied' &&
        response.body.status !== 'unchanged'
      ) {
        setFeedback({
          kind: 'error',
          title: '类型没有保存',
          detail: describeInformationEntryFailure(response.body),
        });
        return;
      }
      setFeedback({
        kind: 'success',
        title: response.body.status === 'applied' ? '类型已保存' : '类型未变化',
        detail: '其他标注与原始来源均保持不变。',
      });
      onSaved();
    } catch {
      setFeedback({
        kind: 'error',
        title: '本地接口不可达',
        detail: '当前条目没有发生变化。',
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <article className="type-correction-editor">
      <header>
        <div>
          <h3>{entry.value.titlePath || '未命名条目'}</h3>
          <small>{entry.sourceKey}</small>
        </div>
        <button
          className="secondary-action"
          type="button"
          onClick={() => {
            onOpenEvidence(
              entry.snapshotId,
              entry.value.fragmentIds[0],
              entry.value.isPrivate,
            );
          }}
        >
          查看来源
        </button>
      </header>
      <div className="type-correction-editor__body">{entry.value.body}</div>
      <form onSubmit={(event) => void save(event)}>
        <fieldset>
          <legend>选择最能描述这条内容用途的类型</legend>
          <div className="type-correction-editor__choices">
            {ENTRY_TYPE_KEYWORDS.map((keyword) => (
              <label key={keyword}>
                <input
                  type="radio"
                  name={`type-${entry.entryId}`}
                  value={keyword}
                  checked={typeKeyword === keyword}
                  onChange={() => {
                    setTypeKeyword(keyword);
                  }}
                />
                <span>{TYPE_LABELS[keyword]}</span>
              </label>
            ))}
          </div>
        </fieldset>
        {typeKeyword === 'other' ? (
          <label className="field">
            <span>自定义类型名称</span>
            <input
              value={typeCustomName}
              onChange={(event) => {
                setTypeCustomName(event.currentTarget.value);
              }}
              maxLength={80}
              required
            />
          </label>
        ) : null}
        <ActionNotice feedback={feedback} />
        <div className="entry-command-actions">
          <button className="primary-action" type="submit" disabled={saving}>
            {saving ? '正在保存…' : '保存类型并继续'}
          </button>
        </div>
      </form>
    </article>
  );
}
