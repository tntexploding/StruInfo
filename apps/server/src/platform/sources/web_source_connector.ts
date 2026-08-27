import {createHash} from 'node:crypto';
import {lookup} from 'node:dns/promises';
import {isIP} from 'node:net';

import {projectStructuredDocument} from '../../modules/evidence/index.js';
import {
  SourceConnectorError,
  type SourceConnectorDocument,
  type SourceConnectorPort,
  type SourceConnectorReadRequest,
  type SourceConnectorReadResult,
} from '../../modules/subscriptions/index.js';

export const WEB_SOURCE_CONNECTOR_ID = 'builtin.web.v1';
export const WEB_MAX_PAGES_PER_CHECK = 8;

const MAX_RESPONSE_BYTES = 1024 * 1024;
const MAX_URL_CODE_POINTS = 2_000;
const MAX_PATH_CODE_POINTS = 500;
const MAX_HEADER_CODE_POINTS = 300;
const MAX_CURSOR_CODE_POINTS = 2_048;
const REQUEST_TIMEOUT_MILLISECONDS = 20_000;
const TOKEN = /^[A-Za-z0-9_-]{43}$/u;
const KEY = /^[0-9a-f]{16}$/u;
const ACCEPTED_CONTENT_TYPES = new Set(['text/html', 'application/xhtml+xml']);

export interface WebSourceConnectorConfiguration {
  readonly pageUrl: string;
  /** Explicit same-origin root-relative pages; link discovery is forbidden. */
  readonly additionalPaths: readonly string[];
}

export interface WebSourceConnectorDependencies {
  readonly fetch?: typeof fetch;
  readonly resolveAddresses?: (hostname: string) => Promise<readonly string[]>;
}

interface WebCursorPage {
  readonly key: string;
  readonly token: string;
  readonly etag?: string;
  readonly lastModified?: string;
}

interface WebCursor {
  readonly version: 1;
  readonly pages: readonly Readonly<WebCursorPage>[];
}

/**
 * A deliberately constrained Web reader. It fetches only the explicitly
 * configured public HTTPS pages on one origin, never discovers links, follows
 * redirects, executes scripts or exposes a general crawler surface.
 */
export class WebSourceConnector implements SourceConnectorPort {
  public readonly connectorId = WEB_SOURCE_CONNECTOR_ID;
  public readonly descriptor = Object.freeze({
    displayName: '受限网页',
    origin: 'builtin' as const,
    configurationMode: 'internal' as const,
  });
  readonly #fetch: typeof fetch;
  readonly #resolveAddresses: (hostname: string) => Promise<readonly string[]>;

  public constructor(
    dependencies: Readonly<WebSourceConnectorDependencies> = {},
  ) {
    this.#fetch = dependencies.fetch ?? globalThis.fetch;
    this.#resolveAddresses =
      dependencies.resolveAddresses ?? defaultResolveAddresses;
  }

  public async read(
    request: Readonly<SourceConnectorReadRequest>,
  ): Promise<Readonly<SourceConnectorReadResult>> {
    const configuration = decodeConfiguration(request.configuration);
    const previous = decodeCursor(request.previousCursor);
    if (
      configuration === undefined ||
      (request.previousCursor !== undefined && previous === undefined)
    ) {
      throw new SourceConnectorError('connector_result_invalid');
    }
    const pages = configuredPages(configuration);
    const firstPage = pages[0];
    if (firstPage === undefined) {
      throw new SourceConnectorError('connector_result_invalid');
    }
    await this.#admitPublicHost(firstPage.hostname);
    const previousByKey = new Map(
      (previous?.pages ?? []).map((page) => [page.key, page]),
    );
    const nextPages: WebCursorPage[] = [];
    const changed: SourceConnectorDocument[] = [];

    for (const pageUrl of pages) {
      const key = digestText(pageUrl.toString()).slice(0, 16);
      const previousPage = previousByKey.get(key);
      const response = await this.#readPage(pageUrl, previousPage);
      if (response.status === 'unchanged') {
        if (previousPage === undefined) {
          throw new SourceConnectorError('connector_result_invalid');
        }
        nextPages.push(previousPage);
        continue;
      }

      const projection = await projectStructuredDocument(
        'html',
        response.bytes,
      );
      if (projection.status !== 'projected') {
        throw new SourceConnectorError(
          projection.code === 'document_too_large' ||
            projection.code === 'projection_too_large'
            ? 'connector_too_large'
            : 'connector_result_invalid',
        );
      }
      const token = digestBytesBase64Url(response.bytes);
      const cursorPage = Object.freeze({
        key,
        token,
        ...boundedHeader('etag', response.etag),
        ...boundedHeader('lastModified', response.lastModified),
      });
      nextPages.push(cursorPage);
      if (previousPage?.token === token) continue;

      const projectionSha256 = digestBytes(projection.value.sourceUtf8);
      changed.push(
        Object.freeze({
          externalId: `page:${key}`,
          version: `${digestBytes(response.bytes)}:${projectionSha256}`,
          canonicalUri: pageUrl.toString(),
          mediaType: response.mediaType,
          profile: 'commonmark-v1' as const,
          sourceUtf8: Uint8Array.from(projection.value.sourceUtf8),
          rawSourceBytes: Uint8Array.from(response.bytes),
        }),
      );
    }

    const cursor = encodeCursor({version: 1, pages: Object.freeze(nextPages)});
    return changed.length === 0
      ? Object.freeze({status: 'unchanged' as const, cursor})
      : Object.freeze({
          status: 'changed' as const,
          cursor,
          documents: Object.freeze(changed),
        });
  }

  async #readPage(
    pageUrl: URL,
    previous: Readonly<WebCursorPage> | undefined,
  ): Promise<
    | Readonly<{status: 'unchanged'}>
    | Readonly<{
        status: 'changed';
        bytes: Uint8Array;
        mediaType: string;
        etag?: string;
        lastModified?: string;
      }>
  > {
    const headers = new Headers({
      accept: 'text/html, application/xhtml+xml;q=0.9',
      'user-agent': 'StruInfo/1.0 (+local-source-subscription)',
    });
    if (previous?.etag !== undefined) {
      headers.set('if-none-match', previous.etag);
    }
    if (previous?.lastModified !== undefined) {
      headers.set('if-modified-since', previous.lastModified);
    }
    let response: Response;
    try {
      response = await this.#fetch(pageUrl, {
        method: 'GET',
        headers,
        redirect: 'manual',
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MILLISECONDS),
      });
    } catch {
      throw new SourceConnectorError('connector_unavailable');
    }
    if (response.status === 304) {
      return Object.freeze({status: 'unchanged' as const});
    }
    if (response.status >= 300 && response.status < 400) {
      throw new SourceConnectorError('connector_result_invalid');
    }
    if (!response.ok) {
      throw new SourceConnectorError('connector_unavailable');
    }
    const mediaType = response.headers
      .get('content-type')
      ?.split(';', 1)[0]
      ?.trim()
      .toLowerCase();
    if (mediaType === undefined || !ACCEPTED_CONTENT_TYPES.has(mediaType)) {
      throw new SourceConnectorError('connector_result_invalid');
    }
    const contentLength = response.headers.get('content-length');
    if (
      contentLength !== null &&
      /^\d+$/u.test(contentLength) &&
      Number(contentLength) > MAX_RESPONSE_BYTES
    ) {
      throw new SourceConnectorError('connector_too_large');
    }
    const bytes = await readBoundedResponseBytes(response);
    if (bytes.byteLength === 0) {
      throw new SourceConnectorError('connector_result_invalid');
    }
    return Object.freeze({
      status: 'changed' as const,
      bytes,
      mediaType,
      ...boundedHeader('etag', response.headers.get('etag')),
      ...boundedHeader('lastModified', response.headers.get('last-modified')),
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

export function decodePublicWebUrl(value: unknown): URL | undefined {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    Array.from(value).length > MAX_URL_CODE_POINTS ||
    value.trim() !== value ||
    containsControlCodePoint(value)
  ) {
    return undefined;
  }
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return undefined;
  }
  return parsed.protocol === 'https:' &&
    parsed.username === '' &&
    parsed.password === '' &&
    parsed.hash === '' &&
    parsed.hostname !== ''
    ? parsed
    : undefined;
}

function decodeConfiguration(
  value: unknown,
): Readonly<WebSourceConnectorConfiguration> | undefined {
  if (
    !isRecord(value) ||
    !exactKeys(value, ['additionalPaths', 'pageUrl']) ||
    !Array.isArray(value.additionalPaths) ||
    value.additionalPaths.length > WEB_MAX_PAGES_PER_CHECK - 1
  ) {
    return undefined;
  }
  const pageUrl = decodePublicWebUrl(value.pageUrl);
  if (pageUrl === undefined) return undefined;
  const additionalPaths: string[] = [];
  const seen = new Set([pageUrl.toString()]);
  for (const path of value.additionalPaths as readonly unknown[]) {
    if (!validAdditionalPath(path)) return undefined;
    const page = new URL(path, pageUrl.origin);
    if (page.origin !== pageUrl.origin || seen.has(page.toString())) {
      return undefined;
    }
    seen.add(page.toString());
    additionalPaths.push(path);
  }
  return Object.freeze({
    pageUrl: pageUrl.toString(),
    additionalPaths: Object.freeze(additionalPaths),
  });
}

function configuredPages(
  configuration: Readonly<WebSourceConnectorConfiguration>,
): readonly URL[] {
  const first = new URL(configuration.pageUrl);
  return Object.freeze([
    first,
    ...configuration.additionalPaths.map((path) => new URL(path, first.origin)),
  ]);
}

function validAdditionalPath(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.startsWith('/') &&
    !value.startsWith('//') &&
    !value.includes('\\') &&
    !value.includes('#') &&
    Array.from(value).length <= MAX_PATH_CODE_POINTS &&
    !containsControlCodePoint(value)
  );
}

function decodeCursor(value: unknown): Readonly<WebCursor> | undefined {
  if (value === undefined) return undefined;
  if (
    typeof value !== 'string' ||
    Array.from(value).length > MAX_CURSOR_CODE_POINTS
  ) {
    return undefined;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(value) as unknown;
  } catch {
    return undefined;
  }
  if (
    !isRecord(parsed) ||
    !exactKeys(parsed, ['pages', 'version']) ||
    parsed.version !== 1 ||
    !Array.isArray(parsed.pages) ||
    parsed.pages.length < 1 ||
    parsed.pages.length > WEB_MAX_PAGES_PER_CHECK
  ) {
    return undefined;
  }
  const pages: WebCursorPage[] = [];
  const keys = new Set<string>();
  for (const value of parsed.pages) {
    if (
      !isRecord(value) ||
      !exactOptionalKeys(value, ['etag', 'key', 'lastModified', 'token']) ||
      typeof value.key !== 'string' ||
      !KEY.test(value.key) ||
      typeof value.token !== 'string' ||
      !TOKEN.test(value.token) ||
      !optionalHeader(value.etag) ||
      !optionalHeader(value.lastModified) ||
      keys.has(value.key)
    ) {
      return undefined;
    }
    keys.add(value.key);
    pages.push(
      Object.freeze({
        key: value.key,
        token: value.token,
        ...(typeof value.etag === 'string' ? {etag: value.etag} : {}),
        ...(typeof value.lastModified === 'string'
          ? {lastModified: value.lastModified}
          : {}),
      }),
    );
  }
  return Object.freeze({version: 1, pages: Object.freeze(pages)});
}

function encodeCursor(cursor: Readonly<WebCursor>): string {
  let encoded = JSON.stringify(cursor);
  if (Array.from(encoded).length <= MAX_CURSOR_CODE_POINTS) return encoded;
  encoded = JSON.stringify({
    version: 1,
    pages: cursor.pages.map(({key, token}) => ({key, token})),
  });
  if (Array.from(encoded).length > MAX_CURSOR_CODE_POINTS) {
    throw new SourceConnectorError('connector_too_large');
  }
  return encoded;
}

async function readBoundedResponseBytes(
  response: Response,
): Promise<Uint8Array> {
  if (response.body === null) return new Uint8Array();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      total += next.value.byteLength;
      if (total > MAX_RESPONSE_BYTES) {
        try {
          await reader.cancel();
        } catch {
          // The bounded-size verdict does not depend on cancellation success.
        }
        throw new SourceConnectorError('connector_too_large');
      }
      chunks.push(Uint8Array.from(next.value));
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

async function defaultResolveAddresses(
  hostname: string,
): Promise<readonly string[]> {
  const literal = isIP(hostname);
  if (literal !== 0) return Object.freeze([hostname]);
  const records = await lookup(hostname, {all: true, verbatim: true});
  return Object.freeze(records.map((record) => record.address));
}

function isBlockedHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase().replace(/\.$/u, '');
  return (
    normalized === 'localhost' ||
    normalized.endsWith('.localhost') ||
    normalized.endsWith('.local') ||
    normalized.endsWith('.internal') ||
    normalized.endsWith('.home')
  );
}

function isBlockedAddress(address: string): boolean {
  const kind = isIP(address);
  if (kind === 4) return blockedIpv4(address);
  if (kind !== 6) return true;
  const normalized = address.toLowerCase();
  if (
    normalized === '::' ||
    normalized === '::1' ||
    normalized.startsWith('fc') ||
    normalized.startsWith('fd') ||
    normalized.startsWith('fe8') ||
    normalized.startsWith('fe9') ||
    normalized.startsWith('fea') ||
    normalized.startsWith('feb')
  ) {
    return true;
  }
  const mapped = /::ffff:(\d+\.\d+\.\d+\.\d+)$/u.exec(normalized)?.[1];
  return mapped === undefined ? false : blockedIpv4(mapped);
}

function blockedIpv4(address: string): boolean {
  const octets = address.split('.').map(Number);
  if (octets.length !== 4 || octets.some((value) => !Number.isInteger(value))) {
    return true;
  }
  const [a = 0, b = 0] = octets;
  return (
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

function boundedHeader<K extends 'etag' | 'lastModified'>(
  key: K,
  value: string | null | undefined,
): Partial<Record<K, string>> {
  return typeof value === 'string' && optionalHeader(value) && value !== ''
    ? ({[key]: value} as Partial<Record<K, string>>)
    : {};
}

function optionalHeader(value: unknown): boolean {
  return (
    value === undefined ||
    (typeof value === 'string' &&
      Array.from(value).length <= MAX_HEADER_CODE_POINTS &&
      !containsControlCodePoint(value))
  );
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

function exactKeys(
  value: Readonly<Record<string, unknown>>,
  expected: readonly string[],
): boolean {
  const keys = Object.keys(value);
  return (
    keys.length === expected.length &&
    keys.every((key) => expected.includes(key))
  );
}

function exactOptionalKeys(
  value: Readonly<Record<string, unknown>>,
  allowed: readonly string[],
): boolean {
  return Object.keys(value).every((key) => allowed.includes(key));
}

function digestText(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function digestBytes(value: Uint8Array): string {
  return createHash('sha256').update(value).digest('hex');
}

function digestBytesBase64Url(value: Uint8Array): string {
  return createHash('sha256').update(value).digest('base64url');
}
