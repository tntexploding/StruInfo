import type {
  InformationEntryAssociationOverrideWrite,
  InformationEntryAssociationProjection,
  InformationEntryAssociationRepositorySnapshot,
} from './information_entry_association_contract.js';

export type InformationEntryAssociationOverrideOutcome =
  'applied' | 'unchanged' | 'not_found' | 'stale';

export interface InformationEntryAssociationRepositoryPort {
  replaceAssociationProjections(
    workspaceId: string,
    projections: readonly Readonly<InformationEntryAssociationProjection>[],
    includePrivate: boolean,
  ): Promise<number>;

  loadAssociationSnapshot(
    workspaceId: string,
    includePrivate: boolean,
  ): Promise<Readonly<InformationEntryAssociationRepositorySnapshot>>;

  writeAssociationOverride(
    write: Readonly<InformationEntryAssociationOverrideWrite>,
  ): Promise<InformationEntryAssociationOverrideOutcome>;
}
