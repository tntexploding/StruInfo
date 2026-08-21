export const KNOWLEDGE_KINDS = [
  'entity',
  'concept',
  'assertion',
  'event',
  'method',
  'framework',
  'resource',
  'work',
  'other',
] as const;

export const EPISTEMIC_ROLES = [
  'source_claim',
  'summary',
  'inference',
  'user_assertion',
] as const;

export const KNOWLEDGE_REVIEW_STATES = [
  'draft',
  'pending_review',
  'confirmed',
  'disputed',
  'rejected',
  'withdrawn',
] as const;

export const INTAKE_ACTIONS = [
  'full',
  'split',
  'condense',
  'source_only',
  'ignore',
  'needs_review',
] as const;

export const INTAKE_REASONS = [
  'already_known',
  'low_information_value',
  'high_noise_or_marketing',
  'unreliable_source',
  'insufficient_evidence',
  'temporarily_not_needed',
  'not_interested',
  'worth_exploring',
  'recommendation_direction_right_sample_wrong',
  'other',
] as const;

export const ASSESSMENT_DIMENSIONS = [
  'information_density',
  'breadth',
  'depth',
  'current_interest',
  'serendipity',
  'noise_marketing',
  'source_reliability',
] as const;

export type KnowledgeKind = (typeof KNOWLEDGE_KINDS)[number];
export type EpistemicRole = (typeof EPISTEMIC_ROLES)[number];
export type KnowledgeItemEpistemicRole = EpistemicRole | 'source_excerpt';
export type KnowledgeReviewState = (typeof KNOWLEDGE_REVIEW_STATES)[number];
export type IntakeAction = (typeof INTAKE_ACTIONS)[number];
export type IntakeReason = (typeof INTAKE_REASONS)[number];
export type AssessmentDimension = (typeof ASSESSMENT_DIMENSIONS)[number];

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
  readonly links: readonly Readonly<{
    left: string;
    right: string;
    kind: 'related' | 'translation';
  }>[];
  readonly knowledgeKinds: readonly Readonly<{
    keyword: string;
    knowledgeKind: KnowledgeKind;
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
    links: Object.freeze([]),
    knowledgeKinds: Object.freeze([]),
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

export type InformationEntryListResponse =
  | Readonly<{
      status: 'ok';
      totalCount: number;
      entries: readonly Readonly<InformationEntry>[];
    }>
  | DomainFailure;

export type InformationEntryRevisionResponse =
  | Readonly<{
      status: 'applied' | 'unchanged';
      entry?: Readonly<InformationEntry>;
    }>
  | Readonly<{status: 'not_found'; issue: Readonly<DomainIssue>}>
  | DomainFailure;

export type InformationEntrySearchResponse =
  | Readonly<{
      status: 'ok';
      totalCount: number;
      items: readonly Readonly<{
        entry: Readonly<InformationEntry>;
        matchReasons: readonly (
          | 'title'
          | 'body'
          | 'content_keyword'
          | 'type_keyword'
          | 'domain_keyword'
        )[];
      }>[];
    }>
  | DomainFailure;

export interface CurationTarget {
  readonly workspaceId: string;
  readonly targetId: string;
  readonly currentVersion: number;
  readonly kind: 'snapshot' | 'fragment';
  readonly resourceId?: string;
  readonly snapshotId?: string;
  readonly fragmentId?: string;
}

export interface VocabularyTerm {
  readonly workspaceId: string;
  readonly termId: string;
  readonly currentRevision: number;
  readonly currentRevisionId: string;
  readonly value: Readonly<{
    displayName: string;
    description?: string;
    parentTermId?: string;
    lifecycle: 'active' | 'retired';
  }>;
}

export interface ClassificationAssignment {
  readonly assignmentId: string;
  readonly targetId: string;
  readonly termId: string;
  readonly state: 'assigned' | 'removed';
}

export interface IntakeDecision {
  readonly decisionId: string;
  readonly targetId: string;
  readonly currentRevision: number;
  readonly currentRevisionId: string;
  readonly value: Readonly<{
    action: IntakeAction;
    reasonCodes: readonly IntakeReason[];
    note?: string;
  }>;
}

export interface Assessment {
  readonly assessmentId: string;
  readonly targetId: string;
  readonly dimension: string;
  readonly currentRevision: number;
  readonly value:
    | Readonly<{state: 'rated'; score: 0 | 1 | 2 | 3 | 4; note?: string}>
    | Readonly<{state: 'cleared'}>;
}

export interface CurationState {
  readonly terms: readonly Readonly<VocabularyTerm>[];
  readonly targets: readonly Readonly<CurationTarget>[];
  readonly assignments: readonly Readonly<ClassificationAssignment>[];
  readonly decisions: readonly Readonly<IntakeDecision>[];
  readonly assessments: readonly Readonly<Assessment>[];
}

export interface KnowledgeSearchSourceMatch {
  readonly inputKind: 'citation' | 'derivation';
  readonly inputOrdinal: number;
  readonly resourceId: string;
  readonly snapshotId: string;
  readonly fragmentId: string;
}

export interface KnowledgeSearchRelationMatch {
  readonly relationId: string;
  readonly direction: 'outgoing' | 'incoming';
  readonly relationTypeKey: string;
  readonly epistemicRole: EpistemicRole;
  readonly reviewState: KnowledgeReviewState;
  readonly qualifier?: string;
  readonly isPrivate?: true;
}

export interface KnowledgeSearchItem {
  readonly itemId: string;
  readonly revision: number;
  readonly revisionId: string;
  readonly value: Readonly<{
    knowledgeKind: KnowledgeKind;
    epistemicRole: KnowledgeItemEpistemicRole;
    reviewState: KnowledgeReviewState;
    title: string;
    body?: string;
  }>;
  readonly matchRank: 0 | 1 | 2 | 3 | 4;
  readonly textMatches: readonly Readonly<{
    field: 'title' | 'body';
    kind: 'exact' | 'substring';
    rank: 0 | 1 | 2 | 3;
  }>[];
  readonly sourceMatches: readonly Readonly<KnowledgeSearchSourceMatch>[];
  readonly relationMatchCount: number;
  readonly relationMatches: readonly Readonly<KnowledgeSearchRelationMatch>[];
  readonly relationMatchesTruncated: boolean;
  readonly isPrivate?: true;
}

export interface PrivateDocumentSearchResult {
  readonly isPrivate: true;
  readonly workspaceId: string;
  readonly resourceId: string;
  readonly snapshotId: string;
  readonly sourceKey: string;
  readonly capturedAt: string;
  readonly fragmentCount: number;
  readonly matchKind: 'browse' | 'source_key' | 'full_text';
  readonly excerpt: string;
}

export interface KnowledgeSearchCursor {
  readonly schemaVersion: 1;
  readonly querySha256: string;
  readonly matchRank: 0 | 1 | 2 | 3 | 4;
  readonly normalizedTitle: string;
  readonly itemId: string;
}

export type KnowledgeSearchResponse =
  | Readonly<{
      status: 'ok';
      querySha256: string;
      totalCount: number;
      items: readonly Readonly<KnowledgeSearchItem>[];
      nextCursor?: Readonly<KnowledgeSearchCursor>;
      includePrivate?: boolean;
      privateDocumentTotalCount?: number;
      privateDocuments?: readonly Readonly<PrivateDocumentSearchResult>[];
    }>
  | DomainFailure;

export interface DomainIssue {
  readonly code: string;
  readonly path?: string;
  readonly budget?: string;
}

export type DomainFailure =
  | Readonly<{status: 'rejected'; issue: Readonly<DomainIssue>}>
  | Readonly<{status: 'failed'; issue: Readonly<DomainIssue>}>;

export interface KnowledgeItemEditState {
  readonly itemId: string;
  readonly revision: number;
  readonly revisionId: string;
  readonly value: Readonly<{
    knowledgeKind: KnowledgeKind;
    epistemicRole: KnowledgeItemEpistemicRole;
    reviewState: KnowledgeReviewState;
    title: string;
    body?: string;
  }>;
  readonly provenance: Readonly<{
    citations: readonly string[];
    fragmentDerivations: readonly string[];
    knowledgeDerivations: readonly Readonly<
      | {kind: 'item'; itemId: string; revision: number}
      | {kind: 'relation'; relationId: string; revision: number}
    >[];
  }>;
  readonly isPrivate?: true;
}

export type KnowledgeItemReadResponse =
  | Readonly<{status: 'ok'; item: Readonly<KnowledgeItemEditState>}>
  | Readonly<{status: 'not_found'; issue?: Readonly<DomainIssue>}>
  | DomainFailure;

export type DomainCommandResponse =
  | Readonly<{
      status: 'applied' | 'unchanged' | 'replayed';
      receipt: Readonly<Record<string, unknown>>;
    }>
  | DomainFailure;

export type MarkdownImportResponse =
  | Readonly<{
      status: 'created' | 'existing';
      workspaceId: string;
      commandIdempotencyKey: string;
      resourceId: string;
      snapshotId: string;
      structureId: string;
      fragmentIds: readonly string[];
      intakeTargetFragmentIds: readonly string[];
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
