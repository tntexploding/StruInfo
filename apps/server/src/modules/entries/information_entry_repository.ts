import type {
  CurrentInformationEntry,
  InformationEntryMaterializeRow,
  InformationEntryRevisionWrite,
} from './information_entry_contract.js';
import type {
  InformationEntryRestructureLineage,
  InformationEntryRestructureOverrideTransfer,
  InformationEntryRestructureSuccessor,
  InformationEntryStructureExpectedEntry,
  InformationEntryStructureExpectedOverride,
} from './information_entry_restructuring.js';
import type {InformationEntryAssociationProjection} from './information_entry_association_contract.js';
import type {InformationDocumentTagRevisionValue} from './information_document_tag_contract.js';

export type InformationEntryMaterializeOutcome = 'created' | 'existing';
export type InformationEntryEmptySnapshotMaterializeOutcome =
  InformationEntryMaterializeOutcome | 'snapshot_not_empty';
export type InformationEntryRevisionOutcome =
  'applied' | 'unchanged' | 'not_found' | 'stale';

export interface InformationEntryMaterializeResult {
  readonly outcome: InformationEntryMaterializeOutcome;
  readonly createdCount: number;
}

export interface InformationEntryEmptySnapshotMaterializeResult {
  readonly outcome: InformationEntryEmptySnapshotMaterializeOutcome;
  readonly createdCount: number;
}

export interface InformationEntryRepositoryPort {
  materializeEntries(
    entries: readonly Readonly<InformationEntryMaterializeRow>[],
  ): Promise<Readonly<InformationEntryMaterializeResult>>;

  reviseEntry(
    write: Readonly<InformationEntryRevisionWrite>,
  ): Promise<InformationEntryRevisionOutcome>;

  loadCurrentEntries(
    workspaceId: string,
    includePrivate: boolean,
  ): Promise<readonly Readonly<CurrentInformationEntry>[]>;
}

export interface InformationEntryEmptySnapshotRepositoryPort extends InformationEntryRepositoryPort {
  materializeEntriesIfSnapshotEmpty(
    entries: readonly Readonly<InformationEntryMaterializeRow>[],
  ): Promise<Readonly<InformationEntryEmptySnapshotMaterializeResult>>;
}

export type InformationEntryRestructureOutcome =
  'applied' | 'unchanged' | 'stale';

export interface InformationEntryRestructureWrite {
  readonly workspaceId: string;
  readonly snapshotId: string;
  readonly includePrivate: boolean;
  readonly expectedEntries: readonly Readonly<InformationEntryStructureExpectedEntry>[];
  readonly expectedOverrides: readonly Readonly<InformationEntryStructureExpectedOverride>[];
  readonly successors: readonly Readonly<InformationEntryRestructureSuccessor>[];
  readonly retiredEntryIds: readonly string[];
  readonly lineage: readonly Readonly<InformationEntryRestructureLineage>[];
  readonly overrideTransfers: readonly Readonly<InformationEntryRestructureOverrideTransfer>[];
  readonly projections: readonly Readonly<InformationEntryAssociationProjection>[];
  readonly documentTags?: Readonly<{
    resourceId: string;
    expectedRevision: number;
    revisionId: string;
    value: Readonly<InformationDocumentTagRevisionValue>;
  }>;
}

export interface InformationEntryRestructureRepositoryPort {
  applyEntryRestructure(
    write: Readonly<InformationEntryRestructureWrite>,
  ): Promise<InformationEntryRestructureOutcome>;
}
