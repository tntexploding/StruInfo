import type {ReactNode} from 'react';
import type {WorkspacePage} from '../api/workspace_ui_preferences.js';
import {useWorkspaceUi} from './use_workspace_ui.js';

export interface WorkspaceAction {
  readonly id: string;
  readonly label: string;
  readonly disabled?: boolean;
  readonly onClick: () => void;
}
export function WorkspaceActionRail({
  page,
  actions,
  active,
  connected = false,
  children,
}: {
  readonly page: WorkspacePage;
  readonly actions: readonly WorkspaceAction[];
  readonly active?: string | undefined;
  readonly connected?: boolean;
  readonly children?: ReactNode;
}) {
  const {preferences} = useWorkspaceUi();
  const order = preferences.sidebars[page];
  const visible = order.flatMap((id) =>
    actions.filter((item) => item.id === id),
  );
  const remaining = actions.filter((item) => !order.includes(item.id));
  const button = (action: WorkspaceAction) => (
    <button
      type="button"
      className="secondary-action"
      aria-pressed={active === action.id}
      disabled={action.disabled}
      onClick={action.onClick}
    >
      {action.label}
    </button>
  );
  return (
    <aside className="workspace-action-rail" aria-label="页面工具">
      <ol data-connected={connected}>
        {visible.map((action) => (
          <li key={action.id}>{button(action)}</li>
        ))}
      </ol>
      {remaining.length === 0 ? null : (
        <details className="workspace-more-actions">
          <summary>更多操作</summary>
          {remaining.map((action) => (
            <div key={action.id}>{button(action)}</div>
          ))}
        </details>
      )}
      {children}
    </aside>
  );
}
