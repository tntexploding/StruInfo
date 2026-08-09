/// <reference lib="dom" />

import {describe, expect, it} from 'vitest';

import {FixedClock} from './fixed-clock.js';
import {testSupportErrorCodes} from './test-support-error.js';

describe('FixedClock', () => {
  it('returns the configured instant without consulting or sharing mutable time', () => {
    const clock = new FixedClock('2026-08-09T01:02:03.004Z');

    const first = clock.now();
    first.setUTCFullYear(2000);

    expect(clock.nowIso()).toBe('2026-08-09T01:02:03.004Z');
    expect(clock.now()).not.toBe(first);
  });

  it('copies a valid Date instant', () => {
    const input = new Date('2026-08-09T01:02:03.004Z');
    const clock = new FixedClock(input);

    input.setTime(0);

    expect(clock.nowIso()).toBe('2026-08-09T01:02:03.004Z');
  });

  it.each([
    '2026-08-09T01:02:03Z',
    '2026-08-09T09:02:03.004+08:00',
    'not-an-instant',
  ])('rejects non-canonical UTC string %s', (instant) => {
    expect(() => new FixedClock(instant)).toThrow(
      expect.objectContaining({
        code: testSupportErrorCodes.fixedClockInvalidInstant,
      }),
    );
  });

  it('rejects an invalid Date', () => {
    expect(() => new FixedClock(new Date(Number.NaN))).toThrow(
      expect.objectContaining({
        code: testSupportErrorCodes.fixedClockInvalidInstant,
      }),
    );
  });
});
