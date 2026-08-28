export const PROCESSING_RUN_ORIGINS = ['deterministic', 'ai'] as const;
export const PROCESSING_RUN_STATUSES = [
  'queued',
  'running',
  'succeeded',
  'failed',
  'cancelled',
] as const;
export const PROCESSING_STAGES = [
  'import',
  'split',
  'tags',
  'associations',
  'query',
] as const;
export const PROCESSING_PRIVACY_SCOPES = [
  'public_only',
  'include_private',
  'private_only',
] as const;
export const PROCESSING_PROPOSAL_KINDS = [
  'split',
  'tags',
  'association',
] as const;
export const PROCESSING_PROPOSAL_STATUSES = [
  'pending_review',
  'accepted',
  'rejected',
  'superseded',
] as const;

export type ProcessingRunOrigin = (typeof PROCESSING_RUN_ORIGINS)[number];
export type ProcessingRunStatus = (typeof PROCESSING_RUN_STATUSES)[number];
export type ProcessingStage = (typeof PROCESSING_STAGES)[number];
export type ProcessingPrivacyScope = (typeof PROCESSING_PRIVACY_SCOPES)[number];
export type ProcessingProposalKind = (typeof PROCESSING_PROPOSAL_KINDS)[number];
export type ProcessingProposalStatus =
  (typeof PROCESSING_PROPOSAL_STATUSES)[number];

export interface ProcessingRun {
  readonly workspaceId: string;
  readonly runId: string;
  readonly idempotencyKey: string;
  readonly origin: ProcessingRunOrigin;
  readonly providerKey?: string;
  readonly status: ProcessingRunStatus;
  readonly targetSnapshotId?: string;
  readonly privacyScope: ProcessingPrivacyScope;
  readonly currentStage: ProcessingStage;
  readonly currentStep?: string;
  readonly completedUnits: number;
  readonly totalUnits?: number;
  readonly attempt: number;
  readonly version: number;
  readonly errorCode?: string;
  readonly createdAt: string;
  readonly startedAt?: string;
  readonly finishedAt?: string;
  readonly updatedAt: string;
  readonly proposals: readonly Readonly<ProcessingProposal>[];
}

export interface ProcessingSplitProposalEntry {
  readonly titlePath: string;
  readonly fragmentIds: readonly string[];
}

/** Closed payload for one explicitly selected public Snapshot. */
export interface ProcessingSplitProposalPayload {
  readonly providerModel: string;
  readonly promptVersion: string;
  readonly splitRuleVersion: 'struinfo.entry-split.ai-group.v1';
  readonly entries: readonly Readonly<ProcessingSplitProposalEntry>[];
}
export interface ProcessingTagProposalContentKeyword {
  readonly displayValue: string;
  readonly normalizedValue: string;
}

export interface ProcessingTagProposalDomain {
  readonly keyword:
    | 'mathematics_formal'
    | 'nature_environment'
    | 'engineering_computing'
    | 'life_health'
    | 'society_public_affairs'
    | 'economy_business'
    | 'law_policy_governance'
    | 'humanities_history'
    | 'language_education'
    | 'culture_arts'
    | 'daily_life'
    | 'other';
  readonly customName?: string;
}

/** Closed product payload for the first provider-backed proposal kind. */
export interface ProcessingTagProposalPayload {
  readonly expectedEntryRevision: number;
  readonly providerModel: string;
  readonly promptVersion: string;
  readonly contentKeywords: readonly Readonly<ProcessingTagProposalContentKeyword>[];
  readonly typeKeyword:
    | 'factual_material'
    | 'knowledge_explanation'
    | 'operating_guideline'
    | 'investigation_analysis'
    | 'argument'
    | 'personal_experience'
    | 'interactive_collaboration'
    | 'public_communication'
    | 'literary_creation'
    | 'other';
  readonly typeCustomName?: string;
  readonly domains: readonly Readonly<ProcessingTagProposalDomain>[];
}

/** Closed payload for one explicitly selected public Entry pair. */
export interface ProcessingAssociationProposalPayload {
  readonly expectedEntryLowRevision: number;
  readonly expectedEntryHighRevision: number;
  readonly expectedOverrideRevision: number;
  readonly providerModel: string;
  readonly promptVersion: string;
  readonly relationLabel: string;
  readonly direction: 'symmetric' | 'low_to_high' | 'high_to_low';
}

export interface ProcessingProposal {
  readonly workspaceId: string;
  readonly proposalId: string;
  readonly runId: string;
  readonly ordinal: number;
  readonly stage: Extract<ProcessingStage, 'split' | 'tags' | 'associations'>;
  readonly kind: ProcessingProposalKind;
  readonly targetSnapshotId?: string;
  readonly targetEntryId?: string;
  readonly relatedEntryId?: string;
  readonly status: ProcessingProposalStatus;
  readonly summary: string;
  readonly fragmentIds: readonly string[];
  readonly splitPayload?: Readonly<ProcessingSplitProposalPayload>;
  readonly tagPayload?: Readonly<ProcessingTagProposalPayload>;
  readonly associationPayload?: Readonly<ProcessingAssociationProposalPayload>;
  readonly createdAt: string;
  readonly decidedAt?: string;
}

export interface ProcessingRunCreate {
  readonly workspaceId: string;
  readonly runId: string;
  readonly idempotencyKey: string;
  readonly origin: ProcessingRunOrigin;
  readonly providerKey?: string;
  readonly targetSnapshotId?: string;
  readonly privacyScope: ProcessingPrivacyScope;
  readonly initialStage: ProcessingStage;
  readonly initialStep?: string;
}

export interface ProcessingRunProgressWrite {
  readonly workspaceId: string;
  readonly runId: string;
  readonly expectedVersion: number;
  readonly status: Exclude<ProcessingRunStatus, 'queued'>;
  readonly currentStage: ProcessingStage;
  readonly currentStep?: string;
  readonly completedUnits: number;
  readonly totalUnits?: number;
  readonly errorCode?: string;
}

export interface ProcessingProposalAppend {
  readonly workspaceId: string;
  readonly proposalId: string;
  readonly runId: string;
  readonly ordinal: number;
  readonly stage: Extract<ProcessingStage, 'split' | 'tags' | 'associations'>;
  readonly kind: ProcessingProposalKind;
  readonly targetSnapshotId?: string;
  readonly targetEntryId?: string;
  readonly relatedEntryId?: string;
  readonly summary: string;
  readonly fragmentIds: readonly string[];
  readonly splitPayload?: Readonly<ProcessingSplitProposalPayload>;
  readonly tagPayload?: Readonly<ProcessingTagProposalPayload>;
  readonly associationPayload?: Readonly<ProcessingAssociationProposalPayload>;
}

export type ProcessingProposalDecision = 'accepted' | 'rejected';

export type ProcessingProposalDecisionOutcome =
  'applied' | 'unchanged' | 'not_found' | 'terminal';

export type ProcessingRunWriteOutcome =
  'applied' | 'unchanged' | 'conflict' | 'not_found' | 'stale' | 'terminal';
