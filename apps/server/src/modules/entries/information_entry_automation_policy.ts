import {
  decodeEntryAutomationPolicy,
  type EntryAutomationPolicy,
} from '../../storage/review_preferences_store.js';
import type {CurrentInformationEntry} from './information_entry_contract.js';
import {
  type InformationEntryAutomationActivation,
  type InformationEntryAutomationReason,
  type InformationEntryAutomationRoute,
  type InformationEntryAutomationSignal,
  type InformationEntryAutomationTrialItem,
  type InformationEntryAutomationTrialRequest,
  type InformationEntryAutomationTrialResult,
} from './information_entry_automation_policy_contract.js';
import {trialInformationEntryPreferenceProfile} from './information_entry_preference_profile.js';
import type {InformationEntryPreferenceTrialItem} from './information_entry_preference_profile_contract.js';

const CANONICAL_UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;

export function trialInformationEntryAutomationPolicy(
  entries: readonly Readonly<CurrentInformationEntry>[],
  currentPolicyRevision: number,
  currentProfileRevision: number,
  policyInput: unknown,
  profileInput: unknown,
  request: Readonly<InformationEntryAutomationTrialRequest>,
): Readonly<InformationEntryAutomationTrialResult> {
  const policy = decodeEntryAutomationPolicy(policyInput);
  if (policy === undefined) return Object.freeze({status: 'invalid_policy'});
  if (
    !isNonNegativeSafeInteger(currentPolicyRevision) ||
    !isNonNegativeSafeInteger(currentProfileRevision) ||
    !isNonNegativeSafeInteger(request.expectedPolicyRevision) ||
    !isNonNegativeSafeInteger(request.expectedProfileRevision)
  ) {
    return Object.freeze({status: 'invalid_request'});
  }
  const manualTakeoverEntryIds = decodeManualTakeoverEntryIds(
    request.manualTakeoverEntryIds,
  );
  if (manualTakeoverEntryIds === undefined) {
    return Object.freeze({status: 'invalid_request'});
  }
  if (
    policy.revision !== request.expectedPolicyRevision ||
    currentPolicyRevision !== request.expectedPolicyRevision
  ) {
    return Object.freeze({
      status: 'stale_policy',
      expectedPolicyRevision: request.expectedPolicyRevision,
      draftPolicyRevision: policy.revision,
      currentPolicyRevision,
    });
  }

  const profileTrial = trialInformationEntryPreferenceProfile(
    entries,
    currentProfileRevision,
    profileInput,
    {
      includePrivate: request.includePrivate,
      expectedProfileRevision: request.expectedProfileRevision,
      ...(request.expectedEntries === undefined
        ? {}
        : {expectedEntries: request.expectedEntries}),
    },
  );
  if (profileTrial.status !== 'complete') return profileTrial;
  const evaluatedEntryIds = new Set(
    profileTrial.items.map((item) => item.entryId),
  );
  if (
    manualTakeoverEntryIds.some((entryId) => !evaluatedEntryIds.has(entryId))
  ) {
    return Object.freeze({status: 'invalid_request'});
  }

  const items = routeItems(
    profileTrial.items,
    policy,
    new Set(manualTakeoverEntryIds),
  );
  return Object.freeze({
    status: 'complete',
    dryRunOnly: true,
    activation: activationFor(policy, profileTrial.profile),
    includePrivate: profileTrial.includePrivate,
    visibleEntryCount: profileTrial.visibleEntryCount,
    evaluatedEntryCount: profileTrial.evaluatedEntryCount,
    truncated: profileTrial.truncated,
    policy,
    profile: profileTrial.profile,
    counts: Object.freeze(countRoutes(items)),
    items,
  });
}

function routeItems(
  items: readonly Readonly<InformationEntryPreferenceTrialItem>[],
  policy: Readonly<EntryAutomationPolicy>,
  manualTakeoverEntryIds: ReadonlySet<string>,
): readonly Readonly<InformationEntryAutomationTrialItem>[] {
  let advanceCandidates = 0;
  let deferCandidates = 0;
  return Object.freeze(
    items.map((item, index) => {
      const signals = Object.freeze({
        usefulness: signalForTotal(
          item.totals.usefulness,
          policy.advanceThresholds.usefulness,
          policy.deferThresholds.usefulness,
        ),
        interest: signalForTotal(
          item.totals.interest,
          policy.advanceThresholds.interest,
          policy.deferThresholds.interest,
        ),
      });
      let decision: Readonly<{
        route: InformationEntryAutomationRoute;
        reason: InformationEntryAutomationReason;
      }>;
      if (manualTakeoverEntryIds.has(item.entryId)) {
        decision = manualDecision('manual_takeover');
      } else if (index >= policy.budgets.maximumEntriesPerRun) {
        decision = manualDecision('run_budget_exhausted');
      } else {
        decision = thresholdDecision(item, signals, policy);
      }
      if (decision.route === 'advance_candidate') {
        if (
          advanceCandidates >= policy.budgets.maximumAdvanceCandidatesPerRun
        ) {
          decision = manualDecision('advance_budget_exhausted');
        } else {
          advanceCandidates += 1;
        }
      } else if (decision.route === 'defer_candidate') {
        if (deferCandidates >= policy.budgets.maximumDeferCandidatesPerRun) {
          decision = manualDecision('defer_budget_exhausted');
        } else {
          deferCandidates += 1;
        }
      }
      return Object.freeze({
        entryId: item.entryId,
        revision: item.revision,
        ...(item.usefulnessScore === undefined
          ? {}
          : {usefulnessScore: item.usefulnessScore}),
        ...(item.interestScore === undefined
          ? {}
          : {interestScore: item.interestScore}),
        matchedRules: item.matchedRules,
        totals: item.totals,
        signals,
        ...decision,
      });
    }),
  );
}

function thresholdDecision(
  item: Readonly<InformationEntryPreferenceTrialItem>,
  signals: Readonly<{
    usefulness: InformationEntryAutomationSignal;
    interest: InformationEntryAutomationSignal;
  }>,
  policy: Readonly<EntryAutomationPolicy>,
): Readonly<{
  route: InformationEntryAutomationRoute;
  reason: InformationEntryAutomationReason;
}> {
  if (item.matchedRules.length < policy.minimumMatchedRuleCount) {
    return manualDecision('insufficient_profile_evidence');
  }
  const values = [signals.usefulness, signals.interest];
  const advanceDimensions = values.filter(
    (signal) => signal === 'advance',
  ).length;
  const deferDimensions = values.filter((signal) => signal === 'defer').length;
  if (advanceDimensions > 0 && deferDimensions > 0) {
    return manualDecision('mixed_signals');
  }
  if (advanceDimensions >= policy.advanceThresholds.requiredDimensions) {
    return Object.freeze({
      route: 'advance_candidate',
      reason: 'advance_threshold_met',
    });
  }
  if (deferDimensions >= policy.deferThresholds.requiredDimensions) {
    return Object.freeze({
      route: 'defer_candidate',
      reason: 'defer_threshold_met',
    });
  }
  return manualDecision('threshold_not_met');
}

function signalForTotal(
  total: number,
  advanceThreshold: number,
  deferThreshold: number,
): InformationEntryAutomationSignal {
  if (total >= advanceThreshold) return 'advance';
  if (total <= -deferThreshold) return 'defer';
  return 'neutral';
}

function manualDecision(reason: InformationEntryAutomationReason): Readonly<{
  route: 'manual_review';
  reason: InformationEntryAutomationReason;
}> {
  return Object.freeze({route: 'manual_review', reason});
}

function activationFor(
  policy: Readonly<EntryAutomationPolicy>,
  profile: Readonly<{revision: number; enabled: boolean}>,
): InformationEntryAutomationActivation {
  if (!policy.enabled) return 'disabled';
  if (policy.paused) return 'paused';
  if (!profile.enabled) return 'profile_disabled';
  if (policy.profileRevision !== profile.revision) {
    return 'profile_revision_mismatch';
  }
  return 'ready';
}

function countRoutes(
  items: readonly Readonly<InformationEntryAutomationTrialItem>[],
): Record<InformationEntryAutomationRoute, number> {
  const counts: Record<InformationEntryAutomationRoute, number> = {
    advance_candidate: 0,
    manual_review: 0,
    defer_candidate: 0,
  };
  for (const item of items) counts[item.route] += 1;
  return counts;
}

function decodeManualTakeoverEntryIds(
  value: readonly string[] | undefined,
): readonly string[] | undefined {
  if (value === undefined) return Object.freeze([]);
  if (value.length > 100) return undefined;
  const identities = new Set<string>();
  for (const entryId of value) {
    if (!CANONICAL_UUID.test(entryId) || identities.has(entryId)) {
      return undefined;
    }
    identities.add(entryId);
  }
  return Object.freeze([...value]);
}

function isNonNegativeSafeInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}
