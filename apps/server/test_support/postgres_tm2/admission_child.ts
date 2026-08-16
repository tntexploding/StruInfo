import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {types} from 'node:util';

import type {Client as PgClient, ClientConfig, QueryResultRow} from 'pg';

import {
  isTm2NativeError,
  runTm2AdmissionPreflight,
  Tm2AdmissionProbeError,
  type Tm2AdmissionConnectionConfigs,
  type Tm2AdmissionEnvironmentObservation,
  type Tm2AdmissionPreflightOutcome,
  type Tm2AdmissionRoleObservation,
  type Tm2AdmissionSessionObservation,
} from './admission_outcome.js';
import {
  admitTm2Environment,
  createPoisonPgPassLine,
  TM2_ROLE_IDENTITIES,
  type AcceptedTm2Environment,
  type Tm2PgConfig,
  type Tm2Role,
} from './environment_oracle.js';

interface SessionIdentityRow extends QueryResultRow {
  readonly session_user: string;
  readonly current_user: string;
  readonly role_setting: string;
  readonly database_name: string;
  readonly server_address: string | null;
  readonly server_port: number | null;
  readonly server_version_num: number;
  readonly server_encoding: string;
  readonly client_encoding: string;
  readonly time_zone: string;
  readonly standard_conforming_strings: string;
}

interface RoleRow extends QueryResultRow {
  readonly rolname: string;
  readonly rolcanlogin: boolean;
  readonly rolsuper: boolean;
  readonly rolcreaterole: boolean;
  readonly rolcreatedb: boolean;
  readonly rolreplication: boolean;
  readonly rolbypassrls: boolean;
}

interface CountRow extends QueryResultRow {
  readonly count: number;
}

interface DatabaseOwnerRow extends QueryResultRow {
  readonly owner: string;
}

type PgClientConstructor = new (config: ClientConfig) => PgClient;

const OPERATIONAL_CONNECTION_ERROR_CODES = new Set([
  '08000',
  '08001',
  '08003',
  '08004',
  '08006',
  '08007',
  '08P01',
  '28000',
  '28P01',
  '3D000',
  '42501',
  '53300',
  '57P03',
  'EAI_AGAIN',
  'ECONNREFUSED',
  'ECONNRESET',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'ENOTFOUND',
  'EPIPE',
  'ETIMEDOUT',
]);

export const TM2_OPERATIONAL_ERROR_MAX_DEPTH = 16;
export const TM2_OPERATIONAL_ERROR_MAX_MEMBERS = 256;

const SESSION_IDENTITY_SQL = `SELECT
  session_user::text AS session_user,
  current_user::text AS current_user,
  current_setting('role')::text AS role_setting,
  current_database()::text AS database_name,
  inet_server_addr()::text AS server_address,
  inet_server_port()::integer AS server_port,
  current_setting('server_version_num')::integer AS server_version_num,
  current_setting('server_encoding')::text AS server_encoding,
  current_setting('client_encoding')::text AS client_encoding,
  current_setting('TimeZone')::text AS time_zone,
  current_setting('standard_conforming_strings')::text AS standard_conforming_strings`;

function failed(
  code:
    | 'tm2_admission_environment_not_isolated'
    | 'tm2_admission_poison_fixture_invalid',
): Tm2AdmissionPreflightOutcome {
  return Object.freeze({status: 'failed', code});
}

function isolatedPoisonRoot(
  environment: Readonly<Record<string, string | undefined>>,
): string | undefined {
  const root = environment.STRUIINFO_TM2_POISON_ROOT;
  if (
    environment.STRUIINFO_TM2_ADMISSION_PREFLIGHT !== '1' ||
    root === undefined ||
    environment.HOME !== join(root, 'home') ||
    environment.USERPROFILE !== join(root, 'user-profile') ||
    environment.APPDATA !== join(root, 'app-data') ||
    Object.keys(environment).some((key) => /^pg/iu.test(key))
  ) {
    return undefined;
  }
  return root;
}

async function poisonFixtureIsExact(
  root: string,
  admission: AcceptedTm2Environment,
): Promise<boolean> {
  const expected = `${[
    admission.admin.config,
    admission.migration.config,
    admission.runtime.config,
  ]
    .map(createPoisonPgPassLine)
    .join('\n')}\n`;
  const [posix, windows] = await Promise.all([
    readFile(join(root, 'home', '.pgpass'), 'utf8'),
    readFile(join(root, 'app-data', 'postgresql', 'pgpass.conf'), 'utf8'),
  ]);
  return (
    posix === expected &&
    windows === expected &&
    [
      admission.admin.config,
      admission.migration.config,
      admission.runtime.config,
    ].every((config) => !expected.includes(config.password))
  );
}

function asClientConfig(config: Readonly<Tm2PgConfig>): ClientConfig {
  return config;
}

interface OperationalErrorTraversal {
  readonly seen: WeakSet<object>;
  remainingMembers: number;
}

function readClosedAggregateMembers(
  value: unknown,
  traversal: OperationalErrorTraversal,
  depth: number,
): readonly unknown[] | undefined {
  if (types.isProxy(value)) {
    return undefined;
  }
  if (
    !Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Array.prototype
  ) {
    return undefined;
  }
  const lengthDescriptor = Object.getOwnPropertyDescriptor(value, 'length');
  if (
    lengthDescriptor === undefined ||
    !('value' in lengthDescriptor) ||
    typeof lengthDescriptor.value !== 'number' ||
    !Number.isSafeInteger(lengthDescriptor.value) ||
    lengthDescriptor.value <= 0 ||
    lengthDescriptor.value > traversal.remainingMembers
  ) {
    return undefined;
  }
  const length = lengthDescriptor.value;
  const expectedKeys = new Set<string>([
    'length',
    ...Array.from({length}, (_, index) => String(index)),
  ]);
  const ownKeys = Reflect.ownKeys(value);
  if (
    ownKeys.length !== expectedKeys.size ||
    ownKeys.some((key) => typeof key !== 'string' || !expectedKeys.has(key))
  ) {
    return undefined;
  }
  traversal.remainingMembers -= length;
  const owned: unknown[] = [];
  for (let index = 0; index < length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (descriptor === undefined || !('value' in descriptor)) {
      return undefined;
    }
    owned.push(descriptor.value);
  }
  if (
    owned.some(
      (member) =>
        !isOperationalConnectionErrorMember(member, traversal, depth + 1),
    )
  ) {
    return undefined;
  }
  return Object.freeze(owned);
}

function isOperationalConnectionErrorMember(
  error: unknown,
  traversal: OperationalErrorTraversal,
  depth: number,
): boolean {
  if (types.isProxy(error)) {
    return false;
  }
  if (
    !isTm2NativeError(error) ||
    depth > TM2_OPERATIONAL_ERROR_MAX_DEPTH ||
    traversal.seen.has(error)
  ) {
    return false;
  }
  traversal.seen.add(error);
  if (error instanceof AggregateError) {
    const errorsDescriptor = Object.getOwnPropertyDescriptor(error, 'errors');
    return (
      errorsDescriptor !== undefined &&
      'value' in errorsDescriptor &&
      readClosedAggregateMembers(errorsDescriptor.value, traversal, depth) !==
        undefined
    );
  }
  const ownKeys = Reflect.ownKeys(error);
  if (ownKeys.some((key) => typeof key === 'symbol')) {
    return false;
  }
  const codeDescriptor = Object.getOwnPropertyDescriptor(error, 'code');
  return (
    codeDescriptor !== undefined &&
    'value' in codeDescriptor &&
    typeof codeDescriptor.value === 'string' &&
    OPERATIONAL_CONNECTION_ERROR_CODES.has(codeDescriptor.value)
  );
}

export function isTm2OperationalConnectionError(error: unknown): boolean {
  return isOperationalConnectionErrorMember(
    error,
    {
      seen: new WeakSet<object>(),
      remainingMembers: TM2_OPERATIONAL_ERROR_MAX_MEMBERS,
    },
    0,
  );
}

async function environmentQuery<Row extends QueryResultRow>(
  client: PgClient,
  sql: string,
): Promise<readonly Row[]> {
  try {
    const result = await client.query<Row>(sql);
    return result.rows;
  } catch (error) {
    if (isTm2OperationalConnectionError(error)) {
      throw new Tm2AdmissionProbeError('tm2_environment_probe_unavailable');
    }
    throw error;
  }
}

async function connectClient(
  Client: PgClientConstructor,
  config: Readonly<Tm2PgConfig>,
  variable:
    | 'STRUIINFO_TM2_ADMIN_DATABASE_URL'
    | 'STRUIINFO_TM2_MIGRATION_DATABASE_URL'
    | 'STRUIINFO_TM2_RUNTIME_DATABASE_URL',
): Promise<PgClient> {
  const client = new Client(asClientConfig(config));
  try {
    await client.connect();
    return client;
  } catch (error) {
    await client.end();
    if (isTm2OperationalConnectionError(error)) {
      throw new Tm2AdmissionProbeError('tm2_connection_unavailable', variable);
    }
    throw error;
  }
}

function projectSession(
  role: Tm2Role,
  row: SessionIdentityRow,
): Tm2AdmissionSessionObservation {
  return Object.freeze({
    role,
    sessionUser: row.session_user,
    currentUser: row.current_user,
    roleSetting: row.role_setting,
    databaseName: row.database_name,
    serverAddress: row.server_address,
    serverPort: row.server_port,
    serverVersionNumber: row.server_version_num,
    serverEncoding: row.server_encoding,
    clientEncoding: row.client_encoding,
    timeZone: row.time_zone,
    standardConformingStrings: row.standard_conforming_strings,
  });
}

function roleFromName(name: string): Tm2Role | undefined {
  for (const role of ['admin', 'migration', 'runtime'] as const) {
    if (TM2_ROLE_IDENTITIES[role] === name) {
      return role;
    }
  }
  return undefined;
}

function projectRole(row: RoleRow): Tm2AdmissionRoleObservation | undefined {
  const role = roleFromName(row.rolname);
  if (role === undefined) {
    return undefined;
  }
  return Object.freeze({
    role,
    name: row.rolname,
    canLogin: row.rolcanlogin,
    superuser: row.rolsuper,
    createRole: row.rolcreaterole,
    createDatabase: row.rolcreatedb,
    replication: row.rolreplication,
    bypassRowLevelSecurity: row.rolbypassrls,
  });
}

async function oneSession(
  role: Tm2Role,
  client: PgClient,
): Promise<Tm2AdmissionSessionObservation> {
  const rows = await environmentQuery<SessionIdentityRow>(
    client,
    SESSION_IDENTITY_SQL,
  );
  const row = rows[0];
  if (row === undefined) {
    throw new Error('TM2_SESSION_OBSERVATION_MISSING');
  }
  return projectSession(role, row);
}

async function inspectEnvironment(
  Client: PgClientConstructor,
  configs: Tm2AdmissionConnectionConfigs,
): Promise<Tm2AdmissionEnvironmentObservation> {
  const clients: PgClient[] = [];
  let observation: Tm2AdmissionEnvironmentObservation | undefined;
  let probeFailure: {readonly error: unknown} | undefined;
  try {
    const admin = await connectClient(
      Client,
      configs.admin,
      'STRUIINFO_TM2_ADMIN_DATABASE_URL',
    );
    clients.push(admin);
    const migration = await connectClient(
      Client,
      configs.migration,
      'STRUIINFO_TM2_MIGRATION_DATABASE_URL',
    );
    clients.push(migration);
    const runtime = await connectClient(
      Client,
      configs.runtime,
      'STRUIINFO_TM2_RUNTIME_DATABASE_URL',
    );
    clients.push(runtime);

    const [adminSession, migrationSession, runtimeSession] = await Promise.all([
      oneSession('admin', admin),
      oneSession('migration', migration),
      oneSession('runtime', runtime),
    ]);
    const roleRows = await environmentQuery<RoleRow>(
      admin,
      `SELECT
  rolname::text AS rolname,
  rolcanlogin,
  rolsuper,
  rolcreaterole,
  rolcreatedb,
  rolreplication,
  rolbypassrls
FROM pg_catalog.pg_roles
WHERE rolname IN ('struinfo_tm2_admin', 'struinfo_tm2_migrator', 'struinfo_tm2_runtime')
ORDER BY rolname`,
    );
    const directMembership = await environmentQuery<CountRow>(
      admin,
      `SELECT count(*)::integer AS count
FROM pg_catalog.pg_auth_members membership
JOIN pg_catalog.pg_roles member_role ON member_role.oid = membership.member
WHERE member_role.rolname IN ('struinfo_tm2_migrator', 'struinfo_tm2_runtime')`,
    );
    const databaseOwner = await environmentQuery<DatabaseOwnerRow>(
      admin,
      `SELECT owner_role.rolname::text AS owner
FROM pg_catalog.pg_database database_record
JOIN pg_catalog.pg_roles owner_role ON owner_role.oid = database_record.datdba
WHERE database_record.datname = current_database()`,
    );
    const runtimeSchemas = await environmentQuery<CountRow>(
      admin,
      `SELECT count(*)::integer AS count
FROM pg_catalog.pg_namespace namespace_record
JOIN pg_catalog.pg_roles owner_role ON owner_role.oid = namespace_record.nspowner
WHERE owner_role.rolname = 'struinfo_tm2_runtime'
  AND namespace_record.nspname !~ '^pg_(?:toast_)?temp_'`,
    );
    const runtimeObjects = await environmentQuery<CountRow>(
      admin,
      `SELECT count(*)::integer AS count
FROM pg_catalog.pg_class object_record
JOIN pg_catalog.pg_namespace namespace_record ON namespace_record.oid = object_record.relnamespace
JOIN pg_catalog.pg_roles owner_role ON owner_role.oid = object_record.relowner
WHERE owner_role.rolname = 'struinfo_tm2_runtime'
  AND namespace_record.nspname IN ('struinfo', 'struinfo_meta')`,
    );
    const runtimeSetRole = await environmentQuery<CountRow>(
      admin,
      `SELECT count(*)::integer AS count
FROM pg_catalog.pg_roles target_role
WHERE target_role.rolname <> 'struinfo_tm2_runtime'
  AND pg_catalog.pg_has_role('struinfo_tm2_runtime', target_role.oid, 'SET')`,
    );
    const projectSchemas = await environmentQuery<CountRow>(
      admin,
      `SELECT count(*)::integer AS count
FROM pg_catalog.pg_namespace
WHERE nspname IN ('struinfo', 'struinfo_meta')`,
    );

    const projectedRoles = roleRows
      .map(projectRole)
      .filter(
        (role): role is Tm2AdmissionRoleObservation => role !== undefined,
      );
    const owner = databaseOwner[0]?.owner;
    if (owner === undefined) {
      throw new Error('TM2_DATABASE_OWNER_OBSERVATION_MISSING');
    }
    observation = Object.freeze({
      sessions: Object.freeze({
        admin: adminSession,
        migration: migrationSession,
        runtime: runtimeSession,
      }),
      roles: Object.freeze(projectedRoles),
      directMembershipCount: directMembership[0]?.count ?? -1,
      databaseOwner: owner,
      runtimeOwnedNonTemporarySchemaCount: runtimeSchemas[0]?.count ?? -1,
      runtimeOwnedProjectObjectCount: runtimeObjects[0]?.count ?? -1,
      runtimeSetRoleCount: runtimeSetRole[0]?.count ?? -1,
      projectSchemaCount: projectSchemas[0]?.count ?? -1,
    });
  } catch (error) {
    probeFailure = {error};
  }

  const closed = await Promise.allSettled(
    clients.map(async (client) => {
      await client.end();
    }),
  );
  if (closed.some((result) => result.status === 'rejected')) {
    throw new Error('TM2_ADMISSION_CLIENT_CLEANUP_FAILED');
  }
  if (probeFailure !== undefined) {
    throw probeFailure.error;
  }
  if (observation === undefined) {
    throw new Error('TM2_ADMISSION_OBSERVATION_MISSING');
  }
  return observation;
}

export async function runTm2AdmissionChild(
  environment: Readonly<Record<string, string | undefined>>,
): Promise<Tm2AdmissionPreflightOutcome> {
  const poisonRoot = isolatedPoisonRoot(environment);
  if (poisonRoot === undefined) {
    return failed('tm2_admission_environment_not_isolated');
  }
  const testAdmission = admitTm2Environment(environment);
  if (
    testAdmission.status === 'accepted' &&
    !(await poisonFixtureIsExact(poisonRoot, testAdmission))
  ) {
    return failed('tm2_admission_poison_fixture_invalid');
  }

  const [
    {Client},
    {decodePostgresConnectionUrl, PostgresConnectionConfigError},
  ] = await Promise.all([
    import('pg'),
    import('../../src/platform/database/postgresql/index.js'),
  ]);
  return await runTm2AdmissionPreflight(environment, {
    decodeProductConfig(role, input) {
      return decodePostgresConnectionUrl(
        input,
        role === 'migration' ? 'migrator' : 'runtime',
      );
    },
    isProductConfigError(error) {
      return (
        !types.isProxy(error) &&
        isTm2NativeError(error) &&
        error instanceof PostgresConnectionConfigError
      );
    },
    async inspectEnvironment(_admission, configs) {
      return Object.freeze({
        observation: await inspectEnvironment(Client, configs),
      });
    },
  });
}
