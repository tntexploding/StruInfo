import {describe, expect, it, vi} from 'vitest';

import type {CurrentInformationEntry} from './information_entry_contract.js';
import type {InformationEntryRepositoryPort} from './information_entry_repository.js';
import {
  reviewCurrentInformationEntryTypes,
  reviewInformationEntryTypes,
} from './information_entry_type_review.js';

const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';

describe('information Entry type review', () => {
  it('reports complete coverage and pages only the requested type state', () => {
    const entries = [
      entry(
        '00000000-0000-4000-8000-000000000001',
        '2040-01-03T00:00:00.000Z',
        'argument',
      ),
      entry('00000000-0000-4000-8000-000000000002', '2040-01-02T00:00:00.000Z'),
      entry('00000000-0000-4000-8000-000000000003', '2040-01-01T00:00:00.000Z'),
    ] as const;

    const first = reviewInformationEntryTypes(entries, {
      workspaceId: WORKSPACE_ID,
      includePrivate: false,
      filter: 'missing',
      limit: 1,
    });

    expect(first.coverage).toMatchObject({
      totalCount: 3,
      classifiedCount: 1,
      missingCount: 2,
    });
    expect(
      first.coverage.byType.find(({typeKeyword}) => typeKeyword === 'argument'),
    ).toEqual({typeKeyword: 'argument', count: 1});
    expect(first.items.map(({entryId}) => entryId)).toEqual([
      '00000000-0000-4000-8000-000000000002',
    ]);
    expect(first.nextCursor).toEqual({
      capturedAt: '2040-01-02T00:00:00.000Z',
      snapshotId: '22222222-2222-4222-8222-222222222222',
      documentOrder: 0,
      entryId: '00000000-0000-4000-8000-000000000002',
    });
    if (first.nextCursor === undefined) {
      throw new Error('Expected the first missing-type page to continue.');
    }

    const second = reviewInformationEntryTypes(entries, {
      workspaceId: WORKSPACE_ID,
      includePrivate: false,
      filter: 'missing',
      limit: 1,
      after: first.nextCursor,
    });
    expect(second.items.map(({entryId}) => entryId)).toEqual([
      '00000000-0000-4000-8000-000000000003',
    ]);
    expect(second.nextCursor).toBeUndefined();
  });

  it('passes privacy scope to compatibility repositories', async () => {
    const loadCurrentEntries = vi.fn(() =>
      Promise.resolve(
        Object.freeze([
          entry(
            '00000000-0000-4000-8000-000000000004',
            '2040-01-04T00:00:00.000Z',
          ),
        ]),
      ),
    );
    const repository: InformationEntryRepositoryPort = {
      materializeEntries: () =>
        Promise.resolve({outcome: 'existing', createdCount: 0}),
      reviseEntry: () => Promise.resolve('not_found'),
      loadCurrentEntries,
    };

    const result = await reviewCurrentInformationEntryTypes(repository, {
      workspaceId: WORKSPACE_ID,
      includePrivate: true,
      filter: 'missing',
      limit: 20,
    });

    expect(loadCurrentEntries).toHaveBeenCalledWith(WORKSPACE_ID, true);
    expect(result.coverage.missingCount).toBe(1);
  });
});

function entry(
  entryId: string,
  capturedAt: string,
  typeKeyword?: 'argument',
): Readonly<CurrentInformationEntry> {
  return Object.freeze({
    workspaceId: WORKSPACE_ID,
    entryId,
    resourceId: '33333333-3333-4333-8333-333333333333',
    snapshotId: '22222222-2222-4222-8222-222222222222',
    revision: 1,
    revisionId: '44444444-4444-4444-8444-444444444444',
    sourceKey: 'synthetic:type-review',
    capturedAt,
    value: Object.freeze({
      documentOrder: 0,
      titlePath: 'Synthetic type review',
      body: 'Value-free synthetic body.',
      bodySha256: 'a'.repeat(64),
      chunkMode: 'split',
      splitRuleVersion: 'synthetic.type-review.v1',
      isPrivate: false,
      ...(typeKeyword === undefined ? {} : {typeKeyword}),
      contentKeywords: Object.freeze([]),
      domains: Object.freeze([]),
      fragmentIds: Object.freeze(['55555555-5555-4555-8555-555555555555']),
    }),
  });
}
