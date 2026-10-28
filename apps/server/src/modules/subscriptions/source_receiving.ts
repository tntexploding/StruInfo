import {z} from 'zod';

const timezone = z
  .string()
  .min(1)
  .max(80)
  .refine((value) => {
    try {
      new Intl.DateTimeFormat('en', {timeZone: value}).format(0);
      return true;
    } catch {
      return false;
    }
  });

/** Transport and update cadence are independent, workspace-owned settings. */
export const sourceReceivingSchema = z
  .object({
    schedule: z.discriminatedUnion('mode', [
      z.object({mode: z.literal('manual')}).strict(),
      z.object({mode: z.literal('once')}).strict(),
      z.object({mode: z.literal('interval')}).strict(),
      z
        .object({
          mode: z.literal('window'),
          timeZone: timezone,
          weekdays: z
            .array(z.number().int().min(0).max(6))
            .min(1)
            .max(7)
            .refine((days) => new Set(days).size === days.length),
          startMinute: z.number().int().min(0).max(1439),
          endMinute: z.number().int().min(1).max(1440),
        })
        .strict()
        .refine((v) => v.endMinute > v.startMinute),
    ]),
    history: z.enum(['discover', 'none']),
    urgency: z.enum(['low', 'normal', 'high']),
    preference: z.number().int().min(0).max(100),
    retryLimit: z.number().int().min(0).max(5).default(2),
  })
  .strict();
export type SourceReceiving = z.infer<typeof sourceReceivingSchema>;
export const DEFAULT_SOURCE_RECEIVING: SourceReceiving = Object.freeze({
  schedule: {mode: 'interval' as const},
  history: 'discover',
  urgency: 'normal',
  preference: 50,
  retryLimit: 2,
});

export const sourceCheckStateSchema = z
  .object({
    failures: z.number().int().min(0).max(1000),
    errorCode: z
      .string()
      .regex(/^[a-z_]+$/u)
      .max(100)
      .optional(),
    lastNewAt: z.iso.datetime().optional(),
  })
  .strict();
export type SourceCheckState = Readonly<{
  failures: number;
  errorCode?: string;
  lastNewAt?: string;
}>;

export const receptionSchema = z
  .object({
    channel: z.enum(['live', 'history', 'manual']),
    strategy: sourceReceivingSchema.optional(),
  })
  .strict();
export type Reception = z.infer<typeof receptionSchema>;

export interface SourceScheduleInput {
  enabled: boolean;
  intervalMinutes: number;
  receiving?: SourceReceiving;
  checkState?: SourceCheckState;
  lastAttemptAt?: string;
  lastSuccessAt?: string;
}
export interface SourceScheduleStatus {
  nextCheckAt: string | null;
  reason:
    | 'disabled'
    | 'manual'
    | 'collected'
    | 'due'
    | 'interval'
    | 'window'
    | 'backoff'
    | 'exhausted';
}

/** Returns one overdue check after downtime, never a replay of every missed slot. */
export function sourceSchedule(
  source: SourceScheduleInput,
  now: string,
): SourceScheduleStatus {
  const strategy = source.receiving ?? DEFAULT_SOURCE_RECEIVING;
  if (!source.enabled) return {nextCheckAt: null, reason: 'disabled'};
  if (strategy.schedule.mode === 'manual')
    return {nextCheckAt: null, reason: 'manual'};
  if (strategy.schedule.mode === 'once' && source.lastSuccessAt)
    return {nextCheckAt: null, reason: 'collected'};
  if ((source.checkState?.failures ?? 0) > strategy.retryLimit)
    return {nextCheckAt: null, reason: 'exhausted'};
  const current = Date.parse(now);
  let due = source.lastAttemptAt
    ? Date.parse(source.lastAttemptAt) + source.intervalMinutes * 60_000
    : 0;
  let reason: SourceScheduleStatus['reason'] = 'interval';
  if (strategy.schedule.mode === 'window') {
    due = nextWindow(due || current, strategy.schedule);
    reason = 'window';
  }
  if (source.checkState?.failures && source.lastAttemptAt) {
    const delay = Math.min(
      10080,
      60 * 2 ** Math.min(10, source.checkState.failures - 1),
    );
    const retryAt = Date.parse(source.lastAttemptAt) + delay * 60_000;
    if (retryAt >= due) {
      due = retryAt;
      reason = 'backoff';
    }
  }
  return {
    nextCheckAt: new Date(due).toISOString(),
    reason: due <= current ? 'due' : reason,
  };
}

function nextWindow(
  start: number,
  window: Extract<SourceReceiving['schedule'], {mode: 'window'}>,
): number {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: window.timeZone,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
  const local = (instant: number) => {
    const parts = new Map(
      formatter.formatToParts(instant).map((p) => [p.type, p.value]),
    );
    return {
      weekday: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(
        parts.get('weekday') ?? '',
      ),
      minute: Number(parts.get('hour')) * 60 + Number(parts.get('minute')),
    };
  };
  const inside = (instant: number) => {
    const {weekday, minute} = local(instant);
    return (
      window.weekdays.includes(weekday) &&
      minute >= window.startMinute &&
      minute < window.endMinute
    );
  };
  let instant = start;
  if (inside(instant)) return instant;
  for (let attempt = 0; attempt < 20; attempt++) {
    const {weekday, minute} = local(instant);
    const advance =
      window.weekdays.includes(weekday) && minute < window.startMinute
        ? window.startMinute - minute
        : 1440 - minute + window.startMinute;
    const previous = instant;
    instant = Math.floor(instant / 60_000) * 60_000 + advance * 60_000;
    // Scan the small offset-change margin; a DST gap may remove part/all of a window.
    const begin = Math.max(start, previous + 60_000, instant - 180 * 60_000);
    for (let probe = begin; probe <= instant; probe += 60_000)
      if (inside(probe)) return probe;
  }
  throw new Error('source_window_unavailable');
}

export interface SourceReceivingStatus extends SourceScheduleStatus {
  live: 'poll';
  history: 'public_index' | 'not_supported' | 'disabled';
  pendingCount: number;
  lastNewAt: string | null;
  errorCode: string | null;
  failures: number;
}
