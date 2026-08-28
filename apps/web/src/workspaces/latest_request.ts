export interface LatestRequestTracker {
  readonly begin: () => number;
  readonly invalidate: () => void;
  readonly isCurrent: (requestId: number) => boolean;
}

export function createLatestRequestTracker(): LatestRequestTracker {
  let latestRequestId = 0;

  return Object.freeze({
    begin(): number {
      latestRequestId += 1;
      return latestRequestId;
    },
    invalidate(): void {
      latestRequestId += 1;
    },
    isCurrent(requestId: number): boolean {
      return requestId === latestRequestId;
    },
  });
}
