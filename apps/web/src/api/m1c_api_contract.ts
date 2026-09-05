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

interface SourceSubscriptionWriteBase {
  readonly subscriptionId: string;
  readonly label: string;
  readonly enabled: boolean;
  readonly sourceAlias: string;
  readonly isPrivate: boolean;
  readonly routeAfterImport: boolean;
  readonly intervalMinutes: number;
}

export interface GitSourceSubscriptionWrite extends SourceSubscriptionWriteBase {
  readonly kind: 'github_markdown';
  readonly repositoryUri: string;
  readonly repositoryRef: string;
  readonly repositoryPath: string;
  readonly profile: 'commonmark-v1' | 'ruanyf-weekly-v1';
}

export interface RssSourceSubscriptionWrite extends SourceSubscriptionWriteBase {
  readonly kind: 'rss_atom';
  readonly feedUrl: string;
  readonly itemLimit: number;
}

export interface JsonApiSourceSubscriptionWrite extends SourceSubscriptionWriteBase {
  readonly kind: 'json_api';
  readonly endpointUrl: string;
  readonly recordsPath: string;
  readonly externalIdPath: string;
  readonly titlePath: string;
  readonly bodyPath: string;
  readonly canonicalUriPath?: string;
  readonly publishedAtPath?: string;
  readonly versionPath?: string;
  readonly recordLimit: number;
  readonly pageCursor?: Readonly<{
    queryParameter: string;
    responsePath: string;
  }>;
  readonly incrementalCursor?: Readonly<{
    queryParameter: string;
    responsePath: string;
  }>;
  readonly authentication:
    Readonly<{kind: 'none'}> | Readonly<{kind: 'bearer_env'; variable: string}>;
}

export interface WebSourceSubscriptionWrite extends SourceSubscriptionWriteBase {
  readonly kind: 'web';
  readonly pageUrl: string;
  readonly additionalPaths: readonly string[];
}

export interface PluginSourceSubscriptionWrite extends SourceSubscriptionWriteBase {
  readonly kind: 'plugin';
  readonly connectorId: string;
  readonly configurationRef: string;
}

export interface SourceConnectorCapabilityView {
  readonly connectorId: string;
  readonly displayName: string;
  readonly origin: 'builtin' | 'plugin';
  readonly configurationMode: 'internal' | 'external_reference';
}

export type SourceSubscriptionWrite =
  | GitSourceSubscriptionWrite
  | RssSourceSubscriptionWrite
  | JsonApiSourceSubscriptionWrite
  | WebSourceSubscriptionWrite
  | PluginSourceSubscriptionWrite;

export type SourceSubscriptionView = SourceSubscriptionWrite &
  Readonly<{
    readonly lastAttemptAt?: string;
    readonly lastSuccessAt?: string;
    readonly lastRunId?: string;
    readonly cursor?:
      | Readonly<{commitSha: string; sourceSha256: string}>
      | Readonly<{connectorCursor: string}>;
  }>;

export type SourceSubscriptionListResponse =
  | Readonly<{
      status: 'ok';
      revision: number;
      connectors: readonly Readonly<SourceConnectorCapabilityView>[];
      subscriptions: readonly Readonly<SourceSubscriptionView>[];
    }>
  | Readonly<{status: 'failed'; issue: Readonly<{code: string}>}>;

export type SourceSubscriptionReplaceResponse =
  | Readonly<{
      status: 'applied' | 'unchanged';
      revision: number;
      subscriptions: readonly Readonly<SourceSubscriptionView>[];
    }>
  | Readonly<{
      status: 'rejected' | 'failed';
      issue: Readonly<{code: string; path?: string}>;
    }>;

export type SourceSubscriptionRunResponse =
  | Readonly<{
      status: 'existing' | 'unchanged' | 'imported';
      outcome: 'existing' | 'unchanged' | 'imported';
      runId: string;
      subscriptionId: string;
      snapshotId?: string;
      snapshotIds?: readonly string[];
      importedDocumentCount?: number;
      automationRunId?: string;
      automationRunIds?: readonly string[];
      materializedEntryCount?: number;
    }>
  | Readonly<{
      status: 'not_found' | 'rejected' | 'failed';
      issue: Readonly<{code: string; path?: string}>;
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

export type EntryPreferenceDimension = 'usefulness' | 'interest';
export type EntryPreferenceFeatureKind = 'content_keyword' | 'type' | 'domain';
export type EntryPreferenceEffect = 'prefer' | 'deprioritize';
export type EntryPreferenceWeight = 1 | 2 | 3 | 4 | 5;

export interface EntryPreferenceRule {
  readonly ruleId: string;
  readonly dimension: EntryPreferenceDimension;
  readonly featureKind: EntryPreferenceFeatureKind;
  readonly featureIdentity: string;
  readonly displayValue: string;
  readonly effect: EntryPreferenceEffect;
  readonly weight: EntryPreferenceWeight;
}

export interface EntryPreferenceProfile {
  readonly revision: number;
  readonly enabled: boolean;
  readonly rules: readonly Readonly<EntryPreferenceRule>[];
}

export interface InformationEntryPreferenceProfileResponse {
  readonly status: 'ok';
  readonly profile: Readonly<EntryPreferenceProfile>;
}

export type InformationEntryPreferenceProfileWriteResponse =
  | Readonly<{
      status: 'applied' | 'unchanged';
      profile: Readonly<EntryPreferenceProfile>;
    }>
  | Readonly<{
      status: 'rejected' | 'failed';
      issue: Readonly<{code: string; path?: string}>;
    }>;

export interface InformationEntryPreferenceSuggestion {
  readonly dimension: EntryPreferenceDimension;
  readonly featureKind: EntryPreferenceFeatureKind;
  readonly featureIdentity: string;
  readonly displayValue: string;
  readonly effect: EntryPreferenceEffect;
  readonly suggestedWeight: EntryPreferenceWeight;
  readonly positiveCount: number;
  readonly neutralCount: number;
  readonly negativeCount: number;
  readonly positiveEntryIds: readonly string[];
  readonly neutralEntryIds: readonly string[];
  readonly negativeEntryIds: readonly string[];
}

export type InformationEntryPreferenceSuggestionResponse =
  | Readonly<{
      status: 'ok';
      includePrivate: boolean;
      visibleEntryCount: number;
      totalCandidateCount: number;
      truncated: boolean;
      candidates: readonly Readonly<InformationEntryPreferenceSuggestion>[];
    }>
  | Readonly<{
      status: 'failed' | 'rejected';
      issue: Readonly<{code: string; path?: string}>;
    }>;

export interface InformationEntryPreferenceTrialItem {
  readonly entryId: string;
  readonly revision: number;
  readonly usefulnessScore?: EntryPreferenceWeight;
  readonly interestScore?: EntryPreferenceWeight;
  readonly matchedRules: readonly Readonly<{
    readonly rule: Readonly<EntryPreferenceRule>;
    readonly signedWeight: number;
  }>[];
  readonly totals: Readonly<{usefulness: number; interest: number}>;
}

export type InformationEntryPreferenceTrialResponse =
  | Readonly<{
      status: 'complete';
      profile: Readonly<EntryPreferenceProfile>;
      includePrivate: boolean;
      visibleEntryCount: number;
      evaluatedEntryCount: number;
      truncated: boolean;
      items: readonly Readonly<InformationEntryPreferenceTrialItem>[];
    }>
  | Readonly<{
      status: 'stale_profile';
      expectedProfileRevision: number;
      draftProfileRevision: number;
      currentProfileRevision: number;
    }>
  | Readonly<{
      status: 'stale_entries';
      entries: readonly Readonly<{
        entryId: string;
        expectedRevision: number;
        currentRevision?: number;
      }>[];
    }>
  | Readonly<{
      status: 'rejected' | 'failed';
      issue: Readonly<{code: string; path?: string}>;
    }>;

export type EntryAutomationRoute =
  'advance_candidate' | 'manual_review' | 'defer_candidate';
export type EntryAutomationReason =
  | 'advance_threshold_met'
  | 'defer_threshold_met'
  | 'threshold_not_met'
  | 'insufficient_profile_evidence'
  | 'mixed_signals'
  | 'manual_takeover'
  | 'run_budget_exhausted'
  | 'advance_budget_exhausted'
  | 'defer_budget_exhausted';

export interface EntryAutomationThresholds {
  readonly usefulness: number;
  readonly interest: number;
  readonly requiredDimensions: 1 | 2;
}

export interface EntryAutomationBudgets {
  readonly maximumEntriesPerRun: number;
  readonly maximumAdvanceCandidatesPerRun: number;
  readonly maximumDeferCandidatesPerRun: number;
}

export interface EntryAutomationPolicy {
  readonly revision: number;
  readonly enabled: boolean;
  readonly paused: boolean;
  readonly profileRevision: number;
  readonly minimumMatchedRuleCount: number;
  readonly advanceThresholds: Readonly<EntryAutomationThresholds>;
  readonly deferThresholds: Readonly<EntryAutomationThresholds>;
  readonly budgets: Readonly<EntryAutomationBudgets>;
  readonly advanceActions?: Readonly<{
    deterministicTags: boolean;
    rebuildAssociations: boolean;
  }>;
  readonly failureMode: 'pause';
}

export interface EntryAutomationProfileSummary {
  readonly revision: number;
  readonly enabled: boolean;
  readonly ruleCount: number;
}

export type InformationEntryAutomationPolicyResponse =
  | Readonly<{
      status: 'ok';
      policy: Readonly<EntryAutomationPolicy>;
      profile: Readonly<EntryAutomationProfileSummary>;
    }>
  | Readonly<{
      status: 'failed';
      issue: Readonly<{code: string; path?: string}>;
    }>;

export type InformationEntryAutomationPolicyWriteResponse =
  | Readonly<{
      status: 'applied' | 'unchanged';
      policy: Readonly<EntryAutomationPolicy>;
      profile: Readonly<EntryAutomationProfileSummary>;
    }>
  | Readonly<{
      status: 'rejected' | 'failed';
      issue: Readonly<{code: string; path?: string}>;
    }>;

export interface InformationEntryAutomationTrialItem extends InformationEntryPreferenceTrialItem {
  readonly signals: Readonly<{
    usefulness: 'advance' | 'defer' | 'neutral';
    interest: 'advance' | 'defer' | 'neutral';
  }>;
  readonly route: EntryAutomationRoute;
  readonly reason: EntryAutomationReason;
}

export type InformationEntryAutomationTrialResponse =
  | Readonly<{
      status: 'complete';
      dryRunOnly: true;
      activation:
        | 'disabled'
        | 'paused'
        | 'profile_disabled'
        | 'profile_revision_mismatch'
        | 'ready';
      includePrivate: boolean;
      visibleEntryCount: number;
      evaluatedEntryCount: number;
      truncated: boolean;
      policy: Readonly<EntryAutomationPolicy>;
      profile: Readonly<EntryPreferenceProfile>;
      counts: Readonly<Record<EntryAutomationRoute, number>>;
      items: readonly Readonly<InformationEntryAutomationTrialItem>[];
    }>
  | Readonly<{
      status: 'stale_policy' | 'stale_profile' | 'stale_entries';
      entries?: readonly Readonly<{
        entryId: string;
        expectedRevision: number;
        currentRevision?: number;
      }>[];
    }>
  | Readonly<{
      status: 'rejected' | 'failed';
      issue: Readonly<{code: string; path?: string}>;
    }>;

export interface EntryAutomationExecutionClaimView {
  readonly ordinal: number;
  readonly entryId: string;
  readonly entryRevision: number;
  readonly route: EntryAutomationRoute;
  readonly reason: EntryAutomationReason;
  readonly status: 'claimed' | 'completed' | 'compensated';
  readonly errorCode?: string;
  readonly createdAt: string;
  readonly finishedAt?: string;
}

export interface EntryAutomationExecutionView {
  readonly runId: string;
  readonly status: 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';
  readonly version: number;
  readonly policyRevision: number;
  readonly profileRevision: number;
  readonly includePrivate: boolean;
  readonly errorCode?: string;
  readonly claims: readonly Readonly<EntryAutomationExecutionClaimView>[];
}

export type InformationEntryAutomationExecutionResponse =
  | Readonly<{
      status: 'ok';
      execution: Readonly<EntryAutomationExecutionView>;
    }>
  | Readonly<{
      status: 'not_found' | 'failed';
      issue: Readonly<{code: string; path?: string}>;
    }>;

export type InformationEntryAutomationExecutionListResponse =
  | Readonly<{
      status: 'ok';
      executions: readonly Readonly<EntryAutomationExecutionView>[];
    }>
  | Readonly<{
      status: 'failed';
      issue: Readonly<{code: string; path?: string}>;
    }>;

export type EntryAutomationWorkItemState =
  'pending' | 'completed' | 'dismissed';

export type EntryAutomationActionState =
  | 'pending'
  | 'tags_applied'
  | 'applied'
  | 'undo_pending'
  | 'undone'
  | 'cancelled';

export interface EntryAutomationActionView {
  readonly deterministicTagsEnabled: boolean;
  readonly rebuildAssociationsEnabled: boolean;
  readonly state: EntryAutomationActionState;
  readonly originVersion: string;
  readonly resultEntryRevision?: number;
  readonly addedTagCount: number;
  readonly associationProjectionCount?: number;
  readonly version: number;
  readonly completedAt?: string;
}

export interface EntryAutomationWorkQueueItemView {
  readonly workspaceId: string;
  readonly runId: string;
  readonly claimOrdinal: number;
  readonly entryId: string;
  readonly entryRevision: number;
  readonly entryRevisionId: string;
  readonly route: EntryAutomationRoute;
  readonly reason: EntryAutomationReason;
  readonly state: EntryAutomationWorkItemState;
  readonly version: number;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly resolvedAt?: string;
  readonly stale: boolean;
  readonly entry: Readonly<InformationEntry>;
  readonly action?: Readonly<EntryAutomationActionView>;
}

export type InformationEntryAutomationWorkQueueResponse =
  | Readonly<{
      status: 'ok';
      includePrivate: boolean;
      items: readonly Readonly<EntryAutomationWorkQueueItemView>[];
    }>
  | Readonly<{
      status: 'failed' | 'rejected';
      issue: Readonly<{code: string; path?: string}>;
    }>;

export type InformationEntryAutomationWorkItemWriteResponse =
  | Readonly<{
      status: 'applied' | 'unchanged';
      item: Readonly<EntryAutomationWorkQueueItemView>;
    }>
  | Readonly<{
      status: 'not_found' | 'stale' | 'failed' | 'rejected';
      issue: Readonly<{code: string; path?: string}>;
    }>;

export type InformationEntryAutomationActionWriteResponse =
  | Readonly<{
      status: 'applied' | 'unchanged';
      item: Readonly<EntryAutomationWorkQueueItemView>;
    }>
  | Readonly<{
      status: 'not_found' | 'not_enabled' | 'stale' | 'failed' | 'rejected';
      issue: Readonly<{code: string; path?: string}>;
    }>;

export type InformationEntryAutomationExecuteResponse =
  | Readonly<{
      status: 'succeeded';
      runId: string;
      replayed: boolean;
      counts: Readonly<Record<EntryAutomationRoute, number>>;
      actions?: Readonly<{
        status: 'complete';
        appliedCount: number;
        unchangedCount: number;
      }>;
      execution?: Readonly<EntryAutomationExecutionView>;
    }>
  | Readonly<{
      status: 'failed';
      runId: string;
      replayed: boolean;
      errorCode:
        'automation_revalidation_failed' | 'automation_execution_failed';
      policyPause: 'applied' | 'superseded' | 'failed';
      recoveryPending: boolean;
      execution?: Readonly<EntryAutomationExecutionView>;
    }>
  | Readonly<{
      status: 'not_ready';
      reason:
        | 'disabled'
        | 'paused'
        | 'profile_disabled'
        | 'profile_revision_mismatch'
        | 'stale_policy'
        | 'stale_profile'
        | 'stale_entries'
        | 'invalid_state'
        | 'no_entries';
    }>
  | Readonly<{status: 'conflict'; runId: string}>
  | Readonly<{
      status: 'rejected';
      issue: Readonly<{code: string; path?: string}>;
    }>;

export interface ReviewPreferencesResponse {
  readonly status: 'ok';
  readonly workspaceId: string;
  readonly quickTags: readonly string[];
  readonly automaticKeywords: Readonly<ReviewAutomaticKeywordPreferences>;
  readonly vocabulary: Readonly<ReviewVocabularyPreferences>;
  readonly associationPolicy: Readonly<ReviewAssociationPolicyPreferences>;
  readonly explorationPolicy?: Readonly<ReviewExplorationPolicyPreferences>;
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
  readonly explorationPolicy?: Readonly<ReviewExplorationPolicyPreferences>;
}

export interface ReviewExplorationPolicyPreferences {
  readonly revision: number;
  readonly enabled: boolean;
  readonly resultShare: number;
  readonly neighborExpansion: boolean;
  readonly crossDomain: boolean;
  readonly serendipity: boolean;
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
export const DEFAULT_REVIEW_EXPLORATION_POLICY: Readonly<ReviewExplorationPolicyPreferences> =
  Object.freeze({
    revision: 0,
    enabled: false,
    resultShare: 20,
    neighborExpansion: true,
    crossDomain: true,
    serendipity: true,
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
  readonly resourceKind:
    'git_file' | 'manual_text' | 'uploaded_file' | 'remote_document';
  readonly sourceKey: string;
  readonly canonicalUri?: string;
  readonly isPrivate?: true;
  readonly capturedAt: string;
  readonly publication?: Readonly<PublicationState>;
  readonly fragmentCount: number;
}

export interface EvidenceSnapshotPageCursor {
  readonly capturedAt: string;
  readonly snapshotId: string;
}

export interface EvidenceSnapshotListResponse {
  readonly status: 'ok';
  readonly snapshots: readonly Readonly<EvidenceSnapshotSummary>[];
  readonly totalCount: number;
  readonly nextCursor?: Readonly<EvidenceSnapshotPageCursor>;
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
export type EntryTextSearchMode = 'exact' | 'substring' | 'fuzzy';
export type EntryTextSearchField = 'title' | 'body' | 'tags';
export type EntryRetrievalMode = 'lexical' | 'semantic' | 'hybrid';

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

export type InformationEntryTypeReviewFilter = 'missing' | EntryTypeKeyword;

export interface InformationEntryTypeReviewCursor {
  readonly capturedAt: string;
  readonly snapshotId: string;
  readonly documentOrder: number;
  readonly entryId: string;
}

export interface InformationEntryTypeCoverage {
  readonly totalCount: number;
  readonly classifiedCount: number;
  readonly missingCount: number;
  readonly byType: readonly Readonly<{
    typeKeyword: EntryTypeKeyword;
    count: number;
  }>[];
}

export interface InformationEntryTypeReviewResponse {
  readonly status: 'ok';
  readonly coverage: Readonly<InformationEntryTypeCoverage>;
  readonly items: readonly Readonly<InformationEntry>[];
  readonly nextCursor?: Readonly<InformationEntryTypeReviewCursor>;
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
  readonly workingCopy?: Readonly<{
    readonly sourceSnapshotId: string;
    readonly revision: number;
    readonly state: 'editing' | 'committed';
    readonly bodySha256: string;
    readonly derivedResourceId?: string;
    readonly derivedSnapshotId?: string;
  }>;
  readonly derivedFromSnapshotId?: string;
}

export interface InformationDocumentWorkingCopyView {
  readonly sourceSnapshotId: string;
  readonly revision: number;
  readonly state: 'original' | 'editing' | 'committed';
  readonly originalText: string;
  readonly currentText: string;
  readonly bodySha256?: string;
  readonly changed: boolean;
  readonly derivedResourceId?: string;
  readonly derivedSnapshotId?: string;
}

export type InformationDocumentWorkingCopyResponse =
  | Readonly<{
      status: 'ok' | 'applied' | 'unchanged' | 'restored';
      workingCopy: Readonly<InformationDocumentWorkingCopyView>;
    }>
  | Readonly<{status: 'not_found'; issue: Readonly<DomainIssue>}>
  | DomainFailure;

export type InformationDocumentWorkingCopyCommitResponse =
  | Readonly<{
      status: 'committed' | 'existing';
      sourceSnapshotId: string;
      derivedResourceId: string;
      derivedSnapshotId: string;
    }>
  | DomainFailure;

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

export interface InformationEntryRestructureRequest {
  readonly snapshotId: string;
  readonly includePrivate: boolean;
  readonly groups?: readonly Readonly<InformationEntryFragmentGroup>[];
}

export interface InformationEntryRestructureApplyRequest extends InformationEntryRestructureRequest {
  readonly groups: readonly Readonly<InformationEntryFragmentGroup>[];
  readonly planSha256: string;
  readonly acknowledgeAnnotationChanges: boolean;
  readonly acknowledgeRelationshipChanges: boolean;
}

export interface InformationEntryRestructureImpact {
  readonly snapshotId: string;
  readonly planSha256: string;
  readonly currentGroups: readonly Readonly<InformationEntryFragmentGroup>[];
  readonly hasChanges: boolean;
  readonly currentEntryCount: number;
  readonly resultingEntryCount: number;
  readonly insertedEntryCount: number;
  readonly revisedEntryCount: number;
  readonly unchangedEntryCount: number;
  readonly retiredEntryCount: number;
  readonly annotationReviewCount: number;
  readonly transferredRelationshipCount: number;
  readonly collapsedRelationshipCount: number;
  readonly conflictingRelationshipCount: number;
  readonly successors: readonly Readonly<{
    entryId: string;
    operation: 'insert' | 'revise' | 'unchanged';
    titlePath: string;
    documentOrder: number;
    predecessorEntryIds: readonly string[];
    annotationStatus: 'preserved' | 'combined' | 'requires_review';
  }>[];
}

export type InformationEntryRestructurePreviewResponse =
  | (Readonly<{status: 'preview'}> &
      Readonly<InformationEntryRestructureImpact>)
  | Readonly<{status: 'not_found'; issue: Readonly<DomainIssue>}>
  | DomainFailure;

export type InformationEntryRestructureApplyResponse =
  | (Readonly<{
      status: 'applied' | 'unchanged';
      entries?: readonly Readonly<InformationEntry>[];
    }> &
      Readonly<InformationEntryRestructureImpact>)
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

export type EntrySplitRuleMode = 'one_section' | 'merge_short_adjacent';

export interface EntrySplitRuleProfile {
  readonly revision: number;
  readonly mode: EntrySplitRuleMode;
  readonly minimumGroupCodePoints: number;
  readonly maximumGroupCodePoints: number;
  readonly maximumFragmentsPerGroup: number;
}

export interface EntrySplitRuleTrialGroup {
  readonly ordinal: number;
  readonly titlePath: string;
  readonly fragmentIds: readonly string[];
  readonly fragmentCount: number;
  readonly codePointCount: number;
  readonly exceedsMaximum: boolean;
  readonly previewText: string;
  readonly previewTruncated: boolean;
}

export interface EntrySplitRuleTrial {
  readonly snapshotId: string;
  readonly profile: Readonly<EntrySplitRuleProfile>;
  readonly sourceFragmentCount: number;
  readonly totalCodePointCount: number;
  readonly groups: readonly Readonly<EntrySplitRuleTrialGroup>[];
}

export type EntrySplitRuleProfileResponse =
  | Readonly<{status: 'ok'; profile: Readonly<EntrySplitRuleProfile>}>
  | DomainFailure;

export type EntrySplitRuleProfileWriteResponse =
  | Readonly<{
      status: 'applied' | 'unchanged';
      profile: Readonly<EntrySplitRuleProfile>;
    }>
  | DomainFailure;

export type EntrySplitRuleTrialResponse =
  | Readonly<{status: 'previewed'; trial: Readonly<EntrySplitRuleTrial>}>
  | Readonly<{status: 'not_found'; issue: Readonly<DomainIssue>}>
  | DomainFailure;

export type EntrySplitRuleApplyResponse =
  | Readonly<{
      status: 'created' | 'existing';
      snapshotId: string;
      profileRevision: number;
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

export interface PrivateDocumentSearchItem {
  readonly snapshot: Readonly<EvidenceSnapshotSummary>;
  readonly matchReasons: readonly ('body' | 'source' | 'uri' | 'entry_tags')[];
  readonly textMatch?: Readonly<{
    mode: EntryTextSearchMode;
    score: number;
  }>;
  readonly entryMatchCount: number;
  readonly excerpt?: string;
}

export type InformationEntrySearchResponse =
  | Readonly<{
      status: 'ok';
      querySha256: string;
      retrievalMode?: EntryRetrievalMode;
      totalCount: number;
      items: readonly Readonly<{
        entry: Readonly<InformationEntry>;
        matchReasons: readonly InformationEntryMatchReason[];
        textMatch?: Readonly<{
          mode: EntryTextSearchMode;
          score: number;
        }>;
        semanticMatch?: Readonly<{
          score: number;
          provider: string;
          model: string;
          indexVersion: string;
        }>;
        retrievalScore?: number;
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

export interface InformationEntrySearchIndexStatus {
  readonly indexVersion: string;
  readonly tokenizerVersion: string;
  readonly publicEntryCount: number;
  readonly currentProjectionCount: number;
  readonly embeddedProjectionCount: number;
  readonly staleProjectionCount: number;
  readonly postingCount: number;
  readonly semanticSearchAvailable: boolean;
  readonly semanticSearchReady: boolean;
  readonly embeddingProvider?: string;
  readonly embeddingModel?: string;
}

export interface InformationEntrySearchIndexRefreshProgress {
  readonly outcome: 'complete' | 'more' | 'provider_failed';
  readonly loadedEntryCount: number;
  readonly updatedEntryCount: number;
  readonly staleEntryCount: number;
  readonly removedProjectionCount: number;
  readonly reusedEmbeddingCount: number;
  readonly embeddingInputCount: number;
  readonly remainingEntryCount: number;
  readonly remainingObsoleteCount: number;
}

export type InformationEntrySearchIndexRefreshResponse =
  | Readonly<{
      status: 'ok';
      index: Readonly<InformationEntrySearchIndexStatus>;
      progress: Readonly<InformationEntrySearchIndexRefreshProgress>;
    }>
  | DomainFailure;

export type InformationEntrySearchIndexResponse =
  | Readonly<{
      status: 'ok';
      index: Readonly<InformationEntrySearchIndexStatus>;
    }>
  | DomainFailure;

export type InformationEntrySearchEvaluationResponse =
  | Readonly<{
      status: 'ok';
      evaluation: Readonly<{
        retrievalMode: 'semantic' | 'hybrid';
        k: number;
        meanRecallAtK: number;
        meanReciprocalRank: number;
        cases: readonly Readonly<{
          caseId: string;
          expectedCount: number;
          retrievedExpectedCount: number;
          recallAtK: number;
          reciprocalRank: number;
          retrievedEntryIds: readonly string[];
        }>[];
      }>;
    }>
  | DomainFailure;

export type InformationEntryExplorationReason =
  'neighbor_expansion' | 'cross_domain' | 'serendipity';

export interface InformationEntryExplorationPolicy extends ReviewExplorationPolicyPreferences {
  readonly version: 'struinfo.entry-exploration.local-association.v1';
}

export type InformationEntryExplorationResponse =
  | Readonly<{
      status: 'ok';
      policy: Readonly<InformationEntryExplorationPolicy>;
      anchorEntryId: string;
      candidateLimit: number;
      totalEligibleCount: number;
      items: readonly Readonly<{
        entry: Readonly<InformationEntry>;
        reason: InformationEntryExplorationReason;
        effectiveScore: number;
        candidateBasis: readonly InformationEntryAssociationBasis[];
        manualAction?: InformationEntryAssociationAction;
        differentSnapshot: boolean;
      }>[];
    }>
  | Readonly<{status: 'not_found'; issue: Readonly<DomainIssue>}>
  | DomainFailure;

export type InformationEntryExplorationPolicyWriteResponse =
  | Readonly<{
      status: 'applied' | 'unchanged';
      policy: Readonly<InformationEntryExplorationPolicy>;
    }>
  | DomainFailure;

export type InformationEntryQuerySynthesisEvidenceStatus =
  'supported' | 'partial' | 'insufficient';

export interface InformationEntryQuerySynthesisEvidence {
  readonly handle: string;
  readonly entryId: string;
  readonly entryRevision: number;
  readonly snapshotId: string;
  readonly fragmentIds: readonly string[];
  readonly titlePath: string;
  readonly excerpt: string;
  readonly truncated: boolean;
  readonly contentKeywords: readonly string[];
  readonly typeKeyword?: Readonly<{
    keyword: EntryTypeKeyword;
    customName?: string;
  }>;
  readonly domains: readonly Readonly<{
    keyword: EntryDomainKeyword;
    customName?: string;
  }>[];
}

export type InformationEntryQuerySynthesisResponse =
  | Readonly<{
      status: 'ok';
      requestId: string;
      querySha256: string;
      providerKey: 'openai-responses-v1';
      model: string;
      promptVersion: string;
      answer: string;
      evidenceStatus: InformationEntryQuerySynthesisEvidenceStatus;
      claims: readonly Readonly<{
        statement: string;
        evidenceRefs: readonly string[];
      }>[];
      limitations: readonly string[];
      evidence: readonly Readonly<InformationEntryQuerySynthesisEvidence>[];
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
      semanticKind: InformationEntryGraphSemanticKind;
      verificationStatus: InformationEntryGraphVerificationStatus;
      note: string;
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

export type InformationEntryGraphSemanticKind =
  | 'similarity'
  | 'related'
  | 'supports'
  | 'contradicts'
  | 'part_of'
  | 'causes'
  | 'example_of'
  | 'custom';

export type InformationEntryGraphVerificationStatus =
  'unreviewed' | 'source_checked' | 'needs_review';

export type InformationEntryGraphEdgeVerificationStatus =
  InformationEntryGraphVerificationStatus | 'calculated';

export type InformationEntryGraphEdgeOrigin =
  'automatically_calculated' | 'user_edited' | 'user_created' | 'ai_assisted';

export interface InformationEntrySourceReviewRevisions {
  readonly entryLowRevision: number;
  readonly entryHighRevision: number;
}
export interface InformationEntrySourceReview {
  readonly status: InformationEntryGraphVerificationStatus;
  readonly storedStatus: InformationEntryGraphEdgeVerificationStatus;
  readonly reason:
    | 'not_reviewed'
    | 'owner_requested'
    | 'unbound'
    | 'entry_changed'
    | 'current';
  readonly reviewedRevisions?: Readonly<InformationEntrySourceReviewRevisions>;
}
export type InformationEntrySourceReviewFilter =
  'pending' | 'all' | InformationEntryGraphVerificationStatus;
export type InformationEntrySourceReviewPrivacy =
  'public' | 'include_private' | 'private_only';
export interface InformationEntrySourceReviewCursor {
  readonly version: 1;
  readonly filter: InformationEntrySourceReviewFilter;
  readonly privacyScope: InformationEntrySourceReviewPrivacy;
  readonly entryLowId: string;
  readonly entryHighId: string;
}
export interface InformationEntrySourceReviewItem {
  readonly entryLow: Readonly<InformationEntry>;
  readonly entryHigh: Readonly<InformationEntry>;
  readonly edge: Readonly<InformationEntryGraphEdge>;
  readonly review: Readonly<InformationEntrySourceReview>;
}
export type InformationEntrySourceReviewListResponse =
  | Readonly<{
      status: 'ok';
      totalCount: number;
      items: readonly Readonly<InformationEntrySourceReviewItem>[];
      nextCursor?: Readonly<InformationEntrySourceReviewCursor>;
    }>
  | DomainFailure;

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
  readonly sourceReview?: Readonly<InformationEntrySourceReview>;
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
        textMatch?: Readonly<{
          mode: EntryTextSearchMode;
          score: number;
        }>;
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

export type DocumentImportResponse = MarkdownImportResponse;

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

export interface EntrySavedQueryConditions {
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
  readonly chunkMode?: 'split' | 'whole';
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
}
export interface EntryQueryContext {
  readonly query: Readonly<EntrySavedQueryConditions>;
  readonly selectedEntryId?: string;
}
export interface EntrySavedQuery extends EntryQueryContext {
  readonly viewId: string;
  readonly name: string;
}
export interface EntrySavedQueries {
  readonly version: 1;
  readonly revision: number;
  readonly views: readonly Readonly<EntrySavedQuery>[];
}
export type EntrySavedQueriesResponse =
  | Readonly<{
      status: 'ok' | 'applied' | 'unchanged';
      savedQueries: Readonly<EntrySavedQueries>;
    }>
  | DomainFailure;
export type EntryQueryContextResponse =
  | Readonly<{status: 'ok'; entry: Readonly<InformationEntry>}>
  | Readonly<{status: 'not_found'; issue: Readonly<DomainIssue>}>
  | DomainFailure;

export interface EntryMarkdownPreview {
  readonly title: string;
  readonly privacyScope: 'public' | 'include_private' | 'private_only';
  readonly entries: readonly Readonly<{
    entryId: string;
    revision: number;
    revisionId: string;
    title: string;
    isPrivate: boolean;
  }>[];
  readonly relationCount: number;
  readonly markdown: string;
  readonly sha256: string;
  readonly byteLength: number;
}
export type EntryMarkdownExportResponse =
  | Readonly<{status: 'ready'; preview: Readonly<EntryMarkdownPreview>}>
  | Readonly<{
      status: 'exported';
      preview: Readonly<EntryMarkdownPreview>;
      file: Readonly<{fileName: string; byteLength: number}>;
    }>
  | Readonly<{status: 'rejected'; issue: Readonly<{code: string}>}>;
