import {describe, expect, it, vi} from 'vitest';

import type {
  CurrentInformationEntry,
  CurrentInformationEntryAssociationOverride,
  InformationEntryAssociationRepositoryPort,
  InformationEntryRepositoryPort,
} from '../entries/index.js';
import type {AiAssociationProposalProviderPort} from './ai_association_proposal.js';
import {
  AiAssociationProposalService,
  AiAssociationProposalServiceError,
} from './ai_association_proposal_service.js';
import type {ProcessingProposal, ProcessingRun} from './processing_contract.js';
import type {AiAssociationProposalRepositoryPort} from './processing_repository.js';

const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';
const ENTRY_LOW_ID = '22222222-2222-4222-8222-222222222222';
const ENTRY_HIGH_ID = '33333333-3333-4333-8333-333333333333';

const PROJECTION = Object.freeze({
  workspaceId: WORKSPACE_ID,
  entryLowId: ENTRY_LOW_ID,
  entryHighId: ENTRY_HIGH_ID,
  entryLowRevision: 1,
  entryLowRevisionId: '44444444-4444-4444-8444-444444444444',
  entryHighRevision: 1,
  entryHighRevisionId: '55555555-5555-4555-8555-555555555555',
  contentSimilarity: 0.7,
  typeSimilarity: 0.5,
  domainSimilarity: 0.25,
  baseScore: 0.55,
  algorithmVersion: 'synthetic-association-v1',
  candidateBasis: Object.freeze(['content_keyword' as const]),
  candidateRank: 1,
});

describe('AiAssociationProposalService', () => {
  it('creates a reviewable pair proposal and applies it through the graph write boundary', async () => {
    const fixture = createFixture(false);

    const started = await fixture.service.start(
      ENTRY_HIGH_ID,
      ENTRY_LOW_ID,
      'synthetic-request',
    );
    expect(started).toMatchObject({
      outcome: 'created',
      run: {status: 'succeeded'},
    });
    expect(fixture.proposeAssociation).toHaveBeenCalledTimes(1);
    const [proposal] = await fixture.service.listForPair(
      ENTRY_LOW_ID,
      ENTRY_HIGH_ID,
    );
    expect(proposal).toMatchObject({
      kind: 'association',
      status: 'pending_review',
      targetEntryId: ENTRY_LOW_ID,
      relatedEntryId: ENTRY_HIGH_ID,
      associationPayload: {
        expectedEntryLowRevision: 1,
        expectedEntryHighRevision: 1,
        expectedOverrideRevision: 0,
        providerModel: 'gpt-5-mini',
        relationLabel: '补充说明',
        direction: 'low_to_high',
      },
    });
    expect(fixture.currentOverride).toBeUndefined();

    const accepted = await fixture.service.accept(
      ENTRY_HIGH_ID,
      ENTRY_LOW_ID,
      proposal?.proposalId ?? '',
    );
    expect(accepted).toMatchObject({
      outcome: 'accepted',
      proposal: {status: 'accepted'},
    });
    expect(fixture.writeAssociationOverride).toHaveBeenCalledTimes(1);
    expect(fixture.currentOverride).toMatchObject({
      revision: 1,
      value: {
        action: 'restore',
        isBlocked: false,
        graph: {
          origin: 'ai',
          label: '补充说明',
          direction: 'low_to_high',
          semanticKind: 'related',
          verificationStatus: 'unreviewed',
          note: 'A 补充 B 的实现背景。',
        },
      },
    });
  });

  it('rejects a proposal without changing the graph', async () => {
    const fixture = createFixture(false);
    await fixture.service.start(ENTRY_LOW_ID, ENTRY_HIGH_ID, 'reject-request');
    const [proposal] = await fixture.service.listForPair(
      ENTRY_LOW_ID,
      ENTRY_HIGH_ID,
    );

    const rejected = await fixture.service.reject(
      ENTRY_LOW_ID,
      ENTRY_HIGH_ID,
      proposal?.proposalId ?? '',
    );

    expect(rejected).toMatchObject({
      outcome: 'rejected',
      proposal: {status: 'rejected'},
    });
    expect(fixture.writeAssociationOverride).not.toHaveBeenCalled();
    expect(fixture.currentOverride).toBeUndefined();
  });

  it('rejects a private pair before creating a run or calling the Provider', async () => {
    const fixture = createFixture(true);

    await expect(
      fixture.service.start(ENTRY_LOW_ID, ENTRY_HIGH_ID, 'private-request'),
    ).rejects.toEqual(
      new AiAssociationProposalServiceError('ai_private_entry_forbidden'),
    );
    expect(fixture.proposeAssociation).not.toHaveBeenCalled();
    expect(fixture.runs.size).toBe(0);
  });
});

function createFixture(privateHigh: boolean) {
  const entriesValue = Object.freeze([
    entry(ENTRY_LOW_ID, false, 0),
    entry(ENTRY_HIGH_ID, privateHigh, 1),
  ]);
  const runs = new Map<string, Readonly<ProcessingRun>>();
  const proposals = new Map<string, Readonly<ProcessingProposal>>();
  let currentOverride:
    Readonly<CurrentInformationEntryAssociationOverride> | undefined;

  const entries: InformationEntryRepositoryPort = {
    materializeEntries: vi.fn(() =>
      Promise.resolve(
        Object.freeze({outcome: 'existing' as const, createdCount: 0}),
      ),
    ),
    reviseEntry: vi.fn(() => Promise.resolve('unchanged' as const)),
    loadCurrentEntries: vi.fn(() => Promise.resolve(entriesValue)),
  };

  const writeAssociationOverride = vi.fn<
    InformationEntryAssociationRepositoryPort['writeAssociationOverride']
  >((write) => {
    if ((currentOverride?.revision ?? 0) !== write.expectedRevision) {
      return Promise.resolve('stale' as const);
    }
    currentOverride = Object.freeze({
      workspaceId: WORKSPACE_ID,
      entryLowId: write.entryLowId,
      entryHighId: write.entryHighId,
      revision: write.expectedRevision + 1,
      revisionId: write.revisionId,
      value: write.value,
    });
    return Promise.resolve('applied' as const);
  });
  const associations: InformationEntryAssociationRepositoryPort = {
    replaceAssociationProjections: vi.fn(() => Promise.resolve(0)),
    loadAssociationSnapshot: vi.fn(() =>
      Promise.resolve(
        Object.freeze({
          projections: Object.freeze([PROJECTION]),
          overrides: Object.freeze(
            currentOverride === undefined ? [] : [currentOverride],
          ),
        }),
      ),
    ),
    writeAssociationOverride,
  };

  const createRun = vi.fn<AiAssociationProposalRepositoryPort['createRun']>(
    (create) => {
      if (runs.has(create.runId)) return Promise.resolve('unchanged' as const);
      runs.set(create.runId, run(create.runId, create.idempotencyKey));
      return Promise.resolve('applied' as const);
    },
  );
  const writeProgress = vi.fn<
    AiAssociationProposalRepositoryPort['writeProgress']
  >((write) => {
    const existing = runs.get(write.runId);
    if (existing === undefined) return Promise.resolve('not_found' as const);
    if (existing.version !== write.expectedVersion) {
      return Promise.resolve('stale' as const);
    }
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
        ...(write.errorCode === undefined ? {} : {errorCode: write.errorCode}),
        version: existing.version + 1,
        proposals: Object.freeze(
          [...proposals.values()].filter(
            (proposal) => proposal.runId === write.runId,
          ),
        ),
      }),
    );
    return Promise.resolve('applied' as const);
  });
  const loadRun = vi.fn<AiAssociationProposalRepositoryPort['loadRun']>(
    (_workspaceId, runId) => Promise.resolve(runs.get(runId)),
  );
  const listAssociationProposalsForPair = vi.fn<
    AiAssociationProposalRepositoryPort['listAssociationProposalsForPair']
  >((_workspaceId, entryLowId, entryHighId) =>
    Promise.resolve(
      Object.freeze(
        [...proposals.values()].filter(
          (proposal) =>
            proposal.targetEntryId === entryLowId &&
            proposal.relatedEntryId === entryHighId,
        ),
      ),
    ),
  );
  const appendAssociationProposal = vi.fn<
    AiAssociationProposalRepositoryPort['appendAssociationProposal']
  >((append) => {
    proposals.set(
      append.proposalId,
      Object.freeze({
        ...append,
        status: 'pending_review' as const,
        createdAt: '2040-01-02T03:04:05.000Z',
      }),
    );
    return Promise.resolve('applied' as const);
  });
  const decideProposal = vi.fn<
    AiAssociationProposalRepositoryPort['decideProposal']
  >((_workspaceId, proposalId, decision) => {
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
  });
  const processing: AiAssociationProposalRepositoryPort = {
    listRecentRuns: vi.fn(() =>
      Promise.resolve(Object.freeze([...runs.values()])),
    ),
    createRun,
    writeProgress,
    cancelRun: vi.fn(() => Promise.resolve('applied' as const)),
    appendProposal: vi.fn(() => Promise.resolve('applied' as const)),
    loadRun,
    listAssociationProposalsForPair,
    appendAssociationProposal,
    decideProposal,
  };

  const proposeAssociation = vi.fn<
    AiAssociationProposalProviderPort['proposeAssociation']
  >(() =>
    Promise.resolve(
      Object.freeze({
        summary: 'A 补充 B 的实现背景。',
        relationLabel: '补充说明',
        direction: 'low_to_high' as const,
      }),
    ),
  );
  const provider = {
    providerKey: 'openai-responses-v1' as const,
    model: 'gpt-5-mini',
    promptVersion: 'struinfo.openai-entry-association.v1',
    proposeAssociation,
  } satisfies AiAssociationProposalProviderPort;
  const service = new AiAssociationProposalService({
    workspaceId: WORKSPACE_ID,
    entries,
    associations,
    processing,
    provider,
  });

  return {
    service,
    runs,
    proposeAssociation,
    writeAssociationOverride,
    get currentOverride() {
      return currentOverride;
    },
  };
}

function run(runId: string, idempotencyKey: string): Readonly<ProcessingRun> {
  return Object.freeze({
    workspaceId: WORKSPACE_ID,
    runId,
    idempotencyKey,
    origin: 'ai',
    providerKey: 'openai-responses-v1',
    status: 'queued',
    privacyScope: 'public_only',
    currentStage: 'associations',
    currentStep: '等待 OpenAI 关系提案',
    completedUnits: 0,
    attempt: 1,
    version: 1,
    createdAt: '2040-01-02T03:04:05.000Z',
    updatedAt: '2040-01-02T03:04:05.000Z',
    proposals: Object.freeze([]),
  });
}

function entry(
  entryId: string,
  isPrivate: boolean,
  documentOrder: number,
): Readonly<CurrentInformationEntry> {
  return Object.freeze({
    workspaceId: WORKSPACE_ID,
    entryId,
    resourceId: '66666666-6666-4666-8666-666666666666',
    snapshotId: '77777777-7777-4777-8777-777777777777',
    revision: 1,
    revisionId:
      entryId === ENTRY_LOW_ID
        ? '44444444-4444-4444-8444-444444444444'
        : '55555555-5555-4555-8555-555555555555',
    sourceKey: `synthetic:${documentOrder.toString()}`,
    capturedAt: '2040-01-02T03:04:05.000Z',
    value: Object.freeze({
      documentOrder,
      titlePath: `Synthetic Entry ${documentOrder.toString()}`,
      body: `Synthetic body ${documentOrder.toString()}`,
      bodySha256: (documentOrder === 0 ? 'a' : 'b').repeat(64),
      chunkMode: 'split',
      splitRuleVersion: 'struinfo.entry-split.section.v1',
      isPrivate,
      contentKeywords: Object.freeze([]),
      domains: Object.freeze([]),
      fragmentIds: Object.freeze([
        documentOrder === 0
          ? '88888888-8888-4888-8888-888888888888'
          : '99999999-9999-4999-8999-999999999999',
      ]),
    }),
  });
}
