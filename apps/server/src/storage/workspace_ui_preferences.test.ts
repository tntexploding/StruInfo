import {describe, expect, it} from 'vitest';
import {
  DEFAULT_WORKSPACE_UI_PREFERENCES,
  decodeWorkspaceUiPreferences,
} from './workspace_ui_preferences.js';
describe('bounded workspace UI preferences', () => {
  it('keeps explicitly ordered optional actions and empty rails', () => {
    const candidate = {
      ...DEFAULT_WORKSPACE_UI_PREFERENCES,
      revision: 3,
      theme: 'dark',
      sidebars: {
        ...DEFAULT_WORKSPACE_UI_PREFERENCES.sidebars,
        documents: ['tags', 'source'],
        query: [],
      },
    };
    expect(decodeWorkspaceUiPreferences(candidate)).toEqual(candidate);
  });
  it.each([
    {...DEFAULT_WORKSPACE_UI_PREFERENCES, includePrivate: true},
    {...DEFAULT_WORKSPACE_UI_PREFERENCES, theme: 'script'},
    {...DEFAULT_WORKSPACE_UI_PREFERENCES, revision: -1},
    {
      ...DEFAULT_WORKSPACE_UI_PREFERENCES,
      sidebars: {
        ...DEFAULT_WORKSPACE_UI_PREFERENCES.sidebars,
        documents: ['source', 'source'],
      },
    },
    {
      ...DEFAULT_WORKSPACE_UI_PREFERENCES,
      sidebars: {
        ...DEFAULT_WORKSPACE_UI_PREFERENCES.sidebars,
        documents: ['run-script'],
      },
    },
    {
      ...DEFAULT_WORKSPACE_UI_PREFERENCES,
      sidebars: {...DEFAULT_WORKSPACE_UI_PREFERENCES.sidebars, extra: []},
    },
  ])('rejects unsupported state rather than persisting it', (candidate) => {
    expect(decodeWorkspaceUiPreferences(candidate)).toBeUndefined();
  });
});
