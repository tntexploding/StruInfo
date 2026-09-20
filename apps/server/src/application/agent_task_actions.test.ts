import {requireOperationValue} from './operation_error.js';
import type {DocumentIntakeService} from './document_intake_service.js';
import {describe, it, expect, vi} from 'vitest';
import type {CurrentInformationEntry} from '../modules/entries/index.js';
import type {
  ProcessingRun,
  ProcessingProposal,
} from '../modules/processing/processing_contract.js';
import type {AiTagProposalRepositoryPort} from '../modules/processing/processing_repository.js';
import {
  AgentTaskActions,
  type AgentTaskActionsDependencies,
} from './agent_task_actions.js';
import type {
  AgentTask,
  AgentTaskRequest,
  AgentTaskStep,
} from './agent_task_contract.js';
const W = '00000000-0000-4000-8000-000000000001',
  E = '00000000-0000-4000-8000-000000000002',
  S = '00000000-0000-4000-8000-000000000003';
function fixture(isPrivate = false) {
  let current: CurrentInformationEntry = {
    workspaceId: W,
    entryId: E,
    snapshotId: S,
    resourceId: S,
    revision: 1,
    revisionId: S,
    sourceKey: 'synthetic',
    capturedAt: '2040-01-01T00:00:00.000Z',
    value: {
      documentOrder: 1,
      titlePath: 'Synthetic',
      body: 'Synthetic evidence.',
      bodySha256: 'a'.repeat(64),
      chunkMode: 'whole',
      splitRuleVersion: 'struinfo.entry-split.ai-group.v1',
      isPrivate,
      contentKeywords: [],
      domains: [],
      fragmentIds: [S],
    },
  };
  const proposals = new Map<string, ProcessingProposal>(),
    runs = new Map<string, ProcessingRun>();
  const processing: AiTagProposalRepositoryPort = {
    createRun: (c) => {
      if (runs.has(c.runId)) return Promise.resolve('unchanged');
      runs.set(c.runId, {
        ...c,
        status: 'queued',
        currentStage: c.initialStage,
        completedUnits: 0,
        attempt: 1,
        version: 1,
        createdAt: '2040-01-01T00:00:00.000Z',
        updatedAt: '2040-01-01T00:00:00.000Z',
        proposals: [],
      });
      return Promise.resolve('applied');
    },
    writeProgress: (w) => {
      const r = requireOperationValue(runs.get(w.runId));
      runs.set(w.runId, {...r, ...w, version: r.version + 1});
      return Promise.resolve('applied');
    },
    loadRun: (_w, id) => {
      const r = runs.get(id);
      return Promise.resolve(
        r
          ? {
              ...r,
              proposals: [...proposals.values()].filter((p) => p.runId === id),
            }
          : undefined,
      );
    },
    appendTagProposal: (p) => {
      proposals.set(p.proposalId, {
        ...p,
        status: 'pending_review',
        createdAt: '2040-01-01T00:00:00.000Z',
      });
      return Promise.resolve('applied');
    },
    decideProposal: (_w, id, status) => {
      const p = proposals.get(id);
      if (!p) return Promise.resolve('not_found');
      proposals.set(id, {...p, status});
      return Promise.resolve('applied');
    },
    listTagProposalsForEntry: () => Promise.resolve([...proposals.values()]),
    listRecentRuns: () => Promise.resolve([...runs.values()]),
    cancelRun: () => Promise.resolve('applied'),
    appendProposal: () => Promise.resolve('applied'),
  };
  const reviseEntry = vi.fn(
    (w: {
      expectedRevision: number;
      revisionId: string;
      value: CurrentInformationEntry['value'];
    }) => {
      if (current.revision !== w.expectedRevision)
        return Promise.resolve('stale' as const);
      current = {
        ...current,
        revision: current.revision + 1,
        revisionId: w.revisionId,
        value: w.value,
      };
      return Promise.resolve('applied' as const);
    },
  );
  const dependencies = {
    workspaceId: W,
    entries: {
      loadCurrentEntries: () => Promise.resolve([current]),
      reviseEntry,
    },
    processing,
    associations: {
      loadAssociationSnapshot: () =>
        Promise.resolve({overrides: [], projections: []}),
    },
    evidence: {loadSnapshot: vi.fn(() => Promise.resolve({isPrivate: true}))},
    blobStore: {read: vi.fn()},
  } as unknown as AgentTaskActionsDependencies;
  const request: AgentTaskRequest = {
    kind: 'tags',
    entryId: E,
    expectedRevision: 1,
    result: {
      summary: 'Synthetic classification',
      contentKeywords: ['Synthetic'],
      typeKeyword: 'knowledge_explanation',
      domains: [{keyword: 'engineering_computing'}],
    },
  };
  const task = {
    taskId: S,
    workspaceId: W,
    request,
    model: 'external-agent',
  } as AgentTask;
  const step: AgentTaskStep = {
    kind: 'tags',
    targetId: E,
    expectedRevision: 1,
    attempt: 1,
    complete: false,
  };
  return {
    dependencies,
    request,
    task,
    step,
    reviseEntry,
    runs,
    get current() {
      return current;
    },
    edit() {
      current = {...current, revision: current.revision + 1};
    },
  };
}
describe('Agent actions reuse actual proposal acceptance', () => {
  it.each(['intake_held', 'intake_blocked'] as const)(
    'rechecks a planned relation candidate when intake changes to %s',
    async (decision) => {
      const f = fixture();
      const candidate = {
        ...f.current,
        entryId: '00000000-0000-4000-8000-000000000004',
        snapshotId: '00000000-0000-4000-8000-000000000005',
      };
      let excluded = false;
      const actions = new AgentTaskActions({
        ...f.dependencies,
        entries: {
          ...f.dependencies.entries,
          loadCurrentEntries: () => Promise.resolve([f.current, candidate]),
        },
        intake: {
          guard: (snapshotId: string) =>
            Promise.resolve(
              excluded && snapshotId === candidate.snapshotId
                ? decision
                : undefined,
            ),
        } as unknown as DocumentIntakeService,
      });
      const task: AgentTask = {
        ...f.task,
        request: {
          kind: 'document',
          snapshotId: S,
          maxEntries: 8,
          maxRelations: 2,
          maxModelCalls: 14,
        },
        state: {
          status: 'running',
          calls: 2,
          phase: 'relations',
          steps: [
            {
              kind: 'relation',
              targetId: E,
              relatedEntryId: candidate.entryId,
              attempt: 1,
              complete: false,
            },
          ],
        },
      };
      expect(await actions.guard(task)).toBeUndefined();
      excluded = true;
      expect(await actions.guard(task)).toBe(decision);
      excluded = false;
      expect(await actions.guard(task)).toBeUndefined();
    },
  );
  it('excludes earlier captures of the same article while retaining other matching sources', async () => {
    const f = fixture();
    const current: CurrentInformationEntry = {
      ...f.current,
      revision: 2,
      canonicalUri: 'https://example.invalid/article',
      value: {
        ...f.current.value,
        contentKeywords: [
          {
            displayValue: 'Synthetic',
            normalizedValue: 'synthetic',
            origin: 'manual',
            originVersion: 'synthetic-v1',
          },
        ],
      },
    };
    const previous = {
      ...current,
      entryId: '00000000-0000-4000-8000-000000000004',
      snapshotId: '00000000-0000-4000-8000-000000000005',
    };
    const other = {
      ...previous,
      entryId: '00000000-0000-4000-8000-000000000006',
      canonicalUri: 'https://example.invalid/other',
    };
    const actions = new AgentTaskActions({
      ...f.dependencies,
      entries: {
        ...f.dependencies.entries,
        loadCurrentEntries: () => Promise.resolve([current, previous, other]),
      },
    });
    const task = {
      ...f.task,
      request: {
        kind: 'document',
        snapshotId: S,
        maxEntries: 8,
        maxRelations: 2,
        maxModelCalls: 14,
      },
      state: {steps: [{...f.step, expectedRevision: 1, complete: true}]},
    } as AgentTask;
    const steps = await actions.relationSteps(task);
    expect(steps).toHaveLength(1);
    expect(steps[0]?.relatedEntryId).toBe(other.entryId);
  });
  it('writes external tags without an internal model and preserves source/body/scores', async () => {
    const f = fixture();
    const actions = new AgentTaskActions(f.dependencies);
    await actions.preflight(f.request);
    const run = await actions.generate(f.task, f.step, 'synthetic');
    expect(run.providerKey).toBe('external-agent-v1');
    const proposal = requireOperationValue(run.proposals[0]);
    const source = f.current.value.body,
      fragments = f.current.value.fragmentIds;
    await actions.accept(f.task, f.step, proposal);
    expect(f.current.revision).toBe(2);
    expect(f.current.value.body).toBe(source);
    expect(f.current.value.fragmentIds).toEqual(fragments);
    expect(f.current.value.contentKeywords[0]).toMatchObject({
      origin: 'ai',
      originVersion: 'external-agent:external-agent:struinfo.agent-tool.v1',
    });
    await actions.accept(f.task, f.step, {...proposal, status: 'accepted'});
    expect(f.reviseEntry).toHaveBeenCalledTimes(1);
  });
  it('rejects stale inputs and stops when a manual edit supersedes an accepted result', async () => {
    const f = fixture();
    const actions = new AgentTaskActions(f.dependencies);
    const run = await actions.generate(f.task, f.step, 'synthetic');
    const proposal = requireOperationValue(run.proposals[0]);
    await actions.accept(f.task, f.step, proposal);
    f.edit();
    await expect(
      actions.accept(f.task, f.step, {...proposal, status: 'accepted'}),
    ).rejects.toMatchObject({code: 'stale_entry_revision'});
    await expect(actions.preflight(f.request)).rejects.toMatchObject({
      code: 'stale_entry_revision',
    });
  });
  it('rejects private entries before creating proposals and rejects missing model configuration', async () => {
    const f = fixture(true);
    const actions = new AgentTaskActions(f.dependencies);
    await expect(actions.preflight(f.request)).rejects.toMatchObject({
      code: 'public_entry_not_found',
    });
    await expect(
      actions.preflight({
        kind: 'document',
        snapshotId: S,
        maxEntries: 12,
        maxRelations: 4,
        maxModelCalls: 24,
      }),
    ).rejects.toMatchObject({code: 'ai_not_configured'});
    expect(f.runs.size).toBe(0);
  });
  it('rejects private documents before blob or model access', async () => {
    const f = fixture();
    const provider = {model: 'synthetic', start: vi.fn()};
    const deps = {
      ...f.dependencies,
      split: provider,
      tags: provider,
      relations: provider,
    } as unknown as AgentTaskActionsDependencies;
    await expect(
      new AgentTaskActions(deps).preflight({
        kind: 'document',
        snapshotId: S,
        maxEntries: 12,
        maxRelations: 4,
        maxModelCalls: 24,
      }),
    ).rejects.toMatchObject({code: 'private_model_transfer_forbidden'});
    expect(provider.start).not.toHaveBeenCalled();
  });
});

describe('recovery checkpoint validation', () => {
  it('keeps matching completed tags but rejects later manual revisions', async () => {
    const f = fixture();
    f.edit();
    const task = {
      ...f.task,
      request: {
        kind: 'document',
        snapshotId: S,
        maxEntries: 12,
        maxRelations: 0,
        maxModelCalls: 24,
      },
      state: {
        status: 'failed',
        calls: 24,
        phase: 'recall',
        steps: [
          {kind: 'split', targetId: S, complete: true, attempt: 1},
          {
            kind: 'tags',
            targetId: E,
            expectedRevision: 1,
            complete: true,
            attempt: 1,
          },
        ],
      },
    } as AgentTask;
    const actions = new AgentTaskActions(f.dependencies);
    await expect(actions.validateRecovery(task)).resolves.toBeUndefined();
    f.edit();
    await expect(actions.validateRecovery(task)).rejects.toMatchObject({
      code: 'document_changed_after_tags',
    });
  });
});

it('batches recall only for unchanged public entries and reads the collection once', async () => {
  const f = fixture();
  const second = {
    ...f.current,
    entryId: '00000000-0000-4000-8000-000000000010',
  };
  const hidden = {
    ...f.current,
    entryId: '00000000-0000-4000-8000-000000000011',
    value: {...f.current.value, isPrivate: true},
  };
  const load = vi.fn(() => Promise.resolve([f.current, second, hidden]));
  const plan = {concepts: [{term: 'Synthetic', variants: ['合成']}]};
  const planRecalls = vi.fn(() => Promise.resolve([plan, plan]));
  const intelligence = {
    model: 'synthetic-model',
    reviewIntake: vi.fn(),
    planRecall: vi.fn(() => Promise.resolve(plan)),
    planRecalls,
  };
  const actions = new AgentTaskActions({
    ...f.dependencies,
    entries: {...f.dependencies.entries, loadCurrentEntries: load},
    intelligence,
  });
  const steps: AgentTaskStep[] = [f.current, second].map((e) => ({
    kind: 'recall',
    targetId: e.entryId,
    expectedRevision: e.revision,
    attempt: 0,
    complete: false,
  }));
  const first = requireOperationValue(steps[0]);
  const task = {
    ...f.task,
    state: {status: 'running', phase: 'recall', calls: 4, steps},
  } as AgentTask;
  expect(await actions.recallGroup(task, first)).toEqual(steps);
  expect(load).toHaveBeenCalledTimes(1);
  expect(await actions.recallGroupPlans(steps)).toEqual([plan, plan]);
  expect(planRecalls).toHaveBeenCalledTimes(1);
  expect(load).toHaveBeenCalledTimes(2);
  f.edit();
  await expect(actions.recallGroupPlans(steps)).rejects.toMatchObject({
    code: 'stale_entry_revision',
  });
  await expect(
    actions.recallGroupPlans([{...first, targetId: hidden.entryId}]),
  ).rejects.toMatchObject({code: 'public_entry_not_found'});
  expect(planRecalls).toHaveBeenCalledTimes(1);
});

it('keeps long recall inputs in separate calls instead of overflowing a batch', async () => {
  const f = fixture();
  const entries = [0, 1].map((n) => ({
    ...f.current,
    entryId: `00000000-0000-4000-8000-${String(20 + n).padStart(12, '0')}`,
    value: {...f.current.value, body: 'x'.repeat(70_000)},
  }));
  const actions = new AgentTaskActions({
    ...f.dependencies,
    entries: {
      ...f.dependencies.entries,
      loadCurrentEntries: () => Promise.resolve(entries),
    },
    intelligence: {
      model: 'synthetic-model',
      reviewIntake: vi.fn(),
      planRecall: vi.fn(),
      planRecalls: vi.fn(),
    },
  });
  const steps: AgentTaskStep[] = entries.map((e) => ({
    kind: 'recall',
    targetId: e.entryId,
    expectedRevision: e.revision,
    attempt: 0,
    complete: false,
  }));
  const first = requireOperationValue(steps[0]);
  const task = {
    ...f.task,
    state: {status: 'running', phase: 'recall', calls: 4, steps},
  } as AgentTask;
  expect(await actions.recallGroup(task, first)).toEqual([first]);
});
