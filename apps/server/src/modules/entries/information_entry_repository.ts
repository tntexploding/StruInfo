import type {
  CurrentInformationEntry,
  InformationEntryMaterializeRow,
  InformationEntryRevisionWrite,
} from './information_entry_contract.js';

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
