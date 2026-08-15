export const TM2_ADMISSION_CHILD_DEADLINE_MS = 60_000;
export const TM2_MANDATORY_CHILD_DEADLINE_MS = 1_800_000;
export const TM2_CHILD_REAP_DEADLINE_MS = 10_000;

export type Tm2BoundedChildKind = 'admission' | 'mandatory';

export interface Tm2ChildProcessPort {
  onError(listener: (error: unknown) => void): void;
  offError(listener: (error: unknown) => void): void;
  onClose(
    listener: (exitCode: number | null, signal: NodeJS.Signals | null) => void,
  ): void;
  offClose(
    listener: (exitCode: number | null, signal: NodeJS.Signals | null) => void,
  ): void;
  kill(signal: NodeJS.Signals): boolean;
}

export interface Tm2DeadlinePort {
  schedule(delayMs: number, callback: () => void): object;
  cancel(handle: object): void;
}

export interface Tm2ChildOutputPort {
  stop(discard: boolean): void;
}

export type Tm2BoundedChildResult =
  | {
      readonly status: 'completed';
      readonly exitCode: number | null;
      readonly signal: NodeJS.Signals | null;
    }
  | {readonly status: 'spawn_failed'}
  | {readonly status: 'timed_out'}
  | {readonly status: 'termination_failed'}
  | {readonly status: 'harness_failed'};

export type Tm2BoundedChildFailureCode =
  | 'tm2_admission_child_failure'
  | 'tm2_admission_child_timeout'
  | 'tm2_admission_child_termination_failure'
  | 'tm2_mandatory_child_failure'
  | 'tm2_mandatory_child_timeout'
  | 'tm2_mandatory_child_termination_failure'
  | 'tm2_harness_failure';

export interface RunTm2BoundedChildOptions {
  readonly child: Tm2ChildProcessPort;
  readonly deadline: Tm2DeadlinePort;
  readonly deadlineMs: number;
  readonly reapDeadlineMs: number;
  readonly output: Tm2ChildOutputPort;
}

export const SYSTEM_TM2_DEADLINE: Tm2DeadlinePort = Object.freeze({
  schedule(delayMs: number, callback: () => void): object {
    return setTimeout(callback, delayMs);
  },
  cancel(handle: object): void {
    clearTimeout(handle as NodeJS.Timeout);
  },
});

export function failureCodeForBoundedChild(
  kind: Tm2BoundedChildKind,
  result: Exclude<Tm2BoundedChildResult, {readonly status: 'completed'}>,
): Tm2BoundedChildFailureCode {
  switch (result.status) {
    case 'spawn_failed':
      return kind === 'admission'
        ? 'tm2_admission_child_failure'
        : 'tm2_mandatory_child_failure';
    case 'timed_out':
      return kind === 'admission'
        ? 'tm2_admission_child_timeout'
        : 'tm2_mandatory_child_timeout';
    case 'termination_failed':
      return kind === 'admission'
        ? 'tm2_admission_child_termination_failure'
        : 'tm2_mandatory_child_termination_failure';
    case 'harness_failed':
      return 'tm2_harness_failure';
  }
}

export async function runTm2BoundedChild(
  options: RunTm2BoundedChildOptions,
): Promise<Tm2BoundedChildResult> {
  return await new Promise<Tm2BoundedChildResult>((resolve) => {
    let settled = false;
    let timedOut = false;
    let killFailed = false;
    let killInProgress = false;
    let closeDuringKill:
      | {
          readonly exitCode: number | null;
          readonly signal: NodeJS.Signals | null;
        }
      | undefined;
    let deadlineHandle: object | undefined;
    let reapHandle: object | undefined;
    let outputStopped = false;

    const stopOutput = (discard: boolean): boolean => {
      if (outputStopped) {
        return true;
      }
      outputStopped = true;
      try {
        options.output.stop(discard);
        return true;
      } catch {
        return false;
      }
    };

    const removeListeners = (): boolean => {
      try {
        options.child.offError(onError);
        options.child.offClose(onClose);
        return true;
      } catch {
        return false;
      }
    };

    const cancelDeadlines = (): boolean => {
      try {
        if (deadlineHandle !== undefined) {
          options.deadline.cancel(deadlineHandle);
          deadlineHandle = undefined;
        }
        if (reapHandle !== undefined) {
          options.deadline.cancel(reapHandle);
          reapHandle = undefined;
        }
        return true;
      } catch {
        return false;
      }
    };

    const settle = (
      result: Tm2BoundedChildResult,
      discardOutput: boolean,
    ): void => {
      if (settled) {
        return;
      }
      settled = true;
      const outputSucceeded = stopOutput(discardOutput);
      const listenersSucceeded = removeListeners();
      const deadlinesSucceeded = cancelDeadlines();
      const cleanupSucceeded =
        outputSucceeded && listenersSucceeded && deadlinesSucceeded;
      resolve(
        cleanupSucceeded ? Object.freeze(result) : {status: 'harness_failed'},
      );
    };

    const settleTimedOutClose = (): void => {
      settle(
        killFailed ? {status: 'termination_failed'} : {status: 'timed_out'},
        true,
      );
    };

    function onError(error: unknown): void {
      void error;
      settle(
        timedOut ? {status: 'termination_failed'} : {status: 'spawn_failed'},
        true,
      );
    }

    function onClose(
      exitCode: number | null,
      signal: NodeJS.Signals | null,
    ): void {
      if (killInProgress) {
        closeDuringKill = {exitCode, signal};
        return;
      }
      if (timedOut) {
        settleTimedOutClose();
        return;
      }
      settle({status: 'completed', exitCode, signal}, false);
    }

    const onReapDeadline = (): void => {
      settle({status: 'termination_failed'}, true);
    };

    const onExecutionDeadline = (): void => {
      if (settled || timedOut) {
        return;
      }
      timedOut = true;
      if (!stopOutput(true)) {
        killFailed = true;
      }
      try {
        reapHandle = options.deadline.schedule(
          options.reapDeadlineMs,
          onReapDeadline,
        );
      } catch {
        settle({status: 'termination_failed'}, true);
        return;
      }
      killInProgress = true;
      try {
        if (!options.child.kill('SIGKILL')) {
          killFailed = true;
        }
      } catch {
        killFailed = true;
      } finally {
        killInProgress = false;
      }
      if (closeDuringKill !== undefined) {
        closeDuringKill = undefined;
        settleTimedOutClose();
      }
    };

    try {
      options.child.onError(onError);
      options.child.onClose(onClose);
      deadlineHandle = options.deadline.schedule(
        options.deadlineMs,
        onExecutionDeadline,
      );
    } catch {
      settle({status: 'harness_failed'}, true);
    }
  });
}
