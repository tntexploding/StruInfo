export const ENTRY_TYPE_KEYWORDS = [
  'factual_material',
  'knowledge_explanation',
  'operating_guideline',
  'investigation_analysis',
  'argument',
  'personal_experience',
  'interactive_collaboration',
  'public_communication',
  'literary_creation',
  'other',
] as const;

export const ENTRY_DOMAIN_KEYWORDS = [
  'mathematics_formal',
  'nature_environment',
  'engineering_computing',
  'life_health',
  'society_public_affairs',
  'economy_business',
  'law_policy_governance',
  'humanities_history',
  'language_education',
  'culture_arts',
  'daily_life',
  'other',
] as const;

export const ENTRY_CHUNK_MODES = ['split', 'whole'] as const;
export const ENTRY_ANNOTATION_ORIGINS = ['manual', 'rule', 'ai'] as const;

export type EntryTypeKeyword = (typeof ENTRY_TYPE_KEYWORDS)[number];
export type EntryDomainKeyword = (typeof ENTRY_DOMAIN_KEYWORDS)[number];
export type EntryChunkMode = (typeof ENTRY_CHUNK_MODES)[number];
export type EntryAnnotationOrigin = (typeof ENTRY_ANNOTATION_ORIGINS)[number];
export type EntryAssessmentScore = 1 | 2 | 3 | 4 | 5;

export interface EntryContentKeyword {
  readonly displayValue: string;
  readonly normalizedValue: string;
  readonly origin: EntryAnnotationOrigin;
  readonly originVersion: string;
}

export interface EntryDomainAssignment {
  readonly keyword: EntryDomainKeyword;
  readonly customName?: string;
  readonly origin: EntryAnnotationOrigin;
  readonly originVersion: string;
}

export interface InformationEntryRevisionValue {
  readonly documentOrder: number;
  readonly titlePath: string;
  readonly body: string;
  readonly bodySha256: string;
  readonly chunkMode: EntryChunkMode;
  readonly splitRuleVersion: string;
  readonly isPrivate: boolean;
  readonly typeKeyword?: EntryTypeKeyword;
  readonly typeCustomName?: string;
  readonly usefulnessScore?: EntryAssessmentScore;
  readonly interestScore?: EntryAssessmentScore;
  readonly contentKeywords: readonly Readonly<EntryContentKeyword>[];
  readonly domains: readonly Readonly<EntryDomainAssignment>[];
  readonly fragmentIds: readonly string[];
}

export interface CurrentInformationEntry {
  readonly workspaceId: string;
  readonly entryId: string;
  readonly resourceId: string;
  readonly snapshotId: string;
  readonly revision: number;
  readonly revisionId: string;
  readonly sourceKey: string;
  readonly canonicalUri?: string;
  readonly capturedAt: string;
  readonly publishedAt?: string;
  readonly value: Readonly<InformationEntryRevisionValue>;
}

export interface InformationEntryMaterializeRow {
  readonly workspaceId: string;
  readonly entryId: string;
  readonly resourceId: string;
  readonly snapshotId: string;
  readonly revisionId: string;
  readonly value: Readonly<InformationEntryRevisionValue>;
}

export interface AiSplitEntryGroupInput {
  readonly titlePath: string;
  readonly fragmentIds: readonly string[];
}

export interface InformationEntryRevisionWrite {
  readonly workspaceId: string;
  readonly entryId: string;
  readonly expectedRevision: number;
  readonly revisionId: string;
  readonly value: Readonly<InformationEntryRevisionValue>;
}

export interface InformationEntrySearchRequest {
  readonly text?: string;
  readonly contentKeyword?: string;
  readonly sourceKey?: string;
  readonly snapshotId?: string;
  readonly typeKeyword?: EntryTypeKeyword;
  readonly typeCustomName?: string;
  readonly domainKeyword?: EntryDomainKeyword;
  readonly domainCustomName?: string;
  readonly domainScope?: 'any' | 'primary' | 'secondary';
  readonly chunkMode?: EntryChunkMode;
  readonly time?: Readonly<{
    field: 'published' | 'captured';
    from?: string;
    to?: string;
  }>;
  readonly association?: Readonly<{
    entryId: string;
    maximumDepth: 1 | 2;
    minimumScore: number;
  }>;
  readonly includePrivate: boolean;
  readonly onlyPrivate?: boolean;
  readonly limit: number;
  readonly after?: Readonly<InformationEntrySearchCursor>;
}

export type InformationEntryMatchReason =
  'title' | 'body' | 'content_keyword' | 'type_keyword' | 'domain_keyword';

export type InformationEntryFilterReason =
  | 'content_keyword'
  | 'source'
  | 'document'
  | 'type'
  | 'domain'
  | 'chunk_mode'
  | 'published_time'
  | 'captured_time'
  | 'private_scope';

export interface InformationEntryAssociationPathStep {
  readonly fromEntryId: string;
  readonly toEntryId: string;
  readonly effectiveScore: number;
  readonly candidateBasis: readonly string[];
  readonly manualAction?: string;
}

export interface InformationEntryAssociationMatch {
  readonly anchorEntryId: string;
  readonly depth: number;
  readonly effectiveScore: number;
  readonly path: readonly Readonly<InformationEntryAssociationPathStep>[];
}

export interface InformationEntrySearchCursor {
  readonly schemaVersion: 1;
  readonly querySha256: string;
  readonly associationDepth: number;
  readonly matchReasonCount: number;
  readonly associationScore: number;
  readonly capturedAt: string;
  readonly documentOrder: number;
  readonly entryId: string;
}

export interface InformationEntrySearchItem {
  readonly entry: Readonly<CurrentInformationEntry>;
  readonly matchReasons: readonly InformationEntryMatchReason[];
  readonly filterReasons: readonly InformationEntryFilterReason[];
  readonly association?: Readonly<InformationEntryAssociationMatch>;
}

export interface InformationEntrySearchResult {
  readonly querySha256: string;
  readonly totalCount: number;
  readonly items: readonly Readonly<InformationEntrySearchItem>[];
  readonly nextCursor?: Readonly<InformationEntrySearchCursor>;
}
