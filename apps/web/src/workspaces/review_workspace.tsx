import {useMemo, useState} from 'react';
import type {SyntheticEvent} from 'react';

import type {
  CurationState,
  EvidenceSnapshot,
  EvidenceSnapshotSummary,
  IntakeAction,
  IntakeReason,
  ReviewAutomaticKeywordPreferences,
  ReviewPreferencesWrite,
  ReviewPreferencesResponse,
} from '../api/m1c_api_contract.js';
import {
  DEFAULT_REVIEW_AUTOMATIC_KEYWORDS,
  DEFAULT_REVIEW_VOCABULARY,
} from '../api/m1c_api_contract.js';
import {ActionNotice} from '../components/action_notice.js';
import {
  createClientUuid,
  createCommandKey,
} from '../components/client_identity.js';
import {
  INTAKE_ACTION_LABELS,
  INTAKE_REASON_LABELS,
  KNOWLEDGE_KIND_LABELS,
} from '../components/product_labels.js';
import type {ActionFeedback, Loadable} from '../components/product_types.js';
import {
  decodeReviewNote,
  encodeReviewNote,
  REVIEW_DIRECTIVE_NOTE_LIMIT,
  REVIEW_EXPLICIT_LINK_LIMIT,
  reviewNoteCodePointLength,
  type ReviewExplicitLink,
  type ReviewLinkPolicy,
} from './review_directive_note.js';
import {
  extractReviewKeywords,
  normalizeReviewKeyword,
  reviewKeywordIdentity,
} from './review_keyword_extractor.js';
import {ReviewQueue} from './review_queue.js';
import {
  deriveReviewProcessingPlan,
  recommendReviewAction,
  type ReviewScore,
} from './review_processing_plan.js';
import {
  createReviewQueueCandidates,
  createReviewTargetOptions,
  firstPendingReviewKey,
  nextReviewKey,
  type ReviewQueueCandidate,
} from './review_queue_model.js';
import {
  canonicalizeReviewKeyword,
  preferredKnowledgeKind,
  vocabularySuggestionsForKeyword,
} from './review_vocabulary.js';

const MAX_REVIEW_KEYWORDS = 12;
const MAX_REVIEW_QUICK_TAGS = 24;
const MAX_REVIEW_KEYWORD_EXCLUSIONS = 64;
const HUMAN_NOTE_LIMIT = 600;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const RELATION_TYPE_PATTERN = /^[a-z][a-z0-9._:-]{0,119}$/u;

const ACTION_CHOICES = [
  'full',
  'split',
  'condense',
  'source_only',
  'ignore',
  'needs_review',
] as const satisfies readonly IntakeAction[];

const REVIEW_SCORE_LEVELS = ['很低', '较低', '中等', '较高', '很高'] as const;

interface KeywordDraft {
  readonly key: string;
  readonly value: string;
  readonly origin: 'automatic' | 'manual';
}

interface ReviewEditorInitialState {
  readonly usefulness: ReviewScore;
  readonly interest: ReviewScore;
  readonly action: IntakeAction;
  readonly actionWasChosen: boolean;
  readonly reasons: readonly IntakeReason[];
  readonly humanNote: string;
  readonly keywords: readonly KeywordDraft[];
  readonly linkPolicy: ReviewLinkPolicy;
  readonly explicitLinks: readonly Readonly<ReviewExplicitLink>[];
}

export interface ReviewWorkspaceProps {
  readonly curation: Loadable<Readonly<CurationState>>;
  readonly evidence?: Readonly<EvidenceSnapshot> | undefined;
  readonly reviewPreferences: Loadable<Readonly<ReviewPreferencesResponse>>;
  readonly onApplyCuration: (body: unknown) => Promise<ActionFeedback>;
  readonly onOpenEvidence: (
    snapshotId: string,
    returnFocus: HTMLElement,
    fragmentId: string,
  ) => void;
  readonly onPutTerm: (body: unknown) => Promise<ActionFeedback>;
  readonly onSaveReviewPreferences: (
    preferences: Readonly<ReviewPreferencesWrite>,
  ) => Promise<ActionFeedback>;
  readonly onRefresh: () => void;
  readonly snapshots: readonly Readonly<EvidenceSnapshotSummary>[];
}

export function ReviewWorkspace({
  curation,
  evidence,
  reviewPreferences,
  onApplyCuration,
  onOpenEvidence,
  onPutTerm,
  onSaveReviewPreferences,
  onRefresh,
  snapshots,
}: ReviewWorkspaceProps) {
  const targetOptions = useMemo(
    () => createReviewTargetOptions(snapshots, evidence),
    [evidence, snapshots],
  );
  const queueCandidates = useMemo(
    () =>
      curation.status === 'ready'
        ? createReviewQueueCandidates(targetOptions, curation.value)
        : [],
    [curation, targetOptions],
  );
  const [targetKey, setTargetKey] = useState('');
  const [sessionReviewPreferences, setSessionReviewPreferences] = useState<
    Readonly<ReviewPreferencesWrite>
  >(() => ({
    quickTags: [],
    automaticKeywords: DEFAULT_REVIEW_AUTOMATIC_KEYWORDS,
    vocabulary: DEFAULT_REVIEW_VOCABULARY,
  }));
  const effectiveTargetKey = queueCandidates.some(
    (target) => target.key === targetKey,
  )
    ? targetKey
    : (firstPendingReviewKey(queueCandidates) ?? '');
  const selected = queueCandidates.find(
    (candidate) => candidate.key === effectiveTargetKey,
  );

  function continueReview(currentKey: string) {
    const next = nextReviewKey(queueCandidates, currentKey);
    if (next !== undefined) setTargetKey(next);
  }

  return (
    <div className="workspace-view review-workspace">
      <header className="workspace-heading review-workspace__heading">
        <div>
          <p className="section-index">02 / RAPID MANUAL REVIEW</p>
          <h1>审核与知识入库</h1>
          <p>
            读完即评：有用与有趣分别记录，处理动作、关键词和关系意图一次提交。
          </p>
        </div>
        <div className="review-heading-status">
          <CurationSummary curation={curation} />
          <button
            className="secondary-action"
            type="button"
            onClick={onRefresh}
          >
            刷新状态
          </button>
        </div>
      </header>

      {curation.status !== 'ready' ? (
        <UnavailableReview state={curation} />
      ) : (
        <div className="review-workbench">
          <ReviewQueue
            candidates={queueCandidates}
            selectedKey={effectiveTargetKey}
            sourceKey={evidence?.sourceKey}
            onSelect={setTargetKey}
          />
          {selected === undefined || evidence === undefined ? (
            <section
              className="review-workbench__empty empty-state"
              role="status"
            >
              <p className="section-index">NO ACTIVE FRAGMENT</p>
              <h2>先从材料工作区打开一份来源档案</h2>
              <p>
                打开后，这里会按解析出的 section Fragment
                形成分页审核队列；正文不会进入前端包体。
              </p>
            </section>
          ) : (
            <FastReviewEditor
              key={`${selected.key}:${(
                findCurationTarget(curation.value, selected.id)
                  ?.currentVersion ?? 0
              ).toString()}:${reviewPreferences.status}`}
              candidates={queueCandidates}
              evidence={evidence}
              reviewPreferences={reviewPreferences}
              sessionReviewPreferences={sessionReviewPreferences}
              selected={selected}
              state={curation.value}
              onApply={onApplyCuration}
              onApplied={continueReview}
              onOpenEvidence={onOpenEvidence}
              onPutTerm={onPutTerm}
              onSaveReviewPreferences={onSaveReviewPreferences}
              onSelect={setTargetKey}
              onUpdateSessionReviewPreferences={setSessionReviewPreferences}
            />
          )}
        </div>
      )}
    </div>
  );
}

function CurationSummary({
  curation,
}: {
  readonly curation: Loadable<Readonly<CurationState>>;
}) {
  const state = curation.status === 'ready' ? curation.value : undefined;
  return (
    <dl className="review-heading-metrics" aria-label="当前审核记录概览">
      <div>
        <dt>词条</dt>
        <dd>{state?.terms.length ?? '—'}</dd>
      </div>
      <div>
        <dt>目标</dt>
        <dd>{state?.targets.length ?? '—'}</dd>
      </div>
      <div>
        <dt>决定</dt>
        <dd>{state?.decisions.length ?? '—'}</dd>
      </div>
      <div>
        <dt>评价</dt>
        <dd>{state?.assessments.length ?? '—'}</dd>
      </div>
    </dl>
  );
}

function FastReviewEditor({
  candidates,
  evidence,
  onApply,
  onApplied,
  onOpenEvidence,
  onPutTerm,
  onSaveReviewPreferences,
  onSelect,
  onUpdateSessionReviewPreferences,
  reviewPreferences,
  sessionReviewPreferences,
  selected,
  state,
}: {
  readonly candidates: readonly Readonly<ReviewQueueCandidate>[];
  readonly evidence: Readonly<EvidenceSnapshot>;
  readonly reviewPreferences: Loadable<Readonly<ReviewPreferencesResponse>>;
  readonly sessionReviewPreferences: Readonly<ReviewPreferencesWrite>;
  readonly onApply: (body: unknown) => Promise<ActionFeedback>;
  readonly onApplied: (targetKey: string) => void;
  readonly onOpenEvidence: (
    snapshotId: string,
    returnFocus: HTMLElement,
    fragmentId: string,
  ) => void;
  readonly onPutTerm: (body: unknown) => Promise<ActionFeedback>;
  readonly onSaveReviewPreferences: (
    preferences: Readonly<ReviewPreferencesWrite>,
  ) => Promise<ActionFeedback>;
  readonly onSelect: (targetKey: string) => void;
  readonly onUpdateSessionReviewPreferences: (
    preferences: Readonly<ReviewPreferencesWrite>,
  ) => void;
  readonly selected: Readonly<ReviewQueueCandidate>;
  readonly state: Readonly<CurationState>;
}) {
  const [automaticKeywordPreferences, setAutomaticKeywordPreferences] =
    useState<Readonly<ReviewAutomaticKeywordPreferences>>(() =>
      reviewPreferences.status === 'ready'
        ? reviewPreferences.value.automaticKeywords
        : sessionReviewPreferences.automaticKeywords,
    );
  const vocabularyPreferences =
    reviewPreferences.status === 'ready'
      ? reviewPreferences.value.vocabulary
      : sessionReviewPreferences.vocabulary;
  const automaticKeywords = useMemo(
    () =>
      extractAutomaticReviewKeywords(
        selected.fragment.selectedText,
        automaticKeywordPreferences,
        vocabularyPreferences,
      ),
    [
      automaticKeywordPreferences,
      selected.fragment.selectedText,
      vocabularyPreferences,
    ],
  );
  const [initial] = useState(() =>
    createReviewEditorInitialState(state, selected, automaticKeywords),
  );
  const [usefulness, setUsefulness] = useState<ReviewScore>(initial.usefulness);
  const [interest, setInterest] = useState<ReviewScore>(initial.interest);
  const [action, setAction] = useState<IntakeAction>(initial.action);
  const [actionWasChosen, setActionWasChosen] = useState(
    initial.actionWasChosen,
  );
  const [reasons, setReasons] = useState<readonly IntakeReason[]>(
    initial.reasons,
  );
  const [humanNote, setHumanNote] = useState(initial.humanNote);
  const [noteOpen, setNoteOpen] = useState(initial.humanNote !== '');
  const [keywords, setKeywords] = useState<readonly KeywordDraft[]>(
    initial.keywords,
  );
  const [linkPolicy, setLinkPolicy] = useState<ReviewLinkPolicy>(
    initial.linkPolicy,
  );
  const [explicitLinks, setExplicitLinks] = useState<
    readonly Readonly<ReviewExplicitLink>[]
  >(initial.explicitLinks);
  const [linkTargetKind, setLinkTargetKind] =
    useState<ReviewExplicitLink['targetKind']>('fragment');
  const [linkTargetId, setLinkTargetId] = useState('');
  const [relationTypeKey, setRelationTypeKey] = useState('related_to');
  const [relationFeedback, setRelationFeedback] = useState('');
  const [commandKey, setCommandKey] = useState(() =>
    createCommandKey('curation'),
  );
  const [submitting, setSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<ActionFeedback>();
  const [quickTagDraft, setQuickTagDraft] = useState('');
  const [quickTagFeedback, setQuickTagFeedback] = useState('');
  const [savingQuickTags, setSavingQuickTags] = useState(false);
  const [savingKeywordPreferences, setSavingKeywordPreferences] =
    useState(false);
  const [keywordPreferenceFeedback, setKeywordPreferenceFeedback] =
    useState('');
  const [excludedKeywordDraft, setExcludedKeywordDraft] = useState(() =>
    automaticKeywordPreferences.excludedKeywords.join('，'),
  );

  const selectedIndex = candidates.findIndex(
    (candidate) => candidate.key === selected.key,
  );

  function updateScore(kind: 'usefulness' | 'interest', value: ReviewScore) {
    const nextUsefulness = kind === 'usefulness' ? value : usefulness;
    const nextInterest = kind === 'interest' ? value : interest;
    if (kind === 'usefulness') setUsefulness(value);
    else setInterest(value);
    if (!actionWasChosen) {
      setAction(
        recommendReviewAction(
          nextUsefulness,
          nextInterest,
          selected.fragment.selectedText,
        ),
      );
    }
  }

  function toggleReason(reason: IntakeReason, checked: boolean) {
    setReasons((current) =>
      checked
        ? [...current, reason]
        : current.filter((value) => value !== reason),
    );
  }

  function toggleQuickTag(tag: string) {
    const identity = reviewKeywordIdentity(tag);
    const selectedTag = keywords.some(
      ({value}) => reviewKeywordIdentity(value) === identity,
    );
    if (!selectedTag && keywords.length >= MAX_REVIEW_KEYWORDS) {
      setQuickTagFeedback(
        `本条最多保留 ${MAX_REVIEW_KEYWORDS.toString()} 个关键词。`,
      );
      return;
    }
    setKeywords((current) =>
      selectedTag
        ? current.filter(({value}) => reviewKeywordIdentity(value) !== identity)
        : [...current, toKeywordDraft(tag)],
    );
    setQuickTagFeedback(
      selectedTag ? `已从本条移除“${tag}”。` : `已标记本条为“${tag}”。`,
    );
  }

  async function persistQuickTags(
    quickTags: readonly string[],
    successMessage: string,
  ) {
    if (reviewPreferences.status === 'loading') return;
    if (reviewPreferences.status !== 'ready') {
      onUpdateSessionReviewPreferences({
        quickTags,
        automaticKeywords: automaticKeywordPreferences,
        vocabulary: sessionReviewPreferences.vocabulary,
      });
      setQuickTagFeedback(
        `${successMessage} 当前偏好接口不可用，因此只保留到本次页面会话。`,
      );
      return;
    }
    setSavingQuickTags(true);
    const next = await onSaveReviewPreferences({
      quickTags,
      automaticKeywords: automaticKeywordPreferences,
      vocabulary: vocabularyPreferences,
    });
    setQuickTagFeedback(
      next.kind === 'success'
        ? successMessage
        : `${next.title}：${next.detail}`,
    );
    setSavingQuickTags(false);
  }

  async function persistAutomaticKeywordPreferences(
    nextPreferences: Readonly<ReviewAutomaticKeywordPreferences>,
    successMessage: string,
  ) {
    if (reviewPreferences.status === 'loading') return;
    const previous = automaticKeywordPreferences;
    const previousAutomaticKeywords = automaticKeywords;
    const nextAutomaticKeywords = extractAutomaticReviewKeywords(
      selected.fragment.selectedText,
      nextPreferences,
    );
    setAutomaticKeywordPreferences(nextPreferences);
    setKeywords((current) =>
      synchronizeAutomaticKeywordDrafts(
        current,
        nextAutomaticKeywords,
        selected.reviewed,
      ),
    );
    if (reviewPreferences.status !== 'ready') {
      onUpdateSessionReviewPreferences({
        quickTags: sessionReviewPreferences.quickTags,
        automaticKeywords: nextPreferences,
        vocabulary: sessionReviewPreferences.vocabulary,
      });
      setKeywordPreferenceFeedback(
        `${successMessage} 当前偏好接口不可用，因此只保留到本次页面会话。`,
      );
      return;
    }
    setSavingKeywordPreferences(true);
    const next = await onSaveReviewPreferences({
      quickTags: reviewPreferences.value.quickTags,
      automaticKeywords: nextPreferences,
      vocabulary: reviewPreferences.value.vocabulary,
    });
    if (next.kind === 'success') {
      setKeywordPreferenceFeedback(successMessage);
    } else {
      setAutomaticKeywordPreferences(previous);
      setKeywords((current) =>
        synchronizeAutomaticKeywordDrafts(
          current,
          previousAutomaticKeywords,
          selected.reviewed,
        ),
      );
      setExcludedKeywordDraft(previous.excludedKeywords.join('，'));
      setKeywordPreferenceFeedback(`${next.title}：${next.detail}`);
    }
    setSavingKeywordPreferences(false);
  }

  function saveExcludedKeywordDraft() {
    const excludedKeywords = parseExcludedKeywords(excludedKeywordDraft);
    setExcludedKeywordDraft(excludedKeywords.join('，'));
    if (
      keywordListsEqual(
        excludedKeywords,
        automaticKeywordPreferences.excludedKeywords,
      )
    ) {
      return;
    }
    void persistAutomaticKeywordPreferences(
      {...automaticKeywordPreferences, excludedKeywords},
      excludedKeywords.length === 0
        ? '自动排除词已清空。'
        : `已保存 ${excludedKeywords.length.toString()} 个自动排除词。`,
    );
  }

  async function addQuickTag() {
    const tag = normalizeReviewKeyword(quickTagDraft);
    if (tag === '') {
      setQuickTagFeedback('请输入 1–120 个字符的明确标记。');
      return;
    }
    if (
      quickTags.some(
        (value) => reviewKeywordIdentity(value) === reviewKeywordIdentity(tag),
      )
    ) {
      setQuickTagFeedback('这个快捷标记已经存在。');
      return;
    }
    if (quickTags.length >= MAX_REVIEW_QUICK_TAGS) {
      setQuickTagFeedback(
        `最多保存 ${MAX_REVIEW_QUICK_TAGS.toString()} 个快捷标记。`,
      );
      return;
    }
    await persistQuickTags(
      [...quickTags, tag],
      `已把“${tag}”保存到当前工作区快捷栏。`,
    );
    setQuickTagDraft('');
  }

  async function removeQuickTag(tag: string) {
    await persistQuickTags(
      quickTags.filter(
        (value) => reviewKeywordIdentity(value) !== reviewKeywordIdentity(tag),
      ),
      `已从快捷栏移除“${tag}”；已审核条目和本条选择均未修改。`,
    );
  }

  function addExplicitLink() {
    const targetId = linkTargetId.trim();
    const relationKey = relationTypeKey.trim();
    if (!UUID_PATTERN.test(targetId)) {
      setRelationFeedback('目标必须是小写规范 UUID。');
      return;
    }
    if (!RELATION_TYPE_PATTERN.test(relationKey)) {
      setRelationFeedback('关系类型使用小写字母开头的稳定 key。');
      return;
    }
    if (
      explicitLinks.some(
        (link) =>
          link.targetKind === linkTargetKind &&
          link.targetId === targetId &&
          link.relationTypeKey === relationKey,
      )
    ) {
      setRelationFeedback('这项联系已经在列表中。');
      return;
    }
    if (explicitLinks.length >= REVIEW_EXPLICIT_LINK_LIMIT) {
      setRelationFeedback(
        `每条审核最多记录 ${REVIEW_EXPLICIT_LINK_LIMIT.toString()} 项明确联系。`,
      );
      return;
    }
    setExplicitLinks((current) => [
      ...current,
      {
        targetKind: linkTargetKind,
        targetId,
        relationTypeKey: relationKey,
      },
    ]);
    setLinkTargetId('');
    setRelationFeedback('联系意图已加入，提交审核后保存。');
  }

  async function submit(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    const target = findCurationTarget(state, selected.id);
    const note = encodeReviewNote(humanNote, {linkPolicy, explicitLinks});
    if (reviewNoteCodePointLength(note) > REVIEW_DIRECTIVE_NOTE_LIMIT) {
      setFeedback({
        kind: 'error',
        title: '审核说明过长',
        detail: '减少备注或明确联系后再提交；本条结果尚未写入。',
      });
      return;
    }

    const normalizedKeywords = uniqueKeywords(
      keywords.map(({value}) =>
        canonicalizeReviewKeyword(value, vocabularyPreferences),
      ),
    );
    setSubmitting(true);
    setFeedback(undefined);
    try {
      const resolvedTermIds: string[] = [];
      for (const keyword of normalizedKeywords) {
        const existing = state.terms.find(
          (term) =>
            term.value.lifecycle === 'active' &&
            reviewKeywordIdentity(term.value.displayName) ===
              reviewKeywordIdentity(keyword),
        );
        if (existing !== undefined) {
          resolvedTermIds.push(existing.termId);
          continue;
        }
        const termId = createClientUuid();
        const created = await onPutTerm({
          commandIdempotencyKey: createCommandKey('review-term'),
          request: {
            termId,
            expectedRevision: 0,
            value: {
              displayName: keyword,
              description: '由人工审核中的可编辑关键词创建。',
              lifecycle: 'active',
            },
          },
        });
        if (created.kind !== 'success') {
          setFeedback(created);
          return;
        }
        resolvedTermIds.push(termId);
      }

      const currentTermIds = assignedTermIds(state, target?.targetId);
      const requestedTermIds = new Set(resolvedTermIds);
      const operations: unknown[] = [];
      for (const termId of currentTermIds) {
        if (!requestedTermIds.has(termId)) {
          operations.push({kind: 'remove_classification', termId});
        }
      }
      for (const termId of resolvedTermIds) {
        if (!currentTermIds.has(termId)) {
          operations.push({kind: 'assign_classification', termId});
        }
      }
      operations.push({
        kind: 'set_intake_decision',
        action,
        reasonCodes: reasons,
        ...(note === undefined ? {} : {note}),
      });
      operations.push({
        kind: 'set_assessment',
        dimension: 'information_density',
        score: usefulness,
      });
      operations.push({
        kind: 'set_assessment',
        dimension: 'current_interest',
        score: interest,
      });

      const next = await onApply({
        commandIdempotencyKey: commandKey,
        request: {
          target: {kind: 'fragment', fragmentId: selected.id},
          expectedTargetVersion: target?.currentVersion ?? 0,
          operations,
        },
      });
      setFeedback(next);
      if (next.kind === 'success') {
        setCommandKey(createCommandKey('curation'));
        onApplied(selected.key);
      }
    } finally {
      setSubmitting(false);
    }
  }

  const recommended = recommendReviewAction(
    usefulness,
    interest,
    selected.fragment.selectedText,
  );
  const effectiveKnowledgeKind = preferredKnowledgeKind(
    keywords.map(({value}) => value),
    vocabularyPreferences,
  );
  const processingPlan = deriveReviewProcessingPlan(
    action,
    selected.fragment.selectedText,
    effectiveKnowledgeKind,
  );
  const quickTags =
    reviewPreferences.status === 'ready'
      ? reviewPreferences.value.quickTags
      : sessionReviewPreferences.quickTags;

  return (
    <form
      className="review-fast-form"
      onSubmit={(event) => {
        void submit(event);
      }}
    >
      <article
        className="review-fragment-panel"
        aria-labelledby="fragment-review-title"
      >
        <header className="review-panel-heading">
          <div>
            <p className="section-index">
              FRAGMENT {String(selectedIndex + 1).padStart(2, '0')} /{' '}
              {String(candidates.length).padStart(2, '0')}
            </p>
            <h2 id="fragment-review-title">Fragment 正文</h2>
          </div>
          <span
            className={
              selected.reviewed
                ? 'status-chip status-chip--reviewed'
                : 'status-chip status-chip--pending'
            }
          >
            {selected.reviewed
              ? INTAKE_ACTION_LABELS[selected.action ?? 'needs_review']
              : '待人工判断'}
          </span>
        </header>
        <div className="review-fragment-copy">
          {selected.fragment.selectedText}
        </div>
        <footer className="review-fragment-meta">
          <span>{evidence.sourceKey}</span>
          {evidence.isPrivate === true ? (
            <span className="privacy-badge">隐私内容</span>
          ) : null}
          <button
            className="text-action"
            type="button"
            onClick={(event) => {
              onOpenEvidence(
                selected.snapshotId,
                event.currentTarget,
                selected.id,
              );
            }}
          >
            查看精确原文
          </button>
        </footer>
      </article>

      <section
        className="review-evaluation-panel"
        aria-labelledby="review-evaluation-title"
      >
        <header className="review-panel-heading">
          <div>
            <p className="section-index">MANUAL ASSESSMENT</p>
            <h2 id="review-evaluation-title">人工评价</h2>
          </div>
          <span className="origin-label origin-label--manual">用户操作</span>
        </header>

        <div className="review-score-grid">
          <ScoreControl
            id="review-usefulness"
            label="有用程度"
            description="信息价值"
            value={usefulness}
            onChange={(value) => {
              updateScore('usefulness', value);
            }}
          />
          <ScoreControl
            id="review-interest"
            label="有趣程度"
            description="当前兴趣"
            value={interest}
            onChange={(value) => {
              updateScore('interest', value);
            }}
          />
        </div>

        <fieldset className="review-action-choices">
          <legend>处理倾向</legend>
          <p>
            当前建议：<strong>{INTAKE_ACTION_LABELS[recommended]}</strong>
            。这是审核记录，不会强迫后续按同名动作机械处理。
          </p>
          <div>
            {ACTION_CHOICES.map((value) => (
              <label key={value} data-selected={action === value}>
                <input
                  type="radio"
                  name="review-action"
                  value={value}
                  checked={action === value}
                  onChange={() => {
                    setAction(value);
                    setActionWasChosen(true);
                  }}
                />
                <span>{INTAKE_ACTION_LABELS[value]}</span>
              </label>
            ))}
          </div>
          <div className="review-processing-plan" role="status">
            <strong>{processingPlan.label}</strong>
            <span>{processingPlan.detail}</span>
            {effectiveKnowledgeKind !== undefined ? (
              <small>
                当前词表规则建议知识类型：
                {KNOWLEDGE_KIND_LABELS[effectiveKnowledgeKind]}
              </small>
            ) : null}
          </div>
        </fieldset>

        <fieldset className="review-reason-choices">
          <legend>判断原因（可多选）</legend>
          <div>
            {Object.entries(INTAKE_REASON_LABELS).map(([value, label]) => {
              const reason = value as IntakeReason;
              return (
                <label key={reason} data-selected={reasons.includes(reason)}>
                  <input
                    type="checkbox"
                    checked={reasons.includes(reason)}
                    onChange={(event) => {
                      toggleReason(reason, event.currentTarget.checked);
                    }}
                  />
                  <span>{label}</span>
                </label>
              );
            })}
          </div>
        </fieldset>

        <fieldset className="review-quick-tags">
          <legend>个人快捷标记</legend>
          <p className="review-quick-tags__intro">
            点击标记当前 Fragment；配置保存在外部个人文件。
          </p>
          <div className="review-quick-tags__content">
            {reviewPreferences.status === 'loading' ? (
              <p className="review-quick-tags__state" role="status">
                正在读取快捷标记…
              </p>
            ) : (
              <>
                {reviewPreferences.status !== 'ready' ? (
                  <p className="review-quick-tags__state" role="status">
                    {reviewPreferences.status === 'error'
                      ? reviewPreferences.message
                      : '个人偏好尚未初始化；快捷标记可在本次页面会话中使用。'}
                  </p>
                ) : null}
                <div className="review-quick-tag-list">
                  {quickTags.length === 0 ? (
                    <span className="empty-copy">尚未保存个人快捷标记</span>
                  ) : null}
                  {quickTags.map((tag) => {
                    const selectedTag = keywords.some(
                      ({value}) =>
                        reviewKeywordIdentity(value) ===
                        reviewKeywordIdentity(tag),
                    );
                    return (
                      <span className="review-quick-tag" key={tag}>
                        <button
                          className="review-quick-tag__toggle"
                          type="button"
                          data-selected={selectedTag}
                          aria-pressed={selectedTag}
                          onClick={() => {
                            toggleQuickTag(tag);
                          }}
                        >
                          {tag}
                        </button>
                        <button
                          className="review-quick-tag__remove"
                          type="button"
                          disabled={savingQuickTags}
                          aria-label={`从快捷栏删除 ${tag}`}
                          title="只从快捷栏移除，不修改已审核条目"
                          onClick={() => {
                            void removeQuickTag(tag);
                          }}
                        >
                          ×
                        </button>
                      </span>
                    );
                  })}
                </div>
                <div className="review-quick-tag-add">
                  <label>
                    <span className="visually-hidden">新增快捷标记</span>
                    <input
                      maxLength={120}
                      value={quickTagDraft}
                      placeholder="新增个人标记"
                      onChange={(event) => {
                        setQuickTagDraft(event.currentTarget.value);
                      }}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') {
                          event.preventDefault();
                          void addQuickTag();
                        }
                      }}
                    />
                  </label>
                  <button
                    className="secondary-action"
                    type="button"
                    disabled={savingQuickTags || quickTagDraft.trim() === ''}
                    onClick={() => {
                      void addQuickTag();
                    }}
                  >
                    {savingQuickTags ? '保存中…' : '新增'}
                  </button>
                </div>
                {quickTagFeedback !== '' ? (
                  <p className="review-inline-feedback" role="status">
                    {quickTagFeedback}
                  </p>
                ) : null}
              </>
            )}
          </div>
        </fieldset>

        <details
          className="review-note-disclosure"
          open={noteOpen}
          onToggle={(event) => {
            setNoteOpen(event.currentTarget.open);
          }}
        >
          <summary>补充说明（可选）</summary>
          <label className="field review-note-field">
            <span className="visually-hidden">补充说明</span>
            <textarea
              rows={2}
              maxLength={HUMAN_NOTE_LIMIT}
              value={humanNote}
              onChange={(event) => {
                setHumanNote(event.currentTarget.value);
              }}
              placeholder="只记录这次判断需要保留的说明"
            />
          </label>
        </details>

        <div className="review-submit-bar">
          <button
            className="secondary-action"
            type="button"
            disabled={selectedIndex <= 0 || submitting}
            onClick={() => {
              const previous = candidates[selectedIndex - 1];
              if (previous !== undefined) onSelect(previous.key);
            }}
          >
            返回上一条
          </button>
          <p>返回会载入上一条已保存结果；完成后自动进入下一条。</p>
          <button
            className="primary-action"
            type="submit"
            disabled={submitting}
          >
            {submitting ? '正在保存…' : '完成本条并继续'}
          </button>
        </div>
        <ActionNotice feedback={feedback} />
      </section>

      <section
        className="review-keyword-panel"
        aria-labelledby="review-keyword-title"
      >
        <header className="review-panel-heading">
          <div>
            <p className="section-index">DETERMINISTIC EXTRACTION</p>
            <h2 id="review-keyword-title">自动标签提取</h2>
          </div>
          <span className="status-chip">
            {automaticKeywordPreferences.enabled
              ? `${automaticKeywords.length.toString()} 候选`
              : '已关闭'}
          </span>
        </header>
        <fieldset className="review-keyword-preferences">
          <legend className="visually-hidden">自动标签设置</legend>
          <label className="review-keyword-toggle">
            <input
              type="checkbox"
              role="switch"
              checked={automaticKeywordPreferences.enabled}
              disabled={
                reviewPreferences.status === 'loading' ||
                savingKeywordPreferences
              }
              onChange={(event) => {
                void persistAutomaticKeywordPreferences(
                  {
                    ...automaticKeywordPreferences,
                    enabled: event.currentTarget.checked,
                  },
                  event.currentTarget.checked
                    ? '自动标签已开启。'
                    : '自动标签已关闭；手工标签不受影响。',
                );
              }}
            />
            <span>
              <strong>启用自动标签</strong>
              <small>关闭后只保留手工添加或已经保存的标签。</small>
            </span>
          </label>
          <label className="review-keyword-toggle">
            <input
              type="checkbox"
              checked={automaticKeywordPreferences.includeLinkDomains}
              disabled={
                !automaticKeywordPreferences.enabled ||
                reviewPreferences.status === 'loading' ||
                savingKeywordPreferences
              }
              onChange={(event) => {
                void persistAutomaticKeywordPreferences(
                  {
                    ...automaticKeywordPreferences,
                    includeLinkDomains: event.currentTarget.checked,
                  },
                  event.currentTarget.checked
                    ? '链接域名可以进入自动候选。'
                    : '链接域名已从自动候选中排除。',
                );
              }}
            />
            <span>
              <strong>允许链接域名进入候选</strong>
              <small>默认关闭；URL 路径和文件名始终不会自动入库。</small>
            </span>
          </label>
          <label className="review-keyword-exclusions">
            <span>自动排除词</span>
            <input
              value={excludedKeywordDraft}
              disabled={
                reviewPreferences.status === 'loading' ||
                savingKeywordPreferences
              }
              placeholder="用逗号分隔，例如：广告，下载"
              aria-describedby="review-keyword-exclusions-help"
              onChange={(event) => {
                setExcludedKeywordDraft(event.currentTarget.value);
              }}
              onBlur={saveExcludedKeywordDraft}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  event.currentTarget.blur();
                }
              }}
            />
            <small id="review-keyword-exclusions-help">
              精确匹配；离开输入框后保存到当前外部工作区偏好文件。
            </small>
          </label>
        </fieldset>
        <p className="review-panel-copy">
          在本机从标题、链接标题、代码词和专名提取；只有下方保留的候选会在提交时成为分类。
        </p>
        {keywordPreferenceFeedback !== '' ? (
          <p className="review-inline-feedback" role="status">
            {keywordPreferenceFeedback}
          </p>
        ) : null}
        <div className="review-keyword-list">
          {keywords.length === 0 ? (
            <p className="empty-copy">没有保留的关键词；可手工添加。</p>
          ) : null}
          {keywords.map((keyword, index) => (
            <div key={keyword.key}>
              <label>
                <span className="visually-hidden">
                  关键词 {(index + 1).toString()}
                </span>
                <input
                  maxLength={120}
                  value={keyword.value}
                  onChange={(event) => {
                    const value = event.currentTarget.value;
                    setKeywords((current) =>
                      current.map((item) =>
                        item.key === keyword.key
                          ? {...item, value, origin: 'manual'}
                          : item,
                      ),
                    );
                  }}
                />
              </label>
              <button
                className="text-action"
                type="button"
                aria-label={`删除关键词 ${keyword.value || (index + 1).toString()}`}
                onClick={() => {
                  setKeywords((current) =>
                    current.filter((item) => item.key !== keyword.key),
                  );
                }}
              >
                删除
              </button>
              <KeywordVocabularySuggestions
                keyword={keyword.value}
                state={state}
                onUse={(displayName) => {
                  setKeywords((current) =>
                    current.map((item) =>
                      item.key === keyword.key
                        ? {...item, value: displayName, origin: 'manual'}
                        : item,
                    ),
                  );
                }}
              />
            </div>
          ))}
        </div>
        <div className="review-keyword-tools">
          <button
            className="secondary-action"
            type="button"
            disabled={keywords.length >= MAX_REVIEW_KEYWORDS}
            onClick={() => {
              setKeywords((current) => [
                ...current,
                toKeywordDraft('', 'manual'),
              ]);
            }}
          >
            添加关键词
          </button>
          <button
            className="text-action"
            type="button"
            disabled={
              !automaticKeywordPreferences.enabled ||
              automaticKeywords.length === 0
            }
            onClick={() => {
              setKeywords((current) =>
                reconcileAutomaticKeywordDrafts(current, automaticKeywords),
              );
            }}
          >
            补回自动候选
          </button>
        </div>
      </section>

      <section
        className="review-relation-panel"
        aria-labelledby="review-relation-title"
      >
        <header className="review-panel-heading">
          <div>
            <p className="section-index">LINK INTENT</p>
            <h2 id="review-relation-title">标签与联系编辑</h2>
          </div>
        </header>
        <p className="review-panel-copy">
          这里保存后续关系处理意图，不伪装成已经提交的正式知识关系。
        </p>
        <fieldset className="review-link-policy">
          <legend>联系策略</legend>
          <label>
            <input
              type="radio"
              name="link-policy"
              checked={linkPolicy === 'auto_candidates'}
              onChange={() => {
                setLinkPolicy('auto_candidates');
              }}
            />
            <span>允许按标签生成候选</span>
          </label>
          <label>
            <input
              type="radio"
              name="link-policy"
              checked={linkPolicy === 'manual_only'}
              onChange={() => {
                setLinkPolicy('manual_only');
              }}
            />
            <span>仅使用我明确指定的联系</span>
          </label>
          <label>
            <input
              type="radio"
              name="link-policy"
              checked={linkPolicy === 'no_links'}
              onChange={() => {
                setLinkPolicy('no_links');
                setExplicitLinks([]);
              }}
            />
            <span>拒绝本条与其他条目建立联系</span>
          </label>
        </fieldset>

        <div
          className="review-explicit-link-builder"
          aria-disabled={linkPolicy === 'no_links'}
        >
          <label className="field">
            <span>目标类型</span>
            <select
              value={linkTargetKind}
              disabled={linkPolicy === 'no_links'}
              onChange={(event) => {
                setLinkTargetKind(
                  event.currentTarget.value as ReviewExplicitLink['targetKind'],
                );
              }}
            >
              <option value="fragment">Fragment</option>
              <option value="knowledge_item">知识条目</option>
            </select>
          </label>
          <label className="field">
            <span>目标 ID</span>
            <input
              list={`review-link-targets-${selected.id}`}
              disabled={linkPolicy === 'no_links'}
              value={linkTargetId}
              onChange={(event) => {
                setLinkTargetId(event.currentTarget.value);
              }}
              placeholder="粘贴目标 UUID"
            />
            <datalist id={`review-link-targets-${selected.id}`}>
              {candidates
                .filter((candidate) => candidate.id !== selected.id)
                .map((candidate) => (
                  <option key={candidate.id} value={candidate.id}>
                    {candidate.label}
                  </option>
                ))}
            </datalist>
          </label>
          <label className="field">
            <span>关系类型 key</span>
            <input
              disabled={linkPolicy === 'no_links'}
              value={relationTypeKey}
              onChange={(event) => {
                setRelationTypeKey(event.currentTarget.value);
              }}
              placeholder="related_to"
            />
          </label>
          <button
            className="secondary-action"
            type="button"
            disabled={linkPolicy === 'no_links'}
            onClick={addExplicitLink}
          >
            指定联系
          </button>
        </div>
        {relationFeedback !== '' ? (
          <p className="review-inline-feedback" role="status">
            {relationFeedback}
          </p>
        ) : null}
        <ul className="review-explicit-links">
          {explicitLinks.map((link) => (
            <li
              key={`${link.targetKind}:${link.targetId}:${link.relationTypeKey}`}
            >
              <div>
                <strong>{link.relationTypeKey}</strong>
                <span>
                  {link.targetKind === 'fragment' ? 'Fragment' : '知识条目'} ·{' '}
                  {shortIdentity(link.targetId)}
                </span>
              </div>
              <button
                className="text-action"
                type="button"
                aria-label={`删除联系 ${link.relationTypeKey} ${link.targetId}`}
                onClick={() => {
                  setExplicitLinks((current) =>
                    current.filter((candidate) => candidate !== link),
                  );
                }}
              >
                删除
              </button>
            </li>
          ))}
        </ul>
      </section>
    </form>
  );
}

function ScoreControl({
  description,
  id,
  label,
  onChange,
  value,
}: {
  readonly description: string;
  readonly id: string;
  readonly label: string;
  readonly onChange: (value: ReviewScore) => void;
  readonly value: ReviewScore;
}) {
  return (
    <div className="review-score-control">
      <span>
        <span>
          <label htmlFor={id}>{label}</label>
          <small>{description}</small>
        </span>
        <output htmlFor={id} aria-label={`${label}当前评分`}>
          {(value + 1).toString()}
          <small>/5</small>
        </output>
      </span>
      <input
        id={id}
        type="range"
        min="0"
        max="4"
        step="1"
        value={value}
        aria-label={label}
        aria-valuetext={`${(value + 1).toString()} / 5，${REVIEW_SCORE_LEVELS[value]}`}
        onChange={(event) => {
          onChange(Number(event.currentTarget.value) as ReviewScore);
        }}
      />
      <span className="review-score-scale" aria-hidden="true">
        {REVIEW_SCORE_LEVELS.map((level, index) => (
          <i data-current={index === value} key={level}>
            <b>{(index + 1).toString()}</b>
            <span>{level}</span>
          </i>
        ))}
      </span>
    </div>
  );
}

function UnavailableReview({
  state,
}: {
  readonly state: Loadable<Readonly<CurationState>>;
}) {
  if (state.status === 'loading') {
    return (
      <div className="loading-state" role="status" aria-busy="true">
        <span aria-hidden="true" />
        正在读取当前审核状态…
      </div>
    );
  }
  return (
    <div className="error-state" role="alert">
      <h2>审核状态暂不可用</h2>
      <p>
        {state.status === 'error'
          ? state.message
          : '当前工作区还没有可读取的审核状态。'}
      </p>
    </div>
  );
}

function createReviewEditorInitialState(
  state: Readonly<CurationState>,
  selected: Readonly<ReviewQueueCandidate>,
  automaticKeywords: readonly string[],
): Readonly<ReviewEditorInitialState> {
  const target = findCurationTarget(state, selected.id);
  const decision =
    target === undefined
      ? undefined
      : state.decisions.find(
          (candidate) => candidate.targetId === target.targetId,
        );
  const decodedNote = decodeReviewNote(decision?.value.note);
  const usefulness =
    readScore(state, target?.targetId, 'information_density') ?? 2;
  const interest = readScore(state, target?.targetId, 'current_interest') ?? 2;
  const persistedKeywords = assignedKeywordValues(state, target?.targetId);
  const useAutomaticKeywords =
    decision === undefined && persistedKeywords.length === 0;
  const initialKeywords = useAutomaticKeywords
    ? automaticKeywords
    : persistedKeywords;
  return Object.freeze({
    usefulness,
    interest,
    action:
      decision?.value.action ??
      recommendReviewAction(
        usefulness,
        interest,
        selected.fragment.selectedText,
      ),
    actionWasChosen: decision !== undefined,
    reasons: decision?.value.reasonCodes ?? [],
    humanNote: decodedNote.humanNote,
    keywords: initialKeywords.map((value) =>
      toKeywordDraft(value, useAutomaticKeywords ? 'automatic' : 'manual'),
    ),
    linkPolicy: decodedNote.directive.linkPolicy,
    explicitLinks: decodedNote.directive.explicitLinks,
  });
}

function findCurationTarget(
  state: Readonly<CurationState>,
  fragmentId: string,
) {
  return state.targets.find(
    (candidate) =>
      candidate.kind === 'fragment' && candidate.fragmentId === fragmentId,
  );
}

function readScore(
  state: Readonly<CurationState>,
  targetId: string | undefined,
  dimension: 'information_density' | 'current_interest',
): ReviewScore | undefined {
  if (targetId === undefined) return undefined;
  const assessment = state.assessments.find(
    (candidate) =>
      candidate.targetId === targetId && candidate.dimension === dimension,
  );
  return assessment?.value.state === 'rated'
    ? assessment.value.score
    : undefined;
}

function assignedTermIds(
  state: Readonly<CurationState>,
  targetId?: string,
): ReadonlySet<string> {
  if (targetId === undefined) return new Set();
  return new Set(
    state.assignments
      .filter(
        (assignment) =>
          assignment.targetId === targetId && assignment.state === 'assigned',
      )
      .map((assignment) => assignment.termId),
  );
}

function assignedKeywordValues(
  state: Readonly<CurationState>,
  targetId?: string,
): readonly string[] {
  const termIds = assignedTermIds(state, targetId);
  return state.terms
    .filter(
      (term) => termIds.has(term.termId) && term.value.lifecycle === 'active',
    )
    .map((term) => term.value.displayName);
}

function toKeywordDraft(
  value: string,
  origin: KeywordDraft['origin'] = 'manual',
): KeywordDraft {
  return {key: createClientUuid(), value, origin};
}

function extractAutomaticReviewKeywords(
  selectedText: string,
  preferences: Readonly<ReviewAutomaticKeywordPreferences>,
  vocabularyPreferences: Readonly<
    ReviewPreferencesWrite['vocabulary']
  > = DEFAULT_REVIEW_VOCABULARY,
): readonly string[] {
  if (!preferences.enabled) return [];
  return uniqueKeywords(
    extractReviewKeywords(selectedText, 8, {
      includeLinkDomains: preferences.includeLinkDomains,
      excludedKeywords: preferences.excludedKeywords,
    }).map((keyword) =>
      canonicalizeReviewKeyword(keyword, vocabularyPreferences),
    ),
  );
}

function synchronizeAutomaticKeywordDrafts(
  current: readonly KeywordDraft[],
  automaticKeywords: readonly string[],
  reviewed: boolean,
): readonly KeywordDraft[] {
  const hasAutomaticDrafts = current.some(
    (keyword) => keyword.origin === 'automatic',
  );
  if (!hasAutomaticDrafts && reviewed) return current;
  return reconcileAutomaticKeywordDrafts(current, automaticKeywords);
}

function reconcileAutomaticKeywordDrafts(
  current: readonly KeywordDraft[],
  automaticKeywords: readonly string[],
): readonly KeywordDraft[] {
  const manual = current.filter((keyword) => keyword.origin === 'manual');
  const manualIdentities = new Set(
    manual.map((keyword) => reviewKeywordIdentity(keyword.value)),
  );
  const automatic = automaticKeywords
    .filter((keyword) => !manualIdentities.has(reviewKeywordIdentity(keyword)))
    .slice(0, Math.max(0, MAX_REVIEW_KEYWORDS - manual.length))
    .map((keyword) => toKeywordDraft(keyword, 'automatic'));
  return [...automatic, ...manual].slice(0, MAX_REVIEW_KEYWORDS);
}

function KeywordVocabularySuggestions({
  keyword,
  onUse,
  state,
}: {
  readonly keyword: string;
  readonly onUse: (displayName: string) => void;
  readonly state: Readonly<CurationState>;
}) {
  const suggestions = vocabularySuggestionsForKeyword(keyword, state.terms);
  if (suggestions.length === 0) return null;
  return (
    <div className="review-keyword-suggestions" aria-label="相近已有词条">
      <span>可能相近：</span>
      {suggestions.map((suggestion) => (
        <button
          className="text-action"
          type="button"
          key={suggestion.termId}
          title={
            suggestion.reason === 'contains'
              ? '当前候选包含这个已有词条'
              : '这个已有词条包含当前候选'
          }
          onClick={() => {
            onUse(suggestion.displayName);
          }}
        >
          改用“{suggestion.displayName}”
        </button>
      ))}
    </div>
  );
}

function parseExcludedKeywords(value: string): readonly string[] {
  return uniqueKeywords(
    value
      .split(/[\n,，;；]+/gu)
      .map((candidate) => candidate.trim())
      .filter((candidate) => candidate !== ''),
    MAX_REVIEW_KEYWORD_EXCLUSIONS,
  );
}

function keywordListsEqual(
  left: readonly string[],
  right: readonly string[],
): boolean {
  return (
    left.length === right.length &&
    left.every(
      (value, index) =>
        reviewKeywordIdentity(value) ===
        reviewKeywordIdentity(right[index] ?? ''),
    )
  );
}

function uniqueKeywords(
  values: readonly string[],
  limit = MAX_REVIEW_KEYWORDS,
): readonly string[] {
  const result: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const normalized = normalizeReviewKeyword(value);
    const identity = reviewKeywordIdentity(normalized);
    if (identity === '' || seen.has(identity)) continue;
    seen.add(identity);
    result.push(normalized);
    if (result.length >= limit) break;
  }
  return result;
}

function shortIdentity(value: string): string {
  return value.length <= 16 ? value : `${value.slice(0, 8)}…${value.slice(-4)}`;
}
