import {
  EMPTY_ANNOTATION_VOCABULARY,
  withDefaultAnnotationDimensions,
  type AnnotationVocabulary,
} from '../modules/entries/structured_annotations.js';
import type {InformationEntryRepositoryPort} from '../modules/entries/information_entry_repository.js';
import type {ReviewPreferencesStore} from '../storage/review_preferences_store.js';

/** Saved public labels form the learned catalog, without a second stored copy. */
export async function loadAnnotationVocabulary(
  workspaceId: string,
  preferences: ReviewPreferencesStore,
  entries: InformationEntryRepositoryPort,
): Promise<AnnotationVocabulary> {
  const configured = withDefaultAnnotationDimensions(
    (await preferences.load(workspaceId)).annotationVocabulary ??
      EMPTY_ANNOTATION_VOCABULARY,
  );
  const learned = entries.loadAnnotationTerms
    ? await entries.loadAnnotationTerms(workspaceId)
    : (await entries.loadCurrentEntries(workspaceId, false))
        .filter(
          (e) =>
            !e.value.isPrivate &&
            e.value.annotations?.inputBodySha256 === e.value.bodySha256,
        )
        .flatMap((e) => e.value.annotations?.labels.map((l) => l.term) ?? []);
  const ids = new Set(configured.terms.map((t) => t.id));
  const dimensions = new Set(configured.dimensions.map((d) => d.id));
  return {
    ...configured,
    terms: [
      ...configured.terms,
      ...learned.filter((t) => {
        if (ids.has(t.id) || !dimensions.has(t.dimensionId)) return false;
        ids.add(t.id);
        return true;
      }),
    ],
  };
}
