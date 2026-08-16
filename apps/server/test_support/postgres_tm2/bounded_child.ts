import type {ChildProcess} from 'node:child_process';

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
  destroyStdin(): void;
  destroyStdout(): void;
  destroyStderr(): void;
  unref(): void;
}

export interface Tm2DeadlinePort {
  schedule(delayMs: number, callback: () => void): object;
  cancel(handle: object): void;
}

export interface Tm2ChildOutputPort {
  stop(discard: boolean): void;
  destroy(): void;
}

interface Tm2BoundedChildResourceState {
  readonly confirmedClosed: boolean;
  readonly safeToDeleteTaskRoot: boolean;
}

export type Tm2BoundedChildResult =
  | (Tm2BoundedChildResourceState & {
      readonly status: 'completed';
      readonly exitCode: number | null;
      readonly signal: NodeJS.Signals | null;
    })
  | (Tm2BoundedChildResourceState & {readonly status: 'spawn_failed'})
  | (Tm2BoundedChildResourceState & {readonly status: 'timed_out'})
  | (Tm2BoundedChildResourceState & {
      readonly status: 'termination_failed';
    })
  | (Tm2BoundedChildResourceState & {readonly status: 'harness_failed'});

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

type Tm2ChildLifecycleState =
  | 'running'
  | 'termination_requested'
  | 'closed_reaped'
  | 'detached_after_reap_failure'
  | 'settled';

export const SYSTEM_TM2_DEADLINE: Tm2DeadlinePort = Object.freeze({
  schedule(delayMs: number, callback: () => void): object {
    return setTimeout(callback, delayMs);
  },
  cancel(handle: object): void {
    clearTimeout(handle as NodeJS.Timeout);
  },
});

export function createTm2ChildProcessPort(
  child: ChildProcess,
): Tm2ChildProcessPort {
  return {
    onError(listener): void {
      child.on('error', listener);
    },
    offError(listener): void {
      child.removeListener('error', listener);
    },
    onClose(listener): void {
      child.on('close', listener);
    },
    offClose(listener): void {
      child.removeListener('close', listener);
    },
    kill(signal): boolean {
      return child.kill(signal);
    },
    destroyStdin(): void {
      child.stdin?.destroy();
    },
    destroyStdout(): void {
      child.stdout?.destroy();
    },
    destroyStderr(): void {
      child.stderr?.destroy();
    },
    unref(): void {
      child.unref();
    },
  };
}

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
    let lifecycle: Tm2ChildLifecycleState = 'running';
    let settled = false;
    let terminationFault = false;
    let killInProgress = false;
    let closeDuringKill:
      | {
          readonly exitCode: number | null;
          readonly signal: NodeJS.Signals | null;
        }
      | undefined;
    let executionDeadline: object | undefined;
    let reapDeadline: object | undefined;
    let outputStopped = false;
    let outputDestroyed = false;

    const attempt = (operation: () => void): boolean => {
      try {
        operation();
        return true;
      } catch {
        return false;
      }
    };

    const stopOutput = (discard: boolean): boolean => {
      if (outputStopped) {
        return true;
      }
      outputStopped = true;
      return attempt(() => {
        options.output.stop(discard);
      });
    };

    const destroyOutput = (): boolean => {
      if (outputDestroyed) {
        return true;
      }
      outputDestroyed = true;
      return attempt(() => {
        options.output.destroy();
      });
    };

    const cancelExecutionDeadline = (): boolean => {
      if (executionDeadline === undefined) {
        return true;
      }
      const handle = executionDeadline;
      executionDeadline = undefined;
      return attempt(() => {
        options.deadline.cancel(handle);
      });
    };

    const cancelReapDeadline = (): boolean => {
      if (reapDeadline === undefined) {
        return true;
      }
      const handle = reapDeadline;
      reapDeadline = undefined;
      return attempt(() => {
        options.deadline.cancel(handle);
      });
    };

    const cleanResources = (configuration: {
      readonly discardOutput: boolean;
      readonly destroyPorts: boolean;
      readonly detach: boolean;
    }): boolean => {
      const results: boolean[] = [];
      results.push(stopOutput(configuration.discardOutput));
      if (configuration.destroyPorts) {
        results.push(destroyOutput());
        results.push(
          attempt(() => {
            options.child.destroyStdin();
          }),
        );
        results.push(
          attempt(() => {
            options.child.destroyStdout();
          }),
        );
        results.push(
          attempt(() => {
            options.child.destroyStderr();
          }),
        );
      }
      results.push(
        attempt(() => {
          options.child.offError(onError);
        }),
      );
      results.push(
        attempt(() => {
          options.child.offClose(onClose);
        }),
      );
      results.push(cancelExecutionDeadline());
      results.push(cancelReapDeadline());
      if (configuration.detach) {
        results.push(
          attempt(() => {
            options.child.unref();
          }),
        );
      }
      return results.every((result) => result);
    };

    const settle = (
      result: Tm2BoundedChildResult,
      configuration: {
        readonly discardOutput: boolean;
        readonly destroyPorts: boolean;
        readonly detach: boolean;
      },
    ): void => {
      if (settled) {
        return;
      }
      settled = true;
      const resourcesClean = cleanResources(configuration);
      lifecycle = 'settled';
      void lifecycle;
      if (resourcesClean) {
        resolve(Object.freeze(result));
        return;
      }
      resolve(
        Object.freeze({
          status:
            result.confirmedClosed && result.status === 'completed'
              ? 'harness_failed'
              : 'termination_failed',
          confirmedClosed: result.confirmedClosed,
          safeToDeleteTaskRoot: result.safeToDeleteTaskRoot,
        }),
      );
    };

    const settleClosedAfterTermination = (): void => {
      lifecycle = 'closed_reaped';
      settle(
        {
          status: terminationFault ? 'termination_failed' : 'timed_out',
          confirmedClosed: true,
          safeToDeleteTaskRoot: true,
        },
        {discardOutput: true, destroyPorts: true, detach: false},
      );
    };

    function onError(error: unknown): void {
      void error;
      if (settled) {
        return;
      }
      if (lifecycle === 'termination_requested') {
        terminationFault = true;
        return;
      }
      settle(
        {
          status: 'spawn_failed',
          confirmedClosed: false,
          safeToDeleteTaskRoot: true,
        },
        {discardOutput: true, destroyPorts: true, detach: true},
      );
    }

    function onClose(
      exitCode: number | null,
      signal: NodeJS.Signals | null,
    ): void {
      if (settled) {
        return;
      }
      if (killInProgress) {
        closeDuringKill = {exitCode, signal};
        return;
      }
      if (lifecycle === 'termination_requested') {
        settleClosedAfterTermination();
        return;
      }
      lifecycle = 'closed_reaped';
      settle(
        {
          status: 'completed',
          exitCode,
          signal,
          confirmedClosed: true,
          safeToDeleteTaskRoot: true,
        },
        {discardOutput: false, destroyPorts: false, detach: false},
      );
    }

    const detachAfterReapFailure = (): void => {
      if (settled) {
        return;
      }
      lifecycle = 'detached_after_reap_failure';
      settle(
        {
          status: 'termination_failed',
          confirmedClosed: false,
          safeToDeleteTaskRoot: false,
        },
        {discardOutput: true, destroyPorts: true, detach: true},
      );
    };

    const onReapDeadline = (): void => {
      detachAfterReapFailure();
    };

    const onExecutionDeadline = (): void => {
      if (settled || lifecycle !== 'running') {
        return;
      }
      lifecycle = 'termination_requested';
      if (!stopOutput(true)) {
        terminationFault = true;
      }
      let reapScheduled = true;
      try {
        reapDeadline = options.deadline.schedule(
          options.reapDeadlineMs,
          onReapDeadline,
        );
      } catch {
        terminationFault = true;
        reapScheduled = false;
      }

      killInProgress = true;
      try {
        if (!options.child.kill('SIGKILL')) {
          terminationFault = true;
        }
      } catch {
        terminationFault = true;
      } finally {
        killInProgress = false;
      }

      if (closeDuringKill !== undefined) {
        closeDuringKill = undefined;
        settleClosedAfterTermination();
        return;
      }
      if (!reapScheduled) {
        detachAfterReapFailure();
      }
    };

    try {
      options.child.onError(onError);
      options.child.onClose(onClose);
      executionDeadline = options.deadline.schedule(
        options.deadlineMs,
        onExecutionDeadline,
      );
    } catch {
      settle(
        {
          status: 'harness_failed',
          confirmedClosed: false,
          safeToDeleteTaskRoot: false,
        },
        {discardOutput: true, destroyPorts: true, detach: true},
      );
    }
  });
}
