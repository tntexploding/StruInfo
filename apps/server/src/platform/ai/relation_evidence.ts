export interface RelationPassage {
  readonly id: string;
  readonly text: string;
  readonly role: 'content' | 'heading' | 'reference';
}

/** A link or image address supplies no independently read body evidence. */
function referenceOnly(text: string): boolean {
  return text.split('\n').every((line) => {
    const trimmed = line.trim();
    return (
      !trimmed ||
      /^!?\[[^\]\n]*\]\([^\n]+\)$/u.test(trimmed) ||
      /^<?https?:\/\/\S+>?$/u.test(trimmed)
    );
  });
}

/** Exact bounded source slices; the model selects IDs instead of copying quotations. */
export function relationPassages(
  body: string,
  endpoint: 'A' | 'B',
): readonly RelationPassage[] {
  const passages: RelationPassage[] = [];
  for (const paragraph of body.split(/\n{2,}/u)) {
    if (!paragraph.trim()) continue;
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
            referenceOnly(paragraph) || referenceOnly(text)
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
