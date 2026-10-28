import type {CurrentInformationEntry} from '../entries/index.js';

export const MAXIMUM_AI_BATCH_ENTRIES = 8;
export const MAXIMUM_TAG_BATCH_CHARACTERS = 100_000;
export const MAXIMUM_RECALL_BATCH_CHARACTERS = 120_000;

export function entryBatchSizeForAttempt(attempt: number): number {
  return attempt === 0 ? MAXIMUM_AI_BATCH_ENTRIES : attempt === 1 ? 4 : 1;
}

/** Conservative request size, including identity, existing tags and JSON escaping. */
export function tagBatchEntrySize(
  entry: Readonly<Pick<CurrentInformationEntry, 'value'>>,
) {
  return Array.from(JSON.stringify(entry.value)).length + 1024;
}

/** Reserve space for tags not yet generated when planning a split proposal. */
export function recallBatchEntrySize(
  entry: Readonly<Pick<CurrentInformationEntry, 'value'>>,
): number {
  return (
    Array.from(
      JSON.stringify({
        title: entry.value.titlePath,
        body: entry.value.body,
      }),
    ).length +
    // Twelve 80-character model tags, including JSON escaping and separators.
    // Use the same floor before and after tagging so the estimate stays valid.
    Math.max(
      2048,
      Array.from(
        JSON.stringify(
          entry.value.contentKeywords.map((keyword) => keyword.displayValue),
        ),
      ).length,
    ) +
    256
  );
}

/** A large Entry stays whole and uses the existing single-entry request. */
export function entryBatchPrefix<T>(
  items: readonly T[],
  size: (item: T) => number,
  maximumCharacters: number,
  maximumEntries = MAXIMUM_AI_BATCH_ENTRIES,
): T[] {
  const group: T[] = [];
  let characters = 0;
  for (const item of items) {
    const next = size(item);
    if (
      group.length &&
      (group.length >= maximumEntries || characters + next > maximumCharacters)
    )
      break;
    group.push(item);
    characters += next;
  }
  return group;
}

export function entryBatchCallEstimate<T>(
  items: readonly T[],
  size: (item: T) => number,
  maximumCharacters: number,
): number {
  let offset = 0;
  let calls = 0;
  while (offset < items.length) {
    offset += entryBatchPrefix(
      items.slice(offset),
      size,
      maximumCharacters,
    ).length;
    calls++;
  }
  return calls;
}
