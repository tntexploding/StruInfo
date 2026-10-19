import {
  AiPriceWindowClosedError,
  AiOperationsPausedError,
  AI_PRICE_WAIT,
  AI_BUDGET_WAIT,
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
    reviewRunId: (_step: AgentTaskStep, proposalId: string, key: string) =>
      `review:${proposalId}:${key}`,
    loadRelationReview: vi.fn((step: AgentTaskStep) =>
      Promise.resolve(
        step.reviewRunId ? runs.get(step.reviewRunId) : undefined,
      ),
    ),
    reviewRelation: vi.fn((_task: AgentTask, step: AgentTaskStep) => {
      const run = {
        runId: requireOperationValue(step.reviewRunId),
        status: 'succeeded',
        proposals: [{proposalId: S, status: 'pending_review'}],
      } as unknown as ProcessingRun;
      runs.set(run.runId, run);
      return Promise.resolve(run);
    }),
    model: 'synthetic-model',
    intakeModel: 'synthetic-model',
    reviewCheckpointCurrent: vi.fn(() => Promise.resolve(true)),
    requiresReceiptAcceptance: vi.fn(() => Promise.resolve(false)),
    receiptVersion: vi.fn(() => Promise.resolve(2)),
    acceptReceipt: vi.fn(() =>
      Promise.resolve('accepted' as 'accepted' | 'held'),
    ),
    guard: vi.fn(() => Promise.resolve(undefined as string | undefined)),
    prepareIntake: vi.fn(() => Promise.resolve(true)),
    reviewIntake: vi.fn(() => Promise.resolve(2)),
    intakeTarget: vi.fn(() => Promise.resolve(S)),
    finishDocumentIntake: vi.fn(async (): Promise<void> => {
      await actions.intakeTarget();
    }),
    validateRecovery: vi.fn(() => Promise.resolve()),
    validateCompletion: vi.fn(() => Promise.resolve()),
    publish: vi.fn(() => Promise.resolve()),
    recallSteps: vi.fn(() => Promise.resolve([] as AgentTaskStep[])),
    recallGroup: vi.fn(
      (_task: AgentTask, step: AgentTaskStep): Promise<AgentTaskStep[]> =>
        Promise.resolve([step]),
    ),
    recallGroupPlans: vi.fn((steps: readonly AgentTaskStep[]) =>
      Promise.all(steps.map(() => actions.recall())),
    ),
    tagGroup: vi.fn((_task: AgentTask, step: AgentTaskStep) =>
      Promise.resolve([step]),
    ),
    generateTagGroup: vi.fn(),
    tagCallEstimate: vi.fn((proposal: ProcessingProposal) =>
      Promise.resolve(proposal.splitPayload?.entries.length ?? 0),
    ),
    recallCallEstimate: vi.fn((proposal: ProcessingProposal) =>
      Promise.resolve(proposal.splitPayload?.entries.length ?? 0),
    ),
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
  it('does not opt new documents into experimental relation verification', async () => {
    const f = fixture();
    f.actions.relationSteps.mockResolvedValue([
      {
        kind: 'relation',
        targetId: E,
        relatedEntryId: P,
        expectedRevision: 2,
        expectedRelatedRevision: 1,
        expectedOverrideRevision: 0,
        attempt: 0,
        complete: false,
      },
    ]);
    const task = await f.service.start(owner, 'ordinary-document', {
      kind: 'document',
      snapshotId: S,
      maxEntries: 4,
      maxRelations: 1,
      maxModelCalls: 3,
    });
    const result = await f.done(task.taskId);
    expect(result.state).toMatchObject({status: 'succeeded', calls: 3});
    expect(result.state.relationReviewRequired).toBeUndefined();
    expect(f.actions.reviewRelation).not.toHaveBeenCalled();
    expect(f.actions.publish).toHaveBeenCalledOnce();
  });
  it.each(['positive', 'negative', 'uncertain', 'budget', 'pause'] as const)(
    'preserves stored independent relation review checkpoints: %s',
    async (mode) => {
      const f = fixture();
      // Simulate a persisted trial task; production creation no longer opts in.
      const create = f.repository.create.bind(f.repository);
      f.repository.create = (task) =>
        create({
          ...task,
          state: {...task.state, relationReviewRequired: true},
        });
      f.actions.relationSteps.mockResolvedValue([
        {
          kind: 'relation',
          targetId: E,
          relatedEntryId: P,
          expectedRevision: 2,
          expectedRelatedRevision: 1,
          expectedOverrideRevision: 0,
          attempt: 0,
          complete: false,
        },
      ]);
      const originalReview = requireOperationValue(
        f.actions.reviewRelation.getMockImplementation(),
      );
      f.actions.reviewRelation.mockImplementation(async (task, step) => {
        const run = await originalReview(task, step);
        if (mode === 'pause')
          await f.repository.control(
            W,
            task.taskId,
            requireOperationValue(f.rows.get(task.taskId)).version,
            'pause',
          );
        if (mode === 'negative') {
          const negative = {
            ...run,
            proposals: [],
            currentStage: 'associations' as const,
            currentStep: '未发现有意义的联系',
            completedUnits: 1,
            totalUnits: 1,
          };
          f.runs.set(run.runId, negative);
          return negative;
        }
        if (mode === 'uncertain') {
          const held = {
            ...run,
            proposals: [],
            status: 'failed' as const,
            errorCode: 'ai_relation_review_uncertain',
          };
          f.runs.set(run.runId, held);
          return held;
        }
        return run;
      });
      const task = await f.service.start(owner, `review-${mode}`, {
        kind: 'document',
        snapshotId: S,
        maxEntries: 4,
        maxRelations: 1,
        maxModelCalls: mode === 'budget' ? 3 : 6,
      });
      let result = await f.done(task.taskId);
      if (mode === 'pause') {
        expect(result.state.status).toBe('paused');
        await f.service.control(owner, task.taskId, result.version, 'resume');
        result = await f.done(task.taskId);
      }
      if (mode === 'budget') {
        expect(result.state).toMatchObject({
          status: 'failed',
          calls: 3,
          errorCode: 'model_call_budget_exhausted',
        });
        expect(f.actions.reviewRelation).not.toHaveBeenCalled();
      } else {
        expect(result.state).toMatchObject({
          status: mode === 'uncertain' ? 'paused' : 'succeeded',
          calls: 4,
          relationReviewRequired: true,
        });
        expect(f.actions.reviewRelation).toHaveBeenCalledTimes(1);
        expect(
          result.state.steps.find((step) => step.kind === 'relation')
            ?.reviewAttempt,
        ).toBe(1);
      }
      const accepted = f.actions.accept.mock.calls.filter(
        ([, step]) => step.kind === 'relation',
      );
      if (mode === 'positive' || mode === 'pause') {
        expect(accepted).toHaveLength(1);
        expect(accepted[0]?.[2].proposalId).toBe(S);
      } else expect(accepted).toHaveLength(0);
      expect(f.actions.publish).toHaveBeenCalledTimes(
        mode === 'budget' || mode === 'uncertain' ? 0 : 1,
      );
    },
  );
  it.each([24, 22])(
    'plans a 35-entry collection against the unchanged %i-call limit',
    async (limit) => {
      const f = fixture();
      const tags: AgentTaskStep[] = Array.from({length: 35}, (_, index) => ({
        kind: 'tags',
        targetId: `00000000-0000-4000-8000-${String(100 + index).padStart(12, '0')}`,
        expectedRevision: 1,
        attempt: 0,
        complete: false,
      }));
      const original = requireOperationValue(
        f.actions.generate.getMockImplementation(),
      );
      f.actions.generate.mockImplementation(async (task, step) => {
        const run = await original(task, step);
        if (step.kind !== 'split') return run;
        const changed = {
          ...run,
          proposals: [
            {
              ...requireOperationValue(run.proposals[0]),
              splitPayload: {
                providerModel: 'synthetic-model',
                promptVersion: 'synthetic-split',
                splitRuleVersion: 'struinfo.entry-split.ai-group.v1',
                entries: tags.map(() => ({
                  titlePath: 'Synthetic',
                  fragmentIds: [S],
                })),
              },
            } as ProcessingProposal,
          ],
        };
        f.runs.set(run.runId, changed);
        return changed;
      });
      f.actions.tagSteps.mockResolvedValue(tags);
      f.actions.tagCallEstimate.mockResolvedValue(9);
      f.actions.recallCallEstimate.mockResolvedValue(9);
      f.actions.tagGroup.mockImplementation((task) =>
        Promise.resolve(
          task.state.steps
            .filter(
              (step) => step.kind === 'tags' && !step.complete && !step.runId,
            )
            .slice(0, 4),
        ),
      );
      f.actions.generateTagGroup.mockImplementation(
        async (group: AgentTaskStep[]) => {
          const task = requireOperationValue([...f.rows.values()][0]);
          return Promise.all(
            group.map(async (step) => ({
              outcome: 'created',
              run: await original(task, step),
            })),
          );
        },
      );
      f.actions.recallSteps.mockResolvedValue(
        tags.map((step) => ({...step, kind: 'recall', expectedRevision: 2})),
      );
      f.actions.recallGroup.mockImplementation((task) =>
        Promise.resolve(
          task.state.steps
            .filter((step) => step.kind === 'recall' && !step.recallPlan)
            .slice(0, 4),
        ),
      );
      f.actions.relationSteps.mockResolvedValue(
        tags.slice(0, 3).map((step) => ({
          ...step,
          kind: 'relation',
          relatedEntryId: P,
          expectedRevision: 2,
          expectedRelatedRevision: 1,
          expectedOverrideRevision: 0,
        })),
      );
      const task = await f.service.start(
        owner,
        `collection-${limit.toString()}`,
        {
          kind: 'document',
          snapshotId: S,
          intake: {fetchFullText: false},
          maxEntries: 64,
          maxRelations: 3,
          maxRelationCandidates: 3,
          maxModelCalls: limit,
        },
      );
      const result = await f.done(task.taskId);
      if (limit === 24) {
        expect(result.state).toMatchObject({status: 'succeeded', calls: 23});
        expect(result.state.steps.every((step) => step.complete)).toBe(true);
        expect(f.actions.publish).toHaveBeenCalledTimes(1);
        expect(f.actions.generateTagGroup).toHaveBeenCalledTimes(9);
      } else {
        expect(result.state).toMatchObject({
          status: 'failed',
          calls: 2,
          errorCode: 'insufficient_document_call_budget',
        });
        expect(f.actions.tagSteps).not.toHaveBeenCalled();
        expect(f.writes).toBe(0);
        expect(f.actions.publish).not.toHaveBeenCalled();
      }
    },
  );
  it.each(['complete', 'pause', 'cancel', 'price-wait', 'invalid'] as const)(
    'reserves one tag call and independent checkpoints: %s',
    async (mode) => {
      const f = fixture();
      const steps: AgentTaskStep[] = [E, P].map((targetId) => ({
        kind: 'tags',
        targetId,
        expectedRevision: 1,
        attempt: 0,
        complete: false,
      }));
      f.actions.tagSteps.mockResolvedValue(steps);
      f.actions.tagGroup.mockImplementation((task, first) =>
        Promise.resolve(
          task.state.steps.filter(
            (step) =>
              step.kind === 'tags' &&
              !step.complete &&
              step.attempt === first.attempt,
          ),
        ),
      );
      f.actions.generateTagGroup.mockImplementation(
        async (group: AgentTaskStep[]) => {
          const current = requireOperationValue([...f.rows.values()][0]);
          expect(current.state.calls).toBe(2); // split + one tag request
          expect(
            current.state.steps
              .filter((step) => step.kind === 'tags')
              .every((step) => step.attempt === 1 && step.runId),
          ).toBe(true);
          if (mode === 'price-wait') throw new AiPriceWindowClosedError();
          if (mode === 'invalid')
            throw new OperationError(
              'rejected',
              'ai_provider_invalid_response',
            );
          const results = await Promise.all(
            group.map(async (step) => ({
              outcome: 'created',
              run: await f.actions.generate(current, step),
            })),
          );
          if (mode === 'pause' || mode === 'cancel')
            await f.repository.control(
              W,
              current.taskId,
              current.version,
              mode,
            );
          return results;
        },
      );
      const task = await f.service.start(owner, 'tag-batch-' + mode, {
        kind: 'document',
        snapshotId: S,
        maxRelations: 0,
        maxModelCalls: 3,
      });
      const result = await f.done(task.taskId);
      expect(f.actions.generateTagGroup).toHaveBeenCalledTimes(1);
      if (mode === 'complete') {
        expect(result.state).toMatchObject({status: 'succeeded', calls: 2});
        expect(f.actions.publish).toHaveBeenCalledTimes(1);
        expect(f.writes).toBe(3);
      } else {
        expect(f.actions.publish).not.toHaveBeenCalled();
        expect(f.writes).toBe(1); // only split was accepted
        expect(result.state.calls).toBe(mode === 'price-wait' ? 1 : 2);
        expect(
          result.state.steps
            .filter((step) => step.kind === 'tags')
            .map((step) => step.attempt),
        ).toEqual(mode === 'price-wait' ? [0, 0] : [1, 1]);
        if (mode === 'pause') {
          const current = await f.service.read(owner, task.taskId);
          await f.service.control(
            owner,
            task.taskId,
            current.version,
            'resume',
          );
          await vi.waitFor(() => {
            expect(f.rows.get(task.taskId)?.state.status).toBe('succeeded');
          });
          expect(f.actions.generateTagGroup).toHaveBeenCalledTimes(1);
          expect(f.rows.get(task.taskId)?.state.calls).toBe(2);
          expect(f.writes).toBe(3);
        }
      }
    },
  );
  it.each(['accepted', 'held'] as const)(
    'finishes a receipt-only review as %s without structure or annotations',
    async (outcome) => {
      const f = fixture();
      f.actions.acceptReceipt.mockResolvedValue(outcome);
      const task = await f.service.start(owner, 'receipt-' + outcome, {
        kind: 'intake',
        snapshotId: S,
        expectedVersion: 1,
        intake: {fetchFullText: false},
      });
      const result = await f.done(task.taskId);
      expect(result.state).toMatchObject({
        status: 'succeeded',
        phase: 'complete',
        calls: 1,
        steps: [{kind: 'intake', complete: true, receiptVersion: 2, outcome}],
      });
      expect(f.actions.intakeTarget).not.toHaveBeenCalled();
      expect(f.actions.generate).not.toHaveBeenCalled();
      expect(f.actions.tagSteps).not.toHaveBeenCalled();
      expect(f.writes).toBe(0);
    },
  );
  it.each(['pause', 'cancel'] as const)(
    'honors %s after receipt review before accepting',
    async (action) => {
      const f = fixture();
      f.actions.reviewIntake.mockImplementationOnce(async () => {
        const current = requireOperationValue([...f.rows.values()][0]);
        await f.repository.control(W, current.taskId, current.version, action);
        return 2;
      });
      const task = await f.service.start(owner, 'receipt-control-' + action, {
        kind: 'intake',
        snapshotId: S,
        expectedVersion: 1,
        intake: {fetchFullText: false},
      });
      expect((await f.done(task.taskId)).state.status).toBe(
        action === 'pause' ? 'paused' : 'cancelled',
      );
      expect(f.actions.acceptReceipt).not.toHaveBeenCalled();
      if (action === 'pause') {
        const current = await f.service.read(owner, task.taskId);
        await f.service.control(owner, task.taskId, current.version, 'resume');
        await vi.waitFor(() => {
          expect(f.rows.get(task.taskId)?.state.status).toBe('succeeded');
        });
        expect(f.actions.reviewIntake).toHaveBeenCalledTimes(1);
        expect(f.actions.acceptReceipt).toHaveBeenCalledTimes(1);
      }
    },
  );
  it('keeps receipt price waits durable without charging attempts and requires intake authority', async () => {
    let closed = true;
    const f = fixture(undefined, {
      check: async () => {
        await Promise.resolve();
        if (closed) throw new AiPriceWindowClosedError();
      },
      canResume: () => true,
    });
    const request = {
      kind: 'intake',
      snapshotId: S,
      expectedVersion: 1,
      intake: {fetchFullText: false},
    };
    const agent = ExecutionAuthority.agent(W, 'synthetic-agent', [
      'tasks.control',
      'models.use',
    ]);
    await expect(
      f.service.start(agent, 'forbidden-receipt', request),
    ).rejects.toMatchObject({code: 'operation_not_authorized'});
    const task = await f.service.start(owner, 'receipt-price', request);
    expect((await f.done(task.taskId)).state).toMatchObject({
      status: 'paused',
      calls: 0,
      errorCode: AI_PRICE_WAIT,
    });
    expect(f.actions.reviewIntake).not.toHaveBeenCalled();
    closed = false;
    await f.service.pollPriceDeferred();
    await vi.waitFor(() => {
      expect(f.rows.get(task.taskId)?.state.status).toBe('succeeded');
    });
    expect(f.actions.reviewIntake).toHaveBeenCalledTimes(1);
    expect(f.actions.generate).not.toHaveBeenCalled();
  });

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
  it('keeps budget waits at their checkpoint until explicitly continued', async () => {
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
        errorCode: AI_BUDGET_WAIT,
      } as unknown as ProcessingRun;
      f.runs.set(requireOperationValue(step.runId), run);
      return run;
    });
    const task = await f.service.start(owner, 'budget-checkpoint', {
      kind: 'document',
      snapshotId: S,
      maxModelCalls: 2,
    });
    const paused = await f.done(task.taskId);
    expect(paused.state).toMatchObject({
      status: 'paused',
      calls: 0,
      errorCode: AI_BUDGET_WAIT,
      steps: [{attempt: 0, complete: false}],
    });
    await vi.waitFor(async () => {
      expect((await f.service.read(owner, task.taskId)).runtimeStatus).toBe(
        'idle',
      );
    });
    await f.service.pollPriceDeferred();
    expect(f.rows.get(task.taskId)?.state.status).toBe('paused');
    await f.service.control(owner, task.taskId, paused.version, 'resume');
    await vi.waitFor(() => {
      expect(f.rows.get(task.taskId)?.state.status).toBe('succeeded');
    });
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
  it('holds before splitting, then uses reselected evidence without resetting spent calls', async () => {
    const f = fixture();
    let held = false;
    f.actions.reviewIntake.mockImplementationOnce(() => {
      held = true;
      return Promise.resolve(2);
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
    f.actions.reviewCheckpointCurrent.mockResolvedValue(false);
    f.actions.intakeTarget.mockResolvedValue(P);
    const current = await f.service.read(owner, task.taskId);
    await f.service.control(owner, task.taskId, current.version, 'resume');
    await vi.waitFor(() => {
      expect(f.rows.get(task.taskId)?.state.status).toBe('succeeded');
    });
    expect(f.actions.reviewIntake).toHaveBeenCalledTimes(2);
    expect(f.rows.get(task.taskId)?.state.calls).toBe(4);
    expect(
      f.rows.get(task.taskId)?.state.steps.find((step) => step.kind === 'split')
        ?.targetId,
    ).toBe(P);
    expect(
      f.rows
        .get(task.taskId)
        ?.state.steps.find((step) => step.kind === 'intake')?.attempt,
    ).toBe(2);
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

it('scopes the task list before the recent-history limit and retains actor isolation', async () => {
  const {service, repository, done} = fixture();
  const saved = await service.start(owner, 'synthetic-document-history', {
    kind: 'document',
    snapshotId: S,
  });
  await done(saved.taskId);
  const list = vi.spyOn(repository, 'list');
  expect(await service.list(owner, [S])).toHaveLength(1);
  expect(list).toHaveBeenLastCalledWith(W, [S], false);
  await service.list(owner, [S], true);
  expect(list).toHaveBeenLastCalledWith(W, [S], true);
  expect(await service.list(owner, [E])).toHaveLength(0);
  const external = ExecutionAuthority.agent(
    W,
    'synthetic-reader',
    DELEGATED_READ_OPERATIONS,
  );
  expect(await service.list(external, [S])).toHaveLength(0);
  await expect(service.list(owner, [])).rejects.toMatchObject({
    code: 'invalid_snapshot_scope',
  });
});

it.each(['intake', 'document'] as const)(
  'global stop preserves an in-flight %s result and resumes without another model call',
  async (kind) => {
    let allowed = true;
    const check = async () => {
      await Promise.resolve();
      if (!allowed) throw new AiOperationsPausedError();
    };
    const f = fixture(undefined, {
      check,
      checkOperations: check,
      canResume: () => true,
    });
    if (kind === 'intake')
      f.actions.reviewIntake.mockImplementationOnce(async () => {
        await Promise.resolve();
        allowed = false;
        return 2;
      });
    else {
      const generate = requireOperationValue(
        f.actions.generate.getMockImplementation(),
      );
      f.actions.generate.mockImplementationOnce(async (task, step) => {
        const result = await generate(task, step);
        allowed = false;
        return result;
      });
    }
    const task = await f.service.start(owner, 'global-' + kind, {
      kind,
      snapshotId: S,
      ...(kind === 'intake'
        ? {expectedVersion: 1, intake: {fetchFullText: false}}
        : {}),
    });
    const paused = await f.done(task.taskId);
    expect(paused.state).toMatchObject({
      status: 'paused',
      errorCode: 'ai_operations_paused',
      calls: 1,
    });
    expect(f.actions.acceptReceipt).not.toHaveBeenCalled();
    expect(f.actions.accept).not.toHaveBeenCalled();
    await f.service.pollPriceDeferred();
    expect(f.rows.get(task.taskId)?.state.status).toBe('paused');
    allowed = true;
    await vi.waitFor(async () => {
      expect((await f.service.read(owner, task.taskId)).runtimeStatus).toBe(
        'idle',
      );
    });
    await f.service.pollPriceDeferred();
    await vi.waitFor(() => {
      expect(f.rows.get(task.taskId)?.state.status).toBe('succeeded');
    });
    expect(
      kind === 'intake' ? f.actions.reviewIntake : f.actions.generate,
    ).toHaveBeenCalledTimes(kind === 'intake' ? 1 : 2);
  },
);
it('global resume preserves individual pauses and refuses to spend a call while prohibited', async () => {
  let allowed = false;
  const check = async () => {
    await Promise.resolve();
    if (!allowed) throw new AiOperationsPausedError();
  };
  const f = fixture(undefined, {
    check,
    checkOperations: check,
    canResume: () => true,
  });
  const task = await f.service.start(owner, 'global-held', {
    kind: 'document',
    snapshotId: S,
  });
  const paused = await f.done(task.taskId);
  expect(paused.state.calls).toBe(0);
  await f.service.control(owner, task.taskId, paused.version, 'pause');
  await vi.waitFor(async () => {
    expect((await f.service.read(owner, task.taskId)).runtimeStatus).toBe(
      'idle',
    );
  });
  allowed = true;
  await f.service.pollPriceDeferred();
  expect(f.actions.generate).not.toHaveBeenCalled();
  expect(f.rows.get(task.taskId)?.pauseRequested).toBe(true);
});

it.each([
  {entries: 25, budget: 55, enough: false},
  {entries: 25, budget: 56, enough: true},
  {entries: 29, budget: 63, enough: false},
  {entries: 29, budget: 64, enough: true},
])(
  'checks the entire collection plan before accepting a split: $entries entries / $budget calls',
  async ({entries, budget, enough}) => {
    const f = fixture();
    const generate = requireOperationValue(
      f.actions.generate.getMockImplementation(),
    );
    f.actions.generate.mockImplementation(async (task, step) => {
      const run = await generate(task, step);
      if (step.kind !== 'split') return run;
      const updated = {
        ...run,
        proposals: run.proposals.map((proposal) => ({
          ...proposal,
          splitPayload: {
            providerModel: 'synthetic-model',
            promptVersion: 'synthetic-v1',
            splitRuleVersion: 'struinfo.entry-split.ai-group.v1' as const,
            entries: Array.from({length: entries}, (_, index) => ({
              titlePath: `Synthetic news ${index.toString()}`,
              fragmentIds: [S],
            })),
          },
        })),
      };
      f.runs.set(updated.runId, updated);
      return updated;
    });
    const targets = Array.from(
      {length: entries},
      (_, index) =>
        `00000000-0000-4000-8000-${String(100 + index).padStart(12, '0')}`,
    );
    f.actions.tagSteps.mockResolvedValue(
      targets.map((targetId) => ({
        kind: 'tags',
        targetId,
        expectedRevision: 1,
        attempt: 0,
        complete: false,
      })),
    );
    f.actions.recallSteps.mockResolvedValue(
      targets.map((targetId) => ({
        kind: 'recall',
        targetId,
        expectedRevision: 2,
        attempt: 0,
        complete: false,
      })),
    );
    const task = await f.service.start(
      owner,
      `synthetic-capacity-${entries.toString()}-${budget.toString()}`,
      {
        kind: 'document',
        snapshotId: S,
        intake: {fetchFullText: false},
        maxEntries: 64,
        maxRelations: 2,
        maxRelationCandidates: 4,
        maxModelCalls: budget,
      },
    );
    const result = await f.done(task.taskId);
    expect(result.request).toMatchObject({maxModelCalls: budget});
    if (enough) {
      expect(result.state.status).toBe('succeeded');
      expect(f.actions.recall).toHaveBeenCalledTimes(entries);
    } else {
      expect(result.state).toMatchObject({
        status: 'failed',
        calls: 2,
        errorCode: 'insufficient_document_call_budget',
      });
      expect(f.actions.accept).not.toHaveBeenCalled();
      expect(f.actions.recall).not.toHaveBeenCalled();
      const split = result.state.steps.find((step) => step.kind === 'split');
      expect(split?.proposalId).toBe(P);
      expect(split?.complete).toBe(false);
    }
  },
);

it('resumes only the failed recall, retaining the completed writes and consumed attempts', async () => {
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
  f.actions.recall.mockRejectedValueOnce(
    new OperationError('rejected', 'ai_provider_incomplete_response'),
  );
  const task = await f.service.start(owner, 'synthetic-recall-recovery', {
    kind: 'document',
    snapshotId: S,
    maxRelations: 1,
    maxRelationCandidates: 1,
    maxModelCalls: 8,
  });
  const failed = await f.done(task.taskId);
  expect(failed.state).toMatchObject({
    status: 'failed',
    phase: 'recall',
    calls: 3,
    errorCode: 'ai_provider_incomplete_response',
  });
  expect(failed.state.steps.find((s) => s.kind === 'recall')).toMatchObject({
    attempt: 1,
    complete: false,
  });
  await f.service.control(owner, task.taskId, failed.version, 'resume');
  const completed = await f.done(task.taskId);
  expect(completed.state).toMatchObject({status: 'succeeded', calls: 4});
  expect(completed.state.steps.find((s) => s.kind === 'recall')).toMatchObject({
    attempt: 2,
    complete: true,
  });
  expect(f.actions.generate).toHaveBeenCalledTimes(2);
  expect(f.actions.accept).toHaveBeenCalledTimes(2);
  expect(f.actions.recall).toHaveBeenCalledTimes(2);
});

it('does not reset the recall attempt limit on repeated explicit resumes', async () => {
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
  f.actions.recall.mockRejectedValue(
    new OperationError('rejected', 'ai_provider_invalid_schema'),
  );
  const task = await f.service.start(owner, 'synthetic-recall-attempt-limit', {
    kind: 'document',
    snapshotId: S,
    maxRelations: 1,
    maxRelationCandidates: 1,
    maxModelCalls: 8,
  });
  let failed = await f.done(task.taskId);
  for (let attempt = 1; attempt <= 3; attempt++) {
    await f.service.control(owner, task.taskId, failed.version, 'resume');
    failed = await f.done(task.taskId);
  }
  expect(failed.state).toMatchObject({
    status: 'failed',
    calls: 5,
    errorCode: 'step_attempt_budget_exhausted',
  });
  expect(f.actions.recall).toHaveBeenCalledTimes(3);
  expect(f.actions.accept).toHaveBeenCalledTimes(2);
});

describe('owner workbench reprocessing', () => {
  it('freezes tag steps at submission, confirms results, and never splits or recalls', async () => {
    const f = fixture();
    const task = await f.service.start(owner, 'workbench-retag', {
      kind: 'document',
      snapshotId: S,
      reprocess: 'tags',
      maxEntries: 12,
      maxRelations: 0,
      maxModelCalls: 3,
    });
    const completed = await f.done(task.taskId);
    expect(completed.state.status).toBe('succeeded');
    expect(completed.state.calls).toBe(1);
    expect(f.actions.tagSteps).toHaveBeenCalledTimes(1);
    expect(
      f.actions.generate.mock.calls.every(([, step]) => step.kind === 'tags'),
    ).toBe(true);
    expect(f.actions.accept).toHaveBeenCalledTimes(1);
    expect(f.actions.recallSteps).not.toHaveBeenCalled();
    expect(f.actions.relationSteps).not.toHaveBeenCalled();
  });
  it('does not silently expand reprocessing into relations', async () => {
    const f = fixture();
    await expect(
      f.service.start(owner, 'retag-invalid-scope', {
        kind: 'document',
        snapshotId: S,
        reprocess: 'tags',
        maxRelations: 1,
      }),
    ).rejects.toMatchObject({code: 'operation_not_authorized'});
    expect(f.rows.size).toBe(0);
  });
});

it('publishes only after every document stage, and resumes publication without another model call', async () => {
  const f = fixture();
  f.actions.publish.mockRejectedValueOnce(
    new OperationError('conflict', 'stale_document_publication'),
  );
  const started = await f.service.start(owner, 'publication-boundary', {
    kind: 'document',
    snapshotId: S,
    intake: {fetchFullText: false},
  });
  const stopped = await f.done(started.taskId);
  expect(stopped.state).toMatchObject({status: 'failed', phase: 'publish'});
  expect(stopped.state.steps.every((step) => step.complete)).toBe(true);
  const calls = stopped.state.calls;
  await f.service.control(owner, started.taskId, stopped.version, 'resume');
  const completed = await f.done(started.taskId);
  expect(completed.state).toMatchObject({
    status: 'succeeded',
    phase: 'complete',
    calls,
  });
  expect(f.actions.finishDocumentIntake).toHaveBeenCalledTimes(1);
  expect(f.actions.publish).toHaveBeenCalledTimes(2);
});

describe('document admission through publication', () => {
  it('keeps reception authority separate from model processing for an external Agent', async () => {
    const f = fixture();
    f.actions.requiresReceiptAcceptance.mockResolvedValue(true);
    const request = {
      kind: 'document',
      snapshotId: S,
      intake: {fetchFullText: false},
      maxEntries: 8,
      maxRelations: 0,
      maxModelCalls: 12,
    };
    await expect(
      f.service.start(
        ExecutionAuthority.agent(W, 'synthetic', [
          'tasks.control',
          'models.use',
          'processing.read',
        ]),
        'no-receipt-grant',
        request,
      ),
    ).rejects.toMatchObject({code: 'operation_not_authorized'});
    expect(f.rows.size).toBe(0);
    const task = await f.service.start(
      ExecutionAuthority.agent(W, 'synthetic', [
        'tasks.control',
        'models.use',
        'processing.read',
        'ingestion.manage',
      ]),
      'with-receipt-grant',
      request,
    );
    expect((await f.done(task.taskId)).state.status).toBe('succeeded');
    expect(f.actions.finishDocumentIntake).toHaveBeenCalledTimes(1);
    expect(f.actions.publish).toHaveBeenCalledTimes(1);
  });
  it.each(['pause', 'cancel'] as const)(
    'saves the review checkpoint and honors %s before document acceptance',
    async (action) => {
      const f = fixture();
      f.actions.reviewIntake.mockImplementationOnce(async () => {
        const t = requireOperationValue([...f.rows.values()][0]);
        await f.repository.control(W, t.taskId, t.version, action);
        return 2;
      });
      const task = await f.service.start(owner, 'document-control-' + action, {
        kind: 'document',
        snapshotId: S,
        intake: {fetchFullText: false},
        maxEntries: 8,
        maxRelations: 0,
        maxModelCalls: 12,
      });
      const paused = await f.done(task.taskId);
      expect(paused.state.status).toBe(
        action === 'pause' ? 'paused' : 'cancelled',
      );
      expect(paused.state.steps[0]).toMatchObject({
        receiptVersion: 2,
        complete: false,
      });
      expect(f.actions.finishDocumentIntake).not.toHaveBeenCalled();
      expect(f.actions.publish).not.toHaveBeenCalled();
      if (action === 'pause') {
        await f.service.control(owner, task.taskId, paused.version, 'resume');
        await vi.waitFor(() => {
          expect(f.rows.get(task.taskId)?.state.status).toBe('succeeded');
        });
        expect(f.actions.reviewIntake).toHaveBeenCalledTimes(1);
        expect(f.actions.finishDocumentIntake).toHaveBeenCalledTimes(1);
        expect(f.actions.publish).toHaveBeenCalledTimes(1);
      }
    },
  );
});

describe('explicit failed-task recovery rounds', () => {
  async function exhausted() {
    const f = fixture();
    const task = await f.service.start(owner, 'recovery', {
      kind: 'document',
      snapshotId: S,
      maxModelCalls: 1,
    });
    const failed = await f.done(task.taskId);
    expect(failed.state.status).toBe('failed');
    expect(failed.state.steps[0]?.complete).toBe(true);
    return {...f, failed};
  }
  it('preserves completed steps and old consumption; repeats do not create another round', async () => {
    const f = await exhausted();
    const next = await f.service.restart(
      owner,
      f.failed.taskId,
      f.failed.version,
    );
    expect(next.state.recovery).toMatchObject({
      previousTaskId: f.failed.taskId,
      previousCalls: 1,
    });
    await f.done(next.taskId);
    expect(f.rows.get(next.taskId)?.state.status).toBe('succeeded');
    expect(f.actions.generate.mock.calls.map((call) => call[1].kind)).toEqual([
      'split',
      'tags',
    ]);
    expect(f.rows.get(f.failed.taskId)?.state).toMatchObject({
      status: 'failed',
      calls: 1,
      supersededBy: next.taskId,
    });
    const repeated = await f.service.restart(
      owner,
      f.failed.taskId,
      f.failed.version,
    );
    expect(repeated.taskId).toBe(next.taskId);
    expect(f.rows.size).toBe(2);
    await expect(
      f.service.control(
        owner,
        f.failed.taskId,
        requireOperationValue(f.rows.get(f.failed.taskId)).version,
        'resume',
      ),
    ).rejects.toMatchObject({code: 'task_superseded'});
  });
  it('refuses stale state and edited documents before creating a new round', async () => {
    const f = await exhausted();
    await expect(
      f.service.restart(owner, f.failed.taskId, f.failed.version - 1),
    ).rejects.toMatchObject({code: 'stale_task_version'});
    f.actions.validateRecovery.mockRejectedValue(
      new OperationError('conflict', 'document_changed_after_tags'),
    );
    await expect(
      f.service.restart(owner, f.failed.taskId, f.failed.version),
    ).rejects.toMatchObject({code: 'document_changed_after_tags'});
    expect(f.rows.size).toBe(1);
  });
  it('requires owner authority and retains dispatch waits in a new round', async () => {
    const f = await exhausted();
    const agent = ExecutionAuthority.agent(W, 'synthetic', [
      ...DELEGATED_READ_OPERATIONS,
      'tasks.control',
      'models.use',
    ]);
    await expect(
      f.service.restart(agent, f.failed.taskId, f.failed.version),
    ).rejects.toMatchObject({code: 'operation_not_authorized'});
    const service = new AgentTaskService(
      W,
      f.repository,
      f.actions as unknown as AgentTaskActions,
      undefined,
      {
        check: () => Promise.reject(new AiPriceWindowClosedError()),
        canResume: () => true,
      },
    );
    const next = await service.restart(
      owner,
      f.failed.taskId,
      f.failed.version,
    );
    await vi.waitFor(() => {
      expect(f.rows.get(next.taskId)?.state.status).toBe('paused');
    });
    expect(f.rows.get(next.taskId)?.state).toMatchObject({
      calls: 0,
      errorCode: AI_PRICE_WAIT,
    });
    expect(f.actions.generate).toHaveBeenCalledTimes(1);
  });
});

it('keeps exhausted attempt history and renews only unfinished attempts on explicit restart', async () => {
  const f = fixture();
  const generate = f.actions.generate.getMockImplementation();
  f.actions.generate.mockRejectedValue(
    new OperationError('rejected', 'ai_provider_invalid_response'),
  );
  const task = await f.service.start(owner, 'attempt-exhaustion', {
    kind: 'document',
    snapshotId: S,
  });
  let current = await f.done(task.taskId);
  await expect(
    f.service.restart(owner, task.taskId, current.version),
  ).rejects.toMatchObject({code: 'task_restart_not_required'});
  for (const attempt of [2, 3]) {
    await f.service.control(owner, task.taskId, current.version, 'resume');
    await vi.waitFor(() => {
      expect(f.rows.get(task.taskId)?.state.calls).toBe(attempt);
    });
    current = await f.done(task.taskId);
  }
  f.actions.generate.mockImplementation(requireOperationValue(generate));
  const next = await f.service.restart(owner, task.taskId, current.version);
  const completed = await f.done(next.taskId);
  expect(completed.state.status).toBe('succeeded');
  expect(completed.state.calls).toBe(2);
  expect(completed.state.recovery?.previousCalls).toBe(3);
  expect(f.rows.get(task.taskId)?.state.steps[0]?.attempt).toBe(3);
});

it('accounts for one batched recall request and preserves all plans when paused after response', async () => {
  const f = fixture();
  const targets = [10, 11, 12, 13].map(
    (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
  );
  f.actions.tagSteps.mockResolvedValue(
    targets.map((targetId) => ({
      kind: 'tags',
      targetId,
      expectedRevision: 1,
      attempt: 0,
      complete: false,
    })),
  );
  f.actions.recallSteps.mockResolvedValue(
    targets.map((targetId) => ({
      kind: 'recall',
      targetId,
      expectedRevision: 2,
      attempt: 0,
      complete: false,
    })),
  );
  f.actions.recallGroup.mockImplementation((task) =>
    Promise.resolve(
      task.state.steps.filter(
        (s) => s.kind === 'recall' && !s.complete && !s.recallPlan,
      ),
    ),
  );
  f.actions.recallGroupPlans.mockImplementation((steps) => {
    const task = requireOperationValue([...f.rows.values()][0]);
    expect(task.state.calls).toBe(6); // One split, four tags, one four-item recall.
    expect(
      task.state.steps
        .filter((s) => s.kind === 'recall')
        .every((s) => s.attempt === 1),
    ).toBe(true);
    f.rows.set(task.taskId, {...task, pauseRequested: true});
    return Promise.resolve(
      steps.map((s) => ({
        concepts: [{term: s.targetId, variants: ['Synthetic equivalent']}],
      })),
    );
  });
  const task = await f.service.start(owner, 'synthetic-batch-checkpoint', {
    kind: 'document',
    snapshotId: S,
    maxEntries: 8,
    maxRelations: 1,
    maxRelationCandidates: 4,
    maxModelCalls: 8,
  });
  expect((await f.done(task.taskId)).state).toMatchObject({
    status: 'paused',
    calls: 6,
  });
  expect(
    f.rows
      .get(task.taskId)
      ?.state.steps.filter((s) => s.kind === 'recall')
      .every((s) => s.recallPlan),
  ).toBe(true);
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
  expect(f.rows.get(task.taskId)?.state.calls).toBe(6);
  expect(f.actions.recallGroupPlans).toHaveBeenCalledTimes(1);
});

it('replans an explicitly selected failed pending split without renewing its budget or discarding history', async () => {
  const f = fixture();
  const generate = requireOperationValue(
    f.actions.generate.getMockImplementation(),
  );
  f.actions.generate.mockImplementation(async (task, step) => {
    const run = await generate(task, step);
    if (step.kind !== 'split') return run;
    const entries = step.attempt === 1 ? 15 : 2;
    const updated = {
      ...run,
      proposals: run.proposals.map((p) => ({
        ...p,
        splitPayload: {
          providerModel: 'synthetic-model',
          promptVersion: 'synthetic-v1',
          splitRuleVersion: 'struinfo.entry-split.ai-group.v1' as const,
          entries: Array.from({length: entries}, () => ({
            titlePath: 'Synthetic resource',
            fragmentIds: [S],
          })),
        },
      })),
    };
    f.runs.set(updated.runId, updated);
    return updated;
  });
  const task = await f.service.start(owner, 'synthetic-replan', {
    kind: 'document',
    snapshotId: S,
    maxEntries: 32,
    maxRelations: 0,
    maxModelCalls: 10,
  });
  const failed = await f.done(task.taskId);
  expect(failed.state.errorCode).toBe('insufficient_document_call_budget');
  const oldRun = failed.state.steps.find((s) => s.kind === 'split')?.runId;
  await vi.waitFor(async () => {
    expect((await f.service.read(owner, task.taskId)).runtimeStatus).toBe(
      'idle',
    );
  });
  const current = await f.service.read(owner, task.taskId);
  await expect(
    f.service.control(owner, task.taskId, current.version - 1, 'resume', true),
  ).rejects.toMatchObject({code: 'stale_task_version'});
  await f.service.control(owner, task.taskId, current.version, 'resume', true);
  await vi.waitFor(() => {
    expect(f.rows.get(task.taskId)?.state.status).toBe('succeeded');
  });
  const after = requireOperationValue(f.rows.get(task.taskId));
  expect(after.request).toMatchObject({maxModelCalls: 10});
  expect(after.state.calls).toBe(3);
  expect(after.state.steps.find((s) => s.kind === 'split')).toMatchObject({
    attempt: 2,
    previousRunIds: [oldRun],
  });
  expect(f.runs.get(requireOperationValue(oldRun))?.proposals[0]?.status).toBe(
    'pending_review',
  );
});

it('finishes a corrected thirteen-item collection within the original 24-call round after one discarded split', async () => {
  const f = fixture();
  const generate = requireOperationValue(
    f.actions.generate.getMockImplementation(),
  );
  f.actions.generate.mockImplementation(async (task, step) => {
    const run = await generate(task, step);
    if (step.kind !== 'split') return run;
    const count = step.attempt === 1 ? 15 : 13;
    const updated = {
      ...run,
      proposals: run.proposals.map((p) => ({
        ...p,
        splitPayload: {
          providerModel: 'synthetic-model',
          promptVersion: 'synthetic-v1',
          splitRuleVersion: 'struinfo.entry-split.ai-group.v1' as const,
          entries: Array.from({length: count}, () => ({
            titlePath: 'Synthetic resource',
            fragmentIds: [S],
          })),
        },
      })),
    };
    f.runs.set(updated.runId, updated);
    return updated;
  });
  const targets = Array.from(
    {length: 13},
    (_, n) => `00000000-0000-4000-8000-${String(100 + n).padStart(12, '0')}`,
  );
  f.actions.tagSteps.mockResolvedValue(
    targets.map((targetId) => ({
      kind: 'tags',
      targetId,
      expectedRevision: 1,
      attempt: 0,
      complete: false,
    })),
  );
  f.actions.recallSteps.mockResolvedValue(
    targets.map((targetId) => ({
      kind: 'recall',
      targetId,
      expectedRevision: 2,
      attempt: 0,
      complete: false,
    })),
  );
  f.actions.relationSteps.mockResolvedValue(
    targets.slice(0, 4).map((targetId) => ({
      kind: 'relation',
      targetId,
      relatedEntryId: S,
      attempt: 0,
      complete: false,
    })),
  );
  f.actions.recallCallEstimate.mockResolvedValue(4);
  f.actions.recallGroup.mockImplementation((task) =>
    Promise.resolve(
      task.state.steps
        .filter(
          (step) =>
            step.kind === 'recall' && !step.complete && !step.recallPlan,
        )
        .slice(0, 4),
    ),
  );
  const task = await f.service.start(owner, 'synthetic-thirteen-item-budget', {
    kind: 'document',
    snapshotId: S,
    intake: {fetchFullText: false},
    maxEntries: 64,
    maxRelations: 4,
    maxRelationCandidates: 4,
    maxModelCalls: 24,
  });
  const failed = await f.done(task.taskId);
  expect(failed.state).toMatchObject({
    calls: 2,
    errorCode: 'insufficient_document_call_budget',
  });
  await vi.waitFor(async () => {
    expect((await f.service.read(owner, task.taskId)).runtimeStatus).toBe(
      'idle',
    );
  });
  const current = await f.service.read(owner, task.taskId);
  await f.service.control(owner, task.taskId, current.version, 'resume', true);
  await vi.waitFor(() => {
    expect(f.rows.get(task.taskId)?.state.status).toBe('succeeded');
  });
  const result = requireOperationValue(f.rows.get(task.taskId));
  expect(result.state.calls).toBe(24);
  expect(result.request).toMatchObject({maxModelCalls: 24});
  expect(
    result.state.steps.filter((step) => step.kind === 'tags' && step.complete),
  ).toHaveLength(13);
  expect(
    f.actions.recallGroupPlans.mock.calls.map(([steps]) => steps.length),
  ).toEqual([4, 4, 4, 1]);
});

describe('owner configured document execution', () => {
  const gate = (limit: number, retries: number) => ({
    check: () => Promise.resolve(),
    canResume: () => true,
    executionSettings: () =>
      Promise.resolve({
        maxConcurrentRequests: limit,
        automaticRetryLimit: retries,
      }),
  });
  const document = {
    kind: 'document',
    snapshotId: S,
    maxModelCalls: 8,
    maxEntries: 4,
    maxRelations: 0,
  };
  it('runs independent documents up to configured concurrency', async () => {
    const f = fixture(undefined, gate(2, 0));
    const release: (() => void)[] = [];
    f.actions.prepareIntake.mockImplementation(
      () =>
        new Promise<boolean>((resolve) =>
          release.push(() => {
            resolve(true);
          }),
        ),
    );
    const req = {...document, intake: {fetchFullText: false}};
    const tasks = await Promise.all(
      [1, 2, 3].map((n) =>
        f.service.start(owner, 'parallel-' + String(n), {
          ...req,
          snapshotId: '00000000-0000-4000-8000-00000000000' + String(n + 5),
        }),
      ),
    );
    await vi.waitFor(() => {
      expect(release).toHaveLength(2);
    });
    release[0]?.();
    await f.done(requireOperationValue(tasks[0]).taskId);
    await vi.waitFor(() => {
      expect(release).toHaveLength(3);
    });
    release[1]?.();
    release[2]?.();
    await Promise.all(tasks.map((t) => f.done(t.taskId)));
  });
  it.each([
    'ai_provider_timeout',
    'ai_provider_invalid_json',
    'ai_provider_invalid_response',
  ])(
    'resumes only unfinished stages after %s without renewing budgets',
    async (code) => {
      const f = fixture(undefined, gate(1, 2));
      const generate = requireOperationValue(
        f.actions.generate.getMockImplementation(),
      );
      f.actions.generate.mockImplementation((task, step) =>
        step.kind === 'tags' && step.attempt === 1
          ? Promise.reject(new OperationError('rejected', code))
          : generate(task, step),
      );
      const task = await f.service.start(owner, 'auto-checkpoint', document);
      const held = await f.done(task.taskId);
      expect(held.state).toMatchObject({
        status: 'paused',
        calls: 2,
        automaticRetry: {limit: 2, used: 1},
        steps: [
          {kind: 'split', complete: true},
          {kind: 'tags', complete: false, attempt: 1},
        ],
      });
      await f.service.pollPriceDeferred();
      expect(f.actions.generate).toHaveBeenCalledTimes(2);
      const now = vi
        .spyOn(Date, 'now')
        .mockReturnValue(
          Date.parse(
            requireOperationValue(held.state.automaticRetry?.notBefore),
          ),
        );
      try {
        await f.service.pollPriceDeferred();
        await vi.waitFor(() => {
          expect(f.rows.get(task.taskId)?.state.status).toBe('succeeded');
        });
        const final = requireOperationValue(f.rows.get(task.taskId));
        expect(final.state.calls).toBe(3);
        expect(final.state.automaticRetry).toEqual({limit: 2, used: 1});
        expect(
          f.actions.generate.mock.calls.map(([, step]) => step.kind),
        ).toEqual(['split', 'tags', 'tags']);
        expect(f.actions.publish).toHaveBeenCalledTimes(1);
      } finally {
        now.mockRestore();
      }
    },
  );
  it('retains scheduled retry authority across a price deferral and still honors disabling it', async () => {
    let retries = 1;
    const g = {
      ...gate(1, 1),
      check: vi.fn(() => Promise.resolve()),
      executionSettings: () =>
        Promise.resolve({
          maxConcurrentRequests: 1,
          automaticRetryLimit: retries,
        }),
    };
    const f = fixture(undefined, g);
    f.actions.generate.mockRejectedValueOnce(
      new OperationError('rejected', 'ai_provider_timeout'),
    );
    const t = await f.service.start(owner, 'retry-price-switch', document);
    const held = await f.done(t.taskId);
    const now = vi
      .spyOn(Date, 'now')
      .mockReturnValue(
        Date.parse(requireOperationValue(held.state.automaticRetry?.notBefore)),
      );
    try {
      g.check
        .mockResolvedValueOnce()
        .mockRejectedValueOnce(new AiPriceWindowClosedError());
      await f.service.pollPriceDeferred();
      await vi.waitFor(() => {
        expect(f.rows.get(t.taskId)?.state.errorCode).toBe(AI_PRICE_WAIT);
      });
      expect(f.rows.get(t.taskId)?.state.automaticRetry).toEqual(
        held.state.automaticRetry,
      );
      expect(f.rows.get(t.taskId)?.state.calls).toBe(1);
      retries = 0;
      await f.service.pollPriceDeferred();
      expect(f.actions.generate).toHaveBeenCalledTimes(1);
      retries = 1;
      await f.service.pollPriceDeferred();
      await vi.waitFor(() => {
        expect(f.rows.get(t.taskId)?.state.status).toBe('succeeded');
      });
    } finally {
      now.mockRestore();
    }
  });
  it('stops after the configured retry allowance', async () => {
    const f = fixture(undefined, gate(1, 1));
    f.actions.generate.mockRejectedValue(
      new OperationError('rejected', 'ai_provider_invalid_json'),
    );
    const task = await f.service.start(owner, 'bounded-retry', document);
    const held = await f.done(task.taskId);
    const now = vi
      .spyOn(Date, 'now')
      .mockReturnValue(
        Date.parse(requireOperationValue(held.state.automaticRetry?.notBefore)),
      );
    try {
      await f.service.pollPriceDeferred();
      await vi.waitFor(() => {
        expect(f.rows.get(task.taskId)?.state.status).toBe('failed');
      });
      await f.service.pollPriceDeferred();
      expect(f.actions.generate).toHaveBeenCalledTimes(2);
      expect(f.rows.get(task.taskId)?.state.calls).toBe(2);
    } finally {
      now.mockRestore();
    }
  });
  it.each([
    'intake_held',
    'insufficient_document_call_budget',
    'model_call_budget_exhausted',
    'stale_entry_revision',
  ])('never retries %s', async (code) => {
    const f = fixture(undefined, gate(1, 2));
    f.actions.generate.mockRejectedValue(new OperationError('rejected', code));
    const task = await f.service.start(owner, 'nonretry-' + code, document);
    const result = await f.done(task.taskId);
    expect(result.state.automaticRetry?.notBefore).toBeUndefined();
    await f.service.pollPriceDeferred();
    expect(f.actions.generate).toHaveBeenCalledTimes(1);
  });
  it.each(['pause', 'cancel', 'permission', 'price', 'disable'] as const)(
    'honors %s while a retry is deferred',
    async (control) => {
      let retries = 2;
      const g = {
        ...gate(1, 2),
        check: vi.fn(() => Promise.resolve()),
        executionSettings: () =>
          Promise.resolve({
            maxConcurrentRequests: 1,
            automaticRetryLimit: retries,
          }),
      };
      const f = fixture(undefined, g);
      f.actions.generate.mockRejectedValue(
        new OperationError('rejected', 'ai_provider_timeout'),
      );
      const task = await f.service.start(
        owner,
        'retry-gate-' + control,
        document,
      );
      const held = await f.done(task.taskId);
      if (control === 'pause' || control === 'cancel')
        await f.service.control(owner, task.taskId, held.version, control);
      if (control === 'permission')
        g.check.mockRejectedValue(new AiOperationsPausedError());
      if (control === 'price')
        g.check.mockRejectedValue(new AiPriceWindowClosedError());
      if (control === 'disable') retries = 0;
      const now = vi
        .spyOn(Date, 'now')
        .mockReturnValue(
          Date.parse(
            requireOperationValue(held.state.automaticRetry?.notBefore),
          ),
        );
      try {
        await f.service.pollPriceDeferred();
        expect(f.actions.generate).toHaveBeenCalledTimes(1);
      } finally {
        now.mockRestore();
      }
    },
  );
  it('does not grant automatic retries to older failed tasks when settings change', async () => {
    let retries = 0;
    const f = fixture(undefined, {
      ...gate(1, 0),
      executionSettings: () =>
        Promise.resolve({
          maxConcurrentRequests: 1,
          automaticRetryLimit: retries,
        }),
    });
    f.actions.generate.mockRejectedValue(
      new OperationError('rejected', 'ai_provider_timeout'),
    );
    const t = await f.service.start(owner, 'legacy-failure', document);
    await f.done(t.taskId);
    retries = 2;
    await f.service.pollPriceDeferred();
    expect(f.rows.get(t.taskId)?.state.automaticRetry).toBeUndefined();
    expect(f.actions.generate).toHaveBeenCalledTimes(1);
  });
});
