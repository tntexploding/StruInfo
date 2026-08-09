import {DeadlineExceededError, type Deadline} from './deadline.js';
import {toError, type RuntimeResource} from './runtime_resource.js';
import type {RuntimeLogger} from '../logging/structured_logger.js';

export type ShutdownSignal = 'SIGINT' | 'SIGTERM';

export type ShutdownStatus = 'completed' | 'failed' | 'timed_out' | 'forced';

export interface ExitDecision {
  exit(code: number): void;
}

export interface SignalSource {
  subscribe(handler: (signal: ShutdownSignal) => void): () => void;
}

export interface ShutdownReadiness {
  beginShutdown(): void;
}

export class ProcessExitDecision implements ExitDecision {
  public exit(code: number): never {
    process.exit(code);
  }
}

export class ProcessSignalSource implements SignalSource {
  public subscribe(handler: (signal: ShutdownSignal) => void): () => void {
    const onSigint = (): void => {
      handler('SIGINT');
    };
    const onSigterm = (): void => {
      handler('SIGTERM');
    };
    process.on('SIGINT', onSigint);
    process.on('SIGTERM', onSigterm);
    return (): void => {
      process.off('SIGINT', onSigint);
      process.off('SIGTERM', onSigterm);
    };
  }
}

export class ShutdownCoordinator {
  readonly #readiness: ShutdownReadiness;
  readonly #resources: readonly RuntimeResource[];
  readonly #deadline: Deadline;
  readonly #timeoutMs: number;
  readonly #logger: RuntimeLogger;
  readonly #exitDecision: ExitDecision;
  #shutdownPromise: Promise<ShutdownStatus> | undefined;
  #forceRequested = false;

  public constructor(options: {
    readonly readiness: ShutdownReadiness;
    readonly resources: readonly RuntimeResource[];
    readonly deadline: Deadline;
    readonly timeoutMs: number;
    readonly logger: RuntimeLogger;
    readonly exitDecision: ExitDecision;
  }) {
    this.#readiness = options.readiness;
    this.#resources = options.resources;
    this.#deadline = options.deadline;
    this.#timeoutMs = options.timeoutMs;
    this.#logger = options.logger;
    this.#exitDecision = options.exitDecision;
  }

  public bind(signalSource: SignalSource): () => void {
    return signalSource.subscribe((signal) => {
      this.handleSignal(signal);
    });
  }

  public handleSignal(signal: ShutdownSignal): void {
    if (this.#shutdownPromise === undefined) {
      void this.requestShutdown(signal, true);
      return;
    }
    this.forceExit(signal);
  }

  public requestShutdown(
    trigger: string,
    exitWhenDone = false,
  ): Promise<ShutdownStatus> {
    if (this.#shutdownPromise !== undefined) {
      return this.#shutdownPromise;
    }

    this.#readiness.beginShutdown();
    this.#shutdownPromise = this.executeShutdown(trigger, exitWhenDone);
    return this.#shutdownPromise;
  }

  private forceExit(signal: ShutdownSignal): void {
    if (this.#forceRequested) {
      return;
    }
    this.#forceRequested = true;
    this.#logger.write('error', 'shutdown_forced', {signal});
    this.#exitDecision.exit(1);
  }

  private async executeShutdown(
    trigger: string,
    exitWhenDone: boolean,
  ): Promise<ShutdownStatus> {
    try {
      await this.#deadline.run('graceful shutdown', this.#timeoutMs, () =>
        this.performOrderlyShutdown(),
      );
      if (this.#forceRequested) {
        return 'forced';
      }
      this.#logger.write('info', 'shutdown_completed', {trigger});
      if (exitWhenDone) {
        this.#exitDecision.exit(0);
      }
      return 'completed';
    } catch (error) {
      if (this.#forceRequested) {
        return 'forced';
      }
      const timedOut = error instanceof DeadlineExceededError;
      this.#logger.write(
        'error',
        timedOut ? 'shutdown_timed_out' : 'shutdown_failed',
        {trigger, error},
      );
      if (exitWhenDone) {
        this.#exitDecision.exit(1);
      }
      return timedOut ? 'timed_out' : 'failed';
    }
  }

  private async performOrderlyShutdown(): Promise<void> {
    const failures: Error[] = [];
    const reverseResources = [...this.#resources].reverse();

    for (const resource of reverseResources) {
      try {
        await resource.stopAccepting();
      } catch (error) {
        failures.push(toError(error));
      }
    }
    for (const resource of reverseResources) {
      try {
        await resource.drain();
      } catch (error) {
        failures.push(toError(error));
      }
    }
    for (const resource of reverseResources) {
      try {
        await resource.close();
      } catch (error) {
        failures.push(toError(error));
      }
    }

    if (failures.length > 0) {
      throw new AggregateError(
        failures,
        'One or more resources failed to stop.',
      );
    }
  }
}
