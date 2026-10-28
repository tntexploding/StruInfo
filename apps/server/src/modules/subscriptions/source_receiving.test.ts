import {describe, expect, it} from 'vitest';
import {
  DEFAULT_SOURCE_RECEIVING,
  sourceReceivingSchema,
  sourceSchedule,
  type SourceScheduleInput,
} from './source_receiving.js';

const source: SourceScheduleInput = {enabled: true, intervalMinutes: 60};
const now = '2026-10-24T03:00:00.000Z';
describe('source receiving schedules', () => {
  it('keeps legacy intervals and never enables paused/manual/finished static sources', () => {
    expect(sourceSchedule(source, now).reason).toBe('due');
    expect(sourceSchedule({...source, enabled: false}, now)).toEqual({
      nextCheckAt: null,
      reason: 'disabled',
    });
    expect(
      sourceSchedule(
        {
          ...source,
          receiving: {...DEFAULT_SOURCE_RECEIVING, schedule: {mode: 'manual'}},
        },
        now,
      ).reason,
    ).toBe('manual');
    const once = {
      ...source,
      receiving: {
        ...DEFAULT_SOURCE_RECEIVING,
        schedule: {mode: 'once' as const},
      },
    };
    expect(sourceSchedule(once, now).reason).toBe('due');
    expect(sourceSchedule({...once, lastSuccessAt: now}, now).reason).toBe(
      'collected',
    );
  });
  it('uses source timezone and catches up only one missed window', () => {
    const weekly = {
      ...source,
      receiving: {
        ...DEFAULT_SOURCE_RECEIVING,
        schedule: {
          mode: 'window' as const,
          timeZone: 'Asia/Shanghai',
          weekdays: [1],
          startMinute: 540,
          endMinute: 600,
        },
      },
    };
    expect(sourceSchedule(weekly, now)).toEqual({
      reason: 'window',
      nextCheckAt: '2026-10-26T01:00:00.000Z',
    });
    expect(
      sourceSchedule(
        {...weekly, lastAttemptAt: '2026-10-12T01:00:00.000Z'},
        now,
      ).reason,
    ).toBe('due');
    expect(sourceSchedule({...weekly, lastAttemptAt: now}, now).reason).toBe(
      'window',
    );
    expect(
      sourceSchedule(
        {...weekly, lastAttemptAt: '2026-10-26T01:00:00.000Z'},
        '2026-10-26T01:59:00.000Z',
      ).nextCheckAt,
    ).toBe('2026-11-02T01:00:00.000Z');
  });
  it('handles both daylight-saving offset changes without skipping the next window', () => {
    const daily = {
      ...source,
      receiving: {
        ...DEFAULT_SOURCE_RECEIVING,
        schedule: {
          mode: 'window' as const,
          timeZone: 'America/New_York',
          weekdays: [0, 1, 2, 3, 4, 5, 6],
          startMinute: 540,
          endMinute: 600,
        },
      },
    };
    expect(
      sourceSchedule(
        {...daily, lastAttemptAt: '2026-03-07T14:00:00.000Z'},
        '2026-03-07T15:00:00.000Z',
      ).nextCheckAt,
    ).toBe('2026-03-08T13:00:00.000Z');
    expect(
      sourceSchedule(
        {...daily, lastAttemptAt: '2026-10-31T13:00:00.000Z'},
        '2026-10-31T14:00:00.000Z',
      ).nextCheckAt,
    ).toBe('2026-11-01T14:00:00.000Z');
  });
  it('backs off failures without changing the configured cadence', () => {
    const failed = {
      ...source,
      receiving: {...DEFAULT_SOURCE_RECEIVING, retryLimit: 3},
      lastAttemptAt: now,
      checkState: {failures: 3, errorCode: 'source_unavailable'},
    };
    expect(sourceSchedule(failed, now)).toEqual({
      reason: 'backoff',
      nextCheckAt: '2026-10-24T07:00:00.000Z',
    });
    expect(sourceSchedule({...failed, checkState: {failures: 0}}, now)).toEqual(
      {reason: 'interval', nextCheckAt: '2026-10-24T04:00:00.000Z'},
    );
  });
  it('stops scheduled retries at the configured limit', () => {
    expect(
      sourceSchedule(
        {
          ...source,
          receiving: {...DEFAULT_SOURCE_RECEIVING, retryLimit: 2},
          lastAttemptAt: now,
          checkState: {failures: 3},
        },
        now,
      ),
    ).toEqual({reason: 'exhausted', nextCheckAt: null});
    expect(
      sourceSchedule(
        {
          ...source,
          receiving: {...DEFAULT_SOURCE_RECEIVING, retryLimit: 0},
          lastAttemptAt: now,
          checkState: {failures: 1},
        },
        now,
      ),
    ).toEqual({reason: 'exhausted', nextCheckAt: null});
  });
  it('rejects unsupported schedules and invalid windows', () => {
    for (const schedule of [
      {mode: 'webhook'},
      {
        mode: 'window',
        timeZone: 'invalid',
        weekdays: [1],
        startMinute: 0,
        endMinute: 1,
      },
      {
        mode: 'window',
        timeZone: 'UTC',
        weekdays: [],
        startMinute: 0,
        endMinute: 1,
      },
      {
        mode: 'window',
        timeZone: 'UTC',
        weekdays: [1],
        startMinute: 600,
        endMinute: 540,
      },
    ])
      expect(
        sourceReceivingSchema.safeParse({...DEFAULT_SOURCE_RECEIVING, schedule})
          .success,
      ).toBe(false);
  });
});
