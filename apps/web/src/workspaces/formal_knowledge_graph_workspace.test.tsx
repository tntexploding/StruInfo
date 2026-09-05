import {renderToStaticMarkup} from 'react-dom/server';
import {describe, expect, it} from 'vitest';

import type {
  InformationEntry,
  InformationEntryGraphEdge,
} from '../api/m1c_api_contract.js';
import {InformationEntryRadialGraph} from './formal_knowledge_graph_workspace.js';

const CENTER_ID = '11111111-1111-4111-8111-111111111111';
const AUTOMATIC_ID = '22222222-2222-4222-8222-222222222222';
const MANUAL_ID = '33333333-3333-4333-8333-333333333333';

describe('InformationEntryRadialGraph', () => {
  it('places one centre with related endpoints and exposes the reason on each line', () => {
    const center = entry(CENTER_ID, '中心条目', '用于验证图谱中心。');
    const automatic = entry(
      AUTOMATIC_ID,
      '自动关联条目',
      '与中心共享关键词和正文内容。',
    );
    const manual = entry(
      MANUAL_ID,
      '人工关联条目',
      '由用户确认其支持中心条目。',
    );
    const edges: readonly Readonly<InformationEntryGraphEdge>[] = [
      {
        entryLowId: CENTER_ID,
        entryHighId: AUTOMATIC_ID,
        label: 'similarity',
        direction: 'symmetric',
        origin: 'automatically_calculated',
        semanticKind: 'similarity',
        verificationStatus: 'calculated',
        note: '',
        effectiveScore: 7_400,
        isBlocked: false,
        overrideRevision: 0,
        projection: {
          workspaceId: center.workspaceId,
          entryLowId: CENTER_ID,
          entryHighId: AUTOMATIC_ID,
          entryLowRevision: 1,
          entryLowRevisionId: center.revisionId,
          entryHighRevision: 1,
          entryHighRevisionId: automatic.revisionId,
          contentSimilarity: 8_000,
          typeSimilarity: 6_000,
          domainSimilarity: 5_000,
          baseScore: 7_400,
          algorithmVersion: 'synthetic-v1',
          candidateBasis: ['content_keyword', 'text_term'],
          candidateRank: 1,
        },
      },
      {
        entryLowId: CENTER_ID,
        entryHighId: MANUAL_ID,
        label: 'supports',
        direction: 'low_to_high',
        origin: 'user_created',
        semanticKind: 'supports',
        verificationStatus: 'source_checked',
        note: '人工确认：该条目为中心结论提供直接支持',
        effectiveScore: 10_000,
        isBlocked: false,
        overrideRevision: 1,
      },
    ];
    const markup = renderToStaticMarkup(
      <InformationEntryRadialGraph
        center={center}
        edges={edges}
        nodesById={
          new Map([
            [center.entryId, center],
            [automatic.entryId, automatic],
            [manual.entryId, manual],
          ])
        }
        selectedEdgeKey={undefined}
        selectedNodeId={center.entryId}
        onRecenter={() => undefined}
        onSelectEdge={() => undefined}
        onSelectNode={() => undefined}
      />,
    );

    expect(markup).toContain('data-knowledge-graph-center="true"');
    expect(markup.match(/data-knowledge-graph-related="true"/gu)).toHaveLength(
      2,
    );
    expect(markup.match(/class="knowledge-radial-edge"/gu)).toHaveLength(2);
    expect(markup).toContain('共同内容关键词、相近正文或标题');
    expect(markup).toContain('人工确认：该条目为中心结论提供直接支持');
    expect(markup).toContain('marker-start="url(#knowledge-arrow)"');
    expect(markup).toContain('marker-end="url(#knowledge-arrow)"');
    expect(markup).toContain('role="button"');
  });
});

function entry(
  entryId: string,
  titlePath: string,
  body: string,
): Readonly<InformationEntry> {
  return {
    workspaceId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    entryId,
    resourceId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    snapshotId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    revision: 1,
    revisionId: `${entryId.slice(0, -1)}0`,
    sourceKey: 'synthetic:knowledge-graph',
    capturedAt: '2040-01-02T03:04:05.000Z',
    value: {
      documentOrder: 0,
      titlePath,
      body,
      bodySha256: 'd'.repeat(64),
      chunkMode: 'split',
      splitRuleVersion: 'synthetic-v1',
      isPrivate: false,
      contentKeywords: [],
      domains: [],
      fragmentIds: ['eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'],
    },
  };
}
