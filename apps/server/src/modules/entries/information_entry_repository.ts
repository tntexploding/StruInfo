import type {
  CurrentInformationEntry,
  InformationEntryMaterializeRow,
  InformationEntryRevisionWrite,
} from './information_entry_contract.js';

export type InformationEntryMaterializeOutcome = 'created' | 'existing';
export type InformationEntryRevisionOutcome =
  'applied' | 'unchanged' | 'not_found' | 'stale';

export interface InformationEntryMaterializeResult {
  readonly outcome: InformationEntryMaterializeOutcome;
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
