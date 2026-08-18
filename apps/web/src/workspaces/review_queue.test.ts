import {describe, expect, it} from 'vitest';

import type {
  CurationState,
  EvidenceFragment,
  EvidenceSnapshot,
} from '../api/m1c_api_contract.js';
import {
  createReviewQueueCandidates,
  createReviewTargetOptions,
  firstPendingReviewKey,
  nextReviewKey,
} from './review_queue_model.js';

const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';
const RESOURCE_ID = '22222222-2222-4222-8222-222222222222';
const SNAPSHOT_ID = '33333333-3333-4333-8333-333333333333';
const STRUCTURE_ID = '44444444-4444-4444-8444-444444444444';
const TARGET_ID = '77777777-7777-4777-8777-777777777777';

describe('M1C review queue', () => {
  it('reconstructs only persisted section Fragments as intake candidates', () => {
    const evidence = syntheticEvidence([
      fragment('50000000-0000-4000-8000-000000000001', 'document', '文档'),
      fragment('50000000-0000-4000-8000-000000000002', 'section', '独立条目'),
      fragment('50000000-0000-4000-8000-000000000003', 'paragraph', '叶子段落'),
    ]);
    const options = createReviewTargetOptions([evidence], evidence);
    const queue = createReviewQueueCandidates(options, emptyCuration());

    expect(queue).toHaveLength(1);
    expect(queue[0]).toMatchObject({
      id: '50000000-0000-4000-8000-000000000002',
      reviewed: false,
      fragment: {nodeKind: 'section', selectedText: '独立条目'},
    });
    expect(firstPendingReviewKey(queue)).toBe(
      'fragment:50000000-0000-4000-8000-000000000002',
    );
  });

  it('maps current decisions to progress and advances to the next pending unit', () => {
    const firstId = '50000000-0000-4000-8000-000000000011';
    const secondId = '50000000-0000-4000-8000-000000000012';
    const evidence = syntheticEvidence([
      fragment(firstId, 'section', '已审核条目'),
      fragment(secondId, 'section', '下一条'),
    ]);
    const state: Readonly<CurationState> = {
      ...emptyCuration(),
      targets: [
        {
          workspaceId: WORKSPACE_ID,
          targetId: TARGET_ID,
          currentVersion: 1,
          kind: 'fragment',
          snapshotId: SNAPSHOT_ID,
          fragmentId: firstId,
        },
      ],
      decisions: [
        {
          decisionId: '88888888-8888-4888-8888-888888888888',
          targetId: TARGET_ID,
          currentRevision: 1,
          currentRevisionId: '99999999-9999-4999-8999-999999999999',
          value: {action: 'source_only', reasonCodes: []},
        },
      ],
    };
    const queue = createReviewQueueCandidates(
      createReviewTargetOptions([evidence], evidence),
      state,
    );

    expect(queue.map(({action, reviewed}) => ({action, reviewed}))).toEqual([
      {action: 'source_only', reviewed: true},
      {action: undefined, reviewed: false},
    ]);
    expect(firstPendingReviewKey(queue)).toBe(`fragment:${secondId}`);
    expect(nextReviewKey(queue, `fragment:${firstId}`)).toBe(
      `fragment:${secondId}`,
    );
  });
});

function emptyCuration(): Readonly<CurationState> {
  return {
    terms: [],
    targets: [],
    assignments: [],
    decisions: [],
    assessments: [],
  };
}

function fragment(
  fragmentId: string,
  nodeKind: EvidenceFragment['nodeKind'],
  selectedText: string,
): Readonly<EvidenceFragment> {
  return {
    fragmentId,
    structureId: STRUCTURE_ID,
    nodeId: `node-${fragmentId}`,
    nodeKind,
    codePointRange: {start: 0, end: selectedText.length},
    lineRange: {start: 1, end: 1},
    selectedTextSha256: 'a'.repeat(64),
    selectedText,
  };
}

function syntheticEvidence(
  fragments: readonly Readonly<EvidenceFragment>[],
): Readonly<EvidenceSnapshot> {
  return {
    workspaceId: WORKSPACE_ID,
    snapshotId: SNAPSHOT_ID,
    resourceId: RESOURCE_ID,
    resourceKind: 'git_file',
    sourceKey: 'synthetic:weekly',
    capturedAt: '2040-01-02T03:04:05.000Z',
    fragmentCount: fragments.length,
    rawSha256: 'b'.repeat(64),
    canonicalContentSha256: 'c'.repeat(64),
    canonicalizationVersion: 'utf8-lf-v1',
    structures: [
      {
        structureId: STRUCTURE_ID,
        parserName: 'struinfo-ruanyf-weekly',
        parserVersion: '1',
        textNormalizationVersion: 'utf8-lf-v1',
        structureSha256: 'd'.repeat(64),
        textBlob: {algorithm: 'sha256', digest: 'c'.repeat(64), byteLength: 42},
        normalizedText: fragments
          .map(({selectedText}) => selectedText)
          .join('\n'),
        fragments,
      },
    ],
  };
}
