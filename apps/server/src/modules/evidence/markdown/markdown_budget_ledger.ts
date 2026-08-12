export interface BoundedLedgerSnapshot<T> {
  readonly observations: number;
  readonly saturatedCount: number;
  readonly retained: readonly Readonly<T>[];
}

/**
 * Saturates observations and retained values at the inclusive limit plus one
 * sentinel record. The retained prefix is deterministic input order.
 */
export class BoundedPreorderLedger<T> {
  private observationsValue = 0;
  private readonly retainedValues: Readonly<T>[] = [];

  constructor(private readonly inclusiveLimit: number) {}

  observe(createValue: () => Readonly<T>): void {
    this.observeMany(1, createValue);
  }

  observeMany(count: number, createValue: () => Readonly<T>): void {
    if (!Number.isSafeInteger(count) || count < 0) {
      throw new TypeError('Ledger observation count must be non-negative.');
    }
    const retainedLimit = this.inclusiveLimit + 1;
    this.observationsValue = Math.min(
      this.observationsValue + count,
      retainedLimit,
    );
    const remaining = Math.max(0, retainedLimit - this.retainedValues.length);
    const additions = Math.min(count, remaining);
    for (let index = 0; index < additions; index += 1) {
      this.retainedValues.push(createValue());
    }
  }

  snapshot(): Readonly<BoundedLedgerSnapshot<T>> {
    return Object.freeze({
      observations: this.observationsValue,
      saturatedCount: this.observationsValue,
      retained: Object.freeze([...this.retainedValues]),
    });
  }
}

/** Counts without retaining product records and saturates at limit + 1. */
export class SaturatingBudgetCounter {
  private observationsValue = 0;

  constructor(private readonly inclusiveLimit: number) {}

  observe(): void {
    this.observeMany(1);
  }

  observeMany(count: number): void {
    if (!Number.isSafeInteger(count) || count < 0) {
      throw new TypeError('Budget observation count must be non-negative.');
    }
    this.observationsValue = Math.min(
      this.observationsValue + count,
      this.inclusiveLimit + 1,
    );
  }

  get saturatedCount(): number {
    return this.observationsValue;
  }
}
