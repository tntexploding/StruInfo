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

export type InformationEntryAssociationAction =
  (typeof INFORMATION_ENTRY_ASSOCIATION_ACTIONS)[number];
export type InformationEntryAssociationBasis =
  (typeof INFORMATION_ENTRY_ASSOCIATION_BASES)[number];

export interface InformationEntryAssociationPolicy {
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
