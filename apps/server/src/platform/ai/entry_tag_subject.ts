import type {CurrentInformationEntry} from '../../modules/entries/index.js';

/** A request projection only: the stored Entry and its complete evidence stay intact. */
export function entryTagSubject(
  entry: Readonly<CurrentInformationEntry>,
): Readonly<{
  titlePath: string;
  body: string;
  documentContext?: Readonly<{titlePath: string; preface: string}>;
}> {
  const {titlePath, body, chunkMode, documentOrder} = entry.value;
  const unchanged = {titlePath, body};
  if (chunkMode !== 'split' || documentOrder !== 0) return unchanged;
  const lines = body.split('\n');
  const headings: {line: number; depth: number; text: string}[] = [];
  let fence: string | undefined;
  for (const [line, text] of lines.entries()) {
    const marker = /^ {0,3}(`{3,}|~{3,})/u.exec(text)?.[1];
    if (marker) {
      if (!fence) fence = marker;
      else if (
        marker.startsWith(fence[0] ?? '') &&
        marker.length >= fence.length &&
        text.trim() === marker
      )
        fence = undefined;
      continue;
    }
    if (fence) continue;
    const match = /^ {0,3}(#{1,6})[ \t]+(.+?)(?:[ \t]+#+)?[ \t]*$/u.exec(text);
    if (match?.[1] && match[2])
      headings.push({line, depth: match[1].length, text: match[2]});
  }
  const [documentTitle, firstItem] = headings;
  // Only a document title followed by a single first numbered item is separated.
  // A whole article, a list inside prose, or a group containing several items stays intact.
  if (
    !documentTitle ||
    !firstItem ||
    documentTitle.depth !== 1 ||
    firstItem.depth !== 2 ||
    lines.slice(0, documentTitle.line).some((line) => line.trim()) ||
    !/^(?:\*\*)?1[.、．）)][ \t]*\S/u.test(firstItem.text) ||
    headings.slice(2).some((heading) => heading.depth <= firstItem.depth)
  )
    return unchanged;
  return {
    titlePath: firstItem.text
      .replace(/^(?:\*\*)?1[.、．）)][ \t]*/u, '')
      .replace(/\*\*$/u, ''),
    body: lines.slice(firstItem.line).join('\n'),
    documentContext: {
      titlePath,
      preface: lines.slice(0, firstItem.line).join('\n'),
    },
  };
}
