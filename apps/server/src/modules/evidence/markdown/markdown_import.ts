import {createHash} from 'node:crypto';

import type {
  GitResourceInput,
  GitSnapshotObservationInput,
  PublicationInput,
  ResourceInput,
  SnapshotInput,
} from '../evidence_contract.js';
import {
  executeCaptureEvidence,
  type EvidenceRepositoryPort,
} from '../evidence_repository.js';
import {
  BlobStoreError,
  type BlobIdentity,
  type BlobStore,
} from '../../../storage/blob_store.js';
import {
  type MarkdownIssue,
  type MarkdownProfile,
  type ParsedMarkdownDocument,
} from './markdown_contract.js';
import {deriveEvidenceBlobId} from './markdown_identity.js';
import {materializeMarkdownEvidence} from './markdown_materializer.js';
import {parseMarkdownStructure} from './markdown_parser.js';

export interface MarkdownSnapshotMetadata {
  readonly workspaceId: string;
  readonly snapshotId: string;
  readonly resourceId: string;
  readonly capturedAt: string;
  readonly mediaType?: string;
  readonly publication?: Readonly<PublicationInput>;
}

export interface ImportMarkdownEvidenceInput {
  readonly workspaceId: string;
  readonly commandIdempotencyKey: string;
  readonly resource: Readonly<ResourceInput>;
  readonly gitResource?: Readonly<GitResourceInput>;
  readonly snapshot: Readonly<MarkdownSnapshotMetadata>;
  readonly gitObservations: readonly Readonly<GitSnapshotObservationInput>[];
  readonly profile: MarkdownProfile;
  readonly sourceUtf8: Uint8Array;
  /**
   * Optional exact source bytes when sourceUtf8 is a deterministic textual
   * projection. Original bytes remain the Snapshot raw Blob while the
   * projection continues through the accepted Markdown materializer.
   */
  readonly rawSourceBytes?: Uint8Array;
  readonly documentBaseUri?: string;
}

export interface MarkdownImportDependencies {
  readonly blobStore: BlobStore;
  readonly evidenceRepository: EvidenceRepositoryPort;
}

interface MarkdownImportReceipt {
  readonly workspaceId: string;
  readonly commandIdempotencyKey: string;
  readonly resourceId: string;
  readonly snapshotId: string;
  readonly structureId: string;
  readonly fragmentIds: readonly string[];
  readonly mediaAssetIds: readonly string[];
  readonly isPrivate?: true;
}

export type ImportMarkdownEvidenceResult =
  | (Readonly<{status: 'created' | 'existing'}> & MarkdownImportReceipt)
  | Readonly<{
      status: 'validation_failed';
      code: string;
      path: string;
      budget?: string;
    }>
  | Readonly<{
      status: 'conflict';
      code: 'immutable_content_conflict';
      workspaceId: string;
      commandIdempotencyKey: string;
    }>
  | Readonly<{
      status: 'persistence_failed';
      code: 'transaction_failed' | 'unavailable';
    }>;

export async function importMarkdownEvidence(
  dependencies: Readonly<MarkdownImportDependencies>,
  input: Readonly<ImportMarkdownEvidenceInput>,
): Promise<ImportMarkdownEvidenceResult> {
  const rawSourceBytes = input.rawSourceBytes ?? input.sourceUtf8;
  let rawPhysicalBlob: Readonly<BlobIdentity>;
  let projectionPhysicalBlob: Readonly<BlobIdentity>;
  try {
    rawPhysicalBlob = await dependencies.blobStore.put(rawSourceBytes);
    projectionPhysicalBlob =
      rawSourceBytes === input.sourceUtf8 ||
      (rawPhysicalBlob.byteLength === input.sourceUtf8.byteLength &&
        rawPhysicalBlob.digest === digestBytes(input.sourceUtf8))
        ? rawPhysicalBlob
        : await dependencies.blobStore.put(input.sourceUtf8);
  } catch (error) {
    return mapBlobFailure(error);
  }

  const rawBlob = Object.freeze({
    workspaceId: input.workspaceId,
    blobId: deriveEvidenceBlobId(input.workspaceId, rawPhysicalBlob.digest),
    digestAlgorithm: 'sha256' as const,
    digest: rawPhysicalBlob.digest,
    byteLength: rawPhysicalBlob.byteLength,
  });
  const projectionBlob = Object.freeze({
    workspaceId: input.workspaceId,
    blobId: deriveEvidenceBlobId(
      input.workspaceId,
      projectionPhysicalBlob.digest,
    ),
    digestAlgorithm: 'sha256' as const,
    digest: projectionPhysicalBlob.digest,
    byteLength: projectionPhysicalBlob.byteLength,
  });
  const parsed = parseMarkdownStructure({
    workspaceId: input.workspaceId,
    resourceId: input.resource.resourceId,
    snapshotId: input.snapshot.snapshotId,
    rawBlob: projectionBlob,
    profile: input.profile,
    sourceUtf8: input.sourceUtf8,
    ...(input.documentBaseUri === undefined
      ? {}
      : {documentBaseUri: input.documentBaseUri}),
  });
  if (parsed.status === 'rejected') {
    return markdownIssueResult(parsed.issue);
  }

  const projectionSnapshot = createSnapshot(
    input.snapshot,
    projectionBlob,
    parsed.value,
  );
  const materialized = materializeMarkdownEvidence({
    parsed: parsed.value,
    snapshot: projectionSnapshot,
    mediaPolicy: 'external_reference_only',
    sourceUtf8: input.sourceUtf8,
  });
  if (materialized.status === 'rejected') {
    return markdownIssueResult(materialized.issue);
  }

  const normalizedIdentity = await persistNormalizedText(
    dependencies.blobStore,
    projectionPhysicalBlob,
    materialized.value.structure.normalizedTextUtf8,
  );
  if (normalizedIdentity.status === 'failed') {
    return normalizedIdentity.result;
  }
  if (
    normalizedIdentity.value.digest !== materialized.value.textBlob.digest ||
    normalizedIdentity.value.byteLength !==
      materialized.value.textBlob.byteLength
  ) {
    return Object.freeze({
      status: 'persistence_failed' as const,
      code: 'unavailable' as const,
    });
  }

  const rawEvidenceBlob = Object.freeze({
    ...rawBlob,
    ...(input.snapshot.mediaType === undefined
      ? {}
      : {mediaType: input.snapshot.mediaType}),
  });
  const blobs =
    rawEvidenceBlob.blobId === materialized.value.textBlob.blobId
      ? [rawEvidenceBlob]
      : [rawEvidenceBlob, materialized.value.textBlob];
  const snapshot = createSnapshot(input.snapshot, rawBlob, parsed.value);
  const writeResult = await executeCaptureEvidence(
    dependencies.evidenceRepository,
    {
      workspaceId: input.workspaceId,
      commandIdempotencyKey: input.commandIdempotencyKey,
      blobs,
      resource: input.resource,
      ...(input.gitResource === undefined
        ? {}
        : {gitResource: input.gitResource}),
      snapshot,
      gitObservations: input.gitObservations,
      structure: materialized.value.structure,
      mediaAssets: materialized.value.mediaAssets,
      mediaUsages: materialized.value.mediaUsages,
    },
  );
  if (writeResult.status === 'validation_failed') {
    return Object.freeze({...writeResult});
  }
  if (writeResult.status === 'conflict') {
    return Object.freeze({...writeResult});
  }
  if (writeResult.status === 'persistence_failed') {
    return Object.freeze({...writeResult});
  }

  return Object.freeze({
    status: writeResult.status,
    workspaceId: writeResult.workspaceId,
    commandIdempotencyKey: writeResult.commandIdempotencyKey,
    resourceId: input.resource.resourceId,
    snapshotId: input.snapshot.snapshotId,
    structureId: materialized.value.structure.structureId,
    fragmentIds: Object.freeze(
      materialized.value.structure.fragments.map(
        (fragment) => fragment.fragmentId,
      ),
    ),
    mediaAssetIds: Object.freeze(
      materialized.value.mediaAssets.map((asset) => asset.mediaAssetId),
    ),
    ...(input.resource.isPrivate === true ? {isPrivate: true as const} : {}),
  });
}

function createSnapshot(
  metadata: Readonly<MarkdownSnapshotMetadata>,
  rawBlob: Readonly<{
    workspaceId: string;
    blobId: string;
    digestAlgorithm: 'sha256';
    digest: string;
    byteLength: number;
  }>,
  parsed: Readonly<ParsedMarkdownDocument>,
): SnapshotInput {
  return Object.freeze({
    workspaceId: metadata.workspaceId,
    snapshotId: metadata.snapshotId,
    resourceId: metadata.resourceId,
    rawSha256: rawBlob.digest,
    rawBlob,
    canonicalContentSha256: parsed.normalizedTextSha256,
    canonicalizationVersion: parsed.textNormalizationVersion,
    ...(metadata.mediaType === undefined
      ? {}
      : {mediaType: metadata.mediaType}),
    ...(metadata.publication === undefined
      ? {}
      : {publication: metadata.publication}),
    capturedAt: metadata.capturedAt,
  });
}

async function persistNormalizedText(
  blobStore: BlobStore,
  rawIdentity: Readonly<BlobIdentity>,
  normalizedTextUtf8: Uint8Array,
): Promise<
  | Readonly<{status: 'stored'; value: Readonly<BlobIdentity>}>
  | Readonly<{
      status: 'failed';
      result: Extract<
        ImportMarkdownEvidenceResult,
        {status: 'validation_failed' | 'persistence_failed'}
      >;
    }>
> {
  if (
    rawIdentity.byteLength === normalizedTextUtf8.byteLength &&
    rawIdentity.digest === digestBytes(normalizedTextUtf8)
  ) {
    return Object.freeze({status: 'stored' as const, value: rawIdentity});
  }
  try {
    return Object.freeze({
      status: 'stored' as const,
      value: await blobStore.put(normalizedTextUtf8),
    });
  } catch (error) {
    return Object.freeze({
      status: 'failed' as const,
      result: mapBlobFailure(error),
    });
  }
}

function markdownIssueResult(
  issue: Readonly<MarkdownIssue>,
): ImportMarkdownEvidenceResult {
  return Object.freeze({
    status: 'validation_failed' as const,
    code: issue.code,
    path: issue.path,
    ...(issue.budget === undefined ? {} : {budget: issue.budget}),
  });
}

function mapBlobFailure(
  error: unknown,
): Extract<
  ImportMarkdownEvidenceResult,
  {status: 'validation_failed' | 'persistence_failed'}
> {
  if (
    error instanceof BlobStoreError &&
    (error.code === 'input_invalid' || error.code === 'input_too_large')
  ) {
    return Object.freeze({
      status: 'validation_failed' as const,
      code: error.code,
      path: 'sourceUtf8',
    });
  }
  return Object.freeze({
    status: 'persistence_failed' as const,
    code: 'unavailable' as const,
  });
}

function digestBytes(bytes: Uint8Array): string {
  // The Blob port is content-addressed; this local check only avoids a second
  // idempotent write when raw and normalized Markdown bytes are identical.
  return createHash('sha256').update(bytes).digest('hex');
}
