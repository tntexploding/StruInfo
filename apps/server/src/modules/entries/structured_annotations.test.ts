import assert from 'node:assert/strict';
import {describe, it, expect} from 'vitest';
import {
  annotationVocabularySchema,
  validateAnnotationEvidence,
  equivalentTermIds,
  annotationState,
  type AnnotationVocabulary,
  type StructuredAnnotations,
} from './structured_annotations.js';
import {searchCurrentInformationEntries} from './information_entry_search.js';
import {decodeEntrySearchBody} from './information_entry_search_request.js';
import {decodeEntrySavedQuery} from './information_entry_saved_queries.js';
import {
  informationEntryBodySha256,
  deriveInformationEntryRevisionId,
} from './information_entry_identity.js';
import type {CurrentInformationEntry} from './information_entry_contract.js';

function required<T>(value: T | undefined): T {
  assert(value !== undefined);
  return value;
}
const id = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const dimension = {
  id: id(1),
  name: '对象',
  role: 'entity' as const,
  description: '具体对象',
  enabled: true,
};
const term = (n: number, meaning: string) => ({
  id: id(n),
  dimensionId: id(1),
  label: 'Mercury',
  meaning,
});
const vocabulary: AnnotationVocabulary = {
  revision: 1,
  dimensions: [dimension],
  terms: [
    term(2, 'planet'),
    term(3, 'element'),
    {...term(4, 'planet'), label: '水星'},
  ],
  aliases: [{termId: id(2), text: '晨星甲', status: 'pending'}],
  relations: [
    {from: id(2), to: id(4), kind: 'equivalent', status: 'confirmed'},
    {from: id(2), to: id(3), kind: 'related', status: 'confirmed'},
  ],
};
function annotated(n = 2): CurrentInformationEntry {
  const body = '🛰 Mercury is a planet.';
  const hash = informationEntryBodySha256(body);
  const annotations: StructuredAnnotations = {
    schemaVersion: 1,
    vocabularyRevision: 1,
    dimensions: [dimension],
    inputRevision: 1,
    inputBodySha256: hash,
    origin: 'manual',
    originVersion: 'synthetic.v1',
    status: 'complete',
    note: '',
    readingState: 'read',
    labels: [
      {
        dimensionId: id(1),
        term: term(n, n === 2 ? 'planet' : 'element'),
        wording: 'Mercury',
        primary: true,
        evidence: {start: 2, end: 9, quote: 'Mercury'},
      },
    ],
    claims: [],
  };
  return {
    workspaceId: id(8),
    entryId: id(n + 10),
    resourceId: id(9),
    snapshotId: id(10),
    revision: 2,
    revisionId: deriveInformationEntryRevisionId(id(n + 10), 2),
    sourceKey: 'synthetic',
    capturedAt: '2026-10-24T00:00:00.000Z',
    value: {
      documentOrder: 0,
      titlePath: 'Synthetic',
      body,
      bodySha256: hash,
      chunkMode: 'whole',
      splitRuleVersion: 'synthetic',
      isPrivate: false,
      fragmentIds: [id(20)],
      contentKeywords: [],
      domains: [],
      annotations,
    },
  };
}
describe('structured annotations', () => {
  it('checks Unicode body ranges and does not accept missing or borrowed evidence', () => {
    const e = annotated(),
      a = required(e.value.annotations);
    expect(validateAnnotationEvidence(a, e.value.body)).toBe(true);
    expect(
      validateAnnotationEvidence(
        {
          ...a,
          labels: [
            {
              ...required(a.labels[0]),
              evidence: {start: 2, end: 9, quote: 'Jupiter'},
            },
          ],
        },
        e.value.body,
      ),
    ).toBe(false);
    expect(
      validateAnnotationEvidence({...a, status: 'none'}, e.value.body),
    ).toBe(false);
    expect(annotationState(a, informationEntryBodySha256('new body'))).toBe(
      'stale',
    );
    expect(annotationState(undefined, e.value.bodySha256)).toBe('unannotated');
  });
  it('expands only confirmed equivalent identities and keeps homonyms and related terms distinct', () => {
    expect([...equivalentTermIds(id(2), vocabulary)]).toEqual([id(2), id(4)]);
    const result = searchCurrentInformationEntries(
      [annotated(), annotated(3)],
      {includePrivate: false, limit: 20, annotationFilter: {termIds: [id(4)]}},
      undefined,
      undefined,
      undefined,
      [],
      vocabulary,
    );
    expect(result.items.map((x) => x.entry.entryId)).toEqual([id(12)]);
  });
  it('retrieves translations and confirmed aliases but not pending aliases', () => {
    const search = (text: string, v = vocabulary) =>
      searchCurrentInformationEntries(
        [annotated(), annotated(3)],
        {includePrivate: false, limit: 20, text, textFields: ['tags']},
        undefined,
        undefined,
        undefined,
        [],
        v,
      );
    expect(search('水星').totalCount).toBe(1);
    expect(search('晨星甲').totalCount).toBe(0);
    expect(
      search('晨星甲', {
        ...vocabulary,
        aliases: [{...required(vocabulary.aliases[0]), status: 'confirmed'}],
      }).totalCount,
    ).toBe(1);
  });
  it('filters status and reading progress without admitting private or stale labels', () => {
    const e = annotated();
    const privateEntry = {
      ...e,
      entryId: id(30),
      value: {...e.value, isPrivate: true},
    };
    expect(
      searchCurrentInformationEntries([e, privateEntry], {
        includePrivate: false,
        limit: 20,
        annotationFilter: {readingState: 'read'},
      }).totalCount,
    ).toBe(1);
    const stale = {
      ...e,
      value: {...e.value, bodySha256: informationEntryBodySha256('changed')},
    };
    expect(
      searchCurrentInformationEntries([stale], {
        includePrivate: false,
        limit: 20,
        annotationFilter: {dimensionId: id(1)},
      }).totalCount,
    ).toBe(0);
    expect(
      searchCurrentInformationEntries([stale], {
        includePrivate: false,
        limit: 20,
        annotationFilter: {status: 'stale'},
      }).totalCount,
    ).toBe(1);
  });
  it('binds cursors to vocabulary and filter versions and persists saved classification filters', () => {
    const query = {
      includePrivate: false,
      annotationFilter: {termIds: [id(2)], readingState: 'read' as const},
    };
    expect(
      decodeEntrySearchBody({...query, limit: 10})?.annotationFilter,
    ).toEqual(query.annotationFilter);
    expect(
      decodeEntrySavedQuery({viewId: id(40), name: 'Planets', query})?.query
        .annotationFilter,
    ).toEqual(query.annotationFilter);
    const result = searchCurrentInformationEntries(
      [annotated(), {...annotated(), entryId: id(31)}],
      {...query, limit: 1},
      undefined,
      undefined,
      undefined,
      [],
      vocabulary,
    );
    expect(result.nextCursor).toBeDefined();
    if (!result.nextCursor) throw new Error('Missing test cursor');
    expect(() =>
      searchCurrentInformationEntries(
        [annotated()],
        {...query, limit: 1, after: required(result.nextCursor)},
        undefined,
        undefined,
        undefined,
        [],
        {...vocabulary, revision: 2},
      ),
    ).toThrow();
  });
  it('rejects dangling identities and cross-dimensional equivalence', () => {
    expect(
      annotationVocabularySchema.safeParse({...vocabulary, terms: []}).success,
    ).toBe(false);
    expect(
      annotationVocabularySchema.safeParse({
        ...vocabulary,
        terms: [...vocabulary.terms, vocabulary.terms[0]],
      }).success,
    ).toBe(false);
    expect(
      decodeEntrySearchBody({
        annotationFilter: {status: 'invented'},
        limit: 10,
      }),
    ).toBeUndefined();
  });
});
