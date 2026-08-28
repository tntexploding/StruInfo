import {
  INFORMATION_ENTRY_ASSOCIATION_ACTIONS,
  INFORMATION_ENTRY_ASSOCIATION_BASES,
  INFORMATION_ENTRY_GRAPH_DIRECTIONS,
  INFORMATION_ENTRY_GRAPH_ORIGINS,
  INFORMATION_ENTRY_GRAPH_SEMANTIC_KINDS,
  INFORMATION_ENTRY_GRAPH_VERIFICATION_STATUSES,
  type CurrentInformationEntryAssociationOverride,
  type InformationEntryAssociationOverrideOutcome,
  type InformationEntryAssociationOverrideValue,
  type InformationEntryAssociationOverrideWrite,
  type InformationEntryAssociationProjection,
  type InformationEntryAssociationRepositoryPort,
  type InformationEntryAssociationRepositorySnapshot,
  type InformationEntryGraphRelationValue,
} from '../../../modules/entries/index.js';

import type {PostgresPoolBoundary} from './postgres_pool.js';
import {runPostgresTransaction} from './postgres_transaction.js';
import {
  canonicalUuid,
  enumValue,
  expectOneAffected,
  integer,
  PostgresAdapterError,
  text,
} from './postgres_values.js';
import {acquireWorkspaceWriteLock} from './workspace_write_lock.js';

function sql(...lines: readonly string[]): string {
  return lines.join(String.fromCharCode(10));
}

export const READ_INFORMATION_ENTRY_ASSOCIATION_PROJECTIONS_SQL = sql(
  'SELECT projection.workspace_id::text, projection.entry_low_id::text,',
  '  projection.entry_high_id::text, projection.entry_low_revision,',
  '  projection.entry_low_revision_id::text, projection.entry_high_revision,',
  '  projection.entry_high_revision_id::text, projection.content_similarity,',
  '  projection.type_similarity, projection.domain_similarity,',
  '  projection.base_score, projection.algorithm_version,',
  '  projection.candidate_basis, projection.candidate_rank',
  'FROM struinfo.information_entry_association_projection AS projection',
  'JOIN struinfo.information_entry AS low_entry',
  '  ON low_entry.workspace_id = projection.workspace_id',
  ' AND low_entry.entry_id = projection.entry_low_id',
  ' AND low_entry.current_revision = projection.entry_low_revision',
  ' AND low_entry.current_revision_id = projection.entry_low_revision_id',
  'JOIN struinfo.information_entry AS high_entry',
  '  ON high_entry.workspace_id = projection.workspace_id',
  ' AND high_entry.entry_id = projection.entry_high_id',
  ' AND high_entry.current_revision = projection.entry_high_revision',
  ' AND high_entry.current_revision_id = projection.entry_high_revision_id',
  'WHERE projection.workspace_id = $1',
  '  AND low_entry.is_current_structure AND high_entry.is_current_structure',
  '  AND ($2::boolean OR (NOT low_entry.is_private AND NOT high_entry.is_private))',
  'ORDER BY projection.entry_low_id, projection.entry_high_id',
);

export const READ_INFORMATION_ENTRY_ASSOCIATION_OVERRIDES_SQL = sql(
  'SELECT override.workspace_id::text, override.entry_low_id::text,',
  '  override.entry_high_id::text, override.current_revision,',
  '  override.current_revision_id::text, override.action,',
  '  override.manual_adjustment, override.is_blocked,',
  '  override.graph_origin, override.graph_label, override.graph_direction,',
  '  override.graph_semantic_kind, override.graph_verification_status,',
  '  override.graph_note',
  'FROM struinfo.information_entry_association_override AS override',
  'JOIN struinfo.information_entry AS low_entry',
  '  ON low_entry.workspace_id = override.workspace_id',
  ' AND low_entry.entry_id = override.entry_low_id',
  'JOIN struinfo.information_entry AS high_entry',
  '  ON high_entry.workspace_id = override.workspace_id',
  ' AND high_entry.entry_id = override.entry_high_id',
  'WHERE override.workspace_id = $1',
  '  AND low_entry.is_current_structure AND high_entry.is_current_structure',
  '  AND ($2::boolean OR (NOT low_entry.is_private AND NOT high_entry.is_private))',
  'ORDER BY override.entry_low_id, override.entry_high_id',
);

export const DELETE_INFORMATION_ENTRY_ASSOCIATION_PROJECTIONS_SQL = sql(
  'DELETE FROM struinfo.information_entry_association_projection AS projection',
  'USING struinfo.information_entry AS low_entry,',
  '      struinfo.information_entry AS high_entry',
  'WHERE projection.workspace_id = $1',
  '  AND low_entry.workspace_id = projection.workspace_id',
  '  AND low_entry.entry_id = projection.entry_low_id',
  '  AND high_entry.workspace_id = projection.workspace_id',
  '  AND high_entry.entry_id = projection.entry_high_id',
  '  AND ($2::boolean OR (NOT low_entry.is_private AND NOT high_entry.is_private))',
);

export const INSERT_INFORMATION_ENTRY_ASSOCIATION_PROJECTION_SQL = sql(
  'INSERT INTO struinfo.information_entry_association_projection (',
  '  workspace_id, entry_low_id, entry_high_id,',
  '  entry_low_revision, entry_low_revision_id,',
  '  entry_high_revision, entry_high_revision_id,',
  '  content_similarity, type_similarity, domain_similarity, base_score,',
  '  algorithm_version, candidate_basis, candidate_rank',
  ') VALUES (',
  '  $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14',
  ')',
);

const READ_ASSOCIATION_ENDPOINTS_SQL = sql(
  'SELECT entry_id::text, is_private',
  'FROM struinfo.information_entry',
  'WHERE workspace_id = $1 AND entry_id IN ($2, $3)',
  '  AND is_current_structure',
  'ORDER BY entry_id',
);

const LOCK_INFORMATION_ENTRY_ASSOCIATION_OVERRIDE_SQL = sql(
  'SELECT current_revision, current_revision_id::text, action,',
  '  manual_adjustment, is_blocked, graph_origin, graph_label, graph_direction,',
  '  graph_semantic_kind, graph_verification_status, graph_note',
  'FROM struinfo.information_entry_association_override',
  'WHERE workspace_id = $1 AND entry_low_id = $2 AND entry_high_id = $3',
  'FOR UPDATE',
);

const INSERT_INFORMATION_ENTRY_ASSOCIATION_OVERRIDE_SQL = sql(
  'INSERT INTO struinfo.information_entry_association_override (',
  '  workspace_id, entry_low_id, entry_high_id, current_revision,',
  '  current_revision_id, action, manual_adjustment, is_blocked,',
  '  graph_origin, graph_label, graph_direction, graph_semantic_kind,',
  '  graph_verification_status, graph_note',
  ') VALUES ($1, $2, $3, 1, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)',
);

const UPDATE_INFORMATION_ENTRY_ASSOCIATION_OVERRIDE_SQL = sql(
  'UPDATE struinfo.information_entry_association_override SET',
  '  current_revision = $4, current_revision_id = $5, action = $6,',
  '  manual_adjustment = $7, is_blocked = $8, graph_origin = $9,',
  '  graph_label = $10, graph_direction = $11, graph_semantic_kind = $12,',
  '  graph_verification_status = $13, graph_note = $14,',
  '  updated_at = CURRENT_TIMESTAMP',
  'WHERE workspace_id = $1 AND entry_low_id = $2 AND entry_high_id = $3',
  '  AND current_revision = $15',
);

type Row = Readonly<Record<string, unknown>>;

export class PostgresInformationEntryAssociationRepository implements InformationEntryAssociationRepositoryPort {
  readonly #pool: PostgresPoolBoundary;

  public constructor(pool: PostgresPoolBoundary) {
    this.#pool = pool;
  }

  public replaceAssociationProjections(
    workspaceIdInput: string,
    projections: readonly Readonly<InformationEntryAssociationProjection>[],
    includePrivate: boolean,
  ): Promise<number> {
    const workspaceId = canonicalUuid(workspaceIdInput);
    return runPostgresTransaction(
      this.#pool,
      'read_committed',
      async (client) => {
        await acquireWorkspaceWriteLock(client, workspaceId);
        await client.query<Row>(
          DELETE_INFORMATION_ENTRY_ASSOCIATION_PROJECTIONS_SQL,
          [workspaceId, includePrivate],
        );
        for (const projection of projections) {
          if (canonicalUuid(projection.workspaceId) !== workspaceId) {
            throw new PostgresAdapterError();
          }
          const result = await client.query<Row>(
            INSERT_INFORMATION_ENTRY_ASSOCIATION_PROJECTION_SQL,
            informationEntryAssociationProjectionParameters(projection),
          );
          expectOneAffected(result.rowCount);
        }
        return projections.length;
      },
    );
  }

  public loadAssociationSnapshot(
    workspaceIdInput: string,
    includePrivate: boolean,
  ): Promise<Readonly<InformationEntryAssociationRepositorySnapshot>> {
    const workspaceId = canonicalUuid(workspaceIdInput);
    return runPostgresTransaction(
      this.#pool,
      'repeatable_read_only',
      async (client) => {
        const projections = await client.query<Row>(
          READ_INFORMATION_ENTRY_ASSOCIATION_PROJECTIONS_SQL,
          [workspaceId, includePrivate],
        );
        const overrides = await client.query<Row>(
          READ_INFORMATION_ENTRY_ASSOCIATION_OVERRIDES_SQL,
          [workspaceId, includePrivate],
        );
        return Object.freeze({
          projections: Object.freeze(projections.rows.map(mapProjection)),
          overrides: Object.freeze(overrides.rows.map(mapOverride)),
        });
      },
    );
  }

  public writeAssociationOverride(
    write: Readonly<InformationEntryAssociationOverrideWrite>,
  ): Promise<InformationEntryAssociationOverrideOutcome> {
    const workspaceId = canonicalUuid(write.workspaceId);
    const entryLowId = canonicalUuid(write.entryLowId);
    const entryHighId = canonicalUuid(write.entryHighId);
    const revisionId = canonicalUuid(write.revisionId);
    if (
      entryLowId >= entryHighId ||
      !Number.isSafeInteger(write.expectedRevision) ||
      write.expectedRevision < 0
    ) {
      throw new PostgresAdapterError();
    }
    assertOverrideValue(write.value);
    return runPostgresTransaction(
      this.#pool,
      'read_committed',
      async (client) => {
        await acquireWorkspaceWriteLock(client, workspaceId);
        const endpoints = await client.query<Row>(
          READ_ASSOCIATION_ENDPOINTS_SQL,
          [workspaceId, entryLowId, entryHighId],
        );
        if (
          endpoints.rows.length !== 2 ||
          (!write.includePrivate &&
            endpoints.rows.some((row) => row.is_private === true))
        ) {
          return 'not_found';
        }
        if (endpoints.rows.some((row) => typeof row.is_private !== 'boolean')) {
          throw new PostgresAdapterError();
        }
        const locked = await client.query<Row>(
          LOCK_INFORMATION_ENTRY_ASSOCIATION_OVERRIDE_SQL,
          [workspaceId, entryLowId, entryHighId],
        );
        if (locked.rows.length > 1) throw new PostgresAdapterError();
        const current = locked.rows[0];
        if (current === undefined) {
          if (write.expectedRevision !== 0) return 'stale';
          const inserted = await client.query<Row>(
            INSERT_INFORMATION_ENTRY_ASSOCIATION_OVERRIDE_SQL,
            [
              workspaceId,
              entryLowId,
              entryHighId,
              revisionId,
              write.value.action,
              write.value.manualAdjustment,
              write.value.isBlocked,
              write.value.graph?.origin ?? null,
              write.value.graph?.label ?? null,
              write.value.graph?.direction ?? null,
              write.value.graph?.semanticKind ?? null,
              write.value.graph?.verificationStatus ?? null,
              write.value.graph?.note ?? null,
            ],
          );
          expectOneAffected(inserted.rowCount);
          return 'applied';
        }
        const currentRevision = integer(current.current_revision, 1);
        if (currentRevision !== write.expectedRevision) return 'stale';
        if (sameOverrideValue(mapOverrideValue(current), write.value)) {
          return 'unchanged';
        }
        const nextRevision = currentRevision + 1;
        if (nextRevision > 2_147_483_647) throw new PostgresAdapterError();
        const updated = await client.query<Row>(
          UPDATE_INFORMATION_ENTRY_ASSOCIATION_OVERRIDE_SQL,
          [
            workspaceId,
            entryLowId,
            entryHighId,
            nextRevision,
            revisionId,
            write.value.action,
            write.value.manualAdjustment,
            write.value.isBlocked,
            write.value.graph?.origin ?? null,
            write.value.graph?.label ?? null,
            write.value.graph?.direction ?? null,
            write.value.graph?.semanticKind ?? null,
            write.value.graph?.verificationStatus ?? null,
            write.value.graph?.note ?? null,
            currentRevision,
          ],
        );
        expectOneAffected(updated.rowCount);
        return 'applied';
      },
    );
  }
}

export function informationEntryAssociationProjectionParameters(
  projection: Readonly<InformationEntryAssociationProjection>,
): readonly unknown[] {
  const basis = projection.candidateBasis.map((value) =>
    enumValue(value, INFORMATION_ENTRY_ASSOCIATION_BASES),
  );
  if (basis.length === 0) throw new PostgresAdapterError();
  return [
    projection.workspaceId,
    canonicalUuid(projection.entryLowId),
    canonicalUuid(projection.entryHighId),
    boundedScore(projection.entryLowRevision, 1, 2_147_483_647),
    canonicalUuid(projection.entryLowRevisionId),
    boundedScore(projection.entryHighRevision, 1, 2_147_483_647),
    canonicalUuid(projection.entryHighRevisionId),
    boundedScore(projection.contentSimilarity),
    boundedScore(projection.typeSimilarity),
    boundedScore(projection.domainSimilarity),
    boundedScore(projection.baseScore),
    nonEmptyText(projection.algorithmVersion),
    basis.join('+'),
    boundedScore(projection.candidateRank, 1, 2_147_483_647),
  ];
}

function mapProjection(row: Row): InformationEntryAssociationProjection {
  const candidateBasis = text(row.candidate_basis)
    .split('+')
    .map((value) => enumValue(value, INFORMATION_ENTRY_ASSOCIATION_BASES));
  if (candidateBasis.length === 0) throw new PostgresAdapterError();
  return Object.freeze({
    workspaceId: canonicalUuid(row.workspace_id),
    entryLowId: canonicalUuid(row.entry_low_id),
    entryHighId: canonicalUuid(row.entry_high_id),
    entryLowRevision: boundedScore(row.entry_low_revision, 1, 2_147_483_647),
    entryLowRevisionId: canonicalUuid(row.entry_low_revision_id),
    entryHighRevision: boundedScore(row.entry_high_revision, 1, 2_147_483_647),
    entryHighRevisionId: canonicalUuid(row.entry_high_revision_id),
    contentSimilarity: boundedScore(row.content_similarity),
    typeSimilarity: boundedScore(row.type_similarity),
    domainSimilarity: boundedScore(row.domain_similarity),
    baseScore: boundedScore(row.base_score),
    algorithmVersion: nonEmptyText(row.algorithm_version),
    candidateBasis: Object.freeze(candidateBasis),
    candidateRank: boundedScore(row.candidate_rank, 1, 2_147_483_647),
  });
}

function mapOverride(row: Row): CurrentInformationEntryAssociationOverride {
  return Object.freeze({
    workspaceId: canonicalUuid(row.workspace_id),
    entryLowId: canonicalUuid(row.entry_low_id),
    entryHighId: canonicalUuid(row.entry_high_id),
    revision: integer(row.current_revision, 1),
    revisionId: canonicalUuid(row.current_revision_id),
    value: mapOverrideValue(row),
  });
}

function mapOverrideValue(
  row: Row,
): Readonly<InformationEntryAssociationOverrideValue> {
  if (typeof row.is_blocked !== 'boolean') throw new PostgresAdapterError();
  const graph = mapGraphRelationValue(row);
  const value = Object.freeze({
    action: enumValue(row.action, INFORMATION_ENTRY_ASSOCIATION_ACTIONS),
    manualAdjustment: integer(row.manual_adjustment, -10_000),
    isBlocked: row.is_blocked,
    ...(graph === undefined ? {} : {graph}),
  });
  assertOverrideValue(value);
  return value;
}

function mapGraphRelationValue(
  row: Row,
): Readonly<InformationEntryGraphRelationValue> | undefined {
  const fields = [
    row.graph_origin,
    row.graph_label,
    row.graph_direction,
    row.graph_semantic_kind,
    row.graph_verification_status,
    row.graph_note,
  ];
  if (fields.every((value) => value === null || value === undefined)) {
    return undefined;
  }
  if (fields.some((value) => typeof value !== 'string')) {
    throw new PostgresAdapterError();
  }
  const label = nonEmptyText(row.graph_label);
  const note = text(row.graph_note);
  if (
    Array.from(label).length > 80 ||
    containsControlCodePoint(label) ||
    note !== note.replace(/\r\n?/gu, '\n').trim().normalize('NFC') ||
    Array.from(note).length > 500 ||
    containsForbiddenNoteControlCodePoint(note)
  ) {
    throw new PostgresAdapterError();
  }
  return Object.freeze({
    origin: enumValue(row.graph_origin, INFORMATION_ENTRY_GRAPH_ORIGINS),
    label,
    direction: enumValue(
      row.graph_direction,
      INFORMATION_ENTRY_GRAPH_DIRECTIONS,
    ),
    semanticKind: enumValue(
      row.graph_semantic_kind,
      INFORMATION_ENTRY_GRAPH_SEMANTIC_KINDS,
    ),
    verificationStatus: enumValue(
      row.graph_verification_status,
      INFORMATION_ENTRY_GRAPH_VERIFICATION_STATUSES,
    ),
    note,
  });
}

function assertOverrideValue(
  value: Readonly<InformationEntryAssociationOverrideValue>,
): void {
  enumValue(value.action, INFORMATION_ENTRY_ASSOCIATION_ACTIONS);
  boundedScore(value.manualAdjustment, -10_000, 10_000);
  if (value.graph !== undefined) {
    enumValue(value.graph.origin, INFORMATION_ENTRY_GRAPH_ORIGINS);
    enumValue(value.graph.direction, INFORMATION_ENTRY_GRAPH_DIRECTIONS);
    enumValue(value.graph.semanticKind, INFORMATION_ENTRY_GRAPH_SEMANTIC_KINDS);
    enumValue(
      value.graph.verificationStatus,
      INFORMATION_ENTRY_GRAPH_VERIFICATION_STATUSES,
    );
    if (
      value.graph.label !== value.graph.label.trim().normalize('NFC') ||
      value.graph.label.length === 0 ||
      Array.from(value.graph.label).length > 80 ||
      containsControlCodePoint(value.graph.label) ||
      value.graph.note !==
        value.graph.note.replace(/\r\n?/gu, '\n').trim().normalize('NFC') ||
      Array.from(value.graph.note).length > 500 ||
      containsForbiddenNoteControlCodePoint(value.graph.note)
    ) {
      throw new PostgresAdapterError();
    }
  }
  if (
    typeof value.isBlocked !== 'boolean' ||
    (value.action === 'block') !== value.isBlocked ||
    (value.action === 'block' && value.manualAdjustment !== 0) ||
    (value.action === 'restore' && value.manualAdjustment !== 0)
  ) {
    throw new PostgresAdapterError();
  }
}

function boundedScore(value: unknown, minimum = 0, maximum = 10_000): number {
  const result = integer(value, minimum);
  if (result > maximum) throw new PostgresAdapterError();
  return result;
}

function nonEmptyText(value: unknown): string {
  const result = text(value);
  if (result.trim() === '') throw new PostgresAdapterError();
  return result;
}

function sameOverrideValue(
  left: Readonly<InformationEntryAssociationOverrideValue>,
  right: Readonly<InformationEntryAssociationOverrideValue>,
): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function containsControlCodePoint(value: string): boolean {
  return Array.from(value).some((character) => {
    const codePoint = character.codePointAt(0);
    return codePoint !== undefined && (codePoint <= 0x1f || codePoint === 0x7f);
  });
}

function containsForbiddenNoteControlCodePoint(value: string): boolean {
  return Array.from(value).some((character) => {
    const codePoint = character.codePointAt(0);
    return (
      codePoint !== undefined &&
      ((codePoint <= 0x1f && codePoint !== 0x09 && codePoint !== 0x0a) ||
        codePoint === 0x7f)
    );
  });
}
