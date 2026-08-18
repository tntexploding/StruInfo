import {describe, expect, it} from 'vitest';

import {
  createSyntheticEvidenceCapture,
  SYNTHETIC_WORKSPACE_ID,
} from '../../../../test_support/synthetic_evidence_capture.js';
import {computeEvidenceCaptureRequestSha256} from '../../../modules/evidence/index.js';
import {
  ACQUIRE_EVIDENCE_WORKSPACE_LOCK_SQL,
  INSERT_EVIDENCE_CAPTURE_COMMAND_SQL,
  PostgresEvidenceRepository,
  READ_EVIDENCE_CAPTURE_COMMAND_SQL,
  READ_EVIDENCE_WORKSPACE_SQL,
} from './index.js';
import type {
  PostgresClientBoundary,
  PostgresPoolBoundary,
  PostgresQueryResult,
} from './postgres_pool.js';
import {
  BEGIN_READ_COMMITTED_SQL,
  COMMIT_TRANSACTION_SQL,
  ROLLBACK_TRANSACTION_SQL,
} from './postgres_transaction.js';

type Row = Readonly<Record<string, unknown>>;
type QueryResponse = Readonly<{
  rows?: readonly Row[];
  rowCount?: number | null;
}>;

class FakeClient implements PostgresClientBoundary {
  public readonly calls: Readonly<{
    sql: string;
    parameters: readonly unknown[];
  }>[] = [];
  public releaseCalls = 0;

  public constructor(
    private readonly handler: (
      sql: string,
      parameters: readonly unknown[],
    ) => QueryResponse = defaultResponse,
  ) {}

  public query<ResultRow extends Row>(
    sql: string,
    parameters: readonly unknown[] = [],
  ): Promise<PostgresQueryResult<ResultRow>> {
    this.calls.push({sql, parameters});
    const response = this.handler(sql, parameters);
    return Promise.resolve({
      rows: (response.rows ?? []) as readonly ResultRow[],
      rowCount: response.rowCount ?? response.rows?.length ?? 0,
    });
  }

  public executeSimple<ResultRow extends Row>(
    statement: string,
    parameters: readonly unknown[],
  ): Promise<PostgresQueryResult<ResultRow>> {
    return this.query(statement, parameters);
  }

  public release(): void {
    this.releaseCalls += 1;
  }
}

class FakePool implements PostgresPoolBoundary {
  public constructor(private readonly client: PostgresClientBoundary | Error) {}

  public query<ResultRow extends Row>(): Promise<
    PostgresQueryResult<ResultRow>
  > {
    return Promise.resolve({rows: [], rowCount: 0});
  }

  public connect(): Promise<PostgresClientBoundary> {
    return this.client instanceof Error
      ? Promise.reject(this.client)
      : Promise.resolve(this.client);
  }

  public end(): Promise<void> {
    return Promise.resolve();
  }
}

describe('PostgreSQL evidence repository', () => {
  it('writes the complete graph in dependency order and commits once', async () => {
    const capture = createSyntheticEvidenceCapture();
    const client = new FakeClient();
    const repository = new PostgresEvidenceRepository(new FakePool(client));

    await expect(
      repository.saveCapture({
        capture,
        requestSha256: computeEvidenceCaptureRequestSha256(capture),
      }),
    ).resolves.toEqual({status: 'created'});

    const statements = client.calls.map(({sql}) => sql);
    expect(statements[0]).toBe(BEGIN_READ_COMMITTED_SQL);
    expect(statements[1]).toBe(ACQUIRE_EVIDENCE_WORKSPACE_LOCK_SQL);
    expect(statements.at(-1)).toBe(COMMIT_TRANSACTION_SQL);
    expect(statements).toContain(INSERT_EVIDENCE_CAPTURE_COMMAND_SQL);
    expect(statements.indexOf(INSERT_EVIDENCE_CAPTURE_COMMAND_SQL)).toBe(
      statements.length - 2,
    );
    expect(
      statements.some((sql) => sql.includes('struinfo.evidence_blob')),
    ).toBe(true);
    expect(statements.some((sql) => sql.includes('struinfo.media_usage'))).toBe(
      true,
    );
    expect(client.releaseCalls).toBe(1);
    expect(client.calls.every(({sql}) => !sql.includes('Synthetic body'))).toBe(
      true,
    );
  });

  it('returns existing without rewriting graph rows for an equal command replay', async () => {
    const capture = createSyntheticEvidenceCapture();
    const digest = computeEvidenceCaptureRequestSha256(capture);
    const client = new FakeClient((sql, parameters) => {
      if (sql === READ_EVIDENCE_CAPTURE_COMMAND_SQL) {
        return {rows: [{request_sha256: digest}]};
      }
      return defaultResponse(sql, parameters);
    });

    await expect(
      new PostgresEvidenceRepository(new FakePool(client)).saveCapture({
        capture,
        requestSha256: digest,
      }),
    ).resolves.toEqual({status: 'existing'});
    expect(
      client.calls.some(({sql}) => sql.includes('struinfo.evidence_blob')),
    ).toBe(false);
    expect(client.calls.at(-1)?.sql).toBe(COMMIT_TRANSACTION_SQL);
  });

  it('rolls back a changed same-key command without partial graph writes', async () => {
    const capture = createSyntheticEvidenceCapture();
    const client = new FakeClient((sql, parameters) => {
      if (sql === READ_EVIDENCE_CAPTURE_COMMAND_SQL) {
        return {rows: [{request_sha256: 'f'.repeat(64)}]};
      }
      return defaultResponse(sql, parameters);
    });

    await expect(
      new PostgresEvidenceRepository(new FakePool(client)).saveCapture({
        capture,
        requestSha256: computeEvidenceCaptureRequestSha256(capture),
      }),
    ).resolves.toEqual({status: 'conflict'});
    expect(client.calls.at(-1)?.sql).toBe(ROLLBACK_TRANSACTION_SQL);
    expect(
      client.calls.some(({sql}) =>
        sql.startsWith('INSERT INTO struinfo.resource'),
      ),
    ).toBe(false);
  });

  it('rolls back when an immutable stable identity resolves to different content', async () => {
    const capture = createSyntheticEvidenceCapture();
    const client = new FakeClient((sql, parameters) => {
      if (
        sql.startsWith('WITH expected') &&
        sql.includes('LEFT JOIN struinfo.resource AS stored')
      ) {
        return {rows: [{mismatch: 1}]};
      }
      return defaultResponse(sql, parameters);
    });

    await expect(
      new PostgresEvidenceRepository(new FakePool(client)).saveCapture({
        capture,
        requestSha256: computeEvidenceCaptureRequestSha256(capture),
      }),
    ).resolves.toEqual({status: 'conflict'});
    expect(client.calls.at(-1)?.sql).toBe(ROLLBACK_TRANSACTION_SQL);
    expect(client.calls).not.toContainEqual(
      expect.objectContaining({sql: INSERT_EVIDENCE_CAPTURE_COMMAND_SQL}),
    );
  });

  it('distinguishes an unavailable pool from a transactional failure', async () => {
    const capture = createSyntheticEvidenceCapture();
    const repository = new PostgresEvidenceRepository(
      new FakePool(new Error('Synthetic connection failure.')),
    );

    await expect(
      repository.saveCapture({
        capture,
        requestSha256: computeEvidenceCaptureRequestSha256(capture),
      }),
    ).rejects.toMatchObject({code: 'unavailable'});
  });
});

function defaultResponse(
  sql: string,
  parameters: readonly unknown[],
): QueryResponse {
  if (sql === READ_EVIDENCE_WORKSPACE_SQL) {
    return {rows: [{workspace_id: SYNTHETIC_WORKSPACE_ID}]};
  }
  if (sql === READ_EVIDENCE_CAPTURE_COMMAND_SQL) {
    return {rows: []};
  }
  if (sql.startsWith('INSERT INTO')) {
    const batch = parameters[1];
    return {rowCount: Array.isArray(batch) ? batch.length : 1};
  }
  return {rows: [], rowCount: 0};
}
