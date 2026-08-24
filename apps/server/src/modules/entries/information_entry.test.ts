import {describe, expect, it} from 'vitest';

import type {CurrentInformationEntry} from './information_entry_contract.js';
import {
  informationEntrySearchKey,
  prepareManualEntryRevision,
  prepareManualSplitInformationEntries,
  prepareSplitInformationEntries,
} from './information_entry.js';
import {searchCurrentInformationEntries} from './information_entry_search.js';

const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';
const RESOURCE_ID = '22222222-2222-4222-8222-222222222222';
const SNAPSHOT_ID = '33333333-3333-4333-8333-333333333333';
const STRUCTURE_ID = '44444444-4444-4444-8444-444444444444';

describe('InformationEntry', () => {
  it('materializes one stable Entry per section while preserving exact provenance and privacy', () => {
    const snapshot = Object.freeze({
      workspaceId: WORKSPACE_ID,
      resourceId: RESOURCE_ID,
      snapshotId: SNAPSHOT_ID,
      isPrivate: true as const,
      structures: [
        {
          structureId: STRUCTURE_ID,
          fragments: [
            fragment(
              '66666666-6666-4666-8666-666666666666',
              'paragraph',
              5,
              'ignored',
            ),
            fragment(
              '55555555-5555-4555-8555-555555555555',
              'section',
              0,
              '## Synthetic Tool\n\nA compact source-backed entry.',
            ),
          ],
        },
      ],
    });

    const first = prepareSplitInformationEntries(snapshot);
    const replay = prepareSplitInformationEntries(snapshot);

    expect(first).toEqual(replay);
    expect(first).toHaveLength(1);
    expect(first[0]).toMatchObject({
      workspaceId: WORKSPACE_ID,
      resourceId: RESOURCE_ID,
      snapshotId: SNAPSHOT_ID,
      value: {
        documentOrder: 0,
        titlePath: 'Synthetic Tool',
        body: '## Synthetic Tool\n\nA compact source-backed entry.',
        chunkMode: 'split',
        isPrivate: true,
        fragmentIds: ['55555555-5555-4555-8555-555555555555'],
      },
    });
    expect(first[0]?.entryId).toMatch(/^[0-9a-f-]{36}$/u);
    expect(first[0]?.revisionId).toMatch(/^[0-9a-f-]{36}$/u);
    expect(first[0]?.value.bodySha256).toMatch(/^[0-9a-f]{64}$/u);
  });

  it('groups every section range exactly once for stable manual materialization', () => {
    const firstId = '55555555-5555-4555-8555-555555555555';
    const secondId = '66666666-6666-4666-8666-666666666666';
    const firstText = '## First\n\nFirst body.';
    const secondText = '## Second\n\nSecond body.';
    const firstRange = Object.freeze({
      fragmentId: firstId,
      startCodePoint: 0,
      endCodePoint: Array.from(firstText).length,
    });
    const secondRange = Object.freeze({
      fragmentId: secondId,
      startCodePoint: 0,
      endCodePoint: Array.from(secondText).length,
    });
    const snapshot = Object.freeze({
      workspaceId: WORKSPACE_ID,
      resourceId: RESOURCE_ID,
      snapshotId: SNAPSHOT_ID,
      isPrivate: true as const,
      structures: [
        {
          structureId: STRUCTURE_ID,
          fragments: [
            fragment(secondId, 'section', 40, secondText),
            fragment(firstId, 'section', 0, firstText),
          ],
        },
      ],
    });

    const rows = prepareManualSplitInformationEntries(snapshot, [
      {
        titlePath: ' Combined entry ',
        fragments: [firstRange, secondRange],
      },
    ]);
    const replay = prepareManualSplitInformationEntries(snapshot, [
      {titlePath: 'Combined entry', fragments: [firstRange, secondRange]},
    ]);

    expect(rows).toEqual(replay);
    expect(rows).toHaveLength(1);
    expect(rows?.[0]).toMatchObject({
      value: {
        documentOrder: 0,
        titlePath: 'Combined entry',
        body: `${firstText}\n\n${secondText}`,
        splitRuleVersion: 'struinfo.entry-split.manual-range.v1',
        isPrivate: true,
        fragmentIds: [firstId, secondId],
        fragmentRanges: [
          {startCodePoint: 0, endCodePoint: Array.from(firstText).length},
          {startCodePoint: 0, endCodePoint: Array.from(secondText).length},
        ],
      },
    });
    expect(
      prepareManualSplitInformationEntries(snapshot, [
        {
          titlePath: 'Second first',
          fragments: [secondRange, firstRange],
        },
      ]),
    ).toBeUndefined();
    expect(
      prepareManualSplitInformationEntries(snapshot, [
        {titlePath: 'Missing section', fragments: [firstRange]},
      ]),
    ).toBeUndefined();
    expect(
      prepareManualSplitInformationEntries(snapshot, [
        {
          titlePath: 'Different title',
          fragments: [firstRange, secondRange],
        },
      ])?.[0]?.entryId,
    ).not.toBe(rows?.[0]?.entryId);
  });

  it('splits a Fragment by Unicode scalar boundaries and rejects gaps', () => {
    const fragmentId = '55555555-5555-4555-8555-555555555555';
    const selectedText = 'A😀e\u0301Z';
    const snapshot = Object.freeze({
      workspaceId: WORKSPACE_ID,
      resourceId: RESOURCE_ID,
      snapshotId: SNAPSHOT_ID,
      structures: [
        {
          structureId: STRUCTURE_ID,
          fragments: [fragment(fragmentId, 'section', 0, selectedText)],
        },
      ],
    });
    const split = prepareManualSplitInformationEntries(snapshot, [
      {
        titlePath: 'Left',
        fragments: [{fragmentId, startCodePoint: 0, endCodePoint: 2}],
      },
      {
        titlePath: 'Right',
        fragments: [{fragmentId, startCodePoint: 2, endCodePoint: 5}],
      },
    ]);

    expect(split?.map((entry) => entry.value.body)).toEqual(['A😀', 'éZ']);
    expect(split?.map((entry) => entry.value.fragmentRanges)).toEqual([
      [{startCodePoint: 0, endCodePoint: 2}],
      [{startCodePoint: 2, endCodePoint: 5}],
    ]);
    expect(
      prepareManualSplitInformationEntries(snapshot, [
        {
          titlePath: 'Gap',
          fragments: [{fragmentId, startCodePoint: 0, endCodePoint: 1}],
        },
        {
          titlePath: 'After gap',
          fragments: [{fragmentId, startCodePoint: 2, endCodePoint: 5}],
        },
      ]),
    ).toBeUndefined();
    expect(
      prepareManualSplitInformationEntries(snapshot, [
        {
          titlePath: 'Overlap',
          fragments: [{fragmentId, startCodePoint: 0, endCodePoint: 3}],
        },
        {
          titlePath: 'After overlap',
          fragments: [{fragmentId, startCodePoint: 2, endCodePoint: 5}],
        },
      ]),
    ).toBeUndefined();
  });
  it('normalizes manual keywords independently and preserves immutable source facts', () => {
    const current = currentEntry({isPrivate: true});
    const revision = prepareManualEntryRevision(current, {
      body: 'Revised body',
      contentKeywords: [' PostgreSQL ', 'e\u0301'],
      typeKeyword: 'other',
      typeCustomName: ' Synthetic Type ',
      domains: [
        {keyword: 'engineering_computing'},
        {keyword: 'other', customName: ' Synthetic Domain '},
      ],
    });

    expect(revision).toMatchObject({
      documentOrder: current.value.documentOrder,
      titlePath: current.value.titlePath,
      body: 'Revised body',
      chunkMode: 'split',
      isPrivate: true,
      typeKeyword: 'other',
      typeCustomName: 'Synthetic Type',
      fragmentIds: current.value.fragmentIds,
      contentKeywords: [
        {displayValue: 'PostgreSQL', normalizedValue: 'postgresql'},
        {displayValue: 'é', normalizedValue: 'é'},
      ],
      domains: [
        {keyword: 'engineering_computing'},
        {keyword: 'other', customName: 'Synthetic Domain'},
      ],
    });
    expect(
      prepareManualEntryRevision(current, {
        body: 'Revised body',
        contentKeywords: ['ABC', 'abc'],
        typeKeyword: 'factual_material',
        domains: [{keyword: 'engineering_computing'}],
      }),
    ).toBeUndefined();
  });

  it('searches body and three keyword dimensions while hiding private Entries by default', () => {
    const publicEntry = currentEntry();
    const privateEntry = currentEntry({
      entryId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      isPrivate: true,
      titlePath: 'Private PostgreSQL note',
    });

    const hidden = searchCurrentInformationEntries(
      [privateEntry, publicEntry],
      {text: 'postgresql', includePrivate: false, limit: 100},
    );
    expect(hidden.totalCount).toBe(1);
    expect(hidden.items[0]?.entry.entryId).toBe(publicEntry.entryId);
    expect(hidden.items[0]?.matchReasons).toEqual(['body', 'content_keyword']);

    const visible = searchCurrentInformationEntries(
      [privateEntry, publicEntry],
      {
        domainKeyword: 'engineering_computing',
        includePrivate: true,
        limit: 100,
      },
    );
    expect(visible.totalCount).toBe(2);
    expect(visible.items.every((item) => item.entry.value.isPrivate)).toBe(
      false,
    );
    expect(informationEntrySearchKey('J\u030c ABC')).toBe('ǰ abc');
  });
});

function fragment(
  fragmentId: string,
  nodeKind: string,
  start: number,
  selectedText: string,
) {
  return Object.freeze({
    fragmentId,
    structureId: STRUCTURE_ID,
    nodeKind,
    codePointRange: Object.freeze({
      start,
      end: start + Array.from(selectedText).length,
    }),
    selectedText,
  });
}

function currentEntry(
  overrides: Readonly<{
    entryId?: string;
    isPrivate?: boolean;
    titlePath?: string;
  }> = {},
): Readonly<CurrentInformationEntry> {
  return Object.freeze({
    workspaceId: WORKSPACE_ID,
    entryId: overrides.entryId ?? '77777777-7777-4777-8777-777777777777',
    resourceId: RESOURCE_ID,
    snapshotId: SNAPSHOT_ID,
    revision: 1,
    revisionId: '88888888-8888-4888-8888-888888888888',
    sourceKey: 'synthetic:entry-source',
    capturedAt: '2040-01-02T03:04:05.000Z',
    value: Object.freeze({
      documentOrder: 0,
      titlePath: overrides.titlePath ?? 'Synthetic Entry',
      body: 'PostgreSQL-backed searchable body',
      bodySha256: 'a'.repeat(64),
      chunkMode: 'split',
      splitRuleVersion: 'struinfo.entry-split.section.v1',
      isPrivate: overrides.isPrivate ?? false,
      typeKeyword: 'knowledge_explanation',
      contentKeywords: Object.freeze([
        Object.freeze({
          displayValue: 'PostgreSQL',
          normalizedValue: 'postgresql',
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
      fragmentIds: Object.freeze(['55555555-5555-4555-8555-555555555555']),
    }),
  });
}
