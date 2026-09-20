import {IntakeOptions} from './intake_options.js';
import {DEFAULT_INTAKE_POLICY} from '../api/ai_workflow_client.js';
import {useState} from 'react';
import type {
  AiPolicy,
  AiPolicySettings,
  AiSource,
} from '../api/ai_workflow_client.js';
export function AiPolicyEditor({
  policy,
  sources,
  model,
  busy,
  onSave,
}: {
  readonly policy: AiPolicy;
  readonly sources: AiSource[];
  readonly model: string | undefined;
  readonly busy: boolean;
  readonly onSave: (
    revision: number,
    settings: AiPolicySettings,
  ) => Promise<boolean>;
}) {
  const [draft, setDraft] = useState<AiPolicy>(() => structuredClone(policy));
  const set = (patch: Partial<AiPolicySettings>) => {
    setDraft((current) => ({
      ...current,
      settings: {...current.settings, ...patch},
    }));
  };
  return (
    <form
      className="ai-policy-form"
      onSubmit={(event) => {
        event.preventDefault();
        void onSave(draft.revision, draft.settings).then((saved) => {
          if (saved)
            setDraft((current) => ({
              ...current,
              revision: current.revision + 1,
            }));
        });
      }}
    >
      <fieldset className="ai-policy-fields" disabled={busy}>
        {policy.revision !== draft.revision ? (
          <p role="status">
            服务器策略已变化，当前草稿保留。可重新读取最新策略。
          </p>
        ) : null}
        <div className="entry-command-actions">
          <label>
            <input
              type="checkbox"
              checked={draft.settings.enabled}
              onChange={(e) => {
                set({enabled: e.currentTarget.checked});
              }}
            />{' '}
            启用新资料自动处理
          </label>
          <label>
            <input
              type="checkbox"
              checked={draft.settings.paused}
              onChange={(e) => {
                set({paused: e.currentTarget.checked});
              }}
            />{' '}
            暂停处理，继续收件
          </label>
        </div>
        <fieldset className="ai-source-scope">
          <legend>处理范围 · 仅新增公开资料</legend>
          <label>
            <input
              type="checkbox"
              checked={draft.settings.manualUploads}
              onChange={(e) => {
                set({manualUploads: e.currentTarget.checked});
              }}
            />{' '}
            普通手动导入
          </label>
          <div className="ai-source-options">
            {sources.length ? (
              sources.map((source) => (
                <label key={source.subscriptionId}>
                  <input
                    type="checkbox"
                    checked={draft.settings.subscriptionIds.includes(
                      source.subscriptionId,
                    )}
                    onChange={(e) => {
                      set({
                        subscriptionIds: e.currentTarget.checked
                          ? [
                              ...draft.settings.subscriptionIds,
                              source.subscriptionId,
                            ]
                          : draft.settings.subscriptionIds.filter(
                              (id) => id !== source.subscriptionId,
                            ),
                      });
                    }}
                  />
                  <span>
                    {source.label}
                    {source.enabled ? '' : ' · 定时采集关闭'}
                  </span>
                </label>
              ))
            ) : (
              <p>还没有公开订阅，可在收件箱添加。</p>
            )}
          </div>
        </fieldset>
        <label>
          <input
            type="checkbox"
            checked={Boolean(draft.settings.intake)}
            onChange={(e) => {
              if (e.currentTarget.checked)
                set({intake: structuredClone(DEFAULT_INTAKE_POLICY)});
              else
                setDraft((current) => {
                  const settings = {...current.settings};
                  delete settings.intake;
                  return {...current, settings};
                });
            }}
          />{' '}
          入库前审核完整性与内容
        </label>
        {draft.settings.intake ? (
          <IntakeOptions
            value={draft.settings.intake}
            onChange={(intake) => {
              set({intake});
            }}
          />
        ) : null}
        <label>
          <input
            type="checkbox"
            checked={draft.settings.maxRelationCandidates !== undefined}
            onChange={(e) => {
              if (e.currentTarget.checked) set({maxRelationCandidates: 12});
              else
                setDraft((current) => {
                  const settings = {...current.settings};
                  delete settings.maxRelationCandidates;
                  return {...current, settings};
                });
            }}
          />{' '}
          多语与近义词召回（保留原标签）
        </label>
        {draft.settings.maxRelationCandidates !== undefined ? (
          <label className="field">
            <span>每篇最多检查关联候选</span>
            <input
              type="number"
              min={0}
              max={24}
              required
              value={draft.settings.maxRelationCandidates}
              onChange={(e) => {
                set({maxRelationCandidates: e.currentTarget.valueAsNumber});
              }}
            />
          </label>
        ) : null}
        <div className="ai-budget-fields">
          <label className="field">
            <span>任务模型</span>
            <input
              value={draft.settings.model}
              onChange={(e) => {
                set({model: e.currentTarget.value});
              }}
              placeholder={model ?? '先在外部配置模型'}
            />
          </label>
          {(
            [
              ['maxDocumentsPerDay', '每日新文档', 1, 100],
              ['maxEntries', '每篇最多条目', 1, 64],
              ['maxRelations', '每篇最多联系', 0, 8],
              ['maxModelCalls', '每篇调用尝试', 1, 64],
            ] as const
          ).map(([key, label, min, max]) => (
            <label className="field" key={key}>
              <span>{label}</span>
              <input
                type="number"
                min={min}
                max={max}
                required
                value={draft.settings[key]}
                onChange={(e) => {
                  set({[key]: e.currentTarget.valueAsNumber});
                }}
              />
            </label>
          ))}
        </div>
        <p className="workflow-boundary-note">
          每日额度按 UTC
          计数；每篇调用额度包括重试。原文始终保留，私有材料不外发。
        </p>
        <div className="entry-command-actions">
          <button
            type="submit"
            className="primary-action"
            disabled={
              busy ||
              (draft.settings.enabled && !draft.settings.paused && !model)
            }
          >
            保存处理策略
          </button>
          <button
            type="button"
            className="secondary-action"
            disabled={busy}
            onClick={() => {
              setDraft(structuredClone(policy));
            }}
          >
            重新读取策略
          </button>
        </div>
      </fieldset>
    </form>
  );
}
