import {readingTitle, sourceDisplayName} from '../components/reading_text.js';
import {useEffect, useId, useMemo, useState} from 'react';
import type {SyntheticEvent} from 'react';

import {
  DEFAULT_REVIEW_VOCABULARY,
  ENTRY_DOMAIN_KEYWORDS,
  ENTRY_TYPE_KEYWORDS,
  type EntryDomainKeyword,
  type EntryTypeKeyword,
  type InformationEntry,
  type InformationEntryDocumentView,
  type M1cHttpResponse,
  type ReviewPreferencesResponse,
  type ReviewPreferencesWrite,
} from '../api/m1c_api_contract.js';
import {ActionNotice} from '../components/action_notice.js';
import type {ActionFeedback, Loadable} from '../components/product_types.js';
import type {InformationEntryServices} from './information_entry_components.js';
import {InformationEntryReviewControls} from './information_entry_review_controls.js';
import {reviewKeywordIdentity} from './review_keyword_extractor.js';
import {canonicalizeReviewKeyword} from './review_vocabulary.js';
import {
  DOMAIN_LABELS,
  TYPE_LABELS,
  describeInformationEntryFailure,
} from './information_entry_shared.js';

export function InformationDocumentPanel({
  document,
  includePrivate,
  onAggregate,
  onChanged,
  onOpenDocument,
  onRevise,
}: {
  readonly document: Readonly<InformationEntryDocumentView>;
  readonly includePrivate: boolean;
  readonly onAggregate: InformationEntryServices['onAggregateDocumentTags'];
  readonly onChanged: (feedback: ActionFeedback) => Promise<void>;
  readonly onOpenDocument: () => void;
  readonly onRevise: InformationEntryServices['onReviseDocumentTags'];
}) {
  const documentTitleId = useId();
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [tagsText, setTagsText] = useState(
    document.currentTags?.value.tags
      .map((tag) => tag.displayValue)
      .join('，') ?? '',
  );
  const [localFeedback, setLocalFeedback] = useState<ActionFeedback>();
  const expectedRevision = document.currentTags?.revision ?? 0;

  async function aggregate() {
    if (busy) return;
    setBusy(true);
    setLocalFeedback(undefined);
    try {
      const response = await onAggregate(document.snapshotId, {
        expectedRevision,
        includePrivate,
      });
      if (
        response.body.status !== 'applied' &&
        response.body.status !== 'unchanged'
      ) {
        setLocalFeedback({
          kind: 'error',
          title: '文档标签没有更新',
          detail: describeInformationEntryFailure(response.body),
        });
        return;
      }
      await onChanged({
        kind: 'success',
        title:
          response.body.status === 'applied'
            ? '文档标签已重新聚合'
            : '聚合结果没有变化',
        detail: '全文出现次数决定主要顺序，条目关键词覆盖率作为辅助参考。',
      });
    } catch {
      setLocalFeedback({
        kind: 'error',
        title: '本地接口不可达',
        detail: '当前标签没有变化；文档和条目保持不变。',
      });
    } finally {
      setBusy(false);
    }
  }

  async function save(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const tags = tagsText
      .split(/[，,\n]/u)
      .map((value) => value.trim())
      .filter((value) => value !== '');
    setBusy(true);
    setLocalFeedback(undefined);
    try {
      const response = await onRevise(document.snapshotId, {
        expectedRevision,
        includePrivate,
        tags,
      });
      if (
        response.body.status !== 'applied' &&
        response.body.status !== 'unchanged'
      ) {
        setLocalFeedback({
          kind: 'error',
          title: '人工标签没有保存',
          detail: describeInformationEntryFailure(response.body),
        });
        return;
      }
      setEditing(false);
      await onChanged({
        kind: 'success',
        title:
          response.body.status === 'applied'
            ? '人工标签状态已保存'
            : '人工标签没有变化',
        detail: '这次修改独立成版；后续重新聚合也必须由用户明确触发。',
      });
    } catch {
      setLocalFeedback({
        kind: 'error',
        title: '本地接口不可达',
        detail: '人工标签状态没有变化。',
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="entry-document-panel" aria-labelledby={documentTitleId}>
      <header className="console-heading">
        <div>
          <h2 id={documentTitleId}>{sourceDisplayName(document)}</h2>
          <p>
            {document.entryCount.toString()} 个条目 ·{' '}
            {document.annotatedEntryCount.toString()} 个已有标签
            {document.currentTags === undefined
              ? ' · 尚无文档标签'
              : ` · 标签状态 v${document.currentTags.revision.toString()}`}
          </p>
        </div>
        <button
          className="secondary-action"
          type="button"
          onClick={onOpenDocument}
        >
          查看完整文档
        </button>
      </header>
      <div className="entry-document-panel__body">
        <div>
          <div className="entry-document-tags" aria-label="当前文档标签">
            {(document.currentTags?.value.tags.length ?? 0) === 0 ? (
              <span className="entry-document-tags__empty">
                为条目标注内容关键词后，可以汇总为文档标签。
              </span>
            ) : (
              document.currentTags?.value.tags.map((tag) => (
                <span key={tag.normalizedValue} className="entry-document-tag">
                  <strong>{tag.displayValue}</strong>
                  <small>
                    全文 {tag.fullTextOccurrences.toString()} · 条目{' '}
                    {tag.entryCoverageCount.toString()}/
                    {document.currentTags?.value.entryCount.toString()}
                  </small>
                </span>
              ))
            )}
          </div>
          <p className="entry-document-panel__rule">
            {document.currentTags === undefined
              ? '尚未执行聚合'
              : document.currentTags.value.revisionKind === 'manual'
                ? '人工设置'
                : '自动生成'}
          </p>
        </div>
        <div className="entry-document-panel__actions">
          <button
            className="secondary-action"
            type="button"
            disabled={busy}
            onClick={() => void aggregate()}
          >
            {busy ? '处理中…' : '按全文重新聚合'}
          </button>
          <button
            className="secondary-action"
            type="button"
            onClick={() => {
              setEditing((current) => !current);
            }}
          >
            {editing ? '取消编辑' : '人工编辑标签'}
          </button>
        </div>
      </div>
      {editing ? (
        <form
          className="entry-document-tag-editor"
          onSubmit={(event) => {
            void save(event);
          }}
        >
          <label className="field field--full">
            <span>文档标签（逗号或换行分隔）</span>
            <textarea
              rows={3}
              value={tagsText}
              onChange={(event) => {
                setTagsText(event.currentTarget.value);
              }}
              placeholder="留空并保存可清除当前文档标签"
            />
          </label>
          <button className="primary-action" type="submit" disabled={busy}>
            保存当前标签
          </button>
        </form>
      ) : null}
      <ActionNotice feedback={localFeedback} />
    </section>
  );
}

export interface EntryEditorDraft {
  readonly body: string;
  readonly usefulnessScore: 1 | 2 | 3 | 4 | 5;
  readonly interestScore: 1 | 2 | 3 | 4 | 5;
  readonly contentKeywords: string;
  readonly typeKeyword: EntryTypeKeyword;
  readonly typeCustomName: string;
  readonly primaryDomain: '' | EntryDomainKeyword;
  readonly secondaryDomain: '' | EntryDomainKeyword;
  readonly thirdDomain: '' | EntryDomainKeyword;
  readonly domainCustomNames: readonly string[];
}

export function InformationEntryEditor({
  entry,
  includePrivate,
  onOpenEvidence,
  onLocateDocument,
  onPreferencesChange,
  overridePreferences,
  onNext,
  onPrevious,
  onRevise,
  onSavePreferences,
  onSaved,
  reviewPreferences,
  initialDraft,
  onDraftChange,
  presentation = 'review',
}: {
  readonly entry: Readonly<InformationEntry>;
  readonly includePrivate: boolean;
  readonly onOpenEvidence: InformationEntryServices['onOpenEvidence'];
  readonly onLocateDocument: () => void;
  readonly onPreferencesChange: (
    value: Readonly<ReviewPreferencesWrite>,
  ) => void;
  readonly overridePreferences?: Readonly<ReviewPreferencesWrite> | undefined;
  readonly onNext?: (() => void) | undefined;
  readonly onPrevious?: (() => void) | undefined;
  readonly onRevise: InformationEntryServices['onRevise'];
  readonly onSavePreferences: (
    value: Readonly<ReviewPreferencesWrite>,
  ) => Promise<M1cHttpResponse<ReviewPreferencesResponse>>;
  readonly onSaved: (feedback: ActionFeedback) => Promise<void>;
  readonly initialDraft?: Readonly<EntryEditorDraft> | undefined;
  readonly onDraftChange?:
    ((draft: Readonly<EntryEditorDraft> | undefined) => void) | undefined;
  readonly presentation?: 'review' | 'workbench';
  readonly reviewPreferences: Loadable<Readonly<ReviewPreferencesResponse>>;
}) {
  const editorHeadingId = useId();
  const [body, setBody] = useState(initialDraft?.body ?? entry.value.body);
  const [usefulnessScore, setUsefulnessScore] = useState<1 | 2 | 3 | 4 | 5>(
    initialDraft?.usefulnessScore ?? entry.value.usefulnessScore ?? 3,
  );
  const [interestScore, setInterestScore] = useState<1 | 2 | 3 | 4 | 5>(
    initialDraft?.interestScore ?? entry.value.interestScore ?? 3,
  );
  const [contentKeywords, setContentKeywords] = useState(
    initialDraft?.contentKeywords ??
      entry.value.contentKeywords.map((value) => value.displayValue).join('，'),
  );
  const [typeKeyword, setTypeKeyword] = useState<EntryTypeKeyword>(
    initialDraft?.typeKeyword ?? entry.value.typeKeyword ?? 'factual_material',
  );
  const [typeCustomName, setTypeCustomName] = useState(
    initialDraft?.typeCustomName ?? entry.value.typeCustomName ?? '',
  );
  const initialDomains = entry.value.domains.map((value) => value.keyword);
  const initialCustomDomains = entry.value.domains.map(
    (value) => value.customName ?? '',
  );
  const [primaryDomain, setPrimaryDomain] = useState<'' | EntryDomainKeyword>(
    initialDraft?.primaryDomain ?? initialDomains[0] ?? '',
  );
  const [secondaryDomain, setSecondaryDomain] = useState<
    '' | EntryDomainKeyword
  >(initialDraft?.secondaryDomain ?? initialDomains[1] ?? '');
  const [thirdDomain, setThirdDomain] = useState<'' | EntryDomainKeyword>(
    initialDraft?.thirdDomain ?? initialDomains[2] ?? '',
  );
  const [domainCustomNames, setDomainCustomNames] = useState<readonly string[]>(
    initialDraft?.domainCustomNames ?? [
      initialCustomDomains[0] ?? '',
      initialCustomDomains[1] ?? '',
      initialCustomDomains[2] ?? '',
    ],
  );
  const [saving, setSaving] = useState(false);
  const [localFeedback, setLocalFeedback] = useState<ActionFeedback>();
  const draft = useMemo<Readonly<EntryEditorDraft>>(
    () => ({
      body,
      usefulnessScore,
      interestScore,
      contentKeywords,
      typeKeyword,
      typeCustomName,
      primaryDomain,
      secondaryDomain,
      thirdDomain,
      domainCustomNames,
    }),
    [
      body,
      usefulnessScore,
      interestScore,
      contentKeywords,
      typeKeyword,
      typeCustomName,
      primaryDomain,
      secondaryDomain,
      thirdDomain,
      domainCustomNames,
    ],
  );
  const dirty =
    body !== entry.value.body ||
    usefulnessScore !== (entry.value.usefulnessScore ?? 3) ||
    interestScore !== (entry.value.interestScore ?? 3) ||
    contentKeywords !==
      entry.value.contentKeywords
        .map((value) => value.displayValue)
        .join('，') ||
    typeKeyword !== (entry.value.typeKeyword ?? 'factual_material') ||
    typeCustomName !== (entry.value.typeCustomName ?? '') ||
    primaryDomain !== (initialDomains[0] ?? '') ||
    secondaryDomain !== (initialDomains[1] ?? '') ||
    thirdDomain !== (initialDomains[2] ?? '') ||
    domainCustomNames.some(
      (value, index) => value !== (initialCustomDomains[index] ?? ''),
    );
  useEffect(() => {
    onDraftChange?.(dirty ? draft : undefined);
  }, [dirty, draft, onDraftChange]);
  const activeVocabulary =
    overridePreferences?.vocabulary ??
    (reviewPreferences.status === 'ready'
      ? reviewPreferences.value.vocabulary
      : DEFAULT_REVIEW_VOCABULARY);

  async function save(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;
    const seenKeywords = new Set<string>();
    const keywords = contentKeywords
      .split(/[，,\n]/u)
      .map((value) => canonicalizeReviewKeyword(value, activeVocabulary))
      .filter((value) => {
        const identity = reviewKeywordIdentity(value);
        if (identity === '' || seenKeywords.has(identity)) return false;
        seenKeywords.add(identity);
        return true;
      });
    if (primaryDomain === '') {
      setLocalFeedback({
        kind: 'error',
        title: '请选择一个主领域',
        detail: '主领域用于文档聚合；不会从来源或用户偏好中静默猜测。',
      });
      return;
    }
    const selections = [
      {keyword: primaryDomain, customName: domainCustomNames[0] ?? ''},
      ...(secondaryDomain === ''
        ? []
        : [
            {
              keyword: secondaryDomain,
              customName: domainCustomNames[1] ?? '',
            },
          ]),
      ...(thirdDomain === ''
        ? []
        : [
            {
              keyword: thirdDomain,
              customName: domainCustomNames[2] ?? '',
            },
          ]),
    ];
    if (keywords.length === 0) {
      setLocalFeedback({
        kind: 'error',
        title: '至少需要一个内容关键词',
        detail: '关键词用于搜索和推荐联系，不会替代正文。',
      });
      return;
    }
    setSaving(true);
    setLocalFeedback(undefined);
    try {
      const response = await onRevise(entry.entryId, {
        expectedRevision: entry.revision,
        includePrivate,
        annotation: {
          body,
          usefulnessScore,
          interestScore,
          contentKeywords: keywords,
          typeKeyword,
          ...(typeKeyword === 'other' ? {typeCustomName} : {}),
          domains: selections.map(({customName, keyword}) => ({
            keyword,
            ...(keyword === 'other' ? {customName} : {}),
          })),
        },
      });
      if (
        response.body.status !== 'applied' &&
        response.body.status !== 'unchanged'
      ) {
        setLocalFeedback({
          kind: 'error',
          title: '条目标注没有保存',
          detail: describeInformationEntryFailure(response.body),
        });
        return;
      }
      await onSaved({
        kind: 'success',
        title:
          response.body.status === 'applied'
            ? '条目已保存'
            : '条目内容没有变化',
        detail:
          response.body.status === 'applied'
            ? '已导入的原文保持不变；搜索会读取更新后的条目。'
            : '当前最终状态没有变化。',
      });
      onNext?.();
    } catch {
      setLocalFeedback({
        kind: 'error',
        title: '本地接口不可达',
        detail: '本次编辑没有保存；原始文档与当前条目保持不变。',
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <section
      className="entry-editor"
      aria-labelledby={editorHeadingId}
      data-presentation={presentation}
    >
      <header className="console-heading">
        <div>
          <h2 id={editorHeadingId}>
            {presentation === 'workbench'
              ? '条目标注'
              : readingTitle(entry.value.titlePath)}
          </h2>
        </div>
        <div
          className="entry-editor__document-actions"
          hidden={presentation === 'workbench'}
        >
          <button
            className="secondary-action"
            type="button"
            onClick={onLocateDocument}
          >
            返回所属文档
          </button>
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
            查看原文
          </button>
        </div>
      </header>
      <form
        className="entry-editor-form"
        onSubmit={(event) => void save(event)}
      >
        <div className="form-commit field--full entry-editor-sticky-actions">
          <div className="entry-review-navigation">
            <button
              className="secondary-action"
              type="button"
              disabled={saving || onPrevious === undefined}
              hidden={presentation === 'workbench'}
              onClick={onPrevious}
            >
              上一条
            </button>
            <button className="primary-action" type="submit" disabled={saving}>
              {saving
                ? '正在保存…'
                : presentation === 'workbench'
                  ? '保存标注'
                  : '保存并继续'}
            </button>
            <button
              className="secondary-action"
              type="button"
              disabled={saving || onNext === undefined}
              hidden={presentation === 'workbench'}
              onClick={onNext}
            >
              下一条
            </button>
          </div>
        </div>
        <details
          className="entry-body-editor field--full"
          open={presentation === 'review' ? true : undefined}
        >
          <summary>
            {presentation === 'workbench' ? '修改条目正文' : '条目正文'}
          </summary>
          <label className="field field--full">
            <span>条目正文</span>
            <textarea
              rows={12}
              value={body}
              onChange={(event) => {
                setBody(event.currentTarget.value);
              }}
            />
            <small>编辑会更新当前条目，不会修改已导入的原文。</small>
          </label>
        </details>
        <label className="field field--full">
          <span>内容关键词（逗号或换行分隔）</span>
          <textarea
            rows={3}
            value={contentKeywords}
            onChange={(event) => {
              setContentKeywords(event.currentTarget.value);
            }}
            placeholder="例如：PostgreSQL，全文检索，个人知识库"
          />
        </label>
        <label className="field">
          <span>类型关键词</span>
          <select
            value={typeKeyword}
            onChange={(event) => {
              setTypeKeyword(event.currentTarget.value as EntryTypeKeyword);
            }}
          >
            {ENTRY_TYPE_KEYWORDS.map((keyword) => (
              <option key={keyword} value={keyword}>
                {TYPE_LABELS[keyword]}
              </option>
            ))}
          </select>
        </label>
        {typeKeyword === 'other' ? (
          <label className="field">
            <span>自定义类型名称</span>
            <input
              value={typeCustomName}
              onChange={(event) => {
                setTypeCustomName(event.currentTarget.value);
              }}
              required
            />
          </label>
        ) : null}
        <DomainField
          label="主领域"
          value={primaryDomain}
          customName={domainCustomNames[0] ?? ''}
          required
          onChange={(value) => {
            if (value !== '') setPrimaryDomain(value);
          }}
          onCustomNameChange={(value) => {
            setDomainCustomNames((current) => [
              value,
              current[1] ?? '',
              current[2] ?? '',
            ]);
          }}
        />
        <DomainField
          label="副领域 1（可选）"
          value={secondaryDomain}
          customName={domainCustomNames[1] ?? ''}
          onChange={setSecondaryDomain}
          onCustomNameChange={(value) => {
            setDomainCustomNames((current) => [
              current[0] ?? '',
              value,
              current[2] ?? '',
            ]);
          }}
        />
        <DomainField
          label="副领域 2（可选）"
          value={thirdDomain}
          customName={domainCustomNames[2] ?? ''}
          onChange={setThirdDomain}
          onCustomNameChange={(value) => {
            setDomainCustomNames((current) => [
              current[0] ?? '',
              current[1] ?? '',
              value,
            ]);
          }}
        />
        <InformationEntryReviewControls
          entry={entry}
          contentKeywords={contentKeywords}
          usefulnessScore={usefulnessScore}
          interestScore={interestScore}
          preferences={reviewPreferences}
          onContentKeywordsChange={setContentKeywords}
          onUsefulnessScoreChange={setUsefulnessScore}
          onInterestScoreChange={setInterestScore}
          onSavePreferences={onSavePreferences}
          onPreferencesChange={onPreferencesChange}
          overridePreferences={overridePreferences}
        />
        <ActionNotice feedback={localFeedback} />
      </form>
    </section>
  );
}

function DomainField({
  customName,
  label,
  onChange,
  onCustomNameChange,
  required = false,
  value,
}: {
  readonly customName: string;
  readonly label: string;
  readonly onChange: (value: '' | EntryDomainKeyword) => void;
  readonly onCustomNameChange: (value: string) => void;
  readonly required?: boolean;
  readonly value: '' | EntryDomainKeyword;
}) {
  return (
    <div className="entry-domain-field">
      <label className="field">
        <span>{label}</span>
        <select
          value={value}
          required={required}
          onChange={(event) => {
            onChange(event.currentTarget.value as '' | EntryDomainKeyword);
          }}
        >
          <option value="" disabled={required}>
            {required ? '选择主领域' : '不设置'}
          </option>
          {ENTRY_DOMAIN_KEYWORDS.map((keyword) => (
            <option key={keyword} value={keyword}>
              {DOMAIN_LABELS[keyword]}
            </option>
          ))}
        </select>
      </label>
      {value === 'other' ? (
        <label className="field">
          <span>自定义领域名称</span>
          <input
            value={customName}
            onChange={(event) => {
              onCustomNameChange(event.currentTarget.value);
            }}
            required
          />
        </label>
      ) : null}
    </div>
  );
}
