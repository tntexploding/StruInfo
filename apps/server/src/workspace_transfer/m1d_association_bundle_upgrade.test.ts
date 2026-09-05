import {describe, expect, it} from 'vitest';
import type {JsonValue} from '../serialization/canonical_json.js';

import {
  M1D_ASSOCIATION_BUNDLE_SCHEMA,
  M1D_ASSOCIATION_BUNDLE_CODEC,
  M1D_ASSOCIATION_VERSION_FOUR_BUNDLE_CODEC,
  M1D_ASSOCIATION_VERSION_FOUR_BUNDLE_SCHEMA,
  M1D_ASSOCIATION_VERSION_THREE_BUNDLE_CODEC,
  M1D_ASSOCIATION_VERSION_THREE_BUNDLE_SCHEMA,
  M1D_ASSOCIATION_VERSION_TWO_BUNDLE_CODEC,
  M1D_ASSOCIATION_VERSION_TWO_BUNDLE_SCHEMA,
} from './m1d_association_bundle.js';

const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';

describe('M1D Association Bundle v5 upgrade', () => {
  it('opens the prior current-state section with empty graph metadata', () => {
    const decoded = M1D_ASSOCIATION_VERSION_TWO_BUNDLE_CODEC.decode({
      schemaVersion: M1D_ASSOCIATION_VERSION_TWO_BUNDLE_SCHEMA,
      tables: [
        {name: 'information_entry_association_projection', rows: []},
        {
          name: 'information_entry_association_override',
          rows: [
            {
              workspace_id: WORKSPACE_ID,
              entry_low_id: '22222222-2222-4222-8222-222222222222',
              entry_high_id: '33333333-3333-4333-8333-333333333333',
              current_revision: 1,
              current_revision_id: '44444444-4444-4444-8444-444444444444',
              action: 'enhance',
              manual_adjustment: 1500,
              is_blocked: false,
              created_at: '2040-01-02T03:04:05.000Z',
              updated_at: '2040-01-02T03:04:05.000Z',
            },
          ],
        },
      ],
    });

    expect(decoded).toMatchObject({
      schemaVersion: M1D_ASSOCIATION_BUNDLE_SCHEMA,
      tables: [
        {name: 'information_entry_association_projection', rows: []},
        {
          name: 'information_entry_association_override',
          rows: [
            {
              graph_origin: null,
              graph_label: null,
              graph_direction: null,
              graph_semantic_kind: null,
              graph_verification_status: null,
              graph_note: null,
            },
          ],
        },
      ],
    });
  });

  it('upgrades v3 graph metadata with explicit semantic maintenance defaults', () => {
    const decoded = M1D_ASSOCIATION_VERSION_THREE_BUNDLE_CODEC.decode({
      schemaVersion: M1D_ASSOCIATION_VERSION_THREE_BUNDLE_SCHEMA,
      tables: [
        {name: 'information_entry_association_projection', rows: []},
        {
          name: 'information_entry_association_override',
          rows: [
            {
              workspace_id: WORKSPACE_ID,
              entry_low_id: '22222222-2222-4222-8222-222222222222',
              entry_high_id: '33333333-3333-4333-8333-333333333333',
              current_revision: 2,
              current_revision_id: '44444444-4444-4444-8444-444444444444',
              action: 'restore',
              manual_adjustment: 0,
              is_blocked: false,
              graph_origin: 'user',
              graph_label: '补充说明',
              graph_direction: 'symmetric',
              created_at: '2040-01-02T03:04:05.000Z',
              updated_at: '2040-01-02T03:04:05.000Z',
            },
          ],
        },
      ],
    });

    expect(decoded).toMatchObject({
      schemaVersion: M1D_ASSOCIATION_BUNDLE_SCHEMA,
      tables: [
        {name: 'information_entry_association_projection', rows: []},
        {
          name: 'information_entry_association_override',
          rows: [
            {
              graph_semantic_kind: 'custom',
              graph_verification_status: 'unreviewed',
              graph_note: '',
            },
          ],
        },
      ],
    });
  });
  it('upgrades a v4 source check without inventing the reviewed Entry versions', () => {
    const decoded = M1D_ASSOCIATION_VERSION_FOUR_BUNDLE_CODEC.decode({
      schemaVersion: M1D_ASSOCIATION_VERSION_FOUR_BUNDLE_SCHEMA,
      tables: [
        {name: 'information_entry_association_projection', rows: []},
        {name: 'information_entry_association_override', rows: [reviewRow()]},
      ],
    });
    expect(decoded).toMatchObject({
      schemaVersion: M1D_ASSOCIATION_BUNDLE_SCHEMA,
      tables: [
        {},
        {
          rows: [
            {
              graph_verification_status: 'source_checked',
              graph_note: 'Synthetic prior check',
              graph_reviewed_entry_low_revision: null,
              graph_reviewed_entry_high_revision: null,
            },
          ],
        },
      ],
    });
  });
  it('round-trips exact current reviewed revisions and rejects partial or malformed bindings', () => {
    const row = {
      ...reviewRow(),
      graph_reviewed_entry_low_revision: 3,
      graph_reviewed_entry_high_revision: 5,
    };
    const snapshot = (value: JsonValue) => ({
      schemaVersion: M1D_ASSOCIATION_BUNDLE_SCHEMA,
      tables: [
        {name: 'information_entry_association_projection', rows: []},
        {name: 'information_entry_association_override', rows: [value]},
      ],
    });
    const encoded = M1D_ASSOCIATION_BUNDLE_CODEC.encode(snapshot(row));
    expect(
      M1D_ASSOCIATION_BUNDLE_CODEC.decode(
        JSON.parse(JSON.stringify(encoded)) as JsonValue,
      ),
    ).toEqual(encoded);
    for (const bad of [
      {...row, graph_reviewed_entry_low_revision: null},
      {...row, graph_reviewed_entry_low_revision: 0},
      {...row, graph_reviewed_entry_high_revision: 1.5},
      {...row, graph_origin: null},
    ])
      expect(() =>
        M1D_ASSOCIATION_BUNDLE_CODEC.decode(snapshot(bad)),
      ).toThrow();
  });
});

function reviewRow() {
  return {
    workspace_id: WORKSPACE_ID,
    entry_low_id: '22222222-2222-4222-8222-222222222222',
    entry_high_id: '33333333-3333-4333-8333-333333333333',
    current_revision: 2,
    current_revision_id: '44444444-4444-4444-8444-444444444444',
    action: 'weaken',
    manual_adjustment: -1500,
    is_blocked: false,
    graph_origin: 'user',
    graph_label: 'Synthetic relation',
    graph_direction: 'symmetric',
    graph_semantic_kind: 'related',
    graph_verification_status: 'source_checked',
    graph_note: 'Synthetic prior check',
    created_at: '2040-01-02T03:04:05.000Z',
    updated_at: '2040-01-02T03:04:05.000Z',
  };
}
