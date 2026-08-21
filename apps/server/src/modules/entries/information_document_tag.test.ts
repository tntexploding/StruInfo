import {describe, expect, it} from 'vitest';

import type {CurrentInformationEntry} from './information_entry_contract.js';
import {
  INFORMATION_DOCUMENT_TAG_AGGREGATION_VERSION,
  INFORMATION_DOCUMENT_TAG_MANUAL_VERSION,
  prepareAggregatedInformationDocumentTags,
  prepareManualInformationDocumentTags,
} from './information_document_tag.js';

const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';
const RESOURCE_ID = '22222222-2222-4222-8222-222222222222';
const SNAPSHOT_ID = '33333333-3333-4333-8333-333333333333';

describe('Information Document tags', () => {
  it('ranks Entry keyword candidates by full-text tendency, then Entry coverage', () => {
    const value = prepareAggregatedInformationDocumentTags({
      normalizedText:
        'PostgreSQL PostgreSQL PostgreSQL TypeScript TypeScript tool',
      isPrivate: false,
      entries: [
        entry(1, ['PostgreSQL', 'tool']),
        entry(2, ['PostgreSQL', 'TypeScript']),
      ],
    });

    expect(value).toEqual({
      revisionKind: 'aggregate',
      ruleVersion: INFORMATION_DOCUMENT_TAG_AGGREGATION_VERSION,
      isPrivate: false,
      entryCount: 2,
      tags: [
        {
          displayValue: 'PostgreSQL',
          normalizedValue: 'postgresql',
          origin: 'aggregate',
          fullTextOccurrences: 3,
          entryCoverageCount: 2,
        },
        {
          displayValue: 'TypeScript',
          normalizedValue: 'typescript',
          origin: 'aggregate',
          fullTextOccurrences: 2,
          entryCoverageCount: 1,
        },
        {
          displayValue: 'tool',
          normalizedValue: 'tool',
          origin: 'aggregate',
          fullTextOccurrences: 1,
          entryCoverageCount: 1,
        },
      ],
    });
  });

  it('creates an exact manual revision while retaining transparent metrics', () => {
    const input = {
      normalizedText: 'e\u0301 PostgreSQL',
      isPrivate: true,
      entries: [entry(1, ['PostgreSQL'], true)],
    } as const;

    expect(
      prepareManualInformationDocumentTags(input, [' é ', 'Database']),
    ).toEqual({
      revisionKind: 'manual',
      ruleVersion: INFORMATION_DOCUMENT_TAG_MANUAL_VERSION,
      isPrivate: true,
      entryCount: 1,
      tags: [
        {
          displayValue: 'é',
          normalizedValue: 'é',
          origin: 'manual',
          fullTextOccurrences: 1,
          entryCoverageCount: 0,
        },
        {
          displayValue: 'Database',
          normalizedValue: 'database',
          origin: 'manual',
          fullTextOccurrences: 0,
          entryCoverageCount: 0,
        },
      ],
    });
    expect(
      prepareManualInformationDocumentTags(input, ['ABC', 'abc']),
    ).toBeUndefined();
    expect(
      prepareAggregatedInformationDocumentTags({
        ...input,
        isPrivate: false,
      }),
    ).toBeUndefined();
  });
});

function entry(
  order: number,
  keywords: readonly string[],
  isPrivate = false,
): Readonly<CurrentInformationEntry> {
  const suffix = (order + 10).toString().padStart(12, '0');
  return Object.freeze({
    workspaceId: WORKSPACE_ID,
    entryId: `44444444-4444-4444-8444-${suffix}`,
    resourceId: RESOURCE_ID,
    snapshotId: SNAPSHOT_ID,
    revision: 2,
    revisionId: `55555555-5555-4555-8555-${suffix}`,
    sourceKey: 'synthetic:document',
    capturedAt: '2040-01-02T03:04:05.000Z',
    value: Object.freeze({
      documentOrder: order,
      titlePath: `Entry ${order.toString()}`,
      body: 'Synthetic body',
      bodySha256: 'a'.repeat(64),
      chunkMode: 'split' as const,
      splitRuleVersion: 'struinfo.entry-split.section.v1',
      isPrivate,
      contentKeywords: Object.freeze(
        keywords.map((displayValue) =>
          Object.freeze({
            displayValue,
            normalizedValue: displayValue.toLowerCase(),
            origin: 'manual' as const,
            originVersion: 'manual-entry-editor.v1',
          }),
        ),
      ),
      domains: Object.freeze([]),
      fragmentIds: Object.freeze([]),
    }),
  });
}
