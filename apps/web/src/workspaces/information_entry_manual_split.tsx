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
  mergeAllManualSplitGroups,
  mergeManualSplitGroups,
  splitManualSplitGroup,
  splitManualSplitPiece,
  type ManualSplitDraftGroup,
} from './information_entry_manual_split_model.js';
import {ManualSplitGroupEditor} from './information_entry_manual_split_group.js';

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

  const sourcePieceCount = useMemo(
    () => groups.reduce((sum, group) => sum + group.pieces.length, 0),
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
    setGroups((current) => mergeAllManualSplitGroups(current));
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
        detail: '每个条目都需要标题，并且必须保留全部原文片段。',
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
              fragments: Object.freeze(
                group.pieces.map((piece) =>
                  Object.freeze({
                    fragmentId: piece.fragment.fragmentId,
                    startCodePoint: piece.startCodePoint,
                    endCodePoint: piece.endCodePoint,
                  }),
                ),
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
              ? '该文档已经通过另一种方式生成条目；现有结构没有被覆盖。'
              : '分组必须按原文顺序覆盖全部片段，且正文不能超过条目上限。',
        });
        return;
      }
      setFeedback({
        kind: 'success',
        title: '人工拆分已保存',
        detail: `当前文档生成 ${response.body.createdCount.toString()} 个条目；原文保持不变。`,
      });
      await onCommitted();
    } catch {
      setFeedback({
        kind: 'error',
        title: '本地接口不可达',
        detail: '人工拆分没有保存，原文和现有条目均未改变。',
      });
    } finally {
      setBusy(false);
    }
  }

  if (alreadyMaterialized) return null;

  return (
    <section
      className="entry-manual-split"
      aria-labelledby="manual-split-title"
    >
      <header className="console-heading">
        <div>
          <h2 id="manual-split-title">人工拆分工作台</h2>
        </div>
        <span className="record-count">
          {status === 'ready'
            ? `${groups.length.toString()} 条 · ${sourcePieceCount.toString()} 个来源段`
            : '等待文档'}
        </span>
      </header>
      <p className="entry-manual-split__boundary">
        可在段落之间或正文光标处拆分。保存时不会修改原文。
      </p>
      {snapshotId === '' ? (
        <p className="entry-manual-split__state">
          请先从上方选择一份来源文档。
        </p>
      ) : isPrivate && !includePrivate ? (
        <p className="entry-manual-split__state">
          这是隐私文档；勾选“查看并处理隐私文档”后才会在本地载入全文。
        </p>
      ) : status === 'loading' ? (
        <p className="entry-manual-split__state" role="status">
          正在读取原文片段…
        </p>
      ) : status === 'error' ? (
        <div className="entry-manual-split__state" role="alert">
          <span>无法建立拆分草稿；文档没有可用的正文片段。</span>
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
              <ManualSplitGroupEditor
                key={`${group.pieces[0]?.fragment.fragmentId ?? 'manual-group'}:${group.pieces[0]?.startCodePoint.toString() ?? groupIndex.toString()}`}
                busy={busy}
                group={group}
                groupIndex={groupIndex}
                onTitleChange={(titlePath) => {
                  updateTitle(groupIndex, titlePath);
                }}
                onMergePrevious={() => {
                  setGroups((current) =>
                    mergeManualSplitGroups(current, groupIndex),
                  );
                }}
                onSplitBefore={(pieceIndex) => {
                  setGroups((current) =>
                    splitManualSplitGroup(current, groupIndex, pieceIndex),
                  );
                }}
                onSplitWithin={(pieceIndex, codePoint) => {
                  setGroups((current) =>
                    splitManualSplitPiece(
                      current,
                      groupIndex,
                      pieceIndex,
                      codePoint,
                    ),
                  );
                }}
              />
            ))}
          </ol>{' '}
          <div className="entry-manual-split__commit">
            <span>保存后生成当前结构；已有条目不会被替换。</span>
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
