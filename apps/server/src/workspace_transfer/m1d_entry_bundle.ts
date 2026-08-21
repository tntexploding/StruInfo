import {Buffer} from 'node:buffer';

import {
  encodeCanonicalJson,
  normalizeJsonValue,
  type JsonObject,
  type JsonPrimitive,
  type JsonValue,
} from '../serialization/canonical_json.js';
import type {WorkspaceBundleSectionCodec} from './workspace_bundle.js';

export const M1D_ENTRY_BUNDLE_SECTION_TYPE = 'struinfo.m1d-entry';
export const M1D_ENTRY_BUNDLE_SECTION_VERSION = 1;
export const M1D_ENTRY_BUNDLE_SCHEMA = 'struinfo.m1d-entry.v1';

const ENTRY_VALUE_LIMIT = 1_000_000;
// Entry rows carry source-bound body text. Do not impose a sort-only ceiling
// below the enclosing Bundle's 16 MiB byte budget.
const ROW_BYTE_LIMIT = 16 * 1024 * 1024;
const CANONICAL_UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;

export interface M1dEntryTableDescriptor {
  readonly name: string;
  readonly columns: readonly string[];
}

export type M1dEntryRow = Readonly<Record<string, JsonPrimitive>>;

export interface M1dEntryTableSnapshot {
  readonly name: string;
  readonly rows: readonly M1dEntryRow[];
}

export interface M1dEntrySnapshot {
  readonly schemaVersion: typeof M1D_ENTRY_BUNDLE_SCHEMA;
  readonly tables: readonly Readonly<M1dEntryTableSnapshot>[];
}

/** Dependency order is also the atomic restore order. */
export const M1D_ENTRY_TABLES: readonly Readonly<M1dEntryTableDescriptor>[] =
  Object.freeze([
    table('information_entry', [
      'workspace_id',
      'entry_id',
      'resource_id',
      'snapshot_id',
      'current_revision',
      'current_revision_id',
      'created_at',
    ]),
    table('information_entry_revision', [
      'workspace_id',
      'entry_id',
      'revision_number',
      'revision_id',
      'previous_revision_id',
      'document_order',
      'title_path',
      'body',
      'body_sha256',
      'chunk_mode',
      'split_rule_version',
      'is_private',
      'type_keyword',
      'type_custom_name',
      'created_at',
    ]),
    table('information_entry_fragment_input', [
      'workspace_id',
      'entry_id',
      'revision_number',
      'revision_id',
      'input_ordinal',
      'fragment_id',
      'created_at',
    ]),
    table('information_entry_content_keyword', [
      'workspace_id',
      'entry_id',
      'revision_number',
      'revision_id',
      'keyword_ordinal',
      'display_value',
      'normalized_value',
      'origin',
      'origin_version',
      'created_at',
    ]),
    table('information_entry_domain_keyword', [
      'workspace_id',
      'entry_id',
      'revision_number',
      'revision_id',
      'domain_ordinal',
      'domain_keyword',
      'custom_name',
      'origin',
      'origin_version',
      'created_at',
    ]),
    table('information_entry_lineage', [
      'workspace_id',
      'successor_entry_id',
      'predecessor_entry_id',
      'lineage_kind',
      'created_at',
    ]),
    table('information_document_tag_set', [
      'workspace_id',
      'resource_id',
      'snapshot_id',
      'current_revision',
      'current_revision_id',
      'created_at',
    ]),
    table('information_document_tag_revision', [
      'workspace_id',
      'snapshot_id',
      'revision_number',
      'revision_id',
      'previous_revision_id',
      'revision_kind',
      'rule_version',
      'is_private',
      'entry_count',
      'created_at',
    ]),
    table('information_document_tag_value', [
      'workspace_id',
      'snapshot_id',
      'revision_number',
      'revision_id',
      'tag_ordinal',
      'display_value',
      'normalized_value',
      'origin',
      'full_text_occurrences',
      'entry_coverage_count',
      'created_at',
    ]),
  ]);

export const M1D_ENTRY_BUNDLE_CODEC: WorkspaceBundleSectionCodec =
  Object.freeze({
    type: M1D_ENTRY_BUNDLE_SECTION_TYPE,
    version: M1D_ENTRY_BUNDLE_SECTION_VERSION,
    encode(value: unknown): unknown {
      return normalizeM1dEntrySnapshot(value);
    },
    decode(payload: JsonValue): unknown {
      return normalizeM1dEntrySnapshot(payload);
    },
  });

export function normalizeM1dEntrySnapshot(value: unknown): M1dEntrySnapshot {
  const normalized = normalizeJsonValue(value, {
    maximumValues: ENTRY_VALUE_LIMIT,
  });
  const record = requireClosedObject(normalized, ['schemaVersion', 'tables']);
  if (record.schemaVersion !== M1D_ENTRY_BUNDLE_SCHEMA) fail();
  const tableValues = record.tables;
  if (!isJsonArray(tableValues)) fail();
  if (tableValues.length !== M1D_ENTRY_TABLES.length) fail();

  const tables = M1D_ENTRY_TABLES.map((descriptor, index) => {
    const candidate = tableValues[index];
    const tableRecord = requireClosedObject(candidate, ['name', 'rows']);
    const rowValues = tableRecord.rows;
    if (tableRecord.name !== descriptor.name || !isJsonArray(rowValues)) {
      fail();
    }
    const rows = rowValues.map((row) => normalizeRow(row, descriptor));
    rows.sort(compareRows);
    return Object.freeze({name: descriptor.name, rows: Object.freeze(rows)});
  });
  return Object.freeze({
    schemaVersion: M1D_ENTRY_BUNDLE_SCHEMA,
    tables: Object.freeze(tables),
  });
}

export function assertM1dEntryWorkspace(
  snapshot: Readonly<M1dEntrySnapshot>,
  workspaceId: string,
): void {
  if (!CANONICAL_UUID.test(workspaceId)) fail();
  for (const tableSnapshot of snapshot.tables) {
    for (const row of tableSnapshot.rows) {
      if (row.workspace_id !== workspaceId) fail();
    }
  }
}

export function m1dEntryTableCounts(
  snapshot: Readonly<M1dEntrySnapshot>,
): Readonly<Record<string, number>> {
  const counts = Object.create(null) as Record<string, number>;
  for (const tableSnapshot of snapshot.tables) {
    counts[tableSnapshot.name] = tableSnapshot.rows.length;
  }
  return Object.freeze(counts);
}

export function createEmptyM1dEntrySnapshot(): M1dEntrySnapshot {
  return normalizeM1dEntrySnapshot({
    schemaVersion: M1D_ENTRY_BUNDLE_SCHEMA,
    tables: M1D_ENTRY_TABLES.map((descriptor) => ({
      name: descriptor.name,
      rows: [],
    })),
  });
}

function table(
  name: string,
  columns: readonly string[],
): Readonly<M1dEntryTableDescriptor> {
  return Object.freeze({name, columns: Object.freeze(columns)});
}

function normalizeRow(
  value: JsonValue | undefined,
  descriptor: Readonly<M1dEntryTableDescriptor>,
): M1dEntryRow {
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

function compareRows(left: M1dEntryRow, right: M1dEntryRow): number {
  return Buffer.compare(
    Buffer.from(encodeCanonicalJson(left, ROW_BYTE_LIMIT)),
    Buffer.from(encodeCanonicalJson(right, ROW_BYTE_LIMIT)),
  );
}

function fail(): never {
  throw new Error('The M1D Entry Bundle section is invalid.');
}
