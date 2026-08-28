const DEFAULT_KEYWORD_LIMIT = 8;
const MAX_KEYWORD_CODE_POINTS = 120;

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

export interface ReviewKeywordExtractionOptions {
  /** URL hosts are excluded by default because they describe transport, not knowledge. */
  readonly includeLinkDomains?: boolean;
  /** Workspace-owned exact exclusions, compared after keyword normalization. */
  readonly excludedKeywords?: readonly string[];
}

export function extractReviewKeywords(
  sourceText: string,
  limit = DEFAULT_KEYWORD_LIMIT,
  options: Readonly<ReviewKeywordExtractionOptions> = {},
): readonly string[] {
  if (limit <= 0) return [];
  const candidates: string[] = [];
  const add = (value: string) => {
    const normalized = normalizeReviewKeyword(value);
    if (normalized !== '') candidates.push(normalized);
  };

  const contentLines = sourceText
    .split(/\r?\n/gu)
    .map((line) => stripMarkdownPrefix(line))
    .filter((line) => line !== '');
  const firstLine = contentLines[0];
  if (firstLine !== undefined && contentLines.length > 1) {
    const title = firstLine.split(/[：:｜|—–（(]/u, 1)[0];
    if (
      title !== undefined &&
      !/[`*[]/u.test(title) &&
      codePointLength(title) <= 48
    ) {
      add(title);
    }
  }

  const sourceWithoutImages = sourceText.replace(MARKDOWN_IMAGE_PATTERN, ' ');
  for (const match of sourceWithoutImages.matchAll(MARKDOWN_LINK_PATTERN)) {
    const label = match[1];
    if (label !== undefined) add(label);
  }

  const sourceWithoutLinks = sourceWithoutImages.replace(
    MARKDOWN_LINK_PATTERN,
    ' ',
  );
  let technicalSource = sourceWithoutLinks;
  for (const pattern of SEMANTIC_CANDIDATE_PATTERNS) {
    for (const match of sourceWithoutLinks.matchAll(pattern)) {
      const value = match[1];
      if (value !== undefined) add(value);
    }
    technicalSource = technicalSource.replace(pattern, ' ');
  }

  if (options.includeLinkDomains === true) {
    for (const match of sourceText.matchAll(RAW_URL_PATTERN)) {
      try {
        const host = new URL(match[0]).hostname.replace(/^www\./u, '');
        add(host);
      } catch {
        // Invalid URLs are source text, not application failures.
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
    (options.excludedKeywords ?? [])
      .map((value) => reviewKeywordIdentity(value))
      .filter((value) => value !== ''),
  );
  const seen = new Set<string>();
  const result: string[] = [];
  for (const candidate of candidates) {
    const identity = reviewKeywordIdentity(candidate);
    if (identity === '' || excluded.has(identity) || seen.has(identity)) {
      continue;
    }
    seen.add(identity);
    result.push(candidate);
    if (result.length >= limit) break;
  }
  return Object.freeze(result);
}

export function normalizeReviewKeyword(value: string): string {
  const normalized = value
    .normalize('NFC')
    .replace(/^[\s#>*+\-–—\d.、:：|｜()[\]{}]+/gu, '')
    .replace(/[\s,，。.!！?？;；:：|｜()[\]{}<>]+$/gu, '')
    .replace(/\s+/gu, ' ')
    .trim();
  if (
    normalized === '' ||
    codePointLength(normalized) > MAX_KEYWORD_CODE_POINTS ||
    /^\d+$/u.test(normalized) ||
    GENERIC_LINE_LABELS.has(normalized)
  ) {
    return '';
  }
  return normalized;
}

export function reviewKeywordIdentity(value: string): string {
  return normalizeReviewKeyword(value).toLowerCase();
}

function stripMarkdownPrefix(value: string): string {
  return value
    .replace(/^\s{0,3}(?:#{1,6}\s+|>\s*|[-+*]\s+|\d+[.)、]\s*)/u, '')
    .replace(/\s+/gu, ' ')
    .trim();
}

function codePointLength(value: string): number {
  return Array.from(value).length;
}
