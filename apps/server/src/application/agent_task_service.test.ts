import {
  AiPriceWindowClosedError,
  AI_PRICE_WAIT,
} from '../modules/processing/ai_price_policy.js';
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
function fixture(
  guard?: (task: AgentTask) => Promise<string | undefined>,
  priceGate?: ConstructorParameters<typeof AgentTaskService>[4],
) {
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
    guard: vi.fn(() => Promise.resolve(undefined as string | undefined)),
    prepareIntake: vi.fn(() => Promise.resolve(true)),
    reviewIntake: vi.fn(() => Promise.resolve()),
    intakeTarget: vi.fn(() => Promise.resolve(S)),
    recallSteps: vi.fn(() => Promise.resolve([] as AgentTaskStep[])),
    recall: vi.fn(() =>
      Promise.resolve({
        concepts: [{term: 'Synthetic', variants: ['合成概念']}],
      }),
    ),
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
    priceGate,
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
  it('waits before claiming calls, resumes after restart, and rechecks between stages', async () => {
    let blocked = true;
    const priceGate = {
      check: async () => {
        await Promise.resolve();
        if (blocked) throw new AiPriceWindowClosedError();
      },
      canResume: () => true,
    };
    const f = fixture(undefined, priceGate);
    const task = await f.service.start(owner, 'price', {
      kind: 'document',
      snapshotId: S,
    });
    await f.done(task.taskId);
    expect(f.rows.get(task.taskId)?.state).toMatchObject({
      status: 'paused',
      calls: 0,
      errorCode: AI_PRICE_WAIT,
    });
    expect(f.actions.generate).not.toHaveBeenCalled();
    await f.service.pollPriceDeferred();
    expect(f.actions.generate).not.toHaveBeenCalled();
    await f.service.drain();
    const resumed = new AgentTaskService(
      W,
      f.repository,
      f.actions as unknown as AgentTaskActions,
      undefined,
      priceGate,
    );
    blocked = false;
    f.actions.accept.mockImplementationOnce(async () => {
      await Promise.resolve();
      blocked = true;
    });
    await resumed.pollPriceDeferred();
    await vi.waitFor(() => {
      expect(f.rows.get(task.taskId)?.state).toMatchObject({
        status: 'paused',
        calls: 1,
        errorCode: AI_PRICE_WAIT,
      });
    });
    expect(f.actions.generate).toHaveBeenCalledTimes(1);
    await vi.waitFor(async () => {
      expect((await resumed.read(owner, task.taskId)).runtimeStatus).toBe(
        'idle',
      );
    });
    blocked = false;
    await resumed.pollPriceDeferred();
    await vi.waitFor(() => {
      expect(f.rows.get(task.taskId)?.state).toMatchObject({
        status: 'succeeded',
        calls: 2,
      });
    });
  });
  it('refunds a final-dispatch deferral and does not reuse its failed proposal run', async () => {
    const f = fixture(undefined, {
      check: () => Promise.resolve(),
      canResume: () => true,
    });
    f.actions.generate.mockImplementationOnce(async (_task, step) => {
      await Promise.resolve();
      const run = {
        runId: step.runId,
        status: 'failed',
        proposals: [],
        errorCode: AI_PRICE_WAIT,
      } as unknown as ProcessingRun;
      f.runs.set(requireOperationValue(step.runId), run);
      return run;
    });
    const task = await f.service.start(owner, 'dispatch-price', {
      kind: 'document',
      snapshotId: S,
      maxModelCalls: 2,
    });
    await f.done(task.taskId);
    expect(f.rows.get(task.taskId)?.state).toMatchObject({
      calls: 0,
      steps: [{attempt: 0, complete: false}],
    });
    const abortedId = f.actions.generate.mock.calls[0]?.[1].runId;
    await vi.waitFor(async () => {
      expect((await f.service.read(owner, task.taskId)).runtimeStatus).toBe(
        'idle',
      );
    });
    await f.service.pollPriceDeferred();
    await vi.waitFor(() => {
      expect(f.rows.get(task.taskId)?.state).toMatchObject({
        status: 'succeeded',
        calls: 2,
      });
    });
    expect(f.actions.generate.mock.calls[1]?.[1].runId).not.toBe(abortedId);
  });
  it.each(['pause', 'cancel'] as const)(
    'does not resume an explicitly %sd price wait',
    async (action) => {
      let blocked = true;
      const f = fixture(undefined, {
        check: async () => {
          await Promise.resolve();
          if (blocked) throw new AiPriceWindowClosedError();
        },
        canResume: () => true,
      });
      const task = await f.service.start(owner, 'stop-price-' + action, {
        kind: 'document',
        snapshotId: S,
      });
      await f.done(task.taskId);
      const current = await f.service.read(owner, task.taskId);
      await f.service.control(owner, task.taskId, current.version, action);
      blocked = false;
      await f.service.pollPriceDeferred();
      expect(f.actions.generate).not.toHaveBeenCalled();
    },
  );
  it('honors revoked resume authority and does not gate external supplied results', async () => {
    const check = vi.fn<() => Promise<void>>(async () => {
      await Promise.resolve();
      throw new AiPriceWindowClosedError();
    });
    const f = fixture(undefined, {check, canResume: () => false});
    const task = await f.service.start(owner, 'revoked-price', {
      kind: 'document',
      snapshotId: S,
    });
    await f.done(task.taskId);
    check.mockResolvedValue(undefined);
    await f.service.pollPriceDeferred();
    expect(f.actions.generate).not.toHaveBeenCalled();
    check.mockRejectedValue(new AiPriceWindowClosedError());
    const external = await f.service.start(owner, 'external-price', {
      kind: 'split',
      snapshotId: S,
      result: {
        summary: 'Synthetic',
        groups: [{titlePath: 'Synthetic', startOrdinal: 0, endOrdinal: 0}],
      },
    });
    expect((await f.done(external.taskId)).state.status).toBe('succeeded');
  });
  it('recovers a completed no-relation evaluation without another call or graph write', async () => {
    const f = fixture();
    const generate = requireOperationValue(
      f.actions.generate.getMockImplementation(),
    );
    f.actions.relationSteps.mockResolvedValue([
      {
        kind: 'relation',
        targetId: E,
        relatedEntryId: S,
        attempt: 0,
        complete: false,
      },
    ]);
    f.actions.generate.mockImplementation(async (task, step) => {
      if (step.kind !== 'relation') return generate(task, step);
      const run = {
        runId: step.runId,
        status: 'succeeded',
        currentStage: 'associations',
        currentStep: '未发现有意义的联系',
        completedUnits: 1,
        totalUnits: 1,
        proposals: [],
      } as unknown as ProcessingRun;
      f.runs.set(requireOperationValue(step.runId), run);
      const current = requireOperationValue(f.rows.get(task.taskId));
      f.rows.set(task.taskId, {...current, pauseRequested: true});
      return run;
    });
    const task = await f.service.start(owner, 'no-relation-recovery', {
      kind: 'document',
      snapshotId: S,
      maxModelCalls: 3,
    });
    expect((await f.done(task.taskId)).state).toMatchObject({
      status: 'paused',
      calls: 3,
    });
    await vi.waitFor(async () => {
      expect((await f.service.read(owner, task.taskId)).runtimeStatus).toBe(
        'idle',
      );
    });
    const current = await f.service.read(owner, task.taskId);
    await f.service.control(owner, task.taskId, current.version, 'resume');
    await vi.waitFor(() => {
      expect(f.rows.get(task.taskId)?.state.status).toBe('succeeded');
    });
    expect(f.rows.get(task.taskId)?.state.steps.at(-1)).toMatchObject({
      complete: true,
      outcome: 'no_relation',
    });
    expect(f.actions.generate).toHaveBeenCalledTimes(3);
    expect(f.writes).toBe(2);
  });

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

describe('intake and multilingual task stages', () => {
  it('holds before splitting and re-reviews after an explicit reset', async () => {
    const f = fixture();
    let held = false;
    f.actions.reviewIntake.mockImplementationOnce(() => {
      held = true;
      return Promise.resolve();
    });
    f.actions.intakeTarget.mockImplementation(() => {
      if (held)
        return Promise.reject(new OperationError('rejected', 'intake_held'));
      return Promise.resolve(S);
    });
    const task = await f.service.start(owner, 'intake-hold', {
      kind: 'document',
      snapshotId: S,
      intake: {fetchFullText: false},
      maxRelations: 0,
      maxModelCalls: 4,
    });
    expect((await f.done(task.taskId)).state).toMatchObject({
      status: 'paused',
      phase: 'intake',
      calls: 1,
      errorCode: 'intake_held',
    });
    expect(f.writes).toBe(0);
    expect(f.actions.generate).not.toHaveBeenCalled();
    await vi.waitFor(async () => {
      expect((await f.service.read(owner, task.taskId)).runtimeStatus).toBe(
        'idle',
      );
    });
    held = false;
    const current = await f.service.read(owner, task.taskId);
    await f.service.control(owner, task.taskId, current.version, 'resume');
    await vi.waitFor(() => {
      expect(f.rows.get(task.taskId)?.state.status).toBe('succeeded');
    });
    expect(f.actions.reviewIntake).toHaveBeenCalledTimes(2);
    expect(f.rows.get(task.taskId)?.state.calls).toBe(4);
    expect(f.writes).toBe(2);
  });
  it('checks more candidates than the accepted edge cap and persists recall reasons', async () => {
    const f = fixture();
    f.actions.recallSteps.mockResolvedValue([
      {
        kind: 'recall',
        targetId: E,
        expectedRevision: 2,
        attempt: 0,
        complete: false,
      },
    ]);
    f.actions.relationSteps.mockResolvedValue(
      [S, P, W].map((relatedEntryId) => ({
        kind: 'relation',
        targetId: E,
        relatedEntryId,
        attempt: 0,
        complete: false,
        candidateReasons: ['Synthetic → 合成概念（正文）'],
      })),
    );
    const generate = requireOperationValue(
      f.actions.generate.getMockImplementation(),
    );
    f.actions.generate.mockImplementation(async (task, step) => {
      if (step.kind !== 'relation' || step.relatedEntryId !== S)
        return generate(task, step);
      const run = {
        runId: step.runId,
        status: 'succeeded',
        currentStage: 'associations',
        currentStep: '未发现有意义的联系',
        completedUnits: 1,
        totalUnits: 1,
        proposals: [],
      } as unknown as ProcessingRun;
      f.runs.set(requireOperationValue(step.runId), run);
      return run;
    });
    const task = await f.service.start(owner, 'recall-budget', {
      kind: 'document',
      snapshotId: S,
      maxRelations: 1,
      maxRelationCandidates: 3,
      maxModelCalls: 5,
    });
    const result = await f.done(task.taskId);
    expect(result.state.status).toBe('succeeded');
    expect(result.state.calls).toBe(5);
    expect(
      result.state.steps
        .filter((s) => s.kind === 'relation')
        .map((s) => s.outcome),
    ).toEqual(['no_relation', undefined, 'edge_budget_reached']);
    expect(
      result.state.steps.find((s) => s.kind === 'recall')?.recallPlan
        ?.concepts[0]?.variants,
    ).toContain('合成概念');
    expect(f.writes).toBe(3);
  });
  it('does not grant capture access through an existing process grant', async () => {
    const f = fixture();
    const authority = ExecutionAuthority.agent(W, 'synthetic-agent', [
      'tasks.control',
      'models.use',
    ]);
    await expect(
      f.service.start(authority, 'no-capture', {
        kind: 'document',
        snapshotId: S,
        intake: {fetchFullText: true},
      }),
    ).rejects.toMatchObject({code: 'operation_not_authorized'});
    expect(f.actions.preflight).not.toHaveBeenCalled();
  });
});
