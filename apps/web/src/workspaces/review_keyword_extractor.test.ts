import {describe, expect, it} from 'vitest';

import {
  extractReviewKeywords,
  normalizeReviewKeyword,
  reviewKeywordIdentity,
} from './review_keyword_extractor.js';

describe('review keyword extraction', () => {
  it('extracts deterministic editable candidates from a tool entry', () => {
    const result = extractReviewKeywords(
      '## TinyPNG：图片压缩工具\n\n[TinyPNG](https://tinypng.com) 可以配合 `pngquant` 使用。',
    );

    expect(result).toEqual(['TinyPNG', 'pngquant']);
  });

  it('keeps semantic link labels while excluding URL destinations by default', () => {
    const source =
      '[DOCX Editor](https://github.com/eigenpal/docx-editor) 的截图托管在 https://cdn.beekka.com/blogimg/asset/example.webp。';

    expect(extractReviewKeywords(source)).toEqual(['DOCX Editor']);
    expect(
      extractReviewKeywords(source, 8, {includeLinkDomains: true}),
    ).toEqual(['DOCX Editor', 'github.com', 'cdn.beekka.com']);
  });

  it('applies workspace-owned exact exclusions after normalization', () => {
    expect(
      extractReviewKeywords('**DOCX Editor** 与 `CLI-Tool`', 8, {
        excludedKeywords: [' docx editor '],
      }),
    ).toEqual(['CLI-Tool']);
  });

  it('normalizes candidates and deduplicates without changing display text', () => {
    const result = extractReviewKeywords(
      '# e\u0301ditor\n\n**éditeur** 与 `CLI-Tool`，再次提到 `CLI-Tool`。',
    );

    expect(result).toContain('éditeur');
    expect(result.filter((value) => value === 'CLI-Tool')).toHaveLength(1);
    expect(normalizeReviewKeyword('  ## 实用工具。 ')).toBe('实用工具');
    expect(reviewKeywordIdentity('Tool.API')).toBe('tool.api');
  });

  it('respects the requested limit and rejects non-keyword noise', () => {
    expect(extractReviewKeywords('## 介绍\n\n12345', 3)).toEqual([]);
    expect(
      extractReviewKeywords('`one.tool` `two.tool` `three.tool`', 2),
    ).toEqual(['one.tool', 'two.tool']);
  });
});
