import {
  intakeReviewKind,
  inboxReceiptPresentation,
} from './inbox_review_state.js';
import {describe, expect, it} from 'vitest';
import {
  activityItems,
  articleStages,
  latestArticleItems,
  activitySummary,
  type AiActivityData,
} from './ai_activity_state.js';
import type {AiTask, IntakeRecord} from '../api/ai_workflow_client.js';
const task = (patch: Partial<AiTask> = {}): AiTask => ({
  taskId: 'synthetic-task',
  version: 1,
  model: 'synthetic-model',
  actorKind: 'owner',
  request: {kind: 'intake', snapshotId: 'synthetic-document'},
  state: {status: 'queued', phase: 'intake', calls: 0, steps: []},
  runtimeStatus: 'running',
  ...patch,
});
function data(tasks: AiTask[] = []): AiActivityData {
  return {
    model: 'synthetic-model',
    tasks,
    intakeRecords: [],
    reports: [],
    checkedAt: '2040-01-02T01:00:00Z',
    price: {
      policy: {revision: 1, enabled: true},
      rule: 'synthetic',
      timeZone: 'Asia/Shanghai',
      provider: 'synthetic',
      applicable: true,
      peak: true,
      blocked: true,
      checkedAt: '2040-01-02T01:00:00Z',
      nextAllowedAt: '2040-01-02T04:00:00Z',
    },
    queue: {
      modelConfigured: true,
      items: [],
      policy: {
        revision: 1,
        settings: {
          enabled: false,
          paused: false,
          subscriptionIds: [],
          manualUploads: false,
          model: 'synthetic-model',
          maxEntries: 12,
          maxRelations: 4,
          maxModelCalls: 24,
          maxDocumentsPerDay: 10,
        },
      },
    },
  };
}
const waiting = () =>
  task({
    runtimeStatus: 'idle',
    state: {
      status: 'paused',
      phase: 'intake',
      calls: 0,
      steps: [],
      errorCode: 'ai_price_window_closed',
    },
  });
describe('overview AI activity', () => {
  it('keeps budget waits out of document review and automatic price resumption', () => {
    const paused = waiting();
    paused.state.errorCode = 'ai_batch_budget_paused';
    const items = activityItems(data([paused]), []);
    expect(items[0]?.state).toBe('paused');
    expect(items[0]?.detail).toContain('模型账户');
    expect(items[0]?.detail).not.toContain('自动继续');
  });
  it('does not mistake the execution queue for a working model', () => {
    const d = data([task()]);
    const summary = activitySummary(d, activityItems(d, []));
    expect(summary.working).toHaveLength(0);
    expect(summary.waiting).toHaveLength(1);
    expect(summary.headline).toBe('AI 等待低价时段');
    expect(summary.next).toContain('12:00');
    expect(summary.nextKinds).toBe('接收审核');
  });
  it('shows actual work and its phase while preserving the separate upcoming window', () => {
    const d = data([
      task({state: {status: 'running', phase: 'recall', calls: 2, steps: []}}),
      waiting(),
    ]);
    const items = activityItems(d, []),
      summary = activitySummary(d, items);
    expect(summary.headline).toBe('AI 正在工作');
    expect(summary.working[0]?.detail).toBe('查找相关资料');
    expect(summary.nextAllowedAt).toBe('2040-01-02T04:00:00Z');
  });
  it('uses actual price time only when there is authorized pending work', () => {
    const d = data();
    expect(activitySummary(d, []).nextAllowedAt).toBeNull();
    expect(activitySummary(d, []).next).toBe('没有已排队的下一次任务。');
    d.tasks = [waiting()];
    if (d.price) {
      d.price.blocked = false;
      d.price.nextAllowedAt = null;
    }
    const summary = activitySummary(d, activityItems(d, []));
    expect(summary.headline).toBe('AI 等待继续');
    expect(summary.next).toContain('等待调度器');
  });
  it.each([
    {pauseRequested: true},
    {cancelRequested: true},
    {runtimeStatus: 'interrupted' as const},
    {actorKind: 'automation'},
    {model: 'old-model'},
  ])(
    'never promises an automatic price resume for stopped or ineligible work: %j',
    (patch) => {
      const d = data([{...waiting(), ...patch}]);
      const items = activityItems(d, []);
      expect(items[0]?.state).toBe('attention');
      expect(activitySummary(d, items).nextAllowedAt).toBeNull();
    },
  );
  it('does not mistake a restored queued task for a scheduled task', () => {
    const d = data([task({runtimeStatus: 'idle'})]);
    expect(activityItems(d, [])[0]?.state).toBe('attention');
  });
  it('preserves the review-only acceptance boundary and the held outcome', () => {
    const d = data([
      task({
        state: {
          status: 'succeeded',
          phase: 'complete',
          calls: 1,
          steps: [{complete: true, outcome: 'accepted'}],
        },
      }),
    ]);
    expect(activityItems(d, [])[0]).toMatchObject({
      state: 'done',
      detail: '已接受；整理尚未启动',
    });
    const completed = d.tasks[0];
    if (!completed) throw new Error('missing synthetic task');
    completed.state.steps = [{complete: true, outcome: 'held'}];
    d.intakeRecords = [
      {
        snapshotId: 'synthetic-document',
        version: 1,
        updatedAt: '2040-01-02',
        value: {
          receipt: 'pending',
          decision: 'held',
          origin: 'model',
          reason: '合成摘要待核对',
          preparation: 'received',
        },
      },
    ];
    expect(activityItems(d, [])[0]?.state).toBe('review');
    expect(activityItems(d, [])[0]?.detail).toContain('接受或拒绝');
  });
  it('keeps restored report state distinct from an active report generator', () => {
    const d = data();
    d.reports = [
      {
        reportId: 'report',
        version: 1,
        title: '合成日报',
        kind: 'daily',
        period: {from: '2040-01-02', to: '2040-01-02'},
        status: 'running',
        itemCount: 3,
        stale: false,
        active: false,
        planned: true,
        completedItemCount: 1,
      },
    ];
    expect(activityItems(d, [])[0]?.state).toBe('attention');
    const report = d.reports[0];
    if (!report) throw new Error('missing synthetic report');
    report.active = true;
    expect(activityItems(d, [])[0]).toMatchObject({
      state: 'working',
      detail: '撰写摘要 · 已完成 1 / 3 条',
    });
    report.status = 'queued';
    report.active = false;
    report.errorCode = 'ai_price_window_closed';
    expect(activitySummary(d, activityItems(d, [])).nextKinds).toBe('日报');
  });
  it('does not reveal private source labels or call external-agent edits internal AI work', () => {
    const d = data([task(), task({request: {kind: 'tags'}})]);
    const items = activityItems(d, [
      {
        workspaceId: 'w',
        snapshotId: 'synthetic-document',
        resourceId: 'r',
        resourceKind: 'manual_text',
        sourceKey: 'private name',
        isPrivate: true,
        capturedAt: '2040-01-02T00:00:00Z',
        fragmentCount: 1,
      },
    ]);
    expect(items).toHaveLength(1);
    expect(items[0]?.title).not.toContain('private name');
  });
});

it('shows global prohibition before any next-price promise', () => {
  const d = data([waiting()]);
  if (!d.price) throw Error('fixture');
  d.price.policy.operationsAllowed = false;
  const summary = activitySummary(d, activityItems(d, []));
  expect(summary.nextAllowedAt).toBeNull();
  expect(summary.headline).toContain('已禁止');
  expect(summary.next).toContain('等待你允许');
});
it('keeps receipt-only and held progress distinct from a completed document workflow', () => {
  const t = task({
    state: {
      status: 'succeeded',
      phase: 'complete',
      calls: 1,
      steps: [{kind: 'intake', complete: true, outcome: 'held'}],
    },
  });
  expect(articleStages(t).map((s) => s.state)).toEqual([
    'held',
    'pending',
    'pending',
    'pending',
    'pending',
  ]);
  const step = t.state.steps[0];
  if (!step) throw Error('fixture');
  step.outcome = 'accepted';
  expect(articleStages(t).map((s) => s.state)).toEqual([
    'done',
    'pending',
    'pending',
    'pending',
    'pending',
  ]);
  t.request.kind = 'document';
  t.state.steps.push(
    {kind: 'split', complete: true},
    {kind: 'tags', complete: true},
  );
  expect(articleStages(t)[3]).toMatchObject({state: 'done', detail: '无候选'});
});
it('keeps the newest result per article without rewriting task history', () => {
  const d = data([
    task({taskId: 'old', updatedAt: '2040-01-01'}),
    task({taskId: 'new', updatedAt: '2040-01-02'}),
  ]);
  const items = activityItems(d, []);
  expect(items).toHaveLength(2);
  expect(latestArticleItems(items).map((i) => i.id)).toEqual(['new']);
});

it('separates decision documents from failed tasks and resolves historical holds from current records', () => {
  const held = task({
    taskId: 'held',
    state: {
      status: 'succeeded',
      phase: 'complete',
      calls: 1,
      steps: [{kind: 'intake', complete: true, outcome: 'held'}],
    },
  });
  const d = data([
    held,
    {...held, taskId: 'older-hold'},
    task({
      taskId: 'failed',
      runtimeStatus: 'idle',
      request: {kind: 'document', snapshotId: 'failed-document'},
      state: {
        status: 'failed',
        phase: 'recall',
        calls: 3,
        steps: [],
        errorCode: 'ai_provider_invalid_response',
      },
    }),
  ]);
  d.intakeRecords = [
    {
      snapshotId: 'synthetic-document',
      version: 1,
      updatedAt: '2040-01-02',
      value: {
        receipt: 'pending',
        decision: 'held',
        origin: 'system',
        reason: '合成抓取失败',
        preparation: 'received',
      },
    },
  ];
  const record = d.intakeRecords[0];
  if (!record) throw new Error('missing synthetic record');
  expect(activitySummary(d, activityItems(d, [])).review).toHaveLength(1);
  expect(activitySummary(d, activityItems(d, [])).failed).toHaveLength(1);
  expect(intakeReviewKind(record)).toBe('receipt');
  record.value.receipt = 'accepted';
  record.value.receiptOrigin = 'manual';
  expect(intakeReviewKind(record)).toBe('processing');
  expect(activityItems(d, []).find((i) => i.id === 'held')?.detail).toContain(
    '整理仍被暂缓',
  );
  record.value.decision = 'admitted';
  record.value.origin = 'manual';
  expect(activitySummary(d, activityItems(d, [])).review).toHaveLength(0);
  expect(activityItems(d, []).find((i) => i.id === 'held')?.state).toBe(
    'settled',
  );
  expect(
    activityItems(d, []).find((i) => i.id === 'held')?.stages?.[0]?.detail,
  ).toBe('原审核暂缓');
  record.value.decision = 'held';
  record.value.receipt = 'rejected';
  expect(activitySummary(d, activityItems(d, [])).review).toHaveLength(0);
});
it('keeps a manually released document task awaiting explicit continuation, not automatic resumption', () => {
  const d = data([
    task({
      runtimeStatus: 'idle',
      request: {kind: 'document', snapshotId: 'synthetic-document'},
      state: {
        status: 'paused',
        phase: 'intake',
        calls: 1,
        steps: [],
        errorCode: 'intake_held',
      },
    }),
  ]);
  d.intakeRecords = [
    {
      snapshotId: 'synthetic-document',
      version: 2,
      updatedAt: '2040-01-02',
      value: {
        decision: 'admitted',
        origin: 'manual',
        reason: '已核对合成原文',
        preparation: 'received',
      },
    },
  ];
  const items = activityItems(d, []);
  expect(items[0]).toMatchObject({
    state: 'attention',
    detail: '接收判断已更新，整理任务需手动继续',
  });
  expect(activitySummary(d, items).waiting).toHaveLength(0);
});
it('includes current public holds beyond the recent task window and targets their original receipt', () => {
  const d = data();
  d.intakeRecords = [
    {
      snapshotId: 'receipt',
      version: 1,
      updatedAt: '2040-01-02',
      value: {
        decision: 'held',
        origin: 'model',
        reason: '合成资料',
        preparation: 'web_article',
        preparedSnapshotId: 'prepared',
      },
    },
  ];
  const source = {
    workspaceId: 'w',
    snapshotId: 'receipt',
    resourceId: 'r',
    resourceKind: 'manual_text' as const,
    sourceKey: 'Synthetic receipt',
    capturedAt: '2040-01-02T00:00:00Z',
    fragmentCount: 1,
  };
  expect(activityItems(d, [source])[0]).toMatchObject({
    state: 'review',
    reviewSnapshotId: 'receipt',
  });
  expect(activityItems(d, [{...source, isPrivate: true}])).toHaveLength(0);
  d.tasks = [
    task({
      runtimeStatus: 'idle',
      request: {kind: 'document', snapshotId: 'prepared'},
      state: {
        status: 'paused',
        phase: 'intake',
        calls: 1,
        steps: [],
        errorCode: 'intake_held',
      },
    }),
  ];
  expect(activityItems(d, [source])).toHaveLength(1);
  expect(activityItems(d, [source])[0]?.reviewSnapshotId).toBe('receipt');
});

describe('inbox receipt explanations', () => {
  const receipt = (): IntakeRecord => ({
    snapshotId: 'synthetic-document',
    version: 1,
    updatedAt: '2040-01-02',
    value: {
      receipt: 'pending',
      decision: 'pending',
      origin: 'system',
      reason: '',
      preparation: 'received',
    },
  });
  it('distinguishes unreviewed receipts, unavailable task status and actual quality holds', () => {
    const record = receipt();
    expect(inboxReceiptPresentation(record, undefined, true)).toMatchObject({
      tone: 'pending',
      label: '待接受 · 尚未审核',
    });
    expect(inboxReceiptPresentation(record, undefined, false).label).toBe(
      '待接受',
    );
    record.value.decision = 'held';
    record.value.reason = '合成摘要缺少正文';
    expect(inboxReceiptPresentation(record, undefined, false)).toMatchObject({
      tone: 'review',
      reasonLabel: '暂缓原因',
      reason: '合成摘要缺少正文',
    });
  });
  it('preserves quality holds after receipt acceptance and gives current rejection precedence over old AI output', () => {
    const record = receipt();
    const oldTask = task({
      state: {
        status: 'succeeded',
        phase: 'complete',
        calls: 1,
        steps: [{kind: 'intake', complete: true, outcome: 'held'}],
      },
    });
    record.value.decision = 'held';
    record.value.reason = '合成审核原因';
    record.value.receipt = 'accepted';
    expect(inboxReceiptPresentation(record, oldTask, true).label).toBe(
      '需人工核对 · 整理暂缓',
    );
    record.value.receipt = 'rejected';
    expect(inboxReceiptPresentation(record, oldTask, true)).toMatchObject({
      tone: 'rejected',
      label: '已拒绝',
      reasonLabel: '原暂缓原因',
    });
    record.value.receipt = 'accepted';
    record.value.decision = 'admitted';
    record.value.receiptOrigin = 'manual';
    expect(inboxReceiptPresentation(record, oldTask, true).label).toBe(
      '已接受',
    );
  });
  it('explains a price wait without claiming the AI has reviewed the document and recognizes interrupted work', () => {
    const record = receipt();
    expect(inboxReceiptPresentation(record, waiting(), true)).toMatchObject({
      tone: 'pending',
      label: 'AI 审核等待低价时段',
    });
    expect(
      inboxReceiptPresentation(
        record,
        task({runtimeStatus: 'interrupted'}),
        true,
      ),
    ).toMatchObject({tone: 'review', label: '审核已中断 · 待决定'});
  });
});

it.each(['paused', 'failed'] as const)(
  'shows a resumed %s task as queued before its next turn, without clearing saved checkpoints',
  (status) => {
    const d = data([
      task({
        request: {kind: 'document', snapshotId: 'synthetic-document'},
        state: {
          status,
          phase: 'tags',
          calls: 2,
          steps: [{kind: 'split', complete: true}],
          errorCode:
            status === 'paused' ? 'intake_held' : 'ai_provider_unavailable',
        },
      }),
    ]);
    expect(activityItems(d, [])[0]).toMatchObject({
      state: 'queued',
      detail: '等待前序任务完成 · 提取与添加标签',
    });
    expect(d.tasks[0]?.state.calls).toBe(2);
    expect(d.tasks[0]?.state.steps[0]?.complete).toBe(true);
    const current = d.tasks[0];
    if (!current) throw new Error('missing synthetic task');
    current.runtimeStatus = 'idle';
    expect(activityItems(d, [])[0]?.state).not.toBe('queued');
    current.runtimeStatus = 'running';
    current.pauseRequested = true;
    expect(activityItems(d, [])[0]?.state).not.toBe('queued');
  },
);

it('shows scheduled checkpoint recovery as queued, and disabled retry as paused', () => {
  const d = data([
    task({
      runtimeStatus: 'idle',
      request: {kind: 'document', snapshotId: 'synthetic-document'},
      state: {
        status: 'paused',
        phase: 'tags',
        calls: 2,
        steps: [],
        errorCode: 'ai_provider_timeout',
        automaticRetry: {limit: 2, used: 1, notBefore: '2040-01-02T04:00:00Z'},
      },
    }),
  ]);
  if (!d.price) throw new Error('missing fixture price');
  d.price.policy.automaticRetryLimit = 2;
  const item = activityItems(d, [])[0];
  expect(item?.state).toBe('queued');
  expect(item?.detail).toContain('自动断点重试 1/2');
  expect(item?.detail).toContain('低价时段');
  d.price.policy.automaticRetryLimit = 0;
  expect(activityItems(d, [])[0]).toMatchObject({
    state: 'paused',
    detail: '自动重试已关闭，等待手动继续',
  });
});
