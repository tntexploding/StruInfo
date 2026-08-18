import {useMemo, useState} from 'react';
import type {SyntheticEvent} from 'react';

import {
  KNOWLEDGE_KINDS,
  type CurationState,
  type KnowledgeKind,
  type ReviewPreferencesResponse,
  type ReviewPreferencesWrite,
} from '../api/m1c_api_contract.js';
import {ActionNotice} from '../components/action_notice.js';
import {createCommandKey} from '../components/client_identity.js';
import {KNOWLEDGE_KIND_LABELS} from '../components/product_labels.js';
import type {ActionFeedback} from '../components/product_types.js';
import {
  normalizeReviewKeyword,
  reviewKeywordIdentity,
} from './review_keyword_extractor.js';
import {
  buildVocabularyPairSuggestions,
  withPreferredKnowledgeKind,
  withVocabularyAlias,
  withVocabularyLink,
} from './review_vocabulary.js';

type ReconciliationAction =
  'alias' | 'translation' | 'related' | 'knowledge_kind';

export interface VocabularyWorkbenchProps {
  readonly state: Readonly<CurationState>;
  readonly preferences: Readonly<ReviewPreferencesResponse>;
  readonly onApplyCuration: (body: unknown) => Promise<ActionFeedback>;
  readonly onPutTerm: (body: unknown) => Promise<ActionFeedback>;
  readonly onRefresh: () => void;
  readonly onSavePreferences: (
    preferences: Readonly<ReviewPreferencesWrite>,
  ) => Promise<ActionFeedback>;
}

export function VocabularyWorkbench({
  onApplyCuration,
  onPutTerm,
  onRefresh,
  onSavePreferences,
  preferences,
  state,
}: VocabularyWorkbenchProps) {
  const activeTerms = useMemo(
    () =>
      state.terms
        .filter((term) => term.value.lifecycle === 'active')
        .sort((left, right) =>
          left.value.displayName.localeCompare(right.value.displayName),
        ),
    [state.terms],
  );
  const suggestions = useMemo(
    () => buildVocabularyPairSuggestions(activeTerms),
    [activeTerms],
  );
  const [source, setSource] = useState('');
  const [targetTermId, setTargetTermId] = useState(
    activeTerms[0]?.termId ?? '',
  );
  const [action, setAction] = useState<ReconciliationAction>('alias');
  const [knowledgeKind, setKnowledgeKind] = useState<KnowledgeKind>('work');
  const [confirmed, setConfirmed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<ActionFeedback>();

  const normalizedSource = normalizeReviewKeyword(source);
  const target = activeTerms.find((term) => term.termId === targetTermId);
  const sourceTerm =
    activeTerms.find((term) => term.value.displayName === normalizedSource) ??
    activeTerms.find(
      (term) =>
        reviewKeywordIdentity(term.value.displayName) ===
        reviewKeywordIdentity(normalizedSource),
    );
  const mergeRequired =
    action === 'alias' &&
    sourceTerm !== undefined &&
    sourceTerm.termId !== target?.termId;
  const caseVariantMerge =
    mergeRequired &&
    target !== undefined &&
    reviewKeywordIdentity(sourceTerm.value.displayName) ===
      reviewKeywordIdentity(target.value.displayName);

  async function submit(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    if (
      target === undefined ||
      (action !== 'knowledge_kind' && normalizedSource === '')
    ) {
      setFeedback({
        kind: 'error',
        title: '词表规则尚不完整',
        detail: '输入来源词并选择一个现有的规范词条。',
      });
      return;
    }
    if (
      action !== 'knowledge_kind' &&
      reviewKeywordIdentity(normalizedSource) ===
        reviewKeywordIdentity(target.value.displayName) &&
      !mergeRequired
    ) {
      setFeedback({
        kind: 'error',
        title: '两端是同一个词条',
        detail: '请选择另一个规范词条，或改为设置优先知识类型。',
      });
      return;
    }
    if (mergeRequired && !confirmed) {
      setFeedback({
        kind: 'error',
        title: '需要明确确认合并',
        detail: '确认后才会迁移当前分类引用并退役来源词条。',
      });
      return;
    }

    setSubmitting(true);
    setFeedback(undefined);
    try {
      const vocabulary =
        action === 'alias'
          ? caseVariantMerge
            ? preferences.vocabulary
            : withVocabularyAlias(
                preferences.vocabulary,
                normalizedSource,
                target.value.displayName,
              )
          : action === 'knowledge_kind'
            ? withPreferredKnowledgeKind(
                preferences.vocabulary,
                target.value.displayName,
                knowledgeKind,
              )
            : withVocabularyLink(
                preferences.vocabulary,
                normalizedSource,
                target.value.displayName,
                action,
              );
      const saved = await onSavePreferences({
        quickTags: preferences.quickTags,
        automaticKeywords: preferences.automaticKeywords,
        vocabulary,
      });
      if (saved.kind !== 'success') {
        setFeedback(saved);
        return;
      }

      if (mergeRequired) {
        const merged = await migrateCurrentAssignments(
          state,
          sourceTerm.termId,
          target.termId,
          onApplyCuration,
        );
        if (merged.kind !== 'success') {
          setFeedback(merged);
          return;
        }
        const retired = await onPutTerm({
          commandIdempotencyKey: createCommandKey('vocabulary-retire'),
          request: {
            termId: sourceTerm.termId,
            expectedRevision: sourceTerm.currentRevision,
            value: {
              displayName: sourceTerm.value.displayName,
              ...(sourceTerm.value.description === undefined
                ? {}
                : {description: sourceTerm.value.description}),
              ...(sourceTerm.value.parentTermId === undefined
                ? {}
                : {parentTermId: sourceTerm.value.parentTermId}),
              lifecycle: 'retired',
            },
          },
        });
        if (retired.kind !== 'success') {
          setFeedback(retired);
          return;
        }
      }

      setFeedback({
        kind: 'success',
        title: '词表规则已保存',
        detail:
          action === 'alias'
            ? mergeRequired
              ? caseVariantMerge
                ? '大小写变体的当前分类已迁移到规范词条，来源词条已退役；历史修订仍保留。'
                : '当前分类已迁移到规范词条，来源词条已退役；历史修订仍保留。'
              : '后续提取到这个写法时会复用规范词条。'
            : action === 'knowledge_kind'
              ? '匹配该词条的审核项会显示所选知识类型与处理计划。'
              : '联系作为外部工作区词表规则保存，不伪装成正式知识关系。',
      });
      setSource('');
      setConfirmed(false);
      onRefresh();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section
      className="vocabulary-workbench"
      aria-labelledby="vocabulary-workbench-title"
    >
      <header className="console-heading">
        <div>
          <p className="section-index">VOCABULARY / USER RULES</p>
          <h2 id="vocabulary-workbench-title">词表整理</h2>
        </div>
        <span className="origin-label origin-label--manual">
          外部工作区配置
        </span>
      </header>
      <p className="section-introduction">
        大小写变体直接归一；中英文等价由你设为别名；相近但不等价的词只建立翻译或近义联系。系统不会自动执行语义合并。
      </p>

      {suggestions.length > 0 ? (
        <div className="vocabulary-suggestions">
          <strong>确定性候选</strong>
          <div>
            {suggestions.slice(0, 8).map((suggestion) => (
              <button
                className="secondary-action"
                type="button"
                key={`${suggestion.left.termId}:${suggestion.right.termId}`}
                onClick={() => {
                  setSource(suggestion.left.value.displayName);
                  setTargetTermId(suggestion.right.termId);
                  setAction('alias');
                  setConfirmed(false);
                }}
              >
                {suggestion.left.value.displayName} ↔{' '}
                {suggestion.right.value.displayName}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      <form
        className="vocabulary-rule-form"
        onSubmit={(event) => {
          void submit(event);
        }}
      >
        <label className="field">
          <span>来源写法或词条</span>
          <input
            required={action !== 'knowledge_kind'}
            disabled={action === 'knowledge_kind'}
            list="vocabulary-active-terms"
            maxLength={120}
            value={source}
            placeholder={
              action === 'knowledge_kind'
                ? '此操作直接使用右侧规范词条'
                : '输入别名或选择现有词条'
            }
            onChange={(event) => {
              setSource(event.currentTarget.value);
              setConfirmed(false);
            }}
          />
        </label>
        <datalist id="vocabulary-active-terms">
          {activeTerms.map((term) => (
            <option key={term.termId} value={term.value.displayName} />
          ))}
        </datalist>
        <label className="field">
          <span>规范词条</span>
          <select
            required
            value={targetTermId}
            onChange={(event) => {
              setTargetTermId(event.currentTarget.value);
              setConfirmed(false);
            }}
          >
            {activeTerms.map((term) => (
              <option key={term.termId} value={term.termId}>
                {term.value.displayName}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>处理方式</span>
          <select
            value={action}
            onChange={(event) => {
              setAction(event.currentTarget.value as ReconciliationAction);
              setConfirmed(false);
            }}
          >
            <option value="alias">设为别名 / 合并重复词条</option>
            <option value="translation">建立中英文或翻译联系</option>
            <option value="related">建立近义或紧密联系</option>
            <option value="knowledge_kind">设置优先知识类型</option>
          </select>
        </label>
        {action === 'knowledge_kind' ? (
          <label className="field">
            <span>优先知识类型</span>
            <select
              value={knowledgeKind}
              onChange={(event) => {
                setKnowledgeKind(event.currentTarget.value as KnowledgeKind);
              }}
            >
              {KNOWLEDGE_KINDS.map((kind) => (
                <option key={kind} value={kind}>
                  {KNOWLEDGE_KIND_LABELS[kind]}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        {mergeRequired ? (
          <label className="vocabulary-merge-confirmation">
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(event) => {
                setConfirmed(event.currentTarget.checked);
              }}
            />
            <span>
              确认把“{sourceTerm.value.displayName}”的当前分类迁移到“
              {target?.value.displayName}”并退役来源词条
            </span>
          </label>
        ) : null}
        <button
          className="primary-action"
          type="submit"
          disabled={submitting || activeTerms.length === 0}
        >
          {submitting ? '正在保存…' : '保存词表规则'}
        </button>
      </form>

      <div className="vocabulary-rule-summary">
        <span>{preferences.vocabulary.aliases.length} 条别名</span>
        <span>{preferences.vocabulary.links.length} 条词表联系</span>
        <span>
          {preferences.vocabulary.knowledgeKinds.length} 条知识类型规则
        </span>
      </div>
      <ActionNotice feedback={feedback} />
    </section>
  );
}

async function migrateCurrentAssignments(
  state: Readonly<CurationState>,
  sourceTermId: string,
  targetTermId: string,
  onApplyCuration: (body: unknown) => Promise<ActionFeedback>,
): Promise<ActionFeedback> {
  const sourceAssignments = state.assignments.filter(
    (assignment) =>
      assignment.termId === sourceTermId && assignment.state === 'assigned',
  );
  for (const assignment of sourceAssignments) {
    const target = state.targets.find(
      (candidate) => candidate.targetId === assignment.targetId,
    );
    if (target === undefined) {
      return {
        kind: 'error',
        title: '分类引用不完整',
        detail: '缺少一个当前审核目标；没有退役来源词条。',
      };
    }
    const targetAlreadyAssigned = state.assignments.some(
      (candidate) =>
        candidate.targetId === assignment.targetId &&
        candidate.termId === targetTermId &&
        candidate.state === 'assigned',
    );
    const result = await onApplyCuration({
      commandIdempotencyKey: createCommandKey('vocabulary-merge'),
      request: {
        target:
          target.kind === 'snapshot'
            ? {kind: 'snapshot', snapshotId: target.snapshotId}
            : {kind: 'fragment', fragmentId: target.fragmentId},
        expectedTargetVersion: target.currentVersion,
        operations: [
          {kind: 'remove_classification', termId: sourceTermId},
          ...(targetAlreadyAssigned
            ? []
            : [{kind: 'assign_classification', termId: targetTermId}]),
        ],
      },
    });
    if (result.kind !== 'success') return result;
  }
  return {
    kind: 'success',
    title: '当前分类已迁移',
    detail: `${sourceAssignments.length.toString()} 个当前引用已迁移。`,
  };
}
