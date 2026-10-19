/** Limits independent documents and model dispatches without renewing their budgets. */
export class AiWorkQueue {
  private active = 0;
  private pumping = false;
  private readonly waiting: {
    run: () => Promise<void>;
    fail: (error: unknown) => void;
  }[] = [];
  constructor(private readonly concurrency: () => Promise<number>) {}
  run<T>(operation: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this.waiting.push({
        run: async () => {
          try {
            resolve(await operation());
          } catch (error) {
            reject(
              error instanceof Error ? error : new Error('ai_queue_failed'),
            );
          }
        },
        fail: reject,
      });
      void this.pump();
    });
  }
  private async pump() {
    if (this.pumping) return;
    this.pumping = true;
    try {
      const configured = await this.concurrency();
      const limit = Number.isInteger(configured)
        ? Math.max(1, Math.min(4, configured))
        : 1;
      while (this.active < limit && this.waiting.length) {
        const work = this.waiting.shift();
        if (!work) break;
        this.active++;
        void work.run().finally(() => {
          this.active--;
          void this.pump();
        });
      }
    } catch (error) {
      for (const work of this.waiting.splice(0)) work.fail(error);
    } finally {
      this.pumping = false;
    }
  }
}
