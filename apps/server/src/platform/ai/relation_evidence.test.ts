import {describe, expect, it} from 'vitest';
import {
  relationPassages,
  resolveRelationEvidence,
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
});
