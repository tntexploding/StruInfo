import type {RuntimeLogger} from '../logging/structured_logger.js';
import type {SourceSubscriptionServicePort} from '../modules/subscriptions/index.js';
import {NodeTimerScheduler, type TimerScheduler} from './deadline.js';
import type {RuntimeResource} from './runtime_resource.js';

export const SOURCE_SUBSCRIPTION_POLL_INTERVAL_MS = 60_000;
export const SOURCE_SUBSCRIPTION_INITIAL_DELAY_MS = 1_000;

export interface SourceSubscriptionSchedulerDependencies {
  readonly subscriptions: SourceSubscriptionServicePort;
  readonly logger: RuntimeLogger;
  readonly timer?: TimerScheduler;
  readonly pollIntervalMs?: number;
  readonly initialDelayMs?: number;
}

/**
 * Small owned runtime resource that checks only subscriptions which are due.
 * It never overlaps polls and never makes a source failure fatal to the process.
 */
export class SourceSubscriptionScheduler implements RuntimeResource {
  public readonly name = 'source-subscription-scheduler';

  readonly #subscriptions: SourceSubscriptionServicePort;
  readonly #logger: RuntimeLogger;
  readonly #timer: TimerScheduler;
  readonly #pollIntervalMs: number;
  #timerHandle: unknown;
  #activePoll: Promise<void> = Promise.resolve();
  #accepting = true;

  private constructor(
    dependencies: Readonly<SourceSubscriptionSchedulerDependencies>,
  ) {
    this.#subscriptions = dependencies.subscriptions;
    this.#logger = dependencies.logger;
    this.#timer = dependencies.timer ?? new NodeTimerScheduler();
    this.#pollIntervalMs =
      dependencies.pollIntervalMs ?? SOURCE_SUBSCRIPTION_POLL_INTERVAL_MS;
    this.#schedule(
      dependencies.initialDelayMs ?? SOURCE_SUBSCRIPTION_INITIAL_DELAY_MS,
    );
  }

  public static start(
    dependencies: Readonly<SourceSubscriptionSchedulerDependencies>,
  ): Promise<SourceSubscriptionScheduler> {
    return Promise.resolve(new SourceSubscriptionScheduler(dependencies));
  }

  public stopAccepting(): void {
    this.#accepting = false;
    if (this.#timerHandle !== undefined) {
      this.#timer.clear(this.#timerHandle);
      this.#timerHandle = undefined;
    }
  }

  public async drain(): Promise<void> {
    await this.#activePoll;
  }

  public async close(): Promise<void> {
    this.stopAccepting();
    await this.drain();
  }

  #schedule(delayMs: number): void {
    if (!this.#accepting) return;
    this.#timerHandle = this.#timer.set(() => {
      if (!this.#accepting) return;
      this.#timerHandle = undefined;
      this.#activePoll = this.#poll();
    }, delayMs);
  }

  async #poll(): Promise<void> {
    try {
      const results = await this.#subscriptions.runDue();
      if (results.length > 0) {
        this.#logger.write('info', 'source_subscription_poll_completed', {
          checked: results.length,
        });
      }
    } catch (error) {
      this.#logger.write('warn', 'source_subscription_poll_failed', {error});
    } finally {
      this.#schedule(this.#pollIntervalMs);
    }
  }
}
