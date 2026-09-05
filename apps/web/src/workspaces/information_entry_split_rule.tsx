import {useEffect, useMemo, useRef, useState} from 'react';

import type {
  EntrySplitRuleApplyResponse,
  EntrySplitRuleProfile,
  EntrySplitRuleProfileResponse,
  EntrySplitRuleProfileWriteResponse,
  EntrySplitRuleTrial,
  EntrySplitRuleTrialResponse,
  M1cHttpResponse,
} from '../api/m1c_api_contract.js';
import {ActionNotice} from '../components/action_notice.js';
import type {ActionFeedback} from '../components/product_types.js';

export interface InformationEntrySplitRuleProps {
  readonly snapshotId: string;
  readonly isPrivate: boolean;
  readonly includePrivate: boolean;
  readonly alreadyMaterialized: boolean;
  readonly onLoad: () => Promise<
    M1cHttpResponse<EntrySplitRuleProfileResponse>
  >;
  readonly onSave: (
    body: unknown,
  ) => Promise<M1cHttpResponse<EntrySplitRuleProfileWriteResponse>>;
  readonly onTrial: (
    body: unknown,
  ) => Promise<M1cHttpResponse<EntrySplitRuleTrialResponse>>;
  readonly onApply: (
    body: unknown,
  ) => Promise<M1cHttpResponse<EntrySplitRuleApplyResponse>>;
  readonly onCommitted: () => Promise<void>;
}

export function InformationEntrySplitRule({
  snapshotId,
  isPrivate,
  includePrivate,
  alreadyMaterialized,
  onLoad,
  onSave,
  onTrial,
  onApply,
  onCommitted,
}: InformationEntrySplitRuleProps) {
  const [saved, setSaved] = useState<Readonly<EntrySplitRuleProfile>>();
  const [draft, setDraft] = useState<Readonly<EntrySplitRuleProfile>>();
  const [trialState, setTrialState] =
    useState<
      Readonly<{trial: Readonly<EntrySplitRuleTrial>; includePrivate: boolean}>
    >();
  const [busy, setBusy] = useState<
    'load' | 'save' | 'trial' | 'apply' | undefined
  >('load');
  const [feedbackState, setFeedbackState] =
    useState<Readonly<{feedback: ActionFeedback; scopeKey?: string}>>();
  const requestGeneration = useRef(0);
  const scopeKey = `${snapshotId}:${includePrivate ? 'private' : 'public'}`;
  const feedback =
    feedbackState?.scopeKey === undefined || feedbackState.scopeKey === scopeKey
      ? feedbackState?.feedback
      : undefined;

  function clearFeedback() {
    setFeedbackState(undefined);
  }

  function publishFeedback(next: ActionFeedback, nextScopeKey?: string) {
    setFeedbackState(
      Object.freeze(
        nextScopeKey === undefined
          ? {feedback: next}
          : {feedback: next, scopeKey: nextScopeKey},
      ),
    );
  }

  useEffect(() => {
    const generation = ++requestGeneration.current;
    void onLoad()
      .then((response) => {
        if (generation !== requestGeneration.current) return;
        if (response.body.status !== 'ok') {
          setFeedbackState(
            Object.freeze({
              feedback: failure('拆分规则未读取', response.body),
            }),
          );
          return;
        }
        setSaved(response.body.profile);
        setDraft(response.body.profile);
      })
      .catch(() => {
        if (generation !== requestGeneration.current) return;
        setFeedbackState(
          Object.freeze({
            feedback: {
              kind: 'error' as const,
              title: '拆分规则未读取',
              detail: '个人配置当前不可用；文档和条目没有变化。',
            },
          }),
        );
      })
      .finally(() => {
        if (generation === requestGeneration.current) setBusy(undefined);
      });
    return () => {
      requestGeneration.current += 1;
    };
  }, [onLoad]);

  const valid = useMemo(() => isValid(draft), [draft]);
  const dirty = useMemo(
    () =>
      saved !== undefined && draft !== undefined && !sameProfile(saved, draft),
    [draft, saved],
  );
  const blocked =
    snapshotId === '' || alreadyMaterialized || (isPrivate && !includePrivate);
  const visibleTrial =
    trialState?.trial.snapshotId === snapshotId &&
    trialState.includePrivate === includePrivate
      ? trialState.trial
      : undefined;
  const previewMatchesSaved =
    visibleTrial !== undefined &&
    saved !== undefined &&
    sameProfile(visibleTrial.profile, saved);

  function revise<Key extends keyof EntrySplitRuleProfile>(
    key: Key,
    value: EntrySplitRuleProfile[Key],
  ) {
    setDraft((current) =>
      current === undefined
        ? current
        : Object.freeze({...current, [key]: value}),
    );
    setTrialState(undefined);
    clearFeedback();
  }

  async function save() {
    if (
      draft === undefined ||
      saved === undefined ||
      !valid ||
      busy !== undefined
    ) {
      return;
    }
    const generation = ++requestGeneration.current;
    setBusy('save');
    clearFeedback();
    try {
      const response = await onSave({
        expectedRevision: saved.revision,
        mode: draft.mode,
        minimumGroupCodePoints: draft.minimumGroupCodePoints,
        maximumGroupCodePoints: draft.maximumGroupCodePoints,
        maximumFragmentsPerGroup: draft.maximumFragmentsPerGroup,
      });
      if (generation !== requestGeneration.current) return;
      if (
        response.body.status !== 'applied' &&
        response.body.status !== 'unchanged'
      ) {
        publishFeedback(failure('规则没有保存', response.body));
        return;
      }
      setSaved(response.body.profile);
      setDraft(response.body.profile);
      setTrialState(undefined);
      publishFeedback({
        kind: 'success',
        title:
          response.body.status === 'applied'
            ? '拆分规则已保存'
            : '规则没有变化',
        detail: '规则已保存到个人设置，不会写入文档正文。',
      });
    } catch {
      if (generation === requestGeneration.current) {
        publishFeedback({
          kind: 'error',
          title: '规则没有保存',
          detail: '本地接口当前不可达。',
        });
      }
    } finally {
      if (generation === requestGeneration.current) setBusy(undefined);
    }
  }

  async function preview() {
    if (draft === undefined || !valid || blocked || busy !== undefined) return;
    const generation = ++requestGeneration.current;
    setBusy('trial');
    clearFeedback();
    try {
      const response = await onTrial({
        snapshotId,
        includePrivate,
        profile: draft,
      });
      if (generation !== requestGeneration.current) return;
      if (response.body.status !== 'previewed') {
        setTrialState(undefined);
        publishFeedback(failure('无法生成规则预览', response.body), scopeKey);
        return;
      }
      setTrialState(
        Object.freeze({trial: response.body.trial, includePrivate}),
      );
      publishFeedback(
        {
          kind: 'success',
          title: '规则预览已生成',
          detail: `将 ${response.body.trial.sourceFragmentCount.toString()} 个原文片段整理为 ${response.body.trial.groups.length.toString()} 个条目。`,
        },
        scopeKey,
      );
    } catch {
      if (generation === requestGeneration.current) {
        setTrialState(undefined);
        publishFeedback(
          {
            kind: 'error',
            title: '无法生成规则预览',
            detail: '本地接口当前不可达。',
          },
          scopeKey,
        );
      }
    } finally {
      if (generation === requestGeneration.current) setBusy(undefined);
    }
  }

  async function apply() {
    if (
      saved === undefined ||
      dirty ||
      !previewMatchesSaved ||
      blocked ||
      busy !== undefined
    ) {
      return;
    }
    const generation = ++requestGeneration.current;
    setBusy('apply');
    clearFeedback();
    try {
      const response = await onApply({
        snapshotId,
        includePrivate,
        expectedProfileRevision: saved.revision,
      });
      if (generation !== requestGeneration.current) return;
      if (
        response.body.status !== 'created' &&
        response.body.status !== 'existing'
      ) {
        publishFeedback(failure('规则没有应用', response.body), scopeKey);
        return;
      }
      publishFeedback(
        {
          kind: 'success',
          title:
            response.body.status === 'created'
              ? '规则拆分已完成'
              : '相同结果已经存在',
          detail: `当前文档包含 ${response.body.entries.length.toString()} 个条目。`,
        },
        scopeKey,
      );
      await onCommitted();
    } catch {
      if (generation === requestGeneration.current) {
        publishFeedback(
          {
            kind: 'error',
            title: '规则没有应用',
            detail: '本地接口当前不可达。',
          },
          scopeKey,
        );
      }
    } finally {
      if (generation === requestGeneration.current) setBusy(undefined);
    }
  }

  return (
    <section
      className="entry-command-panel split-rule-panel"
      aria-labelledby="split-rule-title"
    >
      <header className="console-heading">
        <div>
          <h2 id="split-rule-title">结构规则</h2>
          <p>设置规则后，可以先预览再生成条目。</p>
        </div>
      </header>

      {draft === undefined ? (
        <p className="empty-copy">正在读取拆分规则…</p>
      ) : (
        <div className="split-rule-layout">
          <div className="split-rule-controls">
            <fieldset disabled={busy !== undefined}>
              <legend>规则模式</legend>
              <label className="split-rule-choice">
                <input
                  type="radio"
                  name="entry-split-rule-mode"
                  checked={draft.mode === 'one_section'}
                  onChange={() => {
                    revise('mode', 'one_section');
                  }}
                />
                <span>
                  <strong>每个结构段独立</strong>
                  <small>保持当前默认行为，适合已经分段清晰的材料。</small>
                </span>
              </label>
              <label className="split-rule-choice">
                <input
                  type="radio"
                  name="entry-split-rule-mode"
                  checked={draft.mode === 'merge_short_adjacent'}
                  onChange={() => {
                    revise('mode', 'merge_short_adjacent');
                  }}
                />
                <span>
                  <strong>合并相邻短段</strong>
                  <small>只合并相邻短段，不修改或打乱原文。</small>
                </span>
              </label>
            </fieldset>

            <div
              className="split-rule-number-grid"
              aria-disabled={draft.mode === 'one_section'}
            >
              <label>
                期望最短字符数
                <input
                  type="number"
                  min="1"
                  max="200000"
                  value={draft.minimumGroupCodePoints}
                  disabled={draft.mode === 'one_section' || busy !== undefined}
                  onChange={(event) => {
                    revise(
                      'minimumGroupCodePoints',
                      Number(event.currentTarget.value),
                    );
                  }}
                />
              </label>
              <label>
                允许最长字符数
                <input
                  type="number"
                  min="1"
                  max="200000"
                  value={draft.maximumGroupCodePoints}
                  disabled={draft.mode === 'one_section' || busy !== undefined}
                  onChange={(event) => {
                    revise(
                      'maximumGroupCodePoints',
                      Number(event.currentTarget.value),
                    );
                  }}
                />
              </label>
              <label>
                单组最多结构段
                <input
                  type="number"
                  min="1"
                  max="64"
                  value={draft.maximumFragmentsPerGroup}
                  disabled={draft.mode === 'one_section' || busy !== undefined}
                  onChange={(event) => {
                    revise(
                      'maximumFragmentsPerGroup',
                      Number(event.currentTarget.value),
                    );
                  }}
                />
              </label>
            </div>

            {!valid ? (
              <p className="field-error">
                请输入有效整数；最长字符数不能小于最短字符数。
              </p>
            ) : null}
            <div className="entry-command-actions split-rule-actions">
              <button
                type="button"
                className="secondary-action"
                disabled={!dirty || !valid || busy !== undefined}
                onClick={() => void save()}
              >
                {busy === 'save' ? '正在保存…' : '保存规则'}
              </button>
              <button
                type="button"
                className="secondary-action"
                disabled={!valid || blocked || busy !== undefined}
                onClick={() => void preview()}
              >
                {busy === 'trial' ? '正在预览…' : '预览当前文档'}
              </button>
              <button
                type="button"
                className="primary-action"
                disabled={
                  dirty || !previewMatchesSaved || blocked || busy !== undefined
                }
                onClick={() => void apply()}
              >
                {busy === 'apply' ? '正在生成…' : '按已保存规则生成'}
              </button>
            </div>
            {alreadyMaterialized ? (
              <p className="empty-copy">
                当前文档已有条目；本规则只处理尚未拆分的文档。
              </p>
            ) : null}
            {isPrivate && !includePrivate ? (
              <p className="empty-copy">
                勾选“查看并处理隐私文档”后才能在本地预览。
              </p>
            ) : null}
          </div>

          <div className="split-rule-preview" aria-live="polite">
            <h3>结果预览</h3>
            {visibleTrial === undefined ? (
              <p className="empty-copy">
                选择当前文档并运行预览后，这里会显示最终分组；预览不会写入数据库。
              </p>
            ) : (
              <ol tabIndex={0} aria-label="拆分规则预览结果">
                {visibleTrial.groups.map((group) => (
                  <li
                    key={`${visibleTrial.snapshotId}:${group.ordinal.toString()}`}
                  >
                    <div>
                      <strong>{group.titlePath}</strong>
                      <span>
                        {group.fragmentCount.toString()} 段 ·{' '}
                        {group.codePointCount.toString()} 字符
                      </span>
                    </div>
                    <p>
                      {group.previewText}
                      {group.previewTruncated ? '…' : ''}
                    </p>
                    {group.exceedsMaximum ? (
                      <small>
                        原文片段本身超过当前上限；规则不会从中间截断。
                      </small>
                    ) : null}
                  </li>
                ))}
              </ol>
            )}
          </div>
        </div>
      )}
      <ActionNotice feedback={feedback} />
    </section>
  );
}

function isValid(
  profile: Readonly<EntrySplitRuleProfile> | undefined,
): boolean {
  return (
    profile !== undefined &&
    Number.isSafeInteger(profile.minimumGroupCodePoints) &&
    profile.minimumGroupCodePoints >= 1 &&
    Number.isSafeInteger(profile.maximumGroupCodePoints) &&
    profile.maximumGroupCodePoints >= profile.minimumGroupCodePoints &&
    profile.maximumGroupCodePoints <= 200_000 &&
    Number.isSafeInteger(profile.maximumFragmentsPerGroup) &&
    profile.maximumFragmentsPerGroup >= 1 &&
    profile.maximumFragmentsPerGroup <= 64
  );
}

function sameProfile(
  left: Readonly<EntrySplitRuleProfile>,
  right: Readonly<EntrySplitRuleProfile>,
): boolean {
  return (
    left.revision === right.revision &&
    left.mode === right.mode &&
    left.minimumGroupCodePoints === right.minimumGroupCodePoints &&
    left.maximumGroupCodePoints === right.maximumGroupCodePoints &&
    left.maximumFragmentsPerGroup === right.maximumFragmentsPerGroup
  );
}

function failure(title: string, body: unknown): ActionFeedback {
  const code =
    typeof body === 'object' &&
    body !== null &&
    'issue' in body &&
    typeof body.issue === 'object' &&
    body.issue !== null &&
    'code' in body.issue &&
    typeof body.issue.code === 'string'
      ? body.issue.code
      : 'unknown';
  const detail =
    code === 'stale_entry_split_rule_profile_revision'
      ? '个人配置已在另一请求中更新，请重新加载后再操作。'
      : code === 'split_structure_already_materialized'
        ? '当前文档已经存在条目，不能再次创建另一套结构。'
        : code === 'snapshot_not_found'
          ? '当前文档不存在，或隐私查看尚未开启。'
          : '请求未完成；文档、原文片段和条目保持不变。';
  return {kind: 'error', title, detail};
}
