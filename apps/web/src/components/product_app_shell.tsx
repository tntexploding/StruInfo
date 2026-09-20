import {useWorkspaceUi} from './use_workspace_ui.js';
import {useEffect, useState, type ReactNode} from 'react';

import type {WorkspaceResponse} from '../api/m1c_api_contract.js';
import type {HealthPageState} from '../health/health_state.js';
import type {HealthTransportMode} from '../health/health_runtime.js';
import type {ProductSection} from './product_types.js';

const NAVIGATION: readonly Readonly<{
  section: ProductSection;
  index: string;
  label: string;
  icon: string;
  groupStart?: boolean;
}>[] = [
  {
    section: 'import',
    index: '01',
    label: '文档入口',
    icon: 'M12 3v12 M7 10l5 5 5-5 M4 16v5h16v-5',
  },
  {
    section: 'documents',
    index: '02',
    label: '工作台',
    icon: 'M5 3h10l4 4v14H5z M14 3v5h5 M8 12h8 M8 16h6',
  },
  {
    section: 'query',
    index: '03',
    label: '数据阅览',
    icon: 'M10.5 3a7.5 7.5 0 1 0 0 15 7.5 7.5 0 0 0 0-15 M16 16l5 5',
  },
  {
    section: 'reports',
    index: '04',
    label: '报告',
    icon: 'M5 3h14v18H5z M8 7h8 M8 11h8 M8 15h5',
  },
];

export interface ProductAppShellProps {
  readonly activeSection: ProductSection;
  readonly children: ReactNode;
  readonly evidencePanel: ReactNode;
  readonly health: HealthPageState;
  readonly onNavigate: (section: ProductSection) => void;
  readonly transportMode: HealthTransportMode;
  readonly workspace?: Readonly<WorkspaceResponse> | undefined;
}

export function ProductAppShell({
  activeSection,
  children,
  evidencePanel,
  health,
  onNavigate,
  workspace,
}: ProductAppShellProps) {
  const {preferences} = useWorkspaceUi();
  const effectiveSection = ['split', 'tags', 'associations'].includes(
    activeSection,
  )
    ? 'documents'
    : activeSection === 'knowledge'
      ? 'query'
      : activeSection;
  const [themeOverride, setThemeOverride] = useState<{
    revision: number;
    theme: string;
  }>();
  const theme =
    themeOverride?.revision === preferences.revision
      ? themeOverride.theme
      : preferences.theme;
  useEffect(() => {
    if (theme === 'system') delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = theme;
  }, [theme]);

  const healthLabel = describeHealth(health);
  const aiEnabled =
    workspace?.capabilities.some(
      (capability) => capability === 'ai' || capability.startsWith('ai_'),
    ) === true;
  return (
    <>
      <a className="skip-link" href="#main-workspace">
        跳至主要工作区
      </a>
      <div
        className="product-shell workflow-shell"
        data-section={activeSection}
      >
        <aside className="primary-rail" aria-label="主要导航">
          <button
            className="primary-rail__identity"
            type="button"
            aria-label="StruInfo · 运行总览"
            title="运行总览"
            aria-current={activeSection === 'overview' ? 'page' : undefined}
            onClick={() => {
              onNavigate('overview');
            }}
          >
            <span className="primary-rail__mark" aria-hidden="true">
              SI
            </span>
            <span className="primary-rail__name">StruInfo</span>
          </button>
          <nav className="primary-navigation" aria-label="产品工作区">
            <ol className="workflow-navigation__list">
              {NAVIGATION.map((item) => (
                <li key={item.section} data-group-start={item.groupStart}>
                  <button
                    className="primary-navigation__item"
                    data-active={item.section === effectiveSection}
                    type="button"
                    aria-label={item.label}
                    aria-current={
                      item.section === effectiveSection ? 'page' : undefined
                    }
                    onClick={() => {
                      onNavigate(item.section);
                    }}
                  >
                    <svg
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.6"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden="true"
                    >
                      <path d={item.icon} />
                    </svg>
                    <span
                      className="primary-navigation__index"
                      aria-hidden="true"
                    >
                      {item.index}
                    </span>
                    <span
                      className="workflow-navigation__node"
                      aria-hidden="true"
                    />
                    <span className="primary-navigation__copy">
                      <strong>{item.label}</strong>
                    </span>
                  </button>
                </li>
              ))}
            </ol>
          </nav>
          <button
            type="button"
            className="primary-navigation__item primary-rail__settings"
            aria-current={effectiveSection === 'settings' ? 'page' : undefined}
            onClick={() => {
              onNavigate('settings');
            }}
          >
            <span aria-hidden="true">⚙</span>
            <strong>设置</strong>
          </button>
        </aside>

        <header className="product-command-bar">
          <dl className="command-status" aria-label="当前运行状态">
            <div>
              <dt>工作区</dt>
              <dd>{workspace === undefined ? '读取中' : '已连接'}</dd>
            </div>
            <div data-state={healthLabel.state}>
              <dt>服务</dt>
              <dd>{healthLabel.label}</dd>
            </div>
            <div data-state={aiEnabled ? 'ready' : 'neutral'}>
              <dt>AI</dt>
              <dd>{aiEnabled ? '已启用' : '未启用'}</dd>
            </div>
          </dl>
          <label className="theme-control">
            <span>外观</span>
            <select
              aria-label="界面外观"
              value={theme}
              onChange={(event) => {
                setThemeOverride({
                  revision: preferences.revision,
                  theme: event.currentTarget.value,
                });
              }}
            >
              <option value="system">跟随系统</option>
              <option value="light">浅色</option>
              <option value="dark">深色</option>
            </select>
          </label>
        </header>

        <main className="product-workspace" id="main-workspace" tabIndex={-1}>
          <div className="workspace-grid" aria-hidden="true" />
          {children}
        </main>
        {evidencePanel}
      </div>
    </>
  );
}

function describeHealth(state: HealthPageState): Readonly<{
  label: string;
  state: 'ready' | 'warning' | 'danger' | 'neutral';
}> {
  switch (state.kind) {
    case 'loading':
      return {label: '检查中', state: 'neutral'};
    case 'ready':
      return {label: '已就绪', state: 'ready'};
    case 'not_ready':
      return {
        label: state.reason === 'offline' ? '离线' : '未就绪',
        state: 'warning',
      };
    case 'unexpected_error':
      return {label: '检查失败', state: 'danger'};
  }
}
