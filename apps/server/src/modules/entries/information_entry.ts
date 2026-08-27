import {
  ENTRY_DOMAIN_KEYWORDS,
  ENTRY_TYPE_KEYWORDS,
  type EntryFragmentGroupInput,
  type CurrentInformationEntry,
  type EntryAssessmentScore,
  type EntryContentKeyword,
  type EntryDomainAssignment,
  type EntryDomainKeyword,
  type EntryTypeKeyword,
  type InformationEntryMaterializeRow,
  type InformationEntryRevisionValue,
  type ManualEntryFragmentGroupInput,
} from './information_entry_contract.js';
import {
  deriveInformationEntryId,
  deriveInformationEntryRevisionId,
  informationEntryBodySha256,
} from './information_entry_identity.js';

export const ENTRY_SPLIT_RULE_VERSION = 'struinfo.entry-split.section.v1';
export const AI_ENTRY_SPLIT_RULE_VERSION = 'struinfo.entry-split.ai-group.v1';
export const MANUAL_ENTRY_SPLIT_RULE_VERSION =
  'struinfo.entry-split.manual-range.v1';
export const MANUAL_ENTRY_RESTRUCTURE_RULE_VERSION =
  'struinfo.entry-restructure.manual-range.v1';
export const CONFIGURABLE_ENTRY_SPLIT_RULE_VERSION =
  'struinfo.entry-split.configurable-group.v1';
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
  readonly normalizedText?: string;
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
  readonly usefulnessScore?: EntryAssessmentScore;
  readonly interestScore?: EntryAssessmentScore;
  readonly domains: readonly Readonly<{
    keyword: EntryDomainKeyword;
    customName?: string;
  }>[];
}

export interface AiEntryTagAnnotationInput {
  readonly contentKeywords: readonly string[];
  readonly typeKeyword: EntryTypeKeyword;
  readonly typeCustomName?: string;
  readonly domains: readonly Readonly<{
    keyword: EntryDomainKeyword;
    customName?: string;
  }>[];
  readonly originVersion: string;
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
          titlePath: deriveInformationEntryTitlePath(body),
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

export function prepareAiSplitInformationEntries(
  snapshot: Readonly<MaterializedEvidenceSnapshot>,
  groups: readonly Readonly<EntryFragmentGroupInput>[],
): readonly Readonly<InformationEntryMaterializeRow>[] | undefined {
  return prepareGroupedInformationEntries(snapshot, groups, {
    splitRuleVersion: AI_ENTRY_SPLIT_RULE_VERSION,
    identityVersion: 'ai-group-v1',
    includeTitleInIdentity: false,
    isPrivate: false,
  });
}

export function prepareConfigurableSplitInformationEntries(
  snapshot: Readonly<MaterializedEvidenceSnapshot>,
  groups: readonly Readonly<EntryFragmentGroupInput>[],
  profileRevision: number,
): readonly Readonly<InformationEntryMaterializeRow>[] | undefined {
  if (!Number.isSafeInteger(profileRevision) || profileRevision < 0) {
    return undefined;
  }
  return prepareGroupedInformationEntries(snapshot, groups, {
    splitRuleVersion: `${CONFIGURABLE_ENTRY_SPLIT_RULE_VERSION}:r${profileRevision.toString()}`,
    identityVersion: 'configurable-group-v1',
    includeTitleInIdentity: false,
    isPrivate: snapshot.isPrivate === true,
  });
}

export function prepareManualSplitInformationEntries(
  snapshot: Readonly<MaterializedEvidenceSnapshot>,
  groups: readonly Readonly<ManualEntryFragmentGroupInput>[],
): readonly Readonly<InformationEntryMaterializeRow>[] | undefined {
  const structure = snapshot.structures[0];
  if (structure === undefined || groups.length < 1 || groups.length > 256) {
    return undefined;
  }
  const sections = structure.fragments
    .filter((fragment) => fragment.nodeKind === 'section')
    .sort((left, right) =>
      left.codePointRange.start !== right.codePointRange.start
        ? left.codePointRange.start - right.codePointRange.start
        : left.fragmentId.localeCompare(right.fragmentId),
    );
  const scalarTextByFragment = new Map(
    sections.map((fragment) => [
      fragment.fragmentId,
      Object.freeze(Array.from(fragment.selectedText)),
    ]),
  );
  let sectionIndex = 0;
  let expectedStart = 0;
  let inputCount = 0;
  for (const group of groups) {
    if (group.fragments.length < 1) return undefined;
    for (const input of group.fragments) {
      inputCount += 1;
      if (inputCount > 512) return undefined;
      const section = sections[sectionIndex];
      const scalars = scalarTextByFragment.get(input.fragmentId);
      if (
        section?.fragmentId !== input.fragmentId ||
        scalars === undefined ||
        !Number.isSafeInteger(input.startCodePoint) ||
        !Number.isSafeInteger(input.endCodePoint) ||
        input.startCodePoint !== expectedStart ||
        input.endCodePoint <= input.startCodePoint ||
        input.endCodePoint > scalars.length
      ) {
        return undefined;
      }
      if (input.endCodePoint === scalars.length) {
        sectionIndex += 1;
        expectedStart = 0;
      } else {
        expectedStart = input.endCodePoint;
      }
    }
  }
  if (sectionIndex !== sections.length || expectedStart !== 0) return undefined;

  const rows: Readonly<InformationEntryMaterializeRow>[] = [];
  for (const [documentOrder, group] of groups.entries()) {
    const titlePath = normalizeSplitTitle(group.titlePath);
    if (titlePath === undefined) return undefined;
    const fragments = coalesceManualFragmentInputs(group.fragments);
    const parts = fragments.map((input) => {
      const scalars = scalarTextByFragment.get(input.fragmentId);
      if (scalars === undefined) return undefined;
      return Object.freeze({
        fragmentId: input.fragmentId,
        text: scalars.slice(input.startCodePoint, input.endCodePoint).join(''),
      });
    });
    if (parts.some((part) => part === undefined)) return undefined;
    let body = '';
    let previousFragmentId: string | undefined;
    for (const part of parts) {
      if (part === undefined) return undefined;
      if (body !== '' && previousFragmentId !== part.fragmentId) body += '\n\n';
      body += part.text;
      previousFragmentId = part.fragmentId;
    }
    if (
      body.length === 0 ||
      Array.from(body).length > MAXIMUM_ENTRY_BODY_CODE_POINTS
    ) {
      return undefined;
    }
    const identityInput = [
      titlePath,
      ...fragments.map(
        (input) =>
          `${input.fragmentId}:${input.startCodePoint.toString()}:${input.endCodePoint.toString()}`,
      ),
    ].join('\n');
    const sourceIdentity = `manual-range-v1:${informationEntryBodySha256(identityInput)}`;
    const entryId = deriveInformationEntryId(
      snapshot.snapshotId,
      structure.structureId,
      sourceIdentity,
    );
    rows.push(
      Object.freeze({
        workspaceId: snapshot.workspaceId,
        entryId,
        resourceId: snapshot.resourceId,
        snapshotId: snapshot.snapshotId,
        revisionId: deriveInformationEntryRevisionId(entryId, 1),
        value: Object.freeze({
          documentOrder,
          titlePath,
          body,
          bodySha256: informationEntryBodySha256(body),
          chunkMode: 'split' as const,
          splitRuleVersion: MANUAL_ENTRY_SPLIT_RULE_VERSION,
          isPrivate: snapshot.isPrivate === true,
          contentKeywords: Object.freeze([]),
          domains: Object.freeze([]),
          fragmentIds: Object.freeze(
            fragments.map((input) => input.fragmentId),
          ),
          fragmentRanges: Object.freeze(
            fragments.map((input) =>
              Object.freeze({
                startCodePoint: input.startCodePoint,
                endCodePoint: input.endCodePoint,
              }),
            ),
          ),
        }),
      }),
    );
  }
  return Object.freeze(rows);
}

function coalesceManualFragmentInputs(
  inputs: readonly Readonly<{
    fragmentId: string;
    startCodePoint: number;
    endCodePoint: number;
  }>[],
): readonly Readonly<{
  fragmentId: string;
  startCodePoint: number;
  endCodePoint: number;
}>[] {
  const result: {
    fragmentId: string;
    startCodePoint: number;
    endCodePoint: number;
  }[] = [];
  for (const input of inputs) {
    const previous = result.at(-1);
    if (
      previous?.fragmentId === input.fragmentId &&
      previous.endCodePoint === input.startCodePoint
    ) {
      previous.endCodePoint = input.endCodePoint;
    } else {
      result.push({...input});
    }
  }
  return Object.freeze(result.map((input) => Object.freeze(input)));
}
function prepareGroupedInformationEntries(
  snapshot: Readonly<MaterializedEvidenceSnapshot>,
  groups: readonly Readonly<EntryFragmentGroupInput>[],
  options: Readonly<{
    splitRuleVersion: string;
    identityVersion: string;
    includeTitleInIdentity: boolean;
    isPrivate: boolean;
  }>,
): readonly Readonly<InformationEntryMaterializeRow>[] | undefined {
  const structure = snapshot.structures[0];
  if (structure === undefined || groups.length < 1) return undefined;
  const sections = structure.fragments
    .filter((fragment) => fragment.nodeKind === 'section')
    .sort((left, right) =>
      left.codePointRange.start !== right.codePointRange.start
        ? left.codePointRange.start - right.codePointRange.start
        : left.fragmentId.localeCompare(right.fragmentId),
    );
  const expectedIds = sections.map((fragment) => fragment.fragmentId);
  const actualIds = groups.flatMap((group) => group.fragmentIds);
  if (
    actualIds.length !== expectedIds.length ||
    actualIds.some((fragmentId, index) => fragmentId !== expectedIds[index])
  ) {
    return undefined;
  }
  const sectionById = new Map(
    sections.map((fragment) => [fragment.fragmentId, fragment]),
  );
  const rows: Readonly<InformationEntryMaterializeRow>[] = [];
  for (const [documentOrder, group] of groups.entries()) {
    const titlePath = normalizeSplitTitle(group.titlePath);
    if (titlePath === undefined || group.fragmentIds.length < 1) {
      return undefined;
    }
    const fragments = group.fragmentIds.map((fragmentId) =>
      sectionById.get(fragmentId),
    );
    if (fragments.some((fragment) => fragment === undefined)) return undefined;
    const body = fragments
      .map((fragment) => fragment?.selectedText ?? '')
      .join('\n\n');
    if (
      body.length === 0 ||
      Array.from(body).length > MAXIMUM_ENTRY_BODY_CODE_POINTS
    ) {
      return undefined;
    }
    const identityInput = options.includeTitleInIdentity
      ? [titlePath, ...group.fragmentIds].join('\n')
      : group.fragmentIds.join('\n');
    const sourceIdentity = `${options.identityVersion}:${informationEntryBodySha256(
      identityInput,
    )}`;
    const entryId = deriveInformationEntryId(
      snapshot.snapshotId,
      structure.structureId,
      sourceIdentity,
    );
    rows.push(
      Object.freeze({
        workspaceId: snapshot.workspaceId,
        entryId,
        resourceId: snapshot.resourceId,
        snapshotId: snapshot.snapshotId,
        revisionId: deriveInformationEntryRevisionId(entryId, 1),
        value: Object.freeze({
          documentOrder,
          titlePath,
          body,
          bodySha256: informationEntryBodySha256(body),
          chunkMode: 'split' as const,
          splitRuleVersion: options.splitRuleVersion,
          isPrivate: options.isPrivate,
          contentKeywords: Object.freeze([]),
          domains: Object.freeze([]),
          fragmentIds: Object.freeze([...group.fragmentIds]),
        }),
      }),
    );
  }
  return Object.freeze(rows);
}

export function prepareManualEntryRevision(
  current: Readonly<CurrentInformationEntry>,
  input: Readonly<ManualEntryAnnotationInput>,
): Readonly<InformationEntryRevisionValue> | undefined {
  const body = normalizeBody(input.body);
  const contentKeywords = normalizeContentKeywords(
    input.contentKeywords,
    'manual',
    ENTRY_MANUAL_ORIGIN_VERSION,
  );
  const type = normalizeType(input.typeKeyword, input.typeCustomName);
  const domains = normalizeDomains(
    input.domains,
    'manual',
    ENTRY_MANUAL_ORIGIN_VERSION,
  );
  if (
    body === undefined ||
    contentKeywords === undefined ||
    type === undefined ||
    domains === undefined ||
    !isAssessmentScore(input.usefulnessScore) ||
    !isAssessmentScore(input.interestScore)
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
    ...(input.usefulnessScore === undefined
      ? current.value.usefulnessScore === undefined
        ? {}
        : {usefulnessScore: current.value.usefulnessScore}
      : {usefulnessScore: input.usefulnessScore}),
    ...(input.interestScore === undefined
      ? current.value.interestScore === undefined
        ? {}
        : {interestScore: current.value.interestScore}
      : {interestScore: input.interestScore}),
    contentKeywords,
    domains,
    fragmentIds: current.value.fragmentIds,
    ...(current.value.fragmentRanges === undefined
      ? {}
      : {fragmentRanges: current.value.fragmentRanges}),
  });
}

export function prepareAiEntryTagRevision(
  current: Readonly<CurrentInformationEntry>,
  input: Readonly<AiEntryTagAnnotationInput>,
): Readonly<InformationEntryRevisionValue> | undefined {
  const originVersion = input.originVersion.trim().normalize('NFC');
  if (originVersion.length === 0 || Array.from(originVersion).length > 512) {
    return undefined;
  }
  const contentKeywords = normalizeContentKeywords(
    input.contentKeywords,
    'ai',
    originVersion,
  );
  const type = normalizeType(input.typeKeyword, input.typeCustomName);
  const domains = normalizeDomains(input.domains, 'ai', originVersion);
  if (
    contentKeywords === undefined ||
    type === undefined ||
    domains === undefined
  ) {
    return undefined;
  }
  return Object.freeze({
    ...current.value,
    typeKeyword: type.keyword,
    ...(type.customName === undefined ? {} : {typeCustomName: type.customName}),
    contentKeywords,
    domains,
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

function isAssessmentScore(value: EntryAssessmentScore | undefined): boolean {
  return (
    value === undefined || (Number.isInteger(value) && value >= 1 && value <= 5)
  );
}

function normalizeBody(value: string): string | undefined {
  if (typeof value !== 'string' || value.length === 0) return undefined;
  const count = Array.from(value).length;
  return count > MAXIMUM_ENTRY_BODY_CODE_POINTS ? undefined : value;
}

function normalizeContentKeywords(
  values: readonly string[],
  origin: 'manual' | 'ai',
  originVersion: string,
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
        origin,
        originVersion,
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
  origin: 'manual' | 'ai',
  originVersion: string,
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
        origin,
        originVersion,
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

function normalizeSplitTitle(value: string): string | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim().normalize('NFC');
  if (
    normalized.length === 0 ||
    Array.from(normalized).length > 200 ||
    Array.from(normalized).some((character) => {
      const codePoint = character.codePointAt(0);
      return (
        codePoint !== undefined && (codePoint <= 0x1f || codePoint === 0x7f)
      );
    })
  ) {
    return undefined;
  }
  return normalized;
}

export function deriveInformationEntryTitlePath(body: string): string {
  const line = body
    .split(/\r?\n/u)
    .map((candidate) => candidate.trim())
    .find((candidate) => candidate !== '');
  if (line === undefined) return '';
  return Array.from(line.replace(/^#{1,6}\s+/u, ''))
    .slice(0, 200)
    .join('');
}
