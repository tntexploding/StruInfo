import {createRequire} from 'node:module';

import {Pool, type PoolClient, type QueryResult, type QueryResultRow} from 'pg';

import type {PostgresConnectionConfig} from './postgres_connection_config.js';

interface DrizzleSqlModule {
  readonly sql: Readonly<{
    raw(value: string): unknown;
    param(value: unknown): unknown;
    join(chunks: readonly unknown[]): unknown;
  }>;
}

interface DrizzleNodePostgresModule {
  drizzle(client: PoolClient): Readonly<{
    execute<Row extends QueryResultRow>(
      statement: unknown,
    ): Promise<QueryResult<Row>>;
  }>;
}

const moduleRequire = createRequire(import.meta.url);
const drizzleSql = loadDrizzleSqlModule().sql;
const drizzleNodePostgres = loadDrizzleNodePostgresModule();

export interface PostgresQueryResult<
  Row extends Readonly<Record<string, unknown>>,
> {
  readonly rows: readonly Row[];
  readonly rowCount: number | null;
}

export interface PostgresQueryable {
  query<Row extends Readonly<Record<string, unknown>>>(
    sql: string,
    parameters?: readonly unknown[],
  ): Promise<PostgresQueryResult<Row>>;
}

export interface PostgresClientBoundary extends PostgresQueryable {
  executeSimple<Row extends Readonly<Record<string, unknown>>>(
    statement: string,
    parameters: readonly unknown[],
  ): Promise<PostgresQueryResult<Row>>;
  release(): void;
}

export interface PostgresPoolBoundary extends PostgresQueryable {
  connect(): Promise<PostgresClientBoundary>;
  end(): Promise<void>;
}

export type PostgresPoolFactory = (
  config: Readonly<PostgresConnectionConfig>,
) => PostgresPoolBoundary;

export function createNodePostgresPool(
  config: Readonly<PostgresConnectionConfig>,
): PostgresPoolBoundary {
  return new OwnedNodePostgresPool(new Pool(config));
}

class OwnedNodePostgresPool implements PostgresPoolBoundary {
  readonly #pool: Pool;

  public constructor(pool: Pool) {
    this.#pool = pool;
  }

  public async query<Row extends Readonly<Record<string, unknown>>>(
    sql: string,
    parameters?: readonly unknown[],
  ): Promise<PostgresQueryResult<Row>> {
    return projectNodePostgresQueryResult(
      parameters === undefined
        ? await this.#pool.query<QueryResultRow>(sql)
        : await this.#pool.query<QueryResultRow>(sql, [...parameters]),
    );
  }

  public async connect(): Promise<PostgresClientBoundary> {
    const client = await this.#pool.connect();
    try {
      return new OwnedNodePostgresClient(client);
    } catch (error) {
      try {
        client.release();
      } catch {
        // The original adapter-construction failure remains the safe cause.
      }
      throw error;
    }
  }

  public async end(): Promise<void> {
    await this.#pool.end();
  }
}

class OwnedNodePostgresClient implements PostgresClientBoundary {
  readonly #client: PoolClient;
  readonly #database: ReturnType<DrizzleNodePostgresModule['drizzle']>;

  public constructor(client: PoolClient) {
    this.#client = client;
    this.#database = drizzleNodePostgres.drizzle(client);
  }

  public async query<Row extends Readonly<Record<string, unknown>>>(
    sql: string,
    parameters?: readonly unknown[],
  ): Promise<PostgresQueryResult<Row>> {
    return projectNodePostgresQueryResult(
      parameters === undefined
        ? await this.#client.query<QueryResultRow>(sql)
        : await this.#client.query<QueryResultRow>(sql, [...parameters]),
    );
  }

  public async executeSimple<Row extends Readonly<Record<string, unknown>>>(
    statement: string,
    parameters: readonly unknown[],
  ): Promise<PostgresQueryResult<Row>> {
    const result = await this.#database.execute<Row>(
      createDrizzleStatement(statement, parameters),
    );
    return projectNodePostgresQueryResult(result);
  }

  public release(): void {
    this.#client.release();
  }
}

function createDrizzleStatement(
  statement: string,
  parameters: readonly unknown[],
) {
  const chunks: unknown[] = [];
  let cursor = 0;
  const seen = new Set<number>();
  for (const match of statement.matchAll(/\$(\d+)/gu)) {
    const index = Number(match[1]) - 1;
    if (
      !Number.isSafeInteger(index) ||
      index < 0 ||
      index >= parameters.length
    ) {
      throw new Error('Invalid first-party PostgreSQL statement.');
    }
    chunks.push(drizzleSql.raw(statement.slice(cursor, match.index)));
    chunks.push(drizzleSql.param(parameters[index]));
    cursor = match.index + match[0].length;
    seen.add(index);
  }
  chunks.push(drizzleSql.raw(statement.slice(cursor)));
  if (
    seen.size !== parameters.length ||
    parameters.some((_value, index) => !seen.has(index))
  ) {
    throw new Error('Invalid first-party PostgreSQL statement.');
  }
  return drizzleSql.join(chunks);
}

function loadDrizzleSqlModule(): DrizzleSqlModule {
  const candidate = moduleRequire('drizzle-orm/sql') as unknown;
  const sqlCandidate =
    typeof candidate === 'object' && candidate !== null
      ? (Reflect.get(candidate, 'sql') as unknown)
      : undefined;
  if (
    typeof sqlCandidate !== 'function' ||
    typeof Reflect.get(sqlCandidate, 'raw') !== 'function' ||
    typeof Reflect.get(sqlCandidate, 'param') !== 'function' ||
    typeof Reflect.get(sqlCandidate, 'join') !== 'function'
  ) {
    throw new Error('The admitted Drizzle SQL module is unavailable.');
  }
  return candidate as DrizzleSqlModule;
}

function loadDrizzleNodePostgresModule(): DrizzleNodePostgresModule {
  const candidate = moduleRequire('drizzle-orm/node-postgres') as unknown;
  if (
    typeof candidate !== 'object' ||
    candidate === null ||
    !('drizzle' in candidate) ||
    typeof candidate.drizzle !== 'function'
  ) {
    throw new Error(
      'The admitted Drizzle node-postgres module is unavailable.',
    );
  }
  return candidate as DrizzleNodePostgresModule;
}

/** @internal Exported only for the node-postgres result-shape regression test. */
export function projectNodePostgresQueryResult<
  Row extends Readonly<Record<string, unknown>>,
>(
  result: QueryResult<QueryResultRow> | readonly QueryResult<QueryResultRow>[],
): PostgresQueryResult<Row> {
  const terminalResult = isNodePostgresQueryResultArray(result)
    ? result.at(-1)
    : result;
  if (terminalResult === undefined) {
    throw new Error('PostgreSQL returned no query result.');
  }
  return {
    rows: terminalResult.rows as Row[],
    rowCount: terminalResult.rowCount,
  };
}

function isNodePostgresQueryResultArray(
  result: QueryResult<QueryResultRow> | readonly QueryResult<QueryResultRow>[],
): result is readonly QueryResult<QueryResultRow>[] {
  return Array.isArray(result);
}
