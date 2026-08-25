import {informationEntrySearchKey} from './information_entry.js';
import {listInformationEntryAssociations} from './information_entry_association.js';
import type {InformationEntryAssociationRepositorySnapshot} from './information_entry_association_contract.js';
import type {CurrentInformationEntry} from './information_entry_contract.js';
import {
  INFORMATION_ENTRY_EXPLORATION_REASONS,
  type InformationEntryExplorationCandidate,
  type InformationEntryExplorationPolicy,
  type InformationEntryExplorationReason,
  type InformationEntryExplorationRequest,
  type InformationEntryExplorationResult,
} from './information_entry_exploration_contract.js';

export const INFORMATION_ENTRY_EXPLORATION_MAXIMUM_CANDIDATES = 12;

export function exploreCurrentInformationEntries(
  entries: readonly Readonly<CurrentInformationEntry>[],
  associationSnapshot: Readonly<InformationEntryAssociationRepositorySnapshot>,
  request: Readonly<InformationEntryExplorationRequest>,
  policy: Readonly<InformationEntryExplorationPolicy>,
): Readonly<InformationEntryExplorationResult> | undefined {
  const visibleEntries = entries.filter((entry) =>
    request.onlyPrivate
      ? entry.value.isPrivate
      : request.includePrivate || !entry.value.isPrivate,
  );
  const anchor = visibleEntries.find(
    (entry) => entry.entryId === request.anchorEntryId,
  );
  if (anchor === undefined) return undefined;
  const candidateLimit = explorationCandidateLimit(
    request.pageResultCount,
    policy,
  );
  if (candidateLimit === 0) {
    return freezeResult(policy, request.anchorEntryId, 0, 0, []);
  }

  const excluded = new Set([request.anchorEntryId, ...request.excludeEntryIds]);
  const buckets = new Map<
    InformationEntryExplorationReason,
    InformationEntryExplorationCandidate[]
  >(INFORMATION_ENTRY_EXPLORATION_REASONS.map((reason) => [reason, []]));
  for (const association of listInformationEntryAssociations(
    anchor.entryId,
    visibleEntries,
    associationSnapshot,
  )) {
    if (
      association.isBlocked ||
      excluded.has(association.relatedEntry.entryId)
    ) {
      continue;
    }
    const reason = explorationReason(anchor, association);
    if (!reasonIsEnabled(reason, policy)) continue;
    buckets.get(reason)?.push(
      Object.freeze({
        entry: association.relatedEntry,
        reason,
        effectiveScore: association.effectiveScore,
        candidateBasis: Object.freeze([
          ...(association.projection?.candidateBasis ?? []),
        ]),
        ...(association.override === undefined
          ? {}
          : {manualAction: association.override.value.action}),
        differentSnapshot:
          anchor.snapshotId !== association.relatedEntry.snapshotId,
      }),
    );
  }
  for (const bucket of buckets.values()) {
    bucket.sort((left, right) =>
      left.effectiveScore !== right.effectiveScore
        ? right.effectiveScore - left.effectiveScore
        : left.entry.entryId.localeCompare(right.entry.entryId),
    );
  }
  const totalEligibleCount = [...buckets.values()].reduce(
    (total, bucket) => total + bucket.length,
    0,
  );
  const items = takeRoundRobin(buckets, candidateLimit);
  return freezeResult(
    policy,
    request.anchorEntryId,
    candidateLimit,
    totalEligibleCount,
    items,
  );
}

export function explorationCandidateLimit(
  pageResultCount: number,
  policy: Readonly<InformationEntryExplorationPolicy>,
): number {
  if (!policy.enabled || policy.resultShare === 0 || pageResultCount === 0) {
    return 0;
  }
  return Math.min(
    INFORMATION_ENTRY_EXPLORATION_MAXIMUM_CANDIDATES,
    Math.ceil((pageResultCount * policy.resultShare) / 100),
  );
}

function explorationReason(
  anchor: Readonly<CurrentInformationEntry>,
  association: ReturnType<typeof listInformationEntryAssociations>[number],
): InformationEntryExplorationReason {
  const anchorDomain = primaryDomainIdentity(anchor);
  const relatedDomain = primaryDomainIdentity(association.relatedEntry);
  if (
    anchorDomain !== undefined &&
    relatedDomain !== undefined &&
    anchorDomain !== relatedDomain
  ) {
    return 'cross_domain';
  }
  if (
    anchor.snapshotId !== association.relatedEntry.snapshotId &&
    association.projection?.contentSimilarity === 0 &&
    association.projection.candidateBasis.includes('text_term')
  ) {
    return 'serendipity';
  }
  return 'neighbor_expansion';
}

function primaryDomainIdentity(
  entry: Readonly<CurrentInformationEntry>,
): string | undefined {
  const domain = entry.value.domains[0];
  if (domain === undefined) return undefined;
  return domain.keyword === 'other'
    ? domain.customName === undefined
      ? undefined
      : `other:${informationEntrySearchKey(domain.customName)}`
    : domain.keyword;
}

function reasonIsEnabled(
  reason: InformationEntryExplorationReason,
  policy: Readonly<InformationEntryExplorationPolicy>,
): boolean {
  switch (reason) {
    case 'neighbor_expansion':
      return policy.neighborExpansion;
    case 'cross_domain':
      return policy.crossDomain;
    case 'serendipity':
      return policy.serendipity;
  }
}

function takeRoundRobin(
  buckets: ReadonlyMap<
    InformationEntryExplorationReason,
    readonly Readonly<InformationEntryExplorationCandidate>[]
  >,
  limit: number,
): readonly Readonly<InformationEntryExplorationCandidate>[] {
  const offsets = new Map<InformationEntryExplorationReason, number>();
  const result: Readonly<InformationEntryExplorationCandidate>[] = [];
  while (result.length < limit) {
    let added = false;
    for (const reason of INFORMATION_ENTRY_EXPLORATION_REASONS) {
      const offset = offsets.get(reason) ?? 0;
      const candidate = buckets.get(reason)?.[offset];
      if (candidate === undefined) continue;
      result.push(candidate);
      offsets.set(reason, offset + 1);
      added = true;
      if (result.length >= limit) break;
    }
    if (!added) break;
  }
  return Object.freeze(result);
}

function freezeResult(
  policy: Readonly<InformationEntryExplorationPolicy>,
  anchorEntryId: string,
  candidateLimit: number,
  totalEligibleCount: number,
  items: readonly Readonly<InformationEntryExplorationCandidate>[],
): Readonly<InformationEntryExplorationResult> {
  return Object.freeze({
    policy: Object.freeze({...policy}),
    anchorEntryId,
    candidateLimit,
    totalEligibleCount,
    items: Object.freeze([...items]),
  });
}
