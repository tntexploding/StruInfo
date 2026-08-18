import {createHash} from 'node:crypto';

import {encodeCanonicalJson} from '../../serialization/canonical_json.js';
import type {
  CaptureEvidenceInput,
  EvidenceWriteResult,
  ValidatedCaptureEvidence,
} from './evidence_contract.js';
import {validateEvidenceCapture} from './evidence_validation.js';

const MAXIMUM_CAPTURE_PROJECTION_BYTES = 32 * 1024 * 1024;

export type EvidenceRepositoryFailureCode =
  'transaction_failed' | 'unavailable';

export class EvidenceRepositoryError extends Error {
  public readonly code: EvidenceRepositoryFailureCode;

  public constructor(code: EvidenceRepositoryFailureCode) {
    super('Evidence repository operation failed.');
    this.name = 'EvidenceRepositoryError';
    this.code = code;
  }
}

export interface EvidenceCaptureRepositoryRequest {
  readonly capture: ValidatedCaptureEvidence;
  readonly requestSha256: string;
}

export type EvidenceCaptureRepositoryResult = Readonly<{
  status: 'created' | 'existing' | 'conflict';
}>;

export interface EvidenceRepositoryPort {
  saveCapture(
    request: Readonly<EvidenceCaptureRepositoryRequest>,
  ): Promise<EvidenceCaptureRepositoryResult>;
}

export async function executeCaptureEvidence(
  repository: EvidenceRepositoryPort,
  input: unknown,
): Promise<EvidenceWriteResult> {
  const validation = validateEvidenceCapture(input);
  if (validation.status === 'validation_failed') {
    return Object.freeze({
      status: 'validation_failed' as const,
      code: validation.issue.code,
      path: validation.issue.path,
    });
  }

  let requestSha256: string;
  try {
    requestSha256 = computeEvidenceCaptureRequestSha256(validation.value);
  } catch {
    return Object.freeze({
      status: 'persistence_failed' as const,
      code: 'transaction_failed' as const,
    });
  }

  try {
    const result = await repository.saveCapture({
      capture: validation.value,
      requestSha256,
    });
    if (result.status === 'conflict') {
      return Object.freeze({
        status: 'conflict' as const,
        code: 'immutable_content_conflict' as const,
        workspaceId: validation.value.workspaceId,
        commandIdempotencyKey: validation.value.commandIdempotencyKey,
      });
    }
    return Object.freeze({
      status: result.status,
      workspaceId: validation.value.workspaceId,
      commandIdempotencyKey: validation.value.commandIdempotencyKey,
    });
  } catch (error) {
    return Object.freeze({
      status: 'persistence_failed' as const,
      code:
        error instanceof EvidenceRepositoryError
          ? error.code
          : ('transaction_failed' as const),
    });
  }
}

export function computeEvidenceCaptureRequestSha256(
  capture: ValidatedCaptureEvidence,
): string {
  const bytes = encodeCanonicalJson(
    captureDigestProjection(capture),
    MAXIMUM_CAPTURE_PROJECTION_BYTES,
  );
  return createHash('sha256').update(bytes).digest('hex');
}

function captureDigestProjection(capture: ValidatedCaptureEvidence): object {
  return {
    workspaceId: capture.workspaceId,
    blobs: sortBy(capture.blobs, (blob) => blob.blobId),
    resource: capture.resource,
    ...(capture.gitResource === undefined
      ? {}
      : {gitResource: capture.gitResource}),
    snapshot: capture.snapshot,
    gitObservations: sortBy(
      capture.gitObservations,
      (observation) => observation.observationId,
    ),
    structure: {
      workspaceId: capture.structure.workspaceId,
      structureId: capture.structure.structureId,
      resourceId: capture.structure.resourceId,
      snapshotId: capture.structure.snapshotId,
      parserName: capture.structure.parserName,
      parserVersion: capture.structure.parserVersion,
      textNormalizationVersion: capture.structure.textNormalizationVersion,
      textBlob: capture.structure.textBlob,
      structureSha256: capture.structure.structureSha256,
      nodes: sortBy(capture.structure.nodes, (node) => node.nodeId),
      fragments: sortBy(
        capture.structure.fragments,
        (fragment) => fragment.fragmentId,
      ),
    },
    mediaAssets: sortBy(capture.mediaAssets, (asset) => asset.mediaAssetId),
    mediaUsages: sortBy(capture.mediaUsages, (usage) => usage.mediaUsageId),
  };
}

function sortBy<Value>(
  values: readonly Value[],
  key: (value: Value) => string,
): Value[] {
  return [...values].sort((left, right) => compareText(key(left), key(right)));
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

export type {CaptureEvidenceInput};
