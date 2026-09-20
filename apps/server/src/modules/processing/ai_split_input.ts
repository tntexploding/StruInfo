import type {MaterializedEvidenceFragment} from '../entries/information_entry.js';

/** Reading packets only: their boundaries never establish independent Entries. */
export function splitReadingPackets(
  fragments: readonly MaterializedEvidenceFragment[],
) {
  const packets: MaterializedEvidenceFragment[][] = [];
  const hasChapters =
    fragments.filter((f) => /^#{2,6}\s+/u.test(f.selectedText)).length > 1;
  for (const fragment of fragments) {
    const previous = packets.at(-1);
    const first = previous?.[0];
    const last = previous?.at(-1);
    const heading = /^#{1,6}\s+/u.test(fragment.selectedText);
    const tableRow = /^\|[^\n]*\|$/u.test(fragment.selectedText.trim());
    const caption =
      /^(?:图片[：:]|(?:Figure|Chart|Source|Note)s?\s*[:.\d])/iu.test(
        fragment.selectedText.trim(),
      );
    const join =
      previous &&
      first &&
      last &&
      fragment.nodeKind !== 'section' &&
      last.nodeKind !== 'section' &&
      !heading &&
      ((hasChapters && /^#{1,6}\s+/u.test(first.selectedText)) ||
        (previous.length === 1 && /^#{1,6}\s+/u.test(first.selectedText)) ||
        (tableRow && last.selectedText.trim().startsWith('|')) ||
        (caption &&
          (last.nodeKind === 'image' || last.selectedText.startsWith('!['))));
    if (join) previous.push(fragment);
    else packets.push([fragment]);
  }
  return packets;
}
