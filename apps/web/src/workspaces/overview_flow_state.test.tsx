import {describe, expect, it} from 'vitest';
import {renderToStaticMarkup} from 'react-dom/server';
import type {AiTask} from '../api/ai_workflow_client.js';
import {activityItems, type AiActivityData} from './ai_activity_state.js';
import {currentOverviewItems, overviewFlow} from './overview_flow_state.js';
import {AiTaskQueue} from './ai_activity_panel.js';

function task(id: string, phase: string, status = 'running'): AiTask {
  return {
    taskId: id,
    version: 1,
    model: 'synthetic',
    actorKind: 'owner',
    createdAt: '2040-01-01T00:00:00Z',
    request: {kind: 'document', snapshotId: id},
    runtimeStatus: status === 'running' ? 'running' : 'idle',
    state: {status, phase, calls: 1, steps: []},
  };
}
function fixture(tasks: AiTask[] = []): AiActivityData {
  return {
    model: 'synthetic',
    tasks,
    intakeRecords: [],
    reports: [],
    checkedAt: '2040-01-01T00:00:00Z',
    price: {
      policy: {revision: 1, enabled: true, maxConcurrentRequests: 2},
      rule: 'synthetic',
      timeZone: 'Asia/Shanghai',
      provider: 'synthetic',
      applicable: true,
      peak: false,
      blocked: false,
      checkedAt: '2040-01-01T00:00:00Z',
      nextAllowedAt: null,
    },
    queue: {
      items: [],
      modelConfigured: true,
      policy: {
        revision: 1,
        settings: {
          enabled: true,
          paused: false,
          subscriptionIds: [],
          manualUploads: false,
          model: 'synthetic',
          maxEntries: 12,
          maxRelations: 4,
          maxModelCalls: 24,
          maxDocumentsPerDay: 10,
        },
      },
    },
  };
}
describe('overview workflow state', () => {
  it('maps concurrent stages, recall and price waits without calling queued work running', () => {
    const waiting = task('waiting', 'tags', 'paused');
    waiting.state.errorCode = 'ai_price_window_closed';
    const data = fixture([
      task('split', 'split'),
      task('recall', 'recall'),
      waiting,
    ]);
    const flow = overviewFlow(data, activityItems(data, []));
    expect(flow.find((s) => s.id === 'split')?.tone).toBe('working');
    expect(flow.find((s) => s.id === 'relations')?.tone).toBe('working');
    expect(flow.find((s) => s.id === 'tags')).toMatchObject({
      tone: 'waiting',
      counts: {working: 0, waiting: 1},
    });
  });
  it('lights up newly received documents without an AI task, and clears on rejection', () => {
    const data = fixture();
    data.intakeRecords = [
      {
        snapshotId: 'new',
        version: 1,
        updatedAt: data.checkedAt,
        value: {
          receipt: 'pending',
          decision: 'pending',
          preparation: 'received',
          origin: 'system',
          reason: '',
        },
      },
    ];
    expect(overviewFlow(data, [])[0]).toMatchObject({
      tone: 'review',
      pending: 1,
    });
    const received = data.intakeRecords[0];
    if (!received) throw new Error('missing synthetic receipt');
    received.value.receipt = 'rejected';
    expect(overviewFlow(data, [])[0]).toMatchObject({tone: 'idle', pending: 0});
  });
  it('never keeps a superseded failure red when a newer prepared version succeeded or was cancelled', () => {
    const old = task('original', 'tags', 'failed');
    old.state.errorCode = 'ai_provider_invalid_response';
    const newer = task('prepared', 'complete', 'succeeded');
    newer.createdAt = '2040-01-02T00:00:00Z';
    const data = fixture([old, newer]);
    data.intakeRecords = [
      {
        snapshotId: 'original',
        version: 2,
        updatedAt: data.checkedAt,
        value: {
          receipt: 'accepted',
          decision: 'admitted',
          preparation: 'web_article',
          preparedSnapshotId: 'prepared',
          origin: 'manual',
          reason: '',
        },
      },
    ];
    let items = currentOverviewItems(data, activityItems(data, []));
    expect(items.map((i) => i.id)).toEqual(['prepared']);
    expect(overviewFlow(data, items).every((s) => s.tone !== 'failed')).toBe(
      true,
    );
    newer.state.status = 'cancelled';
    items = currentOverviewItems(data, activityItems(data, []));
    expect(items).toHaveLength(0);
    // A still-active old writer must stay visible and cancellable.
    old.runtimeStatus = 'running';
    old.state.status = 'running';
    expect(currentOverviewItems(data, activityItems(data, []))).toHaveLength(1);
  });
  it('preserves failure and working counts together, and marks stale state unknown', () => {
    const data = fixture([task('a', 'split'), task('b', 'split', 'failed')]);
    const items = activityItems(data, []);
    expect(
      overviewFlow(data, items).find((s) => s.id === 'split'),
    ).toMatchObject({
      tone: 'failed',
      counts: {working: 1, failed: 1},
    });
    expect(
      overviewFlow(data, items, true).every((s) => s.tone === 'unknown'),
    ).toBe(true);
    expect(overviewFlow(undefined, []).every((s) => s.tone === 'unknown')).toBe(
      true,
    );
  });
  it('includes automatic admissions before a model task exists without duplicating active tasks', () => {
    const data = fixture();
    data.queue.items = [
      {
        snapshotId: 'scheduled',
        status: 'pending',
        version: 1,
        sourceLabel: '合成订阅',
      },
    ];
    expect(activityItems(data, [])[0]).toMatchObject({
      state: 'queued',
      actor: '自动任务',
      phase: 'intake',
    });
    data.tasks = [task('scheduled', 'intake')];
    expect(activityItems(data, [])).toHaveLength(1);
  });
  it('shows the actual configured concurrency, changes on new settings, and never invents it while loading', () => {
    const data = fixture();
    const render = (value: AiActivityData | undefined) =>
      renderToStaticMarkup(
        <AiTaskQueue
          embedded
          activity={{
            data: value,
            error: false,
            saving: false,
            saveError: '',
            saveMessage: '',
            setOperations: () => Promise.resolve(),
            refresh: () => undefined,
          }}
          items={[]}
          onNavigate={() => undefined}
          onReviewInbox={() => undefined}
        >
          {null}
        </AiTaskQueue>,
      );
    expect(render(data)).toContain('模型请求并发上限 2');
    if (!data.price) throw new Error('missing synthetic settings');
    data.price.policy.maxConcurrentRequests = 4;
    expect(render(data)).toContain('模型请求并发上限 4');
    expect(render(undefined)).toContain('模型请求并发上限 —');
  });
});
