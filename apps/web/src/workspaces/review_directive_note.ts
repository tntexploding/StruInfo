export const REVIEW_DIRECTIVE_NOTE_LIMIT = 2_000;
export const REVIEW_EXPLICIT_LINK_LIMIT = 6;

const DIRECTIVE_PREFIX = '<!--struinfo-review-directive-v1:';
const DIRECTIVE_SUFFIX = '-->';

export type ReviewLinkPolicy = 'auto_candidates' | 'manual_only' | 'no_links';

export interface ReviewExplicitLink {
  readonly targetKind: 'fragment' | 'knowledge_item';
  readonly targetId: string;
  readonly relationTypeKey: string;
}

export interface ReviewDirective {
  readonly linkPolicy: ReviewLinkPolicy;
  readonly explicitLinks: readonly Readonly<ReviewExplicitLink>[];
}

export interface DecodedReviewNote {
  readonly humanNote: string;
  readonly directive: Readonly<ReviewDirective>;
}

const DEFAULT_DIRECTIVE: Readonly<ReviewDirective> = Object.freeze({
  linkPolicy: 'auto_candidates',
  explicitLinks: Object.freeze([]),
});

export function encodeReviewNote(
  humanNote: string,
  directive: Readonly<ReviewDirective>,
): string | undefined {
  const note = humanNote.trim();
  const links = directive.explicitLinks.slice(0, REVIEW_EXPLICIT_LINK_LIMIT);
  if (directive.linkPolicy === 'auto_candidates' && links.length === 0) {
    return note === '' ? undefined : note;
  }
  const payload = JSON.stringify({
    linkPolicy: directive.linkPolicy,
    explicitLinks: links.map((link) => ({
      targetKind: link.targetKind,
      targetId: link.targetId,
      relationTypeKey: link.relationTypeKey,
    })),
  });
  return `${note === '' ? '' : `${note}\n\n`}${DIRECTIVE_PREFIX}${payload}${DIRECTIVE_SUFFIX}`;
}

export function decodeReviewNote(value?: string): Readonly<DecodedReviewNote> {
  if (value === undefined || value === '') {
    return Object.freeze({humanNote: '', directive: DEFAULT_DIRECTIVE});
  }
  const markerIndex = value.lastIndexOf(DIRECTIVE_PREFIX);
  if (markerIndex < 0 || !value.endsWith(DIRECTIVE_SUFFIX)) {
    return Object.freeze({humanNote: value, directive: DEFAULT_DIRECTIVE});
  }
  const payload = value.slice(
    markerIndex + DIRECTIVE_PREFIX.length,
    -DIRECTIVE_SUFFIX.length,
  );
  const directive = parseDirective(payload);
  if (directive === undefined) {
    return Object.freeze({humanNote: value, directive: DEFAULT_DIRECTIVE});
  }
  return Object.freeze({
    humanNote: value.slice(0, markerIndex).trimEnd(),
    directive,
  });
}

export function reviewNoteCodePointLength(value?: string): number {
  return value === undefined ? 0 : Array.from(value).length;
}

function parseDirective(value: string): Readonly<ReviewDirective> | undefined {
  try {
    const parsed: unknown = JSON.parse(value);
    if (!isRecord(parsed)) return undefined;
    const policy = parsed.linkPolicy;
    const links = parsed.explicitLinks;
    if (!isLinkPolicy(policy) || !Array.isArray(links)) return undefined;
    if (links.length > REVIEW_EXPLICIT_LINK_LIMIT) return undefined;
    const decoded: ReviewExplicitLink[] = [];
    for (const link of links) {
      if (!isRecord(link)) return undefined;
      const {targetKind, targetId, relationTypeKey} = link;
      if (
        (targetKind !== 'fragment' && targetKind !== 'knowledge_item') ||
        typeof targetId !== 'string' ||
        typeof relationTypeKey !== 'string'
      ) {
        return undefined;
      }
      decoded.push({targetKind, targetId, relationTypeKey});
    }
    return Object.freeze({
      linkPolicy: policy,
      explicitLinks: Object.freeze(decoded),
    });
  } catch {
    return undefined;
  }
}

function isLinkPolicy(value: unknown): value is ReviewLinkPolicy {
  return (
    value === 'auto_candidates' ||
    value === 'manual_only' ||
    value === 'no_links'
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
