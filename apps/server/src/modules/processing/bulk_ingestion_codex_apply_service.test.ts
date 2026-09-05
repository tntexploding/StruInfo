import {describe, expect, it, vi} from 'vitest';

import {encodeCanonicalJson} from '../../serialization/canonical_json.js';
import {createReviewPreferences} from '../../storage/review_preferences_store.js';
import {
  deriveInformationEntryRevisionId,
  type CurrentInformationEntry,
  type InformationEntryAssociationIncrementalRepositoryPort,
  type InformationEntryBulkRevisionRepositoryPort,
  type InformationEntryRepositoryPort,
} from '../entries/index.js';
import type {
  BulkIngestionAdjudicationException,
  DecideExactBulkIngestionAdjudicationRequest,
  DecideBulkIngestionAdjudicationResult,
} from './bulk_ingestion_adjudication_contract.js';
import {
  BulkIngestionCodexApplyService,
  BulkIngestionCodexApplyServiceError,
} from './bulk_ingestion_codex_apply_service.js';
import type {BulkIngestionCodexReviewFileStorePort} from './bulk_ingestion_codex_review_contract.js';
import {BulkIngestionCodexReviewService} from './bulk_ingestion_codex_review_service.js';

const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';
const BATCH_ID = '22222222-2222-4222-8222-222222222222';
const SNAPSHOT_ID = '33333333-3333-4333-8333-333333333333';
const ENTRY_ID = '44444444-4444-4444-8444-444444444444';
const REVISION_ID = deriveInformationEntryRevisionId(ENTRY_ID, 3);

describe('M2-P0F Codex review result application', () => {
  it('applies one annotation and exact adjudication idempotently', async () => {
    const harness = await createHarness();
    harness.setResult({
      action: 'annotate',
      annotation: {
        contentKeywords: ['PostgreSQL', 'Recovery'],
        typeKeyword: 'operating_guideline',
        domains: [{keyword: 'engineering_computing'}],
      },
    });

    await expect(
      harness.service.apply({packetId: harness.packetId}),
    ).resolves.toMatchObject({
      outcome: 'applied',
      itemCount: 1,
      annotatedCount: 1,
      revisedEntryCount: 1,
      adjudicatedCount: 1,
    });
    expect(harness.current().revision).toBe(4);
    expect(
      harness
        .current()
        .value.contentKeywords.map((value) => value.displayValue),
    ).toEqual(['PostgreSQL', 'Recovery']);
    expect(harness.exception().status).toBe('accepted');
    expect(harness.exception().version).toBe(2);

    await expect(
      harness.service.apply({packetId: harness.packetId}),
    ).resolves.toMatchObject({
      outcome: 'unchanged',
      revisedEntryCount: 0,
      adjudicatedCount: 0,
    });
    expect(harness.current().revision).toBe(4);
  });

  it('applies an exact non-mutating disposition without revising Entry', async () => {
    const harness = await createHarness();
    harness.setResult({action: 'manual_review'});

    await expect(
      harness.service.apply({packetId: harness.packetId}),
    ).resolves.toMatchObject({
      outcome: 'applied',
      manualReviewCount: 1,
      revisedEntryCount: 0,
      adjudicatedCount: 1,
    });
    expect(harness.current().revision).toBe(3);
    expect(harness.exception().status).toBe('manual_review');
  });

  it('rejects adjudication when the annotated Entry changes after verification', async () => {
    const harness = await createHarness();
    harness.setResult({
      action: 'annotate',
      annotation: {
        contentKeywords: ['PostgreSQL'],
        typeKeyword: 'operating_guideline',
        domains: [{keyword: 'engineering_computing'}],
      },
    });
    harness.advanceEntryBeforeAdjudication();

    await expect(
      harness.service.apply({packetId: harness.packetId}),
    ).rejects.toEqual(
      new BulkIngestionCodexApplyServiceError('adjudication_stale'),
    );
    expect(harness.current().revision).toBe(5);
    expect(harness.exception().status).toBe('pending');
  });

  it('rejects the placeholder, open fields and stale Entry revisions', async () => {
    const placeholder = await createHarness();
    await expect(
      placeholder.service.apply({packetId: placeholder.packetId}),
    ).rejects.toEqual(new BulkIngestionCodexApplyServiceError('files_invalid'));

    const open = await createHarness();
    open.setRawResult({
      ...open.resultBase(),
      decisions: [
        {
          ...open.decisionIdentity(),
          action: 'accept',
          unknown: true,
        },
      ],
    });
    await expect(open.service.apply({packetId: open.packetId})).rejects.toEqual(
      new BulkIngestionCodexApplyServiceError('files_invalid'),
    );

    const stale = await createHarness();
    stale.setResult({action: 'accept'});
    stale.setCurrent({...stale.current(), revision: 4});
    await expect(
      stale.service.apply({packetId: stale.packetId}),
    ).rejects.toEqual(new BulkIngestionCodexApplyServiceError('packet_stale'));
  });
});

async function createHarness() {
  let current = currentEntry();
  let exceptionValue = adjudicationException(current);
  let packetBytes: Uint8Array | undefined;
  let resultBytes: Uint8Array | undefined;
  let packetId = '';
  let packetSha256 = '';
  let beforeAdjudication: (() => void) | undefined;
  const fileStore: BulkIngestionCodexReviewFileStorePort = {
    writePackage(input) {
      packetBytes ??= Uint8Array.from(input.packetBytes);
      resultBytes ??= Uint8Array.from(input.resultTemplateBytes);
      const packet = JSON.parse(new TextDecoder().decode(packetBytes)) as {
        packetId: string;
        packetSha256: string;
      };
      packetId = packet.packetId;
      packetSha256 = packet.packetSha256;
      return Promise.resolve({
        outcome: 'created',
        packetFileName: `${packetId}.codex-review.json`,
        resultFileName: `${packetId}.codex-result.json`,
        packetByteLength: packetBytes.byteLength,
        packetFileSha256: 'a'.repeat(64),
      });
    },
    readPacket() {
      if (packetBytes === undefined) throw new Error('missing');
      return Promise.resolve(Uint8Array.from(packetBytes));
    },
    readResult() {
      if (resultBytes === undefined) throw new Error('missing');
      return Promise.resolve(Uint8Array.from(resultBytes));
    },
  };
  const exportService = new BulkIngestionCodexReviewService({
    workspaceId: WORKSPACE_ID,
    adjudication: {
      sample: () =>
        Promise.resolve([
          {
            sampleRank: 1,
            ordinal: 0,
            snapshotId: SNAPSHOT_ID,
            isPrivate: false,
            entryId: ENTRY_ID,
            entryRevision: 3,
            entryRevisionId: REVISION_ID,
            isCurrent: true,
            exceptionCode: 'no_deterministic_tags',
            status: 'pending',
            version: 1,
          },
        ]),
    },
    entries: {loadCurrentEntries: () => Promise.resolve([current])},
    fileStore,
  });
  await exportService.export({
    batchId: BATCH_ID,
    includePrivate: false,
    limit: 1,
  });

  const entries: InformationEntryRepositoryPort &
    InformationEntryBulkRevisionRepositoryPort = {
    materializeEntries() {
      return Promise.resolve({outcome: 'existing', createdCount: 0});
    },
    reviseEntry() {
      return Promise.resolve('unchanged');
    },
    loadCurrentEntries() {
      return Promise.resolve([current]);
    },
    reviseEntriesAtomically(writes) {
      const write = writes[0];
      if (writes.length !== 1 || current.revision !== write?.expectedRevision) {
        return Promise.resolve({outcome: 'stale', appliedCount: 0});
      }
      current = Object.freeze({
        ...current,
        revision: current.revision + 1,
        revisionId: write.revisionId,
        value: write.value,
      });
      exceptionValue = Object.freeze({...exceptionValue, isCurrent: false});
      return Promise.resolve({outcome: 'applied', appliedCount: 1});
    },
  };
  const associations: InformationEntryAssociationIncrementalRepositoryPort = {
    replaceAssociationProjectionsForEntries: vi.fn().mockResolvedValue(0),
  };
  const adjudication = {
    list() {
      return Promise.resolve([exceptionValue]);
    },
    decideExact(
      request: Readonly<DecideExactBulkIngestionAdjudicationRequest>,
    ): Promise<Readonly<DecideBulkIngestionAdjudicationResult>> {
      const decision = request.decisions[0];
      beforeAdjudication?.();
      beforeAdjudication = undefined;
      if (request.decisions.length !== 1 || decision === undefined) {
        return Promise.resolve({
          outcome: 'stale',
          appliedCount: 0,
          summary: summary(),
        });
      }
      if (
        current.revision !== decision.expectedCurrentEntryRevision ||
        current.revisionId !== decision.expectedCurrentEntryRevisionId
      ) {
        return Promise.resolve({
          outcome: 'stale',
          appliedCount: 0,
          summary: summary(),
        });
      }
      exceptionValue = Object.freeze({
        ...exceptionValue,
        status: decision.toStatus,
        version: exceptionValue.version + 1,
      });
      return Promise.resolve({
        outcome: 'applied',
        appliedCount: 1,
        summary: summary(),
      });
    },
  };
  const service = new BulkIngestionCodexApplyService({
    workspaceId: WORKSPACE_ID,
    fileStore,
    entries,
    adjudication,
    associations,
    preferences: {
      load: () => Promise.resolve(createReviewPreferences(WORKSPACE_ID, [])),
      save: () => Promise.resolve(createReviewPreferences(WORKSPACE_ID, [])),
    },
  });
  const resultBase = () => ({
    schemaVersion: 'struinfo.m2-p0f.codex-review-result.v1',
    packetId,
    packetSha256,
  });
  const decisionIdentity = () => ({
    entryId: ENTRY_ID,
    entryRevision: 3,
    entryRevisionId: REVISION_ID,
    adjudicationVersion: 1,
  });
  const setRawResult = (value: unknown) => {
    resultBytes = encodeCanonicalJson(value, 2 * 1_024 * 1_024);
  };
  return {
    service,
    packetId,
    current: () => current,
    exception: () => exceptionValue,
    setCurrent(value: CurrentInformationEntry) {
      current = Object.freeze(value);
    },
    advanceEntryBeforeAdjudication() {
      beforeAdjudication = () => {
        const revision = current.revision + 1;
        current = Object.freeze({
          ...current,
          revision,
          revisionId: deriveInformationEntryRevisionId(
            current.entryId,
            revision,
          ),
        });
      };
    },
    resultBase,
    decisionIdentity,
    setRawResult,
    setResult(
      decision:
        | Readonly<{action: 'accept' | 'manual_review' | 'deferred'}>
        | Readonly<{
            action: 'annotate';
            annotation: Readonly<{
              contentKeywords: readonly string[];
              typeKeyword: 'operating_guideline';
              domains: readonly Readonly<{
                keyword: 'engineering_computing';
              }>[];
            }>;
          }>,
    ) {
      setRawResult({
        ...resultBase(),
        decisions: [{...decisionIdentity(), ...decision}],
      });
    },
  };
}

function currentEntry(): Readonly<CurrentInformationEntry> {
  return Object.freeze({
    workspaceId: WORKSPACE_ID,
    entryId: ENTRY_ID,
    resourceId: '66666666-6666-4666-8666-666666666666',
    snapshotId: SNAPSHOT_ID,
    revision: 3,
    revisionId: REVISION_ID,
    sourceKey: 'synthetic-source',
    capturedAt: '2026-08-31T00:00:00.000Z',
    value: Object.freeze({
      documentOrder: 0,
      titlePath: 'Synthetic title',
      body: 'Synthetic body.',
      bodySha256: 'a'.repeat(64),
      chunkMode: 'split',
      splitRuleVersion: 'synthetic.v1',
      isPrivate: false,
      contentKeywords: Object.freeze([]),
      domains: Object.freeze([]),
      fragmentIds: Object.freeze(['77777777-7777-4777-8777-777777777777']),
    }),
  });
}

function adjudicationException(
  current: Readonly<CurrentInformationEntry>,
): Readonly<BulkIngestionAdjudicationException> {
  return Object.freeze({
    workspaceId: WORKSPACE_ID,
    batchId: BATCH_ID,
    ordinal: 0,
    snapshotId: SNAPSHOT_ID,
    isPrivate: false,
    entryId: ENTRY_ID,
    entryRevision: 3,
    entryRevisionId: REVISION_ID,
    currentEntryRevision: current.revision,
    currentEntryRevisionId: current.revisionId,
    isCurrent: true,
    exceptionCode: 'no_deterministic_tags',
    status: 'pending',
    version: 1,
  });
}

function summary() {
  return Object.freeze({
    batchId: BATCH_ID,
    totalExceptionCount: 1,
    currentExceptionCount: exceptionCurrentCount(),
    staleExceptionCount: 0,
    pendingCount: 0,
    acceptedCount: 1,
    manualReviewCount: 0,
    deferredCount: 0,
    reviewComplete: true,
    groups: Object.freeze([]),
  });
}

function exceptionCurrentCount(): number {
  return 1;
}
