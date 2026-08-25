import type {
  EntryPreferenceDimension,
  EntryPreferenceEffect,
  EntryPreferenceFeatureKind,
  EntryPreferenceProfile,
  EntryPreferenceRule,
} from '../../storage/review_preferences_store.js';

export const MAXIMUM_INFORMATION_ENTRY_PREFERENCE_SUGGESTIONS = 64;
export const MAXIMUM_INFORMATION_ENTRY_PREFERENCE_TRIAL_ENTRIES = 100;

export interface InformationEntryPreferenceSuggestionRequest {
  readonly includePrivate: boolean;
}

export interface InformationEntryPreferenceSuggestion {
  readonly dimension: EntryPreferenceDimension;
  readonly featureKind: EntryPreferenceFeatureKind;
  readonly featureIdentity: string;
  readonly displayValue: string;
  readonly effect: EntryPreferenceEffect;
  readonly suggestedWeight: EntryPreferenceRule['weight'];
  readonly positiveCount: number;
  readonly neutralCount: number;
  readonly negativeCount: number;
  readonly positiveEntryIds: readonly string[];
  readonly neutralEntryIds: readonly string[];
  readonly negativeEntryIds: readonly string[];
}

export interface InformationEntryPreferenceSuggestionResult {
  readonly includePrivate: boolean;
  readonly visibleEntryCount: number;
  readonly totalCandidateCount: number;
  readonly truncated: boolean;
  readonly candidates: readonly Readonly<InformationEntryPreferenceSuggestion>[];
}

export interface InformationEntryPreferenceTrialExpectedEntry {
  readonly entryId: string;
  readonly revision: number;
}

export interface InformationEntryPreferenceTrialRequest {
  readonly includePrivate: boolean;
  readonly expectedProfileRevision: number;
  /**
   * When present, the trial evaluates exactly this previously observed set and
   * reports any missing or changed revision instead of substituting current
   * state. When absent, it evaluates the first bounded current visible set.
   */
  readonly expectedEntries?: readonly Readonly<InformationEntryPreferenceTrialExpectedEntry>[];
}

export interface InformationEntryPreferenceTrialMatch {
  readonly rule: Readonly<EntryPreferenceRule>;
  readonly signedWeight: number;
}

export interface InformationEntryPreferenceTrialItem {
  readonly entryId: string;
  readonly revision: number;
  readonly usefulnessScore?: 1 | 2 | 3 | 4 | 5;
  readonly interestScore?: 1 | 2 | 3 | 4 | 5;
  readonly matchedRules: readonly Readonly<InformationEntryPreferenceTrialMatch>[];
  readonly totals: Readonly<{
    usefulness: number;
    interest: number;
  }>;
}

export interface InformationEntryPreferenceStaleEntry {
  readonly entryId: string;
  readonly expectedRevision: number;
  readonly currentRevision?: number;
}

export type InformationEntryPreferenceTrialResult =
  | Readonly<{status: 'invalid_profile'}>
  | Readonly<{status: 'invalid_request'}>
  | Readonly<{
      status: 'stale_profile';
      expectedProfileRevision: number;
      draftProfileRevision: number;
      currentProfileRevision: number;
    }>
  | Readonly<{
      status: 'stale_entries';
      entries: readonly Readonly<InformationEntryPreferenceStaleEntry>[];
    }>
  | Readonly<{
      status: 'complete';
      profile: Readonly<EntryPreferenceProfile>;
      includePrivate: boolean;
      visibleEntryCount: number;
      evaluatedEntryCount: number;
      truncated: boolean;
      items: readonly Readonly<InformationEntryPreferenceTrialItem>[];
    }>;
