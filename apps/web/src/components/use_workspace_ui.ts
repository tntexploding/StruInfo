import {createContext, useContext} from 'react';
import {
  DEFAULT_VISUAL_PREFERENCES,
  type VisualPreferences,
} from '../theme/visual_preferences.js';
import {
  DEFAULT_WORKSPACE_UI_PREFERENCES,
  type WorkspaceUiPreferences,
} from '../api/workspace_ui_preferences.js';
export interface WorkspaceUiState {
  readonly preferences: Readonly<WorkspaceUiPreferences>;
  readonly ready: boolean;
  readonly message: string;
  readonly reload: () => void;
  readonly save: (value: Readonly<WorkspaceUiPreferences>) => Promise<boolean>;
  readonly visual: Readonly<VisualPreferences>;
  readonly visualMessage: string;
  readonly updateVisual: (patch: Partial<VisualPreferences>) => void;
}
export const UiContext = createContext<WorkspaceUiState>({
  preferences: DEFAULT_WORKSPACE_UI_PREFERENCES,
  ready: false,
  message: '',
  reload: () => undefined,
  save: () => Promise.resolve(false),
  visual: DEFAULT_VISUAL_PREFERENCES,
  visualMessage: '',
  updateVisual: () => undefined,
});
export function useWorkspaceUi() {
  return useContext(UiContext);
}
