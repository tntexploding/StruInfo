import {useEffect, useMemo, useState} from 'react';
import type {SyntheticEvent} from 'react';

import {
  EPISTEMIC_ROLES,
  KNOWLEDGE_KINDS,
  KNOWLEDGE_REVIEW_STATES,
  type CurationState,
  type EpistemicRole,
  type EvidenceSnapshot,
  type EvidenceSnapshotSummary,
  type KnowledgeKind,
  type KnowledgeReviewState,
  type KnowledgeSearchItem,
  type ReviewVocabularyPreferences,
} from '../api/m1c_api_contract.js';
import {ActionNotice} from '../components/action_notice.js';
import {
  createClientUuid,
  createCommandKey,
} from '../components/client_identity.js';
import {
  EPISTEMIC_ROLE_LABELS,
  INTAKE_ACTION_LABELS,
  KNOWLEDGE_KIND_LABELS,
  REVIEW_STATE_LABELS,
} from '../components/product_labels.js';
import type {ActionFeedback} from '../components/product_types.js';
import {
  createQuickKnowledgeCommand,
  createQuickKnowledgeDraft,
  createReviewedKnowledgeQueue,
  firstPendingKnowledgeKey,
  fragmentKnowledgeTitle,
  loadSnapshotKnowledgeItems,
  nextPendingKnowledgeKey,
  type KnowledgeSearchTransport,
  type QuickKnowledgeDraft,
} from './reviewed_knowledge_queue_model.js';

type CoverageState =
  | Readonly<{status: 'idle'}>
  | Readonly<{
      status: 'ready';
      snapshotId: string;
      items: readonly KnowledgeSearchItem[];
    }>
  | Readonly<{status: 'error'; snapshotId: string}>;

const IDLE_COVERAGE: CoverageState = Object.freeze({status: 'idle'});

export interface ReviewedKnowledgeQueueProps {
  readonly curation: Readonly<CurationState>;
  readonly evidence?: Readonly<EvidenceSnapshot> | undefined;
  readonly onApplyKnowledge: (body: unknown) => Promise<ActionFeedback>;
  readonly onOpenEvidence: (
    snapshotId: string,
    fragmentId: string,
    includePrivate: boolean,
  ) => void;
  readonly onSearch: KnowledgeSearchTransport;
  readonly onSelectEvidence: (
    snapshotId: string,
    includePrivate: boolean,
  ) => Promise<ActionFeedback>;
  readonly onUseAdvancedEditor: (targetId: string) => void;
  readonly snapshots: readonly Readonly<EvidenceSnapshotSummary>[];
  readonly vocabularyPreferences: Readonly<ReviewVocabularyPreferences>;
}

export function ReviewedKnowledgeQueue({
  curation,
  evidence,
  onApplyKnowledge,
  onOpenEvidence,
  onSearch,
  onSelectEvidence,
  onUseAdvancedEditor,
  snapshots,
  vocabularyPreferences,
}: ReviewedKnowledgeQueueProps) {
  const [coverage, setCoverage] = useState<CoverageState>(IDLE_COVERAGE);
  const [selectedKey, setSelectedKey] = useState<string>();
  const [draftState, setDraftState] =
    useState<Readonly<{key: string; value: Readonly<QuickKnowledgeDraft>}>>();
  const [skippedKeys, setSkippedKeys] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const [submitting, setSubmitting] = useState(false);
  const [selectingSource, setSelectingSource] = useState(false);
  const [feedback, setFeedback] = useState<ActionFeedback>();
  const [privateScopeSnapshotId, setPrivateScopeSnapshotId] =
    useState<string>();
  const privateScopeEnabled =
    evidence?.isPrivate !== true ||
    privateScopeSnapshotId === evidence.snapshotId;

  useEffect(() => {
    if (evidence === undefined || !privateScopeEnabled) return;
    let active = true;
    void loadSnapshotKnowledgeItems(evidence, onSearch).then(
      (items) => {
        if (active) {
          setCoverage({
            status: 'ready',
            snapshotId: evidence.snapshotId,
            items,
          });
        }
      },
      () => {
        if (active) {
          setCoverage({status: 'error', snapshotId: evidence.snapshotId});
        }
      },
    );
    return () => {
      active = false;
    };
  }, [evidence, onSearch, privateScopeEnabled]);

  const coverageForEvidence =
    evidence !== undefined &&
    privateScopeEnabled &&
    coverage.status !== 'idle' &&
    coverage.snapshotId === evidence.snapshotId
      ? coverage
      : IDLE_COVERAGE;
  const entries = useMemo(() => {
    if (evidence === undefined || !privateScopeEnabled) return [];
    const formalItems =
      coverage.status === 'ready' && coverage.snapshotId === evidence.snapshotId
        ? coverage.items
        : [];
    return createReviewedKnowledgeQueue(
      curation,
      evidence,
      vocabularyPreferences,
      formalItems,
    );
  }, [
    coverage,
    curation,
    evidence,
    privateScopeEnabled,
    vocabularyPreferences,
  ]);
  const effectiveSelectedKey = entries.some(
    (entry) => entry.key === selectedKey,
  )
    ? selectedKey
    : firstPendingKnowledgeKey(entries, skippedKeys);
  const selectedEntry = entries.find(
    (entry) => entry.key === effectiveSelectedKey,
  );
  const draft =
    selectedEntry === undefined
      ? undefined
      : draftState?.key === selectedEntry.key
        ? draftState.value
        : createQuickKnowledgeDraft(selectedEntry);
  const formalizedCount = entries.filter(
    (entry) => entry.formalItems.length > 0,
  ).length;
  const pendingCount = entries.length - formalizedCount;
  const coverageReady = coverageForEvidence.status === 'ready';
  const requiresAdvancedEditor =
    selectedEntry?.processingPlan.kind === 'split_items' ||
    (draft !== undefined && Array.from(draft.body).length > 20_000);

  function selectEntry(key: string) {
    setSelectedKey(key);
    setDraftState(undefined);
    setFeedback(undefined);
  }

  function updateDraft(change: Partial<QuickKnowledgeDraft>) {
    if (selectedEntry === undefined || draft === undefined) return;
    setDraftState({key: selectedEntry.key, value: {...draft, ...change}});
  }

  async function selectSource(snapshotId: string) {
    const snapshot = snapshots.find((value) => value.snapshotId === snapshotId);
    if (snapshot === undefined) return;
    setSelectingSource(true);
    setFeedback(undefined);
    try {
      const result = await onSelectEvidence(
        snapshot.snapshotId,
        snapshot.isPrivate === true,
      );
      setFeedback(result);
      if (result.kind === 'success') {
        setPrivateScopeSnapshotId(
          snapshot.isPrivate === true ? snapshot.snapshotId : undefined,
        );
        setSelectedKey(undefined);
        setDraftState(undefined);
        setSkippedKeys(new Set());
      }
    } finally {
      setSelectingSource(false);
    }
  }

  async function submit(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    if (selectedEntry === undefined || draft === undefined) return;
    if (draft.title.trim() === '') {
      setFeedback({
        kind: 'error',
        title: '标题不能为空',
        detail: '请保留一个能够在搜索结果中识别该知识项的标题。',
      });
      return;
    }
    if (requiresAdvancedEditor) {
      onUseAdvancedEditor(selectedEntry.targetId);
      return;
    }
    setSubmitting(true);
    setFeedback(undefined);
    try {
      const result = await onApplyKnowledge(
        createQuickKnowledgeCommand(selectedEntry, draft, {
          commandIdempotencyKey: createCommandKey('reviewed-knowledge'),
          itemId: createClientUuid(),
        }),
      );
      if (result.kind === 'error') {
        setFeedback(result);
        return;
      }
      if (evidence === undefined) return;
      try {
        const refreshedItems = await loadSnapshotKnowledgeItems(
          evidence,
          onSearch,
        );
        setCoverage({
          status: 'ready',
          snapshotId: evidence.snapshotId,
          items: refreshedItems,
        });
        const refreshedEntries = createReviewedKnowledgeQueue(
          curation,
          evidence,
          vocabularyPreferences,
          refreshedItems,
        );
        setSelectedKey(
          nextPendingKnowledgeKey(
            refreshedEntries,
            selectedEntry.key,
            skippedKeys,
          ),
        );
        setDraftState(undefined);
        setFeedback({
          kind: 'success',
          title: '已写入正式知识并可检索',
          detail: '当前修订已由来源检索重新读出；队列已前进到下一项。',
        });
      } catch {
        setFeedback({
          kind: 'success',
          title: '正式知识已写入',
          detail:
            '提交已成功，但搜索状态刷新失败；不要重复提交，恢复本地服务后点击“重试检索”。',
        });
      }
    } finally {
      setSubmitting(false);
    }
  }

  async function retryCoverage() {
    if (evidence === undefined) return;
    setFeedback(undefined);
    try {
      const items = await loadSnapshotKnowledgeItems(evidence, onSearch);
      setCoverage({status: 'ready', snapshotId: evidence.snapshotId, items});
    } catch {
      setCoverage({status: 'error', snapshotId: evidence.snapshotId});
    }
  }

  function skipCurrent() {
    if (selectedEntry === undefined) return;
    const nextSkipped = new Set(skippedKeys);
    nextSkipped.add(selectedEntry.key);
    setSkippedKeys(nextSkipped);
    setSelectedKey(
      nextPendingKnowledgeKey(entries, selectedEntry.key, nextSkipped),
    );
    setDraftState(undefined);
    setFeedback(undefined);
  }

  return (
    <section
      className="reviewed-knowledge-queue"
      aria-labelledby="reviewed-knowledge-title"
    >
      <header className="console-heading reviewed-knowledge-queue__heading">
        <div>
          <p className="section-index">REVIEW → FORMAL KNOWLEDGE → SEARCH</p>
          <h2 id="reviewed-knowledge-title">审核转知识</h2>
          <p>
            只列出已审核且允许入库的
            Fragment。提交后立即通过确定性搜索确认，随后前进到下一条。
          </p>
        </div>
        <div
          className="reviewed-knowledge-queue__metrics"
          aria-label="转知识进度"
        >
          <span>
            <strong>{entries.length}</strong> 已准入
          </span>
          <span>
            <strong>{formalizedCount}</strong> 已可检索
          </span>
          <span>
            <strong>{pendingCount}</strong> 待入库
          </span>
        </div>
      </header>

      <div className="reviewed-knowledge-queue__source">
        <label className="field">
          <span>审核来源</span>
          <select
            value={evidence?.snapshotId ?? ''}
            disabled={selectingSource}
            onChange={(event) => {
              void selectSource(event.currentTarget.value);
            }}
          >
            <option value="">选择已导入并审核的文档</option>
            {snapshots.map((snapshot) => (
              <option key={snapshot.snapshotId} value={snapshot.snapshotId}>
                {snapshot.sourceKey}
                {snapshot.isPrivate === true ? ' · 隐私' : ''}
              </option>
            ))}
          </select>
        </label>
        {evidence !== undefined ? (
          <span className="origin-label origin-label--deterministic">
            {!privateScopeEnabled
              ? '隐私范围未启用'
              : coverageReady
                ? '检索状态已同步'
                : coverageForEvidence.status === 'error'
                  ? '检索状态不可用'
                  : '正在核对正式知识…'}
          </span>
        ) : null}
        {evidence?.isPrivate === true ? (
          <label className="reviewed-knowledge-queue__private-scope">
            <input
              type="checkbox"
              checked={privateScopeEnabled}
              onChange={(event) => {
                setPrivateScopeSnapshotId(
                  event.currentTarget.checked ? evidence.snapshotId : undefined,
                );
                setSelectedKey(undefined);
                setDraftState(undefined);
              }}
            />
            <span>处理并检索这份隐私文档</span>
          </label>
        ) : null}
        {coverageForEvidence.status === 'error' ? (
          <button
            className="secondary-action"
            type="button"
            onClick={() => void retryCoverage()}
          >
            重试检索
          </button>
        ) : null}
      </div>

      {evidence === undefined ? (
        <div className="empty-state" role="status">
          <h3>先选择一份已审核文档</h3>
          <p>资料和个人偏好仍从外部工作区读取，不会写入代码或 Git。</p>
        </div>
      ) : !privateScopeEnabled ? (
        <div className="empty-state" role="status">
          <h3>隐私文档内容尚未在本页启用</h3>
          <p>勾选上方选项后，才会读取审核条目和对应的隐私知识。</p>
        </div>
      ) : entries.length === 0 ? (
        <div className="empty-state" role="status">
          <h3>这份文档没有待转入的审核条目</h3>
          <p>
            仅“完整处理 / 拆分入库 / 压缩入库”的已审核 Fragment 会进入这里。
          </p>
        </div>
      ) : (
        <div className="reviewed-knowledge-queue__workbench">
          <aside
            className="reviewed-knowledge-queue__list"
            aria-label="已审核条目"
          >
            <ol>
              {entries.map((entry, index) => (
                <li key={entry.key}>
                  <button
                    type="button"
                    aria-current={
                      entry.key === selectedEntry?.key ? 'true' : undefined
                    }
                    data-complete={entry.formalItems.length > 0}
                    onClick={() => {
                      selectEntry(entry.key);
                    }}
                  >
                    <span>{String(index + 1).padStart(2, '0')}</span>
                    <strong>
                      {fragmentKnowledgeTitle(entry.fragment.selectedText)}
                    </strong>
                    <small>
                      {entry.formalItems.length > 0
                        ? `${entry.formalItems.length.toString()} 项可检索`
                        : entry.processingPlan.label}
                    </small>
                  </button>
                </li>
              ))}
            </ol>
          </aside>

          {selectedEntry !== undefined && draft !== undefined ? (
            <form
              className="reviewed-knowledge-editor"
              onSubmit={(event) => void submit(event)}
            >
              <header className="reviewed-knowledge-editor__header">
                <div>
                  <span className="origin-label origin-label--manual">
                    {INTAKE_ACTION_LABELS[selectedEntry.action]}
                  </span>
                  {evidence.isPrivate === true ? (
                    <span className="origin-label">隐私范围</span>
                  ) : null}
                </div>
                <button
                  className="text-action"
                  type="button"
                  onClick={() => {
                    onOpenEvidence(
                      selectedEntry.snapshotId,
                      selectedEntry.fragment.fragmentId,
                      evidence.isPrivate === true,
                    );
                  }}
                >
                  查看精确原文
                </button>
              </header>

              <div className="reviewed-knowledge-editor__plan">
                <strong>{selectedEntry.processingPlan.label}</strong>
                <p>{selectedEntry.processingPlan.detail}</p>
                {Array.from(draft.body).length > 20_000 ? (
                  <p>
                    正文超过单个知识修订上限；原文没有被截断，请进入高级编辑器拆成多项。
                  </p>
                ) : null}
              </div>

              {selectedEntry.keywords.length > 0 ? (
                <div
                  className="reviewed-knowledge-editor__keywords"
                  aria-label="审核标签"
                >
                  {selectedEntry.keywords.map((keyword) => (
                    <span key={keyword}>{keyword}</span>
                  ))}
                  <small>标签只提供类型建议，不会自动建立正式关系。</small>
                </div>
              ) : null}

              {selectedEntry.formalItems.length > 0 ? (
                <div
                  className="reviewed-knowledge-editor__complete"
                  role="status"
                >
                  <strong>该 Fragment 已形成正式知识</strong>
                  <ul>
                    {selectedEntry.formalItems.map((item) => (
                      <li key={item.itemId}>
                        {item.value.title} · 修订 {item.revision}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : (
                <>
                  <div className="reviewed-knowledge-editor__fields">
                    <label className="field field--full">
                      <span>知识标题</span>
                      <input
                        required
                        maxLength={300}
                        value={draft.title}
                        onChange={(event) => {
                          updateDraft({title: event.currentTarget.value});
                        }}
                      />
                    </label>
                    <label className="field">
                      <span>知识类型</span>
                      <select
                        value={draft.knowledgeKind}
                        onChange={(event) => {
                          updateDraft({
                            knowledgeKind: event.currentTarget
                              .value as KnowledgeKind,
                          });
                        }}
                      >
                        {KNOWLEDGE_KINDS.map((kind) => (
                          <option key={kind} value={kind}>
                            {KNOWLEDGE_KIND_LABELS[kind]}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="field">
                      <span>内容角色</span>
                      <select
                        value={draft.epistemicRole}
                        onChange={(event) => {
                          updateDraft({
                            epistemicRole: event.currentTarget
                              .value as EpistemicRole,
                          });
                        }}
                      >
                        {EPISTEMIC_ROLES.map((role) => (
                          <option key={role} value={role}>
                            {EPISTEMIC_ROLE_LABELS[role]}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="field">
                      <span>知识状态</span>
                      <select
                        value={draft.reviewState}
                        onChange={(event) => {
                          updateDraft({
                            reviewState: event.currentTarget
                              .value as KnowledgeReviewState,
                          });
                        }}
                      >
                        {KNOWLEDGE_REVIEW_STATES.map((state) => (
                          <option
                            key={state}
                            value={state}
                            disabled={
                              state === 'rejected' || state === 'withdrawn'
                            }
                          >
                            {REVIEW_STATE_LABELS[state]}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="field field--full">
                      <span>正式知识正文</span>
                      <textarea
                        rows={9}
                        maxLength={20_000}
                        value={draft.body}
                        onChange={(event) => {
                          updateDraft({body: event.currentTarget.value});
                        }}
                      />
                      <small>
                        可以直接保留短条目；需要压缩时，在提交前删去宣传性或重复表达。
                      </small>
                    </label>
                  </div>

                  <div className="reviewed-knowledge-editor__actions">
                    <button
                      className="text-action"
                      type="button"
                      onClick={skipCurrent}
                    >
                      暂时跳过
                    </button>
                    <button
                      className="secondary-action"
                      type="button"
                      onClick={() => {
                        onUseAdvancedEditor(selectedEntry.targetId);
                      }}
                    >
                      高级拆分 / 建立关系
                    </button>
                    <button
                      className="primary-action"
                      type="submit"
                      disabled={!coverageReady || submitting}
                    >
                      {submitting
                        ? '正在写入并验证…'
                        : requiresAdvancedEditor
                          ? '进入高级拆分'
                          : '写入知识并继续'}
                    </button>
                  </div>
                </>
              )}
              <ActionNotice feedback={feedback} />
            </form>
          ) : null}
        </div>
      )}
      {evidence === undefined || entries.length === 0 ? (
        <ActionNotice feedback={feedback} />
      ) : null}
    </section>
  );
}
