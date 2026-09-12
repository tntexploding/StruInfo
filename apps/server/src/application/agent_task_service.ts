import {createHash} from 'node:crypto';
import {deriveProcessingRunId} from '../modules/processing/processing_identity.js';
import {
  agentTaskRequestSchema,
  type AgentTask,
  type AgentTaskRepository,
  type AgentTaskState,
  type AgentTaskStep,
} from './agent_task_contract.js';
import type {AgentTaskActions} from './agent_task_actions.js';
import type {ExecutionAuthority} from './execution_authority.js';
import {
  OperationError,
  requireOperationValue,
  assertOperationId,
  assertOperationVersion,
} from './operation_error.js';

export class AgentTaskService {
  readonly #interrupted = new Set<string>();
  readonly #running = new Map<string, Promise<void>>();
  #closing = false;
  #tail: Promise<void> = Promise.resolve();
  public constructor(
    private readonly workspaceId: string,
    private readonly repository: AgentTaskRepository,
    private readonly actions: AgentTaskActions,
    private readonly automationGuard?: (
      task: AgentTask,
    ) => Promise<string | undefined>,
  ) {}
  public async start(
    authority: ExecutionAuthority,
    requestKey: string,
    input: unknown,
  ) {
    this.authorize(authority);
    if (this.#closing || this.#running.size >= 32)
      throw new OperationError('rejected', 'task_queue_unavailable');
    if (!/^[a-zA-Z0-9_-]{1,100}$/u.test(requestKey))
      throw new OperationError('invalid_input', 'invalid_request_key');
    const parsed = agentTaskRequestSchema.safeParse(input);
    if (!parsed.success)
      throw new OperationError('invalid_input', 'invalid_task_request');
    const request = parsed.data;
    authority.require(
      request.kind === 'document'
        ? 'models.use'
        : request.kind === 'split'
          ? 'agent.split'
          : request.kind === 'tags'
            ? 'agent.tags'
            : 'agent.relations',
    );
    const identity = authority.identity;
    const taskId = deriveProcessingRunId(
      this.workspaceId,
      'agent-task:' +
        createHash('sha256')
          .update([identity.kind, identity.id, requestKey].join(':'))
          .digest('hex'),
    );
    const existing = await this.repository.read(this.workspaceId, taskId);
    if (existing) {
      if (JSON.stringify(existing.request) !== JSON.stringify(request))
        throw new OperationError('conflict', 'idempotency_conflict');
      return existing;
    }
    await this.actions.preflight(request);
    const first: AgentTaskStep =
      request.kind === 'document' || request.kind === 'split'
        ? {
            kind: 'split',
            targetId: request.snapshotId,
            attempt: 0,
            complete: false,
          }
        : request.kind === 'tags'
          ? {
              kind: 'tags',
              targetId: request.entryId,
              expectedRevision: request.expectedRevision,
              attempt: 0,
              complete: false,
            }
          : {
              kind: 'relation',
              targetId: request.entryId,
              relatedEntryId: request.relatedEntryId,
              expectedRevision: request.expectedRevision,
              expectedRelatedRevision: request.expectedRelatedRevision,
              expectedOverrideRevision: request.expectedOverrideRevision,
              attempt: 0,
              complete: false,
            };
    const now = new Date().toISOString();
    const task: AgentTask = {
      workspaceId: this.workspaceId,
      taskId,
      actorKind: identity.kind,
      actorId: identity.id,
      policyVersion: 'struinfo.agent-task.v1',
      requestKey,
      request,
      model:
        request.kind === 'document'
          ? requireOperationValue(this.actions.model)
          : 'external-agent',
      state: {
        status: 'queued',
        calls: 0,
        phase:
          request.kind === 'document' || request.kind === 'split'
            ? 'split'
            : request.kind === 'tags'
              ? 'tags'
              : 'relations',
        steps: [first],
      },
      pauseRequested: false,
      cancelRequested: false,
      version: 1,
      createdAt: now,
      updatedAt: now,
    };
    await this.repository.create(task);
    const saved = await this.read(authority, taskId);
    if (JSON.stringify(saved.request) !== JSON.stringify(request))
      throw new OperationError('conflict', 'idempotency_conflict');
    this.launch(taskId);
    return saved;
  }
  public async read(authority: ExecutionAuthority, taskId: string) {
    this.authorize(authority, false);
    assertOperationId(taskId, 'taskId');
    const task = await this.repository.read(this.workspaceId, taskId);
    if (!task || !this.visible(authority, task))
      throw new OperationError('not_found', 'task_not_found');
    return {
      ...task,
      runtimeStatus: this.#running.has(taskId)
        ? 'running'
        : this.#interrupted.has(taskId) || task.state.status === 'running'
          ? 'interrupted'
          : 'idle',
    };
  }
  public async list(authority: ExecutionAuthority) {
    this.authorize(authority, false);
    return (await this.repository.list(this.workspaceId)).filter((task) =>
      this.visible(authority, task),
    );
  }
  public async control(
    authority: ExecutionAuthority,
    taskId: string,
    expectedVersion: number,
    action: 'pause' | 'resume' | 'cancel',
  ) {
    this.authorize(authority);
    assertOperationVersion(expectedVersion, 'expectedVersion');
    const task = await this.read(authority, taskId);
    if (task.state.status === 'succeeded' || task.state.status === 'cancelled')
      throw new OperationError('conflict', 'task_terminal');
    if (action === 'resume') {
      authority.require(
        task.request.kind === 'document'
          ? 'models.use'
          : task.request.kind === 'split'
            ? 'agent.split'
            : task.request.kind === 'tags'
              ? 'agent.tags'
              : 'agent.relations',
      );
      if (task.request.kind === 'document' && task.model !== this.actions.model)
        throw new OperationError('conflict', 'task_model_changed');
    }
    if (
      !(await this.repository.control(
        this.workspaceId,
        taskId,
        expectedVersion,
        action,
      ))
    )
      throw new OperationError('conflict', 'stale_task_version');
    this.launch(taskId);
    return this.read(authority, taskId);
  }
  public async execute(taskId: string): Promise<void> {
    await this.repository.withLock(this.workspaceId, taskId, async () => {
      let task = await this.repository.read(this.workspaceId, taskId);
      if (!task || ['succeeded', 'cancelled'].includes(task.state.status))
        return;
      let state: AgentTaskState = {...task.state, status: 'running'};
      delete state.errorCode;
      const save = async () => {
        await this.repository.saveState(this.workspaceId, taskId, state);
      };
      try {
        if (
          task.request.kind === 'document' &&
          task.model !== this.actions.model
        )
          throw new OperationError('conflict', 'task_model_changed');
        await save();
        for (;;) {
          task = requireOperationValue(
            await this.repository.read(this.workspaceId, taskId),
          );
          if (task.pauseRequested || this.stopping()) {
            state = {
              ...state,
              status: task.cancelRequested ? 'cancelled' : 'paused',
            };
            await save();
            return;
          }
          const denied = await this.checkAutomation(task);
          if (denied) {
            state = {...state, status: 'paused', errorCode: denied};
            await save();
            return;
          }
          const index = state.steps.findIndex((s) => !s.complete);
          if (index < 0) {
            if (task.request.kind === 'document' && state.phase === 'split') {
              state = {
                ...state,
                phase: 'tags',
                steps: [...state.steps, ...(await this.actions.tagSteps(task))],
              };
              await save();
              continue;
            }
            if (task.request.kind === 'document' && state.phase === 'tags') {
              state = {
                ...state,
                phase: 'relations',
                steps: [
                  ...state.steps,
                  ...(await this.actions.relationSteps(task)),
                ],
              };
              await save();
              continue;
            }
            state = {...state, status: 'succeeded', phase: 'complete'};
            await save();
            return;
          }
          let step = requireOperationValue(state.steps[index]);
          let run = await this.actions.loadRun(step);
          let proposal = run?.proposals[0];
          if (!proposal) {
            if (
              task.request.kind === 'document' &&
              state.calls >= task.request.maxModelCalls
            )
              throw new OperationError(
                'rejected',
                'model_call_budget_exhausted',
              );
            if (step.attempt >= 3)
              throw new OperationError(
                'rejected',
                'step_attempt_budget_exhausted',
              );
            const attempt = step.attempt + 1;
            const key = [taskId, index, attempt].join('-');
            step = {...step, attempt, runId: this.actions.runId(step, key)};
            state = {
              ...state,
              calls: state.calls + (task.request.kind === 'document' ? 1 : 0),
              steps: state.steps.map((s, i) => (i === index ? step : s)),
            };
            await save(); // Reserve the attempt before calling the model.
            run = await this.actions.generate(task, step, key);
            proposal = run.proposals[0];
            if (!proposal)
              throw new OperationError(
                'rejected',
                safeCode(run.errorCode ?? 'proposal_generation_incomplete'),
              );
          }
          step = {...step, proposalId: proposal.proposalId};
          state = {
            ...state,
            steps: state.steps.map((s, i) => (i === index ? step : s)),
          };
          await save();
          task = requireOperationValue(
            await this.repository.read(this.workspaceId, taskId),
          );
          if (task.pauseRequested || this.stopping()) {
            state = {
              ...state,
              status: task.cancelRequested ? 'cancelled' : 'paused',
            };
            await save();
            return;
          }
          const deniedBeforeAccept = await this.checkAutomation(task);
          if (deniedBeforeAccept) {
            state = {...state, status: 'paused', errorCode: deniedBeforeAccept};
            await save();
            return;
          }
          await this.actions.accept(task, step, proposal);
          state = {
            ...state,
            steps: state.steps.map((s, i) =>
              i === index ? {...step, complete: true} : s,
            ),
          };
          await save();
        }
      } catch (error) {
        state = {
          ...state,
          status: 'failed',
          errorCode: safeCode(
            error instanceof OperationError
              ? error.code
              : typeof error === 'object' && error !== null && 'code' in error
                ? error.code
                : undefined,
          ),
        };
        await save();
      }
    });
  }
  private checkAutomation(task: AgentTask): Promise<string | undefined> {
    if (task.actorKind !== 'automation') return Promise.resolve(undefined);
    return (
      this.automationGuard?.(task) ??
      Promise.resolve('ingestion_authority_unavailable')
    );
  }
  private stopping() {
    return this.#closing;
  }
  public stop() {
    this.#closing = true;
  }
  public async drain() {
    this.#closing = true;
    await Promise.all(this.#running.values());
  }
  private launch(taskId: string) {
    if (this.#closing) throw new OperationError('rejected', 'service_stopping');
    if (this.#running.has(taskId)) return;
    // Failures in persistence leave a resumable durable task; never leak raw errors.
    this.#interrupted.delete(taskId);
    const running = this.#tail
      .then(() => this.execute(taskId))
      .catch(() => {
        this.#interrupted.add(taskId);
      })
      .finally(() => this.#running.delete(taskId));
    this.#running.set(taskId, running);
    this.#tail = running;
  }
  private authorize(authority: ExecutionAuthority, write = true) {
    if (authority.workspaceId !== this.workspaceId)
      throw new OperationError('forbidden', 'workspace_mismatch');
    authority.require(write ? 'tasks.control' : 'processing.read');
  }
  private visible(authority: ExecutionAuthority, task: AgentTask) {
    return (
      authority.identity.kind === 'owner' ||
      (task.actorKind === authority.identity.kind &&
        task.actorId === authority.identity.id)
    );
  }
}
function safeCode(value: unknown) {
  return typeof value === 'string' && /^[a-z][a-z0-9_]{0,119}$/u.test(value)
    ? value
    : 'task_execution_failed';
}
