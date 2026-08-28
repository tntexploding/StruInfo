import {describe, expect, it} from 'vitest';

import type {EvidenceSnapshot} from '../api/m1c_api_contract.js';
import {
  createManualSplitDraft,
  manualSplitCaretCodePoint,
  manualSplitPieceText,
  mergeManualSplitGroups,
  splitManualSplitGroup,
  splitManualSplitPiece,
} from './information_entry_manual_split_model.js';

const FIRST_ID = '55555555-5555-4555-8555-555555555555';
const SECOND_ID = '66666666-6666-4666-8666-666666666666';

describe('InformationEntryManualSplit draft operations', () => {
  it('sorts source sections, merges adjacent groups, and restores a boundary', () => {
    const initial = createManualSplitDraft(snapshot());

    expect(initial.map((group) => group.titlePath)).toEqual([
      'First section',
      'Second section',
    ]);
    expect(
      initial.flatMap((group) =>
        group.pieces.map((piece) => piece.fragment.fragmentId),
      ),
    ).toEqual([FIRST_ID, SECOND_ID]);

    const merged = mergeManualSplitGroups(initial, 1);
    expect(merged).toHaveLength(1);
    expect(merged[0]?.pieces.map((piece) => piece.fragment.fragmentId)).toEqual(
      [FIRST_ID, SECOND_ID],
    );

    const restored = splitManualSplitGroup(merged, 0, 1);
    expect(restored).toHaveLength(2);
    expect(restored[1]?.titlePath).toBe('Second section');
    expect(splitManualSplitGroup(restored, 0, 0)).toBe(restored);
  });

  it('converts a UTF-16 caret to a Unicode scalar boundary and splits one Fragment', () => {
    const original = createManualSplitDraft(snapshot())[0]?.pieces[0];
    if (original === undefined) throw new Error('Synthetic piece missing.');
    const piece = Object.freeze({
      ...original,
      fragment: Object.freeze({
        ...original.fragment,
        selectedText: 'A😀Z',
      }),
      startCodePoint: 0,
      endCodePoint: 3,
    });
    const groups = Object.freeze([
      Object.freeze({titlePath: 'Combined', pieces: Object.freeze([piece])}),
    ]);

    expect(manualSplitCaretCodePoint(piece, 3)).toBe(2);
    expect(manualSplitCaretCodePoint(piece, 2)).toBeUndefined();
    const split = splitManualSplitPiece(groups, 0, 0, 2);
    expect(
      split.flatMap((group) => group.pieces.map(manualSplitPieceText)),
    ).toEqual(['A😀', 'Z']);
    const rejoined = mergeManualSplitGroups(split, 1);
    expect(rejoined[0]?.pieces).toMatchObject([
      {startCodePoint: 0, endCodePoint: 3},
    ]);
  });
});

function snapshot(): Readonly<EvidenceSnapshot> {
  return Object.freeze({
    workspaceId: '11111111-1111-4111-8111-111111111111',
    resourceId: '22222222-2222-4222-8222-222222222222',
    snapshotId: '33333333-3333-4333-8333-333333333333',
    resourceKind: 'manual_text' as const,
    sourceKey: 'synthetic:manual-split',
    capturedAt: '2040-01-02T03:04:05.000Z',
    fragmentCount: 2,
    rawSha256: 'a'.repeat(64),
    canonicalContentSha256: 'b'.repeat(64),
    canonicalizationVersion: 'utf8-lf-v1',
    structures: [
      {
        structureId: '44444444-4444-4444-8444-444444444444',
        parserName: 'commonmark',
        parserVersion: '1',
        textNormalizationVersion: 'utf8-lf-v1',
        structureSha256: 'c'.repeat(64),
        textBlob: {
          algorithm: 'sha256' as const,
          digest: 'd'.repeat(64),
          byteLength: 80,
        },
        normalizedText:
          '## First section\n\nFirst.\n\n## Second section\n\nSecond.',
        fragments: [
          fragment(SECOND_ID, 30, '## Second section\n\nSecond.'),
          fragment(FIRST_ID, 0, '## First section\n\nFirst.'),
        ],
      },
    ],
  });
}

function fragment(fragmentId: string, start: number, selectedText: string) {
  return Object.freeze({
    fragmentId,
    structureId: '44444444-4444-4444-8444-444444444444',
    nodeId: fragmentId,
    nodeKind: 'section' as const,
    codePointRange: {start, end: start + selectedText.length},
    selectedTextSha256: 'e'.repeat(64),
    selectedText,
  });
}
