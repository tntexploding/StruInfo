import {describe, it, expect} from 'vitest';
import {processingForDocument} from './document_processing_state.js';
import type {AiTask, IntakeRecord} from '../api/ai_workflow_client.js';
const task: AiTask = {
  taskId: 'synthetic-task',
  version: 1,
  model: 'synthetic-model',
  actorKind: 'owner',
  request: {kind: 'document', snapshotId: 'source'},
  state: {
    status: 'paused',
    phase: 'intake',
    calls: 0,
    errorCode: 'ai_price_window_closed',
    steps: [{kind: 'intake', targetId: 'source', complete: false}],
  },
};
const intake: IntakeRecord = {
  snapshotId: 'source',
  version: 1,
  updatedAt: '2040-01-01T00:00:00Z',
  value: {
    decision: 'pending',
    origin: 'system',
    reason: '合成待审核',
    preparation: 'web_article',
    preparedSnapshotId: 'full',
    previousPreparedSnapshotIds: ['old'],
  },
};
describe('document processing presentation', () => {
  it('does not present receipt-only acceptance as completed document processing', () => {
    const receipt: AiTask = {
      ...task,
      request: {kind: 'intake', snapshotId: 'source'},
      state: {
        status: 'succeeded',
        phase: 'complete',
        calls: 1,
        steps: [{kind: 'intake', complete: true, outcome: 'accepted'}],
      },
    };
    const view = processingForDocument('source', [receipt], []);
    expect(view.label).toBe('AI 已接受 · 未启动整理');
    expect(
      view.stages
        .filter((s) => s.id !== 'intake')
        .every((s) => s.state === 'idle'),
    ).toBe(true);
    expect(view.stages.find((s) => s.id === 'split')?.detail).toBe('未启动');
  });
  it('shows price wait without pretending any step has completed, and manual pause wins', () => {
    const view = processingForDocument('source', [task], []);
    expect(view.label).toBe('AI 等待低价时段');
    expect(view.stages.every((s) => s.state !== 'done')).toBe(true);
    expect(view.task?.state.calls).toBe(0);
    expect(
      processingForDocument('source', [{...task, pauseRequested: true}], [])
        .label,
    ).toBe('AI 已手动暂停');
  });
  it('links received and prepared evidence while marking historical captures', () => {
    expect(processingForDocument('full', [task], [intake]).task).toBe(task);
    expect(
      processingForDocument('source', [task], [intake]).targetSnapshotId,
    ).toBe('full');
    expect(processingForDocument('old', [task], [intake]).historical).toBe(
      true,
    );
    expect(
      processingForDocument('unrelated', [task], [intake]).task,
    ).toBeUndefined();
  });
  it('shows a batch budget wait without promising automatic or global-control resumption', () => {
    const view = processingForDocument(
      'source',
      [{...task, state: {...task.state, errorCode: 'ai_batch_budget_paused'}}],
      [],
    );
    expect(view.label).toBe('AI 等待批次继续');
    expect(view.reason).toContain('模型账户');
    expect(view.reason).toContain('恢复批次后');
    expect(view.stages.every((s) => s.state !== 'done')).toBe(true);
  });
  it('does not claim AI work for manually blocked or manually annotated material', () => {
    const record = {
      ...intake,
      value: {
        ...intake.value,
        decision: 'blocked' as const,
        origin: 'manual' as const,
        reason: '合成技术限制',
      },
    };
    const blocked = processingForDocument('source', [], [record]);
    expect(blocked.label).toBe('整理已拦截');
    expect(blocked.reason).toBe('合成技术限制');
    expect(blocked.stages.find((s) => s.id === 'tags')?.state).toBe('idle');
    expect(processingForDocument('source', [], []).label).toBe(
      '尚无 AI 文档任务',
    );
  });
  it('counts written edges, completed no-relation decisions and skipped candidates separately', () => {
    const finished: AiTask = {
      ...task,
      state: {
        status: 'succeeded',
        phase: 'complete',
        calls: 5,
        steps: [
          {
            kind: 'split',
            targetId: 'full',
            complete: true,
            proposalId: 'split',
          },
          {kind: 'tags', targetId: 'entry', complete: true, proposalId: 'tags'},
          {
            kind: 'relation',
            targetId: 'entry',
            complete: true,
            proposalId: 'edge',
          },
          {
            kind: 'relation',
            targetId: 'entry',
            complete: true,
            outcome: 'no_relation',
          },
          {
            kind: 'relation',
            targetId: 'entry',
            complete: true,
            outcome: 'edge_budget_reached',
          },
        ],
      },
    };
    const view = processingForDocument('full', [finished], [intake]);
    expect(view.stages.find((s) => s.id === 'split')?.detail).toBe('整篇保留');
    expect(view.stages.find((s) => s.id === 'tags')?.detail).toBe(
      '1 / 1 条完成',
    );
    expect(view.stages.find((s) => s.id === 'relations')?.detail).toBe(
      '已建 1 · 未建 1 · 1 未评估',
    );
  });
  it('does not mark a partial failed task or interrupted runtime as finished', () => {
    const partial = {
      ...task,
      state: {
        ...task.state,
        status: 'failed',
        phase: 'tags',
        errorCode: 'ai_provider_timeout',
        steps: [
          {kind: 'split', targetId: 'source', complete: true},
          {kind: 'tags', targetId: 'entry', complete: false},
        ],
      },
    };
    const view = processingForDocument('source', [partial], []);
    expect(view.label).toBe('AI 部分完成');
    expect(view.stages.find((s) => s.id === 'split')?.state).toBe('done');
    expect(view.stages.find((s) => s.id === 'tags')?.state).toBe('attention');
    expect(
      processingForDocument(
        'source',
        [{...partial, runtimeStatus: 'interrupted'}],
        [],
      ).label,
    ).toBe('AI 待恢复');
  });
});
