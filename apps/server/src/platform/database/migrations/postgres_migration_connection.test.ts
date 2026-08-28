import type {ClientConfig, FieldDef, QueryResult, QueryResultRow} from 'pg';
import {describe, expect, it} from 'vitest';

import {MigrationFailure} from './migration_log.js';
import {parseMigrationConfig} from './migration_config.js';
import {
  PgMigrationConnector,
  type PgClientBoundary,
} from './postgres_migration_connection.js';

const DATABASE_URL =
  'postgresql://struinfo_tm2_migrator:synthetic-pg-secret@localhost/struinfo';
const CONNECTION = parseMigrationConfig({
  STRUIINFO_MIGRATION_DATABASE_URL: DATABASE_URL,
}).connection;

class SyntheticPgClient implements PgClientBoundary {
  public connectCalls = 0;
  public endCalls = 0;
  public readonly queryCalls: {
    sql: string;
    parameters?: readonly unknown[];
  }[] = [];
  public connectFails = false;
  public endFails = false;

  public connect(): Promise<unknown> {
    this.connectCalls += 1;
    return this.connectFails
      ? Promise.reject(new Error(`raw connect ${DATABASE_URL}`))
      : Promise.resolve(this);
  }

  public end(): Promise<void> {
    this.endCalls += 1;
    return this.endFails
      ? Promise.reject(new Error(`raw end ${DATABASE_URL}`))
      : Promise.resolve();
  }

  public query<Row extends QueryResultRow>(
    sql: string,
    parameters?: unknown[],
  ): Promise<QueryResult<Row>> {
    this.queryCalls.push({
      sql,
      ...(parameters === undefined ? {} : {parameters: [...parameters]}),
    });
    return Promise.resolve({
      command: 'SELECT',
      rowCount: 0,
      oid: 0,
      fields: [] as FieldDef[],
      rows: [],
    });
  }
}

describe('PgMigrationConnector', () => {
  it('owns one pg client, forwards parameters, and closes idempotently', async () => {
    const client = new SyntheticPgClient();
    let receivedConfig: ClientConfig | undefined;
    const connector = new PgMigrationConnector((config) => {
      receivedConfig = config;
      return client;
    });

    const connection = await connector.connect(CONNECTION);
    const rows = await connection.query('SELECT $1::integer AS synthetic', [7]);
    await connection.close();
    await connection.close();

    expect(receivedConfig).toEqual({
      host: 'localhost',
      port: 5432,
      database: 'struinfo',
      user: 'struinfo_tm2_migrator',
      password: 'synthetic-pg-secret',
      ssl: false,
      application_name: 'struinfo-tm2-migrator',
      options: '-c role=none -c search_path=pg_catalog',
    });
    expect(client.connectCalls).toBe(1);
    expect(client.queryCalls).toEqual([
      {sql: 'SELECT $1::integer AS synthetic', parameters: [7]},
    ]);
    expect(rows).toEqual([]);
    expect(client.endCalls).toBe(1);
  });

  it('closes a client after connect failure and returns only a safe error', async () => {
    const client = new SyntheticPgClient();
    client.connectFails = true;
    const connector = new PgMigrationConnector(() => client);
    let failure: unknown;

    try {
      await connector.connect(CONNECTION);
    } catch (error) {
      failure = error;
    }

    expect(client.connectCalls).toBe(1);
    expect(client.endCalls).toBe(1);
    expect(failure).toBeInstanceOf(MigrationFailure);
    expect(failure).toMatchObject({
      record: {event: 'migration_connection_failed', outcome: 'failed'},
    });
    expect(String(failure)).not.toContain(DATABASE_URL);
    expect(String(failure)).not.toContain('synthetic-pg-secret');
  });

  it('stays fail-closed when both connect and cleanup fail', async () => {
    const client = new SyntheticPgClient();
    client.connectFails = true;
    client.endFails = true;

    await expect(
      new PgMigrationConnector(() => client).connect(CONNECTION),
    ).rejects.toMatchObject({
      record: {event: 'migration_connection_failed', outcome: 'failed'},
    });
    expect(client.endCalls).toBe(1);
  });
});
