import {useCallback, useEffect, useMemo, useRef, useState} from 'react';

import type {
  EvidenceSnapshot,
  InformationEntryManualMaterializeRequest,
  InformationEntryMaterializeResponse,
  M1cHttpResponse,
} from '../api/m1c_api_contract.js';
import {ActionNotice} from '../components/action_notice.js';
import type {ActionFeedback} from '../components/product_types.js';
import {
  createManualSplitDraft,
  mergeManualSplitGroups,
  splitManualSplitGroup,
  type ManualSplitDraftGroup,
} from './information_entry_manual_split_model.js';

type EvidenceSnapshotReadResponse =
  | Readonly<{status: 'ok'; snapshot: Readonly<EvidenceSnapshot>}>
  | Readonly<{status: 'not_found'}>
  | Readonly<{status: 'rejected'; issue: Readonly<{code: string}>}>;

export interface InformationEntryManualSplitProps {
  readonly snapshotId: string;
  readonly isPrivate: boolean;
  readonly includePrivate: boolean;
  readonly alreadyMaterialized: boolean;
  readonly onLoadSnapshot: (
    snapshotId: string,
    includePrivate?: boolean,
  ) => Promise<M1cHttpResponse<EvidenceSnapshotReadResponse>>;
  readonly onMaterialize: (
    body: Readonly<InformationEntryManualMaterializeRequest>,
  ) => Promise<M1cHttpResponse<InformationEntryMaterializeResponse>>;
  readonly onCommitted: () => Promise<void>;
}

export function InformationEntryManualSplit({
  alreadyMaterialized,
  includePrivate,
  isPrivate,
  onCommitted,
  onLoadSnapshot,
  onMaterialize,
  snapshotId,
}: InformationEntryManualSplitProps) {
  const [snapshot, setSnapshot] = useState<Readonly<EvidenceSnapshot>>();
  const [groups, setGroups] = useState<
    readonly Readonly<ManualSplitDraftGroup>[]
  >([]);
  const [status, setStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>(
    'idle',
  );
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<ActionFeedback>();
  const requestGeneration = useRef(0);

  const loadDraft = useCallback(async () => {
    const generation = ++requestGeneration.current;
    setFeedback(undefined);
    if (
      snapshotId === '' ||
      alreadyMaterialized ||
      (isPrivate && !includePrivate)
    ) {
      setSnapshot(undefined);
      setGroups([]);
      setStatus('idle');
      return;
    }
    setStatus('loading');
    try {
      const response = await onLoadSnapshot(snapshotId, includePrivate);
      if (generation !== requestGeneration.current) return;
      if (response.body.status !== 'ok') {
        setSnapshot(undefined);
        setGroups([]);
        setStatus('error');
        return;
      }
      const nextGroups = createManualSplitDraft(response.body.snapshot);
      setSnapshot(response.body.snapshot);
      setGroups(nextGroups);
      setStatus(nextGroups.length === 0 ? 'error' : 'ready');
    } catch {
      if (generation !== requestGeneration.current) return;
      setSnapshot(undefined);
      setGroups([]);
      setStatus('error');
    }
  }, [
    alreadyMaterialized,
    includePrivate,
    isPrivate,
    onLoadSnapshot,
    snapshotId,
  ]);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadDraft(), 0);
    return () => {
      window.clearTimeout(timer);
      requestGeneration.current += 1;
    };
  }, [loadDraft]);

  const fragmentCount = useMemo(
    () => groups.reduce((sum, group) => sum + group.fragments.length, 0),
    [groups],
  );

  function updateTitle(groupIndex: number, titlePath: string) {
    setGroups((current) =>
      Object.freeze(
        current.map((group, index) =>
          index === groupIndex ? Object.freeze({...group, titlePath}) : group,
        ),
      ),
    );
  }

  function mergeAll() {
    setGroups((current) => {
      const first = current[0];
      if (first === undefined || current.length === 1) return current;
      return Object.freeze([
        Object.freeze({
          titlePath: first.titlePath,
          fragments: Object.freeze(current.flatMap((group) => group.fragments)),
        }),
      ]);
    });
  }

  async function commit() {
    if (
      snapshotId === '' ||
      groups.length === 0 ||
      groups.some((group) => group.titlePath.trim() === '')
    ) {
      setFeedback({
        kind: 'error',
        title: '人工拆分尚未完整',
        detail: '每个条目都需要一个标题，并且全部 Fragment 必须保留。',
      });
      return;
    }
    setBusy(true);
    setFeedback(undefined);
    try {
      const response = await onMaterialize({
        snapshotId,
        includePrivate,
        groups: Object.freeze(
          groups.map((group) =>
            Object.freeze({
              titlePath: group.titlePath,
              fragmentIds: Object.freeze(
                group.fragments.map((fragment) => fragment.fragmentId),
              ),
            }),
          ),
        ),
      });
      if (
        response.body.status !== 'created' &&
        response.body.status !== 'existing'
      ) {
        setFeedback({
          kind: 'error',
          title: '人工拆分没有保存',
          detail:
            'issue' in response.body &&
            response.body.issue.code === 'split_structure_already_materialized'
              ? '该文档已经由另一种拆分方式生成 Entry；现有结构没有被覆盖。'
              : '分组必须按原文顺序完整覆盖全部 Fragment，且正文不能超过条目上限。',
        });
        return;
      }
      setFeedback({
        kind: 'success',
        title: '人工拆分已保存',
        detail: `当前文档生成 ${response.body.createdCount.toString()} 个 Entry；原始证据保持不变。`,
      });
      await onCommitted();
    } catch {
      setFeedback({
        kind: 'error',
        title: '本地接口不可达',
        detail: '人工拆分没有保存，现有证据和 Entry 均未改变。',
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section
      className="entry-manual-split"
      aria-labelledby="manual-split-title"
    >
      <header className="console-heading">
        <div>
          <p className="section-index">MANUAL GROUPING / LOCAL ONLY</p>
          <h2 id="manual-split-title">人工拆分工作台</h2>
        </div>
        <span className="record-count">
          {status === 'ready'
            ? `${groups.length.toString()} 条 · ${fragmentCount.toString()} 个 Fragment`
            : '等待文档'}
        </span>
      </header>
      <p className="entry-manual-split__boundary">
        在既有 Fragment
        边界合并或拆开连续分组，编辑条目标题后一次保存。正文、顺序和来源不会被改写。
      </p>
      {snapshotId === '' ? (
        <p className="entry-manual-split__state">
          请先从上方选择一份来源文档。
        </p>
      ) : alreadyMaterialized ? (
        <p className="entry-manual-split__state">
          该文档已有 Entry。为避免覆盖现有标签与联系，本页不会重新物化结构。
        </p>
      ) : isPrivate && !includePrivate ? (
        <p className="entry-manual-split__state">
          这是隐私文档；勾选“查看并处理隐私文档”后才会在本地载入全文。
        </p>
      ) : status === 'loading' ? (
        <p className="entry-manual-split__state" role="status">
          正在读取本地 Fragment…
        </p>
      ) : status === 'error' ? (
        <div className="entry-manual-split__state" role="alert">
          <span>无法建立人工拆分草稿；文档没有可用 section Fragment。</span>
          <button
            className="text-action"
            type="button"
            onClick={() => void loadDraft()}
          >
            重试
          </button>
        </div>
      ) : status === 'ready' ? (
        <>
          <div className="entry-manual-split__toolbar">
            <button
              className="secondary-action"
              type="button"
              disabled={busy}
              onClick={() => {
                if (snapshot !== undefined)
                  setGroups(createManualSplitDraft(snapshot));
              }}
            >
              按结构重置
            </button>
            <button
              className="secondary-action"
              type="button"
              disabled={busy || groups.length < 2}
              onClick={mergeAll}
            >
              全部合并为一条
            </button>
          </div>
          {snapshot?.structures[0]?.normalizedText === undefined ? null : (
            <details className="entry-manual-split__full-text">
              <summary>查看拆分前全文</summary>
              <pre>{snapshot.structures[0].normalizedText}</pre>
            </details>
          )}
          <ol className="entry-manual-split__groups">
            {groups.map((group, groupIndex) => (
              <li
                key={group.fragments
                  .map((fragment) => fragment.fragmentId)
                  .join(':')}
              >
                {groupIndex === 0 ? null : (
                  <button
                    className="entry-manual-split__merge"
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      setGroups((current) =>
                        mergeManualSplitGroups(current, groupIndex),
                      );
                    }}
                  >
                    与上一条合并
                  </button>
                )}
                <article className="entry-manual-split__group">
                  <header>
                    <strong>
                      条目 {String(groupIndex + 1).padStart(2, '0')}
                    </strong>
                    <span>{group.fragments.length.toString()} 个 Fragment</span>
                  </header>
                  <label>
                    条目标题
                    <input
                      type="text"
                      value={group.titlePath}
                      maxLength={200}
                      disabled={busy}
                      onChange={(event) => {
                        updateTitle(groupIndex, event.currentTarget.value);
                      }}
                    />
                  </label>
                  <div className="entry-manual-split__fragments">
                    {group.fragments.map((fragment, fragmentIndex) => (
                      <div key={fragment.fragmentId}>
                        {fragmentIndex === 0 ? null : (
                          <button
                            className="entry-manual-split__cut"
                            type="button"
                            disabled={busy}
                            aria-label={`在条目 ${String(groupIndex + 1)} 的第 ${String(fragmentIndex + 1)} 个 Fragment 前拆开`}
                            onClick={() => {
                              setGroups((current) =>
                                splitManualSplitGroup(
                                  current,
                                  groupIndex,
                                  fragmentIndex,
                                ),
                              );
                            }}
                          >
                            在此拆开
                          </button>
                        )}
                        <article>
                          <span>
                            Fragment{' '}
                            {String(fragmentIndex + 1).padStart(2, '0')}
                          </span>
                          <pre>{fragment.selectedText}</pre>
                        </article>
                      </div>
                    ))}
                  </div>
                </article>
              </li>
            ))}
          </ol>
          <div className="entry-manual-split__commit">
            <span>保存后生成当前结构；已有 Entry 不会被替换。</span>
            <button
              className="primary-action"
              type="button"
              disabled={busy}
              onClick={() => void commit()}
            >
              {busy
                ? '正在保存…'
                : `保存人工拆分并生成 ${groups.length.toString()} 条`}
            </button>
          </div>
        </>
      ) : null}
      <ActionNotice feedback={feedback} />
    </section>
  );
}
