import {expect, it, vi} from 'vitest';
import {
  advanceHistoryTasks,
  pauseHistoryTasks,
  type HistoryTaskPorts,
} from './source_history_processing.js';
import type {HistorySession} from '../modules/subscriptions/source_history.js';
import type {AgentTask} from './agent_task_contract.js';

it('recovers a submitted native task and observes the same pause, budget and manual decisions', async () => {
  const snapshot = '11111111-1111-4111-8111-111111111111',
    planId = '22222222-2222-4222-8222-222222222222';
  const session: HistorySession = {
    id: planId,
    parts: 0,
    touched: 0,
    articles: new Map(),
    sources: new Map(),
    plan: {
      id: planId,
      ids: new Set(['row']),
      from: undefined,
      to: undefined,
      results: new Map([
        [
          'row',
          {
            id: 'row',
            status: 'imported',
            snapshotId: snapshot,
            job: {receiptVersion: 1},
          },
        ],
      ]),
      processing: {budgetId: 'demo-1', maxModelCalls: 3, state: 'running'},
    },
  };
  let task: AgentTask = {
    taskId: snapshot,
    workspaceId: planId,
    actorKind: 'owner',
    actorId: 'local-owner',
    policyVersion: 'struinfo.agent-task.v1',
    requestKey: 'history-' + planId + '-' + snapshot,
    model: 'synthetic',
    request: {
      kind: 'document',
      snapshotId: snapshot,
      maxEntries: 40,
      maxRelations: 0,
      maxModelCalls: 3,
      budgetId: 'demo-1',
    },
    state: {phase: 'tags', status: 'running', steps: [], calls: 1},
    pauseRequested: false,
    cancelRequested: false,
    version: 2,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  };
  let budgetId = 'other',
    allowed = true;
  const ports = {
    limits: () =>
      Promise.resolve({
        model: 'synthetic',
        allowed,
        concurrency: 1,
        maxModelCalls: 3,
        budget: {
          model: 'synthetic',
          batchId: budgetId,
          paused: false,
          remainingCny: 1,
        },
      }),
    receipt: () => Promise.resolve(undefined),
    tasks: () => Promise.resolve([task]),
    read: () => Promise.resolve(task),
    start: vi.fn(() => {
      throw Error('duplicate admission');
    }),
    control: vi.fn((_, action) => {
      task = {
        ...task,
        version: task.version + 1,
        pauseRequested: action === 'pause',
        state: {
          ...task.state,
          status: action === 'pause' ? 'paused' : 'running',
        },
      };
      return Promise.resolve(task);
    }),
  } satisfies HistoryTaskPorts;
  const tick = () =>
    advanceHistoryTasks(session, ports, () => Promise.resolve());
  expect(await tick()).toBe('budget_wait');
  budgetId = 'demo-1';
  allowed = false;
  expect(await tick()).toBe('dispatch_wait');
  allowed = true;
  expect(await tick()).toBe('again');
  expect(session.plan?.results.get('row')?.job?.taskId).toBe(task.taskId);
  await pauseHistoryTasks(session, ports);
  expect(task.pauseRequested).toBe(true);
  expect(await tick()).toBe('again');
  expect(task.pauseRequested).toBe(false);
  task = {
    ...task,
    pauseRequested: true,
    state: {...task.state, status: 'paused'},
  };
  expect(await tick()).toBe('finished');
  expect(ports.start).not.toHaveBeenCalled();
  expect(ports.control).toHaveBeenCalledTimes(2);
});
