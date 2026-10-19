import type {IntakeRecord} from './document_intake_contract.js';

export interface IntakeEvidenceSummary {
  readonly snapshotId: string;
  readonly isPrivate?: boolean;
  readonly canonicalUri?: string;
  readonly sourceKey?: string;
  readonly capturedAt?: string;
}

/** A model's earlier reason is never relabelled as the owner's explanation. */
export function manualIntakeDecision(record: IntakeRecord) {
  const value = record.value;
  if (value.receiptOrigin === 'manual' && value.receipt === 'rejected')
    return 'reject' as const;
  if (value.origin === 'manual' && value.decision === 'blocked')
    return 'reject' as const;
  if (value.receiptOrigin === 'manual' && value.receipt === 'accepted')
    return 'accept' as const;
  if (value.origin === 'manual' && value.decision === 'admitted')
    return 'accept' as const;
  return undefined;
}

export function intakeSourceId(record: IntakeRecord): string | undefined {
  const origin = record.value.captureOrigin;
  return origin?.kind === 'subscription' ? origin.subscriptionId : undefined;
}

/** Count an article once, even when it has several received/prepared versions. */
export function distinctReviewedDocuments(
  records: readonly IntakeRecord[],
  snapshots: readonly IntakeEvidenceSummary[],
) {
  const evidence = new Map(snapshots.map((s) => [s.snapshotId, s]));
  const latest = new Map<
    string,
    {record: IntakeRecord; source: IntakeEvidenceSummary}
  >();
  for (const record of records) {
    const source = evidence.get(record.snapshotId);
    if (!source || source.isPrivate) continue;
    const key =
      (intakeSourceId(record) ?? 'upload') +
      ':' +
      (source.canonicalUri ?? source.snapshotId);
    const previous = latest.get(key);
    if (
      !previous ||
      (source.capturedAt ?? record.updatedAt) >
        (previous.source.capturedAt ?? previous.record.updatedAt) ||
      ((source.capturedAt ?? record.updatedAt) ===
        (previous.source.capturedAt ?? previous.record.updatedAt) &&
        record.updatedAt > previous.record.updatedAt)
    ) {
      latest.set(key, {record, source});
    }
  }
  return [...latest.values()].sort(
    (a, b) =>
      b.record.updatedAt.localeCompare(a.record.updatedAt) ||
      a.record.snapshotId.localeCompare(b.record.snapshotId),
  );
}

export function selectManualIntakeExamples(
  records: readonly IntakeRecord[],
  snapshots: readonly IntakeEvidenceSummary[],
  target: IntakeRecord | undefined,
  targetId: string,
) {
  const evidence = new Map(snapshots.map((s) => [s.snapshotId, s]));
  const targetUri = evidence.get(targetId)?.canonicalUri;
  const ranked = distinctReviewedDocuments(
    records.filter((r) => manualIntakeDecision(r)),
    snapshots,
  )
    .filter(
      ({record, source}) =>
        record.snapshotId !== targetId &&
        (!targetUri || source.canonicalUri !== targetUri) &&
        manualIntakeDecision(record),
    )
    .sort(
      (a, b) =>
        Number(
          intakeSourceId(b.record) === (target && intakeSourceId(target)),
        ) -
          Number(
            intakeSourceId(a.record) === (target && intakeSourceId(target)),
          ) || b.record.updatedAt.localeCompare(a.record.updatedAt),
    );
  // Keep both sides of the owner's decisions in view when both are available.
  const accepted = ranked
    .filter(({record}) => manualIntakeDecision(record) === 'accept')
    .slice(0, 4);
  const rejected = ranked
    .filter(({record}) => manualIntakeDecision(record) === 'reject')
    .slice(0, 4);
  const selected = [...accepted, ...rejected];
  const chosen = new Set(selected.map(({record}) => record.snapshotId));
  return [
    ...selected,
    ...ranked.filter(({record}) => !chosen.has(record.snapshotId)),
  ].slice(0, 8);
}
