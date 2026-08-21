import {TextEncoder} from 'node:util';

import type {
  CurrentInformationEntry,
  EntryContentKeyword,
} from './information_entry_contract.js';
import type {
  InformationDocumentAggregationInput,
  InformationDocumentTag,
  InformationDocumentTagRevisionValue,
} from './information_document_tag_contract.js';
import {informationEntrySearchKey} from './information_entry.js';

export const INFORMATION_DOCUMENT_TAG_AGGREGATION_VERSION =
  'struinfo.document-tags.fulltext-entry-coverage.v1';
export const INFORMATION_DOCUMENT_TAG_MANUAL_VERSION =
  'manual-document-tag-editor.v1';
export const MAXIMUM_INFORMATION_DOCUMENT_TAGS = 32;
export const MAXIMUM_INFORMATION_DOCUMENT_TAG_CODE_POINTS = 80;

const textEncoder = new TextEncoder();

export function prepareAggregatedInformationDocumentTags(
  input: Readonly<InformationDocumentAggregationInput>,
): Readonly<InformationDocumentTagRevisionValue> | undefined {
  const entries = validateAggregationInput(input);
  if (entries === undefined) return undefined;
  const candidates = new Map<
    string,
    Readonly<{displayValue: string; entryCoverageCount: number}>
  >();
  for (const entry of entries) {
    const seen = new Set<string>();
    for (const keyword of entry.value.contentKeywords) {
      if (seen.has(keyword.normalizedValue)) continue;
      seen.add(keyword.normalizedValue);
      const current = candidates.get(keyword.normalizedValue);
      candidates.set(
        keyword.normalizedValue,
        Object.freeze({
          displayValue: current?.displayValue ?? keyword.displayValue,
          entryCoverageCount: (current?.entryCoverageCount ?? 0) + 1,
        }),
      );
    }
  }
  const normalizedText = informationEntrySearchKey(input.normalizedText);
  const tags = [...candidates.entries()].map(
    ([normalizedValue, candidate]): Readonly<InformationDocumentTag> =>
      Object.freeze({
        displayValue: candidate.displayValue,
        normalizedValue,
        origin: 'aggregate',
        fullTextOccurrences: countOccurrences(normalizedText, normalizedValue),
        entryCoverageCount: candidate.entryCoverageCount,
      }),
  );
  tags.sort(compareDocumentTags);
  return Object.freeze({
    revisionKind: 'aggregate',
    ruleVersion: INFORMATION_DOCUMENT_TAG_AGGREGATION_VERSION,
    isPrivate: input.isPrivate,
    entryCount: entries.length,
    tags: Object.freeze(tags.slice(0, MAXIMUM_INFORMATION_DOCUMENT_TAGS)),
  });
}

export function prepareManualInformationDocumentTags(
  input: Readonly<InformationDocumentAggregationInput>,
  values: readonly string[],
): Readonly<InformationDocumentTagRevisionValue> | undefined {
  const entries = validateAggregationInput(input);
  if (
    entries === undefined ||
    !Array.isArray(values) ||
    values.length > MAXIMUM_INFORMATION_DOCUMENT_TAGS
  ) {
    return undefined;
  }
  const normalizedText = informationEntrySearchKey(input.normalizedText);
  const coverage = entryKeywordCoverage(entries);
  const seen = new Set<string>();
  const tags: Readonly<InformationDocumentTag>[] = [];
  for (const value of values) {
    if (typeof value !== 'string') return undefined;
    const displayValue = value.trim().normalize('NFC');
    const normalizedValue = informationEntrySearchKey(displayValue);
    if (
      displayValue.length === 0 ||
      Array.from(displayValue).length >
        MAXIMUM_INFORMATION_DOCUMENT_TAG_CODE_POINTS ||
      seen.has(normalizedValue)
    ) {
      return undefined;
    }
    seen.add(normalizedValue);
    tags.push(
      Object.freeze({
        displayValue,
        normalizedValue,
        origin: 'manual',
        fullTextOccurrences: countOccurrences(normalizedText, normalizedValue),
        entryCoverageCount: coverage.get(normalizedValue) ?? 0,
      }),
    );
  }
  return Object.freeze({
    revisionKind: 'manual',
    ruleVersion: INFORMATION_DOCUMENT_TAG_MANUAL_VERSION,
    isPrivate: input.isPrivate,
    entryCount: entries.length,
    tags: Object.freeze(tags),
  });
}

function validateAggregationInput(
  input: Readonly<InformationDocumentAggregationInput>,
): readonly Readonly<CurrentInformationEntry>[] | undefined {
  if (typeof input.normalizedText !== 'string' || input.normalizedText === '') {
    return undefined;
  }
  const snapshotIds = new Set(input.entries.map((entry) => entry.snapshotId));
  if (snapshotIds.size > 1) return undefined;
  if (
    input.entries.some((entry) => entry.value.isPrivate !== input.isPrivate)
  ) {
    return undefined;
  }
  return [...input.entries].sort(
    (left, right) =>
      left.value.documentOrder - right.value.documentOrder ||
      left.entryId.localeCompare(right.entryId),
  );
}

function entryKeywordCoverage(
  entries: readonly Readonly<CurrentInformationEntry>[],
): ReadonlyMap<string, number> {
  const result = new Map<string, number>();
  for (const entry of entries) {
    const seen = new Set(
      entry.value.contentKeywords.map(
        (keyword: Readonly<EntryContentKeyword>) => keyword.normalizedValue,
      ),
    );
    for (const normalizedValue of seen) {
      result.set(normalizedValue, (result.get(normalizedValue) ?? 0) + 1);
    }
  }
  return result;
}

function countOccurrences(haystack: string, needle: string): number {
  if (needle === '') return 0;
  let count = 0;
  let offset = 0;
  while (offset <= haystack.length - needle.length) {
    const found = haystack.indexOf(needle, offset);
    if (found < 0) break;
    count += 1;
    offset = found + needle.length;
  }
  return count;
}

function compareDocumentTags(
  left: Readonly<InformationDocumentTag>,
  right: Readonly<InformationDocumentTag>,
): number {
  if (left.fullTextOccurrences !== right.fullTextOccurrences) {
    return right.fullTextOccurrences - left.fullTextOccurrences;
  }
  if (left.entryCoverageCount !== right.entryCoverageCount) {
    return right.entryCoverageCount - left.entryCoverageCount;
  }
  return compareUnsignedUtf8(left.normalizedValue, right.normalizedValue);
}

function compareUnsignedUtf8(left: string, right: string): number {
  const leftBytes = textEncoder.encode(left);
  const rightBytes = textEncoder.encode(right);
  const length = Math.min(leftBytes.length, rightBytes.length);
  for (let index = 0; index < length; index += 1) {
    const leftByte = leftBytes[index];
    const rightByte = rightBytes[index];
    if (leftByte !== rightByte) return (leftByte ?? 0) - (rightByte ?? 0);
  }
  return leftBytes.length - rightBytes.length;
}
