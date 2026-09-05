import type {
  CodePointRange,
  DocumentNodeKind,
  LineRange,
  PublicationInput,
  ResourceKind,
} from './evidence_contract.js';

export const EVIDENCE_SNAPSHOT_PAGE_LIMIT = 200;
/** @deprecated Use EVIDENCE_SNAPSHOT_PAGE_LIMIT for bounded public pages. */
export const EVIDENCE_SNAPSHOT_LIST_LIMIT = EVIDENCE_SNAPSHOT_PAGE_LIMIT;

export interface EvidenceSnapshotPageCursor {
  readonly capturedAt: string;
  readonly snapshotId: string;
}

export interface EvidenceSnapshotPageRequest {
  readonly limit: number;
  readonly after?: Readonly<EvidenceSnapshotPageCursor>;
}

export interface EvidenceSnapshotPage {
  readonly items: readonly Readonly<EvidenceSnapshotSummary>[];
  readonly totalCount: number;
  readonly nextCursor?: Readonly<EvidenceSnapshotPageCursor>;
}

export interface EvidenceSnapshotSummary {
  readonly workspaceId: string;
  readonly snapshotId: string;
  readonly resourceId: string;
  readonly resourceKind: ResourceKind;
  readonly sourceKey: string;
  readonly canonicalUri?: string;
  readonly isPrivate?: true;
  readonly capturedAt: string;
  readonly publication?: Readonly<PublicationInput>;
  readonly fragmentCount: number;
}

export interface EvidenceFragmentReadState {
  readonly fragmentId: string;
  readonly structureId: string;
  readonly nodeId: string;
  readonly nodeKind: DocumentNodeKind;
  readonly codePointRange: Readonly<CodePointRange>;
  readonly lineRange?: Readonly<LineRange>;
  readonly selectedTextSha256: string;
}

export interface EvidenceStructureReadState {
  readonly structureId: string;
  readonly parserName: string;
  readonly parserVersion: string;
  readonly textNormalizationVersion: string;
  readonly structureSha256: string;
  readonly textBlob: Readonly<{
    algorithm: 'sha256';
    digest: string;
    byteLength: number;
  }>;
  readonly fragments: readonly Readonly<EvidenceFragmentReadState>[];
}

export interface EvidenceSnapshotReadState extends EvidenceSnapshotSummary {
  readonly rawSha256: string;
  readonly canonicalContentSha256: string;
  readonly canonicalizationVersion: string;
  readonly mediaType?: string;
  readonly structures: readonly Readonly<EvidenceStructureReadState>[];
}

/** Read-only product projection for the evidence browser. */
export interface EvidenceReadRepositoryPort {
  /**
   * Loads the complete workspace projection for internal joins. Public list
   * endpoints should use listSnapshotPage when the adapter provides it.
   */
  listSnapshots(
    workspaceId: string,
  ): Promise<readonly Readonly<EvidenceSnapshotSummary>[]>;

  listSnapshotPage?(
    workspaceId: string,
    request: Readonly<EvidenceSnapshotPageRequest>,
  ): Promise<Readonly<EvidenceSnapshotPage>>;

  loadSnapshot(
    workspaceId: string,
    snapshotId: string,
  ): Promise<Readonly<EvidenceSnapshotReadState> | undefined>;
}
