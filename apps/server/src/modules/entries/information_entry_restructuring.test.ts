import {describe, expect, it} from 'vitest';

import type {
  CurrentInformationEntry,
  InformationEntryMaterializeRow,
} from './information_entry_contract.js';
import {prepareManualSplitInformationEntries} from './information_entry.js';
import {
  deriveInformationEntryRestructureGroups,
  prepareInformationEntryRestructure,
} from './information_entry_restructuring.js';

const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';
const RESOURCE_ID = '22222222-2222-4222-8222-222222222222';
const SNAPSHOT_ID = '33333333-3333-4333-8333-333333333333';
const STRUCTURE_ID = '44444444-4444-4444-8444-444444444444';
const FIRST_FRAGMENT_ID = '55555555-5555-4555-8555-555555555555';
const SECOND_FRAGMENT_ID = '66666666-6666-4666-8666-666666666666';
const FIRST_TEXT = 'Alpha source.';
const SECOND_TEXT = 'Beta source.';

describe('InformationEntry restructuring', () => {
  it('derives an unchanged round-trip partition without creating revisions', () => {
    const {snapshot, entries} = fixture();
    const groups = deriveInformationEntryRestructureGroups(snapshot, entries);
    expect(groups).toBeDefined();

    const preparation = prepareInformationEntryRestructure(
      snapshot,
      entries,
      groups ?? [],
      [],
    );

    expect(preparation).toMatchObject({
      hasChanges: false,
      retiredEntryIds: [],
      annotationReviewCount: 0,
    });
    expect(preparation?.successors.map((value) => value.operation)).toEqual([
      'unchanged',
      'unchanged',
    ]);
    expect(preparation?.resultingEntries.map((value) => value.entryId)).toEqual(
      entries.map((value) => value.entryId),
    );
  });

  it('treats full deterministic Fragment coverage as the same saved structure', () => {
    const {snapshot, entries} = fixture();
    const deterministicEntries = entries.map((entry) => {
      const value = {...entry.value};
      Reflect.deleteProperty(value, 'fragmentRanges');
      return Object.freeze({
        ...entry,
        value: Object.freeze({
          ...value,
          splitRuleVersion: 'struinfo.entry-split.section.v1',
        }),
      });
    });
    const groups = deriveInformationEntryRestructureGroups(
      snapshot,
      deterministicEntries,
    );
    const preparation = prepareInformationEntryRestructure(
      snapshot,
      deterministicEntries,
      groups ?? [],
      [],
    );

    expect(preparation?.hasChanges).toBe(false);
    expect(
      preparation?.successors.every(
        (successor) => successor.operation === 'unchanged',
      ),
    ).toBe(true);
  });

  it('previews merge lineage, annotation review and deterministic relationship migration', () => {
    const {snapshot, entries} = fixture(true);
    const first = entries[0];
    const second = entries[1];
    if (first === undefined || second === undefined) throw new Error('fixture');
    const externalId = '99999999-9999-4999-8999-999999999999';
    const pair = orderedPair(first.entryId, externalId);
    const internalPair = orderedPair(first.entryId, second.entryId);
    const value = Object.freeze({
      action: 'enhance' as const,
      manualAdjustment: 120,
      isBlocked: false,
      graph: Object.freeze({
        origin: 'user' as const,
        label: 'related',
        direction: 'symmetric' as const,
        semanticKind: 'related' as const,
        verificationStatus: 'source_checked' as const,
        note: '两端来源已核对',
      }),
    });
    const preparation = prepareInformationEntryRestructure(
      snapshot,
      entries,
      [
        {
          titlePath: 'Merged',
          fragments: [
            range(FIRST_FRAGMENT_ID, FIRST_TEXT),
            range(SECOND_FRAGMENT_ID, SECOND_TEXT),
          ],
        },
      ],
      [
        Object.freeze({
          workspaceId: WORKSPACE_ID,
          ...pair,
          revision: 1,
          revisionId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
          value,
        }),
        Object.freeze({
          workspaceId: WORKSPACE_ID,
          ...internalPair,
          revision: 1,
          revisionId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
          value,
        }),
      ],
    );

    expect(preparation).toMatchObject({
      hasChanges: true,
      annotationReviewCount: 1,
      transferredRelationshipCount: 1,
      collapsedRelationshipCount: 1,
      conflictingRelationshipCount: 0,
    });
    expect(preparation?.successors).toHaveLength(1);
    expect(preparation?.successors[0]).toMatchObject({
      operation: 'insert',
      annotationStatus: 'requires_review',
      predecessorEntryIds: [first.entryId, second.entryId],
    });
    expect(preparation?.lineage.map((value) => value.kind)).toEqual([
      'merged_from',
      'merged_from',
    ]);
    expect(preparation?.retiredEntryIds).toEqual([
      first.entryId,
      second.entryId,
    ]);
    expect(preparation?.overrideTransfers[0]?.value).toEqual(value);
    expect(preparation?.planSha256).toMatch(/^[0-9a-f]{64}$/u);
  });

  it('rejects a proposed structure that leaves source evidence uncovered', () => {
    const {snapshot, entries} = fixture();
    expect(
      prepareInformationEntryRestructure(
        snapshot,
        entries,
        [
          {
            titlePath: 'Incomplete',
            fragments: [range(FIRST_FRAGMENT_ID, FIRST_TEXT)],
          },
        ],
        [],
      ),
    ).toBeUndefined();
  });

  it('preserves a directed relationship when successor UUID ordering flips', () => {
    const {snapshot, entries} = fixture();
    const first = entries[0];
    if (first === undefined) throw new Error('fixture');
    const groups = [
      {
        titlePath: 'Merged',
        fragments: [
          range(FIRST_FRAGMENT_ID, FIRST_TEXT),
          range(SECOND_FRAGMENT_ID, SECOND_TEXT),
        ],
      },
    ];
    const initial = prepareInformationEntryRestructure(
      snapshot,
      entries,
      groups,
      [],
    );
    const successorId = initial?.successors[0]?.row.entryId;
    if (successorId === undefined) throw new Error('successor');
    const externalId = uuidBetween(first.entryId, successorId);
    const pair = orderedPair(first.entryId, externalId);
    const preparation = prepareInformationEntryRestructure(
      snapshot,
      entries,
      groups,
      [
        Object.freeze({
          workspaceId: WORKSPACE_ID,
          ...pair,
          revision: 1,
          revisionId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
          value: Object.freeze({
            action: 'enhance' as const,
            manualAdjustment: 40,
            isBlocked: false,
            graph: Object.freeze({
              origin: 'user' as const,
              label: 'depends on',
              direction: 'low_to_high' as const,
              semanticKind: 'supports' as const,
              verificationStatus: 'needs_review' as const,
              note: '方向需要再次核对',
            }),
          }),
        }),
      ],
    );

    expect(preparation?.overrideTransfers).toHaveLength(1);
    expect(preparation?.overrideTransfers[0]?.value.graph?.direction).toBe(
      'high_to_low',
    );
  });
});

function fixture(conflictingAnnotations = false): Readonly<{
  snapshot: ReturnType<typeof snapshotFixture>;
  entries: readonly Readonly<CurrentInformationEntry>[];
}> {
  const snapshot = snapshotFixture();
  const rows = prepareManualSplitInformationEntries(snapshot, [
    {titlePath: 'Alpha', fragments: [range(FIRST_FRAGMENT_ID, FIRST_TEXT)]},
    {titlePath: 'Beta', fragments: [range(SECOND_FRAGMENT_ID, SECOND_TEXT)]},
  ]);
  if (rows === undefined) throw new Error('fixture');
  return Object.freeze({
    snapshot,
    entries: Object.freeze(
      rows.map((row, index) =>
        currentEntry(row, index, conflictingAnnotations),
      ),
    ),
  });
}

function currentEntry(
  row: Readonly<InformationEntryMaterializeRow>,
  index: number,
  conflictingAnnotations: boolean,
): Readonly<CurrentInformationEntry> {
  return Object.freeze({
    workspaceId: row.workspaceId,
    entryId: row.entryId,
    resourceId: row.resourceId,
    snapshotId: row.snapshotId,
    revision: 1,
    revisionId: row.revisionId,
    sourceKey: 'synthetic:restructure',
    capturedAt: '2040-01-02T03:04:05.000Z',
    value: Object.freeze({
      ...row.value,
      typeKeyword:
        conflictingAnnotations && index === 1
          ? ('argument' as const)
          : ('knowledge_explanation' as const),
      usefulnessScore: conflictingAnnotations && index === 1 ? 2 : 4,
      interestScore: 3,
      contentKeywords: Object.freeze([
        Object.freeze({
          displayValue: index === 0 ? 'Alpha' : 'Beta',
          normalizedValue: index === 0 ? 'alpha' : 'beta',
          origin: 'manual' as const,
          originVersion: 'manual-entry-editor.v1',
        }),
      ]),
      domains: Object.freeze([
        Object.freeze({
          keyword: 'engineering_computing' as const,
          origin: 'manual' as const,
          originVersion: 'manual-entry-editor.v1',
        }),
      ]),
    }),
  });
}

function snapshotFixture() {
  return Object.freeze({
    workspaceId: WORKSPACE_ID,
    resourceId: RESOURCE_ID,
    snapshotId: SNAPSHOT_ID,
    structures: Object.freeze([
      Object.freeze({
        structureId: STRUCTURE_ID,
        normalizedText: `${FIRST_TEXT}\n\n${SECOND_TEXT}`,
        fragments: Object.freeze([
          fragment(FIRST_FRAGMENT_ID, 0, FIRST_TEXT),
          fragment(SECOND_FRAGMENT_ID, 20, SECOND_TEXT),
        ]),
      }),
    ]),
  });
}

function fragment(fragmentId: string, start: number, selectedText: string) {
  return Object.freeze({
    fragmentId,
    structureId: STRUCTURE_ID,
    nodeKind: 'section',
    codePointRange: Object.freeze({
      start,
      end: start + Array.from(selectedText).length,
    }),
    selectedText,
  });
}

function range(fragmentId: string, text: string) {
  return Object.freeze({
    fragmentId,
    startCodePoint: 0,
    endCodePoint: Array.from(text).length,
  });
}

function orderedPair(entryId: string, relatedEntryId: string) {
  return entryId < relatedEntryId
    ? Object.freeze({entryLowId: entryId, entryHighId: relatedEntryId})
    : Object.freeze({entryLowId: relatedEntryId, entryHighId: entryId});
}

function uuidBetween(first: string, second: string): string {
  const firstValue = BigInt(`0x${first.replaceAll('-', '')}`);
  const secondValue = BigInt(`0x${second.replaceAll('-', '')}`);
  const low = firstValue < secondValue ? firstValue : secondValue;
  const high = firstValue < secondValue ? secondValue : firstValue;
  const value = (low + high) / 2n;
  if (value === low || value === high) throw new Error('No UUID midpoint.');
  const hex = value.toString(16).padStart(32, '0');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
