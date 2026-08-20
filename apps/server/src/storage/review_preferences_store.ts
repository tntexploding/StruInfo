export const REVIEW_PREFERENCES_FORMAT = 'struinfo.review-preferences';
export const REVIEW_PREFERENCES_VERSION = 1;
export const MAX_REVIEW_QUICK_TAGS = 24;
export const MAX_REVIEW_QUICK_TAG_CODE_POINTS = 120;
export const MAX_REVIEW_KEYWORD_EXCLUSIONS = 64;
export const MAX_REVIEW_VOCABULARY_ALIASES = 128;
export const MAX_REVIEW_VOCABULARY_LINKS = 128;
export const MAX_REVIEW_KNOWLEDGE_KIND_RULES = 64;

export const REVIEW_VOCABULARY_LINK_KINDS = ['related', 'translation'] as const;

export const REVIEW_PREFERRED_KNOWLEDGE_KINDS = [
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

export type ReviewVocabularyLinkKind =
  (typeof REVIEW_VOCABULARY_LINK_KINDS)[number];
export type ReviewPreferredKnowledgeKind =
  (typeof REVIEW_PREFERRED_KNOWLEDGE_KINDS)[number];

export interface ReviewVocabularyPreferences {
  readonly aliases: readonly Readonly<{
    source: string;
    canonical: string;
  }>[];
  readonly links: readonly Readonly<{
    left: string;
    right: string;
    kind: ReviewVocabularyLinkKind;
  }>[];
  readonly knowledgeKinds: readonly Readonly<{
    keyword: string;
    knowledgeKind: ReviewPreferredKnowledgeKind;
  }>[];
}

export const DEFAULT_REVIEW_VOCABULARY_PREFERENCES: Readonly<ReviewVocabularyPreferences> =
  Object.freeze({
    aliases: Object.freeze([]),
    links: Object.freeze([]),
    knowledgeKinds: Object.freeze([]),
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
}

export interface ReviewPreferencesStore {
  load(workspaceId: string): Promise<Readonly<ReviewPreferences>>;
  save(
    workspaceId: string,
    quickTags: readonly string[],
    automaticKeywords?: Readonly<ReviewAutomaticKeywordPreferences>,
    vocabulary?: Readonly<ReviewVocabularyPreferences>,
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
  const links = decodeLinks(value.links);
  const knowledgeKinds = decodeKnowledgeKinds(value.knowledgeKinds);
  if (
    aliases === undefined ||
    links === undefined ||
    knowledgeKinds === undefined
  ) {
    return undefined;
  }
  return Object.freeze({aliases, links, knowledgeKinds});
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
      links: Object.freeze(
        vocabulary.links.map((rule) => Object.freeze({...rule})),
      ),
      knowledgeKinds: Object.freeze(
        vocabulary.knowledgeKinds.map((rule) => Object.freeze({...rule})),
      ),
    }),
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

function decodeLinks(
  value: unknown,
): ReviewVocabularyPreferences['links'] | undefined {
  if (!Array.isArray(value) || value.length > MAX_REVIEW_VOCABULARY_LINKS) {
    return undefined;
  }
  const result: {
    left: string;
    right: string;
    kind: ReviewVocabularyLinkKind;
  }[] = [];
  const identities = new Set<string>();
  for (const candidate of value) {
    if (!isRecord(candidate)) return undefined;
    const left = decodeKeyword(candidate.left);
    const right = decodeKeyword(candidate.right);
    if (
      left === undefined ||
      right === undefined ||
      !isOneOf(REVIEW_VOCABULARY_LINK_KINDS, candidate.kind)
    ) {
      return undefined;
    }
    const ordered = orderPair(left, right);
    if (ordered === undefined) return undefined;
    const identity = `${candidate.kind}:${keywordIdentity(ordered.left)}:${keywordIdentity(ordered.right)}`;
    if (identities.has(identity)) return undefined;
    identities.add(identity);
    result.push({...ordered, kind: candidate.kind});
  }
  return Object.freeze(result.map((rule) => Object.freeze(rule)));
}

function decodeKnowledgeKinds(
  value: unknown,
): ReviewVocabularyPreferences['knowledgeKinds'] | undefined {
  if (!Array.isArray(value) || value.length > MAX_REVIEW_KNOWLEDGE_KIND_RULES) {
    return undefined;
  }
  const result: {
    keyword: string;
    knowledgeKind: ReviewPreferredKnowledgeKind;
  }[] = [];
  const identities = new Set<string>();
  for (const candidate of value) {
    if (!isRecord(candidate)) return undefined;
    const keyword = decodeKeyword(candidate.keyword);
    if (
      keyword === undefined ||
      !isOneOf(REVIEW_PREFERRED_KNOWLEDGE_KINDS, candidate.knowledgeKind)
    ) {
      return undefined;
    }
    const identity = keywordIdentity(keyword);
    if (identities.has(identity)) return undefined;
    identities.add(identity);
    result.push({keyword, knowledgeKind: candidate.knowledgeKind});
  }
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

function orderPair(
  left: string,
  right: string,
): Readonly<{left: string; right: string}> | undefined {
  const leftIdentity = keywordIdentity(left);
  const rightIdentity = keywordIdentity(right);
  if (leftIdentity === rightIdentity) return undefined;
  return leftIdentity < rightIdentity
    ? {left, right}
    : {left: right, right: left};
}

function isOneOf<const T extends readonly string[]>(
  values: T,
  value: unknown,
): value is T[number] {
  return typeof value === 'string' && values.includes(value);
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
