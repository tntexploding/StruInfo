import {describe, expect, it} from 'vitest';

import {
  assertM1dAssociationWorkspace,
  createEmptyM1dAssociationSnapshot,
  M1D_ASSOCIATION_BUNDLE_SCHEMA,
  M1D_ASSOCIATION_TABLES,
  m1dAssociationTableCounts,
  normalizeM1dAssociationSnapshot,
} from './m1d_association_bundle.js';

const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_WORKSPACE_ID = '22222222-2222-4222-8222-222222222222';
const CREATED_AT = '2040-01-02T03:04:05.000Z';

describe('M1D Association Bundle section', () => {
  it('normalizes both current projection and override tables deterministically', () => {
    const first = syntheticSnapshot(false);
    const reversed = syntheticSnapshot(true);

    expect(reversed).toEqual(first);
    expect(first.tables).toHaveLength(2);
    expect(m1dAssociationTableCounts(first)).toMatchObject({
      information_entry_association_projection: 2,
      information_entry_association_override: 1,
    });
    expect(() => {
      assertM1dAssociationWorkspace(first, WORKSPACE_ID);
    }).not.toThrow();
  });

  it('rejects schema drift, structured row values, and cross-workspace rows', () => {
    const raw = JSON.parse(JSON.stringify(syntheticSnapshot(false))) as {
      tables: {name: string; rows: Record<string, unknown>[]}[];
    };
    const projection = raw.tables[0]?.rows[0];
    if (projection === undefined) {
      throw new Error('Synthetic association projection missing.');
    }
    projection.candidate_basis = ['content_keyword'];
    expect(() => normalizeM1dAssociationSnapshot(raw)).toThrow(
      'The M1D Association Bundle section is invalid.',
    );

    expect(() => {
      assertM1dAssociationWorkspace(
        syntheticSnapshot(false),
        OTHER_WORKSPACE_ID,
      );
    }).toThrow('The M1D Association Bundle section is invalid.');
  });

  it('creates an exact empty section for older Bundle restoration', () => {
    const empty = createEmptyM1dAssociationSnapshot();

    expect(empty.schemaVersion).toBe(M1D_ASSOCIATION_BUNDLE_SCHEMA);
    expect(empty.tables.map((table) => table.name)).toEqual(
      M1D_ASSOCIATION_TABLES.map((table) => table.name),
    );
    expect(empty.tables.every((table) => table.rows.length === 0)).toBe(true);
  });
});

function syntheticSnapshot(reverseProjections: boolean) {
  const projections = [
    projectionRow(
      '33333333-3333-4333-8333-333333333333',
      '44444444-4444-4444-8444-444444444444',
      '55555555-5555-4555-8555-555555555555',
      '66666666-6666-4666-8666-666666666666',
      1,
    ),
    projectionRow(
      '33333333-3333-4333-8333-333333333333',
      '77777777-7777-4777-8777-777777777777',
      '55555555-5555-4555-8555-555555555555',
      '88888888-8888-4888-8888-888888888888',
      2,
    ),
  ];
  if (reverseProjections) projections.reverse();
  return normalizeM1dAssociationSnapshot({
    schemaVersion: M1D_ASSOCIATION_BUNDLE_SCHEMA,
    tables: M1D_ASSOCIATION_TABLES.map((descriptor) => ({
      name: descriptor.name,
      rows:
        descriptor.name === 'information_entry_association_projection'
          ? projections
          : descriptor.name === 'information_entry_association_override'
            ? [
                {
                  workspace_id: WORKSPACE_ID,
                  entry_low_id: '33333333-3333-4333-8333-333333333333',
                  entry_high_id: '44444444-4444-4444-8444-444444444444',
                  current_revision: 1,
                  current_revision_id: '99999999-9999-4999-8999-999999999999',
                  action: 'enhance',
                  manual_adjustment: 1500,
                  is_blocked: false,
                  graph_origin: null,
                  graph_label: null,
                  graph_direction: null,
                  graph_semantic_kind: null,
                  graph_verification_status: null,
                  graph_note: null,
                  created_at: CREATED_AT,
                  updated_at: CREATED_AT,
                },
              ]
            : [],
    })),
  });
}

function projectionRow(
  entryLowId: string,
  entryHighId: string,
  entryLowRevisionId: string,
  entryHighRevisionId: string,
  candidateRank: number,
) {
  return {
    workspace_id: WORKSPACE_ID,
    entry_low_id: entryLowId,
    entry_high_id: entryHighId,
    entry_low_revision: 1,
    entry_low_revision_id: entryLowRevisionId,
    entry_high_revision: 1,
    entry_high_revision_id: entryHighRevisionId,
    content_similarity: 2500,
    type_similarity: 10000,
    domain_similarity: 5000,
    base_score: 4125,
    algorithm_version: 'synthetic-association-v1',
    candidate_basis: 'content_keyword,type_keyword',
    candidate_rank: candidateRank,
    generated_at: CREATED_AT,
  };
}
