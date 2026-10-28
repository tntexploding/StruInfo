import {randomUUID} from 'node:crypto';
import {appendFile, lstat, readFile, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {z} from 'zod';
import {modelUsageScope} from './model_usage_scope.js';
import {
  AiBudgetWaitError,
  AiPriceWindowClosedError,
  aiPriceWindow,
  isAiDispatchWait,
} from '../../modules/processing/ai_price_policy.js';

const budgetSchema = z
  .object({
    format: z.literal('struinfo.ai-batch-budget.v1'),
    workspaceId: z.uuid(),
    batchId: z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/u),
    model: z.string().min(1).max(160),
    limitCny: z.number().positive().max(10000),
    paused: z.boolean(),
    offPeakOnly: z.boolean().default(false),
    inputCnyPerMillion: z.number().positive().max(1000),
    cachedInputCnyPerMillion: z.number().nonnegative().max(1000),
    outputCnyPerMillion: z.number().positive().max(1000),
  })
  .strict();
type Budget = z.infer<typeof budgetSchema>;
const usageSchema = z.object({
  input_tokens: z.number().int().nonnegative().max(10_000_000),
  output_tokens: z.number().int().nonnegative().max(1_000_000),
  input_tokens_details: z
    .object({
      cached_tokens: z.number().int().nonnegative().max(10_000_000),
    })
    .optional(),
});
const reservationSchema = z.object({
  kind: z.literal('reserved'),
  id: z.uuid(),
  at: z.iso.datetime(),
  batchId: z.string(),
  model: z.string(),
  stage: z.string().max(100),
  reservedNanoCny: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
});
const settlementSchema = z.object({
  kind: z.literal('settled'),
  id: z.uuid(),
  at: z.iso.datetime(),
  status: z.number().int().min(100).max(599).optional(),
  usage: usageSchema.optional(),
  chargedNanoCny: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  usageKnown: z.boolean(),
});
type Reservation = z.infer<typeof reservationSchema>;
export interface ModelUsageTicket {
  readonly record: Reservation;
  readonly budget: Budget;
}
export interface ModelUsageJournal {
  reserve(request: string): Promise<ModelUsageTicket | undefined>;
  settle(
    ticket: ModelUsageTicket,
    status?: number,
    body?: Uint8Array,
  ): Promise<void>;
}

/** Opt-in, single-instance accounting. Never persists prompts, outputs or secrets. */
export class LocalModelUsageJournal implements ModelUsageJournal {
  private tail: Promise<unknown> = Promise.resolve();
  private failedPauseBatch: string | undefined;
  private readonly budgetPath: string;
  private readonly journalPath: string;
  public constructor(
    exportsRoot: string,
    private readonly workspaceId: string,
    private readonly clock: () => Date = () => new Date(),
  ) {
    if (!z.uuid().safeParse(workspaceId).success) throw new AiBudgetWaitError();
    this.budgetPath = join(exportsRoot, workspaceId + '.ai-batch-budget.json');
    this.journalPath = join(exportsRoot, workspaceId + '.ai-usage.jsonl');
  }
  public budgetStatus() {
    return this.lock(async () => {
      const source = await safeRead(this.budgetPath, 16_384);
      if (source === undefined) return null;
      const budget = budgetSchema.parse(JSON.parse(source));
      if (budget.workspaceId !== this.workspaceId)
        throw new AiBudgetWaitError();
      const rows = (await this.records()).filter(
        (r) => r.record.batchId === budget.batchId,
      );
      const chargedNanoCny = rows.reduce((n, r) => n + r.amount, 0);
      return {
        batchId: budget.batchId,
        paused: budget.paused || this.failedPauseBatch === budget.batchId,
        limitCny: budget.limitCny,
        remainingCny: Math.max(0, budget.limitCny - chargedNanoCny / 1e9),
      };
    });
  }
  public reserve(request: string): Promise<ModelUsageTicket | undefined> {
    return this.lock(async () => {
      const source = await safeRead(this.budgetPath, 16_384);
      if (source === undefined) {
        if (modelUsageScope.getStore()) throw new AiBudgetWaitError();
        return undefined;
      }
      const budget = budgetSchema.parse(JSON.parse(source));
      if (
        budget.workspaceId !== this.workspaceId ||
        (modelUsageScope.getStore() &&
          modelUsageScope.getStore()?.batchId !== budget.batchId) ||
        budget.paused ||
        this.failedPauseBatch === budget.batchId
      )
        throw new AiBudgetWaitError();
      if (
        budget.offPeakOnly &&
        aiPriceWindow(
          {revision: 0, enabled: true},
          'deepseek-responses-v1',
          this.clock(),
        ).blocked
      )
        throw new AiPriceWindowClosedError();
      const input = z
        .object({
          model: z.literal(budget.model),
          input: z.string(),
          max_output_tokens: z.number().int().min(1).max(131_072),
          text: z.object({format: z.object({name: z.string().max(100)})}),
        })
        .parse(JSON.parse(request));
      // UTF-8 bytes conservatively bound text tokens; reserve all permitted output.
      // Additional framing is reserved separately. Unknown responses keep this charge.
      const reservedNanoCny = charge(
        budget,
        Buffer.byteLength(request) + 2048,
        input.max_output_tokens,
        0,
      );
      const records = await this.records();
      const used = records
        .filter((r) => r.record.batchId === budget.batchId)
        .reduce((sum, r) => sum + r.amount, 0);
      if (used + reservedNanoCny > Math.floor(budget.limitCny * 1e9))
        throw new AiBudgetWaitError();
      const record: Reservation = {
        kind: 'reserved',
        id: randomUUID(),
        at: new Date().toISOString(),
        batchId: budget.batchId,
        model: budget.model,
        stage: input.text.format.name,
        reservedNanoCny,
      };
      await this.append(record);
      await modelUsageScope.getStore()?.record({
        id: record.id,
        batchId: record.batchId,
        reservedNanoCny: record.reservedNanoCny,
      });
      return {record, budget};
    });
  }
  public settle(ticket: ModelUsageTicket, status?: number, body?: Uint8Array) {
    return this.lock(async () => {
      const records = await this.records();
      const existing = records.find((r) => r.record.id === ticket.record.id);
      if (!existing) throw new AiBudgetWaitError();
      if (existing.settled) return;
      let usage: z.infer<typeof usageSchema> | undefined;
      if (body && body.byteLength <= 1_048_576) {
        try {
          const envelope: unknown = JSON.parse(new TextDecoder().decode(body));
          const parsed = z.object({usage: usageSchema}).safeParse(envelope);
          if (
            parsed.success &&
            (parsed.data.usage.input_tokens_details?.cached_tokens ?? 0) <=
              parsed.data.usage.input_tokens
          )
            usage = parsed.data.usage;
        } catch {
          /* An unknown billed result retains its full reservation. */
        }
      }
      const settlement = {
        kind: 'settled',
        id: ticket.record.id,
        at: new Date().toISOString(),
        ...(status === undefined ? {} : {status}),
        ...(usage ? {usage} : {}),
        usageKnown: usage !== undefined,
        chargedNanoCny: usage
          ? charge(
              ticket.budget,
              usage.input_tokens,
              usage.output_tokens,
              usage.input_tokens_details?.cached_tokens ?? 0,
            )
          : ticket.record.reservedNanoCny,
      };
      await this.append(settlement);
      await modelUsageScope.getStore()?.record({
        id: ticket.record.id,
        batchId: ticket.record.batchId,
        reservedNanoCny: ticket.record.reservedNanoCny,
        chargedNanoCny: settlement.chargedNanoCny,
        usageKnown: settlement.usageKnown,
      });
      // Count completed responses in completion order, including across restart.
      // A full HTTP 200 resets transport failures even if its model JSON is bad.
      const previous = records
        .filter((r) => r.settled && r.record.batchId === ticket.record.batchId)
        .sort((a, b) => b.settledOrder - a.settledOrder);
      const transient = (code: number | undefined) =>
        code === undefined || [408, 429, 500, 502, 503, 504].includes(code);
      const immediateStop =
        status !== undefined && status >= 400 && !transient(status);
      const repeatedFailure =
        transient(status) &&
        previous.length >= 3 &&
        previous.slice(0, 3).every((r) => transient(r.status));
      // Pause the batch durably; later in-flight success cannot reopen it.
      // An older batch's response must not pause a replacement budget.
      if (immediateStop || repeatedFailure) {
        const source = await safeRead(this.budgetPath, 16_384);
        if (source === undefined) return;
        const current = budgetSchema.parse(JSON.parse(source));
        if (
          current.workspaceId === this.workspaceId &&
          current.batchId === ticket.record.batchId &&
          !current.paused
        ) {
          this.failedPauseBatch = current.batchId;
          await writeFile(
            this.budgetPath,
            JSON.stringify({...current, paused: true}) + '\n',
            {encoding: 'utf8', mode: 0o600, flush: true},
          );
          this.failedPauseBatch = undefined;
        }
      }
    });
  }
  private async records() {
    const text = await safeRead(this.journalPath, 32 * 1024 * 1024);
    const rows = new Map<
      string,
      {
        record: Reservation;
        amount: number;
        settled: boolean;
        settledOrder: number;
        status?: number;
      }
    >();
    let settledOrder = 0;
    for (const line of (text ?? '').split('\n').filter(Boolean)) {
      const raw: unknown = JSON.parse(line);
      const r = reservationSchema.safeParse(raw);
      if (r.success) {
        if (rows.has(r.data.id)) throw new AiBudgetWaitError();
        rows.set(r.data.id, {
          record: r.data,
          amount: r.data.reservedNanoCny,
          settled: false,
          settledOrder: 0,
        });
      } else {
        const s = settlementSchema.parse(raw);
        const item = rows.get(s.id);
        if (!item || item.settled) throw new AiBudgetWaitError();
        item.amount = s.chargedNanoCny;
        item.settled = true;
        item.settledOrder = ++settledOrder;
        if (s.status !== undefined) item.status = s.status;
      }
    }
    return [...rows.values()];
  }
  private async append(value: unknown) {
    await safeRead(this.journalPath, 32 * 1024 * 1024);
    await appendFile(this.journalPath, JSON.stringify(value) + '\n', {
      encoding: 'utf8',
      mode: 0o600,
      flush: true,
    });
  }
  private lock<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.tail
      .catch(() => undefined)
      .then(operation)
      .catch((error: unknown) => {
        if (isAiDispatchWait(error)) throw error;
        // A broken budget or journal must never silently permit unmetered spending.
        throw new AiBudgetWaitError();
      });
    this.tail = next;
    return next;
  }
}

function charge(budget: Budget, input: number, output: number, cached: number) {
  return Math.ceil(
    ((input - cached) * budget.inputCnyPerMillion +
      cached * budget.cachedInputCnyPerMillion +
      output * budget.outputCnyPerMillion) *
      1000,
  );
}
async function safeRead(
  path: string,
  maximum: number,
): Promise<string | undefined> {
  try {
    const info = await lstat(path);
    if (
      !info.isFile() ||
      info.isSymbolicLink() ||
      info.nlink !== 1 ||
      info.size > maximum
    )
      throw new AiBudgetWaitError();
    return await readFile(path, 'utf8');
  } catch (error) {
    if (
      error &&
      typeof error === 'object' &&
      'code' in error &&
      error.code === 'ENOENT'
    )
      return undefined;
    throw error;
  }
}
