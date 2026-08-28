export class DeadlineExceededError extends Error {
  public constructor(label: string, timeoutMs: number) {
    super(`${label} exceeded its ${String(timeoutMs)} ms deadline.`);
    this.name = 'DeadlineExceededError';
  }
}

export interface Deadline {
  run<T>(
    label: string,
    timeoutMs: number,
    operation: () => Promise<T>,
  ): Promise<T>;
}

export interface TimerScheduler {
  set(callback: () => void, delayMs: number): unknown;
  clear(handle: unknown): void;
}

export class NodeTimerScheduler implements TimerScheduler {
  public set(callback: () => void, delayMs: number): NodeJS.Timeout {
    return setTimeout(callback, delayMs);
  }

  public clear(handle: unknown): void {
    clearTimeout(handle as NodeJS.Timeout);
  }
}

export class SystemDeadline implements Deadline {
  readonly #timer: TimerScheduler;

  public constructor(timer: TimerScheduler) {
    this.#timer = timer;
  }

  public async run<T>(
    label: string,
    timeoutMs: number,
    operation: () => Promise<T>,
  ): Promise<T> {
    let timerHandle: unknown;
    const timeout = new Promise<never>((_resolve, reject) => {
      timerHandle = this.#timer.set(() => {
        reject(new DeadlineExceededError(label, timeoutMs));
      }, timeoutMs);
    });

    try {
      return await Promise.race([operation(), timeout]);
    } finally {
      this.#timer.clear(timerHandle);
    }
  }
}
