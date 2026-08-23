import {describe, expect, it} from 'vitest';

import {
  canonicalizeReviewKeyword,
  withVocabularyAlias,
} from './review_vocabulary.js';

const EMPTY = Object.freeze({
  aliases: Object.freeze([]),
});

describe('review vocabulary reconciliation', () => {
  it('follows external alias rules without embedding a user vocabulary', () => {
    const preferences = withVocabularyAlias(
      EMPTY,
      'Synthetic CLI',
      'Synthetic Utility',
    );
    const chained = withVocabularyAlias(
      preferences,
      'SYNTHETIC-CLI',
      'Synthetic CLI',
    );

    expect(canonicalizeReviewKeyword('synthetic cli', preferences)).toBe(
      'Synthetic Utility',
    );
    expect(canonicalizeReviewKeyword('SYNTHETIC-CLI', chained)).toBe(
      'Synthetic Utility',
    );
  });

  it('deduplicates case variants by replacing an existing alias source', () => {
    const first = withVocabularyAlias(EMPTY, 'Synthetic', 'First');
    const replaced = withVocabularyAlias(first, 'SYNTHETIC', 'Second');

    expect(replaced.aliases).toEqual([
      {source: 'SYNTHETIC', canonical: 'Second'},
    ]);
    expect(canonicalizeReviewKeyword('synthetic', replaced)).toBe('Second');
  });
});
