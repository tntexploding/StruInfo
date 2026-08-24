export const REVIEW_PREFERENCES_FORMAT = 'struinfo.review-preferences';
export const REVIEW_PREFERENCES_VERSION = 1;
export const MAX_REVIEW_QUICK_TAGS = 24;
export const MAX_REVIEW_QUICK_TAG_CODE_POINTS = 120;
export const MAX_REVIEW_KEYWORD_EXCLUSIONS = 64;
export const MAX_REVIEW_VOCABULARY_ALIASES = 128;

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
}

export interface ReviewPreferencesStore {
  load(workspaceId: string): Promise<Readonly<ReviewPreferences>>;
  save(
    workspaceId: string,
    quickTags: readonly string[],
    automaticKeywords?: Readonly<ReviewAutomaticKeywordPreferences>,
    vocabulary?: Readonly<ReviewVocabularyPreferences>,
    associationPolicy?: Readonly<ReviewAssociationPolicyPreferences>,
  ): Promise<Readonly<ReviewPreferences>>;
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
  });
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
