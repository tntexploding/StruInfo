import {describe, expect, it} from 'vitest';

import {
  decodeReviewNote,
  encodeReviewNote,
  reviewNoteCodePointLength,
} from './review_directive_note.js';

describe('review directive note', () => {
  it('keeps an ordinary note unchanged for the default link policy', () => {
    const encoded = encodeReviewNote('人工判断', {
      linkPolicy: 'auto_candidates',
      explicitLinks: [],
    });

    expect(encoded).toBe('人工判断');
    expect(decodeReviewNote(encoded)).toEqual({
      humanNote: '人工判断',
      directive: {linkPolicy: 'auto_candidates', explicitLinks: []},
    });
  });

  it('round trips a closed relation-processing directive', () => {
    const encoded = encodeReviewNote('这是一项工具。', {
      linkPolicy: 'manual_only',
      explicitLinks: [
        {
          targetKind: 'fragment',
          targetId: '11111111-1111-4111-8111-111111111111',
          relationTypeKey: 'uses',
        },
      ],
    });

    expect(decodeReviewNote(encoded)).toEqual({
      humanNote: '这是一项工具。',
      directive: {
        linkPolicy: 'manual_only',
        explicitLinks: [
          {
            targetKind: 'fragment',
            targetId: '11111111-1111-4111-8111-111111111111',
            relationTypeKey: 'uses',
          },
        ],
      },
    });
    expect(reviewNoteCodePointLength(encoded)).toBeGreaterThan(20);
  });

  it('preserves malformed or unknown markers as human text', () => {
    const value = '不要丢失\n\n<!--struinfo-review-directive-v1:{bad}-->';
    expect(decodeReviewNote(value)).toEqual({
      humanNote: value,
      directive: {linkPolicy: 'auto_candidates', explicitLinks: []},
    });
  });
});
