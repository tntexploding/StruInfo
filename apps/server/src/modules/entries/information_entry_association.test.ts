import {describe, expect, it} from 'vitest';

import type {CurrentInformationEntry} from './information_entry_contract.js';
import {
  buildInformationEntryAssociationProjection,
  INFORMATION_ENTRY_ASSOCIATION_POLICY,
  listInformationEntryAssociations,
  prepareInformationEntryAssociationReadIndex,
  prepareInformationEntryAssociationOverride,
} from './information_entry_association.js';

const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';
const ENTRY_A = '20000000-0000-4000-8000-000000000001';
const ENTRY_B = '20000000-0000-4000-8000-000000000002';
const ENTRY_C = '20000000-0000-4000-8000-000000000003';

describe('Information Entry associations', () => {
  it('narrows candidates through local indexes and does not connect entries only because labels match', () => {
    const entries = [
      entry(ENTRY_A, '本地 Markdown 编辑器', ['markdown', '编辑器']),
      entry(ENTRY_B, 'Markdown 编辑工具', ['markdown', '工具']),
      entry(ENTRY_C, '完全不同的园艺记录', ['园艺']),
    ];

    const projection = buildInformationEntryAssociationProjection(entries);

    expect(projection).toHaveLength(1);
    expect(projection[0]).toMatchObject({
      entryLowId: ENTRY_A,
      entryHighId: ENTRY_B,
      algorithmVersion: INFORMATION_ENTRY_ASSOCIATION_POLICY.version,
      typeSimilarity: 10_000,
      domainSimilarity: 10_000,
    });
    expect(projection[0]?.baseScore).toBeGreaterThanOrEqual(
      INFORMATION_ENTRY_ASSOCIATION_POLICY.threshold,
    );
    expect(projection[0]?.candidateBasis).toEqual([
      'content_keyword',
      'text_term',
      'type_keyword',
      'domain_keyword',
    ]);
  });

  it('keeps a useful local-text fallback when Entry keywords have not been edited yet', () => {
    const entries = [
      entry(ENTRY_A, '本地终端工具显示命令输出', []),
      entry(ENTRY_B, '本地终端工具显示任务输出', []),
      entry(ENTRY_C, '完全不同的园艺记录', []),
    ];

    const projection = buildInformationEntryAssociationProjection(entries);

    expect(projection).toHaveLength(1);
    expect(projection[0]).toMatchObject({
      entryLowId: ENTRY_A,
      entryHighId: ENTRY_B,
      candidateBasis: ['text_term', 'type_keyword', 'domain_keyword'],
    });
    expect(projection[0]?.baseScore).toBeGreaterThanOrEqual(
      INFORMATION_ENTRY_ASSOCIATION_POLICY.threshold,
    );
  });

  it('keeps versioned manual decisions separate from rebuildable scores', () => {
    const entries = [
      entry(ENTRY_A, 'Markdown 编辑器', ['markdown']),
      entry(ENTRY_B, 'Markdown 工具', ['markdown']),
    ];
    const projection = buildInformationEntryAssociationProjection(entries)[0];
    if (projection === undefined) throw new Error('Expected projection.');
    const override = Object.freeze({
      workspaceId: WORKSPACE_ID,
      entryLowId: ENTRY_A,
      entryHighId: ENTRY_B,
      revision: 1,
      revisionId: '30000000-0000-4000-8000-000000000001',
      value: prepareInformationEntryAssociationOverride('weaken'),
    });

    expect(
      listInformationEntryAssociations(ENTRY_A, entries, {
        projections: [projection],
        overrides: [override],
      }),
    ).toMatchObject([
      {
        relatedEntry: {entryId: ENTRY_B},
        projection: {baseScore: projection.baseScore},
        override: {value: {action: 'weaken', manualAdjustment: -1_500}},
        effectiveScore: Math.max(0, projection.baseScore - 1_500),
        isBlocked: false,
      },
    ]);

    const readIndex = prepareInformationEntryAssociationReadIndex(entries, {
      projections: [projection],
      overrides: [override],
    });
    expect(readIndex.list(ENTRY_A)).toEqual(
      listInformationEntryAssociations(ENTRY_A, entries, {
        projections: [projection],
        overrides: [override],
      }),
    );
    expect(readIndex.list(ENTRY_B)[0]?.relatedEntry.entryId).toBe(ENTRY_A);
    expect(readIndex.list(ENTRY_C)).toEqual([]);

    const blocked = {
      ...override,
      revision: 2,
      value: prepareInformationEntryAssociationOverride('block'),
    };
    expect(
      listInformationEntryAssociations(ENTRY_A, entries, {
        projections: [projection],
        overrides: [blocked],
      })[0],
    ).toMatchObject({effectiveScore: 0, isBlocked: true});
  });

  it('hides stale derived rows while retaining manual-only decisions across recomputation', () => {
    const originalA = entry(ENTRY_A, 'Markdown 编辑器', ['markdown']);
    const currentA = entry(ENTRY_A, '修订后的编辑器', ['markdown'], 2);
    const currentB = entry(ENTRY_B, 'Markdown 工具', ['markdown']);
    const stale = buildInformationEntryAssociationProjection([
      originalA,
      currentB,
    ])[0];
    if (stale === undefined) throw new Error('Expected projection.');
    const manualOnly = Object.freeze({
      workspaceId: WORKSPACE_ID,
      entryLowId: ENTRY_A,
      entryHighId: ENTRY_B,
      revision: 1,
      revisionId: '30000000-0000-4000-8000-000000000001',
      value: prepareInformationEntryAssociationOverride('enhance'),
    });

    expect(
      listInformationEntryAssociations(ENTRY_A, [currentA, currentB], {
        projections: [stale],
        overrides: [manualOnly],
      }),
    ).toMatchObject([
      {
        relatedEntry: {entryId: ENTRY_B},
        effectiveScore: 1_500,
        isBlocked: false,
      },
    ]);
  });
});

function entry(
  entryId: string,
  body: string,
  contentKeywords: readonly string[],
  revision = 1,
): Readonly<CurrentInformationEntry> {
  return Object.freeze({
    workspaceId: WORKSPACE_ID,
    entryId,
    resourceId: '40000000-0000-4000-8000-000000000001',
    snapshotId: '50000000-0000-4000-8000-000000000001',
    revision,
    revisionId: `60000000-0000-4000-8000-${revision.toString().padStart(12, '0')}`,
    sourceKey: 'synthetic:association',
    capturedAt: '2026-08-22T00:00:00.000Z',
    value: Object.freeze({
      documentOrder: Number(entryId.slice(-1)) - 1,
      titlePath: body,
      body,
      bodySha256: '0'.repeat(64),
      chunkMode: 'split' as const,
      splitRuleVersion: 'synthetic.v1',
      isPrivate: false,
      typeKeyword: 'knowledge_explanation' as const,
      contentKeywords: Object.freeze(
        contentKeywords.map((value) =>
          Object.freeze({
            displayValue: value,
            normalizedValue: value,
            origin: 'manual' as const,
            originVersion: 'synthetic.v1',
          }),
        ),
      ),
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
