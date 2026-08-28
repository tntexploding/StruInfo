import {
  deriveInformationEntryTitlePath,
  prepareConfigurableSplitInformationEntries,
  type MaterializedEvidenceSnapshot,
} from './information_entry.js';
import type {
  EntryFragmentGroupInput,
  InformationEntryMaterializeRow,
} from './information_entry_contract.js';

export const ENTRY_SPLIT_RULE_MODES = [
  'one_section',
  'merge_short_adjacent',
] as const;
export const MAXIMUM_ENTRY_SPLIT_RULE_FRAGMENTS_PER_GROUP = 64;
export const MAXIMUM_ENTRY_SPLIT_RULE_CODE_POINTS = 200_000;
export const ENTRY_SPLIT_RULE_PREVIEW_CODE_POINTS = 320;

export type EntrySplitRuleMode = (typeof ENTRY_SPLIT_RULE_MODES)[number];

export interface EntrySplitRuleSettings {
  readonly mode: EntrySplitRuleMode;
  readonly minimumGroupCodePoints: number;
  readonly maximumGroupCodePoints: number;
  readonly maximumFragmentsPerGroup: number;
}

export interface EntrySplitRuleProfile extends EntrySplitRuleSettings {
  readonly revision: number;
}

export const DEFAULT_ENTRY_SPLIT_RULE_PROFILE: Readonly<EntrySplitRuleProfile> =
  Object.freeze({
    revision: 0,
    mode: 'one_section',
    minimumGroupCodePoints: 400,
    maximumGroupCodePoints: 4_000,
    maximumFragmentsPerGroup: 8,
  });

export interface EntrySplitRuleTrialGroup {
  readonly ordinal: number;
  readonly titlePath: string;
  readonly fragmentIds: readonly string[];
  readonly fragmentCount: number;
  readonly codePointCount: number;
  readonly exceedsMaximum: boolean;
  readonly previewText: string;
  readonly previewTruncated: boolean;
}

export interface EntrySplitRuleTrial {
  readonly snapshotId: string;
  readonly profile: Readonly<EntrySplitRuleProfile>;
  readonly sourceFragmentCount: number;
  readonly totalCodePointCount: number;
  readonly groups: readonly Readonly<EntrySplitRuleTrialGroup>[];
}

export interface EntrySplitRulePlan {
  readonly trial: Readonly<EntrySplitRuleTrial>;
  readonly rows: readonly Readonly<InformationEntryMaterializeRow>[];
}

interface RuleFragment {
  readonly fragmentId: string;
  readonly text: string;
  readonly codePointCount: number;
}

export function decodeEntrySplitRuleSettings(
  value: unknown,
): Readonly<EntrySplitRuleSettings> | undefined {
  if (
    !isClosedRecord(value, [
      'maximumFragmentsPerGroup',
      'maximumGroupCodePoints',
      'minimumGroupCodePoints',
      'mode',
    ])
  ) {
    return undefined;
  }
  const minimumGroupCodePoints = value.minimumGroupCodePoints;
  const maximumGroupCodePoints = value.maximumGroupCodePoints;
  const maximumFragmentsPerGroup = value.maximumFragmentsPerGroup;
  if (
    !ENTRY_SPLIT_RULE_MODES.includes(value.mode as EntrySplitRuleMode) ||
    !isIntegerInRange(
      minimumGroupCodePoints,
      1,
      MAXIMUM_ENTRY_SPLIT_RULE_CODE_POINTS,
    ) ||
    typeof minimumGroupCodePoints !== 'number' ||
    !isIntegerInRange(
      maximumGroupCodePoints,
      minimumGroupCodePoints,
      MAXIMUM_ENTRY_SPLIT_RULE_CODE_POINTS,
    ) ||
    !isIntegerInRange(
      maximumFragmentsPerGroup,
      1,
      MAXIMUM_ENTRY_SPLIT_RULE_FRAGMENTS_PER_GROUP,
    )
  ) {
    return undefined;
  }
  return Object.freeze({
    mode: value.mode as EntrySplitRuleMode,
    minimumGroupCodePoints,
    maximumGroupCodePoints: maximumGroupCodePoints as number,
    maximumFragmentsPerGroup: maximumFragmentsPerGroup as number,
  });
}

export function decodeEntrySplitRuleProfile(
  value: unknown,
): Readonly<EntrySplitRuleProfile> | undefined {
  if (!isRecord(value) || !isNonNegativeSafeInteger(value.revision)) {
    return undefined;
  }
  const settings = decodeEntrySplitRuleSettings({
    mode: value.mode,
    minimumGroupCodePoints: value.minimumGroupCodePoints,
    maximumGroupCodePoints: value.maximumGroupCodePoints,
    maximumFragmentsPerGroup: value.maximumFragmentsPerGroup,
  });
  if (
    settings === undefined ||
    Object.keys(value).sort().join(',') !==
      [
        'maximumFragmentsPerGroup',
        'maximumGroupCodePoints',
        'minimumGroupCodePoints',
        'mode',
        'revision',
      ].join(',')
  ) {
    return undefined;
  }
  return Object.freeze({revision: value.revision, ...settings});
}

export function planInformationEntrySplitRule(
  snapshot: Readonly<MaterializedEvidenceSnapshot>,
  profile: Readonly<EntrySplitRuleProfile>,
): Readonly<EntrySplitRulePlan> | undefined {
  const decodedProfile = decodeEntrySplitRuleProfile(profile);
  const structure = snapshot.structures[0];
  if (decodedProfile === undefined || structure === undefined) return undefined;
  const fragments: RuleFragment[] = structure.fragments
    .filter((fragment) => fragment.nodeKind === 'section')
    .sort((left, right) =>
      left.codePointRange.start !== right.codePointRange.start
        ? left.codePointRange.start - right.codePointRange.start
        : left.fragmentId.localeCompare(right.fragmentId),
    )
    .map((fragment) =>
      Object.freeze({
        fragmentId: fragment.fragmentId,
        text: fragment.selectedText,
        codePointCount: Array.from(fragment.selectedText).length,
      }),
    );
  if (fragments.length < 1 || fragments.length > 512) return undefined;
  const grouped =
    decodedProfile.mode === 'one_section'
      ? fragments.map((fragment) => Object.freeze([fragment]))
      : mergeShortAdjacentFragments(fragments, decodedProfile);
  const groupInputs: EntryFragmentGroupInput[] = grouped.map((group) => {
    const body = group.map((fragment) => fragment.text).join('\n\n');
    return Object.freeze({
      titlePath: deriveInformationEntryTitlePath(body),
      fragmentIds: Object.freeze(group.map((fragment) => fragment.fragmentId)),
    });
  });
  const rows = prepareConfigurableSplitInformationEntries(
    snapshot,
    groupInputs,
    decodedProfile.revision,
  );
  if (rows?.length !== grouped.length) return undefined;
  const groups = grouped.map((group, ordinal) => {
    const body = rows[ordinal]?.value.body ?? '';
    const scalars = Array.from(body);
    return Object.freeze({
      ordinal,
      titlePath: rows[ordinal]?.value.titlePath ?? '',
      fragmentIds: Object.freeze(group.map((fragment) => fragment.fragmentId)),
      fragmentCount: group.length,
      codePointCount: scalars.length,
      exceedsMaximum:
        scalars.length > decodedProfile.maximumGroupCodePoints ||
        group.length > decodedProfile.maximumFragmentsPerGroup,
      previewText: scalars
        .slice(0, ENTRY_SPLIT_RULE_PREVIEW_CODE_POINTS)
        .join(''),
      previewTruncated: scalars.length > ENTRY_SPLIT_RULE_PREVIEW_CODE_POINTS,
    });
  });
  return Object.freeze({
    trial: Object.freeze({
      snapshotId: snapshot.snapshotId,
      profile: decodedProfile,
      sourceFragmentCount: fragments.length,
      totalCodePointCount: fragments.reduce(
        (total, fragment) => total + fragment.codePointCount,
        0,
      ),
      groups: Object.freeze(groups),
    }),
    rows,
  });
}

function mergeShortAdjacentFragments(
  fragments: readonly Readonly<RuleFragment>[],
  settings: Readonly<EntrySplitRuleSettings>,
): readonly (readonly Readonly<RuleFragment>[])[] {
  const result: RuleFragment[][] = [];
  let current: RuleFragment[] = [];
  let currentCodePoints = 0;
  for (const fragment of fragments) {
    const separator = current.length === 0 ? 0 : 2;
    const fits =
      current.length < settings.maximumFragmentsPerGroup &&
      currentCodePoints + separator + fragment.codePointCount <=
        settings.maximumGroupCodePoints;
    if (
      current.length > 0 &&
      (currentCodePoints >= settings.minimumGroupCodePoints || !fits)
    ) {
      result.push(current);
      current = [];
      currentCodePoints = 0;
    }
    current.push(fragment);
    currentCodePoints +=
      (current.length === 1 ? 0 : 2) + fragment.codePointCount;
  }
  if (current.length > 0) result.push(current);

  const trailing = result.at(-1);
  const previous = result.at(-2);
  if (trailing !== undefined && previous !== undefined) {
    const trailingCount = groupCodePointCount(trailing);
    const mergedCount = groupCodePointCount(previous) + 2 + trailingCount;
    if (
      trailingCount < settings.minimumGroupCodePoints &&
      previous.length + trailing.length <= settings.maximumFragmentsPerGroup &&
      mergedCount <= settings.maximumGroupCodePoints
    ) {
      result.splice(-2, 2, [...previous, ...trailing]);
    }
  }
  return Object.freeze(result.map((group) => Object.freeze([...group])));
}

function groupCodePointCount(group: readonly Readonly<RuleFragment>[]): number {
  return group.reduce(
    (total, fragment, index) =>
      total + (index === 0 ? 0 : 2) + fragment.codePointCount,
    0,
  );
}

function isIntegerInRange(value: unknown, minimum: number, maximum: number) {
  return (
    typeof value === 'number' &&
    Number.isSafeInteger(value) &&
    value >= minimum &&
    value <= maximum
  );
}

function isNonNegativeSafeInteger(value: unknown): value is number {
  return isIntegerInRange(value, 0, Number.MAX_SAFE_INTEGER);
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isClosedRecord(
  value: unknown,
  keys: readonly string[],
): value is Readonly<Record<string, unknown>> {
  return (
    isRecord(value) &&
    Object.keys(value).sort().join(',') === [...keys].sort().join(',')
  );
}
