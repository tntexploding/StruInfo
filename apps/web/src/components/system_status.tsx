import type {WorkspaceResponse} from '../api/m1c_api_contract.js';
import type {HealthPageState} from '../health/health_state.js';
import {FloatingToolPanel} from './floating_tool_panel.js';

export function SystemStatus({
  health,
  workspace,
  onOpenOverview,
}: {
  readonly health: HealthPageState;
  readonly workspace: Readonly<WorkspaceResponse> | undefined;
  readonly onOpenOverview: () => void;
}) {
  const service = describeHealth(health);
  const aiEnabled =
    workspace?.capabilities.some(
      (capability) => capability === 'ai' || capability.startsWith('ai_'),
    ) === true;
  const summary =
    service.state === 'ready'
      ? workspace === undefined
        ? '连接中'
        : '正常'
      : service.state === 'neutral'
        ? '检查中'
        : '需检查';
  return (
    <div className="system-status" data-state={service.state}>
      <FloatingToolPanel title={'系统状态 · ' + summary} preferredWidth={340}>
        <dl className="command-status" aria-label="当前运行状态">
          <div>
            <StatusIcon kind="workspace" />
            <div className="ef-system-copy">
              <dt>工作区</dt>
              <dd>{workspace === undefined ? '读取中' : '已连接'}</dd>
            </div>
          </div>
          <div data-state={service.state}>
            <StatusIcon kind="service" />
            <div className="ef-system-copy">
              <dt>服务</dt>
              <dd>{service.label}</dd>
            </div>
          </div>
          <div data-kind="ai">
            <StatusIcon kind="ai" />
            <div className="ef-system-copy">
              <dt>AI 接入</dt>
              <dd>{aiEnabled ? '已配置' : '未配置'}</dd>
            </div>
          </div>
        </dl>
        <p className="field-help">
          AI 是否正在工作、任务进度和暂停控制，可在运行总览中查看。
        </p>
        <button
          type="button"
          className="secondary-action"
          onClick={(event) => {
            event.currentTarget
              .closest<HTMLElement>('[popover]')
              ?.hidePopover();
            onOpenOverview();
          }}
        >
          查看运行总览
        </button>
      </FloatingToolPanel>
    </div>
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

function StatusIcon({kind}: {kind: 'workspace' | 'service' | 'ai'}) {
  const paths = {
    workspace:
      'M4 6c0-4 16-4 16 0s-16 4-16 0v12c0 4 16 4 16 0V6 M4 12c0 4 16 4 16 0',
    service: 'M4 4h6v6H4z M14 14h6v6h-6z M7 10v7h7 M10 7h7v7',
    ai: 'm12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5Z',
  };
  return (
    <span className="command-status__icon ef-system-icon" aria-hidden="true">
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      >
        <path d={paths[kind]} />
      </svg>
    </span>
  );
}
