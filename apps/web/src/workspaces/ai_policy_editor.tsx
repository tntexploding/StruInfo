import {ContentDialog} from '../components/content_dialog.js';
import {
  SettingCard,
  SettingRow,
  SettingSwitch,
} from '../components/setting_controls.js';
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
  ) => Promise<AiPolicy | undefined>;
}) {
  const [draft, setDraft] = useState<AiPolicy>(() => structuredClone(policy));
  const set = (patch: Partial<AiPolicySettings>) => {
    setDraft((current) => ({
      ...current,
      settings: {...current.settings, ...patch},
    }));
  };
  const [dialog, setDialog] = useState<'sources' | 'intake' | 'limits'>();
  return (
    <form
      className="ai-policy-form"
      onSubmit={(event) => {
        event.preventDefault();
        void onSave(draft.revision, draft.settings).then((saved) => {
          if (saved) setDraft(saved);
        });
      }}
    >
      <fieldset className="ai-policy-fields" disabled={busy}>
        {policy.revision !== draft.revision ? (
          <p role="status">
            服务器策略已变化，当前草稿保留。可重新读取最新策略。
          </p>
        ) : null}
        <div className="settings-policy-grid">
          <SettingCard title="新增资料" className="ai-card">
            <SettingRow title="自动处理新资料">
              {(id) => (
                <SettingSwitch
                  id={id}
                  checked={draft.settings.enabled}
                  onChange={(enabled) => {
                    set({enabled});
                  }}
                />
              )}
            </SettingRow>
            <SettingRow title="暂停处理，继续收件">
              {(id) => (
                <SettingSwitch
                  id={id}
                  checked={draft.settings.paused}
                  onChange={(paused) => {
                    set({paused});
                  }}
                />
              )}
            </SettingRow>
            <SettingRow title="普通手动导入">
              {(id) => (
                <SettingSwitch
                  id={id}
                  checked={draft.settings.manualUploads}
                  onChange={(manualUploads) => {
                    set({manualUploads});
                  }}
                />
              )}
            </SettingRow>
            <SettingRow
              title="订阅范围"
              hint={String(draft.settings.subscriptionIds.length) + ' 个来源'}
            >
              {(id) => (
                <button
                  id={id}
                  type="button"
                  className="secondary-action"
                  onClick={() => {
                    setDialog('sources');
                  }}
                >
                  选择来源
                </button>
              )}
            </SettingRow>
          </SettingCard>
          <SettingCard title="审核与限额" className="ai-card">
            <SettingRow title="接收前审核">
              {(id) => (
                <SettingSwitch
                  id={id}
                  checked={Boolean(draft.settings.intake)}
                  onChange={(enabled) => {
                    if (enabled)
                      set({intake: structuredClone(DEFAULT_INTAKE_POLICY)});
                    else
                      setDraft((current) => {
                        const settings = {...current.settings};
                        delete settings.intake;
                        return {...current, settings};
                      });
                  }}
                />
              )}
            </SettingRow>
            <SettingRow title="审核规则">
              {(id) => (
                <button
                  id={id}
                  type="button"
                  className="secondary-action"
                  disabled={!draft.settings.intake}
                  onClick={() => {
                    setDialog('intake');
                  }}
                >
                  编辑
                </button>
              )}
            </SettingRow>
            <SettingRow title="任务模型">
              {(id) => (
                <input
                  id={id}
                  value={draft.settings.model}
                  placeholder={model ?? '服务器尚未配置模型'}
                  onChange={(e) => {
                    set({model: e.currentTarget.value});
                  }}
                />
              )}
            </SettingRow>
            <SettingRow title="每日新文档">
              {(id) => (
                <input
                  id={id}
                  type="number"
                  min={1}
                  max={100}
                  required
                  value={draft.settings.maxDocumentsPerDay}
                  onChange={(e) => {
                    set({maxDocumentsPerDay: e.currentTarget.valueAsNumber});
                  }}
                />
              )}
            </SettingRow>
            <SettingRow title="单篇限额">
              {(id) => (
                <button
                  id={id}
                  type="button"
                  className="secondary-action"
                  onClick={() => {
                    setDialog('limits');
                  }}
                >
                  设置上限
                </button>
              )}
            </SettingRow>
          </SettingCard>
        </div>
        <ContentDialog
          open={dialog !== undefined}
          title={
            dialog === 'sources'
              ? '自动处理的来源'
              : dialog === 'intake'
                ? '接收审核规则'
                : '单篇处理限额'
          }
          onClose={() => {
            setDialog(undefined);
          }}
        >
          {dialog === 'sources' ? (
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
                    {source.label}
                    {source.enabled ? '' : ' · 自动检查已关闭'}
                  </label>
                ))
              ) : (
                <p>还没有公开订阅，可在源管理中添加。</p>
              )}
            </div>
          ) : null}
          {dialog === 'intake' && draft.settings.intake ? (
            <IntakeOptions
              value={draft.settings.intake}
              onChange={(intake) => {
                set({intake});
              }}
            />
          ) : null}
          {dialog === 'limits' ? (
            <div>
              {(
                [
                  ['maxEntries', '每篇最多条目', 1, 64],
                  ['maxModelCalls', '每篇调用尝试', 1, 64],
                ] as const
              ).map(([key, label, min, max]) => (
                <SettingRow key={key} title={label}>
                  {(id) => (
                    <input
                      id={id}
                      type="number"
                      min={min}
                      max={max}
                      required
                      value={draft.settings[key]}
                      onChange={(e) => {
                        set({[key]: e.currentTarget.valueAsNumber});
                      }}
                    />
                  )}
                </SettingRow>
              ))}
              <p>调用上限包含重试；每篇任务保留自己的限额。</p>
            </div>
          ) : null}
          <button
            type="button"
            className="primary-action"
            onClick={() => {
              setDialog(undefined);
            }}
          >
            完成编辑
          </button>
        </ContentDialog>
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
