import type {ReactNode} from 'react';

import type {WorkspaceResponse} from '../api/m1c_api_contract.js';
import type {HealthPageState} from '../health/health_state.js';
import type {HealthTransportMode} from '../health/health_runtime.js';
import type {ProductSection} from './product_types.js';

const NAVIGATION: readonly Readonly<{
  section: ProductSection;
  index: string;
  label: string;
  microLabel: string;
}>[] = [
  {section: 'overview', index: '00', label: '总览', microLabel: 'OVERVIEW'},
  {section: 'import', index: '01', label: '导入', microLabel: 'IMPORT'},
  {section: 'split', index: '02', label: '拆分', microLabel: 'SPLIT'},
  {section: 'tags', index: '03', label: '标签', microLabel: 'TAG'},
  {
    section: 'associations',
    index: '04',
    label: '联系',
    microLabel: 'ASSOCIATE',
  },
  {section: 'query', index: '05', label: '查询', microLabel: 'QUERY'},
  {
    section: 'knowledge',
    index: '06',
    label: '知识',
    microLabel: 'KNOWLEDGE',
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
  transportMode,
  workspace,
}: ProductAppShellProps) {
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
          <div className="primary-rail__identity" aria-label="StruInfo">
            <span className="primary-rail__mark" aria-hidden="true">
              SI
            </span>
          </div>
          <nav className="primary-navigation" aria-label="产品工作区">
            <ol className="workflow-navigation__list">
              {NAVIGATION.map((item) => (
                <li key={item.section}>
                  <button
                    className="primary-navigation__item"
                    data-active={item.section === activeSection}
                    type="button"
                    aria-label={item.label}
                    aria-current={
                      item.section === activeSection ? 'page' : undefined
                    }
                    onClick={() => {
                      onNavigate(item.section);
                    }}
                  >
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
                      <small>{item.microLabel}</small>
                    </span>
                  </button>
                </li>
              ))}
            </ol>
          </nav>
          <p className="primary-rail__scope">LOCAL DATA · ONE WORKSPACE</p>
        </aside>

        <header className="product-command-bar">
          <div className="product-lockup">
            <p className="product-lockup__name">StruInfo</p>
            <p className="product-lockup__descriptor">
              文档处理台 · 导入 → 拆分 → 标签 → 联系 → 查询 → 知识
            </p>
          </div>
          <dl className="command-status" aria-label="当前运行状态">
            <div>
              <dt>工作区</dt>
              <dd title={workspace?.workspaceId}>
                {workspace === undefined
                  ? '读取中'
                  : shortIdentity(workspace.workspaceId)}
              </dd>
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
        </header>

        <main className="product-workspace" id="main-workspace" tabIndex={-1}>
          <div className="workspace-grid" aria-hidden="true" />
          {children}
        </main>
        {evidencePanel}

        <footer className="product-status-strip">
          <span>TRACEABLE CORE · MANUAL AUTHORITY</span>
          <span>
            {transportMode === 'mock' ? '健康检查：开发模拟' : '本机同源接口'}
          </span>
        </footer>
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

function shortIdentity(value: string): string {
  return value.length <= 12 ? value : `${value.slice(0, 8)}…${value.slice(-4)}`;
}
