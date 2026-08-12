import type {LineRange} from '../evidence_contract.js';

export interface MarkdownLineIndex {
  readonly codePointLength: number;
  readonly lfCodePointOffsets: readonly number[];
}

export interface IndexedMarkdownText {
  readonly codePoints: readonly string[];
  readonly lineIndex: Readonly<MarkdownLineIndex>;
}

export function indexMarkdownText(text: string): Readonly<IndexedMarkdownText> {
  const codePoints = Object.freeze(Array.from(text));
  return Object.freeze({
    codePoints,
    lineIndex: createMarkdownLineIndex(codePoints),
  });
}

export function createMarkdownLineIndex(
  codePoints: readonly string[],
): Readonly<MarkdownLineIndex> {
  const lfCodePointOffsets: number[] = [];
  for (const [index, codePoint] of codePoints.entries()) {
    if (codePoint === '\n') {
      lfCodePointOffsets.push(index);
    }
  }
  return Object.freeze({
    codePointLength: codePoints.length,
    lfCodePointOffsets: Object.freeze(lfCodePointOffsets),
  });
}

export function lineRangeFromIndex(
  index: Readonly<MarkdownLineIndex>,
  start: number,
  end: number,
): Readonly<LineRange> {
  return Object.freeze({
    start: lineOfCodePoint(index.lfCodePointOffsets, start),
    end: lineOfCodePoint(index.lfCodePointOffsets, end - 1),
  });
}

export function deriveLineRange(
  codePoints: readonly string[],
  start: number,
  end: number,
): Readonly<LineRange> {
  return lineRangeFromIndex(createMarkdownLineIndex(codePoints), start, end);
}

function lineOfCodePoint(
  lfCodePointOffsets: readonly number[],
  codePointIndex: number,
): number {
  let lower = 0;
  let upper = lfCodePointOffsets.length;
  while (lower < upper) {
    const middle = lower + Math.floor((upper - lower) / 2);
    const offset = lfCodePointOffsets[middle];
    if (offset === undefined || offset >= codePointIndex) {
      upper = middle;
    } else {
      lower = middle + 1;
    }
  }
  return lower + 1;
}
