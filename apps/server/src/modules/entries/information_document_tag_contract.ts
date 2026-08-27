import type {CurrentInformationEntry} from './information_entry_contract.js';

export const INFORMATION_DOCUMENT_TAG_ORIGINS = [
  'aggregate',
  'manual',
] as const;

export const INFORMATION_DOCUMENT_TAG_REVISION_KINDS = [
  'aggregate',
  'manual',
] as const;

export type InformationDocumentTagOrigin =
  (typeof INFORMATION_DOCUMENT_TAG_ORIGINS)[number];
export type InformationDocumentTagRevisionKind =
  (typeof INFORMATION_DOCUMENT_TAG_REVISION_KINDS)[number];

export interface InformationDocumentTag {
  readonly displayValue: string;
  readonly normalizedValue: string;
  readonly origin: InformationDocumentTagOrigin;
  readonly fullTextOccurrences: number;
  readonly entryCoverageCount: number;
}

export interface InformationDocumentTagRevisionValue {
  readonly revisionKind: InformationDocumentTagRevisionKind;
  readonly ruleVersion: string;
  readonly isPrivate: boolean;
  readonly entryCount: number;
  readonly tags: readonly Readonly<InformationDocumentTag>[];
}

export interface CurrentInformationDocumentTags {
  readonly workspaceId: string;
  readonly resourceId: string;
  readonly snapshotId: string;
  readonly revision: number;
  readonly revisionId: string;
  readonly value: Readonly<InformationDocumentTagRevisionValue>;
}

export interface InformationDocumentTagWrite {
  readonly workspaceId: string;
  readonly resourceId: string;
  readonly snapshotId: string;
  readonly expectedRevision: number;
  readonly revisionId: string;
  readonly value: Readonly<InformationDocumentTagRevisionValue>;
}

export interface InformationEntryDocumentView {
  readonly workspaceId: string;
  readonly resourceId: string;
  readonly snapshotId: string;
  readonly resourceKind:
    'git_file' | 'manual_text' | 'uploaded_file' | 'remote_document';
  readonly sourceKey: string;
  readonly canonicalUri?: string;
  readonly isPrivate?: true;
  readonly capturedAt: string;
  readonly fragmentCount: number;
  readonly entryCount: number;
  readonly annotatedEntryCount: number;
  readonly currentTags?: Readonly<CurrentInformationDocumentTags>;
  readonly workingCopy?: Readonly<{
    readonly sourceSnapshotId: string;
    readonly revision: number;
    readonly state: 'editing' | 'committed';
    readonly bodySha256: string;
    readonly derivedResourceId?: string;
    readonly derivedSnapshotId?: string;
  }>;
  readonly derivedFromSnapshotId?: string;
}

export interface InformationDocumentAggregationInput {
  readonly normalizedText: string;
  readonly isPrivate: boolean;
  readonly entries: readonly Readonly<CurrentInformationEntry>[];
}
