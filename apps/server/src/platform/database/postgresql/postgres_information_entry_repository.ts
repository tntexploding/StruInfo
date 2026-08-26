import {
  ENTRY_ANNOTATION_ORIGINS,
  ENTRY_CHUNK_MODES,
  ENTRY_DOMAIN_KEYWORDS,
  ENTRY_TYPE_KEYWORDS,
  type CurrentInformationEntry,
  type EntryAssessmentScore,
  type EntryContentKeyword,
  type EntryDomainAssignment,
  type InformationEntryEmptySnapshotMaterializeResult,
  type InformationEntryMaterializeResult,
  type InformationEntryMaterializeRow,
  type InformationEntryRepositoryPort,
  type InformationEntryRevisionOutcome,
  type InformationEntryRevisionValue,
  type InformationEntryRevisionWrite,
} from '../../../modules/entries/index.js';

import type {
  PostgresClientBoundary,
  PostgresPoolBoundary,
} from './postgres_pool.js';
import {runPostgresTransaction} from './postgres_transaction.js';
import {
  canonicalUuid,
  enumValue,
  expectOneAffected,
  integer,
  optionalText,
  PostgresAdapterError,
  sha256,
  text,
} from './postgres_values.js';
import {acquireWorkspaceWriteLock} from './workspace_write_lock.js';

function sql(...lines: readonly string[]): string {
  return lines.join(String.fromCharCode(10));
}

const CURRENT_ENTRY_SELECT = sql(
  'SELECT',
  '  e.workspace_id::text, e.entry_id::text, e.resource_id::text,',
  '  e.snapshot_id::text, e.current_revision, e.current_revision_id::text,',
  '  e.document_order, e.title_path, e.body, e.body_sha256, e.chunk_mode,',
  '  e.split_rule_version, e.is_private, e.type_keyword, e.type_custom_name,',
  '  e.usefulness_score, e.interest_score,',
  '  source.source_key, source.canonical_uri, snapshot.captured_at,',
  '  snapshot.published_at',
  'FROM struinfo.information_entry AS e',
  'JOIN struinfo.resource AS source',
  '  ON source.workspace_id = e.workspace_id AND source.resource_id = e.resource_id',
  'JOIN struinfo.snapshot AS snapshot',
  '  ON snapshot.workspace_id = e.workspace_id',
  ' AND snapshot.resource_id = e.resource_id',
  ' AND snapshot.snapshot_id = e.snapshot_id',
);

export const READ_CURRENT_INFORMATION_ENTRIES_SQL = sql(
  CURRENT_ENTRY_SELECT,
  'WHERE e.workspace_id = $1 AND e.is_current_structure',
  '  AND ($2::boolean OR NOT e.is_private)',
  'ORDER BY snapshot.captured_at DESC, e.snapshot_id, e.document_order, e.entry_id',
);

export const READ_CURRENT_INFORMATION_ENTRY_INPUTS_SQL = sql(
  'SELECT i.entry_id::text, i.input_ordinal, i.fragment_id::text,',
  '  r.start_code_point, r.end_code_point',
  'FROM struinfo.information_entry_fragment_input AS i',
  'LEFT JOIN struinfo.information_entry_fragment_range AS r',
  '  ON r.workspace_id = i.workspace_id',
  ' AND r.entry_id = i.entry_id AND r.input_ordinal = i.input_ordinal',
  'JOIN struinfo.information_entry AS e',
  '  ON e.workspace_id = i.workspace_id AND e.entry_id = i.entry_id',
  'WHERE i.workspace_id = $1 AND e.is_current_structure',
  '  AND ($2::boolean OR NOT e.is_private)',
  'ORDER BY i.entry_id, i.input_ordinal',
);

export const READ_CURRENT_INFORMATION_ENTRY_KEYWORDS_SQL = sql(
  'SELECT k.entry_id::text, k.keyword_ordinal,',
  '  k.display_value, k.normalized_value, k.origin, k.origin_version',
  'FROM struinfo.information_entry_content_keyword AS k',
  'JOIN struinfo.information_entry AS e',
  '  ON e.workspace_id = k.workspace_id AND e.entry_id = k.entry_id',
  'WHERE k.workspace_id = $1 AND e.is_current_structure',
  '  AND ($2::boolean OR NOT e.is_private)',
  'ORDER BY k.entry_id, k.keyword_ordinal',
);

export const READ_CURRENT_INFORMATION_ENTRY_DOMAINS_SQL = sql(
  'SELECT d.entry_id::text, d.domain_ordinal,',
  '  d.domain_keyword, d.custom_name, d.origin, d.origin_version',
  'FROM struinfo.information_entry_domain_keyword AS d',
  'JOIN struinfo.information_entry AS e',
  '  ON e.workspace_id = d.workspace_id AND e.entry_id = d.entry_id',
  'WHERE d.workspace_id = $1 AND e.is_current_structure',
  '  AND ($2::boolean OR NOT e.is_private)',
  'ORDER BY d.entry_id, d.domain_ordinal',
);

const LOCK_CURRENT_ENTRY_SQL = sql(
  CURRENT_ENTRY_SELECT,
  'WHERE e.workspace_id = $1 AND e.entry_id = $2 AND e.is_current_structure',
  'FOR UPDATE OF e',
);

const READ_SNAPSHOT_ENTRY_IDS_SQL = sql(
  'SELECT entry_id::text',
  'FROM struinfo.information_entry',
  'WHERE workspace_id = $1 AND snapshot_id = $2 AND is_current_structure',
  'ORDER BY entry_id',
);

const READ_ENTRY_MATERIALIZATION_SQL = sql(
  'SELECT resource_id::text, snapshot_id::text, document_order,',
  '  chunk_mode, split_rule_version, is_private',
  'FROM struinfo.information_entry',
  'WHERE workspace_id = $1 AND entry_id = $2',
);

const READ_ENTRY_INPUTS_SQL = sql(
  'SELECT i.input_ordinal, i.fragment_id::text,',
  '  r.start_code_point, r.end_code_point',
  'FROM struinfo.information_entry_fragment_input AS i',
  'LEFT JOIN struinfo.information_entry_fragment_range AS r',
  '  ON r.workspace_id = i.workspace_id',
  ' AND r.entry_id = i.entry_id AND r.input_ordinal = i.input_ordinal',
  'WHERE i.workspace_id = $1 AND i.entry_id = $2',
  'ORDER BY i.input_ordinal',
);

const READ_ENTRY_KEYWORDS_SQL = sql(
  'SELECT keyword_ordinal, display_value, normalized_value, origin, origin_version',
  'FROM struinfo.information_entry_content_keyword',
  'WHERE workspace_id = $1 AND entry_id = $2',
  'ORDER BY keyword_ordinal',
);

const READ_ENTRY_DOMAINS_SQL = sql(
  'SELECT domain_ordinal, domain_keyword, custom_name, origin, origin_version',
  'FROM struinfo.information_entry_domain_keyword',
  'WHERE workspace_id = $1 AND entry_id = $2',
  'ORDER BY domain_ordinal',
);

const INSERT_ENTRY_SQL = sql(
  'INSERT INTO struinfo.information_entry (',
  '  workspace_id, entry_id, resource_id, snapshot_id,',
  '  current_revision, current_revision_id, document_order, title_path, body,',
  '  body_sha256, chunk_mode, split_rule_version, is_private, type_keyword,',
  '  type_custom_name, usefulness_score, interest_score',
  ') VALUES (',
  '  $1, $2, $3, $4, 1, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16',
  ')',
);

const UPDATE_ENTRY_SQL = sql(
  'UPDATE struinfo.information_entry SET',
  '  current_revision = $3, current_revision_id = $4,',
  '  document_order = $5, title_path = $6, body = $7, body_sha256 = $8,',
  '  chunk_mode = $9, split_rule_version = $10, is_private = $11,',
  '  type_keyword = $12, type_custom_name = $13,',
  '  usefulness_score = $14, interest_score = $15,',
  '  updated_at = CURRENT_TIMESTAMP',
  'WHERE workspace_id = $1 AND entry_id = $2 AND current_revision = $16',
  '  AND is_current_structure',
);

const DELETE_FRAGMENT_INPUTS_SQL =
  'DELETE FROM struinfo.information_entry_fragment_input WHERE workspace_id = $1 AND entry_id = $2';
const DELETE_FRAGMENT_RANGES_SQL =
  'DELETE FROM struinfo.information_entry_fragment_range WHERE workspace_id = $1 AND entry_id = $2';
const DELETE_CONTENT_KEYWORDS_SQL =
  'DELETE FROM struinfo.information_entry_content_keyword WHERE workspace_id = $1 AND entry_id = $2';
const DELETE_DOMAIN_KEYWORDS_SQL =
  'DELETE FROM struinfo.information_entry_domain_keyword WHERE workspace_id = $1 AND entry_id = $2';

const INSERT_FRAGMENT_INPUT_SQL = sql(
  'INSERT INTO struinfo.information_entry_fragment_input (',
  '  workspace_id, entry_id, input_ordinal, fragment_id',
  ') VALUES ($1, $2, $3, $4)',
);
const INSERT_FRAGMENT_RANGE_SQL = sql(
  'INSERT INTO struinfo.information_entry_fragment_range (',
  '  workspace_id, entry_id, input_ordinal, start_code_point, end_code_point',
  ') SELECT $1, $2, $3, $4::integer, $5::integer',
  'FROM struinfo.information_entry_fragment_input AS input',
  'JOIN struinfo.fragment AS fragment',
  '  ON fragment.workspace_id = input.workspace_id',
  ' AND fragment.fragment_id = input.fragment_id',
  'WHERE input.workspace_id = $1 AND input.entry_id = $2',
  '  AND input.input_ordinal = $3',
  '  AND $4::integer >= 0',
  '  AND $5::integer <= char_length(fragment.selected_text)',
);
const INSERT_CONTENT_KEYWORD_SQL = sql(
  'INSERT INTO struinfo.information_entry_content_keyword (',
  '  workspace_id, entry_id, keyword_ordinal, display_value, normalized_value,',
  '  origin, origin_version',
  ') VALUES ($1, $2, $3, $4, $5, $6, $7)',
);
const INSERT_DOMAIN_KEYWORD_SQL = sql(
  'INSERT INTO struinfo.information_entry_domain_keyword (',
  '  workspace_id, entry_id, domain_ordinal, domain_keyword, custom_name,',
  '  origin, origin_version',
  ') VALUES ($1, $2, $3, $4, $5, $6, $7)',
);

type Row = Readonly<Record<string, unknown>>;

export class PostgresInformationEntryRepository implements InformationEntryRepositoryPort {
  readonly #pool: PostgresPoolBoundary;

  public constructor(pool: PostgresPoolBoundary) {
    this.#pool = pool;
  }

  public async materializeEntries(
    entries: readonly Readonly<InformationEntryMaterializeRow>[],
  ): Promise<Readonly<InformationEntryMaterializeResult>> {
    if (entries.length === 0) {
      return Object.freeze({outcome: 'existing', createdCount: 0});
    }
    const workspaceId = canonicalUuid(entries[0]?.workspaceId);
    return runPostgresTransaction(
      this.#pool,
      'read_committed',
      async (client) => {
        await acquireWorkspaceWriteLock(client, workspaceId);
        let createdCount = 0;
        for (const entry of entries) {
          if (canonicalUuid(entry.workspaceId) !== workspaceId) {
            throw new PostgresAdapterError();
          }
          const existing = await client.query<Row>(
            READ_ENTRY_MATERIALIZATION_SQL,
            [workspaceId, canonicalUuid(entry.entryId)],
          );
          if (existing.rows.length > 1) throw new PostgresAdapterError();
          const row = existing.rows[0];
          if (row !== undefined) {
            await assertExistingMaterialization(client, entry, row);
            continue;
          }
          await insertNewEntry(client, entry);
          createdCount += 1;
        }
        return Object.freeze({
          outcome: createdCount === 0 ? 'existing' : 'created',
          createdCount,
        });
      },
    );
  }

  public async materializeEntriesIfSnapshotEmpty(
    entries: readonly Readonly<InformationEntryMaterializeRow>[],
  ): Promise<Readonly<InformationEntryEmptySnapshotMaterializeResult>> {
    if (entries.length === 0) {
      return Object.freeze({outcome: 'existing', createdCount: 0});
    }
    const first = entries[0];
    if (first === undefined) throw new PostgresAdapterError();
    const workspaceId = canonicalUuid(first.workspaceId);
    const snapshotId = canonicalUuid(first.snapshotId);
    return runPostgresTransaction(
      this.#pool,
      'read_committed',
      async (client) => {
        await acquireWorkspaceWriteLock(client, workspaceId);
        for (const entry of entries) {
          if (
            canonicalUuid(entry.workspaceId) !== workspaceId ||
            canonicalUuid(entry.snapshotId) !== snapshotId
          ) {
            throw new PostgresAdapterError();
          }
        }
        const existing = await client.query<Row>(READ_SNAPSHOT_ENTRY_IDS_SQL, [
          workspaceId,
          snapshotId,
        ]);
        if (existing.rows.length === 0) {
          for (const entry of entries) await insertNewEntry(client, entry);
          return Object.freeze({
            outcome: 'created' as const,
            createdCount: entries.length,
          });
        }
        const currentIds = existing.rows
          .map((row) => canonicalUuid(row.entry_id))
          .sort();
        const expectedIds = entries.map((entry) => entry.entryId).sort();
        if (
          currentIds.length !== expectedIds.length ||
          currentIds.some((entryId, index) => entryId !== expectedIds[index])
        ) {
          return Object.freeze({
            outcome: 'snapshot_not_empty' as const,
            createdCount: 0,
          });
        }
        for (const entry of entries) {
          const current = await client.query<Row>(
            READ_ENTRY_MATERIALIZATION_SQL,
            [workspaceId, canonicalUuid(entry.entryId)],
          );
          if (current.rows.length !== 1 || current.rows[0] === undefined) {
            throw new PostgresAdapterError();
          }
          await assertExistingMaterialization(client, entry, current.rows[0]);
        }
        return Object.freeze({outcome: 'existing' as const, createdCount: 0});
      },
    );
  }
  public reviseEntry(
    write: Readonly<InformationEntryRevisionWrite>,
  ): Promise<InformationEntryRevisionOutcome> {
    const workspaceId = canonicalUuid(write.workspaceId);
    const entryId = canonicalUuid(write.entryId);
    return runPostgresTransaction(
      this.#pool,
      'read_committed',
      async (client) => {
        await acquireWorkspaceWriteLock(client, workspaceId);
        const locked = await client.query<Row>(LOCK_CURRENT_ENTRY_SQL, [
          workspaceId,
          entryId,
        ]);
        if (locked.rows.length === 0) return 'not_found';
        if (locked.rows.length !== 1) throw new PostgresAdapterError();
        const row = locked.rows[0];
        if (row === undefined) throw new PostgresAdapterError();
        const currentRevision = integer(row.current_revision, 1);
        if (currentRevision !== write.expectedRevision) return 'stale';
        const current = await loadOneCurrentValue(client, row);
        if (sameRevisionValue(current, write.value)) return 'unchanged';

        const nextRevision = currentRevision + 1;
        if (nextRevision > 2_147_483_647) throw new PostgresAdapterError();
        const updated = await client.query<Row>(UPDATE_ENTRY_SQL, [
          workspaceId,
          entryId,
          nextRevision,
          canonicalUuid(write.revisionId),
          ...informationEntryValueParameters(write.value),
          currentRevision,
        ]);
        expectOneAffected(updated.rowCount);
        await replaceEntryChildren(client, workspaceId, entryId, write.value);
        return 'applied';
      },
    );
  }

  public loadCurrentEntries(
    workspaceIdInput: string,
    includePrivate: boolean,
  ): Promise<readonly Readonly<CurrentInformationEntry>[]> {
    const workspaceId = canonicalUuid(workspaceIdInput);
    return runPostgresTransaction(
      this.#pool,
      'repeatable_read_only',
      async (client) => {
        const [core, inputs, keywords, domains] = await Promise.all([
          client.query<Row>(READ_CURRENT_INFORMATION_ENTRIES_SQL, [
            workspaceId,
            includePrivate,
          ]),
          client.query<Row>(READ_CURRENT_INFORMATION_ENTRY_INPUTS_SQL, [
            workspaceId,
            includePrivate,
          ]),
          client.query<Row>(READ_CURRENT_INFORMATION_ENTRY_KEYWORDS_SQL, [
            workspaceId,
            includePrivate,
          ]),
          client.query<Row>(READ_CURRENT_INFORMATION_ENTRY_DOMAINS_SQL, [
            workspaceId,
            includePrivate,
          ]),
        ]);
        return Object.freeze(
          core.rows.map((row) =>
            mapCurrentEntry(row, inputs.rows, keywords.rows, domains.rows),
          ),
        );
      },
    );
  }
}

export async function insertNewEntry(
  client: PostgresClientBoundary,
  entry: Readonly<InformationEntryMaterializeRow>,
): Promise<void> {
  const inserted = await client.query<Row>(INSERT_ENTRY_SQL, [
    entry.workspaceId,
    entry.entryId,
    entry.resourceId,
    entry.snapshotId,
    entry.revisionId,
    ...informationEntryValueParameters(entry.value),
  ]);
  expectOneAffected(inserted.rowCount);
  await insertEntryChildren(
    client,
    entry.workspaceId,
    entry.entryId,
    entry.value,
  );
}

export function informationEntryValueParameters(
  value: Readonly<InformationEntryRevisionValue>,
): readonly unknown[] {
  return [
    value.documentOrder,
    value.titlePath,
    value.body,
    value.bodySha256,
    value.chunkMode,
    value.splitRuleVersion,
    value.isPrivate,
    value.typeKeyword ?? null,
    value.typeCustomName ?? null,
    value.usefulnessScore ?? null,
    value.interestScore ?? null,
  ];
}

export async function replaceEntryChildren(
  client: PostgresClientBoundary,
  workspaceId: string,
  entryId: string,
  value: Readonly<InformationEntryRevisionValue>,
): Promise<void> {
  await client.query<Row>(DELETE_FRAGMENT_RANGES_SQL, [workspaceId, entryId]);
  await client.query<Row>(DELETE_FRAGMENT_INPUTS_SQL, [workspaceId, entryId]);
  await client.query<Row>(DELETE_CONTENT_KEYWORDS_SQL, [workspaceId, entryId]);
  await client.query<Row>(DELETE_DOMAIN_KEYWORDS_SQL, [workspaceId, entryId]);
  await insertEntryChildren(client, workspaceId, entryId, value);
}

async function insertEntryChildren(
  client: PostgresClientBoundary,
  workspaceId: string,
  entryId: string,
  value: Readonly<InformationEntryRevisionValue>,
): Promise<void> {
  if (
    value.fragmentRanges !== undefined &&
    value.fragmentRanges.length !== value.fragmentIds.length
  ) {
    throw new PostgresAdapterError();
  }
  for (const [index, fragmentId] of value.fragmentIds.entries()) {
    const result = await client.query<Row>(INSERT_FRAGMENT_INPUT_SQL, [
      workspaceId,
      entryId,
      index,
      fragmentId,
    ]);
    expectOneAffected(result.rowCount);
    const range = value.fragmentRanges?.[index];
    if (range !== undefined) {
      const insertedRange = await client.query<Row>(INSERT_FRAGMENT_RANGE_SQL, [
        workspaceId,
        entryId,
        index,
        range.startCodePoint,
        range.endCodePoint,
      ]);
      expectOneAffected(insertedRange.rowCount);
    }
  }
  for (const [index, keyword] of value.contentKeywords.entries()) {
    const result = await client.query<Row>(INSERT_CONTENT_KEYWORD_SQL, [
      workspaceId,
      entryId,
      index,
      keyword.displayValue,
      keyword.normalizedValue,
      keyword.origin,
      keyword.originVersion,
    ]);
    expectOneAffected(result.rowCount);
  }
  for (const [index, domain] of value.domains.entries()) {
    const result = await client.query<Row>(INSERT_DOMAIN_KEYWORD_SQL, [
      workspaceId,
      entryId,
      index,
      domain.keyword,
      domain.customName ?? null,
      domain.origin,
      domain.originVersion,
    ]);
    expectOneAffected(result.rowCount);
  }
}

async function assertExistingMaterialization(
  client: PostgresClientBoundary,
  entry: Readonly<InformationEntryMaterializeRow>,
  row: Row,
): Promise<void> {
  const inputs = await client.query<Row>(READ_ENTRY_INPUTS_SQL, [
    entry.workspaceId,
    entry.entryId,
  ]);
  const actualRanges = mapFragmentRanges(inputs.rows);
  if (
    canonicalUuid(row.resource_id) !== entry.resourceId ||
    canonicalUuid(row.snapshot_id) !== entry.snapshotId ||
    integer(row.document_order) !== entry.value.documentOrder ||
    enumValue(row.chunk_mode, ENTRY_CHUNK_MODES) !== entry.value.chunkMode ||
    text(row.split_rule_version) !== entry.value.splitRuleVersion ||
    row.is_private !== entry.value.isPrivate ||
    inputs.rows.length !== entry.value.fragmentIds.length ||
    inputs.rows.some(
      (input, index) =>
        canonicalUuid(input.fragment_id) !== entry.value.fragmentIds[index],
    ) ||
    JSON.stringify(actualRanges) !== JSON.stringify(entry.value.fragmentRanges)
  ) {
    throw new PostgresAdapterError();
  }
}

async function loadOneCurrentValue(
  client: PostgresClientBoundary,
  row: Row,
): Promise<Readonly<InformationEntryRevisionValue>> {
  const workspaceId = canonicalUuid(row.workspace_id);
  const entryId = canonicalUuid(row.entry_id);
  const [inputs, keywords, domains] = await Promise.all([
    client.query<Row>(READ_ENTRY_INPUTS_SQL, [workspaceId, entryId]),
    client.query<Row>(READ_ENTRY_KEYWORDS_SQL, [workspaceId, entryId]),
    client.query<Row>(READ_ENTRY_DOMAINS_SQL, [workspaceId, entryId]),
  ]);
  return mapRevisionValue(row, inputs.rows, keywords.rows, domains.rows);
}

function mapCurrentEntry(
  row: Row,
  inputRows: readonly Row[],
  keywordRows: readonly Row[],
  domainRows: readonly Row[],
): CurrentInformationEntry {
  const entryId = canonicalUuid(row.entry_id);
  const canonicalUri = optionalText(row.canonical_uri);
  const publishedAt = optionalTimestamp(row.published_at);
  return Object.freeze({
    workspaceId: canonicalUuid(row.workspace_id),
    entryId,
    resourceId: canonicalUuid(row.resource_id),
    snapshotId: canonicalUuid(row.snapshot_id),
    revision: integer(row.current_revision, 1),
    revisionId: canonicalUuid(row.current_revision_id),
    sourceKey: text(row.source_key),
    ...(canonicalUri === undefined ? {} : {canonicalUri}),
    capturedAt: timestamp(row.captured_at),
    ...(publishedAt === undefined ? {} : {publishedAt}),
    value: mapRevisionValue(
      row,
      inputRows.filter((candidate) => candidate.entry_id === entryId),
      keywordRows.filter((candidate) => candidate.entry_id === entryId),
      domainRows.filter((candidate) => candidate.entry_id === entryId),
    ),
  });
}

function mapRevisionValue(
  row: Row,
  inputRows: readonly Row[],
  keywordRows: readonly Row[],
  domainRows: readonly Row[],
): Readonly<InformationEntryRevisionValue> {
  if (typeof row.is_private !== 'boolean') throw new PostgresAdapterError();
  const typeKeyword =
    row.type_keyword === null
      ? undefined
      : enumValue(row.type_keyword, ENTRY_TYPE_KEYWORDS);
  const typeCustomName = optionalText(row.type_custom_name);
  const usefulnessScore = optionalAssessmentScore(row.usefulness_score);
  const interestScore = optionalAssessmentScore(row.interest_score);
  const fragmentRanges = mapFragmentRanges(inputRows);
  if (
    (typeKeyword === 'other') !== (typeCustomName !== undefined) ||
    inputRows.some(
      (candidate, index) => integer(candidate.input_ordinal) !== index,
    ) ||
    keywordRows.some(
      (candidate, index) => integer(candidate.keyword_ordinal) !== index,
    ) ||
    domainRows.some(
      (candidate, index) => integer(candidate.domain_ordinal) !== index,
    )
  ) {
    throw new PostgresAdapterError();
  }
  return Object.freeze({
    documentOrder: integer(row.document_order),
    titlePath: text(row.title_path),
    body: text(row.body),
    bodySha256: sha256(row.body_sha256),
    chunkMode: enumValue(row.chunk_mode, ENTRY_CHUNK_MODES),
    splitRuleVersion: text(row.split_rule_version),
    isPrivate: row.is_private,
    ...(typeKeyword === undefined ? {} : {typeKeyword}),
    ...(typeCustomName === undefined ? {} : {typeCustomName}),
    ...(usefulnessScore === undefined ? {} : {usefulnessScore}),
    ...(interestScore === undefined ? {} : {interestScore}),
    contentKeywords: Object.freeze(keywordRows.map(mapContentKeyword)),
    domains: Object.freeze(domainRows.map(mapDomain)),
    fragmentIds: Object.freeze(
      inputRows.map((candidate) => canonicalUuid(candidate.fragment_id)),
    ),
    ...(fragmentRanges === undefined ? {} : {fragmentRanges}),
  });
}

function mapFragmentRanges(inputRows: readonly Row[]):
  | readonly Readonly<{
      startCodePoint: number;
      endCodePoint: number;
    }>[]
  | undefined {
  const hasAnyRange = inputRows.some(
    (row) => row.start_code_point !== null || row.end_code_point !== null,
  );
  if (!hasAnyRange) return undefined;
  return Object.freeze(
    inputRows.map((row) => {
      if (row.start_code_point === null || row.end_code_point === null) {
        throw new PostgresAdapterError();
      }
      const startCodePoint = integer(row.start_code_point);
      const endCodePoint = integer(row.end_code_point, 1);
      if (endCodePoint <= startCodePoint) throw new PostgresAdapterError();
      return Object.freeze({startCodePoint, endCodePoint});
    }),
  );
}

function optionalAssessmentScore(
  value: unknown,
): EntryAssessmentScore | undefined {
  if (value === null) return undefined;
  const score = integer(value, 1);
  if (score > 5) throw new PostgresAdapterError();
  return score as EntryAssessmentScore;
}

function mapContentKeyword(row: Row): EntryContentKeyword {
  return Object.freeze({
    displayValue: text(row.display_value),
    normalizedValue: text(row.normalized_value),
    origin: enumValue(row.origin, ENTRY_ANNOTATION_ORIGINS),
    originVersion: text(row.origin_version),
  });
}

function mapDomain(row: Row): EntryDomainAssignment {
  const customName = optionalText(row.custom_name);
  const keyword = enumValue(row.domain_keyword, ENTRY_DOMAIN_KEYWORDS);
  if ((keyword === 'other') !== (customName !== undefined)) {
    throw new PostgresAdapterError();
  }
  return Object.freeze({
    keyword,
    ...(customName === undefined ? {} : {customName}),
    origin: enumValue(row.origin, ENTRY_ANNOTATION_ORIGINS),
    originVersion: text(row.origin_version),
  });
}

function sameRevisionValue(
  left: Readonly<InformationEntryRevisionValue>,
  right: Readonly<InformationEntryRevisionValue>,
): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function optionalTimestamp(value: unknown): string | undefined {
  return value === null ? undefined : timestamp(value);
}

function timestamp(value: unknown): string {
  const date = value instanceof Date ? value : new Date(text(value));
  if (Number.isNaN(date.getTime())) throw new PostgresAdapterError();
  return date.toISOString();
}
