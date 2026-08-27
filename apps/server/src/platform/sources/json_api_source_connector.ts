import {createHash} from 'node:crypto';
import {isIP} from 'node:net';
import {lookup} from 'node:dns/promises';

import {
  SourceConnectorError,
  type SourceConnectorDocument,
  type SourceConnectorPort,
  type SourceConnectorReadRequest,
  type SourceConnectorReadResult,
} from '../../modules/subscriptions/index.js';

export const JSON_API_SOURCE_CONNECTOR_ID = 'builtin.json-api.v1';
export const JSON_API_MAX_RECORDS_PER_CHECK = 32;
export const JSON_API_MAX_PAGES_PER_CHECK = 5;

const MAX_RESPONSE_BYTES = 1024 * 1024;
const MAX_ENDPOINT_CODE_POINTS = 2_000;
const MAX_CURSOR_VALUE_CODE_POINTS = 300;
const MAX_SECRET_CODE_POINTS = 8_192;
const REQUEST_TIMEOUT_MS = 20_000;
const PATH =
  /^(?:[A-Za-z_][A-Za-z0-9_-]{0,99})(?:\.(?:[A-Za-z_][A-Za-z0-9_-]{0,99})){0,7}$/u;
const QUERY_PARAMETER = /^[A-Za-z_][A-Za-z0-9_.-]{0,79}$/u;
const ENVIRONMENT_VARIABLE = /^[A-Z_][A-Z0-9_]{0,99}$/u;
const TOKEN = /^[A-Za-z0-9_-]{16}$/u;
const JSON_CONTENT_TYPE = /^application\/(?:[A-Za-z0-9!#$&^_.+-]+\+)?json$/u;

export interface JsonApiCursorMapping {
  readonly queryParameter: string;
  readonly responsePath: string;
}

export type JsonApiAuthentication =
  Readonly<{kind: 'none'}> | Readonly<{kind: 'bearer_env'; variable: string}>;

export interface JsonApiSourceConnectorConfiguration {
  readonly endpointUrl: string;
  readonly recordsPath: string;
  readonly externalIdPath: string;
  readonly titlePath: string;
  readonly bodyPath: string;
  readonly canonicalUriPath?: string;
  readonly publishedAtPath?: string;
  readonly versionPath?: string;
  readonly recordLimit: number;
  readonly pageCursor?: Readonly<JsonApiCursorMapping>;
  readonly incrementalCursor?: Readonly<JsonApiCursorMapping>;
  readonly authentication: Readonly<JsonApiAuthentication>;
}

interface JsonApiCursor {
  readonly version: 1;
  readonly itemTokens: readonly string[];
  readonly checkpoint?: string;
}

interface ProjectedRecord {
  readonly token: string;
  readonly document: Readonly<SourceConnectorDocument>;
}

export interface JsonApiSourceConnectorDependencies {
  readonly fetch?: typeof fetch;
  readonly resolveAddresses?: (hostname: string) => Promise<readonly string[]>;
  readonly readEnvironment?: (variable: string) => string | undefined;
}

/**
 * A deliberately small declarative JSON reader. It owns no product state and
 * executes no user script: every mapping is a bounded property path.
 */
export class JsonApiSourceConnector implements SourceConnectorPort {
  public readonly connectorId = JSON_API_SOURCE_CONNECTOR_ID;
  public readonly descriptor = Object.freeze({
    displayName: 'JSON API',
    origin: 'builtin' as const,
    configurationMode: 'internal' as const,
  });
  readonly #fetch: typeof fetch;
  readonly #resolveAddresses: (hostname: string) => Promise<readonly string[]>;
  readonly #readEnvironment: (variable: string) => string | undefined;

  public constructor(
    dependencies: Readonly<JsonApiSourceConnectorDependencies> = {},
  ) {
    this.#fetch = dependencies.fetch ?? globalThis.fetch;
    this.#resolveAddresses =
      dependencies.resolveAddresses ?? defaultResolveAddresses;
    this.#readEnvironment =
      dependencies.readEnvironment ?? ((variable) => process.env[variable]);
  }

  public async read(
    request: Readonly<SourceConnectorReadRequest>,
  ): Promise<Readonly<SourceConnectorReadResult>> {
    const configuration = decodeConfiguration(request.configuration);
    const previousCursor = decodeCursor(request.previousCursor);
    if (
      configuration === undefined ||
      (request.previousCursor !== undefined && previousCursor === undefined)
    ) {
      throw new SourceConnectorError('connector_result_invalid');
    }
    const endpoint = decodePublicJsonApiUrl(configuration.endpointUrl);
    if (endpoint === undefined) {
      throw new SourceConnectorError('connector_result_invalid');
    }
    await this.#admitPublicHost(endpoint.hostname);
    const headers = this.#requestHeaders(configuration.authentication);
    const projected: ProjectedRecord[] = [];
    const externalIds = new Set<string>();
    const pageCursors = new Set<string>();
    let nextPageCursor: string | undefined;
    let checkpoint = previousCursor?.checkpoint;
    let pagesRead = 0;

    do {
      pagesRead += 1;
      const requestUrl = new URL(endpoint);
      if (
        configuration.incrementalCursor !== undefined &&
        previousCursor?.checkpoint !== undefined
      ) {
        requestUrl.searchParams.set(
          configuration.incrementalCursor.queryParameter,
          previousCursor.checkpoint,
        );
      }
      if (
        configuration.pageCursor !== undefined &&
        nextPageCursor !== undefined
      ) {
        requestUrl.searchParams.set(
          configuration.pageCursor.queryParameter,
          nextPageCursor,
        );
      }
      const page = await this.#readPage(requestUrl, headers);
      const root = parseJson(page.bytes);
      const records = readPath(root, configuration.recordsPath);
      if (!Array.isArray(records)) {
        throw new SourceConnectorError('connector_result_invalid');
      }
      if (projected.length + records.length > configuration.recordLimit) {
        throw new SourceConnectorError('connector_too_large');
      }
      for (const record of records as readonly unknown[]) {
        const candidate = projectRecord(
          record,
          configuration,
          endpoint,
          page.bytes,
          page.mediaType,
        );
        if (externalIds.has(candidate.document.externalId)) {
          throw new SourceConnectorError('connector_result_invalid');
        }
        externalIds.add(candidate.document.externalId);
        projected.push(candidate);
      }
      if (configuration.incrementalCursor !== undefined) {
        const value = optionalCursorValue(
          readPath(root, configuration.incrementalCursor.responsePath),
        );
        if (value !== undefined) checkpoint = value;
      }
      nextPageCursor =
        configuration.pageCursor === undefined
          ? undefined
          : optionalCursorValue(
              readPath(root, configuration.pageCursor.responsePath),
            );
      if (nextPageCursor !== undefined) {
        if (
          pageCursors.has(nextPageCursor) ||
          pagesRead >= JSON_API_MAX_PAGES_PER_CHECK ||
          projected.length >= configuration.recordLimit
        ) {
          throw new SourceConnectorError('connector_too_large');
        }
        pageCursors.add(nextPageCursor);
      }
    } while (nextPageCursor !== undefined);

    const cursor = encodeCursor({
      version: 1,
      itemTokens:
        projected.length === 0 && previousCursor !== undefined
          ? previousCursor.itemTokens
          : Object.freeze(projected.map((record) => record.token)),
      ...(checkpoint === undefined ? {} : {checkpoint}),
    });
    const previousTokens = new Set(previousCursor?.itemTokens ?? []);
    const changed = projected.filter(
      (record) => !previousTokens.has(record.token),
    );
    return changed.length === 0
      ? Object.freeze({status: 'unchanged' as const, cursor})
      : Object.freeze({
          status: 'changed' as const,
          cursor,
          documents: Object.freeze(changed.map((record) => record.document)),
        });
  }

  #requestHeaders(authentication: Readonly<JsonApiAuthentication>): Headers {
    const headers = new Headers({
      accept: 'application/json',
      'user-agent': 'StruInfo/1.0 (+local-source-subscription)',
    });
    if (authentication.kind === 'bearer_env') {
      const token = this.#readEnvironment(authentication.variable);
      if (!validSecret(token)) {
        throw new SourceConnectorError('connector_unavailable');
      }
      headers.set('authorization', `Bearer ${token}`);
    }
    return headers;
  }

  async #readPage(
    requestUrl: URL,
    headers: Headers,
  ): Promise<Readonly<{bytes: Uint8Array; mediaType: string}>> {
    let response: Response;
    try {
      response = await this.#fetch(requestUrl, {
        method: 'GET',
        headers,
        redirect: 'manual',
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch {
      throw new SourceConnectorError('connector_unavailable');
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
    if (mediaType === undefined || !JSON_CONTENT_TYPE.test(mediaType)) {
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
    return Object.freeze({bytes, mediaType});
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

export function decodePublicJsonApiUrl(value: unknown): URL | undefined {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    Array.from(value).length > MAX_ENDPOINT_CODE_POINTS ||
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
): Readonly<JsonApiSourceConnectorConfiguration> | undefined {
  if (
    !isRecord(value) ||
    !exactOptionalKeys(value, [
      'authentication',
      'bodyPath',
      'canonicalUriPath',
      'endpointUrl',
      'externalIdPath',
      'incrementalCursor',
      'pageCursor',
      'publishedAtPath',
      'recordLimit',
      'recordsPath',
      'titlePath',
      'versionPath',
    ]) ||
    typeof value.endpointUrl !== 'string' ||
    typeof value.recordsPath !== 'string' ||
    !validPath(value.recordsPath, true) ||
    typeof value.externalIdPath !== 'string' ||
    !validPath(value.externalIdPath, false) ||
    typeof value.titlePath !== 'string' ||
    !validPath(value.titlePath, false) ||
    typeof value.bodyPath !== 'string' ||
    !validPath(value.bodyPath, false) ||
    !optionalPath(value.canonicalUriPath) ||
    !optionalPath(value.publishedAtPath) ||
    !optionalPath(value.versionPath) ||
    !Number.isSafeInteger(value.recordLimit) ||
    (value.recordLimit as number) < 1 ||
    (value.recordLimit as number) > JSON_API_MAX_RECORDS_PER_CHECK
  ) {
    return undefined;
  }
  const endpoint = decodePublicJsonApiUrl(value.endpointUrl);
  const pageCursor = decodeCursorMapping(value.pageCursor);
  const incrementalCursor = decodeCursorMapping(value.incrementalCursor);
  const authentication = decodeAuthentication(value.authentication);
  if (
    endpoint === undefined ||
    (value.pageCursor !== undefined && pageCursor === undefined) ||
    (value.incrementalCursor !== undefined &&
      incrementalCursor === undefined) ||
    (pageCursor !== undefined &&
      incrementalCursor?.queryParameter === pageCursor.queryParameter) ||
    authentication === undefined
  ) {
    return undefined;
  }
  for (const mapping of [pageCursor, incrementalCursor]) {
    if (
      mapping !== undefined &&
      endpoint.searchParams.has(mapping.queryParameter)
    ) {
      return undefined;
    }
  }
  return Object.freeze({
    endpointUrl: endpoint.toString(),
    recordsPath: value.recordsPath,
    externalIdPath: value.externalIdPath,
    titlePath: value.titlePath,
    bodyPath: value.bodyPath,
    ...(typeof value.canonicalUriPath === 'string'
      ? {canonicalUriPath: value.canonicalUriPath}
      : {}),
    ...(typeof value.publishedAtPath === 'string'
      ? {publishedAtPath: value.publishedAtPath}
      : {}),
    ...(typeof value.versionPath === 'string'
      ? {versionPath: value.versionPath}
      : {}),
    recordLimit: value.recordLimit as number,
    ...(pageCursor === undefined ? {} : {pageCursor}),
    ...(incrementalCursor === undefined ? {} : {incrementalCursor}),
    authentication,
  });
}

function decodeCursorMapping(
  value: unknown,
): Readonly<JsonApiCursorMapping> | undefined {
  if (value === undefined) return undefined;
  return isRecord(value) &&
    exactKeys(value, ['queryParameter', 'responsePath']) &&
    typeof value.queryParameter === 'string' &&
    QUERY_PARAMETER.test(value.queryParameter) &&
    typeof value.responsePath === 'string' &&
    validPath(value.responsePath, false)
    ? Object.freeze({
        queryParameter: value.queryParameter,
        responsePath: value.responsePath,
      })
    : undefined;
}

function decodeAuthentication(
  value: unknown,
): Readonly<JsonApiAuthentication> | undefined {
  if (!isRecord(value)) return undefined;
  if (value.kind === 'none' && exactKeys(value, ['kind'])) {
    return Object.freeze({kind: 'none' as const});
  }
  return value.kind === 'bearer_env' &&
    exactKeys(value, ['kind', 'variable']) &&
    typeof value.variable === 'string' &&
    ENVIRONMENT_VARIABLE.test(value.variable)
    ? Object.freeze({kind: 'bearer_env' as const, variable: value.variable})
    : undefined;
}

function projectRecord(
  value: unknown,
  configuration: Readonly<JsonApiSourceConnectorConfiguration>,
  endpoint: URL,
  rawResponseBytes: Uint8Array,
  mediaType: string,
): Readonly<ProjectedRecord> {
  if (!isRecord(value)) {
    throw new SourceConnectorError('connector_result_invalid');
  }
  const externalIdValue = scalarText(
    readPath(value, configuration.externalIdPath),
  );
  const titleValue = scalarText(readPath(value, configuration.titlePath));
  const bodyValue = scalarText(readPath(value, configuration.bodyPath));
  if (
    externalIdValue === undefined ||
    titleValue === undefined ||
    bodyValue === undefined
  ) {
    throw new SourceConnectorError('connector_result_invalid');
  }
  const externalId = boundedIdentity(externalIdValue);
  const title = normalizedTitle(titleValue);
  const body = normalizedBody(bodyValue);
  if (externalId === undefined || title === undefined || body === undefined) {
    throw new SourceConnectorError('connector_result_invalid');
  }
  const canonicalUri = recordUri(
    configuration.canonicalUriPath === undefined
      ? undefined
      : readPath(value, configuration.canonicalUriPath),
    endpoint,
  );
  const publication =
    configuration.publishedAtPath === undefined
      ? undefined
      : publicationFrom(readPath(value, configuration.publishedAtPath));
  if (
    configuration.publishedAtPath !== undefined &&
    readPath(value, configuration.publishedAtPath) !== undefined &&
    publication === undefined
  ) {
    throw new SourceConnectorError('connector_result_invalid');
  }
  const mappedVersion =
    configuration.versionPath === undefined
      ? undefined
      : scalarText(readPath(value, configuration.versionPath));
  if (configuration.versionPath !== undefined && mappedVersion === undefined) {
    throw new SourceConnectorError('connector_result_invalid');
  }
  const version = digestText(
    JSON.stringify([
      externalId,
      title,
      body,
      canonicalUri,
      publication?.instant ?? null,
      mappedVersion ?? stableJson(value),
    ]),
  );
  const token = createHash('sha256')
    .update(`${externalId}\u0000${version}`, 'utf8')
    .digest()
    .subarray(0, 12)
    .toString('base64url');
  const source = [
    `# ${escapeMarkdownHeading(title)}`,
    body,
    `[查看原始记录](${escapeMarkdownDestination(canonicalUri)})`,
  ]
    .filter((part) => part.trim() !== '')
    .join('\n\n');
  return Object.freeze({
    token,
    document: Object.freeze({
      externalId,
      version,
      canonicalUri,
      mediaType,
      profile: 'commonmark-v1' as const,
      sourceUtf8: new TextEncoder().encode(`${source.trim()}\n`),
      rawSourceBytes: Uint8Array.from(rawResponseBytes),
      ...(publication === undefined ? {} : {publication}),
    }),
  });
}

function readPath(value: unknown, path: string): unknown {
  if (path === '') return value;
  let current = value;
  for (const segment of path.split('.')) {
    if (!isRecord(current) || !Object.hasOwn(current, segment)) {
      return undefined;
    }
    current = current[segment];
  }
  return current;
}

function scalarText(value: unknown): string | undefined {
  return typeof value === 'string' ||
    typeof value === 'boolean' ||
    (typeof value === 'number' && Number.isFinite(value))
    ? String(value)
    : undefined;
}

function optionalCursorValue(value: unknown): string | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  const text = scalarText(value);
  if (
    text === undefined ||
    Array.from(text).length > MAX_CURSOR_VALUE_CODE_POINTS ||
    containsControlCodePoint(text)
  ) {
    throw new SourceConnectorError('connector_result_invalid');
  }
  return text;
}

function publicationFrom(value: unknown) {
  if (value === undefined || value === null || value === '') return undefined;
  const text = scalarText(value);
  if (text === undefined) return undefined;
  const instant = new Date(text);
  return Number.isNaN(instant.valueOf())
    ? undefined
    : Object.freeze({
        inferred: false,
        instant: instant.toISOString(),
        precision: 'second' as const,
      });
}

function recordUri(value: unknown, endpoint: URL): string {
  if (value === undefined || value === null || value === '') {
    return endpoint.toString();
  }
  const text = scalarText(value);
  if (text === undefined || containsControlCodePoint(text)) {
    throw new SourceConnectorError('connector_result_invalid');
  }
  let parsed: URL;
  try {
    parsed = new URL(text, endpoint);
  } catch {
    throw new SourceConnectorError('connector_result_invalid');
  }
  parsed.hash = '';
  if (
    parsed.protocol !== 'https:' ||
    parsed.username !== '' ||
    parsed.password !== ''
  ) {
    throw new SourceConnectorError('connector_result_invalid');
  }
  return parsed.toString();
}

function boundedIdentity(value: string): string | undefined {
  const normalized = value.trim().normalize('NFC');
  if (normalized === '' || containsControlCodePoint(normalized)) {
    return undefined;
  }
  return Array.from(normalized).length <= 500
    ? normalized
    : `sha256:${digestText(normalized)}`;
}

function normalizedTitle(value: string): string | undefined {
  const normalized = value
    .normalize('NFC')
    .replace(/[\t\n\f\r ]+/gu, ' ')
    .trim();
  return normalized !== '' &&
    Array.from(normalized).length <= 500 &&
    !containsControlCodePoint(normalized)
    ? normalized
    : undefined;
}

function normalizedBody(value: string): string | undefined {
  const normalized = value.normalize('NFC').trim();
  return normalized.includes('\u0000') ? undefined : normalized;
}

function stableJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map((candidate) => stableJson(candidate)).join(',')}]`;
  }
  const record = value as Readonly<Record<string, unknown>>;
  return `{${Object.keys(record)
    .sort(compareUtf8)
    .map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`)
    .join(',')}}`;
}

function compareUtf8(left: string, right: string): number {
  return Buffer.compare(Buffer.from(left, 'utf8'), Buffer.from(right, 'utf8'));
}

function encodeCursor(value: Readonly<JsonApiCursor>): string {
  const encoded = Buffer.from(JSON.stringify(value), 'utf8').toString(
    'base64url',
  );
  if (Array.from(encoded).length > 2_048) {
    throw new SourceConnectorError('connector_too_large');
  }
  return encoded;
}

function decodeCursor(value: string | undefined): JsonApiCursor | undefined {
  if (value === undefined) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(
      Buffer.from(value, 'base64url').toString('utf8'),
    ) as unknown;
  } catch {
    return undefined;
  }
  if (
    !isRecord(parsed) ||
    !exactOptionalKeys(parsed, ['checkpoint', 'itemTokens', 'version']) ||
    parsed.version !== 1 ||
    !Array.isArray(parsed.itemTokens) ||
    parsed.itemTokens.length > JSON_API_MAX_RECORDS_PER_CHECK ||
    parsed.itemTokens.some(
      (token) => typeof token !== 'string' || !TOKEN.test(token),
    ) ||
    (parsed.checkpoint !== undefined &&
      (typeof parsed.checkpoint !== 'string' ||
        parsed.checkpoint.length === 0 ||
        Array.from(parsed.checkpoint).length > MAX_CURSOR_VALUE_CODE_POINTS ||
        containsControlCodePoint(parsed.checkpoint)))
  ) {
    return undefined;
  }
  return Object.freeze({
    version: 1 as const,
    itemTokens: Object.freeze([...(parsed.itemTokens as string[])]),
    ...(typeof parsed.checkpoint === 'string'
      ? {checkpoint: parsed.checkpoint}
      : {}),
  });
}

function parseJson(bytes: Uint8Array): unknown {
  try {
    const text = new TextDecoder('utf-8', {fatal: true}).decode(bytes);
    if (text.includes('\u0000')) {
      throw new SourceConnectorError('connector_result_invalid');
    }
    return JSON.parse(text) as unknown;
  } catch (error) {
    if (error instanceof SourceConnectorError) throw error;
    throw new SourceConnectorError('connector_result_invalid');
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
      if (totalBytes > MAX_RESPONSE_BYTES) {
        try {
          await reader.cancel();
        } catch {
          // The size verdict remains stable when cancellation itself fails.
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

function validPath(value: string, allowEmpty: boolean): boolean {
  return (allowEmpty && value === '') || PATH.test(value);
}

function optionalPath(value: unknown): boolean {
  return value === undefined || (typeof value === 'string' && PATH.test(value));
}

function validSecret(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    Array.from(value).length <= MAX_SECRET_CODE_POINTS &&
    !value.includes('\u0000') &&
    !value.includes('\r') &&
    !value.includes('\n')
  );
}

function containsControlCodePoint(value: string): boolean {
  return Array.from(value).some((character) => {
    const codePoint = character.codePointAt(0);
    return codePoint !== undefined && (codePoint <= 0x1f || codePoint === 0x7f);
  });
}

function escapeMarkdownHeading(value: string): string {
  return value.replace(/[\\`*_[\]<>#]/gu, '\\$&');
}

function escapeMarkdownDestination(value: string): string {
  return value.replace(/\s/gu, '%20').replace(/\)/gu, '%29');
}

function digestText(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
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

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
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
