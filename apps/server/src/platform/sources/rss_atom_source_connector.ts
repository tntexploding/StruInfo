import {createHash} from 'node:crypto';
import {lookup} from 'node:dns/promises';
import {isIP} from 'node:net';

import {XMLParser, XMLValidator} from 'fast-xml-parser';

import {projectStructuredDocument} from '../../modules/evidence/index.js';
import {
  SourceConnectorError,
  type SourceConnectorDocument,
  type SourceConnectorPort,
  type SourceConnectorReadRequest,
  type SourceConnectorReadResult,
} from '../../modules/subscriptions/index.js';

export const RSS_ATOM_SOURCE_CONNECTOR_ID = 'builtin.rss-atom.v1';
export const RSS_ATOM_MAX_ITEMS_PER_CHECK = 20;

const MAX_FEED_BYTES = 1024 * 1024;
const MAX_FEED_URL_CODE_POINTS = 2_000;
const MAX_HEADER_CODE_POINTS = 500;
const MAX_ENCODED_CURSOR_CODE_POINTS = 2_048;
const REQUEST_TIMEOUT_MILLISECONDS = 20_000;
const SHA256 = /^[0-9a-f]{64}$/u;
const TOKEN = /^[A-Za-z0-9_-]{43}$/u;
const ACCEPTED_CONTENT_TYPES = new Set([
  'application/atom+xml',
  'application/rss+xml',
  'application/xml',
  'text/xml',
]);

export interface RssAtomSourceConnectorConfiguration {
  readonly feedUrl: string;
  readonly itemLimit: number;
}

export interface RssAtomSourceConnectorDependencies {
  readonly fetch?: typeof fetch;
  readonly resolveAddresses?: (hostname: string) => Promise<readonly string[]>;
}

interface RssAtomCursor {
  readonly version: 1;
  readonly feedSha256: string;
  readonly itemTokens: readonly string[];
  readonly etag?: string;
  readonly lastModified?: string;
}

interface ParsedFeedItem {
  readonly externalId: string;
  readonly version: string;
  readonly token: string;
  readonly canonicalUri: string;
  readonly title: string;
  readonly content: string;
  readonly contentKind: 'html' | 'text';
  readonly publishedAt?: string;
}

/**
 * Built-in public RSS/Atom reader. It owns no persistence and returns the same
 * bounded connector result that an installed trusted adapter must return.
 */
export class RssAtomSourceConnector implements SourceConnectorPort {
  public readonly connectorId = RSS_ATOM_SOURCE_CONNECTOR_ID;
  public readonly descriptor = Object.freeze({
    displayName: 'RSS / Atom',
    origin: 'builtin' as const,
    configurationMode: 'internal' as const,
  });
  readonly #fetch: typeof fetch;
  readonly #resolveAddresses: (hostname: string) => Promise<readonly string[]>;

  public constructor(
    dependencies: Readonly<RssAtomSourceConnectorDependencies> = {},
  ) {
    this.#fetch = dependencies.fetch ?? fetch;
    this.#resolveAddresses =
      dependencies.resolveAddresses ?? defaultResolveAddresses;
  }

  public async read(
    request: Readonly<SourceConnectorReadRequest>,
  ): Promise<Readonly<SourceConnectorReadResult>> {
    const configuration = decodeConfiguration(request.configuration);
    if (configuration === undefined) {
      throw new SourceConnectorError('connector_result_invalid');
    }
    const feedUrl = decodePublicFeedUrl(configuration.feedUrl);
    if (feedUrl === undefined) {
      throw new SourceConnectorError('connector_result_invalid');
    }
    await this.#admitPublicHost(feedUrl.hostname);
    const previousCursor = decodeCursor(request.previousCursor);
    if (request.previousCursor !== undefined && previousCursor === undefined) {
      throw new SourceConnectorError('connector_result_invalid');
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => {
      controller.abort();
    }, REQUEST_TIMEOUT_MILLISECONDS);
    let response: Response;
    try {
      response = await this.#fetch(feedUrl, {
        method: 'GET',
        redirect: 'error',
        signal: controller.signal,
        headers: requestHeaders(previousCursor),
      });
    } catch {
      throw new SourceConnectorError('connector_unavailable');
    } finally {
      clearTimeout(timeout);
    }

    if (response.status === 304 && previousCursor !== undefined) {
      return Object.freeze({
        status: 'unchanged' as const,
        cursor: encodeCursor(previousCursor),
      });
    }
    if (!response.ok) {
      throw new SourceConnectorError('connector_unavailable');
    }
    const contentType = response.headers
      .get('content-type')
      ?.split(';', 1)[0]
      ?.trim()
      .toLowerCase();
    if (contentType === undefined || !ACCEPTED_CONTENT_TYPES.has(contentType)) {
      throw new SourceConnectorError('connector_result_invalid');
    }
    const contentLength = response.headers.get('content-length');
    if (
      contentLength !== null &&
      /^\d+$/u.test(contentLength) &&
      Number(contentLength) > MAX_FEED_BYTES
    ) {
      throw new SourceConnectorError('connector_too_large');
    }
    let feedBytes: Uint8Array;
    try {
      feedBytes = await readBoundedResponseBytes(response);
    } catch (error) {
      if (error instanceof SourceConnectorError) throw error;
      throw new SourceConnectorError('connector_unavailable');
    }
    if (feedBytes.byteLength === 0) {
      throw new SourceConnectorError('connector_result_invalid');
    }
    if (feedBytes.byteLength > MAX_FEED_BYTES) {
      throw new SourceConnectorError('connector_too_large');
    }
    const feedText = decodeUtf8(feedBytes);
    if (feedText === undefined || /<!DOCTYPE\b/iu.test(feedText)) {
      throw new SourceConnectorError('connector_result_invalid');
    }
    const parsedItems = parseFeed(feedText, feedUrl.toString());
    if (parsedItems.length === 0) {
      throw new SourceConnectorError('connector_result_invalid');
    }
    const currentItems = parsedItems.slice(0, configuration.itemLimit);
    const currentTokens = Object.freeze(currentItems.map((item) => item.token));
    const feedSha256 = digestBytes(feedBytes);
    const cursorWithoutHeaders: Readonly<RssAtomCursor> = Object.freeze({
      version: 1 as const,
      feedSha256,
      itemTokens: currentTokens,
    });
    const cursorWithHeaders: Readonly<RssAtomCursor> = Object.freeze({
      ...cursorWithoutHeaders,
      ...boundedHeader(response.headers.get('etag'), MAX_HEADER_CODE_POINTS),
      ...boundedLastModified(response.headers.get('last-modified')),
    });
    const nextCursor =
      encodeCursor(cursorWithHeaders).length <= MAX_ENCODED_CURSOR_CODE_POINTS
        ? cursorWithHeaders
        : cursorWithoutHeaders;
    const encodedNextCursor = encodeCursor(nextCursor);
    const previousTokens = new Set(previousCursor?.itemTokens ?? []);
    const changedItems = currentItems.filter(
      (item) => !previousTokens.has(item.token),
    );
    if (
      previousCursor?.feedSha256 === feedSha256 ||
      changedItems.length === 0
    ) {
      return Object.freeze({
        status: 'unchanged' as const,
        cursor: encodedNextCursor,
      });
    }
    const documents: SourceConnectorDocument[] = [];
    for (const item of changedItems) {
      documents.push(await toConnectorDocument(item, feedBytes, contentType));
    }
    return Object.freeze({
      status: 'changed' as const,
      cursor: encodedNextCursor,
      documents: Object.freeze(documents),
    });
  }

  async #admitPublicHost(hostname: string): Promise<void> {
    if (isBlockedHostname(hostname)) {
      throw new SourceConnectorError('connector_result_invalid');
    }
    let addresses: readonly string[];
    try {
      addresses = await this.#resolveAddresses(hostname);
    } catch {
      throw new SourceConnectorError('connector_unavailable');
    }
    if (
      addresses.length === 0 ||
      addresses.some((address) => isBlockedAddress(address))
    ) {
      throw new SourceConnectorError('connector_result_invalid');
    }
  }
}

async function readBoundedResponseBytes(
  response: Response,
): Promise<Uint8Array> {
  if (response.body === null) return new Uint8Array();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      totalBytes += chunk.value.byteLength;
      if (totalBytes > MAX_FEED_BYTES) {
        try {
          await reader.cancel();
        } catch {
          // The size verdict remains stable even when cancellation fails.
        }
        throw new SourceConnectorError('connector_too_large');
      }
      chunks.push(Uint8Array.from(chunk.value));
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

export function decodePublicFeedUrl(value: unknown): URL | undefined {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    Array.from(value).length > MAX_FEED_URL_CODE_POINTS ||
    containsControlCodePoint(value) ||
    value.trim() !== value
  ) {
    return undefined;
  }
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return undefined;
  }
  if (
    parsed.protocol !== 'https:' ||
    parsed.username !== '' ||
    parsed.password !== '' ||
    parsed.hash !== '' ||
    parsed.hostname === ''
  ) {
    return undefined;
  }
  return parsed;
}

function decodeConfiguration(
  value: unknown,
): Readonly<RssAtomSourceConnectorConfiguration> | undefined {
  if (
    !isRecord(value) ||
    Object.keys(value).sort().join('\u0000') !== 'feedUrl\u0000itemLimit' ||
    typeof value.feedUrl !== 'string' ||
    !Number.isSafeInteger(value.itemLimit) ||
    (value.itemLimit as number) < 1 ||
    (value.itemLimit as number) > RSS_ATOM_MAX_ITEMS_PER_CHECK
  ) {
    return undefined;
  }
  return Object.freeze({
    feedUrl: value.feedUrl,
    itemLimit: value.itemLimit as number,
  });
}

function requestHeaders(cursor: Readonly<RssAtomCursor> | undefined): Headers {
  const headers = new Headers({
    accept:
      'application/atom+xml, application/rss+xml, application/xml;q=0.9, text/xml;q=0.8',
    'user-agent': 'StruInfo/1.0 (+local-source-subscription)',
  });
  if (cursor?.etag !== undefined) headers.set('if-none-match', cursor.etag);
  if (cursor?.lastModified !== undefined) {
    headers.set('if-modified-since', cursor.lastModified);
  }
  return headers;
}

function parseFeed(
  feedText: string,
  feedUrl: string,
): readonly ParsedFeedItem[] {
  // The exact pinned parser still ships this syntax validator. Keeping it here
  // avoids seven unrelated runtime packages while retaining fail-closed XML.
  // eslint-disable-next-line @typescript-eslint/no-deprecated
  if (XMLValidator.validate(feedText) !== true) {
    throw new SourceConnectorError('connector_result_invalid');
  }
  let parsed: unknown;
  try {
    parsed = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: '@_',
      removeNSPrefix: true,
      parseTagValue: false,
      parseAttributeValue: false,
      trimValues: false,
      processEntities: true,
      ignoreDeclaration: true,
      ignorePiTags: true,
      maxNestedTags: 100,
      isArray: (tagName) =>
        tagName === 'item' || tagName === 'entry' || tagName === 'link',
    }).parse(feedText) as unknown;
  } catch {
    throw new SourceConnectorError('connector_result_invalid');
  }
  if (!isRecord(parsed)) {
    throw new SourceConnectorError('connector_result_invalid');
  }
  if (isRecord(parsed.rss) && isRecord(parsed.rss.channel)) {
    return parseRssItems(parsed.rss.channel, feedUrl);
  }
  if (isRecord(parsed.feed)) {
    return parseAtomItems(parsed.feed, feedUrl);
  }
  throw new SourceConnectorError('connector_result_invalid');
}

function parseRssItems(
  channel: Readonly<Record<string, unknown>>,
  feedUrl: string,
): readonly ParsedFeedItem[] {
  const items = toArray(channel.item);
  return Object.freeze(
    items.flatMap((candidate) => {
      if (!isRecord(candidate)) return [];
      const title =
        normalizedText(textValue(candidate.title)) || '未命名订阅条目';
      const link = admittedItemUri(firstText(candidate.link), feedUrl);
      const content =
        textValue(candidate.encoded) ?? textValue(candidate.description) ?? '';
      const externalId = stableExternalId(
        textValue(candidate.guid) ?? textValue(candidate.id) ?? link,
        title,
        content,
      );
      const publishedAt = normalizedInstant(
        textValue(candidate.pubDate) ??
          textValue(candidate.published) ??
          textValue(candidate.updated),
      );
      return [
        buildParsedItem({
          externalId,
          canonicalUri: link,
          title,
          content,
          contentKind: looksLikeHtml(content) ? 'html' : 'text',
          ...(publishedAt === undefined ? {} : {publishedAt}),
        }),
      ];
    }),
  );
}

function parseAtomItems(
  feed: Readonly<Record<string, unknown>>,
  feedUrl: string,
): readonly ParsedFeedItem[] {
  const items = toArray(feed.entry);
  return Object.freeze(
    items.flatMap((candidate) => {
      if (!isRecord(candidate)) return [];
      const title =
        normalizedText(textValue(candidate.title)) || '未命名订阅条目';
      const link = atomLink(candidate.link, feedUrl);
      const contentNode = candidate.content ?? candidate.summary;
      const content = textValue(contentNode) ?? deepText(contentNode);
      const contentType =
        isRecord(contentNode) && typeof contentNode['@_type'] === 'string'
          ? contentNode['@_type'].toLowerCase()
          : '';
      const externalId = stableExternalId(
        textValue(candidate.id) ?? link,
        title,
        content,
      );
      const publishedAt = normalizedInstant(
        textValue(candidate.published) ?? textValue(candidate.updated),
      );
      return [
        buildParsedItem({
          externalId,
          canonicalUri: link,
          title,
          content,
          contentKind:
            contentType === 'html' ||
            contentType === 'xhtml' ||
            looksLikeHtml(content)
              ? 'html'
              : 'text',
          ...(publishedAt === undefined ? {} : {publishedAt}),
        }),
      ];
    }),
  );
}

function buildParsedItem(
  value: Omit<ParsedFeedItem, 'token' | 'version'>,
): ParsedFeedItem {
  const version = digestText(
    JSON.stringify([
      value.externalId,
      value.canonicalUri,
      value.title,
      value.content,
      value.contentKind,
      value.publishedAt ?? null,
    ]),
  );
  return Object.freeze({
    ...value,
    version,
    token: createHash('sha256')
      .update(`${value.externalId}\u0000${version}`, 'utf8')
      .digest('base64url'),
  });
}

async function toConnectorDocument(
  item: Readonly<ParsedFeedItem>,
  rawFeedBytes: Uint8Array,
  mediaType: string,
): Promise<Readonly<SourceConnectorDocument>> {
  const title = escapeMarkdownHeading(item.title);
  let body = normalizedText(item.content);
  if (item.contentKind === 'html' && item.content.trim() !== '') {
    const projection = await projectStructuredDocument(
      'html',
      new TextEncoder().encode(item.content),
    );
    if (projection.status === 'projected') {
      body = new TextDecoder().decode(projection.value.sourceUtf8).trim();
    }
  }
  const source = [
    `# ${title}`,
    body,
    `[查看原始条目](${escapeMarkdownDestination(item.canonicalUri)})`,
  ]
    .filter((part) => part.trim() !== '')
    .join('\n\n');
  return Object.freeze({
    externalId: item.externalId,
    version: item.version,
    canonicalUri: item.canonicalUri,
    mediaType,
    profile: 'commonmark-v1' as const,
    sourceUtf8: new TextEncoder().encode(`${source.trim()}\n`),
    rawSourceBytes: Uint8Array.from(rawFeedBytes),
    ...(item.publishedAt === undefined
      ? {}
      : {
          publication: Object.freeze({
            inferred: false,
            instant: item.publishedAt,
            precision: 'second' as const,
          }),
        }),
  });
}

function atomLink(value: unknown, fallback: string): string {
  for (const candidate of toArray(value)) {
    if (typeof candidate === 'string') {
      const admitted = admittedItemUri(candidate, fallback);
      if (admitted !== fallback) return admitted;
      continue;
    }
    if (!isRecord(candidate) || typeof candidate['@_href'] !== 'string') {
      continue;
    }
    const relation = candidate['@_rel'];
    if (relation !== undefined && relation !== 'alternate') continue;
    const admitted = admittedItemUri(candidate['@_href'], fallback);
    if (admitted !== fallback) return admitted;
  }
  return fallback;
}

function admittedItemUri(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback;
  try {
    const parsed = new URL(value.trim(), fallback);
    return parsed.protocol === 'https:' &&
      parsed.username === '' &&
      parsed.password === ''
      ? parsed.toString()
      : fallback;
  } catch {
    return fallback;
  }
}

function stableExternalId(
  candidate: string,
  title: string,
  content: string,
): string {
  const normalized = normalizedText(candidate);
  const value =
    normalized === ''
      ? `generated:${digestText(`${title}\u0000${content}`)}`
      : normalized;
  return Array.from(value).length <= 500 && !containsControlCodePoint(value)
    ? value
    : `sha256:${digestText(value)}`;
}

function encodeCursor(cursor: Readonly<RssAtomCursor>): string {
  return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url');
}

function decodeCursor(value: string | undefined): RssAtomCursor | undefined {
  if (value === undefined) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(
      Buffer.from(value, 'base64url').toString('utf8'),
    ) as unknown;
  } catch {
    return undefined;
  }
  if (!isRecord(parsed)) {
    return undefined;
  }
  const itemTokens = decodeCursorItemTokens(parsed.itemTokens);
  if (
    parsed.version !== 1 ||
    typeof parsed.feedSha256 !== 'string' ||
    !SHA256.test(parsed.feedSha256) ||
    itemTokens === undefined ||
    !optionalHeader(parsed.etag) ||
    !optionalHeader(parsed.lastModified)
  ) {
    return undefined;
  }
  return Object.freeze({
    version: 1 as const,
    feedSha256: parsed.feedSha256,
    itemTokens,
    ...(typeof parsed.etag === 'string' ? {etag: parsed.etag} : {}),
    ...(typeof parsed.lastModified === 'string'
      ? {lastModified: parsed.lastModified}
      : {}),
  });
}

function decodeCursorItemTokens(value: unknown): readonly string[] | undefined {
  if (!Array.isArray(value) || value.length > RSS_ATOM_MAX_ITEMS_PER_CHECK) {
    return undefined;
  }
  const tokens: string[] = [];
  for (const token of value as readonly unknown[]) {
    if (typeof token !== 'string' || !TOKEN.test(token)) return undefined;
    tokens.push(token);
  }
  return Object.freeze(tokens);
}

function boundedHeader(
  value: string | null,
  maximum: number,
): Readonly<{etag?: string}> {
  return value !== null &&
    value.length > 0 &&
    Array.from(value).length <= maximum &&
    !containsControlCodePoint(value)
    ? Object.freeze({etag: value})
    : Object.freeze({});
}

function boundedLastModified(
  value: string | null,
): Readonly<{lastModified?: string}> {
  return value !== null &&
    value.length > 0 &&
    Array.from(value).length <= MAX_HEADER_CODE_POINTS &&
    !containsControlCodePoint(value)
    ? Object.freeze({lastModified: value})
    : Object.freeze({});
}

function optionalHeader(value: unknown): boolean {
  return (
    value === undefined ||
    (typeof value === 'string' &&
      value.length > 0 &&
      Array.from(value).length <= MAX_HEADER_CODE_POINTS &&
      !containsControlCodePoint(value))
  );
}

async function defaultResolveAddresses(
  hostname: string,
): Promise<readonly string[]> {
  if (isIP(hostname) !== 0) return Object.freeze([hostname]);
  const records = await lookup(hostname, {all: true, verbatim: true});
  return Object.freeze(records.map((record) => record.address));
}

function isBlockedHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase().replace(/\.$/u, '');
  return (
    normalized === 'localhost' ||
    normalized.endsWith('.localhost') ||
    normalized.endsWith('.local') ||
    (isIP(normalized) !== 0 && isBlockedAddress(normalized))
  );
}

function isBlockedAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) {
    const octets = address.split('.').map(Number);
    const [a, b] = octets;
    return (
      a === undefined ||
      b === undefined ||
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      a >= 224
    );
  }
  if (family === 6) {
    const normalized = address.toLowerCase();
    return (
      normalized === '::' ||
      normalized === '::1' ||
      normalized.startsWith('fc') ||
      normalized.startsWith('fd') ||
      /^fe[89ab]/u.test(normalized) ||
      normalized.startsWith('ff') ||
      normalized.startsWith('::ffff:')
    );
  }
  return true;
}

function textValue(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  if (isRecord(value) && typeof value['#text'] === 'string') {
    return value['#text'];
  }
  return undefined;
}

function firstText(value: unknown): string | undefined {
  for (const candidate of toArray(value)) {
    const text = textValue(candidate);
    if (text !== undefined) return text;
  }
  return undefined;
}

function deepText(value: unknown, depth = 0): string {
  if (depth > 20) return '';
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) {
    return value.map((item) => deepText(item, depth + 1)).join(' ');
  }
  if (!isRecord(value)) return '';
  return Object.entries(value)
    .filter(([key]) => !key.startsWith('@_'))
    .map(([, candidate]) => deepText(candidate, depth + 1))
    .join(' ');
}

function toArray(value: unknown): readonly unknown[] {
  if (value === undefined) return Object.freeze([]);
  return Array.isArray(value) ? value : Object.freeze([value]);
}

function decodeUtf8(bytes: Uint8Array): string | undefined {
  try {
    const value = new TextDecoder('utf-8', {fatal: true}).decode(bytes);
    return value.includes('\u0000') ? undefined : value;
  } catch {
    return undefined;
  }
}

function normalizedText(value: string | undefined): string {
  return (value ?? '')
    .normalize('NFC')
    .replace(/[\t\n\f\r ]+/gu, ' ')
    .trim();
}

function normalizedInstant(value: string | undefined): string | undefined {
  if (value === undefined || value.trim() === '') return undefined;
  const parsed = new Date(value);
  return Number.isNaN(parsed.valueOf()) ? undefined : parsed.toISOString();
}

function looksLikeHtml(value: string): boolean {
  return /<\/?[A-Za-z][^>]*>/u.test(value);
}

function escapeMarkdownHeading(value: string): string {
  return value.replace(/[\\`*_[\]<>#]/gu, '\\$&');
}

function escapeMarkdownDestination(value: string): string {
  return value.replace(/\s/gu, '%20').replace(/\)/gu, '%29');
}

function containsControlCodePoint(value: string): boolean {
  return Array.from(value).some((character) => {
    const codePoint = character.codePointAt(0);
    return codePoint !== undefined && (codePoint <= 0x1f || codePoint === 0x7f);
  });
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function digestBytes(value: Uint8Array): string {
  return createHash('sha256').update(value).digest('hex');
}

function digestText(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}
