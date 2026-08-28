import {renderToStaticMarkup} from 'react-dom/server';
import {describe, expect, it, vi} from 'vitest';

import {
  InformationEntryAutomationExecutionAudit,
  InformationEntryAutomationPolicyPanel,
} from './information_entry_automation_policy_panel.js';

const unavailable = () => Promise.reject(new Error('not called'));

describe('InformationEntryAutomationPolicyPanel', () => {
  it('renders an honest unavailable state without exposing inactive run controls', () => {
    const services = automationServices();
    const markup = renderToStaticMarkup(
      <InformationEntryAutomationPolicyPanel enabled={false} {...services} />,
    );

    expect(markup).toContain('可恢复自动分流');
    expect(markup).toContain('当前运行时未提供可恢复自动分流边界');
    expect(markup).not.toContain('确认并记录本次分流');
    expect(
      Object.values(services).every(
        (service) => service.mock.calls.length === 0,
      ),
    ).toBe(true);
  });

  it('renders a labelled loading state before policy and audit data arrive', () => {
    const markup = renderToStaticMarkup(
      <InformationEntryAutomationPolicyPanel
        enabled
        {...automationServices()}
      />,
    );

    expect(markup).toContain('role="status"');
    expect(markup).toContain('正在读取自动分流设置与运行记录');
    expect(markup).not.toContain('与外部配置一致');
  });

  it('renders exact failed-run recovery state without implying content writes', () => {
    const markup = renderToStaticMarkup(
      <InformationEntryAutomationExecutionAudit
        state={{
          status: 'ready',
          value: {
            runId: '11111111-1111-4111-8111-111111111111',
            status: 'failed',
            version: 3,
            policyRevision: 4,
            profileRevision: 5,
            includePrivate: true,
            errorCode: 'automation_execution_failed',
            claims: [
              {
                ordinal: 0,
                entryId: '22222222-2222-4222-8222-222222222222',
                entryRevision: 7,
                route: 'manual_review',
                reason: 'manual_takeover',
                status: 'claimed',
                errorCode: 'synthetic_claim_pending',
                createdAt: '2026-08-26T00:00:00.000Z',
              },
            ],
          },
        }}
        onRetry={vi.fn()}
      />,
    );

    expect(markup).toContain('完整运行审计');
    expect(markup).toContain('仍有 1 条分流事实没有结算');
    expect(markup).toContain('Entry、标签、联系和知识图谱均未被本运行改写');
    expect(markup).toContain('automation_execution_failed');
    expect(markup).toContain('synthetic_claim_pending');
    expect(markup).toContain('待结算');
  });

  it('keeps an exact-run read failure retryable and separate from recent summaries', () => {
    const markup = renderToStaticMarkup(
      <InformationEntryAutomationExecutionAudit
        state={{
          status: 'error',
          runId: '33333333-3333-4333-8333-333333333333',
          message: '无法读取该运行的完整审计记录。',
        }}
        onRetry={vi.fn()}
      />,
    );

    expect(markup).toContain('role="alert"');
    expect(markup).toContain('无法读取该运行的完整审计记录');
    expect(markup).toContain('重试完整审计');
  });
});

function automationServices() {
  return {
    onLoad: vi.fn(unavailable),
    onSave: vi.fn(unavailable),
    onTrial: vi.fn(unavailable),
    onExecute: vi.fn(unavailable),
    onListRuns: vi.fn(unavailable),
    onLoadRun: vi.fn(unavailable),
  };
}
