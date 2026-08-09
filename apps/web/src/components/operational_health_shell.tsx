import type {HealthRole} from '../health/health_contract.js';
import type {HealthPageState} from '../health/health_state.js';
import type {HealthTransportMode} from '../health/health_runtime.js';

export interface OperationalHealthShellProps {
  readonly onRetry: () => void;
  readonly state: HealthPageState;
  readonly transportMode: HealthTransportMode;
}

function formatRole(role: HealthRole): string {
  switch (role) {
    case 'api':
      return 'API';
    case 'scheduler':
      return 'SCHEDULER';
    case 'worker':
      return 'WORKER';
    case 'all':
      return 'ALL';
  }
}

function RetryButton({onRetry}: {readonly onRetry: () => void}) {
  return (
    <button className="retry-button" type="button" onClick={onRetry}>
      <span aria-hidden="true">↻</span>
      重试就绪检查
    </button>
  );
}

function LoadingStatus() {
  return (
    <div
      className="status-panel status-panel--loading"
      role="status"
      aria-busy="true"
      aria-live="polite"
    >
      <p className="status-panel__code">CHECK / PENDING</p>
      <h2>正在检查运行状态</h2>
      <p>等待 operational health 响应；当前尚未判定 API 或数据库状态。</p>
      <div className="loading-rule" aria-hidden="true" />
    </div>
  );
}

function ReadyStatus({
  state,
}: {
  readonly state: Extract<HealthPageState, {kind: 'ready'}>;
}) {
  return (
    <div
      className="status-panel status-panel--ready"
      role="status"
      aria-live="polite"
    >
      <p className="status-panel__code">CHECK / READY</p>
      <h2>系统已就绪</h2>
      <p>Operational health 返回 ready；数据库检查为 ready。</p>
      <dl className="readiness-facts">
        <div>
          <dt>运行角色</dt>
          <dd>{formatRole(state.response.role)}</dd>
        </div>
        <div>
          <dt>数据库检查</dt>
          <dd>已就绪</dd>
        </div>
      </dl>
    </div>
  );
}

function NotReadyStatus({
  onRetry,
  state,
}: {
  readonly onRetry: () => void;
  readonly state: Extract<HealthPageState, {kind: 'not_ready'}>;
}) {
  const isOffline = state.reason === 'offline';
  return (
    <div className="status-panel status-panel--warning" role="alert">
      <p className="status-panel__code">
        {isOffline ? 'CHECK / OFFLINE' : 'CHECK / NOT READY'}
      </p>
      <h2>{isOffline ? '无法连接运行状态接口' : '服务暂未就绪'}</h2>
      <p>
        {isOffline
          ? '未收到健康响应；页面未将离线状态解释为业务故障，也未修改任何数据。'
          : '运行角色已响应，但数据库检查尚未就绪。可稍后重试。'}
      </p>
      {state.reason === 'contract' ? (
        <dl className="readiness-facts">
          <div>
            <dt>运行角色</dt>
            <dd>{formatRole(state.response.role)}</dd>
          </div>
          <div>
            <dt>数据库检查</dt>
            <dd>未就绪</dd>
          </div>
        </dl>
      ) : null}
      <RetryButton onRetry={onRetry} />
    </div>
  );
}

const ERROR_COPY = {
  configuration: '健康接口地址配置无效，状态未被采信。',
  contract: '响应不符合 C-M0-S-r2，状态未被采信。',
  http: '服务返回了契约未支持的 HTTP 状态，状态未被采信。',
  unknown: '检查过程中发生未预期错误，状态未被采信。',
} as const;

function UnexpectedErrorStatus({
  onRetry,
  state,
}: {
  readonly onRetry: () => void;
  readonly state: Extract<HealthPageState, {kind: 'unexpected_error'}>;
}) {
  return (
    <div className="status-panel status-panel--error" role="alert">
      <p className="status-panel__code">CHECK / INVALID</p>
      <h2>无法验证系统状态</h2>
      <p>{ERROR_COPY[state.reason]}</p>
      <p className="status-panel__safety">
        现有产品数据未被读取或修改；请检查配置或服务后重试。
      </p>
      <RetryButton onRetry={onRetry} />
    </div>
  );
}

function HealthStatus({
  onRetry,
  state,
}: {
  readonly onRetry: () => void;
  readonly state: HealthPageState;
}) {
  switch (state.kind) {
    case 'loading':
      return <LoadingStatus />;
    case 'ready':
      return <ReadyStatus state={state} />;
    case 'not_ready':
      return <NotReadyStatus state={state} onRetry={onRetry} />;
    case 'unexpected_error':
      return <UnexpectedErrorStatus state={state} onRetry={onRetry} />;
  }
}

export function OperationalHealthShell({
  onRetry,
  state,
  transportMode,
}: OperationalHealthShellProps) {
  const isLoading = state.kind === 'loading';
  const isMock = transportMode === 'mock';

  return (
    <>
      <a className="skip-link" href="#main-content">
        跳至主要内容
      </a>
      <div className="app-shell">
        <aside className="edge-shell" aria-label="产品索引">
          <span className="edge-shell__mark" aria-hidden="true">
            SI
          </span>
          <span className="edge-shell__index">00</span>
          <span className="edge-shell__label">FOUNDATION</span>
        </aside>

        <header className="command-header">
          <div className="product-identity">
            <p className="product-identity__name">StruInfo</p>
            <p className="product-identity__description">
              Personal Knowledge OS · 来源可追溯的个人信息工作空间
            </p>
          </div>
          <span className="transport-label" data-transport={transportMode}>
            {isMock ? '模拟数据 · 开发模式' : '实时健康接口'}
          </span>
          <nav className="section-navigation" aria-label="当前页面">
            <a href="#readiness" aria-current="page">
              <span aria-hidden="true">01</span>
              运行状态
            </a>
          </nav>
        </header>

        <main className="workspace" id="main-content">
          <section
            className="health-stage"
            id="readiness"
            aria-labelledby="page-title"
            aria-busy={isLoading}
          >
            <div className="blueprint-grid" aria-hidden="true" />
            <div className="stage-content">
              <header className="stage-heading">
                <p className="stage-heading__index">01 / SYSTEM READINESS</p>
                <h1 id="page-title">系统就绪状态</h1>
                <p>
                  读取部署级 operational health；它不代表信源、知识或 AI
                  功能已经启用。
                </p>
              </header>
              <HealthStatus state={state} onRetry={onRetry} />
            </div>
          </section>

          <aside className="metadata-rail" aria-labelledby="scope-title">
            <p className="metadata-rail__index">SCOPE / 001</p>
            <h2 id="scope-title">检查范围</h2>
            <dl className="contract-facts">
              <div>
                <dt>契约</dt>
                <dd>C-M0-S-r2</dd>
              </div>
              <div>
                <dt>端点</dt>
                <dd>/health/ready</dd>
              </div>
              <div>
                <dt>Transport</dt>
                <dd>{isMock ? 'Deterministic mock' : 'Configured fetch'}</dd>
              </div>
            </dl>
            <p className="metadata-rail__note">
              本页只判断运行角色与数据库 readiness。未提供的产品状态保持未知。
            </p>
            <p className="unicode-proof">
              <span>UNICODE</span>
              中文 / Latin · 标点，。 · Emoji 🧭
            </p>
          </aside>
        </main>

        <footer className="status-footer">
          <span>M0-S · OPERATIONAL HEALTH ONLY</span>
          <span>未来产品模块尚未启用</span>
        </footer>
      </div>
    </>
  );
}
