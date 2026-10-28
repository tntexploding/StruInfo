import {z} from 'zod';
import {deriveUuidV5} from '../../modules/entries/information_entry_identity.js';
import {type CurrentInformationEntry} from '../../modules/entries/information_entry_contract.js';
import {
  structuredAnnotationsSchema,
  validateAnnotationEvidence,
  type AnnotationVocabulary,
} from '../../modules/entries/structured_annotations.js';
import {entryTagSubject} from './entry_tag_subject.js';

const quote = z.string().min(1).max(2000);
export const annotationResponseSchema = z
  .object({
    status: z.enum(['complete', 'partial', 'unknown', 'none']),
    note: z.string().max(400),
    labels: z
      .array(
        z
          .object({
            dimensionId: z.uuid(),
            termId: z.uuid().nullable(),
            label: z.string().min(1).max(120),
            meaning: z.string().max(400),
            wording: z.string().min(1).max(120),
            primary: z.boolean(),
            quote,
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
            quote,
          })
          .strict(),
      )
      .max(16),
  })
  .strict();
export const ANNOTATION_INSTRUCTIONS =
  'Also return annotations using only the supplied dimensions. Labels distinguish form, domain, concrete entity, issue, purpose and conditions. Select known termId only for the same identity and meaning; otherwise use null and describe the sense. Do not merge homonyms, related concepts or broader terms. Quote exact contiguous text from this Entry body for each label and explicit claim. Never borrow collection prefaces, links or neighbouring items. Record author stance as supports, opposes or reports; do not judge truth. Unknown speaker, time and conditions use empty strings. Use unknown, partial or none when justified; empty arrays are valid. Do not invent labels to fill dimensions. Manual annotations are protected.';
export function annotationModelContext(vocabulary: AnnotationVocabulary) {
  // Vocabulary is explicit public configuration; never load private document tags here.
  const dimensions = vocabulary.dimensions.filter((d) => d.enabled);
  const context = {
    revision: vocabulary.revision,
    dimensions,
    terms: [] as AnnotationVocabulary['terms'],
  };
  // The catalog is shared by a batch; it cannot consume the whole request allowance.
  for (const term of vocabulary.terms) {
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
) {
  const parsed = annotationResponseSchema.parse(input);
  const subject = entryTagSubject(entry).body;
  const evidence = (text: string) => {
    if (!subject.includes(text))
      throw new Error('Annotation evidence outside subject.');
    const index = entry.value.body.indexOf(text);
    if (index < 0 || entry.value.body.includes(text, index + 1))
      throw new Error('Ambiguous annotation evidence.');
    const start = Array.from(entry.value.body.slice(0, index)).length;
    return {start, end: start + Array.from(text).length, quote: text};
  };
  const context = annotationModelContext(vocabulary);
  const annotations = structuredAnnotationsSchema.parse({
    schemaVersion: 1,
    vocabularyRevision: vocabulary.revision,
    dimensions: context.dimensions,
    inputRevision: entry.revision,
    inputBodySha256: entry.value.bodySha256,
    origin: 'ai',
    originVersion: 'structured-tags.v1',
    status: parsed.status,
    note: parsed.note,
    readingState: entry.value.annotations?.readingState ?? 'unread',
    labels: parsed.labels.map((l, index) => {
      const known = context.terms.find((t) => t.id === l.termId);
      if (
        l.termId &&
        (known?.dimensionId !== l.dimensionId ||
          known.label !== l.label ||
          known.meaning !== l.meaning)
      )
        throw new Error('Unknown annotation term.');
      return {
        dimensionId: l.dimensionId,
        wording: l.wording,
        primary: l.primary,
        evidence: evidence(l.quote),
        term: known ?? {
          id: deriveUuidV5(
            entry.revisionId,
            `annotation:${index.toString()}:${l.dimensionId}:${l.label}:${l.meaning}`,
          ),
          dimensionId: l.dimensionId,
          label: l.label,
          meaning: l.meaning,
        },
      };
    }),
    claims: parsed.claims.map(({quote: text, ...claim}) => ({
      ...claim,
      evidence: evidence(text),
    })),
  });
  if (!validateAnnotationEvidence(annotations, entry.value.body))
    throw new Error('Invalid annotation evidence.');
  return annotations;
}
