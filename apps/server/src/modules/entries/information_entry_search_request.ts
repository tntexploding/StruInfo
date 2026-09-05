import {
  ENTRY_CHUNK_MODES,
  ENTRY_DOMAIN_KEYWORDS,
  ENTRY_TEXT_SEARCH_FIELDS,
  ENTRY_TEXT_SEARCH_MODES,
  ENTRY_RETRIEVAL_MODES,
  ENTRY_TYPE_KEYWORDS,
  type EntryDomainKeyword,
  type EntryTypeKeyword,
  type EntryTextSearchField,
  type EntryTextSearchMode,
  type InformationEntrySearchRequest,
} from './information_entry_contract.js';

const CANONICAL_UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;
export function decodeEntrySearchBody(
  body: unknown,
): Readonly<InformationEntrySearchRequest> | undefined {
  if (!isRecord(body)) return undefined;
  const textValue = optionalBoundedText(body.text, 300);
  const retrievalMode = body.retrievalMode ?? 'lexical';
  const textMode = body.textMode ?? 'substring';
  const textFields = decodeEntrySearchTextFields(body.textFields);
  const contentKeyword = optionalBoundedText(body.contentKeyword, 80);
  const sourceKey = optionalBoundedText(body.sourceKey, 2_048);
  const snapshotId = body.snapshotId ?? undefined;
  const typeKeyword = body.typeKeyword ?? undefined;
  const typeCustomName = optionalBoundedText(body.typeCustomName, 80);
  const domainKeyword = body.domainKeyword ?? undefined;
  const domainCustomName = optionalBoundedText(body.domainCustomName, 80);
  const domainScope = body.domainScope ?? 'any';
  const chunkMode = body.chunkMode ?? undefined;
  const includePrivate = body.includePrivate ?? false;
  const onlyPrivate = body.onlyPrivate ?? false;
  const limit = body.limit ?? 25;
  const time = decodeEntrySearchTime(body.time);
  const association = decodeEntrySearchAssociation(body.association);
  const after = decodeEntrySearchCursor(body.after);
  if (
    textValue === null ||
    typeof retrievalMode !== 'string' ||
    !ENTRY_RETRIEVAL_MODES.includes(
      retrievalMode as (typeof ENTRY_RETRIEVAL_MODES)[number],
    ) ||
    (retrievalMode !== 'lexical' &&
      (textValue === undefined || textValue.trim() === '')) ||
    typeof textMode !== 'string' ||
    !ENTRY_TEXT_SEARCH_MODES.includes(textMode as EntryTextSearchMode) ||
    textFields === undefined ||
    (textValue === undefined &&
      (body.textMode !== undefined || body.textFields !== undefined)) ||
    contentKeyword === null ||
    sourceKey === null ||
    typeCustomName === null ||
    domainCustomName === null ||
    (snapshotId !== undefined &&
      (typeof snapshotId !== 'string' || !CANONICAL_UUID.test(snapshotId))) ||
    (typeKeyword !== undefined &&
      (typeof typeKeyword !== 'string' ||
        !ENTRY_TYPE_KEYWORDS.includes(typeKeyword as EntryTypeKeyword))) ||
    (typeCustomName !== undefined && typeKeyword !== 'other') ||
    (typeKeyword === 'other' && typeCustomName === undefined) ||
    (domainKeyword !== undefined &&
      (typeof domainKeyword !== 'string' ||
        !ENTRY_DOMAIN_KEYWORDS.includes(
          domainKeyword as EntryDomainKeyword,
        ))) ||
    (domainScope !== 'any' &&
      domainScope !== 'primary' &&
      domainScope !== 'secondary') ||
    (domainCustomName !== undefined && domainKeyword !== 'other') ||
    (domainKeyword === 'other' && domainCustomName === undefined) ||
    (domainKeyword === undefined && domainScope !== 'any') ||
    (chunkMode !== undefined &&
      (typeof chunkMode !== 'string' ||
        !ENTRY_CHUNK_MODES.includes(chunkMode as 'split' | 'whole'))) ||
    (body.time !== undefined && time === undefined) ||
    (body.association !== undefined && association === undefined) ||
    (body.after !== undefined && after === undefined) ||
    typeof includePrivate !== 'boolean' ||
    typeof onlyPrivate !== 'boolean' ||
    (onlyPrivate && !includePrivate) ||
    typeof limit !== 'number' ||
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    limit > 100
  ) {
    return undefined;
  }
  return Object.freeze({
    ...(textValue === undefined
      ? {}
      : {
          text: textValue,
          textMode: textMode as EntryTextSearchMode,
          textFields,
        }),
    retrievalMode: retrievalMode as (typeof ENTRY_RETRIEVAL_MODES)[number],
    ...(contentKeyword === undefined ? {} : {contentKeyword}),
    ...(sourceKey === undefined ? {} : {sourceKey}),
    ...(snapshotId === undefined ? {} : {snapshotId}),
    ...(typeKeyword === undefined
      ? {}
      : {typeKeyword: typeKeyword as EntryTypeKeyword}),
    ...(typeCustomName === undefined ? {} : {typeCustomName}),
    ...(domainKeyword === undefined
      ? {}
      : {domainKeyword: domainKeyword as EntryDomainKeyword}),
    ...(domainCustomName === undefined ? {} : {domainCustomName}),
    domainScope,
    ...(chunkMode === undefined
      ? {}
      : {chunkMode: chunkMode as 'split' | 'whole'}),
    ...(time === undefined ? {} : {time}),
    ...(association === undefined ? {} : {association}),
    includePrivate,
    onlyPrivate,
    limit,
    ...(after === undefined ? {} : {after}),
  });
}

function decodeEntrySearchTextFields(
  value: unknown,
): readonly EntryTextSearchField[] | undefined {
  const fields = value ?? ENTRY_TEXT_SEARCH_FIELDS;
  if (
    !Array.isArray(fields) ||
    fields.length < 1 ||
    fields.length > ENTRY_TEXT_SEARCH_FIELDS.length ||
    !fields.every(
      (field) =>
        typeof field === 'string' &&
        ENTRY_TEXT_SEARCH_FIELDS.includes(field as EntryTextSearchField),
    ) ||
    new Set(fields).size !== fields.length
  ) {
    return undefined;
  }
  return Object.freeze(
    ENTRY_TEXT_SEARCH_FIELDS.filter((field) => fields.includes(field)),
  );
}

function decodeEntrySearchTime(body: unknown):
  | Readonly<{
      field: 'published' | 'captured';
      from?: string;
      to?: string;
    }>
  | undefined {
  if (body === undefined) return undefined;
  if (!isRecord(body)) return undefined;
  const from = body.from ?? undefined;
  const to = body.to ?? undefined;
  if (
    (body.field !== 'published' && body.field !== 'captured') ||
    (from !== undefined && (typeof from !== 'string' || !isIsoDate(from))) ||
    (to !== undefined && (typeof to !== 'string' || !isIsoDate(to))) ||
    (from === undefined && to === undefined) ||
    (typeof from === 'string' && typeof to === 'string' && from > to)
  ) {
    return undefined;
  }
  return Object.freeze({
    field: body.field,
    ...(typeof from === 'string' ? {from} : {}),
    ...(typeof to === 'string' ? {to} : {}),
  });
}

function decodeEntrySearchAssociation(body: unknown):
  | Readonly<{
      entryId: string;
      maximumDepth: 1 | 2;
      minimumScore: number;
    }>
  | undefined {
  if (body === undefined) return undefined;
  if (
    !isRecord(body) ||
    typeof body.entryId !== 'string' ||
    !CANONICAL_UUID.test(body.entryId) ||
    (body.maximumDepth !== 1 && body.maximumDepth !== 2) ||
    typeof body.minimumScore !== 'number' ||
    !Number.isSafeInteger(body.minimumScore) ||
    body.minimumScore < 0 ||
    body.minimumScore > 10_000
  ) {
    return undefined;
  }
  return Object.freeze({
    entryId: body.entryId,
    maximumDepth: body.maximumDepth,
    minimumScore: body.minimumScore,
  });
}

function decodeEntrySearchCursor(
  body: unknown,
): Readonly<NonNullable<InformationEntrySearchRequest['after']>> | undefined {
  if (body === undefined) return undefined;
  if (
    !isRecord(body) ||
    body.schemaVersion !== 2 ||
    typeof body.querySha256 !== 'string' ||
    !/^[0-9a-f]{64}$/u.test(body.querySha256) ||
    typeof body.associationDepth !== 'number' ||
    !Number.isSafeInteger(body.associationDepth) ||
    body.associationDepth < 0 ||
    body.associationDepth > 2 ||
    typeof body.textScore !== 'number' ||
    !Number.isSafeInteger(body.textScore) ||
    body.textScore < 0 ||
    body.textScore > 10_000 ||
    typeof body.matchReasonCount !== 'number' ||
    !Number.isSafeInteger(body.matchReasonCount) ||
    body.matchReasonCount < 0 ||
    body.matchReasonCount > 5 ||
    typeof body.associationScore !== 'number' ||
    !Number.isSafeInteger(body.associationScore) ||
    body.associationScore < 0 ||
    body.associationScore > 10_000 ||
    typeof body.capturedAt !== 'string' ||
    Number.isNaN(Date.parse(body.capturedAt)) ||
    typeof body.documentOrder !== 'number' ||
    !Number.isSafeInteger(body.documentOrder) ||
    body.documentOrder < 0 ||
    typeof body.entryId !== 'string' ||
    !CANONICAL_UUID.test(body.entryId)
  ) {
    return undefined;
  }
  return Object.freeze({
    schemaVersion: 2 as const,
    querySha256: body.querySha256,
    associationDepth: body.associationDepth,
    textScore: body.textScore,
    matchReasonCount: body.matchReasonCount,
    associationScore: body.associationScore,
    capturedAt: new Date(body.capturedAt).toISOString(),
    documentOrder: body.documentOrder,
    entryId: body.entryId,
  });
}

function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value)) return false;
  const date = new Date(value + 'T00:00:00.000Z');
  return (
    !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value
  );
}

function optionalBoundedText(
  value: unknown,
  maximumCodePoints: number,
): string | undefined | null {
  if (value === undefined) return undefined;
  if (typeof value !== 'string') return null;
  const normalized = value.trim().normalize('NFC');
  if (normalized.length === 0) return undefined;
  return Array.from(normalized).length <= maximumCodePoints ? normalized : null;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
