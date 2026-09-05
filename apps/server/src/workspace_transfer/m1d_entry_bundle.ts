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

export const M1D_ENTRY_BUNDLE_SECTION_TYPE = 'struinfo.m1d-entry';
export const M1D_ENTRY_BUNDLE_SECTION_VERSION = 5;
export const M1D_ENTRY_BUNDLE_SCHEMA = 'struinfo.m1d-entry.v5';
export const M1D_ENTRY_VERSION_FOUR_BUNDLE_SECTION_VERSION = 4;
export const M1D_ENTRY_VERSION_FOUR_BUNDLE_SCHEMA = 'struinfo.m1d-entry.v4';
export const M1D_ENTRY_VERSION_THREE_BUNDLE_SECTION_VERSION = 3;
export const M1D_ENTRY_VERSION_THREE_BUNDLE_SCHEMA = 'struinfo.m1d-entry.v3';
export const M1D_ENTRY_VERSION_TWO_BUNDLE_SECTION_VERSION = 2;
export const M1D_ENTRY_VERSION_TWO_BUNDLE_SCHEMA = 'struinfo.m1d-entry.v2';
export const M1D_ENTRY_LEGACY_BUNDLE_SECTION_VERSION = 1;
export const M1D_ENTRY_LEGACY_BUNDLE_SCHEMA = 'struinfo.m1d-entry.v1';

const ENTRY_VALUE_LIMIT = DEFAULT_MAXIMUM_WORKSPACE_BUNDLE_VALUES;
const ROW_BYTE_LIMIT = 256 * 1024 * 1024;
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

export const M1D_ENTRY_TABLES: readonly Readonly<M1dEntryTableDescriptor>[] =
  Object.freeze([
    table('information_entry', [
      'workspace_id',
      'entry_id',
      'resource_id',
      'snapshot_id',
      'current_revision',
      'current_revision_id',
      'document_order',
      'title_path',
      'body',
      'body_sha256',
      'chunk_mode',
      'split_rule_version',
      'is_private',
      'type_keyword',
      'type_custom_name',
      'usefulness_score',
      'interest_score',
      'is_current_structure',
      'created_at',
      'updated_at',
    ]),
    table('information_entry_fragment_input', [
      'workspace_id',
      'entry_id',
      'input_ordinal',
      'fragment_id',
      'created_at',
    ]),
    table('information_entry_content_keyword', [
      'workspace_id',
      'entry_id',
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
      'revision_kind',
      'rule_version',
      'is_private',
      'entry_count',
      'created_at',
      'updated_at',
    ]),
    table('information_document_tag_value', [
      'workspace_id',
      'snapshot_id',
      'tag_ordinal',
      'display_value',
      'normalized_value',
      'origin',
      'full_text_occurrences',
      'entry_coverage_count',
      'created_at',
    ]),
    table('information_entry_fragment_range', [
      'workspace_id',
      'entry_id',
      'input_ordinal',
      'start_code_point',
      'end_code_point',
      'created_at',
    ]),
    table('information_document_working_copy', [
      'workspace_id',
      'source_snapshot_id',
      'revision',
      'state',
      'draft_body',
      'body_sha256',
      'derived_resource_id',
      'derived_snapshot_id',
      'created_at',
      'updated_at',
      'committed_at',
    ]),
  ]);

const VERSION_FOUR_ENTRY_TABLES = Object.freeze(M1D_ENTRY_TABLES.slice(0, -1));

const VERSION_THREE_ENTRY_TABLES = Object.freeze(
  VERSION_FOUR_ENTRY_TABLES.map((descriptor, index) =>
    index === 0
      ? table(
          descriptor.name,
          descriptor.columns.filter(
            (column) => column !== 'is_current_structure',
          ),
        )
      : descriptor,
  ),
);

const VERSION_TWO_ENTRY_TABLES = Object.freeze(
  VERSION_THREE_ENTRY_TABLES.slice(0, -1),
);

const LEGACY_ENTRY_TABLES: readonly Readonly<M1dEntryTableDescriptor>[] =
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
    requiredDescriptor(M1D_ENTRY_TABLES, 4),
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
    encode: normalizeM1dEntrySnapshot,
    decode: normalizeM1dEntrySnapshot,
  });

export const M1D_ENTRY_VERSION_FOUR_BUNDLE_CODEC: WorkspaceBundleSectionCodec =
  Object.freeze({
    type: M1D_ENTRY_BUNDLE_SECTION_TYPE,
    version: M1D_ENTRY_VERSION_FOUR_BUNDLE_SECTION_VERSION,
    encode(value: unknown): unknown {
      return normalizeVersionFourSnapshot(value);
    },
    decode(payload: JsonValue): unknown {
      return upgradeVersionFourSnapshot(normalizeVersionFourSnapshot(payload));
    },
  });

export const M1D_ENTRY_VERSION_THREE_BUNDLE_CODEC: WorkspaceBundleSectionCodec =
  Object.freeze({
    type: M1D_ENTRY_BUNDLE_SECTION_TYPE,
    version: M1D_ENTRY_VERSION_THREE_BUNDLE_SECTION_VERSION,
    encode(value: unknown): unknown {
      return normalizeVersionThreeSnapshot(value);
    },
    decode(payload: JsonValue): unknown {
      return upgradeVersionThreeSnapshot(
        normalizeVersionThreeSnapshot(payload),
      );
    },
  });

export const M1D_ENTRY_VERSION_TWO_BUNDLE_CODEC: WorkspaceBundleSectionCodec =
  Object.freeze({
    type: M1D_ENTRY_BUNDLE_SECTION_TYPE,
    version: M1D_ENTRY_VERSION_TWO_BUNDLE_SECTION_VERSION,
    encode(value: unknown): unknown {
      return normalizeVersionTwoSnapshot(value);
    },
    decode(payload: JsonValue): unknown {
      return upgradeVersionTwoSnapshot(normalizeVersionTwoSnapshot(payload));
    },
  });

export const M1D_ENTRY_LEGACY_BUNDLE_CODEC: WorkspaceBundleSectionCodec =
  Object.freeze({
    type: M1D_ENTRY_BUNDLE_SECTION_TYPE,
    version: M1D_ENTRY_LEGACY_BUNDLE_SECTION_VERSION,
    encode(value: unknown): unknown {
      return normalizeLegacySnapshot(value);
    },
    decode(payload: JsonValue): unknown {
      return upgradeLegacySnapshot(normalizeLegacySnapshot(payload));
    },
  });

export function normalizeM1dEntrySnapshot(value: unknown): M1dEntrySnapshot {
  return normalizeSnapshot(
    value,
    M1D_ENTRY_BUNDLE_SCHEMA,
    M1D_ENTRY_TABLES,
  ) as M1dEntrySnapshot;
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

function normalizeVersionTwoSnapshot(value: unknown): Readonly<{
  schemaVersion: typeof M1D_ENTRY_VERSION_TWO_BUNDLE_SCHEMA;
  tables: readonly Readonly<M1dEntryTableSnapshot>[];
}> {
  return normalizeSnapshot(
    value,
    M1D_ENTRY_VERSION_TWO_BUNDLE_SCHEMA,
    VERSION_TWO_ENTRY_TABLES,
  ) as Readonly<{
    schemaVersion: typeof M1D_ENTRY_VERSION_TWO_BUNDLE_SCHEMA;
    tables: readonly Readonly<M1dEntryTableSnapshot>[];
  }>;
}

function normalizeVersionThreeSnapshot(value: unknown): Readonly<{
  schemaVersion: typeof M1D_ENTRY_VERSION_THREE_BUNDLE_SCHEMA;
  tables: readonly Readonly<M1dEntryTableSnapshot>[];
}> {
  return normalizeSnapshot(
    value,
    M1D_ENTRY_VERSION_THREE_BUNDLE_SCHEMA,
    VERSION_THREE_ENTRY_TABLES,
  ) as Readonly<{
    schemaVersion: typeof M1D_ENTRY_VERSION_THREE_BUNDLE_SCHEMA;
    tables: readonly Readonly<M1dEntryTableSnapshot>[];
  }>;
}

function normalizeVersionFourSnapshot(value: unknown): Readonly<{
  schemaVersion: typeof M1D_ENTRY_VERSION_FOUR_BUNDLE_SCHEMA;
  tables: readonly Readonly<M1dEntryTableSnapshot>[];
}> {
  return normalizeSnapshot(
    value,
    M1D_ENTRY_VERSION_FOUR_BUNDLE_SCHEMA,
    VERSION_FOUR_ENTRY_TABLES,
  ) as Readonly<{
    schemaVersion: typeof M1D_ENTRY_VERSION_FOUR_BUNDLE_SCHEMA;
    tables: readonly Readonly<M1dEntryTableSnapshot>[];
  }>;
}

function upgradeVersionFourSnapshot(
  snapshot: ReturnType<typeof normalizeVersionFourSnapshot>,
): M1dEntrySnapshot {
  return normalizeM1dEntrySnapshot({
    schemaVersion: M1D_ENTRY_BUNDLE_SCHEMA,
    tables: [
      ...snapshot.tables,
      {name: 'information_document_working_copy', rows: []},
    ],
  });
}

function upgradeVersionThreeSnapshot(
  snapshot: ReturnType<typeof normalizeVersionThreeSnapshot>,
): M1dEntrySnapshot {
  return upgradeVersionFourSnapshot(
    normalizeVersionFourSnapshot({
      schemaVersion: M1D_ENTRY_VERSION_FOUR_BUNDLE_SCHEMA,
      tables: snapshot.tables.map((tableSnapshot) =>
        tableSnapshot.name === 'information_entry'
          ? {
              name: tableSnapshot.name,
              rows: tableSnapshot.rows.map((row) => ({
                ...row,
                is_current_structure: true,
              })),
            }
          : tableSnapshot,
      ),
    }),
  );
}

function upgradeVersionTwoSnapshot(
  snapshot: ReturnType<typeof normalizeVersionTwoSnapshot>,
): M1dEntrySnapshot {
  return upgradeVersionThreeSnapshot(
    normalizeVersionThreeSnapshot({
      schemaVersion: M1D_ENTRY_VERSION_THREE_BUNDLE_SCHEMA,
      tables: [
        ...snapshot.tables,
        {name: 'information_entry_fragment_range', rows: []},
      ],
    }),
  );
}

function normalizeLegacySnapshot(value: unknown): Readonly<{
  schemaVersion: typeof M1D_ENTRY_LEGACY_BUNDLE_SCHEMA;
  tables: readonly Readonly<M1dEntryTableSnapshot>[];
}> {
  return normalizeSnapshot(
    value,
    M1D_ENTRY_LEGACY_BUNDLE_SCHEMA,
    LEGACY_ENTRY_TABLES,
  ) as Readonly<{
    schemaVersion: typeof M1D_ENTRY_LEGACY_BUNDLE_SCHEMA;
    tables: readonly Readonly<M1dEntryTableSnapshot>[];
  }>;
}

function upgradeLegacySnapshot(
  legacy: ReturnType<typeof normalizeLegacySnapshot>,
): M1dEntrySnapshot {
  const tables = new Map(
    legacy.tables.map((value) => [value.name, value.rows]),
  );
  const entries = requiredRows(tables, 'information_entry');
  const revisions = requiredRows(tables, 'information_entry_revision');
  const currentByEntry = new Map(
    entries.map((entry) => [
      identity(entry, 'entry_id'),
      {
        revision: requiredPrimitive(entry, 'current_revision'),
        revisionId: requiredPrimitive(entry, 'current_revision_id'),
      },
    ]),
  );
  const revisionByEntry = new Map(
    revisions.map((revision) => [
      identity(revision, 'entry_id', 'revision_number', 'revision_id'),
      revision,
    ]),
  );
  const currentEntries = entries.map((entry) => {
    const revision = revisionByEntry.get(
      identityValues(
        requiredPrimitive(entry, 'workspace_id'),
        requiredPrimitive(entry, 'entry_id'),
        requiredPrimitive(entry, 'current_revision'),
        requiredPrimitive(entry, 'current_revision_id'),
      ),
    );
    if (revision === undefined) fail();
    return rowFor(requiredDescriptor(M1D_ENTRY_TABLES, 0), {
      ...entry,
      ...revision,
      created_at: requiredPrimitive(entry, 'created_at'),
      usefulness_score: null,
      interest_score: null,
      is_current_structure: true,
      updated_at: requiredPrimitive(revision, 'created_at'),
    });
  });

  const currentChildren = (
    tableName: string,
    descriptor: Readonly<M1dEntryTableDescriptor>,
  ) =>
    requiredRows(tables, tableName)
      .filter((row) => {
        const current = currentByEntry.get(identity(row, 'entry_id'));
        return (
          current !== undefined &&
          current.revision === row.revision_number &&
          current.revisionId === row.revision_id
        );
      })
      .map((row) => rowFor(descriptor, row));

  const tagSets = requiredRows(tables, 'information_document_tag_set');
  const tagRevisions = new Map(
    requiredRows(tables, 'information_document_tag_revision').map(
      (revision) => [
        identity(revision, 'snapshot_id', 'revision_number', 'revision_id'),
        revision,
      ],
    ),
  );
  const currentTagsBySnapshot = new Map(
    tagSets.map((tagSet) => [
      identity(tagSet, 'snapshot_id'),
      {
        revision: requiredPrimitive(tagSet, 'current_revision'),
        revisionId: requiredPrimitive(tagSet, 'current_revision_id'),
      },
    ]),
  );
  const currentTagSets = tagSets.map((tagSet) => {
    const revision = tagRevisions.get(
      identityValues(
        requiredPrimitive(tagSet, 'workspace_id'),
        requiredPrimitive(tagSet, 'snapshot_id'),
        requiredPrimitive(tagSet, 'current_revision'),
        requiredPrimitive(tagSet, 'current_revision_id'),
      ),
    );
    if (revision === undefined) fail();
    return rowFor(requiredDescriptor(M1D_ENTRY_TABLES, 5), {
      ...tagSet,
      ...revision,
      created_at: requiredPrimitive(tagSet, 'created_at'),
      updated_at: requiredPrimitive(revision, 'created_at'),
    });
  });
  const currentTagValues = requiredRows(
    tables,
    'information_document_tag_value',
  )
    .filter((row) => {
      const current = currentTagsBySnapshot.get(identity(row, 'snapshot_id'));
      return (
        current !== undefined &&
        current.revision === row.revision_number &&
        current.revisionId === row.revision_id
      );
    })
    .map((row) => rowFor(requiredDescriptor(M1D_ENTRY_TABLES, 6), row));

  return normalizeM1dEntrySnapshot({
    schemaVersion: M1D_ENTRY_BUNDLE_SCHEMA,
    tables: [
      {name: 'information_entry', rows: currentEntries},
      {
        name: 'information_entry_fragment_input',
        rows: currentChildren(
          'information_entry_fragment_input',
          requiredDescriptor(M1D_ENTRY_TABLES, 1),
        ),
      },
      {
        name: 'information_entry_content_keyword',
        rows: currentChildren(
          'information_entry_content_keyword',
          requiredDescriptor(M1D_ENTRY_TABLES, 2),
        ),
      },
      {
        name: 'information_entry_domain_keyword',
        rows: currentChildren(
          'information_entry_domain_keyword',
          requiredDescriptor(M1D_ENTRY_TABLES, 3),
        ),
      },
      {
        name: 'information_entry_lineage',
        rows: requiredRows(tables, 'information_entry_lineage'),
      },
      {name: 'information_document_tag_set', rows: currentTagSets},
      {name: 'information_document_tag_value', rows: currentTagValues},
      {name: 'information_entry_fragment_range', rows: []},
      {name: 'information_document_working_copy', rows: []},
    ],
  });
}

function normalizeSnapshot(
  value: unknown,
  schema: string,
  descriptors: readonly Readonly<M1dEntryTableDescriptor>[],
): Readonly<{schemaVersion: string; tables: readonly M1dEntryTableSnapshot[]}> {
  const normalized = normalizeJsonValue(value, {
    maximumValues: ENTRY_VALUE_LIMIT,
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
  descriptors: readonly Readonly<M1dEntryTableDescriptor>[],
  index: number,
): Readonly<M1dEntryTableDescriptor> {
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
  descriptor: Readonly<M1dEntryTableDescriptor>,
  source: Readonly<Record<string, JsonPrimitive>>,
): M1dEntryRow {
  const value = Object.create(null) as Record<string, JsonPrimitive>;
  for (const column of descriptor.columns) {
    if (!Object.hasOwn(source, column)) fail();
    value[column] = requiredPrimitive(source, column);
  }
  return Object.freeze(value);
}

function requiredRows(
  tables: ReadonlyMap<string, readonly M1dEntryRow[]>,
  name: string,
): readonly M1dEntryRow[] {
  const rows = tables.get(name);
  if (rows === undefined) fail();
  return rows;
}

function identity(row: M1dEntryRow, ...columns: readonly string[]): string {
  return identityValues(
    requiredPrimitive(row, 'workspace_id'),
    ...columns.map((column) => requiredPrimitive(row, column)),
  );
}

function identityValues(...values: readonly JsonPrimitive[]): string {
  return JSON.stringify(values);
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
