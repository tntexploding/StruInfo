export function entryTagLabels(value) {
  if (value.annotations)
    return value.annotations.inputBodySha256 === value.bodySha256
      ? value.annotations.labels
      : [];
  return [];
}
export function entryTagWords(value) {
  return value.annotations &&
    value.annotations.originVersion !== 'reading-state.v1'
    ? [...new Set(entryTagLabels(value).map((l) => l.term.label))]
    : (value.contentKeywords || []).map((t) => t.displayValue);
}
export const tagCategories = [
  ['form', '类型'],
  ['domain', '领域'],
  ['entity', '对象'],
  ['issue', '议题'],
  ['purpose', '用途'],
  ['condition', '条件'],
];
export function entryTagDetails(value) {
  return Object.fromEntries(
    tagCategories.map(([role]) => [
      role,
      entryTagLabels(value)
        .filter((l) =>
          value.annotations.dimensions.some(
            (d) => d.id === l.dimensionId && d.role === role,
          ),
        )
        .map((l) => l.term.label)
        .join('、'),
    ]),
  );
}
