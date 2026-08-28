import {TestSupportError, testSupportErrorCodes} from './test-support-error.js';

export interface Clock {
  now(): Date;
}

export class FixedClock implements Clock {
  readonly #epochMilliseconds: number;

  constructor(instant: Date | string) {
    const epochMilliseconds =
      instant instanceof Date ? instant.getTime() : Date.parse(instant);

    if (
      !Number.isFinite(epochMilliseconds) ||
      (typeof instant === 'string' &&
        new Date(epochMilliseconds).toISOString() !== instant)
    ) {
      throw new TestSupportError(
        testSupportErrorCodes.fixedClockInvalidInstant,
        'FixedClock requires a valid canonical UTC instant.',
        {instant: String(instant)},
      );
    }

    this.#epochMilliseconds = epochMilliseconds;
  }

  now(): Date {
    return new Date(this.#epochMilliseconds);
  }

  nowIso(): string {
    return this.now().toISOString();
  }
}
