import type {
  EvidenceFragment,
  EvidenceSnapshot,
} from '../api/m1c_api_contract.js';

export interface ManualSplitDraftGroup {
  readonly titlePath: string;
  readonly fragments: readonly Readonly<EvidenceFragment>[];
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
        fragments: Object.freeze([fragment]),
      }),
    ),
  );
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
    fragments: Object.freeze([...previous.fragments, ...current.fragments]),
  });
  return Object.freeze([
    ...groups.slice(0, groupIndex - 1),
    merged,
    ...groups.slice(groupIndex + 1),
  ]);
}

export function splitManualSplitGroup(
  groups: readonly Readonly<ManualSplitDraftGroup>[],
  groupIndex: number,
  fragmentIndex: number,
): readonly Readonly<ManualSplitDraftGroup>[] {
  const group = groups[groupIndex];
  if (
    group === undefined ||
    fragmentIndex < 1 ||
    fragmentIndex >= group.fragments.length
  ) {
    return groups;
  }
  const left = Object.freeze({
    titlePath: group.titlePath,
    fragments: Object.freeze(group.fragments.slice(0, fragmentIndex)),
  });
  const rightFragments = Object.freeze(group.fragments.slice(fragmentIndex));
  const first = rightFragments[0];
  if (first === undefined) return groups;
  const right = Object.freeze({
    titlePath: deriveDraftTitle(first.selectedText, groupIndex + 1),
    fragments: rightFragments,
  });
  return Object.freeze([
    ...groups.slice(0, groupIndex),
    left,
    right,
    ...groups.slice(groupIndex + 1),
  ]);
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
