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
export type WorkspaceUiPreferencesResponse = Readonly<{
  status: 'ok' | 'conflict';
  preferences: Readonly<WorkspaceUiPreferences>;
}>;
export const DEFAULT_WORKSPACE_UI_PREFERENCES: Readonly<WorkspaceUiPreferences> =
  {
    revision: 0,
    theme: 'system',
    sidebars: WORKSPACE_SIDEBAR_ACTIONS,
  };
export const WORKSPACE_PAGE_LABELS: Readonly<Record<WorkspacePage, string>> = {
  inbox: '收件箱',
  documents: '资料库',
  topics: '专题',
  query: '查询',
  settings: '设置',
};
export const SIDEBAR_ACTION_LABELS: Readonly<Record<string, string>> = {
  import: '手动导入',
  subscriptions: '订阅信源',
  activity: '接收记录',
  source: '来源详情',
  structure: '调整结构',
  tags: '添加标签',
  links: '建立联系',
  details: '条目详情',
  relations: '关系编辑',
  sources: '来源复核',
  language: '阅读设置',
  export: '资料清单与导出',
  tools: '更多工具',
  appearance: '页面与外观',
  workflow: '处理流程',
  ai: 'AI 设置',
  maintenance: '数据与维护',
};
