import {useState} from 'react';
import type {
  ReviewPreferencesResponse,
  ReviewPreferencesWrite,
  M1cHttpResponse,
} from '../api/m1c_api_contract.js';
import type {Loadable} from '../components/product_types.js';
import type {InformationEntryServices} from './information_entry_components.js';
import {AssociationPolicyPanel} from './association_policy_panel.js';

export function ReviewSettings({
  preferences,
  onSave,
  onSaveAssociation,
  onRebuild,
  onReload,
}: {
  readonly preferences: Loadable<Readonly<ReviewPreferencesResponse>>;
  readonly onSave: (
    value: Readonly<ReviewPreferencesWrite>,
  ) => Promise<M1cHttpResponse<ReviewPreferencesResponse>>;
  readonly onSaveAssociation: InformationEntryServices['onReviseAssociationPolicy'];
  readonly onRebuild: InformationEntryServices['onRebuildAssociations'];
  readonly onReload: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  if (preferences.status !== 'ready')
    return (
      <p>
        标签与联系配置尚未读取。
        <button
          type="button"
          className="text-action"
          onClick={() => {
            void onReload();
          }}
        >
          重新读取
        </button>
      </p>
    );
  const value = preferences.value;
  return (
    <>
      <section
        className="settings-group"
        aria-labelledby="vocabulary-settings-title"
      >
        <h2 id="vocabulary-settings-title">标签与个人词表</h2>
        <p>设置常用标签、忽略的词语，以及同一个词的不同写法。</p>
        <VocabularySettings value={value} onSave={onSave} />
      </section>
      <section
        className="settings-group"
        aria-labelledby="association-settings-title"
      >
        <h2 id="association-settings-title">联系推荐</h2>
        <p>调整本地相似度计算。AI 建立联系时仍按原文判断。</p>
        <AssociationPolicyPanel
          key={value.associationPolicy.revision}
          policy={value.associationPolicy}
          saving={busy}
          onSave={(draft) => {
            if (busy) return;
            setBusy(true);
            setMessage('');
            void (async () => {
              try {
                const result = await onSaveAssociation({
                  expectedRevision: value.associationPolicy.revision,
                  ...draft,
                });
                if (
                  result.body.status !== 'applied' &&
                  result.body.status !== 'unchanged'
                ) {
                  setMessage('保存未完成；请重新读取配置后再试。');
                  return;
                }
                await onReload();
                if (result.body.status === 'applied') {
                  const rebuilt = await onRebuild({includePrivate: false});
                  setMessage(
                    rebuilt.body.status === 'rebuilt'
                      ? '联系设置已保存，公开推荐已更新。人工关系保持原有设置。'
                      : '设置已保存；推荐更新尚未成功，可在联系维护中重试。',
                  );
                } else setMessage('联系设置没有变化。');
              } catch {
                setMessage('未能确认执行结果，请重新读取当前设置。');
              } finally {
                setBusy(false);
              }
            })();
          }}
        />
        <p role="status">{message}</p>
      </section>
    </>
  );
}
function VocabularySettings({
  value,
  onSave,
}: {
  readonly value: Readonly<ReviewPreferencesResponse>;
  readonly onSave: (
    value: Readonly<ReviewPreferencesWrite>,
  ) => Promise<M1cHttpResponse<ReviewPreferencesResponse>>;
}) {
  const [quick, setQuick] = useState(value.quickTags.join('\n'));
  const [excluded, setExcluded] = useState(
    value.automaticKeywords.excludedKeywords.join('\n'),
  );
  const [aliases, setAliases] = useState(
    value.vocabulary.aliases
      .map((v) => v.source + ' => ' + v.canonical)
      .join('\n'),
  );
  const [enabled, setEnabled] = useState(value.automaticKeywords.enabled);
  const [domains, setDomains] = useState(
    value.automaticKeywords.includeLinkDomains,
  );
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState('');
  const lines = (s: string) =>
    s
      .split(/\r?\n/u)
      .map((v) => v.trim())
      .filter(Boolean);
  return (
    <form
      className="settings-form"
      onSubmit={(event) => {
        event.preventDefault();
        if (busy) return;
        const rules = lines(aliases).map((line) =>
          line.split('=>').map((v) => v.trim()),
        );
        if (
          rules.some((parts) => parts.length !== 2 || !parts[0] || !parts[1])
        ) {
          setMessage('每行别名请使用“原词 => 规范词”。');
          return;
        }
        setBusy(true);
        setMessage('');
        void onSave({
          quickTags: lines(quick),
          automaticKeywords: {
            enabled,
            includeLinkDomains: domains,
            excludedKeywords: lines(excluded),
          },
          vocabulary: {
            aliases: rules.map((parts) => ({
              source: parts[0] ?? '',
              canonical: parts[1] ?? '',
            })),
          },
        })
          .then(() => {
            setMessage('标签设置已保存。');
          })
          .catch(() => {
            setMessage('未能确认保存结果，草稿保留。');
          })
          .finally(() => {
            setBusy(false);
          });
      }}
    >
      <label>
        <input
          type="checkbox"
          checked={enabled}
          onChange={(event) => {
            setEnabled(event.currentTarget.checked);
          }}
        />
        提供本地关键词建议
      </label>
      <label>
        <input
          type="checkbox"
          checked={domains}
          onChange={(event) => {
            setDomains(event.currentTarget.checked);
          }}
        />
        包含链接域名
      </label>
      <label className="field">
        <span>快捷标签（每行一个，最多 24 个）</span>
        <textarea
          value={quick}
          onChange={(event) => {
            setQuick(event.currentTarget.value);
          }}
        />
      </label>
      <label className="field">
        <span>排除关键词（每行一个）</span>
        <textarea
          value={excluded}
          onChange={(event) => {
            setExcluded(event.currentTarget.value);
          }}
        />
      </label>
      <label className="field">
        <span>词语别名（每行：原词 =&gt; 规范词）</span>
        <textarea
          value={aliases}
          onChange={(event) => {
            setAliases(event.currentTarget.value);
          }}
        />
      </label>
      <button className="primary-action" type="submit" disabled={busy}>
        {busy ? '正在保存…' : '保存标签设置'}
      </button>
      <p role="status">{message}</p>
    </form>
  );
}
