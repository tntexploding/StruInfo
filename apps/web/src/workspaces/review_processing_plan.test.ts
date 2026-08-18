import {describe, expect, it} from 'vitest';

import {
  deriveReviewProcessingPlan,
  recommendReviewAction,
} from './review_processing_plan.js';

describe('review processing plan', () => {
  it('keeps short fragments as one item even when the stored tendency says split', () => {
    expect(
      deriveReviewProcessingPlan('split', 'short synthetic text'),
    ).toMatchObject({
      kind: 'single_item',
      label: '短条目单项',
    });
    expect(recommendReviewAction(4, 4, 'short synthetic text')).toBe('full');
  });

  it('treats a configured work as a source-backed work item', () => {
    expect(
      deriveReviewProcessingPlan('condense', 'synthetic media', 'work'),
    ).toMatchObject({kind: 'single_item', label: '作品类单项'});
  });

  it('only recommends splitting when length and structure both justify it', () => {
    const longStructured = Array.from(
      {length: 12},
      (_, index) => `Synthetic section ${index.toString()} ${'x'.repeat(80)}`,
    ).join('\n');
    expect(recommendReviewAction(4, 3, longStructured)).toBe('split');
    expect(deriveReviewProcessingPlan('split', longStructured)).toMatchObject({
      kind: 'split_items',
    });
  });
});
