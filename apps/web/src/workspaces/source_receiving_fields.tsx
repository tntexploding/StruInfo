import type {
  SourceReceiving,
  SourceReceivingStatus,
} from '../api/source_receiving_contract.js';
import {DEFAULT_SOURCE_RECEIVING} from '../api/source_receiving_contract.js';
const clockText = (minute: number) =>
  String(Math.floor(minute / 60)).padStart(2, '0') +
  ':' +
  String(minute % 60).padStart(2, '0');
const clockMinute = (text: string) => {
  const [h, m] = text.split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
};
export function SourceReceivingFields({
  value = DEFAULT_SOURCE_RECEIVING,
  interval,
  onInterval,
  onChange,
}: {
  value?: SourceReceiving | undefined;
  interval: number;
  onInterval: (value: number) => void;
  onChange: (value: SourceReceiving) => void;
}) {
  const window = value.schedule.mode === 'window' ? value.schedule : undefined;
  return (
    <div className="receiving-grid">
      <label className="setting-field">
        <span>检查方式</span>
        <select
          value={value.schedule.mode}
          onChange={(e) => {
            const mode = e.target.value as SourceReceiving['schedule']['mode'];
            onChange({
              ...value,
              schedule:
                mode === 'window'
                  ? {
                      mode,
                      timeZone:
                        Intl.DateTimeFormat().resolvedOptions().timeZone,
                      weekdays: [1, 2, 3, 4, 5],
                      startMinute: 540,
                      endMinute: 600,
                    }
                  : {mode},
            });
          }}
        >
          <option value="interval">按间隔</option>
          <option value="window">按日期与时段</option>
          <option value="once">收取一次</option>
          <option value="manual">仅手动检查</option>
        </select>
      </label>
      <label className="setting-field interval-field">
        <span>检查间隔</span>
        <span className="unit-input">
          <input
            aria-label="检查间隔"
            type="number"
            min={15}
            max={10080}
            value={interval}
            onChange={(e) => {
              onInterval(e.target.valueAsNumber);
            }}
          />
          <span>分钟</span>
        </span>
      </label>
      {window ? (
        <div className="schedule-field">
          <span className="field-label">检查日期</span>
          <div className="weekdays" role="group" aria-label="每周检查日期">
            {['日', '一', '二', '三', '四', '五', '六'].map((day, i) => (
              <button
                type="button"
                key={i}
                aria-label={'星期' + day}
                aria-pressed={window.weekdays.includes(i)}
                onClick={() => {
                  onChange({
                    ...value,
                    schedule: {
                      ...window,
                      weekdays: window.weekdays.includes(i)
                        ? window.weekdays.filter((d) => d !== i)
                        : [...window.weekdays, i].sort(),
                    },
                  });
                }}
              >
                {day}
              </button>
            ))}
          </div>
          <div className="time-window">
            <label>
              从{' '}
              <input
                aria-label="检查开始时间"
                type="time"
                value={clockText(window.startMinute)}
                onChange={(e) => {
                  onChange({
                    ...value,
                    schedule: {
                      ...window,
                      startMinute: clockMinute(e.target.value),
                    },
                  });
                }}
              />
            </label>
            <label>
              至{' '}
              <input
                aria-label="检查结束时间"
                type="time"
                value={clockText(window.endMinute % 1440)}
                onChange={(e) => {
                  onChange({
                    ...value,
                    schedule: {
                      ...window,
                      endMinute: clockMinute(e.target.value) || 1440,
                    },
                  });
                }}
              />
            </label>
          </div>
          <label className="setting-field">
            <span>时区</span>
            <input
              value={window.timeZone}
              onChange={(e) => {
                onChange({
                  ...value,
                  schedule: {...window, timeZone: e.target.value},
                });
              }}
            />
          </label>
        </div>
      ) : null}
      <label className="setting-field retry-field">
        <span>失败重试次数</span>
        <input
          type="number"
          min={0}
          max={5}
          value={value.retryLimit}
          onChange={(e) => {
            onChange({...value, retryLimit: e.target.valueAsNumber});
          }}
        />
      </label>
    </div>
  );
}
function sourceScheduleText(status: SourceReceivingStatus): string {
  const reasons = {
    disabled: '自动检查已暂停',
    manual: '等待手动检查',
    collected: '已完成一次采集',
    due: '等待检查',
    interval: '等待下次检查',
    window: '等待检查时段',
    backoff: '失败后等待重试',
    exhausted: '自动重试已用完，等待手动检查',
  };
  return (
    reasons[status.reason] +
    (status.nextCheckAt && status.reason !== 'due'
      ? ` · ${new Date(status.nextCheckAt).toLocaleString()}`
      : '')
  );
}
export function SourceReceivingSummary({
  status,
}: {
  status?: SourceReceivingStatus | undefined;
}) {
  if (!status) return null;
  const errors: Record<string, string> = {
    source_unavailable: '来源暂时无法访问',
    source_too_large: '响应超过容量限制',
    source_invalid: '来源格式无法读取',
    source_import_unavailable: '原文保存失败',
    source_import_rejected: '原文未通过入库检查',
  };
  return (
    <div className="source-receiving-summary">
      <p>{sourceScheduleText(status)}</p>
      <p>
        {status.history === 'public_index'
          ? '支持往期目录探测，范围以来源公开目录为准'
          : status.history === 'disabled'
            ? '往期查询已关闭'
            : '不支持往期目录'}
      </p>
      {status.lastNewAt ? (
        <p>最近收到新资料：{new Date(status.lastNewAt).toLocaleString()}</p>
      ) : null}
      {status.errorCode ? (
        <p className="source-receiving-error">
          {errors[status.errorCode] ?? '本次检查失败'} · 连续 {status.failures}{' '}
          次；可点击“立即检查”重试。
        </p>
      ) : null}
    </div>
  );
}
