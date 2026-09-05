import {useEffect, useRef, useState} from 'react';

import type {
  EntryPreferenceDimension,
  EntryPreferenceEffect,
  EntryPreferenceFeatureKind,
  EntryPreferenceProfile,
  EntryPreferenceRule,
  EntryPreferenceWeight,
  InformationEntryPreferenceProfileResponse,
  InformationEntryPreferenceProfileWriteResponse,
  InformationEntryPreferenceSuggestion,
  InformationEntryPreferenceSuggestionResponse,
  InformationEntryPreferenceTrialResponse,
  M1cHttpResponse,
} from '../api/m1c_api_contract.js';
import type {Loadable} from '../components/product_types.js';

const MAXIMUM_RULES = 64;
const TRIAL_VISIBLE_LIMIT = 100;
const WEIGHTS: readonly EntryPreferenceWeight[] = [1, 2, 3, 4, 5];
const DIMENSIONS: readonly EntryPreferenceDimension[] = [
  'usefulness',
  'interest',
];
const FEATURE_KINDS: readonly EntryPreferenceFeatureKind[] = [
  'content_keyword',
  'type',
  'domain',
];
const EFFECTS: readonly EntryPreferenceEffect[] = ['prefer', 'deprioritize'];

const DIMENSION_LABELS: Readonly<Record<EntryPreferenceDimension, string>> = {
  usefulness: '有用',
  interest: '有趣',
};
const FEATURE_LABELS: Readonly<Record<EntryPreferenceFeatureKind, string>> = {
  content_keyword: '内容关键词',
  type: '类型',
  domain: '领域',
};
const EFFECT_LABELS: Readonly<Record<EntryPreferenceEffect, string>> = {
  prefer: '偏好',
  deprioritize: '降低优先级',
};

type SuggestionState =
  | Readonly<{status: 'idle'}>
  | Readonly<{status: 'loading'}>
  | Readonly<{
      status: 'ready';
      value: Extract<
        InformationEntryPreferenceSuggestionResponse,
        {status: 'ok'}
      >;
    }>
  | Readonly<{status: 'error'; message: string}>;

type TrialState =
  | Readonly<{status: 'idle'}>
  | Readonly<{status: 'loading'}>
  | Readonly<{
      status: 'ready';
      value: Extract<
        InformationEntryPreferenceTrialResponse,
        {status: 'complete'}
      >;
    }>
  | Readonly<{status: 'error'; message: string}>;

interface DraftState {
  readonly baseRevision: number;
  readonly value: Readonly<EntryPreferenceProfile>;
}

export interface InformationEntryPreferenceProfilePanelProps {
  readonly state: Loadable<Readonly<InformationEntryPreferenceProfileResponse>>;
  readonly onReload: () => void;
  readonly onSave: (
    body: Readonly<{
      expectedRevision: number;
      enabled: boolean;
      rules: readonly Readonly<EntryPreferenceRule>[];
    }>,
  ) => Promise<M1cHttpResponse<InformationEntryPreferenceProfileWriteResponse>>;
  readonly onSuggest: (
    includePrivate: boolean,
  ) => Promise<M1cHttpResponse<InformationEntryPreferenceSuggestionResponse>>;
  readonly onTrial: (
    body: Readonly<{
      includePrivate: boolean;
      expectedProfileRevision: number;
      profile: Readonly<EntryPreferenceProfile>;
    }>,
  ) => Promise<M1cHttpResponse<InformationEntryPreferenceTrialResponse>>;
}

export function InformationEntryPreferenceProfilePanel({
  onReload,
  onSave,
  onSuggest,
  onTrial,
  state,
}: InformationEntryPreferenceProfilePanelProps) {
  const [draftState, setDraftState] = useState<DraftState>();
  const [includePrivate, setIncludePrivate] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string>();
  const [suggestions, setSuggestions] = useState<SuggestionState>({
    status: 'idle',
  });
  const [trial, setTrial] = useState<TrialState>({status: 'idle'});
  const mounted = useRef(true);
  const saveRequestId = useRef(0);
  const suggestionRequestId = useRef(0);
  const trialRequestId = useRef(0);
  const [newRule, setNewRule] = useState<Omit<EntryPreferenceRule, 'ruleId'>>({
    dimension: 'usefulness',
    featureKind: 'content_keyword',
    featureIdentity: '',
    displayValue: '',
    effect: 'prefer',
    weight: 3,
  });

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      saveRequestId.current += 1;
      suggestionRequestId.current += 1;
      trialRequestId.current += 1;
    };
  }, []);

  if (state.status === 'loading') {
    return (
      <section
        className="entry-preference-profile"
        aria-labelledby="entry-preference-profile-title"
      >
        <ProfileHeading />
        <p className="entry-preference-profile__state" role="status">
          正在读取偏好规则…
        </p>
      </section>
    );
  }
  if (state.status === 'error') {
    return (
      <section
        className="entry-preference-profile"
        aria-labelledby="entry-preference-profile-title"
      >
        <ProfileHeading />
        <div
          className="error-state entry-preference-profile__state"
          role="alert"
        >
          <p>{state.message}</p>
          <button className="secondary-action" type="button" onClick={onReload}>
            重新读取
          </button>
        </div>
      </section>
    );
  }
  if (state.status === 'empty') return null;

  const saved = state.value.profile;
  const draft =
    draftState?.baseRevision === saved.revision ? draftState.value : saved;
  const isDirty = !profilesHaveSameValue(saved, draft);

  function replaceDraft(next: Readonly<EntryPreferenceProfile>) {
    trialRequestId.current += 1;
    setDraftState({baseRevision: saved.revision, value: next});
    setMessage(undefined);
    setTrial({status: 'idle'});
  }

  function replaceRule(
    ruleId: string,
    update: (rule: Readonly<EntryPreferenceRule>) => EntryPreferenceRule,
  ) {
    replaceDraft({
      ...draft,
      rules: draft.rules.map((rule) =>
        rule.ruleId === ruleId ? update(rule) : rule,
      ),
    });
  }

  function addManualRule() {
    const displayValue = newRule.displayValue.trim().normalize('NFC');
    const featureIdentity = normalizeFeatureIdentity(
      newRule.featureIdentity === '' ? displayValue : newRule.featureIdentity,
    );
    if (displayValue === '' || featureIdentity === '') {
      setMessage('请填写规则显示名称和匹配值。');
      return;
    }
    if (
      draft.rules.some(
        (rule) =>
          rule.dimension === newRule.dimension &&
          rule.featureKind === newRule.featureKind &&
          rule.featureIdentity === featureIdentity,
      )
    ) {
      setMessage('同一评分维度下已经存在这项规则。');
      return;
    }
    if (draft.rules.length >= MAXIMUM_RULES) {
      setMessage('规则已达到 64 条上限，请先删除不再需要的规则。');
      return;
    }
    const ruleId = createRuleId();
    if (ruleId === undefined) {
      setMessage('无法新建规则，请刷新页面后重试。');
      return;
    }
    replaceDraft({
      ...draft,
      rules: [
        ...draft.rules,
        {
          ...newRule,
          ruleId,
          displayValue,
          featureIdentity,
        },
      ],
    });
    setNewRule({...newRule, featureIdentity: '', displayValue: ''});
    setMessage('新规则已加入草稿，保存后生效。');
  }

  function acceptSuggestion(
    suggestion: Readonly<InformationEntryPreferenceSuggestion>,
  ) {
    const existing = draft.rules.find(
      (rule) =>
        rule.dimension === suggestion.dimension &&
        rule.featureKind === suggestion.featureKind &&
        rule.featureIdentity === suggestion.featureIdentity,
    );
    if (existing !== undefined) {
      replaceRule(existing.ruleId, (rule) => ({
        ...rule,
        displayValue: suggestion.displayValue,
        effect: suggestion.effect,
        weight: suggestion.suggestedWeight,
      }));
      setMessage('建议已更新到现有规则草稿，尚未保存。');
      return;
    }
    if (draft.rules.length >= MAXIMUM_RULES) {
      setMessage('规则已达到 64 条上限，请先删除不再需要的规则。');
      return;
    }
    const ruleId = createRuleId();
    if (ruleId === undefined) {
      setMessage('无法新建规则，请刷新页面后重试。');
      return;
    }
    replaceDraft({
      ...draft,
      rules: [
        ...draft.rules,
        {
          ruleId,
          dimension: suggestion.dimension,
          featureKind: suggestion.featureKind,
          featureIdentity: suggestion.featureIdentity,
          displayValue: suggestion.displayValue,
          effect: suggestion.effect,
          weight: suggestion.suggestedWeight,
        },
      ],
    });
    setMessage('建议规则已加入草稿，保存后生效。');
  }

  async function saveProfile() {
    const requestId = ++saveRequestId.current;
    suggestionRequestId.current += 1;
    trialRequestId.current += 1;
    setSaving(true);
    setSuggestions({status: 'idle'});
    setTrial({status: 'idle'});
    setMessage(undefined);
    try {
      const response = await onSave({
        expectedRevision: saved.revision,
        enabled: draft.enabled,
        rules: draft.rules,
      });
      if (!mounted.current || requestId !== saveRequestId.current) return;
      if (
        response.body.status === 'applied' ||
        response.body.status === 'unchanged'
      ) {
        setDraftState(undefined);
        setMessage(
          response.body.status === 'applied'
            ? '偏好规则已保存。'
            : '偏好规则没有变化。',
        );
      } else {
        const issue =
          'issue' in response.body ? response.body.issue : {code: 'unknown'};
        setMessage(
          issue.code === 'stale_entry_preference_profile_revision'
            ? '规则已在其他操作中更新，请重新读取后再保存。'
            : '偏好规则保存失败；现有个人配置没有被修改。',
        );
      }
    } catch {
      if (!mounted.current || requestId !== saveRequestId.current) return;
      setMessage('本地服务当前不可用；偏好规则没有保存。');
    } finally {
      if (mounted.current && requestId === saveRequestId.current) {
        setSaving(false);
      }
    }
  }

  async function generateSuggestions() {
    const requestId = ++suggestionRequestId.current;
    setSuggestions({status: 'loading'});
    setMessage(undefined);
    try {
      const response = await onSuggest(includePrivate);
      if (!mounted.current || requestId !== suggestionRequestId.current) {
        return;
      }
      setSuggestions(
        response.body.status === 'ok'
          ? {status: 'ready', value: response.body}
          : {
              status: 'error',
              message: '无法生成建议；现有规则和条目均未改变。',
            },
      );
    } catch {
      if (!mounted.current || requestId !== suggestionRequestId.current) {
        return;
      }
      setSuggestions({
        status: 'error',
        message: '本地服务当前不可用，未生成建议。',
      });
    }
  }

  async function runTrial() {
    const requestId = ++trialRequestId.current;
    setTrial({status: 'loading'});
    setMessage(undefined);
    try {
      const response = await onTrial({
        includePrivate,
        expectedProfileRevision: saved.revision,
        profile: draft,
      });
      if (!mounted.current || requestId !== trialRequestId.current) return;
      if (response.body.status === 'complete') {
        setTrial({status: 'ready', value: response.body});
        return;
      }
      setTrial({
        status: 'error',
        message:
          response.body.status === 'stale_profile'
            ? '已保存规则发生变化，请重新读取后再试运行。'
            : response.body.status === 'stale_entries'
              ? '参与试运行的条目已发生变化，请重新运行。'
              : '试运行失败；没有修改任何条目或查询结果。',
      });
    } catch {
      if (!mounted.current || requestId !== trialRequestId.current) return;
      setTrial({
        status: 'error',
        message: '本地服务当前不可用，未执行试运行。',
      });
    }
  }

  return (
    <section
      className="entry-preference-profile"
      aria-labelledby="entry-preference-profile-title"
    >
      <ProfileHeading />

      <div className="entry-preference-profile__summary">
        <div>
          <span
            className="status-chip"
            data-tone={draft.enabled ? 'ready' : 'muted'}
          >
            {draft.enabled ? '已启用' : '默认关闭'}
          </span>
          <span>{draft.rules.length.toString()} / 64 条规则</span>
        </div>
        <label className="entry-preference-profile__toggle">
          <input
            type="checkbox"
            checked={draft.enabled}
            disabled={saving}
            onChange={(event) => {
              replaceDraft({...draft, enabled: event.currentTarget.checked});
            }}
          />
          启用已保存规则
        </label>
      </div>

      <div className="entry-preference-profile__rules">
        <header>
          <div>
            <h3>规则草稿</h3>
          </div>
          <span>{isDirty ? '有未保存修改' : '已保存'}</span>
        </header>
        {draft.rules.length === 0 ? (
          <p className="entry-preference-profile__empty">
            暂无规则。可手动新增，也可根据已有评分生成建议。
          </p>
        ) : (
          <ol className="entry-preference-rule-list">
            {draft.rules.map((rule) => (
              <li key={rule.ruleId}>
                <RuleEditor
                  rule={rule}
                  disabled={saving}
                  onChange={(next) => {
                    replaceRule(rule.ruleId, () => next);
                  }}
                  onRemove={() => {
                    replaceDraft({
                      ...draft,
                      rules: draft.rules.filter(
                        (candidate) => candidate.ruleId !== rule.ruleId,
                      ),
                    });
                  }}
                />
              </li>
            ))}
          </ol>
        )}

        <details className="entry-preference-profile__new-rule">
          <summary>手动新增规则</summary>
          <div className="entry-preference-new-rule-grid">
            <SelectField
              label="评分维度"
              value={newRule.dimension}
              options={DIMENSIONS}
              labels={DIMENSION_LABELS}
              onChange={(value) => {
                setNewRule({...newRule, dimension: value});
              }}
            />
            <SelectField
              label="特征类型"
              value={newRule.featureKind}
              options={FEATURE_KINDS}
              labels={FEATURE_LABELS}
              onChange={(value) => {
                setNewRule({...newRule, featureKind: value});
              }}
            />
            <label className="field">
              <span>显示名称</span>
              <input
                maxLength={80}
                value={newRule.displayValue}
                onChange={(event) => {
                  setNewRule({
                    ...newRule,
                    displayValue: event.currentTarget.value,
                  });
                }}
                placeholder="例如 PostgreSQL"
              />
            </label>
            <label className="field">
              <span>匹配值</span>
              <input
                maxLength={96}
                value={newRule.featureIdentity}
                onChange={(event) => {
                  setNewRule({
                    ...newRule,
                    featureIdentity: event.currentTarget.value,
                  });
                }}
                placeholder="留空时自动生成"
              />
            </label>
            <SelectField
              label="作用"
              value={newRule.effect}
              options={EFFECTS}
              labels={EFFECT_LABELS}
              onChange={(value) => {
                setNewRule({...newRule, effect: value});
              }}
            />
            <WeightField
              value={newRule.weight}
              onChange={(value) => {
                setNewRule({...newRule, weight: value});
              }}
            />
            <button
              className="secondary-action"
              type="button"
              disabled={saving || draft.rules.length >= MAXIMUM_RULES}
              onClick={addManualRule}
            >
              加入草稿
            </button>
          </div>
        </details>
      </div>

      <div className="entry-preference-profile__actions">
        <label>
          <input
            type="checkbox"
            checked={includePrivate}
            onChange={(event) => {
              suggestionRequestId.current += 1;
              trialRequestId.current += 1;
              setIncludePrivate(event.currentTarget.checked);
              setSuggestions({status: 'idle'});
              setTrial({status: 'idle'});
            }}
          />
          本次建议与试运行包含隐私条目
        </label>
        <div>
          <button
            className="secondary-action"
            type="button"
            disabled={saving}
            onClick={() => {
              saveRequestId.current += 1;
              suggestionRequestId.current += 1;
              trialRequestId.current += 1;
              setDraftState(undefined);
              setSuggestions({status: 'idle'});
              setTrial({status: 'idle'});
              onReload();
            }}
          >
            放弃草稿并重读
          </button>
          <button
            className="primary-action"
            type="button"
            disabled={saving || !isDirty}
            onClick={() => void saveProfile()}
          >
            {saving ? '正在保存…' : '保存偏好规则'}
          </button>
        </div>
      </div>
      {message === undefined ? null : (
        <p className="entry-preference-profile__message" aria-live="polite">
          {message}
        </p>
      )}

      <div className="entry-preference-profile__tools">
        <section aria-labelledby="entry-preference-suggestions-title">
          <header>
            <div>
              <h3 id="entry-preference-suggestions-title">
                根据评分生成规则建议
              </h3>
            </div>
            <button
              className="secondary-action"
              type="button"
              disabled={suggestions.status === 'loading'}
              onClick={() => void generateSuggestions()}
            >
              {suggestions.status === 'loading' ? '正在统计…' : '生成规则建议'}
            </button>
          </header>
          <SuggestionResults state={suggestions} onAccept={acceptSuggestion} />
        </section>

        <section aria-labelledby="entry-preference-trial-title">
          <header>
            <div>
              <h3 id="entry-preference-trial-title">试运行</h3>
            </div>
            <button
              className="secondary-action"
              type="button"
              disabled={trial.status === 'loading'}
              onClick={() => void runTrial()}
            >
              {trial.status === 'loading'
                ? '正在试算…'
                : '试算最多 ' + TRIAL_VISIBLE_LIMIT.toString() + ' 条'}
            </button>
          </header>
          <TrialResults state={trial} />
        </section>
      </div>
    </section>
  );
}

function ProfileHeading() {
  return (
    <header className="entry-preference-profile__heading">
      <div>
        <h2 id="entry-preference-profile-title">偏好规则</h2>
        <p>规则保存在个人配置中，只提供评分建议，不会自动修改条目。</p>
      </div>
    </header>
  );
}

function RuleEditor({
  disabled,
  onChange,
  onRemove,
  rule,
}: {
  readonly disabled: boolean;
  readonly onChange: (rule: EntryPreferenceRule) => void;
  readonly onRemove: () => void;
  readonly rule: Readonly<EntryPreferenceRule>;
}) {
  return (
    <div className="entry-preference-rule">
      <SelectField
        label="维度"
        value={rule.dimension}
        options={DIMENSIONS}
        labels={DIMENSION_LABELS}
        disabled={disabled}
        onChange={(dimension) => {
          onChange({...rule, dimension});
        }}
      />
      <SelectField
        label="特征"
        value={rule.featureKind}
        options={FEATURE_KINDS}
        labels={FEATURE_LABELS}
        disabled={disabled}
        onChange={(featureKind) => {
          onChange({...rule, featureKind});
        }}
      />
      <label className="field">
        <span>显示名称</span>
        <input
          maxLength={80}
          value={rule.displayValue}
          disabled={disabled}
          onChange={(event) => {
            onChange({...rule, displayValue: event.currentTarget.value});
          }}
        />
      </label>
      <label className="field">
        <span>匹配值</span>
        <input
          maxLength={96}
          value={rule.featureIdentity}
          disabled={disabled}
          onChange={(event) => {
            onChange({
              ...rule,
              featureIdentity: normalizeFeatureIdentity(
                event.currentTarget.value,
              ),
            });
          }}
        />
      </label>
      <SelectField
        label="作用"
        value={rule.effect}
        options={EFFECTS}
        labels={EFFECT_LABELS}
        disabled={disabled}
        onChange={(effect) => {
          onChange({...rule, effect});
        }}
      />
      <WeightField
        value={rule.weight}
        disabled={disabled}
        onChange={(weight) => {
          onChange({...rule, weight});
        }}
      />
      <button
        className="entry-preference-rule__remove"
        type="button"
        disabled={disabled}
        onClick={onRemove}
        aria-label={'删除规则 ' + rule.displayValue}
      >
        删除
      </button>
    </div>
  );
}

function SelectField<T extends string>({
  disabled = false,
  label,
  labels,
  onChange,
  options,
  value,
}: {
  readonly disabled?: boolean;
  readonly label: string;
  readonly labels: Readonly<Record<T, string>>;
  readonly onChange: (value: T) => void;
  readonly options: readonly T[];
  readonly value: T;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      <select
        value={value}
        disabled={disabled}
        onChange={(event) => {
          onChange(event.currentTarget.value as T);
        }}
      >
        {options.map((option) => (
          <option key={option} value={option}>
            {labels[option]}
          </option>
        ))}
      </select>
    </label>
  );
}

function WeightField({
  disabled = false,
  onChange,
  value,
}: {
  readonly disabled?: boolean;
  readonly onChange: (value: EntryPreferenceWeight) => void;
  readonly value: EntryPreferenceWeight;
}) {
  return (
    <label className="field">
      <span>权重</span>
      <select
        value={value}
        disabled={disabled}
        onChange={(event) => {
          onChange(Number(event.currentTarget.value) as EntryPreferenceWeight);
        }}
      >
        {WEIGHTS.map((weight) => (
          <option key={weight} value={weight}>
            {weight}
          </option>
        ))}
      </select>
    </label>
  );
}

function SuggestionResults({
  onAccept,
  state,
}: {
  readonly onAccept: (
    suggestion: Readonly<InformationEntryPreferenceSuggestion>,
  ) => void;
  readonly state: SuggestionState;
}) {
  if (state.status === 'idle') {
    return <p className="entry-preference-profile__empty">尚未生成建议。</p>;
  }
  if (state.status === 'loading') {
    return <p role="status">正在统计当前可见条目的评分…</p>;
  }
  if (state.status === 'error') {
    return <p role="alert">{state.message}</p>;
  }
  if (state.value.candidates.length === 0) {
    return (
      <p className="entry-preference-profile__empty">
        已检查 {state.value.visibleEntryCount.toString()} 条可见
        条目，当前没有达到样本门槛的建议。
      </p>
    );
  }
  return (
    <>
      <p className="entry-preference-profile__result-summary">
        {state.value.visibleEntryCount.toString()} 条可见条目 ·
        {state.value.totalCandidateCount.toString()} 个建议
        {state.value.truncated ? ' · 仅显示前 64 个' : ''}
      </p>
      <ul className="entry-preference-suggestion-list">
        {state.value.candidates.map((candidate) => (
          <li
            key={[
              candidate.dimension,
              candidate.featureKind,
              candidate.featureIdentity,
            ].join(':')}
          >
            <div>
              <strong>{candidate.displayValue}</strong>
              <span>
                {DIMENSION_LABELS[candidate.dimension]} ·
                {FEATURE_LABELS[candidate.featureKind]} ·
                {EFFECT_LABELS[candidate.effect]} {candidate.suggestedWeight}
              </span>
            </div>
            <dl>
              <div>
                <dt>正向</dt>
                <dd>{candidate.positiveCount}</dd>
              </div>
              <div>
                <dt>中性</dt>
                <dd>{candidate.neutralCount}</dd>
              </div>
              <div>
                <dt>负向</dt>
                <dd>{candidate.negativeCount}</dd>
              </div>
            </dl>
            <details>
              <summary>查看参考条目</summary>
              <EvidenceEntryIds
                label="正向"
                values={candidate.positiveEntryIds}
              />
              <EvidenceEntryIds
                label="中性"
                values={candidate.neutralEntryIds}
              />
              <EvidenceEntryIds
                label="负向"
                values={candidate.negativeEntryIds}
              />
            </details>
            <button
              className="secondary-action"
              type="button"
              aria-label={`把建议加入规则：${candidate.displayValue}`}
              onClick={() => {
                onAccept(candidate);
              }}
            >
              加入规则
            </button>
          </li>
        ))}
      </ul>
    </>
  );
}

function EvidenceEntryIds({
  label,
  values,
}: {
  readonly label: string;
  readonly values: readonly string[];
}) {
  const visible = values.slice(0, 6);
  return (
    <p>
      <strong>{label}：</strong>
      {visible.length === 0
        ? '无'
        : visible.map(shortIdentity).join('、') +
          (values.length > visible.length
            ? ' 等 ' + values.length.toString() + ' 条'
            : '')}
    </p>
  );
}

function TrialResults({state}: {readonly state: TrialState}) {
  if (state.status === 'idle') {
    return (
      <p className="entry-preference-profile__empty">
        尚未试运行。草稿规则也可以直接试算，不必先保存。
      </p>
    );
  }
  if (state.status === 'loading') {
    return <p role="status">正在计算规则匹配，不会修改条目…</p>;
  }
  if (state.status === 'error') {
    return <p role="alert">{state.message}</p>;
  }
  return (
    <>
      <p className="entry-preference-profile__result-summary">
        已试算 {state.value.evaluatedEntryCount.toString()} /
        {state.value.visibleEntryCount.toString()} 条可见条目
        {state.value.truncated ? ' · 已按上限截断' : ''}
      </p>
      {state.value.items.length === 0 ? (
        <p className="entry-preference-profile__empty">当前范围没有条目。</p>
      ) : (
        <div
          className="entry-preference-trial-table"
          role="region"
          aria-label="偏好规则试运行结果"
          tabIndex={0}
        >
          <table>
            <thead>
              <tr>
                <th scope="col">条目</th>
                <th scope="col">人工评分</th>
                <th scope="col">有用净值</th>
                <th scope="col">有趣净值</th>
                <th scope="col">匹配规则</th>
              </tr>
            </thead>
            <tbody>
              {state.value.items.map((item) => (
                <tr key={item.entryId}>
                  <th scope="row">{shortIdentity(item.entryId)}</th>
                  <td>
                    有用 {item.usefulnessScore ?? '—'} / 有趣{' '}
                    {item.interestScore ?? '—'}
                  </td>
                  <td>{signedNumber(item.totals.usefulness)}</td>
                  <td>{signedNumber(item.totals.interest)}</td>
                  <td>
                    {item.matchedRules.length === 0
                      ? '无'
                      : item.matchedRules
                          .map(
                            (match) =>
                              match.rule.displayValue +
                              ' ' +
                              signedNumber(match.signedWeight),
                          )
                          .join('、')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

function normalizeFeatureIdentity(value: string): string {
  const normalized = value.trim().normalize('NFC');
  let lowered = '';
  for (const character of normalized) {
    const codePoint = character.codePointAt(0);
    lowered +=
      codePoint !== undefined && codePoint >= 0x41 && codePoint <= 0x5a
        ? String.fromCodePoint(codePoint + 0x20)
        : character;
  }
  return lowered.normalize('NFC');
}

function createRuleId(): string | undefined {
  return typeof globalThis.crypto.randomUUID === 'function'
    ? globalThis.crypto.randomUUID()
    : undefined;
}

function shortIdentity(value: string): string {
  return value.length <= 12 ? value : value.slice(0, 8) + '…';
}

function signedNumber(value: number): string {
  return value > 0 ? '+' + value.toString() : value.toString();
}

function profilesHaveSameValue(
  left: Readonly<EntryPreferenceProfile>,
  right: Readonly<EntryPreferenceProfile>,
): boolean {
  if (
    left.enabled !== right.enabled ||
    left.rules.length !== right.rules.length
  ) {
    return false;
  }
  return left.rules.every((rule, index) => {
    const candidate = right.rules[index];
    return (
      candidate?.ruleId === rule.ruleId &&
      rule.dimension === candidate.dimension &&
      rule.featureKind === candidate.featureKind &&
      rule.featureIdentity === candidate.featureIdentity &&
      rule.displayValue === candidate.displayValue &&
      rule.effect === candidate.effect &&
      rule.weight === candidate.weight
    );
  });
}
