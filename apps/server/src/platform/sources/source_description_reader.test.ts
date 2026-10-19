import {describe, it, expect, vi} from 'vitest';
import {SourceDescriptionReader} from './source_description_reader.js';
import {HistoryHttp} from './history_http.js';
const URL = 'https://example.invalid/feed';
function fixture(text: string) {
  const fetcher = vi
    .fn<typeof fetch>()
    .mockImplementation(() => Promise.resolve(new Response(text)));
  return {
    fetcher,
    reader: new SourceDescriptionReader(
      new HistoryHttp({
        fetch: fetcher,
        resolveAddresses: () => Promise.resolve(['203.0.113.10']),
      }),
    ),
  };
}
describe('public source description evidence', () => {
  it('extracts publisher metadata, titles and short reading excerpts without following links', async () => {
    const f = fixture(
      '<rss><channel><title>Synthetic feed</title><description><![CDATA[<p>Engineering &amp; design</p>]]></description>' +
        Array.from(
          {length: 15},
          (_, i) =>
            `<item><title>Synthetic ${String(i)}</title><link>https://example.invalid/${String(i)}</link><description>Synthetic bounded body xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx</description></item>`,
        ).join('') +
        '</channel></rss>',
    );
    const result = await f.reader.read('rss_atom', URL);
    expect(result.description).toBe('Engineering & design');
    expect(result.title).toBe('Synthetic feed');
    expect(result.sampleTitles).toHaveLength(12);
    expect(result.sampleExcerpts).toHaveLength(4);
    expect(
      result.sampleExcerpts?.every((item) => item.text.length === 1000),
    ).toBe(true);
    expect(result.sampleExcerpts?.[0]?.text).toContain(
      'Synthetic bounded body',
    );
    expect(f.fetcher).toHaveBeenCalledTimes(1);
  });
  it('handles Atom subtitle and namespace metadata', async () => {
    const f = fixture(
      '<atom:feed xmlns:atom="http://www.w3.org/2005/Atom"><atom:title>Synthetic Atom</atom:title><atom:subtitle>Teaching networks</atom:subtitle><atom:entry><atom:id>synthetic</atom:id><atom:title>Routing experiment</atom:title><atom:link href="https://example.invalid/post"/><atom:content>Body</atom:content></atom:entry></atom:feed>',
    );
    expect(await f.reader.read('rss_atom', URL)).toEqual({
      title: 'Synthetic Atom',
      description: 'Teaching networks',
      sampleTitles: ['Routing experiment'],
      sampleExcerpts: [{title: 'Routing experiment', text: 'Body'}],
    });
  });
  it('uses public page metadata and headings, not scripts or hidden data', async () => {
    const f = fixture(
      '<html><head><title>Synthetic site</title><meta name="description" content="Public tutorials"><script>secret instructions</script></head><body><h2>System design</h2><p>Unrelated body</p></body></html>',
    );
    expect(await f.reader.read('web', URL)).toEqual({
      title: 'Synthetic site',
      description: 'Public tutorials',
      sampleTitles: ['System design'],
    });
    expect(f.fetcher).toHaveBeenCalledTimes(1);
  });
  it('retains the public-HTTPS and bounded-response reader safeguards', async () => {
    const f = fixture('not an XML feed');
    await expect(
      f.reader.read('rss_atom', 'http://127.0.0.1/feed'),
    ).rejects.toThrow();
    await expect(
      f.reader.read('rss_atom', 'https://user:pass@example.invalid/feed'),
    ).rejects.toThrow();
    expect(f.fetcher).not.toHaveBeenCalled();
    await expect(f.reader.read('rss_atom', URL)).rejects.toThrow();
    expect(f.fetcher).toHaveBeenCalledTimes(1);
  });
});
