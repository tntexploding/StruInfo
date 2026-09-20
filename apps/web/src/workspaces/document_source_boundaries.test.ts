import {describe, expect, it} from 'vitest';
import type {
  EvidenceStructure,
  InformationEntry,
} from '../api/m1c_api_contract.js';
import {documentSourceBoundaries} from './document_source_boundaries.js';
const structure: EvidenceStructure = {
  structureId: 'structure',
  parserName: 'synthetic',
  parserVersion: '1',
  textNormalizationVersion: '1',
  structureSha256: 'hash',
  textBlob: {algorithm: 'sha256', digest: 'hash', byteLength: 6},
  normalizedText: 'A😀Z',
  fragments: [
    {
      fragmentId: 'fragment',
      structureId: 'structure',
      nodeId: 'node',
      nodeKind: 'section',
      codePointRange: {start: 0, end: 3},
      selectedTextSha256: 'hash',
      selectedText: 'A😀Z',
    },
  ],
};
const entry = (
  order: number,
  start: number,
  end: number,
): InformationEntry => ({
  workspaceId: 'workspace',
  entryId: 'entry-' + order.toString(),
  resourceId: 'resource',
  snapshotId: 'snapshot',
  revision: 1,
  revisionId: 'revision',
  sourceKey: 'synthetic',
  capturedAt: '2026-01-01T00:00:00Z',
  value: {
    documentOrder: order,
    titlePath: 'Synthetic ' + order.toString(),
    body: 'synthetic',
    bodySha256: 'hash',
    chunkMode: 'split',
    splitRuleVersion: 'synthetic',
    isPrivate: false,
    contentKeywords: [],
    domains: [],
    fragmentIds: ['fragment'],
    fragmentRanges: [{startCodePoint: start, endCodePoint: end}],
  },
});
describe('evidence anchored source boundaries', () => {
  it('uses code point ranges instead of repeated text matching', () => {
    expect(
      documentSourceBoundaries(structure, [entry(0, 0, 2), entry(1, 2, 3)]),
    ).toEqual([{offset: 3, label: '第 2 条 · Synthetic 1'}]);
  });
  it('does not draw cuts on unrelated evidence or an unsplit article', () => {
    expect(documentSourceBoundaries(structure, [entry(0, 0, 3)])).toEqual([]);
    expect(
      documentSourceBoundaries({...structure, fragments: []}, [
        entry(0, 0, 2),
        entry(1, 2, 3),
      ]),
    ).toEqual([]);
  });
});
