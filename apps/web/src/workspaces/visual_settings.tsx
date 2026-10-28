import {useWorkspaceUi} from '../components/use_workspace_ui.js';
import {
  SettingCard,
  SettingRow,
  SettingSwitch,
} from '../components/setting_controls.js';
import {DEFAULT_VISUAL_PREFERENCES} from '../theme/visual_preferences.js';
export function VisualSettings({readingOnly = false}: {readingOnly?: boolean}) {
  const {visual, updateVisual, visualMessage} = useWorkspaceUi();
  return (
    <>
      {!readingOnly ? (
        <SettingCard title="光效与动画" className="effects-card">
          <SettingRow title="发光强度" range>
            {(id) => (
              <>
                <input
                  id={id}
                  aria-label="发光强度"
                  type="range"
                  min="0"
                  max="100"
                  step="5"
                  value={visual.glow}
                  onChange={(e) => {
                    updateVisual({glow: Number(e.currentTarget.value)});
                  }}
                />
                <output>{visual.glow}%</output>
              </>
            )}
          </SettingRow>
          {(
            [
              ['glass', '玻璃效果'],
              ['motion', '界面动画'],
              ['flowMotion', '流程动画'],
            ] as const
          ).map(([key, title]) => (
            <SettingRow key={key} title={title}>
              {(id) => (
                <SettingSwitch
                  id={id}
                  checked={visual[key]}
                  disabled={key === 'flowMotion' && !visual.motion}
                  onChange={(checked) => {
                    updateVisual({[key]: checked});
                  }}
                />
              )}
            </SettingRow>
          ))}
          <div className="settings-card-actions">
            <button
              className="text-action"
              onClick={() => {
                updateVisual(DEFAULT_VISUAL_PREFERENCES);
              }}
            >
              恢复默认光效和字号
            </button>
          </div>
          <p role="status">{visualMessage}</p>
        </SettingCard>
      ) : null}
      <SettingCard title="正文显示" className="reading-card">
        <SettingRow title="正文字号" range>
          {(id) => (
            <>
              <input
                id={id}
                aria-label="正文字号"
                type="range"
                min="15"
                max="24"
                value={visual.readingSize}
                onChange={(e) => {
                  updateVisual({readingSize: Number(e.currentTarget.value)});
                }}
              />
              <output>{visual.readingSize} px</output>
            </>
          )}
        </SettingRow>
        <SettingRow title="正文宽度" range>
          {(id) => (
            <>
              <input
                id={id}
                aria-label="正文宽度"
                type="range"
                min="48"
                max="110"
                step="2"
                value={visual.readingMeasure}
                onChange={(e) => {
                  updateVisual({readingMeasure: Number(e.currentTarget.value)});
                }}
              />
              <output>{visual.readingMeasure} 字宽</output>
            </>
          )}
        </SettingRow>
        <p className="appearance-reading-preview">
          正文使用 Noto Serif SC，界面使用 Noto Sans SC。
        </p>
        <p className="settings-footnote">调整后立即生效，保存在当前浏览器。</p>
      </SettingCard>
    </>
  );
}
