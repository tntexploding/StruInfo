import {createHash} from 'node:crypto';

import {deriveUuidV5} from '../entries/index.js';
import {
  importMarkdownEvidence,
  type EvidenceRepositoryPort,
  type PublicationInput,
} from '../evidence/index.js';
import type {BlobStore} from '../../storage/blob_store.js';

const CANONICAL_UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;
const CONNECTOR_ID = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+){1,7}$/u;
const MAX_CURSOR_CODE_POINTS = 2_048;
const MAX_DOCUMENT_ID_CODE_POINTS = 500;
const MAX_DOCUMENT_VERSION_CODE_POINTS = 500;
const MAX_MEDIA_TYPE_CODE_POINTS = 120;

export const MAX_SOURCE_CONNECTOR_DOCUMENTS = 64;
export const MAX_SOURCE_CONNECTOR_DOCUMENT_BYTES = 1024 * 1024;

export type SourceConnectorErrorCode =
  | 'connector_duplicate'
  | 'connector_not_available'
  | 'connector_result_invalid'
  | 'connector_too_large'
  | 'connector_unavailable';

export class SourceConnectorError extends Error {
  public readonly code: SourceConnectorErrorCode;

  public constructor(code: SourceConnectorErrorCode) {
    super('The external source connector operation failed.');
    this.name = 'SourceConnectorError';
    this.code = code;
  }
}

/**
 * Connector-specific configuration remains external product data. The host
 * owns scheduling, privacy, import and cursor persistence; a connector only
 * turns its own closed configuration into bounded source documents.
 */
export interface SourceConnectorReadRequest {
  readonly subscriptionId: string;
  readonly configuration: unknown;
  readonly previousCursor?: string;
}

export type SourceConnectorOrigin = 'builtin' | 'plugin';
export type SourceConnectorConfigurationMode =
  'internal' | 'external_reference';

export interface SourceConnectorDescriptor {
  readonly displayName: string;
  readonly origin: SourceConnectorOrigin;
  readonly configurationMode: SourceConnectorConfigurationMode;
}

export interface SourceConnectorCapability extends SourceConnectorDescriptor {
  readonly connectorId: string;
}

export interface SourceConnectorDocument {
  readonly externalId: string;
  readonly version: string;
  readonly canonicalUri: string;
  readonly mediaType: string;
  readonly profile: 'commonmark-v1' | 'ruanyf-weekly-v1';
  /** UTF-8 Markdown projection consumed by the existing evidence pipeline. */
  readonly sourceUtf8: Uint8Array;
  /** Optional exact remote bytes, kept as the Snapshot raw Blob. */
  readonly rawSourceBytes?: Uint8Array;
  readonly publication?: Readonly<PublicationInput>;
}

export type SourceConnectorReadResult =
  | Readonly<{status: 'unchanged'; cursor: string}>
  | Readonly<{
      status: 'changed';
      cursor: string;
      documents: readonly Readonly<SourceConnectorDocument>[];
    }>;

export interface SourceConnectorPort {
  readonly connectorId: string;
  /**
   * Optional owner-facing metadata. Undescribed injected test adapters remain
   * callable, but only described adapters appear in capability discovery.
   */
  readonly descriptor?: Readonly<SourceConnectorDescriptor>;
  read(request: Readonly<SourceConnectorReadRequest>): Promise<unknown>;
}

/**
 * Runtime registry shared by built-in readers and optional installed plugin
 * adapters. No executable plugin payload or credential is stored here.
 */
export class SourceConnectorRegistry {
  readonly #connectors: ReadonlyMap<string, SourceConnectorPort>;
  readonly #capabilities: readonly Readonly<SourceConnectorCapability>[];

  public constructor(connectors: readonly SourceConnectorPort[]) {
    const byId = new Map<string, SourceConnectorPort>();
    const capabilities: SourceConnectorCapability[] = [];
    for (const connector of connectors) {
      if (!validConnectorId(connector.connectorId)) {
        throw new SourceConnectorError('connector_result_invalid');
      }
      if (byId.has(connector.connectorId)) {
        throw new SourceConnectorError('connector_duplicate');
      }
      byId.set(connector.connectorId, connector);
      if (connector.descriptor !== undefined) {
        const descriptor = decodeConnectorDescriptor(connector.descriptor);
        if (
          descriptor === undefined ||
          (descriptor.origin === 'plugin' &&
            !PLUGIN_CONNECTOR_ID.test(connector.connectorId)) ||
          (descriptor.origin === 'builtin' &&
            !BUILTIN_CONNECTOR_ID.test(connector.connectorId))
        ) {
          throw new SourceConnectorError('connector_result_invalid');
        }
        capabilities.push(
          Object.freeze({connectorId: connector.connectorId, ...descriptor}),
        );
      }
    }
    this.#connectors = byId;
    this.#capabilities = Object.freeze(
      capabilities.sort((left, right) =>
        left.connectorId.localeCompare(right.connectorId),
      ),
    );
  }

  public connectorIds(): readonly string[] {
    return Object.freeze([...this.#connectors.keys()].sort());
  }

  public capabilities(): readonly Readonly<SourceConnectorCapability>[] {
    return this.#capabilities;
  }

  public async read(
    connectorId: string,
    request: Readonly<SourceConnectorReadRequest>,
  ): Promise<Readonly<SourceConnectorReadResult>> {
    if (
      !validConnectorId(connectorId) ||
      !CANONICAL_UUID.test(request.subscriptionId) ||
      !optionalBoundedText(request.previousCursor, MAX_CURSOR_CODE_POINTS)
    ) {
      throw new SourceConnectorError('connector_result_invalid');
    }
    const connector = this.#connectors.get(connectorId);
    if (connector === undefined) {
      throw new SourceConnectorError('connector_not_available');
    }
    let result: unknown;
    try {
      result = await connector.read(request);
    } catch (error) {
      if (error instanceof SourceConnectorError) throw error;
      throw new SourceConnectorError('connector_unavailable');
    }
    return decodeConnectorResult(result);
  }
}

function decodeConnectorDescriptor(
  value: unknown,
): Readonly<SourceConnectorDescriptor> | undefined {
  if (
    !isRecord(value) ||
    !exactKeys(value, ['configurationMode', 'displayName', 'origin']) ||
    !boundedText(value.displayName, 80) ||
    (value.origin !== 'builtin' && value.origin !== 'plugin') ||
    (value.configurationMode !== 'internal' &&
      value.configurationMode !== 'external_reference') ||
    (value.origin === 'builtin' && value.configurationMode !== 'internal') ||
    (value.origin === 'plugin' &&
      value.configurationMode !== 'external_reference')
  ) {
    return undefined;
  }
  return Object.freeze({
    displayName: value.displayName,
    origin: value.origin,
    configurationMode: value.configurationMode,
  });
}

export interface SourceConnectorImportDependencies {
  readonly blobStore: BlobStore;
  readonly evidenceRepository: EvidenceRepositoryPort;
  readonly importEvidence?: typeof importMarkdownEvidence;
}

export interface SourceConnectorImportInput {
  readonly workspaceId: string;
  readonly subscriptionId: string;
  readonly connectorId: string;
  readonly sourceAlias: string;
  readonly isPrivate: boolean;
  readonly capturedAt: string;
  readonly result: Extract<SourceConnectorReadResult, {status: 'changed'}>;
}

export type SourceConnectorImportResult =
  | Readonly<{
      status: 'complete';
      documents: readonly Readonly<{
        externalId: string;
        resourceId: string;
        snapshotId: string;
        outcome: 'created' | 'existing';
      }>[];
    }>
  | Readonly<{
      status: 'failed';
      documentIndex: number;
      code:
        | 'validation_failed'
        | 'conflict'
        | 'persistence_failed'
        | 'connector_result_invalid';
    }>;

/**
 * Imports a validated changed batch one document at a time. Cursor advancement
 * remains the caller's responsibility and must happen only after `complete`.
 * A retry is safe because every document receives deterministic identities.
 */
export async function importSourceConnectorDocuments(
  dependencies: Readonly<SourceConnectorImportDependencies>,
  input: Readonly<SourceConnectorImportInput>,
): Promise<Readonly<SourceConnectorImportResult>> {
  if (
    !CANONICAL_UUID.test(input.workspaceId) ||
    !CANONICAL_UUID.test(input.subscriptionId) ||
    !validConnectorId(input.connectorId) ||
    !boundedText(input.sourceAlias, MAX_DOCUMENT_ID_CODE_POINTS) ||
    typeof input.isPrivate !== 'boolean' ||
    !validInstant(input.capturedAt)
  ) {
    return Object.freeze({
      status: 'failed' as const,
      documentIndex: 0,
      code: 'connector_result_invalid' as const,
    });
  }
  const importedDocuments: {
    externalId: string;
    resourceId: string;
    snapshotId: string;
    outcome: 'created' | 'existing';
  }[] = [];
  for (const [documentIndex, document] of input.result.documents.entries()) {
    const rawSourceBytes = document.rawSourceBytes ?? document.sourceUtf8;
    const projectionSha256 = digest(document.sourceUtf8);
    const rawSha256 = digest(rawSourceBytes);
    const documentIdentity = digestText(
      `${input.connectorId}\u0000${document.externalId}`,
    );
    const contentIdentity = digestText(`${rawSha256}\u0000${projectionSha256}`);
    const resourceId = deriveUuidV5(
      input.workspaceId,
      `struinfo:source-connector-resource:v1:${input.subscriptionId}:${documentIdentity}`,
    );
    const snapshotId = deriveUuidV5(
      resourceId,
      `struinfo:source-connector-snapshot:v1:${contentIdentity}`,
    );
    const imported = await (
      dependencies.importEvidence ?? importMarkdownEvidence
    )(
      {
        blobStore: dependencies.blobStore,
        evidenceRepository: dependencies.evidenceRepository,
      },
      Object.freeze({
        workspaceId: input.workspaceId,
        commandIdempotencyKey: `source-connector-import:${input.subscriptionId}:${contentIdentity}`,
        resource: Object.freeze({
          workspaceId: input.workspaceId,
          resourceId,
          resourceKind: 'remote_document' as const,
          sourceKey: sourceKey(
            input.sourceAlias,
            input.subscriptionId,
            document.externalId,
          ),
          canonicalUri: document.canonicalUri,
          ...(input.isPrivate ? {isPrivate: true as const} : {}),
        }),
        snapshot: Object.freeze({
          workspaceId: input.workspaceId,
          resourceId,
          snapshotId,
          capturedAt: input.capturedAt,
          mediaType: document.mediaType,
          ...(document.publication === undefined
            ? {}
            : {publication: document.publication}),
        }),
        gitObservations: Object.freeze([]),
        profile: document.profile,
        sourceUtf8: Uint8Array.from(document.sourceUtf8),
        rawSourceBytes: Uint8Array.from(rawSourceBytes),
        documentBaseUri: document.canonicalUri,
      }),
    );
    if (imported.status !== 'created' && imported.status !== 'existing') {
      return Object.freeze({
        status: 'failed' as const,
        documentIndex,
        code: imported.status,
      });
    }
    importedDocuments.push({
      externalId: document.externalId,
      resourceId,
      snapshotId,
      outcome: imported.status,
    });
  }
  return Object.freeze({
    status: 'complete' as const,
    documents: Object.freeze(
      importedDocuments.map((document) => Object.freeze(document)),
    ),
  });
}

function decodeConnectorResult(
  value: unknown,
): Readonly<SourceConnectorReadResult> {
  if (!isRecord(value) || !boundedText(value.cursor, MAX_CURSOR_CODE_POINTS)) {
    throw new SourceConnectorError('connector_result_invalid');
  }
  if (value.status === 'unchanged') {
    if (!exactKeys(value, ['cursor', 'status'])) {
      throw new SourceConnectorError('connector_result_invalid');
    }
    return Object.freeze({status: 'unchanged' as const, cursor: value.cursor});
  }
  if (
    value.status !== 'changed' ||
    !exactKeys(value, ['cursor', 'documents', 'status']) ||
    !Array.isArray(value.documents) ||
    value.documents.length < 1 ||
    value.documents.length > MAX_SOURCE_CONNECTOR_DOCUMENTS
  ) {
    throw new SourceConnectorError(
      Array.isArray(value.documents) &&
        value.documents.length > MAX_SOURCE_CONNECTOR_DOCUMENTS
        ? 'connector_too_large'
        : 'connector_result_invalid',
    );
  }
  const documents: SourceConnectorDocument[] = [];
  const identities = new Set<string>();
  for (const candidate of value.documents) {
    const document = decodeConnectorDocument(candidate);
    if (identities.has(document.externalId)) {
      throw new SourceConnectorError('connector_result_invalid');
    }
    identities.add(document.externalId);
    documents.push(document);
  }
  return Object.freeze({
    status: 'changed' as const,
    cursor: value.cursor,
    documents: Object.freeze(documents),
  });
}

function decodeConnectorDocument(
  value: unknown,
): Readonly<SourceConnectorDocument> {
  if (!isRecord(value)) {
    throw new SourceConnectorError('connector_result_invalid');
  }
  if (
    !exactOptionalKeys(value, [
      'canonicalUri',
      'externalId',
      'mediaType',
      'profile',
      'publication',
      'rawSourceBytes',
      'sourceUtf8',
      'version',
    ]) ||
    !boundedText(value.externalId, MAX_DOCUMENT_ID_CODE_POINTS) ||
    !boundedText(value.version, MAX_DOCUMENT_VERSION_CODE_POINTS) ||
    !validHttpsUri(value.canonicalUri) ||
    !boundedText(value.mediaType, MAX_MEDIA_TYPE_CODE_POINTS) ||
    (value.profile !== 'commonmark-v1' &&
      value.profile !== 'ruanyf-weekly-v1') ||
    !(value.sourceUtf8 instanceof Uint8Array) ||
    value.sourceUtf8.byteLength < 1 ||
    !validUtf8Text(value.sourceUtf8) ||
    (value.rawSourceBytes !== undefined &&
      (!(value.rawSourceBytes instanceof Uint8Array) ||
        value.rawSourceBytes.byteLength < 1))
  ) {
    throw new SourceConnectorError('connector_result_invalid');
  }
  if (
    value.sourceUtf8.byteLength > MAX_SOURCE_CONNECTOR_DOCUMENT_BYTES ||
    (value.rawSourceBytes instanceof Uint8Array &&
      value.rawSourceBytes.byteLength > MAX_SOURCE_CONNECTOR_DOCUMENT_BYTES)
  ) {
    throw new SourceConnectorError('connector_too_large');
  }
  const publication = decodePublication(value.publication);
  if (value.publication !== undefined && publication === undefined) {
    throw new SourceConnectorError('connector_result_invalid');
  }
  return Object.freeze({
    externalId: value.externalId,
    version: value.version,
    canonicalUri: value.canonicalUri,
    mediaType: value.mediaType,
    profile: value.profile,
    sourceUtf8: Uint8Array.from(value.sourceUtf8),
    ...(value.rawSourceBytes === undefined
      ? {}
      : {rawSourceBytes: Uint8Array.from(value.rawSourceBytes)}),
    ...(publication === undefined ? {} : {publication}),
  });
}

function decodePublication(
  value: unknown,
): Readonly<PublicationInput> | undefined {
  if (value === undefined) return undefined;
  if (
    !isRecord(value) ||
    !exactOptionalKeys(value, [
      'inferred',
      'instant',
      'precision',
      'sourceText',
      'sourceTimezone',
    ]) ||
    typeof value.inferred !== 'boolean' ||
    (value.instant !== undefined && !validInstant(value.instant)) ||
    (value.sourceText !== undefined && !boundedText(value.sourceText, 500)) ||
    (value.sourceTimezone !== undefined &&
      !boundedText(value.sourceTimezone, 120)) ||
    (value.precision !== undefined &&
      (typeof value.precision !== 'string' ||
        !['year', 'month', 'day', 'hour', 'minute', 'second'].includes(
          value.precision,
        )))
  ) {
    return undefined;
  }
  return Object.freeze({
    inferred: value.inferred,
    ...(typeof value.instant === 'string' ? {instant: value.instant} : {}),
    ...(typeof value.sourceText === 'string'
      ? {sourceText: value.sourceText}
      : {}),
    ...(typeof value.sourceTimezone === 'string'
      ? {sourceTimezone: value.sourceTimezone}
      : {}),
    ...(typeof value.precision === 'string'
      ? {
          precision: value.precision as NonNullable<
            PublicationInput['precision']
          >,
        }
      : {}),
  });
}

function validConnectorId(value: unknown): value is string {
  return typeof value === 'string' && CONNECTOR_ID.test(value);
}

const BUILTIN_CONNECTOR_ID = /^builtin(?:[._-][a-z0-9]+){1,7}$/u;
const PLUGIN_CONNECTOR_ID = /^plugin(?:[._-][a-z0-9]+){1,7}$/u;

function boundedText(value: unknown, maximum: number): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    Array.from(value).length <= maximum &&
    !containsControlCodePoint(value)
  );
}

function optionalBoundedText(value: unknown, maximum: number): boolean {
  return value === undefined || boundedText(value, maximum);
}

function validUtf8Text(value: Uint8Array): boolean {
  try {
    const text = new TextDecoder('utf-8', {fatal: true}).decode(value);
    return text.length > 0 && !text.includes('\u0000');
  } catch {
    return false;
  }
}

function validHttpsUri(value: unknown): value is string {
  if (typeof value !== 'string' || containsControlCodePoint(value))
    return false;
  try {
    const parsed = new URL(value);
    return (
      parsed.protocol === 'https:' &&
      parsed.username === '' &&
      parsed.password === '' &&
      parsed.hash === ''
    );
  } catch {
    return false;
  }
}

function validInstant(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    Number.isFinite(Date.parse(value))
  );
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function containsControlCodePoint(value: string): boolean {
  return Array.from(value).some((character) => {
    const codePoint = character.codePointAt(0);
    return codePoint !== undefined && (codePoint <= 0x1f || codePoint === 0x7f);
  });
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

function digest(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function digestText(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function sourceKey(
  alias: string,
  subscriptionId: string,
  externalId: string,
): string {
  const safeAlias = alias
    .trim()
    .normalize('NFC')
    .replace(/[\\/]/gu, '／')
    .slice(0, 300);
  const identity = digestText(`${subscriptionId}\u0000${externalId}`).slice(
    0,
    24,
  );
  return `${safeAlias}#${identity}`;
}
