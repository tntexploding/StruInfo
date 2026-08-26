import type {
  EvidenceFragment,
  EvidenceSnapshot,
  InformationEntryFragmentGroup,
} from '../api/m1c_api_contract.js';

export interface ManualSplitDraftPiece {
  readonly fragment: Readonly<EvidenceFragment>;
  readonly startCodePoint: number;
  readonly endCodePoint: number;
}

export interface ManualSplitDraftGroup {
  readonly titlePath: string;
  readonly pieces: readonly Readonly<ManualSplitDraftPiece>[];
}

export function createManualSplitDraft(
  snapshot: Readonly<EvidenceSnapshot>,
): readonly Readonly<ManualSplitDraftGroup>[] {
  const sections = [...(snapshot.structures[0]?.fragments ?? [])]
    .filter((fragment) => fragment.nodeKind === 'section')
    .sort((left, right) =>
      left.codePointRange.start !== right.codePointRange.start
        ? left.codePointRange.start - right.codePointRange.start
        : left.fragmentId.localeCompare(right.fragmentId),
    );
  return Object.freeze(
    sections.map((fragment, index) =>
      Object.freeze({
        titlePath: deriveDraftTitle(fragment.selectedText, index),
        pieces: Object.freeze([
          Object.freeze({
            fragment,
            startCodePoint: 0,
            endCodePoint: Array.from(fragment.selectedText).length,
          }),
        ]),
      }),
    ),
  );
}

export function createManualSplitDraftFromGroups(
  snapshot: Readonly<EvidenceSnapshot>,
  groups: readonly Readonly<InformationEntryFragmentGroup>[],
): readonly Readonly<ManualSplitDraftGroup>[] | undefined {
  const fragments = new Map(
    (snapshot.structures[0]?.fragments ?? []).map((fragment) => [
      fragment.fragmentId,
      fragment,
    ]),
  );
  const draft: ManualSplitDraftGroup[] = [];
  for (const group of groups) {
    const pieces: ManualSplitDraftPiece[] = [];
    for (const input of group.fragments) {
      const fragment = fragments.get(input.fragmentId);
      const length =
        fragment === undefined ? -1 : Array.from(fragment.selectedText).length;
      if (
        fragment === undefined ||
        !Number.isSafeInteger(input.startCodePoint) ||
        !Number.isSafeInteger(input.endCodePoint) ||
        input.startCodePoint < 0 ||
        input.endCodePoint <= input.startCodePoint ||
        input.endCodePoint > length
      ) {
        return undefined;
      }
      pieces.push(
        Object.freeze({
          fragment,
          startCodePoint: input.startCodePoint,
          endCodePoint: input.endCodePoint,
        }),
      );
    }
    if (pieces.length === 0) return undefined;
    draft.push(
      Object.freeze({
        titlePath: group.titlePath,
        pieces: Object.freeze(pieces),
      }),
    );
  }
  return draft.length === 0 ? undefined : Object.freeze(draft);
}

export function manualSplitPieceText(
  piece: Readonly<ManualSplitDraftPiece>,
): string {
  return Array.from(piece.fragment.selectedText)
    .slice(piece.startCodePoint, piece.endCodePoint)
    .join('');
}

export function manualSplitCaretCodePoint(
  piece: Readonly<ManualSplitDraftPiece>,
  utf16Offset: number,
): number | undefined {
  const text = manualSplitPieceText(piece);
  if (
    !Number.isSafeInteger(utf16Offset) ||
    utf16Offset < 0 ||
    utf16Offset > text.length
  ) {
    return undefined;
  }
  const scalarOffset = Array.from(text.slice(0, utf16Offset)).length;
  if (Array.from(text).slice(0, scalarOffset).join('').length !== utf16Offset) {
    return undefined;
  }
  return piece.startCodePoint + scalarOffset;
}

export function mergeManualSplitGroups(
  groups: readonly Readonly<ManualSplitDraftGroup>[],
  groupIndex: number,
): readonly Readonly<ManualSplitDraftGroup>[] {
  const previous = groups[groupIndex - 1];
  const current = groups[groupIndex];
  if (previous === undefined || current === undefined) return groups;
  const merged = Object.freeze({
    titlePath: previous.titlePath,
    pieces: coalescePieces([...previous.pieces, ...current.pieces]),
  });
  return Object.freeze([
    ...groups.slice(0, groupIndex - 1),
    merged,
    ...groups.slice(groupIndex + 1),
  ]);
}

export function mergeAllManualSplitGroups(
  groups: readonly Readonly<ManualSplitDraftGroup>[],
): readonly Readonly<ManualSplitDraftGroup>[] {
  const first = groups[0];
  if (first === undefined || groups.length === 1) return groups;
  return Object.freeze([
    Object.freeze({
      titlePath: first.titlePath,
      pieces: coalescePieces(groups.flatMap((group) => group.pieces)),
    }),
  ]);
}

export function splitManualSplitGroup(
  groups: readonly Readonly<ManualSplitDraftGroup>[],
  groupIndex: number,
  pieceIndex: number,
): readonly Readonly<ManualSplitDraftGroup>[] {
  const group = groups[groupIndex];
  if (
    group === undefined ||
    pieceIndex < 1 ||
    pieceIndex >= group.pieces.length
  ) {
    return groups;
  }
  return replaceWithSplitGroups(
    groups,
    groupIndex,
    group,
    group.pieces.slice(0, pieceIndex),
    group.pieces.slice(pieceIndex),
  );
}

export function splitManualSplitPiece(
  groups: readonly Readonly<ManualSplitDraftGroup>[],
  groupIndex: number,
  pieceIndex: number,
  splitCodePoint: number,
): readonly Readonly<ManualSplitDraftGroup>[] {
  const group = groups[groupIndex];
  const piece = group?.pieces[pieceIndex];
  if (
    group === undefined ||
    piece === undefined ||
    !Number.isSafeInteger(splitCodePoint) ||
    splitCodePoint <= piece.startCodePoint ||
    splitCodePoint >= piece.endCodePoint
  ) {
    return groups;
  }
  const leftPiece = Object.freeze({...piece, endCodePoint: splitCodePoint});
  const rightPiece = Object.freeze({...piece, startCodePoint: splitCodePoint});
  return replaceWithSplitGroups(
    groups,
    groupIndex,
    group,
    [...group.pieces.slice(0, pieceIndex), leftPiece],
    [rightPiece, ...group.pieces.slice(pieceIndex + 1)],
  );
}

function replaceWithSplitGroups(
  groups: readonly Readonly<ManualSplitDraftGroup>[],
  groupIndex: number,
  source: Readonly<ManualSplitDraftGroup>,
  leftPieces: readonly Readonly<ManualSplitDraftPiece>[],
  rightPieces: readonly Readonly<ManualSplitDraftPiece>[],
): readonly Readonly<ManualSplitDraftGroup>[] {
  const firstRight = rightPieces[0];
  if (leftPieces.length === 0 || firstRight === undefined) return groups;
  const left = Object.freeze({
    titlePath: source.titlePath,
    pieces: Object.freeze(leftPieces),
  });
  const right = Object.freeze({
    titlePath: deriveDraftTitle(
      manualSplitPieceText(firstRight),
      groupIndex + 1,
    ),
    pieces: Object.freeze(rightPieces),
  });
  return Object.freeze([
    ...groups.slice(0, groupIndex),
    left,
    right,
    ...groups.slice(groupIndex + 1),
  ]);
}

function coalescePieces(
  pieces: readonly Readonly<ManualSplitDraftPiece>[],
): readonly Readonly<ManualSplitDraftPiece>[] {
  const result: ManualSplitDraftPiece[] = [];
  for (const piece of pieces) {
    const previous = result.at(-1);
    if (
      previous?.fragment.fragmentId === piece.fragment.fragmentId &&
      previous.endCodePoint === piece.startCodePoint
    ) {
      result[result.length - 1] = Object.freeze({
        ...previous,
        endCodePoint: piece.endCodePoint,
      });
    } else {
      result.push(Object.freeze({...piece}));
    }
  }
  return Object.freeze(result);
}

function deriveDraftTitle(text: string, index: number): string {
  const firstLine = text
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .find((line) => line !== '');
  const title = firstLine?.replace(/^#{1,6}\s+/u, '').trim() ?? '';
  return Array.from(title === '' ? `条目 ${String(index + 1)}` : title)
    .slice(0, 200)
    .join('');
}
