import {describe, expect, it} from 'vitest';

import {
  assertM1eProcessingWorkspace,
  createEmptyM1eProcessingSnapshot,
  M1E_PROCESSING_BUNDLE_SCHEMA,
  M1E_PROCESSING_LEGACY_BUNDLE_CODEC,
  M1E_PROCESSING_LEGACY_BUNDLE_SCHEMA,
  M1E_PROCESSING_TABLES,
  M1E_PROCESSING_VERSION_EIGHT_BUNDLE_CODEC,
  M1E_PROCESSING_VERSION_EIGHT_BUNDLE_SCHEMA,
  M1E_PROCESSING_VERSION_NINE_BUNDLE_CODEC,
  M1E_PROCESSING_VERSION_NINE_BUNDLE_SCHEMA,
  M1E_PROCESSING_VERSION_SEVEN_BUNDLE_CODEC,
  M1E_PROCESSING_VERSION_SEVEN_BUNDLE_SCHEMA,
  M1E_PROCESSING_VERSION_FOUR_BUNDLE_CODEC,
  M1E_PROCESSING_VERSION_FOUR_BUNDLE_SCHEMA,
  M1E_PROCESSING_VERSION_FIVE_BUNDLE_CODEC,
  M1E_PROCESSING_VERSION_FIVE_BUNDLE_SCHEMA,
  M1E_PROCESSING_VERSION_SIX_BUNDLE_CODEC,
  M1E_PROCESSING_VERSION_SIX_BUNDLE_SCHEMA,
  M1E_PROCESSING_VERSION_THREE_BUNDLE_CODEC,
  M1E_PROCESSING_VERSION_THREE_BUNDLE_SCHEMA,
  M1E_PROCESSING_VERSION_TWO_BUNDLE_CODEC,
  M1E_PROCESSING_VERSION_TWO_BUNDLE_SCHEMA,
  normalizeM1eProcessingSnapshot,
} from './m1e_processing_bundle.js';

const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';

describe('M1E processing Bundle section', () => {
  it('keeps the nineteen typed processing tables in a closed canonical order', () => {
    const empty = createEmptyM1eProcessingSnapshot();
    expect(empty.schemaVersion).toBe(M1E_PROCESSING_BUNDLE_SCHEMA);
    expect(empty.tables.map((table) => table.name)).toEqual(
      M1E_PROCESSING_TABLES.map((table) => table.name),
    );
  });

  it('upgrades the v9 enrichment section with empty adjudication state', () => {
    const upgraded = M1E_PROCESSING_VERSION_NINE_BUNDLE_CODEC.decode({
      schemaVersion: M1E_PROCESSING_VERSION_NINE_BUNDLE_SCHEMA,
      tables: M1E_PROCESSING_TABLES.slice(0, 18).map((descriptor) => ({
        name: descriptor.name,
        rows: [],
      })),
    });

    expect(upgraded).toEqual(createEmptyM1eProcessingSnapshot());
  });

  it('upgrades the v8 bulk-ingestion section with empty enrichment state', () => {
    const upgraded = M1E_PROCESSING_VERSION_EIGHT_BUNDLE_CODEC.decode({
      schemaVersion: M1E_PROCESSING_VERSION_EIGHT_BUNDLE_SCHEMA,
      tables: M1E_PROCESSING_TABLES.slice(0, 16).map((descriptor) => ({
        name: descriptor.name,
        rows: [],
      })),
    });

    expect(upgraded).toEqual(createEmptyM1eProcessingSnapshot());
  });

  it('upgrades the v7 deterministic-action section with empty bulk batches', () => {
    const upgraded = M1E_PROCESSING_VERSION_SEVEN_BUNDLE_CODEC.decode({
      schemaVersion: M1E_PROCESSING_VERSION_SEVEN_BUNDLE_SCHEMA,
      tables: M1E_PROCESSING_TABLES.slice(0, 14).map((descriptor) => ({
        name: descriptor.name,
        rows: [],
      })),
    });

    expect(upgraded).toEqual(createEmptyM1eProcessingSnapshot());
  });

  it('upgrades the v6 owner queue section with empty automation actions', () => {
    const upgraded = M1E_PROCESSING_VERSION_SIX_BUNDLE_CODEC.decode({
      schemaVersion: M1E_PROCESSING_VERSION_SIX_BUNDLE_SCHEMA,
      tables: M1E_PROCESSING_TABLES.slice(0, 13).map((descriptor) => ({
        name: descriptor.name,
        rows: [],
      })),
    });

    expect(upgraded).toEqual(createEmptyM1eProcessingSnapshot());
  });

  it('upgrades the v5 automation execution section with an empty work queue', () => {
    const upgraded = M1E_PROCESSING_VERSION_FIVE_BUNDLE_CODEC.decode({
      schemaVersion: M1E_PROCESSING_VERSION_FIVE_BUNDLE_SCHEMA,
      tables: M1E_PROCESSING_TABLES.slice(0, 12).map((descriptor) => ({
        name: descriptor.name,
        rows: [],
      })),
    });

    expect(upgraded).toEqual(createEmptyM1eProcessingSnapshot());
  });

  it('upgrades the v4 split section with empty automation execution tables', () => {
    const upgraded = M1E_PROCESSING_VERSION_FOUR_BUNDLE_CODEC.decode({
      schemaVersion: M1E_PROCESSING_VERSION_FOUR_BUNDLE_SCHEMA,
      tables: M1E_PROCESSING_TABLES.slice(0, 10).map((descriptor) => ({
        name: descriptor.name,
        rows: [],
      })),
    });

    expect(upgraded).toEqual(createEmptyM1eProcessingSnapshot());
  });

  it('upgrades the v3 tag and association section with empty split tables', () => {
    const upgraded = M1E_PROCESSING_VERSION_THREE_BUNDLE_CODEC.decode({
      schemaVersion: M1E_PROCESSING_VERSION_THREE_BUNDLE_SCHEMA,
      tables: M1E_PROCESSING_TABLES.slice(0, 7).map((descriptor) => ({
        name: descriptor.name,
        rows: [],
      })),
    });

    expect(upgraded).toEqual(createEmptyM1eProcessingSnapshot());
  });

  it('upgrades the v2 tag proposal section with empty later proposal tables', () => {
    const upgraded = M1E_PROCESSING_VERSION_TWO_BUNDLE_CODEC.decode({
      schemaVersion: M1E_PROCESSING_VERSION_TWO_BUNDLE_SCHEMA,
      tables: M1E_PROCESSING_TABLES.slice(0, 6).map((descriptor) => ({
        name: descriptor.name,
        rows: [],
      })),
    });

    expect(upgraded).toEqual(createEmptyM1eProcessingSnapshot());
  });

  it('upgrades the v1 three-table section with empty typed proposal tables', () => {
    const upgraded = M1E_PROCESSING_LEGACY_BUNDLE_CODEC.decode({
      schemaVersion: M1E_PROCESSING_LEGACY_BUNDLE_SCHEMA,
      tables: M1E_PROCESSING_TABLES.slice(0, 3).map((descriptor) => ({
        name: descriptor.name,
        rows: [],
      })),
    });

    expect(upgraded).toEqual(createEmptyM1eProcessingSnapshot());
  });

  it('accepts rows only for the requested workspace', () => {
    const snapshot = normalizeM1eProcessingSnapshot({
      schemaVersion: M1E_PROCESSING_BUNDLE_SCHEMA,
      tables: M1E_PROCESSING_TABLES.map((descriptor) => ({
        name: descriptor.name,
        rows:
          descriptor.name === 'processing_run'
            ? [
                {
                  workspace_id: WORKSPACE_ID,
                  run_id: '22222222-2222-4222-8222-222222222222',
                  idempotency_key: 'synthetic-run',
                  origin: 'deterministic',
                  provider_key: null,
                  status: 'succeeded',
                  target_snapshot_id: null,
                  privacy_scope: 'public_only',
                  current_stage: 'tags',
                  current_step: '完成',
                  completed_units: 1,
                  total_units: 1,
                  attempt: 1,
                  current_version: 2,
                  error_code: null,
                  created_at: '2040-01-02T03:04:05.000Z',
                  started_at: '2040-01-02T03:04:06.000Z',
                  finished_at: '2040-01-02T03:04:07.000Z',
                  updated_at: '2040-01-02T03:04:07.000Z',
                },
              ]
            : [],
      })),
    });
    expect(() => {
      assertM1eProcessingWorkspace(snapshot, WORKSPACE_ID);
    }).not.toThrow();
    expect(() => {
      assertM1eProcessingWorkspace(
        snapshot,
        '33333333-3333-4333-8333-333333333333',
      );
    }).toThrow();
  });

  it('rejects extra fields instead of carrying opaque Provider payloads', () => {
    const raw = JSON.parse(
      JSON.stringify(createEmptyM1eProcessingSnapshot()),
    ) as {tables: {rows: Record<string, unknown>[]}[]};
    raw.tables[0]?.rows.push({
      workspace_id: WORKSPACE_ID,
      opaque_provider_payload: 'not permitted',
    });
    expect(() => normalizeM1eProcessingSnapshot(raw)).toThrow();
  });
});
