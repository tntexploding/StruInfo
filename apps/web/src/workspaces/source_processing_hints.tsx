import type {ReactNode} from 'react';
import {useEffect, useRef, useState} from 'react';
import type {SourceSubscriptionWrite} from '../api/m1c_api_contract.js';
import {aiError, aiWorkflowCommand} from '../api/ai_workflow_client.js';

type Profile = NonNullable<SourceSubscriptionWrite['processingProfile']>;
export function SourceProcessingHints({
  value,
  onChange,
  snapshotId,
  isPrivate = false,
  onRecipe,
  scopeToggle,
}: {
  readonly value: Profile | undefined;
  readonly onChange: (value: Profile) => void;
  readonly snapshotId?: string | undefined;
  readonly isPrivate?: boolean;
  readonly onRecipe: () => void;
  readonly scopeToggle: ReactNode;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const lock = useRef(false);
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const profile = value ?? {split: '', tags: '', relations: ''};
  async function suggest() {
    if (!snapshotId || isPrivate || lock.current) return;
    lock.current = true;
    setBusy(true);
    setError('');
    try {
      const result = await aiWorkflowCommand<{explanation: string}>(
        'split_recipe_suggest',
        {snapshotId, includePrivate: false},
      );
      if (mounted.current) onChange({...profile, split: result.explanation});
    } catch (e) {
      if (mounted.current) setError(aiError(e));
    } finally {
      lock.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  return (
    <section className="category ai-settings">
      <header>
        <div className="ai-heading">
          <h3>AI 设置</h3>
        </div>
        {scopeToggle}
      </header>
      <div className="ai-fields">
        <div className="prompt-field split-field">
          <div className="field-heading">
            <label htmlFor="source-split-text">拆分方案</label>
            <div className="inline-actions">
              <button
                type="button"
                className="text-action"
                disabled={busy || !snapshotId || isPrivate}
                onClick={() => void suggest()}
              >
                {busy ? '正在生成…' : 'AI 生成'}
              </button>
              <button type="button" className="text-action" onClick={onRecipe}>
                完整方案 ↗
              </button>
            </div>
          </div>
          <textarea
            disabled={busy}
            id="source-split-text"
            rows={3}
            maxLength={4000}
            value={profile.split}
            onChange={(e) => {
              onChange({...profile, split: e.target.value});
            }}
            placeholder="AI 生成后可直接修改"
          />
        </div>
        {(['tags', 'relations'] as const).map((key) => (
          <label className="setting-field prompt-field" key={key}>
            <span>{key === 'tags' ? '标签要求' : '联系要求'}</span>
            <textarea
              disabled={busy}
              rows={3}
              maxLength={4000}
              value={profile[key]}
              onChange={(e) => {
                onChange({...profile, [key]: e.target.value});
              }}
              placeholder={key === 'tags' ? '补充标签要求' : '补充联系要求'}
            />
          </label>
        ))}
      </div>
      {error ? <p role="alert">{error}</p> : null}
    </section>
  );
}
