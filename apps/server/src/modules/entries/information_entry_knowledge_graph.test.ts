import {describe, expect, it} from 'vitest';

import type {CurrentInformationEntry} from './information_entry_contract.js';
import {buildInformationEntryAssociationProjection} from './information_entry_association.js';
import {
  buildInformationEntryKnowledgeGraph,
  prepareInformationEntryGraphEdit,
  prepareInformationEntryGraphRelation,
  prepareInformationEntryGraphVisibility,
} from './information_entry_knowledge_graph.js';

const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';
const ENTRY_A = '20000000-0000-4000-8000-000000000001';
const ENTRY_B = '20000000-0000-4000-8000-000000000002';
const OVERRIDE_REVISION_ID = '30000000-0000-4000-8000-000000000001';

describe('Information Entry knowledge graph', () => {
  it('shows a visible deterministic association immediately as an unconfirmed similarity edge', () => {
    const entries = [entry(ENTRY_A), entry(ENTRY_B)];
    const projection = buildInformationEntryAssociationProjection(entries)[0];
    if (projection === undefined) throw new Error('Expected projection.');

    const graph = buildInformationEntryKnowledgeGraph(ENTRY_A, entries, {
      projections: [projection],
      overrides: [],
    });

    expect(graph).toMatchObject({
      center: {entryId: ENTRY_A},
      nodes: [{entryId: ENTRY_A}, {entryId: ENTRY_B}],
      edges: [
        {
          entryLowId: ENTRY_A,
          entryHighId: ENTRY_B,
          label: 'similarity',
          direction: 'symmetric',
          origin: 'automatically_calculated',
          semanticKind: 'similarity',
          verificationStatus: 'calculated',
          note: '',
          isBlocked: false,
          overrideRevision: 0,
        },
      ],
      hiddenEdges: [],
    });
  });

  it('keeps user edits through blocking and makes the hidden endpoint restorable', () => {
    const entries = [entry(ENTRY_A), entry(ENTRY_B)];
    const projection = buildInformationEntryAssociationProjection(entries)[0];
    if (projection === undefined) throw new Error('Expected projection.');
    const relation = prepareInformationEntryGraphRelation(
      '  同一工具链  ',
      'low_to_high',
      'association',
      {
        semanticKind: 'supports',
        verificationStatus: 'source_checked',
        note: '  已核对来源  ',
      },
    );
    if (relation === undefined) throw new Error('Expected relation.');
    const edited = prepareInformationEntryGraphEdit(undefined, true, relation);
    const blocked = prepareInformationEntryGraphVisibility(edited, true, true);

    const graph = buildInformationEntryKnowledgeGraph(ENTRY_A, entries, {
      projections: [projection],
      overrides: [
        {
          workspaceId: WORKSPACE_ID,
          entryLowId: ENTRY_A,
          entryHighId: ENTRY_B,
          revision: 2,
          revisionId: OVERRIDE_REVISION_ID,
          value: blocked,
        },
      ],
    });

    expect(relation.label).toBe('同一工具链');
    expect(relation.note).toBe('已核对来源');
    expect(graph).toMatchObject({
      nodes: [{entryId: ENTRY_A}, {entryId: ENTRY_B}],
      edges: [],
      hiddenEdges: [
        {
          label: '同一工具链',
          direction: 'low_to_high',
          origin: 'user_edited',
          semanticKind: 'supports',
          verificationStatus: 'source_checked',
          isBlocked: true,
          overrideRevision: 2,
        },
      ],
    });
  });

  it('supports a user-created relation without manufacturing a similarity projection', () => {
    const entries = [entry(ENTRY_A), entry(ENTRY_B)];
    const relation = prepareInformationEntryGraphRelation(
      '扩展自',
      'high_to_low',
      'user',
    );
    if (relation === undefined) throw new Error('Expected relation.');
    const value = prepareInformationEntryGraphEdit(undefined, false, relation);

    const graph = buildInformationEntryKnowledgeGraph(ENTRY_A, entries, {
      projections: [],
      overrides: [
        {
          workspaceId: WORKSPACE_ID,
          entryLowId: ENTRY_A,
          entryHighId: ENTRY_B,
          revision: 1,
          revisionId: OVERRIDE_REVISION_ID,
          value,
        },
      ],
    });

    expect(graph?.edges).toMatchObject([
      {
        label: '扩展自',
        direction: 'high_to_low',
        origin: 'user_created',
        effectiveScore: 0,
      },
    ]);
    expect(graph?.edges[0]?.projection).toBeUndefined();
    expect(
      prepareInformationEntryGraphRelation('\u0000bad', 'symmetric', 'user'),
    ).toBeUndefined();
  });
});

function entry(entryId: string): Readonly<CurrentInformationEntry> {
  return Object.freeze({
    workspaceId: WORKSPACE_ID,
    entryId,
    resourceId: '40000000-0000-4000-8000-000000000001',
    snapshotId: '50000000-0000-4000-8000-000000000001',
    revision: 1,
    revisionId: `60000000-0000-4000-8000-${entryId.slice(-12)}`,
    sourceKey: 'synthetic:knowledge-graph',
    capturedAt: '2040-01-02T03:04:05.000Z',
    value: Object.freeze({
      documentOrder: Number(entryId.slice(-1)) - 1,
      titlePath: `Entry ${entryId.slice(-1)}`,
      body: '共享的本地知识图谱编辑工具说明',
      bodySha256: '0'.repeat(64),
      chunkMode: 'split' as const,
      splitRuleVersion: 'synthetic.v1',
      isPrivate: false,
      typeKeyword: 'knowledge_explanation' as const,
      contentKeywords: Object.freeze([
        Object.freeze({
          displayValue: '知识图谱',
          normalizedValue: '知识图谱',
          origin: 'manual' as const,
          originVersion: 'synthetic.v1',
        }),
      ]),
      domains: Object.freeze([
        Object.freeze({
          keyword: 'engineering_computing' as const,
          origin: 'manual' as const,
          originVersion: 'synthetic.v1',
        }),
      ]),
      fragmentIds: Object.freeze([
        `70000000-0000-4000-8000-${entryId.slice(-12)}`,
      ]),
    }),
  });
}
