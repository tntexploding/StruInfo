import {createHash} from 'node:crypto';
import {XMLParser, XMLValidator} from 'fast-xml-parser';
import {projectStructuredDocument} from '../../modules/evidence/index.js';
import type {
  HistoryArticle,
  HistoryPage,
  HistoryPageResult,
  SourceHistoryReader,
} from '../../modules/subscriptions/source_history.js';
import {parseFeed} from './rss_atom_source_connector.js';
import {HistoryHttp, HistoryReadError, historyUrl} from './history_http.js';
import {
  articleMetadata,
  articlePath,
  attr,
  dateValue,
  nodes,
  nodeText,
  plainHtml,
  urlDate,
  urlTitle,
} from './history_markup.js';
const record = (v: unknown): Record<string, unknown> =>
  v && typeof v === 'object' && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : {};
const array = (v: unknown): unknown[] =>
  v === undefined ? [] : Array.isArray(v) ? v : [v];
const text = (v: unknown) => (typeof v === 'string' ? v : '');
export class PublicSourceHistoryReader implements SourceHistoryReader {
  public constructor(private readonly http = new HistoryHttp()) {}
  public async read(
    page: HistoryPage,
    base: string,
  ): Promise<HistoryPageResult> {
    const response = await this.http.read(page.url, base);
    const origin = new URL(base).origin;
    const articles: HistoryPageResult['articles'] = [],
      next: HistoryPage[] = [];
    const add = (
      value: string,
      title?: string,
      date?: string,
      access: HistoryArticle['access'] = 'unknown',
    ) => {
      const url = historyUrl(value, base);
      if (!url || !articlePath(url)) return;
      const publishedAt = dateValue(date) ?? urlDate(url);
      articles.push({
        url,
        title: title ? plainHtml(title).slice(0, 500) : urlTitle(url),
        ...(!title ? {titleFromUrl: true} : {}),
        ...(publishedAt ? {publishedAt, dateInferred: !dateValue(date)} : {}),
        access,
      });
    };
    if (page.kind === 'feed') {
      const items = parseFeed(response.text, base);
      for (const item of items)
        if (item.canonicalUri !== base)
          add(item.canonicalUri, item.title, item.publishedAt);
      const generator =
        /<generator(?:\s[^>]*)?>([\s\S]*?)<\/generator>/iu.exec(
          response.text,
        )?.[1] ?? '';
      if (/substack/iu.test(generator))
        return {
          articles,
          method: '公开文章目录',
          replaceQueue: false,
          next: [
            {
              kind: 'substack',
              page: 0,
              url: origin + '/api/v1/archive?sort=new&offset=0&limit=50',
            },
          ],
        };
      if (/wordpress\.org/iu.test(generator))
        return {
          articles,
          method: '公开文章目录',
          replaceQueue: false,
          next: [
            {
              kind: 'wordpress',
              page: 1,
              url:
                origin +
                '/wp-json/wp/v2/posts?per_page=100&page=1&_fields=id,date_gmt,title,link',
            },
          ],
        };
      return {articles, next, method: 'RSS 最近内容'};
    }
    if (page.kind === 'substack' || page.kind === 'wordpress') {
      const rows: unknown = JSON.parse(response.text);
      if (!Array.isArray(rows))
        throw new HistoryReadError('history_directory_invalid');
      for (const raw of rows) {
        const row = record(raw);
        if (page.kind === 'substack')
          add(
            text(row.canonical_url),
            text(row.title),
            text(row.post_date),
            row.audience === 'everyone' ? 'public' : 'restricted',
          );
        else
          add(
            text(row.link),
            text(record(row.title).rendered),
            text(row.date_gmt) + 'Z',
          );
      }
      const current = page.page ?? 0;
      const total = Number(response.headers.get('x-wp-totalpages'));
      if (
        rows.length &&
        (page.kind === 'substack' ? true : total > current || !total)
      ) {
        const url = new URL(page.url);
        url.searchParams.set(
          page.kind === 'substack' ? 'offset' : 'page',
          String(current + (page.kind === 'substack' ? rows.length : 1)),
        );
        next.push({
          ...page,
          url: url.href,
          page: current + (page.kind === 'substack' ? rows.length : 1),
        });
      }
      return {articles, next, method: '公开文章目录'};
    }
    if (page.kind === 'robots') {
      const maps = [...response.text.matchAll(/^Sitemap:\s*(\S+)/gimu)]
        .map((m) => historyUrl(m[1] ?? '', base))
        .filter(
          (u): u is string => Boolean(u) && !/news|image|video/iu.test(u ?? ''),
        );
      for (const url of maps.length
        ? [...new Set(maps)]
        : [origin + '/sitemap.xml'])
        next.push({kind: 'sitemap', url});
      return {articles, next, method: '站点地图'};
    }
    if (page.kind === 'sitemap') {
      if (
        // eslint-disable-next-line @typescript-eslint/no-deprecated
        XMLValidator.validate(response.text) !== true ||
        /<!DOCTYPE|<!ENTITY/iu.test(response.text)
      )
        throw new HistoryReadError('history_directory_invalid');
      const xml = record(
        new XMLParser({
          removeNSPrefix: true,
          parseTagValue: false,
          maxNestedTags: 30,
        }).parse(response.text) as unknown,
      );
      if (xml.sitemapindex)
        for (const v of array(record(xml.sitemapindex).sitemap)) {
          const url = historyUrl(text(record(v).loc), base);
          if (
            url &&
            !/(?:author|tag|categor|image|video|news|archive)/iu.test(
              new URL(url).pathname,
            )
          )
            next.push({kind: 'sitemap', url});
        }
      else if (xml.urlset)
        for (const v of array(record(xml.urlset).url)) {
          const row = record(v),
            news = record(row.news);
          // lastmod is modification time, never an article publication date.
          add(
            text(row.loc),
            text(news.title) || undefined,
            text(news.publication_date) || undefined,
          );
        }
      else throw new HistoryReadError('history_directory_invalid');
      return {articles, next, method: '站点地图'};
    }
    for (const n of nodes(response.text).filter((n) => n.tagName === 'a')) {
      const href = attr(n, 'href');
      if (!href || href.startsWith('#')) continue;
      const url = historyUrl(href, response.url);
      if (!url) continue;
      const path = new URL(url).pathname,
        label = nodeText(n);
      if (
        /^(?:content index|all content|all posts|全部文章|按日期查看|按日期排列|所有文章)$/iu.test(
          label.trim(),
        ) ||
        /\/(?:archives?|content-index|catalog)(?:\.html)?\/?$/iu.test(path) ||
        /\/(?:20|19)\d{2}\/(?:\d{2}\/)?$/u.test(path) ||
        /\/page\/\d+\/?$/u.test(path) ||
        attr(n, 'rel').split(' ').includes('next')
      )
        next.push({kind: 'html', url});
      else if (
        urlDate(url) ||
        /\/(?:articles|bliki)\/[^/]+\.html$/u.test(path) ||
        /\/blog\/\d{4}\/\d{2}\/[^/]+\.html$/u.test(path)
      ) {
        const context =
          n.parentNode &&
          'tagName' in n.parentNode &&
          ['li', 'p'].includes(n.parentNode.tagName)
            ? nodeText(n.parentNode)
            : '';
        const date = /^\s*(\d{4})[.年/-](\d{1,2})[.月/-](\d{1,2})/u.exec(
          context,
        );
        add(
          url,
          label.length > 3 ? label : undefined,
          date
            ? `${date[1] ?? ''}-${(date[2] ?? '').padStart(2, '0')}-${(date[3] ?? '').padStart(2, '0')}T00:00:00Z`
            : undefined,
        );
      }
    }
    return {articles, next, method: '网页归档（可能不完整）'};
  }
  public async article(article: HistoryArticle) {
    const response = await this.http.read(article.url, article.url);
    if (
      !/text\/html|application\/xhtml\+xml/iu.test(
        response.headers.get('content-type') ?? '',
      )
    )
      throw new HistoryReadError('history_not_article');
    const metadata = articleMetadata(response.text, response.url);
    const projection = await projectStructuredDocument('html', response.bytes);
    if (projection.status !== 'projected')
      throw new HistoryReadError('history_article_unreadable');
    const body = new TextDecoder().decode(projection.value.sourceUtf8);
    if (body.trim().length < 40)
      throw new HistoryReadError('history_article_empty');
    const publishedAt = metadata.publishedAt ?? article.publishedAt;
    const title = metadata.title || article.title;
    const markdown = /^#\s/mu.test(body) ? body : '# ' + title + '\n\n' + body;
    const bytes = new TextEncoder().encode(markdown);
    return {
      title,
      access:
        metadata.restricted || article.access === 'restricted'
          ? ('restricted' as const)
          : article.access,
      document: {
        externalId:
          'history:' + createHash('sha256').update(article.url).digest('hex'),
        version: createHash('sha256').update(bytes).digest('hex'),
        canonicalUri: metadata.canonicalUrl ?? response.url,
        mediaType: 'text/html',
        profile: 'commonmark-v1' as const,
        sourceUtf8: bytes,
        rawSourceBytes: response.bytes,
        ...(publishedAt
          ? {
              publication: {
                instant: publishedAt,
                precision:
                  article.dateInferred && !metadata.publishedAt
                    ? ('day' as const)
                    : ('second' as const),
                inferred: Boolean(
                  article.dateInferred && !metadata.publishedAt,
                ),
              },
            }
          : {}),
      },
    };
  }
}
