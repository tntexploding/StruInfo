import {describe, expect, it, vi} from 'vitest';

import type {
  CurrentInformationEntry,
  InformationEntryRepositoryPort,
} from '../entries/index.js';
import type {AiTagProposalProviderPort} from './ai_tag_proposal.js';
import {
  AiTagProposalService,
  AiTagProposalServiceError,
} from './ai_tag_proposal_service.js';
import type {ProcessingProposal, ProcessingRun} from './processing_contract.js';
import type {AiTagProposalRepositoryPort} from './processing_repository.js';

const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';
const ENTRY_ID = '22222222-2222-4222-8222-222222222222';

describe('AiTagProposalService', () => {
  it('creates a reviewable proposal and applies it only through Entry revision', async () => {
    const fixture = createFixture(false);

    const started = await fixture.service.start(ENTRY_ID, 'synthetic-request');
    expect(started.outcome).toBe('created');
    expect(started.run.status).toBe('succeeded');
    expect(fixture.proposeTags).toHaveBeenCalledTimes(1);
    const [proposal] = await fixture.service.listForEntry(ENTRY_ID);
    expect(proposal).toMatchObject({
      kind: 'tags',
      status: 'pending_review',
      targetEntryId: ENTRY_ID,
      tagPayload: {
        expectedEntryRevision: 1,
        providerModel: 'gpt-5-mini',
      },
    });
    expect(fixture.current.revision).toBe(1);

    const accepted = await fixture.service.accept(
      ENTRY_ID,
      proposal?.proposalId ?? '',
    );
    expect(accepted.outcome).toBe('accepted');
    expect(accepted.proposal.status).toBe('accepted');
    expect(fixture.reviseEntry).toHaveBeenCalledTimes(1);
    expect(fixture.current).toMatchObject({
      revision: 2,
      value: {
        typeKeyword: 'knowledge_explanation',
        contentKeywords: [
          {
            displayValue: 'PostgreSQL',
            origin: 'ai',
            originVersion: 'openai:gpt-5-mini:struinfo.openai-entry-tags.v1',
          },
        ],
      },
    });
  });

  it('rejects a proposal without changing the Entry', async () => {
    const fixture = createFixture(false);
    await fixture.service.start(ENTRY_ID, 'reject-request');
    const [proposal] = await fixture.service.listForEntry(ENTRY_ID);

    const rejected = await fixture.service.reject(
      ENTRY_ID,
      proposal?.proposalId ?? '',
    );
    expect(rejected).toMatchObject({outcome: 'rejected'});
    expect(rejected.proposal.status).toBe('rejected');
    expect(fixture.reviseEntry).not.toHaveBeenCalled();
    expect(fixture.current.revision).toBe(1);
  });

  it('never invokes the Provider for a private Entry', async () => {
    const fixture = createFixture(true);

    await expect(
      fixture.service.start(ENTRY_ID, 'private-request'),
    ).rejects.toEqual(
      new AiTagProposalServiceError('ai_private_entry_forbidden'),
    );
    expect(fixture.proposeTags).not.toHaveBeenCalled();
    expect(fixture.runs.size).toBe(0);
  });
});

function createFixture(isPrivate: boolean) {
  let current = entry(isPrivate);
  const runs = new Map<string, Readonly<ProcessingRun>>();
  const proposals = new Map<string, Readonly<ProcessingProposal>>();

  const materializeEntries = vi.fn<
    InformationEntryRepositoryPort['materializeEntries']
  >(() =>
    Promise.resolve(
      Object.freeze({outcome: 'existing' as const, createdCount: 0}),
    ),
  );
  const reviseEntry = vi.fn<InformationEntryRepositoryPort['reviseEntry']>(
    (write) => {
      if (write.expectedRevision !== current.revision) {
        return Promise.resolve('stale' as const);
      }
      current = Object.freeze({
        ...current,
        revision: current.revision + 1,
        revisionId: write.revisionId,
        value: write.value,
      });
      return Promise.resolve('applied' as const);
    },
  );
  const loadCurrentEntries = vi.fn<
    InformationEntryRepositoryPort['loadCurrentEntries']
  >(() => Promise.resolve(Object.freeze([current])));
  const entries: InformationEntryRepositoryPort = {
    materializeEntries,
    reviseEntry,
    loadCurrentEntries,
  };

  const listRecentRuns = vi.fn<AiTagProposalRepositoryPort['listRecentRuns']>(
    () => Promise.resolve(Object.freeze([...runs.values()])),
  );
  const createRun = vi.fn<AiTagProposalRepositoryPort['createRun']>(
    (create) => {
      if (runs.has(create.runId)) {
        return Promise.resolve('unchanged' as const);
      }
      runs.set(create.runId, run(create.runId, create.idempotencyKey));
      return Promise.resolve('applied' as const);
    },
  );
  const writeProgress = vi.fn<AiTagProposalRepositoryPort['writeProgress']>(
    (write) => {
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
          ...(write.errorCode === undefined
            ? {}
            : {errorCode: write.errorCode}),
          version: existing.version + 1,
          proposals: Object.freeze(
            [...proposals.values()].filter(
              (value) => value.runId === write.runId,
            ),
          ),
        }),
      );
      return Promise.resolve('applied' as const);
    },
  );
  const cancelRun = vi.fn<AiTagProposalRepositoryPort['cancelRun']>(() =>
    Promise.resolve('applied' as const),
  );
  const appendProposal = vi.fn<AiTagProposalRepositoryPort['appendProposal']>(
    () => Promise.resolve('applied' as const),
  );
  const loadRun = vi.fn<AiTagProposalRepositoryPort['loadRun']>(
    (_workspaceId, runId) => {
      const existing = runs.get(runId);
      return Promise.resolve(
        existing === undefined
          ? undefined
          : Object.freeze({
              ...existing,
              proposals: Object.freeze(
                [...proposals.values()].filter(
                  (value) => value.runId === runId,
                ),
              ),
            }),
      );
    },
  );
  const listTagProposalsForEntry = vi.fn<
    AiTagProposalRepositoryPort['listTagProposalsForEntry']
  >((_workspaceId, entryId) =>
    Promise.resolve(
      Object.freeze(
        [...proposals.values()].filter(
          (proposal) => proposal.targetEntryId === entryId,
        ),
      ),
    ),
  );
  const appendTagProposal = vi.fn<
    AiTagProposalRepositoryPort['appendTagProposal']
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
  const decideProposal = vi.fn<AiTagProposalRepositoryPort['decideProposal']>(
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
  const processing: AiTagProposalRepositoryPort = {
    listRecentRuns,
    createRun,
    writeProgress,
    cancelRun,
    appendProposal,
    loadRun,
    listTagProposalsForEntry,
    appendTagProposal,
    decideProposal,
  };

  const proposeTags = vi.fn<AiTagProposalProviderPort['proposeTags']>(() =>
    Promise.resolve(
      Object.freeze({
        summary: 'Synthetic tags',
        contentKeywords: Object.freeze(['PostgreSQL']),
        typeKeyword: 'knowledge_explanation' as const,
        domains: Object.freeze([
          Object.freeze({keyword: 'engineering_computing' as const}),
        ]),
      }),
    ),
  );
  const provider = {
    providerKey: 'openai-responses-v1' as const,
    model: 'gpt-5-mini',
    promptVersion: 'struinfo.openai-entry-tags.v1',
    proposeTags,
  } satisfies AiTagProposalProviderPort;
  const service = new AiTagProposalService({
    workspaceId: WORKSPACE_ID,
    entries,
    processing,
    provider,
  });
  return {
    entries,
    processing,
    provider,
    reviseEntry,
    proposeTags,
    service,
    runs,
    get current() {
      return current;
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
    targetSnapshotId: '44444444-4444-4444-8444-444444444444',
    privacyScope: 'public_only',
    currentStage: 'tags',
    currentStep: '等待 OpenAI 标签提案',
    completedUnits: 0,
    attempt: 1,
    version: 1,
    createdAt: '2040-01-02T03:04:05.000Z',
    updatedAt: '2040-01-02T03:04:05.000Z',
    proposals: Object.freeze([]),
  });
}

function entry(isPrivate: boolean): Readonly<CurrentInformationEntry> {
  return Object.freeze({
    workspaceId: WORKSPACE_ID,
    entryId: ENTRY_ID,
    resourceId: '33333333-3333-4333-8333-333333333333',
    snapshotId: '44444444-4444-4444-8444-444444444444',
    revision: 1,
    revisionId: '55555555-5555-4555-8555-555555555555',
    sourceKey: 'synthetic:entry',
    capturedAt: '2040-01-02T03:04:05.000Z',
    value: Object.freeze({
      documentOrder: 0,
      titlePath: 'Synthetic Entry',
      body: 'Synthetic body',
      bodySha256: 'a'.repeat(64),
      chunkMode: 'split',
      splitRuleVersion: 'struinfo.entry-split.section.v1',
      isPrivate,
      contentKeywords: Object.freeze([]),
      domains: Object.freeze([]),
      fragmentIds: Object.freeze(['66666666-6666-4666-8666-666666666666']),
    }),
  });
}
