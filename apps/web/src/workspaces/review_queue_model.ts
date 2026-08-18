import type {
  CurationState,
  EvidenceFragment,
  EvidenceSnapshot,
  EvidenceSnapshotSummary,
  IntakeAction,
} from '../api/m1c_api_contract.js';

export interface ReviewTargetOption {
  readonly key: string;
  readonly kind: 'snapshot' | 'fragment';
  readonly id: string;
  readonly label: string;
  readonly snapshotId?: string;
  readonly fragment?: Readonly<EvidenceFragment>;
}

export interface ReviewQueueCandidate extends ReviewTargetOption {
  readonly kind: 'fragment';
  readonly snapshotId: string;
  readonly fragment: Readonly<EvidenceFragment>;
  readonly reviewed: boolean;
  readonly action?: IntakeAction;
}

export function createReviewTargetOptions(
  snapshots: readonly Readonly<EvidenceSnapshotSummary>[],
  evidence?: Readonly<EvidenceSnapshot>,
): readonly Readonly<ReviewTargetOption>[] {
  const result: ReviewTargetOption[] = snapshots.map((snapshot) => ({
    key: `snapshot:${snapshot.snapshotId}`,
    kind: 'snapshot',
    id: snapshot.snapshotId,
    label: `Snapshot · ${snapshot.sourceKey}`,
    snapshotId: snapshot.snapshotId,
  }));
  if (evidence !== undefined) {
    let ordinal = 0;
    for (const structure of evidence.structures) {
      for (const fragment of structure.fragments) {
        ordinal += 1;
        result.push({
          key: `fragment:${fragment.fragmentId}`,
          kind: 'fragment',
          id: fragment.fragmentId,
          label: `Fragment ${ordinal.toString()} · ${compactExcerpt(fragment.selectedText)}`,
          snapshotId: evidence.snapshotId,
          fragment,
        });
      }
    }
  }
  return Object.freeze(result);
}

export function createReviewQueueCandidates(
  targetOptions: readonly Readonly<ReviewTargetOption>[],
  state: Readonly<CurationState>,
): readonly Readonly<ReviewQueueCandidate>[] {
  return Object.freeze(
    targetOptions.flatMap((option): ReviewQueueCandidate[] => {
      // The accepted Markdown profile persists section Fragments only for
      // profile-declared intake targets. Leaf/document Fragments remain
      // available as evidence but do not inflate the manual review queue.
      if (
        option.kind !== 'fragment' ||
        option.fragment?.nodeKind !== 'section' ||
        option.snapshotId === undefined
      ) {
        return [];
      }
      const target = state.targets.find(
        (candidate) =>
          candidate.kind === 'fragment' && candidate.fragmentId === option.id,
      );
      const decision =
        target === undefined
          ? undefined
          : state.decisions.find(
              (candidate) => candidate.targetId === target.targetId,
            );
      return [
        {
          ...option,
          kind: 'fragment',
          snapshotId: option.snapshotId,
          fragment: option.fragment,
          reviewed: decision !== undefined,
          ...(decision === undefined ? {} : {action: decision.value.action}),
        },
      ];
    }),
  );
}

export function firstPendingReviewKey(
  candidates: readonly Readonly<ReviewQueueCandidate>[],
): string | undefined {
  return (
    candidates.find((candidate) => !candidate.reviewed)?.key ??
    candidates[0]?.key
  );
}

export function nextReviewKey(
  candidates: readonly Readonly<ReviewQueueCandidate>[],
  currentKey: string,
): string | undefined {
  const currentIndex = candidates.findIndex(
    (candidate) => candidate.key === currentKey,
  );
  const after = candidates
    .slice(Math.max(0, currentIndex + 1))
    .find((candidate) => !candidate.reviewed);
  const before = candidates
    .slice(0, Math.max(0, currentIndex))
    .find((candidate) => !candidate.reviewed);
  return after?.key ?? before?.key ?? candidates[currentIndex + 1]?.key;
}

function compactExcerpt(value: string): string {
  const normalized = value.replace(/\s+/gu, ' ').trim();
  return normalized.length <= 52 ? normalized : `${normalized.slice(0, 52)}…`;
}
