import type {ReactNode} from 'react';
import {SystemStatus} from './system_status.js';

import type {WorkspaceResponse} from '../api/m1c_api_contract.js';
import type {HealthPageState} from '../health/health_state.js';
import type {HealthTransportMode} from '../health/health_runtime.js';
import type {ProductSection} from './product_types.js';

const NAVIGATION: readonly Readonly<{
  section: ProductSection;
  label: string;
  icon: string;
  groupStart?: boolean;
}>[] = [
  {
    section: 'import',
    label: '文档入口',
    icon: 'M12 3v12 M7 10l5 5 5-5 M4 16v5h16v-5',
  },
  {
    section: 'documents',
    label: '工作台',
    icon: 'M5 3h10l4 4v14H5z M14 3v5h5 M8 12h8 M8 16h6',
  },
  {
    section: 'query',
    label: '数据阅览',
    icon: 'M10.5 3a7.5 7.5 0 1 0 0 15 7.5 7.5 0 0 0 0-15 M16 16l5 5',
  },
  {
    section: 'reports',
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
  const effectiveSection = ['split', 'tags', 'associations'].includes(
    activeSection,
  )
    ? 'documents'
    : activeSection === 'knowledge'
      ? 'query'
      : activeSection;
  return (
    <>
      <a className="skip-link" href="#main-workspace">
        跳至主要工作区
      </a>
      <div
        className="product-shell workflow-shell detail-app ef-app editorial-app"
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
            <span className="primary-rail__name">
              StruInfo<small>个人知识库</small>
            </span>
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
                    <span className="primary-navigation__copy">
                      <strong>{item.label}</strong>
                    </span>
                  </button>
                </li>
              ))}
            </ol>
          </nav>
          <div className="primary-rail__footer">
            <SystemStatus
              health={health}
              workspace={workspace}
              onOpenOverview={() => {
                onNavigate('overview');
              }}
            />
            <button
              type="button"
              className="primary-navigation__item primary-rail__settings"
              aria-label="设置"
              aria-current={
                effectiveSection === 'settings' ? 'page' : undefined
              }
              onClick={() => {
                onNavigate('settings');
              }}
            >
              <span aria-hidden="true">⚙</span>
              <strong>设置</strong>
            </button>
          </div>
        </aside>

        <main className="product-workspace" id="main-workspace" tabIndex={-1}>
          <div className="workspace-grid" aria-hidden="true" />
          {children}
        </main>
        {evidencePanel}
      </div>
    </>
  );
}
