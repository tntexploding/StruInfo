import type {ReviewVocabularyPreferences} from '../api/m1c_api_contract.js';
import {
  normalizeReviewKeyword,
  reviewKeywordIdentity,
} from './review_keyword_extractor.js';

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

export function withVocabularyAlias(
  preferences: Readonly<ReviewVocabularyPreferences>,
  source: string,
  canonical: string,
): Readonly<ReviewVocabularyPreferences> {
  const sourceIdentity = reviewKeywordIdentity(source);
  return Object.freeze({
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
