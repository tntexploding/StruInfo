import {describe, expect, it} from 'vitest';

import type {VocabularyTerm} from '../api/m1c_api_contract.js';
import {
  buildVocabularyPairSuggestions,
  canonicalizeReviewKeyword,
  preferredKnowledgeKind,
  vocabularySuggestionsForKeyword,
  withVocabularyAlias,
} from './review_vocabulary.js';

const EMPTY = Object.freeze({
  aliases: Object.freeze([]),
  links: Object.freeze([]),
  knowledgeKinds: Object.freeze([]),
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

  it('suggests containment but does not automatically merge it', () => {
    const terms = [term('1', 'Data Tool'), term('2', 'Tool')];

    expect(vocabularySuggestionsForKeyword('Data Tool CLI', terms)).toEqual([
      expect.objectContaining({displayName: 'Data Tool', reason: 'contains'}),
      expect.objectContaining({displayName: 'Tool', reason: 'contains'}),
    ]);
    expect(buildVocabularyPairSuggestions(terms)).toEqual([
      expect.objectContaining({reason: 'contains'}),
    ]);
  });

  it('maps a user-selected classification to a generic knowledge kind', () => {
    expect(
      preferredKnowledgeKind(['Synthetic Cover'], {
        ...EMPTY,
        knowledgeKinds: [{keyword: 'Synthetic Cover', knowledgeKind: 'work'}],
      }),
    ).toBe('work');
  });
});

function term(termId: string, displayName: string): VocabularyTerm {
  return {
    workspaceId: '11111111-1111-4111-8111-111111111111',
    termId: termId.padStart(8, '0') + '-1111-4111-8111-111111111111',
    currentRevision: 1,
    currentRevisionId: '22222222-2222-4222-8222-222222222222',
    value: {displayName, lifecycle: 'active'},
  };
}
