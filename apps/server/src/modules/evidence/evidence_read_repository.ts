import type {
  CodePointRange,
  DocumentNodeKind,
  LineRange,
  PublicationInput,
  ResourceKind,
} from './evidence_contract.js';

export const EVIDENCE_SNAPSHOT_LIST_LIMIT = 200;

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
  listSnapshots(
    workspaceId: string,
  ): Promise<readonly Readonly<EvidenceSnapshotSummary>[]>;

  loadSnapshot(
    workspaceId: string,
    snapshotId: string,
  ): Promise<Readonly<EvidenceSnapshotReadState> | undefined>;
}
