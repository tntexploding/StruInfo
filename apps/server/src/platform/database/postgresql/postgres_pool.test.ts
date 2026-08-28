import type {QueryResult, QueryResultRow} from 'pg';
import {describe, expect, it} from 'vitest';

import {projectNodePostgresQueryResult} from './postgres_pool.js';

function result(
  command: string,
  rows: QueryResultRow[],
  rowCount: number | null,
): QueryResult<QueryResultRow> {
  return {command, fields: [], oid: 0, rowCount, rows};
}

describe('node-postgres query-result projection', () => {
  it('projects ordinary single-statement results', () => {
    expect(
      projectNodePostgresQueryResult(result('SELECT', [{value: 1}], 1)),
    ).toEqual({rows: [{value: 1}], rowCount: 1});
  });

  it('projects the terminal result from a multi-statement simple query', () => {
    expect(
      projectNodePostgresQueryResult([
        result('BEGIN', [], null),
        result('CREATE', [], null),
        result('COMMIT', [], null),
      ]),
    ).toEqual({rows: [], rowCount: null});
  });

  it('rejects an impossible empty multi-statement result', () => {
    expect(() => projectNodePostgresQueryResult([])).toThrow(
      'PostgreSQL returned no query result.',
    );
  });
});
