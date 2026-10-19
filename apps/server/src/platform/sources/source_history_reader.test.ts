import {describe, it, expect, vi} from 'vitest';
import {HistoryHttp, HistoryReadError} from './history_http.js';
import {PublicSourceHistoryReader} from './source_history_reader.js';
import {articleMetadata, urlDate} from './history_markup.js';
const BASE = 'https://example.invalid/feed';
const response = (body: string, type = 'application/xml') =>
  new Response(body, {headers: {'content-type': type}});
function reader(fetcher: typeof fetch) {
  return new PublicSourceHistoryReader(
    new HistoryHttp({
      fetch: fetcher,
      resolveAddresses: () => Promise.resolve(['203.0.113.10']),
    }),
  );
}
describe('public source history reader', () => {
  it('does not mistake a platform link in an article for the feed generator', async () => {
    const r = reader(
      vi
        .fn<typeof fetch>()
        .mockResolvedValue(
          response(
            '<rss><channel><item><title>Synthetic</title><link>http://example.invalid/post</link><description>Read about substack and wordpress.org.</description></item></channel></rss>',
          ),
        ),
    );
    const page = await r.read({kind: 'feed', url: BASE}, BASE);
    expect(page.method).toBe('RSS 最近内容');
    expect(page.next).toEqual([]);
    expect(page.articles[0]?.url).toBe('https://example.invalid/post');
  });

  it('follows sitemap indexes within the source and never labels lastmod as publication', async () => {
    const f = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        response(
          '<sitemapindex><sitemap><loc>https://example.invalid/posts.xml</loc></sitemap><sitemap><loc>https://foreign.invalid/items.xml</loc></sitemap><sitemap><loc>https://example.invalid/tags.xml</loc></sitemap></sitemapindex>',
        ),
      )
      .mockResolvedValueOnce(
        response(
          '<urlset><url><loc>https://example.invalid/post-one</loc><lastmod>2026-01-01</lastmod></url><url><loc>https://example.invalid/2023/02/03/post-two/</loc></url></urlset>',
        ),
      );
    const r = reader(f),
      index = await r.read(
        {kind: 'sitemap', url: 'https://example.invalid/sitemap.xml'},
        BASE,
      );
    expect(index.next).toEqual([
      {kind: 'sitemap', url: 'https://example.invalid/posts.xml'},
    ]);
    const next = index.next[0];
    if (!next) throw new Error('missing synthetic page');
    const page = await r.read(next, BASE);
    expect(page.articles[0]?.publishedAt).toBeUndefined();
    expect(page.articles[1]).toMatchObject({
      publishedAt: '2023-02-03T00:00:00.000Z',
      dateInferred: true,
    });
  });
  it('uses public paginated metadata, keeping locked content distinct', async () => {
    const rows = Array.from({length: 2}, (_, id) => ({
      title: 'Synthetic ' + String(id),
      canonical_url: 'https://example.invalid/p/' + String(id),
      post_date: '2024-01-01T00:00:00Z',
      audience: id ? 'everyone' : 'only_paid',
    }));
    const r = reader(
      vi
        .fn<typeof fetch>()
        .mockResolvedValue(response(JSON.stringify(rows), 'application/json')),
    );
    const result = await r.read(
      {
        kind: 'substack',
        page: 0,
        url: 'https://example.invalid/api/v1/archive?offset=0&limit=50',
      },
      BASE,
    );
    expect(result.articles).toHaveLength(2);
    expect(result.articles[0]?.access).toBe('restricted');
    expect(result.next[0]?.url).toContain('offset=2');
  });
  it('discovers HTML archive pages without crawling unrelated sites or images', async () => {
    const r = reader(
      vi
        .fn<typeof fetch>()
        .mockResolvedValue(
          response(
            '<a href="/blog/archives.html">Archives</a><a href="/blog/2024/01/first.html">Synthetic title</a><a href="https://outside.invalid/2024/01/01/post/">Outside</a><a href="/image.png">Image</a>',
            'text/html',
          ),
        ),
    );
    const result = await r.read(
      {kind: 'html', url: 'https://example.invalid/'},
      BASE,
    );
    expect(result.articles).toHaveLength(1);
    expect(result.articles[0]?.title).toBe('Synthetic title');
    expect(result.next[0]?.url).toContain('/blog/archives.html');
  });
  it('retains exact page evidence and publisher date in the article projection', async () => {
    const html =
      '<html><head><meta property="og:title" content="Synthetic original title"><meta property="article:published_time" content="2020-02-03T12:00:00Z"></head><body><article><h1>Synthetic original title</h1><p>This is a complete synthetic article with enough context for review.</p></article></body></html>';
    const r = reader(
      vi.fn<typeof fetch>().mockResolvedValue(response(html, 'text/html')),
    );
    const result = await r.article({
      id: 'a',
      subscriptionId: 'b',
      url: 'https://example.invalid/post',
      title: 'path title',
      access: 'unknown',
    });
    expect(result.document.rawSourceBytes).toEqual(Buffer.from(html));
    expect(result.document.publication).toMatchObject({
      instant: '2020-02-03T12:00:00.000Z',
      inferred: false,
    });
    expect(new TextDecoder().decode(result.document.sourceUtf8)).toContain(
      'complete synthetic article',
    );
    expect(
      articleMetadata(
        '<script type="application/ld+json">{"@type":"Article","isAccessibleForFree":false,"datePublished":"2021-01-01"}</script>',
        BASE,
      ).restricted,
    ).toBe(true);
    expect(urlDate('https://example.invalid/2023/Dec/2/a/')).toBe(
      '2023-12-02T00:00:00.000Z',
    );
  });
  it('reads an explicit visible publication label without using update or body dates', () => {
    expect(
      articleMetadata('<div>发布日期：<a href="/edit">2022/3/4</a></div>', BASE)
        .publishedAt,
    ).toBe('2022-03-04T00:00:00.000Z');
    expect(
      articleMetadata('<p>Published on: <span>2021-02-03</span></p>', BASE)
        .publishedAt,
    ).toBe('2021-02-03T00:00:00.000Z');
    for (const html of [
      '<div>Updated: 2022-03-04</div>',
      '<p>This synthetic article discusses a publication dated 2022-03-04.</p>',
      '<div>发布日期：2022/02/31</div>',
    ])
      expect(articleMetadata(html, BASE).publishedAt).toBeUndefined();
  });
  it('rejects local destinations, cross-site redirects, malformed XML and oversized streams', async () => {
    const f = vi.fn<typeof fetch>();
    const http = new HistoryHttp({
      fetch: f,
      resolveAddresses: () => Promise.resolve(['127.0.0.1']),
    });
    await expect(http.read(BASE, BASE)).rejects.toBeInstanceOf(
      HistoryReadError,
    );
    expect(f).not.toHaveBeenCalled();
    const redirect = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(null, {
        status: 302,
        headers: {location: 'https://outside.invalid/'},
      }),
    );
    await expect(
      reader(redirect).read({kind: 'feed', url: BASE}, BASE),
    ).rejects.toThrow('history_redirect_not_allowed');
    expect(redirect).toHaveBeenCalledTimes(1);
    await expect(
      reader(
        vi.fn<typeof fetch>().mockResolvedValue(response('<urlset>')),
      ).read({kind: 'sitemap', url: BASE}, BASE),
    ).rejects.toThrow('history_directory_invalid');
    const large = new Response(new Uint8Array(8 * 1024 * 1024 + 1), {
      headers: {'content-length': '1'},
    });
    await expect(
      reader(vi.fn<typeof fetch>().mockResolvedValue(large)).read(
        {kind: 'feed', url: BASE},
        BASE,
      ),
    ).rejects.toThrow('history_response_too_large');
  });
});
