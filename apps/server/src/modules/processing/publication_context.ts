interface Heading {
  readonly start: number;
  readonly depth: number;
  readonly title: string;
}

interface TextRange {
  readonly start: number;
  readonly end: number;
}

/** Narrow publication headings, never generic Related/References or story titles. */
function publicationHeading(title: string): boolean {
  const normalized = title
    .replace(/\[([^\]]+)\]\([^)]*\)/gu, '$1')
    .replace(/\s*\(\s*permalink\s*\)\s*$/iu, '')
    .replace(/[*_`]/gu, '')
    .trim();
  return /^(?:colophon|copyright(?: and licensing)?|about the author|author biography|(?:upcoming|recent) appearances|(?:latest|upcoming) books|subscription (?:information|options)|how to (?:get|subscribe to) .{1,80}|出版信息|版权(?:与许可|声明|说明)?|作者简介|近期活动|新书预告|订阅(?:方式|说明|信息|渠道))\s*[:：]?$/iu.test(
    normalized,
  );
}

/** Link captions are pointers, not the contents of the linked article. */
export function isReferenceOnly(text: string): boolean {
  let links = 0;
  const lines = text.split('\n').map((line) => line.trim());
  for (const [index, raw] of lines.entries()) {
    if (!raw || /^#{1,6}\s/u.test(raw)) continue;
    const line = raw.replace(/^(?:[-*+]|\d+[.)])\s+/u, '');
    if (line.startsWith('![') || line.startsWith('[![')) continue;
    if (
      /^\[[^\]\n]+\]\(https?:\/\/\S+\)$/u.test(line) ||
      /^<?https?:\/\/\S+>?$/u.test(line)
    ) {
      links++;
      continue;
    }
    // A headline followed by its URL, including dated archive listings.
    const caption = /^(.*?)\s+\[(https?:\/\/[^\]]+)\]\(https?:\/\/\S+\)$/u.exec(
      line,
    )?.[1];
    const next = lines.slice(index + 1).find(Boolean) ?? '';
    const separateUrl =
      /^(?:<?https?:\/\/\S+>?|\[https?:\/\/[^\]]+\]\(https?:\/\/\S+\))$/u.test(
        next,
      );
    const label = caption ?? (separateUrl ? line : undefined);
    if (
      label &&
      Array.from(label).length <= 240 &&
      (!/[。；;]|\.\s|\.$/u.test(label) ||
        /^#?\d+\s*(?:years?|yrs?|months?|days?)\s*ago\b/iu.test(label))
    ) {
      if (caption) links++;
      continue;
    }
    return false;
  }
  return links > 0;
}

/** Several links to in-page anchors form navigation, even with short captions. */
function isContentsOutline(text: string): boolean {
  const lines = text
    .split('\n')
    .map((line) => line.trim())
    .filter(
      (line) =>
        line &&
        !/^#{1,6}\s/u.test(line) &&
        !line.startsWith('![') &&
        !line.startsWith('[!['),
    );
  if (lines.length < 2) return false;
  const links = lines.map(
    (line) =>
      /^(?:[-*+]|\d+[.)])?\s*\[[^\]]+\]\((#[^)\s]+|https?:\/\/[^)#\s]+#[^)\s]+)\)(?:\s*[:：].*)?$/u.exec(
        line,
      )?.[1],
  );
  if (links.some((link) => !link)) return false;
  // Cross-article annotated references also use fragments; those are not a TOC.
  const targets = links.map((link) => link?.split('#')[0]);
  return new Set(targets).size === 1 && new Set(links).size >= 2;
}

/** Short availability notices may accompany a collection, but explain no method. */
function isPublicationNotice(text: string): boolean {
  let availability = false;
  const paragraphs = text.split(/\n{2,}/u);
  for (const paragraph of paragraphs) {
    const prose = paragraph
      .split('\n')
      .filter((line) => !/^\s*(?:#{1,6}\s|!\[|\[!\[)/u.test(line))
      .join('\n')
      .trim();
    if (!prose || isReferenceOnly(prose)) continue;
    const plain = prose.replace(/\[([^\]]+)\]\([^)]*\)/gu, '$1');
    if (
      Array.from(plain).length <= 600 &&
      /\b(?:book|chapter)\b.{0,160}\b(?:now available|early access|now released)\b/iu.test(
        plain,
      ) &&
      !/(?:\n|[.!?]\s+)\S/u.test(plain)
    ) {
      availability = true;
      continue;
    }
    // A catalogue footer with repository / purchase links, without body prose.
    if (
      Array.from(plain).length <= 200 &&
      (prose.match(/\[[^\]]+\]\(https?:\/\/[^)]*\)/gu)?.length ?? 0) >= 2 &&
      !/[。.!?；;]/u.test(plain) &&
      /\b(?:book|repository|purchase)\b/iu.test(plain)
    )
      continue;
    return false;
  }
  return availability;
}

function headings(text: string): readonly Heading[] {
  const result: Heading[] = [];
  let offset = 0;
  let fence: string | undefined;
  for (const line of text.split('\n')) {
    const marker = /^ {0,3}(`{3,}|~{3,})/u.exec(line)?.[1];
    if (marker) {
      if (!fence) fence = marker;
      else if (
        marker.startsWith(fence[0] ?? '') &&
        marker.length >= fence.length &&
        line.trim() === marker
      )
        fence = undefined;
    } else if (!fence) {
      const match = /^ {0,3}(#{1,6})[ \t]+(.+?)(?:[ \t]+#+)?[ \t]*$/u.exec(
        line,
      );
      if (match?.[1] && match[2])
        result.push({start: offset, depth: match[1].length, title: match[2]});
    }
    offset += line.length + 1;
  }
  return result;
}

function publicationRanges(text: string): readonly TextRange[] {
  const outline = headings(text);
  const ranges: TextRange[] = [];
  for (const [index, heading] of outline.entries()) {
    if (ranges.some((range) => heading.start < range.end)) continue;
    const next = outline.slice(index + 1).find((h) => h.depth <= heading.depth);
    const section = text.slice(heading.start, next?.start);
    if (
      !publicationHeading(heading.title) &&
      !isReferenceOnly(section) &&
      !isContentsOutline(section) &&
      !isPublicationNotice(section)
    )
      continue;
    ranges.push({start: heading.start, end: next?.start ?? text.length});
  }
  return ranges;
}

function substantiveText(text: string): boolean {
  return text
    .split('\n')
    .some((line) => line.trim() && !/^\s*#{1,6}\s/u.test(line));
}

/** Used only to attach an all-publication group to its neighbouring real Entry. */
export function isPublicationOnly(text: string): boolean {
  const ranges = publicationRanges(text);
  if (!ranges.length) return isReferenceOnly(text) || isPublicationNotice(text);
  let offset = 0;
  const retained: string[] = [];
  for (const range of ranges) {
    retained.push(text.slice(offset, range.start));
    offset = range.end;
  }
  retained.push(text.slice(offset));
  const body = retained.join('').trim();
  return !body || isReferenceOnly(body) || isPublicationNotice(body);
}

/** Request-only projection. Never changes stored text or suppresses a whole document. */
export function withoutPublicationContext(text: string): string {
  const ranges = publicationRanges(text);
  if (!ranges.length) return text;
  let offset = 0;
  const retained: string[] = [];
  for (const range of ranges) {
    retained.push(text.slice(offset, range.start));
    offset = range.end;
  }
  retained.push(text.slice(offset));
  const body = retained.join('');
  // An article about publication or an author is still valid source material.
  return substantiveText(body) ? body : text;
}
