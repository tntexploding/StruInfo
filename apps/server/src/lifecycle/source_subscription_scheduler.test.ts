import {describe, expect, it, vi} from 'vitest';

import type {TimerScheduler} from './deadline.js';
import {SourceSubscriptionScheduler} from './source_subscription_scheduler.js';

describe('SourceSubscriptionScheduler', () => {
  it('polls without overlap and stops scheduling during shutdown', async () => {
    const callbacks: (() => void)[] = [];
    const timer: TimerScheduler = {
      set: vi.fn((callback: () => void) => {
        callbacks.push(callback);
        return callback;
      }),
      clear: vi.fn(),
    };
    const runDue = vi.fn(() => Promise.resolve([]));
    const scheduler = await SourceSubscriptionScheduler.start({
      subscriptions: {
        list: () => Promise.reject(new Error('unexpected list')),
        replace: () => Promise.reject(new Error('unexpected replace')),
        runNow: () => Promise.reject(new Error('unexpected run')),
        runDue,
      },
      logger: {write: vi.fn()},
      timer,
      initialDelayMs: 10,
      pollIntervalMs: 20,
    });

    expect(callbacks).toHaveLength(1);
    callbacks[0]?.();
    await scheduler.drain();
    expect(runDue).toHaveBeenCalledTimes(1);
    expect(callbacks).toHaveLength(2);

    scheduler.stopAccepting();
    callbacks[1]?.();
    await scheduler.close();
    expect(runDue).toHaveBeenCalledTimes(1);
  });
});
