import {types as utilityTypes} from 'node:util';

import {copyOwnedByteView} from '../../serialization/owned_byte_view.js';
import {
  type CaptureEvidenceInput,
  type CodePointRange,
  type DocumentNodeInput,
  type DocumentStructureInput,
  type EvidenceBlobInput,
  type ExactBlobIdentity,
  type FragmentInput,
  type GitObjectIdentity,
  type GitResourceInput,
  type GitSnapshotObservationInput,
  type ImmutableEvidenceRecord,
  type ImmutableEvidenceScalar,
  type LineRange,
  type MediaAssetInput,
  type MediaDimensions,
  type MediaUsageInput,
  type PublicationInput,
  type ResourceInput,
  type SnapshotInput,
  type SupersededMediaUsageReference,
} from './evidence_contract.js';

const typedArrayPrototype = Object.getPrototypeOf(
  Uint8Array.prototype,
) as object;
const typedArrayBufferDescriptor = Object.getOwnPropertyDescriptor(
  typedArrayPrototype,
  'buffer',
);
const typedArrayByteOffsetDescriptor = Object.getOwnPropertyDescriptor(
  typedArrayPrototype,
  'byteOffset',
);
const typedArrayByteLengthDescriptor = Object.getOwnPropertyDescriptor(
  typedArrayPrototype,
  'byteLength',
);
const arrayBufferByteLengthDescriptor = Object.getOwnPropertyDescriptor(
  ArrayBuffer.prototype,
  'byteLength',
);
const arrayBufferResizableDescriptor = Object.getOwnPropertyDescriptor(
  ArrayBuffer.prototype,
  'resizable',
);
const arrayBufferDetachedDescriptor = Object.getOwnPropertyDescriptor(
  ArrayBuffer.prototype,
  'detached',
);

export type ClosedInputDecodeCode = 'invalid_shape' | 'invalid_utf8';

export class ClosedInputDecodeError extends Error {
  public readonly code: ClosedInputDecodeCode;
  public readonly path: string;

  public constructor(code: ClosedInputDecodeCode, path: string) {
    super('Evidence input decoding failed.');
    this.name = 'ClosedInputDecodeError';
    this.code = code;
    this.path = path;
  }
}

export function decodeCaptureEvidence(input: unknown): CaptureEvidenceInput {
  const value = inspectRecord(
    input,
    [
      'workspaceId',
      'commandIdempotencyKey',
      'blobs',
      'resource',
      'snapshot',
      'gitObservations',
      'structure',
      'mediaAssets',
      'mediaUsages',
    ],
    ['gitResource'],
    'capture',
  );
  const gitResource = optionalValue(value, 'gitResource');

  return {
    workspaceId: requiredString(value, 'workspaceId', 'workspaceId'),
    commandIdempotencyKey: requiredString(
      value,
      'commandIdempotencyKey',
      'commandIdempotencyKey',
    ),
    blobs: decodeArray(
      requiredValue(value, 'blobs', 'blobs'),
      'blobs',
      decodeEvidenceBlob,
    ),
    resource: decodeResource(
      requiredValue(value, 'resource', 'resource'),
      'resource',
    ),
    ...(gitResource === undefined
      ? {}
      : {gitResource: decodeGitResource(gitResource, 'gitResource')}),
    snapshot: decodeSnapshot(
      requiredValue(value, 'snapshot', 'snapshot'),
      'snapshot',
    ),
    gitObservations: decodeArray(
      requiredValue(value, 'gitObservations', 'gitObservations'),
      'gitObservations',
      decodeGitObservation,
    ),
    structure: decodeStructure(
      requiredValue(value, 'structure', 'structure'),
      'structure',
    ),
    mediaAssets: decodeArray(
      requiredValue(value, 'mediaAssets', 'mediaAssets'),
      'mediaAssets',
      decodeMediaAsset,
    ),
    mediaUsages: decodeArray(
      requiredValue(value, 'mediaUsages', 'mediaUsages'),
      'mediaUsages',
      decodeMediaUsage,
    ),
  };
}

export function decodeImmutableEvidenceRecord(
  input: unknown,
): ImmutableEvidenceRecord {
  const path = 'immutableRecord';
  const value = inspectRecord(
    input,
    [
      'workspaceId',
      'entityKind',
      'stableId',
      'naturalIdentity',
      'immutableContent',
    ],
    [],
    path,
  );
  return {
    workspaceId: requiredString(value, 'workspaceId', `${path}.workspaceId`),
    entityKind: requiredString(
      value,
      'entityKind',
      `${path}.entityKind`,
    ) as ImmutableEvidenceRecord['entityKind'],
    stableId: requiredString(value, 'stableId', `${path}.stableId`),
    naturalIdentity: decodeArray(
      requiredValue(value, 'naturalIdentity', `${path}.naturalIdentity`),
      `${path}.naturalIdentity`,
      decodeImmutableScalar,
    ),
    immutableContent: decodeArray(
      requiredValue(value, 'immutableContent', `${path}.immutableContent`),
      `${path}.immutableContent`,
      decodeImmutableScalar,
    ),
  };
}

function decodeEvidenceBlob(value: unknown, path: string): EvidenceBlobInput {
  const record = inspectRecord(
    value,
    ['workspaceId', 'blobId', 'digestAlgorithm', 'digest', 'byteLength'],
    ['mediaType'],
    path,
  );
  const mediaType = optionalString(record, 'mediaType', `${path}.mediaType`);
  return {
    ...decodeExactBlobFields(record, path),
    ...(mediaType === undefined ? {} : {mediaType}),
  };
}

function decodeExactBlob(value: unknown, path: string): ExactBlobIdentity {
  const record = inspectRecord(
    value,
    ['workspaceId', 'blobId', 'digestAlgorithm', 'digest', 'byteLength'],
    [],
    path,
  );
  return decodeExactBlobFields(record, path);
}

function decodeExactBlobFields(
  record: InspectedRecord,
  path: string,
): ExactBlobIdentity {
  return {
    workspaceId: requiredString(record, 'workspaceId', `${path}.workspaceId`),
    blobId: requiredString(record, 'blobId', `${path}.blobId`),
    digestAlgorithm: requiredString(
      record,
      'digestAlgorithm',
      `${path}.digestAlgorithm`,
    ) as ExactBlobIdentity['digestAlgorithm'],
    digest: requiredString(record, 'digest', `${path}.digest`),
    byteLength: requiredNumber(record, 'byteLength', `${path}.byteLength`),
  };
}

function decodeResource(value: unknown, path: string): ResourceInput {
  const record = inspectRecord(
    value,
    ['workspaceId', 'resourceId', 'resourceKind', 'sourceKey'],
    ['canonicalUri', 'isPrivate'],
    path,
  );
  const canonicalUri = optionalString(
    record,
    'canonicalUri',
    `${path}.canonicalUri`,
  );
  const isPrivate = optionalBoolean(record, 'isPrivate', `${path}.isPrivate`);
  return {
    workspaceId: requiredString(record, 'workspaceId', `${path}.workspaceId`),
    resourceId: requiredString(record, 'resourceId', `${path}.resourceId`),
    resourceKind: requiredString(
      record,
      'resourceKind',
      `${path}.resourceKind`,
    ) as ResourceInput['resourceKind'],
    sourceKey: requiredString(record, 'sourceKey', `${path}.sourceKey`),
    ...(canonicalUri === undefined ? {} : {canonicalUri}),
    ...(isPrivate === true ? {isPrivate: true as const} : {}),
  };
}

function decodeGitResource(value: unknown, path: string): GitResourceInput {
  const record = inspectRecord(
    value,
    [
      'workspaceId',
      'resourceId',
      'canonicalRepositoryUri',
      'repositoryRelativePath',
    ],
    [],
    path,
  );
  return {
    workspaceId: requiredString(record, 'workspaceId', `${path}.workspaceId`),
    resourceId: requiredString(record, 'resourceId', `${path}.resourceId`),
    canonicalRepositoryUri: requiredString(
      record,
      'canonicalRepositoryUri',
      `${path}.canonicalRepositoryUri`,
    ),
    repositoryRelativePath: requiredString(
      record,
      'repositoryRelativePath',
      `${path}.repositoryRelativePath`,
    ),
  };
}

function decodeSnapshot(value: unknown, path: string): SnapshotInput {
  const record = inspectRecord(
    value,
    [
      'workspaceId',
      'snapshotId',
      'resourceId',
      'rawSha256',
      'canonicalContentSha256',
      'canonicalizationVersion',
      'capturedAt',
    ],
    ['rawBlob', 'mediaType', 'publication'],
    path,
  );
  const rawBlob = optionalValue(record, 'rawBlob');
  const mediaType = optionalString(record, 'mediaType', `${path}.mediaType`);
  const publication = optionalValue(record, 'publication');
  return {
    workspaceId: requiredString(record, 'workspaceId', `${path}.workspaceId`),
    snapshotId: requiredString(record, 'snapshotId', `${path}.snapshotId`),
    resourceId: requiredString(record, 'resourceId', `${path}.resourceId`),
    rawSha256: requiredString(record, 'rawSha256', `${path}.rawSha256`),
    ...(rawBlob === undefined
      ? {}
      : {rawBlob: decodeExactBlob(rawBlob, `${path}.rawBlob`)}),
    canonicalContentSha256: requiredString(
      record,
      'canonicalContentSha256',
      `${path}.canonicalContentSha256`,
    ),
    canonicalizationVersion: requiredString(
      record,
      'canonicalizationVersion',
      `${path}.canonicalizationVersion`,
    ),
    ...(mediaType === undefined ? {} : {mediaType}),
    ...(publication === undefined
      ? {}
      : {publication: decodePublication(publication, `${path}.publication`)}),
    capturedAt: requiredString(record, 'capturedAt', `${path}.capturedAt`),
  };
}

function decodePublication(value: unknown, path: string): PublicationInput {
  const record = inspectRecord(
    value,
    ['inferred'],
    ['instant', 'sourceTimezone', 'precision', 'sourceText'],
    path,
  );
  const instant = optionalString(record, 'instant', `${path}.instant`);
  const sourceTimezone = optionalString(
    record,
    'sourceTimezone',
    `${path}.sourceTimezone`,
  );
  const precision = optionalString(record, 'precision', `${path}.precision`);
  const sourceText = optionalString(record, 'sourceText', `${path}.sourceText`);
  return {
    ...(instant === undefined ? {} : {instant}),
    ...(sourceTimezone === undefined ? {} : {sourceTimezone}),
    ...(precision === undefined
      ? {}
      : {precision: precision as NonNullable<PublicationInput['precision']>}),
    ...(sourceText === undefined ? {} : {sourceText}),
    inferred: requiredBoolean(record, 'inferred', `${path}.inferred`),
  };
}

function decodeGitObservation(
  value: unknown,
  path: string,
): GitSnapshotObservationInput {
  const record = inspectRecord(
    value,
    [
      'workspaceId',
      'observationId',
      'resourceId',
      'snapshotId',
      'repositoryRef',
      'commit',
      'observedAt',
    ],
    ['blobObject'],
    path,
  );
  const blobObject = optionalValue(record, 'blobObject');
  return {
    workspaceId: requiredString(record, 'workspaceId', `${path}.workspaceId`),
    observationId: requiredString(
      record,
      'observationId',
      `${path}.observationId`,
    ),
    resourceId: requiredString(record, 'resourceId', `${path}.resourceId`),
    snapshotId: requiredString(record, 'snapshotId', `${path}.snapshotId`),
    repositoryRef: requiredString(
      record,
      'repositoryRef',
      `${path}.repositoryRef`,
    ),
    commit: decodeGitObjectIdentity(
      requiredValue(record, 'commit', `${path}.commit`),
      `${path}.commit`,
    ),
    ...(blobObject === undefined
      ? {}
      : {
          blobObject: decodeGitObjectIdentity(blobObject, `${path}.blobObject`),
        }),
    observedAt: requiredString(record, 'observedAt', `${path}.observedAt`),
  };
}

function decodeGitObjectIdentity(
  value: unknown,
  path: string,
): GitObjectIdentity {
  const record = inspectRecord(value, ['algorithm', 'digest'], [], path);
  return {
    algorithm: requiredString(
      record,
      'algorithm',
      `${path}.algorithm`,
    ) as GitObjectIdentity['algorithm'],
    digest: requiredString(record, 'digest', `${path}.digest`),
  };
}

function decodeStructure(value: unknown, path: string): DocumentStructureInput {
  const record = inspectRecord(
    value,
    [
      'workspaceId',
      'structureId',
      'resourceId',
      'snapshotId',
      'parserName',
      'parserVersion',
      'textNormalizationVersion',
      'textBlob',
      'structureSha256',
      'normalizedTextUtf8',
      'nodes',
      'fragments',
    ],
    [],
    path,
  );
  return {
    workspaceId: requiredString(record, 'workspaceId', `${path}.workspaceId`),
    structureId: requiredString(record, 'structureId', `${path}.structureId`),
    resourceId: requiredString(record, 'resourceId', `${path}.resourceId`),
    snapshotId: requiredString(record, 'snapshotId', `${path}.snapshotId`),
    parserName: requiredString(record, 'parserName', `${path}.parserName`),
    parserVersion: requiredString(
      record,
      'parserVersion',
      `${path}.parserVersion`,
    ),
    textNormalizationVersion: requiredString(
      record,
      'textNormalizationVersion',
      `${path}.textNormalizationVersion`,
    ),
    textBlob: decodeExactBlob(
      requiredValue(record, 'textBlob', `${path}.textBlob`),
      `${path}.textBlob`,
    ),
    structureSha256: requiredString(
      record,
      'structureSha256',
      `${path}.structureSha256`,
    ),
    normalizedTextUtf8: decodeOwnedNormalizedBytes(
      requiredValue(record, 'normalizedTextUtf8', `${path}.normalizedTextUtf8`),
      `${path}.normalizedTextUtf8`,
    ),
    nodes: decodeArray(
      requiredValue(record, 'nodes', `${path}.nodes`),
      `${path}.nodes`,
      decodeDocumentNode,
    ),
    fragments: decodeArray(
      requiredValue(record, 'fragments', `${path}.fragments`),
      `${path}.fragments`,
      decodeFragment,
    ),
  };
}

function decodeDocumentNode(value: unknown, path: string): DocumentNodeInput {
  const record = inspectRecord(
    value,
    [
      'workspaceId',
      'resourceId',
      'snapshotId',
      'structureId',
      'nodeId',
      'kind',
      'siblingOrdinal',
      'codePointRange',
    ],
    ['parentNodeId', 'lineRange'],
    path,
  );
  const parentNodeId = optionalString(
    record,
    'parentNodeId',
    `${path}.parentNodeId`,
  );
  const lineRange = optionalValue(record, 'lineRange');
  return {
    workspaceId: requiredString(record, 'workspaceId', `${path}.workspaceId`),
    resourceId: requiredString(record, 'resourceId', `${path}.resourceId`),
    snapshotId: requiredString(record, 'snapshotId', `${path}.snapshotId`),
    structureId: requiredString(record, 'structureId', `${path}.structureId`),
    nodeId: requiredString(record, 'nodeId', `${path}.nodeId`),
    ...(parentNodeId === undefined ? {} : {parentNodeId}),
    kind: requiredString(
      record,
      'kind',
      `${path}.kind`,
    ) as DocumentNodeInput['kind'],
    siblingOrdinal: requiredNumber(
      record,
      'siblingOrdinal',
      `${path}.siblingOrdinal`,
    ),
    codePointRange: decodeCodePointRange(
      requiredValue(record, 'codePointRange', `${path}.codePointRange`),
      `${path}.codePointRange`,
    ),
    ...(lineRange === undefined
      ? {}
      : {lineRange: decodeLineRange(lineRange, `${path}.lineRange`)}),
  };
}

function decodeFragment(value: unknown, path: string): FragmentInput {
  const record = inspectRecord(
    value,
    [
      'workspaceId',
      'fragmentId',
      'resourceId',
      'snapshotId',
      'structureId',
      'nodeId',
      'textBlob',
      'locatorKind',
      'locatorVersion',
      'codePointRange',
      'selectedTextSha256',
    ],
    ['lineRange'],
    path,
  );
  const lineRange = optionalValue(record, 'lineRange');
  return {
    workspaceId: requiredString(record, 'workspaceId', `${path}.workspaceId`),
    fragmentId: requiredString(record, 'fragmentId', `${path}.fragmentId`),
    resourceId: requiredString(record, 'resourceId', `${path}.resourceId`),
    snapshotId: requiredString(record, 'snapshotId', `${path}.snapshotId`),
    structureId: requiredString(record, 'structureId', `${path}.structureId`),
    nodeId: requiredString(record, 'nodeId', `${path}.nodeId`),
    textBlob: decodeExactBlob(
      requiredValue(record, 'textBlob', `${path}.textBlob`),
      `${path}.textBlob`,
    ),
    locatorKind: requiredString(
      record,
      'locatorKind',
      `${path}.locatorKind`,
    ) as FragmentInput['locatorKind'],
    locatorVersion: requiredNumber(
      record,
      'locatorVersion',
      `${path}.locatorVersion`,
    ) as FragmentInput['locatorVersion'],
    codePointRange: decodeCodePointRange(
      requiredValue(record, 'codePointRange', `${path}.codePointRange`),
      `${path}.codePointRange`,
    ),
    ...(lineRange === undefined
      ? {}
      : {lineRange: decodeLineRange(lineRange, `${path}.lineRange`)}),
    selectedTextSha256: requiredString(
      record,
      'selectedTextSha256',
      `${path}.selectedTextSha256`,
    ),
  };
}

function decodeCodePointRange(value: unknown, path: string): CodePointRange {
  const record = inspectRecord(value, ['start', 'end'], [], path);
  return {
    start: requiredNumber(record, 'start', `${path}.start`),
    end: requiredNumber(record, 'end', `${path}.end`),
  };
}

function decodeLineRange(value: unknown, path: string): LineRange {
  const record = inspectRecord(value, ['start', 'end'], [], path);
  return {
    start: requiredNumber(record, 'start', `${path}.start`),
    end: requiredNumber(record, 'end', `${path}.end`),
  };
}

function decodeMediaAsset(value: unknown, path: string): MediaAssetInput {
  const record = inspectRecord(
    value,
    ['workspaceId', 'mediaAssetId', 'storageMode'],
    ['blob', 'originalUri', 'mediaType', 'dimensions'],
    path,
  );
  const storageMode = requiredString(
    record,
    'storageMode',
    `${path}.storageMode`,
  );
  const blobValue = optionalValue(record, 'blob');
  const originalUri = optionalString(
    record,
    'originalUri',
    `${path}.originalUri`,
  );
  const mediaType = optionalString(record, 'mediaType', `${path}.mediaType`);
  const dimensionsValue = optionalValue(record, 'dimensions');
  const common = {
    workspaceId: requiredString(record, 'workspaceId', `${path}.workspaceId`),
    mediaAssetId: requiredString(
      record,
      'mediaAssetId',
      `${path}.mediaAssetId`,
    ),
    ...(originalUri === undefined ? {} : {originalUri}),
    ...(mediaType === undefined ? {} : {mediaType}),
    ...(dimensionsValue === undefined
      ? {}
      : {
          dimensions: decodeMediaDimensions(
            dimensionsValue,
            `${path}.dimensions`,
          ),
        }),
  };

  if (storageMode === 'stored_blob') {
    return {
      ...common,
      storageMode,
      ...(blobValue === undefined
        ? {}
        : {blob: decodeExactBlob(blobValue, `${path}.blob`)}),
    } as MediaAssetInput;
  }
  if (storageMode === 'external_reference') {
    return {
      ...common,
      storageMode,
      ...(blobValue === undefined
        ? {}
        : {blob: decodeExactBlob(blobValue, `${path}.blob`)}),
    } as MediaAssetInput;
  }
  throw new ClosedInputDecodeError('invalid_shape', `${path}.storageMode`);
}

function decodeMediaDimensions(value: unknown, path: string): MediaDimensions {
  const record = inspectRecord(value, ['width', 'height'], [], path);
  return {
    width: requiredNumber(record, 'width', `${path}.width`),
    height: requiredNumber(record, 'height', `${path}.height`),
  };
}

function decodeMediaUsage(value: unknown, path: string): MediaUsageInput {
  const record = inspectRecord(
    value,
    [
      'workspaceId',
      'mediaUsageId',
      'mediaAssetId',
      'resourceId',
      'snapshotId',
      'structureId',
      'nodeId',
      'ordinal',
      'purpose',
      'purposeOrigin',
    ],
    ['confidence', 'supersededUsage'],
    path,
  );
  const confidence = optionalNumber(record, 'confidence', `${path}.confidence`);
  const supersededUsage = optionalValue(record, 'supersededUsage');
  return {
    workspaceId: requiredString(record, 'workspaceId', `${path}.workspaceId`),
    mediaUsageId: requiredString(
      record,
      'mediaUsageId',
      `${path}.mediaUsageId`,
    ),
    mediaAssetId: requiredString(
      record,
      'mediaAssetId',
      `${path}.mediaAssetId`,
    ),
    resourceId: requiredString(record, 'resourceId', `${path}.resourceId`),
    snapshotId: requiredString(record, 'snapshotId', `${path}.snapshotId`),
    structureId: requiredString(record, 'structureId', `${path}.structureId`),
    nodeId: requiredString(record, 'nodeId', `${path}.nodeId`),
    ordinal: requiredNumber(record, 'ordinal', `${path}.ordinal`),
    purpose: requiredString(
      record,
      'purpose',
      `${path}.purpose`,
    ) as MediaUsageInput['purpose'],
    purposeOrigin: requiredString(
      record,
      'purposeOrigin',
      `${path}.purposeOrigin`,
    ) as MediaUsageInput['purposeOrigin'],
    ...(confidence === undefined ? {} : {confidence}),
    ...(supersededUsage === undefined
      ? {}
      : {
          supersededUsage: decodeSupersededUsage(
            supersededUsage,
            `${path}.supersededUsage`,
          ),
        }),
  };
}

function decodeSupersededUsage(
  value: unknown,
  path: string,
): SupersededMediaUsageReference {
  const record = inspectRecord(
    value,
    [
      'workspaceId',
      'mediaUsageId',
      'resourceId',
      'snapshotId',
      'structureId',
      'nodeId',
      'ordinal',
    ],
    [],
    path,
  );
  return {
    workspaceId: requiredString(record, 'workspaceId', `${path}.workspaceId`),
    mediaUsageId: requiredString(
      record,
      'mediaUsageId',
      `${path}.mediaUsageId`,
    ),
    resourceId: requiredString(record, 'resourceId', `${path}.resourceId`),
    snapshotId: requiredString(record, 'snapshotId', `${path}.snapshotId`),
    structureId: requiredString(record, 'structureId', `${path}.structureId`),
    nodeId: requiredString(record, 'nodeId', `${path}.nodeId`),
    ordinal: requiredNumber(record, 'ordinal', `${path}.ordinal`),
  };
}

function decodeImmutableScalar(
  value: unknown,
  path: string,
): ImmutableEvidenceScalar {
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'boolean' ||
    (typeof value === 'number' && Number.isFinite(value))
  ) {
    return value;
  }
  throw new ClosedInputDecodeError('invalid_shape', path);
}

function decodeOwnedNormalizedBytes(value: unknown, path: string): Uint8Array {
  if (value === null || typeof value !== 'object' || isProxy(value)) {
    throw new ClosedInputDecodeError('invalid_utf8', path);
  }
  try {
    if (
      !utilityTypes.isUint8Array(value) ||
      Object.getPrototypeOf(value) !== Uint8Array.prototype ||
      typedArrayBufferDescriptor?.get === undefined ||
      typedArrayByteOffsetDescriptor?.get === undefined ||
      typedArrayByteLengthDescriptor?.get === undefined ||
      arrayBufferByteLengthDescriptor?.get === undefined
    ) {
      throw new ClosedInputDecodeError('invalid_utf8', path);
    }

    const backingBuffer = typedArrayBufferDescriptor.get.call(
      value,
    ) as ArrayBufferLike;
    const byteOffset = typedArrayByteOffsetDescriptor.get.call(value) as number;
    const byteLength = typedArrayByteLengthDescriptor.get.call(value) as number;
    if (
      utilityTypes.isSharedArrayBuffer(backingBuffer) ||
      !utilityTypes.isArrayBuffer(backingBuffer)
    ) {
      throw new ClosedInputDecodeError('invalid_utf8', path);
    }
    const backingByteLength = arrayBufferByteLengthDescriptor.get.call(
      backingBuffer,
    ) as number;
    const resizable =
      arrayBufferResizableDescriptor?.get?.call(backingBuffer) === true;
    const detached =
      arrayBufferDetachedDescriptor?.get?.call(backingBuffer) === true;
    if (
      detached ||
      resizable ||
      byteOffset !== 0 ||
      byteLength !== backingByteLength
    ) {
      throw new ClosedInputDecodeError('invalid_utf8', path);
    }
    validateTypedArrayOwnProperties(value, byteLength, path);
    return copyOwnedByteView(value, byteLength);
  } catch (error) {
    if (error instanceof ClosedInputDecodeError) {
      throw error;
    }
    throw new ClosedInputDecodeError('invalid_utf8', path);
  }
}

function validateTypedArrayOwnProperties(
  value: object,
  byteLength: number,
  path: string,
): void {
  const keys = Reflect.ownKeys(value);
  if (keys.length !== byteLength) {
    throw new ClosedInputDecodeError('invalid_utf8', path);
  }
  const indexes = new Set<number>();
  for (const key of keys) {
    if (typeof key !== 'string' || !isCanonicalArrayIndex(key)) {
      throw new ClosedInputDecodeError('invalid_utf8', path);
    }
    const index = Number(key);
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (
      index >= byteLength ||
      descriptor === undefined ||
      !Object.hasOwn(descriptor, 'value')
    ) {
      throw new ClosedInputDecodeError('invalid_utf8', path);
    }
    indexes.add(index);
  }
  if (indexes.size !== byteLength) {
    throw new ClosedInputDecodeError('invalid_utf8', path);
  }
}

type InspectedRecord = Readonly<Record<string, unknown>>;

function inspectRecord(
  value: unknown,
  requiredKeys: readonly string[],
  optionalKeys: readonly string[],
  path: string,
): InspectedRecord {
  if (value === null || typeof value !== 'object' || isProxy(value)) {
    throw new ClosedInputDecodeError('invalid_shape', path);
  }

  let prototype: object | null;
  try {
    prototype = Reflect.getPrototypeOf(value);
  } catch {
    throw new ClosedInputDecodeError('invalid_shape', path);
  }
  if (prototype !== Object.prototype) {
    throw new ClosedInputDecodeError('invalid_shape', path);
  }
  let keys: readonly PropertyKey[];
  try {
    keys = Reflect.ownKeys(value);
  } catch {
    throw new ClosedInputDecodeError('invalid_shape', path);
  }

  const allowed = new Set([...requiredKeys, ...optionalKeys]);
  const descriptors: (readonly [string, PropertyDescriptor])[] = [];
  for (const key of keys) {
    if (typeof key !== 'string') {
      throw new ClosedInputDecodeError('invalid_shape', path);
    }
    const keyPath = propertyPath(path, key);
    if (key === '__proto__' || key === 'constructor' || !allowed.has(key)) {
      throw new ClosedInputDecodeError('invalid_shape', keyPath);
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor === undefined || !Object.hasOwn(descriptor, 'value')) {
      throw new ClosedInputDecodeError('invalid_shape', keyPath);
    }
    descriptors.push([key, descriptor]);
  }
  const present = new Set(descriptors.map(([key]) => key));
  for (const key of requiredKeys) {
    if (!present.has(key)) {
      throw new ClosedInputDecodeError(
        'invalid_shape',
        propertyPath(path, key),
      );
    }
  }

  const result: Record<string, unknown> = {};
  for (const [key, descriptor] of descriptors) {
    Object.defineProperty(result, key, {
      value: descriptor.value as unknown,
      enumerable: true,
      configurable: false,
      writable: false,
    });
  }
  return result;
}

function decodeArray<Value>(
  value: unknown,
  path: string,
  decodeItem: (item: unknown, path: string) => Value,
): readonly Value[] {
  if (value === null || typeof value !== 'object' || isProxy(value)) {
    throw new ClosedInputDecodeError('invalid_shape', path);
  }

  let prototype: object | null;
  try {
    prototype = Reflect.getPrototypeOf(value);
  } catch {
    throw new ClosedInputDecodeError('invalid_shape', path);
  }
  if (!Array.isArray(value) || prototype !== Array.prototype) {
    throw new ClosedInputDecodeError('invalid_shape', path);
  }
  let keys: readonly PropertyKey[];
  try {
    keys = Reflect.ownKeys(value);
  } catch {
    throw new ClosedInputDecodeError('invalid_shape', path);
  }

  const indexDescriptors = new Map<number, PropertyDescriptor>();
  let lengthDescriptor: PropertyDescriptor | undefined;
  for (const key of keys) {
    if (typeof key !== 'string') {
      throw new ClosedInputDecodeError('invalid_shape', path);
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor === undefined || !Object.hasOwn(descriptor, 'value')) {
      throw new ClosedInputDecodeError(
        'invalid_shape',
        propertyPath(path, key),
      );
    }
    if (key === 'length') {
      lengthDescriptor = descriptor;
      continue;
    }
    if (
      key === '__proto__' ||
      key === 'constructor' ||
      !isCanonicalArrayIndex(key)
    ) {
      throw new ClosedInputDecodeError(
        'invalid_shape',
        propertyPath(path, key),
      );
    }
    indexDescriptors.set(Number(key), descriptor);
  }

  const length = lengthDescriptor?.value as unknown;
  if (
    typeof length !== 'number' ||
    !Number.isSafeInteger(length) ||
    length < 0 ||
    indexDescriptors.size !== length ||
    [...indexDescriptors.keys()].some((index) => index >= length)
  ) {
    throw new ClosedInputDecodeError('invalid_shape', path);
  }
  return [...indexDescriptors.entries()]
    .sort(([left], [right]) => left - right)
    .map(([index, descriptor]) =>
      decodeItem(descriptor.value, `${path}[${String(index)}]`),
    );
}

function requiredValue(
  record: InspectedRecord,
  key: string,
  path: string,
): unknown {
  if (!Object.hasOwn(record, key)) {
    throw new ClosedInputDecodeError('invalid_shape', path);
  }
  return record[key];
}

function optionalValue(record: InspectedRecord, key: string): unknown {
  return Object.hasOwn(record, key) ? record[key] : undefined;
}

function requiredString(
  record: InspectedRecord,
  key: string,
  path: string,
): string {
  const value = requiredValue(record, key, path);
  if (typeof value !== 'string') {
    throw new ClosedInputDecodeError('invalid_shape', path);
  }
  return value;
}

function optionalString(
  record: InspectedRecord,
  key: string,
  path: string,
): string | undefined {
  const value = optionalValue(record, key);
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== 'string') {
    throw new ClosedInputDecodeError('invalid_shape', path);
  }
  return value;
}

function requiredNumber(
  record: InspectedRecord,
  key: string,
  path: string,
): number {
  const value = requiredValue(record, key, path);
  if (typeof value !== 'number') {
    throw new ClosedInputDecodeError('invalid_shape', path);
  }
  return value;
}

function optionalNumber(
  record: InspectedRecord,
  key: string,
  path: string,
): number | undefined {
  const value = optionalValue(record, key);
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== 'number') {
    throw new ClosedInputDecodeError('invalid_shape', path);
  }
  return value;
}

function requiredBoolean(
  record: InspectedRecord,
  key: string,
  path: string,
): boolean {
  const value = requiredValue(record, key, path);
  if (typeof value !== 'boolean') {
    throw new ClosedInputDecodeError('invalid_shape', path);
  }
  return value;
}

function optionalBoolean(
  record: InspectedRecord,
  key: string,
  path: string,
): boolean | undefined {
  const value = optionalValue(record, key);
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== 'boolean') {
    throw new ClosedInputDecodeError('invalid_shape', path);
  }
  return value;
}

function isCanonicalArrayIndex(value: string): boolean {
  if (!/^(?:0|[1-9][0-9]*)$/u.test(value)) {
    return false;
  }
  const index = Number(value);
  return Number.isSafeInteger(index) && index >= 0 && String(index) === value;
}

function propertyPath(path: string, key: string): string {
  return path === 'capture' ? key : `${path}.${key}`;
}

function isProxy(value: object): boolean {
  try {
    return utilityTypes.isProxy(value);
  } catch {
    return true;
  }
}
