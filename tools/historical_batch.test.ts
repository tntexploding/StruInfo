import {describe, it, expect, vi} from 'vitest';
import {historySchemas} from '../apps/server/src/application/source_history_service.js';
import {
  prepareManifest,
  validateManifest,
  type Candidate,
  type PreparationInput,
} from './historical_batch_plan.js';
import {
  advanceBatch,
  type BatchPorts,
  type BatchProgress,
  type BatchTask,
} from './historical_batch_runner.js';
function required<T>(v: T | undefined): T {
  if (v === undefined) throw new Error('missing synthetic value');
  return v;
}
const source = '11111111-1111-4111-8111-111111111111';
const other = '22222222-2222-4222-8222-222222222222';
function candidate(i: number, subscriptionId = source): Candidate {
  return {
    id: i.toString(16).padStart(64, '0'),
    subscriptionId,
    url: `https://example.invalid/story/${String(i)}`,
    title: `Synthetic item ${String(i)}`,
    publishedAt: `2025-${String((i % 12) + 1).padStart(2, '0')}-02T00:00:00Z`,
    access: 'public',
    completeness: 'unchecked',
  };
}
function input(): PreparationInput {
  return {
    id: 'synthetic',
    workspaceId: source,
    from: '2024-01-01',
    to: '2026-09-26',
    batchSize: 2,
    sources: [
      {
        subscriptionId: source,
        label: 'Synthetic source',
        limit: 5,
        previouslyAccepted: 1,
      },
    ],
    candidates: Array.from({length: 8}, (_, i) => candidate(i + 1)),
    previouslyReviewedUrls: [],
    task: {
      maxEntries: 64,
      maxRelations: 4,
      maxRelationCandidates: 8,
      maxModelCalls: 64,
    },
  };
}
describe('historical batch preparation', () => {
  it('applies the cumulative cap across all batches and does not fill exclusions with paid content', () => {
    const i = input();
    i.previouslyReviewedUrls = [required(i.candidates[0]).url];
    required(i.candidates[1]).access = 'restricted';
    required(i.candidates[2]).completeness = 'incomplete';
    const m = prepareManifest(i);
    expect(m.articles).toHaveLength(4);
    expect(m.articles.map((a) => a.batch)).toEqual([1, 1, 2, 2]);
    expect(m.reserve).toHaveLength(1);
    expect(m.excluded.map((a) => a.reason)).toEqual([
      'previously_received_or_reviewed',
      'restricted',
      'incomplete',
    ]);
    expect(m.articles.every((a) => a.completeness === 'unchecked')).toBe(true);
  });
  it('deduplicates across sources and tracking links but preserves meaningful query strings', () => {
    const i = input();
    i.sources.push({
      subscriptionId: other,
      label: 'Other source',
      limit: 5,
      previouslyAccepted: 0,
    });
    i.candidates = [
      candidate(1),
      {...candidate(2, other), url: candidate(1).url + '?utm_source=synthetic'},
      {...candidate(3), url: 'https://example.invalid/read?id=1'},
      {...candidate(4), url: 'https://example.invalid/read?id=2'},
    ];
    const m = prepareManifest(i);
    expect(m.articles).toHaveLength(3);
    expect(m.excluded[0]?.reason).toBe('duplicate_url');
  });
  it('keeps unknown dates and retrieval failures out of the execution manifest', () => {
    const i = input();
    delete required(i.candidates[0]).publishedAt;
    required(i.candidates[1]).completeness = 'unavailable';
    required(i.candidates[2]).publishedAt = '2023-01-01T00:00:00Z';
    const m = prepareManifest(i);
    expect(m.excluded.map((a) => a.reason)).toEqual([
      'unknown_publication_date',
      'needs_fetch_review',
      'outside_date_range',
    ]);
    required(m.sources[0]).previouslyAccepted = 5;
    expect(() => {
      validateManifest(m);
    }).toThrow('cumulative_source_cap_exceeded');
  });
  it('interleaves sources and samples throughout the date range rather than only newest material', () => {
    const i = input();
    i.sources.push({
      subscriptionId: other,
      label: 'Other',
      limit: 2,
      previouslyAccepted: 0,
    });
    i.candidates.push(candidate(20, other), candidate(21, other));
    const m = prepareManifest(i);
    expect(m.articles.slice(0, 4).map((a) => a.subscriptionId)).toEqual([
      source,
      other,
      source,
      other,
    ]);
    expect(
      m.articles.filter((a) => a.subscriptionId === source).map((a) => a.id),
    ).not.toEqual(i.candidates.slice(0, 4).map((a) => a.id));
  });
});
function fixture() {
  const i = input();
  i.candidates = [candidate(1)];
  const manifest = prepareManifest(i);
  const progress: BatchProgress = {
    format: 'struinfo.historical-progress.v1',
    manifestId: manifest.id,
    articles: {},
  };
  const row = required(manifest.articles[0]);
  let paused = false,
    receipt = 'pending',
    manual = false,
    blocked = false,
    budgetPaused = false;
  let currentTask: BatchTask = {
    taskId: other,
    version: 1,
    request: {kind: 'document', snapshotId: source},
    state: {status: 'queued', calls: 0},
  };
  const log: {op: string; value: unknown}[] = [];
  const call = vi.fn(async (op: string, value: unknown) => {
    await Promise.resolve();
    log.push({op, value});
    if (Object.hasOwn(historySchemas, op))
      historySchemas[op as keyof typeof historySchemas].parse(value);
    if (op === 'system_status')
      return {
        model: 'synthetic-model',
        aiPrice: {
          blocked,
          policy: {
            operationsAllowed: true,
            maxConcurrentRequests: 2,
            automaticRetryLimit: 1,
          },
        },
      };
    if (op === 'intake_status')
      return {
        records: [
          {
            snapshotId: source,
            version: 1,
            value: {
              receipt,
              ...(manual ? {origin: 'manual', decision: 'held'} : {}),
            },
          },
        ],
      };
    if (op === 'history_restore')
      return {sessionId: other, sources: [{subscriptionId: source}]};
    if (op === 'history_list') return {articles: [row]};
    if (op === 'history_preview') return {item: row, access: 'public'};
    if (op === 'history_prepare_import') return {planId: other};
    if (op === 'history_import')
      return {results: [{status: 'imported', snapshotId: source}]};
    if (op === 'task_start' || op === 'task_read') return currentTask;
    if (op === 'task_control')
      return {...currentTask, version: currentTask.version + 1};
    return {};
  });
  const ports: BatchPorts = {
    call: async <T>(op: string, value: unknown = {}) =>
      (await call(op, value)) as T,
    save: vi.fn(() => Promise.resolve()),
    paused: () => Promise.resolve(paused),
    budget: () =>
      Promise.resolve({
        batchId: 'synthetic-1',
        workspaceId: source,
        model: 'synthetic-model',
        paused: budgetPaused,
        limitCny: 10,
      }),
  };
  return {
    manifest,
    progress,
    row,
    ports,
    log,
    call,
    pause: () => {
      paused = true;
    },
    block: () => {
      blocked = true;
    },
    pauseBudget: () => {
      budgetPaused = true;
    },
    hold: () => {
      manual = true;
    },
    reject: () => {
      receipt = 'rejected';
    },
    setTask: (task: BatchTask) => {
      currentTask = task;
    },
  };
}
describe('historical batch execution', () => {
  it('honors pause, price and batch budgets before restoring a session or admitting a document', async () => {
    for (const kind of ['pause', 'price', 'budget']) {
      const f = fixture();
      if (kind === 'pause') f.pause();
      if (kind === 'price') f.block();
      if (kind === 'budget') f.pauseBudget();
      expect(await advanceBatch(f.manifest, f.progress, 1, f.ports)).toBe(
        kind === 'pause'
          ? 'paused'
          : kind === 'price'
            ? 'dispatch_wait'
            : 'budget_wait',
      );
      expect(
        f.log.some((x) => x.op.startsWith('history') || x.op === 'task_start'),
      ).toBe(false);
    }
  });
  it('recovers a lost task-start response with the same persisted request without importing again', async () => {
    const f = fixture();
    const original = f.ports.call;
    let fail = true;
    f.ports.call = async <T>(op: string, value: unknown = {}) => {
      const result = await original<T>(op, value);
      if (op === 'task_start' && fail) {
        fail = false;
        throw new Error('synthetic_connection_lost');
      }
      return result;
    };
    await expect(
      advanceBatch(f.manifest, f.progress, 1, f.ports),
    ).rejects.toThrow('synthetic_connection_lost');
    const first = structuredClone(f.progress.articles[f.row.id]?.startRequest);
    expect(await advanceBatch(f.manifest, f.progress, 1, f.ports)).toBe(
      'started',
    );
    expect(f.progress.articles[f.row.id]?.startRequest).toEqual(first);
    expect(f.log.filter((x) => x.op === 'history_import')).toHaveLength(1);
    expect(
      f.log.filter((x) => x.op === 'task_start').map((x) => x.value),
    ).toEqual([first, first]);
  });
  it('restores an uncertain import with a new session and preserves an existing manual hold', async () => {
    const f = fixture();
    f.progress.articles[f.row.id] = {status: 'importing'};
    f.hold();
    const original = f.ports.call;
    f.ports.call = async <T>(op: string, value: unknown = {}) => {
      const result = await original<T>(op, value);
      if (op === 'history_list')
        return {articles: [{...f.row, existingSnapshotId: source}]} as T;
      if (op === 'history_import')
        return {results: [{status: 'existing', snapshotId: source}]} as T;
      return result;
    };
    expect(await advanceBatch(f.manifest, f.progress, 1, f.ports)).toBe('held');
    expect(f.log.some((x) => x.op === 'task_start')).toBe(false);
  });
  it('does not take over previously received documents', async () => {
    const f = fixture(),
      original = f.ports.call;
    f.ports.call = async <T>(op: string, value: unknown = {}) =>
      op === 'history_list'
        ? ({articles: [{...f.row, existingSnapshotId: source}]} as T)
        : original<T>(op, value);
    expect(await advanceBatch(f.manifest, f.progress, 1, f.ports)).toBe(
      'existing',
    );
    expect(
      f.log.some((x) => x.op === 'history_import' || x.op === 'task_start'),
    ).toBe(false);
  });
  it('pauses only its own active tasks and never restarts failed or manually paused tasks', async () => {
    const f = fixture();
    f.progress.articles[f.row.id] = {
      status: 'processing',
      snapshotId: source,
      taskId: other,
    };
    f.pause();
    expect(await advanceBatch(f.manifest, f.progress, 1, f.ports)).toBe(
      'pausing',
    );
    expect(f.log.find((x) => x.op === 'task_control')?.value).toEqual({
      taskId: other,
      expectedVersion: 1,
      action: 'pause',
    });
    f.setTask({
      taskId: other,
      version: 3,
      request: {kind: 'document', snapshotId: source},
      pauseRequested: true,
      runtimeStatus: 'idle',
      state: {status: 'paused', calls: 1},
    });
    expect(await advanceBatch(f.manifest, f.progress, 1, f.ports)).toBe(
      'paused',
    );
    expect(f.progress.articles[f.row.id]?.pausedTaskVersion).toBe(3);
    const g = fixture();
    g.progress.articles[g.row.id] = {
      status: 'processing',
      snapshotId: source,
      taskId: other,
    };
    g.setTask({
      taskId: other,
      version: 5,
      request: {kind: 'document', snapshotId: source},
      state: {
        status: 'failed',
        calls: 64,
        errorCode: 'model_call_budget_exhausted',
      },
    });
    expect(await advanceBatch(g.manifest, g.progress, 1, g.ports)).toBe(
      'settled',
    );
    expect(g.progress.articles[g.row.id]?.status).toBe('failed');
    expect(
      g.log.some((x) => x.op === 'task_control' || x.op === 'task_start'),
    ).toBe(false);
  });
  it('blocks mismatched budget identity and rechecks access before import', async () => {
    const f = fixture();
    f.ports.budget = () =>
      Promise.resolve({
        batchId: 'unrelated',
        workspaceId: source,
        model: 'synthetic-model',
        paused: false,
        limitCny: 10,
      });
    await expect(
      advanceBatch(f.manifest, f.progress, 1, f.ports),
    ).rejects.toThrow('batch_budget_mismatch');
    const g = fixture(),
      original = g.ports.call;
    g.ports.call = async <T>(op: string, value: unknown = {}) =>
      op === 'history_preview'
        ? ({item: g.row, access: 'restricted'} as T)
        : original<T>(op, value);
    expect(await advanceBatch(g.manifest, g.progress, 1, g.ports)).toBe(
      'excluded',
    );
    expect(g.log.some((x) => x.op === 'history_import')).toBe(false);
  });
  it('waits for the application retry delay and stops at a budget hold without a resume loop', async () => {
    for (const budget of [false, true]) {
      const f = fixture();
      f.progress.articles[f.row.id] = {
        status: 'processing',
        snapshotId: source,
        taskId: other,
      };
      f.setTask({
        taskId: other,
        version: 3,
        request: {kind: 'document', snapshotId: source},
        state: {
          status: 'paused',
          calls: 1,
          errorCode: budget ? 'ai_batch_budget_paused' : 'ai_response_invalid',
          ...(budget
            ? {}
            : {
                automaticRetry: {
                  limit: 1,
                  used: 1,
                  notBefore: '2099-01-01T00:00:00Z',
                },
              }),
        },
      });
      expect(await advanceBatch(f.manifest, f.progress, 1, f.ports)).toBe(
        budget ? 'budget_wait' : 'running',
      );
      expect(
        f.log.some((x) => x.op === 'task_control' || x.op === 'task_start'),
      ).toBe(false);
    }
  });
  it('continues an interrupted owned task but preserves a separate manual pause', async () => {
    for (const manualPause of [false, true]) {
      const f = fixture();
      f.progress.articles[f.row.id] = {
        status: 'processing',
        snapshotId: source,
        taskId: other,
      };
      f.setTask({
        taskId: other,
        version: 3,
        request: {kind: 'document', snapshotId: source},
        runtimeStatus: manualPause ? 'idle' : 'interrupted',
        pauseRequested: manualPause,
        state: {status: manualPause ? 'paused' : 'running', calls: 2},
      });
      expect(await advanceBatch(f.manifest, f.progress, 1, f.ports)).toBe(
        manualPause ? 'settled' : 'resumed',
      );
      expect(f.log.some((x) => x.op === 'task_control')).toBe(!manualPause);
      expect(f.log.some((x) => x.op === 'task_start')).toBe(false);
    }
  });
  it('does not poll an immutable completed task again on every admission tick', async () => {
    const f = fixture();
    f.progress.articles[f.row.id] = {
      status: 'completed',
      snapshotId: source,
      taskId: other,
    };
    expect(await advanceBatch(f.manifest, f.progress, 1, f.ports)).toBe(
      'settled',
    );
    expect(f.log.some((x) => x.op.startsWith('task'))).toBe(false);
  });
});
