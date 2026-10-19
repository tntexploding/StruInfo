import {useState} from 'react';
import type {SourceSubscriptionWrite} from '../api/m1c_api_contract.js';
import {aiError, aiWorkflowCommand} from '../api/ai_workflow_client.js';

interface Suggestion {
  text: string;
  sampleCount: number;
  key: string;
}
function failure(error: unknown) {
  const code = error instanceof Error ? error.message : '';
  return (
    (
      {
        ai_price_window_closed: '当前不在低价时段，请在低价时段再点击生成。',
        ai_not_configured: '请先在设置中配置 AI，简介仍可手动填写。',
        private_model_transfer_forbidden: '隐私来源请手动填写简介。',
        source_description_invalid: '请检查来源名称、地址与简介长度。',
        source_description_url_required: '请先填写来源地址。',
        source_description_read_failed:
          '无法读取来源介绍，请检查公开地址，或手动填写简介。',
        source_description_evidence_required:
          '来源信息不足，请先在简介框补充主题与内容线索，再生成。',
      } as Record<string, string>
    )[code] ?? aiError(error)
  );
}

export function SourceDescriptionField({
  subscription,
  disabled,
  onChange,
}: {
  subscription: Readonly<SourceSubscriptionWrite>;
  disabled: boolean;
  onChange: (description: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [suggestion, setSuggestion] = useState<Suggestion>();
  const [error, setError] = useState('');
  const readsSource =
    subscription.kind === 'rss_atom' || subscription.kind === 'web';
  const url =
    subscription.kind === 'rss_atom'
      ? subscription.feedUrl
      : subscription.kind === 'web'
        ? subscription.pageUrl
        : undefined;
  const input = {
    label: subscription.label,
    kind: subscription.kind,
    isPrivate: subscription.isPrivate,
    ...(url === undefined ? {} : {url}),
    notes: subscription.description ?? '',
  };
  const key = JSON.stringify(input);
  const ready =
    Boolean(
      subscription.label.trim() &&
      (readsSource ? url?.trim() : input.notes.trim()),
    ) && !subscription.isPrivate;
  async function generate() {
    if (!ready || busy || disabled) return;
    setBusy(true);
    setError('');
    setSuggestion(undefined);
    try {
      const result = await aiWorkflowCommand<{
        text: string;
        sampleCount: number;
      }>('source_description_generate', input);
      setSuggestion({...result, key});
    } catch (e) {
      setError(failure(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="field--wide source-description-field">
      <label className="field">
        <span>来源简介</span>
        <textarea
          maxLength={500}
          rows={3}
          disabled={disabled}
          placeholder="这个来源关注什么，通常发布哪些文章"
          value={subscription.description ?? ''}
          onChange={(event) => {
            onChange(event.currentTarget.value);
          }}
        />
      </label>
      <div className="source-description-actions">
        <button
          type="button"
          className="secondary-action"
          disabled={disabled || busy || !ready}
          onClick={() => {
            void generate();
          }}
        >
          {busy ? '正在生成简介…' : 'AI 生成简介'}
        </button>
        <small>
          {subscription.isPrivate
            ? '隐私来源请手动填写简介。'
            : readsSource
              ? '可选：填写名称和地址后，根据来源介绍与近期内容生成。'
              : '可选：先在简介框填写内容线索，再用 AI 整理。'}
        </small>
      </div>
      {busy ? (
        <p className="muted-copy" role="status">
          正在读取来源信息并生成简介草稿…
        </p>
      ) : null}
      {error ? <p role="alert">{error}</p> : null}
      {suggestion ? (
        <div className="source-description-suggestion" role="status">
          {suggestion.key === key ? (
            <>
              <strong>AI 简介草稿</strong>
              <p>{suggestion.text}</p>
              <div className="source-description-actions">
                <button
                  type="button"
                  className="secondary-action"
                  disabled={disabled}
                  onClick={() => {
                    onChange(suggestion.text);
                    setSuggestion(undefined);
                  }}
                >
                  使用这份简介
                </button>
                <small>可继续修改，保存订阅设置后生效。</small>
              </div>
            </>
          ) : (
            <p>来源资料已变化，生成的旧草稿未应用，请重新生成。</p>
          )}
        </div>
      ) : null}
    </div>
  );
}
