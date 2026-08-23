import {describe, expect, it, vi} from 'vitest';

import type {
  PostgresClientBoundary,
  PostgresPoolBoundary,
  PostgresQueryResult,
} from './postgres_pool.js';
import {
  LIST_EVIDENCE_SNAPSHOTS_SQL,
  PostgresEvidenceReadRepository,
  READ_EVIDENCE_FRAGMENTS_SQL,
  READ_EVIDENCE_SNAPSHOT_SQL,
  READ_EVIDENCE_STRUCTURES_SQL,
} from './postgres_evidence_read_repository.js';
import {
  BEGIN_REPEATABLE_READ_ONLY_SQL,
  COMMIT_TRANSACTION_SQL,
} from './postgres_transaction.js';

const WORKSPACE_ID = '00000000-0000-4000-8000-000000000001';
const RESOURCE_ID = '00000000-0000-4000-8000-000000000002';
const SNAPSHOT_ID = '00000000-0000-4000-8000-000000000003';
const STRUCTURE_ID = '00000000-0000-4000-8000-000000000004';
const NODE_ID = '00000000-0000-4000-8000-000000000005';
const FRAGMENT_ID = '00000000-0000-4000-8000-000000000006';

type Row = Readonly<Record<string, unknown>>;

describe('Postgres product read repositories', () => {
  it('maps an immutable evidence snapshot and exact fragment locator', async () => {
    const snapshotRow = {
      workspace_id: WORKSPACE_ID,
      snapshot_id: SNAPSHOT_ID,
      resource_id: RESOURCE_ID,
      resource_kind: 'git_file',
      source_key: 'git:synthetic/issue.md',
      canonical_uri: 'https://example.invalid/issue.md',
      captured_at: new Date('2040-01-02T03:04:05Z'),
      published_at: null,
      published_timezone: null,
      published_precision: null,
      published_source_text: null,
      published_inferred: false,
      fragment_count: 1,
      raw_sha256: 'a'.repeat(64),
      canonical_content_sha256: 'b'.repeat(64),
      canonicalization_version: 'utf8-lf-v1',
      media_type: 'text/markdown',
      is_private: true,
    };
    const pool = createPool((sql) => {
      if (sql === LIST_EVIDENCE_SNAPSHOTS_SQL) return rows(snapshotRow);
      if (sql === READ_EVIDENCE_SNAPSHOT_SQL) return rows(snapshotRow);
      if (sql === READ_EVIDENCE_STRUCTURES_SQL) {
        return rows({
          workspace_id: WORKSPACE_ID,
          structure_id: STRUCTURE_ID,
          parser_name: 'struinfo-commonmark',
          parser_version: '1',
          text_normalization_version: 'utf8-lf-v1',
          text_blob_sha256: 'b'.repeat(64),
          text_blob_byte_length: '42',
          structure_sha256: 'c'.repeat(64),
        });
      }
      if (sql === READ_EVIDENCE_FRAGMENTS_SQL) {
        return rows({
          fragment_id: FRAGMENT_ID,
          structure_id: STRUCTURE_ID,
          node_id: NODE_ID,
          node_kind: 'section',
          code_point_start: '2',
          code_point_end: '9',
          line_start: 1,
          line_end: 2,
          selected_text_sha256: 'd'.repeat(64),
        });
      }
      return rows();
    });
    const repository = new PostgresEvidenceReadRepository(pool);

    await expect(repository.listSnapshots(WORKSPACE_ID)).resolves.toEqual([
      expect.objectContaining({
        workspaceId: WORKSPACE_ID,
        snapshotId: SNAPSHOT_ID,
        capturedAt: '2040-01-02T03:04:05.000Z',
        fragmentCount: 1,
        isPrivate: true,
      }),
    ]);
    await expect(
      repository.loadSnapshot(WORKSPACE_ID, SNAPSHOT_ID),
    ).resolves.toMatchObject({
      mediaType: 'text/markdown',
      isPrivate: true,
      structures: [
        {
          structureId: STRUCTURE_ID,
          textBlob: {digest: 'b'.repeat(64), byteLength: 42},
          fragments: [
            {
              fragmentId: FRAGMENT_ID,
              nodeKind: 'section',
              codePointRange: {start: 2, end: 9},
              lineRange: {start: 1, end: 2},
            },
          ],
        },
      ],
    });
  });
});

function createPool(
  respond: (
    sql: string,
    parameters?: readonly unknown[],
  ) => PostgresQueryResult<Row>,
): PostgresPoolBoundary {
  const client: PostgresClientBoundary = {
    query<QueryRow extends Row>(
      sql: string,
      parameters?: readonly unknown[],
    ): Promise<PostgresQueryResult<QueryRow>> {
      const result =
        sql === BEGIN_REPEATABLE_READ_ONLY_SQL || sql === COMMIT_TRANSACTION_SQL
          ? rows()
          : respond(sql, parameters);
      return Promise.resolve(result as PostgresQueryResult<QueryRow>);
    },
    executeSimple<QueryRow extends Row>(
      sql: string,
      parameters: readonly unknown[],
    ): Promise<PostgresQueryResult<QueryRow>> {
      return Promise.resolve(
        respond(sql, parameters) as PostgresQueryResult<QueryRow>,
      );
    },
    release: vi.fn(),
  };
  return {
    query<QueryRow extends Row>(
      sql: string,
      parameters?: readonly unknown[],
    ): Promise<PostgresQueryResult<QueryRow>> {
      return Promise.resolve(
        respond(sql, parameters) as PostgresQueryResult<QueryRow>,
      );
    },
    connect: () => Promise.resolve(client),
    end: () => Promise.resolve(),
  };
}

function rows(...values: readonly Row[]): PostgresQueryResult<Row> {
  return {rows: values, rowCount: values.length};
}
