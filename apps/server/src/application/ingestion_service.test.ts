import {describe, it, expect, vi} from 'vitest';
import {IngestionService} from './ingestion_service.js';
import {
  EMPTY_INGESTION_POLICY,
  ingestionSettingsSchema,
  INGESTION_ACTOR_ID,
  ingestionTaskKey,
  type IngestionItem,
  type IngestionPolicy,
  type IngestionRepository,
  type IngestionTaskPort,
} from './ingestion_contract.js';
import {ExecutionAuthority} from './execution_authority.js';
import type {AgentTask} from './agent_task_contract.js';
import {requireOperationValue, OperationError} from './operation_error.js';
const W = '00000000-0000-4000-8000-000000000001',
  S = '00000000-0000-4000-8000-000000000002',
  SUB = '00000000-0000-4000-8000-000000000003',
  OTHER = '00000000-0000-4000-8000-000000000004';
const owner = ExecutionAuthority.owner(W);
function fixture() {
  let policy: IngestionPolicy = structuredClone(EMPTY_INGESTION_POLICY);
  const items = new Map<string, IngestionItem>(),
    tasks = new Map<string, AgentTask>();
  const repository: IngestionRepository = {
    policy: () => Promise.resolve(structuredClone(policy)),
    savePolicy: (revision, settings, authorizedBy) => {
      if (revision !== policy.revision) return Promise.resolve(false);
      policy = {revision: revision + 1, settings, authorizedBy};
      return Promise.resolve(true);
    },
    read: (id) =>
      Promise.resolve(
        items.has(id) ? structuredClone(items.get(id)) : undefined,
      ),
    list: (active, limit) =>
      Promise.resolve(
        [...items.values()]
          .filter((i) => !active || ['pending', 'running'].includes(i.status))
          .slice(0, limit)
          .map((i) => structuredClone(i)),
      ),
    update: (id, version, status, taskId, errorCode) => {
      const old = requireOperationValue(items.get(id));
      if (old.version !== version) return Promise.resolve(false);
      const next = {
        ...old,
        status,
        version: version + 1,
        ...(taskId ? {taskId} : {}),
      };
      delete next.errorCode;
      if (errorCode) next.errorCode = errorCode;
      items.set(id, next);
      return Promise.resolve(true);
    },
    reserve: (id, max) => {
      const item = requireOperationValue(items.get(id));
      if (item.admittedAt) return Promise.resolve(true);
      if ([...items.values()].filter((i) => i.admittedAt).length >= max)
        return Promise.resolve(false);
      items.set(id, {
        ...item,
        admittedAt: '2040-01-01T00:00:00Z',
        version: item.version + 1,
      });
      return Promise.resolve(true);
    },
    withPollLock: (action) => action(),
  };
  const taskPort: IngestionTaskPort = {
    start: vi.fn((id: string, p: IngestionPolicy) => {
      if (!tasks.has(id))
        tasks.set(id, {
          workspaceId: W,
          taskId: id,
          actorKind: 'automation',
          actorId: INGESTION_ACTOR_ID,
          policyVersion: 'struinfo.agent-task.v1',
          requestKey: ingestionTaskKey(id),
          model: p.settings.model,
          request: {
            kind: 'document',
            maxRelations: 0,
            snapshotId: id,
            maxEntries: p.settings.maxEntries,
            maxModelCalls: p.settings.maxModelCalls,
          },
          state: {status: 'queued', calls: 0, phase: 'split', steps: []},
          pauseRequested: false,
          cancelRequested: false,
          version: 1,
          createdAt: '2040-01-01',
          updatedAt: '2040-01-01',
        });
      return Promise.resolve(
        structuredClone(requireOperationValue(tasks.get(id))),
      );
    }),
    read: (id) =>
      Promise.resolve({
        ...structuredClone(requireOperationValue(tasks.get(id))),
        runtimeStatus: 'idle',
      }),
    resume: vi.fn((t: AgentTask) => {
      tasks.set(t.taskId, {...t, state: {...t.state, status: 'running'}});
      return Promise.resolve();
    }),
    cancel: vi.fn((t: AgentTask) => {
      tasks.set(t.taskId, {...t, state: {...t.state, status: 'cancelled'}});
      return Promise.resolve();
    }),
  };
  const service = new IngestionService(
    W,
    repository,
    taskPort,
    () => 'synthetic-model',
    () =>
      Promise.resolve([
        {subscriptionId: SUB, isPrivate: false},
        {subscriptionId: OTHER, isPrivate: true},
      ]),
  );
  const enable = () =>
    service.savePolicy(owner, policy.revision, {
      ...ingestionSettingsSchema.parse({}),
      enabled: true,
      manualUploads: true,
      subscriptionIds: [SUB],
      model: 'synthetic-model',
      maxDocumentsPerDay: 1,
    });
  const add = (id = S) =>
    items.set(id, {
      snapshotId: id,
      origin: {kind: 'upload'},
      policy: structuredClone(policy),
      status: 'pending',
      version: 1,
      createdAt: '2040-01-01',
    });
  return {
    service,
    repository,
    taskPort,
    tasks,
    items,
    enable,
    add,
    get policy() {
      return policy;
    },
  };
}
describe('new-material ingestion policy and queue', () => {
  it('allows queue takeover even when task cancellation races with progress', async () => {
    const f = fixture();
    await f.enable();
    f.add();
    await f.service.poll();
    vi.mocked(f.taskPort.cancel).mockRejectedValueOnce(
      new OperationError('conflict', 'stale_task_version'),
    );
    const item = await f.service.control(
      owner,
      S,
      requireOperationValue(f.items.get(S)).version,
      'take_over',
    );
    expect(item?.status).toBe('taken_over');
    expect(await f.service.guard(requireOperationValue(f.tasks.get(S)))).toBe(
      'ingestion_item_stopped',
    );
  });
  it('keeps queue controls versioned and exposes a cursor and frozen authority for long queues', async () => {
    const f = fixture();
    await f.enable();
    f.add();
    f.add(OTHER);
    await expect(
      f.service.control(owner, S, 99, 'pause'),
    ).rejects.toMatchObject({code: 'stale_ingestion_item'});
    const status = await f.service.status(owner, {limit: 1});
    expect(status.items).toHaveLength(1);
    expect(status.nextCursor?.snapshotId).toBe(S);
    expect(status.items[0]?.policy.authorizedBy).toEqual(owner.identity);
  });

  it('defaults off and separates the automate grant from ordinary Agent processing', async () => {
    const f = fixture();
    expect((await f.service.status(owner)).policy.settings.enabled).toBe(false);
    const agent = ExecutionAuthority.agent(W, 'synthetic', [
      'processing.read',
      'models.use',
      'tasks.control',
    ]);
    await expect(f.service.savePolicy(agent, 0, {})).rejects.toMatchObject({
      code: 'operation_not_authorized',
    });
    await f.service.savePolicy(
      ExecutionAuthority.agent(W, 'operator', ['ingestion.manage']),
      0,
      {},
    );
    await expect(f.service.savePolicy(owner, 0, {})).rejects.toMatchObject({
      code: 'stale_ingestion_policy',
    });
  });
  it('requires a configured model and explicit public scope before enabling', async () => {
    const f = fixture();
    await expect(
      f.service.savePolicy(owner, 0, {
        enabled: true,
        model: 'different',
        manualUploads: true,
      }),
    ).rejects.toMatchObject({code: 'ingestion_model_not_configured'});
    await expect(
      f.service.savePolicy(owner, 0, {
        enabled: true,
        model: 'synthetic-model',
        subscriptionIds: [OTHER],
      }),
    ).rejects.toMatchObject({code: 'ingestion_public_subscription_required'});
    await expect(
      f.service.savePolicy(owner, 0, {enabled: true, model: 'synthetic-model'}),
    ).rejects.toMatchObject({code: 'ingestion_scope_required'});
    await expect(
      f.service.savePolicy(owner, 0, {
        enabled: true,
        model: 'synthetic-model',
        manualUploads: true,
        includePrivate: true,
      }),
    ).rejects.toMatchObject({code: 'invalid_ingestion_policy'});
  });
  it('allows pausing when model or source configuration is unavailable and validates again on resume', async () => {
    const f = fixture();
    await f.enable();
    await expect(
      f.service.savePolicy(owner, f.policy.revision, {
        ...f.policy.settings,
        paused: true,
        model: 'unavailable-model',
      }),
    ).resolves.toMatchObject({settings: {paused: true}});
    await expect(
      f.service.savePolicy(owner, f.policy.revision, {
        ...f.policy.settings,
        paused: false,
      }),
    ).rejects.toMatchObject({code: 'ingestion_model_not_configured'});
    expect(f.policy.settings.paused).toBe(true);
  });
  it('admits each document once, observes completion and leaves excess documents safely pending', async () => {
    const f = fixture();
    await f.enable();
    f.add();
    f.add(OTHER);
    await f.service.poll();
    await f.service.poll();
    expect(f.taskPort.start).toHaveBeenCalledTimes(1);
    expect(f.items.get(OTHER)).toMatchObject({
      status: 'pending',
      errorCode: 'daily_document_budget_reached',
    });
    const task = requireOperationValue(f.tasks.get(S));
    f.tasks.set(S, {...task, state: {...task.state, status: 'succeeded'}});
    await f.service.poll();
    expect(f.items.get(S)?.status).toBe('completed');
  });
  it('keeps failed tasks for explicit retry without spending a second document allowance', async () => {
    const f = fixture();
    await f.enable();
    f.add();
    await f.service.poll();
    const task = requireOperationValue(f.tasks.get(S));
    f.tasks.set(S, {
      ...task,
      state: {
        ...task.state,
        status: 'failed',
        errorCode: 'provider_unavailable',
      },
    });
    await f.service.poll();
    expect(f.items.get(S)).toMatchObject({
      status: 'attention',
      errorCode: 'provider_unavailable',
    });
    vi.mocked(f.taskPort.resume).mockClear();
    await f.service.poll();
    expect(f.taskPort.resume).not.toHaveBeenCalled();
    await f.service.control(
      owner,
      S,
      requireOperationValue(f.items.get(S)).version,
      'retry',
    );
    await f.service.poll();
    expect(f.taskPort.resume).toHaveBeenCalledTimes(1);
    expect(f.taskPort.start).toHaveBeenCalledTimes(1);
  });
  it('recovers an uncertain task start with the same durable request key', async () => {
    const f = fixture();
    await f.enable();
    f.add();
    let uncertain = true;
    f.taskPort.start = (id, p) => {
      const existing = f.tasks.get(id);
      if (existing) return Promise.resolve(structuredClone(existing));
      const task: AgentTask = {
        workspaceId: W,
        taskId: id,
        actorKind: 'automation',
        actorId: INGESTION_ACTOR_ID,
        policyVersion: 'struinfo.agent-task.v1',
        requestKey: ingestionTaskKey(id),
        model: p.settings.model,
        request: {
          kind: 'document',
          maxRelations: 0,
          snapshotId: id,
          maxEntries: 12,
          maxModelCalls: 24,
        },
        state: {status: 'queued', phase: 'split', calls: 0, steps: []},
        version: 1,
        pauseRequested: false,
        cancelRequested: false,
        createdAt: '2040-01-01',
        updatedAt: '2040-01-01',
      };
      f.tasks.set(id, task);
      if (uncertain) {
        uncertain = false;
        throw new OperationError('rejected', 'synthetic_interruption');
      }
      return Promise.resolve(task);
    };
    await f.service.poll();
    expect(f.items.get(S)?.status).toBe('attention');
    expect(f.tasks.size).toBe(1);
    const paused = requireOperationValue(f.tasks.get(S));
    f.tasks.set(S, {
      ...paused,
      state: {
        ...paused.state,
        status: 'paused',
        errorCode: 'ingestion_item_stopped',
      },
    });
    await f.service.control(
      owner,
      S,
      requireOperationValue(f.items.get(S)).version,
      'retry',
    );
    await f.service.poll();
    expect(f.tasks.size).toBe(1);
    expect(f.items.get(S)).toMatchObject({status: 'running', taskId: S});
    await f.service.poll();
    expect(f.taskPort.resume).toHaveBeenCalledOnce();
  });
  it('moves scope-removed items out of the active queue so newer permitted documents can run', async () => {
    const f = fixture();
    await f.enable();
    for (let i = 0; i < 25; i++)
      f.add('00000000-0000-4000-8000-' + String(100 + i).padStart(12, '0'));
    f.add(S);
    const accepted = requireOperationValue(f.items.get(S));
    f.items.set(S, {
      ...accepted,
      origin: {kind: 'subscription', subscriptionId: SUB},
    });
    await f.service.savePolicy(owner, f.policy.revision, {
      ...f.policy.settings,
      manualUploads: false,
    });
    await f.service.poll();
    expect(f.taskPort.start).not.toHaveBeenCalled();
    expect(
      [...f.items.values()].filter((i) => i.status === 'attention'),
    ).toHaveLength(25);
    await f.service.poll();
    expect(f.taskPort.start).toHaveBeenCalledOnce();
    expect(f.items.get(S)?.status).toBe('running');
  });
  it('requires explicit retry after a task stops for a narrowed policy, but resumes a global pause', async () => {
    const f = fixture();
    await f.enable();
    f.add();
    await f.service.poll();
    const task = requireOperationValue(f.tasks.get(S));
    f.tasks.set(S, {
      ...task,
      state: {...task.state, status: 'paused', errorCode: 'ingestion_paused'},
    });
    await f.service.savePolicy(owner, f.policy.revision, {
      ...f.policy.settings,
      paused: true,
    });
    await f.service.poll();
    expect(f.items.get(S)?.status).toBe('running');
    expect(f.taskPort.resume).not.toHaveBeenCalled();
    await f.service.savePolicy(owner, f.policy.revision, {
      ...f.policy.settings,
      paused: false,
    });
    await f.service.poll();
    expect(f.taskPort.resume).toHaveBeenCalledOnce();
    vi.mocked(f.taskPort.resume).mockClear();
    f.tasks.set(S, {
      ...task,
      state: {
        ...task.state,
        status: 'paused',
        errorCode: 'ingestion_budget_changed',
      },
    });
    await f.service.savePolicy(owner, f.policy.revision, {
      ...f.policy.settings,
      maxModelCalls: 1,
    });
    await f.service.poll();
    expect(f.items.get(S)).toMatchObject({
      status: 'attention',
      errorCode: 'ingestion_budget_changed',
    });
    await f.service.savePolicy(owner, f.policy.revision, {
      ...f.policy.settings,
      maxModelCalls: 24,
    });
    await f.service.poll();
    expect(f.taskPort.resume).not.toHaveBeenCalled();
    await f.service.control(
      owner,
      S,
      requireOperationValue(f.items.get(S)).version,
      'retry',
    );
    await f.service.poll();
    expect(f.taskPort.resume).toHaveBeenCalledOnce();
  });
  it('does not override an explicit task pause when the global policy resumes', async () => {
    const f = fixture();
    await f.enable();
    f.add();
    await f.service.poll();
    const task = requireOperationValue(f.tasks.get(S));
    f.tasks.set(S, {
      ...task,
      pauseRequested: true,
      state: {...task.state, status: 'paused', errorCode: 'ingestion_paused'},
    });
    await f.service.poll();
    expect(f.taskPort.resume).not.toHaveBeenCalled();
    expect(f.items.get(S)?.status).toBe('attention');
    await f.service.control(
      owner,
      S,
      requireOperationValue(f.items.get(S)).version,
      'retry',
    );
    await f.service.poll();
    expect(f.taskPort.resume).toHaveBeenCalledOnce();
  });
  it('checks current scope, model and budgets and gives manual takeover priority', async () => {
    const f = fixture();
    await f.enable();
    f.add();
    await f.service.poll();
    const task = requireOperationValue(f.tasks.get(S));
    expect(await f.service.guard(task)).toBeUndefined();
    await f.service.savePolicy(owner, f.policy.revision, {
      ...f.policy.settings,
      paused: true,
    });
    expect(await f.service.guard(task)).toBe('ingestion_paused');
    await f.service.savePolicy(owner, f.policy.revision, {
      ...f.policy.settings,
      paused: false,
      manualUploads: false,
    });
    expect(await f.service.guard(task)).toBe('ingestion_scope_removed');
    await f.service.savePolicy(owner, f.policy.revision, {
      ...f.policy.settings,
      manualUploads: true,
      maxModelCalls: 1,
    });
    expect(await f.service.guard(task)).toBe('ingestion_budget_changed');
    await f.service.control(
      owner,
      S,
      requireOperationValue(f.items.get(S)).version,
      'take_over',
    );
    expect(await f.service.guard(task)).toBe('ingestion_item_stopped');
    expect(f.taskPort.cancel).toHaveBeenCalledTimes(1);
    await expect(f.service.control(owner, S, 1, 'retry')).rejects.toMatchObject(
      {code: 'ingestion_item_terminal'},
    );
  });
});
