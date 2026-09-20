import {useCallback, useEffect, useRef, useState} from 'react';
import {aiPriceCommand, type AiPriceStatus} from '../api/ai_price_client.js';
import './ai_price_settings.css';

export function AiPriceSettings({
  client = aiPriceCommand,
}: {
  client?: typeof aiPriceCommand;
}) {
  const [status, setStatus] = useState<AiPriceStatus>();
  const [enabled, setEnabled] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const initialized = useRef(false);
  const load = useCallback(async () => {
    const result = await client('ai_price_status');
    setStatus(result);
    if (!initialized.current) {
      setEnabled(result.policy.enabled);
      initialized.current = true;
    }
  }, [client]);
  useEffect(() => {
    const refresh = () => {
      void load().catch(() => {
        setMessage('价格时段暂时无法读取，请重试。');
      });
    };
    refresh();
    const timer = setInterval(refresh, 30_000);
    return () => {
      clearInterval(timer);
    };
  }, [load]);
  async function save() {
    if (!status) return;
    setBusy(true);
    setMessage('');
    try {
      const result = await client('ai_price_save', {
        revision: status.policy.revision,
        enabled,
      });
      setStatus(result);
      setEnabled(result.policy.enabled);
      setMessage('已保存。后续模型请求使用此设置。');
    } catch (error) {
      setMessage(
        error instanceof Error && error.message === 'stale_ai_price_policy'
          ? '设置已在其他地方修改。请刷新状态，再检查并保存当前草稿。'
          : '保存失败，草稿保留，请重试。',
      );
    } finally {
      setBusy(false);
    }
  }
  const next = status?.nextAllowedAt
    ? new Intl.DateTimeFormat('zh-CN', {
        timeZone: 'Asia/Shanghai',
        month: 'numeric',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23',
      }).format(new Date(status.nextAllowedAt))
    : '';
  return (
    <section
      className="ai-price-settings"
      aria-labelledby="ai-price-title"
      aria-busy={busy}
    >
      <div className="ai-price-heading">
        <div>
          <h2 id="ai-price-title">DeepSeek 峰谷价格</h2>
          <p>把模型处理留到低价时段，订阅接收和本地阅读照常进行。</p>
        </div>
        <span className="status-badge">
          {!status
            ? '读取中'
            : !status.applicable
              ? '等待 DeepSeek 接入'
              : status.blocked
                ? '高峰 · 等待低价'
                : status.policy.enabled
                  ? '低价 · 可调用'
                  : '时段限制未开启'}
        </span>
      </div>
      <label className="ai-price-toggle">
        <input
          type="checkbox"
          checked={enabled}
          disabled={!status || busy}
          onChange={(e) => {
            setEnabled(e.target.checked);
            setMessage('');
          }}
        />
        仅在 DeepSeek 低价时段调用
      </label>
      <p>
        北京时间周一至周五 09:00–12:00、14:00–18:00
        为高峰；其余时间及周末为低价，价格为高峰的一半。
      </p>
      {status?.blocked && (
        <p className="notice">
          已提交的文档任务、日报与周报将于北京时间 {next}{' '}
          后自动续跑。仍受原有范围、预算和暂停设置约束。
        </p>
      )}
      <p className="field-hint">
        覆盖接收审核、拆分、标签、联系、翻译、查询综合和报告生成。即时工具在高峰提示稍后重试；已发出的请求允许完成。开启此项不会开启自动处理。
      </p>
      <div className="ai-price-actions">
        <button
          type="button"
          className="primary-action"
          disabled={!status || busy || enabled === status.policy.enabled}
          onClick={() => {
            void save();
          }}
        >
          保存时段设置
        </button>
        <button
          type="button"
          className="secondary-action"
          disabled={busy}
          onClick={() => {
            void load()
              .then(() => {
                setMessage('状态已刷新，当前草稿保留。');
              })
              .catch(() => {
                setMessage('状态读取失败，请重试。');
              });
          }}
        >
          刷新状态
        </button>
        <a
          href="https://api-docs.deepseek.com/zh-cn/quick_start/pricing/"
          target="_blank"
          rel="noreferrer"
        >
          官方计价说明
        </a>
        <small>规则核对：2026-09-14 · 以服务方实际计费为准</small>
      </div>
      <p role="status" aria-live="polite">
        {message ||
          (status && enabled !== status.policy.enabled ? '有未保存的修改' : '')}
      </p>
    </section>
  );
}
