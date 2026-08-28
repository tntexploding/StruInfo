import {createHash} from 'node:crypto';
import {TextEncoder} from 'node:util';

export const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;
export const SHA256_PATTERN = /^[0-9a-f]{64}$/u;

const textEncoder = new TextEncoder();

export function deriveEvidenceBlobId(
  workspaceId: string,
  digest: string,
): string {
  return deriveUuidV5(
    workspaceId,
    `struinfo:evidence-blob:v1:sha256:${digest}`,
  );
}

export function deriveDocumentStructureId(
  snapshotId: string,
  parserName: string,
  parserVersion: string,
  normalizationVersion: string,
  structureDigest: string,
): string {
  return deriveUuidV5(
    snapshotId,
    `struinfo:document-structure:v1:${parserName}:${parserVersion}:${normalizationVersion}:${structureDigest}`,
  );
}

export function deriveDocumentNodeId(
  structureId: string,
  localKey: string,
): string {
  return deriveUuidV5(structureId, `struinfo:document-node:v1:${localKey}`);
}

export function deriveFragmentId(
  structureId: string,
  localKey: string,
): string {
  return deriveUuidV5(structureId, `struinfo:fragment:v1:${localKey}`);
}

export function deriveMediaAssetId(
  structureId: string,
  localKey: string,
): string {
  return deriveUuidV5(structureId, `struinfo:media-asset:v1:${localKey}`);
}

export function deriveMediaUsageId(
  structureId: string,
  localKey: string,
): string {
  return deriveUuidV5(structureId, `struinfo:media-usage:v1:${localKey}`);
}

export function deriveUuidV5(namespace: string, name: string): string {
  if (!UUID_PATTERN.test(namespace)) {
    throw new Error('UUID version 5 namespace is invalid.');
  }
  const digest = createHash('sha1')
    .update(uuidToBytes(namespace))
    .update(textEncoder.encode(name))
    .digest();
  const bytes = Uint8Array.from(digest.subarray(0, 16));
  const versionByte = bytes[6];
  const variantByte = bytes[8];
  if (versionByte === undefined || variantByte === undefined) {
    throw new Error('UUID version 5 digest is incomplete.');
  }
  bytes[6] = (versionByte & 0x0f) | 0x50;
  bytes[8] = (variantByte & 0x3f) | 0x80;
  const hex = Buffer.from(bytes).toString('hex');
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20),
  ].join('-');
}

function uuidToBytes(uuid: string): Uint8Array {
  return Uint8Array.from(Buffer.from(uuid.replaceAll('-', ''), 'hex'));
}
