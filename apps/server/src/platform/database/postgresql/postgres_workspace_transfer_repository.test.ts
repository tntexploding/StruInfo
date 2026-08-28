import {describe, expect, it, vi} from 'vitest';

import {M1C_DOMAIN_TABLES} from '../../../workspace_transfer/m1c_domain_bundle.js';
import {
  M1D_ASSOCIATION_BUNDLE_SCHEMA,
  M1D_ASSOCIATION_TABLES,
  normalizeM1dAssociationSnapshot,
} from '../../../workspace_transfer/m1d_association_bundle.js';
import {
  M1D_ENTRY_BUNDLE_SCHEMA,
  M1D_ENTRY_TABLES,
  normalizeM1dEntrySnapshot,
} from '../../../workspace_transfer/m1d_entry_bundle.js';
import {
  createEmptyM1cWorkspaceTransferSnapshot,
  type M1cWorkspaceTransferSnapshot,
} from '../../../workspace_transfer/m1c_workspace_transfer.js';
import type {
  PostgresClientBoundary,
  PostgresPoolBoundary,
  PostgresQueryResult,
} from './postgres_pool.js';
import {
  PostgresM1cDomainTransferRepository,
  READ_WORKSPACE_FOR_TRANSFER_SQL,
} from './postgres_workspace_transfer_repository.js';

const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';
const CREATED_AT = '2040-01-02T03:04:05.000Z';

describe('PostgresM1cDomainTransferRepository', () => {
  it('exports every domain table inside one repeatable-read snapshot', async () => {
    const {pool, statements, release} = createPool((sql) => {
      if (sql.includes('FROM struinfo.workspace AS t')) {
        return rows([
          {row_payload: {workspace_id: WORKSPACE_ID, created_at: CREATED_AT}},
        ]);
      }
      return rows([]);
    });
    const repository = new PostgresM1cDomainTransferRepository(pool);

    const snapshot = await repository.exportWorkspace(WORKSPACE_ID);

    expect(snapshot.domain.tables).toHaveLength(M1C_DOMAIN_TABLES.length);
    expect(snapshot.entries.tables).toHaveLength(M1D_ENTRY_TABLES.length);
    expect(snapshot.associations.tables).toHaveLength(
      M1D_ASSOCIATION_TABLES.length,
    );
    expect(snapshot.domain.tables[0]).toMatchObject({name: 'workspace'});
    expect(statements).toContainEqual(
      expect.stringContaining(
        'FROM struinfo.information_document_tag_value AS t',
      ),
    );
    expect(statements).toContainEqual(
      expect.stringContaining(
        'FROM struinfo.information_entry_association_override AS t',
      ),
    );
    expect(statements[0]).toBe(
      'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY',
    );
    expect(statements.at(-1)).toBe('COMMIT');
    expect(release).toHaveBeenCalledTimes(1);
  });

  it('restores all non-empty tables only when the workspace is absent', async () => {
    const {pool, statements, parameters} = createPool((sql) =>
      sql === READ_WORKSPACE_FOR_TRANSFER_SQL ? rows([]) : rows([]),
    );
    const repository = new PostgresM1cDomainTransferRepository(pool);
    const snapshot = createEmptyM1cWorkspaceTransferSnapshot(
      WORKSPACE_ID,
      CREATED_AT,
    );

    await repository.restoreEmptyWorkspace(WORKSPACE_ID, snapshot);

    expect(statements).toContain('SET CONSTRAINTS ALL DEFERRED');
    expect(statements).toContainEqual(
      expect.stringContaining(
        'jsonb_populate_recordset(NULL::struinfo.workspace, $1::jsonb)',
      ),
    );
    expect(parameters).toContainEqual([
      JSON.stringify(snapshot.domain.tables[0]?.rows),
    ]);
    expect(statements.at(-1)).toBe('COMMIT');
  });

  it('refuses to merge a Bundle into an existing workspace', async () => {
    const {pool, statements} = createPool((sql) =>
      sql === READ_WORKSPACE_FOR_TRANSFER_SQL
        ? rows([{workspace_id: WORKSPACE_ID}])
        : rows([]),
    );
    const repository = new PostgresM1cDomainTransferRepository(pool);

    await expect(
      repository.restoreEmptyWorkspace(
        WORKSPACE_ID,
        createEmptyM1cWorkspaceTransferSnapshot(WORKSPACE_ID, CREATED_AT),
      ),
    ).rejects.toEqual(expect.objectContaining({code: 'workspace_not_empty'}));
    expect(statements.some((sql) => sql.startsWith('INSERT INTO'))).toBe(false);
  });

  it('rolls back domain, Entry, and association rows together', async () => {
    const {pool, statements} = createPool((sql) => {
      if (sql === READ_WORKSPACE_FOR_TRANSFER_SQL) return rows([]);
      if (
        sql.startsWith(
          'INSERT INTO struinfo.information_entry_association_projection ',
        )
      ) {
        throw new Error('synthetic association restore failure');
      }
      return rows([]);
    });
    const repository = new PostgresM1cDomainTransferRepository(pool);

    await expect(
      repository.restoreEmptyWorkspace(
        WORKSPACE_ID,
        snapshotWithAssociation(WORKSPACE_ID, CREATED_AT),
      ),
    ).rejects.toMatchObject({code: 'repository_failed'});

    expect(statements).toContainEqual(
      expect.stringContaining('INSERT INTO struinfo.workspace '),
    );
    expect(statements).toContainEqual(
      expect.stringContaining('INSERT INTO struinfo.information_entry '),
    );
    expect(statements).toContainEqual(
      expect.stringContaining(
        'INSERT INTO struinfo.information_entry_association_projection ',
      ),
    );
    expect(statements.at(-1)).toBe('ROLLBACK');
  });
});

function snapshotWithEntry(
  workspaceId: string,
  createdAt: string,
): M1cWorkspaceTransferSnapshot {
  const empty = createEmptyM1cWorkspaceTransferSnapshot(workspaceId, createdAt);
  const entries = normalizeM1dEntrySnapshot({
    schemaVersion: M1D_ENTRY_BUNDLE_SCHEMA,
    tables: M1D_ENTRY_TABLES.map((descriptor) => ({
      name: descriptor.name,
      rows:
        descriptor.name === 'information_entry'
          ? [
              {
                workspace_id: workspaceId,
                entry_id: '33333333-3333-4333-8333-333333333333',
                resource_id: '44444444-4444-4444-8444-444444444444',
                snapshot_id: '55555555-5555-4555-8555-555555555555',
                current_revision: 1,
                current_revision_id: '66666666-6666-4666-8666-666666666666',
                document_order: 0,
                title_path: 'Synthetic Entry',
                body: 'Synthetic current body.',
                body_sha256: 'a'.repeat(64),
                chunk_mode: 'split',
                split_rule_version: 'synthetic-v1',
                is_private: false,
                is_current_structure: true,
                type_keyword: null,
                type_custom_name: null,
                usefulness_score: null,
                interest_score: null,
                created_at: createdAt,
                updated_at: createdAt,
              },
            ]
          : [],
    })),
  });
  return Object.freeze({
    domain: empty.domain,
    entries,
    associations: empty.associations,
    processing: empty.processing,
  });
}

function snapshotWithAssociation(
  workspaceId: string,
  createdAt: string,
): M1cWorkspaceTransferSnapshot {
  const base = snapshotWithEntry(workspaceId, createdAt);
  const associations = normalizeM1dAssociationSnapshot({
    schemaVersion: M1D_ASSOCIATION_BUNDLE_SCHEMA,
    tables: M1D_ASSOCIATION_TABLES.map((descriptor) => ({
      name: descriptor.name,
      rows:
        descriptor.name === 'information_entry_association_projection'
          ? [
              {
                workspace_id: workspaceId,
                entry_low_id: '33333333-3333-4333-8333-333333333333',
                entry_high_id: '77777777-7777-4777-8777-777777777777',
                entry_low_revision: 1,
                entry_low_revision_id: '66666666-6666-4666-8666-666666666666',
                entry_high_revision: 1,
                entry_high_revision_id: '88888888-8888-4888-8888-888888888888',
                content_similarity: 2500,
                type_similarity: 10000,
                domain_similarity: 5000,
                base_score: 4125,
                algorithm_version: 'synthetic-v1',
                candidate_basis: 'content_keyword,type_keyword',
                candidate_rank: 1,
                generated_at: createdAt,
              },
            ]
          : [],
    })),
  });
  return Object.freeze({...base, associations});
}

function createPool(
  resolveQuery: (
    sql: string,
    parameters: readonly unknown[],
  ) => PostgresQueryResult<Readonly<Record<string, unknown>>>,
): Readonly<{
  pool: PostgresPoolBoundary;
  statements: string[];
  parameters: readonly unknown[][];
  release: ReturnType<typeof vi.fn>;
}> {
  const statements: string[] = [];
  const parameters: unknown[][] = [];
  const release = vi.fn();
  const client: PostgresClientBoundary = {
    query<Row extends Readonly<Record<string, unknown>>>(
      sql: string,
      values: readonly unknown[] = [],
    ) {
      statements.push(sql);
      parameters.push([...values]);
      return Promise.resolve(
        resolveQuery(sql, values) as PostgresQueryResult<Row>,
      );
    },
    executeSimple: () => Promise.reject(new Error('unexpected executeSimple')),
    release,
  };
  return {
    statements,
    parameters,
    release,
    pool: {
      query: () => Promise.reject(new Error('unexpected pool query')),
      connect: () => Promise.resolve(client),
      end: () => Promise.resolve(),
    },
  };
}

function rows<Row extends Readonly<Record<string, unknown>>>(
  values: readonly Row[],
): PostgresQueryResult<Row> {
  return {rows: values, rowCount: values.length};
}
