import {createHash} from 'node:crypto';
import {TextEncoder} from 'node:util';

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;
const textEncoder = new TextEncoder();

export function deriveInformationEntryId(
  snapshotId: string,
  structureId: string,
  sourceIdentity: string,
): string {
  return deriveUuidV5(
    snapshotId,
    `struinfo:information-entry:v1:split:${structureId}:${sourceIdentity}`,
  );
}

export function deriveInformationEntryRevisionId(
  entryId: string,
  revision: number,
): string {
  if (!Number.isSafeInteger(revision) || revision < 1) {
    throw new Error('Information Entry revision is invalid.');
  }
  return deriveUuidV5(
    entryId,
    `struinfo:information-entry-revision:v1:${revision.toString()}`,
  );
}

export function informationEntryBodySha256(body: string): string {
  return createHash('sha256').update(body, 'utf8').digest('hex');
}

export function deriveUuidV5(namespace: string, name: string): string {
  if (!UUID_PATTERN.test(namespace)) {
    throw new Error('Information Entry UUID namespace is invalid.');
  }
  const digest = createHash('sha1')
    .update(Buffer.from(namespace.replaceAll('-', ''), 'hex'))
    .update(textEncoder.encode(name))
    .digest();
  const bytes = Uint8Array.from(digest.subarray(0, 16));
  const versionByte = bytes[6];
  const variantByte = bytes[8];
  if (versionByte === undefined || variantByte === undefined) {
    throw new Error('Information Entry UUID digest is incomplete.');
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
