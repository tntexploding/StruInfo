import {z} from 'zod';
import {isDeepStrictEqual} from 'node:util';
import {
  annotationDraftSchema,
  annotationVocabularySchema,
  structuredAnnotationsSchema,
  EMPTY_ANNOTATION_VOCABULARY,
  validateAnnotationEvidence,
} from '../modules/entries/structured_annotations.js';
import {
  deriveInformationEntryRevisionId,
  type InformationEntryRepositoryPort,
} from '../modules/entries/index.js';
import {
  patchReviewPreferences,
  updateReviewPreferences,
  type ReviewPreferencesStore,
} from '../storage/review_preferences_store.js';
import type {ExecutionAuthority} from './execution_authority.js';
import {OperationError} from './operation_error.js';

export const annotationCommandSchemas = {
  annotation_vocabulary: z.object({}).strict(),
  entry_annotations_read: z
    .object({entryId: z.uuid(), includePrivate: z.boolean().default(false)})
    .strict(),
  entry_annotations_save: z
    .object({
      entryId: z.uuid(),
      includePrivate: z.boolean().default(false),
      expectedRevision: z.number().int().positive(),
      vocabularyRevision: z.number().int().min(0),
      annotation: annotationDraftSchema,
    })
    .strict(),
};
export const annotationOwnerSchemas = {
  annotation_vocabulary_save: z
    .object({
      expectedRevision: z.number().int().min(0),
      vocabulary: annotationVocabularySchema,
    })
    .strict(),
};
interface Dependencies {
  workspaceId: string;
  entries: InformationEntryRepositoryPort;
  preferences: ReviewPreferencesStore;
  stage: (snapshotId: string) => Promise<void>;
}
export class AnnotationService {
  constructor(private readonly deps: Dependencies) {}
  async execute(
    authority: ExecutionAuthority,
    name: string,
    input: unknown,
  ): Promise<unknown> {
    if (authority.workspaceId !== this.deps.workspaceId)
      throw new OperationError('forbidden', 'workspace_mismatch');
    const schemas = {...annotationCommandSchemas, ...annotationOwnerSchemas};
    if (!Object.hasOwn(schemas, name))
      throw new OperationError('not_found', 'unknown_operation');
    const schema = schemas[name as keyof typeof schemas];
    const parsed = schema.safeParse(input);
    if (!parsed.success)
      throw new OperationError('invalid_input', 'annotation_invalid');
    const vocabulary =
      (await this.deps.preferences.load(this.deps.workspaceId))
        .annotationVocabulary ?? EMPTY_ANNOTATION_VOCABULARY;
    authority.require('documents.read');
    if (name === 'annotation_vocabulary') return {vocabulary};
    if (name === 'annotation_vocabulary_save') {
      if (authority.identity.kind !== 'owner')
        throw new OperationError('forbidden', 'annotation_owner_required');
      const request =
        annotationOwnerSchemas.annotation_vocabulary_save.parse(input);
      const {result} = await updateReviewPreferences(
        this.deps.preferences,
        this.deps.workspaceId,
        (current) => {
          const before =
            current.annotationVocabulary ?? EMPTY_ANNOTATION_VOCABULARY;
          if (before.revision !== request.expectedRevision)
            throw new OperationError('conflict', 'stale_annotation_vocabulary');
          // Published annotations keep their original labels; identities cannot change meaning.
          if (
            before.terms.some(
              (t) =>
                !request.vocabulary.terms.some((n) => isDeepStrictEqual(n, t)),
            ) ||
            before.dimensions.some(
              (d) =>
                !request.vocabulary.dimensions.some(
                  (n) => n.id === d.id && n.role === d.role,
                ),
            )
          )
            throw new OperationError('rejected', 'annotation_identity_changed');
          const next = {...request.vocabulary, revision: before.revision + 1};
          return {
            next: patchReviewPreferences(current, {annotationVocabulary: next}),
            result: next,
          };
        },
      );
      return {vocabulary: result};
    }
    const request = annotationCommandSchemas.entry_annotations_read
      .loose()
      .parse(input);
    authority.require('documents.read', request.includePrivate);
    const rows = this.deps.entries.loadCurrentEntriesByIds
      ? await this.deps.entries.loadCurrentEntriesByIds(
          this.deps.workspaceId,
          request.includePrivate,
          [request.entryId],
        )
      : await this.deps.entries.loadCurrentEntries(
          this.deps.workspaceId,
          request.includePrivate,
        );
    const entry = rows.find(
      (e) =>
        e.entryId === request.entryId &&
        (!e.value.isPrivate || request.includePrivate),
    );
    if (!entry)
      throw new OperationError('not_found', 'information_entry_not_found');
    if (name === 'entry_annotations_read') return {entry, vocabulary};
    authority.require(
      authority.identity.kind === 'owner' ? 'entries.revise' : 'agent.tags',
      request.includePrivate,
    );
    const write = annotationCommandSchemas.entry_annotations_save.parse(input);
    if (entry.revision !== write.expectedRevision)
      throw new OperationError('conflict', 'stale_entry_revision');
    if (vocabulary.revision !== write.vocabularyRevision)
      throw new OperationError('conflict', 'stale_annotation_vocabulary');
    const annotation = structuredAnnotationsSchema.parse({
      ...write.annotation,
      schemaVersion: 1,
      dimensions: vocabulary.dimensions,
      vocabularyRevision: vocabulary.revision,
      inputRevision: entry.revision,
      inputBodySha256: entry.value.bodySha256,
      origin: authority.identity.kind === 'owner' ? 'manual' : 'ai',
      originVersion:
        authority.identity.kind === 'owner'
          ? 'manual-annotations.v1'
          : 'external-agent-annotations.v1',
    });
    if (
      !validateAnnotationEvidence(annotation, entry.value.body) ||
      annotation.labels.some((l) =>
        [
          ...vocabulary.terms,
          ...(entry.value.annotations?.labels.map((old) => old.term) ?? []),
        ].some((t) => t.id === l.term.id && !isDeepStrictEqual(t, l.term)),
      )
    )
      throw new OperationError('invalid_input', 'annotation_evidence_invalid');
    if (
      authority.identity.kind !== 'owner' &&
      entry.value.annotations?.origin === 'manual'
    )
      throw new OperationError('conflict', 'manual_annotations_protected');
    if (!entry.value.isPrivate) await this.deps.stage(entry.snapshotId);
    const outcome = await this.deps.entries.reviseEntry({
      workspaceId: this.deps.workspaceId,
      entryId: entry.entryId,
      expectedRevision: entry.revision,
      revisionId: deriveInformationEntryRevisionId(
        entry.entryId,
        entry.revision + 1,
      ),
      value: {...entry.value, annotations: annotation},
    });
    if (outcome === 'stale' || outcome === 'not_found')
      throw new OperationError('conflict', 'stale_entry_revision');
    return {status: outcome, annotation};
  }
}
