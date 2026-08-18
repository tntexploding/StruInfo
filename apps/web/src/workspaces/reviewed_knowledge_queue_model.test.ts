import {describe, expect, it, vi} from 'vitest';

import type {
  CurationState,
  EvidenceFragment,
  EvidenceSnapshot,
  KnowledgeSearchItem,
  ReviewVocabularyPreferences,
} from '../api/m1c_api_contract.js';
import {
  createQuickKnowledgeCommand,
  createQuickKnowledgeDraft,
  createReviewedKnowledgeQueue,
  firstPendingKnowledgeKey,
  fragmentKnowledgeTitle,
  loadSnapshotKnowledgeItems,
  nextPendingKnowledgeKey,
} from './reviewed_knowledge_queue_model.js';

const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';
const RESOURCE_ID = '22222222-2222-4222-8222-222222222222';
const SNAPSHOT_ID = '33333333-3333-4333-8333-333333333333';
const STRUCTURE_ID = '44444444-4444-4444-8444-444444444444';
const FIRST_FRAGMENT_ID = '55555555-5555-4555-8555-555555555551';
const SECOND_FRAGMENT_ID = '55555555-5555-4555-8555-555555555552';
const FIRST_TARGET_ID = '66666666-6666-4666-8666-666666666661';
const SECOND_TARGET_ID = '66666666-6666-4666-8666-666666666662';
const TERM_ID = '77777777-7777-4777-8777-777777777777';

describe('reviewed Fragment to formal knowledge queue', () => {
  it('keeps only eligible reviewed Fragments and applies external vocabulary rules', () => {
    const evidence = syntheticEvidence(false);
    const state = syntheticCuration('source_only');
    const preferences: Readonly<ReviewVocabularyPreferences> = {
      aliases: [],
      links: [],
      knowledgeKinds: [{keyword: '合成工具', knowledgeKind: 'resource'}],
    };

    const entries = createReviewedKnowledgeQueue(
      state,
      evidence,
      preferences,
      [],
    );

    expect(entries).toHaveLength(1);
    const entry = entries[0];
    expect(entry).toBeDefined();
    if (entry === undefined) throw new Error('missing synthetic queue entry');
    expect(entry).toMatchObject({
      key: FIRST_TARGET_ID,
      action: 'full',
      expectedDecisionRevision: 2,
      keywords: ['合成工具'],
      suggestedKnowledgeKind: 'resource',
      processingPlan: {kind: 'single_item', label: '短条目单项'},
      formalItems: [],
    });
    expect(createQuickKnowledgeDraft(entry)).toMatchObject({
      title: '合成工具',
      knowledgeKind: 'resource',
      epistemicRole: 'summary',
      reviewState: 'confirmed',
    });
  });

  it('maps current searchable items to their exact source Fragment and advances pending work', () => {
    const evidence = syntheticEvidence(false);
    const state = syntheticCuration('full');
    const formalItem = syntheticSearchItem(FIRST_FRAGMENT_ID);
    const entries = createReviewedKnowledgeQueue(
      state,
      evidence,
      {aliases: [], links: [], knowledgeKinds: []},
      [formalItem],
    );

    expect(entries).toHaveLength(2);
    expect(entries[0]?.formalItems).toEqual([formalItem]);
    expect(entries[1]?.formalItems).toEqual([]);
    expect(firstPendingKnowledgeKey(entries)).toBe(SECOND_TARGET_ID);
    expect(nextPendingKnowledgeKey(entries, FIRST_TARGET_ID)).toBe(
      SECOND_TARGET_ID,
    );
  });

  it('extracts a semantic title without preserving the Markdown destination URL', () => {
    expect(
      fragmentKnowledgeTitle(
        '5、[为什么中心极限定理无处不在？](https://example.invalid/a_(b))',
      ),
    ).toBe('为什么中心极限定理无处不在？');
    expect(fragmentKnowledgeTitle('## **合成标题**')).toBe('合成标题');
  });

  it('keeps the complete Fragment body so oversized entries can be split without data loss', () => {
    const selectedText = `合成标题\n${'长'.repeat(20_001)}`;
    const evidence = syntheticEvidence(false, selectedText);
    const entries = createReviewedKnowledgeQueue(
      syntheticCuration('source_only'),
      evidence,
      {aliases: [], links: [], knowledgeKinds: []},
      [],
    );
    const entry = entries[0];
    expect(entry).toBeDefined();
    if (entry === undefined) throw new Error('missing synthetic queue entry');

    expect(createQuickKnowledgeDraft(entry).body).toBe(selectedText);
    expect(Array.from(createQuickKnowledgeDraft(entry).body)).toHaveLength(
      20_006,
    );
  });

  it('builds one source-backed eligible-target command without AI or implicit relations', () => {
    const entries = createReviewedKnowledgeQueue(
      syntheticCuration('source_only'),
      syntheticEvidence(false),
      {aliases: [], links: [], knowledgeKinds: []},
      [],
    );
    const entry = entries[0];
    expect(entry).toBeDefined();
    if (entry === undefined) throw new Error('missing synthetic queue entry');
    const draft = {
      ...createQuickKnowledgeDraft(entry),
      epistemicRole: 'source_claim' as const,
    };
    const command = createQuickKnowledgeCommand(entry, draft, {
      commandIdempotencyKey: 'synthetic-command',
      itemId: '88888888-8888-4888-8888-888888888888',
    });

    expect(command).toMatchObject({
      commandIdempotencyKey: 'synthetic-command',
      request: {
        authorization: {
          kind: 'eligible_target',
          target: {kind: 'fragment', fragmentId: FIRST_FRAGMENT_ID},
          expectedDecisionRevision: 2,
        },
        operations: [
          {
            kind: 'put_item',
            expectedRevision: 0,
            provenance: {
              citations: [FIRST_FRAGMENT_ID],
              fragmentDerivations: [],
              knowledgeDerivations: [],
            },
          },
        ],
      },
    });
  });

  it('reads every source-scoped search page and carries explicit privacy scope', async () => {
    const cursor = {
      schemaVersion: 1 as const,
      querySha256: 'a'.repeat(64),
      matchRank: 4 as const,
      normalizedTitle: '合成标题',
      itemId: '88888888-8888-4888-8888-888888888888',
    };
    const first = syntheticSearchItem(FIRST_FRAGMENT_ID);
    const second = syntheticSearchItem(SECOND_FRAGMENT_ID, 2);
    const search = vi
      .fn()
      .mockResolvedValueOnce({
        statusCode: 200,
        body: {
          status: 'ok',
          querySha256: 'a'.repeat(64),
          totalCount: 2,
          items: [first],
          nextCursor: cursor,
        },
      })
      .mockResolvedValueOnce({
        statusCode: 200,
        body: {
          status: 'ok',
          querySha256: 'a'.repeat(64),
          totalCount: 2,
          items: [second],
        },
      });

    await expect(
      loadSnapshotKnowledgeItems(syntheticEvidence(true), search),
    ).resolves.toEqual([first, second]);
    expect(search).toHaveBeenCalledTimes(2);
    expect(search.mock.calls[0]?.[0]).toMatchObject({
      includePrivate: true,
      request: {
        filters: {
          source: {
            kind: 'snapshot',
            snapshotId: SNAPSHOT_ID,
            inputKinds: ['citation', 'derivation'],
          },
        },
        page: {limit: 100},
      },
    });
    expect(search.mock.calls[1]?.[0]).toMatchObject({
      request: {page: {after: cursor}},
    });
  });
});

function syntheticEvidence(
  isPrivate: boolean,
  firstSelectedText = '[合成工具](https://example.invalid/tool)\n\n一项合成用途说明。',
): Readonly<EvidenceSnapshot> {
  const fragments = [
    fragment(FIRST_FRAGMENT_ID, firstSelectedText),
    fragment(SECOND_FRAGMENT_ID, '第二个合成条目。'),
  ];
  return {
    workspaceId: WORKSPACE_ID,
    snapshotId: SNAPSHOT_ID,
    resourceId: RESOURCE_ID,
    resourceKind: 'git_file',
    sourceKey: 'synthetic:weekly',
    ...(isPrivate ? {isPrivate: true as const} : {}),
    capturedAt: '2040-01-02T03:04:05.000Z',
    fragmentCount: fragments.length,
    rawSha256: 'b'.repeat(64),
    canonicalContentSha256: 'c'.repeat(64),
    canonicalizationVersion: 'utf8-lf-v1',
    structures: [
      {
        structureId: STRUCTURE_ID,
        parserName: 'commonmark',
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

function syntheticCuration(
  secondAction: 'full' | 'source_only',
): Readonly<CurationState> {
  return {
    terms: [
      {
        workspaceId: WORKSPACE_ID,
        termId: TERM_ID,
        currentRevision: 1,
        currentRevisionId: '99999999-9999-4999-8999-999999999991',
        value: {displayName: '合成工具', lifecycle: 'active'},
      },
    ],
    targets: [
      target(FIRST_TARGET_ID, FIRST_FRAGMENT_ID),
      target(SECOND_TARGET_ID, SECOND_FRAGMENT_ID),
    ],
    assignments: [
      {
        assignmentId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        targetId: FIRST_TARGET_ID,
        termId: TERM_ID,
        state: 'assigned',
      },
    ],
    decisions: [
      decision(FIRST_TARGET_ID, 'full', 2),
      decision(SECOND_TARGET_ID, secondAction, 1),
    ],
    assessments: [],
  };
}

function target(targetId: string, fragmentId: string) {
  return {
    workspaceId: WORKSPACE_ID,
    targetId,
    currentVersion: 1,
    kind: 'fragment' as const,
    fragmentId,
  };
}

function decision(
  targetId: string,
  action: 'full' | 'source_only',
  currentRevision: number,
) {
  return {
    decisionId:
      targetId === FIRST_TARGET_ID
        ? 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1'
        : 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2',
    targetId,
    currentRevision,
    currentRevisionId:
      targetId === FIRST_TARGET_ID
        ? 'cccccccc-cccc-4ccc-8ccc-ccccccccccc1'
        : 'cccccccc-cccc-4ccc-8ccc-ccccccccccc2',
    value: {action, reasonCodes: []},
  };
}

function fragment(
  fragmentId: string,
  selectedText: string,
): Readonly<EvidenceFragment> {
  return {
    fragmentId,
    structureId: STRUCTURE_ID,
    nodeId: `node-${fragmentId}`,
    nodeKind: 'section',
    codePointRange: {start: 0, end: Array.from(selectedText).length},
    lineRange: {start: 1, end: selectedText.split('\n').length},
    selectedTextSha256: 'e'.repeat(64),
    selectedText,
  };
}

function syntheticSearchItem(
  fragmentId: string,
  ordinal = 1,
): Readonly<KnowledgeSearchItem> {
  const suffix = ordinal.toString().padStart(12, '0');
  return {
    itemId: `88888888-8888-4888-8888-${suffix}`,
    revision: 1,
    revisionId: `99999999-9999-4999-8999-${suffix}`,
    value: {
      knowledgeKind: 'concept',
      epistemicRole: 'summary',
      reviewState: 'confirmed',
      title: `合成知识 ${ordinal.toString()}`,
    },
    matchRank: 4,
    textMatches: [],
    sourceMatches: [
      {
        inputKind: 'derivation',
        inputOrdinal: 0,
        resourceId: RESOURCE_ID,
        snapshotId: SNAPSHOT_ID,
        fragmentId,
      },
    ],
    relationMatchCount: 0,
    relationMatches: [],
    relationMatchesTruncated: false,
  };
}
