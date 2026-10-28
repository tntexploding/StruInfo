import {z} from 'zod';

const label = z.string().trim().min(1).max(120);
export const annotationRoleSchema = z.enum([
  'form',
  'domain',
  'entity',
  'issue',
  'purpose',
  'condition',
  'custom',
]);
export const annotationDimensionSchema = z
  .object({
    id: z.uuid(),
    name: label,
    role: annotationRoleSchema,
    description: z.string().trim().max(400),
    enabled: z.boolean(),
  })
  .strict();
export const annotationTermSchema = z
  .object({
    id: z.uuid(),
    dimensionId: z.uuid(),
    label,
    meaning: z.string().trim().max(400),
  })
  .strict();
export const annotationVocabularySchema = z
  .object({
    revision: z.number().int().min(0),
    dimensions: z.array(annotationDimensionSchema).max(32),
    terms: z.array(annotationTermSchema).max(4096),
    aliases: z
      .array(
        z
          .object({
            termId: z.uuid(),
            text: label,
            status: z.enum(['pending', 'confirmed']),
          })
          .strict(),
      )
      .max(4096),
    relations: z
      .array(
        z
          .object({
            from: z.uuid(),
            to: z.uuid(),
            kind: z.enum(['equivalent', 'broader', 'related']),
            status: z.enum(['pending', 'confirmed']),
          })
          .strict(),
      )
      .max(4096),
  })
  .strict()
  .superRefine((value, ctx) => {
    const dimensions = new Set(value.dimensions.map((d) => d.id));
    const terms = new Map(value.terms.map((t) => [t.id, t]));
    if (
      dimensions.size !== value.dimensions.length ||
      terms.size !== value.terms.length ||
      value.terms.some((t) => !dimensions.has(t.dimensionId)) ||
      value.aliases.some((a) => !terms.has(a.termId)) ||
      value.relations.some(
        (r) =>
          r.from === r.to ||
          !terms.has(r.from) ||
          !terms.has(r.to) ||
          (r.kind === 'equivalent' &&
            terms.get(r.from)?.dimensionId !== terms.get(r.to)?.dimensionId),
      )
    ) {
      ctx.addIssue({code: 'custom', message: 'Invalid vocabulary identities.'});
    }
  });
export type AnnotationVocabulary = z.infer<typeof annotationVocabularySchema>;
export type AnnotationTerm = z.infer<typeof annotationTermSchema>;
export const EMPTY_ANNOTATION_VOCABULARY: AnnotationVocabulary = {
  revision: 0,
  dimensions: [],
  terms: [],
  aliases: [],
  relations: [],
};
export const annotationEvidenceSchema = z
  .object({
    start: z.number().int().min(0),
    end: z.number().int().positive(),
    quote: z.string().min(1).max(2000),
  })
  .strict();
export const annotationDraftSchema = z
  .object({
    status: z.enum(['complete', 'partial', 'unknown', 'none']),
    note: z.string().trim().max(400),
    readingState: z.enum(['unread', 'reading', 'read', 'archived']),
    labels: z
      .array(
        z
          .object({
            dimensionId: z.uuid(),
            term: annotationTermSchema,
            wording: label,
            primary: z.boolean(),
            evidence: annotationEvidenceSchema,
          })
          .strict(),
      )
      .max(48),
    claims: z
      .array(
        z
          .object({
            statement: z.string().trim().min(1).max(800),
            speaker: z.string().trim().max(160),
            stance: z.enum(['supports', 'opposes', 'reports']),
            conditions: z.string().trim().max(400),
            time: z.string().trim().max(160),
            evidence: annotationEvidenceSchema,
          })
          .strict(),
      )
      .max(16),
  })
  .strict();
export type AnnotationDraft = z.infer<typeof annotationDraftSchema>;
export const structuredAnnotationsSchema = annotationDraftSchema.extend({
  schemaVersion: z.literal(1),
  vocabularyRevision: z.number().int().min(0),
  dimensions: z.array(annotationDimensionSchema).max(32),
  inputRevision: z.number().int().positive(),
  inputBodySha256: z.string().regex(/^[0-9a-f]{64}$/u),
  origin: z.enum(['manual', 'ai', 'rule']),
  originVersion: z.string().min(1).max(512),
});
export type StructuredAnnotations = z.infer<typeof structuredAnnotationsSchema>;
export const annotationFilterSchema = z
  .object({
    dimensionId: z.uuid().optional(),
    termIds: z.array(z.uuid()).min(1).max(64).optional(),
    status: z
      .enum(['unannotated', 'complete', 'partial', 'unknown', 'none', 'stale'])
      .optional(),
    readingState: z.enum(['unread', 'reading', 'read', 'archived']).optional(),
  })
  .strict();
export type AnnotationFilter = Readonly<{
  readonly dimensionId?: string;
  readonly termIds?: string[];
  readonly status?:
    'unannotated' | 'complete' | 'partial' | 'unknown' | 'none' | 'stale';
  readonly readingState?: 'unread' | 'reading' | 'read' | 'archived';
}>;

export function validateAnnotationEvidence(
  value: StructuredAnnotations,
  body: string,
): boolean {
  const points = Array.from(body);
  const dimensions = new Set(value.dimensions.map((d) => d.id));
  return (
    new Set(value.labels.map((l) => l.term.id)).size === value.labels.length &&
    !(
      (value.status === 'none' || value.status === 'unknown') &&
      (value.labels.length || value.claims.length)
    ) &&
    value.labels.every(
      (l) =>
        dimensions.has(l.dimensionId) && l.term.dimensionId === l.dimensionId,
    ) &&
    [...value.labels, ...value.claims].every(
      ({evidence: e}) =>
        e.start < e.end &&
        e.end <= points.length &&
        points.slice(e.start, e.end).join('') === e.quote,
    )
  );
}
export function annotationState(
  value: StructuredAnnotations | undefined,
  bodySha256: string,
) {
  return !value
    ? 'unannotated'
    : value.inputBodySha256 !== bodySha256
      ? 'stale'
      : value.status;
}
export function equivalentTermIds(
  id: string,
  vocabulary: AnnotationVocabulary,
): Set<string> {
  const ids = new Set([id]);
  const edges = vocabulary.relations.filter(
    (r) => r.kind === 'equivalent' && r.status === 'confirmed',
  );
  const pending = [id];
  while (pending.length) {
    const next = pending.pop();
    for (const edge of edges) {
      const other =
        edge.from === next ? edge.to : edge.to === next ? edge.from : undefined;
      if (other && !ids.has(other)) {
        ids.add(other);
        pending.push(other);
      }
    }
  }
  return ids;
}
export function annotationSearchWords(
  value: StructuredAnnotations,
  vocabulary: AnnotationVocabulary,
): string[] {
  return value.labels.flatMap((l) => {
    const ids = equivalentTermIds(l.term.id, vocabulary);
    return [
      l.wording,
      l.term.label,
      ...vocabulary.terms.filter((t) => ids.has(t.id)).map((t) => t.label),
      ...vocabulary.aliases
        .filter((a) => a.status === 'confirmed' && ids.has(a.termId))
        .map((a) => a.text),
    ];
  });
}
export function matchesAnnotationFilter(
  value: StructuredAnnotations | undefined,
  bodySha256: string,
  filter: AnnotationFilter | undefined,
  vocabulary: AnnotationVocabulary,
): boolean {
  if (!filter) return true;
  if (filter.status && annotationState(value, bodySha256) !== filter.status)
    return false;
  if (
    filter.readingState &&
    (value?.readingState ?? 'unread') !== filter.readingState
  )
    return false;
  if (!filter.dimensionId && !filter.termIds) return true;
  if (value?.inputBodySha256 !== bodySha256) return false;
  const ids = new Set(
    filter.termIds?.flatMap((id) => [...equivalentTermIds(id, vocabulary)]) ??
      [],
  );
  return value.labels.some(
    (l) =>
      (!filter.dimensionId || l.dimensionId === filter.dimensionId) &&
      (!filter.termIds || ids.has(l.term.id)),
  );
}
