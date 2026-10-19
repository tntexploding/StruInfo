import {useEffect, useRef, useState} from 'react';
import {
  aiWorkflowCommand,
  type AiTask,
  type AiQueueStatus,
  type AiRuntimeStatus,
  type IntakeRecord,
} from '../api/ai_workflow_client.js';
import {aiPriceCommand, type AiPriceStatus} from '../api/ai_price_client.js';
import {reportCommand, type ReportList} from '../api/report_client.js';
import {aiError} from '../api/ai_workflow_client.js';
import type {AiActivityData} from './ai_activity_state.js';

export function useAiActivity(refreshToken: number) {
  const [data, setData] = useState<AiActivityData>();
  const [error, setError] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [saveMessage, setSaveMessage] = useState('');
  const [controlRefresh, setControlRefresh] = useState(0);
  const epoch = useRef(0);
  const writing = useRef(false);
  async function setOperations(allowed: boolean) {
    if (
      !data?.price ||
      writing.current ||
      error ||
      (data.price.policy.operationsAllowed !== false) === allowed
    )
      return;
    writing.current = true;
    epoch.current++;
    setSaving(true);
    setSaveError('');
    setSaveMessage('');
    try {
      const price = await aiPriceCommand('ai_operations_save', {
        revision: data.price.policy.revision,
        operationsAllowed: allowed,
      });
      setData((current) => (current ? {...current, price} : current));
      setSaveMessage(
        allowed
          ? '已允许 AI 操作。仅恢复因总体许可暂停的已授权任务；待你决定和失败任务仍需单独处理。'
          : '已禁止后续 AI 操作。已发出的请求完成后暂停后续步骤。',
      );
    } catch (e) {
      setSaveError(aiError(e));
    } finally {
      writing.current = false;
      epoch.current++;
      setSaving(false);
      setControlRefresh((n) => n + 1);
    }
  }
  useEffect(() => {
    let disposed = false,
      busy = false;
    const isCurrent = () => !disposed;
    async function load() {
      if (
        disposed ||
        busy ||
        writing.current ||
        document.visibilityState === 'hidden'
      )
        return;
      const requestEpoch = epoch.current;
      busy = true;
      try {
        const [runtime, tasks, reports, queue, intake] = await Promise.all([
          aiWorkflowCommand<AiRuntimeStatus & {aiPrice?: AiPriceStatus}>(
            'system_status',
          ),
          aiWorkflowCommand<AiTask[]>('tasks_list', {prioritizeActive: true}),
          reportCommand<ReportList>('reports_list', {prioritizeActive: true}),
          aiWorkflowCommand<AiQueueStatus>('ingestion_status', {
            limit: 100,
            status: 'pending',
          }),
          aiWorkflowCommand<{records: IntakeRecord[]}>('intake_status'),
        ]);
        if (!Array.isArray(intake.records))
          throw new Error('invalid_intake_response');
        if (isCurrent() && requestEpoch === epoch.current) {
          setData({
            ...(runtime.model ? {model: runtime.model} : {}),
            ...(runtime.aiPrice ? {price: runtime.aiPrice} : {}),
            tasks,
            intakeRecords: intake.records,
            reports: reports.reports,
            queue,
            checkedAt: new Date().toISOString(),
          });
          setError(false);
        }
      } catch {
        if (isCurrent() && requestEpoch === epoch.current) setError(true);
      } finally {
        busy = false;
      }
    }
    const first = globalThis.setTimeout(() => void load(), 0);
    const interval = globalThis.setInterval(() => void load(), 10000);
    const visible = () => void load();
    document.addEventListener('visibilitychange', visible);
    return () => {
      disposed = true;
      globalThis.clearTimeout(first);
      globalThis.clearInterval(interval);
      document.removeEventListener('visibilitychange', visible);
    };
  }, [refreshToken, controlRefresh]);
  return {
    data,
    error,
    saving,
    saveError,
    saveMessage,
    setOperations,
    refresh: () => {
      setControlRefresh((n) => n + 1);
    },
  };
}
