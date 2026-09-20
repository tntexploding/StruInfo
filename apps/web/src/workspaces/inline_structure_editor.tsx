import {useEffect, useState} from 'react';
import type {
  EvidenceSnapshot,
  InformationEntryDocumentView,
  InformationEntryRestructureImpact,
} from '../api/m1c_api_contract.js';
import type {InformationEntrySplitWorkspaceProps} from './information_entry_split_workspace.js';
import {ReadingContent} from '../components/reading_content.js';
import {
  createManualSplitDraft,
  createManualSplitDraftFromGroups,
  mergeAllManualSplitGroups,
  mergeManualSplitGroups,
  splitManualSplitGroup,
  splitManualSplitPiece,
  manualSplitPieceText,
  type ManualSplitDraftGroup,
} from './information_entry_manual_split_model.js';
import {describeInformationEntryFailure} from './information_entry_shared.js';
export function InlineStructureEditor({
  document,
  snapshot,
  includePrivate,
  services,
  initialDraft,
  onDraftChange,
  onConfirmed,
  onClose,
}: {
  document: InformationEntryDocumentView;
  snapshot: EvidenceSnapshot;
  includePrivate: boolean;
  initialDraft?: readonly ManualSplitDraftGroup[] | undefined;
  onDraftChange: (groups: readonly ManualSplitDraftGroup[]) => void;
  services: InformationEntrySplitWorkspaceProps;
  onConfirmed: () => void;
  onClose: () => void;
}) {
  const {onPreviewRestructure} = services;
  const [groups, setGroups] = useState<readonly ManualSplitDraftGroup[]>(
    () =>
      initialDraft ??
      mergeAllManualSplitGroups(createManualSplitDraft(snapshot)),
  );
  const [impact, setImpact] = useState<InformationEntryRestructureImpact>();
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(
    document.entryCount > 0 && !initialDraft,
  );
  const [error, setError] = useState('');
  const [loadFailed, setLoadFailed] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);
  useEffect(() => {
    if (!document.entryCount || initialDraft) return;
    let current = true;
    void onPreviewRestructure({snapshotId: document.snapshotId, includePrivate})
      .then((r) => {
        if (!current) return;
        if (r.body.status !== 'preview')
          throw new Error(describeInformationEntryFailure(r.body));
        const draft = createManualSplitDraftFromGroups(
          snapshot,
          r.body.currentGroups,
        );
        if (!draft)
          throw new Error(
            '原文分段和现有条目暂时无法对应。请刷新后重试，现有数据未改变。',
          );
        setGroups(draft);
        setLoading(false);
      })
      .catch((e: unknown) => {
        if (current) {
          setError(e instanceof Error ? e.message : '无法读取结构');
          setLoadFailed(true);
          setLoading(false);
        }
      });
    return () => {
      current = false;
    };
  }, [
    document.snapshotId,
    document.entryCount,
    snapshot,
    includePrivate,
    onPreviewRestructure,
    initialDraft,
  ]);
  const change = (next: readonly ManualSplitDraftGroup[]) => {
    setGroups(next);
    onDraftChange(next);
    setImpact(undefined);
    setAcknowledged(false);
    setError('');
  };
  const request = () => ({
    snapshotId: document.snapshotId,
    includePrivate,
    groups: groups.map((g) => ({
      titlePath: g.titlePath,
      fragments: g.pieces.map((p) => ({
        fragmentId: p.fragment.fragmentId,
        startCodePoint: p.startCodePoint,
        endCodePoint: p.endCodePoint,
      })),
    })),
  });
  async function save() {
    setBusy(true);
    setError('');
    try {
      if (document.entryCount && !impact) {
        const response = await onPreviewRestructure(request());
        if (response.body.status !== 'preview')
          throw new Error(describeInformationEntryFailure(response.body));
        setImpact(response.body);
        return;
      }
      const response =
        document.entryCount && impact
          ? await services.onApplyRestructure({
              ...request(),
              planSha256: impact.planSha256,
              acknowledgeAnnotationChanges: acknowledged,
              acknowledgeRelationshipChanges: acknowledged,
            })
          : await services.onMaterializeManual(request());
      if (
        !['applied', 'unchanged', 'created', 'existing'].includes(
          response.body.status,
        )
      )
        throw new Error(describeInformationEntryFailure(response.body));
      onConfirmed();
    } catch (e) {
      setError(e instanceof Error ? e.message : '结构确认未完成，请重试。');
    } finally {
      setBusy(false);
    }
  }
  const affectsMetadata =
    impact &&
    impact.annotationReviewCount +
      impact.collapsedRelationshipCount +
      impact.conflictingRelationshipCount >
      0;
  return (
    <div className="inline-structure-editor">
      <div className="inline-structure-heading">
        <div>
          <strong>分段草稿 · {groups.length} 条</strong>
          <p>
            在正文段落间添加分段，点击现有分段线合并。确认前不改变已入库内容。
          </p>
        </div>
        <button
          className="secondary-action"
          onClick={() => {
            change(mergeAllManualSplitGroups(groups));
          }}
          disabled={busy || loading || loadFailed}
        >
          整篇保留
        </button>
      </div>
      {loading ? (
        <p role="status">读取现有分段…</p>
      ) : loadFailed ? (
        <p role="status">
          无法读取现有分段，请关闭编辑器后重试。原有结构未改变。
        </p>
      ) : (
        <div className="inline-structure-body">
          {groups.map((group, gi) => (
            <section key={gi} className="inline-structure-group">
              {gi ? (
                <button
                  className="inline-cut-remove"
                  disabled={busy}
                  onClick={() => {
                    change(mergeManualSplitGroups(groups, gi));
                  }}
                >
                  分段 {gi + 1} · 点击移除此分段线
                </button>
              ) : null}
              <label className="inline-group-title">
                条目 {gi + 1}
                <input
                  aria-label={'条目 ' + String(gi + 1) + ' 标题'}
                  maxLength={200}
                  value={group.titlePath}
                  disabled={busy}
                  onChange={(e) => {
                    change(
                      groups.map((g, i) =>
                        i === gi ? {...g, titlePath: e.target.value} : g,
                      ),
                    );
                  }}
                />
              </label>
              {group.pieces.map((piece, pi) => {
                const text = manualSplitPieceText(piece);
                const stops = [...text.matchAll(/\n\s*\n/gu)]
                  .map((match) => match.index + match[0].length)
                  .filter((at) => at > 0 && at < text.length);
                return (
                  <div
                    key={
                      piece.fragment.fragmentId +
                      ':' +
                      String(piece.startCodePoint)
                    }
                  >
                    {pi ? (
                      <button
                        className="inline-cut-add"
                        disabled={busy}
                        onClick={() => {
                          change(splitManualSplitGroup(groups, gi, pi));
                        }}
                      >
                        ＋ 在这里分段
                      </button>
                    ) : null}
                    <ReadingContent
                      text={text}
                      baseUri={document.canonicalUri}
                      boundaries={stops.map((at) => ({
                        offset: at,
                        label: '候选分段位置',
                        separator: false,
                        annotation: (
                          <button
                            className="inline-cut-add"
                            disabled={busy}
                            onClick={() => {
                              change(
                                splitManualSplitPiece(
                                  groups,
                                  gi,
                                  pi,
                                  piece.startCodePoint +
                                    Array.from(text.slice(0, at)).length,
                                ),
                              );
                            }}
                          >
                            ＋ 在这里分段
                          </button>
                        ),
                      }))}
                    />
                  </div>
                );
              })}
            </section>
          ))}
        </div>
      )}
      <footer className="journey-floating-bar">
        <div>
          {impact ? (
            <p>
              {impact.hasChanges
                ? '将生成 ' +
                  String(impact.resultingEntryCount) +
                  ' 条；需复核标签 ' +
                  String(impact.annotationReviewCount) +
                  ' 条，合并或冲突关系 ' +
                  String(
                    impact.collapsedRelationshipCount +
                      impact.conflictingRelationshipCount,
                  ) +
                  ' 条。'
                : '与现有结构一致。'}
            </p>
          ) : null}
          {affectsMetadata ? (
            <label>
              <input
                type="checkbox"
                checked={acknowledged}
                onChange={(e) => {
                  setAcknowledged(e.target.checked);
                }}
              />
              已核对以上标签和关系变更
            </label>
          ) : null}
          {error ? <p role="alert">{error}</p> : null}
        </div>
        <div className="journey-action-group">
          <button
            className="secondary-action"
            disabled={busy}
            onClick={onClose}
          >
            取消本次分段
          </button>
          <button
            className="primary-action"
            disabled={
              busy ||
              loading ||
              loadFailed ||
              !groups.length ||
              groups.some((g) => !g.titlePath.trim()) ||
              Boolean(affectsMetadata && !acknowledged) ||
              Boolean(impact && !impact.hasChanges)
            }
            onClick={() => void save()}
          >
            {busy
              ? '正在处理…'
              : document.entryCount && !impact
                ? '预览变更影响'
                : '确认分段并入库'}
          </button>
        </div>
      </footer>
    </div>
  );
}
