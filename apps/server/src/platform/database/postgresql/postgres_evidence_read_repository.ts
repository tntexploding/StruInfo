import {
  EVIDENCE_SNAPSHOT_LIST_LIMIT,
  DOCUMENT_NODE_KINDS,
  PUBLICATION_PRECISIONS,
  RESOURCE_KINDS,
  type EvidenceFragmentReadState,
  type EvidenceReadRepositoryPort,
  type EvidenceSnapshotReadState,
  type EvidenceSnapshotSummary,
  type EvidenceStructureReadState,
  type PublicationInput,
} from '../../../modules/evidence/index.js';

import type {PostgresPoolBoundary} from './postgres_pool.js';
import {runPostgresTransaction} from './postgres_transaction.js';
import {
  canonicalUuid,
  enumValue,
  integer,
  optionalText,
  PostgresAdapterError,
  sha256,
  text,
} from './postgres_values.js';

export const LIST_EVIDENCE_SNAPSHOTS_SQL = `SELECT
  s.workspace_id::text, s.snapshot_id::text, s.resource_id::text,
  r.resource_kind, r.source_key, r.canonical_uri, r.is_private, s.captured_at,
  s.published_at, s.published_timezone, s.published_precision,
  s.published_source_text, s.published_inferred,
  count(f.fragment_id)::integer AS fragment_count
FROM struinfo.snapshot AS s
JOIN struinfo.resource AS r
  ON r.workspace_id = s.workspace_id AND r.resource_id = s.resource_id
LEFT JOIN struinfo.fragment AS f
  ON f.workspace_id = s.workspace_id AND f.snapshot_id = s.snapshot_id
WHERE s.workspace_id = $1
GROUP BY
  s.workspace_id, s.snapshot_id, s.resource_id, r.resource_kind,
  r.source_key, r.canonical_uri, r.is_private, s.captured_at, s.published_at,
  s.published_timezone, s.published_precision, s.published_source_text,
  s.published_inferred
ORDER BY s.captured_at DESC, s.snapshot_id
LIMIT ${String(EVIDENCE_SNAPSHOT_LIST_LIMIT)}` as const;

export const READ_EVIDENCE_SNAPSHOT_SQL = `SELECT
  s.workspace_id::text, s.snapshot_id::text, s.resource_id::text,
  r.resource_kind, r.source_key, r.canonical_uri, r.is_private, s.captured_at,
  s.published_at, s.published_timezone, s.published_precision,
  s.published_source_text, s.published_inferred,
  s.raw_sha256, s.canonical_content_sha256,
  s.canonicalization_version, s.media_type,
  (SELECT count(*)::integer FROM struinfo.fragment AS f
    WHERE f.workspace_id = s.workspace_id AND f.snapshot_id = s.snapshot_id)
    AS fragment_count
FROM struinfo.snapshot AS s
JOIN struinfo.resource AS r
  ON r.workspace_id = s.workspace_id AND r.resource_id = s.resource_id
WHERE s.workspace_id = $1 AND s.snapshot_id = $2` as const;

export const READ_EVIDENCE_STRUCTURES_SQL = `SELECT
  workspace_id::text, structure_id::text, parser_name, parser_version,
  text_normalization_version, text_blob_sha256, text_blob_byte_length,
  structure_sha256
FROM struinfo.document_structure
WHERE workspace_id = $1 AND snapshot_id = $2
ORDER BY structure_id` as const;

export const READ_EVIDENCE_FRAGMENTS_SQL = `SELECT
  f.fragment_id::text, f.structure_id::text, f.node_id::text, n.node_kind,
  f.code_point_start, f.code_point_end, f.line_start, f.line_end,
  f.selected_text_sha256
FROM struinfo.fragment AS f
JOIN struinfo.document_node AS n
  ON n.workspace_id = f.workspace_id
 AND n.resource_id = f.resource_id
 AND n.snapshot_id = f.snapshot_id
 AND n.structure_id = f.structure_id
 AND n.node_id = f.node_id
WHERE f.workspace_id = $1 AND f.snapshot_id = $2
ORDER BY f.structure_id, f.code_point_start, f.code_point_end, f.fragment_id` as const;

type Row = Readonly<Record<string, unknown>>;

export class PostgresEvidenceReadRepository implements EvidenceReadRepositoryPort {
  readonly #pool: PostgresPoolBoundary;

  public constructor(pool: PostgresPoolBoundary) {
    this.#pool = pool;
  }

  public async listSnapshots(
    workspaceIdInput: string,
  ): Promise<readonly Readonly<EvidenceSnapshotSummary>[]> {
    const workspaceId = canonicalUuid(workspaceIdInput);
    const result = await this.#pool.query<Row>(LIST_EVIDENCE_SNAPSHOTS_SQL, [
      workspaceId,
    ]);
    return Object.freeze(result.rows.map(mapSnapshotSummary));
  }

  public loadSnapshot(
    workspaceIdInput: string,
    snapshotIdInput: string,
  ): Promise<Readonly<EvidenceSnapshotReadState> | undefined> {
    const workspaceId = canonicalUuid(workspaceIdInput);
    const snapshotId = canonicalUuid(snapshotIdInput);
    return runPostgresTransaction(
      this.#pool,
      'repeatable_read_only',
      async (client) => {
        const snapshotResult = await client.query<Row>(
          READ_EVIDENCE_SNAPSHOT_SQL,
          [workspaceId, snapshotId],
        );
        if (snapshotResult.rows.length === 0) return undefined;
        if (snapshotResult.rows.length !== 1) throw new PostgresAdapterError();
        const snapshotRow = snapshotResult.rows[0];
        if (snapshotRow === undefined) throw new PostgresAdapterError();

        const structuresResult = await client.query<Row>(
          READ_EVIDENCE_STRUCTURES_SQL,
          [workspaceId, snapshotId],
        );
        const fragmentsResult = await client.query<Row>(
          READ_EVIDENCE_FRAGMENTS_SQL,
          [workspaceId, snapshotId],
        );
        const fragments = fragmentsResult.rows.map(mapFragment);
        const structures = structuresResult.rows.map((row) =>
          mapStructure(row, fragments),
        );
        if (
          fragments.some(
            (fragment) =>
              !structures.some(
                (structure) => structure.structureId === fragment.structureId,
              ),
          )
        ) {
          throw new PostgresAdapterError();
        }
        const summary = mapSnapshotSummary(snapshotRow);
        const mediaType = optionalText(snapshotRow.media_type);
        return Object.freeze({
          ...summary,
          rawSha256: sha256(snapshotRow.raw_sha256),
          canonicalContentSha256: sha256(snapshotRow.canonical_content_sha256),
          canonicalizationVersion: text(snapshotRow.canonicalization_version),
          ...(mediaType === undefined ? {} : {mediaType}),
          structures: Object.freeze(structures),
        });
      },
    );
  }
}

function mapSnapshotSummary(row: Row): EvidenceSnapshotSummary {
  const canonicalUri = optionalText(row.canonical_uri);
  const publication = mapPublication(row);
  if (typeof row.is_private !== 'boolean') {
    throw new PostgresAdapterError();
  }
  return Object.freeze({
    workspaceId: canonicalUuid(row.workspace_id),
    snapshotId: canonicalUuid(row.snapshot_id),
    resourceId: canonicalUuid(row.resource_id),
    resourceKind: enumValue(row.resource_kind, RESOURCE_KINDS),
    sourceKey: text(row.source_key),
    ...(canonicalUri === undefined ? {} : {canonicalUri}),
    ...(row.is_private ? {isPrivate: true as const} : {}),
    capturedAt: timestamp(row.captured_at),
    ...(publication === undefined ? {} : {publication}),
    fragmentCount: integer(row.fragment_count, 0),
  });
}

function mapPublication(row: Row): Readonly<PublicationInput> | undefined {
  const instant = optionalTimestamp(row.published_at);
  const sourceTimezone = optionalText(row.published_timezone);
  const precision =
    row.published_precision === null
      ? undefined
      : enumValue(row.published_precision, PUBLICATION_PRECISIONS);
  const sourceText = optionalText(row.published_source_text);
  if (typeof row.published_inferred !== 'boolean') {
    throw new PostgresAdapterError();
  }
  if (
    instant === undefined &&
    sourceTimezone === undefined &&
    precision === undefined &&
    sourceText === undefined &&
    !row.published_inferred
  ) {
    return undefined;
  }
  return Object.freeze({
    ...(instant === undefined ? {} : {instant}),
    ...(sourceTimezone === undefined ? {} : {sourceTimezone}),
    ...(precision === undefined ? {} : {precision}),
    ...(sourceText === undefined ? {} : {sourceText}),
    inferred: row.published_inferred,
  });
}

function mapStructure(
  row: Row,
  fragments: readonly EvidenceFragmentReadState[],
): EvidenceStructureReadState {
  canonicalUuid(row.workspace_id);
  const structureId = canonicalUuid(row.structure_id);
  return Object.freeze({
    structureId,
    parserName: text(row.parser_name),
    parserVersion: text(row.parser_version),
    textNormalizationVersion: text(row.text_normalization_version),
    structureSha256: sha256(row.structure_sha256),
    textBlob: Object.freeze({
      algorithm: 'sha256' as const,
      digest: sha256(row.text_blob_sha256),
      byteLength: postgresSafeInteger(row.text_blob_byte_length),
    }),
    fragments: Object.freeze(
      fragments.filter((fragment) => fragment.structureId === structureId),
    ),
  });
}

function mapFragment(row: Row): EvidenceFragmentReadState {
  const lineStart = optionalPostgresInteger(row.line_start, 1);
  const lineEnd = optionalPostgresInteger(row.line_end, 1);
  if ((lineStart === undefined) !== (lineEnd === undefined)) {
    throw new PostgresAdapterError();
  }
  return Object.freeze({
    fragmentId: canonicalUuid(row.fragment_id),
    structureId: canonicalUuid(row.structure_id),
    nodeId: canonicalUuid(row.node_id),
    nodeKind: enumValue(row.node_kind, DOCUMENT_NODE_KINDS),
    codePointRange: Object.freeze({
      start: postgresSafeInteger(row.code_point_start),
      end: postgresSafeInteger(row.code_point_end),
    }),
    ...(lineStart === undefined || lineEnd === undefined
      ? {}
      : {lineRange: Object.freeze({start: lineStart, end: lineEnd})}),
    selectedTextSha256: sha256(row.selected_text_sha256),
  });
}

function timestamp(value: unknown): string {
  if (value instanceof Date && Number.isFinite(value.valueOf())) {
    return value.toISOString();
  }
  if (typeof value === 'string') {
    const parsed = new Date(value);
    if (Number.isFinite(parsed.valueOf())) return parsed.toISOString();
  }
  throw new PostgresAdapterError();
}

function optionalTimestamp(value: unknown): string | undefined {
  return value === null ? undefined : timestamp(value);
}

function postgresSafeInteger(value: unknown, minimum = 0): number {
  const parsed =
    typeof value === 'string' && /^\d+$/u.test(value) ? Number(value) : value;
  if (
    typeof parsed !== 'number' ||
    !Number.isSafeInteger(parsed) ||
    parsed < minimum
  ) {
    throw new PostgresAdapterError();
  }
  return parsed;
}

function optionalPostgresInteger(
  value: unknown,
  minimum: number,
): number | undefined {
  return value === null ? undefined : postgresSafeInteger(value, minimum);
}
