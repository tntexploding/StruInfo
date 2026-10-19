import {
  parse,
  parseFragment,
  type DefaultTreeAdapterTypes as Tree,
} from 'parse5';
import {historyUrl} from './history_http.js';

type Node = Tree.Node;
export function nodes(text: string): Tree.Element[] {
  const result: Tree.Element[] = [];
  const visit = (node: Node) => {
    if ('tagName' in node) result.push(node);
    if ('childNodes' in node) for (const child of node.childNodes) visit(child);
  };
  visit(parse(text));
  return result;
}
export function attr(
  node: Pick<Tree.Element, 'attrs'> | undefined,
  name: string,
) {
  return node?.attrs.find((a) => a.name === name)?.value ?? '';
}
export function plainHtml(value: string): string {
  const visit = (node: Node): string =>
    'value' in node
      ? node.value
      : 'childNodes' in node
        ? node.childNodes.map(visit).join('')
        : '';
  return visit(parseFragment(value)).replace(/\s+/gu, ' ').trim();
}
export function nodeText(node: Node): string {
  return 'value' in node
    ? node.value
    : 'childNodes' in node
      ? node.childNodes.map(nodeText).join(' ').replace(/\s+/gu, ' ').trim()
      : '';
}
export function dateValue(value: unknown): string | undefined {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}/u.test(value))
    return undefined;
  const n = Date.parse(value);
  return Number.isFinite(n) ? new Date(n).toISOString() : undefined;
}
export function urlDate(value: string): string | undefined {
  const path = new URL(value).pathname;
  const match =
    /\/(20\d{2}|19\d{2})\/(\d{2}|[A-Z][a-z]{2})\/(\d{1,2})(?:\/|$)/u.exec(
      path,
    ) ?? /-(20\d{2})(\d{2})(\d{2})\/?$/u.exec(path);
  if (!match) return undefined;
  const month = /^\d/u.test(match[2] ?? '')
    ? match[2]
    : String(
        [
          'Jan',
          'Feb',
          'Mar',
          'Apr',
          'May',
          'Jun',
          'Jul',
          'Aug',
          'Sep',
          'Oct',
          'Nov',
          'Dec',
        ].indexOf(match[2] ?? '') + 1,
      ).padStart(2, '0');
  return dateValue(
    `${match[1] ?? ''}-${month ?? ''}-${(match[3] ?? '').padStart(2, '0')}T00:00:00Z`,
  );
}
export function articlePath(value: string): boolean {
  const path = new URL(value).pathname;
  return (
    path !== '/' &&
    !/\.(?:xml|json|png|jpg|webp|svg|pdf|css|js|zip)$/iu.test(path) &&
    !/\/(?:tags?|categor(?:y|ies)|authors?|about|archives?|search|subscribe|donate|login|privacy|terms|contact|grapher|explorers|topics|page|feed|rss|sitemap|index)(?:[./_-]|$)/iu.test(
      path,
    ) &&
    !/^\/(?:[a-z]{2}[-/])?\d{4}\/?(?:\d{2}\/?)?$/u.test(path)
  );
}
export function urlTitle(value: string): string {
  try {
    return decodeURIComponent(
      new URL(value).pathname.split('/').filter(Boolean).at(-1) ?? value,
    )
      .replace(/\.html?$/iu, '')
      .replace(/[-_]+/gu, ' ')
      .slice(0, 500);
  } catch {
    return value;
  }
}
export function articleMetadata(html: string, url: string) {
  const all = nodes(html);
  const meta = (names: string[]) =>
    all.find(
      (n) =>
        n.tagName === 'meta' &&
        names.includes(attr(n, 'property') || attr(n, 'name')),
    );
  const title =
    attr(meta(['og:title', 'twitter:title']), 'content') ||
    nodeText(
      all.find((n) => n.tagName === 'h1') ??
        all.find((n) => n.tagName === 'title') ??
        ({nodeName: '#text', value: ''} as Tree.TextNode),
    );
  let publishedAt = dateValue(
    attr(
      meta(['article:published_time', 'datePublished', 'date', 'pubdate']),
      'content',
    ),
  );
  const publishedNode = all.find(
    (n) =>
      (n.tagName === 'time' && attr(n, 'datetime')) ||
      attr(n, 'class').split(' ').includes('published'),
  );
  publishedAt ??= dateValue(
    publishedNode
      ? attr(publishedNode, 'datetime') || attr(publishedNode, 'title')
      : undefined,
  );
  let restricted = false;
  for (const n of all.filter(
    (n) => n.tagName === 'script' && attr(n, 'type') === 'application/ld+json',
  )) {
    try {
      const visit = (v: unknown, depth = 0) => {
        if (depth > 12 || !v || typeof v !== 'object') return;
        if (Array.isArray(v)) {
          v.forEach((x) => {
            visit(x, depth + 1);
          });
          return;
        }
        const r = v as Record<string, unknown>;
        if (
          r.isAccessibleForFree === false ||
          r.isAccessibleForFree === 'false'
        )
          restricted = true;
        publishedAt ??= dateValue(r.datePublished);
        if (r['@graph']) visit(r['@graph'], depth + 1);
      };
      visit(JSON.parse(nodeText(n)) as unknown);
    } catch {
      /* Optional publisher metadata. */
    }
  }
  if (!publishedAt) {
    for (const n of all) {
      if (
        !['p', 'div', 'span', 'time', 'dd'].includes(n.tagName) ||
        n.childNodes.length > 8
      )
        continue;
      const text = nodeText(n);
      if (text.length > 100) continue;
      const match =
        /^(?:发布日期|发布时间|发布于|Published(?: on)?|Posted(?: on)?)\s*[:：]?\s*(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})日?\s*$/iu.exec(
          text,
        );
      if (!match) continue;
      const day = `${match[1] ?? ''}-${(match[2] ?? '').padStart(2, '0')}-${(match[3] ?? '').padStart(2, '0')}`;
      const value = dateValue(day + 'T00:00:00Z');
      if (value?.slice(0, 10) === day) {
        publishedAt = value;
        break;
      }
    }
  }
  const canonical = all.find(
    (n) => n.tagName === 'link' && attr(n, 'rel') === 'canonical',
  );
  return {
    title: plainHtml(title).slice(0, 500),
    publishedAt,
    restricted,
    canonicalUrl: canonical
      ? historyUrl(attr(canonical, 'href'), url)
      : undefined,
  };
}
