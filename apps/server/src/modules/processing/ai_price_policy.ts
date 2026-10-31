import {z} from 'zod';

/** DeepSeek's published tariff, verified 2026-09-14. All boundaries are Beijing time. */
export const AI_PRICE_RULE = 'deepseek-weekday-peak-2026-09-14' as const;
export const aiPricePolicySchema = z
  .object({
    revision: z.number().int().min(0).max(2147483646),
    enabled: z.boolean(),
    operationsAllowed: z.boolean().optional(),
    backgroundPaused: z.boolean().optional(),
    assistantPriceRestricted: z.boolean().optional(),
    maxConcurrentRequests: z.number().int().min(1).max(4).optional(),
    automaticRetryLimit: z.number().int().min(0).max(2).optional(),
  })
  .strict();
export type AiPricePolicy = z.infer<typeof aiPricePolicySchema>;
export const DEFAULT_AI_PRICE_POLICY: Readonly<AiPricePolicy> = Object.freeze({
  revision: 0,
  enabled: false,
});
export const AI_PRICE_WAIT = 'ai_price_window_closed' as const;

export class AiPriceWindowClosedError extends Error {
  public readonly code = AI_PRICE_WAIT;
  public constructor() {
    super(AI_PRICE_WAIT);
  }
}
export const AI_OPERATIONS_PAUSED = 'ai_operations_paused' as const;
export class AiOperationsPausedError extends Error {
  public readonly code = AI_OPERATIONS_PAUSED;
  public constructor() {
    super(AI_OPERATIONS_PAUSED);
  }
}
export function isAiDispatchWait(error: unknown): error is Error & {
  code:
    typeof AI_PRICE_WAIT | typeof AI_OPERATIONS_PAUSED | typeof AI_BUDGET_WAIT;
} {
  return (
    error instanceof Error &&
    'code' in error &&
    (error.code === AI_PRICE_WAIT ||
      error.code === AI_OPERATIONS_PAUSED ||
      error.code === AI_BUDGET_WAIT)
  );
}

export const AI_BUDGET_WAIT = 'ai_batch_budget_paused' as const;
export class AiBudgetWaitError extends Error {
  public readonly code = AI_BUDGET_WAIT;
  public constructor() {
    super(AI_BUDGET_WAIT);
  }
}

export function aiPriceWindow(
  policy: Readonly<AiPricePolicy>,
  provider: string | undefined,
  now: Date,
) {
  const beijing = new Date(now.getTime() + 8 * 60 * 60 * 1000);
  const weekday = beijing.getUTCDay();
  const minute = beijing.getUTCHours() * 60 + beijing.getUTCMinutes();
  const peakEnd =
    weekday > 0 && weekday < 6
      ? minute >= 540 && minute < 720
        ? 720
        : minute >= 840 && minute < 1080
          ? 1080
          : undefined
      : undefined;
  const applicable = provider === 'deepseek-responses-v1';
  const blocked = applicable && policy.enabled && peakEnd !== undefined;
  const nextAllowedAt = blocked
    ? new Date(
        Date.UTC(
          beijing.getUTCFullYear(),
          beijing.getUTCMonth(),
          beijing.getUTCDate(),
          0,
          peakEnd,
        ) -
          8 * 60 * 60 * 1000,
      ).toISOString()
    : null;
  return {
    policy,
    rule: AI_PRICE_RULE,
    timeZone: 'Asia/Shanghai' as const,
    provider: provider ?? null,
    applicable,
    peak: peakEnd !== undefined,
    blocked,
    checkedAt: now.toISOString(),
    nextAllowedAt,
  };
}
