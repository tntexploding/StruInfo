export interface WorkspaceResponse {
  readonly status: 'ok';
  readonly workspaceId: string;
  readonly capabilities: readonly string[];
}

export interface ReviewPreferencesResponse {
  readonly status: 'ok';
  readonly workspaceId: string;
  readonly quickTags: readonly string[];
  readonly automaticKeywords: Readonly<ReviewAutomaticKeywordPreferences>;
  readonly vocabulary: Readonly<ReviewVocabularyPreferences>;
}

export interface ReviewAutomaticKeywordPreferences {
  readonly enabled: boolean;
  readonly includeLinkDomains: boolean;
  readonly excludedKeywords: readonly string[];
}

export interface ReviewPreferencesWrite {
  readonly quickTags: readonly string[];
  readonly automaticKeywords: Readonly<ReviewAutomaticKeywordPreferences>;
  readonly vocabulary: Readonly<ReviewVocabularyPreferences>;
}

export interface ReviewVocabularyPreferences {
  readonly aliases: readonly Readonly<{
    source: string;
    canonical: string;
  }>[];
}
export const DEFAULT_REVIEW_AUTOMATIC_KEYWORDS: Readonly<ReviewAutomaticKeywordPreferences> =
  Object.freeze({
    enabled: true,
    includeLinkDomains: false,
    excludedKeywords: Object.freeze([]),
  });

export const DEFAULT_REVIEW_VOCABULARY: Readonly<ReviewVocabularyPreferences> =
  Object.freeze({
    aliases: Object.freeze([]),
  });
export interface PublicationState {
  readonly instant?: string;
  readonly sourceTimezone?: string;
  readonly precision?: string;
  readonly sourceText?: string;
  readonly inferred: boolean;
}

export interface EvidenceSnapshotSummary {
  readonly workspaceId: string;
  readonly snapshotId: string;
  readonly resourceId: string;
  readonly resourceKind: 'git_file' | 'manual_text' | 'uploaded_file';
  readonly sourceKey: string;
  readonly canonicalUri?: string;
  readonly isPrivate?: true;
  readonly capturedAt: string;
  readonly publication?: Readonly<PublicationState>;
  readonly fragmentCount: number;
}

export interface EvidenceFragment {
  readonly fragmentId: string;
  readonly structureId: string;
  readonly nodeId: string;
  readonly nodeKind:
    | 'document'
    | 'section'
    | 'heading'
    | 'paragraph'
    | 'blockquote'
    | 'list'
    | 'list_item'
    | 'code_block'
    | 'table'
    | 'table_row'
    | 'table_cell'
    | 'image'
    | 'thematic_break';
  readonly codePointRange: Readonly<{start: number; end: number}>;
  readonly lineRange?: Readonly<{start: number; end: number}>;
  readonly selectedTextSha256: string;
  readonly selectedText: string;
}

export interface EvidenceStructure {
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
  readonly normalizedText: string;
  readonly fragments: readonly Readonly<EvidenceFragment>[];
}

export interface EvidenceSnapshot extends EvidenceSnapshotSummary {
  readonly rawSha256: string;
  readonly canonicalContentSha256: string;
  readonly canonicalizationVersion: string;
  readonly mediaType?: string;
  readonly structures: readonly Readonly<EvidenceStructure>[];
}

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

export type EntryTypeKeyword = (typeof ENTRY_TYPE_KEYWORDS)[number];
export type EntryDomainKeyword = (typeof ENTRY_DOMAIN_KEYWORDS)[number];

export interface InformationEntryContentKeyword {
  readonly displayValue: string;
  readonly normalizedValue: string;
  readonly origin: 'manual' | 'rule' | 'ai';
  readonly originVersion: string;
}

export interface InformationEntryDomainAssignment {
  readonly keyword: EntryDomainKeyword;
  readonly customName?: string;
  readonly origin: 'manual' | 'rule' | 'ai';
  readonly originVersion: string;
}

export interface InformationEntry {
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
  readonly value: Readonly<{
    documentOrder: number;
    titlePath: string;
    body: string;
    bodySha256: string;
    chunkMode: 'split' | 'whole';
    splitRuleVersion: string;
    isPrivate: boolean;
    typeKeyword?: EntryTypeKeyword;
    typeCustomName?: string;
    usefulnessScore?: 1 | 2 | 3 | 4 | 5;
    interestScore?: 1 | 2 | 3 | 4 | 5;
    contentKeywords: readonly Readonly<InformationEntryContentKeyword>[];
    domains: readonly Readonly<InformationEntryDomainAssignment>[];
    fragmentIds: readonly string[];
  }>;
}

export interface InformationDocumentTag {
  readonly displayValue: string;
  readonly normalizedValue: string;
  readonly origin: 'aggregate' | 'manual';
  readonly fullTextOccurrences: number;
  readonly entryCoverageCount: number;
}

export interface CurrentInformationDocumentTags {
  readonly workspaceId: string;
  readonly resourceId: string;
  readonly snapshotId: string;
  readonly revision: number;
  readonly revisionId: string;
  readonly value: Readonly<{
    revisionKind: 'aggregate' | 'manual';
    ruleVersion: string;
    isPrivate: boolean;
    entryCount: number;
    tags: readonly Readonly<InformationDocumentTag>[];
  }>;
}

export interface InformationEntryDocumentView extends EvidenceSnapshotSummary {
  readonly entryCount: number;
  readonly annotatedEntryCount: number;
  readonly currentTags?: Readonly<CurrentInformationDocumentTags>;
}

export type InformationEntryDocumentListResponse =
  | Readonly<{
      status: 'ok';
      totalCount: number;
      documents: readonly Readonly<InformationEntryDocumentView>[];
    }>
  | DomainFailure;

export type InformationDocumentTagWriteResponse =
  | Readonly<{
      status: 'applied' | 'unchanged';
      documentTags?: Readonly<CurrentInformationDocumentTags>;
    }>
  | Readonly<{status: 'not_found'; issue: Readonly<DomainIssue>}>
  | DomainFailure;

export type InformationEntryMaterializeResponse =
  | Readonly<{
      status: 'created' | 'existing';
      snapshotId: string;
      createdCount: number;
      entries: readonly Readonly<InformationEntry>[];
    }>
  | Readonly<{status: 'not_found'; issue: Readonly<DomainIssue>}>
  | DomainFailure;

export type InformationEntryRevisionResponse =
  | Readonly<{
      status: 'applied' | 'unchanged';
      entry?: Readonly<InformationEntry>;
    }>
  | Readonly<{status: 'not_found'; issue: Readonly<DomainIssue>}>
  | DomainFailure;

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

export type InformationEntrySearchResponse =
  | Readonly<{
      status: 'ok';
      querySha256: string;
      totalCount: number;
      items: readonly Readonly<{
        entry: Readonly<InformationEntry>;
        matchReasons: readonly InformationEntryMatchReason[];
        filterReasons: readonly InformationEntryFilterReason[];
        association?: Readonly<InformationEntryAssociationMatch>;
      }>[];
      nextCursor?: Readonly<InformationEntrySearchCursor>;
    }>
  | DomainFailure;

export type InformationEntryAssociationAction =
  'enhance' | 'weaken' | 'block' | 'restore';

export type InformationEntryAssociationBasis =
  'content_keyword' | 'text_term' | 'type_keyword' | 'domain_keyword';

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

export interface CurrentInformationEntryAssociationOverride {
  readonly workspaceId: string;
  readonly entryLowId: string;
  readonly entryHighId: string;
  readonly revision: number;
  readonly revisionId: string;
  readonly value: Readonly<{
    action: InformationEntryAssociationAction;
    manualAdjustment: number;
    isBlocked: boolean;
  }>;
}

export interface InformationEntryAssociationView {
  readonly relatedEntry: Readonly<InformationEntry>;
  readonly projection?: Readonly<InformationEntryAssociationProjection>;
  readonly override?: Readonly<CurrentInformationEntryAssociationOverride>;
  readonly effectiveScore: number;
  readonly isBlocked: boolean;
}

export type InformationEntryAssociationRebuildResponse =
  | Readonly<{
      status: 'rebuilt';
      entryCount: number;
      projectedCount: number;
      policy: Readonly<InformationEntryAssociationPolicy>;
    }>
  | DomainFailure;

export type InformationEntryAssociationListResponse =
  | Readonly<{
      status: 'ok';
      entryId: string;
      totalCount: number;
      policy: Readonly<InformationEntryAssociationPolicy>;
      associations: readonly Readonly<InformationEntryAssociationView>[];
    }>
  | Readonly<{status: 'not_found'; issue: Readonly<DomainIssue>}>
  | DomainFailure;

export type InformationEntryAssociationOverrideResponse =
  | Readonly<{status: 'applied' | 'unchanged'}>
  | Readonly<{status: 'not_found'; issue: Readonly<DomainIssue>}>
  | DomainFailure;

export interface DomainIssue {
  readonly code: string;
  readonly path?: string;
  readonly budget?: string;
}

export type DomainFailure =
  | Readonly<{status: 'rejected'; issue: Readonly<DomainIssue>}>
  | Readonly<{status: 'failed'; issue: Readonly<DomainIssue>}>;

export type MarkdownImportResponse =
  | Readonly<{
      status: 'created' | 'existing';
      workspaceId: string;
      commandIdempotencyKey: string;
      resourceId: string;
      snapshotId: string;
      structureId: string;
      fragmentIds: readonly string[];
      mediaAssetIds: readonly string[];
      isPrivate?: true;
    }>
  | Readonly<{
      status: 'validation_failed' | 'persistence_failed' | 'conflict';
      code: string;
      path?: string;
      budget?: string;
    }>;

export interface WorkspaceBundleTransferSummary {
  readonly fileName: string;
  readonly byteLength: number;
  readonly sha256?: string;
  readonly blobCount: number;
  readonly personalDataIncluded: boolean;
  readonly tableCounts: Readonly<Record<string, number>>;
}

export type WorkspaceBundleTransferResponse =
  | (Readonly<WorkspaceBundleTransferSummary> &
      Readonly<{status: 'exported' | 'restored'}>)
  | DomainFailure;

export interface M1cHttpResponse<T> {
  readonly statusCode: number;
  readonly body: T;
}
