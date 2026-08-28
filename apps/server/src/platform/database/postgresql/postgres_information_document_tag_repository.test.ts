import {describe, expect, it, vi} from 'vitest';

import type {
  PostgresClientBoundary,
  PostgresPoolBoundary,
  PostgresQueryResult,
} from './postgres_pool.js';
import {
  PostgresInformationDocumentTagRepository,
  READ_CURRENT_INFORMATION_DOCUMENT_TAGS_SQL,
  READ_CURRENT_INFORMATION_DOCUMENT_TAG_VALUES_SQL,
} from './postgres_information_document_tag_repository.js';

const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';
const RESOURCE_ID = '22222222-2222-4222-8222-222222222222';
const SNAPSHOT_ID = '33333333-3333-4333-8333-333333333333';
const REVISION_ID = '44444444-4444-4444-8444-444444444444';

describe('PostgresInformationDocumentTagRepository', () => {
  it('loads the current versioned tag projection with transparent evidence metrics', async () => {
    const parameters: (readonly unknown[])[] = [];
    const pool = createPool((sql, values) => {
      if (values !== undefined) parameters.push(values);
      if (sql === READ_CURRENT_INFORMATION_DOCUMENT_TAGS_SQL) {
        return rows({
          workspace_id: WORKSPACE_ID,
          resource_id: RESOURCE_ID,
          snapshot_id: SNAPSHOT_ID,
          current_revision: 2,
          current_revision_id: REVISION_ID,
          revision_kind: 'manual',
          rule_version: 'manual-document-tag-editor.v1',
          is_private: false,
          entry_count: 3,
        });
      }
      if (sql === READ_CURRENT_INFORMATION_DOCUMENT_TAG_VALUES_SQL) {
        return rows({
          snapshot_id: SNAPSHOT_ID,
          revision_number: 2,
          tag_ordinal: 0,
          display_value: 'PostgreSQL',
          normalized_value: 'postgresql',
          origin: 'manual',
          full_text_occurrences: 4,
          entry_coverage_count: 2,
        });
      }
      return rows();
    });
    const repository = new PostgresInformationDocumentTagRepository(pool);

    await expect(
      repository.loadCurrentDocumentTags(WORKSPACE_ID, false),
    ).resolves.toEqual([
      {
        workspaceId: WORKSPACE_ID,
        resourceId: RESOURCE_ID,
        snapshotId: SNAPSHOT_ID,
        revision: 2,
        revisionId: REVISION_ID,
        value: {
          revisionKind: 'manual',
          ruleVersion: 'manual-document-tag-editor.v1',
          isPrivate: false,
          entryCount: 3,
          tags: [
            {
              displayValue: 'PostgreSQL',
              normalizedValue: 'postgresql',
              origin: 'manual',
              fullTextOccurrences: 4,
              entryCoverageCount: 2,
            },
          ],
        },
      },
    ]);
    expect(parameters).toContainEqual([WORKSPACE_ID, false]);
  });
});

function createPool(
  respond: (
    sql: string,
    parameters?: readonly unknown[],
  ) => PostgresQueryResult<Row>,
): PostgresPoolBoundary {
  const client: PostgresClientBoundary = {
    query<QueryRow extends Row>(sql: string, parameters?: readonly unknown[]) {
      return Promise.resolve(
        respond(sql, parameters) as PostgresQueryResult<QueryRow>,
      );
    },
    executeSimple: () => Promise.reject(new Error('unexpected executeSimple')),
    release: vi.fn(),
  };
  return {
    query: () => Promise.reject(new Error('unexpected pool query')),
    connect: () => Promise.resolve(client),
    end: () => Promise.resolve(),
  };
}

type Row = Readonly<Record<string, unknown>>;

function rows(...values: readonly Row[]): PostgresQueryResult<Row> {
  return {rows: values, rowCount: values.length};
}
