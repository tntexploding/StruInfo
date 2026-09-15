import {requireOperationValue} from './operation_error.js';
import {describe, expect, it} from 'vitest';
import type {CurrentInformationEntry} from '../modules/entries/index.js';
import {recallRelationCandidates} from './relation_candidate_recall.js';

function entry(
  n: number,
  keywords: string[],
  body = 'Synthetic document.',
): CurrentInformationEntry {
  const id = `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
  return {
    workspaceId: '00000000-0000-4000-8000-000000000000',
    entryId: id,
    snapshotId: id,
    resourceId: id,
    revisionId: id,
    revision: 1,
    sourceKey: 'synthetic',
    canonicalUri: `https://example.invalid/${String(n)}`,
    capturedAt: '2040-01-01T00:00:00.000Z',
    value: {
      documentOrder: 1,
      titlePath: 'Synthetic document',
      body,
      bodySha256: 'a'.repeat(64),
      chunkMode: 'whole',
      splitRuleVersion: 'synthetic.v1',
      isPrivate: false,
      fragmentIds: [id],
      domains: [],
      contentKeywords: keywords.map((displayValue) => ({
        displayValue,
        normalizedValue: displayValue.toLowerCase(),
        origin: 'manual',
        originVersion: 'synthetic.v1',
      })),
    },
  };
}
describe('multilingual document relation recall', () => {
  it('ignores invented short codes and URL parameters but keeps grounded acronyms and confirmed aliases', () => {
    const anchor = entry(
      1,
      ['Synthetic Republic', 'Starvine protocol'],
      'The SVP protocol is described here. [chart](https://example.invalid/?country=SR)',
    );
    const grounded = entry(2, ['SVP']);
    const ambiguous = entry(3, ['SR']);
    const confirmed = entry(4, ['SX']);
    const results = recallRelationCandidates(
      anchor,
      [grounded, ambiguous, confirmed],
      {
        concepts: [
          {term: 'Synthetic Republic', variants: ['SR']},
          {term: 'Starvine protocol', variants: ['SVP']},
        ],
      },
      [{source: 'Starvine protocol', canonical: 'SX'}],
      8,
    );
    expect(results.map((r) => r.entry.entryId).sort()).toEqual(
      [grounded.entryId, confirmed.entryId].sort(),
    );
  });

  it('recalls translated and synonymous terms from annotations and body without editing labels', () => {
    const anchor = entry(1, ['星藤缓冲机制']);
    const tagged = entry(2, ['Starvine buffer']);
    const body = entry(
      3,
      [],
      'The starvine buffering mechanism retains synthetic records.',
    );
    const unrelated = entry(4, ['Unrelated concept']);
    const plan = {
      concepts: [
        {
          term: '星藤缓冲机制',
          variants: ['Starvine buffer', 'starvine buffering mechanism'],
        },
      ],
    };
    const before = JSON.stringify([anchor, tagged, body]);
    const results = recallRelationCandidates(
      anchor,
      [anchor, tagged, body, unrelated],
      plan,
      [],
      8,
    );
    expect(results.map((r) => r.entry.entryId)).toEqual([
      tagged.entryId,
      body.entryId,
    ]);
    expect(results[1]?.reasons).toContain(
      '星藤缓冲机制 → starvine buffering mechanism（正文）',
    );
    expect(JSON.stringify([anchor, tagged, body])).toBe(before);
  });
  it('follows confirmed alias chains without a model and keeps Latin word boundaries', () => {
    const anchor = entry(1, ['luma']);
    const direct = entry(2, ['lumina']);
    const translated = entry(3, ['示例光环']);
    const falsePositive = entry(
      4,
      [],
      'The synthetic term lumatic is unrelated.',
    );
    const results = recallRelationCandidates(
      anchor,
      [anchor, direct, translated, falsePositive],
      undefined,
      [
        {source: 'luma', canonical: 'lumina'},
        {source: 'lumina', canonical: '示例光环'},
      ],
      8,
    );
    expect(results.map((r) => r.entry.entryId)).toEqual([
      direct.entryId,
      translated.entryId,
    ]);
  });
  it('uses the latest whole capture and reserves one candidate per distinct source', () => {
    const anchor = entry(1, ['Synthetic concept']);
    const old = entry(2, ['Synthetic concept']);
    const fragment = {
      ...old,
      entryId: entry(3, []).entryId,
      value: {...old.value, chunkMode: 'split' as const},
    };
    const fresh = {
      ...entry(4, ['Synthetic concept']),
      canonicalUri: requireOperationValue(old.canonicalUri),
      capturedAt: '2040-01-02T00:00:00.000Z',
    };
    const other = entry(5, ['Synthetic concept']);
    const sameAsAnchor = {
      ...entry(6, ['Synthetic concept']),
      canonicalUri: requireOperationValue(anchor.canonicalUri),
    };
    const results = recallRelationCandidates(
      anchor,
      [old, fragment, fresh, other, sameAsAnchor],
      undefined,
      [],
      2,
    );
    expect(results.map((r) => r.entry.entryId)).toEqual([
      fresh.entryId,
      other.entryId,
    ]);
  });
  it('excludes private and blocked entries before ranking and counting', () => {
    const anchor = entry(1, ['Synthetic concept']);
    const privateEntry = entry(2, ['Synthetic concept']);
    const blocked = entry(3, ['Synthetic concept']);
    const publicEntry = entry(4, ['Synthetic concept']);
    const results = recallRelationCandidates(
      anchor,
      [
        {...privateEntry, value: {...privateEntry.value, isPrivate: true}},
        blocked,
        publicEntry,
      ],
      undefined,
      [],
      4,
      new Set([blocked.entryId]),
    );
    expect(results.map((r) => r.entry.entryId)).toEqual([publicEntry.entryId]);
  });
});
