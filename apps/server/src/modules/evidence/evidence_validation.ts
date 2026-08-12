import {createHash} from 'node:crypto';
import {isDeepStrictEqual, TextDecoder, TextEncoder} from 'node:util';

import {
  BLOB_DIGEST_ALGORITHM,
  DOCUMENT_NODE_KINDS,
  IMMUTABLE_EVIDENCE_ENTITY_KINDS,
  MEDIA_PURPOSE_ORIGINS,
  MEDIA_PURPOSES,
  PUBLICATION_PRECISIONS,
  RESOURCE_KINDS,
  type CaptureEvidenceInput,
  type CodePointRange,
  type DocumentNodeInput,
  type EvidenceBlobInput,
  type ExactBlobIdentity,
  type GitObjectIdentity,
  type ImmutableEvidenceRecord,
  type LineRange,
  type MediaAssetInput,
  type MediaUsageInput,
  type ValidatedCaptureEvidence,
} from './evidence_contract.js';
import {
  ClosedInputDecodeError,
  decodeCaptureEvidence,
  decodeImmutableEvidenceRecord,
} from './closed_input_decoder.js';
import {
  indexMarkdownText,
  lineRangeFromIndex,
  type IndexedMarkdownText,
} from './markdown/markdown_line_index.js';
import {validateFixedMarkdownEvidenceStructureWithTextIndex} from './markdown/markdown_projection.js';

const SHA256_PATTERN = /^[0-9a-f]{64}$/u;
const SHA1_PATTERN = /^[0-9a-f]{40}$/u;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;
const URI_SCHEME_PATTERN = /^[A-Za-z][A-Za-z0-9+.-]*:/u;
const WINDOWS_DRIVE_PREFIX_PATTERN = /^[A-Za-z]:/u;
const ISO_TIMESTAMP_PATTERN =
  /^([0-9]{4})-([0-9]{2})-([0-9]{2})T([0-9]{2}):([0-9]{2}):([0-9]{2})(?:\.([0-9]{1,6}))?(Z|([+-])([0-9]{2}):([0-9]{2}))$/u;

export type EvidenceValidationCode =
  | 'blob_identity_mismatch'
  | 'duplicate_identity'
  | 'fragment_hash_mismatch'
  | 'invalid_blob_identity'
  | 'invalid_confidence'
  | 'invalid_digest'
  | 'invalid_git_identity'
  | 'invalid_idempotency_key'
  | 'invalid_line_range'
  | 'invalid_media'
  | 'invalid_publication'
  | 'invalid_range'
  | 'invalid_resource'
  | 'invalid_shape'
  | 'invalid_structure'
  | 'invalid_timestamp'
  | 'invalid_tree'
  | 'invalid_uri'
  | 'invalid_utf8'
  | 'invalid_uuid'
  | 'workspace_mismatch';

export interface EvidenceValidationIssue {
  readonly code: EvidenceValidationCode;
  readonly path: string;
}

export type EvidenceValidationResult =
  | Readonly<{
      status: 'validated';
      value: ValidatedCaptureEvidence;
    }>
  | Readonly<{
      status: 'validation_failed';
      issue: Readonly<EvidenceValidationIssue>;
    }>;

export type EvidenceReplayResolution =
  | Readonly<{
      /** Command-level state only; entity reuse is resolved separately. */
      status: 'new_command';
      value: ValidatedCaptureEvidence;
    }>
  | Readonly<{
      /** An equal immutable command with the same workspace/key was replayed. */
      status: 'replayed';
      value: ValidatedCaptureEvidence;
    }>
  | Readonly<{
      status: 'validation_failed';
      issue: Readonly<EvidenceValidationIssue>;
    }>
  | Readonly<{
      status: 'conflict';
      code: 'immutable_content_conflict';
      workspaceId: string;
      commandIdempotencyKey: string;
    }>;

export type ImmutableEvidenceRecordResolution =
  | Readonly<{
      status: 'insert' | 'existing';
      value: Readonly<ImmutableEvidenceRecord>;
    }>
  | Readonly<{
      status: 'validation_failed';
      issue: Readonly<EvidenceValidationIssue>;
    }>
  | Readonly<{
      status: 'conflict';
      code: 'immutable_content_conflict';
      workspaceId: string;
      entityKind: ImmutableEvidenceRecord['entityKind'];
      stableId: string;
    }>;

class EvidenceValidationFault extends Error {
  public readonly code: EvidenceValidationCode;
  public readonly path: string;

  public constructor(code: EvidenceValidationCode, path: string) {
    super('Evidence capture validation failed.');
    this.name = 'EvidenceValidationFault';
    this.code = code;
    this.path = path;
  }
}

export function validateEvidenceCapture(
  input: unknown,
): EvidenceValidationResult {
  try {
    const decoded = decodeCaptureEvidence(input);
    validateCapture(decoded);
    return Object.freeze({
      status: 'validated' as const,
      value: createValidatedCapture(decoded),
    });
  } catch (error) {
    const issue =
      error instanceof EvidenceValidationFault
        ? {code: error.code, path: error.path}
        : error instanceof ClosedInputDecodeError
          ? {code: error.code, path: error.path}
          : {code: 'invalid_shape' as const, path: 'capture'};
    return Object.freeze({
      status: 'validation_failed' as const,
      issue: Object.freeze(issue),
    });
  }
}

export function resolveEvidenceCaptureReplay(
  existing: unknown,
  candidate: unknown,
): EvidenceReplayResolution {
  const candidateResult = validateEvidenceCapture(candidate);
  if (candidateResult.status === 'validation_failed') {
    return candidateResult;
  }
  if (existing === undefined) {
    return Object.freeze({
      status: 'new_command' as const,
      value: candidateResult.value,
    });
  }

  const existingResult = validateEvidenceCapture(existing);
  if (existingResult.status === 'validation_failed') {
    return existingResult;
  }
  if (
    existingResult.value.workspaceId === candidateResult.value.workspaceId &&
    existingResult.value.commandIdempotencyKey ===
      candidateResult.value.commandIdempotencyKey &&
    immutableCapturesEqual(existingResult.value, candidateResult.value)
  ) {
    return Object.freeze({
      status: 'replayed' as const,
      value: existingResult.value,
    });
  }

  if (
    existingResult.value.workspaceId !== candidateResult.value.workspaceId ||
    existingResult.value.commandIdempotencyKey !==
      candidateResult.value.commandIdempotencyKey
  ) {
    return Object.freeze({
      status: 'new_command' as const,
      value: candidateResult.value,
    });
  }

  return Object.freeze({
    status: 'conflict' as const,
    code: 'immutable_content_conflict' as const,
    workspaceId: candidateResult.value.workspaceId,
    commandIdempotencyKey: candidateResult.value.commandIdempotencyKey,
  });
}

export function resolveImmutableEvidenceRecord(
  existingByStableId: unknown,
  existingByNaturalIdentity: unknown,
  candidate: unknown,
): ImmutableEvidenceRecordResolution {
  const candidateResult = validateImmutableEvidenceRecord(candidate);
  if (candidateResult.status === 'validation_failed') {
    return candidateResult;
  }
  const right = candidateResult.value;

  const stableResult =
    validateOptionalImmutableEvidenceRecord(existingByStableId);
  if (stableResult?.status === 'validation_failed') {
    return stableResult;
  }
  const naturalResult = validateOptionalImmutableEvidenceRecord(
    existingByNaturalIdentity,
  );
  if (naturalResult?.status === 'validation_failed') {
    return naturalResult;
  }
  const stableValue = stableResult?.value;
  const naturalValue = naturalResult?.value;
  const byStableId = sameImmutableRecordScope(stableValue, right)
    ? stableValue
    : undefined;
  const byNaturalIdentity = sameImmutableRecordScope(naturalValue, right)
    ? naturalValue
    : undefined;

  if (byStableId === undefined && byNaturalIdentity === undefined) {
    return Object.freeze({status: 'insert' as const, value: right});
  }

  const stableLookupConsistent =
    byStableId === undefined || byStableId.stableId === right.stableId;
  const naturalLookupConsistent =
    byNaturalIdentity === undefined ||
    isDeepStrictEqual(byNaturalIdentity.naturalIdentity, right.naturalIdentity);
  const lookupsResolveSameRow =
    byStableId === undefined ||
    byNaturalIdentity === undefined ||
    isDeepStrictEqual(byStableId, byNaturalIdentity);
  const existing = byStableId ?? byNaturalIdentity;
  if (
    stableLookupConsistent &&
    naturalLookupConsistent &&
    lookupsResolveSameRow &&
    existing !== undefined &&
    isDeepStrictEqual(existing.naturalIdentity, right.naturalIdentity) &&
    isDeepStrictEqual(existing.immutableContent, right.immutableContent)
  ) {
    return Object.freeze({status: 'existing' as const, value: existing});
  }
  return Object.freeze({
    status: 'conflict' as const,
    code: 'immutable_content_conflict' as const,
    workspaceId: right.workspaceId,
    entityKind: right.entityKind,
    stableId: right.stableId,
  });
}

function validateOptionalImmutableEvidenceRecord(
  input: unknown,
): ReturnType<typeof validateImmutableEvidenceRecord> | undefined {
  return input === undefined
    ? undefined
    : validateImmutableEvidenceRecord(input);
}

function sameImmutableRecordScope(
  left: Readonly<ImmutableEvidenceRecord> | undefined,
  right: Readonly<ImmutableEvidenceRecord>,
): left is Readonly<ImmutableEvidenceRecord> {
  return (
    left?.workspaceId === right.workspaceId &&
    left.entityKind === right.entityKind
  );
}

function validateCapture(input: Readonly<CaptureEvidenceInput>): void {
  validateUuid(input.workspaceId, 'workspaceId');
  validateNonEmpty(input.commandIdempotencyKey, 'commandIdempotencyKey');
  if (!isArray(input.blobs)) {
    fail('invalid_blob_identity', 'blobs');
  }

  const blobsById = validateBlobs(input.workspaceId, input.blobs);
  validateResource(input);
  validateSnapshot(input, blobsById);
  validateGitObservations(input);
  const text = validateStructure(input, blobsById);
  const textIndex = indexMarkdownText(text);
  const nodesById = validateNodes(input, textIndex);
  validateFragments(input, textIndex, nodesById);
  const markdownStructureCheck =
    validateFixedMarkdownEvidenceStructureWithTextIndex(
      input.structure,
      input.snapshot,
      textIndex,
    );
  if (markdownStructureCheck.status === 'invalid') {
    fail('invalid_structure', markdownStructureCheck.path);
  }
  const assetsById = validateMediaAssets(input, blobsById);
  validateMediaUsages(input, nodesById, assetsById);
}

function validateBlobs(
  workspaceId: string,
  blobs: readonly Readonly<EvidenceBlobInput>[],
): ReadonlyMap<string, Readonly<EvidenceBlobInput>> {
  const byId = new Map<string, Readonly<EvidenceBlobInput>>();
  const digestIdentities = new Set<string>();
  for (const [index, blob] of blobs.entries()) {
    const path = `blobs[${String(index)}]`;
    validateExactBlobShape(blob, workspaceId, path);
    validateOptionalNonEmpty(blob.mediaType, `${path}.mediaType`);
    if (byId.has(blob.blobId)) {
      fail('duplicate_identity', `${path}.blobId`);
    }
    const digestIdentity = `${blob.digestAlgorithm}\u0000${blob.digest}`;
    if (digestIdentities.has(digestIdentity)) {
      fail('duplicate_identity', `${path}.digest`);
    }
    byId.set(blob.blobId, blob);
    digestIdentities.add(digestIdentity);
  }
  return byId;
}

function validateResource(input: Readonly<CaptureEvidenceInput>): void {
  const {resource} = input;
  validateWorkspace(resource.workspaceId, input.workspaceId, 'resource');
  validateUuid(resource.resourceId, 'resource.resourceId');
  if (!isOneOf(RESOURCE_KINDS, resource.resourceKind)) {
    fail('invalid_resource', 'resource.resourceKind');
  }
  validateSourceKey(resource.sourceKey, 'resource.sourceKey');
  if (resource.canonicalUri !== undefined) {
    validateUri(resource.canonicalUri, 'resource.canonicalUri');
  }

  const {gitResource} = input;
  if (resource.resourceKind === 'git_file') {
    if (gitResource === undefined) {
      fail('invalid_resource', 'gitResource');
    }
    validateWorkspace(
      gitResource.workspaceId,
      input.workspaceId,
      'gitResource',
    );
    validateUuid(gitResource.resourceId, 'gitResource.resourceId');
    if (gitResource.resourceId !== resource.resourceId) {
      fail('invalid_resource', 'gitResource.resourceId');
    }
    validateUri(
      gitResource.canonicalRepositoryUri,
      'gitResource.canonicalRepositoryUri',
    );
    validateRepositoryRelativePath(
      gitResource.repositoryRelativePath,
      'gitResource.repositoryRelativePath',
    );
  } else if (gitResource !== undefined) {
    fail('invalid_resource', 'gitResource');
  }
}

function validateSnapshot(
  input: Readonly<CaptureEvidenceInput>,
  blobsById: ReadonlyMap<string, Readonly<EvidenceBlobInput>>,
): void {
  const {snapshot} = input;
  validateWorkspace(snapshot.workspaceId, input.workspaceId, 'snapshot');
  validateUuid(snapshot.snapshotId, 'snapshot.snapshotId');
  validateUuid(snapshot.resourceId, 'snapshot.resourceId');
  if (snapshot.resourceId !== input.resource.resourceId) {
    fail('invalid_structure', 'snapshot.resourceId');
  }
  validateSha256(snapshot.rawSha256, 'snapshot.rawSha256');
  validateSha256(
    snapshot.canonicalContentSha256,
    'snapshot.canonicalContentSha256',
  );
  validateNonEmpty(
    snapshot.canonicalizationVersion,
    'snapshot.canonicalizationVersion',
  );
  validateOptionalNonEmpty(snapshot.mediaType, 'snapshot.mediaType');
  validateTimestamp(snapshot.capturedAt, 'snapshot.capturedAt');

  if (snapshot.rawBlob !== undefined) {
    validateRegisteredBlob(
      snapshot.rawBlob,
      input.workspaceId,
      blobsById,
      'snapshot.rawBlob',
    );
    if (snapshot.rawBlob.digest !== snapshot.rawSha256) {
      fail('blob_identity_mismatch', 'snapshot.rawBlob.digest');
    }
  }
  if (snapshot.publication !== undefined) {
    validatePublication(snapshot.publication);
  }
}

function validatePublication(
  publication: NonNullable<CaptureEvidenceInput['snapshot']['publication']>,
): void {
  if (typeof publication.inferred !== 'boolean') {
    fail('invalid_publication', 'snapshot.publication.inferred');
  }
  if (publication.instant !== undefined) {
    validateTimestamp(publication.instant, 'snapshot.publication.instant');
  }
  if (
    publication.instant === undefined &&
    (publication.sourceTimezone !== undefined ||
      publication.precision !== undefined)
  ) {
    fail('invalid_publication', 'snapshot.publication');
  }
  validateOptionalNonEmpty(
    publication.sourceTimezone,
    'snapshot.publication.sourceTimezone',
  );
  if (
    publication.precision !== undefined &&
    !isOneOf(PUBLICATION_PRECISIONS, publication.precision)
  ) {
    fail('invalid_publication', 'snapshot.publication.precision');
  }
  validateOptionalNonEmpty(
    publication.sourceText,
    'snapshot.publication.sourceText',
  );
}

function validateGitObservations(input: Readonly<CaptureEvidenceInput>): void {
  if (!isArray(input.gitObservations)) {
    fail('invalid_git_identity', 'gitObservations');
  }
  if (
    input.resource.resourceKind === 'git_file' &&
    input.gitObservations.length === 0
  ) {
    fail('invalid_git_identity', 'gitObservations');
  }
  if (input.gitObservations.length > 0 && input.gitResource === undefined) {
    fail('invalid_git_identity', 'gitObservations');
  }

  const ids = new Set<string>();
  const identities = new Set<string>();
  for (const [index, observation] of input.gitObservations.entries()) {
    const path = `gitObservations[${String(index)}]`;
    validateWorkspace(observation.workspaceId, input.workspaceId, path);
    validateUuid(observation.observationId, `${path}.observationId`);
    validateUuid(observation.resourceId, `${path}.resourceId`);
    validateUuid(observation.snapshotId, `${path}.snapshotId`);
    if (
      observation.resourceId !== input.resource.resourceId ||
      observation.snapshotId !== input.snapshot.snapshotId
    ) {
      fail('invalid_git_identity', path);
    }
    validateNonEmpty(observation.repositoryRef, `${path}.repositoryRef`);
    validateGitObjectIdentity(observation.commit, `${path}.commit`);
    if (observation.blobObject !== undefined) {
      validateGitObjectIdentity(observation.blobObject, `${path}.blobObject`);
    }
    validateTimestamp(observation.observedAt, `${path}.observedAt`);

    if (ids.has(observation.observationId)) {
      fail('duplicate_identity', `${path}.observationId`);
    }
    const identity = [
      observation.resourceId,
      observation.repositoryRef,
      observation.commit.algorithm,
      observation.commit.digest,
    ].join('\u0000');
    if (identities.has(identity)) {
      fail('duplicate_identity', `${path}.commit`);
    }
    ids.add(observation.observationId);
    identities.add(identity);
  }
}

function validateStructure(
  input: Readonly<CaptureEvidenceInput>,
  blobsById: ReadonlyMap<string, Readonly<EvidenceBlobInput>>,
): string {
  const {structure} = input;
  validateWorkspace(structure.workspaceId, input.workspaceId, 'structure');
  validateUuid(structure.structureId, 'structure.structureId');
  validateUuid(structure.resourceId, 'structure.resourceId');
  validateUuid(structure.snapshotId, 'structure.snapshotId');
  if (
    structure.resourceId !== input.resource.resourceId ||
    structure.snapshotId !== input.snapshot.snapshotId
  ) {
    fail('invalid_structure', 'structure');
  }
  validateNonEmpty(structure.parserName, 'structure.parserName');
  validateNonEmpty(structure.parserVersion, 'structure.parserVersion');
  validateNonEmpty(
    structure.textNormalizationVersion,
    'structure.textNormalizationVersion',
  );
  validateSha256(structure.structureSha256, 'structure.structureSha256');
  validateRegisteredBlob(
    structure.textBlob,
    input.workspaceId,
    blobsById,
    'structure.textBlob',
  );
  if (
    structure.normalizedTextUtf8.byteLength !== structure.textBlob.byteLength ||
    sha256(structure.normalizedTextUtf8) !== structure.textBlob.digest
  ) {
    fail('blob_identity_mismatch', 'structure.normalizedTextUtf8');
  }
  try {
    return new TextDecoder('utf-8', {fatal: true, ignoreBOM: true}).decode(
      structure.normalizedTextUtf8,
    );
  } catch {
    fail('invalid_utf8', 'structure.normalizedTextUtf8');
  }
}

function validateNodes(
  input: Readonly<CaptureEvidenceInput>,
  textIndex: Readonly<IndexedMarkdownText>,
): ReadonlyMap<string, Readonly<DocumentNodeInput>> {
  const {nodes} = input.structure;
  if (!isArray(nodes) || nodes.length === 0) {
    fail('invalid_tree', 'structure.nodes');
  }
  const byId = new Map<string, Readonly<DocumentNodeInput>>();

  for (const [index, node] of nodes.entries()) {
    const path = `structure.nodes[${String(index)}]`;
    validateContext(input, node, path);
    validateUuid(node.nodeId, `${path}.nodeId`);
    if (node.parentNodeId !== undefined) {
      validateUuid(node.parentNodeId, `${path}.parentNodeId`);
    }
    if (!isOneOf(DOCUMENT_NODE_KINDS, node.kind)) {
      fail('invalid_tree', `${path}.kind`);
    }
    validateNonNegativeInteger(node.siblingOrdinal, `${path}.siblingOrdinal`);
    validateCodePointRange(
      node.codePointRange,
      textIndex.codePoints.length,
      `${path}.codePointRange`,
    );
    validateOptionalLineRange(
      node.lineRange,
      textIndex,
      node.codePointRange,
      `${path}.lineRange`,
    );
    if (byId.has(node.nodeId)) {
      fail('duplicate_identity', `${path}.nodeId`);
    }
    byId.set(node.nodeId, node);
  }

  const siblingSlots = new Set<string>();
  let rootCount = 0;
  for (const [index, node] of nodes.entries()) {
    const path = `structure.nodes[${String(index)}]`;
    if (node.parentNodeId === undefined) {
      rootCount += 1;
      if (node.siblingOrdinal !== 0) {
        fail('invalid_tree', `${path}.siblingOrdinal`);
      }
    } else {
      if (node.parentNodeId === node.nodeId) {
        fail('invalid_tree', `${path}.parentNodeId`);
      }
      if (!byId.has(node.parentNodeId)) {
        fail('invalid_tree', `${path}.parentNodeId`);
      }
    }
    const slot = `${node.parentNodeId ?? '<root>'}\u0000${String(node.siblingOrdinal)}`;
    if (siblingSlots.has(slot)) {
      fail('duplicate_identity', `${path}.siblingOrdinal`);
    }
    siblingSlots.add(slot);
  }

  validateNodeCycles(nodes, byId);
  if (rootCount !== 1) {
    fail('invalid_tree', 'structure.nodes');
  }
  return byId;
}

function validateNodeCycles(
  nodes: readonly Readonly<DocumentNodeInput>[],
  byId: ReadonlyMap<string, Readonly<DocumentNodeInput>>,
): void {
  for (const node of nodes) {
    const traversal = new Set<string>();
    let current: Readonly<DocumentNodeInput> | undefined = node;
    while (current !== undefined) {
      if (traversal.has(current.nodeId)) {
        fail('invalid_tree', 'structure.nodes');
      }
      traversal.add(current.nodeId);
      current =
        current.parentNodeId === undefined
          ? undefined
          : byId.get(current.parentNodeId);
    }
  }
}

function validateFragments(
  input: Readonly<CaptureEvidenceInput>,
  textIndex: Readonly<IndexedMarkdownText>,
  nodesById: ReadonlyMap<string, Readonly<DocumentNodeInput>>,
): void {
  const {fragments} = input.structure;
  if (!isArray(fragments)) {
    fail('invalid_structure', 'structure.fragments');
  }
  const ids = new Set<string>();
  const identities = new Set<string>();

  for (const [index, fragment] of fragments.entries()) {
    const path = `structure.fragments[${String(index)}]`;
    validateContext(input, fragment, path);
    validateUuid(fragment.fragmentId, `${path}.fragmentId`);
    validateUuid(fragment.nodeId, `${path}.nodeId`);
    const node = nodesById.get(fragment.nodeId);
    if (node === undefined) {
      fail('invalid_structure', `${path}.nodeId`);
    }
    validateSameBlobIdentity(
      fragment.textBlob,
      input.structure.textBlob,
      `${path}.textBlob`,
    );
    const runtimeLocator = fragment as unknown as Readonly<{
      locatorKind?: unknown;
      locatorVersion?: unknown;
    }>;
    if (
      runtimeLocator.locatorKind !== 'unicode_code_point_range' ||
      runtimeLocator.locatorVersion !== 1
    ) {
      fail('invalid_range', `${path}.locatorKind`);
    }
    validateCodePointRange(
      fragment.codePointRange,
      textIndex.codePoints.length,
      `${path}.codePointRange`,
    );
    if (
      fragment.codePointRange.start < node.codePointRange.start ||
      fragment.codePointRange.end > node.codePointRange.end
    ) {
      fail('invalid_range', `${path}.codePointRange`);
    }
    validateOptionalLineRange(
      fragment.lineRange,
      textIndex,
      fragment.codePointRange,
      `${path}.lineRange`,
    );
    if (
      fragment.lineRange !== undefined &&
      node.lineRange !== undefined &&
      (fragment.lineRange.start < node.lineRange.start ||
        fragment.lineRange.end > node.lineRange.end)
    ) {
      fail('invalid_line_range', `${path}.lineRange`);
    }
    validateSha256(fragment.selectedTextSha256, `${path}.selectedTextSha256`);
    const selectedText = textIndex.codePoints
      .slice(fragment.codePointRange.start, fragment.codePointRange.end)
      .join('');
    if (
      sha256(new TextEncoder().encode(selectedText)) !==
      fragment.selectedTextSha256
    ) {
      fail('fragment_hash_mismatch', `${path}.selectedTextSha256`);
    }

    if (ids.has(fragment.fragmentId)) {
      fail('duplicate_identity', `${path}.fragmentId`);
    }
    const identity = [
      fragment.structureId,
      fragment.nodeId,
      fragment.locatorKind,
      String(fragment.locatorVersion),
      String(fragment.codePointRange.start),
      String(fragment.codePointRange.end),
    ].join('\u0000');
    if (identities.has(identity)) {
      fail('duplicate_identity', `${path}.codePointRange`);
    }
    ids.add(fragment.fragmentId);
    identities.add(identity);
  }
}

function validateMediaAssets(
  input: Readonly<CaptureEvidenceInput>,
  blobsById: ReadonlyMap<string, Readonly<EvidenceBlobInput>>,
): ReadonlyMap<string, MediaAssetInput> {
  if (!isArray(input.mediaAssets)) {
    fail('invalid_media', 'mediaAssets');
  }
  const byId = new Map<string, MediaAssetInput>();
  const storedDigests = new Set<string>();

  for (const [index, asset] of input.mediaAssets.entries()) {
    const path = `mediaAssets[${String(index)}]`;
    validateWorkspace(asset.workspaceId, input.workspaceId, path);
    validateUuid(asset.mediaAssetId, `${path}.mediaAssetId`);
    validateOptionalNonEmpty(asset.mediaType, `${path}.mediaType`);
    validateOptionalMediaDimensions(asset.dimensions, `${path}.dimensions`);
    if (byId.has(asset.mediaAssetId)) {
      fail('duplicate_identity', `${path}.mediaAssetId`);
    }

    const runtimeStorageMode = (
      asset as unknown as Readonly<{storageMode?: unknown}>
    ).storageMode;
    if (
      runtimeStorageMode !== 'stored_blob' &&
      runtimeStorageMode !== 'external_reference'
    ) {
      fail('invalid_media', `${path}.storageMode`);
    }

    if (asset.storageMode === 'stored_blob') {
      const runtimeAsset = asset as MediaAssetInput & {
        readonly blob?: Readonly<ExactBlobIdentity>;
      };
      if (runtimeAsset.blob === undefined) {
        fail('invalid_media', `${path}.blob`);
      }
      validateRegisteredBlob(
        runtimeAsset.blob,
        input.workspaceId,
        blobsById,
        `${path}.blob`,
      );
      if (asset.originalUri !== undefined) {
        validateUri(asset.originalUri, `${path}.originalUri`);
      }
      if (storedDigests.has(runtimeAsset.blob.digest)) {
        fail('duplicate_identity', `${path}.blob.digest`);
      }
      storedDigests.add(runtimeAsset.blob.digest);
    } else {
      const runtimeAsset = asset as MediaAssetInput & {
        readonly blob?: unknown;
      };
      if (runtimeAsset.blob !== undefined) {
        fail('invalid_media', `${path}.blob`);
      }
      validateUri(asset.originalUri, `${path}.originalUri`);
    }
    byId.set(asset.mediaAssetId, asset);
  }
  return byId;
}

function validateMediaUsages(
  input: Readonly<CaptureEvidenceInput>,
  nodesById: ReadonlyMap<string, Readonly<DocumentNodeInput>>,
  assetsById: ReadonlyMap<string, MediaAssetInput>,
): void {
  if (!isArray(input.mediaUsages)) {
    fail('invalid_media', 'mediaUsages');
  }
  const byId = new Map<string, Readonly<MediaUsageInput>>();
  const revisionIdentities = new Set<string>();

  for (const [index, usage] of input.mediaUsages.entries()) {
    const path = `mediaUsages[${String(index)}]`;
    validateContext(input, usage, path);
    validateUuid(usage.mediaUsageId, `${path}.mediaUsageId`);
    validateUuid(usage.mediaAssetId, `${path}.mediaAssetId`);
    validateUuid(usage.nodeId, `${path}.nodeId`);
    validateNonNegativeInteger(usage.ordinal, `${path}.ordinal`);
    if (!assetsById.has(usage.mediaAssetId)) {
      fail('invalid_media', `${path}.mediaAssetId`);
    }
    if (!nodesById.has(usage.nodeId)) {
      fail('invalid_media', `${path}.nodeId`);
    }
    if (!isOneOf(MEDIA_PURPOSES, usage.purpose)) {
      fail('invalid_media', `${path}.purpose`);
    }
    if (!isOneOf(MEDIA_PURPOSE_ORIGINS, usage.purposeOrigin)) {
      fail('invalid_media', `${path}.purposeOrigin`);
    }
    validateConfidence(usage, path);
    if (usage.supersededUsage !== undefined) {
      validateSupersededUsage(input, usage, path);
    }
    if (byId.has(usage.mediaUsageId)) {
      fail('duplicate_identity', `${path}.mediaUsageId`);
    }
    const revisionIdentity = mediaUsagePositionKey(
      usage,
      usage.supersededUsage?.mediaUsageId,
    );
    if (revisionIdentities.has(revisionIdentity)) {
      fail('duplicate_identity', `${path}.supersededUsage`);
    }
    byId.set(usage.mediaUsageId, usage);
    revisionIdentities.add(revisionIdentity);
  }

  for (const [index, usage] of input.mediaUsages.entries()) {
    const reference = usage.supersededUsage;
    if (reference === undefined) {
      continue;
    }
    const target = byId.get(reference.mediaUsageId);
    if (target !== undefined && !sameMediaUsagePosition(target, reference)) {
      fail('invalid_media', `mediaUsages[${String(index)}].supersededUsage`);
    }
    validateMediaUsageCycle(usage, byId);
  }
}

function validateSupersededUsage(
  input: Readonly<CaptureEvidenceInput>,
  usage: Readonly<MediaUsageInput>,
  path: string,
): void {
  const reference = usage.supersededUsage;
  if (reference === undefined) {
    return;
  }
  validateWorkspace(
    reference.workspaceId,
    input.workspaceId,
    `${path}.supersededUsage`,
  );
  validateUuid(reference.mediaUsageId, `${path}.supersededUsage.mediaUsageId`);
  validateUuid(reference.resourceId, `${path}.supersededUsage.resourceId`);
  validateUuid(reference.snapshotId, `${path}.supersededUsage.snapshotId`);
  validateUuid(reference.structureId, `${path}.supersededUsage.structureId`);
  validateUuid(reference.nodeId, `${path}.supersededUsage.nodeId`);
  validateNonNegativeInteger(
    reference.ordinal,
    `${path}.supersededUsage.ordinal`,
  );
  if (
    reference.mediaUsageId === usage.mediaUsageId ||
    !sameMediaUsagePosition(usage, reference)
  ) {
    fail('invalid_media', `${path}.supersededUsage`);
  }
}

function validateMediaUsageCycle(
  usage: Readonly<MediaUsageInput>,
  byId: ReadonlyMap<string, Readonly<MediaUsageInput>>,
): void {
  const traversal = new Set<string>();
  let current: Readonly<MediaUsageInput> | undefined = usage;
  while (current !== undefined) {
    if (traversal.has(current.mediaUsageId)) {
      fail('invalid_media', 'mediaUsages');
    }
    traversal.add(current.mediaUsageId);
    const predecessorId: string | undefined =
      current.supersededUsage?.mediaUsageId;
    current = predecessorId === undefined ? undefined : byId.get(predecessorId);
  }
}

function validateConfidence(
  usage: Readonly<MediaUsageInput>,
  path: string,
): void {
  if (usage.confidence === undefined) {
    return;
  }
  if (
    usage.purposeOrigin !== 'ai_inference' ||
    !Number.isFinite(usage.confidence) ||
    usage.confidence < 0 ||
    usage.confidence > 1
  ) {
    fail('invalid_confidence', `${path}.confidence`);
  }
}

function validateContext(
  input: Readonly<CaptureEvidenceInput>,
  value: Readonly<{
    workspaceId: string;
    resourceId: string;
    snapshotId: string;
    structureId: string;
  }>,
  path: string,
): void {
  validateWorkspace(value.workspaceId, input.workspaceId, path);
  validateUuid(value.resourceId, `${path}.resourceId`);
  validateUuid(value.snapshotId, `${path}.snapshotId`);
  validateUuid(value.structureId, `${path}.structureId`);
  if (
    value.resourceId !== input.resource.resourceId ||
    value.snapshotId !== input.snapshot.snapshotId ||
    value.structureId !== input.structure.structureId
  ) {
    fail('invalid_structure', path);
  }
}

function validateExactBlobShape(
  blob: Readonly<ExactBlobIdentity>,
  workspaceId: string,
  path: string,
): void {
  validateWorkspace(blob.workspaceId, workspaceId, path);
  validateUuid(blob.blobId, `${path}.blobId`);
  if (runtimeDigestAlgorithm(blob) !== BLOB_DIGEST_ALGORITHM) {
    fail('invalid_blob_identity', `${path}.digestAlgorithm`);
  }
  validateSha256(blob.digest, `${path}.digest`);
  validateNonNegativeInteger(blob.byteLength, `${path}.byteLength`);
}

function validateRegisteredBlob(
  reference: Readonly<ExactBlobIdentity>,
  workspaceId: string,
  blobsById: ReadonlyMap<string, Readonly<EvidenceBlobInput>>,
  path: string,
): void {
  validateExactBlobShape(reference, workspaceId, path);
  const registered = blobsById.get(reference.blobId);
  if (registered === undefined) {
    fail('blob_identity_mismatch', path);
  }
  validateSameBlobIdentity(reference, registered, path);
}

function validateSameBlobIdentity(
  left: Readonly<ExactBlobIdentity>,
  right: Readonly<ExactBlobIdentity>,
  path: string,
): void {
  if (
    left.workspaceId !== right.workspaceId ||
    left.blobId !== right.blobId ||
    runtimeDigestAlgorithm(left) !== runtimeDigestAlgorithm(right) ||
    left.digest !== right.digest ||
    left.byteLength !== right.byteLength
  ) {
    fail('blob_identity_mismatch', path);
  }
}

function validateGitObjectIdentity(
  identity: Readonly<GitObjectIdentity>,
  path: string,
): void {
  const valid =
    typeof identity.digest === 'string' &&
    ((identity.algorithm === 'sha1' && SHA1_PATTERN.test(identity.digest)) ||
      (identity.algorithm === 'sha256' &&
        SHA256_PATTERN.test(identity.digest)));
  if (!valid) {
    fail('invalid_git_identity', path);
  }
}

function validateCodePointRange(
  range: Readonly<CodePointRange>,
  maximum: number,
  path: string,
): void {
  if (
    !Number.isSafeInteger(range.start) ||
    !Number.isSafeInteger(range.end) ||
    range.start < 0 ||
    range.end <= range.start ||
    range.end > maximum
  ) {
    fail('invalid_range', path);
  }
}

function validateOptionalLineRange(
  range: Readonly<LineRange> | undefined,
  textIndex: Readonly<IndexedMarkdownText>,
  codePointRange: Readonly<CodePointRange>,
  path: string,
): void {
  if (range === undefined) {
    return;
  }
  if (
    !Number.isSafeInteger(range.start) ||
    !Number.isSafeInteger(range.end) ||
    range.start < 1 ||
    range.end < range.start
  ) {
    fail('invalid_line_range', path);
  }
  const expected = lineRangeFromIndex(
    textIndex.lineIndex,
    codePointRange.start,
    codePointRange.end,
  );
  if (range.start !== expected.start || range.end !== expected.end) {
    fail('invalid_line_range', path);
  }
}

function validateOptionalMediaDimensions(
  dimensions: MediaAssetInput['dimensions'],
  path: string,
): void {
  if (dimensions === undefined) {
    return;
  }
  if (
    !Number.isSafeInteger(dimensions.width) ||
    !Number.isSafeInteger(dimensions.height) ||
    dimensions.width <= 0 ||
    dimensions.height <= 0
  ) {
    fail('invalid_media', path);
  }
}

function validateRepositoryRelativePath(value: unknown, path: string): void {
  if (typeof value !== 'string') {
    fail('invalid_resource', path);
  }
  validateNonEmpty(value, path);
  const segments = value.split('/');
  if (
    value.startsWith('/') ||
    value.startsWith('\\\\') ||
    value.includes('\\') ||
    /^[A-Za-z]:/u.test(value) ||
    segments.some(
      (segment) => segment === '' || segment === '.' || segment === '..',
    )
  ) {
    fail('invalid_resource', path);
  }
}

function validateSourceKey(value: string, path: string): void {
  validateNonEmpty(value, path);
  const segments = value.split(/[\\/]/u);
  if (
    WINDOWS_DRIVE_PREFIX_PATTERN.test(value) ||
    value.startsWith('/') ||
    value.startsWith('\\') ||
    value.includes('\\') ||
    segments.some((segment) => segment === '.' || segment === '..')
  ) {
    fail('invalid_resource', path);
  }
}

function validateUri(value: unknown, path: string): void {
  if (typeof value !== 'string') {
    fail('invalid_uri', path);
  }
  validateNonEmpty(value, path);
  if (!URI_SCHEME_PATTERN.test(value)) {
    fail('invalid_uri', path);
  }
  try {
    const parsed = new URL(value);
    if (parsed.protocol === 'file:') {
      fail('invalid_uri', path);
    }
  } catch (error) {
    if (error instanceof EvidenceValidationFault) {
      throw error;
    }
    fail('invalid_uri', path);
  }
}

function validateTimestamp(value: string, path: string): void {
  if (typeof value !== 'string') {
    fail('invalid_timestamp', path);
  }
  const match = ISO_TIMESTAMP_PATTERN.exec(value);
  if (match === null) {
    fail('invalid_timestamp', path);
  }
  const year = timestampPart(match, 1, path);
  const month = timestampPart(match, 2, path);
  const day = timestampPart(match, 3, path);
  const hour = timestampPart(match, 4, path);
  const minute = timestampPart(match, 5, path);
  const second = timestampPart(match, 6, path);
  const zone = requiredTimestampPart(match, 8, path);
  if (
    year < 1 ||
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > daysInMonth(year, month) ||
    hour > 23 ||
    minute > 59 ||
    second > 59
  ) {
    fail('invalid_timestamp', path);
  }
  if (zone !== 'Z') {
    const offsetHour = timestampPart(match, 10, path);
    const offsetMinute = timestampPart(match, 11, path);
    if (
      offsetHour > 14 ||
      offsetMinute > 59 ||
      (offsetHour === 14 && offsetMinute !== 0)
    ) {
      fail('invalid_timestamp', path);
    }
  }
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds)) {
    fail('invalid_timestamp', path);
  }
}

function timestampPart(
  match: RegExpExecArray,
  index: number,
  path: string,
): number {
  return Number(requiredTimestampPart(match, index, path));
}

function requiredTimestampPart(
  match: RegExpExecArray,
  index: number,
  path: string,
): string {
  const value = match[index];
  if (value === undefined) {
    fail('invalid_timestamp', path);
  }
  return value;
}

function daysInMonth(year: number, month: number): number {
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  return (
    [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][
      month - 1
    ] ?? 0
  );
}

function validateUuid(value: unknown, path: string): void {
  if (typeof value !== 'string' || !UUID_PATTERN.test(value)) {
    fail('invalid_uuid', path);
  }
}

function validateSha256(value: unknown, path: string): void {
  if (typeof value !== 'string' || !SHA256_PATTERN.test(value)) {
    fail('invalid_digest', path);
  }
}

function validateNonNegativeInteger(value: number, path: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    fail('invalid_structure', path);
  }
}

function validateNonEmpty(value: string, path: string): void {
  if (typeof value !== 'string' || value.trim() === '') {
    fail('invalid_structure', path);
  }
}

function validateOptionalNonEmpty(
  value: string | undefined,
  path: string,
): void {
  if (value !== undefined) {
    validateNonEmpty(value, path);
  }
}

function validateWorkspace(
  actual: string,
  expected: string,
  path: string,
): void {
  validateUuid(actual, `${path}.workspaceId`);
  if (actual !== expected) {
    fail('workspace_mismatch', `${path}.workspaceId`);
  }
}

function mediaUsagePositionKey(
  usage: Readonly<MediaUsageInput>,
  supersededUsageId: string | undefined,
): string {
  return [
    usage.resourceId,
    usage.snapshotId,
    usage.structureId,
    usage.nodeId,
    String(usage.ordinal),
    supersededUsageId ?? '<root>',
  ].join('\u0000');
}

function sameMediaUsagePosition(
  left: Readonly<
    Pick<
      MediaUsageInput,
      | 'workspaceId'
      | 'resourceId'
      | 'snapshotId'
      | 'structureId'
      | 'nodeId'
      | 'ordinal'
    >
  >,
  right: Readonly<
    Pick<
      MediaUsageInput,
      | 'workspaceId'
      | 'resourceId'
      | 'snapshotId'
      | 'structureId'
      | 'nodeId'
      | 'ordinal'
    >
  >,
): boolean {
  return (
    left.workspaceId === right.workspaceId &&
    left.resourceId === right.resourceId &&
    left.snapshotId === right.snapshotId &&
    left.structureId === right.structureId &&
    left.nodeId === right.nodeId &&
    left.ordinal === right.ordinal
  );
}

function immutableCapturesEqual(
  left: ValidatedCaptureEvidence,
  right: ValidatedCaptureEvidence,
): boolean {
  return isDeepStrictEqual(normalizeCapture(left), normalizeCapture(right));
}

function normalizeCapture(input: ValidatedCaptureEvidence): object {
  return {
    workspaceId: input.workspaceId,
    blobs: sortBy(input.blobs, (blob) => blob.blobId),
    resource: input.resource,
    gitResource: input.gitResource,
    snapshot: input.snapshot,
    gitObservations: sortBy(
      input.gitObservations,
      (observation) => observation.observationId,
    ),
    structure: {
      workspaceId: input.structure.workspaceId,
      structureId: input.structure.structureId,
      resourceId: input.structure.resourceId,
      snapshotId: input.structure.snapshotId,
      parserName: input.structure.parserName,
      parserVersion: input.structure.parserVersion,
      textNormalizationVersion: input.structure.textNormalizationVersion,
      textBlob: input.structure.textBlob,
      structureSha256: input.structure.structureSha256,
      fragments: sortBy(
        input.structure.fragments,
        (fragment) => fragment.fragmentId,
      ),
      nodes: sortBy(input.structure.nodes, (node) => node.nodeId),
    },
    mediaAssets: sortBy(input.mediaAssets, (asset) => asset.mediaAssetId),
    mediaUsages: sortBy(input.mediaUsages, (usage) => usage.mediaUsageId),
  };
}

function createValidatedCapture(
  input: Readonly<CaptureEvidenceInput>,
): ValidatedCaptureEvidence {
  return deepFreeze({
    workspaceId: input.workspaceId,
    commandIdempotencyKey: input.commandIdempotencyKey,
    blobs: input.blobs,
    resource: input.resource,
    ...(input.gitResource === undefined
      ? {}
      : {gitResource: input.gitResource}),
    snapshot: input.snapshot,
    gitObservations: input.gitObservations,
    structure: {
      workspaceId: input.structure.workspaceId,
      structureId: input.structure.structureId,
      resourceId: input.structure.resourceId,
      snapshotId: input.structure.snapshotId,
      parserName: input.structure.parserName,
      parserVersion: input.structure.parserVersion,
      textNormalizationVersion: input.structure.textNormalizationVersion,
      textBlob: input.structure.textBlob,
      structureSha256: input.structure.structureSha256,
      nodes: input.structure.nodes,
      fragments: input.structure.fragments,
    },
    mediaAssets: input.mediaAssets,
    mediaUsages: input.mediaUsages,
  });
}

function validateImmutableEvidenceRecord(input: unknown):
  | Readonly<{
      status: 'validated';
      value: Readonly<ImmutableEvidenceRecord>;
    }>
  | Readonly<{
      status: 'validation_failed';
      issue: Readonly<EvidenceValidationIssue>;
    }> {
  try {
    const decoded = decodeImmutableEvidenceRecord(input);
    validateImmutableRecordShape(decoded);
    return Object.freeze({
      status: 'validated' as const,
      value: deepFreeze(decoded),
    });
  } catch (error) {
    const issue =
      error instanceof EvidenceValidationFault
        ? {code: error.code, path: error.path}
        : error instanceof ClosedInputDecodeError
          ? {code: error.code, path: error.path}
          : {code: 'invalid_shape' as const, path: 'immutableRecord'};
    return Object.freeze({
      status: 'validation_failed' as const,
      issue: Object.freeze(issue),
    });
  }
}

function validateImmutableRecordShape(
  record: Readonly<ImmutableEvidenceRecord>,
): void {
  if (typeof record.workspaceId !== 'string') {
    fail('invalid_shape', 'immutableRecord.workspaceId');
  }
  validateUuid(record.workspaceId, 'immutableRecord.workspaceId');
  const entityKind: unknown = (
    record as unknown as Readonly<{entityKind?: unknown}>
  ).entityKind;
  if (
    typeof entityKind !== 'string' ||
    !isOneOf(IMMUTABLE_EVIDENCE_ENTITY_KINDS, entityKind)
  ) {
    fail('invalid_shape', 'immutableRecord.entityKind');
  }
  if (typeof record.stableId !== 'string') {
    fail('invalid_shape', 'immutableRecord.stableId');
  }
  validateUuid(record.stableId, 'immutableRecord.stableId');
  if (!isArray(record.naturalIdentity) || record.naturalIdentity.length === 0) {
    fail('invalid_shape', 'immutableRecord.naturalIdentity');
  }
  if (!isArray(record.immutableContent)) {
    fail('invalid_shape', 'immutableRecord.immutableContent');
  }
  for (const value of record.naturalIdentity) {
    validateImmutableScalar(value, 'immutableRecord.naturalIdentity');
  }
  for (const value of record.immutableContent) {
    validateImmutableScalar(value, 'immutableRecord.immutableContent');
  }
}

function validateImmutableScalar(value: unknown, path: string): void {
  if (
    value !== null &&
    typeof value !== 'string' &&
    typeof value !== 'boolean' &&
    (typeof value !== 'number' || !Number.isFinite(value))
  ) {
    fail('invalid_shape', path);
  }
}

function deepFreeze<Value>(value: Value): Value {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) {
    return value;
  }
  const record = value as unknown as Readonly<Record<string, unknown>>;
  for (const child of Object.values(record)) {
    deepFreeze(child);
  }
  return Object.freeze(value);
}

function sortBy<T>(values: readonly T[], key: (value: T) => string): T[] {
  return [...values].sort((left, right) => key(left).localeCompare(key(right)));
}

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function isOneOf<const Values extends readonly string[]>(
  values: Values,
  candidate: unknown,
): candidate is Values[number] {
  return (
    typeof candidate === 'string' && values.some((value) => value === candidate)
  );
}

function runtimeDigestAlgorithm(
  identity: Readonly<ExactBlobIdentity>,
): unknown {
  return (identity as unknown as Readonly<{digestAlgorithm?: unknown}>)
    .digestAlgorithm;
}

function isArray(value: unknown): boolean {
  return Array.isArray(value);
}

function fail(code: EvidenceValidationCode, path: string): never {
  throw new EvidenceValidationFault(code, path);
}
