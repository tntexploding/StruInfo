import {useMemo, useState} from 'react';
import type {KeyboardEvent} from 'react';

import {
  DEFAULT_REVIEW_AUTOMATIC_KEYWORDS,
  DEFAULT_REVIEW_VOCABULARY,
  type InformationEntry,
  type M1cHttpResponse,
  type ReviewPreferencesResponse,
  type ReviewPreferencesWrite,
  type ReviewVocabularyPreferences,
} from '../api/m1c_api_contract.js';
import type {Loadable} from '../components/product_types.js';
import {
  extractReviewKeywords,
  normalizeReviewKeyword,
  reviewKeywordIdentity,
} from './review_keyword_extractor.js';
import {
  canonicalizeReviewKeyword,
  withVocabularyAlias,
} from './review_vocabulary.js';

const SCORE_VALUES = [1, 2, 3, 4, 5] as const;
const MAXIMUM_QUICK_TAGS = 24;

const DEFAULT_SESSION_PREFERENCES: Readonly<ReviewPreferencesWrite> =
  Object.freeze({
    quickTags: Object.freeze([]),
    automaticKeywords: DEFAULT_REVIEW_AUTOMATIC_KEYWORDS,
    vocabulary: DEFAULT_REVIEW_VOCABULARY,
  });

export interface InformationEntryReviewControlsProps {
  readonly entry: Readonly<InformationEntry>;
  readonly contentKeywords: string;
  readonly interestScore: 1 | 2 | 3 | 4 | 5;
  readonly usefulnessScore: 1 | 2 | 3 | 4 | 5;
  readonly preferences: Loadable<Readonly<ReviewPreferencesResponse>>;
  readonly overridePreferences?: Readonly<ReviewPreferencesWrite> | undefined;
  readonly onContentKeywordsChange: (value: string) => void;
  readonly onInterestScoreChange: (value: 1 | 2 | 3 | 4 | 5) => void;
  readonly onPreferencesChange?:
    ((value: Readonly<ReviewPreferencesWrite>) => void) | undefined;
  readonly onSavePreferences: (
    value: Readonly<ReviewPreferencesWrite>,
  ) => Promise<M1cHttpResponse<ReviewPreferencesResponse>>;
  readonly onUsefulnessScoreChange: (value: 1 | 2 | 3 | 4 | 5) => void;
}

export function InformationEntryReviewControls({
  contentKeywords,
  entry,
  interestScore,
  onContentKeywordsChange,
  onInterestScoreChange,
  onPreferencesChange,
  onSavePreferences,
  onUsefulnessScoreChange,
  preferences,
  overridePreferences,
  usefulnessScore,
}: InformationEntryReviewControlsProps) {
  const resolved =
    preferences.status === 'ready' ? preferences.value : undefined;
  const [sessionPreferences, setSessionPreferences] = useState<
    Readonly<ReviewPreferencesWrite> | undefined
  >();
  const activePreferences =
    overridePreferences ??
    sessionPreferences ??
    resolved ??
    DEFAULT_SESSION_PREFERENCES;
  const automatic = activePreferences.automaticKeywords;
  const vocabulary = activePreferences.vocabulary;
  const [quickTagDraft, setQuickTagDraft] = useState('');
  const [exclusionDraft, setExclusionDraft] = useState('');
  const [aliasSource, setAliasSource] = useState('');
  const [aliasCanonical, setAliasCanonical] = useState('');
  const [savingPreferences, setSavingPreferences] = useState(false);
  const [preferenceMessage, setPreferenceMessage] = useState<string>();

  const candidates = useMemo(() => {
    if (!automatic.enabled) return Object.freeze([] as string[]);
    return canonicalKeywords(
      extractReviewKeywords(entry.value.body, 10, {
        includeLinkDomains: automatic.includeLinkDomains,
        excludedKeywords: automatic.excludedKeywords,
      }),
      vocabulary,
    );
  }, [automatic, entry.value.body, vocabulary]);

  function applyKeywords(values: readonly string[]) {
    const current = contentKeywords
      .split(/[，,\n]/u)
      .map((value) => value.trim())
      .filter((value) => value !== '');
    onContentKeywordsChange(
      canonicalKeywords([...current, ...values], vocabulary).join('，'),
    );
  }

  async function persist(
    next: Readonly<ReviewPreferencesWrite>,
    successMessage: string,
  ) {
    if (savingPreferences) return;
    setSessionPreferences(next);
    onPreferencesChange?.(next);
    if (resolved === undefined) {
      setPreferenceMessage(`${successMessage} 仅保留在本次页面会话中。`);
      return;
    }
    setSavingPreferences(true);
    setPreferenceMessage(undefined);
    try {
      await onSavePreferences(next);
      setPreferenceMessage(successMessage);
    } catch {
      setPreferenceMessage('无法保存个人设置；修改仅在当前页面有效。');
    } finally {
      setSavingPreferences(false);
    }
  }

  function nextWrite(
    overrides: Partial<ReviewPreferencesWrite>,
  ): ReviewPreferencesWrite {
    return {
      quickTags: overrides.quickTags ?? activePreferences.quickTags,
      automaticKeywords:
        overrides.automaticKeywords ?? activePreferences.automaticKeywords,
      vocabulary: overrides.vocabulary ?? activePreferences.vocabulary,
    };
  }

  function addQuickTag() {
    const normalized = normalizeReviewKeyword(quickTagDraft);
    if (normalized === '') return;
    const quickTags = canonicalKeywords(
      [...activePreferences.quickTags, normalized],
      vocabulary,
    ).slice(0, MAXIMUM_QUICK_TAGS);
    setQuickTagDraft('');
    void persist(nextWrite({quickTags}), `已保存快捷标签“${normalized}”。`);
  }

  function addExclusion() {
    const normalized = normalizeReviewKeyword(exclusionDraft);
    if (normalized === '') return;
    const excludedKeywords = canonicalKeywords(
      [...activePreferences.automaticKeywords.excludedKeywords, normalized],
      DEFAULT_REVIEW_VOCABULARY,
    );
    setExclusionDraft('');
    void persist(
      nextWrite({
        automaticKeywords: {
          ...activePreferences.automaticKeywords,
          excludedKeywords,
        },
      }),
      `已把“${normalized}”加入自动标签排除列表。`,
    );
  }

  function addAlias() {
    const source = normalizeReviewKeyword(aliasSource);
    const canonical = normalizeReviewKeyword(aliasCanonical);
    if (source === '' || canonical === '') return;
    const nextVocabulary = withVocabularyAlias(
      activePreferences.vocabulary,
      source,
      canonical,
    );
    setAliasSource('');
    setAliasCanonical('');
    void persist(
      nextWrite({vocabulary: nextVocabulary}),
      `以后“${source}”会合并为“${canonical}”。`,
    );
  }

  return (
    <section
      className="entry-review-controls field--full"
      aria-labelledby="entry-review-controls-title"
    >
      <header className="entry-review-controls__heading">
        <div>
          <h3 id="entry-review-controls-title">人工评分与标签</h3>
        </div>
      </header>

      <div className="entry-review-score-grid">
        <ScoreControl
          label="有用程度"
          value={usefulnessScore}
          onChange={onUsefulnessScoreChange}
        />
        <ScoreControl
          label="有趣程度"
          value={interestScore}
          onChange={onInterestScoreChange}
        />
      </div>

      <div className="entry-deterministic-keywords">
        <div>
          <strong>自动标签建议</strong>
          <small>
            {automatic.enabled
              ? '从正文和现有标记中提取，默认忽略网址。'
              : '当前工作区已关闭自动标签。'}
          </small>
        </div>
        <div className="entry-keyword-candidates" aria-label="自动标签建议">
          {candidates.length === 0 ? (
            <span>没有建议</span>
          ) : (
            candidates.map((candidate) => (
              <button
                type="button"
                className="tag-token"
                key={reviewKeywordIdentity(candidate)}
                onClick={() => {
                  applyKeywords([candidate]);
                }}
              >
                + {candidate}
              </button>
            ))
          )}
        </div>
        <button
          className="secondary-action"
          type="button"
          disabled={candidates.length === 0}
          onClick={() => {
            applyKeywords(candidates);
          }}
        >
          添加全部建议
        </button>
      </div>

      <details className="entry-review-preferences">
        <summary>快捷标签与自动标签设置</summary>
        {preferences.status === 'loading' ? <p>正在读取个人标签设置…</p> : null}
        {preferences.status === 'error' ? (
          <p role="alert">{preferences.message}</p>
        ) : null}
        {resolved === undefined ? (
          <p className="entry-preference-message" role="status">
            个人设置当前无法读取；以下修改仅在当前页面有效。
          </p>
        ) : null}
        <div className="entry-review-preferences__body">
          <div className="entry-review-toggle-row">
            <label>
              <input
                type="checkbox"
                checked={activePreferences.automaticKeywords.enabled}
                disabled={savingPreferences}
                onChange={(event) => {
                  const next = nextWrite({
                    automaticKeywords: {
                      ...activePreferences.automaticKeywords,
                      enabled: event.currentTarget.checked,
                    },
                  });
                  void persist(next, '自动标签开关已保存。');
                }}
              />
              开启自动标签
            </label>
            <label>
              <input
                type="checkbox"
                checked={activePreferences.automaticKeywords.includeLinkDomains}
                disabled={savingPreferences}
                onChange={(event) => {
                  const next = nextWrite({
                    automaticKeywords: {
                      ...activePreferences.automaticKeywords,
                      includeLinkDomains: event.currentTarget.checked,
                    },
                  });
                  void persist(next, '链接域名筛选设置已保存。');
                }}
              />
              允许把链接域名作为标签
            </label>
          </div>

          <PreferenceList
            title="快捷标签"
            values={activePreferences.quickTags}
            onApply={applyKeywords}
            onRemove={(value) => {
              const next = nextWrite({
                quickTags: activePreferences.quickTags.filter(
                  (tag) =>
                    reviewKeywordIdentity(tag) !== reviewKeywordIdentity(value),
                ),
              });
              void persist(next, `已删除快捷标签“${value}”。`);
            }}
          />
          <InlineDraft
            label="新增快捷标签"
            value={quickTagDraft}
            button="保存快捷标签"
            onChange={setQuickTagDraft}
            onCommit={addQuickTag}
          />

          <PreferenceList
            title="自动标签排除词"
            values={activePreferences.automaticKeywords.excludedKeywords}
            onRemove={(value) => {
              const next = nextWrite({
                automaticKeywords: {
                  ...activePreferences.automaticKeywords,
                  excludedKeywords:
                    activePreferences.automaticKeywords.excludedKeywords.filter(
                      (keyword) =>
                        reviewKeywordIdentity(keyword) !==
                        reviewKeywordIdentity(value),
                    ),
                },
              });
              void persist(next, `已移除排除词“${value}”。`);
            }}
          />
          <InlineDraft
            label="新增排除词"
            value={exclusionDraft}
            button="加入排除"
            onChange={setExclusionDraft}
            onCommit={addExclusion}
          />

          <div className="entry-alias-editor">
            <strong>标签别名合并</strong>
            <p>大小写差异会自动合并；中英文等语义别名由你明确指定。</p>
            <div className="entry-alias-editor__inputs">
              <label className="field">
                <span>别名</span>
                <input
                  value={aliasSource}
                  onChange={(event) => {
                    setAliasSource(event.currentTarget.value);
                  }}
                />
              </label>
              <label className="field">
                <span>合并为</span>
                <input
                  value={aliasCanonical}
                  onChange={(event) => {
                    setAliasCanonical(event.currentTarget.value);
                  }}
                />
              </label>
              <button
                className="secondary-action"
                type="button"
                onClick={addAlias}
              >
                保存别名
              </button>
            </div>
            <ul className="entry-alias-list">
              {activePreferences.vocabulary.aliases.map((alias) => (
                <li key={reviewKeywordIdentity(alias.source)}>
                  <span>
                    {alias.source} → {alias.canonical}
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      const nextVocabulary: ReviewVocabularyPreferences = {
                        ...activePreferences.vocabulary,
                        aliases: activePreferences.vocabulary.aliases.filter(
                          (value) =>
                            reviewKeywordIdentity(value.source) !==
                            reviewKeywordIdentity(alias.source),
                        ),
                      };
                      const next = nextWrite({vocabulary: nextVocabulary});
                      void persist(next, `已删除别名“${alias.source}”。`);
                    }}
                  >
                    删除
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </div>
        {preferenceMessage === undefined ? null : (
          <p className="entry-preference-message" aria-live="polite">
            {preferenceMessage}
          </p>
        )}
      </details>
    </section>
  );
}

function ScoreControl({
  label,
  onChange,
  value,
}: {
  readonly label: string;
  readonly onChange: (value: 1 | 2 | 3 | 4 | 5) => void;
  readonly value: 1 | 2 | 3 | 4 | 5;
}) {
  return (
    <label className="entry-review-score">
      <span>
        <strong>{label}</strong>
        <b>{value}/5</b>
      </span>
      <input
        type="range"
        min={1}
        max={5}
        step={1}
        value={value}
        onChange={(event) => {
          onChange(Number(event.currentTarget.value) as 1 | 2 | 3 | 4 | 5);
        }}
      />
      <span className="entry-review-score__ticks" aria-hidden="true">
        {SCORE_VALUES.map((score) => (
          <i key={score}>{score}</i>
        ))}
      </span>
    </label>
  );
}

function PreferenceList({
  onApply,
  onRemove,
  title,
  values,
}: {
  readonly onApply?: ((values: readonly string[]) => void) | undefined;
  readonly onRemove: (value: string) => void;
  readonly title: string;
  readonly values: readonly string[];
}) {
  return (
    <div className="entry-preference-list">
      <strong>{title}</strong>
      <div>
        {values.length === 0 ? (
          <span>暂无</span>
        ) : (
          values.map((value) => (
            <span
              className="entry-preference-token"
              key={reviewKeywordIdentity(value)}
            >
              {onApply === undefined ? (
                <em>{value}</em>
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    onApply([value]);
                  }}
                >
                  + {value}
                </button>
              )}
              <button
                type="button"
                aria-label={`删除 ${value}`}
                onClick={() => {
                  onRemove(value);
                }}
              >
                ×
              </button>
            </span>
          ))
        )}
      </div>
    </div>
  );
}

function InlineDraft({
  button,
  label,
  onChange,
  onCommit,
  value,
}: {
  readonly button: string;
  readonly label: string;
  readonly onChange: (value: string) => void;
  readonly onCommit: () => void;
  readonly value: string;
}) {
  function keyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    onCommit();
  }
  return (
    <div className="entry-inline-draft">
      <label className="field">
        <span>{label}</span>
        <input
          value={value}
          onKeyDown={keyDown}
          onChange={(event) => {
            onChange(event.currentTarget.value);
          }}
        />
      </label>
      <button className="secondary-action" type="button" onClick={onCommit}>
        {button}
      </button>
    </div>
  );
}

function canonicalKeywords(
  values: readonly string[],
  vocabulary: Readonly<ReviewVocabularyPreferences>,
): readonly string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const canonical = canonicalizeReviewKeyword(value, vocabulary);
    const identity = reviewKeywordIdentity(canonical);
    if (identity === '' || seen.has(identity)) continue;
    seen.add(identity);
    result.push(canonical);
  }
  return Object.freeze(result);
}
