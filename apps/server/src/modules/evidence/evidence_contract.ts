export const BLOB_DIGEST_ALGORITHM = 'sha256' as const;

export const RESOURCE_KINDS = [
  'git_file',
  'manual_text',
  'uploaded_file',
  'remote_document',
] as const;
export type ResourceKind = (typeof RESOURCE_KINDS)[number];

export const PUBLICATION_PRECISIONS = [
  'year',
  'month',
  'day',
  'hour',
  'minute',
  'second',
] as const;
export type PublicationPrecision = (typeof PUBLICATION_PRECISIONS)[number];

export const DOCUMENT_NODE_KINDS = [
  'document',
  'section',
  'heading',
  'paragraph',
  'blockquote',
  'list',
  'list_item',
  'code_block',
  'table',
  'table_row',
  'table_cell',
  'image',
  'thematic_break',
] as const;
export type DocumentNodeKind = (typeof DOCUMENT_NODE_KINDS)[number];

export const MEDIA_PURPOSES = [
  'cover',
  'concept_explanation',
  'data_visualization',
  'screenshot',
  'example',
  'decorative',
  'unknown',
] as const;
export type MediaPurpose = (typeof MEDIA_PURPOSES)[number];

export const MEDIA_PURPOSE_ORIGINS = [
  'source_statement',
  'deterministic_parser',
  'ai_inference',
  'user_confirmation',
  'unknown',
] as const;
export type MediaPurposeOrigin = (typeof MEDIA_PURPOSE_ORIGINS)[number];

export interface ExactBlobIdentity {
  readonly workspaceId: string;
  readonly blobId: string;
  readonly digestAlgorithm: typeof BLOB_DIGEST_ALGORITHM;
  readonly digest: string;
  readonly byteLength: number;
}

export interface EvidenceBlobInput extends ExactBlobIdentity {
  readonly mediaType?: string;
}

export interface ResourceInput {
  readonly workspaceId: string;
  readonly resourceId: string;
  readonly resourceKind: ResourceKind;
  readonly sourceKey: string;
  readonly canonicalUri?: string;
  /** Present only when this resource belongs to the private-document scope. */
  readonly isPrivate?: true;
}

export interface GitResourceInput {
  readonly workspaceId: string;
  readonly resourceId: string;
  readonly canonicalRepositoryUri: string;
  readonly repositoryRelativePath: string;
}

export interface PublicationInput {
  readonly instant?: string;
  readonly sourceTimezone?: string;
  readonly precision?: PublicationPrecision;
  readonly sourceText?: string;
  readonly inferred: boolean;
}

export interface SnapshotInput {
  readonly workspaceId: string;
  readonly snapshotId: string;
  readonly resourceId: string;
  readonly rawSha256: string;
  readonly rawBlob?: Readonly<ExactBlobIdentity>;
  readonly canonicalContentSha256: string;
  readonly canonicalizationVersion: string;
  readonly mediaType?: string;
  readonly publication?: Readonly<PublicationInput>;
  readonly capturedAt: string;
}

export type GitObjectIdentity =
  | Readonly<{algorithm: 'sha1'; digest: string}>
  | Readonly<{algorithm: 'sha256'; digest: string}>;

export interface GitSnapshotObservationInput {
  readonly workspaceId: string;
  readonly observationId: string;
  readonly resourceId: string;
  readonly snapshotId: string;
  readonly repositoryRef: string;
  readonly commit: GitObjectIdentity;
  readonly blobObject?: GitObjectIdentity;
  readonly observedAt: string;
}

export interface CodePointRange {
  readonly start: number;
  readonly end: number;
}

export interface LineRange {
  readonly start: number;
  readonly end: number;
}

export interface DocumentNodeInput {
  readonly workspaceId: string;
  readonly resourceId: string;
  readonly snapshotId: string;
  readonly structureId: string;
  readonly nodeId: string;
  readonly parentNodeId?: string;
  readonly kind: DocumentNodeKind;
  readonly siblingOrdinal: number;
  readonly codePointRange: Readonly<CodePointRange>;
  readonly lineRange?: Readonly<LineRange>;
}

export interface FragmentInput {
  readonly workspaceId: string;
  readonly fragmentId: string;
  readonly resourceId: string;
  readonly snapshotId: string;
  readonly structureId: string;
  readonly nodeId: string;
  readonly textBlob: Readonly<ExactBlobIdentity>;
  readonly locatorKind: 'unicode_code_point_range';
  readonly locatorVersion: 1;
  readonly codePointRange: Readonly<CodePointRange>;
  readonly lineRange?: Readonly<LineRange>;
  readonly selectedTextSha256: string;
}

export interface DocumentStructureInput {
  readonly workspaceId: string;
  readonly structureId: string;
  readonly resourceId: string;
  readonly snapshotId: string;
  readonly parserName: string;
  readonly parserVersion: string;
  readonly textNormalizationVersion: string;
  readonly textBlob: Readonly<ExactBlobIdentity>;
  readonly structureSha256: string;
  /** Ephemeral validation bytes; repositories must not persist them in rows. */
  readonly normalizedTextUtf8: Uint8Array;
  readonly nodes: readonly Readonly<DocumentNodeInput>[];
  readonly fragments: readonly Readonly<FragmentInput>[];
}

export interface MediaDimensions {
  readonly width: number;
  readonly height: number;
}

interface MediaAssetBaseInput {
  readonly workspaceId: string;
  readonly mediaAssetId: string;
  readonly originalUri?: string;
  readonly mediaType?: string;
  readonly dimensions?: Readonly<MediaDimensions>;
}

export interface StoredMediaAssetInput extends MediaAssetBaseInput {
  readonly storageMode: 'stored_blob';
  readonly blob: Readonly<ExactBlobIdentity>;
}

export interface ExternalMediaAssetInput extends MediaAssetBaseInput {
  readonly storageMode: 'external_reference';
  readonly originalUri: string;
}

export type MediaAssetInput =
  Readonly<StoredMediaAssetInput> | Readonly<ExternalMediaAssetInput>;

export interface SupersededMediaUsageReference {
  readonly workspaceId: string;
  readonly mediaUsageId: string;
  readonly resourceId: string;
  readonly snapshotId: string;
  readonly structureId: string;
  readonly nodeId: string;
  readonly ordinal: number;
}

export interface MediaUsageInput {
  readonly workspaceId: string;
  readonly mediaUsageId: string;
  readonly mediaAssetId: string;
  readonly resourceId: string;
  readonly snapshotId: string;
  readonly structureId: string;
  readonly nodeId: string;
  readonly ordinal: number;
  readonly purpose: MediaPurpose;
  readonly purposeOrigin: MediaPurposeOrigin;
  readonly confidence?: number;
  readonly supersededUsage?: Readonly<SupersededMediaUsageReference>;
}

export interface CaptureEvidenceInput {
  readonly workspaceId: string;
  readonly commandIdempotencyKey: string;
  readonly blobs: readonly Readonly<EvidenceBlobInput>[];
  readonly resource: Readonly<ResourceInput>;
  readonly gitResource?: Readonly<GitResourceInput>;
  readonly snapshot: Readonly<SnapshotInput>;
  readonly gitObservations: readonly Readonly<GitSnapshotObservationInput>[];
  readonly structure: Readonly<DocumentStructureInput>;
  readonly mediaAssets: readonly MediaAssetInput[];
  readonly mediaUsages: readonly Readonly<MediaUsageInput>[];
}

export type ValidatedDocumentStructure = Readonly<
  Omit<DocumentStructureInput, 'normalizedTextUtf8'>
>;

export type ValidatedCaptureEvidence = Readonly<
  Omit<CaptureEvidenceInput, 'structure'> & {
    readonly structure: ValidatedDocumentStructure;
  }
>;

export const IMMUTABLE_EVIDENCE_ENTITY_KINDS = [
  'evidence_blob',
  'resource',
  'git_resource',
  'snapshot',
  'git_snapshot_observation',
  'document_structure',
  'document_node',
  'fragment',
  'media_asset',
  'media_usage',
] as const;
export type ImmutableEvidenceEntityKind =
  (typeof IMMUTABLE_EVIDENCE_ENTITY_KINDS)[number];

export type ImmutableEvidenceScalar = string | number | boolean | null;

/**
 * Pure in-memory comparison material for the pre-repository identity probe.
 *
 * These scalar tuples are not a SQL unique-constraint definition and are not
 * a complete oracle for PostgreSQL NULL, collation, numeric, or type semantics.
 * A later repository must project each entity's frozen natural identity and
 * immutable content explicitly.
 */
export interface ImmutableEvidenceRecord {
  readonly workspaceId: string;
  readonly entityKind: ImmutableEvidenceEntityKind;
  readonly stableId: string;
  readonly naturalIdentity: readonly ImmutableEvidenceScalar[];
  readonly immutableContent: readonly ImmutableEvidenceScalar[];
}

export type EvidenceWriteResult =
  | Readonly<{
      status: 'created' | 'existing';
      workspaceId: string;
      commandIdempotencyKey: string;
    }>
  | Readonly<{
      status: 'validation_failed';
      code: string;
      path: string;
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
