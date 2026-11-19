import {z} from 'zod';
import {deriveUuidV5} from '../../modules/entries/information_entry_identity.js';
import {type CurrentInformationEntry} from '../../modules/entries/information_entry_contract.js';
import {
  structuredAnnotationsSchema,
  canonicalAnnotationTerm,
  validateAnnotationEvidence,
  type AnnotationVocabulary,
} from '../../modules/entries/structured_annotations.js';
import {entryTagSubject} from './entry_tag_subject.js';
import {relationPassages} from './relation_evidence.js';
import {publicationContentRanges} from '../../modules/processing/publication_context.js';

const evidenceId = z.string().min(1).max(80);
export const annotationResponseSchema = z
  .object({
    status: z.enum(['complete', 'partial', 'unknown', 'none']),
    note: z.string().max(400),
    labels: z
      .array(
        z
          .object({
            dimensionId: z.uuid(),
            termId: z
              .string()
              .regex(/^T[1-9]\d{0,2}$/u)
              .nullable(),
            label: z.string().min(1).max(120),
            meaning: z.string().max(400),
            wording: z.string().min(1).max(120),
            primary: z.boolean(),
            evidenceId,
          })
          .strict(),
      )
      .max(48),
    claims: z
      .array(
        z
          .object({
            statement: z.string().min(1).max(800),
            speaker: z.string().max(160),
            stance: z.enum(['supports', 'opposes', 'reports']),
            conditions: z.string().max(400),
            time: z.string().max(160),
            evidenceId,
          })
          .strict(),
      )
      .max(16),
  })
  .strict();
export const ANNOTATION_INSTRUCTIONS =
  'Every annotations object must contain all four keys: status, note, labels, claims. Include claims: [] when there are no explicit claims; never omit it, including in batch items. Each label has dimensionId, termId, label, meaning, wording, primary, evidenceId. Each claim has statement, speaker, stance, conditions, time, evidenceId. Return annotations using only the supplied dimensions. Labels distinguish form, domain, concrete entity, issue, purpose and conditions. termId is a request-local reference such as T1 or T2 from the supplied vocabulary, never a UUID. Copy a supplied reference only for the same identity, meaning and dimension; otherwise use null and describe the new sense. Never generate an ID for a new term. Known IDs retain their vocabulary label and meaning. Do not merge homonyms, related concepts or broader terms. Each label and explicit claim must select one evidenceId from this Entry passages. The program saves that exact source passage; do not copy or rewrite quotations. wording is a short name for the label, at most 120 characters, not a source excerpt. Headings identify subjects; reference links do not establish facts about their targets. Never borrow collection prefaces or neighbouring items. Record author stance as supports, opposes or reports; do not judge truth. Unknown speaker, time and conditions use empty strings. Use unknown, partial or none when justified; empty arrays are valid. Do not invent labels to fill dimensions. Manual annotations are protected.';

function annotationPassages(entry: CurrentInformationEntry) {
  const subject = entryTagSubject(entry);
  const body = entry.value.body;
  const ranges = publicationContentRanges(body);
  // The selected first item is a suffix of the publication-filtered projection.
  let skip =
    ranges.reduce((sum, r) => sum + r.end - r.start, 0) - subject.body.length;
  const result: {id: string; text: string; start: number; end: number}[] = [];
  for (const range of ranges) {
    const start = range.start + Math.min(skip, range.end - range.start);
    skip -= start - range.start;
    const part = body.slice(start, range.end);
    let cursor = 0;
    for (const passage of relationPassages(part, 'A')) {
      const offset = part.indexOf(passage.text, cursor);
      cursor = offset + passage.text.length;
      let position = start + offset;
      // A source sentence may exceed the stored quote limit. Preserve every byte.
      for (const text of passage.text.match(/.{1,1000}/gsu) ?? []) {
        const point = Array.from(body.slice(0, position)).length;
        result.push({
          id: `E${String(entry.value.documentOrder)}:P${String(result.length)}`,
          text,
          start: point,
          end: point + Array.from(text).length,
        });
        position += text.length;
      }
    }
  }
  return result;
}

export function annotationModelSubject(entry: CurrentInformationEntry) {
  const {titlePath, documentContext} = entryTagSubject(entry);
  return {
    entryId: entry.entryId,
    titlePath,
    ...(documentContext ? {documentContext} : {}),
    passages: annotationPassages(entry).map(({id, text}) => ({id, text})),
  };
}
export function annotationModelContext(
  vocabulary: AnnotationVocabulary,
  entries: readonly CurrentInformationEntry[] = [],
) {
  // Vocabulary is explicit public configuration; never load private document tags here.
  const dimensions = vocabulary.dimensions.filter((d) => d.enabled);
  const context = {
    revision: vocabulary.revision,
    dimensions,
    terms: [] as AnnotationVocabulary['terms'],
  };
  // The catalog is shared by a batch; it cannot consume the whole request allowance.
  const texts = entries
    .map((e) => entryTagSubject(e))
    .map((s) => (s.titlePath + '\n' + s.body).normalize('NFKC').toLowerCase());
  const aliases = new Map<string, string[]>();
  for (const a of vocabulary.aliases)
    if (a.status === 'confirmed')
      aliases.set(a.termId, [...(aliases.get(a.termId) ?? []), a.text]);
  const score = (term: AnnotationVocabulary['terms'][number]) => {
    const words = [term.label, ...(aliases.get(term.id) ?? [])];
    return texts.reduce(
      (sum, text) =>
        sum +
        words.filter((word) =>
          text.includes(word.normalize('NFKC').toLowerCase()),
        ).length,
      0,
    );
  };
  const relevant = vocabulary.terms
    .map((term) => ({term, score: score(term)}))
    .filter((t) => t.score > 0)
    .sort((a, b) => b.score - a.score || a.term.id.localeCompare(b.term.id));
  for (const {term} of relevant) {
    if (!dimensions.some((d) => d.id === term.dimensionId)) continue;
    context.terms.push(term);
    if (Array.from(JSON.stringify(context)).length > 24_000) {
      context.terms.pop();
      break;
    }
    if (context.terms.length === 128) break;
  }
  return context;
}
export function decodeAnnotationResponse(
  input: unknown,
  entry: CurrentInformationEntry,
  vocabulary: AnnotationVocabulary,
  suppliedTerms: AnnotationVocabulary['terms'] = annotationModelContext(
    vocabulary,
    [entry],
  ).terms,
) {
  const parsed = annotationResponseSchema.parse(input);
  const passages = annotationPassages(entry);
  const evidence = (id: string) => {
    const passage = passages.find((p) => p.id === id);
    if (!passage) throw new Error('Unknown annotation evidence.');
    return {start: passage.start, end: passage.end, quote: passage.text};
  };
  const context = {
    dimensions: vocabulary.dimensions.filter((d) => d.enabled),
    terms: vocabulary.terms,
  };
  const annotations = structuredAnnotationsSchema.parse({
    schemaVersion: 1,
    vocabularyRevision: vocabulary.revision,
    dimensions: context.dimensions,
    inputRevision: entry.revision,
    inputBodySha256: entry.value.bodySha256,
    origin: 'ai',
    originVersion: 'unified-tags.v1',
    status: parsed.status,
    note: parsed.note,
    readingState: entry.value.annotations?.readingState ?? 'unread',
    labels: parsed.labels.map((l) => {
      const known = l.termId
        ? suppliedTerms[Number(l.termId.slice(1)) - 1]
        : undefined;
      if (l.termId && !known) throw new Error('Unknown annotation term.');
      if (known && known.dimensionId !== l.dimensionId)
        throw new Error('Annotation term dimension mismatch.');
      return {
        dimensionId: l.dimensionId,
        wording: l.wording,
        primary: l.primary,
        evidence: evidence(l.evidenceId),
        term: canonicalAnnotationTerm(
          known ?? {
            id: deriveUuidV5(l.dimensionId, l.label),
            dimensionId: l.dimensionId,
            label: l.label,
            meaning: l.meaning,
          },
          vocabulary,
        ),
      };
    }),
    claims: parsed.claims.map(({evidenceId: id, ...claim}) => ({
      ...claim,
      evidence: evidence(id),
    })),
  });
  if (
    new Set(annotations.labels.map((l) => l.term.id)).size !==
    annotations.labels.length
  )
    throw new Error('Duplicate annotation term.');
  if (
    annotations.labels.some(
      (l) => !context.dimensions.some((d) => d.id === l.dimensionId),
    )
  )
    throw new Error('Unknown annotation dimension.');
  if (
    ['none', 'unknown'].includes(annotations.status) &&
    (annotations.labels.length || annotations.claims.length)
  )
    throw new Error('Annotation status conflicts with content.');
  if (!validateAnnotationEvidence(annotations, entry.value.body))
    throw new Error('Invalid annotation evidence.');
  return annotations;
}
