import {useCallback, useEffect, useMemo, useRef, useState} from 'react';

import type {
  EvidenceSnapshot,
  InformationEntryFragmentGroup,
  InformationEntryRestructureApplyRequest,
  InformationEntryRestructureApplyResponse,
  InformationEntryRestructureImpact,
  InformationEntryRestructurePreviewResponse,
  M1cHttpResponse,
} from '../api/m1c_api_contract.js';
import {ActionNotice} from '../components/action_notice.js';
import type {ActionFeedback} from '../components/product_types.js';
import {ManualSplitGroupEditor} from './information_entry_manual_split_group.js';
import {
  createManualSplitDraftFromGroups,
  mergeAllManualSplitGroups,
  mergeManualSplitGroups,
  splitManualSplitGroup,
  splitManualSplitPiece,
  type ManualSplitDraftGroup,
} from './information_entry_manual_split_model.js';

type EvidenceSnapshotReadResponse =
  | Readonly<{status: 'ok'; snapshot: Readonly<EvidenceSnapshot>}>
  | Readonly<{status: 'not_found'}>
  | Readonly<{status: 'rejected'; issue: Readonly<{code: string}>}>;

export interface InformationEntryRestructureProps {
  readonly snapshotId: string;
  readonly isPrivate: boolean;
  readonly includePrivate: boolean;
  readonly alreadyMaterialized: boolean;
  readonly onLoadSnapshot: (
    snapshotId: string,
    includePrivate?: boolean,
  ) => Promise<M1cHttpResponse<EvidenceSnapshotReadResponse>>;
  readonly onPreview: (
    body: Readonly<{
      snapshotId: string;
      includePrivate: boolean;
      groups?: readonly Readonly<InformationEntryFragmentGroup>[];
    }>,
  ) => Promise<M1cHttpResponse<InformationEntryRestructurePreviewResponse>>;
  readonly onApply: (
    body: Readonly<InformationEntryRestructureApplyRequest>,
  ) => Promise<M1cHttpResponse<InformationEntryRestructureApplyResponse>>;
  readonly onCommitted: () => Promise<void>;
}

export function InformationEntryRestructure({
  alreadyMaterialized,
  includePrivate,
  isPrivate,
  onApply,
  onCommitted,
  onLoadSnapshot,
  onPreview,
  snapshotId,
}: InformationEntryRestructureProps) {
  const [snapshot, setSnapshot] = useState<Readonly<EvidenceSnapshot>>();
  const [groups, setGroups] = useState<
    readonly Readonly<ManualSplitDraftGroup>[]
  >([]);
  const [impact, setImpact] =
    useState<Readonly<InformationEntryRestructureImpact>>();
  const [status, setStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>(
    'idle',
  );
  const [busy, setBusy] = useState(false);
  const [acknowledgeAnnotations, setAcknowledgeAnnotations] = useState(false);
  const [acknowledgeRelationships, setAcknowledgeRelationships] =
    useState(false);
  const [feedback, setFeedback] = useState<ActionFeedback>();
  const requestGeneration = useRef(0);

  const loadCurrent = useCallback(async () => {
    const generation = ++requestGeneration.current;
    setFeedback(undefined);
    setImpact(undefined);
    setAcknowledgeAnnotations(false);
    setAcknowledgeRelationships(false);
    if (
      snapshotId === '' ||
      !alreadyMaterialized ||
      (isPrivate && !includePrivate)
    ) {
      setSnapshot(undefined);
      setGroups([]);
      setStatus('idle');
      return;
    }
    setStatus('loading');
    try {
      const [snapshotResponse, previewResponse] = await Promise.all([
        onLoadSnapshot(snapshotId, includePrivate),
        onPreview({snapshotId, includePrivate}),
      ]);
      if (generation !== requestGeneration.current) return;
      if (
        snapshotResponse.body.status !== 'ok' ||
        previewResponse.body.status !== 'preview'
      ) {
        setSnapshot(undefined);
        setGroups([]);
        setStatus('error');
        return;
      }
      const nextGroups = createManualSplitDraftFromGroups(
        snapshotResponse.body.snapshot,
        previewResponse.body.currentGroups,
      );
      if (nextGroups === undefined) {
        setSnapshot(undefined);
        setGroups([]);
        setStatus('error');
        return;
      }
      setSnapshot(snapshotResponse.body.snapshot);
      setGroups(nextGroups);
      setImpact(previewResponse.body);
      setStatus('ready');
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
    onPreview,
    snapshotId,
  ]);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadCurrent(), 0);
    return () => {
      window.clearTimeout(timer);
      requestGeneration.current += 1;
    };
  }, [loadCurrent]);

  const sourcePieceCount = useMemo(
    () => groups.reduce((sum, group) => sum + group.pieces.length, 0),
    [groups],
  );

  function changeGroups(
    transform: (
      current: readonly Readonly<ManualSplitDraftGroup>[],
    ) => readonly Readonly<ManualSplitDraftGroup>[],
  ) {
    setGroups((current) => transform(current));
    setImpact(undefined);
    setAcknowledgeAnnotations(false);
    setAcknowledgeRelationships(false);
    setFeedback(undefined);
  }

  function requestGroups(): readonly Readonly<InformationEntryFragmentGroup>[] {
    return Object.freeze(
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
    );
  }

  function draftIsComplete(): boolean {
    return (
      groups.length > 0 &&
      groups.every(
        (group) => group.titlePath.trim() !== '' && group.pieces.length > 0,
      )
    );
  }

  async function preview() {
    if (!draftIsComplete()) {
      setFeedback({
        kind: 'error',
        title: '结构草稿尚未完整',
        detail: '每个条目都需要标题，并且必须完整保留原始来源顺序。',
      });
      return;
    }
    setBusy(true);
    setFeedback(undefined);
    try {
      const response = await onPreview({
        snapshotId,
        includePrivate,
        groups: requestGroups(),
      });
      if (response.body.status !== 'preview') {
        setImpact(undefined);
        setFeedback({
          kind: 'error',
          title: '无法生成影响预览',
          detail: restructureFailure(response.body),
        });
        return;
      }
      setImpact(response.body);
      setAcknowledgeAnnotations(false);
      setAcknowledgeRelationships(false);
      setFeedback({
        kind: 'success',
        title: response.body.hasChanges ? '影响预览已更新' : '结构没有变化',
        detail: response.body.hasChanges
          ? '请检查标签与关系迁移摘要，再明确应用。'
          : '当前分组与已保存结构一致，不需要写入。',
      });
    } catch {
      setImpact(undefined);
      setFeedback({
        kind: 'error',
        title: '本地接口不可达',
        detail: '预览没有生成，现有 Entry 与关系均未改变。',
      });
    } finally {
      setBusy(false);
    }
  }

  async function apply() {
    if (!impact?.hasChanges) return;
    setBusy(true);
    setFeedback(undefined);
    try {
      const response = await onApply({
        snapshotId,
        includePrivate,
        groups: requestGroups(),
        planSha256: impact.planSha256,
        acknowledgeAnnotationChanges: acknowledgeAnnotations,
        acknowledgeRelationshipChanges: acknowledgeRelationships,
      });
      if (
        response.body.status !== 'applied' &&
        response.body.status !== 'unchanged'
      ) {
        setFeedback({
          kind: 'error',
          title: '结构没有应用',
          detail: restructureFailure(response.body),
        });
        return;
      }
      await onCommitted();
      await loadCurrent();
      setFeedback({
        kind: 'success',
        title:
          response.body.status === 'applied'
            ? '条目结构已更新'
            : '结构已经是最新状态',
        detail: '原始 Snapshot 与 Fragment 未改写；旧 Entry 已保留为沿袭前身。',
      });
    } catch {
      setFeedback({
        kind: 'error',
        title: '本地接口不可达',
        detail: '原子重组没有得到确认；请重新载入影响预览后再试。',
      });
    } finally {
      setBusy(false);
    }
  }

  if (!alreadyMaterialized) return null;

  return (
    <section
      className="entry-manual-split entry-restructure"
      aria-labelledby="entry-restructure-title"
    >
      <header className="console-heading">
        <div>
          <p className="section-index">STRUCTURE MIGRATION / PREVIEW FIRST</p>
          <h2 id="entry-restructure-title">已生成条目重组</h2>
        </div>
        <span className="record-count">
          {status === 'ready'
            ? `${groups.length.toString()} 条 · ${sourcePieceCount.toString()} 个来源段`
            : '等待结构'}
        </span>
      </header>
      <p className="entry-manual-split__boundary">
        先编辑完整分组，再预览标签、沿袭与关系迁移。只有点击“应用重组”才会一次写入；原始证据不会改变。
      </p>
      {isPrivate && !includePrivate ? (
        <p className="entry-manual-split__state">
          这是隐私文档；勾选“查看并处理隐私文档”后才会在本地载入结构。
        </p>
      ) : status === 'loading' ? (
        <p className="entry-manual-split__state" role="status">
          正在读取当前结构与关系…
        </p>
      ) : status === 'error' ? (
        <div className="entry-manual-split__state" role="alert">
          <span>无法载入可重组结构；现有数据没有改变。</span>
          <button
            className="text-action"
            type="button"
            onClick={() => void loadCurrent()}
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
              onClick={() => void loadCurrent()}
            >
              恢复已保存结构
            </button>
            <button
              className="secondary-action"
              type="button"
              disabled={busy || groups.length < 2}
              onClick={() => {
                changeGroups(mergeAllManualSplitGroups);
              }}
            >
              全部合并为一条
            </button>
          </div>
          {snapshot?.structures[0]?.normalizedText === undefined ? null : (
            <details className="entry-manual-split__full-text">
              <summary>查看不可变来源全文</summary>
              <pre>{snapshot.structures[0].normalizedText}</pre>
            </details>
          )}
          <ol className="entry-manual-split__groups">
            {groups.map((group, groupIndex) => (
              <ManualSplitGroupEditor
                key={`${group.pieces[0]?.fragment.fragmentId ?? 'restructure-group'}:${group.pieces[0]?.startCodePoint.toString() ?? groupIndex.toString()}`}
                busy={busy}
                group={group}
                groupIndex={groupIndex}
                onTitleChange={(titlePath) => {
                  changeGroups((current) =>
                    Object.freeze(
                      current.map((value, index) =>
                        index === groupIndex
                          ? Object.freeze({...value, titlePath})
                          : value,
                      ),
                    ),
                  );
                }}
                onMergePrevious={() => {
                  changeGroups((current) =>
                    mergeManualSplitGroups(current, groupIndex),
                  );
                }}
                onSplitBefore={(pieceIndex) => {
                  changeGroups((current) =>
                    splitManualSplitGroup(current, groupIndex, pieceIndex),
                  );
                }}
                onSplitWithin={(pieceIndex, codePoint) => {
                  changeGroups((current) =>
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
          </ol>
          <div className="entry-restructure__preview-actions">
            <span>编辑后必须重新生成预览，旧预览不能提交。</span>
            <button
              className="secondary-action"
              type="button"
              disabled={busy}
              onClick={() => void preview()}
            >
              {busy ? '正在计算…' : '预览重组影响'}
            </button>
          </div>
          {impact === undefined ? null : (
            <RestructureImpact
              impact={impact}
              acknowledgeAnnotations={acknowledgeAnnotations}
              acknowledgeRelationships={acknowledgeRelationships}
              busy={busy}
              onAcknowledgeAnnotations={setAcknowledgeAnnotations}
              onAcknowledgeRelationships={setAcknowledgeRelationships}
              onApply={() => void apply()}
            />
          )}
        </>
      ) : null}
      <ActionNotice feedback={feedback} />
    </section>
  );
}

function RestructureImpact({
  acknowledgeAnnotations,
  acknowledgeRelationships,
  busy,
  impact,
  onAcknowledgeAnnotations,
  onAcknowledgeRelationships,
  onApply,
}: Readonly<{
  impact: Readonly<InformationEntryRestructureImpact>;
  acknowledgeAnnotations: boolean;
  acknowledgeRelationships: boolean;
  busy: boolean;
  onAcknowledgeAnnotations: (value: boolean) => void;
  onAcknowledgeRelationships: (value: boolean) => void;
  onApply: () => void;
}>) {
  const relationshipAcknowledgementRequired =
    impact.transferredRelationshipCount > 0 ||
    impact.collapsedRelationshipCount > 0;
  const blocked =
    impact.conflictingRelationshipCount > 0 ||
    (impact.annotationReviewCount > 0 && !acknowledgeAnnotations) ||
    (relationshipAcknowledgementRequired && !acknowledgeRelationships);
  return (
    <section
      className="entry-restructure__impact"
      aria-labelledby="restructure-impact-title"
    >
      <header>
        <div>
          <p className="section-index">IMPACT PREVIEW</p>
          <h3 id="restructure-impact-title">本次将发生什么</h3>
        </div>
        <span className="record-count">
          {impact.currentEntryCount.toString()} →{' '}
          {impact.resultingEntryCount.toString()} 条
        </span>
      </header>
      <dl className="entry-restructure__metrics">
        <div>
          <dt>新增</dt>
          <dd>{impact.insertedEntryCount}</dd>
        </div>
        <div>
          <dt>更新</dt>
          <dd>{impact.revisedEntryCount}</dd>
        </div>
        <div>
          <dt>保留</dt>
          <dd>{impact.unchangedEntryCount}</dd>
        </div>
        <div>
          <dt>退出当前结构</dt>
          <dd>{impact.retiredEntryCount}</dd>
        </div>
        <div>
          <dt>迁移关系</dt>
          <dd>{impact.transferredRelationshipCount}</dd>
        </div>
        <div>
          <dt>折叠关系</dt>
          <dd>{impact.collapsedRelationshipCount}</dd>
        </div>
      </dl>
      {impact.conflictingRelationshipCount > 0 ? (
        <p className="entry-restructure__warning" role="alert">
          有 {impact.conflictingRelationshipCount.toString()}{' '}
          条关系在新端点上冲突；请调整分组后重新预览。
        </p>
      ) : null}
      {impact.annotationReviewCount > 0 ? (
        <label className="privacy-query-toggle">
          <input
            type="checkbox"
            checked={acknowledgeAnnotations}
            onChange={(event) => {
              onAcknowledgeAnnotations(event.currentTarget.checked);
            }}
          />
          我已确认 {impact.annotationReviewCount.toString()}{' '}
          个合并条目的标签、分类或评分需要复核；系统会合并内容标签（超出上限时保留前
          32 个），并把互相冲突的分类或评分留空。
        </label>
      ) : null}
      {relationshipAcknowledgementRequired ? (
        <label className="privacy-query-toggle">
          <input
            type="checkbox"
            checked={acknowledgeRelationships}
            onChange={(event) => {
              onAcknowledgeRelationships(event.currentTarget.checked);
            }}
          />
          我已确认关系将按最大证据重叠迁移；合并后指向同一条目的关系将折叠。
        </label>
      ) : null}
      <div className="entry-manual-split__commit">
        <span>应用后仍可从 lineage 查到旧 Entry，但当前查询只显示新结构。</span>
        <button
          className="primary-action"
          type="button"
          disabled={busy || blocked || !impact.hasChanges}
          onClick={onApply}
        >
          {busy ? '正在应用…' : '应用重组'}
        </button>
      </div>
    </section>
  );
}

function restructureFailure(body: unknown): string {
  if (
    typeof body === 'object' &&
    body !== null &&
    'issue' in body &&
    typeof body.issue === 'object' &&
    body.issue !== null &&
    'code' in body.issue
  ) {
    const code = String(body.issue.code);
    if (code === 'stale_entry_restructure_preview')
      return '条目、标签或关系在预览后发生了变化，请重新载入并预览。';
    if (code === 'entry_restructure_relationship_conflict')
      return '多个旧关系映射到同一新端点但内容不一致，请调整分组。';
    if (code === 'entry_restructure_private_relationship_scope_required')
      return '当前结构连接到隐私条目；请明确开启隐私范围后再处理。';
  }
  return '分组必须完整覆盖原始 Fragment，且所有影响都必须先经过有效预览。';
}
