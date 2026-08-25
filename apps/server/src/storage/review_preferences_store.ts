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

export const ENTRY_PREFERENCE_DIMENSIONS = ['usefulness', 'interest'] as const;
export const ENTRY_PREFERENCE_FEATURE_KINDS = [
  'content_keyword',
  'type',
  'domain',
] as const;
export const ENTRY_PREFERENCE_EFFECTS = ['prefer', 'deprioritize'] as const;

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

export interface ReviewSourceSubscriptionCursor {
  readonly commitSha: string;
  readonly sourceSha256: string;
}

export interface ReviewSourceSubscription {
  readonly subscriptionId: string;
  readonly label: string;
  /** Enables periodic checks. Explicit run-now remains available when false. */
  readonly enabled: boolean;
  readonly repositoryUri: string;
  readonly repositoryRef: string;
  readonly repositoryPath: string;
  readonly profile: 'commonmark-v1' | 'ruanyf-weekly-v1';
  readonly sourceAlias: string;
  readonly isPrivate: boolean;
  readonly intervalMinutes: number;
  readonly lastAttemptAt?: string;
  readonly lastSuccessAt?: string;
  readonly lastRunId?: string;
  readonly cursor?: Readonly<ReviewSourceSubscriptionCursor>;
}

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
}

export interface ReviewPreferencesStore {
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
): Readonly<ReviewPreferences> {
  return Object.freeze({
    format: REVIEW_PREFERENCES_FORMAT,
    version: REVIEW_PREFERENCES_VERSION,
    workspaceId,
    quickTags: Object.freeze([...quickTags]),
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
        sourceSubscriptions.subscriptions.map((subscription) =>
          Object.freeze({
            ...subscription,
            ...(subscription.cursor === undefined
              ? {}
              : {cursor: Object.freeze({...subscription.cursor})}),
          }),
        ),
      ),
    }),
    entryPreferenceProfile: Object.freeze({
      revision: entryPreferenceProfile.revision,
      enabled: entryPreferenceProfile.enabled,
      rules: Object.freeze(
        entryPreferenceProfile.rules.map((rule) => Object.freeze({...rule})),
      ),
    }),
  });
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
    typeof value.repositoryUri !== 'string' ||
    typeof value.repositoryRef !== 'string' ||
    typeof value.repositoryPath !== 'string' ||
    (value.profile !== 'commonmark-v1' &&
      value.profile !== 'ruanyf-weekly-v1') ||
    typeof value.sourceAlias !== 'string' ||
    (value.isPrivate !== true && value.isPrivate !== false) ||
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
  const repositoryUri = decodeGithubRepositoryUri(value.repositoryUri);
  const repositoryRef = decodeRepositoryRef(value.repositoryRef);
  const repositoryPath = decodeRepositoryPath(value.repositoryPath);
  const cursor = decodeSourceSubscriptionCursor(value.cursor);
  if (
    label === undefined ||
    sourceAlias === undefined ||
    repositoryUri === undefined ||
    repositoryRef === undefined ||
    repositoryPath === undefined ||
    (value.cursor !== undefined && cursor === undefined)
  ) {
    return undefined;
  }
  return Object.freeze({
    subscriptionId: value.subscriptionId,
    label,
    enabled: value.enabled,
    repositoryUri,
    repositoryRef,
    repositoryPath,
    profile: value.profile,
    sourceAlias,
    isPrivate: value.isPrivate,
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
    ...(cursor === undefined ? {} : {cursor}),
  });
}

function decodeSourceSubscriptionCursor(
  value: unknown,
): Readonly<ReviewSourceSubscriptionCursor> | undefined {
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
