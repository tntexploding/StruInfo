import {deriveUuidV5} from './information_entry_identity.js';

export function deriveInformationDocumentTagRevisionId(
  snapshotId: string,
  revision: number,
): string {
  if (!Number.isSafeInteger(revision) || revision < 1) {
    throw new Error('Information Document tag revision is invalid.');
  }
  return deriveUuidV5(
    snapshotId,
    `struinfo:information-document-tag-revision:v1:${revision.toString()}`,
  );
}
