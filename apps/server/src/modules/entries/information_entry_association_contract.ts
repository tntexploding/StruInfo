import type {CurrentInformationEntry} from './information_entry_contract.js';

export const INFORMATION_ENTRY_ASSOCIATION_ACTIONS = [
  'enhance',
  'weaken',
  'block',
  'restore',
] as const;

export const INFORMATION_ENTRY_ASSOCIATION_BASES = [
  'content_keyword',
  'text_term',
  'type_keyword',
  'domain_keyword',
] as const;

export const INFORMATION_ENTRY_GRAPH_ORIGINS = [
  'association',
  'user',
  'ai',
] as const;

export const INFORMATION_ENTRY_GRAPH_DIRECTIONS = [
  'symmetric',
  'low_to_high',
  'high_to_low',
] as const;

export const INFORMATION_ENTRY_GRAPH_SEMANTIC_KINDS = [
  'similarity',
  'related',
  'supports',
  'contradicts',
  'part_of',
  'causes',
  'example_of',
  'custom',
] as const;

export const INFORMATION_ENTRY_GRAPH_VERIFICATION_STATUSES = [
  'unreviewed',
  'source_checked',
  'needs_review',
] as const;

export type InformationEntryAssociationAction =
  (typeof INFORMATION_ENTRY_ASSOCIATION_ACTIONS)[number];
export type InformationEntryAssociationBasis =
  (typeof INFORMATION_ENTRY_ASSOCIATION_BASES)[number];
export type InformationEntryGraphOrigin =
  (typeof INFORMATION_ENTRY_GRAPH_ORIGINS)[number];
export type InformationEntryGraphDirection =
  (typeof INFORMATION_ENTRY_GRAPH_DIRECTIONS)[number];
export type InformationEntryGraphSemanticKind =
  (typeof INFORMATION_ENTRY_GRAPH_SEMANTIC_KINDS)[number];
export type InformationEntryGraphVerificationStatus =
  (typeof INFORMATION_ENTRY_GRAPH_VERIFICATION_STATUSES)[number];
export type InformationEntryGraphEdgeVerificationStatus =
  InformationEntryGraphVerificationStatus | 'calculated';

export interface InformationEntryGraphRelationValue {
  readonly origin: InformationEntryGraphOrigin;
  readonly label: string;
  readonly direction: InformationEntryGraphDirection;
  readonly semanticKind: InformationEntryGraphSemanticKind;
  readonly verificationStatus: InformationEntryGraphVerificationStatus;
  readonly note: string;
}

export interface InformationEntryAssociationPolicy {
  readonly revision: number;
  readonly version: string;
  readonly contentWeight: number;
  readonly typeWeight: number;
  readonly domainWeight: number;
  readonly threshold: number;
  readonly candidateLimit: number;
  readonly adjustmentStep: number;
}

export interface InformationEntryAssociationProjection {
  readonly workspaceId: string;
  readonly entryLowId: string;
  readonly entryHighId: string;
  readonly entryLowRevision: number;
  readonly entryLowRevisionId: string;
  readonly entryHighRevision: number;
  readonly entryHighRevisionId: string;
  readonly contentSimilarity: number;
  readonly typeSimilarity: number;
  readonly domainSimilarity: number;
  readonly baseScore: number;
  readonly algorithmVersion: string;
  readonly candidateBasis: readonly InformationEntryAssociationBasis[];
  readonly candidateRank: number;
}

export interface InformationEntryAssociationOverrideValue {
  readonly action: InformationEntryAssociationAction;
  readonly manualAdjustment: number;
  readonly isBlocked: boolean;
  readonly graph?: Readonly<InformationEntryGraphRelationValue>;
}

export interface CurrentInformationEntryAssociationOverride {
  readonly workspaceId: string;
  readonly entryLowId: string;
  readonly entryHighId: string;
  readonly revision: number;
  readonly revisionId: string;
  readonly value: Readonly<InformationEntryAssociationOverrideValue>;
}

export interface InformationEntryAssociationOverrideWrite {
  readonly workspaceId: string;
  readonly entryLowId: string;
  readonly entryHighId: string;
  readonly expectedRevision: number;
  readonly revisionId: string;
  readonly includePrivate: boolean;
  readonly value: Readonly<InformationEntryAssociationOverrideValue>;
}

export interface InformationEntryAssociationRepositorySnapshot {
  readonly projections: readonly Readonly<InformationEntryAssociationProjection>[];
  readonly overrides: readonly Readonly<CurrentInformationEntryAssociationOverride>[];
}

export interface InformationEntryAssociationView {
  readonly relatedEntry: Readonly<CurrentInformationEntry>;
  readonly projection?: Readonly<InformationEntryAssociationProjection>;
  readonly override?: Readonly<CurrentInformationEntryAssociationOverride>;
  readonly effectiveScore: number;
  readonly isBlocked: boolean;
}

export type InformationEntryGraphEdgeOrigin =
  'automatically_calculated' | 'user_edited' | 'user_created' | 'ai_assisted';

export interface InformationEntryGraphEdge {
  readonly entryLowId: string;
  readonly entryHighId: string;
  readonly label: string;
  readonly direction: InformationEntryGraphDirection;
  readonly origin: InformationEntryGraphEdgeOrigin;
  readonly semanticKind: InformationEntryGraphSemanticKind;
  readonly verificationStatus: InformationEntryGraphEdgeVerificationStatus;
  readonly note: string;
  readonly effectiveScore: number;
  readonly isBlocked: boolean;
  readonly overrideRevision: number;
  readonly projection?: Readonly<InformationEntryAssociationProjection>;
}

export interface InformationEntryKnowledgeGraph {
  readonly center: Readonly<CurrentInformationEntry>;
  readonly nodes: readonly Readonly<CurrentInformationEntry>[];
  readonly edges: readonly Readonly<InformationEntryGraphEdge>[];
  readonly hiddenEdges: readonly Readonly<InformationEntryGraphEdge>[];
}
