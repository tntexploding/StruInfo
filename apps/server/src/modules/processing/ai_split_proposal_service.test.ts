import {createHash} from 'node:crypto';

import {describe, expect, it, vi} from 'vitest';

import type {BlobIdentity, BlobStore} from '../../storage/blob_store.js';
import type {
  CurrentInformationEntry,
  InformationEntryEmptySnapshotRepositoryPort,
  InformationEntryMaterializeRow,
} from '../entries/index.js';
import type {
  EvidenceReadRepositoryPort,
  EvidenceSnapshotReadState,
} from '../evidence/index.js';
import type {AiSplitProposalProviderPort} from './ai_split_proposal.js';
import {
  AiSplitProposalService,
  AiSplitProposalServiceError,
} from './ai_split_proposal_service.js';
import type {ProcessingProposal, ProcessingRun} from './processing_contract.js';
import type {AiSplitProposalRepositoryPort} from './processing_repository.js';

const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';
const SNAPSHOT_ID = '22222222-2222-4222-8222-222222222222';
const RESOURCE_ID = '33333333-3333-4333-8333-333333333333';
const STRUCTURE_ID = '44444444-4444-4444-8444-444444444444';
const FRAGMENT_A_ID = '55555555-5555-4555-8555-555555555555';
const FRAGMENT_B_ID = '66666666-6666-4666-8666-666666666666';
const SECTION_A = 'Synthetic public section A.';
const SECTION_B = 'Synthetic public section B.';
const NORMALIZED_TEXT = SECTION_A + '\n' + SECTION_B;

describe('AiSplitProposalService', () => {
  it('creates a reviewable grouping and materializes exact Fragment text only after acceptance', async () => {
    const fixture = createFixture(false);

    const started = await fixture.service.start(
      SNAPSHOT_ID,
      'synthetic-request',
    );
    expect(started).toMatchObject({
      outcome: 'created',
      run: {status: 'succeeded'},
    });
    expect(fixture.proposeSplit).toHaveBeenCalledWith([
      {ordinal: 0, text: SECTION_A},
      {ordinal: 1, text: SECTION_B},
    ]);
    expect(fixture.currentEntries).toHaveLength(0);

    const [proposal] = await fixture.service.listForSnapshot(SNAPSHOT_ID);
    expect(proposal).toMatchObject({
      kind: 'split',
      status: 'pending_review',
      targetSnapshotId: SNAPSHOT_ID,
      splitPayload: {
        providerModel: 'gpt-5-mini',
        splitRuleVersion: 'struinfo.entry-split.ai-group.v1',
        entries: [
          {
            titlePath: 'Combined synthetic entry',
            fragmentIds: [FRAGMENT_A_ID, FRAGMENT_B_ID],
          },
        ],
      },
    });

    const accepted = await fixture.service.accept(
      SNAPSHOT_ID,
      proposal?.proposalId ?? '',
    );
    expect(accepted.outcome).toBe('accepted');
    expect(accepted.proposal.status).toBe('accepted');
    if (!('entries' in accepted)) throw new Error('missing accepted entries');
    expect(accepted.entries).toHaveLength(1);
    expect(accepted.entries[0]?.value).toMatchObject({
      titlePath: 'Combined synthetic entry',
      body: SECTION_A + '\n\n' + SECTION_B,
      fragmentIds: [FRAGMENT_A_ID, FRAGMENT_B_ID],
      splitRuleVersion: 'struinfo.entry-split.ai-group.v1',
      isPrivate: false,
    });
  });

  it('rejects a proposal without creating an Entry', async () => {
    const fixture = createFixture(false);
    await fixture.service.start(SNAPSHOT_ID, 'reject-request');
    const [proposal] = await fixture.service.listForSnapshot(SNAPSHOT_ID);

    const rejected = await fixture.service.reject(
      SNAPSHOT_ID,
      proposal?.proposalId ?? '',
    );
    expect(rejected.outcome).toBe('rejected');
    expect(rejected.proposal.status).toBe('rejected');
    expect(fixture.materializeEntriesIfSnapshotEmpty).not.toHaveBeenCalled();
    expect(fixture.currentEntries).toHaveLength(0);
  });

  it('rejects a private Snapshot before Blob or Provider access', async () => {
    const fixture = createFixture(true);

    await expect(
      fixture.service.start(SNAPSHOT_ID, 'private-request'),
    ).rejects.toEqual(
      new AiSplitProposalServiceError('ai_private_snapshot_forbidden'),
    );
    expect(fixture.blobRead).not.toHaveBeenCalled();
    expect(fixture.proposeSplit).not.toHaveBeenCalled();
    expect(fixture.runs.size).toBe(0);
  });

  it('does not overwrite a deterministic split that wins before acceptance', async () => {
    const fixture = createFixture(false);
    await fixture.service.start(SNAPSHOT_ID, 'stale-request');
    const [proposal] = await fixture.service.listForSnapshot(SNAPSHOT_ID);
    fixture.occupySnapshot();

    await expect(
      fixture.service.accept(SNAPSHOT_ID, proposal?.proposalId ?? ''),
    ).rejects.toEqual(
      new AiSplitProposalServiceError('stale_split_materialization'),
    );
    expect(fixture.decideProposal).not.toHaveBeenCalled();
    expect(fixture.currentEntries).toHaveLength(1);
    expect(fixture.currentEntries[0]?.value.splitRuleVersion).toBe(
      'struinfo.entry-split.section.v1',
    );
  });
});

function createFixture(isPrivate: boolean) {
  const snapshot = evidenceSnapshot(isPrivate);
  let currentEntries: readonly Readonly<CurrentInformationEntry>[] = [];
  const runs = new Map<string, Readonly<ProcessingRun>>();
  const proposals = new Map<string, Readonly<ProcessingProposal>>();

  const bytes = new TextEncoder().encode(NORMALIZED_TEXT);
  const blobRead = vi.fn<BlobStore['read']>(() => Promise.resolve(bytes));
  const blobStore: BlobStore = {
    put: () => Promise.resolve(blobIdentity(bytes)),
    read: blobRead,
  };
  const evidence: EvidenceReadRepositoryPort = {
    listSnapshots: () => Promise.resolve(Object.freeze([snapshot])),
    loadSnapshot: (_workspaceId, snapshotId) =>
      Promise.resolve(snapshotId === SNAPSHOT_ID ? snapshot : undefined),
  };

  const materializeEntries = vi.fn<
    InformationEntryEmptySnapshotRepositoryPort['materializeEntries']
  >(() => Promise.resolve({outcome: 'existing', createdCount: 0}));
  const materializeEntriesIfSnapshotEmpty = vi.fn<
    InformationEntryEmptySnapshotRepositoryPort['materializeEntriesIfSnapshotEmpty']
  >((rows) => {
    if (currentEntries.some((entry) => entry.snapshotId === SNAPSHOT_ID)) {
      return Promise.resolve({outcome: 'snapshot_not_empty', createdCount: 0});
    }
    currentEntries = Object.freeze(rows.map(materializedCurrentEntry));
    return Promise.resolve({outcome: 'created', createdCount: rows.length});
  });
  const entries: InformationEntryEmptySnapshotRepositoryPort = {
    materializeEntries,
    materializeEntriesIfSnapshotEmpty,
    reviseEntry: () => Promise.resolve('not_found'),
    loadCurrentEntries: () => Promise.resolve(currentEntries),
  };

  const decideProposal = vi.fn<AiSplitProposalRepositoryPort['decideProposal']>(
    (_workspaceId, proposalId, decision) => {
      const proposal = proposals.get(proposalId);
      if (proposal === undefined) return Promise.resolve('not_found' as const);
      proposals.set(
        proposalId,
        Object.freeze({
          ...proposal,
          status: decision,
          decidedAt: '2040-01-02T03:04:06.000Z',
        }),
      );
      return Promise.resolve('applied' as const);
    },
  );
  const processing: AiSplitProposalRepositoryPort = {
    listRecentRuns: () => Promise.resolve(Object.freeze([...runs.values()])),
    createRun: (create) => {
      if (runs.has(create.runId)) return Promise.resolve('unchanged');
      runs.set(
        create.runId,
        processingRun(create.runId, create.idempotencyKey),
      );
      return Promise.resolve('applied');
    },
    writeProgress: (write) => {
      const existing = runs.get(write.runId);
      if (existing === undefined) return Promise.resolve('not_found');
      if (existing.version !== write.expectedVersion)
        return Promise.resolve('stale');
      runs.set(
        write.runId,
        Object.freeze({
          ...existing,
          status: write.status,
          currentStage: write.currentStage,
          ...(write.currentStep === undefined
            ? {}
            : {currentStep: write.currentStep}),
          completedUnits: write.completedUnits,
          ...(write.totalUnits === undefined
            ? {}
            : {totalUnits: write.totalUnits}),
          ...(write.errorCode === undefined
            ? {}
            : {errorCode: write.errorCode}),
          version: existing.version + 1,
          proposals: Object.freeze(
            [...proposals.values()].filter(
              (proposal) => proposal.runId === write.runId,
            ),
          ),
        }),
      );
      return Promise.resolve('applied');
    },
    cancelRun: () => Promise.resolve('applied'),
    appendProposal: () => Promise.resolve('applied'),
    loadRun: (_workspaceId, runId) => Promise.resolve(runs.get(runId)),
    listSplitProposalsForSnapshot: (_workspaceId, snapshotId) =>
      Promise.resolve(
        Object.freeze(
          [...proposals.values()].filter(
            (proposal) => proposal.targetSnapshotId === snapshotId,
          ),
        ),
      ),
    appendSplitProposal: (append) => {
      proposals.set(
        append.proposalId,
        Object.freeze({
          ...append,
          status: 'pending_review',
          createdAt: '2040-01-02T03:04:05.000Z',
        }),
      );
      return Promise.resolve('applied');
    },
    decideProposal,
  };

  const proposeSplit = vi.fn<AiSplitProposalProviderPort['proposeSplit']>(() =>
    Promise.resolve(
      Object.freeze({
        summary: 'Synthetic grouping',
        groups: Object.freeze([
          Object.freeze({
            titlePath: 'Combined synthetic entry',
            startOrdinal: 0,
            endOrdinal: 1,
          }),
        ]),
      }),
    ),
  );
  const provider = {
    providerKey: 'openai-responses-v1' as const,
    model: 'gpt-5-mini',
    promptVersion: 'struinfo.openai-entry-split.v1',
    proposeSplit,
  } satisfies AiSplitProposalProviderPort;
  const service = new AiSplitProposalService({
    workspaceId: WORKSPACE_ID,
    blobStore,
    evidence,
    entries,
    processing,
    provider,
  });

  return {
    service,
    runs,
    blobRead,
    proposeSplit,
    materializeEntriesIfSnapshotEmpty,
    decideProposal,
    get currentEntries() {
      return currentEntries;
    },
    occupySnapshot() {
      currentEntries = Object.freeze([deterministicCurrentEntry()]);
    },
  };
}

function evidenceSnapshot(
  isPrivate: boolean,
): Readonly<EvidenceSnapshotReadState> {
  const bytes = new TextEncoder().encode(NORMALIZED_TEXT);
  const secondStart = Array.from(SECTION_A + '\n').length;
  return Object.freeze({
    workspaceId: WORKSPACE_ID,
    snapshotId: SNAPSHOT_ID,
    resourceId: RESOURCE_ID,
    resourceKind: 'manual_text',
    sourceKey: 'synthetic:public-split',
    ...(isPrivate ? {isPrivate: true as const} : {}),
    capturedAt: '2040-01-02T03:04:05.000Z',
    fragmentCount: 2,
    rawSha256: digest(NORMALIZED_TEXT),
    canonicalContentSha256: digest(NORMALIZED_TEXT),
    canonicalizationVersion: 'utf8-lf-v1',
    structures: Object.freeze([
      Object.freeze({
        structureId: STRUCTURE_ID,
        parserName: 'struinfo-commonmark',
        parserVersion: '1',
        textNormalizationVersion: 'utf8-lf-v1',
        structureSha256: 'a'.repeat(64),
        textBlob: blobIdentity(bytes),
        fragments: Object.freeze([
          fragment(FRAGMENT_A_ID, 0, Array.from(SECTION_A).length, SECTION_A),
          fragment(
            FRAGMENT_B_ID,
            secondStart,
            Array.from(NORMALIZED_TEXT).length,
            SECTION_B,
          ),
        ]),
      }),
    ]),
  });
}

function fragment(
  fragmentId: string,
  start: number,
  end: number,
  text: string,
) {
  return Object.freeze({
    fragmentId,
    structureId: STRUCTURE_ID,
    nodeId: fragmentId,
    nodeKind: 'section' as const,
    codePointRange: Object.freeze({start, end}),
    selectedTextSha256: digest(text),
  });
}

function blobIdentity(bytes: Uint8Array): Readonly<BlobIdentity> {
  return Object.freeze({
    algorithm: 'sha256',
    digest: createHash('sha256').update(bytes).digest('hex'),
    byteLength: bytes.byteLength,
  });
}

function digest(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function materializedCurrentEntry(
  row: Readonly<InformationEntryMaterializeRow>,
): Readonly<CurrentInformationEntry> {
  return Object.freeze({
    ...row,
    revision: 1,
    sourceKey: 'synthetic:public-split',
    capturedAt: '2040-01-02T03:04:05.000Z',
  });
}

function deterministicCurrentEntry(): Readonly<CurrentInformationEntry> {
  return Object.freeze({
    workspaceId: WORKSPACE_ID,
    entryId: '77777777-7777-4777-8777-777777777777',
    resourceId: RESOURCE_ID,
    snapshotId: SNAPSHOT_ID,
    revision: 1,
    revisionId: '88888888-8888-4888-8888-888888888888',
    sourceKey: 'synthetic:public-split',
    capturedAt: '2040-01-02T03:04:05.000Z',
    value: Object.freeze({
      documentOrder: 0,
      titlePath: 'Deterministic entry',
      body: SECTION_A,
      bodySha256: digest(SECTION_A),
      chunkMode: 'split',
      splitRuleVersion: 'struinfo.entry-split.section.v1',
      isPrivate: false,
      contentKeywords: Object.freeze([]),
      domains: Object.freeze([]),
      fragmentIds: Object.freeze([FRAGMENT_A_ID]),
    }),
  });
}

function processingRun(
  runId: string,
  idempotencyKey: string,
): Readonly<ProcessingRun> {
  return Object.freeze({
    workspaceId: WORKSPACE_ID,
    runId,
    idempotencyKey,
    origin: 'ai',
    providerKey: 'openai-responses-v1',
    status: 'queued',
    targetSnapshotId: SNAPSHOT_ID,
    privacyScope: 'public_only',
    currentStage: 'split',
    currentStep: '等待 OpenAI 拆分提案',
    completedUnits: 0,
    attempt: 1,
    version: 1,
    createdAt: '2040-01-02T03:04:05.000Z',
    updatedAt: '2040-01-02T03:04:05.000Z',
    proposals: Object.freeze([]),
  });
}
