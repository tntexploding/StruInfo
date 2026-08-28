import {TextEncoder} from 'node:util';

import {
  decodeEntryPreferenceProfile,
  ENTRY_PREFERENCE_DIMENSIONS,
  ENTRY_PREFERENCE_FEATURE_KINDS,
  normalizeEntryPreferenceFeatureIdentity,
  type EntryPreferenceDimension,
  type EntryPreferenceFeatureKind,
  type EntryPreferenceProfile,
  type EntryPreferenceRule,
} from '../../storage/review_preferences_store.js';
import type {CurrentInformationEntry} from './information_entry_contract.js';
import {
  MAXIMUM_INFORMATION_ENTRY_PREFERENCE_SUGGESTIONS,
  MAXIMUM_INFORMATION_ENTRY_PREFERENCE_TRIAL_ENTRIES,
  type InformationEntryPreferenceStaleEntry,
  type InformationEntryPreferenceSuggestion,
  type InformationEntryPreferenceSuggestionRequest,
  type InformationEntryPreferenceSuggestionResult,
  type InformationEntryPreferenceTrialExpectedEntry,
  type InformationEntryPreferenceTrialItem,
  type InformationEntryPreferenceTrialMatch,
  type InformationEntryPreferenceTrialRequest,
  type InformationEntryPreferenceTrialResult,
} from './information_entry_preference_profile_contract.js';

const CANONICAL_UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;
const textEncoder = new TextEncoder();

type ObservationSide = 'positive' | 'neutral' | 'negative';

interface EntryPreferenceFeature {
  readonly featureKind: EntryPreferenceFeatureKind;
  readonly featureIdentity: string;
  readonly displayValue: string;
}

interface MutableSuggestionAggregate extends EntryPreferenceFeature {
  readonly dimension: EntryPreferenceDimension;
  readonly displays: Set<string>;
  readonly positiveEntryIds: Set<string>;
  readonly neutralEntryIds: Set<string>;
  readonly negativeEntryIds: Set<string>;
}

export function suggestInformationEntryPreferenceRules(
  entries: readonly Readonly<CurrentInformationEntry>[],
  request: Readonly<InformationEntryPreferenceSuggestionRequest>,
): Readonly<InformationEntryPreferenceSuggestionResult> {
  const visibleEntries = visibleInformationEntries(
    entries,
    request.includePrivate,
  );
  const aggregates = new Map<string, MutableSuggestionAggregate>();

  for (const entry of visibleEntries) {
    const features = informationEntryPreferenceFeatures(entry);
    for (const dimension of ENTRY_PREFERENCE_DIMENSIONS) {
      const score =
        dimension === 'usefulness'
          ? entry.value.usefulnessScore
          : entry.value.interestScore;
      const side = observationSide(score);
      if (side === undefined) continue;
      for (const feature of features) {
        const key = aggregateKey(dimension, feature);
        let aggregate = aggregates.get(key);
        if (aggregate === undefined) {
          aggregate = {
            ...feature,
            dimension,
            displays: new Set<string>(),
            positiveEntryIds: new Set<string>(),
            neutralEntryIds: new Set<string>(),
            negativeEntryIds: new Set<string>(),
          };
          aggregates.set(key, aggregate);
        }
        aggregate.displays.add(feature.displayValue);
        aggregate[`${side}EntryIds`].add(entry.entryId);
      }
    }
  }

  const candidates = [...aggregates.values()]
    .map(toSuggestion)
    .filter(
      (
        candidate,
      ): candidate is Readonly<InformationEntryPreferenceSuggestion> =>
        candidate !== undefined,
    )
    .sort(compareSuggestions);
  const bounded = candidates.slice(
    0,
    MAXIMUM_INFORMATION_ENTRY_PREFERENCE_SUGGESTIONS,
  );
  return Object.freeze({
    includePrivate: request.includePrivate,
    visibleEntryCount: visibleEntries.length,
    totalCandidateCount: candidates.length,
    truncated: bounded.length !== candidates.length,
    candidates: Object.freeze(bounded),
  });
}

export function trialInformationEntryPreferenceProfile(
  entries: readonly Readonly<CurrentInformationEntry>[],
  currentProfileRevision: number,
  profileInput: unknown,
  request: Readonly<InformationEntryPreferenceTrialRequest>,
): Readonly<InformationEntryPreferenceTrialResult> {
  const profile = decodeEntryPreferenceProfile(profileInput);
  if (profile === undefined) return Object.freeze({status: 'invalid_profile'});
  if (
    !isNonNegativeSafeInteger(currentProfileRevision) ||
    !isNonNegativeSafeInteger(request.expectedProfileRevision) ||
    !isValidExpectedEntries(request.expectedEntries)
  ) {
    return Object.freeze({status: 'invalid_request'});
  }
  if (
    profile.revision !== request.expectedProfileRevision ||
    currentProfileRevision !== request.expectedProfileRevision
  ) {
    return Object.freeze({
      status: 'stale_profile',
      expectedProfileRevision: request.expectedProfileRevision,
      draftProfileRevision: profile.revision,
      currentProfileRevision,
    });
  }

  const visibleEntries = visibleInformationEntries(
    entries,
    request.includePrivate,
  ).sort(compareEntries);
  const selection = selectTrialEntries(visibleEntries, request.expectedEntries);
  if (selection.status === 'stale_entries') return selection;

  return Object.freeze({
    status: 'complete',
    profile,
    includePrivate: request.includePrivate,
    visibleEntryCount: visibleEntries.length,
    evaluatedEntryCount: selection.entries.length,
    truncated:
      request.expectedEntries === undefined &&
      visibleEntries.length > selection.entries.length,
    items: Object.freeze(
      selection.entries.map((entry) => trialEntry(entry, profile)),
    ),
  });
}

function visibleInformationEntries(
  entries: readonly Readonly<CurrentInformationEntry>[],
  includePrivate: boolean,
): Readonly<CurrentInformationEntry>[] {
  return entries.filter((entry) => includePrivate || !entry.value.isPrivate);
}

function informationEntryPreferenceFeatures(
  entry: Readonly<CurrentInformationEntry>,
): readonly Readonly<EntryPreferenceFeature>[] {
  const features = new Map<string, EntryPreferenceFeature>();
  for (const keyword of entry.value.contentKeywords) {
    addFeature(features, {
      featureKind: 'content_keyword',
      featureIdentity: normalizeEntryPreferenceFeatureIdentity(
        keyword.normalizedValue,
      ),
      displayValue: keyword.displayValue,
    });
  }
  if (entry.value.typeKeyword !== undefined) {
    addFeature(features, {
      featureKind: 'type',
      featureIdentity: fixedOrCustomIdentity(
        entry.value.typeKeyword,
        entry.value.typeCustomName,
      ),
      displayValue:
        entry.value.typeKeyword === 'other'
          ? (entry.value.typeCustomName ?? entry.value.typeKeyword)
          : entry.value.typeKeyword,
    });
  }
  for (const domain of entry.value.domains) {
    addFeature(features, {
      featureKind: 'domain',
      featureIdentity: fixedOrCustomIdentity(domain.keyword, domain.customName),
      displayValue:
        domain.keyword === 'other'
          ? (domain.customName ?? domain.keyword)
          : domain.keyword,
    });
  }
  return Object.freeze(
    [...features.values()].map((feature) => Object.freeze(feature)),
  );
}

function addFeature(
  features: Map<string, EntryPreferenceFeature>,
  feature: Readonly<EntryPreferenceFeature>,
): void {
  if (feature.featureIdentity.length === 0) return;
  const key = `${feature.featureKind}\u0000${feature.featureIdentity}`;
  const current = features.get(key);
  if (
    current === undefined ||
    compareUnsignedUtf8(feature.displayValue, current.displayValue) < 0
  ) {
    features.set(key, {...feature});
  }
}

function fixedOrCustomIdentity(keyword: string, customName?: string): string {
  return keyword === 'other' && customName !== undefined
    ? `other:${normalizeEntryPreferenceFeatureIdentity(customName)}`
    : normalizeEntryPreferenceFeatureIdentity(keyword);
}

function observationSide(
  score: CurrentInformationEntry['value']['usefulnessScore'],
): ObservationSide | undefined {
  if (score === undefined) return undefined;
  if (score >= 4) return 'positive';
  if (score <= 2) return 'negative';
  return 'neutral';
}

function aggregateKey(
  dimension: EntryPreferenceDimension,
  feature: Readonly<EntryPreferenceFeature>,
): string {
  return [dimension, feature.featureKind, feature.featureIdentity].join(
    '\u0000',
  );
}

function toSuggestion(
  aggregate: Readonly<MutableSuggestionAggregate>,
): Readonly<InformationEntryPreferenceSuggestion> | undefined {
  const positiveEntryIds = sortedIds(aggregate.positiveEntryIds);
  const neutralEntryIds = sortedIds(aggregate.neutralEntryIds);
  const negativeEntryIds = sortedIds(aggregate.negativeEntryIds);
  const observationCount =
    positiveEntryIds.length + neutralEntryIds.length + negativeEntryIds.length;
  const difference = positiveEntryIds.length - negativeEntryIds.length;
  if (observationCount < 3 || Math.abs(difference) < 2) return undefined;
  const displayValue = [...aggregate.displays].sort(compareUnsignedUtf8)[0];
  if (displayValue === undefined) return undefined;
  return Object.freeze({
    dimension: aggregate.dimension,
    featureKind: aggregate.featureKind,
    featureIdentity: aggregate.featureIdentity,
    displayValue,
    effect: difference > 0 ? 'prefer' : 'deprioritize',
    suggestedWeight: Math.min(
      5,
      Math.abs(difference),
    ) as EntryPreferenceRule['weight'],
    positiveCount: positiveEntryIds.length,
    neutralCount: neutralEntryIds.length,
    negativeCount: negativeEntryIds.length,
    positiveEntryIds,
    neutralEntryIds,
    negativeEntryIds,
  });
}

function compareSuggestions(
  left: Readonly<InformationEntryPreferenceSuggestion>,
  right: Readonly<InformationEntryPreferenceSuggestion>,
): number {
  const dimension =
    ENTRY_PREFERENCE_DIMENSIONS.indexOf(left.dimension) -
    ENTRY_PREFERENCE_DIMENSIONS.indexOf(right.dimension);
  if (dimension !== 0) return dimension;
  const featureKind =
    ENTRY_PREFERENCE_FEATURE_KINDS.indexOf(left.featureKind) -
    ENTRY_PREFERENCE_FEATURE_KINDS.indexOf(right.featureKind);
  return featureKind !== 0
    ? featureKind
    : compareUnsignedUtf8(left.featureIdentity, right.featureIdentity);
}

function sortedIds(values: ReadonlySet<string>): readonly string[] {
  return Object.freeze([...values].sort(compareUnsignedUtf8));
}

function compareUnsignedUtf8(left: string, right: string): number {
  const leftBytes = textEncoder.encode(left);
  const rightBytes = textEncoder.encode(right);
  const length = Math.min(leftBytes.length, rightBytes.length);
  for (let index = 0; index < length; index += 1) {
    const leftByte = leftBytes[index] ?? 0;
    const rightByte = rightBytes[index] ?? 0;
    if (leftByte !== rightByte) return leftByte - rightByte;
  }
  return leftBytes.length - rightBytes.length;
}

function isNonNegativeSafeInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

function isValidExpectedEntries(
  entries:
    | readonly Readonly<InformationEntryPreferenceTrialExpectedEntry>[]
    | undefined,
): boolean {
  if (entries === undefined) return true;
  if (entries.length > MAXIMUM_INFORMATION_ENTRY_PREFERENCE_TRIAL_ENTRIES) {
    return false;
  }
  const identities = new Set<string>();
  for (const entry of entries) {
    if (
      !CANONICAL_UUID.test(entry.entryId) ||
      !Number.isSafeInteger(entry.revision) ||
      entry.revision < 1 ||
      identities.has(entry.entryId)
    ) {
      return false;
    }
    identities.add(entry.entryId);
  }
  return true;
}

function selectTrialEntries(
  visibleEntries: readonly Readonly<CurrentInformationEntry>[],
  expectedEntries:
    | readonly Readonly<InformationEntryPreferenceTrialExpectedEntry>[]
    | undefined,
):
  | Readonly<{
      status: 'selected';
      entries: readonly Readonly<CurrentInformationEntry>[];
    }>
  | Readonly<{
      status: 'stale_entries';
      entries: readonly Readonly<InformationEntryPreferenceStaleEntry>[];
    }> {
  if (expectedEntries === undefined) {
    return Object.freeze({
      status: 'selected',
      entries: Object.freeze(
        visibleEntries.slice(
          0,
          MAXIMUM_INFORMATION_ENTRY_PREFERENCE_TRIAL_ENTRIES,
        ),
      ),
    });
  }
  const currentById = new Map(
    visibleEntries.map((entry) => [entry.entryId, entry]),
  );
  const staleEntries: Readonly<InformationEntryPreferenceStaleEntry>[] = [];
  const selectedEntries: Readonly<CurrentInformationEntry>[] = [];
  for (const expected of [...expectedEntries].sort((left, right) =>
    compareUnsignedUtf8(left.entryId, right.entryId),
  )) {
    const current = currentById.get(expected.entryId);
    if (current?.revision !== expected.revision) {
      staleEntries.push(
        Object.freeze({
          entryId: expected.entryId,
          expectedRevision: expected.revision,
          ...(current === undefined ? {} : {currentRevision: current.revision}),
        }),
      );
    } else {
      selectedEntries.push(current);
    }
  }
  if (staleEntries.length > 0) {
    return Object.freeze({
      status: 'stale_entries',
      entries: Object.freeze(staleEntries),
    });
  }
  return Object.freeze({
    status: 'selected',
    entries: Object.freeze(selectedEntries),
  });
}

function trialEntry(
  entry: Readonly<CurrentInformationEntry>,
  profile: Readonly<EntryPreferenceProfile>,
): Readonly<InformationEntryPreferenceTrialItem> {
  const featureIdentities = new Set(
    informationEntryPreferenceFeatures(entry).map(
      (feature) => `${feature.featureKind}\u0000${feature.featureIdentity}`,
    ),
  );
  const matchedRules: Readonly<InformationEntryPreferenceTrialMatch>[] = [];
  let usefulness = 0;
  let interest = 0;
  for (const rule of profile.rules) {
    if (
      !featureIdentities.has(`${rule.featureKind}\u0000${rule.featureIdentity}`)
    ) {
      continue;
    }
    const signedWeight = rule.effect === 'prefer' ? rule.weight : -rule.weight;
    if (rule.dimension === 'usefulness') usefulness += signedWeight;
    else interest += signedWeight;
    matchedRules.push(
      Object.freeze({
        rule: Object.freeze({...rule}),
        signedWeight,
      }),
    );
  }
  return Object.freeze({
    entryId: entry.entryId,
    revision: entry.revision,
    ...(entry.value.usefulnessScore === undefined
      ? {}
      : {usefulnessScore: entry.value.usefulnessScore}),
    ...(entry.value.interestScore === undefined
      ? {}
      : {interestScore: entry.value.interestScore}),
    matchedRules: Object.freeze(matchedRules),
    totals: Object.freeze({usefulness, interest}),
  });
}

function compareEntries(
  left: Readonly<CurrentInformationEntry>,
  right: Readonly<CurrentInformationEntry>,
): number {
  return compareUnsignedUtf8(left.entryId, right.entryId);
}
