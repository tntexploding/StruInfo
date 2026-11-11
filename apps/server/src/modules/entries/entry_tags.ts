import type {InformationEntryRevisionValue} from './information_entry_contract.js';
import {
  annotationSearchWords,
  EMPTY_ANNOTATION_VOCABULARY,
  type AnnotationVocabulary,
} from './structured_annotations.js';

/** Single tag reader. Legacy fields are used only for records without annotations. */
export function entryTagWords(
  value: InformationEntryRevisionValue,
  vocabulary: AnnotationVocabulary = EMPTY_ANNOTATION_VOCABULARY,
): string[] {
  if (
    value.annotations &&
    value.annotations.originVersion !== 'reading-state.v1'
  )
    return value.annotations.inputBodySha256 === value.bodySha256
      ? [...new Set(annotationSearchWords(value.annotations, vocabulary))]
      : [];
  return [
    ...value.contentKeywords.map((t) => t.displayValue),
    ...(value.typeKeyword ? [value.typeCustomName ?? value.typeKeyword] : []),
    ...value.domains.map((d) => d.customName ?? d.keyword),
  ];
}
