import {describe, expect, it} from 'vitest';

import {
  assertM1dEntryWorkspace,
  createEmptyM1dEntrySnapshot,
  M1D_ENTRY_BUNDLE_SCHEMA,
  M1D_ENTRY_TABLES,
  M1D_ENTRY_VERSION_FOUR_BUNDLE_CODEC,
  M1D_ENTRY_VERSION_FOUR_BUNDLE_SCHEMA,
  M1D_ENTRY_VERSION_THREE_BUNDLE_CODEC,
  M1D_ENTRY_VERSION_THREE_BUNDLE_SCHEMA,
  M1D_ENTRY_VERSION_TWO_BUNDLE_CODEC,
  M1D_ENTRY_VERSION_TWO_BUNDLE_SCHEMA,
  m1dEntryTableCounts,
  normalizeM1dEntrySnapshot,
} from './m1d_entry_bundle.js';

const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_WORKSPACE_ID = '22222222-2222-4222-8222-222222222222';
const CREATED_AT = '2040-01-02T03:04:05.000Z';

describe('M1D Entry Bundle section', () => {
  it('normalizes all nine current Entry, range, document-tag, and working-copy tables deterministically', () => {
    const first = syntheticSnapshot(false);
    const reversed = syntheticSnapshot(true);

    expect(reversed).toEqual(first);
    expect(first.tables).toHaveLength(9);
    expect(m1dEntryTableCounts(first)).toMatchObject({
      information_entry: 2,
      information_document_tag_set: 1,
      information_entry_fragment_range: 1,
      information_document_working_copy: 1,
    });
    expect(() => {
      assertM1dEntryWorkspace(first, WORKSPACE_ID);
    }).not.toThrow();
  });

  it('upgrades versions four, three, and two into current structure rows', () => {
    const current = syntheticSnapshot(false);
    const versionFourTables = current.tables.slice(0, -1);
    const versionThreeTables = versionFourTables.map((table) =>
      table.name === 'information_entry'
        ? {
            ...table,
            rows: table.rows.map((row) => {
              const previous = {...row};
              Reflect.deleteProperty(previous, 'is_current_structure');
              return previous;
            }),
          }
        : table,
    );
    const versionThree = {
      schemaVersion: M1D_ENTRY_VERSION_THREE_BUNDLE_SCHEMA,
      tables: versionThreeTables,
    };
    const versionFour = {
      schemaVersion: M1D_ENTRY_VERSION_FOUR_BUNDLE_SCHEMA,
      tables: versionFourTables,
    };
    const versionTwo = {
      schemaVersion: M1D_ENTRY_VERSION_TWO_BUNDLE_SCHEMA,
      tables: versionThreeTables.slice(0, -1),
    };

    const upgradedFour = M1D_ENTRY_VERSION_FOUR_BUNDLE_CODEC.decode(
      versionFour,
    ) as ReturnType<typeof normalizeM1dEntrySnapshot>;
    const upgradedThree = M1D_ENTRY_VERSION_THREE_BUNDLE_CODEC.decode(
      versionThree,
    ) as ReturnType<typeof normalizeM1dEntrySnapshot>;
    const upgraded = M1D_ENTRY_VERSION_TWO_BUNDLE_CODEC.decode(
      versionTwo,
    ) as ReturnType<typeof normalizeM1dEntrySnapshot>;

    expect(
      upgradedThree.tables[0]?.rows.every(
        (row) => row.is_current_structure === true,
      ),
    ).toBe(true);
    expect(upgradedFour.tables).toHaveLength(9);
    expect(upgradedFour.tables.at(-1)).toEqual({
      name: 'information_document_working_copy',
      rows: [],
    });
    expect(upgraded.schemaVersion).toBe(M1D_ENTRY_BUNDLE_SCHEMA);
    expect(upgraded.tables).toHaveLength(9);
    expect(upgraded.tables.at(-1)).toEqual({
      name: 'information_document_working_copy',
      rows: [],
    });
  });
  it('rejects schema drift and cross-workspace rows', () => {
    const raw = JSON.parse(JSON.stringify(syntheticSnapshot(false))) as {
      tables: {name: string; rows: Record<string, unknown>[]}[];
    };
    const entryRow = raw.tables[0]?.rows[0];
    if (entryRow === undefined) throw new Error('Synthetic Entry row missing.');
    entryRow.unexpected = true;
    expect(() => normalizeM1dEntrySnapshot(raw)).toThrow(
      'The M1D Entry Bundle section is invalid.',
    );

    expect(() => {
      assertM1dEntryWorkspace(syntheticSnapshot(false), OTHER_WORKSPACE_ID);
    }).toThrow('The M1D Entry Bundle section is invalid.');
  });

  it('creates an exact empty section for legacy Bundle restoration', () => {
    const empty = createEmptyM1dEntrySnapshot();

    expect(empty.schemaVersion).toBe(M1D_ENTRY_BUNDLE_SCHEMA);
    expect(empty.tables.map((table) => table.name)).toEqual(
      M1D_ENTRY_TABLES.map((table) => table.name),
    );
    expect(empty.tables.every((table) => table.rows.length === 0)).toBe(true);
  });

  it('does not impose a one-MiB sort ceiling on source-bound Entry bodies', () => {
    const body = '\t'.repeat(600_000);
    const snapshot = normalizeM1dEntrySnapshot({
      schemaVersion: M1D_ENTRY_BUNDLE_SCHEMA,
      tables: M1D_ENTRY_TABLES.map((descriptor) => ({
        name: descriptor.name,
        rows:
          descriptor.name === 'information_entry'
            ? [
                entryRow(
                  '33333333-3333-4333-8333-333333333333',
                  '44444444-4444-4444-8444-444444444444',
                  body,
                ),
                entryRow(
                  '55555555-5555-4555-8555-555555555555',
                  '66666666-6666-4666-8666-666666666666',
                  body,
                ),
              ]
            : [],
      })),
    });

    expect(
      snapshot.tables.find((table) => table.name === 'information_entry')?.rows,
    ).toHaveLength(2);
  });
});

function syntheticSnapshot(reverseEntries: boolean) {
  const entryRows = [
    entryRow(
      '33333333-3333-4333-8333-333333333333',
      '44444444-4444-4444-8444-444444444444',
    ),
    entryRow(
      '55555555-5555-4555-8555-555555555555',
      '66666666-6666-4666-8666-666666666666',
    ),
  ];
  if (reverseEntries) entryRows.reverse();
  return normalizeM1dEntrySnapshot({
    schemaVersion: M1D_ENTRY_BUNDLE_SCHEMA,
    tables: M1D_ENTRY_TABLES.map((descriptor) => ({
      name: descriptor.name,
      rows:
        descriptor.name === 'information_entry'
          ? entryRows
          : descriptor.name === 'information_entry_fragment_range'
            ? [
                {
                  workspace_id: WORKSPACE_ID,
                  entry_id: '33333333-3333-4333-8333-333333333333',
                  input_ordinal: 0,
                  start_code_point: 0,
                  end_code_point: 5,
                  created_at: CREATED_AT,
                },
              ]
            : descriptor.name === 'information_document_tag_set'
              ? [
                  {
                    workspace_id: WORKSPACE_ID,
                    resource_id: '77777777-7777-4777-8777-777777777777',
                    snapshot_id: '88888888-8888-4888-8888-888888888888',
                    current_revision: 1,
                    current_revision_id: '99999999-9999-4999-8999-999999999999',
                    revision_kind: 'deterministic_aggregate',
                    rule_version: 'synthetic-v1',
                    is_private: false,
                    entry_count: 2,
                    created_at: CREATED_AT,
                    updated_at: CREATED_AT,
                  },
                ]
              : descriptor.name === 'information_document_working_copy'
                ? [
                    {
                      workspace_id: WORKSPACE_ID,
                      source_snapshot_id:
                        '88888888-8888-4888-8888-888888888888',
                      revision: 1,
                      state: 'editing',
                      draft_body: 'Edited synthetic document.',
                      body_sha256: 'b'.repeat(64),
                      derived_resource_id: null,
                      derived_snapshot_id: null,
                      created_at: CREATED_AT,
                      updated_at: CREATED_AT,
                      committed_at: null,
                    },
                  ]
                : [],
    })),
  });
}

function entryRow(
  entryId: string,
  revisionId: string,
  body = 'Synthetic Entry body.',
) {
  return {
    workspace_id: WORKSPACE_ID,
    entry_id: entryId,
    resource_id: '77777777-7777-4777-8777-777777777777',
    snapshot_id: '88888888-8888-4888-8888-888888888888',
    current_revision: 1,
    current_revision_id: revisionId,
    document_order: 0,
    title_path: '',
    body,
    body_sha256: 'a'.repeat(64),
    chunk_mode: 'split',
    split_rule_version: 'synthetic-v1',
    is_private: false,
    is_current_structure: true,
    type_keyword: null,
    type_custom_name: null,
    usefulness_score: null,
    interest_score: null,
    created_at: CREATED_AT,
    updated_at: CREATED_AT,
  };
}
