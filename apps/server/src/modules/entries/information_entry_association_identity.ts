import {deriveUuidV5} from './information_entry_identity.js';

export function deriveInformationEntryAssociationOverrideRevisionId(
  entryLowId: string,
  entryHighId: string,
  revision: number,
): string {
  if (!Number.isSafeInteger(revision) || revision < 1) {
    throw new Error(
      'Information Entry association override revision is invalid.',
    );
  }
  return deriveUuidV5(
    entryLowId,
    `struinfo:information-entry-association-override:v1:${entryHighId}:${revision.toString()}`,
  );
}
