import {createHash, randomUUID} from 'node:crypto';
import {z} from 'zod';
import {OperationError} from './operation_error.js';
import {isAiDispatchWait} from '../modules/processing/ai_price_policy.js';
import {
  describeAssistantTool,
  parseAssistantTool,
  type AssistantTools,
} from './assistant_tools.js';
import {
  assistantStepSchema,
  sessionIdentitySchema,
  type AssistantProvider,
  type AssistantSessionStore,
  type AssistantSession,
  type AssistantTurn,
  type AssistantEvent,
} from './assistant_session.js';
const sessionId = z.string().regex(/^[a-f0-9]{64}$/u),
  id = z.uuid();
const selected = z.object({sessionId}).strict();
const askSchema = selected.extend({
  messageId: z.string().trim().min(1).max(160),
  message: z.string().trim().min(1).max(8000),
  timeZone: z.string().max(80).default('UTC'),
});
const invokeSchema = selected.extend({
  messageId: z.string().trim().min(1).max(160),
  operation: z.string().max(100),
  input: z.unknown(),
});
const decisionSchema = selected.extend({turnId: id, confirmationId: id});
const MAX_STEPS = 16,
  MAX_MODEL_CALLS = 12;

/** Web and message clients share persisted sessions and application tools. */
export class SystemAssistant {
  private readonly active = new Map<string, Promise<void>>();
  private readonly stops = new Set<string>();
  private ingress: Promise<unknown> = Promise.resolve();
  constructor(
    private readonly deps: {
      store: AssistantSessionStore;
      tools: AssistantTools;
      provider?: AssistantProvider;
      checkModelCall: () => Promise<void>;
      now?: () => Date;
    },
  ) {}
  private now() {
    return this.deps.now?.() ?? new Date();
  }
  private event(
    s: AssistantSession,
    t: AssistantTurn,
    event: Omit<AssistantEvent, 'sequence' | 'at'>,
  ) {
    const sequence =
      s.turns.reduce(
        (max, turn) => Math.max(max, turn.events.at(-1)?.sequence ?? 0),
        0,
      ) + 1;
    t.events.push({...event, sequence, at: this.now().toISOString()});
  }
  private save(s: AssistantSession) {
    s.updatedAt = this.now().toISOString();
    return this.deps.store.save(s, s.version);
  }
  private async session(key: string) {
    const session = await this.deps.store.read(key);
    if (!session)
      throw new OperationError('not_found', 'assistant_session_not_found');
    const turn = session.turns.at(-1);
    if (turn?.status === 'running' && !this.active.has(key)) {
      turn.status = 'interrupted';
      turn.uncertain = turn.inFlight?.effect === 'change';
      this.event(session, turn, {
        kind: 'error',
        text: turn.uncertain
          ? '执行中断。上一步修改结果待核对，不会自动重发。'
          : '执行中断。可从已保存的结果继续。',
      });
      await this.save(session);
    }
    return session;
  }
  private view(s: AssistantSession) {
    return {
      sessionId: s.id,
      channel: s.channel,
      conversationId: s.conversationId,
      updatedAt: s.updatedAt,
      messages: s.turns.slice(-20).map((t) => ({
        id: t.id,
        message: t.message,
        status: t.status,
        answer: t.events.findLast((e) => e.kind === 'answer')?.text,
      })),
      turn: s.turns.at(-1) ?? null,
      jobs: s.jobs,
      active: this.active.has(s.id),
      stopRequested: this.stops.has(s.id),
    };
  }
  private executeTool(name: string, input: unknown) {
    const parsed = parseAssistantTool(this.deps.tools, name, input);
    return parsed.tool.execute(parsed.input);
  }
  async execute(operation: string, input: unknown): Promise<unknown> {
    const call = this.ingress
      .catch(() => undefined)
      .then(() => this.command(operation, input));
    this.ingress = call;
    try {
      return await call;
    } catch (error) {
      if (error instanceof z.ZodError || error instanceof RangeError)
        throw new OperationError('invalid_input', 'assistant_invalid_request');
      throw error;
    }
  }
  private async command(operation: string, input: unknown): Promise<unknown> {
    if (operation === 'status')
      return {
        configured: Boolean(this.deps.provider),
        system: await this.executeTool('system_status', {}),
        limits: {steps: MAX_STEPS, modelCalls: MAX_MODEL_CALLS},
      };
    if (operation === 'tools') {
      const {name} = z
        .object({name: z.string().max(100).optional()})
        .strict()
        .parse(input);
      return name
        ? describeAssistantTool(this.deps.tools, name)
        : Object.entries(this.deps.tools).map(([name, t]) => ({
            name,
            title: t.title,
            effect: t.effect,
          }));
    }
    if (operation === 'sessions') {
      z.object({}).strict().parse(input);
      return (await this.deps.store.list()).slice(0, 100).map((s) => ({
        sessionId: s.id,
        channel: s.channel,
        conversationId: s.conversationId,
        updatedAt: s.updatedAt,
        title: s.turns[0]?.message ?? '新会话',
        status: s.turns.at(-1)?.status ?? 'empty',
        version: s.version,
        active: this.active.has(s.id),
      }));
    }
    if (operation === 'delete') {
      const r = selected
        .extend({expectedVersion: z.number().int().positive()})
        .parse(input);
      if (this.active.has(r.sessionId))
        throw new OperationError('conflict', 'assistant_busy');
      await this.deps.store.delete(r.sessionId, r.expectedVersion);
      this.stops.delete(r.sessionId);
      return {sessionId: r.sessionId, status: 'deleted'};
    }
    if (operation === 'open') {
      const identity = sessionIdentitySchema.parse(input);
      const key = createHash('sha256')
        .update(JSON.stringify(identity))
        .digest('hex');
      let s = await this.deps.store.read(key);
      if (!s) {
        s = {
          id: key,
          ...identity,
          version: 0,
          updatedAt: this.now().toISOString(),
          turns: [],
          jobs: [],
        };
        await this.deps.store.save(s, 0);
      }
      return this.view(await this.session(key));
    }
    if (operation === 'read' || operation === 'events') {
      const r = selected
        .extend({after: z.number().int().nonnegative().default(0)})
        .parse(input);
      const s = await this.session(r.sessionId);
      if (!this.active.has(s.id)) await this.refreshJobs(s);
      if (operation === 'read') return this.view(s);
      const events = s.turns
        .flatMap((t) => t.events)
        .filter((e) => e.sequence > r.after)
        .slice(0, 100);
      return {
        sessionId: s.id,
        status: s.turns.at(-1)?.status ?? 'empty',
        events,
        next: events.at(-1)?.sequence ?? r.after,
      };
    }
    if (operation === 'ask' || operation === 'invoke') {
      const r =
        operation === 'ask'
          ? askSchema.parse(input)
          : invokeSchema.parse(input);
      const s = await this.session(r.sessionId);
      const duplicate = s.turns.find((t) => t.messageId === r.messageId);
      const message = 'message' in r ? r.message : '执行 ' + r.operation;
      if (duplicate) {
        if (
          duplicate.message !== message ||
          ('operation' in r &&
            JSON.stringify(duplicate.invocationOriginal) !==
              JSON.stringify({operation: r.operation, input: r.input}))
        )
          throw new OperationError('conflict', 'assistant_message_id_reused');
        return {...this.view(s), turn: duplicate};
      }
      if (
        this.active.has(s.id) ||
        ['running', 'confirmation'].includes(s.turns.at(-1)?.status ?? '')
      )
        throw new OperationError('conflict', 'assistant_busy');
      if (s.turns.length >= 100)
        throw new OperationError('rejected', 'assistant_session_full');
      if ('operation' in r)
        parseAssistantTool(this.deps.tools, r.operation, r.input);
      const timeZone = 'timeZone' in r ? r.timeZone : 'UTC';
      new Intl.DateTimeFormat('en-CA', {timeZone}).format(this.now());
      const t: AssistantTurn = {
        id: randomUUID(),
        messageId: r.messageId,
        message,
        timeZone,
        status: 'running',
        steps: 0,
        calls: 0,
        events: [],
        ...('operation' in r
          ? {
              invocation: {operation: r.operation, input: r.input},
              invocationOriginal: {operation: r.operation, input: r.input},
              direct: true,
            }
          : {}),
      };
      s.turns.push(t);
      this.event(s, t, {kind: 'message', text: message});
      await this.save(s);
      this.launch(s);
      return this.view(s);
    }
    if (operation === 'confirm' || operation === 'dismiss') {
      const r = decisionSchema.parse(input),
        s = await this.session(r.sessionId),
        t = s.turns.find((turn) => turn.id === r.turnId);
      if (t?.decisions?.includes(r.confirmationId))
        return {...this.view(s), turn: t};
      if (!t || t !== s.turns.at(-1))
        throw new OperationError('conflict', 'assistant_confirmation_expired');
      if (this.active.has(s.id)) return this.view(s);
      if (t.status !== 'confirmation' || t.pending?.id !== r.confirmationId)
        throw new OperationError('conflict', 'assistant_confirmation_expired');
      (t.decisions ??= []).push(r.confirmationId);
      if (operation === 'dismiss') {
        delete t.pending;
        t.status = 'cancelled';
        this.event(s, t, {kind: 'answer', text: '已取消，未执行待确认操作。'});
        await this.save(s);
        return this.view(s);
      }
      t.status = 'running';
      await this.save(s);
      this.launch(s, true);
      return this.view(s);
    }
    if (operation === 'resume' || operation === 'cancel') {
      const r = selected.parse(input),
        s = await this.session(r.sessionId),
        t = s.turns.at(-1);
      if (!t) return this.view(s);
      if (operation === 'cancel') {
        if (this.active.has(s.id)) {
          this.stops.add(s.id);
          return {...this.view(s), stopRequested: true};
        }
        if (['completed', 'cancelled'].includes(t.status)) return this.view(s);
        t.status = 'cancelled';
        delete t.pending;
        this.event(s, t, {
          kind: 'answer',
          text: '已停止助手后续操作。已提交的业务任务可单独取消。',
        });
        await this.save(s);
        return this.view(s);
      }
      if (this.active.has(s.id)) return this.view(s);
      if (t.uncertain)
        throw new OperationError('conflict', 'assistant_write_needs_review');
      if (!['failed', 'interrupted'].includes(t.status))
        throw new OperationError('conflict', 'assistant_cannot_resume');
      if (t.steps >= MAX_STEPS || t.calls >= MAX_MODEL_CALLS)
        throw new OperationError('rejected', 'assistant_step_limit');
      delete t.inFlight;
      t.status = 'running';
      await this.save(s);
      this.launch(s, Boolean(t.pending && t.decisions?.includes(t.pending.id)));
      return this.view(s);
    }
    throw new OperationError('invalid_input', 'assistant_unknown_operation');
  }
  private launch(s: AssistantSession, confirmed = false) {
    if (this.active.has(s.id)) return;
    const work = Promise.resolve()
      .then(() => this.process(s, confirmed))
      .catch(() => undefined)
      .finally(() => {
        this.active.delete(s.id);
        this.stops.delete(s.id);
      });
    this.active.set(s.id, work);
  }
  async settle() {
    await Promise.allSettled([...this.active.values()]);
  }
  stop() {
    for (const id of this.active.keys()) this.stops.add(id);
  }
  private history(s: AssistantSession) {
    return s.turns
      .slice(-8)
      .flatMap((t) => t.events)
      .filter((e) => e.modelVisible !== false)
      .slice(-20)
      .map((e) => ({
        sequence: e.sequence,
        kind: e.kind,
        text: e.text,
        operation: e.operation,
        result: compact(e.result),
      }));
  }
  private async process(s: AssistantSession, confirmed: boolean) {
    const t = s.turns.at(-1);
    if (!t) return;
    try {
      if (confirmed && t.pending) {
        const pending = t.pending;
        delete t.pending;
        await this.runTool(s, t, pending.operation, pending.input);
        if (t.direct) {
          t.status = 'completed';
          await this.save(s);
          return;
        }
      }
      while (t.status === 'running') {
        if (this.stops.has(s.id)) {
          t.status = 'cancelled';
          this.event(s, t, {kind: 'answer', text: '已停止后续操作。'});
          break;
        }
        if (t.steps >= MAX_STEPS || t.calls >= MAX_MODEL_CALLS)
          throw new OperationError('rejected', 'assistant_step_limit');
        let operation: string, args: unknown;
        if (t.invocation) {
          ({operation, input: args} = t.invocation);
          delete t.invocation;
        } else if (
          t.steps === 0 &&
          /^((暂停|停止|恢复|启动)(后台)?队列|暂停AI|关闭AI|恢复AI|允许AI)$/iu.test(
            t.message.replace(/\s/gu, ''),
          )
        ) {
          const message = t.message.replace(/\s/gu, '');
          const result = (await this.executeTool('ai_price_status', {})) as {
            policy: {revision: number};
          };
          const paused = /^(暂停|停止|关闭)/u.test(message);
          operation = message.includes('队列')
            ? 'queue_control'
            : 'ai_operations_save';
          args =
            operation === 'queue_control'
              ? {paused, revision: result.policy.revision}
              : {operationsAllowed: !paused, revision: result.policy.revision};
          t.direct = true;
        } else {
          if (!this.deps.provider)
            throw new OperationError('rejected', 'ai_not_configured');
          await this.deps.checkModelCall();
          t.calls++;
          t.inFlight = {operation: 'plan', effect: 'model'};
          await this.save(s);
          const plan = assistantStepSchema.parse(
            await this.deps.provider.plan({
              message: t.message,
              timeZone: t.timeZone,
              date: new Intl.DateTimeFormat('en-CA', {
                timeZone: t.timeZone,
              }).format(this.now()),
              tools: Object.entries(this.deps.tools).map(([name, x]) => ({
                name,
                title: x.title,
                effect: x.effect,
              })),
              history: this.history(s),
            }),
          );
          delete t.inFlight;
          if (this.stops.has(s.id)) {
            t.status = 'cancelled';
            this.event(s, t, {kind: 'answer', text: '已停止后续操作。'});
            break;
          }
          if (plan.operation === 'answer' || plan.operation === 'clarify') {
            t.status = 'completed';
            this.event(s, t, {
              kind: 'answer',
              text: plan.clarification || '操作结束。',
            });
            break;
          }
          operation = plan.operation;
          args = JSON.parse(plan.arguments) as unknown;
        }
        if (operation === 'tool_describe') {
          const {name} = z.object({name: z.string()}).strict().parse(args);
          t.steps++;
          this.event(s, t, {
            kind: 'result',
            operation,
            text: '已读取操作参数',
            result: describeAssistantTool(this.deps.tools, name),
          });
          await this.save(s);
          continue;
        }
        if (operation === 'result_read') {
          const r = z
            .object({
              sequence: z.number().int().positive(),
              offset: z.number().int().nonnegative(),
            })
            .strict()
            .parse(args);
          const saved = s.turns
            .flatMap((turn) => turn.events)
            .find((e) => e.sequence === r.sequence && e.result !== undefined);
          if (!saved || saved.modelVisible === false)
            throw new OperationError(
              'forbidden',
              'assistant_result_unavailable',
            );
          const content = serializedResult(saved.result);
          t.steps++;
          this.event(s, t, {
            kind: 'result',
            operation,
            text: '已读取后续内容',
            result: {
              text: content.slice(r.offset, r.offset + 12000),
              next: r.offset + 12000 < content.length ? r.offset + 12000 : null,
            },
          });
          await this.save(s);
          continue;
        }
        // Business idempotency keys are generated here, never guessed by the model.
        const schema = this.deps.tools[operation]?.schema;
        if (
          schema instanceof z.ZodObject &&
          'requestKey' in schema.shape &&
          args &&
          typeof args === 'object'
        )
          args = {...args, requestKey: `assistant_${t.id}_${String(t.steps)}`};
        const parsed = parseAssistantTool(this.deps.tools, operation, args);
        if (parsed.tool.effect === 'change') {
          t.pending = {
            id: randomUUID(),
            operation,
            input: parsed.input,
            label: parsed.tool.title,
          };
          t.status = 'confirmation';
          this.event(s, t, {
            kind: 'confirmation',
            operation,
            text: parsed.tool.title,
            input: parsed.input,
            modelVisible: false,
          });
          break;
        }
        await this.runTool(s, t, operation, parsed.input);
        if (t.direct) t.status = 'completed';
      }
      await this.save(s);
    } catch (error) {
      t.status = 'failed';
      t.uncertain =
        t.inFlight?.effect === 'change' && !(error instanceof OperationError);
      const code =
        error instanceof OperationError
          ? error.code
          : isAiDispatchWait(error)
            ? error.code
            : error instanceof SyntaxError || error instanceof z.ZodError
              ? 'assistant_invalid_plan'
              : 'assistant_operation_failed';
      this.event(s, t, {
        kind: 'error',
        text: code,
        ...(error instanceof OperationError && error.field
          ? {result: {detail: error.field}}
          : {}),
      });
      if (!t.uncertain) delete t.inFlight;
      await this.save(s);
    }
  }
  private async runTool(
    s: AssistantSession,
    t: AssistantTurn,
    operation: string,
    input: unknown,
  ) {
    const parsed = parseAssistantTool(this.deps.tools, operation, input);
    t.steps++;
    t.inFlight = {operation, effect: parsed.tool.effect};
    this.event(s, t, {
      kind: 'step',
      operation,
      text: parsed.tool.title,
      input: parsed.input,
      modelVisible: false,
    });
    await this.save(s);
    const result = await parsed.tool.execute(parsed.input);
    delete t.inFlight;
    const modelVisible =
      !containsPrivate(input) &&
      !containsPrivate(result) &&
      !['workspace_export', 'workspace_restore'].includes(operation);
    this.event(s, t, {
      kind: 'result',
      operation,
      text: parsed.tool.title,
      result,
      modelVisible,
    });
    this.trackJob(s, operation, result);
    if (operation === 'queue_control') {
      this.event(s, t, {
        kind: 'answer',
        text: (input as {paused: boolean}).paused
          ? '后台队列已暂停。系统助手保持可用。'
          : '后台队列已恢复。任务按现有许可和时段继续。',
      });
    }
    if (!modelVisible) {
      t.status = 'completed';
      this.event(s, t, {
        kind: 'answer',
        text: '结果已返回。涉及私密资料或备份内容，未继续发送给模型。',
      });
    }
    if (
      operation === 'ai_operations_save' &&
      (input as {operationsAllowed?: boolean}).operationsAllowed === false
    ) {
      t.status = 'completed';
      this.event(s, t, {
        kind: 'answer',
        text: '已关闭 AI 总开关。可用“恢复 AI”重新开启。',
      });
    }
    await this.save(s);
  }
  private trackJob(s: AssistantSession, operation: string, result: unknown) {
    const r = result as {
      jobId?: string;
      taskId?: string;
      task?: {taskId?: string};
      reportId?: string;
      report?: {reportId?: string};
    } | null;
    const taskId = r?.taskId ?? r?.task?.taskId,
      reportId = r?.reportId ?? r?.report?.reportId;
    const job =
      taskId && ['task_start', 'task_control'].includes(operation)
        ? {operation: 'task_read', input: {taskId}}
        : reportId && ['report_generate'].includes(operation)
          ? {operation: 'report_read', input: {reportId}}
          : r?.jobId &&
              ['topic_job_start', 'topic_job_control'].includes(operation)
            ? {operation: 'topics_list', input: {}, jobId: r.jobId}
            : undefined;
    if (
      job &&
      !s.jobs.some(
        (x) =>
          JSON.stringify(x.input) === JSON.stringify(job.input) &&
          x.jobId === job.jobId,
      )
    )
      s.jobs.push({...job, fingerprint: ''});
  }
  private async refreshJobs(s: AssistantSession) {
    const t = s.turns.at(-1);
    if (!t || s.jobs.length === 0) return;
    let changed = false;
    for (const job of [...s.jobs]) {
      try {
        let result = await this.executeTool(job.operation, job.input);
        if (job.jobId)
          result = (result as {jobs: {id: string}[]}).jobs.find(
            (j) => j.id === job.jobId,
          ) ?? {status: 'unavailable'};
        const fingerprint = createHash('sha256')
          .update(JSON.stringify(result))
          .digest('hex');
        if (fingerprint !== job.fingerprint) {
          job.fingerprint = fingerprint;
          changed = true;
          this.event(s, t, {
            kind: 'job',
            operation: job.operation,
            text: '任务状态已更新',
            result,
            modelVisible: !containsPrivate(result),
          });
        }
        const r = result as {
          status?: string;
          state?: {status?: string};
          report?: {state?: {status?: string}};
        };
        if (
          [
            'completed',
            'succeeded',
            'ready',
            'reviewed',
            'cancelled',
            'failed',
            'unavailable',
          ].includes(
            r.state?.status ?? r.report?.state?.status ?? r.status ?? '',
          )
        ) {
          s.jobs = s.jobs.filter((j) => j !== job);
          changed = true;
        }
      } catch (error) {
        if (error instanceof OperationError) {
          s.jobs = s.jobs.filter((j) => j !== job);
          changed = true;
          this.event(s, t, {kind: 'error', text: error.code});
        } else throw error;
      }
    }
    if (changed) await this.save(s);
  }
}
function containsPrivate(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(containsPrivate);
  if (value && typeof value === 'object')
    return Object.entries(value).some(
      ([k, v]) =>
        ((k === 'isPrivate' || k === 'includePrivate' || k === 'onlyPrivate') &&
          v === true) ||
        (k === 'privacy' && v === 'private') ||
        (k === 'privacyScope' && v !== 'public') ||
        containsPrivate(v),
    );
  return false;
}
function serializedResult(value: unknown) {
  return JSON.stringify(value, (key, v: unknown) =>
    /^(apiKey|password|authorization|secret|token)$/iu.test(key)
      ? '[已隐藏]'
      : v,
  );
}
function compact(value: unknown): unknown {
  const text = serializedResult(value);
  if (!text) return undefined;
  return text.length > 18000
    ? {
        truncated: true,
        length: text.length,
        next: 18000,
        text: text.slice(0, 18000),
      }
    : (JSON.parse(text) as unknown);
}
