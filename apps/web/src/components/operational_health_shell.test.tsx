import {renderToStaticMarkup} from 'react-dom/server';
import {describe, expect, it} from 'vitest';

import type {HealthPageState} from '../health/health_state.js';
import {
  NOT_READY_HEALTH_FIXTURE,
  READY_HEALTH_FIXTURE,
} from '../health/mock_health_client.js';
import {OperationalHealthShell} from './operational_health_shell.js';

function renderShell(
  state: HealthPageState,
  transportMode: 'live' | 'mock' = 'mock',
): string {
  return renderToStaticMarkup(
    <OperationalHealthShell
      state={state}
      transportMode={transportMode}
      onRetry={() => undefined}
    />,
  );
}

describe('OperationalHealthShell', () => {
  it('renders loading with busy and polite status semantics', () => {
    const markup = renderShell({kind: 'loading'});

    expect(markup).toContain('正在检查运行状态');
    expect(markup).toContain('aria-busy="true"');
    expect(markup).toContain('role="status"');
    expect(markup).toContain('aria-live="polite"');
  });

  it('renders only contract-backed ready facts', () => {
    const markup = renderShell({
      kind: 'ready',
      response: READY_HEALTH_FIXTURE,
    });

    expect(markup).toContain('系统已就绪');
    expect(markup).toContain('<dd>API</dd>');
    expect(markup).toContain('<dd>已就绪</dd>');
    expect(markup).toContain('它不代表信源、知识或 AI 功能已经启用');
    expect(markup).not.toContain('AI Agent Active');
    expect(markup).not.toContain('Knowledge Graph');
    expect(markup).not.toContain('Review Queue');
  });

  it('renders not-ready as an actionable alert with retry', () => {
    const markup = renderShell({
      kind: 'not_ready',
      reason: 'contract',
      response: NOT_READY_HEALTH_FIXTURE,
    });

    expect(markup).toContain('role="alert"');
    expect(markup).toContain('服务暂未就绪');
    expect(markup).toContain('<dd>未就绪</dd>');
    expect(markup).toContain('<button');
    expect(markup).toContain('重试就绪检查');
  });

  it('renders offline and unexpected errors without claiming a product failure', () => {
    const offlineMarkup = renderShell({
      kind: 'not_ready',
      reason: 'offline',
    });
    const unexpectedMarkup = renderShell({
      kind: 'unexpected_error',
      reason: 'contract',
    });

    expect(offlineMarkup).toContain('无法连接运行状态接口');
    expect(offlineMarkup).toContain('未将离线状态解释为业务故障');
    expect(unexpectedMarkup).toContain('无法验证系统状态');
    expect(unexpectedMarkup).toContain('状态未被采信');
    expect(unexpectedMarkup).toContain('重试就绪检查');
  });

  it('renders the mock disclosure, Unicode content, and landmark hierarchy', () => {
    const markup = renderShell({kind: 'loading'});

    expect(markup).toContain('模拟数据 · 开发模式');
    expect(markup).toContain('中文 / Latin · 标点，。 · Emoji 🧭');
    expect(markup).toContain('<header');
    expect(markup).toContain('<nav');
    expect(markup).toContain('<main');
    expect(markup).toContain('<aside');
    expect(markup).toContain('<footer');
    expect(markup.match(/<h1/g)).toHaveLength(1);
    expect(markup).toContain('href="#main-content"');
    expect(markup).toMatch(
      /<main[^>]*id="main-content"[^>]*tabindex="-1"[^>]*>/,
    );
    expect(markup).not.toContain('tabindex="0"');
    expect(markup).toContain('aria-current="page"');
  });
});
