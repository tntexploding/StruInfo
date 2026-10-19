import type {AiSplitProposalSection} from '../../modules/processing/ai_split_proposal.js';

/** Resolve a title only inside the final range, after framing/context merges. */
export function splitSourceTitle(
  sections: readonly AiSplitProposalSection[],
  group: Readonly<{
    startOrdinal: number;
    endOrdinal: number;
    titlePath: string;
  }>,
  framing: ReadonlySet<number> = new Set(),
): string {
  const documentTitle = sections[0]?.text
    .trimStart()
    .match(/^#\s+([^\n]+)/u)?.[1];
  const lines = sections
    .slice(group.startOrdinal, group.endOrdinal + 1)
    .filter((section) => !framing.has(section.ordinal))
    .flatMap((section) => section.text.split('\n'));
  const candidates: {text: string; linked: boolean}[] = [];
  let fence: string | undefined;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]?.trim() ?? '';
    const marker = /^(`{3,}|~{3,})/u.exec(line)?.[1];
    if (marker) {
      if (!fence) fence = marker;
      else if (
        marker.startsWith(fence[0] ?? '') &&
        marker.length >= fence.length
      )
        fence = undefined;
      continue;
    }
    if (fence || !line || line.startsWith('![') || line.startsWith('[!['))
      continue;
    const heading = /^#{1,6}\s+(.+?)(?:\s+#+)?$/u.exec(line)?.[1];
    if (heading && heading === documentTitle) continue;
    const namedLink = /^\[([^\]]+)\]\(https?:\/\/[^\s]+\)$/u.exec(line)?.[1];
    const next =
      lines
        .slice(i + 1)
        .find((value) => value.trim())
        ?.trim() ?? '';
    const followedByLink =
      !next.startsWith('[![') &&
      /^(?:<?https?:\/\/|\[[^\]]+\]\(https?:\/\/)/u.test(next);
    const label = heading ?? namedLink ?? (followedByLink ? line : undefined);
    if (
      !label ||
      /^https?:\/\//u.test(label) ||
      (!heading && !namedLink && /[。.!?！？:：]$/u.test(label))
    )
      continue;
    const text = label
      .replace(/^\*\*(.*?)\*\*$/u, '$1')
      .replace(/\[([^\]]+)\]\([^)]*\)/gu, '$1')
      .trim();
    if (!text || Array.from(text).length > 200) continue;
    candidates.push({text, linked: Boolean(namedLink ?? followedByLink)});
  }
  // A named, source-linked item is more specific than its category heading.
  return (
    candidates.find((candidate) => candidate.linked)?.text ??
    candidates[0]?.text ??
    group.titlePath.replace(/^#{1,6}\s+/u, '')
  );
}
