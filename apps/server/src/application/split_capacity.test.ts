import {describe, expect, it, vi} from 'vitest';
import {
  agentTaskRequestSchema,
  agentTaskStateSchema,
  type AgentTask,
  type AgentTaskStep,
} from './agent_task_contract.js';
import {ingestionSettingsSchema} from './ingestion_contract.js';
import {
  AgentTaskActions,
  type AgentTaskActionsDependencies,
} from './agent_task_actions.js';
import {assertProcessingProposalAppend} from '../modules/processing/processing.js';
import type {ProcessingProposal} from '../modules/processing/processing_contract.js';
const id = (i: number) =>
  '00000000-0000-4000-8000-' + String(i).padStart(12, '0');
const groups = Array.from({length: 64}, (_, i) => ({
  titlePath: 'Synthetic entry ' + i.toString(),
  startOrdinal: i * 2,
  endOrdinal: i * 2 + 1,
}));
function splitProposal(count = 64, fragments = 128): ProcessingProposal {
  const fragmentIds = Array.from({length: fragments}, (_, i) => id(i + 1));
  return {
    workspaceId: id(200),
    proposalId: id(201),
    runId: id(202),
    ordinal: 0,
    stage: 'split',
    kind: 'split',
    targetSnapshotId: id(203),
    summary: 'Synthetic collection',
    status: 'pending_review',
    createdAt: '2040-01-01T00:00:00.000Z',
    fragmentIds,
    splitPayload: {
      providerModel: 'synthetic',
      promptVersion: 'synthetic.v1',
      splitRuleVersion: 'struinfo.entry-split.ai-group.v1',
      entries: Array.from({length: count}, (_, i) => ({
        titlePath: 'Synthetic entry ' + i.toString(),
        fragmentIds:
          count === 1
            ? fragmentIds
            : fragmentIds.slice(i * 2, i === count - 1 ? undefined : i * 2 + 2),
      })),
    },
  };
}
describe('split capacity across durable task and proposal boundaries', () => {
  it('accepts 64-entry task/policy limits without changing old or omitted budgets', () => {
    const request = {kind: 'document', snapshotId: id(1), maxEntries: 64};
    expect(agentTaskRequestSchema.parse(request)).toMatchObject({
      maxEntries: 64,
      maxModelCalls: 24,
    });
    expect(ingestionSettingsSchema.parse({maxEntries: 64}).maxEntries).toBe(64);
    expect(
      agentTaskRequestSchema.safeParse({...request, maxEntries: 65}).success,
    ).toBe(false);
    expect(ingestionSettingsSchema.safeParse({maxEntries: 65}).success).toBe(
      false,
    );
    expect(
      agentTaskRequestSchema.parse({...request, maxEntries: 24}),
    ).toMatchObject({maxEntries: 24, maxModelCalls: 24});
    expect(ingestionSettingsSchema.parse({}).maxEntries).toBe(12);
  });
  it('admits 64 external groups through ordinal 127 and rejects both overflows', () => {
    const request = {
      kind: 'split',
      snapshotId: id(1),
      result: {summary: 'Synthetic', groups},
    };
    expect(agentTaskRequestSchema.parse(request)).toEqual(request);
    expect(
      agentTaskRequestSchema.safeParse({
        ...request,
        result: {...request.result, groups: [...groups, groups[0]]},
      }).success,
    ).toBe(false);
    expect(
      agentTaskRequestSchema.safeParse({
        ...request,
        result: {...request.result, groups: [{...groups[0], endOrdinal: 128}]},
      }).success,
    ).toBe(false);
    expect(
      agentTaskRequestSchema.safeParse({
        ...request,
        result: {
          ...request.result,
          groups: groups.map((g) => ({...g, titlePath: '合'.repeat(240)})),
        },
      }).success,
    ).toBe(false);
  });
  it('validates all 128 evidence links for both a collection and a whole article', () => {
    expect(() => {
      assertProcessingProposalAppend(splitProposal());
    }).not.toThrow();
    expect(() => {
      assertProcessingProposalAppend(splitProposal(1));
    }).not.toThrow();
    expect(() => {
      assertProcessingProposalAppend(splitProposal(64, 129));
    }).toThrow();
    expect(() => {
      assertProcessingProposalAppend(splitProposal(1, 129));
    }).toThrow();
    expect(() => {
      assertProcessingProposalAppend(splitProposal(65, 130));
    }).toThrow();
  });
  it('can persist the expanded tag/recall plan but keeps the 64-call cap', () => {
    const state = {
      status: 'running',
      phase: 'recall',
      calls: 40,
      steps: Array.from({length: 154}, (_, i) => ({
        kind: 'recall',
        targetId: id(i),
        attempt: 0,
        complete: false,
      })),
    };
    expect(agentTaskStateSchema.safeParse(state).success).toBe(true);
    expect(agentTaskStateSchema.safeParse({...state, calls: 65}).success).toBe(
      false,
    );
    expect(
      agentTaskStateSchema.safeParse({
        ...state,
        steps: [...state.steps, state.steps[0]],
      }).success,
    ).toBe(false);
  });
  it('honors an existing 24-entry authorization while accepting a new 64-entry authorization', async () => {
    const accept = vi.fn(() => Promise.resolve());
    const actions = new AgentTaskActions({
      split: {accept},
    } as unknown as AgentTaskActionsDependencies);
    const step: AgentTaskStep = {
      kind: 'split',
      targetId: id(203),
      attempt: 0,
      complete: false,
    };
    const task = {
      request: {
        kind: 'document',
        snapshotId: id(203),
        maxEntries: 24,
        maxRelations: 4,
        maxModelCalls: 24,
      },
    } as AgentTask;
    await expect(
      actions.accept(task, step, splitProposal()),
    ).rejects.toMatchObject({code: 'entry_budget_exceeded'});
    expect(accept).not.toHaveBeenCalled();
    await actions.accept(
      {
        ...task,
        request: {
          ...task.request,
          kind: 'document',
          snapshotId: id(203),
          maxEntries: 64,
          maxRelations: 4,
          maxModelCalls: 24,
        },
      },
      step,
      splitProposal(),
    );
    expect(accept).toHaveBeenCalledWith(id(203), id(201));
  });
});
