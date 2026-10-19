import {useWorkspaceUi} from '../components/use_workspace_ui.js';
import {DEFAULT_VISUAL_PREFERENCES} from '../theme/visual_preferences.js';

export function VisualSettings() {
  const {visual, updateVisual, visualMessage} = useWorkspaceUi();
  return (
    <>
      <section
        className="settings-group"
        aria-labelledby="visual-effects-title"
      >
        <header>
          <h2 id="visual-effects-title">光效与动画</h2>
          <p>调整后立即生效，保存在当前浏览器。</p>
        </header>
        <div className="appearance-fields">
          <label className="field appearance-range" htmlFor="appearance-glow">
            <span>
              发光强度 <output>{visual.glow}%</output>
            </span>
            <input
              id="appearance-glow"
              aria-label="发光强度"
              aria-describedby="appearance-glow-help"
              type="range"
              min="0"
              max="100"
              step="5"
              value={visual.glow}
              onChange={(event) => {
                updateVisual({glow: Number(event.currentTarget.value)});
              }}
            />
            <small id="appearance-glow-help">
              调整按钮和流程光带的亮度，0 为关闭。
            </small>
          </label>
          <label className="appearance-switch">
            <input
              type="checkbox"
              checked={visual.glass}
              onChange={(event) => {
                updateVisual({glass: event.currentTarget.checked});
              }}
            />
            <span>
              <strong>玻璃效果</strong>
              <small>选项卡和弹窗半透明，正文保持实色。</small>
            </span>
          </label>
          <label className="appearance-switch">
            <input
              type="checkbox"
              checked={visual.motion}
              onChange={(event) => {
                updateVisual({motion: event.currentTarget.checked});
              }}
            />
            <span>
              <strong>界面动画</strong>
              <small>
                按钮反馈、切换过渡和状态灯动画。关闭后保留静态状态。
              </small>
            </span>
          </label>
          <label className="appearance-switch">
            <input
              type="checkbox"
              checked={visual.flowMotion}
              disabled={!visual.motion}
              onChange={(event) => {
                updateVisual({flowMotion: event.currentTarget.checked});
              }}
            />
            <span>
              <strong>流程动画</strong>
              <small>总览中的流光、光束和数字增长动画。</small>
            </span>
          </label>
        </div>
        <p className="field-hint">
          系统开启“减少动态效果”时，页面也会减少动画。
        </p>
      </section>
      <section
        className="settings-group"
        aria-labelledby="reading-appearance-title"
      >
        <header>
          <h2 id="reading-appearance-title">正文显示</h2>
        </header>
        <label
          className="field appearance-range"
          htmlFor="appearance-reading-size"
        >
          <span>
            正文字号 <output>{visual.readingSize} px</output>
          </span>
          <input
            id="appearance-reading-size"
            aria-label="正文字号"
            type="range"
            min="15"
            max="24"
            step="1"
            value={visual.readingSize}
            onChange={(event) => {
              updateVisual({readingSize: Number(event.currentTarget.value)});
            }}
          />
        </label>
        <p className="appearance-reading-preview">
          正文使用 Noto Serif SC，界面使用 Noto Sans
          SC。这里可以预览正文的大小。
        </p>
        <p className="field-hint">
          拖动页面两栏之间的分隔线，可以调整栏目宽度。
        </p>
      </section>
      <div className="appearance-reset">
        <button
          className="secondary-action"
          type="button"
          onClick={() => {
            updateVisual(DEFAULT_VISUAL_PREFERENCES);
          }}
        >
          恢复默认光效和字号
        </button>
        <p role="status">{visualMessage}</p>
      </div>
    </>
  );
}
