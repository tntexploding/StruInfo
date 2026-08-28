import {describe, expect, it} from 'vitest';

import type {
  CurrentInformationEntry,
  EntryDomainKeyword,
} from './information_entry_contract.js';
import type {
  CurrentInformationEntryAssociationOverride,
  InformationEntryAssociationBasis,
  InformationEntryAssociationProjection,
  InformationEntryAssociationRepositorySnapshot,
} from './information_entry_association_contract.js';
import {
  exploreCurrentInformationEntries,
  INFORMATION_ENTRY_EXPLORATION_MAXIMUM_CANDIDATES,
} from './information_entry_exploration.js';
import {
  INFORMATION_ENTRY_EXPLORATION_POLICY_VERSION,
  type InformationEntryExplorationPolicy,
} from './information_entry_exploration_contract.js';
import {searchCurrentInformationEntries} from './information_entry_search.js';

const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';
const RESOURCE_ID = '22222222-2222-4222-8222-222222222222';
const SNAPSHOT_A = '33333333-3333-4333-8333-333333333331';
const SNAPSHOT_B = '33333333-3333-4333-8333-333333333332';
const ANCHOR_ID = entryId(1);

describe('Information Entry exploration', () => {
  it('classifies direct associations and takes one candidate from each enabled reason', () => {
    const anchor = entry(1, SNAPSHOT_A, 'engineering_computing');
    const neighbor = entry(2, SNAPSHOT_A, 'engineering_computing');
    const crossDomain = entry(3, SNAPSHOT_A, 'culture_arts');
    const serendipity = entry(4, SNAPSHOT_B, 'engineering_computing');
    const entries = [anchor, neighbor, crossDomain, serendipity];
    const snapshot = associationSnapshot([
      projection(anchor, neighbor, 7_000, 5_000, ['content_keyword']),
      projection(anchor, crossDomain, 9_000, 5_000, [
        'content_keyword',
        'domain_keyword',
      ]),
      projection(anchor, serendipity, 8_000, 0, ['text_term']),
    ]);

    const result = exploreCurrentInformationEntries(
      entries,
      snapshot,
      {
        anchorEntryId: ANCHOR_ID,
        excludeEntryIds: [],
        pageResultCount: 6,
        includePrivate: false,
      },
      policy({resultShare: 50}),
    );

    expect(result).toMatchObject({
      candidateLimit: 3,
      totalEligibleCount: 3,
    });
    expect(result?.items.map((candidate) => candidate.reason)).toEqual([
      'neighbor_expansion',
      'cross_domain',
      'serendipity',
    ]);
    expect(result?.items.map((candidate) => candidate.entry.entryId)).toEqual([
      neighbor.entryId,
      crossDomain.entryId,
      serendipity.entryId,
    ]);
    expect(result?.items[2]).toMatchObject({
      differentSnapshot: true,
      candidateBasis: ['text_term'],
    });
  });

  it('keeps stable score ordering inside a reason and enforces the twelve-item bound', () => {
    const anchor = entry(1, SNAPSHOT_A, 'engineering_computing');
    const candidates = Array.from({length: 15}, (_, index) =>
      entry(index + 2, SNAPSHOT_A, 'engineering_computing'),
    );
    const snapshot = associationSnapshot(
      candidates.map((candidate, index) =>
        projection(anchor, candidate, 9_000 - index * 100, 5_000, [
          'content_keyword',
        ]),
      ),
    );

    const result = exploreCurrentInformationEntries(
      [anchor, ...candidates],
      snapshot,
      {
        anchorEntryId: ANCHOR_ID,
        excludeEntryIds: [],
        pageResultCount: 100,
        includePrivate: false,
      },
      policy({resultShare: 50}),
    );

    expect(result).toMatchObject({
      candidateLimit: INFORMATION_ENTRY_EXPLORATION_MAXIMUM_CANDIDATES,
      totalEligibleCount: 15,
    });
    expect(result?.items).toHaveLength(12);
    expect(result?.items.map((candidate) => candidate.effectiveScore)).toEqual(
      Array.from({length: 12}, (_, index) => 9_000 - index * 100),
    );
  });

  it('excludes private, blocked, stale and current-page candidates before counting', () => {
    const anchor = entry(1, SNAPSHOT_A, 'engineering_computing');
    const visible = entry(2, SNAPSHOT_A, 'engineering_computing');
    const privateEntry = entry(3, SNAPSHOT_A, 'engineering_computing', true);
    const blocked = entry(4, SNAPSHOT_A, 'engineering_computing');
    const stale = entry(5, SNAPSHOT_A, 'engineering_computing');
    const onPage = entry(6, SNAPSHOT_A, 'engineering_computing');
    const projections = [visible, privateEntry, blocked, stale, onPage].map(
      (candidate) =>
        projection(anchor, candidate, 7_000, 5_000, ['content_keyword']),
    );
    const staleProjection = projections[3];
    if (staleProjection === undefined) throw new Error('fixture');
    projections[3] = Object.freeze({
      ...staleProjection,
      entryHighRevision: staleProjection.entryHighRevision + 1,
    });

    const result = exploreCurrentInformationEntries(
      [anchor, visible, privateEntry, blocked, stale, onPage],
      associationSnapshot(projections, [blockedOverride(anchor, blocked)]),
      {
        anchorEntryId: ANCHOR_ID,
        excludeEntryIds: [onPage.entryId],
        pageResultCount: 20,
        includePrivate: false,
      },
      policy({resultShare: 50}),
    );

    expect(result).toMatchObject({totalEligibleCount: 1});
    expect(result?.items.map((candidate) => candidate.entry.entryId)).toEqual([
      visible.entryId,
    ]);
  });

  it('returns no candidates when disabled or zero-share and leaves normal search unchanged', () => {
    const anchor = entry(1, SNAPSHOT_A, 'engineering_computing');
    const candidate = entry(2, SNAPSHOT_A, 'engineering_computing');
    const entries = [anchor, candidate];
    const snapshot = associationSnapshot([
      projection(anchor, candidate, 7_000, 5_000, ['content_keyword']),
    ]);
    const searchRequest = Object.freeze({
      text: 'Synthetic',
      textMode: 'substring' as const,
      textFields: Object.freeze(['title' as const]),
      includePrivate: false,
      limit: 20,
    });
    const before = searchCurrentInformationEntries(
      entries,
      searchRequest,
      snapshot,
    );

    const disabled = exploreCurrentInformationEntries(
      entries,
      snapshot,
      {
        anchorEntryId: ANCHOR_ID,
        excludeEntryIds: [],
        pageResultCount: 20,
        includePrivate: false,
      },
      policy({enabled: false}),
    );
    const zeroShare = exploreCurrentInformationEntries(
      entries,
      snapshot,
      {
        anchorEntryId: ANCHOR_ID,
        excludeEntryIds: [],
        pageResultCount: 20,
        includePrivate: false,
      },
      policy({resultShare: 0}),
    );
    const after = searchCurrentInformationEntries(
      entries,
      searchRequest,
      snapshot,
    );

    expect(disabled?.items).toEqual([]);
    expect(zeroShare?.items).toEqual([]);
    expect(after).toEqual(before);
  });
});

function policy(
  overrides: Partial<InformationEntryExplorationPolicy> = {},
): Readonly<InformationEntryExplorationPolicy> {
  return Object.freeze({
    revision: 0,
    version: INFORMATION_ENTRY_EXPLORATION_POLICY_VERSION,
    enabled: true,
    resultShare: 20,
    neighborExpansion: true,
    crossDomain: true,
    serendipity: true,
    ...overrides,
  });
}

function entry(
  ordinal: number,
  snapshotId: string,
  domainKeyword: EntryDomainKeyword,
  isPrivate = false,
): Readonly<CurrentInformationEntry> {
  const id = entryId(ordinal);
  return Object.freeze({
    workspaceId: WORKSPACE_ID,
    entryId: id,
    resourceId: RESOURCE_ID,
    snapshotId,
    revision: 1,
    revisionId: revisionId(ordinal),
    sourceKey: `synthetic:exploration:${snapshotId}`,
    capturedAt: '2040-01-02T00:00:00.000Z',
    value: Object.freeze({
      documentOrder: ordinal - 1,
      titlePath: `Synthetic exploration ${ordinal.toString()}`,
      body: `Synthetic exploration body ${ordinal.toString()}`,
      bodySha256: ordinal.toString(16).padStart(64, '0'),
      chunkMode: 'split' as const,
      splitRuleVersion: 'synthetic.v1',
      isPrivate,
      typeKeyword: 'knowledge_explanation' as const,
      contentKeywords: Object.freeze([
        Object.freeze({
          displayValue: 'Synthetic',
          normalizedValue: 'synthetic',
          origin: 'manual' as const,
          originVersion: 'synthetic.v1',
        }),
      ]),
      domains: Object.freeze([
        Object.freeze({
          keyword: domainKeyword,
          origin: 'manual' as const,
          originVersion: 'synthetic.v1',
        }),
      ]),
      fragmentIds: Object.freeze([fragmentId(ordinal)]),
    }),
  });
}

function projection(
  first: Readonly<CurrentInformationEntry>,
  second: Readonly<CurrentInformationEntry>,
  baseScore: number,
  contentSimilarity: number,
  candidateBasis: readonly InformationEntryAssociationBasis[],
): Readonly<InformationEntryAssociationProjection> {
  const [low, high] =
    first.entryId.localeCompare(second.entryId) < 0
      ? [first, second]
      : [second, first];
  return Object.freeze({
    workspaceId: WORKSPACE_ID,
    entryLowId: low.entryId,
    entryHighId: high.entryId,
    entryLowRevision: low.revision,
    entryLowRevisionId: low.revisionId,
    entryHighRevision: high.revision,
    entryHighRevisionId: high.revisionId,
    contentSimilarity,
    typeSimilarity: 10_000,
    domainSimilarity: 0,
    baseScore,
    algorithmVersion: 'synthetic.v1',
    candidateBasis: Object.freeze([...candidateBasis]),
    candidateRank: 1,
  });
}

function blockedOverride(
  first: Readonly<CurrentInformationEntry>,
  second: Readonly<CurrentInformationEntry>,
): Readonly<CurrentInformationEntryAssociationOverride> {
  const [low, high] =
    first.entryId.localeCompare(second.entryId) < 0
      ? [first, second]
      : [second, first];
  return Object.freeze({
    workspaceId: WORKSPACE_ID,
    entryLowId: low.entryId,
    entryHighId: high.entryId,
    revision: 1,
    revisionId: '77777777-7777-4777-8777-777777777777',
    value: Object.freeze({
      action: 'block' as const,
      manualAdjustment: 0,
      isBlocked: true,
    }),
  });
}

function associationSnapshot(
  projections: readonly Readonly<InformationEntryAssociationProjection>[],
  overrides: readonly Readonly<CurrentInformationEntryAssociationOverride>[] = [],
): Readonly<InformationEntryAssociationRepositorySnapshot> {
  return Object.freeze({
    projections: Object.freeze([...projections]),
    overrides: Object.freeze([...overrides]),
  });
}

function entryId(ordinal: number): string {
  return `44444444-4444-4444-8444-${ordinal.toString().padStart(12, '0')}`;
}

function revisionId(ordinal: number): string {
  return `55555555-5555-4555-8555-${ordinal.toString().padStart(12, '0')}`;
}

function fragmentId(ordinal: number): string {
  return `66666666-6666-4666-8666-${ordinal.toString().padStart(12, '0')}`;
}
