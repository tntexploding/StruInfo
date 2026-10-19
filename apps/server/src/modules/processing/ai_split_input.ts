import type {
  MaterializedEvidenceFragment,
  MaterializedEvidenceSnapshot,
} from '../entries/information_entry.js';
import {MAXIMUM_AI_SPLIT_FRAGMENTS} from './ai_split_proposal.js';

/** A whole-document evidence anchor can retain exact ranges around Markdown
 * list/quote markers which are absent from the parser's leaf fragments. */
export function splitInputPackets(
  fragments: readonly MaterializedEvidenceFragment[],
  snapshot?: Readonly<MaterializedEvidenceSnapshot>,
) {
  const whole =
    fragments.length === 1 && fragments[0]?.nodeKind === 'document'
      ? fragments[0]
      : undefined;
  if (!whole || !snapshot) return splitReadingPackets(fragments);
  const points = Array.from(whole.selectedText);
  const leaves =
    snapshot.structures[0]?.fragments.filter(
      (f) => f.nodeKind !== 'document',
    ) ?? [];
  leaves.sort(
    (a, b) =>
      a.codePointRange.start - b.codePointRange.start ||
      b.codePointRange.end - a.codePointRange.end,
  );
  const inputs: MaterializedEvidenceFragment[] = [];
  let end = 0;
  for (const leaf of leaves) {
    const range = leaf.codePointRange;
    if (range.end <= end) continue;
    if (
      range.start < end ||
      range.end > points.length ||
      points.slice(range.start, range.end).join('') !== leaf.selectedText
    )
      return [[whole]];
    inputs.push({
      ...whole,
      nodeKind: leaf.nodeKind,
      codePointRange: {start: end, end: range.end},
      selectedText: points.slice(end, range.end).join(''),
    });
    end = range.end;
  }
  if (!inputs.length) return [[whole]];
  const last = inputs.at(-1);
  if (last && end < points.length)
    inputs[inputs.length - 1] = {
      ...last,
      codePointRange: {start: last.codePointRange.start, end: points.length},
      selectedText: points.slice(last.codePointRange.start).join(''),
    };
  return splitReadingPackets(inputs);
}

/** Reading packets only: their boundaries never establish independent Entries. */
export function splitReadingPackets(
  fragments: readonly MaterializedEvidenceFragment[],
) {
  // Keep paragraph-level choices when they fit. A category heading must not
  // hide several unnumbered stories inside one indivisible model packet.
  const fine: MaterializedEvidenceFragment[][] = [];
  for (const fragment of fragments) {
    const previous = fine.at(-1);
    const last = previous?.at(-1);
    if (previous && last && attachedIllustration(fragment, last))
      previous.push(fragment);
    else fine.push([fragment]);
  }
  if (fine.length <= MAXIMUM_AI_SPLIT_FRAGMENTS) return fine;

  // Large sources retain the existing chapter/item grouping, without losing
  // explicit linked or bold item starts. No source text is dropped to fit.
  const packets: MaterializedEvidenceFragment[][] = [];
  const hasChapters =
    fragments.filter((f) => /^\s*#{1,6}\s+/u.test(f.selectedText)).length > 1;
  const numbered = (text: string) =>
    /^\s*(?:(?:\d{1,3}[、.)．]|[（(]\d{1,3}[)）])\s*\S|[-+*]\s+\[[^\]\n]+\]\()/u.test(
      text,
    );
  const hasNumberedItems =
    fragments.filter((f) => numbered(f.selectedText)).length > 1;
  const namedItem = (f: MaterializedEvidenceFragment) =>
    f.nodeKind === 'paragraph' &&
    /^\s*(?:\[[^\]\n]+\]\(https?:\/\/[^\s)]+\)|\*\*[^*\n]+\*\*)/u.test(
      f.selectedText,
    );
  const hasNamedItems = fragments.filter(namedItem).length > 1;
  for (const fragment of fragments) {
    const previous = packets.at(-1);
    const first = previous?.[0];
    const last = previous?.at(-1);
    const heading = /^\s*#{1,6}\s+/u.test(fragment.selectedText);
    const join =
      previous &&
      first &&
      last &&
      fragment.nodeKind !== 'section' &&
      last.nodeKind !== 'section' &&
      !heading &&
      !(hasNumberedItems && numbered(fragment.selectedText)) &&
      !(hasNamedItems && namedItem(fragment)) &&
      ((hasChapters && /^\s*#{1,6}\s+/u.test(first.selectedText)) ||
        (hasNumberedItems && numbered(first.selectedText)) ||
        (hasNamedItems && namedItem(first)) ||
        (previous.length === 1 && /^\s*#{1,6}\s+/u.test(first.selectedText)) ||
        attachedIllustration(fragment, last));
    if (join) previous.push(fragment);
    else packets.push([fragment]);
  }
  return packets;
}

function attachedIllustration(
  fragment: MaterializedEvidenceFragment,
  previous: MaterializedEvidenceFragment,
): boolean {
  if (fragment.nodeKind === 'section' || previous.nodeKind === 'section')
    return false;
  const text = fragment.selectedText.trim();
  return (
    (/^\|[^\n]*\|$/u.test(text) &&
      previous.selectedText.trim().startsWith('|')) ||
    (/^(?:图片[：:]|(?:Figure|Chart|Source|Note)s?\s*[:.\d])/iu.test(text) &&
      (previous.nodeKind === 'image' ||
        previous.selectedText.trimStart().startsWith('![')))
  );
}
