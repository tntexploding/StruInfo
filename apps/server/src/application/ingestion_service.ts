import {
  ingestionScopeMatches,
  ingestionSettingsSchema,
  INGESTION_ACTOR_ID,
  ingestionTaskKey,
  type IngestionItem,
  type IngestionRepository,
  type IngestionTaskPort,
  type IngestionStatusQuery,
} from './ingestion_contract.js';
import {
  OperationError,
  requireOperationValue,
  assertOperationId,
  assertOperationVersion,
} from './operation_error.js';
import type {ExecutionAuthority} from './execution_authority.js';
import type {AgentTask} from './agent_task_contract.js';

export class IngestionService {
  public constructor(
    private readonly workspaceId: string,
    private readonly repository: IngestionRepository,
    private readonly tasks: IngestionTaskPort,
    private readonly model: () => string | undefined,
    private readonly subscriptions: () => Promise<
      readonly {subscriptionId: string; isPrivate: boolean}[]
    >,
  ) {}

  public async status(
    authority: ExecutionAuthority,
    query: IngestionStatusQuery = {limit: 50},
  ) {
    this.authorize(authority, false);
    const [policy, items, summary] = await Promise.all([
      this.repository.policy(),
      this.repository.list(false, query.limit + 1, query.after, query.status),
      this.repository.summary?.(),
    ]);
    const page = items.slice(0, query.limit);
    const last = page.at(-1);
    const details = await Promise.all(
      page.map(async (item) => {
        if (!item.taskId) return item;
        try {
          const task = await this.tasks.read(item.taskId);
          return {
            ...item,
            task: {
              status: task.state.status,
              phase: task.state.phase,
              calls: task.state.calls,
              completedSteps: task.state.steps.filter((s) => s.complete).length,
              totalSteps: task.state.steps.length,
              errorCode: task.state.errorCode,
            },
          };
        } catch {
          return {
            ...item,
            task: {status: 'unavailable', errorCode: 'task_read_unavailable'},
          };
        }
      }),
    );
    return {
      policy,
      modelConfigured: Boolean(this.model()),
      ...(summary ? {summary} : {}),
      items: details,
      ...(items.length > query.limit && last
        ? {nextCursor: {createdAt: last.createdAt, snapshotId: last.snapshotId}}
        : {}),
    };
  }
  public async savePolicy(
    authority: ExecutionAuthority,
    expectedRevision: number,
    input: unknown,
  ) {
    this.authorize(authority);
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0)
      throw new OperationError('invalid_input', 'invalid_policy_revision');
    const decoded = ingestionSettingsSchema.safeParse(input);
    if (!decoded.success)
      throw new OperationError('invalid_input', 'invalid_ingestion_policy');
    const settings = decoded.data;
    if (settings.enabled && !settings.paused) {
      if (!settings.model || settings.model !== this.model())
        throw new OperationError('rejected', 'ingestion_model_not_configured');
      const sources = await this.subscriptions();
      if (
        settings.subscriptionIds.some(
          (id) => !sources.some((s) => s.subscriptionId === id && !s.isPrivate),
        )
      )
        throw new OperationError(
          'invalid_input',
          'ingestion_public_subscription_required',
        );
      if (!settings.manualUploads && !settings.subscriptionIds.length)
        throw new OperationError('invalid_input', 'ingestion_scope_required');
    }
    if (authority.identity.kind === 'automation')
      throw new OperationError(
        'forbidden',
        'ingestion_policy_authority_required',
      );
    if (
      !(await this.repository.savePolicy(
        expectedRevision,
        settings,
        authority.identity,
      ))
    )
      throw new OperationError('conflict', 'stale_ingestion_policy');
    return this.repository.policy();
  }
  public async control(
    authority: ExecutionAuthority,
    snapshotId: string,
    expectedVersion: number,
    action: 'pause' | 'retry' | 'take_over',
  ) {
    this.authorize(authority);
    assertOperationId(snapshotId, 'snapshotId');
    assertOperationVersion(expectedVersion, 'expectedVersion');
    const item = requireOperationValue(await this.repository.read(snapshotId));
    if (item.status === 'completed' || item.status === 'taken_over')
      throw new OperationError('conflict', 'ingestion_item_terminal');
    const status =
      action === 'retry'
        ? 'pending'
        : action === 'pause'
          ? 'paused'
          : 'taken_over';
    if (
      !(await this.repository.update(
        snapshotId,
        expectedVersion,
        status,
        item.taskId,
      ))
    )
      throw new OperationError('conflict', 'stale_ingestion_item');
    // Queue ownership is settled first: the task guard also sees it during a model call.
    if (action === 'take_over' && item.taskId) {
      const task = await this.tasks.read(item.taskId);
      if (!['succeeded', 'cancelled'].includes(task.state.status)) {
        try {
          await this.tasks.cancel(task);
        } catch (error) {
          if (!(
            error instanceof OperationError &&
            ['stale_task_version', 'task_terminal'].includes(error.code)
          ))
            throw error;
        }
      }
    }
    return this.repository.read(snapshotId);
  }
  public async guard(task: AgentTask): Promise<string | undefined> {
    if (task.actorKind !== 'automation') return undefined;
    if (task.actorId !== INGESTION_ACTOR_ID || task.request.kind !== 'document')
      return 'ingestion_authority_invalid';
    const item = await this.repository.read(task.request.snapshotId);
    if (!item || task.requestKey !== ingestionTaskKey(item.snapshotId))
      return 'ingestion_authority_invalid';
    if (!['pending', 'running'].includes(item.status))
      return 'ingestion_item_stopped';
    const current = await this.repository.policy();
    if (!current.settings.enabled) return 'ingestion_disabled';
    if (current.settings.paused) return 'ingestion_paused';
    if (!ingestionScopeMatches(current.settings, item.origin))
      return 'ingestion_scope_removed';
    if (
      task.model !== current.settings.model ||
      task.model !== item.policy.settings.model
    )
      return 'ingestion_model_changed';
    if (
      task.request.maxEntries > current.settings.maxEntries ||
      task.request.maxRelations > current.settings.maxRelations ||
      task.request.maxModelCalls > current.settings.maxModelCalls ||
      (task.request.maxRelationCandidates ?? task.request.maxRelations) >
        (current.settings.maxRelationCandidates ??
          current.settings.maxRelations) ||
      JSON.stringify(task.request.intake) !==
        JSON.stringify(current.settings.intake)
    )
      return 'ingestion_budget_changed';
    return undefined;
  }
  public async poll(): Promise<void> {
    await this.repository.withPollLock(async () => {
      for (const item of await this.repository.list(true, 25)) {
        try {
          await this.advance(item);
        } catch (error) {
          const current = await this.repository.read(item.snapshotId);
          if (current && ['pending', 'running'].includes(current.status))
            await this.repository.update(
              current.snapshotId,
              current.version,
              'attention',
              current.taskId,
              error instanceof OperationError
                ? error.code
                : 'ingestion_processing_failed',
            );
        }
      }
    });
  }
  private async advance(item: IngestionItem) {
    const current = await this.repository.policy();
    const ready =
      current.settings.enabled &&
      !current.settings.paused &&
      ingestionScopeMatches(current.settings, item.origin) &&
      current.settings.model === this.model();
    if (item.taskId) {
      const task = await this.tasks.read(item.taskId);
      if (task.state.status === 'succeeded') {
        await this.repository.update(
          item.snapshotId,
          item.version,
          'completed',
          task.taskId,
        );
      } else if (task.state.status === 'cancelled') {
        await this.repository.update(
          item.snapshotId,
          item.version,
          'taken_over',
          task.taskId,
        );
      } else if (task.runtimeStatus !== 'running') {
        // The model price scheduler owns these waits; they are not failed intake.
        if (
          task.state.errorCode === 'ai_price_window_closed' &&
          !task.pauseRequested
        )
          return;
        const blocked = await this.guard(task);
        const needsPolicyReview = Boolean(
          current.settings.enabled && !current.settings.paused && blocked,
        );
        if (
          ready &&
          !blocked &&
          (!task.pauseRequested || item.status === 'pending') &&
          (item.status === 'pending' ||
            ['queued', 'running'].includes(task.state.status) ||
            [
              'ingestion_paused',
              'ingestion_disabled',
              'ingestion_scope_removed',
              'ingestion_item_stopped',
            ].includes(task.state.errorCode ?? ''))
        ) {
          await this.tasks.resume(task);
          await this.repository.update(
            item.snapshotId,
            item.version,
            'running',
            task.taskId,
          );
        } else if (
          needsPolicyReview ||
          task.state.status === 'failed' ||
          task.pauseRequested ||
          (task.state.status === 'paused' &&
            !task.state.errorCode?.startsWith('ingestion_'))
        ) {
          await this.repository.update(
            item.snapshotId,
            item.version,
            'attention',
            task.taskId,
            needsPolicyReview
              ? blocked
              : (task.state.errorCode ?? 'task_paused'),
          );
        }
      }
      return;
    }
    if (
      current.settings.enabled &&
      !current.settings.paused &&
      !ingestionScopeMatches(current.settings, item.origin)
    )
      throw new OperationError('conflict', 'ingestion_scope_removed');
    if (!ready) return;
    if (item.policy.settings.model !== current.settings.model)
      throw new OperationError('conflict', 'ingestion_model_changed');
    if (
      item.policy.settings.maxEntries > current.settings.maxEntries ||
      item.policy.settings.maxRelations > current.settings.maxRelations ||
      item.policy.settings.maxModelCalls > current.settings.maxModelCalls ||
      (item.policy.settings.maxRelationCandidates ??
        item.policy.settings.maxRelations) >
        (current.settings.maxRelationCandidates ??
          current.settings.maxRelations) ||
      JSON.stringify(item.policy.settings.intake) !==
        JSON.stringify(current.settings.intake)
    )
      throw new OperationError('conflict', 'ingestion_budget_changed');
    if (
      !(await this.repository.reserve(
        item.snapshotId,
        current.settings.maxDocumentsPerDay,
      ))
    ) {
      if (item.errorCode !== 'daily_document_budget_reached')
        await this.repository.update(
          item.snapshotId,
          item.version,
          'pending',
          undefined,
          'daily_document_budget_reached',
        );
      return;
    }
    const reserved = requireOperationValue(
      await this.repository.read(item.snapshotId),
    );
    if (!['pending', 'running'].includes(reserved.status)) return;
    const task = await this.tasks.start(item.snapshotId, item.policy);
    await this.repository.update(
      item.snapshotId,
      reserved.version,
      'running',
      task.taskId,
    );
  }
  private authorize(authority: ExecutionAuthority, write = true) {
    if (authority.workspaceId !== this.workspaceId)
      throw new OperationError('forbidden', 'workspace_mismatch');
    authority.require(write ? 'ingestion.manage' : 'processing.read');
  }
}
