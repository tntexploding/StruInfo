import {withSourceProcessing} from './source_processing_scope.js';
import {createHash} from 'node:crypto';
import {AiWorkQueue} from './ai_work_queue.js';
import {isNoRelationRun} from '../modules/processing/ai_association_proposal.js';
import {deriveProcessingRunId} from '../modules/processing/processing_identity.js';
import {
  AI_PRICE_WAIT,
  AI_OPERATIONS_PAUSED,
  isAiDispatchWait,
} from '../modules/processing/ai_price_policy.js';
import {
  agentTaskRequestSchema,
  DOCUMENT_WORKFLOW,
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
  readonly #queue: AiWorkQueue;
  public constructor(
    private readonly workspaceId: string,
    private readonly repository: AgentTaskRepository,
    private readonly actions: AgentTaskActions,
    private readonly automationGuard?: (
      task: AgentTask,
    ) => Promise<string | undefined>,
    private readonly priceGate?: {
      check: () => Promise<void>;
      checkOperations?: () => Promise<void>;
      canResume: (task: AgentTask) => boolean | Promise<boolean>;
      executionSettings?: () => Promise<{
        maxConcurrentRequests: number;
        automaticRetryLimit: number;
      }>;
    },
  ) {
    this.#queue = new AiWorkQueue(
      async () =>
        (await this.priceGate?.executionSettings?.())?.maxConcurrentRequests ??
        1,
    );
  }
  public async start(
    authority: ExecutionAuthority,
    requestKey: string,
    input: unknown,
  ) {
    this.authorize(authority);
    if (this.#closing)
      throw new OperationError('rejected', 'task_queue_unavailable');
    if (!/^[a-zA-Z0-9_-]{1,100}$/u.test(requestKey))
      throw new OperationError('invalid_input', 'invalid_request_key');
    const parsed = agentTaskRequestSchema.safeParse(input);
    if (!parsed.success)
      throw new OperationError('invalid_input', 'invalid_task_request');
    const request = parsed.data;
    if (
      request.kind === 'document' &&
      request.reprocess &&
      (authority.identity.kind !== 'owner' ||
        request.intake ||
        request.maxRelations !== 0 ||
        request.maxRelationCandidates)
    )
      throw new OperationError('forbidden', 'operation_not_authorized');
    authority.require(
      request.kind === 'document' || request.kind === 'intake'
        ? 'models.use'
        : request.kind === 'split'
          ? 'agent.split'
          : request.kind === 'tags'
            ? 'agent.tags'
            : 'agent.relations',
    );
    if (
      request.kind === 'intake' ||
      (authority.identity.kind === 'external_agent' &&
        (await this.actions.requiresReceiptAcceptance(request)))
    )
      authority.require('ingestion.manage');
    if (
      (request.kind === 'document' || request.kind === 'intake') &&
      request.intake?.fetchFullText &&
      authority.identity.kind === 'external_agent'
    )
      authority.require('sources.capture');
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
      request.kind === 'document' ||
      request.kind === 'split' ||
      request.kind === 'intake'
        ? {
            kind:
              (request.kind === 'document' || request.kind === 'intake') &&
              request.intake
                ? 'intake'
                : 'split',
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
    const sourceSplit = await this.actions.freezeSourceSplit(request);
    const retryLimit =
      (await this.priceGate?.executionSettings?.())?.automaticRetryLimit ?? 0;
    const task: AgentTask = {
      workspaceId: this.workspaceId,
      taskId,
      actorKind: identity.kind,
      actorId: identity.id,
      policyVersion: 'struinfo.agent-task.v1',
      requestKey,
      request,
      model:
        request.kind === 'document' || request.kind === 'intake'
          ? requireOperationValue(
              request.kind === 'intake'
                ? this.actions.intakeModel
                : this.actions.model,
            )
          : 'external-agent',
      state: {
        ...(request.kind === 'document' ? {workflow: DOCUMENT_WORKFLOW} : {}),
        ...(sourceSplit ? {sourceSplit} : {}),
        // Relation verification remains readable for existing checkpoints, but
        // its semantic trial did not qualify it as a default for new tasks.
        ...(request.kind === 'document' && retryLimit > 0
          ? {automaticRetry: {limit: retryLimit, used: 0}}
          : {}),
        status: 'queued',
        calls: 0,
        phase:
          request.kind === 'document' ||
          request.kind === 'split' ||
          request.kind === 'intake'
            ? (request.kind === 'document' || request.kind === 'intake') &&
              request.intake
              ? 'intake'
              : 'split'
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
    const initialized: AgentTask =
      request.kind === 'document' && request.reprocess === 'tags'
        ? {
            ...task,
            state: {
              ...task.state,
              phase: 'tags',
              steps: await this.actions.tagSteps(task),
            },
          }
        : task;
    await this.repository.create(initialized);
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
  public async list(
    authority: ExecutionAuthority,
    snapshotIds?: readonly string[],
    prioritizeActive = false,
  ) {
    this.authorize(authority, false);
    if (snapshotIds !== undefined) {
      if (snapshotIds.length < 1 || snapshotIds.length > 50)
        throw new OperationError('invalid_input', 'invalid_snapshot_scope');
      snapshotIds.forEach((id) => {
        assertOperationId(id, 'snapshotId');
      });
    }
    return (
      await this.repository.list(
        this.workspaceId,
        snapshotIds,
        prioritizeActive,
      )
    )
      .filter(
        (task) =>
          this.visible(authority, task) &&
          (snapshotIds === undefined ||
            ('snapshotId' in task.request &&
              snapshotIds.includes(task.request.snapshotId))),
      )
      .map((task) => ({
        ...task,
        runtimeStatus: this.#running.has(task.taskId)
          ? 'running'
          : this.#interrupted.has(task.taskId) ||
              task.state.status === 'running'
            ? 'interrupted'
            : 'idle',
      }));
  }
  public async latestDocuments(authority: ExecutionAuthority) {
    this.authorize(authority, false);
    const tasks = this.repository.listPublicationTasks
      ? await this.repository.listPublicationTasks(this.workspaceId)
      : await this.repository.list(this.workspaceId);
    return tasks
      .filter((task) => this.visible(authority, task))
      .map((task) => ({
        ...task,
        runtimeStatus: this.#running.has(task.taskId)
          ? ('running' as const)
          : ('idle' as const),
      }));
  }
  /** A new owner-authorized round preserves the failed record and completed checkpoints. */
  public async restart(
    authority: ExecutionAuthority,
    taskId: string,
    expectedVersion: number,
  ) {
    this.authorize(authority);
    authority.require('models.use');
    if (authority.identity.kind !== 'owner')
      throw new OperationError('forbidden', 'operation_not_authorized');
    assertOperationId(taskId, 'taskId');
    assertOperationVersion(expectedVersion, 'expectedVersion');
    if (this.#closing)
      throw new OperationError('rejected', 'task_queue_unavailable');
    const nextId = deriveProcessingRunId(
      this.workspaceId,
      'agent-task-restart:' + taskId,
    );
    const saved = await this.repository.withLock(
      this.workspaceId,
      taskId,
      async () => {
        const task = await this.read(authority, taskId);
        assertCurrentDocumentWorkflow(task);
        if (task.state.supersededBy)
          return this.read(authority, task.state.supersededBy);
        if (task.version !== expectedVersion)
          throw new OperationError('conflict', 'stale_task_version');
        if (!taskNeedsRestart(task))
          throw new OperationError('rejected', 'task_restart_not_required');
        if (this.#running.has(taskId))
          throw new OperationError('conflict', 'task_busy');
        if (task.model !== this.actions.model)
          throw new OperationError('conflict', 'task_model_changed');
        await this.actions.validateRecovery(task);
        const existing = await this.repository.read(this.workspaceId, nextId);
        const next: AgentTask = existing ?? {
          ...task,
          taskId: nextId,
          actorKind: 'owner',
          actorId: authority.identity.id,
          requestKey: 'restart-' + taskId,
          state: {
            workflow: DOCUMENT_WORKFLOW,
            ...(task.state.sourceSplit
              ? {sourceSplit: task.state.sourceSplit}
              : {}),
            status: 'queued',
            calls: 0,
            phase: task.state.phase,
            recovery: {
              previousTaskId: taskId,
              firstStartedAt:
                task.state.recovery?.firstStartedAt ?? task.createdAt,
              previousCalls:
                (task.state.recovery?.previousCalls ?? 0) + task.state.calls,
            },
            steps: task.state.steps.map((step) =>
              step.complete
                ? {...step}
                : {
                    ...step,
                    attempt: 0,
                    ...(step.reviewAttempt !== undefined
                      ? {reviewAttempt: 0}
                      : {}),
                  },
            ),
          },
          pauseRequested: false,
          cancelRequested: false,
          version: 1,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
        await this.repository.create(next);
        await this.repository.saveState(this.workspaceId, taskId, {
          ...task.state,
          supersededBy: nextId,
        });
        return next;
      },
    );
    // Returning an existing round is idempotent, not a request to resume its later failure.
    if (saved.state.status === 'queued') this.launch(saved.taskId);
    return this.read(authority, saved.taskId);
  }
  public async control(
    authority: ExecutionAuthority,
    taskId: string,
    expectedVersion: number,
    action: 'pause' | 'resume' | 'cancel',
    regenerateSplit = false,
  ): Promise<Awaited<ReturnType<AgentTaskService['read']>>> {
    this.authorize(authority);
    if (regenerateSplit) {
      if (action !== 'resume' || authority.identity.kind !== 'owner')
        throw new OperationError('forbidden', 'split_replan_owner_required');
      authority.require('models.use');
      const version = await this.replanSplit(
        authority,
        taskId,
        expectedVersion,
      );
      return this.control(authority, taskId, version, 'resume');
    }
    assertOperationVersion(expectedVersion, 'expectedVersion');
    const task = await this.read(authority, taskId);
    if (task.state.supersededBy)
      throw new OperationError('conflict', 'task_superseded');
    if (task.state.status === 'succeeded' || task.state.status === 'cancelled')
      throw new OperationError('conflict', 'task_terminal');
    if (action === 'resume') {
      assertCurrentDocumentWorkflow(task);
      authority.require(
        task.request.kind === 'document' || task.request.kind === 'intake'
          ? 'models.use'
          : task.request.kind === 'split'
            ? 'agent.split'
            : task.request.kind === 'tags'
              ? 'agent.tags'
              : 'agent.relations',
      );
      if (
        task.request.kind === 'intake' ||
        (authority.identity.kind === 'external_agent' &&
          (await this.actions.requiresReceiptAcceptance(task.request)))
      )
        authority.require('ingestion.manage');
      if (
        (task.request.kind === 'document' || task.request.kind === 'intake') &&
        task.request.intake?.fetchFullText &&
        authority.identity.kind === 'external_agent'
      )
        authority.require('sources.capture');
      if (
        (task.request.kind === 'document' || task.request.kind === 'intake') &&
        task.model !==
          (task.request.kind === 'intake'
            ? this.actions.intakeModel
            : this.actions.model)
      )
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
  private async replanSplit(
    authority: ExecutionAuthority,
    taskId: string,
    expectedVersion: number,
  ) {
    return this.repository.withLock(this.workspaceId, taskId, async () => {
      const task = await this.read(authority, taskId);
      assertCurrentDocumentWorkflow(task);
      if (task.version !== expectedVersion)
        throw new OperationError('conflict', 'stale_task_version');
      const index = task.state.steps.findIndex((s) => !s.complete);
      const step = task.state.steps[index];
      if (
        task.request.kind !== 'document' ||
        task.state.status !== 'failed' ||
        task.cancelRequested ||
        task.pauseRequested ||
        task.state.supersededBy ||
        task.state.errorCode !== 'insufficient_document_call_budget' ||
        step?.kind !== 'split' ||
        !step.runId ||
        step.attempt >= 3 ||
        task.state.calls >= task.request.maxModelCalls ||
        (step.previousRunIds?.length ?? 0) >= 3
      )
        throw new OperationError('rejected', 'split_replan_unavailable');
      const run = await this.actions.loadRun(step);
      if (run?.proposals[0]?.status !== 'pending_review')
        throw new OperationError('conflict', 'split_replan_unavailable');
      await this.actions.validateRecovery(task);
      const next = {
        ...step,
        previousRunIds: [...(step.previousRunIds ?? []), step.runId],
      };
      delete next.runId;
      delete next.proposalId;
      await this.repository.saveState(this.workspaceId, taskId, {
        ...task.state,
        steps: task.state.steps.map((s, i) => (i === index ? next : s)),
        errorCode: 'split_replanned',
      });
      return (await this.read(authority, taskId)).version;
    });
  }
  public async execute(taskId: string): Promise<void> {
    const task = await this.repository.read(this.workspaceId, taskId);
    return withSourceProcessing(
      task?.state.sourceSplit?.processingProfile,
      () => this.executeScoped(taskId),
    );
  }
  private async executeScoped(taskId: string): Promise<void> {
    await this.repository.withLock(this.workspaceId, taskId, async () => {
      let task = await this.repository.read(this.workspaceId, taskId);
      if (
        !task ||
        task.state.supersededBy ||
        ['succeeded', 'cancelled'].includes(task.state.status)
      )
        return;
      let state: AgentTaskState = {...task.state, status: 'running'};
      if (isLegacyDocumentTask(task)) {
        await this.repository.saveState(this.workspaceId, taskId, {
          ...task.state,
          status: task.cancelRequested ? 'cancelled' : 'paused',
          errorCode: 'legacy_document_task',
        });
        return;
      }
      let unsentAttempt: AgentTaskState | undefined;
      delete state.errorCode;
      const save = async () => {
        await this.repository.saveState(this.workspaceId, taskId, state);
      };
      try {
        if (
          (task.request.kind === 'document' ||
            task.request.kind === 'intake') &&
          task.model !==
            (task.request.kind === 'intake'
              ? this.actions.intakeModel
              : this.actions.model)
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
            if (
              task.request.kind === 'document' &&
              task.request.reprocess === 'tags'
            ) {
              await this.actions.validateCompletion(task);
              await this.actions.publish(task);
              state = {
                ...clearRetryWait(state),
                status: 'succeeded',
                phase: 'complete',
              };
              await save();
              return;
            }
            if (task.request.kind === 'document' && state.phase === 'intake') {
              state = {
                ...state,
                phase: 'split',
                steps: [
                  ...state.steps,
                  {
                    kind: 'split',
                    targetId: await this.actions.intakeTarget(task),
                    attempt: 0,
                    complete: false,
                  },
                ],
              };
              await save();
              continue;
            }
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
              state = {...state, phase: 'publish'};
              await save();
              continue;
            }
            if (task.request.kind === 'document') {
              await this.actions.validateCompletion(task);
              await this.actions.publish(task);
            }
            state = {
              ...clearRetryWait(state),
              status: 'succeeded',
              phase: 'complete',
            };
            await save();
            return;
          }
          let step = requireOperationValue(state.steps[index]);
          if (
            step.kind === 'recall' ||
            (task.request.kind === 'document' && step.kind === 'relation')
          )
            throw new OperationError('rejected', 'legacy_document_task');
          if (step.kind === 'intake') {
            if (
              task.request.kind === 'document' &&
              step.receiptVersion !== undefined &&
              !(await this.actions.reviewCheckpointCurrent(
                task,
                step.receiptVersion,
              ))
            ) {
              step = {...step};
              delete step.receiptVersion;
            }
            const needsCall =
              step.receiptVersion === undefined &&
              (await this.actions.prepareIntake(task));
            const currentTask = requireOperationValue(
              await this.repository.read(this.workspaceId, taskId),
            );
            const guard = await this.checkAutomation(currentTask);
            if (currentTask.pauseRequested || this.stopping() || guard) {
              state = {
                ...state,
                status: currentTask.cancelRequested ? 'cancelled' : 'paused',
                ...(guard ? {errorCode: guard} : {}),
              };
              await save();
              return;
            }
            if (needsCall) {
              await this.priceGate?.check();
              if (
                (task.request.kind !== 'document' &&
                  task.request.kind !== 'intake') ||
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
              unsentAttempt = structuredClone(state);
              state = clearRetryWait(state);
              step = {...step, attempt: step.attempt + 1};
              state = {
                ...state,
                calls: state.calls + 1,
                steps: state.steps.map((s, i) => (i === index ? step : s)),
              };
              await save();
              const reviewedVersion = await this.actions.reviewIntake(task);
              if (reviewedVersion !== undefined)
                step = {...step, receiptVersion: reviewedVersion};
              unsentAttempt = undefined;
            }
            if (task.request.kind === 'intake') {
              if (step.receiptVersion === undefined)
                step = {
                  ...step,
                  receiptVersion: await this.actions.receiptVersion(task),
                };
              state = {
                ...state,
                steps: state.steps.map((s, i) => (i === index ? step : s)),
              };
              await save();
              const current = requireOperationValue(
                await this.repository.read(this.workspaceId, taskId),
              );
              const receiptGuard = await this.checkAutomation(current);
              if (current.pauseRequested || this.stopping() || receiptGuard) {
                state = {
                  ...state,
                  status: current.cancelRequested ? 'cancelled' : 'paused',
                  ...(receiptGuard ? {errorCode: receiptGuard} : {}),
                };
                await save();
                return;
              }
              step = {
                ...step,
                outcome: await this.actions.acceptReceipt(
                  task,
                  requireOperationValue(step.receiptVersion),
                ),
              };
            } else if (step.kind === 'intake') {
              state = {
                ...state,
                steps: state.steps.map((s, i) => (i === index ? step : s)),
              };
              await save();
              const current = requireOperationValue(
                await this.repository.read(this.workspaceId, taskId),
              );
              const guard = await this.checkAutomation(current);
              if (current.pauseRequested || this.stopping() || guard) {
                state = {
                  ...state,
                  status: current.cancelRequested ? 'cancelled' : 'paused',
                  ...(guard ? {errorCode: guard} : {}),
                };
                await save();
                return;
              }
              await this.actions.finishDocumentIntake(
                task,
                step.receiptVersion,
              );
            }
            state = {
              ...state,
              steps: state.steps.map((s, i) =>
                i === index ? {...step, complete: true} : s,
              ),
            };
            await save();
            continue;
          }
          if (
            task.request.kind === 'document' &&
            step.kind === 'split' &&
            state.sourceSplit &&
            !step.runId &&
            step.attempt === 0
          ) {
            if (!step.sourceSplit) {
              step = {
                ...step,
                sourceSplit: await this.actions.decideSourceSplit(task, step),
              };
              state = {
                ...state,
                steps: state.steps.map((s, i) => (i === index ? step : s)),
              };
              await save();
              continue;
            }
            if (step.sourceSplit.outcome === 'review')
              throw new OperationError('rejected', step.sourceSplit.reason);
            if (step.sourceSplit.outcome === 'rule') {
              await this.actions.applySourceSplit(task, step);
              state = {
                ...state,
                steps: state.steps.map((s, i) =>
                  i === index ? {...step, complete: true} : s,
                ),
              };
              await save();
              continue;
            }
          }
          let run = await this.actions.loadRun(step);
          let proposal = run?.proposals[0];
          let noRelation =
            task.request.kind === 'document' &&
            step.kind === 'relation' &&
            isNoRelationRun(run);
          if (!proposal && !noRelation) {
            if (task.request.kind === 'document') await this.priceGate?.check();
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
            const tagGroup =
              task.request.kind === 'document' && step.kind === 'tags'
                ? await this.actions.tagGroup({...task, state}, step)
                : [step];
            if (tagGroup.length > 1) {
              const taskVersion = task.version;
              const keys = new Map(
                tagGroup.map((member) => [
                  member.targetId,
                  [
                    taskId,
                    state.steps.findIndex(
                      (candidate) =>
                        candidate.kind === 'tags' &&
                        candidate.targetId === member.targetId,
                    ),
                    member.attempt + 1,
                    taskVersion,
                  ].join('-'),
                ]),
              );
              const reserved = new Map(
                tagGroup.map((member) => [
                  member.targetId,
                  {
                    ...member,
                    attempt: member.attempt + 1,
                    runId: this.actions.runId(
                      member,
                      requireOperationValue(keys.get(member.targetId)),
                    ),
                  },
                ]),
              );
              unsentAttempt = structuredClone(state);
              state = {
                ...clearRetryWait(state),
                calls: state.calls + 1,
                steps: state.steps.map((member) =>
                  member.kind === 'tags'
                    ? (reserved.get(member.targetId) ?? member)
                    : member,
                ),
              };
              await save();
              const results = await this.actions.generateTagGroup(
                [...reserved.values()],
                keys,
              );
              if (
                results.length !== tagGroup.length ||
                results.some(
                  ({run: generated}, i) =>
                    generated.runId !==
                      reserved.get(tagGroup[i]?.targetId ?? '')?.runId ||
                    !generated.proposals.length,
                )
              )
                throw new OperationError(
                  'rejected',
                  safeCode(
                    results.find(
                      ({run: generated}) => !generated.proposals.length,
                    )?.run.errorCode ?? 'proposal_generation_incomplete',
                  ),
                );
              unsentAttempt = undefined;
              // The next loop loads the saved runs and checks pause/manual state
              // before accepting each Entry. No extra model call is made.
              continue;
            }
            // A price-only deferral can retry without reusing its aborted run identity.
            const key = [taskId, index, attempt, task.version].join('-');
            unsentAttempt = structuredClone(state);
            state = clearRetryWait(state);
            step = {...step, attempt, runId: this.actions.runId(step, key)};
            state = {
              ...state,
              calls: state.calls + (task.request.kind === 'document' ? 1 : 0),
              steps: state.steps.map((s, i) => (i === index ? step : s)),
            };
            await save(); // Reserve the attempt before calling the model.
            run = await this.actions.generate(task, step, key);
            proposal = run.proposals[0];
            noRelation =
              task.request.kind === 'document' &&
              step.kind === 'relation' &&
              isNoRelationRun(run);
            if (!proposal && !noRelation)
              throw new OperationError(
                'rejected',
                safeCode(run.errorCode ?? 'proposal_generation_incomplete'),
              );
            unsentAttempt = undefined;
          }
          step = {
            ...step,
            ...(proposal ? {proposalId: proposal.proposalId} : {}),
            ...(noRelation ? {outcome: 'no_relation' as const} : {}),
          };
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
          if (
            task.request.kind === 'document' &&
            step.kind === 'split' &&
            proposal?.splitPayload &&
            proposal.status !== 'accepted'
          ) {
            const tags = await this.actions.tagCallEstimate(proposal);
            if (state.calls + tags > task.request.maxModelCalls)
              throw new OperationError(
                'rejected',
                'insufficient_document_call_budget',
              );
          }
          if (proposal) await this.actions.accept(task, step, proposal);
          state = {
            ...state,
            steps: state.steps.map((s, i) =>
              i === index ? {...step, complete: true} : s,
            ),
          };
          await save();
        }
      } catch (error) {
        if (isAiDispatchWait(error)) {
          state = {
            ...(unsentAttempt ?? state),
            status: 'paused',
            errorCode: error.code,
          };
          await save();
          return;
        }
        state = {
          ...state,
          status:
            (error instanceof OperationError &&
              [
                'intake_held',
                'intake_blocked',
                'ai_relation_review_uncertain',
              ].includes(error.code)) ||
            (error instanceof OperationError &&
              state.steps.some(
                (s) => !s.complete && s.sourceSplit?.outcome === 'review',
              ))
              ? 'paused'
              : 'failed',
          errorCode: safeCode(
            error instanceof OperationError
              ? error.code
              : typeof error === 'object' && error !== null && 'code' in error
                ? error.code
                : undefined,
          ),
        };
        const retry = state.automaticRetry;
        const retryLimit =
          (await this.priceGate?.executionSettings?.())?.automaticRetryLimit ??
          0;
        if (
          task.request.kind === 'document' &&
          state.status === 'failed' &&
          retry &&
          retry.used < Math.min(retry.limit, retryLimit) &&
          retryableModelFailure(state.errorCode) &&
          state.calls < task.request.maxModelCalls &&
          !state.steps.some((s) => !s.complete && s.attempt >= 3)
        ) {
          state = {
            ...state,
            status: 'paused',
            automaticRetry: {
              ...retry,
              used: retry.used + 1,
              notBefore: new Date(
                Date.now() + 60000 * 2 ** retry.used,
              ).toISOString(),
            },
          };
        }
        await save();
      }
    });
  }
  private async checkAutomation(task: AgentTask): Promise<string | undefined> {
    if (task.request.kind === 'document' || task.request.kind === 'intake')
      await this.priceGate?.checkOperations?.();
    const intake = await this.actions.guard(task);
    if (intake) return intake;
    if (task.actorKind !== 'automation') return Promise.resolve(undefined);
    return (
      this.automationGuard?.(task) ??
      Promise.resolve('ingestion_authority_unavailable')
    );
  }
  private stopping() {
    return this.#closing;
  }
  /** Resume dispatch waits and explicitly budgeted retries; manual pauses stay held. */
  public async pollPriceDeferred() {
    if (this.#closing || !this.priceGate) return;
    try {
      await this.priceGate.check();
    } catch (error) {
      if (isAiDispatchWait(error)) return;
      throw error;
    }
    const tasks = this.repository.listPriceDeferred
      ? await this.repository.listPriceDeferred(this.workspaceId)
      : await this.repository.list(this.workspaceId);
    const retries = this.repository.listRetryDeferred
      ? await this.repository.listRetryDeferred(this.workspaceId)
      : await this.repository.list(this.workspaceId);
    const settings = await this.priceGate.executionSettings?.();
    for (const task of new Map(
      [...tasks, ...retries].map((t) => [t.taskId, t]),
    ).values()) {
      if (isLegacyDocumentTask(task)) continue;
      if (this.#running.size >= 32) break;
      const retry = task.state.automaticRetry;
      if (
        task.request.kind === 'document' &&
        task.state.status === 'paused' &&
        retry?.notBefore &&
        (retryableModelFailure(task.state.errorCode) ||
          task.state.errorCode === AI_PRICE_WAIT ||
          task.state.errorCode === AI_OPERATIONS_PAUSED) &&
        Date.parse(retry.notBefore) <= Date.now() &&
        retry.used <=
          Math.min(retry.limit, settings?.automaticRetryLimit ?? 0) &&
        !task.pauseRequested &&
        !task.cancelRequested &&
        !task.state.supersededBy &&
        task.state.calls < task.request.maxModelCalls &&
        (await this.priceGate.canResume(task))
      ) {
        this.launch(task.taskId, true);
        continue;
      }
      if (retry?.notBefore) {
        continue;
      }
      if (
        (task.request.kind === 'document' || task.request.kind === 'intake') &&
        task.state.status === 'paused' &&
        (task.state.errorCode === AI_PRICE_WAIT ||
          task.state.errorCode === AI_OPERATIONS_PAUSED) &&
        !task.pauseRequested &&
        !task.cancelRequested
      ) {
        if (await this.priceGate.canResume(task)) this.launch(task.taskId);
        else
          await this.repository.withLock(
            this.workspaceId,
            task.taskId,
            async () => {
              const current = await this.repository.read(
                this.workspaceId,
                task.taskId,
              );
              if (current?.version === task.version)
                await this.repository.saveState(this.workspaceId, task.taskId, {
                  ...current.state,
                  status: 'paused',
                  errorCode: 'task_authority_changed',
                });
            },
          );
      }
    }
  }
  public stop() {
    this.#closing = true;
  }
  public async drain() {
    this.#closing = true;
    await Promise.all(this.#running.values());
  }
  private launch(taskId: string, automaticRetry = false) {
    if (this.#closing) throw new OperationError('rejected', 'service_stopping');
    if (this.#running.has(taskId)) return;
    // Failures in persistence leave a resumable durable task; never leak raw errors.
    this.#interrupted.delete(taskId);
    const running = this.#queue
      .run(async () => {
        if (automaticRetry) {
          const current = await this.repository.read(this.workspaceId, taskId);
          const settings = await this.priceGate?.executionSettings?.();
          if (
            !current?.state.automaticRetry?.notBefore ||
            current.pauseRequested ||
            current.cancelRequested ||
            current.state.automaticRetry.used >
              (settings?.automaticRetryLimit ?? 0)
          )
            return;
        }
        await this.execute(taskId);
      })
      .catch(() => {
        this.#interrupted.add(taskId);
      })
      .finally(() => this.#running.delete(taskId));
    this.#running.set(taskId, running);
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

export function taskNeedsRestart(task: AgentTask): boolean {
  if (
    isLegacyDocumentTask(task) ||
    task.request.kind !== 'document' ||
    task.state.status !== 'failed' ||
    task.state.supersededBy
  )
    return false;
  const code = task.state.errorCode ?? '';
  const retryable =
    code.startsWith('ai_provider_') ||
    [
      'model_call_budget_exhausted',
      'step_attempt_budget_exhausted',
      'proposal_generation_incomplete',
      'task_execution_failed',
    ].includes(code);
  return (
    retryable &&
    (task.state.calls >= task.request.maxModelCalls ||
      task.state.steps.some(
        (step) =>
          !step.complete &&
          (step.attempt >= 3 || (step.reviewAttempt ?? 0) >= 3),
      ))
  );
}

function retryableModelFailure(code: string | undefined): boolean {
  return [
    'ai_provider_timeout',
    'ai_provider_unavailable',
    'ai_provider_invalid_response',
    'ai_provider_invalid_envelope',
    'ai_provider_invalid_json',
    'ai_provider_invalid_schema',
    'proposal_generation_incomplete',
  ].includes(code ?? '');
}

function clearRetryWait(state: AgentTaskState): AgentTaskState {
  if (!state.automaticRetry?.notBefore) return state;
  const automaticRetry = {...state.automaticRetry};
  delete automaticRetry.notBefore;
  return {...state, automaticRetry};
}
export function isLegacyDocumentTask(task: AgentTask): boolean {
  return (
    task.request.kind === 'document' &&
    task.state.workflow !== DOCUMENT_WORKFLOW
  );
}

function assertCurrentDocumentWorkflow(task: AgentTask) {
  if (isLegacyDocumentTask(task))
    throw new OperationError('rejected', 'legacy_document_task');
}
