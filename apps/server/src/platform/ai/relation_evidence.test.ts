import {describe, expect, it} from 'vitest';
import {
  relationPassages,
  resolveRelationEvidence,
  relationEvidenceSummary,
} from './relation_evidence.js';

describe('pair-bound relation evidence', () => {
  it('resolves bounded exact original slices without copying or rewriting quotations', () => {
    const body = '# Synthetic heading\n\n' + 'A 🧪 mechanism. '.repeat(40);
    const passages = relationPassages(body, 'A');
    expect(passages.length).toBeGreaterThan(2);
    for (const passage of passages) {
      expect(Array.from(passage.text).length).toBeLessThanOrEqual(480);
      expect(body).toContain(passage.text);
    }
    expect(resolveRelationEvidence(['A:1'], passages)).toEqual([
      passages[1]?.text,
    ]);
  });

  it('keeps complete sentences and all original characters, including a long sentence', () => {
    const sentences = [
      'First mechanism. ',
      'Synthetic boundary '.repeat(40) + 'ends here. ',
      '最后一句保留完整。',
    ];
    const passages = relationPassages(sentences.join(''), 'A');
    expect(passages.map((p) => p.text).join('')).toBe(sentences.join(''));
    for (const sentence of sentences)
      expect(passages.some((p) => p.text.includes(sentence))).toBe(true);
  });

  it('rejects other endpoints, unknown IDs, duplicate IDs and heading-only evidence', () => {
    const passages = relationPassages('# Heading\n\nConcrete mechanism.', 'A');
    for (const ids of [['B:1'], ['A:99'], ['A:1', 'A:1'], ['A:0'], [], 'A:1'])
      expect(resolveRelationEvidence(ids, passages)).toBeUndefined();
  });

  it('keeps image/link references out of selectable evidence while retaining prose', () => {
    const body = [
      '# Synthetic experiment',
      '![Chart](https://example.invalid/chart.png)',
      '[图片：查看原图](https://example.invalid/chart.png)',
      'https://example.invalid/chart.png',
      'The experiment reduced latency from 9 ms to 4 ms. [Details](https://example.invalid/results)',
    ].join('\n\n');
    const passages = relationPassages(body, 'A');
    for (const id of ['A:0', 'A:1', 'A:2', 'A:3'])
      expect(resolveRelationEvidence([id], passages)).toBeUndefined();
    expect(resolveRelationEvidence(['A:4'], passages)).toEqual([
      passages[4]?.text,
    ]);
    expect(passages.map((passage) => passage.text).join('\n\n')).toBe(body);
  });

  it('excludes linked headlines while retaining a short factual explanation', () => {
    const passages = relationPassages(
      '- External implementation [https://example.invalid/a](https://example.invalid/a)\n\nA valve reduces pressure. [Details](https://example.invalid/b)',
      'A',
    );
    expect(resolveRelationEvidence(['A:0'], passages)).toBeUndefined();
    expect(resolveRelationEvidence(['A:1'], passages)).toEqual([
      passages[1]?.text,
    ]);
  });

  it('treats explicitly deferred coverage and external guide introductions as references', () => {
    const body = [
      '# Starvine method',
      'In [Starvine](https://example.invalid/paper), researchers introduce an alternative to a queue. I originally planned to cover it in this article, but I implemented it several weeks ago.',
      'For those interested in further details, I have written a separate article and implementation guide here:',
      '[Guide author](https://example.invalid/author)',
      '·',
      'February 18, 2024',
      '[Read the guide](https://example.invalid/guide)',
      'Synthetic Digest is a reader-supported publication. To receive new posts and support my work, consider becoming a free or paid subscriber.',
    ].join('\n\n');
    const passages = relationPassages(body, 'A');
    expect(passages.filter((p) => p.role === 'content')).toEqual([]);
    expect(resolveRelationEvidence(['A:1', 'A:2'], passages)).toBeUndefined();
    expect(passages.map((p) => p.text).join('\n\n')).toBe(body);
  });

  it('retains direct technical explanations even with a supplemental external link', () => {
    const body = [
      'The update factors the matrix into a direction matrix and a scale vector. [Paper](https://example.invalid/paper)',
      'We implemented the update by multiplying the scale vector by the normalized direction. Further details appear in the [guide](https://example.invalid/guide).',
      'I originally planned to describe the algorithm, but this article instead includes the derivation: the counter increments once per request.',
      'The scale vector normalizes each update. I have written an implementation guide here: [Guide](https://example.invalid/guide)',
      'For more details see the [guide](https://example.invalid/guide). The update factors the weight into direction and magnitude.',
      'The update factors the weight into direction and magnitude. I originally planned to cover it in this article, but I implemented it weeks ago. [Guide](https://example.invalid/guide)',
    ].join('\n\n');
    expect(relationPassages(body, 'A').every((p) => p.role === 'content')).toBe(
      true,
    );
  });

  it('excludes card dates only between references, retaining dates within an article', () => {
    const body = [
      '[External story](https://example.invalid/story)',
      '2024-02-18',
      '[Read full story](https://example.invalid/story)',
      'The experiment began on the following day.',
      '2024-02-19',
      'The measured delay was 3 ms.',
      'The study examines a reader-supported publication and its subscription revenue.',
    ].join('\n\n');
    const passages = relationPassages(body, 'A');
    expect(resolveRelationEvidence(['A:1'], passages)).toBeUndefined();
    for (const id of ['A:3', 'A:4', 'A:5', 'A:6'])
      expect(resolveRelationEvidence([id], passages)).toBeDefined();
    expect(passages.map((p) => p.text).join('\n\n')).toBe(body);
  });

  it('keeps referral paragraphs as context while other paragraphs remain usable', () => {
    const passages = relationPassages(
      'For more details see the implementation guide:\n\n[External guide](https://example.invalid/guide)\n\nThe measured delay fell from 8 ms to 3 ms.',
      'A',
    );
    expect(passages.map((p) => p.role)).toEqual([
      'reference',
      'reference',
      'content',
    ]);
    expect(resolveRelationEvidence(['A:2'], passages)).toEqual([
      'The measured delay fell from 8 ms to 3 ms.',
    ]);
  });

  it('stores both selected sides with explicit excerpt markers within the note limit', () => {
    const summary = relationEvidenceSummary(
      ['A short fact.', 'An independent second fact.'],
      ['🧪'.repeat(1000)],
    );
    expect(summary).toContain('「A short fact.」');
    expect(summary).toContain('「An independent second fact.」');
    expect(summary).toContain('」…');
    expect(Array.from(summary).length).toBeLessThanOrEqual(240);
  });
});
