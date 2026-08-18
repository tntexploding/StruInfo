import {Buffer} from 'node:buffer';

import {
  encodeCanonicalJson,
  normalizeJsonValue,
  type JsonObject,
  type JsonPrimitive,
  type JsonValue,
} from '../serialization/canonical_json.js';
import {
  BLOB_DIGEST_ALGORITHM,
  type BlobIdentity,
} from '../storage/blob_store.js';
import type {WorkspaceBundleSectionCodec} from './workspace_bundle.js';

export const M1C_DOMAIN_BUNDLE_SECTION_TYPE = 'struinfo.m1c-domain';
export const M1C_DOMAIN_BUNDLE_SECTION_VERSION = 1;
export const M1C_DOMAIN_BUNDLE_SCHEMA = 'struinfo.m1c-domain.v1';

const DOMAIN_VALUE_LIMIT = 1_000_000;
const ROW_BYTE_LIMIT = 1 * 1024 * 1024;
const CANONICAL_UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;
const SHA256 = /^[0-9a-f]{64}$/u;

export interface M1cDomainTableDescriptor {
  readonly name: string;
  readonly columns: readonly string[];
}

export type M1cDomainRow = Readonly<Record<string, JsonPrimitive>>;

export interface M1cDomainTableSnapshot {
  readonly name: string;
  readonly rows: readonly M1cDomainRow[];
}

export interface M1cDomainSnapshot {
  readonly schemaVersion: typeof M1C_DOMAIN_BUNDLE_SCHEMA;
  readonly tables: readonly Readonly<M1cDomainTableSnapshot>[];
}

/**
 * Dependency order is also the restore order. Column order follows the
 * reviewed migrations and is used to reject schema drift at the Bundle edge.
 */
export const M1C_DOMAIN_TABLES: readonly Readonly<M1cDomainTableDescriptor>[] =
  Object.freeze([
    table('workspace', ['workspace_id', 'created_at']),
    table('evidence_blob', [
      'workspace_id',
      'blob_id',
      'digest_algorithm',
      'digest',
      'byte_length',
      'media_type',
      'read_revoked_at',
      'delete_after',
      'created_at',
    ]),
    table('resource', [
      'workspace_id',
      'resource_id',
      'resource_kind',
      'source_key',
      'canonical_uri',
      'created_at',
      'is_private',
    ]),
    table('git_resource', [
      'workspace_id',
      'resource_id',
      'canonical_repository_uri',
      'repository_relative_path',
      'created_at',
    ]),
    table('snapshot', [
      'workspace_id',
      'snapshot_id',
      'resource_id',
      'raw_sha256',
      'raw_blob_id',
      'raw_blob_byte_length',
      'canonical_content_sha256',
      'canonicalization_version',
      'media_type',
      'published_at',
      'published_timezone',
      'published_precision',
      'published_source_text',
      'published_inferred',
      'captured_at',
      'created_at',
    ]),
    table('git_snapshot_observation', [
      'workspace_id',
      'observation_id',
      'resource_id',
      'snapshot_id',
      'repository_ref',
      'commit_hash_algorithm',
      'commit_hash',
      'git_blob_hash_algorithm',
      'git_blob_hash',
      'observed_at',
      'created_at',
    ]),
    table('document_structure', [
      'workspace_id',
      'structure_id',
      'resource_id',
      'snapshot_id',
      'parser_name',
      'parser_version',
      'text_normalization_version',
      'text_blob_id',
      'text_blob_sha256',
      'text_blob_byte_length',
      'structure_sha256',
      'created_at',
    ]),
    table('document_node', [
      'workspace_id',
      'structure_id',
      'node_id',
      'resource_id',
      'snapshot_id',
      'parent_node_id',
      'node_kind',
      'sibling_ordinal',
      'code_point_start',
      'code_point_end',
      'line_start',
      'line_end',
      'created_at',
    ]),
    table('fragment', [
      'workspace_id',
      'fragment_id',
      'resource_id',
      'snapshot_id',
      'structure_id',
      'node_id',
      'text_blob_id',
      'text_blob_sha256',
      'text_blob_byte_length',
      'locator_kind',
      'locator_version',
      'code_point_start',
      'code_point_end',
      'line_start',
      'line_end',
      'selected_text_sha256',
      'created_at',
    ]),
    table('media_asset', [
      'workspace_id',
      'media_asset_id',
      'storage_mode',
      'blob_id',
      'blob_sha256',
      'blob_byte_length',
      'original_uri',
      'media_type',
      'pixel_width',
      'pixel_height',
      'created_at',
    ]),
    table('media_usage', [
      'workspace_id',
      'media_usage_id',
      'media_asset_id',
      'resource_id',
      'snapshot_id',
      'structure_id',
      'node_id',
      'ordinal',
      'purpose',
      'purpose_origin',
      'confidence',
      'superseded_usage_id',
      'created_at',
    ]),
    table('evidence_capture_command', [
      'workspace_id',
      'command_idempotency_key',
      'request_sha256',
      'created_at',
    ]),
    table('curation_target', [
      'workspace_id',
      'target_id',
      'target_kind',
      'resource_id',
      'snapshot_id',
      'fragment_id',
      'current_version',
      'created_at',
    ]),
    table('vocabulary_term', [
      'workspace_id',
      'term_id',
      'current_revision',
      'current_term_revision_id',
      'created_at',
    ]),
    table('vocabulary_term_revision', [
      'workspace_id',
      'term_id',
      'term_revision_id',
      'revision_number',
      'display_name',
      'description',
      'parent_term_id',
      'lifecycle',
      'created_at',
    ]),
    table('classification_assignment', [
      'workspace_id',
      'assignment_id',
      'target_id',
      'term_id',
      'current_revision',
      'current_assignment_revision_id',
      'created_at',
    ]),
    table('classification_assignment_revision', [
      'workspace_id',
      'assignment_id',
      'assignment_revision_id',
      'revision_number',
      'assignment_state',
      'term_id',
      'term_revision_number',
      'term_revision_id',
      'created_at',
    ]),
    table('intake_decision', [
      'workspace_id',
      'decision_id',
      'target_id',
      'current_revision',
      'current_decision_revision_id',
      'created_at',
    ]),
    table('intake_decision_revision', [
      'workspace_id',
      'decision_id',
      'decision_revision_id',
      'revision_number',
      'intake_action',
      'note',
      'created_at',
    ]),
    table('intake_decision_reason', [
      'workspace_id',
      'decision_id',
      'decision_revision_id',
      'reason_ordinal',
      'reason_code',
      'created_at',
    ]),
    table('assessment', [
      'workspace_id',
      'assessment_id',
      'target_id',
      'dimension',
      'current_revision',
      'current_assessment_revision_id',
      'created_at',
    ]),
    table('assessment_revision', [
      'workspace_id',
      'assessment_id',
      'assessment_revision_id',
      'revision_number',
      'assessment_state',
      'score',
      'note',
      'created_at',
    ]),
    table('curation_command', [
      'workspace_id',
      'command_idempotency_key',
      'request_sha256',
      'command_kind',
      'authority',
      'target_id',
      'term_id',
      'outcome',
      'resulting_version',
      'created_at',
    ]),
    table('knowledge_change_set', [
      'workspace_id',
      'change_set_id',
      'command_idempotency_key',
      'request_sha256',
      'command_kind',
      'authority',
      'operation_origin',
      'authorization_kind',
      'target_id',
      'decision_id',
      'decision_revision',
      'decision_revision_id',
      'original_outcome',
      'operation_count',
      'created_at',
    ]),
    table('knowledge_item', [
      'workspace_id',
      'item_id',
      'current_revision',
      'current_revision_id',
      'created_at',
    ]),
    table('knowledge_relation', [
      'workspace_id',
      'relation_id',
      'subject_item_id',
      'relation_type_key',
      'object_item_id',
      'current_revision',
      'current_revision_id',
      'created_at',
    ]),
    table('knowledge_change_operation', [
      'workspace_id',
      'change_set_id',
      'operation_index',
      'operation_kind',
      'item_id',
      'relation_id',
      'operation_outcome',
      'resulting_revision',
      'resulting_revision_id',
      'created_at',
    ]),
    table('knowledge_revision', [
      'workspace_id',
      'item_id',
      'revision_id',
      'revision_number',
      'knowledge_kind',
      'epistemic_role',
      'review_state',
      'title',
      'body',
      'change_set_id',
      'operation_index',
      'previous_revision_id',
      'created_at',
      'is_private',
    ]),
    table('knowledge_relation_revision', [
      'workspace_id',
      'relation_id',
      'revision_id',
      'revision_number',
      'subject_item_id',
      'relation_type_key',
      'object_item_id',
      'epistemic_role',
      'review_state',
      'qualifier',
      'change_set_id',
      'operation_index',
      'previous_revision_id',
      'created_at',
      'is_private',
    ]),
    table('knowledge_revision_fragment_input', [
      'workspace_id',
      'item_id',
      'revision_number',
      'revision_id',
      'input_kind',
      'input_ordinal',
      'fragment_id',
      'created_at',
    ]),
    table('knowledge_revision_item_input', [
      'workspace_id',
      'item_id',
      'revision_number',
      'revision_id',
      'input_ordinal',
      'input_item_id',
      'input_revision_number',
      'input_revision_id',
      'created_at',
    ]),
    table('knowledge_revision_relation_input', [
      'workspace_id',
      'item_id',
      'revision_number',
      'revision_id',
      'input_ordinal',
      'input_relation_id',
      'input_revision_number',
      'input_revision_id',
      'created_at',
    ]),
    table('relation_revision_fragment_input', [
      'workspace_id',
      'relation_id',
      'revision_number',
      'revision_id',
      'input_kind',
      'input_ordinal',
      'fragment_id',
      'created_at',
    ]),
    table('relation_revision_item_input', [
      'workspace_id',
      'relation_id',
      'revision_number',
      'revision_id',
      'input_ordinal',
      'input_item_id',
      'input_revision_number',
      'input_revision_id',
      'created_at',
    ]),
    table('relation_revision_relation_input', [
      'workspace_id',
      'relation_id',
      'revision_number',
      'revision_id',
      'input_ordinal',
      'input_relation_id',
      'input_revision_number',
      'input_revision_id',
      'created_at',
    ]),
    table('knowledge_change_event', [
      'workspace_id',
      'event_id',
      'event_kind',
      'event_schema_version',
      'change_set_id',
      'created_at',
    ]),
  ]);

export const M1C_DOMAIN_BUNDLE_CODEC: WorkspaceBundleSectionCodec =
  Object.freeze({
    type: M1C_DOMAIN_BUNDLE_SECTION_TYPE,
    version: M1C_DOMAIN_BUNDLE_SECTION_VERSION,
    encode(value: unknown): unknown {
      return normalizeM1cDomainSnapshot(value);
    },
    decode(payload: JsonValue): unknown {
      return normalizeM1cDomainSnapshot(payload);
    },
  });

export function normalizeM1cDomainSnapshot(value: unknown): M1cDomainSnapshot {
  const normalized = normalizeJsonValue(value, {
    maximumValues: DOMAIN_VALUE_LIMIT,
  });
  const record = requireClosedObject(normalized, ['schemaVersion', 'tables']);
  if (record.schemaVersion !== M1C_DOMAIN_BUNDLE_SCHEMA) fail();
  const tableValues = record.tables;
  if (!isJsonArray(tableValues)) fail();
  if (tableValues.length !== M1C_DOMAIN_TABLES.length) fail();

  const tables = M1C_DOMAIN_TABLES.map((descriptor, index) => {
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
  if (tables[0]?.rows.length !== 1) fail();
  return Object.freeze({
    schemaVersion: M1C_DOMAIN_BUNDLE_SCHEMA,
    tables: Object.freeze(tables),
  });
}

export function assertM1cDomainWorkspace(
  snapshot: Readonly<M1cDomainSnapshot>,
  workspaceId: string,
): void {
  if (!CANONICAL_UUID.test(workspaceId)) fail();
  for (const tableSnapshot of snapshot.tables) {
    for (const row of tableSnapshot.rows) {
      if (row.workspace_id !== workspaceId) fail();
    }
  }
}

export function m1cDomainBlobReferences(
  snapshot: Readonly<M1cDomainSnapshot>,
): readonly Readonly<BlobIdentity>[] {
  const tableSnapshot = snapshot.tables.find(
    (candidate) => candidate.name === 'evidence_blob',
  );
  if (tableSnapshot === undefined) fail();
  const references = tableSnapshot.rows.map((row) => {
    if (
      row.digest_algorithm !== BLOB_DIGEST_ALGORITHM ||
      typeof row.digest !== 'string' ||
      !SHA256.test(row.digest) ||
      typeof row.byte_length !== 'number' ||
      !Number.isSafeInteger(row.byte_length) ||
      row.byte_length < 0
    ) {
      fail();
    }
    return Object.freeze({
      algorithm: BLOB_DIGEST_ALGORITHM,
      digest: row.digest,
      byteLength: row.byte_length,
    });
  });
  references.sort((left, right) => left.digest.localeCompare(right.digest));
  for (let index = 1; index < references.length; index += 1) {
    if (references[index - 1]?.digest === references[index]?.digest) fail();
  }
  return Object.freeze(references);
}

export function m1cDomainTableCounts(
  snapshot: Readonly<M1cDomainSnapshot>,
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
): Readonly<M1cDomainTableDescriptor> {
  return Object.freeze({name, columns: Object.freeze(columns)});
}

function normalizeRow(
  value: JsonValue | undefined,
  descriptor: Readonly<M1cDomainTableDescriptor>,
): M1cDomainRow {
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

function compareRows(left: M1cDomainRow, right: M1cDomainRow): number {
  return Buffer.compare(
    Buffer.from(encodeCanonicalJson(left, ROW_BYTE_LIMIT)),
    Buffer.from(encodeCanonicalJson(right, ROW_BYTE_LIMIT)),
  );
}

function fail(): never {
  throw new Error('The M1C domain Bundle section is invalid.');
}
