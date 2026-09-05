import type {
  CurrentInformationEntry,
  InformationEntryTypeReviewRequest,
  InformationEntryTypeReviewResult,
  InformationEntryMaterializeRow,
  InformationEntryRevisionWrite,
  InformationEntrySearchCursor,
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

export interface InformationEntryBulkRevisionResult {
  readonly outcome: InformationEntryRevisionOutcome;
  readonly appliedCount: number;
}

export interface InformationEntryMaterializeResult {
  readonly outcome: InformationEntryMaterializeOutcome;
  readonly createdCount: number;
}

export type InformationEntryBrowsePrivacyScope = 'public' | 'all' | 'private';

export interface InformationEntryBrowsePage {
  readonly totalCount: number;
  readonly entries: readonly Readonly<CurrentInformationEntry>[];
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

  /**
   * Optional optimized hydration path for a closed set of current Entry ids.
   * Implementations that do not provide it keep the complete-load behavior.
   */
  loadCurrentEntriesByIds?(
    workspaceId: string,
    includePrivate: boolean,
    entryIds: readonly string[],
  ): Promise<readonly Readonly<CurrentInformationEntry>[]>;

  /**
   * Optional scale-aware page for an unfiltered chronological browse. The
   * cursor fields are the stable suffix used by the ordinary Entry search.
   */
  loadCurrentEntryBrowsePage?(
    workspaceId: string,
    privacyScope: InformationEntryBrowsePrivacyScope,
    limit: number,
    after?: Pick<
      InformationEntrySearchCursor,
      'capturedAt' | 'documentOrder' | 'entryId'
    >,
  ): Promise<Readonly<InformationEntryBrowsePage>>;

  /**
   * Optional scale-aware read used by the owner-facing type correction queue.
   * The pure fallback keeps synthetic and in-memory repositories compatible.
   */
  reviewCurrentEntryTypes?(
    request: Readonly<InformationEntryTypeReviewRequest>,
  ): Promise<Readonly<InformationEntryTypeReviewResult>>;
}

export interface InformationEntryEmptySnapshotRepositoryPort extends InformationEntryRepositoryPort {
  materializeEntriesIfSnapshotEmpty(
    entries: readonly Readonly<InformationEntryMaterializeRow>[],
  ): Promise<Readonly<InformationEntryEmptySnapshotMaterializeResult>>;
}

/**
 * Applies one closed set of current Entry revisions in a single workspace
 * transaction. The caller prepares every revision through the ordinary Entry
 * domain boundary; this port only batches the existing write semantics.
 */
export interface InformationEntryBulkRevisionRepositoryPort {
  reviseEntriesAtomically(
    writes: readonly Readonly<InformationEntryRevisionWrite>[],
  ): Promise<Readonly<InformationEntryBulkRevisionResult>>;
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
