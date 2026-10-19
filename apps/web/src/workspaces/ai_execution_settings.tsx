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
    <section
      className="ai-price-settings"
      aria-labelledby="ai-execution-title"
      aria-busy={busy}
    >
      <div className="ai-price-heading">
        <div>
          <h2 id="ai-execution-title">AI 运行与恢复</h2>
          <p>设置同时调用 AI 的数量，以及失败后的自动重试次数。</p>
        </div>
        <button
          type="button"
          className="secondary-action"
          disabled={!status || busy}
          onClick={() => void save('ai_operations_save')}
        >
          {status?.policy.operationsAllowed === false
            ? '允许 AI 操作'
            : '暂停 AI 操作'}
        </button>
      </div>
      <div className="ai-execution-fields">
        <label className="field">
          <span>最大模型并发数</span>
          <select
            aria-label="最大模型并发数"
            aria-describedby="ai-concurrency-help"
            value={concurrency}
            disabled={!status || busy}
            onChange={(e) => {
              setConcurrency(Number(e.target.value));
            }}
          >
            {[1, 2, 3, 4].map((n) => (
              <option value={n} key={n}>
                {n} 个同时调用{n === 1 ? '（默认）' : ''}
              </option>
            ))}
          </select>
          <small id="ai-concurrency-help">
            文档处理、翻译、问答和报告共用此上限。已发出的请求继续完成。
          </small>
        </label>
        <label className="field">
          <span>每篇文档自动断点重试</span>
          <select
            aria-label="每篇文档自动断点重试"
            aria-describedby="ai-retry-help"
            value={retries}
            disabled={!status || busy}
            onChange={(e) => {
              setRetries(Number(e.target.value));
            }}
          >
            {[0, 1, 2].map((n) => (
              <option value={n} key={n}>
                {n === 0 ? '关闭（默认）' : '最多 ' + String(n) + ' 次'}
              </option>
            ))}
          </select>
          <small id="ai-retry-help">
            新任务使用此次数。调低或关闭时，等待重试的任务也会受限。
          </small>
        </label>
      </div>
      <p className="field-hint">
        超时、临时服务异常或返回格式错误时，分别等待 1 分钟、2
        分钟后重试。从未完成的步骤继续，使用原有预算，并遵守 AI 开关和价格时段。
      </p>
      <p className="field-hint">
        人工暂停、审核暂缓、容量不足及历史失败任务需手动处理。报告和即时工具也需手动重试。
      </p>
      <div className="ai-price-actions">
        <button
          type="button"
          className="primary-action"
          disabled={!dirty || busy}
          onClick={() => void save('ai_execution_save')}
        >
          保存运行设置
        </button>
        <button
          type="button"
          className="secondary-action"
          disabled={busy}
          onClick={() =>
            void load()
              .then(() => {
                setMessage('已重新读取，当前草稿保留。');
              })
              .catch(() => {
                setMessage('读取失败，请重试。');
              })
          }
        >
          重新读取运行设置
        </button>
      </div>
      <p role="status">{message || (dirty ? '有未保存的修改' : '')}</p>
    </section>
  );
}
