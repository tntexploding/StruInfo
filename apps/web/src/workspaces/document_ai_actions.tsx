import {useRef, useState} from 'react';
import {
  aiWorkflowCommand,
  aiError,
  DEFAULT_INTAKE_POLICY,
  type AiQueueStatus,
  type AiTask,
} from '../api/ai_workflow_client.js';
export function DocumentAiActions({
  snapshotId,
  entryCount,
  onStarted,
}: {
  snapshotId: string;
  entryCount: number;
  onStarted: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const lock = useRef(false);
  async function start(retag: boolean) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setMessage('');
    try {
      const status = await aiWorkflowCommand<AiQueueStatus>('ingestion_status');
      if (!status.modelConfigured) throw new Error('ai_not_configured');
      const policy = status.policy.settings;
      await aiWorkflowCommand<AiTask>('task_start', {
        requestKey: crypto.randomUUID(),
        request: {
          kind: 'document',
          snapshotId,
          maxEntries: retag
            ? Math.max(entryCount, policy.maxEntries)
            : policy.maxEntries,
          maxModelCalls: policy.maxModelCalls,
          ...(retag
            ? {reprocess: 'tags'}
            : {
                intake: policy.intake ?? DEFAULT_INTAKE_POLICY,
              }),
        },
      });
      setMessage(
        retag
          ? 'AI 重做标签已排队。成功结果自动确认，手动标签和原文保留。'
          : 'AI 整理已排队：审核、分段、标注和确认入库。主题与联系单独处理。',
      );
      onStarted();
    } catch (e) {
      setMessage(aiError(e));
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  return (
    <div className="document-ai-actions">
      <div className="journey-action-group">
        <button
          className="primary-action"
          disabled={busy || entryCount > 0}
          onClick={() => void start(false)}
        >
          AI 整理并入库
        </button>
        <button
          className="secondary-action"
          disabled={busy || entryCount === 0 || entryCount > 64}
          onClick={() => void start(true)}
        >
          AI 重做标签
        </button>
      </div>
      <p>使用已保存的调用额度和价格时段，保留原文。</p>
      {message ? <p role="status">{message}</p> : null}
    </div>
  );
}
