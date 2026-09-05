import type {InformationEntrySourceReviewPage} from './information_entry_source_review_list.js';
import type {InformationEntrySourceReviewRequest} from './information_entry_source_review.js';
import type {
  InformationEntryAssociationOverrideWrite,
  InformationEntryAssociationProjection,
  InformationEntryAssociationRepositorySnapshot,
} from './information_entry_association_contract.js';

export type InformationEntryAssociationOverrideOutcome =
  'applied' | 'unchanged' | 'not_found' | 'stale';

export interface InformationEntryAssociationRepositoryPort {
  loadSourceReviewPage?(
    workspaceId: string,
    request: Readonly<InformationEntrySourceReviewRequest>,
  ): Promise<Readonly<InformationEntrySourceReviewPage>>;

  replaceAssociationProjections(
    workspaceId: string,
    projections: readonly Readonly<InformationEntryAssociationProjection>[],
    includePrivate: boolean,
  ): Promise<number>;

  loadAssociationSnapshot(
    workspaceId: string,
    includePrivate: boolean,
  ): Promise<Readonly<InformationEntryAssociationRepositorySnapshot>>;

  /** Loads only current visible associations touching the supplied Entries. */
  loadAssociationSnapshotForEntries?(
    workspaceId: string,
    includePrivate: boolean,
    entryIds: readonly string[],
  ): Promise<Readonly<InformationEntryAssociationRepositorySnapshot>>;

  writeAssociationOverride(
    write: Readonly<InformationEntryAssociationOverrideWrite>,
  ): Promise<InformationEntryAssociationOverrideOutcome>;
}

/** Replaces only calculated projections touching the supplied source Entries. */
export interface InformationEntryAssociationIncrementalRepositoryPort {
  replaceAssociationProjectionsForEntries(
    workspaceId: string,
    sourceEntryIds: readonly string[],
    projections: readonly Readonly<InformationEntryAssociationProjection>[],
    includePrivate: boolean,
  ): Promise<number>;
}
