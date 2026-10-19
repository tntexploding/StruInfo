import {useState, type ReactNode} from 'react';
import {WorkspaceActionRail} from '../components/workspace_action_rail.js';
import {useWorkspaceUi} from '../components/use_workspace_ui.js';
import {
  SIDEBAR_ACTION_LABELS,
  type WorkspaceUiPreferences,
} from '../api/workspace_ui_preferences.js';
import type {ProductSection} from '../components/product_types.js';
import {VisualSettings} from './visual_settings.js';

export function SettingsWorkspace({
  workflow,
  ai,
  maintenance,
}: {
  readonly workflow: ReactNode;
  readonly ai: ReactNode;
  readonly maintenance: ReactNode;
  readonly onNavigate: (section: ProductSection) => void;
}) {
  const [section, setSection] = useState('appearance');
  const [visited, setVisited] = useState<ReadonlySet<string>>(
    new Set(['appearance']),
  );
  return (
    <div className="workspace-view settings-workspace">
      <header className="workflow-page-heading">
        <div>
          <h1>设置</h1>
          <p>调整外观、AI 接入与处理规则，管理数据和备份。</p>
        </div>
      </header>
      <div className="settings-layout">
        <WorkspaceActionRail
          page="settings"
          presentation="selection"
          active={section}
          actions={['appearance', 'workflow', 'ai', 'maintenance'].map(
            (id) => ({
              id,
              label: SIDEBAR_ACTION_LABELS[id] ?? id,
              onClick: () => {
                setSection(id);
                setVisited((current) => new Set([...current, id]));
              },
            }),
          )}
        />
        <div className="settings-content">
          <div hidden={section !== 'appearance'}>
            <InterfaceSettings />
            <VisualSettings />
          </div>
          <div hidden={section !== 'workflow'}>
            {visited.has('workflow') ? workflow : null}
          </div>
          <div hidden={section !== 'ai'}>{visited.has('ai') ? ai : null}</div>
          <div hidden={section !== 'maintenance'}>
            {visited.has('maintenance') ? maintenance : null}
          </div>
        </div>
      </div>
    </div>
  );
}
function InterfaceSettings() {
  const ui = useWorkspaceUi();
  return (
    <section className="interface-settings settings-group">
      <h2>主题</h2>
      <p>选择浅色、深色或跟随系统，保存后应用到所有页面。</p>
      {!ui.ready ? (
        <>
          <p>正在读取已保存的主题。</p>
          <button type="button" className="text-action" onClick={ui.reload}>
            重新读取
          </button>
        </>
      ) : (
        <InterfaceSettingsForm
          key={ui.preferences.revision}
          initial={ui.preferences}
        />
      )}
      <p role="status">{ui.message}</p>
    </section>
  );
}
function InterfaceSettingsForm({
  initial,
}: {
  readonly initial: Readonly<WorkspaceUiPreferences>;
}) {
  const ui = useWorkspaceUi();
  const [draft, setDraft] = useState(initial);
  const [busy, setBusy] = useState(false);
  return (
    <form
      className="appearance-theme-form"
      onSubmit={(event) => {
        event.preventDefault();
        if (busy) return;
        setBusy(true);
        void ui.save(draft).finally(() => {
          setBusy(false);
        });
      }}
    >
      <label className="field">
        <span>默认外观</span>
        <select
          value={draft.theme}
          onChange={(event) => {
            setDraft({
              ...draft,
              theme: event.currentTarget
                .value as WorkspaceUiPreferences['theme'],
            });
          }}
        >
          <option value="system">跟随系统</option>
          <option value="light">浅色</option>
          <option value="dark">深色</option>
        </select>
      </label>
      <div className="entry-command-actions">
        <button type="submit" className="primary-action" disabled={busy}>
          {busy ? '正在保存…' : '保存页面设置'}
        </button>
        <button
          type="button"
          className="secondary-action"
          disabled={busy}
          onClick={ui.reload}
        >
          撤销未保存的修改
        </button>
      </div>
    </form>
  );
}
