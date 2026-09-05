import type {ReactNode} from 'react';

import type {WorkspaceResponse} from '../api/m1c_api_contract.js';
import type {HealthPageState} from '../health/health_state.js';
import type {HealthTransportMode} from '../health/health_runtime.js';
import type {ProductSection} from './product_types.js';

const NAVIGATION: readonly Readonly<{
  section: ProductSection;
  index: string;
  label: string;
}>[] = [
  {section: 'overview', index: '00', label: '总览'},
  {section: 'import', index: '01', label: '导入'},
  {section: 'split', index: '02', label: '拆分'},
  {section: 'tags', index: '03', label: '标签'},
  {
    section: 'associations',
    index: '04',
    label: '联系',
  },
  {section: 'query', index: '05', label: '查询'},
  {
    section: 'knowledge',
    index: '06',
    label: '知识',
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
                    </span>
                  </button>
                </li>
              ))}
            </ol>
          </nav>
        </aside>

        <header className="product-command-bar">
          <div className="product-lockup">
            <p className="product-lockup__name">StruInfo</p>
          </div>
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
