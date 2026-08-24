import {Buffer} from 'node:buffer';

import {
  encodeCanonicalJson,
  normalizeJsonValue,
  type JsonObject,
  type JsonPrimitive,
  type JsonValue,
} from '../serialization/canonical_json.js';
import type {WorkspaceBundleSectionCodec} from './workspace_bundle.js';

export const M1E_PROCESSING_BUNDLE_SECTION_TYPE = 'struinfo.m1e-processing';
export const M1E_PROCESSING_BUNDLE_SECTION_VERSION = 2;
export const M1E_PROCESSING_BUNDLE_SCHEMA = 'struinfo.m1e-processing.v2';
export const M1E_PROCESSING_LEGACY_BUNDLE_SECTION_VERSION = 1;
export const M1E_PROCESSING_LEGACY_BUNDLE_SCHEMA = 'struinfo.m1e-processing.v1';

const PROCESSING_VALUE_LIMIT = 1_000_000;
const ROW_BYTE_LIMIT = 1024 * 1024;
const CANONICAL_UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;

export interface M1eProcessingTableDescriptor {
  readonly name: string;
  readonly columns: readonly string[];
}

export type M1eProcessingRow = Readonly<Record<string, JsonPrimitive>>;

export interface M1eProcessingTableSnapshot {
  readonly name: string;
  readonly rows: readonly M1eProcessingRow[];
}

export interface M1eProcessingSnapshot {
  readonly schemaVersion: typeof M1E_PROCESSING_BUNDLE_SCHEMA;
  readonly tables: readonly Readonly<M1eProcessingTableSnapshot>[];
}

export const M1E_PROCESSING_TABLES: readonly Readonly<M1eProcessingTableDescriptor>[] =
  Object.freeze([
    table('processing_run', [
      'workspace_id',
      'run_id',
      'idempotency_key',
      'origin',
      'provider_key',
      'status',
      'target_snapshot_id',
      'privacy_scope',
      'current_stage',
      'current_step',
      'completed_units',
      'total_units',
      'attempt',
      'current_version',
      'error_code',
      'created_at',
      'started_at',
      'finished_at',
      'updated_at',
    ]),
    table('processing_proposal', [
      'workspace_id',
      'proposal_id',
      'run_id',
      'proposal_ordinal',
      'stage',
      'proposal_kind',
      'target_snapshot_id',
      'target_entry_id',
      'related_entry_id',
      'status',
      'summary',
      'created_at',
      'decided_at',
    ]),
    table('processing_proposal_fragment_input', [
      'workspace_id',
      'proposal_id',
      'input_ordinal',
      'fragment_id',
    ]),
    table('processing_tag_proposal', [
      'workspace_id',
      'proposal_id',
      'expected_entry_revision',
      'provider_model',
      'prompt_version',
      'type_keyword',
      'type_custom_name',
    ]),
    table('processing_tag_proposal_content_keyword', [
      'workspace_id',
      'proposal_id',
      'keyword_ordinal',
      'display_value',
      'normalized_value',
    ]),
    table('processing_tag_proposal_domain', [
      'workspace_id',
      'proposal_id',
      'domain_ordinal',
      'domain_keyword',
      'custom_name',
    ]),
  ]);

const LEGACY_PROCESSING_TABLES: readonly Readonly<M1eProcessingTableDescriptor>[] =
  Object.freeze(M1E_PROCESSING_TABLES.slice(0, 3));

export const M1E_PROCESSING_BUNDLE_CODEC: WorkspaceBundleSectionCodec =
  Object.freeze({
    type: M1E_PROCESSING_BUNDLE_SECTION_TYPE,
    version: M1E_PROCESSING_BUNDLE_SECTION_VERSION,
    encode: normalizeM1eProcessingSnapshot,
    decode: normalizeM1eProcessingSnapshot,
  });

export const M1E_PROCESSING_LEGACY_BUNDLE_CODEC: WorkspaceBundleSectionCodec =
  Object.freeze({
    type: M1E_PROCESSING_BUNDLE_SECTION_TYPE,
    version: M1E_PROCESSING_LEGACY_BUNDLE_SECTION_VERSION,
    encode: normalizeLegacySnapshot,
    decode(payload: JsonValue): unknown {
      return upgradeLegacySnapshot(normalizeLegacySnapshot(payload));
    },
  });

export function normalizeM1eProcessingSnapshot(
  value: unknown,
): M1eProcessingSnapshot {
  return normalizeSnapshot(
    value,
    M1E_PROCESSING_BUNDLE_SCHEMA,
    M1E_PROCESSING_TABLES,
  ) as M1eProcessingSnapshot;
}

function normalizeLegacySnapshot(value: unknown): Readonly<{
  schemaVersion: typeof M1E_PROCESSING_LEGACY_BUNDLE_SCHEMA;
  tables: readonly Readonly<M1eProcessingTableSnapshot>[];
}> {
  return normalizeSnapshot(
    value,
    M1E_PROCESSING_LEGACY_BUNDLE_SCHEMA,
    LEGACY_PROCESSING_TABLES,
  ) as Readonly<{
    schemaVersion: typeof M1E_PROCESSING_LEGACY_BUNDLE_SCHEMA;
    tables: readonly Readonly<M1eProcessingTableSnapshot>[];
  }>;
}

function normalizeSnapshot(
  value: unknown,
  schemaVersion: string,
  descriptors: readonly Readonly<M1eProcessingTableDescriptor>[],
): Readonly<{
  schemaVersion: string;
  tables: readonly Readonly<M1eProcessingTableSnapshot>[];
}> {
  const normalized = normalizeJsonValue(value, {
    maximumValues: PROCESSING_VALUE_LIMIT,
  });
  const record = requireClosedObject(normalized, ['schemaVersion', 'tables']);
  if (
    record.schemaVersion !== schemaVersion ||
    !isJsonArray(record.tables) ||
    record.tables.length !== descriptors.length
  ) {
    fail();
  }
  const tableValues = record.tables;
  const tables = descriptors.map((descriptor, index) => {
    const candidate = requireClosedObject(tableValues[index], ['name', 'rows']);
    if (candidate.name !== descriptor.name || !isJsonArray(candidate.rows)) {
      fail();
    }
    const rows = candidate.rows.map((row) => normalizeRow(row, descriptor));
    rows.sort(compareRows);
    return Object.freeze({name: descriptor.name, rows: Object.freeze(rows)});
  });
  return Object.freeze({schemaVersion, tables: Object.freeze(tables)});
}

function upgradeLegacySnapshot(
  legacy: Readonly<{
    tables: readonly Readonly<M1eProcessingTableSnapshot>[];
  }>,
): M1eProcessingSnapshot {
  return normalizeM1eProcessingSnapshot({
    schemaVersion: M1E_PROCESSING_BUNDLE_SCHEMA,
    tables: [
      ...legacy.tables,
      ...M1E_PROCESSING_TABLES.slice(LEGACY_PROCESSING_TABLES.length).map(
        (descriptor) => ({name: descriptor.name, rows: []}),
      ),
    ],
  });
}

export function assertM1eProcessingWorkspace(
  snapshot: Readonly<M1eProcessingSnapshot>,
  workspaceId: string,
): void {
  if (!CANONICAL_UUID.test(workspaceId)) fail();
  for (const tableSnapshot of snapshot.tables) {
    for (const row of tableSnapshot.rows) {
      if (row.workspace_id !== workspaceId) fail();
    }
  }
}

export function createEmptyM1eProcessingSnapshot(): M1eProcessingSnapshot {
  return normalizeM1eProcessingSnapshot({
    schemaVersion: M1E_PROCESSING_BUNDLE_SCHEMA,
    tables: M1E_PROCESSING_TABLES.map((descriptor) => ({
      name: descriptor.name,
      rows: [],
    })),
  });
}

export function m1eProcessingTableCounts(
  snapshot: Readonly<M1eProcessingSnapshot>,
): Readonly<Record<string, number>> {
  const counts = Object.create(null) as Record<string, number>;
  for (const tableSnapshot of snapshot.tables) {
    counts[tableSnapshot.name] = tableSnapshot.rows.length;
  }
  return Object.freeze(counts);
}

function table(
  name: string,
  columns: readonly string[],
): Readonly<M1eProcessingTableDescriptor> {
  return Object.freeze({name, columns: Object.freeze(columns)});
}

function normalizeRow(
  value: JsonValue | undefined,
  descriptor: Readonly<M1eProcessingTableDescriptor>,
): M1eProcessingRow {
  const record = requireClosedObject(value, descriptor.columns);
  if (
    typeof record.workspace_id !== 'string' ||
    !CANONICAL_UUID.test(record.workspace_id)
  ) {
    fail();
  }
  const row = Object.create(null) as Record<string, JsonPrimitive>;
  for (const column of descriptor.columns) {
    const field = record[column];
    if (
      field === undefined ||
      (typeof field === 'object' && field !== null) ||
      (typeof field === 'number' &&
        Number.isInteger(field) &&
        !Number.isSafeInteger(field))
    ) {
      fail();
    }
    row[column] = field;
  }
  return Object.freeze(row);
}

function requireClosedObject(
  value: JsonValue | undefined,
  expectedKeys: readonly string[],
): JsonObject {
  if (
    value === undefined ||
    value === null ||
    typeof value !== 'object' ||
    isJsonArray(value)
  ) {
    fail();
  }
  const keys = Object.keys(value).sort();
  const expected = [...expectedKeys].sort();
  if (
    keys.length !== expected.length ||
    keys.some((key, index) => key !== expected[index])
  ) {
    fail();
  }
  return value;
}

function isJsonArray(
  value: JsonValue | undefined,
): value is readonly JsonValue[] {
  return Array.isArray(value);
}

function compareRows(left: M1eProcessingRow, right: M1eProcessingRow): number {
  return Buffer.compare(
    Buffer.from(encodeCanonicalJson(left, ROW_BYTE_LIMIT)),
    Buffer.from(encodeCanonicalJson(right, ROW_BYTE_LIMIT)),
  );
}

function fail(): never {
  throw new Error('The M1E Processing Bundle section is invalid.');
}
