import {fromMarkdown} from 'mdast-util-from-markdown';

export interface MarkdownNode {
  readonly position?:
    | Readonly<{
        start: Readonly<{offset?: number | undefined}>;
        end: Readonly<{offset?: number | undefined}>;
      }>
    | undefined;
  readonly type: string;
  readonly children?: readonly MarkdownNode[];
  readonly value?: string;
  readonly depth?: number;
  readonly url?: string;
  readonly alt?: string | null | undefined;
  readonly ordered?: boolean | null | undefined;
  readonly start?: number | null | undefined;
  readonly identifier?: string;
}

export function readingTitle(value: string): string {
  return plainText(fromMarkdown(value)).trim() || '未命名条目';
}

/** A display-only title; the source heading stays intact. */
export function compactDocumentTitle(value: string): string {
  const characters = Array.from(value);
  if (characters.length <= 80) return value;
  // Briefings sometimes put their full contents after a complete leading heading.
  const heading = /^【[^】\n]{10,78}】/u.exec(value)?.[0];
  if (heading !== undefined) return heading;
  return characters.slice(0, 80).join('').trimEnd() + '…';
}

export function sourceDisplayName(source: {
  readonly sourceKey: string;
  readonly canonicalUri?: string;
}): string {
  if (!/[a-f0-9]{20,}/i.test(source.sourceKey)) return source.sourceKey;
  if (source.canonicalUri !== undefined) {
    try {
      const url = new URL(source.canonicalUri);
      if (url.protocol === 'https:' || url.protocol === 'http:') {
        const segment = url.pathname.split('/').filter(Boolean).at(-1) ?? '';
        const title = decodeURIComponent(segment)
          .replace(/\.(html?|md)$/i, '')
          .replace(/[-_]+/g, ' ');
        return title === '' ? url.hostname : `${title} · ${url.hostname}`;
      }
    } catch {
      /* Preserve a readable local alias for malformed external metadata. */
    }
  }
  return (
    source.sourceKey
      .replace(/[:/_-]?[a-f0-9]{20,}/gi, '')
      .replace(/[:/_-]+$/, '') || '来源文档'
  );
}

export function sourceShortName(source: {
  readonly sourceKey: string;
  readonly canonicalUri?: string;
}): string {
  if (
    /[a-f0-9]{20,}/i.test(source.sourceKey) &&
    source.canonicalUri !== undefined
  ) {
    const uri = safeReadingLink(source.canonicalUri);
    if (uri !== undefined) return new URL(uri).hostname;
  }
  return sourceDisplayName(source);
}

export function plainText(node: MarkdownNode): string {
  return node.children?.map(plainText).join('') ?? node.value ?? node.alt ?? '';
}

export function safeReadingLink(
  value: string | undefined,
  baseUri?: string,
): string | undefined {
  if (value === undefined || value.trim() === '') return undefined;
  try {
    const url =
      baseUri === undefined ? new URL(value) : new URL(value, baseUri);
    return url.protocol === 'https:' || url.protocol === 'http:'
      ? url.href
      : undefined;
  } catch {
    return undefined;
  }
}
