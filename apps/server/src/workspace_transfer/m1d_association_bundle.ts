import {Buffer} from 'node:buffer';

import {
  encodeCanonicalJson,
  normalizeJsonValue,
  type JsonObject,
  type JsonPrimitive,
  type JsonValue,
} from '../serialization/canonical_json.js';
import {
  DEFAULT_MAXIMUM_WORKSPACE_BUNDLE_VALUES,
  type WorkspaceBundleSectionCodec,
} from './workspace_bundle.js';

export const M1D_ASSOCIATION_BUNDLE_SECTION_TYPE = 'struinfo.m1d-association';
export const M1D_ASSOCIATION_BUNDLE_SECTION_VERSION = 5;
export const M1D_ASSOCIATION_BUNDLE_SCHEMA = 'struinfo.m1d-association.v5';
export const M1D_ASSOCIATION_VERSION_FOUR_BUNDLE_SECTION_VERSION = 4;
export const M1D_ASSOCIATION_VERSION_FOUR_BUNDLE_SCHEMA =
  'struinfo.m1d-association.v4';
export const M1D_ASSOCIATION_VERSION_THREE_BUNDLE_SECTION_VERSION = 3;
export const M1D_ASSOCIATION_VERSION_THREE_BUNDLE_SCHEMA =
  'struinfo.m1d-association.v3';
export const M1D_ASSOCIATION_VERSION_TWO_BUNDLE_SECTION_VERSION = 2;
export const M1D_ASSOCIATION_VERSION_TWO_BUNDLE_SCHEMA =
  'struinfo.m1d-association.v2';
export const M1D_ASSOCIATION_LEGACY_BUNDLE_SECTION_VERSION = 1;
export const M1D_ASSOCIATION_LEGACY_BUNDLE_SCHEMA =
  'struinfo.m1d-association.v1';

const ASSOCIATION_VALUE_LIMIT = DEFAULT_MAXIMUM_WORKSPACE_BUNDLE_VALUES;
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
      'action',
      'manual_adjustment',
      'is_blocked',
      'graph_origin',
      'graph_label',
      'graph_direction',
      'graph_semantic_kind',
      'graph_verification_status',
      'graph_note',
      'graph_reviewed_entry_low_revision',
      'graph_reviewed_entry_high_revision',
      'created_at',
      'updated_at',
    ]),
  ]);

const VERSION_FOUR_ASSOCIATION_TABLES = Object.freeze(
  M1D_ASSOCIATION_TABLES.map((descriptor) =>
    table(
      descriptor.name,
      descriptor.columns.filter(
        (column) =>
          column !== 'graph_reviewed_entry_low_revision' &&
          column !== 'graph_reviewed_entry_high_revision',
      ),
    ),
  ),
);

const VERSION_THREE_ASSOCIATION_TABLES: readonly Readonly<M1dAssociationTableDescriptor>[] =
  Object.freeze([
    requiredDescriptor(M1D_ASSOCIATION_TABLES, 0),
    table('information_entry_association_override', [
      'workspace_id',
      'entry_low_id',
      'entry_high_id',
      'current_revision',
      'current_revision_id',
      'action',
      'manual_adjustment',
      'is_blocked',
      'graph_origin',
      'graph_label',
      'graph_direction',
      'created_at',
      'updated_at',
    ]),
  ]);

const VERSION_TWO_ASSOCIATION_TABLES: readonly Readonly<M1dAssociationTableDescriptor>[] =
  Object.freeze([
    requiredDescriptor(M1D_ASSOCIATION_TABLES, 0),
    table('information_entry_association_override', [
      'workspace_id',
      'entry_low_id',
      'entry_high_id',
      'current_revision',
      'current_revision_id',
      'action',
      'manual_adjustment',
      'is_blocked',
      'created_at',
      'updated_at',
    ]),
  ]);

const LEGACY_ASSOCIATION_TABLES: readonly Readonly<M1dAssociationTableDescriptor>[] =
  Object.freeze([
    requiredDescriptor(M1D_ASSOCIATION_TABLES, 0),
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
    encode: normalizeM1dAssociationSnapshot,
    decode: normalizeM1dAssociationSnapshot,
  });

export const M1D_ASSOCIATION_VERSION_FOUR_BUNDLE_CODEC: WorkspaceBundleSectionCodec =
  Object.freeze({
    type: M1D_ASSOCIATION_BUNDLE_SECTION_TYPE,
    version: M1D_ASSOCIATION_VERSION_FOUR_BUNDLE_SECTION_VERSION,
    encode: (value: unknown) =>
      normalizeSnapshot(
        value,
        M1D_ASSOCIATION_VERSION_FOUR_BUNDLE_SCHEMA,
        VERSION_FOUR_ASSOCIATION_TABLES,
      ),
    decode(payload: JsonValue): unknown {
      const legacy = normalizeSnapshot(
        payload,
        M1D_ASSOCIATION_VERSION_FOUR_BUNDLE_SCHEMA,
        VERSION_FOUR_ASSOCIATION_TABLES,
      );
      return normalizeM1dAssociationSnapshot({
        schemaVersion: M1D_ASSOCIATION_BUNDLE_SCHEMA,
        tables: legacy.tables.map((section) => ({
          name: section.name,
          rows:
            section.name === 'information_entry_association_override'
              ? section.rows.map((row) => ({
                  ...row,
                  graph_reviewed_entry_low_revision: null,
                  graph_reviewed_entry_high_revision: null,
                }))
              : section.rows,
        })),
      });
    },
  });

export const M1D_ASSOCIATION_VERSION_TWO_BUNDLE_CODEC: WorkspaceBundleSectionCodec =
  Object.freeze({
    type: M1D_ASSOCIATION_BUNDLE_SECTION_TYPE,
    version: M1D_ASSOCIATION_VERSION_TWO_BUNDLE_SECTION_VERSION,
    encode: normalizeVersionTwoSnapshot,
    decode(payload: JsonValue): unknown {
      return upgradeVersionTwoSnapshot(normalizeVersionTwoSnapshot(payload));
    },
  });

export const M1D_ASSOCIATION_VERSION_THREE_BUNDLE_CODEC: WorkspaceBundleSectionCodec =
  Object.freeze({
    type: M1D_ASSOCIATION_BUNDLE_SECTION_TYPE,
    version: M1D_ASSOCIATION_VERSION_THREE_BUNDLE_SECTION_VERSION,
    encode: normalizeVersionThreeSnapshot,
    decode(payload: JsonValue): unknown {
      return upgradeVersionThreeSnapshot(
        normalizeVersionThreeSnapshot(payload),
      );
    },
  });

export const M1D_ASSOCIATION_LEGACY_BUNDLE_CODEC: WorkspaceBundleSectionCodec =
  Object.freeze({
    type: M1D_ASSOCIATION_BUNDLE_SECTION_TYPE,
    version: M1D_ASSOCIATION_LEGACY_BUNDLE_SECTION_VERSION,
    encode: normalizeLegacySnapshot,
    decode(payload: JsonValue): unknown {
      return upgradeLegacySnapshot(normalizeLegacySnapshot(payload));
    },
  });

export function normalizeM1dAssociationSnapshot(
  value: unknown,
): M1dAssociationSnapshot {
  return normalizeSnapshot(
    value,
    M1D_ASSOCIATION_BUNDLE_SCHEMA,
    M1D_ASSOCIATION_TABLES,
  ) as M1dAssociationSnapshot;
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

function normalizeVersionTwoSnapshot(value: unknown): Readonly<{
  schemaVersion: typeof M1D_ASSOCIATION_VERSION_TWO_BUNDLE_SCHEMA;
  tables: readonly Readonly<M1dAssociationTableSnapshot>[];
}> {
  return normalizeSnapshot(
    value,
    M1D_ASSOCIATION_VERSION_TWO_BUNDLE_SCHEMA,
    VERSION_TWO_ASSOCIATION_TABLES,
  ) as Readonly<{
    schemaVersion: typeof M1D_ASSOCIATION_VERSION_TWO_BUNDLE_SCHEMA;
    tables: readonly Readonly<M1dAssociationTableSnapshot>[];
  }>;
}

function normalizeVersionThreeSnapshot(value: unknown): Readonly<{
  schemaVersion: typeof M1D_ASSOCIATION_VERSION_THREE_BUNDLE_SCHEMA;
  tables: readonly Readonly<M1dAssociationTableSnapshot>[];
}> {
  return normalizeSnapshot(
    value,
    M1D_ASSOCIATION_VERSION_THREE_BUNDLE_SCHEMA,
    VERSION_THREE_ASSOCIATION_TABLES,
  ) as Readonly<{
    schemaVersion: typeof M1D_ASSOCIATION_VERSION_THREE_BUNDLE_SCHEMA;
    tables: readonly Readonly<M1dAssociationTableSnapshot>[];
  }>;
}

function upgradeVersionThreeSnapshot(
  legacy: ReturnType<typeof normalizeVersionThreeSnapshot>,
): M1dAssociationSnapshot {
  return normalizeM1dAssociationSnapshot({
    schemaVersion: M1D_ASSOCIATION_BUNDLE_SCHEMA,
    tables: legacy.tables.map((tableSnapshot) => ({
      name: tableSnapshot.name,
      rows:
        tableSnapshot.name === 'information_entry_association_override'
          ? tableSnapshot.rows.map((row) => ({
              ...row,
              graph_semantic_kind:
                row.graph_origin === null
                  ? null
                  : row.graph_label === 'similarity'
                    ? 'similarity'
                    : 'custom',
              graph_verification_status:
                row.graph_origin === null ? null : 'unreviewed',
              graph_note: row.graph_origin === null ? null : '',
              graph_reviewed_entry_low_revision: null,
              graph_reviewed_entry_high_revision: null,
            }))
          : tableSnapshot.rows,
    })),
  });
}

function upgradeVersionTwoSnapshot(
  legacy: ReturnType<typeof normalizeVersionTwoSnapshot>,
): M1dAssociationSnapshot {
  return normalizeM1dAssociationSnapshot({
    schemaVersion: M1D_ASSOCIATION_BUNDLE_SCHEMA,
    tables: legacy.tables.map((tableSnapshot) => ({
      name: tableSnapshot.name,
      rows:
        tableSnapshot.name === 'information_entry_association_override'
          ? tableSnapshot.rows.map((row) => ({
              ...row,
              graph_origin: null,
              graph_label: null,
              graph_direction: null,
              graph_semantic_kind: null,
              graph_verification_status: null,
              graph_note: null,
              graph_reviewed_entry_low_revision: null,
              graph_reviewed_entry_high_revision: null,
            }))
          : tableSnapshot.rows,
    })),
  });
}

function normalizeLegacySnapshot(value: unknown): Readonly<{
  schemaVersion: typeof M1D_ASSOCIATION_LEGACY_BUNDLE_SCHEMA;
  tables: readonly Readonly<M1dAssociationTableSnapshot>[];
}> {
  return normalizeSnapshot(
    value,
    M1D_ASSOCIATION_LEGACY_BUNDLE_SCHEMA,
    LEGACY_ASSOCIATION_TABLES,
  ) as Readonly<{
    schemaVersion: typeof M1D_ASSOCIATION_LEGACY_BUNDLE_SCHEMA;
    tables: readonly Readonly<M1dAssociationTableSnapshot>[];
  }>;
}

function upgradeLegacySnapshot(
  legacy: ReturnType<typeof normalizeLegacySnapshot>,
): M1dAssociationSnapshot {
  const tables = new Map(
    legacy.tables.map((value) => [value.name, value.rows]),
  );
  const projections = requiredRows(
    tables,
    'information_entry_association_projection',
  );
  const overrides = requiredRows(
    tables,
    'information_entry_association_override',
  );
  const revisions = new Map(
    requiredRows(tables, 'information_entry_association_override_revision').map(
      (revision) => [
        identityValues(
          requiredPrimitive(revision, 'workspace_id'),
          requiredPrimitive(revision, 'entry_low_id'),
          requiredPrimitive(revision, 'entry_high_id'),
          requiredPrimitive(revision, 'revision_number'),
          requiredPrimitive(revision, 'revision_id'),
        ),
        revision,
      ],
    ),
  );
  const currentOverrides = overrides.map((override) => {
    const revision = revisions.get(
      identityValues(
        requiredPrimitive(override, 'workspace_id'),
        requiredPrimitive(override, 'entry_low_id'),
        requiredPrimitive(override, 'entry_high_id'),
        requiredPrimitive(override, 'current_revision'),
        requiredPrimitive(override, 'current_revision_id'),
      ),
    );
    if (revision === undefined) fail();
    return rowFor(requiredDescriptor(M1D_ASSOCIATION_TABLES, 1), {
      ...override,
      ...revision,
      graph_origin: null,
      graph_label: null,
      graph_direction: null,
      graph_semantic_kind: null,
      graph_verification_status: null,
      graph_note: null,
      graph_reviewed_entry_low_revision: null,
      graph_reviewed_entry_high_revision: null,
      created_at: requiredPrimitive(override, 'created_at'),
      updated_at: requiredPrimitive(revision, 'created_at'),
    });
  });
  return normalizeM1dAssociationSnapshot({
    schemaVersion: M1D_ASSOCIATION_BUNDLE_SCHEMA,
    tables: [
      {
        name: 'information_entry_association_projection',
        rows: projections,
      },
      {
        name: 'information_entry_association_override',
        rows: currentOverrides,
      },
    ],
  });
}

function normalizeSnapshot(
  value: unknown,
  schema: string,
  descriptors: readonly Readonly<M1dAssociationTableDescriptor>[],
): Readonly<{
  schemaVersion: string;
  tables: readonly M1dAssociationTableSnapshot[];
}> {
  const normalized = normalizeJsonValue(value, {
    maximumValues: ASSOCIATION_VALUE_LIMIT,
  });
  const record = requireClosedObject(normalized, ['schemaVersion', 'tables']);
  if (record.schemaVersion !== schema || !isJsonArray(record.tables)) fail();
  const tableValues = record.tables;
  if (tableValues.length !== descriptors.length) fail();
  const tables = descriptors.map((descriptor, index) => {
    const candidate = requireClosedObject(tableValues[index], ['name', 'rows']);
    if (candidate.name !== descriptor.name || !isJsonArray(candidate.rows)) {
      fail();
    }
    const rows = candidate.rows.map((row) => normalizeRow(row, descriptor));
    rows.sort(compareRows);
    return Object.freeze({name: descriptor.name, rows: Object.freeze(rows)});
  });
  return Object.freeze({schemaVersion: schema, tables: Object.freeze(tables)});
}

function requiredDescriptor(
  descriptors: readonly Readonly<M1dAssociationTableDescriptor>[],
  index: number,
): Readonly<M1dAssociationTableDescriptor> {
  const descriptor = descriptors[index];
  if (descriptor === undefined) fail();
  return descriptor;
}

function requiredPrimitive(
  source: Readonly<Record<string, JsonPrimitive>>,
  column: string,
): JsonPrimitive {
  if (!Object.hasOwn(source, column)) fail();
  const value = source[column];
  if (value === undefined) fail();
  return value;
}

function rowFor(
  descriptor: Readonly<M1dAssociationTableDescriptor>,
  source: Readonly<Record<string, JsonPrimitive>>,
): M1dAssociationRow {
  const value = Object.create(null) as Record<string, JsonPrimitive>;
  for (const column of descriptor.columns) {
    if (!Object.hasOwn(source, column)) fail();
    value[column] = requiredPrimitive(source, column);
  }
  return Object.freeze(value);
}

function requiredRows(
  tables: ReadonlyMap<string, readonly M1dAssociationRow[]>,
  name: string,
): readonly M1dAssociationRow[] {
  const rows = tables.get(name);
  if (rows === undefined) fail();
  return rows;
}

function identityValues(...values: readonly JsonPrimitive[]): string {
  return JSON.stringify(values);
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
  if (descriptor.columns.includes('graph_reviewed_entry_low_revision')) {
    const low = record.graph_reviewed_entry_low_revision;
    const high = record.graph_reviewed_entry_high_revision;
    if (
      !(low === null && high === null) &&
      (record.graph_origin === null ||
        typeof low !== 'number' ||
        typeof high !== 'number' ||
        !Number.isSafeInteger(low) ||
        !Number.isSafeInteger(high) ||
        low < 1 ||
        high < 1 ||
        low > 2_147_483_647 ||
        high > 2_147_483_647)
    )
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
