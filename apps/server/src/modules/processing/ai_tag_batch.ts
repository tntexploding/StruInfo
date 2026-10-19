import type {CurrentInformationEntry} from '../entries/index.js';

export const MAXIMUM_TAG_BATCH_ENTRIES = 4;
export const MAXIMUM_TAG_BATCH_CHARACTERS = 100_000;

/** Conservative request size, including identity, existing tags and JSON escaping. */
export function tagBatchEntrySize(
  entry: Readonly<Pick<CurrentInformationEntry, 'value'>>,
) {
  return Array.from(JSON.stringify(entry.value)).length + 1024;
}

/** A large Entry stays whole and uses the existing single-entry request. */
export function tagBatchPrefix<T>(
  items: readonly T[],
  size: (item: T) => number,
  maximumEntries = MAXIMUM_TAG_BATCH_ENTRIES,
): T[] {
  const group: T[] = [];
  let characters = 0;
  for (const item of items) {
    const next = size(item);
    if (
      group.length &&
      (group.length >= maximumEntries ||
        characters + next > MAXIMUM_TAG_BATCH_CHARACTERS)
    )
      break;
    group.push(item);
    characters += next;
  }
  return group;
}
