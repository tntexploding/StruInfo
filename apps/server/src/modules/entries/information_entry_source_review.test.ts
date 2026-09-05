import {describe, expect, it} from 'vitest';
import type {CurrentInformationEntry} from './information_entry_contract.js';
import type {
  InformationEntryGraphRelationValue,
  CurrentInformationEntryAssociationOverride,
} from './information_entry_association_contract.js';
import {buildInformationEntryAssociationProjection} from './information_entry_association.js';
import {
  readInformationEntrySourceReview,
  decodeSourceReviewRequest,
  decodeSourceReviewWrite,
} from './information_entry_source_review.js';
import {
  listInformationEntrySourceReviewItems,
  paginateInformationEntrySourceReviews,
} from './information_entry_source_review_list.js';

const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';
const ENTRY_A = '20000000-0000-4000-8000-000000000001';
const ENTRY_B = '20000000-0000-4000-8000-000000000002';
const ENTRY_C = '20000000-0000-4000-8000-000000000003';
const ENTRY_D = '20000000-0000-4000-8000-000000000004';
const checked: Readonly<InformationEntryGraphRelationValue> = {
  origin: 'user',
  label: 'Synthetic relation',
  direction: 'symmetric',
  semanticKind: 'supports',
  verificationStatus: 'source_checked',
  note: 'Synthetic source note',
};
const revisions = {entryLowRevision: 1, entryHighRevision: 2};

describe('version-bound relationship source reviews', () => {
  it('keeps unknown historical checks unbound and invalidates either changed endpoint without changing stored decisions', () => {
    expect(readInformationEntrySourceReview(checked, revisions)).toEqual({
      status: 'needs_review',
      storedStatus: 'source_checked',
      reason: 'unbound',
    });
    const bound = {...checked, reviewedRevisions: revisions};
    expect(readInformationEntrySourceReview(bound, revisions)).toMatchObject({
      status: 'source_checked',
      reason: 'current',
    });
    for (const current of [
      {entryLowRevision: 2, entryHighRevision: 2},
      {entryLowRevision: 1, entryHighRevision: 3},
    ]) {
      expect(readInformationEntrySourceReview(bound, current)).toEqual({
        status: 'needs_review',
        storedStatus: 'source_checked',
        reason: 'entry_changed',
        reviewedRevisions: revisions,
      });
    }
    expect(bound.verificationStatus).toBe('source_checked');
    expect(
      readInformationEntrySourceReview(
        {...bound, verificationStatus: 'needs_review'},
        revisions,
      ),
    ).toMatchObject({reason: 'owner_requested'});
    expect(
      readInformationEntrySourceReview(undefined, revisions),
    ).toMatchObject({status: 'unreviewed', storedStatus: 'calculated'});
  });

  it('filters privacy, blocks and stale projections before counting and paging', () => {
    const a = entry(ENTRY_A),
      b = entry(ENTRY_B),
      c = entry(ENTRY_C),
      d = entry(ENTRY_D);
    const privateC = {...c, value: {...c.value, isPrivate: true}};
    const privateD = {...d, value: {...d.value, isPrivate: true}};
    const current = [a, b, privateC, privateD];
    const projections = buildInformationEntryAssociationProjection(current);
    expect(projections).toHaveLength(6);
    const blocked: CurrentInformationEntryAssociationOverride = {
      workspaceId: WORKSPACE_ID,
      entryLowId: ENTRY_A,
      entryHighId: ENTRY_C,
      revision: 1,
      revisionId: '30000000-0000-4000-8000-000000000001',
      value: {action: 'block', manualAdjustment: 0, isBlocked: true},
    };
    const list = (
      privacyScope: 'public' | 'include_private' | 'private_only',
    ) =>
      listInformationEntrySourceReviewItems(
        WORKSPACE_ID,
        current,
        {projections, overrides: [blocked]},
        {filter: 'all', privacyScope, limit: 2},
      );
    expect(
      list('public').map((row) => [row.edge.entryLowId, row.edge.entryHighId]),
    ).toEqual([[ENTRY_A, ENTRY_B]]);
    expect(
      list('private_only').map((row) => [
        row.edge.entryLowId,
        row.edge.entryHighId,
      ]),
    ).toEqual([[ENTRY_C, ENTRY_D]]);
    const all = list('include_private');
    expect(all).toHaveLength(5);
    const request = {
      filter: 'all',
      privacyScope: 'include_private',
      limit: 2,
    } as const;
    const first = paginateInformationEntrySourceReviews(all, request);
    expect(first.totalCount).toBe(5);
    expect(first.items).toHaveLength(2);
    expect(first.nextCursor).toBeDefined();
    if (first.nextCursor === undefined)
      throw new Error('Expected second page.');
    const second = paginateInformationEntrySourceReviews(all, {
      ...request,
      after: first.nextCursor,
    });
    if (second.nextCursor === undefined)
      throw new Error('Expected third page.');
    const third = paginateInformationEntrySourceReviews(all, {
      ...request,
      after: second.nextCursor,
    });
    expect([...first.items, ...second.items, ...third.items]).toEqual(all);
    expect(third.nextCursor).toBeUndefined();
    expect(
      listInformationEntrySourceReviewItems(
        WORKSPACE_ID,
        [a, {...b, revision: 2}],
        {projections, overrides: []},
        {...request, privacyScope: 'public'},
      ),
    ).toEqual([]);
  });

  it('keeps a durable checked relation visible for re-review after Entry changes and projection rebuilds', () => {
    const a = entry(ENTRY_A),
      b = entry(ENTRY_B);
    const override: CurrentInformationEntryAssociationOverride = {
      workspaceId: WORKSPACE_ID,
      entryLowId: ENTRY_A,
      entryHighId: ENTRY_B,
      revision: 3,
      revisionId: '30000000-0000-4000-8000-000000000001',
      value: {
        action: 'weaken',
        manualAdjustment: -1500,
        isBlocked: false,
        graph: {
          ...checked,
          reviewedRevisions: {entryLowRevision: 1, entryHighRevision: 1},
        },
      },
    };
    const current = [a, {...b, revision: 2}];
    const request = {
      filter: 'pending',
      privacyScope: 'public',
      limit: 20,
    } as const;
    for (const projections of [
      [],
      buildInformationEntryAssociationProjection(current),
    ]) {
      const items = listInformationEntrySourceReviewItems(
        WORKSPACE_ID,
        current,
        {projections, overrides: [override]},
        request,
      );
      expect(items).toHaveLength(1);
      expect(items[0]).toMatchObject({
        edge: {
          label: checked.label,
          direction: checked.direction,
          note: checked.note,
          verificationStatus: 'needs_review',
        },
        review: {reason: 'entry_changed'},
      });
    }
  });

  it('rejects replaying a cursor into another status or privacy scope and bounds closed requests', () => {
    const after = {
      version: 1,
      filter: 'pending',
      privacyScope: 'public',
      entryLowId: ENTRY_A,
      entryHighId: ENTRY_B,
    };
    expect(decodeSourceReviewRequest({after})).toMatchObject({
      limit: 20,
      after,
    });
    for (const request of [
      {after, privacyScope: 'include_private'},
      {after, filter: 'all'},
      {limit: 51},
      {limit: 0},
      {body: 'unexpected'},
      {after: {...after, entryLowId: ENTRY_B}},
    ]) {
      expect(decodeSourceReviewRequest(request)).toBeUndefined();
    }
    const write = {
      expectedRevision: 2,
      includePrivate: false,
      expectedEntryRevisions: revisions,
      verificationStatus: 'source_checked',
      note: '',
    };
    expect(decodeSourceReviewWrite(write)).toEqual(write);
    for (const bad of [
      {...write, label: 'unauthorized edit'},
      {...write, expectedEntryRevisions: undefined},
      {...write, expectedEntryRevisions: {...revisions, entryLowRevision: 0}},
      {...write, includePrivate: 'true'},
    ])
      expect(decodeSourceReviewWrite(bad)).toBeUndefined();
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
