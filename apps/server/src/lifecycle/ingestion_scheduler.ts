import {NodeTimerScheduler, type TimerScheduler} from './deadline.js';
import type {RuntimeResource} from './runtime_resource.js';
import type {RuntimeLogger} from '../logging/structured_logger.js';

/** The same durable queue covers manual uploads and every subscription connector. */
export class IngestionScheduler implements RuntimeResource {
  public readonly name = 'ingestion-scheduler';
  private accepting = true;
  private handle: unknown;
  private active: Promise<void> = Promise.resolve();
  public constructor(
    private readonly poll: () => Promise<void>,
    private readonly logger: RuntimeLogger,
    private readonly timer: TimerScheduler = new NodeTimerScheduler(),
  ) {
    this.schedule(1000);
  }
  private schedule(ms = 60_000) {
    if (!this.accepting) return;
    this.handle = this.timer.set(() => {
      this.handle = undefined;
      if (this.accepting) this.active = this.run();
    }, ms);
  }
  private async run() {
    try {
      await this.poll();
    } catch {
      this.logger.write('warn', 'ingestion_poll_failed', {
        code: 'ingestion_unavailable',
      });
    } finally {
      this.schedule();
    }
  }
  public stopAccepting() {
    this.accepting = false;
    if (this.handle !== undefined) this.timer.clear(this.handle);
  }
  public async drain() {
    await this.active;
  }
  public async close() {
    this.stopAccepting();
    await this.drain();
  }
}
