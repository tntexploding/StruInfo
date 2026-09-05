import {
  DEFAULT_ENTRY_SAVED_QUERIES,
  type EntrySavedQueries,
} from '../modules/entries/information_entry_saved_queries.js';
import {
  DEFAULT_ENTRY_SPLIT_RULE_PROFILE,
  type EntrySplitRuleProfile,
} from '../modules/entries/information_entry_split_rule.js';
import {
  DEFAULT_ENTRY_CLASSIFICATION_DOMAIN_THRESHOLDS,
  DEFAULT_ENTRY_CLASSIFICATION_NEIGHBOR_POLICY,
  DEFAULT_ENTRY_CLASSIFICATION_PROFILE,
  DEFAULT_ENTRY_CLASSIFICATION_TYPE_THRESHOLDS,
  ENTRY_CLASSIFICATION_PROFILE_VERSION,
  type EntryClassificationProfile,
} from '../modules/entries/information_entry_deterministic_classification.js';
import {
  cloneEntryTypeLearningState,
  DEFAULT_ENTRY_TYPE_LEARNING_STATE,
} from '../modules/entries/information_entry_type_learning.js';

export const REVIEW_PREFERENCES_FORMAT = 'struinfo.review-preferences';
export const REVIEW_PREFERENCES_VERSION = 1;
export const MAX_REVIEW_QUICK_TAGS = 24;
export const MAX_REVIEW_QUICK_TAG_CODE_POINTS = 120;
export const MAX_REVIEW_KEYWORD_EXCLUSIONS = 64;
export const MAX_REVIEW_VOCABULARY_ALIASES = 128;
export const MAX_SOURCE_SUBSCRIPTIONS = 32;
export const MAX_ENTRY_PREFERENCE_RULES = 64;
export const MAX_ENTRY_PREFERENCE_FEATURE_CODE_POINTS = 96;
export const MAX_ENTRY_PREFERENCE_DISPLAY_CODE_POINTS = 80;
export const MAX_ENTRY_AUTOMATION_SCORE_THRESHOLD =
  MAX_ENTRY_PREFERENCE_RULES * 5;
export const MAX_ENTRY_AUTOMATION_ENTRIES_PER_RUN = 100;

export const ENTRY_PREFERENCE_DIMENSIONS = ['usefulness', 'interest'] as const;
export const ENTRY_PREFERENCE_FEATURE_KINDS = [
  'content_keyword',
  'type',
  'domain',
] as const;
export const ENTRY_PREFERENCE_EFFECTS = ['prefer', 'deprioritize'] as const;
export const ENTRY_AUTOMATION_FAILURE_MODES = ['pause'] as const;

const CANONICAL_UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;
const SHA1 = /^[0-9a-f]{40}$/u;
const SHA256 = /^[0-9a-f]{64}$/u;

export type EntryPreferenceDimension =
  (typeof ENTRY_PREFERENCE_DIMENSIONS)[number];
export type EntryPreferenceFeatureKind =
  (typeof ENTRY_PREFERENCE_FEATURE_KINDS)[number];
export type EntryPreferenceEffect = (typeof ENTRY_PREFERENCE_EFFECTS)[number];

export interface EntryPreferenceRule {
  readonly ruleId: string;
  readonly dimension: EntryPreferenceDimension;
  readonly featureKind: EntryPreferenceFeatureKind;
  readonly featureIdentity: string;
  readonly displayValue: string;
  readonly effect: EntryPreferenceEffect;
  readonly weight: 1 | 2 | 3 | 4 | 5;
}

export interface EntryPreferenceProfile {
  readonly revision: number;
  readonly enabled: boolean;
  readonly rules: readonly Readonly<EntryPreferenceRule>[];
}

export const DEFAULT_ENTRY_PREFERENCE_PROFILE: Readonly<EntryPreferenceProfile> =
  Object.freeze({
    revision: 0,
    enabled: false,
    rules: Object.freeze([]),
  });

export type EntryAutomationFailureMode =
  (typeof ENTRY_AUTOMATION_FAILURE_MODES)[number];

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

export interface EntryAutomationAdvanceActions {
  /** Apply deterministic content-keyword candidates to advance candidates. */
  readonly deterministicTags: boolean;
  /** Rebuild replaceable Association projections after the tag action. */
  readonly rebuildAssociations: boolean;
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
  readonly advanceActions?: Readonly<EntryAutomationAdvanceActions>;
  readonly failureMode: EntryAutomationFailureMode;
}

export const DEFAULT_ENTRY_AUTOMATION_POLICY: Readonly<EntryAutomationPolicy> =
  Object.freeze({
    revision: 0,
    enabled: false,
    paused: false,
    profileRevision: 0,
    minimumMatchedRuleCount: 1,
    advanceThresholds: Object.freeze({
      usefulness: 3,
      interest: 3,
      requiredDimensions: 1,
    }),
    deferThresholds: Object.freeze({
      usefulness: 3,
      interest: 3,
      requiredDimensions: 1,
    }),
    budgets: Object.freeze({
      maximumEntriesPerRun: 100,
      maximumAdvanceCandidatesPerRun: 25,
      maximumDeferCandidatesPerRun: 25,
    }),
    advanceActions: Object.freeze({
      deterministicTags: false,
      rebuildAssociations: false,
    }),
    failureMode: 'pause',
  });

export interface ReviewGitSourceSubscriptionCursor {
  readonly commitSha: string;
  readonly sourceSha256: string;
}

export interface ReviewRssSourceSubscriptionCursor {
  readonly connectorCursor: string;
}

export interface ReviewJsonApiSourceSubscriptionCursor {
  readonly connectorCursor: string;
}

export interface ReviewWebSourceSubscriptionCursor {
  readonly connectorCursor: string;
}

export interface ReviewPluginSourceSubscriptionCursor {
  readonly connectorCursor: string;
}

export interface ReviewJsonApiCursorMapping {
  readonly queryParameter: string;
  readonly responsePath: string;
}

export type ReviewJsonApiAuthentication =
  Readonly<{kind: 'none'}> | Readonly<{kind: 'bearer_env'; variable: string}>;

interface ReviewSourceSubscriptionBase {
  readonly subscriptionId: string;
  readonly label: string;
  /** Enables periodic checks. Explicit run-now remains available when false. */
  readonly enabled: boolean;
  readonly sourceAlias: string;
  readonly isPrivate: boolean;
  /** Default-off: route a changed import after deterministic materialization. */
  readonly routeAfterImport: boolean;
  readonly intervalMinutes: number;
  readonly lastAttemptAt?: string;
  readonly lastSuccessAt?: string;
  readonly lastRunId?: string;
}

export interface ReviewGitSourceSubscription extends ReviewSourceSubscriptionBase {
  readonly kind?: 'github_markdown';
  readonly repositoryUri: string;
  readonly repositoryRef: string;
  readonly repositoryPath: string;
  readonly profile: 'commonmark-v1' | 'ruanyf-weekly-v1';
  readonly cursor?: Readonly<ReviewGitSourceSubscriptionCursor>;
}

export interface ReviewRssSourceSubscription extends ReviewSourceSubscriptionBase {
  readonly kind: 'rss_atom';
  readonly feedUrl: string;
  readonly itemLimit: number;
  readonly cursor?: Readonly<ReviewRssSourceSubscriptionCursor>;
}

export interface ReviewJsonApiSourceSubscription extends ReviewSourceSubscriptionBase {
  readonly kind: 'json_api';
  readonly endpointUrl: string;
  /** Empty means that the response root is the record array. */
  readonly recordsPath: string;
  readonly externalIdPath: string;
  readonly titlePath: string;
  readonly bodyPath: string;
  readonly canonicalUriPath?: string;
  readonly publishedAtPath?: string;
  readonly versionPath?: string;
  readonly recordLimit: number;
  readonly pageCursor?: Readonly<ReviewJsonApiCursorMapping>;
  readonly incrementalCursor?: Readonly<ReviewJsonApiCursorMapping>;
  readonly authentication: Readonly<ReviewJsonApiAuthentication>;
  readonly cursor?: Readonly<ReviewJsonApiSourceSubscriptionCursor>;
}

export interface ReviewWebSourceSubscription extends ReviewSourceSubscriptionBase {
  readonly kind: 'web';
  readonly pageUrl: string;
  readonly additionalPaths: readonly string[];
  readonly cursor?: Readonly<ReviewWebSourceSubscriptionCursor>;
}

export interface ReviewPluginSourceSubscription extends ReviewSourceSubscriptionBase {
  readonly kind: 'plugin';
  /** Installed runtime adapter. No executable payload is stored here. */
  readonly connectorId: string;
  /** Opaque reference resolved by the already-installed adapter. */
  readonly configurationRef: string;
  readonly cursor?: Readonly<ReviewPluginSourceSubscriptionCursor>;
}

export type ReviewSourceSubscription =
  | ReviewGitSourceSubscription
  | ReviewRssSourceSubscription
  | ReviewJsonApiSourceSubscription
  | ReviewWebSourceSubscription
  | ReviewPluginSourceSubscription;

export interface ReviewSourceSubscriptionPreferences {
  readonly revision: number;
  readonly subscriptions: readonly Readonly<ReviewSourceSubscription>[];
}

export const DEFAULT_REVIEW_SOURCE_SUBSCRIPTION_PREFERENCES: Readonly<ReviewSourceSubscriptionPreferences> =
  Object.freeze({revision: 0, subscriptions: Object.freeze([])});

export interface ReviewExplorationPolicyPreferences {
  readonly revision: number;
  readonly enabled: boolean;
  readonly resultShare: number;
  readonly neighborExpansion: boolean;
  readonly crossDomain: boolean;
  readonly serendipity: boolean;
}

export const DEFAULT_REVIEW_EXPLORATION_POLICY_PREFERENCES: Readonly<ReviewExplorationPolicyPreferences> =
  Object.freeze({
    revision: 0,
    enabled: false,
    resultShare: 20,
    neighborExpansion: true,
    crossDomain: true,
    serendipity: true,
  });

export interface ReviewAssociationPolicyPreferences {
  readonly revision: number;
  readonly contentWeight: number;
  readonly typeWeight: number;
  readonly domainWeight: number;
  readonly threshold: number;
}

export const DEFAULT_REVIEW_ASSOCIATION_POLICY_PREFERENCES: Readonly<ReviewAssociationPolicyPreferences> =
  Object.freeze({
    revision: 0,
    contentWeight: 65,
    typeWeight: 15,
    domainWeight: 20,
    threshold: 1_100,
  });

export interface ReviewVocabularyPreferences {
  readonly aliases: readonly Readonly<{
    source: string;
    canonical: string;
  }>[];
}

export const DEFAULT_REVIEW_VOCABULARY_PREFERENCES: Readonly<ReviewVocabularyPreferences> =
  Object.freeze({
    aliases: Object.freeze([]),
  });

export interface ReviewAutomaticKeywordPreferences {
  readonly enabled: boolean;
  readonly includeLinkDomains: boolean;
  readonly excludedKeywords: readonly string[];
}

export const DEFAULT_REVIEW_AUTOMATIC_KEYWORD_PREFERENCES: Readonly<ReviewAutomaticKeywordPreferences> =
  Object.freeze({
    enabled: true,
    includeLinkDomains: false,
    excludedKeywords: Object.freeze([]),
  });

export interface ReviewPreferences {
  readonly format: typeof REVIEW_PREFERENCES_FORMAT;
  readonly version: typeof REVIEW_PREFERENCES_VERSION;
  readonly workspaceId: string;
  readonly quickTags: readonly string[];
  readonly automaticKeywords?: Readonly<ReviewAutomaticKeywordPreferences>;
  readonly vocabulary?: Readonly<ReviewVocabularyPreferences>;
  readonly associationPolicy?: Readonly<ReviewAssociationPolicyPreferences>;
  readonly explorationPolicy?: Readonly<ReviewExplorationPolicyPreferences>;
  readonly sourceSubscriptions?: Readonly<ReviewSourceSubscriptionPreferences>;
  readonly entryPreferenceProfile?: Readonly<EntryPreferenceProfile>;
  readonly entryAutomationPolicy?: Readonly<EntryAutomationPolicy>;
  readonly entrySplitRuleProfile?: Readonly<EntrySplitRuleProfile>;
  readonly entryClassificationProfile?: Readonly<EntryClassificationProfile>;
  readonly entrySavedQueries?: Readonly<EntrySavedQueries>;
}

export interface ReviewPreferencesStore {
  /** Isolates a temporary preference replacement through restore success or rollback. */
  replaceForRestore?<T>(
    workspaceId: string,
    preferences: Readonly<ReviewPreferences>,
    restore: () => Promise<T>,
  ): Promise<T>;
  load(workspaceId: string): Promise<Readonly<ReviewPreferences>>;
  save(
    workspaceId: string,
    quickTags: readonly string[],
    automaticKeywords?: Readonly<ReviewAutomaticKeywordPreferences>,
    vocabulary?: Readonly<ReviewVocabularyPreferences>,
    associationPolicy?: Readonly<ReviewAssociationPolicyPreferences>,
    explorationPolicy?: Readonly<ReviewExplorationPolicyPreferences>,
    sourceSubscriptions?: Readonly<ReviewSourceSubscriptionPreferences>,
    entryPreferenceProfile?: Readonly<EntryPreferenceProfile>,
    entryAutomationPolicy?: Readonly<EntryAutomationPolicy>,
    entrySplitRuleProfile?: Readonly<EntrySplitRuleProfile>,
    entryClassificationProfile?: Readonly<EntryClassificationProfile>,
    entrySavedQueries?: Readonly<EntrySavedQueries>,
  ): Promise<Readonly<ReviewPreferences>>;
  update?<T>(
    workspaceId: string,
    updater: ReviewPreferencesUpdater<T>,
  ): Promise<Readonly<ReviewPreferencesUpdateResult<T>>>;
}

export interface ReviewPreferencesUpdate<T> {
  readonly next: Readonly<ReviewPreferences>;
  readonly result: T;
}

export interface ReviewPreferencesUpdateResult<T> {
  readonly preferences: Readonly<ReviewPreferences>;
  readonly result: T;
}

export type ReviewPreferencesUpdater<T> = (
  current: Readonly<ReviewPreferences>,
) => Readonly<ReviewPreferencesUpdate<T>>;

export interface ReviewPreferencesPatch {
  readonly quickTags?: readonly string[];
  readonly automaticKeywords?: Readonly<ReviewAutomaticKeywordPreferences>;
  readonly vocabulary?: Readonly<ReviewVocabularyPreferences>;
  readonly associationPolicy?: Readonly<ReviewAssociationPolicyPreferences>;
  readonly explorationPolicy?: Readonly<ReviewExplorationPolicyPreferences>;
  readonly sourceSubscriptions?: Readonly<ReviewSourceSubscriptionPreferences>;
  readonly entryPreferenceProfile?: Readonly<EntryPreferenceProfile>;
  readonly entryAutomationPolicy?: Readonly<EntryAutomationPolicy>;
  readonly entrySplitRuleProfile?: Readonly<EntrySplitRuleProfile>;
  readonly entryClassificationProfile?: Readonly<EntryClassificationProfile>;
  readonly entrySavedQueries?: Readonly<EntrySavedQueries>;
}

export function patchReviewPreferences(
  current: Readonly<ReviewPreferences>,
  patch: Readonly<ReviewPreferencesPatch>,
): Readonly<ReviewPreferences> {
  return createReviewPreferences(
    current.workspaceId,
    patch.quickTags ?? current.quickTags,
    patch.automaticKeywords ??
      current.automaticKeywords ??
      DEFAULT_REVIEW_AUTOMATIC_KEYWORD_PREFERENCES,
    patch.vocabulary ??
      current.vocabulary ??
      DEFAULT_REVIEW_VOCABULARY_PREFERENCES,
    patch.associationPolicy ??
      current.associationPolicy ??
      DEFAULT_REVIEW_ASSOCIATION_POLICY_PREFERENCES,
    patch.explorationPolicy ??
      current.explorationPolicy ??
      DEFAULT_REVIEW_EXPLORATION_POLICY_PREFERENCES,
    patch.sourceSubscriptions ??
      current.sourceSubscriptions ??
      DEFAULT_REVIEW_SOURCE_SUBSCRIPTION_PREFERENCES,
    patch.entryPreferenceProfile ??
      current.entryPreferenceProfile ??
      DEFAULT_ENTRY_PREFERENCE_PROFILE,
    patch.entryAutomationPolicy ??
      current.entryAutomationPolicy ??
      DEFAULT_ENTRY_AUTOMATION_POLICY,
    patch.entrySplitRuleProfile ??
      current.entrySplitRuleProfile ??
      DEFAULT_ENTRY_SPLIT_RULE_PROFILE,
    patch.entryClassificationProfile ??
      current.entryClassificationProfile ??
      DEFAULT_ENTRY_CLASSIFICATION_PROFILE,
    patch.entrySavedQueries ??
      current.entrySavedQueries ??
      DEFAULT_ENTRY_SAVED_QUERIES,
  );
}

/**
 * Applies one read-modify-write operation.
 *
 * The external-file implementation serializes this operation per workspace.
 * Small in-memory test ports may omit update and use the compatibility fallback.
 */
export async function updateReviewPreferences<T>(
  store: ReviewPreferencesStore,
  workspaceId: string,
  updater: ReviewPreferencesUpdater<T>,
): Promise<Readonly<ReviewPreferencesUpdateResult<T>>> {
  if (store.update !== undefined) {
    return store.update(workspaceId, updater);
  }
  const current = await store.load(workspaceId);
  const update = updater(current);
  const preferences =
    update.next === current
      ? current
      : await store.save(
          workspaceId,
          update.next.quickTags,
          update.next.automaticKeywords,
          update.next.vocabulary,
          update.next.associationPolicy,
          update.next.explorationPolicy,
          update.next.sourceSubscriptions,
          update.next.entryPreferenceProfile,
          update.next.entryAutomationPolicy,
          update.next.entrySplitRuleProfile,
          update.next.entryClassificationProfile,
          update.next.entrySavedQueries,
        );
  return Object.freeze({preferences, result: update.result});
}

export class ReviewPreferencesStoreError extends Error {
  public readonly code: 'preferences_invalid' | 'preferences_unavailable';

  public constructor(
    code: ReviewPreferencesStoreError['code'],
    message = 'Review preferences are unavailable.',
  ) {
    super(message);
    this.name = 'ReviewPreferencesStoreError';
    this.code = code;
  }
}

export function decodeReviewQuickTags(
  value: unknown,
): readonly string[] | undefined {
  return decodeKeywordList(value, MAX_REVIEW_QUICK_TAGS);
}

export function decodeReviewAutomaticKeywordPreferences(
  value: unknown,
): Readonly<ReviewAutomaticKeywordPreferences> | undefined {
  if (
    !isRecord(value) ||
    (value.enabled !== true && value.enabled !== false) ||
    (value.includeLinkDomains !== true && value.includeLinkDomains !== false)
  ) {
    return undefined;
  }
  const excludedKeywords = decodeKeywordList(
    value.excludedKeywords,
    MAX_REVIEW_KEYWORD_EXCLUSIONS,
  );
  if (excludedKeywords === undefined) return undefined;
  return Object.freeze({
    enabled: value.enabled,
    includeLinkDomains: value.includeLinkDomains,
    excludedKeywords,
  });
}

export function decodeReviewVocabularyPreferences(
  value: unknown,
): Readonly<ReviewVocabularyPreferences> | undefined {
  if (!isRecord(value)) return undefined;
  const aliases = decodeAliases(value.aliases);
  if (aliases === undefined) return undefined;
  return Object.freeze({aliases});
}

export function decodeReviewAssociationPolicyPreferences(
  value: unknown,
): Readonly<ReviewAssociationPolicyPreferences> | undefined {
  if (!isRecord(value)) return undefined;
  const values = [
    value.revision,
    value.contentWeight,
    value.typeWeight,
    value.domainWeight,
    value.threshold,
  ];
  if (
    values.some(
      (candidate) =>
        typeof candidate !== 'number' || !Number.isSafeInteger(candidate),
    ) ||
    (value.revision as number) < 0 ||
    (value.contentWeight as number) < 0 ||
    (value.typeWeight as number) < 0 ||
    (value.domainWeight as number) < 0 ||
    (value.contentWeight as number) +
      (value.typeWeight as number) +
      (value.domainWeight as number) !==
      100 ||
    (value.threshold as number) < 0 ||
    (value.threshold as number) > 10_000
  ) {
    return undefined;
  }
  return Object.freeze({
    revision: value.revision as number,
    contentWeight: value.contentWeight as number,
    typeWeight: value.typeWeight as number,
    domainWeight: value.domainWeight as number,
    threshold: value.threshold as number,
  });
}

export function decodeReviewExplorationPolicyPreferences(
  value: unknown,
): Readonly<ReviewExplorationPolicyPreferences> | undefined {
  if (
    !isRecord(value) ||
    typeof value.revision !== 'number' ||
    !Number.isSafeInteger(value.revision) ||
    value.revision < 0 ||
    (value.enabled !== true && value.enabled !== false) ||
    typeof value.resultShare !== 'number' ||
    !Number.isSafeInteger(value.resultShare) ||
    value.resultShare < 0 ||
    value.resultShare > 50 ||
    (value.neighborExpansion !== true && value.neighborExpansion !== false) ||
    (value.crossDomain !== true && value.crossDomain !== false) ||
    (value.serendipity !== true && value.serendipity !== false)
  ) {
    return undefined;
  }
  return Object.freeze({
    revision: value.revision,
    enabled: value.enabled,
    resultShare: value.resultShare,
    neighborExpansion: value.neighborExpansion,
    crossDomain: value.crossDomain,
    serendipity: value.serendipity,
  });
}

export function decodeReviewSourceSubscriptionPreferences(
  value: unknown,
): Readonly<ReviewSourceSubscriptionPreferences> | undefined {
  if (
    !isRecord(value) ||
    typeof value.revision !== 'number' ||
    !Number.isSafeInteger(value.revision) ||
    value.revision < 0 ||
    !Array.isArray(value.subscriptions) ||
    value.subscriptions.length > MAX_SOURCE_SUBSCRIPTIONS
  ) {
    return undefined;
  }
  const subscriptions: ReviewSourceSubscription[] = [];
  const identities = new Set<string>();
  for (const candidate of value.subscriptions) {
    const subscription = decodeSourceSubscription(candidate);
    if (
      subscription === undefined ||
      identities.has(subscription.subscriptionId)
    ) {
      return undefined;
    }
    identities.add(subscription.subscriptionId);
    subscriptions.push(subscription);
  }
  return Object.freeze({
    revision: value.revision,
    subscriptions: Object.freeze(subscriptions),
  });
}

export function decodeEntryPreferenceProfile(
  value: unknown,
): Readonly<EntryPreferenceProfile> | undefined {
  if (
    !isClosedRecord(value, ['enabled', 'revision', 'rules']) ||
    typeof value.revision !== 'number' ||
    !Number.isSafeInteger(value.revision) ||
    value.revision < 0 ||
    (value.enabled !== true && value.enabled !== false) ||
    !Array.isArray(value.rules) ||
    value.rules.length > MAX_ENTRY_PREFERENCE_RULES
  ) {
    return undefined;
  }
  const rules: Readonly<EntryPreferenceRule>[] = [];
  const ruleIds = new Set<string>();
  const featureRules = new Set<string>();
  for (const candidate of value.rules) {
    const rule = decodeEntryPreferenceRule(candidate);
    if (rule === undefined) return undefined;
    const featureRule = [
      rule.dimension,
      rule.featureKind,
      rule.featureIdentity,
    ].join(':');
    if (ruleIds.has(rule.ruleId) || featureRules.has(featureRule)) {
      return undefined;
    }
    ruleIds.add(rule.ruleId);
    featureRules.add(featureRule);
    rules.push(rule);
  }
  return Object.freeze({
    revision: value.revision,
    enabled: value.enabled,
    rules: Object.freeze(rules),
  });
}

export function decodeEntryAutomationPolicy(
  value: unknown,
): Readonly<EntryAutomationPolicy> | undefined {
  const baseKeys = [
    'advanceThresholds',
    'budgets',
    'deferThresholds',
    'enabled',
    'failureMode',
    'minimumMatchedRuleCount',
    'paused',
    'profileRevision',
    'revision',
  ] as const;
  if (
    (!isClosedRecord(value, baseKeys) &&
      !isClosedRecord(value, [...baseKeys, 'advanceActions'])) ||
    !isNonNegativeSafeInteger(value.revision) ||
    (value.enabled !== true && value.enabled !== false) ||
    (value.paused !== true && value.paused !== false) ||
    !isNonNegativeSafeInteger(value.profileRevision) ||
    !isIntegerInRange(
      value.minimumMatchedRuleCount,
      1,
      MAX_ENTRY_PREFERENCE_RULES,
    ) ||
    !ENTRY_AUTOMATION_FAILURE_MODES.includes(
      value.failureMode as EntryAutomationFailureMode,
    )
  ) {
    return undefined;
  }
  const advanceThresholds = decodeEntryAutomationThresholds(
    value.advanceThresholds,
  );
  const deferThresholds = decodeEntryAutomationThresholds(
    value.deferThresholds,
  );
  const budgets = decodeEntryAutomationBudgets(value.budgets);
  const advanceActions =
    value.advanceActions === undefined
      ? undefined
      : decodeEntryAutomationAdvanceActions(value.advanceActions);
  if (
    advanceThresholds === undefined ||
    deferThresholds === undefined ||
    budgets === undefined ||
    (value.advanceActions !== undefined && advanceActions === undefined)
  ) {
    return undefined;
  }
  return Object.freeze({
    revision: value.revision,
    enabled: value.enabled,
    paused: value.paused,
    profileRevision: value.profileRevision,
    minimumMatchedRuleCount: value.minimumMatchedRuleCount,
    advanceThresholds,
    deferThresholds,
    budgets,
    ...(advanceActions === undefined ? {} : {advanceActions}),
    failureMode: value.failureMode as EntryAutomationFailureMode,
  });
}
function decodeKeywordList(
  value: unknown,
  maximumItems: number,
): readonly string[] | undefined {
  if (!Array.isArray(value) || value.length > maximumItems) return undefined;
  const result: string[] = [];
  const identities = new Set<string>();
  for (const item of value) {
    if (typeof item !== 'string') return undefined;
    const tag = item.trim().normalize('NFC');
    if (
      tag.length === 0 ||
      Array.from(tag).length > MAX_REVIEW_QUICK_TAG_CODE_POINTS ||
      containsControlCodePoint(tag)
    ) {
      return undefined;
    }
    const identity = tag.toLowerCase();
    if (identities.has(identity)) return undefined;
    identities.add(identity);
    result.push(tag);
  }
  return Object.freeze(result);
}

function containsControlCodePoint(value: string): boolean {
  return Array.from(value).some((character) => {
    const codePoint = character.codePointAt(0);
    return codePoint !== undefined && (codePoint <= 0x1f || codePoint === 0x7f);
  });
}

export function createReviewPreferences(
  workspaceId: string,
  quickTags: readonly string[],
  automaticKeywords: Readonly<ReviewAutomaticKeywordPreferences> = DEFAULT_REVIEW_AUTOMATIC_KEYWORD_PREFERENCES,
  vocabulary: Readonly<ReviewVocabularyPreferences> = DEFAULT_REVIEW_VOCABULARY_PREFERENCES,
  associationPolicy: Readonly<ReviewAssociationPolicyPreferences> = DEFAULT_REVIEW_ASSOCIATION_POLICY_PREFERENCES,
  explorationPolicy: Readonly<ReviewExplorationPolicyPreferences> = DEFAULT_REVIEW_EXPLORATION_POLICY_PREFERENCES,
  sourceSubscriptions: Readonly<ReviewSourceSubscriptionPreferences> = DEFAULT_REVIEW_SOURCE_SUBSCRIPTION_PREFERENCES,
  entryPreferenceProfile: Readonly<EntryPreferenceProfile> = DEFAULT_ENTRY_PREFERENCE_PROFILE,
  entryAutomationPolicy: Readonly<EntryAutomationPolicy> = DEFAULT_ENTRY_AUTOMATION_POLICY,
  entrySplitRuleProfile: Readonly<EntrySplitRuleProfile> = DEFAULT_ENTRY_SPLIT_RULE_PROFILE,
  entryClassificationProfile: Readonly<EntryClassificationProfile> = DEFAULT_ENTRY_CLASSIFICATION_PROFILE,
  entrySavedQueries: Readonly<EntrySavedQueries> = DEFAULT_ENTRY_SAVED_QUERIES,
): Readonly<ReviewPreferences> {
  const advanceActions =
    entryAutomationPolicy.advanceActions ??
    Object.freeze({
      deterministicTags: false,
      rebuildAssociations: false,
    });
  return Object.freeze({
    format: REVIEW_PREFERENCES_FORMAT,
    version: REVIEW_PREFERENCES_VERSION,
    workspaceId,
    quickTags: Object.freeze([...quickTags]),
    entrySavedQueries,
    automaticKeywords: Object.freeze({
      enabled: automaticKeywords.enabled,
      includeLinkDomains: automaticKeywords.includeLinkDomains,
      excludedKeywords: Object.freeze([...automaticKeywords.excludedKeywords]),
    }),
    vocabulary: Object.freeze({
      aliases: Object.freeze(
        vocabulary.aliases.map((rule) => Object.freeze({...rule})),
      ),
    }),
    associationPolicy: Object.freeze({...associationPolicy}),
    explorationPolicy: Object.freeze({...explorationPolicy}),
    sourceSubscriptions: Object.freeze({
      revision: sourceSubscriptions.revision,
      subscriptions: Object.freeze(
        sourceSubscriptions.subscriptions.map(cloneSourceSubscription),
      ),
    }),
    entryPreferenceProfile: Object.freeze({
      revision: entryPreferenceProfile.revision,
      enabled: entryPreferenceProfile.enabled,
      rules: Object.freeze(
        entryPreferenceProfile.rules.map((rule) => Object.freeze({...rule})),
      ),
    }),
    entryAutomationPolicy: Object.freeze({
      revision: entryAutomationPolicy.revision,
      enabled: entryAutomationPolicy.enabled,
      paused: entryAutomationPolicy.paused,
      profileRevision: entryAutomationPolicy.profileRevision,
      minimumMatchedRuleCount: entryAutomationPolicy.minimumMatchedRuleCount,
      advanceThresholds: Object.freeze({
        ...entryAutomationPolicy.advanceThresholds,
      }),
      deferThresholds: Object.freeze({
        ...entryAutomationPolicy.deferThresholds,
      }),
      budgets: Object.freeze({...entryAutomationPolicy.budgets}),
      advanceActions: Object.freeze({
        deterministicTags: advanceActions.deterministicTags,
        rebuildAssociations: advanceActions.rebuildAssociations,
      }),
      failureMode: entryAutomationPolicy.failureMode,
    }),
    entrySplitRuleProfile: Object.freeze({...entrySplitRuleProfile}),
    entryClassificationProfile: Object.freeze({
      format: entryClassificationProfile.format,
      version: ENTRY_CLASSIFICATION_PROFILE_VERSION,
      revision: entryClassificationProfile.revision,
      aliases: Object.freeze(
        entryClassificationProfile.aliases.map((alias) =>
          Object.freeze({...alias}),
        ),
      ),
      typeMappings: Object.freeze(
        entryClassificationProfile.typeMappings.map((mapping) =>
          Object.freeze({...mapping}),
        ),
      ),
      domainMappings: Object.freeze(
        entryClassificationProfile.domainMappings.map((mapping) =>
          Object.freeze({...mapping}),
        ),
      ),
      exclusions: Object.freeze([...entryClassificationProfile.exclusions]),
      typeThresholds: Object.freeze(
        (
          entryClassificationProfile.typeThresholds ??
          DEFAULT_ENTRY_CLASSIFICATION_TYPE_THRESHOLDS
        ).map((threshold) => Object.freeze({...threshold})),
      ),
      domainThresholds: Object.freeze(
        (
          entryClassificationProfile.domainThresholds ??
          DEFAULT_ENTRY_CLASSIFICATION_DOMAIN_THRESHOLDS
        ).map((threshold) => Object.freeze({...threshold})),
      ),
      neighborPolicy: Object.freeze({
        ...(entryClassificationProfile.neighborPolicy ??
          DEFAULT_ENTRY_CLASSIFICATION_NEIGHBOR_POLICY),
      }),
      typeLearning: cloneEntryTypeLearningState(
        entryClassificationProfile.typeLearning ??
          DEFAULT_ENTRY_TYPE_LEARNING_STATE,
      ),
    }),
  });
}

function decodeEntryAutomationAdvanceActions(
  value: unknown,
): Readonly<EntryAutomationAdvanceActions> | undefined {
  if (
    !isClosedRecord(value, ['deterministicTags', 'rebuildAssociations']) ||
    (value.deterministicTags !== true && value.deterministicTags !== false) ||
    (value.rebuildAssociations !== true && value.rebuildAssociations !== false)
  ) {
    return undefined;
  }
  return Object.freeze({
    deterministicTags: value.deterministicTags,
    rebuildAssociations: value.rebuildAssociations,
  });
}

function decodeEntryAutomationThresholds(
  value: unknown,
): Readonly<EntryAutomationThresholds> | undefined {
  if (
    !isClosedRecord(value, ['interest', 'requiredDimensions', 'usefulness']) ||
    !isIntegerInRange(
      value.usefulness,
      1,
      MAX_ENTRY_AUTOMATION_SCORE_THRESHOLD,
    ) ||
    !isIntegerInRange(
      value.interest,
      1,
      MAX_ENTRY_AUTOMATION_SCORE_THRESHOLD,
    ) ||
    (value.requiredDimensions !== 1 && value.requiredDimensions !== 2)
  ) {
    return undefined;
  }
  return Object.freeze({
    usefulness: value.usefulness,
    interest: value.interest,
    requiredDimensions: value.requiredDimensions,
  });
}

function decodeEntryAutomationBudgets(
  value: unknown,
): Readonly<EntryAutomationBudgets> | undefined {
  if (
    !isClosedRecord(value, [
      'maximumAdvanceCandidatesPerRun',
      'maximumDeferCandidatesPerRun',
      'maximumEntriesPerRun',
    ]) ||
    !isIntegerInRange(
      value.maximumEntriesPerRun,
      1,
      MAX_ENTRY_AUTOMATION_ENTRIES_PER_RUN,
    ) ||
    !isIntegerInRange(
      value.maximumAdvanceCandidatesPerRun,
      0,
      value.maximumEntriesPerRun,
    ) ||
    !isIntegerInRange(
      value.maximumDeferCandidatesPerRun,
      0,
      value.maximumEntriesPerRun,
    )
  ) {
    return undefined;
  }
  return Object.freeze({
    maximumEntriesPerRun: value.maximumEntriesPerRun,
    maximumAdvanceCandidatesPerRun: value.maximumAdvanceCandidatesPerRun,
    maximumDeferCandidatesPerRun: value.maximumDeferCandidatesPerRun,
  });
}

function isIntegerInRange(
  value: unknown,
  minimum: number,
  maximum: number,
): value is number {
  return (
    typeof value === 'number' &&
    Number.isSafeInteger(value) &&
    value >= minimum &&
    value <= maximum
  );
}

function isNonNegativeSafeInteger(value: unknown): value is number {
  return isIntegerInRange(value, 0, Number.MAX_SAFE_INTEGER);
}

function decodeEntryPreferenceRule(
  value: unknown,
): Readonly<EntryPreferenceRule> | undefined {
  if (
    !isClosedRecord(value, [
      'dimension',
      'displayValue',
      'effect',
      'featureIdentity',
      'featureKind',
      'ruleId',
      'weight',
    ]) ||
    typeof value.ruleId !== 'string' ||
    !CANONICAL_UUID.test(value.ruleId) ||
    typeof value.dimension !== 'string' ||
    !ENTRY_PREFERENCE_DIMENSIONS.includes(
      value.dimension as EntryPreferenceDimension,
    ) ||
    typeof value.featureKind !== 'string' ||
    !ENTRY_PREFERENCE_FEATURE_KINDS.includes(
      value.featureKind as EntryPreferenceFeatureKind,
    ) ||
    typeof value.featureIdentity !== 'string' ||
    typeof value.displayValue !== 'string' ||
    typeof value.effect !== 'string' ||
    !ENTRY_PREFERENCE_EFFECTS.includes(value.effect as EntryPreferenceEffect) ||
    typeof value.weight !== 'number' ||
    !Number.isInteger(value.weight) ||
    value.weight < 1 ||
    value.weight > 5
  ) {
    return undefined;
  }
  const displayValue = decodeBoundedText(
    value.displayValue,
    MAX_ENTRY_PREFERENCE_DISPLAY_CODE_POINTS,
  );
  const featureIdentity = decodeEntryPreferenceFeatureIdentity(
    value.featureIdentity,
  );
  if (displayValue === undefined || featureIdentity === undefined) {
    return undefined;
  }
  return Object.freeze({
    ruleId: value.ruleId,
    dimension: value.dimension as EntryPreferenceDimension,
    featureKind: value.featureKind as EntryPreferenceFeatureKind,
    featureIdentity,
    displayValue,
    effect: value.effect as EntryPreferenceEffect,
    weight: value.weight as EntryPreferenceRule['weight'],
  });
}

function decodeEntryPreferenceFeatureIdentity(
  value: string,
): string | undefined {
  const normalized = normalizeEntryPreferenceFeatureIdentity(value);
  return normalized.length > 0 &&
    Array.from(normalized).length <= MAX_ENTRY_PREFERENCE_FEATURE_CODE_POINTS &&
    !containsControlCodePoint(normalized) &&
    value === normalized
    ? normalized
    : undefined;
}

export function normalizeEntryPreferenceFeatureIdentity(value: string): string {
  const firstNfc = value.trim().normalize('NFC');
  let lowered = '';
  for (const codePoint of firstNfc) {
    const code = codePoint.codePointAt(0);
    lowered +=
      code !== undefined && code >= 0x41 && code <= 0x5a
        ? String.fromCodePoint(code + 0x20)
        : codePoint;
  }
  return lowered.normalize('NFC');
}

function decodeSourceSubscription(
  value: unknown,
): Readonly<ReviewSourceSubscription> | undefined {
  if (
    !isRecord(value) ||
    typeof value.subscriptionId !== 'string' ||
    !CANONICAL_UUID.test(value.subscriptionId) ||
    typeof value.label !== 'string' ||
    (value.enabled !== true && value.enabled !== false) ||
    typeof value.sourceAlias !== 'string' ||
    (value.isPrivate !== true && value.isPrivate !== false) ||
    (value.routeAfterImport !== undefined &&
      value.routeAfterImport !== true &&
      value.routeAfterImport !== false) ||
    typeof value.intervalMinutes !== 'number' ||
    !Number.isSafeInteger(value.intervalMinutes) ||
    value.intervalMinutes < 15 ||
    value.intervalMinutes > 10_080 ||
    !optionalInstant(value.lastAttemptAt) ||
    !optionalInstant(value.lastSuccessAt) ||
    (value.lastRunId !== undefined &&
      (typeof value.lastRunId !== 'string' ||
        !CANONICAL_UUID.test(value.lastRunId)))
  ) {
    return undefined;
  }
  const label = decodeBoundedText(value.label, 120);
  const sourceAlias = decodeBoundedText(value.sourceAlias, 500);
  if (label === undefined || sourceAlias === undefined) {
    return undefined;
  }
  const common = Object.freeze({
    subscriptionId: value.subscriptionId,
    label,
    enabled: value.enabled,
    sourceAlias,
    isPrivate: value.isPrivate,
    routeAfterImport: value.routeAfterImport === true,
    intervalMinutes: value.intervalMinutes,
    ...(typeof value.lastAttemptAt === 'string'
      ? {lastAttemptAt: value.lastAttemptAt}
      : {}),
    ...(typeof value.lastSuccessAt === 'string'
      ? {lastSuccessAt: value.lastSuccessAt}
      : {}),
    ...(typeof value.lastRunId === 'string'
      ? {lastRunId: value.lastRunId}
      : {}),
  });
  const kind = value.kind ?? 'github_markdown';
  if (kind === 'rss_atom') {
    if (
      typeof value.feedUrl !== 'string' ||
      !Number.isSafeInteger(value.itemLimit) ||
      (value.itemLimit as number) < 1 ||
      (value.itemLimit as number) > 20
    ) {
      return undefined;
    }
    const feedUrl = decodePublicHttpsUri(value.feedUrl);
    const cursor = decodeRssSourceSubscriptionCursor(value.cursor);
    if (
      feedUrl === undefined ||
      (value.cursor !== undefined && cursor === undefined)
    ) {
      return undefined;
    }
    return Object.freeze({
      ...common,
      kind: 'rss_atom' as const,
      feedUrl,
      itemLimit: value.itemLimit as number,
      ...(cursor === undefined ? {} : {cursor}),
    });
  }
  if (kind === 'json_api') {
    if (
      typeof value.endpointUrl !== 'string' ||
      typeof value.recordsPath !== 'string' ||
      typeof value.externalIdPath !== 'string' ||
      typeof value.titlePath !== 'string' ||
      typeof value.bodyPath !== 'string' ||
      !optionalJsonApiPath(value.canonicalUriPath) ||
      !optionalJsonApiPath(value.publishedAtPath) ||
      !optionalJsonApiPath(value.versionPath) ||
      !Number.isSafeInteger(value.recordLimit) ||
      (value.recordLimit as number) < 1 ||
      (value.recordLimit as number) > 32
    ) {
      return undefined;
    }
    const endpointUrl = decodePublicHttpsUri(value.endpointUrl);
    const recordsPath = decodeJsonApiPath(value.recordsPath, true);
    const externalIdPath = decodeJsonApiPath(value.externalIdPath, false);
    const titlePath = decodeJsonApiPath(value.titlePath, false);
    const bodyPath = decodeJsonApiPath(value.bodyPath, false);
    const canonicalUriPath = decodeOptionalJsonApiPath(value.canonicalUriPath);
    const publishedAtPath = decodeOptionalJsonApiPath(value.publishedAtPath);
    const versionPath = decodeOptionalJsonApiPath(value.versionPath);
    const pageCursor = decodeJsonApiCursorMapping(value.pageCursor);
    const incrementalCursor = decodeJsonApiCursorMapping(
      value.incrementalCursor,
    );
    const authentication = decodeJsonApiAuthentication(value.authentication);
    const cursor = decodeConnectorSourceSubscriptionCursor(value.cursor);
    if (
      endpointUrl === undefined ||
      recordsPath === undefined ||
      externalIdPath === undefined ||
      titlePath === undefined ||
      bodyPath === undefined ||
      canonicalUriPath === null ||
      publishedAtPath === null ||
      versionPath === null ||
      (value.pageCursor !== undefined && pageCursor === undefined) ||
      (value.incrementalCursor !== undefined &&
        incrementalCursor === undefined) ||
      (pageCursor !== undefined &&
        incrementalCursor?.queryParameter === pageCursor.queryParameter) ||
      authentication === undefined ||
      (value.cursor !== undefined && cursor === undefined)
    ) {
      return undefined;
    }
    return Object.freeze({
      ...common,
      kind: 'json_api' as const,
      endpointUrl,
      recordsPath,
      externalIdPath,
      titlePath,
      bodyPath,
      ...(canonicalUriPath === undefined ? {} : {canonicalUriPath}),
      ...(publishedAtPath === undefined ? {} : {publishedAtPath}),
      ...(versionPath === undefined ? {} : {versionPath}),
      recordLimit: value.recordLimit as number,
      ...(pageCursor === undefined ? {} : {pageCursor}),
      ...(incrementalCursor === undefined ? {} : {incrementalCursor}),
      authentication,
      ...(cursor === undefined ? {} : {cursor}),
    });
  }
  if (kind === 'web') {
    const pageUrl =
      typeof value.pageUrl === 'string'
        ? decodePublicHttpsUri(value.pageUrl)
        : undefined;
    const additionalPaths = decodeWebAdditionalPaths(value.additionalPaths);
    const cursor = decodeConnectorSourceSubscriptionCursor(value.cursor);
    if (
      pageUrl === undefined ||
      additionalPaths === undefined ||
      (value.cursor !== undefined && cursor === undefined)
    ) {
      return undefined;
    }
    return Object.freeze({
      ...common,
      kind: 'web' as const,
      pageUrl,
      additionalPaths,
      ...(cursor === undefined ? {} : {cursor}),
    });
  }
  if (kind === 'plugin') {
    const cursor = decodeConnectorSourceSubscriptionCursor(value.cursor);
    if (
      typeof value.connectorId !== 'string' ||
      !PLUGIN_CONNECTOR_ID.test(value.connectorId) ||
      typeof value.configurationRef !== 'string' ||
      !PLUGIN_CONFIGURATION_REFERENCE.test(value.configurationRef) ||
      (value.cursor !== undefined && cursor === undefined)
    ) {
      return undefined;
    }
    return Object.freeze({
      ...common,
      kind: 'plugin' as const,
      connectorId: value.connectorId,
      configurationRef: value.configurationRef,
      ...(cursor === undefined ? {} : {cursor}),
    });
  }
  if (
    kind !== 'github_markdown' ||
    typeof value.repositoryUri !== 'string' ||
    typeof value.repositoryRef !== 'string' ||
    typeof value.repositoryPath !== 'string' ||
    (value.profile !== 'commonmark-v1' && value.profile !== 'ruanyf-weekly-v1')
  ) {
    return undefined;
  }
  const repositoryUri = decodeGithubRepositoryUri(value.repositoryUri);
  const repositoryRef = decodeRepositoryRef(value.repositoryRef);
  const repositoryPath = decodeRepositoryPath(value.repositoryPath);
  const cursor = decodeGitSourceSubscriptionCursor(value.cursor);
  if (
    repositoryUri === undefined ||
    repositoryRef === undefined ||
    repositoryPath === undefined ||
    (value.cursor !== undefined && cursor === undefined)
  ) {
    return undefined;
  }
  return Object.freeze({
    ...common,
    kind: 'github_markdown' as const,
    repositoryUri,
    repositoryRef,
    repositoryPath,
    profile: value.profile,
    ...(cursor === undefined ? {} : {cursor}),
  });
}

function cloneSourceSubscription(
  subscription: Readonly<ReviewSourceSubscription>,
): Readonly<ReviewSourceSubscription> {
  if (subscription.kind === 'rss_atom') {
    return Object.freeze({
      ...subscription,
      kind: subscription.kind,
      ...(subscription.cursor === undefined
        ? {}
        : {
            cursor: Object.freeze({
              connectorCursor: subscription.cursor.connectorCursor,
            }),
          }),
    });
  }
  if (subscription.kind === 'json_api') {
    return Object.freeze({
      ...subscription,
      kind: subscription.kind,
      ...(subscription.pageCursor === undefined
        ? {}
        : {pageCursor: Object.freeze({...subscription.pageCursor})}),
      ...(subscription.incrementalCursor === undefined
        ? {}
        : {
            incrementalCursor: Object.freeze({
              ...subscription.incrementalCursor,
            }),
          }),
      authentication: Object.freeze({...subscription.authentication}),
      ...(subscription.cursor === undefined
        ? {}
        : {
            cursor: Object.freeze({
              connectorCursor: subscription.cursor.connectorCursor,
            }),
          }),
    });
  }
  if (subscription.kind === 'web') {
    return Object.freeze({
      ...subscription,
      additionalPaths: Object.freeze([...subscription.additionalPaths]),
      ...(subscription.cursor === undefined
        ? {}
        : {
            cursor: Object.freeze({
              connectorCursor: subscription.cursor.connectorCursor,
            }),
          }),
    });
  }
  if (subscription.kind === 'plugin') {
    return Object.freeze({
      ...subscription,
      ...(subscription.cursor === undefined
        ? {}
        : {
            cursor: Object.freeze({
              connectorCursor: subscription.cursor.connectorCursor,
            }),
          }),
    });
  }
  return Object.freeze({
    ...subscription,
    ...(subscription.kind === undefined ? {} : {kind: subscription.kind}),
    ...(subscription.cursor === undefined
      ? {}
      : {
          cursor: Object.freeze({
            commitSha: subscription.cursor.commitSha,
            sourceSha256: subscription.cursor.sourceSha256,
          }),
        }),
  });
}

function decodeGitSourceSubscriptionCursor(
  value: unknown,
): Readonly<ReviewGitSourceSubscriptionCursor> | undefined {
  if (value === undefined) return undefined;
  if (
    !isRecord(value) ||
    typeof value.commitSha !== 'string' ||
    !SHA1.test(value.commitSha) ||
    typeof value.sourceSha256 !== 'string' ||
    !SHA256.test(value.sourceSha256)
  ) {
    return undefined;
  }
  return Object.freeze({
    commitSha: value.commitSha,
    sourceSha256: value.sourceSha256,
  });
}

function decodeRssSourceSubscriptionCursor(
  value: unknown,
): Readonly<ReviewRssSourceSubscriptionCursor> | undefined {
  return decodeConnectorSourceSubscriptionCursor(value);
}

function decodeConnectorSourceSubscriptionCursor(
  value: unknown,
): Readonly<ReviewRssSourceSubscriptionCursor> | undefined {
  if (value === undefined) return undefined;
  if (
    !isRecord(value) ||
    Object.keys(value).length !== 1 ||
    typeof value.connectorCursor !== 'string' ||
    value.connectorCursor.length === 0 ||
    Array.from(value.connectorCursor).length > 2_048 ||
    containsControlCodePoint(value.connectorCursor)
  ) {
    return undefined;
  }
  return Object.freeze({connectorCursor: value.connectorCursor});
}

const JSON_API_PATH =
  /^(?:[A-Za-z_][A-Za-z0-9_-]{0,99})(?:\.(?:[A-Za-z_][A-Za-z0-9_-]{0,99})){0,7}$/u;
const JSON_API_QUERY_PARAMETER = /^[A-Za-z_][A-Za-z0-9_.-]{0,79}$/u;
const ENVIRONMENT_VARIABLE = /^[A-Z_][A-Z0-9_]{0,99}$/u;
const PLUGIN_CONNECTOR_ID = /^plugin(?:[._-][a-z0-9]+){1,7}$/u;
const PLUGIN_CONFIGURATION_REFERENCE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/u;

function decodeWebAdditionalPaths(
  value: unknown,
): readonly string[] | undefined {
  if (!Array.isArray(value) || value.length > 7) return undefined;
  const decoded: string[] = [];
  const seen = new Set<string>();
  for (const path of value) {
    if (
      typeof path !== 'string' ||
      !path.startsWith('/') ||
      path.startsWith('//') ||
      path.includes('\\') ||
      path.includes('#') ||
      Array.from(path).length > 500 ||
      containsControlCodePoint(path) ||
      seen.has(path)
    ) {
      return undefined;
    }
    seen.add(path);
    decoded.push(path);
  }
  return Object.freeze(decoded);
}

function decodeJsonApiPath(
  value: string,
  allowEmpty: boolean,
): string | undefined {
  return (allowEmpty && value === '') || JSON_API_PATH.test(value)
    ? value
    : undefined;
}

function optionalJsonApiPath(value: unknown): boolean {
  return value === undefined || typeof value === 'string';
}

function decodeOptionalJsonApiPath(value: unknown): string | undefined | null {
  if (value === undefined) return undefined;
  if (typeof value !== 'string') return null;
  if (value === '') return undefined;
  return decodeJsonApiPath(value, false) ?? null;
}

function decodeJsonApiCursorMapping(
  value: unknown,
): Readonly<ReviewJsonApiCursorMapping> | undefined {
  if (value === undefined) return undefined;
  if (
    !isClosedRecord(value, ['queryParameter', 'responsePath']) ||
    typeof value.queryParameter !== 'string' ||
    !JSON_API_QUERY_PARAMETER.test(value.queryParameter) ||
    typeof value.responsePath !== 'string'
  ) {
    return undefined;
  }
  const responsePath = decodeJsonApiPath(value.responsePath, false);
  return responsePath === undefined
    ? undefined
    : Object.freeze({
        queryParameter: value.queryParameter,
        responsePath,
      });
}

function decodeJsonApiAuthentication(
  value: unknown,
): Readonly<ReviewJsonApiAuthentication> | undefined {
  if (!isRecord(value)) return undefined;
  if (value.kind === 'none') {
    return isClosedRecord(value, ['kind'])
      ? Object.freeze({kind: 'none' as const})
      : undefined;
  }
  return value.kind === 'bearer_env' &&
    isClosedRecord(value, ['kind', 'variable']) &&
    typeof value.variable === 'string' &&
    ENVIRONMENT_VARIABLE.test(value.variable)
    ? Object.freeze({kind: 'bearer_env' as const, variable: value.variable})
    : undefined;
}

function decodePublicHttpsUri(value: string): string | undefined {
  if (
    value.trim() !== value ||
    Array.from(value).length > 2_000 ||
    containsControlCodePoint(value)
  ) {
    return undefined;
  }
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return undefined;
  }
  return parsed.protocol === 'https:' &&
    parsed.username === '' &&
    parsed.password === '' &&
    parsed.hash === '' &&
    parsed.hostname !== ''
    ? parsed.toString()
    : undefined;
}

function decodeGithubRepositoryUri(value: string): string | undefined {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return undefined;
  }
  if (
    parsed.protocol !== 'https:' ||
    parsed.hostname !== 'github.com' ||
    parsed.port !== '' ||
    parsed.username !== '' ||
    parsed.password !== '' ||
    parsed.search !== '' ||
    parsed.hash !== ''
  ) {
    return undefined;
  }
  const segments = parsed.pathname.split('/').filter(Boolean);
  if (segments.length !== 2) return undefined;
  const [owner, rawRepository] = segments;
  const repository = rawRepository?.endsWith('.git')
    ? rawRepository.slice(0, -4)
    : rawRepository;
  if (
    owner === undefined ||
    repository === undefined ||
    !/^[A-Za-z0-9](?:[A-Za-z0-9_.-]{0,99})$/u.test(owner) ||
    !/^[A-Za-z0-9](?:[A-Za-z0-9_.-]{0,99})$/u.test(repository)
  ) {
    return undefined;
  }
  return `https://github.com/${owner}/${repository}`;
}

function decodeRepositoryRef(value: string): string | undefined {
  const normalized = value.normalize('NFC').trim();
  return normalized.length > 0 &&
    Array.from(normalized).length <= 200 &&
    /^[A-Za-z0-9][A-Za-z0-9._/-]*$/u.test(normalized) &&
    !normalized.includes('..') &&
    !normalized.includes('//') &&
    !normalized.endsWith('/') &&
    !normalized.endsWith('.lock')
    ? normalized
    : undefined;
}

function decodeRepositoryPath(value: string): string | undefined {
  const normalized = value.normalize('NFC').trim();
  if (
    normalized.length === 0 ||
    Array.from(normalized).length > 500 ||
    normalized.startsWith('/') ||
    normalized.endsWith('/') ||
    normalized.includes('\\') ||
    normalized.includes('//') ||
    normalized
      .split('/')
      .some((segment) => segment === '.' || segment === '..') ||
    !/\.(?:md|markdown)$/iu.test(normalized) ||
    containsControlCodePoint(normalized)
  ) {
    return undefined;
  }
  return normalized;
}

function decodeBoundedText(value: string, maximum: number): string | undefined {
  const normalized = value.normalize('NFC').trim();
  return normalized.length > 0 &&
    Array.from(normalized).length <= maximum &&
    !containsControlCodePoint(normalized)
    ? normalized
    : undefined;
}

function optionalInstant(value: unknown): boolean {
  if (value === undefined) return true;
  if (typeof value !== 'string') return false;
  const parsed = new Date(value);
  return Number.isFinite(parsed.valueOf()) && parsed.toISOString() === value;
}

function decodeAliases(
  value: unknown,
): ReviewVocabularyPreferences['aliases'] | undefined {
  if (!Array.isArray(value) || value.length > MAX_REVIEW_VOCABULARY_ALIASES) {
    return undefined;
  }
  const result: {source: string; canonical: string}[] = [];
  const sources = new Set<string>();
  for (const candidate of value) {
    if (!isRecord(candidate)) return undefined;
    const source = decodeKeyword(candidate.source);
    const canonical = decodeKeyword(candidate.canonical);
    if (source === undefined || canonical === undefined) return undefined;
    const sourceIdentity = keywordIdentity(source);
    if (
      sourceIdentity === keywordIdentity(canonical) ||
      sources.has(sourceIdentity)
    ) {
      return undefined;
    }
    sources.add(sourceIdentity);
    result.push({source, canonical});
  }
  if (hasAliasCycle(result)) return undefined;
  return Object.freeze(result.map((rule) => Object.freeze(rule)));
}

function decodeKeyword(value: unknown): string | undefined {
  const decoded = decodeKeywordList([value], 1);
  return decoded?.[0];
}

function keywordIdentity(value: string): string {
  return value.normalize('NFC').trim().toLowerCase();
}

function hasAliasCycle(
  aliases: readonly Readonly<{source: string; canonical: string}>[],
): boolean {
  const targets = new Map(
    aliases.map((rule) => [
      keywordIdentity(rule.source),
      keywordIdentity(rule.canonical),
    ]),
  );
  for (const source of targets.keys()) {
    const visited = new Set<string>();
    let current: string | undefined = source;
    while (current !== undefined && targets.has(current)) {
      if (visited.has(current)) return true;
      visited.add(current);
      current = targets.get(current);
    }
  }
  return false;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isClosedRecord(
  value: unknown,
  expectedKeys: readonly string[],
): value is Readonly<Record<string, unknown>> {
  if (!isRecord(value)) return false;
  const keys = Object.keys(value).sort();
  const expected = [...expectedKeys].sort();
  return (
    keys.length === expected.length &&
    keys.every((key, index) => key === expected[index])
  );
}
