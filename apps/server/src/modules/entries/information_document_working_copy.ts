import {createHash} from 'node:crypto';

import {deriveUuidV5} from './information_entry_identity.js';

export const INFORMATION_DOCUMENT_WORKING_COPY_MAX_BYTES = 1_048_576;
export const INFORMATION_DOCUMENT_EDIT_RULE_VERSION =
  'struinfo.document-edit.owner.v1' as const;

export type InformationDocumentWorkingCopyState = 'editing' | 'committed';

export interface InformationDocumentWorkingCopy {
  readonly workspaceId: string;
  readonly sourceSnapshotId: string;
  readonly revision: number;
  readonly state: InformationDocumentWorkingCopyState;
  readonly bodySha256: string;
  readonly draftBody?: string;
  readonly derivedResourceId?: string;
  readonly derivedSnapshotId?: string;
}

export type InformationDocumentWorkingCopySummary = Omit<
  InformationDocumentWorkingCopy,
  'draftBody'
>;

export interface InformationDocumentWorkingCopySave {
  readonly workspaceId: string;
  readonly sourceSnapshotId: string;
  readonly expectedRevision: number;
  readonly draftBody: string;
  readonly bodySha256: string;
}

export interface InformationDocumentWorkingCopyCommit {
  readonly workspaceId: string;
  readonly sourceSnapshotId: string;
  readonly expectedRevision: number;
  readonly bodySha256: string;
  readonly derivedResourceId: string;
  readonly derivedSnapshotId: string;
}

export type InformationDocumentWorkingCopyWriteResult = Readonly<{
  outcome:
    'applied' | 'unchanged' | 'stale' | 'committed' | 'source_materialized';
  value?: Readonly<InformationDocumentWorkingCopy>;
}>;

export type InformationDocumentWorkingCopyRestoreResult =
  'restored' | 'not_found' | 'stale' | 'committed';

export type InformationDocumentWorkingCopyCommitResult = Readonly<{
  outcome:
    'committed' | 'existing' | 'not_found' | 'stale' | 'source_materialized';
  value?: Readonly<InformationDocumentWorkingCopy>;
}>;

export interface InformationDocumentWorkingCopyRepositoryPort {
  load(
    workspaceId: string,
    sourceSnapshotId: string,
  ): Promise<Readonly<InformationDocumentWorkingCopy> | undefined>;
  list(
    workspaceId: string,
  ): Promise<readonly Readonly<InformationDocumentWorkingCopySummary>[]>;
  save(
    write: Readonly<InformationDocumentWorkingCopySave>,
  ): Promise<InformationDocumentWorkingCopyWriteResult>;
  restore(
    workspaceId: string,
    sourceSnapshotId: string,
    expectedRevision: number,
  ): Promise<InformationDocumentWorkingCopyRestoreResult>;
  commit(
    write: Readonly<InformationDocumentWorkingCopyCommit>,
  ): Promise<InformationDocumentWorkingCopyCommitResult>;
}

export interface ValidatedInformationDocumentWorkingCopyText {
  readonly text: string;
  readonly utf8Bytes: number;
  readonly sha256: string;
}

export function validateInformationDocumentWorkingCopyText(
  value: unknown,
): Readonly<ValidatedInformationDocumentWorkingCopyText> | undefined {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.includes('\u0000') ||
    hasUnpairedSurrogate(value)
  ) {
    return undefined;
  }
  const bytes = new TextEncoder().encode(value);
  if (
    bytes.byteLength === 0 ||
    bytes.byteLength > INFORMATION_DOCUMENT_WORKING_COPY_MAX_BYTES
  ) {
    return undefined;
  }
  return Object.freeze({
    text: value,
    utf8Bytes: bytes.byteLength,
    sha256: createHash('sha256').update(bytes).digest('hex'),
  });
}

export function deriveEditedInformationDocumentResourceId(
  sourceSnapshotId: string,
): string {
  return deriveUuidV5(
    sourceSnapshotId,
    'struinfo:edited-information-document-resource:v1',
  );
}

export function deriveEditedInformationDocumentSnapshotId(
  sourceSnapshotId: string,
  bodySha256: string,
): string {
  return deriveUuidV5(
    sourceSnapshotId,
    `struinfo:edited-information-document-snapshot:v1:${bodySha256}`,
  );
}

function hasUnpairedSurrogate(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      if (index + 1 >= value.length) return true;
      const next = value.charCodeAt(index + 1);
      if (next < 0xdc00 || next > 0xdfff) return true;
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      return true;
    }
  }
  return false;
}
