import {describe, expect, it} from 'vitest';

import {createLatestRequestTracker} from './latest_request.js';

describe('latest request tracker', () => {
  it('accepts only the newest request when responses resolve out of order', () => {
    const tracker = createLatestRequestTracker();
    const firstRequest = tracker.begin();
    const secondRequest = tracker.begin();

    expect(tracker.isCurrent(firstRequest)).toBe(false);
    expect(tracker.isCurrent(secondRequest)).toBe(true);
  });

  it('invalidates pending work when its owner unmounts', () => {
    const tracker = createLatestRequestTracker();
    const pendingRequest = tracker.begin();

    tracker.invalidate();

    expect(tracker.isCurrent(pendingRequest)).toBe(false);
  });
});
