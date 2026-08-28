import {types as utilityTypes} from 'node:util';

import {
  BLOB_DIGEST_ALGORITHM,
  type BlobIdentity,
} from '../storage/blob_store.js';
import {
  CanonicalJsonError,
  decodeCanonicalJson,
  encodeCanonicalJson,
  type JsonObject,
  type JsonValue,
  normalizeJsonValue,
} from '../serialization/canonical_json.js';

export const WORKSPACE_BUNDLE_FORMAT = 'struinfo.workspace-bundle';
export const WORKSPACE_BUNDLE_VERSION = 1;
export const DEFAULT_MAXIMUM_WORKSPACE_BUNDLE_BYTES = 256 * 1024 * 1024;
export const DEFAULT_MAXIMUM_WORKSPACE_BUNDLE_VALUES = 1_000_000;

const IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;
const SHA256_DIGEST_PATTERN = /^[a-f0-9]{64}$/u;
const SECRET_PROPERTY_NAMES = new Set([
  'accesstoken',
  'apikey',
  'authorization',
  'clientsecret',
  'cookie',
  'credential',
  'credentials',
  'credentialvalue',
  'databaseurl',
  'password',
  'privatekey',
  'refreshtoken',
  'secret',
  'secretvalue',
]);
const SECRET_QUERY_PARAMETER_NAMES = new Set([
  'access_token',
  'api_key',
  'apikey',
  'auth',
  'key',
  'password',
  'sig',
  'signature',
  'token',
]);
const SECRET_PROPERTY_SUFFIXES = [
  'accesstoken',
  'apikey',
  'authorization',
  'clientsecret',
  'cookie',
  'credential',
  'credentials',
  'credentialvalue',
  'databaseurl',
  'password',
  'privatekey',
  'refreshtoken',
  'secret',
  'secrets',
  'secretvalue',
] as const;

export type WorkspaceBundleErrorCode =
  | 'input_invalid'
  | 'bundle_too_large'
  | 'encoding_invalid'
  | 'format_unsupported'
  | 'schema_invalid'
  | 'secret_material_forbidden'
  | 'section_unsupported';

export class WorkspaceBundleError extends Error {
  public readonly code: WorkspaceBundleErrorCode;

  public constructor(code: WorkspaceBundleErrorCode, message: string) {
    super(message);
    this.name = 'WorkspaceBundleError';
    this.code = code;
  }
}

export interface WorkspaceBundleSectionCodec {
  readonly type: string;
  readonly version: number;
  encode(value: unknown): unknown;
  decode(payload: JsonValue): unknown;
}

export interface WorkspaceBundleSectionInput {
  readonly type: string;
  readonly version: number;
  readonly value: unknown;
}

export interface WorkspaceBundleWriteRequest {
  readonly workspaceId: string;
  readonly exportedAt: string;
  readonly sections: readonly WorkspaceBundleSectionInput[];
  readonly blobReferences: readonly Readonly<BlobIdentity>[];
}

export interface ImportedWorkspaceBundleSection {
  readonly type: string;
  readonly version: number;
  readonly value: unknown;
}

export interface ImportedWorkspaceBundle {
  readonly workspaceId: string;
  readonly exportedAt: string;
  readonly secretHandling: 'excluded';
  readonly sections: readonly Readonly<ImportedWorkspaceBundleSection>[];
  readonly blobReferences: readonly Readonly<BlobIdentity>[];
}

export interface WorkspaceBundleOptions {
  readonly maximumBytes?: number;
  readonly maximumValues?: number;
}

export function writeWorkspaceBundle(
  request: Readonly<WorkspaceBundleWriteRequest>,
  codecs: readonly Readonly<WorkspaceBundleSectionCodec>[],
  options: Readonly<WorkspaceBundleOptions> = {},
): Uint8Array {
  if (utilityTypes.isProxy(request) || utilityTypes.isProxy(options)) {
    throw schemaInvalid();
  }
  const maximumBytes = parseMaximumBytes(options.maximumBytes);
  const maximumValues = parseMaximumValues(options.maximumValues);
  validateWorkspaceId(request.workspaceId);
  validateTimestamp(request.exportedAt);
  const registry = createCodecRegistry(codecs);
  const sections = normalizeSectionsForWrite(
    request.sections,
    registry,
    maximumValues,
  );
  const blobReferences = normalizeBlobReferences(request.blobReferences);
  const envelope = normalizeJsonValue(
    {
      blobReferences,
      exportedAt: request.exportedAt,
      format: WORKSPACE_BUNDLE_FORMAT,
      secretHandling: 'excluded',
      sections,
      version: WORKSPACE_BUNDLE_VERSION,
      workspaceId: request.workspaceId,
    },
    {maximumValues},
  );
  assertNoSecretMaterial(envelope);
  try {
    return encodeCanonicalJson(envelope, maximumBytes, {maximumValues});
  } catch (error) {
    throw mapCanonicalJsonError(error);
  }
}

export function readWorkspaceBundle(
  input: Uint8Array,
  codecs: readonly Readonly<WorkspaceBundleSectionCodec>[],
  options: Readonly<WorkspaceBundleOptions> = {},
): Readonly<ImportedWorkspaceBundle> {
  const maximumBytes = parseMaximumBytes(options.maximumBytes);
  const maximumValues = parseMaximumValues(options.maximumValues);
  let decoded: JsonValue;
  try {
    decoded = decodeCanonicalJson(input, maximumBytes, {maximumValues});
  } catch (error) {
    throw mapCanonicalJsonError(error);
  }
  assertNoSecretMaterial(decoded);
  const envelope = requireClosedObject(decoded, [
    'blobReferences',
    'exportedAt',
    'format',
    'secretHandling',
    'sections',
    'version',
    'workspaceId',
  ]);
  if (
    envelope.format !== WORKSPACE_BUNDLE_FORMAT ||
    envelope.version !== WORKSPACE_BUNDLE_VERSION
  ) {
    throw new WorkspaceBundleError(
      'format_unsupported',
      'The workspace bundle format or version is not supported.',
    );
  }
  if (envelope.secretHandling !== 'excluded') {
    throw schemaInvalid();
  }
  const workspaceId = requireString(envelope.workspaceId);
  const exportedAt = requireString(envelope.exportedAt);
  validateWorkspaceId(workspaceId);
  validateTimestamp(exportedAt);
  const registry = createCodecRegistry(codecs);
  const sections = decodeSections(envelope.sections, registry);
  const blobReferences = decodeBlobReferences(envelope.blobReferences);
  return Object.freeze({
    workspaceId,
    exportedAt,
    secretHandling: 'excluded' as const,
    sections,
    blobReferences,
  });
}

function normalizeSectionsForWrite(
  sections: readonly WorkspaceBundleSectionInput[],
  registry: ReadonlyMap<string, Readonly<WorkspaceBundleSectionCodec>>,
  maximumValues: number,
): readonly JsonValue[] {
  if (!isReadonlyArray(sections)) {
    throw schemaInvalid();
  }
  const normalized = sections.map((section) => {
    if (utilityTypes.isProxy(section)) {
      throw schemaInvalid();
    }
    const key = codecKey(section.type, section.version);
    const codec = registry.get(key);
    if (codec === undefined) {
      throw unsupportedSection();
    }
    let payload: JsonValue;
    try {
      payload = normalizeJsonValue(codec.encode(section.value), {
        maximumValues,
      });
    } catch (error) {
      if (error instanceof WorkspaceBundleError) {
        throw error;
      }
      throw schemaInvalid();
    }
    assertNoSecretMaterial(payload);
    return Object.freeze({
      payload,
      type: codec.type,
      version: codec.version,
    });
  });
  normalized.sort(compareSections);
  assertUniqueSectionKeys(normalized);
  return Object.freeze(normalized);
}

function decodeSections(
  value: JsonValue | undefined,
  registry: ReadonlyMap<string, Readonly<WorkspaceBundleSectionCodec>>,
): readonly Readonly<ImportedWorkspaceBundleSection>[] {
  if (!isReadonlyArray(value)) {
    throw schemaInvalid();
  }
  const sections = value.map((candidate) => {
    const section = requireClosedObject(candidate, [
      'payload',
      'type',
      'version',
    ]);
    const type = requireString(section.type);
    const version = requirePositiveSafeInteger(section.version);
    const codec = registry.get(codecKey(type, version));
    if (codec === undefined || section.payload === undefined) {
      throw unsupportedSection();
    }
    let decoded: unknown;
    try {
      decoded = codec.decode(section.payload);
    } catch {
      throw schemaInvalid();
    }
    return Object.freeze({type, version, value: decoded});
  });
  assertSortedUniqueSections(sections);
  return Object.freeze(sections);
}

function normalizeBlobReferences(
  references: readonly Readonly<BlobIdentity>[],
): readonly JsonValue[] {
  if (!isReadonlyArray(references)) {
    throw schemaInvalid();
  }
  const normalized = references.map((reference) => {
    if (utilityTypes.isProxy(reference)) {
      throw schemaInvalid();
    }
    validateBlobReference(reference);
    return Object.freeze({
      algorithm: BLOB_DIGEST_ALGORITHM,
      byteLength: reference.byteLength,
      digest: reference.digest,
    });
  });
  normalized.sort((left, right) => left.digest.localeCompare(right.digest));
  for (let index = 1; index < normalized.length; index += 1) {
    if (normalized[index - 1]?.digest === normalized[index]?.digest) {
      throw schemaInvalid();
    }
  }
  return Object.freeze(normalized);
}

function decodeBlobReferences(
  value: JsonValue | undefined,
): readonly Readonly<BlobIdentity>[] {
  if (!isReadonlyArray(value)) {
    throw schemaInvalid();
  }
  const references = value.map((candidate) => {
    const record = requireClosedObject(candidate, [
      'algorithm',
      'byteLength',
      'digest',
    ]);
    const reference: BlobIdentity = {
      algorithm: requireString(
        record.algorithm,
      ) as typeof BLOB_DIGEST_ALGORITHM,
      byteLength: requireNonNegativeSafeInteger(record.byteLength),
      digest: requireString(record.digest),
    };
    validateBlobReference(reference);
    return Object.freeze(reference);
  });
  for (let index = 1; index < references.length; index += 1) {
    const previous = references[index - 1];
    const current = references[index];
    if (
      previous === undefined ||
      current === undefined ||
      previous.digest.localeCompare(current.digest) >= 0
    ) {
      throw schemaInvalid();
    }
  }
  return Object.freeze(references);
}

function createCodecRegistry(
  codecs: readonly Readonly<WorkspaceBundleSectionCodec>[],
): ReadonlyMap<string, Readonly<WorkspaceBundleSectionCodec>> {
  if (!isReadonlyArray(codecs)) {
    throw schemaInvalid();
  }
  const registry = new Map<string, Readonly<WorkspaceBundleSectionCodec>>();
  for (const codec of codecs) {
    validateIdentifier(codec.type);
    if (!Number.isSafeInteger(codec.version) || codec.version < 1) {
      throw schemaInvalid();
    }
    const key = codecKey(codec.type, codec.version);
    if (registry.has(key)) {
      throw schemaInvalid();
    }
    registry.set(key, codec);
  }
  return registry;
}

function validateBlobReference(reference: Readonly<BlobIdentity>): void {
  const candidate = reference as unknown as Readonly<Record<string, unknown>>;
  if (
    candidate.algorithm !== BLOB_DIGEST_ALGORITHM ||
    typeof candidate.digest !== 'string' ||
    !SHA256_DIGEST_PATTERN.test(candidate.digest) ||
    typeof candidate.byteLength !== 'number' ||
    !Number.isSafeInteger(candidate.byteLength) ||
    candidate.byteLength < 0
  ) {
    throw schemaInvalid();
  }
}

function validateWorkspaceId(value: string): void {
  validateIdentifier(value);
}

function validateIdentifier(value: string): void {
  if (!IDENTIFIER_PATTERN.test(value)) {
    throw schemaInvalid();
  }
}

function validateTimestamp(value: string): void {
  const milliseconds = Date.parse(value);
  if (
    !Number.isFinite(milliseconds) ||
    new Date(milliseconds).toISOString() !== value
  ) {
    throw schemaInvalid();
  }
}

function parseMaximumBytes(value: number | undefined): number {
  const maximumBytes = value ?? DEFAULT_MAXIMUM_WORKSPACE_BUNDLE_BYTES;
  if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 0) {
    throw new WorkspaceBundleError(
      'input_invalid',
      'The workspace bundle byte limit is invalid.',
    );
  }
  return maximumBytes;
}

function parseMaximumValues(value: number | undefined): number {
  const maximumValues = value ?? DEFAULT_MAXIMUM_WORKSPACE_BUNDLE_VALUES;
  if (!Number.isSafeInteger(maximumValues) || maximumValues < 1) {
    throw new WorkspaceBundleError(
      'input_invalid',
      'The workspace bundle value limit is invalid.',
    );
  }
  return maximumValues;
}

function assertNoSecretMaterial(value: JsonValue): void {
  if (typeof value === 'string') {
    assertSafeString(value);
    return;
  }
  if (value === null || typeof value !== 'object') {
    return;
  }
  if (isReadonlyArray(value)) {
    for (const item of value) {
      assertNoSecretMaterial(item);
    }
    return;
  }
  for (const [key, item] of Object.entries(value)) {
    const normalizedKey = key.toLowerCase().replaceAll(/[^a-z0-9]/gu, '');
    if (
      SECRET_PROPERTY_NAMES.has(normalizedKey) ||
      SECRET_PROPERTY_SUFFIXES.some((suffix) => normalizedKey.endsWith(suffix))
    ) {
      throw secretMaterialForbidden();
    }
    assertNoSecretMaterial(item);
  }
}

function assertSafeString(value: string): void {
  if (
    /-----BEGIN (?:[A-Z0-9 ]+ )?PRIVATE KEY-----/u.test(value) ||
    /\bBearer\s+[^\s]+/iu.test(value)
  ) {
    throw secretMaterialForbidden();
  }
  if (!/^[A-Za-z][A-Za-z0-9+.-]*:\/\//u.test(value)) {
    return;
  }
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return;
  }
  if (parsed.username !== '' || parsed.password !== '') {
    throw secretMaterialForbidden();
  }
  for (const key of parsed.searchParams.keys()) {
    if (SECRET_QUERY_PARAMETER_NAMES.has(key.toLowerCase())) {
      throw secretMaterialForbidden();
    }
  }
}

function requireClosedObject(
  value: JsonValue,
  expectedKeys: readonly string[],
): JsonObject {
  if (value === null || typeof value !== 'object' || isReadonlyArray(value)) {
    throw schemaInvalid();
  }
  const actualKeys = Object.keys(value).sort();
  const sortedExpectedKeys = [...expectedKeys].sort();
  if (
    actualKeys.length !== sortedExpectedKeys.length ||
    actualKeys.some((key, index) => key !== sortedExpectedKeys[index])
  ) {
    throw schemaInvalid();
  }
  return value;
}

function requireString(value: JsonValue | undefined): string {
  if (typeof value !== 'string') {
    throw schemaInvalid();
  }
  return value;
}

function requirePositiveSafeInteger(value: JsonValue | undefined): number {
  const parsed = requireNonNegativeSafeInteger(value);
  if (parsed < 1) {
    throw schemaInvalid();
  }
  return parsed;
}

function requireNonNegativeSafeInteger(value: JsonValue | undefined): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw schemaInvalid();
  }
  return value;
}

function compareSections(
  left: Readonly<{type: string; version: number}>,
  right: Readonly<{type: string; version: number}>,
): number {
  return left.type.localeCompare(right.type) || left.version - right.version;
}

function assertUniqueSectionKeys(
  sections: readonly Readonly<{type: string; version: number}>[],
): void {
  for (let index = 1; index < sections.length; index += 1) {
    const previous = sections[index - 1];
    const current = sections[index];
    if (
      previous !== undefined &&
      current !== undefined &&
      compareSections(previous, current) === 0
    ) {
      throw schemaInvalid();
    }
  }
}

function assertSortedUniqueSections(
  sections: readonly Readonly<{type: string; version: number}>[],
): void {
  for (let index = 1; index < sections.length; index += 1) {
    const previous = sections[index - 1];
    const current = sections[index];
    if (
      previous === undefined ||
      current === undefined ||
      compareSections(previous, current) >= 0
    ) {
      throw schemaInvalid();
    }
  }
}

function codecKey(type: string, version: number): string {
  return `${type}\u0000${String(version)}`;
}

function isReadonlyArray(value: unknown): value is readonly unknown[] {
  return !utilityTypes.isProxy(value) && Array.isArray(value);
}

function mapCanonicalJsonError(error: unknown): WorkspaceBundleError {
  if (error instanceof CanonicalJsonError) {
    if (error.code === 'size_exceeded') {
      return new WorkspaceBundleError(
        'bundle_too_large',
        'The workspace bundle exceeds the configured byte limit.',
      );
    }
    if (error.code === 'encoding_invalid') {
      return new WorkspaceBundleError(
        'encoding_invalid',
        'The workspace bundle must use valid canonical UTF-8 JSON.',
      );
    }
  }
  return schemaInvalid();
}

function schemaInvalid(): WorkspaceBundleError {
  return new WorkspaceBundleError(
    'schema_invalid',
    'The workspace bundle does not satisfy its closed schema.',
  );
}

function secretMaterialForbidden(): WorkspaceBundleError {
  return new WorkspaceBundleError(
    'secret_material_forbidden',
    'Ordinary workspace bundles cannot contain secret material.',
  );
}

function unsupportedSection(): WorkspaceBundleError {
  return new WorkspaceBundleError(
    'section_unsupported',
    'The workspace bundle contains an unsupported section contract.',
  );
}
