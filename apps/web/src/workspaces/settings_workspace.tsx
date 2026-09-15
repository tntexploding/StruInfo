import {useState, type ReactNode} from 'react';
import {WorkspaceActionRail} from '../components/workspace_action_rail.js';
import {useWorkspaceUi} from '../components/use_workspace_ui.js';
import {
  WORKSPACE_SIDEBAR_ACTIONS,
  WORKSPACE_PAGE_LABELS,
  SIDEBAR_ACTION_LABELS,
  type WorkspacePage,
  type WorkspaceUiPreferences,
} from '../api/workspace_ui_preferences.js';
import type {ProductSection} from '../components/product_types.js';

export function SettingsWorkspace({
  workflow,
  ai,
  maintenance,
  onNavigate,
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
          <p>页面布局、处理规则与模型接入，集中管理。</p>
        </div>
      </header>
      <div className="settings-layout">
        <WorkspaceActionRail
          page="settings"
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
          </div>
          <div hidden={section !== 'workflow'}>
            {visited.has('workflow') ? workflow : null}
            <details className="workflow-tool-drawer">
              <summary>批量处理与高级工具</summary>
              <div className="entry-command-actions">
                <button
                  type="button"
                  className="secondary-action"
                  onClick={() => {
                    onNavigate('split');
                  }}
                >
                  批量结构工具
                </button>
                <button
                  type="button"
                  className="secondary-action"
                  onClick={() => {
                    onNavigate('tags');
                  }}
                >
                  批量标签与待处理队列
                </button>
                <button
                  type="button"
                  className="secondary-action"
                  onClick={() => {
                    onNavigate('associations');
                  }}
                >
                  联系维护
                </button>
              </div>
            </details>
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
    <section className="interface-settings">
      <h2>页面与外观</h2>
      <p>选择各页侧栏常用按钮并调整顺序。隐藏的功能仍可从“更多操作”进入。</p>
      {!ui.ready ? (
        <p>正在使用默认布局；读取成功后可以保存个人设置。</p>
      ) : (
        <InterfaceSettingsForm
          key={ui.preferences.revision}
          initial={ui.preferences}
        />
      )}
      <p role="status">{ui.message}</p>
      <button type="button" className="text-action" onClick={ui.reload}>
        重新读取页面设置
      </button>
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
  function update(page: WorkspacePage, actions: readonly string[]) {
    setDraft((current) => ({
      ...current,
      sidebars: {...current.sidebars, [page]: actions},
    }));
  }
  function move(page: WorkspacePage, id: string, delta: number) {
    const values = [...draft.sidebars[page]],
      index = values.indexOf(id),
      next = index + delta;
    if (index < 0 || next < 0 || next >= values.length) return;
    const other = values[next];
    if (other === undefined) return;
    values[index] = other;
    values[next] = id;
    update(page, values);
  }
  return (
    <form
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
          onClick={() => {
            setDraft({
              ...draft,
              theme: 'system',
              sidebars: WORKSPACE_SIDEBAR_ACTIONS,
            });
          }}
        >
          恢复默认草稿
        </button>
      </div>
      <div className="sidebar-preferences">
        {(Object.keys(WORKSPACE_SIDEBAR_ACTIONS) as WorkspacePage[]).map(
          (page) => {
            const values = draft.sidebars[page],
              all = [
                ...values,
                ...WORKSPACE_SIDEBAR_ACTIONS[page].filter(
                  (id) => !values.includes(id),
                ),
              ];
            return (
              <fieldset key={page}>
                <legend>{WORKSPACE_PAGE_LABELS[page]}</legend>
                {all.map((id) => (
                  <div className="sidebar-preference-row" key={id}>
                    <label>
                      <input
                        type="checkbox"
                        checked={values.includes(id)}
                        onChange={(event) => {
                          update(
                            page,
                            event.currentTarget.checked
                              ? [...values, id]
                              : values.filter((v) => v !== id),
                          );
                        }}
                      />
                      {SIDEBAR_ACTION_LABELS[id]}
                    </label>
                    <button
                      type="button"
                      className="text-action"
                      aria-label={
                        WORKSPACE_PAGE_LABELS[page] +
                        (SIDEBAR_ACTION_LABELS[id] ?? id) +
                        '上移'
                      }
                      disabled={
                        !values.includes(id) || values.indexOf(id) === 0
                      }
                      onClick={() => {
                        move(page, id, -1);
                      }}
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      className="text-action"
                      aria-label={
                        WORKSPACE_PAGE_LABELS[page] +
                        (SIDEBAR_ACTION_LABELS[id] ?? id) +
                        '下移'
                      }
                      disabled={
                        !values.includes(id) ||
                        values.indexOf(id) === values.length - 1
                      }
                      onClick={() => {
                        move(page, id, 1);
                      }}
                    >
                      ↓
                    </button>
                  </div>
                ))}
              </fieldset>
            );
          },
        )}
      </div>
      <p className="workflow-boundary-note">
        设置保存在当前外部工作区，并随个人数据包迁移。不会保存隐私可见范围。
      </p>
    </form>
  );
}
