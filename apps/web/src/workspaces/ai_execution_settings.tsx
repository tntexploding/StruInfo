import {
  SettingCard,
  SettingRow,
  SettingSwitch,
} from '../components/setting_controls.js';
import {useCallback, useEffect, useRef, useState} from 'react';
import {aiPriceCommand, type AiPriceStatus} from '../api/ai_price_client.js';
import './ai_price_settings.css';

export function AiExecutionSettings({
  client = aiPriceCommand,
}: {
  client?: typeof aiPriceCommand;
}) {
  const [status, setStatus] = useState<AiPriceStatus>();
  const [concurrency, setConcurrency] = useState(1);
  const [retries, setRetries] = useState(0);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const initialized = useRef(false);
  const load = useCallback(async () => {
    const result = await client('ai_price_status');
    setStatus(result);
    if (!initialized.current) {
      setConcurrency(result.policy.maxConcurrentRequests ?? 1);
      setRetries(result.policy.automaticRetryLimit ?? 0);
      initialized.current = true;
    }
  }, [client]);
  useEffect(() => {
    const start = setTimeout(() => {
      void load().catch(() => {
        setMessage('AI 运行设置读取失败，请重新读取。');
      });
    }, 0);
    return () => {
      clearTimeout(start);
    };
  }, [load]);
  async function save(operation: 'ai_execution_save' | 'ai_operations_save') {
    if (!status || busy) return;
    setBusy(true);
    setMessage('');
    try {
      const result = await client(operation, {
        revision: status.policy.revision,
        ...(operation === 'ai_execution_save'
          ? {maxConcurrentRequests: concurrency, automaticRetryLimit: retries}
          : {operationsAllowed: status.policy.operationsAllowed === false}),
      });
      setStatus(result);
      setMessage(
        operation === 'ai_execution_save'
          ? '已保存。并发用于后续请求；自动重试额度用于之后新建的文档任务。'
          : result.policy.operationsAllowed === false
            ? '已暂停后续 AI 操作，已发出的请求允许完成。'
            : '已允许后续 AI 操作，任务仍遵守价格时段与各自预算。',
      );
    } catch (error) {
      setMessage(
        error instanceof Error && error.message === 'stale_ai_price_policy'
          ? '设置已在其他位置修改。请重新读取，再检查并保存草稿。'
          : '保存失败，当前草稿保留，请重试。',
      );
    } finally {
      setBusy(false);
    }
  }
  const dirty =
    status &&
    (concurrency !== (status.policy.maxConcurrentRequests ?? 1) ||
      retries !== (status.policy.automaticRetryLimit ?? 0));
  return (
    <SettingCard title="AI 运行与恢复" className="ai-card">
      <SettingRow
        title="允许 AI 操作"
        hint="暂停后不再发出新请求，已发出的请求继续完成。"
      >
        {(id) => (
          <SettingSwitch
            id={id}
            checked={status?.policy.operationsAllowed !== false}
            disabled={!status || busy}
            onChange={() => void save('ai_operations_save')}
          />
        )}
      </SettingRow>
      <SettingRow title="最大模型并发数" hint="文档、翻译、问答和报告共用。">
        {(id) => (
          <select
            id={id}
            value={concurrency}
            disabled={!status || busy}
            onChange={(e) => {
              setConcurrency(Number(e.currentTarget.value));
            }}
          >
            {[1, 2, 3, 4].map((n) => (
              <option key={n} value={n}>
                {n} 个同时调用
              </option>
            ))}
          </select>
        )}
      </SettingRow>
      <SettingRow
        title="每篇文档自动断点重试"
        hint="用于新任务，仍使用任务原有预算。"
      >
        {(id) => (
          <select
            id={id}
            value={retries}
            disabled={!status || busy}
            onChange={(e) => {
              setRetries(Number(e.currentTarget.value));
            }}
          >
            {[0, 1, 2].map((n) => (
              <option key={n} value={n}>
                {n === 0 ? '关闭' : '最多 ' + String(n) + ' 次'}
              </option>
            ))}
          </select>
        )}
      </SettingRow>
      <div className="settings-card-actions">
        <button
          className="primary-action"
          disabled={!dirty || busy}
          onClick={() => void save('ai_execution_save')}
        >
          保存运行设置
        </button>
        <button
          className="text-action"
          disabled={busy}
          onClick={() =>
            void load().catch(() => {
              setMessage('读取失败，请重试。');
            })
          }
        >
          重新读取运行设置
        </button>
      </div>
      <p role="status">{message || (dirty ? '有未保存的修改' : '')}</p>
    </SettingCard>
  );
}
