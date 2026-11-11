import {
  sourceProcessingProfileSchema,
  type SourceProcessingProfile,
} from '../modules/subscriptions/source_processing_profile.js';
import {
  EMPTY_ANNOTATION_VOCABULARY,
  annotationVocabularySchema,
  type AnnotationVocabulary,
} from '../modules/entries/structured_annotations.js';
import {
  EMPTY_SOURCE_SPLIT_CATALOG,
  sourceSplitCatalogSchema,
  type SourceSplitCatalog,
} from '../modules/entries/source_split_recipe.js';
import {
  sourceReceivingSchema,
  sourceCheckStateSchema,
  type SourceReceiving,
  type SourceCheckState,
} from '../modules/subscriptions/source_receiving.js';
import {
  DEFAULT_AI_PRICE_POLICY,
  aiPricePolicySchema,
  type AiPricePolicy,
} from '../modules/processing/ai_price_policy.js';
import {
  DEFAULT_ENTRY_SAVED_QUERIES,
  type EntrySavedQueries,
} from '../modules/entries/information_entry_saved_queries.js';
import {
  DEFAULT_ENTRY_SPLIT_RULE_PROFILE,
  type EntrySplitRuleProfile,
} from '../modules/entries/information_entry_split_rule.js';
import {
  DEFAULT_WORKSPACE_UI_PREFERENCES,
  type WorkspaceUiPreferences,
} from './workspace_ui_preferences.js';
export const REVIEW_PREFERENCES_FORMAT = 'struinfo.review-preferences';
export const REVIEW_PREFERENCES_VERSION = 1;
export const MAX_REVIEW_QUICK_TAGS = 24;
export const MAX_REVIEW_QUICK_TAG_CODE_POINTS = 120;
export const MAX_REVIEW_KEYWORD_EXCLUSIONS = 64;
export const MAX_REVIEW_VOCABULARY_ALIASES = 128;
export const MAX_SOURCE_SUBSCRIPTIONS = 32;
const CANONICAL_UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;
const SHA1 = /^[0-9a-f]{40}$/u;
const SHA256 = /^[0-9a-f]{64}$/u;
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
  | Readonly<{
      kind: 'none';
    }>
  | Readonly<{
      kind: 'bearer_env';
      variable: string;
    }>;
interface ReviewSourceSubscriptionBase {
  readonly processingProfile?: SourceProcessingProfile;
  readonly receiving?: SourceReceiving;
  readonly checkState?: SourceCheckState;
  readonly qualityReview?: Readonly<{
    reviewedAt: string;
    documentKeys: readonly string[];
  }>;
  readonly subscriptionId: string;
  readonly label: string;
  readonly description?: string;
  /** Enables periodic checks. Explicit run-now remains available when false. */
  readonly enabled: boolean;
  readonly sourceAlias: string;
  readonly isPrivate: boolean;
  /** Default-off: route a changed import after deterministic materialization. */
  /** Historical backup field; new subscriptions always use intake. */
  readonly routeAfterImport?: boolean;
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
  readonly cursor?: Readonly<
    ReviewGitSourceSubscriptionCursor | ReviewRssSourceSubscriptionCursor
  >;
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
    threshold: 1100,
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
  readonly entrySplitRuleProfile?: Readonly<EntrySplitRuleProfile>;
  readonly entrySavedQueries?: Readonly<EntrySavedQueries>;
  readonly uiPreferences?: Readonly<WorkspaceUiPreferences>;
  readonly aiPricePolicy?: Readonly<AiPricePolicy>;
  readonly sourceSplitRecipes?: Readonly<SourceSplitCatalog>;
  readonly annotationVocabulary?: Readonly<AnnotationVocabulary>;
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
    entrySplitRuleProfile?: Readonly<EntrySplitRuleProfile>,
    entrySavedQueries?: Readonly<EntrySavedQueries>,
    uiPreferences?: Readonly<WorkspaceUiPreferences>,
    aiPricePolicy?: Readonly<AiPricePolicy>,
    sourceSplitRecipes?: Readonly<SourceSplitCatalog>,
    annotationVocabulary?: Readonly<AnnotationVocabulary>,
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
  readonly entrySplitRuleProfile?: Readonly<EntrySplitRuleProfile>;
  readonly entrySavedQueries?: Readonly<EntrySavedQueries>;
  readonly uiPreferences?: Readonly<WorkspaceUiPreferences>;
  readonly aiPricePolicy?: Readonly<AiPricePolicy>;
  readonly sourceSplitRecipes?: Readonly<SourceSplitCatalog>;
  readonly annotationVocabulary?: Readonly<AnnotationVocabulary>;
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
    patch.entrySplitRuleProfile ??
      current.entrySplitRuleProfile ??
      DEFAULT_ENTRY_SPLIT_RULE_PROFILE,
    patch.entrySavedQueries ??
      current.entrySavedQueries ??
      DEFAULT_ENTRY_SAVED_QUERIES,
    patch.uiPreferences ??
      current.uiPreferences ??
      DEFAULT_WORKSPACE_UI_PREFERENCES,
    patch.aiPricePolicy ?? current.aiPricePolicy ?? DEFAULT_AI_PRICE_POLICY,
    patch.sourceSplitRecipes ??
      current.sourceSplitRecipes ??
      EMPTY_SOURCE_SPLIT_CATALOG,
    patch.annotationVocabulary ??
      current.annotationVocabulary ??
      EMPTY_ANNOTATION_VOCABULARY,
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
          update.next.entrySplitRuleProfile,
          update.next.entrySavedQueries,
          update.next.uiPreferences,
          update.next.aiPricePolicy,
          update.next.sourceSplitRecipes,
          update.next.annotationVocabulary,
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
    (value.threshold as number) > 10000
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
  entrySplitRuleProfile: Readonly<EntrySplitRuleProfile> = DEFAULT_ENTRY_SPLIT_RULE_PROFILE,
  entrySavedQueries: Readonly<EntrySavedQueries> = DEFAULT_ENTRY_SAVED_QUERIES,
  uiPreferences: Readonly<WorkspaceUiPreferences> = DEFAULT_WORKSPACE_UI_PREFERENCES,
  aiPricePolicy: Readonly<AiPricePolicy> = DEFAULT_AI_PRICE_POLICY,
  sourceSplitRecipes: Readonly<SourceSplitCatalog> = EMPTY_SOURCE_SPLIT_CATALOG,
  annotationVocabulary: Readonly<AnnotationVocabulary> = EMPTY_ANNOTATION_VOCABULARY,
): Readonly<ReviewPreferences> {
  return Object.freeze({
    format: REVIEW_PREFERENCES_FORMAT,
    version: REVIEW_PREFERENCES_VERSION,
    workspaceId,
    quickTags: Object.freeze([...quickTags]),
    entrySavedQueries,
    uiPreferences,
    aiPricePolicy: Object.freeze(aiPricePolicySchema.parse(aiPricePolicy)),
    sourceSplitRecipes: sourceSplitCatalogSchema.parse(sourceSplitRecipes),
    annotationVocabulary:
      annotationVocabularySchema.parse(annotationVocabulary),
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
    entrySplitRuleProfile: Object.freeze({...entrySplitRuleProfile}),
  });
}
function decodeSourceSubscription(
  value: unknown,
): Readonly<ReviewSourceSubscription> | undefined {
  if (!isRecord(value)) return undefined;
  const receiving =
    value.receiving === undefined
      ? undefined
      : sourceReceivingSchema.safeParse(cleanStoredReceiving(value.receiving));
  const checkState =
    value.checkState === undefined
      ? undefined
      : sourceCheckStateSchema.safeParse(value.checkState);
  const processingProfile =
    value.processingProfile === undefined
      ? undefined
      : sourceProcessingProfileSchema.safeParse(value.processingProfile);
  if (
    processingProfile?.success === false ||
    receiving?.success === false ||
    checkState?.success === false
  )
    return undefined;
  if (
    !isRecord(value) ||
    typeof value.subscriptionId !== 'string' ||
    !CANONICAL_UUID.test(value.subscriptionId) ||
    typeof value.label !== 'string' ||
    (value.description !== undefined &&
      (typeof value.description !== 'string' ||
        value.description.length > 500)) ||
    (value.enabled !== true && value.enabled !== false) ||
    typeof value.sourceAlias !== 'string' ||
    (value.isPrivate !== true && value.isPrivate !== false) ||
    (value.routeAfterImport !== undefined &&
      value.routeAfterImport !== true &&
      value.routeAfterImport !== false) ||
    typeof value.intervalMinutes !== 'number' ||
    !Number.isSafeInteger(value.intervalMinutes) ||
    value.intervalMinutes < 15 ||
    value.intervalMinutes > 10080 ||
    (value.qualityReview !== undefined &&
      (!isRecord(value.qualityReview) ||
        typeof value.qualityReview.reviewedAt !== 'string' ||
        !optionalInstant(value.qualityReview.reviewedAt) ||
        !Array.isArray(value.qualityReview.documentKeys) ||
        value.qualityReview.documentKeys.length > 20 ||
        value.qualityReview.documentKeys.some(
          (key) => typeof key !== 'string' || !key.length || key.length > 4096,
        ))) ||
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
    ...(processingProfile?.success
      ? {processingProfile: processingProfile.data}
      : {}),
    ...(receiving?.success ? {receiving: receiving.data} : {}),
    ...(checkState?.success
      ? {
          checkState: {
            failures: checkState.data.failures,
            ...(checkState.data.errorCode
              ? {errorCode: checkState.data.errorCode}
              : {}),
            ...(checkState.data.lastNewAt
              ? {lastNewAt: checkState.data.lastNewAt}
              : {}),
          },
        }
      : {}),
    ...(isRecord(value.qualityReview)
      ? {
          qualityReview: {
            reviewedAt: value.qualityReview.reviewedAt as string,
            documentKeys: value.qualityReview.documentKeys as string[],
          },
        }
      : {}),
    subscriptionId: value.subscriptionId,
    label,
    ...(typeof value.description === 'string' && value.description.trim()
      ? {description: value.description.trim()}
      : {}),
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
  const cursor = repositoryPath?.endsWith('/')
    ? decodeConnectorSourceSubscriptionCursor(value.cursor)
    : decodeGitSourceSubscriptionCursor(value.cursor);
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
  if (subscription.processingProfile)
    subscription = {
      ...subscription,
      processingProfile: Object.freeze({...subscription.processingProfile}),
    };
  if (subscription.qualityReview)
    subscription = {
      ...subscription,
      qualityReview: Object.freeze({
        reviewedAt: subscription.qualityReview.reviewedAt,
        documentKeys: Object.freeze([
          ...subscription.qualityReview.documentKeys,
        ]),
      }),
    };
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
          cursor: Object.freeze({...subscription.cursor}),
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
    Array.from(value.connectorCursor).length > 2048 ||
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
    Array.from(value).length > 2000 ||
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
  const directory = normalized.endsWith('/');
  const path = directory ? normalized.slice(0, -1) : normalized;
  if (
    path.length === 0 ||
    Array.from(normalized).length > 500 ||
    normalized.startsWith('/') ||
    normalized.includes('\\') ||
    normalized.includes('//') ||
    path.split('/').some((segment) => segment === '.' || segment === '..') ||
    (!directory && !/\.(?:md|markdown)$/iu.test(normalized)) ||
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
  const result: {
    source: string;
    canonical: string;
  }[] = [];
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
  aliases: readonly Readonly<{
    source: string;
    canonical: string;
  }>[],
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
function cleanStoredReceiving(value: unknown): unknown {
  if (
    value === null ||
    typeof value !== 'object' ||
    !('retryBackoffMinutes' in value)
  )
    return value;
  const current = {...value};
  delete current.retryBackoffMinutes;
  return current;
}
