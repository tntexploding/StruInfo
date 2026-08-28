import {describe, expect, it} from 'vitest';

import type {MaterializedEvidenceSnapshot} from './information_entry.js';
import {
  decodeEntrySplitRuleProfile,
  planInformationEntrySplitRule,
} from './information_entry_split_rule.js';

const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';
const RESOURCE_ID = '22222222-2222-4222-8222-222222222222';
const SNAPSHOT_ID = '33333333-3333-4333-8333-333333333333';
const STRUCTURE_ID = '44444444-4444-4444-8444-444444444444';

describe('InformationEntry split rules', () => {
  it('preserves the one-section default and exact private provenance', () => {
    const source = snapshot([
      '## Alpha\n\nShort source.',
      '## Beta\n\nSecond source.',
    ]);

    const plan = planInformationEntrySplitRule(source, {
      revision: 3,
      mode: 'one_section',
      minimumGroupCodePoints: 400,
      maximumGroupCodePoints: 4_000,
      maximumFragmentsPerGroup: 8,
    });

    expect(plan?.trial.groups).toHaveLength(2);
    expect(plan?.rows.map((row) => row.value.titlePath)).toEqual([
      'Alpha',
      'Beta',
    ]);
    expect(plan?.rows[0]?.value).toMatchObject({
      isPrivate: true,
      splitRuleVersion: 'struinfo.entry-split.configurable-group.v1:r3',
      fragmentIds: ['55555555-5555-4555-8555-555555555551'],
    });
    expect(Object.isFrozen(plan?.trial.groups)).toBe(true);
  });

  it('merges only adjacent short sections and keeps source order stable', () => {
    const source = snapshot([
      '## A\n\naaaaa',
      'bbbbbbbbbb',
      `## C\n\n${'c'.repeat(30)}`,
    ]);
    const profile = {
      revision: 1,
      mode: 'merge_short_adjacent' as const,
      minimumGroupCodePoints: 25,
      maximumGroupCodePoints: 50,
      maximumFragmentsPerGroup: 3,
    };

    const first = planInformationEntrySplitRule(source, profile);
    const replay = planInformationEntrySplitRule(source, profile);

    expect(first).toEqual(replay);
    expect(first?.trial.groups.map((group) => group.fragmentCount)).toEqual([
      2, 1,
    ]);
    expect(first?.rows[0]?.value.body).toBe('## A\n\naaaaa\n\nbbbbbbbbbb');
    expect(first?.rows[1]?.value.titlePath).toBe('C');
  });

  it('reports an indivisible oversized Fragment without cutting evidence', () => {
    const plan = planInformationEntrySplitRule(snapshot(['x'.repeat(80)]), {
      revision: 2,
      mode: 'merge_short_adjacent',
      minimumGroupCodePoints: 10,
      maximumGroupCodePoints: 20,
      maximumFragmentsPerGroup: 2,
    });

    expect(plan?.trial.groups).toEqual([
      expect.objectContaining({
        fragmentCount: 1,
        codePointCount: 80,
        exceedsMaximum: true,
      }),
    ]);
    expect(plan?.rows[0]?.value.fragmentIds).toHaveLength(1);
  });

  it('rejects open, contradictory, or out-of-budget profiles', () => {
    expect(
      decodeEntrySplitRuleProfile({
        revision: 0,
        mode: 'merge_short_adjacent',
        minimumGroupCodePoints: 100,
        maximumGroupCodePoints: 50,
        maximumFragmentsPerGroup: 2,
      }),
    ).toBeUndefined();
    expect(
      decodeEntrySplitRuleProfile({
        revision: 0,
        mode: 'one_section',
        minimumGroupCodePoints: 1,
        maximumGroupCodePoints: 1,
        maximumFragmentsPerGroup: 1,
        script: 'not allowed',
      }),
    ).toBeUndefined();
  });
});

function snapshot(
  texts: readonly string[],
): Readonly<MaterializedEvidenceSnapshot> {
  let start = 0;
  return Object.freeze({
    workspaceId: WORKSPACE_ID,
    resourceId: RESOURCE_ID,
    snapshotId: SNAPSHOT_ID,
    isPrivate: true,
    structures: Object.freeze([
      Object.freeze({
        structureId: STRUCTURE_ID,
        fragments: Object.freeze(
          texts.map((selectedText, index) => {
            const currentStart = start;
            start += Array.from(selectedText).length + 1;
            return Object.freeze({
              fragmentId: `55555555-5555-4555-8555-55555555555${(index + 1).toString()}`,
              structureId: STRUCTURE_ID,
              nodeKind: 'section',
              codePointRange: Object.freeze({
                start: currentStart,
                end: currentStart + Array.from(selectedText).length,
              }),
              selectedText,
            });
          }),
        ),
      }),
    ]),
  });
}
