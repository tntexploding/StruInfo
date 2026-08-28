import {describe, expect, it} from 'vitest';

import {
  assertProcessingProposalAppend,
  assertProcessingRunCreate,
  assertProcessingRunProgress,
  canTransitionProcessingRun,
  deriveProcessingProposalId,
  deriveProcessingRunId,
} from './index.js';

const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';
const RUN_ID = '22222222-2222-4222-8222-222222222222';
const SNAPSHOT_ID = '33333333-3333-4333-8333-333333333333';
const ENTRY_A = '44444444-4444-4444-8444-444444444444';
const ENTRY_B = '55555555-5555-4555-8555-555555555555';

describe('provider-neutral processing runs', () => {
  it('accepts deterministic runs without requiring a Provider', () => {
    expect(() => {
      assertProcessingRunCreate({
        workspaceId: WORKSPACE_ID,
        runId: RUN_ID,
        idempotencyKey: 'synthetic-processing-run',
        origin: 'deterministic',
        targetSnapshotId: SNAPSHOT_ID,
        privacyScope: 'public_only',
        initialStage: 'split',
        initialStep: '准备确定性拆分',
      });
    }).not.toThrow();
  });

  it('requires a named Provider only for AI-origin runs', () => {
    expect(() => {
      assertProcessingRunCreate({
        workspaceId: WORKSPACE_ID,
        runId: RUN_ID,
        idempotencyKey: 'synthetic-ai-run',
        origin: 'ai',
        privacyScope: 'public_only',
        initialStage: 'tags',
      });
    }).toThrow();
    expect(() => {
      assertProcessingRunCreate({
        workspaceId: WORKSPACE_ID,
        runId: RUN_ID,
        idempotencyKey: 'synthetic-ai-run',
        origin: 'ai',
        providerKey: 'synthetic-provider',
        privacyScope: 'public_only',
        initialStage: 'tags',
      });
    }).not.toThrow();
  });

  it('keeps progress transitions bounded and terminal states final', () => {
    expect(canTransitionProcessingRun('queued', 'running')).toBe(true);
    expect(canTransitionProcessingRun('running', 'running')).toBe(true);
    expect(canTransitionProcessingRun('running', 'succeeded')).toBe(true);
    expect(canTransitionProcessingRun('succeeded', 'running')).toBe(false);
    expect(() => {
      assertProcessingRunProgress({
        workspaceId: WORKSPACE_ID,
        runId: RUN_ID,
        expectedVersion: 1,
        status: 'failed',
        currentStage: 'tags',
        completedUnits: 2,
        totalUnits: 1,
        errorCode: 'synthetic_failure',
      });
    }).toThrow();
  });

  it('accepts typed tag and association proposal envelopes only', () => {
    expect(() => {
      assertProcessingProposalAppend({
        workspaceId: WORKSPACE_ID,
        proposalId: deriveProcessingProposalId(RUN_ID, 0),
        runId: RUN_ID,
        ordinal: 0,
        stage: 'tags',
        kind: 'tags',
        targetEntryId: ENTRY_A,
        summary: '建议补充一个内容关键词',
        fragmentIds: Object.freeze([]),
      });
    }).not.toThrow();
    expect(() => {
      assertProcessingProposalAppend({
        workspaceId: WORKSPACE_ID,
        proposalId: deriveProcessingProposalId(RUN_ID, 1),
        runId: RUN_ID,
        ordinal: 1,
        stage: 'associations',
        kind: 'association',
        targetEntryId: ENTRY_A,
        relatedEntryId: ENTRY_B,
        summary: '建议检查两个条目的联系',
        fragmentIds: Object.freeze([]),
      });
    }).not.toThrow();
    expect(() => {
      assertProcessingProposalAppend({
        workspaceId: WORKSPACE_ID,
        proposalId: deriveProcessingProposalId(RUN_ID, 2),
        runId: RUN_ID,
        ordinal: 2,
        stage: 'associations',
        kind: 'association',
        targetEntryId: ENTRY_A,
        relatedEntryId: ENTRY_A,
        summary: '非法自联系',
        fragmentIds: Object.freeze([]),
      });
    }).toThrow();
  });

  it('derives stable run and proposal identities', () => {
    expect(
      deriveProcessingRunId(WORKSPACE_ID, 'synthetic-processing-run'),
    ).toBe(deriveProcessingRunId(WORKSPACE_ID, 'synthetic-processing-run'));
    expect(deriveProcessingProposalId(RUN_ID, 0)).not.toBe(
      deriveProcessingProposalId(RUN_ID, 1),
    );
  });
});
