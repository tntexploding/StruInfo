import {
  Client,
  type ClientConfig,
  type QueryResult,
  type QueryResultRow,
} from 'pg';

import {MigrationFailure} from './migration_log.js';

export type MigrationRow = Readonly<Record<string, unknown>>;

export interface MigrationConnection {
  query(
    sql: string,
    parameters?: readonly unknown[],
  ): Promise<readonly MigrationRow[]>;
  close(): Promise<void>;
}

export interface MigrationConnector {
  connect(databaseUrl: string): Promise<MigrationConnection>;
}

export interface PgClientBoundary {
  connect(): Promise<unknown>;
  end(): Promise<void>;
  query<Row extends QueryResultRow>(
    sql: string,
    parameters?: unknown[],
  ): Promise<QueryResult<Row>>;
}

export type PgClientFactory = (config: ClientConfig) => PgClientBoundary;

type SafeQueryRow = QueryResultRow & Readonly<Record<string, unknown>>;

export class PgMigrationConnector implements MigrationConnector {
  readonly #clientFactory: PgClientFactory;

  public constructor(
    clientFactory: PgClientFactory = (config) => new Client(config),
  ) {
    this.#clientFactory = clientFactory;
  }

  public async connect(databaseUrl: string): Promise<MigrationConnection> {
    const client = this.#clientFactory({
      connectionString: databaseUrl,
      application_name: 'struinfo-migrate',
    });
    try {
      await client.connect();
    } catch {
      try {
        await client.end();
      } catch {
        // The safe connection failure below covers both acquisition attempts.
      }
      throw new MigrationFailure({
        event: 'migration_connection_failed',
        outcome: 'failed',
      });
    }
    return new PgOwnedMigrationConnection(client);
  }
}

class PgOwnedMigrationConnection implements MigrationConnection {
  readonly #client: PgClientBoundary;
  #closed = false;

  public constructor(client: PgClientBoundary) {
    this.#client = client;
  }

  public async query(
    sql: string,
    parameters?: readonly unknown[],
  ): Promise<readonly MigrationRow[]> {
    const result =
      parameters === undefined
        ? await this.#client.query<SafeQueryRow>(sql)
        : await this.#client.query<SafeQueryRow>(sql, [...parameters]);
    return result.rows;
  }

  public async close(): Promise<void> {
    if (this.#closed) {
      return;
    }
    this.#closed = true;
    await this.#client.end();
  }
}
