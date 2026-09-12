import {requireOperationValue} from './operation_error.js';
import {describe, it, expect, vi} from 'vitest';
import type {
  ProcessingRun,
  ProcessingProposal,
} from '../modules/processing/processing_contract.js';
import type {
  AgentTask,
  AgentTaskRepository,
  AgentTaskStep,
} from './agent_task_contract.js';
import type {AgentTaskActions} from './agent_task_actions.js';
import {AgentTaskService} from './agent_task_service.js';
import {
  ExecutionAuthority,
  DELEGATED_READ_OPERATIONS,
} from './execution_authority.js';
import {OperationError} from './operation_error.js';
const W = '00000000-0000-4000-8000-000000000001';
const S = '00000000-0000-4000-8000-000000000002';
const E = '00000000-0000-4000-8000-000000000003';
const P = '00000000-0000-4000-8000-000000000004';
const owner = ExecutionAuthority.owner(W);
function fixture(guard?: (task: AgentTask) => Promise<string | undefined>) {
  const rows = new Map<string, AgentTask>();
  const locks = new Set<string>();
  const runs = new Map<string, ProcessingRun>();
  const repository: AgentTaskRepository = {
    create: (task) => {
      if (rows.has(task.taskId)) return Promise.resolve(false);
      rows.set(task.taskId, structuredClone(task));
      return Promise.resolve(true);
    },
    read: (_w, id) =>
      Promise.resolve(rows.get(id) ? structuredClone(rows.get(id)) : undefined),
    list: () =>
      Promise.resolve([...rows.values()].map((t) => structuredClone(t))),
    saveState: (_w, id, state) => {
      const task = requireOperationValue(rows.get(id));
      rows.set(id, {
        ...task,
        state: structuredClone(state),
        version: task.version + 1,
      });
      return Promise.resolve();
    },
    control: (_w, id, version, action) => {
      const task = requireOperationValue(rows.get(id));
      if (task.version !== version) return Promise.resolve(false);
      rows.set(id, {
        ...task,
        pauseRequested: action !== 'resume',
        cancelRequested: action === 'cancel',
        version: task.version + 1,
      });
      return Promise.resolve(true);
    },
    withLock: async (_w, id, action) => {
      if (locks.has(id)) throw new OperationError('conflict', 'task_busy');
      locks.add(id);
      try {
        return await action();
      } finally {
        locks.delete(id);
      }
    },
  };
  let count = 0;
  const actions = {
    model: 'synthetic-model',
    preflight: vi.fn(() => {
      return Promise.resolve();
    }),
    runId: (_step: AgentTaskStep, key: string) => key,
    loadRun: vi.fn((step: AgentTaskStep) =>
      Promise.resolve(step.runId ? runs.get(step.runId) : undefined),
    ),
    generate: vi.fn((_task: AgentTask, step: AgentTaskStep) => {
      const proposal = {
        proposalId: P,
        status: 'pending_review',
      } as ProcessingProposal;
      const run = {
        runId: requireOperationValue(step.runId),
        status: 'succeeded',
        proposals: [proposal],
      } as unknown as ProcessingRun;
      runs.set(requireOperationValue(step.runId), run);
      return Promise.resolve(run);
    }),
    accept: vi.fn<
      (
        task: AgentTask,
        step: AgentTaskStep,
        proposal: ProcessingProposal,
      ) => Promise<void>
    >(() => {
      count++;
      return Promise.resolve();
    }),
    tagSteps: vi.fn(() =>
      Promise.resolve([
        {
          kind: 'tags',
          targetId: E,
          expectedRevision: 1,
          attempt: 0,
          complete: false,
        },
      ] as AgentTaskStep[]),
    ),
    relationSteps: vi.fn(() => Promise.resolve([] as AgentTaskStep[])),
  };
  const service = new AgentTaskService(
    W,
    repository,
    actions as unknown as AgentTaskActions,
    guard,
  );
  const done = async (id: string) => {
    await vi.waitFor(() => {
      expect(rows.get(id)?.state.status).not.toBe('queued');
    });
    await vi.waitFor(() => {
      expect(['succeeded', 'failed', 'paused', 'cancelled']).toContain(
        rows.get(id)?.state.status,
      );
    });
    return requireOperationValue(rows.get(id));
  };
  return {
    service,
    actions,
    repository,
    rows,
    runs,
    done,
    get writes() {
      return count;
    },
  };
}
describe('bounded Agent tasks', () => {
  it('rechecks saved automation authority after generation and resumes the same proposal', async () => {
    let denied: string | undefined;
    const f = fixture(() => Promise.resolve(denied));
    const generate = requireOperationValue(
      f.actions.generate.getMockImplementation(),
    );
    f.actions.generate.mockImplementationOnce(async (task, step) => {
      const run = await generate(task, step);
      denied = 'ingestion_paused';
      return run;
    });
    const automation = ExecutionAuthority.automation(W, 'new-materials-policy');
    const task = await f.service.start(automation, 'automatic', {
      kind: 'document',
      snapshotId: S,
    });
    expect((await f.done(task.taskId)).state).toMatchObject({
      status: 'paused',
      errorCode: 'ingestion_paused',
      calls: 1,
    });
    expect(f.writes).toBe(0);
    await vi.waitFor(async () => {
      expect(
        (await f.service.read(automation, task.taskId)).runtimeStatus,
      ).toBe('idle');
    });
    denied = undefined;
    const current = await f.service.read(automation, task.taskId);
    await f.service.control(automation, task.taskId, current.version, 'resume');
    await vi.waitFor(() => {
      expect(f.rows.get(task.taskId)?.state.status).toBe('succeeded');
    });
    expect(f.actions.generate).toHaveBeenCalledTimes(2);
    expect(f.writes).toBe(2);
  });

  it('completes split and tags once, persists authority and reuses idempotent starts', async () => {
    const f = fixture();
    const task = await f.service.start(owner, 'one', {
      kind: 'document',
      snapshotId: S,
    });
    const result = await f.done(task.taskId);
    expect(result.state).toMatchObject({
      status: 'succeeded',
      calls: 2,
      phase: 'complete',
    });
    expect(result).toMatchObject({
      actorKind: 'owner',
      policyVersion: 'struinfo.agent-task.v1',
      model: 'synthetic-model',
    });
    expect(f.writes).toBe(2);
    await f.service.start(owner, 'one', {kind: 'document', snapshotId: S});
    expect(f.writes).toBe(2);
    await expect(
      f.service.start(owner, 'one', {
        kind: 'document',
        snapshotId: S,
        maxEntries: 2,
      }),
    ).rejects.toMatchObject({code: 'idempotency_conflict'});
  });
  it('does not give read delegates write or model authority', async () => {
    const f = fixture();
    const reader = ExecutionAuthority.delegate(
      W,
      {kind: 'external_agent', id: 'reader'},
      {operations: DELEGATED_READ_OPERATIONS},
    );
    await expect(
      f.service.start(reader, 'one', {kind: 'document', snapshotId: S}),
    ).rejects.toMatchObject({code: 'operation_not_authorized'});
    expect(f.actions.preflight).not.toHaveBeenCalled();
    const editor = ExecutionAuthority.agent(W, 'editor', [
      ...DELEGATED_READ_OPERATIONS,
      'tasks.control',
      'agent.tags',
    ]);
    await expect(
      f.service.start(editor, 'one', {kind: 'document', snapshotId: S}),
    ).rejects.toMatchObject({code: 'operation_not_authorized'});
  });
  it('rejects invalid/private/unconfigured inputs before creating durable work', async () => {
    const f = fixture();
    await expect(
      f.service.start(owner, 'one', {
        kind: 'document',
        snapshotId: S,
        includePrivate: true,
      }),
    ).rejects.toMatchObject({code: 'invalid_task_request'});
    f.actions.preflight.mockRejectedValue(
      new OperationError('forbidden', 'private_model_transfer_forbidden'),
    );
    await expect(
      f.service.start(owner, 'one', {kind: 'document', snapshotId: S}),
    ).rejects.toMatchObject({code: 'private_model_transfer_forbidden'});
    expect(f.rows.size).toBe(0);
  });
  it('reserves calls before generation and stops at the budget', async () => {
    const f = fixture();
    const task = await f.service.start(owner, 'limited', {
      kind: 'document',
      snapshotId: S,
      maxModelCalls: 1,
    });
    const failed = await f.done(task.taskId);
    expect(failed.state).toMatchObject({
      status: 'failed',
      calls: 1,
      errorCode: 'model_call_budget_exhausted',
    });
    expect(f.actions.generate).toHaveBeenCalledTimes(1);
    expect(f.writes).toBe(1);
  });
  it('pauses before acceptance and resumes the saved proposal without a second call', async () => {
    const f = fixture();
    let release!: () => void;
    const wait = new Promise<void>((resolve) => {
      release = resolve;
    });
    const generate = requireOperationValue(
      f.actions.generate.getMockImplementation(),
    );
    f.actions.generate.mockImplementation(async (task, step) => {
      await wait;
      return generate(task, step);
    });
    const task = await f.service.start(owner, 'pause', {
      kind: 'document',
      snapshotId: S,
    });
    await vi.waitFor(() => {
      expect(f.actions.generate).toHaveBeenCalledTimes(1);
    });
    const running = await f.service.read(owner, task.taskId);
    await f.service.control(owner, task.taskId, running.version, 'pause');
    release();
    const paused = await f.done(task.taskId);
    expect(paused.state.status).toBe('paused');
    expect(f.writes).toBe(0);
    await f.service.control(owner, task.taskId, paused.version, 'resume');
    await vi.waitFor(() => {
      expect(f.rows.get(task.taskId)?.state.status).toBe('succeeded');
    });
    expect(f.actions.generate).toHaveBeenCalledTimes(2);
    expect(f.writes).toBe(2);
  });
  it('cancels at a boundary and preserves completed writes', async () => {
    const f = fixture();
    let release!: () => void;
    const wait = new Promise<void>((r) => {
      release = r;
    });
    const generate = requireOperationValue(
      f.actions.generate.getMockImplementation(),
    );
    f.actions.generate.mockImplementation(async (task, step) => {
      await wait;
      return generate(task, step);
    });
    const task = await f.service.start(owner, 'cancel', {
      kind: 'document',
      snapshotId: S,
    });
    await vi.waitFor(() => {
      expect(f.actions.generate).toHaveBeenCalledTimes(1);
    });
    const running = await f.service.read(owner, task.taskId);
    await f.service.control(owner, task.taskId, running.version, 'cancel');
    release();
    const result = await f.done(task.taskId);
    expect(result.state.status).toBe('cancelled');
    expect(f.writes).toBe(0);
  });
  it('resumes interrupted acceptance with the same proposal and rejects stale control versions', async () => {
    const f = fixture();
    f.actions.accept.mockRejectedValueOnce(
      new OperationError('conflict', 'stale_entry_revision'),
    );
    const task = await f.service.start(owner, 'recover', {
      kind: 'document',
      snapshotId: S,
    });
    const failed = await f.done(task.taskId);
    await expect(
      f.service.control(owner, task.taskId, 1, 'resume'),
    ).rejects.toMatchObject({code: 'stale_task_version'});
    await f.service.control(owner, task.taskId, failed.version, 'resume');
    await vi.waitFor(() => {
      expect(f.rows.get(task.taskId)?.state.status).toBe('succeeded');
    });
    expect(f.actions.generate).toHaveBeenCalledTimes(2);
    expect(f.actions.accept.mock.calls[0]?.[2]).toEqual(
      f.actions.accept.mock.calls[1]?.[2],
    );
  });
  it('limits tasks to their owning Agent and fixes workspace identity', async () => {
    const f = fixture();
    const a = ExecutionAuthority.agent(W, 'a', [
      ...DELEGATED_READ_OPERATIONS,
      'tasks.control',
      'models.use',
    ]);
    const b = ExecutionAuthority.agent(W, 'b', [
      ...DELEGATED_READ_OPERATIONS,
      'tasks.control',
      'models.use',
    ]);
    const task = await f.service.start(a, 'one', {
      kind: 'document',
      snapshotId: S,
    });
    await f.done(task.taskId);
    expect(await f.service.list(b)).toEqual([]);
    await expect(f.service.read(b, task.taskId)).rejects.toMatchObject({
      code: 'task_not_found',
    });
    await expect(
      f.service.list(ExecutionAuthority.owner(S)),
    ).rejects.toMatchObject({code: 'workspace_mismatch'});
  });
});
