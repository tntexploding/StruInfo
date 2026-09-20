import {describe, expect, it} from 'vitest';
import {matchesIntakeSource} from './intake_source_state.js';

describe('intake source grouping', () => {
  const subscriptions = new Set(['sub-one']);
  it.each(['upload', 'uploaded_file', 'manual_text'])(
    'lists genuine %s captures under manual input',
    (kind) => {
      const origin = {snapshotId: 'document', kind};
      expect(matchesIntakeSource(origin, 'manual', subscriptions)).toBe(true);
      expect(matchesIntakeSource(origin, 'other', subscriptions)).toBe(false);
    },
  );
  it('never treats an unknown remote capture or removed subscription as manual input', () => {
    for (const origin of [
      {snapshotId: 'document', kind: 'remote_document'},
      {
        snapshotId: 'document',
        kind: 'subscription',
        subscriptionId: 'removed-sub',
      },
    ]) {
      expect(matchesIntakeSource(origin, 'manual', subscriptions)).toBe(false);
      expect(matchesIntakeSource(origin, 'other', subscriptions)).toBe(true);
    }
  });
  it('keeps loading records unassigned and known subscriptions in their own list', () => {
    expect(matchesIntakeSource(undefined, 'manual', subscriptions)).toBe(false);
    expect(matchesIntakeSource(undefined, 'other', subscriptions)).toBe(false);
    const origin = {
      snapshotId: 'document',
      kind: 'subscription',
      subscriptionId: 'sub-one',
    };
    expect(matchesIntakeSource(origin, 'sub-one', subscriptions)).toBe(true);
    expect(matchesIntakeSource(origin, 'manual', subscriptions)).toBe(false);
    expect(matchesIntakeSource(origin, 'other', subscriptions)).toBe(false);
    expect(matchesIntakeSource(origin, 'all', subscriptions)).toBe(true);
  });
});
