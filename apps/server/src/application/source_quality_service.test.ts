import {afterEach, expect, it} from 'vitest';
import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {SourceQualityService} from './source_quality_service.js';
import {
  manualIntakeDecision,
  selectManualIntakeExamples,
  type IntakeEvidenceSummary,
} from './intake_feedback.js';
import {
  intakeRecordValueSchema,
  type IntakeRecord,
} from './document_intake_contract.js';
import {LocalReviewPreferencesStore} from '../platform/storage/local_review_preferences_store.js';
import {patchReviewPreferences} from '../storage/review_preferences_store.js';
import {requireOperationValue} from './operation_error.js';
const W = '10000000-0000-4000-8000-000000000001',
  SOURCE = '10000000-0000-4000-8000-000000000002';
const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, {recursive: true, force: true});
});
function review(
  n: number,
  outcome: 'accept' | 'reject' | 'hold' | 'capture' = 'reject',
): IntakeRecord {
  return {
    snapshotId: '20000000-0000-4000-8000-' + String(n).padStart(12, '0'),
    version: 1,
    updatedAt: new Date(Date.UTC(2040, 0, n + 1)).toISOString(),
    value: intakeRecordValueSchema.parse({
      captureOrigin: {kind: 'subscription', subscriptionId: SOURCE},
      decision: outcome === 'accept' ? 'admitted' : 'held',
      origin: outcome === 'capture' ? 'system' : 'model',
      reason:
        outcome === 'capture'
          ? 'Synthetic fetch failure'
          : 'Synthetic earlier AI reason',
      ...(outcome === 'capture'
        ? {}
        : {
            assessment: {
              completeness: outcome === 'accept' ? 'complete' : 'summary',
              contentKind: 'article',
              decision: outcome === 'accept' ? 'admit' : 'hold',
              reason: 'Synthetic prior AI judgement',
            },
          }),
      ...(['accept', 'reject'].includes(outcome)
        ? {
            receipt: outcome === 'accept' ? 'accepted' : 'rejected',
            receiptOrigin: 'manual',
          }
        : {}),
    }),
  };
}
function evidence(record: IntakeRecord): IntakeEvidenceSummary {
  return {
    snapshotId: record.snapshotId,
    canonicalUri: 'https://example.invalid/' + record.snapshotId,
    sourceKey: 'Synthetic document ' + record.snapshotId,
    capturedAt: record.updatedAt,
    isPrivate: false,
  };
}
async function fixture(records: IntakeRecord[]) {
  const root = mkdtempSync(join(tmpdir(), 'struinfo-source-quality-'));
  roots.push(root);
  const preferences = new LocalReviewPreferencesStore(root);
  await preferences.update(W, (current) => ({
    next: patchReviewPreferences(current, {
      sourceSubscriptions: {
        revision: 1,
        subscriptions: [
          {
            kind: 'rss_atom',
            subscriptionId: SOURCE,
            label: 'Synthetic feed',
            enabled: true,
            feedUrl: 'https://example.invalid/feed',
            itemLimit: 20,
            sourceAlias: 'synthetic',
            isPrivate: false,
            intervalMinutes: 60,
          },
        ],
      },
    }),
    result: null,
  }));
  const snapshots = records.map(evidence);
  const service = new SourceQualityService(W, {
    preferences,
    intake: {list: () => Promise.resolve(records)},
    snapshots: () => Promise.resolve(snapshots),
  });
  return {service, preferences, snapshots};
}
it('requires at least five adverse decisions and half the reviewed sample, without automatic suspension', async () => {
  const records = [
    review(1),
    review(2),
    review(3, 'hold'),
    review(4, 'capture'),
    review(5, 'accept'),
  ];
  const f = await fixture(records);
  expect((await f.service.status()).sources[0]?.needsReview).toBe(false);
  records.push(review(6));
  f.snapshots.push(evidence(requireOperationValue(records.at(-1))));
  const source = requireOperationValue((await f.service.status()).sources[0]);
  expect(source).toMatchObject({
    enabled: true,
    needsReview: true,
    manualRejected: 3,
    aiHeld: 1,
    technicalHolds: 1,
    accepted: 1,
  });
  expect(
    (await f.preferences.load(W)).sourceSubscriptions?.subscriptions[0]
      ?.enabled,
  ).toBe(true);
  for (let n = 7; n <= 12; n++) {
    const record = review(n, 'accept');
    records.push(record);
    f.snapshots.push(evidence(record));
  }
  expect((await f.service.status()).sources[0]?.needsReview).toBe(false);
});
it('acknowledges the exact samples, survives reload, and asks again only after five new adverse articles', async () => {
  const records = Array.from({length: 8}, (_, i) => review(i + 1));
  const f = await fixture(records);
  const before = await f.service.status(),
    source = requireOperationValue(before.sources[0]);
  const input = {
    subscriptionId: SOURCE,
    expectedRevision: before.revision,
    action: 'keep' as const,
    samples: source.samples.map(({snapshotId, version}) => ({
      snapshotId,
      version,
    })),
  };
  await f.service.control(input);
  expect((await f.service.status()).sources[0]).toMatchObject({
    enabled: true,
    needsReview: false,
  });
  expect(
    (await f.preferences.load(W)).sourceSubscriptions?.subscriptions[0]
      ?.qualityReview?.documentKeys,
  ).toHaveLength(8);
  await expect(f.service.control(input)).rejects.toMatchObject({
    code: 'source_quality_changed',
  });
  for (let n = 9; n <= 12; n++) {
    const r = review(n);
    records.push(r);
    f.snapshots.push(evidence(r));
  }
  expect((await f.service.status()).sources[0]?.needsReview).toBe(false);
  const r = review(13);
  records.push(r);
  f.snapshots.push(evidence(r));
  const current = await f.service.status(),
    next = requireOperationValue(current.sources[0]);
  expect(next.needsReview).toBe(true);
  await f.service.control({
    subscriptionId: SOURCE,
    expectedRevision: current.revision,
    action: 'close',
    samples: next.samples.map(({snapshotId, version}) => ({
      snapshotId,
      version,
    })),
  });
  expect((await f.service.status()).sources[0]).toMatchObject({
    enabled: false,
    needsReview: false,
    reviewed: 13,
  });
  expect(records).toHaveLength(13);
});
it('rejects decisions on changed intake versions and excludes private and duplicate documents', async () => {
  const records = Array.from({length: 6}, (_, i) => review(i + 1));
  const f = await fixture(records);
  f.snapshots[0] = {...requireOperationValue(f.snapshots[0]), isPrivate: true};
  f.snapshots[1] = {
    ...requireOperationValue(f.snapshots[1]),
    canonicalUri: requireOperationValue(f.snapshots[2]?.canonicalUri),
  };
  const current = await f.service.status(),
    source = requireOperationValue(current.sources[0]);
  expect(source.reviewed).toBe(4);
  expect(source.needsReview).toBe(false);
  records[5] = {...requireOperationValue(records[5]), version: 2};
  await expect(
    f.service.control({
      subscriptionId: SOURCE,
      expectedRevision: current.revision,
      action: 'keep',
      samples: source.samples.map(({snapshotId, version}) => ({
        snapshotId,
        version,
      })),
    }),
  ).rejects.toMatchObject({code: 'source_quality_changed'});
});
it('bounds manual examples, includes accepts and rejects, and excludes the target and private evidence', () => {
  const records = Array.from({length: 20}, (_, i) =>
    review(i + 1, i % 2 ? 'accept' : 'reject'),
  );
  const snapshots = records.map(evidence);
  snapshots[19] = {...requireOperationValue(snapshots[19]), isPrivate: true};
  const selected = selectManualIntakeExamples(
    records,
    snapshots,
    records[0],
    requireOperationValue(records[0]).snapshotId,
  );
  expect(selected).toHaveLength(8);
  expect(
    selected.filter(({record}) => manualIntakeDecision(record) === 'accept'),
  ).toHaveLength(4);
  expect(
    selected.filter(({record}) => manualIntakeDecision(record) === 'reject'),
  ).toHaveLength(4);
  expect(
    selected.some(({record}) =>
      [records[0]?.snapshotId, records[19]?.snapshotId].includes(
        record.snapshotId,
      ),
    ),
  ).toBe(false);
  const corrected = review(21, 'accept');
  corrected.value.assessment = {
    completeness: 'summary',
    contentKind: 'article',
    decision: 'hold',
    reason: 'Old model judgement',
  };
  expect(manualIntakeDecision(corrected)).toBe('accept');
});
