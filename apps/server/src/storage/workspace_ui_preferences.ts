export const WORKSPACE_SIDEBAR_ACTIONS = {
  inbox: ['import', 'subscriptions', 'activity'],
  documents: ['source', 'structure', 'tags', 'links'],
  topics: ['details', 'relations', 'sources'],
  query: ['language', 'export', 'tools'],
  settings: ['appearance', 'workflow', 'ai', 'maintenance'],
} as const;
export type WorkspacePage = keyof typeof WORKSPACE_SIDEBAR_ACTIONS;
export interface WorkspaceUiPreferences {
  readonly revision: number;
  readonly theme: 'system' | 'light' | 'dark';
  readonly sidebars: Readonly<Record<WorkspacePage, readonly string[]>>;
}
export const DEFAULT_WORKSPACE_UI_PREFERENCES: Readonly<WorkspaceUiPreferences> =
  Object.freeze({
    revision: 0,
    theme: 'system',
    sidebars: Object.freeze(WORKSPACE_SIDEBAR_ACTIONS),
  });

export function decodeWorkspaceUiPreferences(
  value: unknown,
): Readonly<WorkspaceUiPreferences> | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    return undefined;
  const record = value as Record<string, unknown>;
  if (
    Object.keys(record).some(
      (key) => !['revision', 'theme', 'sidebars'].includes(key),
    ) ||
    !Number.isSafeInteger(record.revision) ||
    (record.revision as number) < 0 ||
    !['system', 'light', 'dark'].includes(record.theme as string) ||
    typeof record.sidebars !== 'object' ||
    record.sidebars === null ||
    Array.isArray(record.sidebars)
  )
    return undefined;
  const raw = record.sidebars as Record<string, unknown>;
  const pages = Object.keys(WORKSPACE_SIDEBAR_ACTIONS) as WorkspacePage[];
  if (Object.keys(raw).length !== pages.length) return undefined;
  const sidebars = {} as Record<WorkspacePage, readonly string[]>;
  for (const page of pages) {
    const actions = raw[page];
    const allowed: readonly string[] = WORKSPACE_SIDEBAR_ACTIONS[page];
    if (
      !Array.isArray(actions) ||
      actions.length > allowed.length ||
      actions.some(
        (item) => typeof item !== 'string' || !allowed.includes(item),
      ) ||
      new Set(actions).size !== actions.length
    )
      return undefined;
    sidebars[page] = Object.freeze([...(actions as string[])]);
  }
  return Object.freeze({
    revision: record.revision as number,
    theme: record.theme as WorkspaceUiPreferences['theme'],
    sidebars: Object.freeze(sidebars),
  });
}
