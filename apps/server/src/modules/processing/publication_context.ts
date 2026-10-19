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
  return /^(?:colophon|copyright(?: and licensing)?|about the author|author biography|subscription (?:information|options)|how to (?:get|subscribe to) .{1,80}|出版信息|版权(?:与许可|声明|说明)?|作者简介|订阅(?:方式|说明|信息|渠道))\s*[:：]?$/iu.test(
    normalized,
  );
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
    if (!publicationHeading(heading.title)) continue;
    if (ranges.some((range) => heading.start < range.end)) continue;
    const next = outline.slice(index + 1).find((h) => h.depth <= heading.depth);
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
  if (!ranges.length) return false;
  let offset = 0;
  for (const range of ranges) {
    if (text.slice(offset, range.start).trim()) return false;
    offset = range.end;
  }
  return !text.slice(offset).trim();
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
