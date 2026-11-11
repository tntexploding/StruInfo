import assert from 'node:assert/strict';
import {describe, expect, it, vi} from 'vitest';
import type {StructuredAnnotations} from '../entries/structured_annotations.js';
import {prepareAiEntryTagRevision} from '../entries/information_entry.js';

import type {
  CurrentInformationEntry,
  InformationEntryRepositoryPort,
} from '../entries/index.js';
import type {AiTagProposalProviderPort} from './ai_tag_proposal.js';
import {AiTagProposalService} from './ai_tag_proposal_service.js';
import type {ProcessingProposal, ProcessingRun} from './processing_contract.js';
import type {AiTagProposalRepositoryPort} from './processing_repository.js';

const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';
const ENTRY_ID = '22222222-2222-4222-8222-222222222222';

describe('unified tag proposal writes', () => {
  it('writes only annotations, preserves raw text and reuses an accepted result', async () => {
    const f = createFixture(false);
    const body = f.current.value.body;
    await f.service.start(ENTRY_ID, 'one');
    const [p] = await f.service.listForEntry(ENTRY_ID);
    expect(p?.tagPayload).not.toHaveProperty('contentKeywords');
    await f.service.accept(ENTRY_ID, required(p).proposalId);
    expect(f.current.value.body).toBe(body);
    expect(f.current.value.annotations?.labels).toHaveLength(1);
    expect(f.current.value.contentKeywords).toEqual([]);
    expect(f.current.value.domains).toEqual([]);
    expect(f.current.value.typeKeyword).toBeUndefined();
    expect(
      prepareAiEntryTagRevision(f.current, {
        originVersion: 'old-maintenance',
        typeKeyword: 'other',
        typeCustomName: 'Legacy',
        contentKeywords: ['Legacy'],
        domains: [],
      }),
    ).toBeUndefined();
    await f.service.accept(ENTRY_ID, required(p).proposalId);
    expect(f.proposeTags).toHaveBeenCalledTimes(1);
    expect(f.reviseEntry).toHaveBeenCalledTimes(1);
  });
  it('retains manual labels', async () => {
    const f = createFixture(false);
    const a = {...labelsFor(f.current), origin: 'manual' as const};
    await f.entries.reviseEntry({
      workspaceId: WORKSPACE_ID,
      entryId: ENTRY_ID,
      expectedRevision: 1,
      revisionId: ENTRY_ID,
      value: {...f.current.value, annotations: a},
    });
    await f.service.start(ENTRY_ID, 'manual');
    const [p] = await f.service.listForEntry(ENTRY_ID);
    await f.service.accept(ENTRY_ID, required(p).proposalId);
    expect(f.current.value.annotations).toEqual(a);
  });
  it('rejects foreign evidence without writing a proposal', async () => {
    const f = createFixture(false);
    const a = labelsFor(f.current);
    const label = required(a.labels[0]);
    assert('evidence' in label);
    label.evidence.quote = 'foreign body';
    f.proposeTags.mockResolvedValue({summary: 'invalid', annotations: a});
    const result = await f.service.start(ENTRY_ID, 'invalid');
    expect(result.run.status).toBe('failed');
    expect(await f.service.listForEntry(ENTRY_ID)).toEqual([]);
  });
  it('preserves a historical manual domain when adding unified tags', async () => {
    const f = createFixture(false);
    await f.entries.reviseEntry({
      workspaceId: WORKSPACE_ID,
      entryId: ENTRY_ID,
      expectedRevision: 1,
      revisionId: ENTRY_ID,
      value: {
        ...f.current.value,
        domains: [
          {
            keyword: 'other',
            customName: 'Manual domain',
            origin: 'manual',
            originVersion: 'owner',
          },
        ],
      },
    });
    await f.service.start(ENTRY_ID, 'manual-domain');
    const [p] = await f.service.listForEntry(ENTRY_ID);
    await f.service.accept(ENTRY_ID, required(p).proposalId);
    expect(f.current.value.domains[0]?.customName).toBe('Manual domain');
    expect(f.current.value.annotations).toBeUndefined();
  });
  it('keeps private content away from the provider', async () => {
    const f = createFixture(true);
    await expect(f.service.start(ENTRY_ID, 'private')).rejects.toMatchObject({
      code: 'ai_private_entry_forbidden',
    });
    expect(f.proposeTags).not.toHaveBeenCalled();
  });
  it('does not apply a proposal over a later edit', async () => {
    const f = createFixture(false);
    await f.service.start(ENTRY_ID, 'stale');
    const [p] = await f.service.listForEntry(ENTRY_ID);
    await f.entries.reviseEntry({
      workspaceId: WORKSPACE_ID,
      entryId: ENTRY_ID,
      expectedRevision: 1,
      revisionId: ENTRY_ID,
      value: {
        ...f.current.value,
        body: 'Owner edit',
        bodySha256: 'b'.repeat(64),
      },
    });
    await expect(
      f.service.accept(ENTRY_ID, required(p).proposalId),
    ).rejects.toMatchObject({code: 'ai_proposal_invalid'});
    expect(f.current.value.body).toBe('Owner edit');
  });
  it('allows unknown without fabricated labels', async () => {
    const f = createFixture(false);
    f.proposeTags.mockResolvedValue({
      summary: 'Unknown',
      annotations: {...labelsFor(f.current), status: 'unknown', labels: []},
    });
    await f.service.start(ENTRY_ID, 'unknown');
    const [p] = await f.service.listForEntry(ENTRY_ID);
    await f.service.accept(ENTRY_ID, required(p).proposalId);
    expect(f.current.value.annotations?.labels).toEqual([]);
  });
});
function createFixture(
  isPrivate: boolean,
  providerConfig: Partial<
    Pick<
      AiTagProposalProviderPort,
      'providerKey' | 'model' | 'promptVersion' | 'proposeTagsBatch'
    >
  > = {},
) {
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

  const proposeTags = vi.fn<AiTagProposalProviderPort['proposeTags']>((e) =>
    Promise.resolve({summary: 'Synthetic tags', annotations: labelsFor(e)}),
  );
  const provider = {
    providerKey: 'openai-responses-v1' as const,
    model: 'gpt-5-mini',
    promptVersion: 'struinfo.openai-entry-tags.v1',
    ...providerConfig,
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
    appendTagProposal,
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

function labelsFor(e: CurrentInformationEntry): StructuredAnnotations {
  const dimension = {
    id: '11111111-1111-4111-8111-111111111119',
    name: '议题',
    role: 'issue' as const,
    description: '',
    enabled: true,
  };
  return {
    schemaVersion: 1,
    vocabularyRevision: 0,
    dimensions: [dimension],
    inputRevision: e.revision,
    inputBodySha256: e.value.bodySha256,
    origin: 'ai',
    originVersion: 'synthetic.unified',
    status: 'complete',
    note: '',
    readingState: 'unread',
    claims: [],
    labels: [
      {
        dimensionId: dimension.id,
        term: {
          id: '11111111-1111-4111-8111-111111111118',
          dimensionId: dimension.id,
          label: 'Synthetic',
          meaning: 'synthetic test',
        },
        wording: 'Synthetic',
        primary: true,
        evidence: {
          start: 0,
          end: Array.from(e.value.body).length,
          quote: e.value.body,
        },
      },
    ],
  };
}

function required<T>(value: T | undefined): T {
  assert(value !== undefined);
  return value;
}
