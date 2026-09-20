import type {ReactNode} from 'react';
import type {
  EvidenceStructure,
  InformationEntry,
} from '../api/m1c_api_contract.js';
import type {ReadingBoundary} from '../components/reading_content.js';
import {readingTitle} from '../components/reading_text.js';

export function documentSourceBoundaries(
  structure: Readonly<EvidenceStructure>,
  entries: readonly Readonly<InformationEntry>[],
  annotate?: (entry: Readonly<InformationEntry>) => ReactNode,
): readonly ReadingBoundary[] {
  if (entries.length < 2) return [];
  const fragments = new Map(
    structure.fragments.map((fragment) => [fragment.fragmentId, fragment]),
  );
  const starts = entries
    .flatMap((entry) => {
      const positions = entry.value.fragmentIds.flatMap((id, index) => {
        const fragment = fragments.get(id);
        const range = entry.value.fragmentRanges?.[index];
        if (
          !fragment ||
          (range &&
            (range.startCodePoint < 0 ||
              range.endCodePoint >
                fragment.codePointRange.end - fragment.codePointRange.start))
        )
          return [];
        return [fragment.codePointRange.start + (range?.startCodePoint ?? 0)];
      });
      return positions.length ? [{entry, start: Math.min(...positions)}] : [];
    })
    .sort((a, b) => a.start - b.start);
  const offsets = [0];
  for (const character of structure.normalizedText)
    offsets.push((offsets.at(-1) ?? 0) + character.length);
  return starts
    .flatMap(({entry, start}, index) => {
      const offset = offsets[start];
      if (
        offset === undefined ||
        offset < 0 ||
        offset >= structure.normalizedText.length
      )
        return [];
      const annotation = annotate?.(entry);
      if ((index === 0 && !annotation) || (index > 0 && offset === 0))
        return [];
      return [
        {
          offset,
          ...(index === 0 ? {separator: false} : {}),
          ...(annotation ? {annotation} : {}),
          label:
            '第 ' +
            (entry.value.documentOrder + 1).toString() +
            ' 条 · ' +
            readingTitle(entry.value.titlePath),
        },
      ];
    })
    .filter(
      (marker, index, all) =>
        index === 0 || all[index - 1]?.offset !== marker.offset,
    );
}
