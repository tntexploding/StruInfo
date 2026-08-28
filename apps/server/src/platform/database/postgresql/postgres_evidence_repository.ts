import type {
  EvidenceCaptureRepositoryRequest,
  EvidenceCaptureRepositoryResult,
  EvidenceRepositoryPort,
  MediaAssetInput,
  ValidatedCaptureEvidence,
} from '../../../modules/evidence/index.js';
import {EvidenceRepositoryError} from '../../../modules/evidence/index.js';

import type {
  PostgresClientBoundary,
  PostgresPoolBoundary,
} from './postgres_pool.js';
import {
  BEGIN_READ_COMMITTED_SQL,
  COMMIT_TRANSACTION_SQL,
  ROLLBACK_TRANSACTION_SQL,
} from './postgres_transaction.js';
import {deriveWorkspaceWriteLockKey} from './workspace_write_lock.js';

export const INSERT_EVIDENCE_WORKSPACE_SQL = `INSERT INTO struinfo.workspace
(workspace_id)
VALUES ($1)
ON CONFLICT DO NOTHING` as const;

export const READ_EVIDENCE_WORKSPACE_SQL = `SELECT workspace_id::text
FROM struinfo.workspace
WHERE workspace_id = $1` as const;

export const READ_EVIDENCE_CAPTURE_COMMAND_SQL = `SELECT request_sha256
FROM struinfo.evidence_capture_command
WHERE workspace_id = $1 AND command_idempotency_key = $2` as const;

export const INSERT_EVIDENCE_CAPTURE_COMMAND_SQL =
  `INSERT INTO struinfo.evidence_capture_command
(workspace_id, command_idempotency_key, request_sha256)
VALUES ($1, $2, $3)` as const;

export const ACQUIRE_EVIDENCE_WORKSPACE_LOCK_SQL =
  'SELECT pg_advisory_xact_lock($1::bigint)' as const;

const INSERT_BLOBS_SQL = `INSERT INTO struinfo.evidence_blob
(workspace_id, blob_id, digest_algorithm, digest, byte_length, media_type)
SELECT $1::uuid, candidate.blob_id, candidate.digest_algorithm,
  candidate.digest, candidate.byte_length, candidate.media_type
FROM unnest($2::uuid[], $3::text[], $4::text[], $5::bigint[], $6::text[])
  AS candidate(blob_id, digest_algorithm, digest, byte_length, media_type)
ON CONFLICT DO NOTHING`;
const VERIFY_BLOBS_SQL = `WITH expected AS (
  SELECT $1::uuid AS workspace_id, candidate.*
  FROM unnest($2::uuid[], $3::text[], $4::text[], $5::bigint[], $6::text[])
    AS candidate(blob_id, digest_algorithm, digest, byte_length, media_type)
)
SELECT 1 AS mismatch
FROM expected
LEFT JOIN struinfo.evidence_blob AS stored
  ON stored.workspace_id = expected.workspace_id
 AND stored.blob_id = expected.blob_id
WHERE stored.blob_id IS NULL
   OR ROW(stored.digest_algorithm, stored.digest, stored.byte_length, stored.media_type)
      IS DISTINCT FROM
      ROW(expected.digest_algorithm, expected.digest, expected.byte_length, expected.media_type)
LIMIT 1`;

const INSERT_RESOURCE_SQL = `INSERT INTO struinfo.resource
(workspace_id, resource_id, resource_kind, source_key, canonical_uri, is_private)
SELECT $1::uuid, candidate.resource_id, candidate.resource_kind,
  candidate.source_key, candidate.canonical_uri, candidate.is_private
FROM unnest($2::uuid[], $3::text[], $4::text[], $5::text[], $6::boolean[])
  AS candidate(resource_id, resource_kind, source_key, canonical_uri, is_private)
ON CONFLICT DO NOTHING`;
const VERIFY_RESOURCE_SQL = `WITH expected AS (
  SELECT $1::uuid AS workspace_id, candidate.*
  FROM unnest($2::uuid[], $3::text[], $4::text[], $5::text[], $6::boolean[])
    AS candidate(resource_id, resource_kind, source_key, canonical_uri, is_private)
)
SELECT 1 AS mismatch
FROM expected
LEFT JOIN struinfo.resource AS stored
  ON stored.workspace_id = expected.workspace_id
 AND stored.resource_id = expected.resource_id
WHERE stored.resource_id IS NULL
   OR ROW(stored.resource_kind, stored.source_key, stored.canonical_uri, stored.is_private)
      IS DISTINCT FROM
      ROW(expected.resource_kind, expected.source_key, expected.canonical_uri, expected.is_private)
LIMIT 1`;

const INSERT_GIT_RESOURCE_SQL = `INSERT INTO struinfo.git_resource
(workspace_id, resource_id, canonical_repository_uri, repository_relative_path)
SELECT $1::uuid, candidate.resource_id, candidate.repository_uri,
  candidate.relative_path
FROM unnest($2::uuid[], $3::text[], $4::text[])
  AS candidate(resource_id, repository_uri, relative_path)
ON CONFLICT DO NOTHING`;
const VERIFY_GIT_RESOURCE_SQL = `WITH expected AS (
  SELECT $1::uuid AS workspace_id, candidate.*
  FROM unnest($2::uuid[], $3::text[], $4::text[])
    AS candidate(resource_id, repository_uri, relative_path)
)
SELECT 1 AS mismatch
FROM expected
LEFT JOIN struinfo.git_resource AS stored
  ON stored.workspace_id = expected.workspace_id
 AND stored.resource_id = expected.resource_id
WHERE stored.resource_id IS NULL
   OR ROW(stored.canonical_repository_uri, stored.repository_relative_path)
      IS DISTINCT FROM ROW(expected.repository_uri, expected.relative_path)
LIMIT 1`;

const INSERT_SNAPSHOT_SQL = `INSERT INTO struinfo.snapshot
(workspace_id, snapshot_id, resource_id, raw_sha256, raw_blob_id,
 raw_blob_byte_length, canonical_content_sha256, canonicalization_version,
 media_type, published_at, published_timezone, published_precision,
 published_source_text, published_inferred, captured_at)
SELECT $1::uuid, candidate.snapshot_id, candidate.resource_id,
  candidate.raw_sha256, candidate.raw_blob_id, candidate.raw_blob_byte_length,
  candidate.canonical_sha256, candidate.canonicalization_version,
  candidate.media_type, candidate.published_at, candidate.published_timezone,
  candidate.published_precision, candidate.published_source_text,
  candidate.published_inferred, candidate.captured_at
FROM unnest(
  $2::uuid[], $3::uuid[], $4::text[], $5::uuid[], $6::bigint[],
  $7::text[], $8::text[], $9::text[], $10::timestamptz[], $11::text[],
  $12::text[], $13::text[], $14::boolean[], $15::timestamptz[]
) AS candidate(
  snapshot_id, resource_id, raw_sha256, raw_blob_id, raw_blob_byte_length,
  canonical_sha256, canonicalization_version, media_type, published_at,
  published_timezone, published_precision, published_source_text,
  published_inferred, captured_at
)
ON CONFLICT DO NOTHING`;
const VERIFY_SNAPSHOT_SQL = `WITH expected AS (
  SELECT $1::uuid AS workspace_id, candidate.*
  FROM unnest(
    $2::uuid[], $3::uuid[], $4::text[], $5::uuid[], $6::bigint[],
    $7::text[], $8::text[], $9::text[], $10::timestamptz[], $11::text[],
    $12::text[], $13::text[], $14::boolean[], $15::timestamptz[]
  ) AS candidate(
    snapshot_id, resource_id, raw_sha256, raw_blob_id, raw_blob_byte_length,
    canonical_sha256, canonicalization_version, media_type, published_at,
    published_timezone, published_precision, published_source_text,
    published_inferred, captured_at
  )
)
SELECT 1 AS mismatch
FROM expected
LEFT JOIN struinfo.snapshot AS stored
  ON stored.workspace_id = expected.workspace_id
 AND stored.snapshot_id = expected.snapshot_id
WHERE stored.snapshot_id IS NULL
   OR ROW(
        stored.resource_id, stored.raw_sha256, stored.raw_blob_id,
        stored.raw_blob_byte_length, stored.canonical_content_sha256,
        stored.canonicalization_version, stored.media_type, stored.published_at,
        stored.published_timezone, stored.published_precision,
        stored.published_source_text, stored.published_inferred,
        stored.captured_at
      ) IS DISTINCT FROM ROW(
        expected.resource_id, expected.raw_sha256, expected.raw_blob_id,
        expected.raw_blob_byte_length, expected.canonical_sha256,
        expected.canonicalization_version, expected.media_type,
        expected.published_at, expected.published_timezone,
        expected.published_precision, expected.published_source_text,
        expected.published_inferred, expected.captured_at
      )
LIMIT 1`;

const INSERT_GIT_OBSERVATIONS_SQL = `INSERT INTO struinfo.git_snapshot_observation
(workspace_id, observation_id, resource_id, snapshot_id, repository_ref,
 commit_hash_algorithm, commit_hash, git_blob_hash_algorithm, git_blob_hash,
 observed_at)
SELECT $1::uuid, candidate.observation_id, candidate.resource_id,
  candidate.snapshot_id, candidate.repository_ref,
  candidate.commit_algorithm, candidate.commit_hash,
  candidate.blob_algorithm, candidate.blob_hash, candidate.observed_at
FROM unnest(
  $2::uuid[], $3::uuid[], $4::uuid[], $5::text[], $6::text[],
  $7::text[], $8::text[], $9::text[], $10::timestamptz[]
) AS candidate(
  observation_id, resource_id, snapshot_id, repository_ref,
  commit_algorithm, commit_hash, blob_algorithm, blob_hash, observed_at
)
ON CONFLICT DO NOTHING`;
const VERIFY_GIT_OBSERVATIONS_SQL = `WITH expected AS (
  SELECT $1::uuid AS workspace_id, candidate.*
  FROM unnest(
    $2::uuid[], $3::uuid[], $4::uuid[], $5::text[], $6::text[],
    $7::text[], $8::text[], $9::text[], $10::timestamptz[]
  ) AS candidate(
    observation_id, resource_id, snapshot_id, repository_ref,
    commit_algorithm, commit_hash, blob_algorithm, blob_hash, observed_at
  )
)
SELECT 1 AS mismatch
FROM expected
LEFT JOIN struinfo.git_snapshot_observation AS stored
  ON stored.workspace_id = expected.workspace_id
 AND stored.observation_id = expected.observation_id
WHERE stored.observation_id IS NULL
   OR ROW(
        stored.resource_id, stored.snapshot_id, stored.repository_ref,
        stored.commit_hash_algorithm, stored.commit_hash,
        stored.git_blob_hash_algorithm, stored.git_blob_hash, stored.observed_at
      ) IS DISTINCT FROM ROW(
        expected.resource_id, expected.snapshot_id, expected.repository_ref,
        expected.commit_algorithm, expected.commit_hash,
        expected.blob_algorithm, expected.blob_hash, expected.observed_at
      )
LIMIT 1`;

const INSERT_STRUCTURE_SQL = `INSERT INTO struinfo.document_structure
(workspace_id, structure_id, resource_id, snapshot_id, parser_name,
 parser_version, text_normalization_version, text_blob_id, text_blob_sha256,
 text_blob_byte_length, structure_sha256)
SELECT $1::uuid, candidate.structure_id, candidate.resource_id,
  candidate.snapshot_id, candidate.parser_name, candidate.parser_version,
  candidate.normalization_version, candidate.text_blob_id,
  candidate.text_blob_sha256, candidate.text_blob_byte_length,
  candidate.structure_sha256
FROM unnest(
  $2::uuid[], $3::uuid[], $4::uuid[], $5::text[], $6::text[],
  $7::text[], $8::uuid[], $9::text[], $10::bigint[], $11::text[]
) AS candidate(
  structure_id, resource_id, snapshot_id, parser_name, parser_version,
  normalization_version, text_blob_id, text_blob_sha256,
  text_blob_byte_length, structure_sha256
)
ON CONFLICT DO NOTHING`;
const VERIFY_STRUCTURE_SQL = `WITH expected AS (
  SELECT $1::uuid AS workspace_id, candidate.*
  FROM unnest(
    $2::uuid[], $3::uuid[], $4::uuid[], $5::text[], $6::text[],
    $7::text[], $8::uuid[], $9::text[], $10::bigint[], $11::text[]
  ) AS candidate(
    structure_id, resource_id, snapshot_id, parser_name, parser_version,
    normalization_version, text_blob_id, text_blob_sha256,
    text_blob_byte_length, structure_sha256
  )
)
SELECT 1 AS mismatch
FROM expected
LEFT JOIN struinfo.document_structure AS stored
  ON stored.workspace_id = expected.workspace_id
 AND stored.structure_id = expected.structure_id
WHERE stored.structure_id IS NULL
   OR ROW(
        stored.resource_id, stored.snapshot_id, stored.parser_name,
        stored.parser_version, stored.text_normalization_version,
        stored.text_blob_id, stored.text_blob_sha256,
        stored.text_blob_byte_length, stored.structure_sha256
      ) IS DISTINCT FROM ROW(
        expected.resource_id, expected.snapshot_id, expected.parser_name,
        expected.parser_version, expected.normalization_version,
        expected.text_blob_id, expected.text_blob_sha256,
        expected.text_blob_byte_length, expected.structure_sha256
      )
LIMIT 1`;

const INSERT_NODES_SQL = `INSERT INTO struinfo.document_node
(workspace_id, structure_id, node_id, resource_id, snapshot_id,
 parent_node_id, node_kind, sibling_ordinal, code_point_start,
 code_point_end, line_start, line_end)
SELECT $1::uuid, candidate.structure_id, candidate.node_id,
  candidate.resource_id, candidate.snapshot_id, candidate.parent_node_id,
  candidate.node_kind, candidate.sibling_ordinal,
  candidate.code_point_start, candidate.code_point_end,
  candidate.line_start, candidate.line_end
FROM unnest(
  $2::uuid[], $3::uuid[], $4::uuid[], $5::uuid[], $6::uuid[],
  $7::text[], $8::integer[], $9::bigint[], $10::bigint[],
  $11::integer[], $12::integer[]
) AS candidate(
  structure_id, node_id, resource_id, snapshot_id, parent_node_id,
  node_kind, sibling_ordinal, code_point_start, code_point_end,
  line_start, line_end
)
ON CONFLICT DO NOTHING`;
const VERIFY_NODES_SQL = `WITH expected AS (
  SELECT $1::uuid AS workspace_id, candidate.*
  FROM unnest(
    $2::uuid[], $3::uuid[], $4::uuid[], $5::uuid[], $6::uuid[],
    $7::text[], $8::integer[], $9::bigint[], $10::bigint[],
    $11::integer[], $12::integer[]
  ) AS candidate(
    structure_id, node_id, resource_id, snapshot_id, parent_node_id,
    node_kind, sibling_ordinal, code_point_start, code_point_end,
    line_start, line_end
  )
)
SELECT 1 AS mismatch
FROM expected
LEFT JOIN struinfo.document_node AS stored
  ON stored.workspace_id = expected.workspace_id
 AND stored.structure_id = expected.structure_id
 AND stored.node_id = expected.node_id
WHERE stored.node_id IS NULL
   OR ROW(
        stored.resource_id, stored.snapshot_id, stored.parent_node_id,
        stored.node_kind, stored.sibling_ordinal, stored.code_point_start,
        stored.code_point_end, stored.line_start, stored.line_end
      ) IS DISTINCT FROM ROW(
        expected.resource_id, expected.snapshot_id, expected.parent_node_id,
        expected.node_kind, expected.sibling_ordinal,
        expected.code_point_start, expected.code_point_end,
        expected.line_start, expected.line_end
      )
LIMIT 1`;

const INSERT_FRAGMENTS_SQL = `INSERT INTO struinfo.fragment
(workspace_id, fragment_id, resource_id, snapshot_id, structure_id, node_id,
 text_blob_id, text_blob_sha256, text_blob_byte_length, locator_kind,
 locator_version, code_point_start, code_point_end, line_start, line_end,
 selected_text_sha256)
SELECT $1::uuid, candidate.fragment_id, candidate.resource_id,
  candidate.snapshot_id, candidate.structure_id, candidate.node_id,
  candidate.text_blob_id, candidate.text_blob_sha256,
  candidate.text_blob_byte_length, candidate.locator_kind,
  candidate.locator_version, candidate.code_point_start,
  candidate.code_point_end, candidate.line_start, candidate.line_end,
  candidate.selected_text_sha256
FROM unnest(
  $2::uuid[], $3::uuid[], $4::uuid[], $5::uuid[], $6::uuid[],
  $7::uuid[], $8::text[], $9::bigint[], $10::text[], $11::integer[],
  $12::bigint[], $13::bigint[], $14::integer[], $15::integer[], $16::text[]
) AS candidate(
  fragment_id, resource_id, snapshot_id, structure_id, node_id,
  text_blob_id, text_blob_sha256, text_blob_byte_length, locator_kind,
  locator_version, code_point_start, code_point_end, line_start, line_end,
  selected_text_sha256
)
ON CONFLICT DO NOTHING`;
const VERIFY_FRAGMENTS_SQL = `WITH expected AS (
  SELECT $1::uuid AS workspace_id, candidate.*
  FROM unnest(
    $2::uuid[], $3::uuid[], $4::uuid[], $5::uuid[], $6::uuid[],
    $7::uuid[], $8::text[], $9::bigint[], $10::text[], $11::integer[],
    $12::bigint[], $13::bigint[], $14::integer[], $15::integer[], $16::text[]
  ) AS candidate(
    fragment_id, resource_id, snapshot_id, structure_id, node_id,
    text_blob_id, text_blob_sha256, text_blob_byte_length, locator_kind,
    locator_version, code_point_start, code_point_end, line_start, line_end,
    selected_text_sha256
  )
)
SELECT 1 AS mismatch
FROM expected
LEFT JOIN struinfo.fragment AS stored
  ON stored.workspace_id = expected.workspace_id
 AND stored.fragment_id = expected.fragment_id
WHERE stored.fragment_id IS NULL
   OR ROW(
        stored.resource_id, stored.snapshot_id, stored.structure_id,
        stored.node_id, stored.text_blob_id, stored.text_blob_sha256,
        stored.text_blob_byte_length, stored.locator_kind,
        stored.locator_version, stored.code_point_start,
        stored.code_point_end, stored.line_start, stored.line_end,
        stored.selected_text_sha256
      ) IS DISTINCT FROM ROW(
        expected.resource_id, expected.snapshot_id, expected.structure_id,
        expected.node_id, expected.text_blob_id, expected.text_blob_sha256,
        expected.text_blob_byte_length, expected.locator_kind,
        expected.locator_version, expected.code_point_start,
        expected.code_point_end, expected.line_start, expected.line_end,
        expected.selected_text_sha256
      )
LIMIT 1`;

const INSERT_MEDIA_ASSETS_SQL = `INSERT INTO struinfo.media_asset
(workspace_id, media_asset_id, storage_mode, blob_id, blob_sha256,
 blob_byte_length, original_uri, media_type, pixel_width, pixel_height)
SELECT $1::uuid, candidate.media_asset_id, candidate.storage_mode,
  candidate.blob_id, candidate.blob_sha256, candidate.blob_byte_length,
  candidate.original_uri, candidate.media_type, candidate.pixel_width,
  candidate.pixel_height
FROM unnest(
  $2::uuid[], $3::text[], $4::uuid[], $5::text[], $6::bigint[],
  $7::text[], $8::text[], $9::integer[], $10::integer[]
) AS candidate(
  media_asset_id, storage_mode, blob_id, blob_sha256, blob_byte_length,
  original_uri, media_type, pixel_width, pixel_height
)
ON CONFLICT DO NOTHING`;
const VERIFY_MEDIA_ASSETS_SQL = `WITH expected AS (
  SELECT $1::uuid AS workspace_id, candidate.*
  FROM unnest(
    $2::uuid[], $3::text[], $4::uuid[], $5::text[], $6::bigint[],
    $7::text[], $8::text[], $9::integer[], $10::integer[]
  ) AS candidate(
    media_asset_id, storage_mode, blob_id, blob_sha256, blob_byte_length,
    original_uri, media_type, pixel_width, pixel_height
  )
)
SELECT 1 AS mismatch
FROM expected
LEFT JOIN struinfo.media_asset AS stored
  ON stored.workspace_id = expected.workspace_id
 AND stored.media_asset_id = expected.media_asset_id
WHERE stored.media_asset_id IS NULL
   OR ROW(
        stored.storage_mode, stored.blob_id, stored.blob_sha256,
        stored.blob_byte_length, stored.original_uri, stored.media_type,
        stored.pixel_width, stored.pixel_height
      ) IS DISTINCT FROM ROW(
        expected.storage_mode, expected.blob_id, expected.blob_sha256,
        expected.blob_byte_length, expected.original_uri, expected.media_type,
        expected.pixel_width, expected.pixel_height
      )
LIMIT 1`;

const INSERT_MEDIA_USAGES_SQL = `INSERT INTO struinfo.media_usage
(workspace_id, media_usage_id, media_asset_id, resource_id, snapshot_id,
 structure_id, node_id, ordinal, purpose, purpose_origin, confidence,
 superseded_usage_id)
SELECT $1::uuid, candidate.media_usage_id, candidate.media_asset_id,
  candidate.resource_id, candidate.snapshot_id, candidate.structure_id,
  candidate.node_id, candidate.ordinal, candidate.purpose,
  candidate.purpose_origin, candidate.confidence,
  candidate.superseded_usage_id
FROM unnest(
  $2::uuid[], $3::uuid[], $4::uuid[], $5::uuid[], $6::uuid[],
  $7::uuid[], $8::integer[], $9::text[], $10::text[],
  $11::double precision[], $12::uuid[]
) AS candidate(
  media_usage_id, media_asset_id, resource_id, snapshot_id, structure_id,
  node_id, ordinal, purpose, purpose_origin, confidence, superseded_usage_id
)
ON CONFLICT DO NOTHING`;
const VERIFY_MEDIA_USAGES_SQL = `WITH expected AS (
  SELECT $1::uuid AS workspace_id, candidate.*
  FROM unnest(
    $2::uuid[], $3::uuid[], $4::uuid[], $5::uuid[], $6::uuid[],
    $7::uuid[], $8::integer[], $9::text[], $10::text[],
    $11::double precision[], $12::uuid[]
  ) AS candidate(
    media_usage_id, media_asset_id, resource_id, snapshot_id, structure_id,
    node_id, ordinal, purpose, purpose_origin, confidence, superseded_usage_id
  )
)
SELECT 1 AS mismatch
FROM expected
LEFT JOIN struinfo.media_usage AS stored
  ON stored.workspace_id = expected.workspace_id
 AND stored.media_usage_id = expected.media_usage_id
WHERE stored.media_usage_id IS NULL
   OR ROW(
        stored.media_asset_id, stored.resource_id, stored.snapshot_id,
        stored.structure_id, stored.node_id, stored.ordinal, stored.purpose,
        stored.purpose_origin, stored.confidence, stored.superseded_usage_id
      ) IS DISTINCT FROM ROW(
        expected.media_asset_id, expected.resource_id, expected.snapshot_id,
        expected.structure_id, expected.node_id, expected.ordinal,
        expected.purpose, expected.purpose_origin, expected.confidence,
        expected.superseded_usage_id
      )
LIMIT 1`;

type Row = Readonly<Record<string, unknown>>;

class EvidenceContentConflict extends Error {}

export class PostgresEvidenceRepository implements EvidenceRepositoryPort {
  readonly #pool: PostgresPoolBoundary;

  public constructor(pool: PostgresPoolBoundary) {
    this.#pool = pool;
  }

  public async saveCapture(
    request: Readonly<EvidenceCaptureRepositoryRequest>,
  ): Promise<EvidenceCaptureRepositoryResult> {
    let client: PostgresClientBoundary;
    try {
      client = await this.#pool.connect();
    } catch {
      throw new EvidenceRepositoryError('unavailable');
    }

    let transactionActive = false;
    let result: EvidenceCaptureRepositoryResult | undefined;
    let failed = false;
    try {
      await client.query(BEGIN_READ_COMMITTED_SQL);
      transactionActive = true;
      result = await saveCaptureInTransaction(client, request);
      await client.query(COMMIT_TRANSACTION_SQL);
      transactionActive = false;
    } catch (error) {
      if (transactionActive) {
        try {
          await client.query(ROLLBACK_TRANSACTION_SQL);
          transactionActive = false;
        } catch {
          failed = true;
        }
      }
      if (error instanceof EvidenceContentConflict && !failed) {
        result = Object.freeze({status: 'conflict' as const});
      } else {
        failed = true;
      }
    }

    try {
      client.release();
    } catch {
      failed = true;
    }
    if (failed || result === undefined) {
      throw new EvidenceRepositoryError('transaction_failed');
    }
    return result;
  }
}

async function saveCaptureInTransaction(
  client: PostgresClientBoundary,
  request: Readonly<EvidenceCaptureRepositoryRequest>,
): Promise<EvidenceCaptureRepositoryResult> {
  const {capture} = request;
  await client.query(ACQUIRE_EVIDENCE_WORKSPACE_LOCK_SQL, [
    deriveWorkspaceWriteLockKey(capture.workspaceId),
  ]);
  await client.query(INSERT_EVIDENCE_WORKSPACE_SQL, [capture.workspaceId]);
  const workspace = await client.query<Row>(READ_EVIDENCE_WORKSPACE_SQL, [
    capture.workspaceId,
  ]);
  if (
    workspace.rows.length !== 1 ||
    workspace.rows[0]?.workspace_id !== capture.workspaceId
  ) {
    throw new Error('Evidence workspace could not be resolved.');
  }

  const command = await client.query<Row>(READ_EVIDENCE_CAPTURE_COMMAND_SQL, [
    capture.workspaceId,
    capture.commandIdempotencyKey,
  ]);
  if (command.rows.length > 1) {
    throw new Error('Evidence command identity is not unique.');
  }
  if (command.rows[0] !== undefined) {
    if (command.rows[0].request_sha256 !== request.requestSha256) {
      throw new EvidenceContentConflict();
    }
    return Object.freeze({status: 'existing' as const});
  }

  const createdRows = await persistCaptureGraph(client, capture);
  const insertedCommand = await client.query(
    INSERT_EVIDENCE_CAPTURE_COMMAND_SQL,
    [capture.workspaceId, capture.commandIdempotencyKey, request.requestSha256],
  );
  if (insertedCommand.rowCount !== 1) {
    throw new Error('Evidence command was not inserted.');
  }
  return Object.freeze({
    status: createdRows === 0 ? ('existing' as const) : ('created' as const),
  });
}

async function persistCaptureGraph(
  client: PostgresClientBoundary,
  capture: ValidatedCaptureEvidence,
): Promise<number> {
  let created = 0;
  created += await persistBlobs(client, capture);
  created += await persistResource(client, capture);
  created += await persistGitResource(client, capture);
  created += await persistSnapshot(client, capture);
  created += await persistGitObservations(client, capture);
  created += await persistStructure(client, capture);
  created += await persistNodes(client, capture);
  created += await persistFragments(client, capture);
  created += await persistMediaAssets(client, capture);
  created += await persistMediaUsages(client, capture);
  return created;
}

function persistBlobs(
  client: PostgresClientBoundary,
  capture: ValidatedCaptureEvidence,
): Promise<number> {
  const rows = capture.blobs;
  return persistBatch(client, INSERT_BLOBS_SQL, VERIFY_BLOBS_SQL, rows.length, [
    capture.workspaceId,
    rows.map((row) => row.blobId),
    rows.map((row) => row.digestAlgorithm),
    rows.map((row) => row.digest),
    rows.map((row) => row.byteLength),
    rows.map((row) => row.mediaType ?? null),
  ]);
}

function persistResource(
  client: PostgresClientBoundary,
  capture: ValidatedCaptureEvidence,
): Promise<number> {
  const row = capture.resource;
  return persistBatch(client, INSERT_RESOURCE_SQL, VERIFY_RESOURCE_SQL, 1, [
    capture.workspaceId,
    [row.resourceId],
    [row.resourceKind],
    [row.sourceKey],
    [row.canonicalUri ?? null],
    [row.isPrivate === true],
  ]);
}

function persistGitResource(
  client: PostgresClientBoundary,
  capture: ValidatedCaptureEvidence,
): Promise<number> {
  const row = capture.gitResource;
  if (row === undefined) return Promise.resolve(0);
  return persistBatch(
    client,
    INSERT_GIT_RESOURCE_SQL,
    VERIFY_GIT_RESOURCE_SQL,
    1,
    [
      capture.workspaceId,
      [row.resourceId],
      [row.canonicalRepositoryUri],
      [row.repositoryRelativePath],
    ],
  );
}

function persistSnapshot(
  client: PostgresClientBoundary,
  capture: ValidatedCaptureEvidence,
): Promise<number> {
  const row = capture.snapshot;
  const publication = row.publication;
  return persistBatch(client, INSERT_SNAPSHOT_SQL, VERIFY_SNAPSHOT_SQL, 1, [
    capture.workspaceId,
    [row.snapshotId],
    [row.resourceId],
    [row.rawSha256],
    [row.rawBlob?.blobId ?? null],
    [row.rawBlob?.byteLength ?? null],
    [row.canonicalContentSha256],
    [row.canonicalizationVersion],
    [row.mediaType ?? null],
    [publication?.instant ?? null],
    [publication?.sourceTimezone ?? null],
    [publication?.precision ?? null],
    [publication?.sourceText ?? null],
    [publication?.inferred ?? false],
    [row.capturedAt],
  ]);
}

function persistGitObservations(
  client: PostgresClientBoundary,
  capture: ValidatedCaptureEvidence,
): Promise<number> {
  const rows = capture.gitObservations;
  if (rows.length === 0) return Promise.resolve(0);
  return persistBatch(
    client,
    INSERT_GIT_OBSERVATIONS_SQL,
    VERIFY_GIT_OBSERVATIONS_SQL,
    rows.length,
    [
      capture.workspaceId,
      rows.map((row) => row.observationId),
      rows.map((row) => row.resourceId),
      rows.map((row) => row.snapshotId),
      rows.map((row) => row.repositoryRef),
      rows.map((row) => row.commit.algorithm),
      rows.map((row) => row.commit.digest),
      rows.map((row) => row.blobObject?.algorithm ?? null),
      rows.map((row) => row.blobObject?.digest ?? null),
      rows.map((row) => row.observedAt),
    ],
  );
}

function persistStructure(
  client: PostgresClientBoundary,
  capture: ValidatedCaptureEvidence,
): Promise<number> {
  const row = capture.structure;
  return persistBatch(client, INSERT_STRUCTURE_SQL, VERIFY_STRUCTURE_SQL, 1, [
    capture.workspaceId,
    [row.structureId],
    [row.resourceId],
    [row.snapshotId],
    [row.parserName],
    [row.parserVersion],
    [row.textNormalizationVersion],
    [row.textBlob.blobId],
    [row.textBlob.digest],
    [row.textBlob.byteLength],
    [row.structureSha256],
  ]);
}

function persistNodes(
  client: PostgresClientBoundary,
  capture: ValidatedCaptureEvidence,
): Promise<number> {
  const rows = capture.structure.nodes;
  return persistBatch(client, INSERT_NODES_SQL, VERIFY_NODES_SQL, rows.length, [
    capture.workspaceId,
    rows.map((row) => row.structureId),
    rows.map((row) => row.nodeId),
    rows.map((row) => row.resourceId),
    rows.map((row) => row.snapshotId),
    rows.map((row) => row.parentNodeId ?? null),
    rows.map((row) => row.kind),
    rows.map((row) => row.siblingOrdinal),
    rows.map((row) => row.codePointRange.start),
    rows.map((row) => row.codePointRange.end),
    rows.map((row) => row.lineRange?.start ?? null),
    rows.map((row) => row.lineRange?.end ?? null),
  ]);
}

function persistFragments(
  client: PostgresClientBoundary,
  capture: ValidatedCaptureEvidence,
): Promise<number> {
  const rows = capture.structure.fragments;
  return persistBatch(
    client,
    INSERT_FRAGMENTS_SQL,
    VERIFY_FRAGMENTS_SQL,
    rows.length,
    [
      capture.workspaceId,
      rows.map((row) => row.fragmentId),
      rows.map((row) => row.resourceId),
      rows.map((row) => row.snapshotId),
      rows.map((row) => row.structureId),
      rows.map((row) => row.nodeId),
      rows.map((row) => row.textBlob.blobId),
      rows.map((row) => row.textBlob.digest),
      rows.map((row) => row.textBlob.byteLength),
      rows.map((row) => row.locatorKind),
      rows.map((row) => row.locatorVersion),
      rows.map((row) => row.codePointRange.start),
      rows.map((row) => row.codePointRange.end),
      rows.map((row) => row.lineRange?.start ?? null),
      rows.map((row) => row.lineRange?.end ?? null),
      rows.map((row) => row.selectedTextSha256),
    ],
  );
}

function persistMediaAssets(
  client: PostgresClientBoundary,
  capture: ValidatedCaptureEvidence,
): Promise<number> {
  const rows = capture.mediaAssets;
  if (rows.length === 0) return Promise.resolve(0);
  return persistBatch(
    client,
    INSERT_MEDIA_ASSETS_SQL,
    VERIFY_MEDIA_ASSETS_SQL,
    rows.length,
    [
      capture.workspaceId,
      rows.map((row) => row.mediaAssetId),
      rows.map((row) => row.storageMode),
      rows.map((row) => storedBlob(row)?.blobId ?? null),
      rows.map((row) => storedBlob(row)?.digest ?? null),
      rows.map((row) => storedBlob(row)?.byteLength ?? null),
      rows.map((row) => row.originalUri ?? null),
      rows.map((row) => row.mediaType ?? null),
      rows.map((row) => row.dimensions?.width ?? null),
      rows.map((row) => row.dimensions?.height ?? null),
    ],
  );
}

function persistMediaUsages(
  client: PostgresClientBoundary,
  capture: ValidatedCaptureEvidence,
): Promise<number> {
  const rows = capture.mediaUsages;
  if (rows.length === 0) return Promise.resolve(0);
  return persistBatch(
    client,
    INSERT_MEDIA_USAGES_SQL,
    VERIFY_MEDIA_USAGES_SQL,
    rows.length,
    [
      capture.workspaceId,
      rows.map((row) => row.mediaUsageId),
      rows.map((row) => row.mediaAssetId),
      rows.map((row) => row.resourceId),
      rows.map((row) => row.snapshotId),
      rows.map((row) => row.structureId),
      rows.map((row) => row.nodeId),
      rows.map((row) => row.ordinal),
      rows.map((row) => row.purpose),
      rows.map((row) => row.purposeOrigin),
      rows.map((row) => row.confidence ?? null),
      rows.map((row) => row.supersededUsage?.mediaUsageId ?? null),
    ],
  );
}

async function persistBatch(
  client: PostgresClientBoundary,
  insertSql: string,
  verifySql: string,
  expectedCount: number,
  parameters: readonly unknown[],
): Promise<number> {
  if (expectedCount === 0) return 0;
  const inserted = await client.query(insertSql, parameters);
  if (
    inserted.rowCount === null ||
    inserted.rowCount < 0 ||
    inserted.rowCount > expectedCount
  ) {
    throw new Error('Evidence insert count is invalid.');
  }
  const verification = await client.query<Row>(verifySql, parameters);
  if (verification.rows.length !== 0) {
    throw new EvidenceContentConflict();
  }
  return inserted.rowCount;
}

function storedBlob(
  asset: MediaAssetInput,
): Readonly<{blobId: string; digest: string; byteLength: number}> | undefined {
  return asset.storageMode === 'stored_blob' ? asset.blob : undefined;
}
