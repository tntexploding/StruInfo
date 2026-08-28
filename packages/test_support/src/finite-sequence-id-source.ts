import {TestSupportError, testSupportErrorCodes} from './test-support-error.js';

export interface IdSource {
  nextId(): string;
}

export class FiniteSequenceIdSource implements IdSource {
  readonly #ids: readonly string[];
  #nextIndex = 0;

  constructor(ids: readonly string[]) {
    const copiedIds = [...ids];
    const seenIds = new Set<string>();

    for (const [index, id] of copiedIds.entries()) {
      if (id.length === 0 || id.trim() !== id) {
        throw new TestSupportError(
          testSupportErrorCodes.finiteIdSourceInvalidId,
          'Finite ID values must be non-empty and have no surrounding whitespace.',
          {index},
        );
      }
      if (seenIds.has(id)) {
        throw new TestSupportError(
          testSupportErrorCodes.finiteIdSourceDuplicate,
          'Finite ID values must be unique.',
          {id},
        );
      }
      seenIds.add(id);
    }

    this.#ids = Object.freeze(copiedIds);
  }

  get consumedCount(): number {
    return this.#nextIndex;
  }

  get remainingCount(): number {
    return this.#ids.length - this.#nextIndex;
  }

  nextId(): string {
    const id = this.#ids[this.#nextIndex];
    if (id === undefined) {
      throw new TestSupportError(
        testSupportErrorCodes.finiteIdSourceExhausted,
        'Finite ID source is exhausted.',
        {consumedCount: this.#nextIndex},
      );
    }

    this.#nextIndex += 1;
    return id;
  }

  assertFullyConsumed(): void {
    if (this.remainingCount !== 0) {
      throw new TestSupportError(
        testSupportErrorCodes.finiteIdSourceUnconsumed,
        'Finite ID source still has unconsumed values.',
        {
          consumedCount: this.consumedCount,
          remainingCount: this.remainingCount,
        },
      );
    }
  }
}
