import type {SourceDescriptionEvidence} from '../../application/source_description_service.js';
import {XMLParser} from 'fast-xml-parser';
import {HistoryHttp} from './history_http.js';
import {attr, nodes, nodeText, plainHtml} from './history_markup.js';
import {parseFeed} from './rss_atom_source_connector.js';

const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
const plain = (value: unknown, maximum: number): string => {
  const text = typeof value === 'string' ? value : record(value)['#text'];
  return typeof text === 'string'
    ? Array.from(plainHtml(text)).slice(0, maximum).join('')
    : '';
};

/** Reads public metadata and bounded syndicated excerpts, without following article links. */
export class SourceDescriptionReader {
  public constructor(private readonly http = new HistoryHttp()) {}
  public async read(
    kind: 'rss_atom' | 'web',
    url: string,
  ): Promise<SourceDescriptionEvidence> {
    const {text} = await this.http.read(url, url);
    if (kind === 'rss_atom') {
      const items = parseFeed(text, url); // Validates XML and the RSS/Atom envelope.
      const xml = record(
        new XMLParser({
          ignoreAttributes: true,
          removeNSPrefix: true,
          parseTagValue: false,
          ignoreDeclaration: true,
          ignorePiTags: true,
          maxNestedTags: 100,
        }).parse(text) as unknown,
      );
      const channel = xml.rss
        ? record(record(xml.rss).channel)
        : record(xml.feed);
      return {
        title: plain(channel.title, 240),
        description: plain(channel.description ?? channel.subtitle, 1500),
        sampleTitles: [
          ...new Set(
            items.map((item) => plain(item.title, 240)).filter(Boolean),
          ),
        ].slice(0, 12),
        sampleExcerpts: items
          .slice(0, 4)
          .map((item) => ({
            title: plain(item.title, 240),
            text: plain(item.content, 1000),
          }))
          .filter((item) => item.text),
      };
    }
    const elements = nodes(text);
    const description = elements.find(
      (node) =>
        node.tagName === 'meta' &&
        ['description', 'og:description'].includes(
          attr(node, 'name') || attr(node, 'property'),
        ),
    );
    return {
      title: plain(
        nodeText(
          elements.find((node) => node.tagName === 'title') ?? {
            nodeName: '#text',
            value: '',
            parentNode: null,
          },
        ),
        240,
      ),
      description: plain(attr(description, 'content'), 1500),
      sampleTitles: [
        ...new Set(
          elements
            .filter((node) => ['h1', 'h2', 'h3'].includes(node.tagName))
            .map((node) => plain(nodeText(node), 240))
            .filter(Boolean),
        ),
      ].slice(0, 12),
    };
  }
}
