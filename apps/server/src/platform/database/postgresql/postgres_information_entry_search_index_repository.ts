import {
  INFORMATION_ENTRY_EMBEDDING_BATCH_MAXIMUM,
  INFORMATION_ENTRY_TERM_MAXIMUM_POSTINGS_PER_ENTRY,
  type InformationEntrySearchIndexRefreshRequest,
  type InformationEntrySearchIndexRefreshBatch,
  type InformationEntrySearchIndexRefreshCommit,
  INFORMATION_ENTRY_TERM_TOKENIZER_VERSION,
  type InformationEntryLexicalCandidateRequest,
  type InformationEntrySearchIndexRepositoryPort,
  type InformationEntrySearchIndexMetrics,
  type InformationEntrySearchIndexSnapshot,
  type InformationEntrySearchProjection,
  type InformationEntryTermPosting,
} from '../../../modules/entries/index.js';

import type {
  PostgresClientBoundary,
  PostgresPoolBoundary,
} from './postgres_pool.js';
import {runPostgresTransaction} from './postgres_transaction.js';
import {
  canonicalUuid,
  integer,
  optionalText,
  PostgresAdapterError,
  sha256,
  text,
} from './postgres_values.js';
import {acquireWorkspaceWriteLock} from './workspace_write_lock.js';

type Row = Readonly<Record<string, unknown>>;

export const READ_INFORMATION_ENTRY_SEARCH_PROJECTIONS_SQL = [
  'SELECT entry_id::text, entry_revision, entry_revision_id::text,',
  '  projection_sha256, tokenizer_version, embedding_provider,',
  '  embedding_model, embedding_dimensions, embedding',
  'FROM struinfo.information_entry_search_projection',
  'WHERE workspace_id = $1',
  'ORDER BY entry_id',
].join('\n');

export const READ_INFORMATION_ENTRY_TERM_POSTINGS_SQL = [
  'SELECT entry_id::text, field, term, occurrences',
  'FROM struinfo.information_entry_term_posting',
  'WHERE workspace_id = $1',
  'ORDER BY entry_id, field, term',
].join('\n');

export const READ_INFORMATION_ENTRY_SEARCH_INDEX_READINESS_SQL = [
  'SELECT',
  '  (SELECT count(*)::integer',
  '   FROM struinfo.information_entry AS entry',
  '   WHERE entry.workspace_id = $1 AND entry.is_current_structure',
  '     AND NOT entry.is_private) AS public_entry_count,',
  '  (SELECT count(*)::integer',
  '   FROM struinfo.information_entry_search_projection AS projection',
  '   JOIN struinfo.information_entry AS entry',
  '     ON entry.workspace_id = projection.workspace_id',
  '    AND entry.entry_id = projection.entry_id',
  '    AND entry.current_revision = projection.entry_revision',
  '    AND entry.current_revision_id = projection.entry_revision_id',
  '   WHERE projection.workspace_id = $1 AND entry.is_current_structure',
  '     AND NOT entry.is_private',
  '     AND projection.tokenizer_version = $2',
  '     AND (SELECT count(*)',
  '          FROM struinfo.information_entry_term_posting AS posting',
  '          WHERE posting.workspace_id = projection.workspace_id',
  '            AND posting.entry_id = projection.entry_id) < $3::integer',
  '  ) AS current_projection_count',
].join('\n');

export const READ_INFORMATION_ENTRY_SEARCH_INDEX_METRICS_SQL = [
  'WITH projection_status AS (',
  '  SELECT projection.embedding_provider, projection.embedding_model,',
  '    projection.embedding, entry.entry_id IS NOT NULL AS is_current',
  '  FROM struinfo.information_entry_search_projection AS projection',
  '  LEFT JOIN struinfo.information_entry AS entry',
  '    ON entry.workspace_id = projection.workspace_id',
  '   AND entry.entry_id = projection.entry_id',
  '   AND entry.current_revision = projection.entry_revision',
  '   AND entry.current_revision_id = projection.entry_revision_id',
  '   AND entry.is_current_structure AND NOT entry.is_private',
  "   AND projection.tokenizer_version = '" +
    INFORMATION_ENTRY_TERM_TOKENIZER_VERSION +
    "'",
  '  WHERE projection.workspace_id = $1',
  ')',
  'SELECT',
  '  (SELECT count(*)::integer',
  '   FROM struinfo.information_entry AS entry',
  '   WHERE entry.workspace_id = $1 AND entry.is_current_structure',
  '     AND NOT entry.is_private) AS public_entry_count,',
  '  count(*) FILTER (WHERE is_current)::integer AS current_projection_count,',
  '  count(*) FILTER (WHERE is_current AND $2::text IS NOT NULL',
  '    AND embedding_provider = $2::text AND embedding_model = $3::text',
  '    AND embedding IS NOT NULL)::integer AS embedded_projection_count,',
  '  count(*) FILTER (WHERE NOT is_current)::integer AS stale_projection_count,',
  '  (SELECT count(*)::integer',
  '   FROM struinfo.information_entry_term_posting AS posting',
  '   WHERE posting.workspace_id = $1) AS posting_count',
  'FROM projection_status',
].join('\n');

export const FIND_INFORMATION_ENTRY_LEXICAL_CANDIDATES_SQL = [
  'SELECT DISTINCT posting.entry_id::text',
  'FROM struinfo.information_entry_term_posting AS posting',
  'JOIN struinfo.information_entry_search_projection AS projection',
  '  ON projection.workspace_id = posting.workspace_id',
  ' AND projection.entry_id = posting.entry_id',
  'JOIN struinfo.information_entry AS entry',
  '  ON entry.workspace_id = projection.workspace_id',
  ' AND entry.entry_id = projection.entry_id',
  ' AND entry.current_revision = projection.entry_revision',
  ' AND entry.current_revision_id = projection.entry_revision_id',
  'WHERE posting.workspace_id = $1 AND entry.is_current_structure',
  '  AND NOT entry.is_private',
  '  AND posting.field = ANY($2::text[])',
  '  AND EXISTS (',
  '    SELECT 1 FROM unnest($3::text[]) AS candidate(term)',
  '    WHERE strpos(posting.term, candidate.term) > 0',
  '  )',
  'ORDER BY posting.entry_id::text',
].join('\n');

const DELETE_POSTINGS_SQL =
  'DELETE FROM struinfo.information_entry_term_posting WHERE workspace_id = $1';
const DELETE_PROJECTIONS_SQL =
  'DELETE FROM struinfo.information_entry_search_projection WHERE workspace_id = $1';
const INSERT_PROJECTION_SQL = [
  'INSERT INTO struinfo.information_entry_search_projection (',
  '  workspace_id, entry_id, entry_revision, entry_revision_id,',
  '  projection_sha256, tokenizer_version, embedding_provider,',
  '  embedding_model, embedding_dimensions, embedding',
  ') VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)',
].join('\n');
const INSERT_POSTING_SQL = [
  'INSERT INTO struinfo.information_entry_term_posting (',
  '  workspace_id, entry_id, field, term, occurrences',
  ') VALUES ($1, $2, $3, $4, $5)',
].join('\n');

export const READ_INFORMATION_ENTRY_INDEX_REFRESH_BATCH_SQL = [
  'WITH pending AS (',
  '  SELECT entry.entry_id, false AS obsolete',
  '  FROM struinfo.information_entry AS entry',
  '  LEFT JOIN struinfo.information_entry_search_projection AS projection',
  '    ON projection.workspace_id = entry.workspace_id AND projection.entry_id = entry.entry_id',
  '  WHERE entry.workspace_id = $1 AND entry.is_current_structure AND NOT entry.is_private',
  '    AND (projection.entry_id IS NULL',
  '      OR projection.entry_revision <> entry.current_revision',
  '      OR projection.entry_revision_id <> entry.current_revision_id',
  '      OR projection.tokenizer_version <> $2',
  '      OR ($3::text IS NOT NULL AND (',
  '        projection.embedding_provider IS DISTINCT FROM $3::text',
  '        OR projection.embedding_model IS DISTINCT FROM $4::text',
  '        OR projection.embedding IS NULL OR projection.embedding_dimensions IS NULL',
  '        OR projection.embedding_dimensions NOT BETWEEN 1 AND 16384',
  '      )))',
  '  UNION ALL',
  '  SELECT projection.entry_id, true AS obsolete',
  '  FROM struinfo.information_entry_search_projection AS projection',
  '  JOIN struinfo.information_entry AS entry',
  '    ON entry.workspace_id = projection.workspace_id AND entry.entry_id = projection.entry_id',
  '  WHERE projection.workspace_id = $1 AND (NOT entry.is_current_structure OR entry.is_private)',
  '), selected AS (',
  '  SELECT entry_id, obsolete FROM pending ORDER BY obsolete DESC, entry_id LIMIT $5',
  ')',
  'SELECT',
  '  (SELECT count(*)::integer FROM pending WHERE NOT obsolete) AS remaining_entry_count,',
  '  (SELECT count(*)::integer FROM pending WHERE obsolete) AS remaining_obsolete_count,',
  '  ARRAY(SELECT entry_id::text FROM selected WHERE NOT obsolete ORDER BY entry_id) AS entry_ids,',
  '  ARRAY(SELECT entry_id::text FROM selected WHERE obsolete ORDER BY entry_id) AS obsolete_entry_ids',
].join('\n');

export const READ_INFORMATION_ENTRY_INDEX_COMMIT_STATE_SQL = [
  'SELECT entry_id::text, current_revision, current_revision_id::text, is_private, is_current_structure',
  'FROM struinfo.information_entry WHERE workspace_id = $1 AND entry_id = ANY($2::uuid[])',
].join('\n');

const DELETE_SELECTED_POSTINGS_SQL =
  DELETE_POSTINGS_SQL + ' AND entry_id = ANY($2::uuid[])';
const DELETE_SELECTED_PROJECTIONS_SQL =
  DELETE_PROJECTIONS_SQL +
  ' AND entry_id = ANY($2::uuid[]) RETURNING entry_id::text';
const READ_SELECTED_PROJECTIONS_SQL =
  READ_INFORMATION_ENTRY_SEARCH_PROJECTIONS_SQL.replace(
    'ORDER BY entry_id',
    'AND entry_id = ANY($2::uuid[]) ORDER BY entry_id',
  );

export class PostgresInformationEntrySearchIndexRepository implements InformationEntrySearchIndexRepositoryPort {
  readonly #pool: PostgresPoolBoundary;

  public constructor(pool: PostgresPoolBoundary) {
    this.#pool = pool;
  }

  public async loadSearchIndex(
    workspaceIdInput: string,
  ): Promise<Readonly<InformationEntrySearchIndexSnapshot>> {
    const workspaceId = canonicalUuid(workspaceIdInput);
    return runPostgresTransaction(
      this.#pool,
      'repeatable_read_only',
      async (client) => {
        const projections = await client.query<Row>(
          READ_INFORMATION_ENTRY_SEARCH_PROJECTIONS_SQL,
          [workspaceId],
        );
        const postings = await client.query<Row>(
          READ_INFORMATION_ENTRY_TERM_POSTINGS_SQL,
          [workspaceId],
        );
        return Object.freeze({
          projections: Object.freeze(projections.rows.map(mapProjection)),
          postings: Object.freeze(postings.rows.map(mapPosting)),
        });
      },
    );
  }

  public async loadSearchIndexMetrics(
    workspaceIdInput: string,
    embeddingProviderInput?: string,
    embeddingModelInput?: string,
  ): Promise<Readonly<InformationEntrySearchIndexMetrics>> {
    const workspaceId = canonicalUuid(workspaceIdInput);
    if (
      (embeddingProviderInput === undefined) !==
      (embeddingModelInput === undefined)
    ) {
      throw new PostgresAdapterError();
    }
    const embeddingProvider =
      embeddingProviderInput === undefined
        ? null
        : nonEmptyText(embeddingProviderInput);
    const embeddingModel =
      embeddingModelInput === undefined
        ? null
        : nonEmptyText(embeddingModelInput);
    return runPostgresTransaction(
      this.#pool,
      'repeatable_read_only',
      async (client) => {
        const result = await client.query<Row>(
          READ_INFORMATION_ENTRY_SEARCH_INDEX_METRICS_SQL,
          [workspaceId, embeddingProvider, embeddingModel],
        );
        if (result.rows.length !== 1) throw new PostgresAdapterError();
        const row = result.rows[0];
        if (row === undefined) throw new PostgresAdapterError();
        return Object.freeze({
          publicEntryCount: integer(row.public_entry_count),
          currentProjectionCount: integer(row.current_projection_count),
          embeddedProjectionCount: integer(row.embedded_projection_count),
          staleProjectionCount: integer(row.stale_projection_count),
          postingCount: integer(row.posting_count),
        });
      },
    );
  }

  public replaceSearchIndex(
    workspaceIdInput: string,
    snapshot: Readonly<InformationEntrySearchIndexSnapshot>,
  ): Promise<void> {
    const workspaceId = canonicalUuid(workspaceIdInput);
    assertSnapshot(snapshot);
    return runPostgresTransaction(
      this.#pool,
      'read_committed',
      async (client) => {
        await acquireWorkspaceWriteLock(client, workspaceId);
        const current = await client.query<Row>(
          READ_INFORMATION_ENTRY_INDEX_COMMIT_STATE_SQL,
          [
            workspaceId,
            snapshot.projections.map((projection) => projection.entryId),
          ],
        );
        const states = new Map(
          current.rows.map((row) => [canonicalUuid(row.entry_id), row]),
        );
        const accepted = snapshot.projections.filter((projection) =>
          matchesCurrentPublicEntry(projection, states.get(projection.entryId)),
        );
        const acceptedIds = new Set(
          accepted.map((projection) => projection.entryId),
        );
        await client.query<Row>(DELETE_POSTINGS_SQL, [workspaceId]);
        await client.query<Row>(DELETE_PROJECTIONS_SQL, [workspaceId]);
        for (const projection of accepted) {
          await insertProjection(client, workspaceId, projection);
        }
        for (const posting of snapshot.postings) {
          if (!acceptedIds.has(posting.entryId)) continue;
          await client.query<Row>(INSERT_POSTING_SQL, [
            workspaceId,
            posting.entryId,
            posting.field,
            posting.term,
            posting.occurrences,
          ]);
        }
      },
    );
  }

  public loadRefreshBatch(
    workspaceIdInput: string,
    request: Readonly<InformationEntrySearchIndexRefreshRequest>,
  ): Promise<Readonly<InformationEntrySearchIndexRefreshBatch>> {
    const workspaceId = canonicalUuid(workspaceIdInput);
    if (
      !Number.isSafeInteger(request.limit) ||
      request.limit < 0 ||
      request.limit > INFORMATION_ENTRY_EMBEDDING_BATCH_MAXIMUM ||
      (request.embeddingProvider === undefined) !==
        (request.embeddingModel === undefined)
    )
      throw new PostgresAdapterError();
    const provider =
      request.embeddingProvider === undefined
        ? null
        : nonEmptyText(request.embeddingProvider);
    const model =
      request.embeddingModel === undefined
        ? null
        : nonEmptyText(request.embeddingModel);
    return runPostgresTransaction(
      this.#pool,
      'repeatable_read_only',
      async (client) => {
        const result = await client.query<Row>(
          READ_INFORMATION_ENTRY_INDEX_REFRESH_BATCH_SQL,
          [
            workspaceId,
            INFORMATION_ENTRY_TERM_TOKENIZER_VERSION,
            provider,
            model,
            request.limit,
          ],
        );
        const row = result.rows[0];
        if (result.rows.length !== 1 || row === undefined)
          throw new PostgresAdapterError();
        const entryIds = uuidArray(row.entry_ids);
        const obsoleteEntryIds = uuidArray(row.obsolete_entry_ids);
        const prior =
          entryIds.length === 0
            ? []
            : (
                await client.query<Row>(READ_SELECTED_PROJECTIONS_SQL, [
                  workspaceId,
                  entryIds,
                ])
              ).rows;
        return Object.freeze({
          entryIds,
          obsoleteEntryIds,
          previousProjections: Object.freeze(
            prior.flatMap((projection) => {
              try {
                return [mapProjection(projection)];
              } catch {
                // Only selected derived rows may be discarded and rebuilt from evidence.
                return [];
              }
            }),
          ),
          remainingEntryCount: integer(row.remaining_entry_count),
          remainingObsoleteCount: integer(row.remaining_obsolete_count),
        });
      },
    );
  }

  public applyRefreshBatch(
    workspaceIdInput: string,
    snapshot: Readonly<InformationEntrySearchIndexSnapshot>,
    obsoleteEntryIdsInput: readonly string[],
  ): Promise<Readonly<InformationEntrySearchIndexRefreshCommit>> {
    const workspaceId = canonicalUuid(workspaceIdInput);
    assertSnapshot(snapshot);
    const obsoleteEntryIds = obsoleteEntryIdsInput.map(canonicalUuid);
    const entryIds = [
      ...new Set([
        ...snapshot.projections.map((item) => item.entryId),
        ...obsoleteEntryIds,
      ]),
    ];
    if (entryIds.length > INFORMATION_ENTRY_EMBEDDING_BATCH_MAXIMUM)
      throw new PostgresAdapterError();
    return runPostgresTransaction(
      this.#pool,
      'read_committed',
      async (client) => {
        await acquireWorkspaceWriteLock(client, workspaceId);
        const states = await client.query<Row>(
          READ_INFORMATION_ENTRY_INDEX_COMMIT_STATE_SQL,
          [workspaceId, entryIds],
        );
        const current = new Map(
          states.rows.map((row) => [canonicalUuid(row.entry_id), row]),
        );
        const accepted = snapshot.projections.filter((projection) =>
          matchesCurrentPublicEntry(
            projection,
            current.get(projection.entryId),
          ),
        );
        const removed = entryIds.filter((entryId) => {
          const row = current.get(entryId);
          return (
            row !== undefined &&
            (row.is_private === true || row.is_current_structure === false)
          );
        });
        const updatedEntryIds = accepted.map(
          (projection) => projection.entryId,
        );
        const selected = [...updatedEntryIds, ...removed];
        await client.query<Row>(DELETE_SELECTED_POSTINGS_SQL, [
          workspaceId,
          selected,
        ]);
        const deleted = await client.query<Row>(
          DELETE_SELECTED_PROJECTIONS_SQL,
          [workspaceId, selected],
        );
        for (const projection of accepted)
          await insertProjection(client, workspaceId, projection);
        const acceptedIds = new Set(updatedEntryIds);
        for (const posting of snapshot.postings) {
          if (!acceptedIds.has(posting.entryId)) continue;
          await client.query<Row>(INSERT_POSTING_SQL, [
            workspaceId,
            posting.entryId,
            posting.field,
            posting.term,
            posting.occurrences,
          ]);
        }
        // A concurrently cleaned obsolete row is not reported as newly removed.
        const removedSet = new Set(removed);
        const removedCount = deleted.rows.filter((row) =>
          removedSet.has(canonicalUuid(row.entry_id)),
        ).length;
        return Object.freeze({
          updatedEntryIds: Object.freeze(updatedEntryIds),
          removedCount,
        });
      },
    );
  }

  public findLexicalCandidateEntryIds(
    workspaceIdInput: string,
    request: Readonly<InformationEntryLexicalCandidateRequest>,
  ): Promise<readonly string[] | undefined> {
    const workspaceId = canonicalUuid(workspaceIdInput);
    assertCandidateRequest(request);
    return runPostgresTransaction(
      this.#pool,
      'repeatable_read_only',
      async (client) => {
        const readiness = await client.query<Row>(
          READ_INFORMATION_ENTRY_SEARCH_INDEX_READINESS_SQL,
          [
            workspaceId,
            INFORMATION_ENTRY_TERM_TOKENIZER_VERSION,
            INFORMATION_ENTRY_TERM_MAXIMUM_POSTINGS_PER_ENTRY,
          ],
        );
        if (readiness.rows.length !== 1) throw new PostgresAdapterError();
        const row = readiness.rows[0];
        if (
          row === undefined ||
          integer(row.public_entry_count) !==
            integer(row.current_projection_count)
        ) {
          return undefined;
        }
        const candidates = await client.query<Row>(
          FIND_INFORMATION_ENTRY_LEXICAL_CANDIDATES_SQL,
          [workspaceId, request.fields, request.terms],
        );
        return Object.freeze(
          candidates.rows.map((candidate) => canonicalUuid(candidate.entry_id)),
        );
      },
    );
  }
}

function assertCandidateRequest(
  request: Readonly<InformationEntryLexicalCandidateRequest>,
): void {
  if (
    request.fields.length < 1 ||
    request.fields.length > 3 ||
    request.terms.length < 1 ||
    request.terms.length > 8 ||
    request.terms.some((term) => term.length < 1 || term.length > 80)
  ) {
    throw new PostgresAdapterError();
  }
}

function nonEmptyText(value: unknown): string {
  const result = text(value);
  if (result.trim() === '') throw new PostgresAdapterError();
  return result;
}

async function insertProjection(
  client: PostgresClientBoundary,
  workspaceId: string,
  projection: Readonly<InformationEntrySearchProjection>,
): Promise<void> {
  await client.query<Row>(INSERT_PROJECTION_SQL, [
    workspaceId,
    projection.entryId,
    projection.entryRevision,
    projection.entryRevisionId,
    projection.projectionSha256,
    projection.tokenizerVersion,
    projection.embeddingProvider ?? null,
    projection.embeddingModel ?? null,
    projection.embedding?.length ?? null,
    projection.embedding === undefined ? null : [...projection.embedding],
  ]);
}

function mapProjection(row: Row): Readonly<InformationEntrySearchProjection> {
  const provider = optionalText(row.embedding_provider);
  const model = optionalText(row.embedding_model);
  const embedding = optionalEmbedding(row.embedding);
  const dimensions =
    row.embedding_dimensions === null
      ? undefined
      : integer(row.embedding_dimensions, 1);
  if (
    (provider === undefined) !== (model === undefined) ||
    (provider === undefined) !== (embedding === undefined) ||
    (embedding !== undefined && embedding.length !== dimensions)
  ) {
    throw new PostgresAdapterError();
  }
  const base = {
    entryId: canonicalUuid(row.entry_id),
    entryRevision: integer(row.entry_revision, 1),
    entryRevisionId: canonicalUuid(row.entry_revision_id),
    projectionSha256: sha256(row.projection_sha256),
    tokenizerVersion: tokenizerVersion(row.tokenizer_version),
  } as const;
  if (provider === undefined) return Object.freeze(base);
  if (model === undefined || embedding === undefined) {
    throw new PostgresAdapterError();
  }
  return Object.freeze({
    ...base,
    embeddingProvider: provider,
    embeddingModel: model,
    embedding,
  });
}

function mapPosting(row: Row): Readonly<InformationEntryTermPosting> {
  const field = text(row.field);
  if (field !== 'title' && field !== 'body' && field !== 'tags') {
    throw new PostgresAdapterError();
  }
  return Object.freeze({
    entryId: canonicalUuid(row.entry_id),
    field,
    term: text(row.term),
    occurrences: integer(row.occurrences, 1),
  });
}

function optionalEmbedding(value: unknown): readonly number[] | undefined {
  if (value === null) return undefined;
  if (
    !Array.isArray(value) ||
    value.length < 1 ||
    value.length > 16_384 ||
    value.some(
      (item) =>
        (typeof item !== 'number' && typeof item !== 'string') ||
        !Number.isFinite(Number(item)),
    )
  ) {
    throw new PostgresAdapterError();
  }
  return Object.freeze(value.map((item) => Number(item)));
}

function tokenizerVersion(
  value: unknown,
): typeof INFORMATION_ENTRY_TERM_TOKENIZER_VERSION {
  if (value !== INFORMATION_ENTRY_TERM_TOKENIZER_VERSION) {
    throw new PostgresAdapterError();
  }
  return INFORMATION_ENTRY_TERM_TOKENIZER_VERSION;
}

function assertSnapshot(
  snapshot: Readonly<InformationEntrySearchIndexSnapshot>,
): void {
  const entryIds = new Set<string>();
  for (const projection of snapshot.projections) {
    canonicalUuid(projection.entryId);
    canonicalUuid(projection.entryRevisionId);
    integer(projection.entryRevision, 1);
    sha256(projection.projectionSha256);
    tokenizerVersion(projection.tokenizerVersion);
    if (entryIds.has(projection.entryId)) throw new PostgresAdapterError();
    entryIds.add(projection.entryId);
  }
  const postingKeys = new Set<string>();
  for (const posting of snapshot.postings) {
    if (!entryIds.has(posting.entryId)) throw new PostgresAdapterError();
    const key = `${posting.entryId}\n${posting.field}\n${posting.term}`;
    if (postingKeys.has(key)) throw new PostgresAdapterError();
    postingKeys.add(key);
  }
}

function uuidArray(value: unknown): readonly string[] {
  if (!Array.isArray(value)) throw new PostgresAdapterError();
  return Object.freeze(value.map(canonicalUuid));
}

function matchesCurrentPublicEntry(
  projection: Readonly<InformationEntrySearchProjection>,
  row: Row | undefined,
): boolean {
  return (
    row?.is_private === false &&
    row.is_current_structure === true &&
    integer(row.current_revision, 1) === projection.entryRevision &&
    canonicalUuid(row.current_revision_id) === projection.entryRevisionId
  );
}
