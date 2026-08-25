import type {CurrentInformationEntry} from './information_entry_contract.js';
import type {
  InformationEntryAssociationAction,
  InformationEntryAssociationBasis,
} from './information_entry_association_contract.js';

export const INFORMATION_ENTRY_EXPLORATION_REASONS = [
  'neighbor_expansion',
  'cross_domain',
  'serendipity',
] as const;

export const INFORMATION_ENTRY_EXPLORATION_POLICY_VERSION =
  'struinfo.entry-exploration.local-association.v1';

export type InformationEntryExplorationReason =
  (typeof INFORMATION_ENTRY_EXPLORATION_REASONS)[number];

export interface InformationEntryExplorationPolicy {
  readonly revision: number;
  readonly version: typeof INFORMATION_ENTRY_EXPLORATION_POLICY_VERSION;
  readonly enabled: boolean;
  readonly resultShare: number;
  readonly neighborExpansion: boolean;
  readonly crossDomain: boolean;
  readonly serendipity: boolean;
}

export interface InformationEntryExplorationRequest {
  readonly anchorEntryId: string;
  readonly excludeEntryIds: readonly string[];
  readonly pageResultCount: number;
  readonly includePrivate: boolean;
  readonly onlyPrivate?: boolean;
}

export interface InformationEntryExplorationCandidate {
  readonly entry: Readonly<CurrentInformationEntry>;
  readonly reason: InformationEntryExplorationReason;
  readonly effectiveScore: number;
  readonly candidateBasis: readonly InformationEntryAssociationBasis[];
  readonly manualAction?: InformationEntryAssociationAction;
  readonly differentSnapshot: boolean;
}

export interface InformationEntryExplorationResult {
  readonly policy: Readonly<InformationEntryExplorationPolicy>;
  readonly anchorEntryId: string;
  readonly candidateLimit: number;
  readonly totalEligibleCount: number;
  readonly items: readonly Readonly<InformationEntryExplorationCandidate>[];
}
