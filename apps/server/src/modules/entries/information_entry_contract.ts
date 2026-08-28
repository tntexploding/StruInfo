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
export const ENTRY_TEXT_SEARCH_MODES = ['exact', 'substring', 'fuzzy'] as const;
export const ENTRY_TEXT_SEARCH_FIELDS = ['title', 'body', 'tags'] as const;
export const ENTRY_RETRIEVAL_MODES = ['lexical', 'semantic', 'hybrid'] as const;

export type EntryTypeKeyword = (typeof ENTRY_TYPE_KEYWORDS)[number];
export type EntryDomainKeyword = (typeof ENTRY_DOMAIN_KEYWORDS)[number];
export type EntryChunkMode = (typeof ENTRY_CHUNK_MODES)[number];
export type EntryAnnotationOrigin = (typeof ENTRY_ANNOTATION_ORIGINS)[number];
export type EntryTextSearchMode = (typeof ENTRY_TEXT_SEARCH_MODES)[number];
export type EntryTextSearchField = (typeof ENTRY_TEXT_SEARCH_FIELDS)[number];
export type EntryRetrievalMode = (typeof ENTRY_RETRIEVAL_MODES)[number];
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
  readonly fragmentRanges?: readonly Readonly<EntryFragmentRange>[];
}

export interface EntryFragmentRange {
  readonly startCodePoint: number;
  readonly endCodePoint: number;
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

export interface EntryFragmentGroupInput {
  readonly titlePath: string;
  readonly fragmentIds: readonly string[];
}

export type AiSplitEntryGroupInput = EntryFragmentGroupInput;

export interface ManualEntryFragmentInput extends EntryFragmentRange {
  readonly fragmentId: string;
}

export interface ManualEntryFragmentGroupInput {
  readonly titlePath: string;
  readonly fragments: readonly Readonly<ManualEntryFragmentInput>[];
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
  readonly retrievalMode?: EntryRetrievalMode;
  readonly textMode?: EntryTextSearchMode;
  readonly textFields?: readonly EntryTextSearchField[];
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
  readonly schemaVersion: 2;
  readonly querySha256: string;
  readonly associationDepth: number;
  readonly textScore: number;
  readonly matchReasonCount: number;
  readonly associationScore: number;
  readonly capturedAt: string;
  readonly documentOrder: number;
  readonly entryId: string;
}

export interface InformationEntrySearchItem {
  readonly entry: Readonly<CurrentInformationEntry>;
  readonly matchReasons: readonly InformationEntryMatchReason[];
  readonly textMatch?: Readonly<{
    mode: EntryTextSearchMode;
    score: number;
  }>;
  readonly semanticMatch?: Readonly<{
    score: number;
    provider: string;
    model: string;
    indexVersion: string;
  }>;
  readonly retrievalScore?: number;
  readonly filterReasons: readonly InformationEntryFilterReason[];
  readonly association?: Readonly<InformationEntryAssociationMatch>;
}

export interface InformationEntrySearchResult {
  readonly querySha256: string;
  readonly retrievalMode?: EntryRetrievalMode;
  readonly totalCount: number;
  readonly items: readonly Readonly<InformationEntrySearchItem>[];
  readonly nextCursor?: Readonly<InformationEntrySearchCursor>;
}
