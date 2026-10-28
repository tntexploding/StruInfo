import {useCallback, useEffect, useRef, useState} from 'react';
import {
  aiError,
  aiWorkflowCommand,
  type AiWorkflowClient,
  type AiQueueStatus,
  type AiRuntimeStatus,
  type AiSource,
  type AiPolicySettings,
  type AiPolicy,
} from '../api/ai_workflow_client.js';
import {AiPolicyEditor} from './ai_policy_editor.js';

export function AiAutomationSettings({
  client = aiWorkflowCommand,
}: {
  readonly client?: AiWorkflowClient;
}) {
  const [data, setData] = useState<{
    queue: AiQueueStatus;
    runtime: AiRuntimeStatus;
    sources: AiSource[];
  }>();
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const generation = useRef(0);
  const lock = useRef(false);
  const load = useCallback(async () => {
    const request = ++generation.current;
    try {
      const [queue, runtime, sources] = await Promise.all([
        client<AiQueueStatus>('ingestion_status', {limit: 1}),
        client<AiRuntimeStatus>('system_status'),
        client<AiSource[]>('subscriptions_list'),
      ]);
      if (request === generation.current) setData({queue, runtime, sources});
    } catch (error) {
      if (request === generation.current) setMessage(aiError(error));
    }
  }, [client]);
  useEffect(() => {
    const timer = setTimeout(() => {
      void load();
    }, 0);
    return () => {
      clearTimeout(timer);
    };
  }, [load]);
  async function save(revision: number, settings: AiPolicySettings) {
    if (lock.current) return undefined;
    lock.current = true;
    setBusy(true);
    setMessage('');
    try {
      const saved = await client<AiPolicy>('ingestion_policy_save', {
        expectedRevision: revision,
        settings,
      });
      setMessage('处理策略已保存。');
      await load();
      return saved;
    } catch (error) {
      setMessage(aiError(error));
      await load();
      return undefined;
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  return (
    <div className="ai-automation-settings full-width">
      {data ? (
        <AiPolicyEditor
          policy={data.queue.policy}
          sources={data.sources}
          model={data.runtime.model}
          busy={busy}
          onSave={save}
        />
      ) : (
        <button
          className="secondary-action"
          disabled={busy}
          onClick={() => void load()}
        >
          读取自动处理设置
        </button>
      )}
      <div className="settings-card-actions">
        <button
          type="button"
          className="text-action"
          disabled={busy}
          onClick={() => void load()}
        >
          刷新状态
        </button>
        {data && !data.runtime.model ? <span>模型尚未配置。</span> : null}
      </div>
      <p role="status">{message}</p>
    </div>
  );
}
