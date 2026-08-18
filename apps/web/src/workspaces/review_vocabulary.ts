import type {
  KnowledgeKind,
  ReviewVocabularyPreferences,
  VocabularyTerm,
} from '../api/m1c_api_contract.js';
import {
  normalizeReviewKeyword,
  reviewKeywordIdentity,
} from './review_keyword_extractor.js';

export interface VocabularySuggestion {
  readonly termId: string;
  readonly displayName: string;
  readonly reason: 'contains' | 'contained_by';
}

export interface VocabularyPairSuggestion {
  readonly left: Readonly<VocabularyTerm>;
  readonly right: Readonly<VocabularyTerm>;
  readonly reason: 'case_variant' | 'contains';
}

export function canonicalizeReviewKeyword(
  value: string,
  preferences: Readonly<ReviewVocabularyPreferences>,
): string {
  let current = normalizeReviewKeyword(value);
  const aliases = new Map(
    preferences.aliases.map((rule) => [
      reviewKeywordIdentity(rule.source),
      normalizeReviewKeyword(rule.canonical),
    ]),
  );
  const visited = new Set<string>();
  for (let index = 0; index <= preferences.aliases.length; index += 1) {
    const identity = reviewKeywordIdentity(current);
    const next = aliases.get(identity);
    if (next === undefined || visited.has(identity)) return current;
    visited.add(identity);
    current = next;
  }
  return current;
}

export function preferredKnowledgeKind(
  keywords: readonly string[],
  preferences: Readonly<ReviewVocabularyPreferences>,
): KnowledgeKind | undefined {
  const identities = new Set(
    keywords.map((keyword) =>
      reviewKeywordIdentity(canonicalizeReviewKeyword(keyword, preferences)),
    ),
  );
  return preferences.knowledgeKinds.find((rule) =>
    identities.has(
      reviewKeywordIdentity(
        canonicalizeReviewKeyword(rule.keyword, preferences),
      ),
    ),
  )?.knowledgeKind;
}

export function vocabularySuggestionsForKeyword(
  value: string,
  terms: readonly Readonly<VocabularyTerm>[],
  maximum = 3,
): readonly Readonly<VocabularySuggestion>[] {
  const identity = reviewKeywordIdentity(value);
  if (identity === '') return [];
  return terms
    .filter((term) => term.value.lifecycle === 'active')
    .flatMap((term): readonly VocabularySuggestion[] => {
      const termIdentity = reviewKeywordIdentity(term.value.displayName);
      if (termIdentity === identity) return [];
      if (termIdentity.length >= 2 && identity.includes(termIdentity)) {
        return [
          {
            termId: term.termId,
            displayName: term.value.displayName,
            reason: 'contains',
          },
        ];
      }
      if (identity.length >= 2 && termIdentity.includes(identity)) {
        return [
          {
            termId: term.termId,
            displayName: term.value.displayName,
            reason: 'contained_by',
          },
        ];
      }
      return [];
    })
    .sort(
      (left, right) =>
        Math.abs(left.displayName.length - value.length) -
          Math.abs(right.displayName.length - value.length) ||
        left.displayName.localeCompare(right.displayName),
    )
    .slice(0, maximum);
}

export function buildVocabularyPairSuggestions(
  terms: readonly Readonly<VocabularyTerm>[],
  maximum = 24,
): readonly Readonly<VocabularyPairSuggestion>[] {
  const active = terms.filter((term) => term.value.lifecycle === 'active');
  const result: VocabularyPairSuggestion[] = [];
  for (let leftIndex = 0; leftIndex < active.length; leftIndex += 1) {
    const left = active[leftIndex];
    if (left === undefined) continue;
    const leftIdentity = reviewKeywordIdentity(left.value.displayName);
    for (
      let rightIndex = leftIndex + 1;
      rightIndex < active.length;
      rightIndex += 1
    ) {
      const right = active[rightIndex];
      if (right === undefined) continue;
      const rightIdentity = reviewKeywordIdentity(right.value.displayName);
      const reason =
        leftIdentity === rightIdentity
          ? 'case_variant'
          : leftIdentity.length >= 2 &&
              rightIdentity.length >= 2 &&
              (leftIdentity.includes(rightIdentity) ||
                rightIdentity.includes(leftIdentity))
            ? 'contains'
            : undefined;
      if (reason !== undefined) result.push({left, right, reason});
      if (result.length >= maximum) return Object.freeze(result);
    }
  }
  return Object.freeze(result);
}

export function withVocabularyAlias(
  preferences: Readonly<ReviewVocabularyPreferences>,
  source: string,
  canonical: string,
): Readonly<ReviewVocabularyPreferences> {
  const sourceIdentity = reviewKeywordIdentity(source);
  return Object.freeze({
    ...preferences,
    aliases: Object.freeze([
      ...preferences.aliases.filter(
        (rule) => reviewKeywordIdentity(rule.source) !== sourceIdentity,
      ),
      Object.freeze({
        source: normalizeReviewKeyword(source),
        canonical: normalizeReviewKeyword(canonical),
      }),
    ]),
  });
}

export function withVocabularyLink(
  preferences: Readonly<ReviewVocabularyPreferences>,
  left: string,
  right: string,
  kind: 'related' | 'translation',
): Readonly<ReviewVocabularyPreferences> {
  const normalizedLeft = normalizeReviewKeyword(left);
  const normalizedRight = normalizeReviewKeyword(right);
  const [orderedLeft, orderedRight] =
    reviewKeywordIdentity(normalizedLeft) <
    reviewKeywordIdentity(normalizedRight)
      ? [normalizedLeft, normalizedRight]
      : [normalizedRight, normalizedLeft];
  const identity = `${kind}:${reviewKeywordIdentity(orderedLeft)}:${reviewKeywordIdentity(orderedRight)}`;
  return Object.freeze({
    ...preferences,
    links: Object.freeze([
      ...preferences.links.filter(
        (rule) =>
          `${rule.kind}:${reviewKeywordIdentity(rule.left)}:${reviewKeywordIdentity(rule.right)}` !==
          identity,
      ),
      Object.freeze({left: orderedLeft, right: orderedRight, kind}),
    ]),
  });
}

export function withPreferredKnowledgeKind(
  preferences: Readonly<ReviewVocabularyPreferences>,
  keyword: string,
  knowledgeKind: KnowledgeKind,
): Readonly<ReviewVocabularyPreferences> {
  const identity = reviewKeywordIdentity(keyword);
  return Object.freeze({
    ...preferences,
    knowledgeKinds: Object.freeze([
      ...preferences.knowledgeKinds.filter(
        (rule) => reviewKeywordIdentity(rule.keyword) !== identity,
      ),
      Object.freeze({keyword: normalizeReviewKeyword(keyword), knowledgeKind}),
    ]),
  });
}
