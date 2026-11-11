import assert from 'node:assert/strict';
import {describe, it, expect, vi} from 'vitest';
import {
  migrateLegacyEntryTags,
  legacyTagVocabulary,
} from './legacy_tag_migration.js';
import {
  EMPTY_ANNOTATION_VOCABULARY,
  annotationDraftSchema,
} from './structured_annotations.js';
import {informationEntryBodySha256} from './information_entry_identity.js';
import type {CurrentInformationEntry} from './information_entry_contract.js';
import {entryTagWords} from './entry_tags.js';
import {topicLabels} from './topic_candidates.js';
import {searchCurrentInformationEntries} from './information_entry_search.js';
import {AnnotationService} from '../../application/annotation_service.js';
import {ExecutionAuthority} from '../../application/execution_authority.js';
import {createReviewPreferences} from '../../storage/review_preferences_store.js';
const id = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
function fixture(): CurrentInformationEntry {
  const body = 'A synthetic reference about memory.';
  return {
    workspaceId: id(1),
    entryId: id(2),
    resourceId: id(3),
    snapshotId: id(4),
    revision: 2,
    revisionId: id(5),
    sourceKey: 'synthetic',
    capturedAt: '2026-11-10T00:00:00.000Z',
    value: {
      documentOrder: 0,
      titlePath: 'Synthetic',
      body,
      bodySha256: informationEntryBodySha256(body),
      chunkMode: 'whole',
      splitRuleVersion: 'synthetic',
      isPrivate: false,
      fragmentIds: [id(6)],
      contentKeywords: [
        {
          displayValue: 'Memory',
          normalizedValue: 'memory',
          origin: 'manual',
          originVersion: 'manual.v1',
        },
      ],
      typeKeyword: 'knowledge_explanation',
      domains: [
        {
          keyword: 'engineering_computing',
          origin: 'ai',
          originVersion: 'old.ai',
        },
      ],
    },
  };
}
describe('legacy tag migration', () => {
  it('moves labels once, preserves manual provenance and body, and feeds the common readers', () => {
    const before = fixture(),
      vocabulary = legacyTagVocabulary(EMPTY_ANNOTATION_VOCABULARY);
    const after = migrateLegacyEntryTags(before, vocabulary);
    expect(after.value.body).toBe(before.value.body);
    expect(after.revision).toBe(before.revision);
    expect(after.value).toMatchObject({
      contentKeywords: [],
      domains: [],
      annotations: {status: 'partial', origin: 'manual'},
    });
    expect(after.value.typeKeyword).toBeUndefined();
    expect(entryTagWords(after.value)).toEqual([
      'Memory',
      '知识解释',
      '工程与计算',
    ]);
    expect(after.value.annotations?.labels[0]).toMatchObject({
      term: {meaning: ''},
      legacy: {origin: 'manual', originVersion: 'manual.v1'},
    });
    expect(topicLabels(after, vocabulary).map((l) => l.label)).toContain(
      'Memory',
    );
    expect(
      searchCurrentInformationEntries([after], {
        includePrivate: false,
        limit: 20,
        typeKeyword: 'knowledge_explanation',
        domainKeyword: 'engineering_computing',
      }).totalCount,
    ).toBe(1);
    expect(migrateLegacyEntryTags(after, vocabulary)).toBe(after);
    expect(
      annotationDraftSchema.safeParse(after.value.annotations).success,
    ).toBe(false);
  });
  it('keeps a newer annotation authoritative and gives identical legacy labels one identity', () => {
    const v = legacyTagVocabulary(EMPTY_ANNOTATION_VOCABULARY);
    const a = migrateLegacyEntryTags(fixture(), v);
    const b = migrateLegacyEntryTags({...fixture(), entryId: id(12)}, v);
    expect(a.value.annotations?.labels[0]?.term.id).toBe(
      b.value.annotations?.labels[0]?.term.id,
    );
    assert(a.value.annotations);
    const newer = {
      ...a,
      value: {...fixture().value, annotations: a.value.annotations},
    };
    expect(migrateLegacyEntryTags(newer, v).value.annotations).toEqual(
      a.value.annotations,
    );
  });
  it('allows unchanged migrated labels when editing but rejects fabricated migration provenance', async () => {
    const vocabulary = legacyTagVocabulary(EMPTY_ANNOTATION_VOCABULARY),
      entry = migrateLegacyEntryTags(fixture(), vocabulary);
    const reviseEntry = vi.fn(() => Promise.resolve('applied' as const));
    const service = new AnnotationService({
      workspaceId: entry.workspaceId,
      stage: vi.fn(() => Promise.resolve(undefined)),
      entries: {
        loadCurrentEntries: () => Promise.resolve([entry]),
        reviseEntry,
        materializeEntries: () =>
          Promise.resolve({
            outcome: 'existing' as const,
            createdCount: 0,
          }),
      },
      preferences: {
        load: () =>
          Promise.resolve({
            ...createReviewPreferences(entry.workspaceId, []),
            annotationVocabulary: vocabulary,
          }),
        save: vi.fn(),
      },
    });
    const a = entry.value.annotations;
    assert(a);
    const input = {
      entryId: entry.entryId,
      expectedRevision: entry.revision,
      vocabularyRevision: vocabulary.revision,
      annotation: {
        status: a.status,
        note: a.note,
        readingState: 'read',
        labels: a.labels,
        claims: a.claims,
      },
    };
    const owner = ExecutionAuthority.owner(entry.workspaceId);
    await service.execute(owner, 'entry_annotations_save', input);
    expect(reviseEntry).toHaveBeenCalledTimes(1);
    await expect(
      service.execute(owner, 'entry_annotations_save', {
        ...input,
        annotation: {
          ...input.annotation,
          labels: [{...a.labels[0], wording: 'invented'}],
        },
      }),
    ).rejects.toMatchObject({code: 'annotation_evidence_invalid'});
    expect(reviseEntry).toHaveBeenCalledTimes(1);
  });
});
