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

export interface InformationEntryRevisionWrite {
  readonly workspaceId: string;
  readonly entryId: string;
  readonly expectedRevision: number;
  readonly revisionId: string;
  readonly value: Readonly<InformationEntryRevisionValue>;
}

export interface InformationEntrySearchRequest {
  readonly text?: string;
  readonly snapshotId?: string;
  readonly typeKeyword?: EntryTypeKeyword;
  readonly domainKeyword?: EntryDomainKeyword;
  readonly includePrivate: boolean;
  readonly limit: number;
}

export type InformationEntryMatchReason =
  'title' | 'body' | 'content_keyword' | 'type_keyword' | 'domain_keyword';

export interface InformationEntrySearchItem {
  readonly entry: Readonly<CurrentInformationEntry>;
  readonly matchReasons: readonly InformationEntryMatchReason[];
}

export interface InformationEntrySearchResult {
  readonly totalCount: number;
  readonly items: readonly Readonly<InformationEntrySearchItem>[];
}
