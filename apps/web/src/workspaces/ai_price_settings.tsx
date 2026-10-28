import {
  SettingCard,
  SettingRow,
  SettingSwitch,
} from '../components/setting_controls.js';
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
    <SettingCard title="价格时段" className="ai-card">
      <SettingRow
        title="仅在 DeepSeek 低价时段调用"
        hint={
          !status
            ? '正在读取'
            : !status.applicable
              ? '等待 DeepSeek 接入'
              : status.blocked
                ? '高峰时段，等待低价'
                : status.policy.enabled
                  ? '当前可调用'
                  : '时段限制未开启'
        }
      >
        {(id) => (
          <SettingSwitch
            id={id}
            checked={enabled}
            disabled={!status || busy}
            onChange={setEnabled}
          />
        )}
      </SettingRow>
      <p>
        北京时间周一至周五 09:00–12:00、14:00–18:00
        为高峰，其余时间及周末为低价。
      </p>
      {status?.blocked ? <p>下次允许调用：北京时间 {next}</p> : null}
      <div className="settings-card-actions">
        <button
          className="primary-action"
          disabled={!status || busy || enabled === status.policy.enabled}
          onClick={() => void save()}
        >
          保存时段设置
        </button>
        <button
          className="text-action"
          disabled={busy}
          onClick={() =>
            void load().catch(() => {
              setMessage('状态读取失败，请重试。');
            })
          }
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
      </div>
      <p role="status">{message}</p>
    </SettingCard>
  );
}
