export class Tm2Barrier {
  readonly #participantCount: number;
  #arrivals = 0;
  #release: (() => void) | undefined;
  readonly #released: Promise<void>;

  constructor(participantCount: number) {
    if (!Number.isInteger(participantCount) || participantCount < 2) {
      throw new Error('PG_TM2_BARRIER_PARTICIPANTS');
    }
    this.#participantCount = participantCount;
    this.#released = new Promise<void>((resolve) => {
      this.#release = resolve;
    });
  }

  get arrivals(): number {
    return this.#arrivals;
  }

  async arrive(): Promise<void> {
    if (this.#arrivals >= this.#participantCount) {
      throw new Error('PG_TM2_BARRIER_OVERFLOW');
    }
    this.#arrivals += 1;
    if (this.#arrivals === this.#participantCount) {
      const release = this.#release;
      this.#release = undefined;
      release?.();
    }
    await this.#released;
  }
}

export async function withTm2Deadline<T>(
  operation: Promise<T>,
  timeoutMilliseconds: number,
): Promise<T> {
  if (!Number.isInteger(timeoutMilliseconds) || timeoutMilliseconds <= 0) {
    throw new Error('PG_TM2_DEADLINE_INVALID');
  }
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_resolve, reject) => {
    timeout = setTimeout(() => {
      reject(new Error('PG_TM2_BOUNDED_DEADLINE'));
    }, timeoutMilliseconds);
  });
  try {
    return await Promise.race([operation, deadline]);
  } finally {
    if (timeout !== undefined) {
      clearTimeout(timeout);
    }
  }
}

export interface ObservedBlockedQuery {
  readonly applicationName: string;
  readonly waitEventType: string;
  readonly waitEvent: string;
  readonly transactionId: string | undefined;
}

export function isLockBlockedObservation(
  observation: ObservedBlockedQuery,
): boolean {
  return (
    observation.applicationName.startsWith('struinfo-tm2-') &&
    observation.waitEventType === 'Lock' &&
    observation.waitEvent.length > 0
  );
}
