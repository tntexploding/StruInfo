import type {
  ReviewAutomaticKeywordPreferences,
  ReviewVocabularyPreferences,
} from '../../storage/review_preferences_store.js';
import {informationEntrySearchKey} from './information_entry.js';

export const DETERMINISTIC_ENTRY_TAG_RULE_VERSION =
  'struinfo.entry-tags.deterministic.v1';

const DEFAULT_KEYWORD_LIMIT = 10;
const MAX_KEYWORD_CODE_POINTS = 80;
const MARKDOWN_IMAGE_PATTERN = /!\[[^\]\n]*\]\([^)\n]+\)/gu;
const MARKDOWN_LINK_PATTERN = /\[([^\]\n]+)\]\(([^)\n]+)\)/gu;
const RAW_URL_PATTERN = /https?:\/\/[^\s)\]}>'"]+/giu;
const SEMANTIC_CANDIDATE_PATTERNS = [
  /`([^`\n]+)`/gu,
  /\*\*([^*\n]+)\*\*/gu,
  /《([^》\n]+)》/gu,
  /「([^」\n]+)」/gu,
  /“([^”\n]+)”/gu,
] as const;
const GENERIC_LINE_LABELS = new Set([
  '介绍',
  '说明',
  '内容',
  '项目',
  '工具',
  '资源',
  '链接',
  '更多',
  '参考',
]);

export interface DeterministicEntryTagCandidate {
  readonly displayValue: string;
  readonly normalizedValue: string;
}

/**
 * Server-owned equivalent of the visible Tags-page candidate rule.
 * It is intentionally lexical, bounded and network-free.
 */
export function extractDeterministicEntryTagCandidates(
  sourceText: string,
  automatic: Readonly<ReviewAutomaticKeywordPreferences>,
  vocabulary: Readonly<ReviewVocabularyPreferences>,
  limit = DEFAULT_KEYWORD_LIMIT,
): readonly Readonly<DeterministicEntryTagCandidate>[] {
  if (!automatic.enabled || limit <= 0) return Object.freeze([]);
  const raw: string[] = [];
  const add = (value: string) => {
    const normalized = normalizeDeterministicTag(value);
    if (normalized !== '') raw.push(normalized);
  };
  const lines = sourceText
    .split(/\r?\n/gu)
    .map(stripMarkdownPrefix)
    .filter((line) => line !== '');
  const firstLine = lines[0];
  if (firstLine !== undefined && lines.length > 1) {
    const title = firstLine.split(/[：:｜|—–（(]/u, 1)[0];
    if (
      title !== undefined &&
      !/[`*[]/u.test(title) &&
      Array.from(title).length <= 48
    ) {
      add(title);
    }
  }
  const withoutImages = sourceText.replace(MARKDOWN_IMAGE_PATTERN, ' ');
  for (const match of withoutImages.matchAll(MARKDOWN_LINK_PATTERN)) {
    if (match[1] !== undefined) add(match[1]);
  }
  const withoutLinks = withoutImages.replace(MARKDOWN_LINK_PATTERN, ' ');
  let technicalSource = withoutLinks;
  for (const pattern of SEMANTIC_CANDIDATE_PATTERNS) {
    for (const match of withoutLinks.matchAll(pattern)) {
      if (match[1] !== undefined) add(match[1]);
    }
    technicalSource = technicalSource.replace(pattern, ' ');
  }
  if (automatic.includeLinkDomains) {
    for (const match of sourceText.matchAll(RAW_URL_PATTERN)) {
      try {
        add(new URL(match[0]).hostname.replace(/^www\./u, ''));
      } catch {
        // Invalid URLs remain source text and do not fail deterministic tagging.
      }
    }
  }
  technicalSource = technicalSource.replace(RAW_URL_PATTERN, ' ');
  for (const match of technicalSource.matchAll(
    /\b[A-Za-z][A-Za-z0-9]*(?:[._+#/-][A-Za-z0-9]+)+\b|\b[A-Z][A-Za-z0-9]{2,31}\b/gu,
  )) {
    add(match[0]);
  }

  const excluded = new Set(
    automatic.excludedKeywords.map(informationEntrySearchKey),
  );
  const aliases = new Map(
    vocabulary.aliases.map((alias) => [
      informationEntrySearchKey(alias.source),
      alias.canonical,
    ]),
  );
  const seen = new Set<string>();
  const result: Readonly<DeterministicEntryTagCandidate>[] = [];
  for (const candidate of raw) {
    let displayValue = candidate;
    const visited = new Set<string>();
    for (;;) {
      const identity = informationEntrySearchKey(displayValue);
      if (visited.has(identity)) break;
      visited.add(identity);
      const canonical = aliases.get(identity);
      if (canonical === undefined) break;
      displayValue = canonical;
    }
    displayValue = normalizeDeterministicTag(displayValue);
    const normalizedValue = informationEntrySearchKey(displayValue);
    if (
      displayValue === '' ||
      excluded.has(normalizedValue) ||
      seen.has(normalizedValue) ||
      [...seen].some(
        (existing) =>
          existing.startsWith(`${normalizedValue} `) ||
          normalizedValue.startsWith(`${existing} `),
      )
    ) {
      continue;
    }
    seen.add(normalizedValue);
    result.push(Object.freeze({displayValue, normalizedValue}));
    if (result.length >= limit) break;
  }
  return Object.freeze(result);
}

export function deterministicEntryTagOriginVersion(
  runId: string,
  claimOrdinal: number,
): string {
  return `${DETERMINISTIC_ENTRY_TAG_RULE_VERSION}:${runId}:${claimOrdinal.toString()}`;
}

function normalizeDeterministicTag(value: string): string {
  const normalized = value
    .normalize('NFC')
    .replace(/^[\s#>*+\-–—\d.、:：|｜()[\]{}]+/gu, '')
    .replace(/[\s,，。.!！?？;；:：|｜()[\]{}<>]+$/gu, '')
    .replace(/\s+/gu, ' ')
    .trim();
  if (
    normalized === '' ||
    Array.from(normalized).length > MAX_KEYWORD_CODE_POINTS ||
    /^\d+$/u.test(normalized) ||
    GENERIC_LINE_LABELS.has(normalized)
  ) {
    return '';
  }
  return normalized;
}

function stripMarkdownPrefix(value: string): string {
  return value
    .replace(/^\s{0,3}(?:#{1,6}\s+|>\s*|[-+*]\s+|\d+[.)、]\s*)/u, '')
    .replace(/\s+/gu, ' ')
    .trim();
}
