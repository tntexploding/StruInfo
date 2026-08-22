import {Buffer} from 'node:buffer';

import {
  encodeCanonicalJson,
  normalizeJsonValue,
  type JsonObject,
  type JsonPrimitive,
  type JsonValue,
} from '../serialization/canonical_json.js';
import type {WorkspaceBundleSectionCodec} from './workspace_bundle.js';

export const M1D_ASSOCIATION_BUNDLE_SECTION_TYPE = 'struinfo.m1d-association';
export const M1D_ASSOCIATION_BUNDLE_SECTION_VERSION = 1;
export const M1D_ASSOCIATION_BUNDLE_SCHEMA = 'struinfo.m1d-association.v1';

const ASSOCIATION_VALUE_LIMIT = 1_000_000;
const ROW_BYTE_LIMIT = 1024 * 1024;
const CANONICAL_UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;

export interface M1dAssociationTableDescriptor {
  readonly name: string;
  readonly columns: readonly string[];
}

export type M1dAssociationRow = Readonly<Record<string, JsonPrimitive>>;

export interface M1dAssociationTableSnapshot {
  readonly name: string;
  readonly rows: readonly M1dAssociationRow[];
}

export interface M1dAssociationSnapshot {
  readonly schemaVersion: typeof M1D_ASSOCIATION_BUNDLE_SCHEMA;
  readonly tables: readonly Readonly<M1dAssociationTableSnapshot>[];
}

/** Dependency order is also the atomic restore order. */
export const M1D_ASSOCIATION_TABLES: readonly Readonly<M1dAssociationTableDescriptor>[] =
  Object.freeze([
    table('information_entry_association_projection', [
      'workspace_id',
      'entry_low_id',
      'entry_high_id',
      'entry_low_revision',
      'entry_low_revision_id',
      'entry_high_revision',
      'entry_high_revision_id',
      'content_similarity',
      'type_similarity',
      'domain_similarity',
      'base_score',
      'algorithm_version',
      'candidate_basis',
      'candidate_rank',
      'generated_at',
    ]),
    table('information_entry_association_override', [
      'workspace_id',
      'entry_low_id',
      'entry_high_id',
      'current_revision',
      'current_revision_id',
      'created_at',
    ]),
    table('information_entry_association_override_revision', [
      'workspace_id',
      'entry_low_id',
      'entry_high_id',
      'revision_number',
      'revision_id',
      'previous_revision_id',
      'action',
      'manual_adjustment',
      'is_blocked',
      'created_at',
    ]),
  ]);

export const M1D_ASSOCIATION_BUNDLE_CODEC: WorkspaceBundleSectionCodec =
  Object.freeze({
    type: M1D_ASSOCIATION_BUNDLE_SECTION_TYPE,
    version: M1D_ASSOCIATION_BUNDLE_SECTION_VERSION,
    encode(value: unknown): unknown {
      return normalizeM1dAssociationSnapshot(value);
    },
    decode(payload: JsonValue): unknown {
      return normalizeM1dAssociationSnapshot(payload);
    },
  });

export function normalizeM1dAssociationSnapshot(
  value: unknown,
): M1dAssociationSnapshot {
  const normalized = normalizeJsonValue(value, {
    maximumValues: ASSOCIATION_VALUE_LIMIT,
  });
  const record = requireClosedObject(normalized, ['schemaVersion', 'tables']);
  if (record.schemaVersion !== M1D_ASSOCIATION_BUNDLE_SCHEMA) fail();
  const tableValues = record.tables;
  if (!isJsonArray(tableValues)) fail();
  if (tableValues.length !== M1D_ASSOCIATION_TABLES.length) fail();

  const tables = M1D_ASSOCIATION_TABLES.map((descriptor, index) => {
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
    schemaVersion: M1D_ASSOCIATION_BUNDLE_SCHEMA,
    tables: Object.freeze(tables),
  });
}

export function assertM1dAssociationWorkspace(
  snapshot: Readonly<M1dAssociationSnapshot>,
  workspaceId: string,
): void {
  if (!CANONICAL_UUID.test(workspaceId)) fail();
  for (const tableSnapshot of snapshot.tables) {
    for (const row of tableSnapshot.rows) {
      if (row.workspace_id !== workspaceId) fail();
    }
  }
}

export function m1dAssociationTableCounts(
  snapshot: Readonly<M1dAssociationSnapshot>,
): Readonly<Record<string, number>> {
  const counts = Object.create(null) as Record<string, number>;
  for (const tableSnapshot of snapshot.tables) {
    counts[tableSnapshot.name] = tableSnapshot.rows.length;
  }
  return Object.freeze(counts);
}

export function createEmptyM1dAssociationSnapshot(): M1dAssociationSnapshot {
  return normalizeM1dAssociationSnapshot({
    schemaVersion: M1D_ASSOCIATION_BUNDLE_SCHEMA,
    tables: M1D_ASSOCIATION_TABLES.map((descriptor) => ({
      name: descriptor.name,
      rows: [],
    })),
  });
}

function table(
  name: string,
  columns: readonly string[],
): Readonly<M1dAssociationTableDescriptor> {
  return Object.freeze({name, columns: Object.freeze(columns)});
}

function normalizeRow(
  value: JsonValue | undefined,
  descriptor: Readonly<M1dAssociationTableDescriptor>,
): M1dAssociationRow {
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

function compareRows(
  left: M1dAssociationRow,
  right: M1dAssociationRow,
): number {
  return Buffer.compare(
    Buffer.from(encodeCanonicalJson(left, ROW_BYTE_LIMIT)),
    Buffer.from(encodeCanonicalJson(right, ROW_BYTE_LIMIT)),
  );
}

function fail(): never {
  throw new Error('The M1D Association Bundle section is invalid.');
}
