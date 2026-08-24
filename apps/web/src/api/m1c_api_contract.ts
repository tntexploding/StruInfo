export interface WorkspaceResponse {
  readonly status: 'ok';
  readonly workspaceId: string;
  readonly capabilities: readonly string[];
}

export type ProcessingStage =
  'import' | 'split' | 'tags' | 'associations' | 'query';

export interface ProcessingTagProposalPayloadView {
  readonly expectedEntryRevision: number;
  readonly providerModel: string;
  readonly promptVersion: string;
  readonly contentKeywords: readonly Readonly<{
    displayValue: string;
    normalizedValue: string;
  }>[];
  readonly typeKeyword: EntryTypeKeyword;
  readonly typeCustomName?: string;
  readonly domains: readonly Readonly<{
    keyword: EntryDomainKeyword;
    customName?: string;
  }>[];
}

export interface ProcessingAssociationProposalPayloadView {
  readonly expectedEntryLowRevision: number;
  readonly expectedEntryHighRevision: number;
  readonly expectedOverrideRevision: number;
  readonly providerModel: string;
  readonly promptVersion: string;
  readonly relationLabel: string;
  readonly direction: InformationEntryGraphDirection;
}

export interface ProcessingSplitProposalPayloadView {
  readonly providerModel: string;
  readonly promptVersion: string;
  readonly splitRuleVersion: 'struinfo.entry-split.ai-group.v1';
  readonly entries: readonly Readonly<{
    titlePath: string;
    fragmentIds: readonly string[];
  }>[];
}

export interface ProcessingProposalView {
  readonly proposalId: string;
  readonly runId: string;
  readonly ordinal: number;
  readonly stage: Extract<ProcessingStage, 'split' | 'tags' | 'associations'>;
  readonly kind: 'split' | 'tags' | 'association';
  readonly targetSnapshotId?: string;
  readonly targetEntryId?: string;
  readonly relatedEntryId?: string;
  readonly status: 'pending_review' | 'accepted' | 'rejected' | 'superseded';
  readonly summary: string;
  readonly fragmentIds: readonly string[];
  readonly splitPayload?: Readonly<ProcessingSplitProposalPayloadView>;
  readonly tagPayload?: Readonly<ProcessingTagProposalPayloadView>;
  readonly associationPayload?: Readonly<ProcessingAssociationProposalPayloadView>;
  readonly createdAt: string;
  readonly decidedAt?: string;
}

export interface ProcessingRunView {
  readonly runId: string;
  readonly origin: 'deterministic' | 'ai';
  readonly providerKey?: string;
  readonly status: 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';
  readonly targetSnapshotId?: string;
  readonly privacyScope: 'public_only' | 'include_private' | 'private_only';
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
  readonly proposals: readonly Readonly<ProcessingProposalView>[];
}

export type ProcessingRunListResponse =
  | Readonly<{status: 'ok'; runs: readonly Readonly<ProcessingRunView>[]}>
  | Readonly<{status: 'failed'; issue: Readonly<{code: string}>}>;

export type ProcessingRunCancelResponse =
  | Readonly<{status: 'cancelled'; runId: string; version: number}>
  | Readonly<{
      status: 'not_found' | 'rejected' | 'failed';
      issue: Readonly<{code: string}>;
    }>;

export type AiTagProposalListResponse =
  | Readonly<{
      status: 'ok';
      proposals: readonly Readonly<ProcessingProposalView>[];
    }>
  | Readonly<{
      status: 'not_found' | 'rejected' | 'failed';
      issue: Readonly<{code: string; path?: string}>;
    }>;

export type AiTagProposalStartResponse =
  | Readonly<{
      status: 'created' | 'existing';
      run: Readonly<ProcessingRunView>;
    }>
  | Readonly<{
      status: 'not_found' | 'rejected' | 'failed';
      issue: Readonly<{code: string; path?: string}>;
      run?: Readonly<ProcessingRunView>;
    }>;

export type AiTagProposalDecisionResponse =
  | Readonly<{
      status: 'accepted' | 'rejected' | 'unchanged';
      proposal: Readonly<ProcessingProposalView>;
      entry?: Readonly<InformationEntry>;
    }>
  | Readonly<{
      status: 'not_found' | 'rejected' | 'failed';
      issue: Readonly<{code: string; path?: string}>;
    }>;

export type AiSplitProposalListResponse = AiTagProposalListResponse;
export type AiSplitProposalStartResponse = AiTagProposalStartResponse;
export type AiSplitProposalDecisionResponse =
  | Readonly<{
      status: 'accepted' | 'rejected' | 'unchanged';
      proposal: Readonly<ProcessingProposalView>;
      entries?: readonly Readonly<InformationEntry>[];
    }>
  | Readonly<{
      status: 'not_found' | 'rejected' | 'failed';
      issue: Readonly<{code: string; path?: string}>;
    }>;

export type AiAssociationProposalListResponse = AiTagProposalListResponse;
export type AiAssociationProposalStartResponse = AiTagProposalStartResponse;
export type AiAssociationProposalDecisionResponse =
  AiTagProposalDecisionResponse;
export interface ReviewPreferencesResponse {
  readonly status: 'ok';
  readonly workspaceId: string;
  readonly quickTags: readonly string[];
  readonly automaticKeywords: Readonly<ReviewAutomaticKeywordPreferences>;
  readonly vocabulary: Readonly<ReviewVocabularyPreferences>;
  readonly associationPolicy: Readonly<ReviewAssociationPolicyPreferences>;
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
  readonly associationPolicy?: Readonly<ReviewAssociationPolicyPreferences>;
}

export interface ReviewAssociationPolicyPreferences {
  readonly revision: number;
  readonly contentWeight: number;
  readonly typeWeight: number;
  readonly domainWeight: number;
  readonly threshold: number;
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

export const DEFAULT_REVIEW_ASSOCIATION_POLICY: Readonly<ReviewAssociationPolicyPreferences> =
  Object.freeze({
    revision: 0,
    contentWeight: 65,
    typeWeight: 15,
    domainWeight: 20,
    threshold: 1_100,
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
    fragmentRanges?: readonly Readonly<{
      startCodePoint: number;
      endCodePoint: number;
    }>[];
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

export interface InformationEntryFragmentGroup {
  readonly titlePath: string;
  readonly fragments: readonly Readonly<{
    fragmentId: string;
    startCodePoint: number;
    endCodePoint: number;
  }>[];
}

export interface InformationEntryManualMaterializeRequest {
  readonly snapshotId: string;
  readonly includePrivate: boolean;
  readonly groups: readonly Readonly<InformationEntryFragmentGroup>[];
}

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

export interface PrivateDocumentSearchItem {
  readonly snapshot: Readonly<EvidenceSnapshotSummary>;
  readonly matchReasons: readonly ('body' | 'source' | 'uri')[];
  readonly entryMatchCount: number;
  readonly excerpt?: string;
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
      privateDocuments: Readonly<{
        totalCount: number;
        items: readonly Readonly<PrivateDocumentSearchItem>[];
      }>;
      nextCursor?: Readonly<InformationEntrySearchCursor>;
    }>
  | DomainFailure;

export type InformationEntryAssociationAction =
  'enhance' | 'weaken' | 'block' | 'restore';

export type InformationEntryAssociationBasis =
  'content_keyword' | 'text_term' | 'type_keyword' | 'domain_keyword';

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
    graph?: Readonly<{
      origin: 'association' | 'user' | 'ai';
      label: string;
      direction: InformationEntryGraphDirection;
    }>;
  }>;
}

export interface InformationEntryAssociationView {
  readonly relatedEntry: Readonly<InformationEntry>;
  readonly projection?: Readonly<InformationEntryAssociationProjection>;
  readonly override?: Readonly<CurrentInformationEntryAssociationOverride>;
  readonly effectiveScore: number;
  readonly isBlocked: boolean;
}

export type InformationEntryGraphDirection =
  'symmetric' | 'low_to_high' | 'high_to_low';

export type InformationEntryGraphEdgeOrigin =
  'automatically_calculated' | 'user_edited' | 'user_created' | 'ai_assisted';

export interface InformationEntryGraphEdge {
  readonly entryLowId: string;
  readonly entryHighId: string;
  readonly label: string;
  readonly direction: InformationEntryGraphDirection;
  readonly origin: InformationEntryGraphEdgeOrigin;
  readonly effectiveScore: number;
  readonly isBlocked: boolean;
  readonly overrideRevision: number;
  readonly projection?: Readonly<InformationEntryAssociationProjection>;
}

export type InformationEntryKnowledgeGraphResponse =
  | Readonly<{
      status: 'ok';
      querySha256: string;
      candidateTotalCount: number;
      candidates: readonly Readonly<{
        entry: Readonly<InformationEntry>;
        matchReasons: readonly InformationEntryMatchReason[];
        filterReasons: readonly InformationEntryFilterReason[];
      }>[];
      graph: Readonly<{
        center: Readonly<InformationEntry>;
        nodes: readonly Readonly<InformationEntry>[];
        edges: readonly Readonly<InformationEntryGraphEdge>[];
        hiddenEdges: readonly Readonly<InformationEntryGraphEdge>[];
      }> | null;
    }>
  | Readonly<{status: 'not_found'; issue: Readonly<DomainIssue>}>
  | DomainFailure;

export type InformationEntryKnowledgeGraphEdgeWriteResponse =
  | Readonly<{status: 'applied' | 'unchanged'}>
  | Readonly<{status: 'not_found'; issue: Readonly<DomainIssue>}>
  | DomainFailure;

export type InformationEntryAssociationRebuildResponse =
  | Readonly<{
      status: 'rebuilt';
      entryCount: number;
      projectedCount: number;
      policy: Readonly<InformationEntryAssociationPolicy>;
    }>
  | DomainFailure;

export type InformationEntryAssociationPolicyWriteResponse =
  | Readonly<{
      status: 'applied' | 'unchanged';
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
