import {describe, it, expect} from 'vitest';
import {
  createSyntheticEvidenceCapture,
  SYNTHETIC_WORKSPACE_ID,
} from '../../../../test_support/synthetic_evidence_capture.js';
import {
  ingestionSettingsSchema,
  type IngestionOrigin,
} from '../../../application/ingestion_contract.js';
import {
  PostgresIngestionRepository,
  recordIngestionCapture,
} from './postgres_ingestion_repository.js';
import type {
  PostgresPoolBoundary,
  PostgresClientBoundary,
  PostgresQueryResult,
} from './postgres_pool.js';
const SUB = '00000000-0000-4000-8000-000000000003';
type Row = Readonly<Record<string, unknown>>;
class SqlFake implements PostgresClientBoundary, PostgresPoolBoundary {
  public calls: {sql: string; parameters: readonly unknown[]}[] = [];
  public constructor(
    private readonly handler: (sql: string) => {
      rows?: readonly Row[];
      rowCount?: number;
    } = () => ({rowCount: 1}),
  ) {}
  public query<R extends Row>(
    sql: string,
    parameters: readonly unknown[] = [],
  ): Promise<PostgresQueryResult<R>> {
    this.calls.push({sql, parameters});
    const refs = [...sql.matchAll(/\$(\d+)/g)].map((m) => Number(m[1]));
    expect(parameters).toHaveLength(Math.max(0, ...refs));
    const result = this.handler(sql);
    return Promise.resolve({
      rows: (result.rows ?? []) as readonly R[],
      rowCount: result.rowCount ?? result.rows?.length ?? 0,
    });
  }
  public executeSimple<R extends Row>(
    sql: string,
    parameters: readonly unknown[],
  ) {
    return this.query<R>(sql, parameters);
  }
  public connect() {
    return Promise.resolve(this);
  }
  public release() {
    return undefined;
  }
  public end() {
    return Promise.resolve();
  }
}
function row(settings: unknown) {
  return {
    current_version: 2,
    settings_text: JSON.stringify(ingestionSettingsSchema.parse(settings)),
    authorized_by_kind: 'owner',
    authorized_by_id: 'synthetic-owner',
  };
}
describe('PostgreSQL ingestion adapter', () => {
  it('keeps explicit historical backfills pending even under enabled automatic policy', async () => {
    const client = new SqlFake((sql) =>
      sql.startsWith('SELECT')
        ? {rows: [row({enabled: true, subscriptionIds: [SUB]})]}
        : {rowCount: 1},
    );
    await recordIngestionCapture(
      client,
      createSyntheticEvidenceCapture(),
      {kind: 'subscription', subscriptionId: SUB},
      {reviewOnly: true},
    );
    expect(client.calls).toHaveLength(1);
    expect(client.calls[0]?.sql).toContain('processing_document_intake');
    expect(JSON.parse(String(client.calls[0]?.parameters[2]))).toMatchObject({
      receipt: 'pending',
      captureOrigin: {kind: 'subscription', subscriptionId: SUB},
    });
    expect(
      client.calls.some((c) => c.sql.includes('processing_ingestion_item')),
    ).toBe(false);
  });

  it.each([
    [{enabled: false, manualUploads: true}, {kind: 'upload'}, false],
    [{enabled: true, manualUploads: false}, {kind: 'upload'}, false],
    [
      {enabled: true, subscriptionIds: [SUB]},
      {kind: 'subscription', subscriptionId: SUB},
      true,
    ],
    [
      {enabled: true, subscriptionIds: []},
      {kind: 'subscription', subscriptionId: SUB},
      false,
    ],
    [
      {enabled: true, paused: true, manualUploads: true},
      {kind: 'upload'},
      true,
    ],
  ])(
    'enqueues only new public material in saved scope (paused capture stays durable)',
    async (settings, origin, writes) => {
      const client = new SqlFake((sql) =>
        sql.startsWith('SELECT') ? {rows: [row(settings)]} : {rowCount: 1},
      );
      const capture = createSyntheticEvidenceCapture();
      await recordIngestionCapture(client, capture, origin as IngestionOrigin);
      const inserted = client.calls.find((c) =>
        c.sql.startsWith('INSERT INTO struinfo.processing_ingestion_item'),
      );
      const receipt = client.calls.find((c) =>
        c.sql.startsWith('INSERT INTO struinfo.processing_document_intake'),
      );
      expect(Boolean(receipt)).toBe(true);
      if (receipt)
        expect(JSON.parse(String(receipt.parameters[2]))).toMatchObject({
          captureOrigin: origin,
          receipt: 'pending',
          decision: 'pending',
          origin: 'system',
        });
      expect(Boolean(inserted)).toBe(writes);
      if (writes)
        expect(inserted?.parameters).toEqual([
          capture.workspaceId,
          capture.snapshot.snapshotId,
          origin.kind,
          'subscriptionId' in origin ? origin.subscriptionId : null,
          2,
          JSON.stringify(ingestionSettingsSchema.parse(settings)),
          'owner',
          'synthetic-owner',
        ]);
    },
  );
  it('does not read policy or enqueue private captures', async () => {
    const client = new SqlFake(),
      capture = createSyntheticEvidenceCapture();
    await recordIngestionCapture(
      client,
      {...capture, resource: {...capture.resource, isPrivate: true}},
      {kind: 'upload'},
    );
    expect(client.calls).toHaveLength(0);
  });
  it('persists policy identity and CAS parameters inside the workspace lock', async () => {
    const client = new SqlFake(),
      repo = new PostgresIngestionRepository(client, SYNTHETIC_WORKSPACE_ID);
    const settings = ingestionSettingsSchema.parse({});
    expect(
      await repo.savePolicy(0, settings, {
        kind: 'external_agent',
        id: 'synthetic-operator',
      }),
    ).toBe(true);
    expect(
      await repo.savePolicy(1, settings, {
        kind: 'owner',
        id: 'synthetic-owner',
      }),
    ).toBe(true);
    const inserted = client.calls.find((c) =>
      c.sql.startsWith('INSERT INTO struinfo.processing_ingestion_policy'),
    );
    expect(inserted?.parameters.slice(2)).toEqual([
      'external_agent',
      'synthetic-operator',
    ]);
    expect(client.calls[1]?.sql).toContain('pg_advisory_xact_lock');
    expect(client.calls.at(-1)?.sql).toBe('COMMIT');
  });
  it('reserves against the current daily limit under lock and aligns queue cursors with ordering', async () => {
    const client = new SqlFake((sql) =>
      sql.startsWith('SELECT status')
        ? {rows: [{status: 'pending', admitted_at: null}]}
        : sql.includes('SELECT current_version')
          ? {
              rows: [
                row({
                  enabled: true,
                  manualUploads: true,
                  maxDocumentsPerDay: 1,
                }),
              ],
            }
          : {rowCount: 1},
    );
    const repo = new PostgresIngestionRepository(
      client,
      SYNTHETIC_WORKSPACE_ID,
    );
    expect(await repo.reserve(SUB, 10)).toBe(true);
    const reserve = client.calls.find((c) => c.sql.startsWith('UPDATE'));
    expect(reserve?.parameters[2]).toBe(1);
    expect(reserve?.sql).toContain("AT TIME ZONE 'UTC'");
    await repo.list(
      false,
      10,
      {createdAt: '2040-01-01T00:00:00.000Z', snapshotId: SUB},
      'attention',
    );
    expect(client.calls.at(-1)?.sql).toContain(
      "d.state_text::jsonb->>'receipt' = 'rejected'",
    );
    expect(client.calls.at(-1)?.sql).toContain(
      'created_at DESC,snapshot_id DESC',
    );
    expect(client.calls.at(-1)?.parameters.slice(3)).toEqual([
      '2040-01-01T00:00:00.000Z',
      SUB,
      'attention',
    ]);
  });
});
