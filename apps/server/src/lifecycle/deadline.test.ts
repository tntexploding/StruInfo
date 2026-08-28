import {describe, expect, it, vi} from 'vitest';

import {
  DeadlineExceededError,
  SystemDeadline,
  type TimerScheduler,
} from './deadline.js';

describe('SystemDeadline', () => {
  it('uses an injected finite timer and clears it after success', async () => {
    const timer = new RecordingTimer();
    const deadline = new SystemDeadline(timer);

    await expect(
      deadline.run('synthetic operation', 250, () => Promise.resolve('done')),
    ).resolves.toBe('done');

    expect(timer.delayMs).toBe(250);
    expect(timer.clear).toHaveBeenCalledExactlyOnceWith(timer.handle);
  });

  it('rejects with an actionable timeout without leaking operation details', async () => {
    const timer = new RecordingTimer();
    const deadline = new SystemDeadline(timer);
    const pending = deadline.run(
      'database readiness check',
      125,
      () => new Promise<never>(() => undefined),
    );

    timer.fire();

    await expect(pending).rejects.toEqual(
      new DeadlineExceededError('database readiness check', 125),
    );
    expect(timer.clear).toHaveBeenCalledTimes(1);
  });
});

class RecordingTimer implements TimerScheduler {
  public readonly handle = Symbol('timer');
  public readonly clear = vi.fn((handle: unknown) => {
    void handle;
  });
  public delayMs: number | undefined;
  #callback: (() => void) | undefined;

  public set(callback: () => void, delayMs: number): unknown {
    this.#callback = callback;
    this.delayMs = delayMs;
    return this.handle;
  }

  public fire(): void {
    this.#callback?.();
  }
}
