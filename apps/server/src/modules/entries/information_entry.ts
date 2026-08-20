import {
  ENTRY_DOMAIN_KEYWORDS,
  ENTRY_TYPE_KEYWORDS,
  type CurrentInformationEntry,
  type EntryContentKeyword,
  type EntryDomainAssignment,
  type EntryDomainKeyword,
  type EntryTypeKeyword,
  type InformationEntryMaterializeRow,
  type InformationEntryMatchReason,
  type InformationEntryRevisionValue,
  type InformationEntrySearchRequest,
  type InformationEntrySearchResult,
} from './information_entry_contract.js';
import {
  deriveInformationEntryId,
  deriveInformationEntryRevisionId,
  informationEntryBodySha256,
} from './information_entry_identity.js';

export const ENTRY_SPLIT_RULE_VERSION = 'struinfo.entry-split.section.v1';
export const ENTRY_MANUAL_ORIGIN_VERSION = 'manual-entry-editor.v1';
export const MAXIMUM_ENTRY_BODY_CODE_POINTS = 200_000;
export const MAXIMUM_CONTENT_KEYWORDS = 32;

export interface MaterializedEvidenceFragment {
  readonly fragmentId: string;
  readonly structureId: string;
  readonly nodeKind: string;
  readonly codePointRange: Readonly<{start: number; end: number}>;
  readonly selectedText: string;
}

export interface MaterializedEvidenceStructure {
  readonly structureId: string;
  readonly fragments: readonly Readonly<MaterializedEvidenceFragment>[];
}

export interface MaterializedEvidenceSnapshot {
  readonly workspaceId: string;
  readonly snapshotId: string;
  readonly resourceId: string;
  readonly isPrivate?: true;
  readonly structures: readonly Readonly<MaterializedEvidenceStructure>[];
}

export interface ManualEntryAnnotationInput {
  readonly body: string;
  readonly contentKeywords: readonly string[];
  readonly typeKeyword: EntryTypeKeyword;
  readonly typeCustomName?: string;
  readonly domains: readonly Readonly<{
    keyword: EntryDomainKeyword;
    customName?: string;
  }>[];
}

export function prepareSplitInformationEntries(
  snapshot: Readonly<MaterializedEvidenceSnapshot>,
): readonly Readonly<InformationEntryMaterializeRow>[] {
  const structure = snapshot.structures[0];
  if (structure === undefined) return Object.freeze([]);
  const sections = structure.fragments
    .filter((fragment) => fragment.nodeKind === 'section')
    .sort((left, right) =>
      left.codePointRange.start !== right.codePointRange.start
        ? left.codePointRange.start - right.codePointRange.start
        : left.fragmentId.localeCompare(right.fragmentId),
    );
  return Object.freeze(
    sections.map((fragment, documentOrder) => {
      const entryId = deriveInformationEntryId(
        snapshot.snapshotId,
        structure.structureId,
        fragment.fragmentId,
      );
      const revisionId = deriveInformationEntryRevisionId(entryId, 1);
      const body = fragment.selectedText;
      return Object.freeze({
        workspaceId: snapshot.workspaceId,
        entryId,
        resourceId: snapshot.resourceId,
        snapshotId: snapshot.snapshotId,
        revisionId,
        value: Object.freeze({
          documentOrder,
          titlePath: deriveTitlePath(body),
          body,
          bodySha256: informationEntryBodySha256(body),
          chunkMode: 'split' as const,
          splitRuleVersion: ENTRY_SPLIT_RULE_VERSION,
          isPrivate: snapshot.isPrivate === true,
          contentKeywords: Object.freeze([]),
          domains: Object.freeze([]),
          fragmentIds: Object.freeze([fragment.fragmentId]),
        }),
      });
    }),
  );
}

export function prepareManualEntryRevision(
  current: Readonly<CurrentInformationEntry>,
  input: Readonly<ManualEntryAnnotationInput>,
): Readonly<InformationEntryRevisionValue> | undefined {
  const body = normalizeBody(input.body);
  const contentKeywords = normalizeContentKeywords(input.contentKeywords);
  const type = normalizeType(input.typeKeyword, input.typeCustomName);
  const domains = normalizeDomains(input.domains);
  if (
    body === undefined ||
    contentKeywords === undefined ||
    type === undefined ||
    domains === undefined
  ) {
    return undefined;
  }
  return Object.freeze({
    documentOrder: current.value.documentOrder,
    titlePath: current.value.titlePath,
    body,
    bodySha256: informationEntryBodySha256(body),
    chunkMode: current.value.chunkMode,
    splitRuleVersion: current.value.splitRuleVersion,
    isPrivate: current.value.isPrivate,
    typeKeyword: type.keyword,
    ...(type.customName === undefined ? {} : {typeCustomName: type.customName}),
    contentKeywords,
    domains,
    fragmentIds: current.value.fragmentIds,
  });
}

export function searchCurrentInformationEntries(
  entries: readonly Readonly<CurrentInformationEntry>[],
  request: Readonly<InformationEntrySearchRequest>,
): Readonly<InformationEntrySearchResult> {
  const query =
    request.text === undefined ? '' : informationEntrySearchKey(request.text);
  const matches = entries.flatMap((entry) => {
    if (!request.includePrivate && entry.value.isPrivate) return [];
    if (
      request.snapshotId !== undefined &&
      entry.snapshotId !== request.snapshotId
    ) {
      return [];
    }
    if (
      request.typeKeyword !== undefined &&
      entry.value.typeKeyword !== request.typeKeyword
    ) {
      return [];
    }
    if (
      request.domainKeyword !== undefined &&
      !entry.value.domains.some(
        (domain) => domain.keyword === request.domainKeyword,
      )
    ) {
      return [];
    }
    const reasons = matchReasons(entry, query);
    return query !== '' && reasons.length === 0
      ? []
      : [Object.freeze({entry, matchReasons: Object.freeze(reasons)})];
  });
  matches.sort(compareSearchItems);
  return Object.freeze({
    totalCount: matches.length,
    items: Object.freeze(matches.slice(0, request.limit)),
  });
}

export function informationEntrySearchKey(value: string): string {
  const firstNfc = value.normalize('NFC');
  let lowered = '';
  for (const codePoint of firstNfc) {
    const code = codePoint.codePointAt(0);
    lowered +=
      code !== undefined && code >= 0x41 && code <= 0x5a
        ? String.fromCodePoint(code + 0x20)
        : codePoint;
  }
  return lowered.normalize('NFC');
}

function normalizeBody(value: string): string | undefined {
  if (typeof value !== 'string' || value.length === 0) return undefined;
  const count = Array.from(value).length;
  return count > MAXIMUM_ENTRY_BODY_CODE_POINTS ? undefined : value;
}

function normalizeContentKeywords(
  values: readonly string[],
): readonly Readonly<EntryContentKeyword>[] | undefined {
  if (
    !Array.isArray(values) ||
    values.length < 1 ||
    values.length > MAXIMUM_CONTENT_KEYWORDS
  ) {
    return undefined;
  }
  const seen = new Set<string>();
  const result: Readonly<EntryContentKeyword>[] = [];
  for (const value of values) {
    if (typeof value !== 'string') return undefined;
    const displayValue = value.trim().normalize('NFC');
    const normalizedValue = informationEntrySearchKey(displayValue);
    if (
      displayValue.length === 0 ||
      Array.from(displayValue).length > 80 ||
      seen.has(normalizedValue)
    ) {
      return undefined;
    }
    seen.add(normalizedValue);
    result.push(
      Object.freeze({
        displayValue,
        normalizedValue,
        origin: 'manual' as const,
        originVersion: ENTRY_MANUAL_ORIGIN_VERSION,
      }),
    );
  }
  return Object.freeze(result);
}

function normalizeType(
  keyword: EntryTypeKeyword,
  customName: string | undefined,
): Readonly<{keyword: EntryTypeKeyword; customName?: string}> | undefined {
  if (!ENTRY_TYPE_KEYWORDS.includes(keyword)) return undefined;
  return normalizeFixedOrOther(keyword, customName);
}

function normalizeDomains(
  values: readonly Readonly<{
    keyword: EntryDomainKeyword;
    customName?: string;
  }>[],
): readonly Readonly<EntryDomainAssignment>[] | undefined {
  if (values.length < 1 || values.length > 3) {
    return undefined;
  }
  const seen = new Set<string>();
  const result: Readonly<EntryDomainAssignment>[] = [];
  for (const value of values) {
    if (!ENTRY_DOMAIN_KEYWORDS.includes(value.keyword)) return undefined;
    const normalized = normalizeFixedOrOther(value.keyword, value.customName);
    if (normalized === undefined) return undefined;
    const identity = `${normalized.keyword}:${informationEntrySearchKey(normalized.customName ?? '')}`;
    if (seen.has(identity)) return undefined;
    seen.add(identity);
    result.push(
      Object.freeze({
        keyword: normalized.keyword,
        ...(normalized.customName === undefined
          ? {}
          : {customName: normalized.customName}),
        origin: 'manual' as const,
        originVersion: ENTRY_MANUAL_ORIGIN_VERSION,
      }),
    );
  }
  return Object.freeze(result);
}

function normalizeFixedOrOther<Keyword extends string>(
  keyword: Keyword,
  customName: string | undefined,
): Readonly<{keyword: Keyword; customName?: string}> | undefined {
  if (keyword !== 'other') {
    return customName === undefined || customName.trim() === ''
      ? Object.freeze({keyword})
      : undefined;
  }
  if (typeof customName !== 'string') return undefined;
  const normalizedCustomName = customName.trim().normalize('NFC');
  if (
    normalizedCustomName.length === 0 ||
    Array.from(normalizedCustomName).length > 80
  ) {
    return undefined;
  }
  return Object.freeze({keyword, customName: normalizedCustomName});
}

function deriveTitlePath(body: string): string {
  const line = body
    .split(/\r?\n/u)
    .map((candidate) => candidate.trim())
    .find((candidate) => candidate !== '');
  if (line === undefined) return '';
  return Array.from(line.replace(/^#{1,6}\s+/u, ''))
    .slice(0, 200)
    .join('');
}

function matchReasons(
  entry: Readonly<CurrentInformationEntry>,
  query: string,
): InformationEntryMatchReason[] {
  if (query === '') return [];
  const reasons: InformationEntryMatchReason[] = [];
  if (informationEntrySearchKey(entry.value.titlePath).includes(query)) {
    reasons.push('title');
  }
  if (informationEntrySearchKey(entry.value.body).includes(query)) {
    reasons.push('body');
  }
  if (
    entry.value.contentKeywords.some((keyword) =>
      keyword.normalizedValue.includes(query),
    )
  ) {
    reasons.push('content_keyword');
  }
  if (
    entry.value.typeKeyword !== undefined &&
    informationEntrySearchKey(
      entry.value.typeCustomName ?? entry.value.typeKeyword,
    ).includes(query)
  ) {
    reasons.push('type_keyword');
  }
  if (
    entry.value.domains.some((domain) =>
      informationEntrySearchKey(domain.customName ?? domain.keyword).includes(
        query,
      ),
    )
  ) {
    reasons.push('domain_keyword');
  }
  return reasons;
}

function compareSearchItems(
  left: Readonly<{
    entry: Readonly<CurrentInformationEntry>;
    matchReasons: readonly InformationEntryMatchReason[];
  }>,
  right: Readonly<{
    entry: Readonly<CurrentInformationEntry>;
    matchReasons: readonly InformationEntryMatchReason[];
  }>,
): number {
  if (left.matchReasons.length !== right.matchReasons.length) {
    return right.matchReasons.length - left.matchReasons.length;
  }
  const sourceOrder = right.entry.capturedAt.localeCompare(
    left.entry.capturedAt,
  );
  if (sourceOrder !== 0) return sourceOrder;
  if (left.entry.value.documentOrder !== right.entry.value.documentOrder) {
    return left.entry.value.documentOrder - right.entry.value.documentOrder;
  }
  return left.entry.entryId.localeCompare(right.entry.entryId);
}
