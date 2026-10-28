export interface RelationPassage {
  readonly id: string;
  readonly text: string;
  readonly role: 'content' | 'heading' | 'reference';
}

/** A link or image address supplies no independently read body evidence. */
function referenceOnly(text: string): boolean {
  if (isReferenceOnly(text)) return true;
  return text.split('\n').every((line) => {
    const trimmed = line.trim();
    return (
      !trimmed ||
      /^!?\[[^\]\n]*\]\([^\n]+\)$/u.test(trimmed) ||
      /^<?https?:\/\/\S+>?$/u.test(trimmed)
    );
  });
}

/** Explicitly deferred coverage describes another reading, not this body's method. */
function readingReferral(text: string, next: string): boolean {
  if (!/https?:\/\//iu.test(text + '\n' + next)) return false;
  const normalized = text.replace(/\s+/gu, ' ').trim();
  const deferral =
    /\b(?:i|we)\s+(?:had\s+)?(?:originally\s+)?(?:planned|intended|meant)\s+to\s+(?:cover|discuss|explain|describe)\b[^.!?]{0,180}\bbut\b/iu.exec(
      normalized,
    );
  const introduction = deferral
    ? normalized.slice(0, deferral.index).trim()
    : '';
  const deferred =
    deferral !== null &&
    (!introduction ||
      /^In \[[^\]]+\]\(https?:\/\/[^)]+\), (?:researchers|authors) introduce [^.!?]{1,260}\.$/iu.test(
        introduction,
      )) &&
    /\b(?:implemented|published|wrote|covered|discussed)\b[^.!?]{0,180}\b(?:ago|elsewhere|separately|another|separate)\b/iu.test(
      normalized,
    );
  const externalGuide =
    /^(?:for\s+[^.!?]{1,100},\s*)?(?:i|we)\s+(?:have\s+)?(?:written|published|posted)\b[^.!?]{0,180}\b(?:article|post|guide|tutorial)\b[^.!?]{0,100}\b(?:here|elsewhere|separately)\b/iu.test(
      normalized,
    );
  const readingInstruction =
    /^(?:for\s+(?:more|further)\s+(?:details|information)|(?:see|read|visit|check)\s+(?:the|our|my|this))\b[^.!?]{0,180}\b(?:article|guide|tutorial|full\s+(?:story|post))\b/iu.test(
      normalized,
    );
  const chineseReferral =
    /(?:原本|原来|本来|原计划|最初)[^。！？]{0,80}(?:介绍|讨论|解释|展开)[^。！？]{0,60}(?:但|不过)[^。！？]{0,100}(?:另文|另一篇|另写|单独介绍)/u.test(
      normalized,
    ) ||
    /^(?:更多|进一步的?|详细的?)[^。！？]{0,30}(?:介绍|说明|细节|实现|内容)[^。！？]{0,50}(?:参见|请看|阅读)[^。！？]{0,80}(?:文章|教程|指南)/u.test(
      normalized,
    );
  // A referral followed by factual prose in the same paragraph remains available.
  const additionalSentence = /[.!?]\s+\S|[。！？]\S/u.test(normalized);
  return (
    deferred ||
    (!additionalSentence &&
      (externalGuide || readingInstruction || chineseReferral))
  );
}

function cardMetadata(text: string): boolean {
  return /^(?:[·•|]\s*)?(?:(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},?\s+\d{4}|\d{4}-\d{2}-\d{2}|\d{4}年\d{1,2}月\d{1,2}日)?$/iu.test(
    text.trim(),
  );
}

/** Dates inside linked reading cards and subscription footers supply no body facts. */
function referenceMetadata(
  paragraphs: readonly string[],
  index: number,
): boolean {
  const text = paragraphs[index]?.trim() ?? '';
  if (/^[·•|]$/u.test(text)) return true;
  if (cardMetadata(text)) {
    let before = index - 1;
    let after = index + 1;
    while (before >= 0 && cardMetadata(paragraphs[before] ?? '')) before--;
    while (after < paragraphs.length && cardMetadata(paragraphs[after] ?? ''))
      after++;
    return (
      before >= 0 &&
      after < paragraphs.length &&
      referenceOnly(paragraphs[before] ?? '') &&
      referenceOnly(paragraphs[after] ?? '')
    );
  }
  return (
    index === paragraphs.length - 1 &&
    /^(?:[^.!?\n]{1,120} is a reader-supported publication\.\s*)?To receive new posts and support (?:my|our) work, (?:please )?(?:consider )?(?:becoming|become) a (?:free or paid|free|paid) subscriber\.?$/iu.test(
      text,
    )
  );
}

/** Exact bounded source slices; the model selects IDs instead of copying quotations. */
export function relationPassages(
  body: string,
  endpoint: 'A' | 'B',
): readonly RelationPassage[] {
  const passages: RelationPassage[] = [];
  const paragraphs = body.split(/\n{2,}/u).filter((text) => text.trim());
  for (const [index, paragraph] of paragraphs.entries()) {
    if (!paragraph.trim()) continue;
    const referral =
      readingReferral(paragraph, paragraphs[index + 1] ?? '') ||
      referenceMetadata(paragraphs, index);
    const role = paragraph
      .split('\n')
      .every((line) => !line.trim() || /^\s*#{1,6}\s/u.test(line))
      ? 'heading'
      : 'content';
    const sentences = new Intl.Segmenter('en', {
      granularity: 'sentence',
    }).segment(paragraph);
    const chunks: string[] = [];
    let chunk = '';
    for (const {segment} of sentences) {
      if (chunk && Array.from(chunk + segment).length > 480) {
        chunks.push(chunk);
        chunk = '';
      }
      chunk += segment;
    }
    if (chunk) chunks.push(chunk);
    // A long sentence remains intact; the request's existing overall limit still applies.
    for (const text of chunks) {
      passages.push(
        Object.freeze({
          id: `${endpoint}:${passages.length.toString()}`,
          text,
          role:
            referral || referenceOnly(paragraph) || referenceOnly(text)
              ? 'reference'
              : role,
        }),
      );
    }
  }
  return Object.freeze(passages);
}

export function resolveRelationEvidence(
  ids: unknown,
  passages: readonly RelationPassage[],
): readonly string[] | undefined {
  if (
    !Array.isArray(ids) ||
    ids.length < 1 ||
    ids.length > 2 ||
    new Set(ids).size !== ids.length
  )
    return undefined;
  const resolved: string[] = [];
  for (const id of ids) {
    const passage = passages.find((candidate) => candidate.id === id);
    if (passage?.role !== 'content') return undefined;
    resolved.push(passage.text);
  }
  return Object.freeze(resolved);
}

/** Store source excerpts, not a new factual assertion composed by the model. */
export function relationEvidenceSummary(
  evidenceA: readonly string[],
  evidenceB: readonly string[],
): string {
  const excerpts = (evidence: readonly string[]) => {
    const limit = Math.floor(108 / evidence.length) - 3;
    return evidence
      .map((text) => {
        const points = Array.from(
          text
            .replace(/[\s\p{Cc}]+/gu, ' ')
            .trim()
            .normalize('NFC'),
        );
        return `「${points.slice(0, limit).join('')}」${points.length > limit ? '…' : ''}`;
      })
      .join(' ');
  };
  return `A：${excerpts(evidenceA)}；B：${excerpts(evidenceB)}`;
}
import {isReferenceOnly} from '../../modules/processing/publication_context.js';
