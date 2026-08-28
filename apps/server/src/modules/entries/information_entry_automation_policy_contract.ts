import type {
  EntryAutomationPolicy,
  EntryPreferenceProfile,
} from '../../storage/review_preferences_store.js';
import type {
  InformationEntryPreferenceStaleEntry,
  InformationEntryPreferenceTrialExpectedEntry,
  InformationEntryPreferenceTrialMatch,
} from './information_entry_preference_profile_contract.js';

export const INFORMATION_ENTRY_AUTOMATION_ROUTES = [
  'advance_candidate',
  'manual_review',
  'defer_candidate',
] as const;

export const INFORMATION_ENTRY_AUTOMATION_REASONS = [
  'advance_threshold_met',
  'defer_threshold_met',
  'threshold_not_met',
  'insufficient_profile_evidence',
  'mixed_signals',
  'manual_takeover',
  'run_budget_exhausted',
  'advance_budget_exhausted',
  'defer_budget_exhausted',
] as const;

export type InformationEntryAutomationRoute =
  (typeof INFORMATION_ENTRY_AUTOMATION_ROUTES)[number];
export type InformationEntryAutomationReason =
  (typeof INFORMATION_ENTRY_AUTOMATION_REASONS)[number];
export type InformationEntryAutomationSignal = 'advance' | 'defer' | 'neutral';
export type InformationEntryAutomationActivation =
  | 'disabled'
  | 'paused'
  | 'profile_disabled'
  | 'profile_revision_mismatch'
  | 'ready';

export interface InformationEntryAutomationTrialRequest {
  readonly includePrivate: boolean;
  readonly expectedPolicyRevision: number;
  readonly expectedProfileRevision: number;
  readonly expectedEntries?: readonly Readonly<InformationEntryPreferenceTrialExpectedEntry>[];
  readonly manualTakeoverEntryIds?: readonly string[];
}

export interface InformationEntryAutomationTrialItem {
  readonly entryId: string;
  readonly revision: number;
  readonly usefulnessScore?: 1 | 2 | 3 | 4 | 5;
  readonly interestScore?: 1 | 2 | 3 | 4 | 5;
  readonly matchedRules: readonly Readonly<InformationEntryPreferenceTrialMatch>[];
  readonly totals: Readonly<{
    usefulness: number;
    interest: number;
  }>;
  readonly signals: Readonly<{
    usefulness: InformationEntryAutomationSignal;
    interest: InformationEntryAutomationSignal;
  }>;
  readonly route: InformationEntryAutomationRoute;
  readonly reason: InformationEntryAutomationReason;
}

export type InformationEntryAutomationTrialResult =
  | Readonly<{status: 'invalid_policy'}>
  | Readonly<{status: 'invalid_profile'}>
  | Readonly<{status: 'invalid_request'}>
  | Readonly<{
      status: 'stale_policy';
      expectedPolicyRevision: number;
      draftPolicyRevision: number;
      currentPolicyRevision: number;
    }>
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
      dryRunOnly: true;
      activation: InformationEntryAutomationActivation;
      includePrivate: boolean;
      visibleEntryCount: number;
      evaluatedEntryCount: number;
      truncated: boolean;
      policy: Readonly<EntryAutomationPolicy>;
      profile: Readonly<EntryPreferenceProfile>;
      counts: Readonly<Record<InformationEntryAutomationRoute, number>>;
      items: readonly Readonly<InformationEntryAutomationTrialItem>[];
    }>;
