import type {AiSplitProposalSection} from '../../modules/processing/ai_split_proposal.js';
import {
  isReferenceOnly,
  withoutPublicationContext,
} from '../../modules/processing/publication_context.js';

const CATEGORY =
  /^(?:tools|resources|links|articles|news|工具|资源|链接|文章|资讯)\s*[:：]?$/iu;

function titleKey(text: string): string {
  return text
    .normalize('NFKC')
    .replace(/^\d+\s*[).、]\s*/u, '')
    .trim()
    .toLowerCase();
}

/** A trailing category belongs to later content, not the preceding item. */
function hasHeadingBody(
  lines: readonly string[],
  index: number,
  level: number,
) {
  for (const line of lines.slice(index + 1)) {
    const heading = /^\s*(#{1,6})\s/u.exec(line);
    if (heading && (heading[1]?.length ?? 0) <= level) return false;
    if (
      line.trim() &&
      !heading &&
      !isReferenceOnly(line) &&
      !/^\s*(?:!\[|\[!\[)/u.test(line)
    )
      return true;
  }
  return false;
}

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
  const text = sections
    .slice(group.startOrdinal, group.endOrdinal + 1)
    .filter((section) => !framing.has(section.ordinal))
    .map((section) => section.text)
    .join('\n');
  const lines = withoutPublicationContext(text).split('\n');
  const candidates: {
    text: string;
    level: number;
    leading: boolean;
    line: number;
  }[] = [];
  let fence: string | undefined;
  let bodyStarted = false;
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
    const headingMatch = /^(#{1,6})\s+(.+?)(?:\s+#+)?$/u.exec(line);
    const heading = headingMatch?.[2];
    const level = headingMatch?.[1]?.length ?? 0;
    if (heading && heading === documentTitle) continue;
    if (heading && !hasHeadingBody(lines, i, level)) continue;
    const namedLink =
      /^(?:\d+\s*[).、]\s*)?\[([^\]]+)\]\(https?:\/\/[^\s]+\)(?:\s*[（(][^()（）\n]{1,40}[)）])?\s*$/u.exec(
        line,
      )?.[1];
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
    ) {
      if (!/^(?:<?https?:\/\/|\[[^\]]+\]\(https?:\/\/)/u.test(line))
        bodyStarted = true;
      continue;
    }
    const text = label
      .replace(/^\*\*(.*?)\*\*$/u, '$1')
      .replace(/\[([^\]]+)\]\([^)]*\)/gu, '$1')
      .replace(/\s*\(\s*permalink\s*\)\s*$/iu, '')
      .trim();
    if (!text || Array.from(text).length > 200) continue;
    candidates.push({text, level, leading: !bodyStarted, line: i});
  }
  const headings = candidates.filter((candidate) => candidate.level > 0);
  const level = Math.min(...headings.map((candidate) => candidate.level));
  const topHeadings = headings.filter((candidate) => candidate.level === level);
  // Use the proposed subject only when the final source contains that heading.
  // This lets the article outrank its attached cover without trusting outside titles.
  const heading =
    topHeadings.find(
      (candidate) => titleKey(candidate.text) === titleKey(group.titlePath),
    ) ?? topHeadings[0];
  const linked = candidates.find(
    (candidate) => candidate.level === 0 && candidate.leading,
  );
  const selected =
    heading && (!CATEGORY.test(heading.text) || !linked) ? heading : linked;
  // Preserve a correct "category: item" title when both parts occur in the source.
  if (selected === linked && linked) {
    const proposed = /^(.*?)[:：]\s*(.+)$/u.exec(group.titlePath);
    const preceding = [
      ...sections.slice(0, group.startOrdinal).map((section) => section.text),
      ...lines.slice(0, linked.line),
    ].join('\n');
    const category = [...preceding.matchAll(/^#{1,6}\s+(.+)$/gmu)].at(-1)?.[1];
    if (
      proposed?.[1] &&
      proposed[2] &&
      category &&
      titleKey(proposed[1]) === titleKey(category) &&
      titleKey(proposed[2]) === titleKey(linked.text)
    )
      return group.titlePath;
  }
  return selected?.text ?? group.titlePath.replace(/^#{1,6}\s+/u, '');
}
