import {useEffect, useState} from 'react';
import {
  aiError,
  aiWorkflowCommand,
  type AiPolicy,
  type AiQueueStatus,
} from '../api/ai_workflow_client.js';

/** Per-source scope uses the same policy and revision as Settings. */
export function SourceAiScopeToggle({
  subscriptionId,
  isPrivate,
  saved,
}: {
  readonly subscriptionId: string;
  readonly isPrivate: boolean;
  readonly saved: boolean;
}) {
  const [policy, setPolicy] = useState<AiPolicy>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    let current = true;
    void aiWorkflowCommand<AiQueueStatus>('ingestion_status', {limit: 1})
      .then((result) => {
        if (current) setPolicy(result.policy);
      })
      .catch((e: unknown) => {
        if (current) setError(aiError(e));
      });
    return () => {
      current = false;
    };
  }, [subscriptionId]);
  async function change(enabled: boolean) {
    if (!policy || busy || !saved || isPrivate) return;
    setBusy(true);
    setError('');
    const settings = {
      ...policy.settings,
      subscriptionIds: enabled
        ? [...new Set([...policy.settings.subscriptionIds, subscriptionId])]
        : policy.settings.subscriptionIds.filter((id) => id !== subscriptionId),
    };
    try {
      const next = await aiWorkflowCommand<AiPolicy>('ingestion_policy_save', {
        expectedRevision: policy.revision,
        settings,
      });
      setPolicy(next);
    } catch (e) {
      setError(aiError(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="source-ai-scope">
      <label
        className="switch-label"
        title={
          !saved
            ? '先保存来源'
            : !policy?.settings.enabled
              ? '全局自动处理尚未开启'
              : ''
        }
      >
        <span>AI 自动处理</span>
        <input
          type="checkbox"
          role="switch"
          disabled={!policy || busy || !saved || isPrivate}
          checked={Boolean(
            policy?.settings.subscriptionIds.includes(subscriptionId),
          )}
          onChange={(e) => void change(e.target.checked)}
        />
        <i aria-hidden="true" />
      </label>
      {error ? (
        <small role="alert">{error}</small>
      ) : policy?.settings.subscriptionIds.includes(subscriptionId) &&
        !policy.settings.enabled ? (
        <small>全局自动处理已关闭</small>
      ) : null}
    </div>
  );
}
