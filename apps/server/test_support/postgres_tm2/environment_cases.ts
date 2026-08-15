import {readFile, rm, writeFile} from 'node:fs/promises';
import {join} from 'node:path';

import {Client} from 'pg';

import {
  decodePostgresConnectionUrl,
  type PostgresConnectionConfig,
} from '../../src/platform/database/postgresql/index.js';

import {
  admitTm2Environment,
  auditClosedPgConfig,
  createPgPassLine,
  createPoisonPgPassLine,
  decodeTm2Url,
  sanitizePgEnvironment,
  TM2_APPLICATION_NAMES,
  TM2_ROLE_IDENTITIES,
  TM2_STARTUP_OPTIONS,
  type AcceptedTm2Url,
  type Tm2AdmissionCode,
  type Tm2Role,
} from './environment_oracle.js';
import type {Tm2MandatoryCase} from './mandatory_ledger.js';
import type {Tm2CaseEvidence, Tm2ExecutionContext} from './public_facade.js';
import {
  configsAreByteForByteEquivalent,
  Tm2SafeFailure,
} from './bound_runtime.js';
import type {BoundPostgresTm2Runtime} from './bound_runtime.js';

interface UrlCaseVector {
  readonly role: Tm2Role;
  readonly input: unknown;
  readonly expected: 'accepted' | Tm2AdmissionCode;
  readonly productComparable: boolean;
  readonly expectedDecodedPassword?: string;
}

const RUNTIME_PREFIX = 'postgres://struinfo_tm2_runtime:';
const RUNTIME_SUFFIX = '@127.0.0.1:5432/struinfo_tm2';

function runtimeUrl(password = 'synthetic%40secret'): string {
  return `${RUNTIME_PREFIX}${password}${RUNTIME_SUFFIX}`;
}

function productAccepts(input: unknown): boolean {
  try {
    decodePostgresConnectionUrl(input, 'runtime');
    return true;
  } catch {
    return false;
  }
}

function vectorFor(number: number): UrlCaseVector | undefined {
  const malformedRawHigh = `postgres://struinfo_tm2_runtime:synthetic${String.fromCharCode(0xd800)}secret@127.0.0.1/struinfo_tm2`;
  const malformedRawLow = `postgres://struinfo_tm2_runtime:synthetic${String.fromCharCode(0xdc00)}secret@127.0.0.1/struinfo_tm2`;
  const accepted = (
    input: string,
    expectedDecodedPassword?: string,
  ): UrlCaseVector => ({
    role: 'runtime',
    input,
    expected: 'accepted',
    productComparable: true,
    ...(expectedDecodedPassword === undefined ? {} : {expectedDecodedPassword}),
  });
  const rejected = (
    input: unknown,
    expected: Tm2AdmissionCode,
    productComparable = true,
  ): UrlCaseVector => ({
    role: 'runtime',
    input,
    expected,
    productComparable,
  });
  const vectors = new Map<number, UrlCaseVector>([
    [1, accepted(runtimeUrl())],
    [2, accepted(runtimeUrl().replace('postgres:', 'postgresql:'))],
    [3, accepted(runtimeUrl())],
    [4, accepted(runtimeUrl().replace('127.0.0.1', '[::1]'))],
    [5, accepted(runtimeUrl().replace('127.0.0.1', 'localhost'))],
    [6, accepted(runtimeUrl().replace(':5432/', '/'))],
    [7, accepted(runtimeUrl().replace(':5432/', ':1/'))],
    [8, accepted(runtimeUrl().replace(':5432/', ':65535/'))],
    [9, rejected(` ${runtimeUrl()}`, 'tm2_url_whitespace')],
    [10, rejected(`${runtimeUrl()} `, 'tm2_url_whitespace')],
    [11, rejected(runtimeUrl('synthetic\tsecret'), 'tm2_url_raw_character')],
    [
      12,
      rejected(
        runtimeUrl(`synthetic${String.fromCharCode(0x7f)}secret`),
        'tm2_url_raw_character',
      ),
    ],
    [
      13,
      rejected(
        runtimeUrl().replace('struinfo_tm2_runtime', 'wrong_role'),
        'tm2_url_username',
        false,
      ),
    ],
    [
      14,
      rejected(
        runtimeUrl().replace('struinfo_tm2_runtime', ''),
        'tm2_url_username',
        false,
      ),
    ],
    [
      15,
      rejected(
        runtimeUrl().replace('struinfo_tm2_runtime', 'struinfo_tm2_%'),
        'tm2_url_percent_encoding',
      ),
    ],
    [
      16,
      rejected(
        runtimeUrl().replace('struinfo_tm2_runtime', 'struinfo_tm2_%C0%AF'),
        'tm2_url_percent_encoding',
      ),
    ],
    [
      17,
      {
        role: 'admin',
        input: 'postgres://struinfo_tm2_admin:synthetic@127.0.0.1/struinfo_tm2',
        expected: 'accepted',
        productComparable: false,
      },
    ],
    [
      18,
      {
        role: 'migration',
        input:
          'postgres://struinfo_tm2_migrator:synthetic@127.0.0.1/struinfo_tm2',
        expected: 'accepted',
        productComparable: false,
      },
    ],
    [19, accepted(runtimeUrl('synthetic'))],
    [
      20,
      rejected(
        'postgres://struinfo_tm2_runtime@127.0.0.1/struinfo_tm2',
        'tm2_url_password_missing',
      ),
    ],
    [
      21,
      {
        role: 'migration',
        input: 'postgres://struinfo_tm2_migrator@127.0.0.1/struinfo_tm2',
        expected: 'tm2_url_password_missing',
        productComparable: true,
      },
    ],
    [
      22,
      rejected(
        'postgres://struinfo_tm2_runtime@127.0.0.1/struinfo_tm2',
        'tm2_url_password_missing',
      ),
    ],
    [
      23,
      rejected(
        'postgres://struinfo_tm2_runtime:@127.0.0.1/struinfo_tm2',
        'tm2_url_password_empty',
      ),
    ],
    [
      24,
      {
        role: 'migration',
        input: 'postgres://struinfo_tm2_migrator:@127.0.0.1/struinfo_tm2',
        expected: 'tm2_url_password_empty',
        productComparable: true,
      },
    ],
    [
      25,
      rejected(
        'postgres://struinfo_tm2_runtime:@127.0.0.1/struinfo_tm2',
        'tm2_url_password_empty',
      ),
    ],
    [26, rejected(runtimeUrl('%00'), 'tm2_url_unicode')],
    [27, accepted(runtimeUrl('synthetic%40secret'), 'synthetic@secret')],
    [28, accepted(runtimeUrl('synthetic+secret'), 'synthetic+secret')],
    [29, accepted(runtimeUrl('synthetic%2Bsecret'), 'synthetic+secret')],
    [30, accepted(runtimeUrl('synthetic%2525secret'), 'synthetic%25secret')],
    [31, rejected(runtimeUrl('%'), 'tm2_url_percent_encoding')],
    [32, rejected(runtimeUrl('%0'), 'tm2_url_percent_encoding')],
    [33, rejected(runtimeUrl('%GG'), 'tm2_url_percent_encoding')],
    [34, rejected(runtimeUrl('%C0%AF'), 'tm2_url_percent_encoding')],
    [35, rejected(runtimeUrl('%E2%82'), 'tm2_url_percent_encoding')],
    [36, rejected(runtimeUrl('%ED%A0%80'), 'tm2_url_percent_encoding')],
    [37, rejected(runtimeUrl('%F4%90%80%80'), 'tm2_url_percent_encoding')],
    [38, rejected(runtimeUrl('synthetic%00secret'), 'tm2_url_unicode')],
    [39, rejected(malformedRawHigh, 'tm2_url_unicode')],
    [40, rejected(malformedRawLow, 'tm2_url_unicode')],
    [41, rejected(runtimeUrl('%ED%B0%80'), 'tm2_url_percent_encoding')],
    [42, accepted(runtimeUrl('J%CC%8C'), 'J\u030c')],
    [43, accepted(runtimeUrl('SyntheticSecret'), 'SyntheticSecret')],
    [44, accepted(runtimeUrl('%2525'), '%25')],
    [45, rejected(runtimeUrl().replace(':5432/', ':0/'), 'tm2_url_port')],
    [46, rejected(runtimeUrl().replace(':5432/', ':65536/'), 'tm2_url_port')],
    [47, rejected(runtimeUrl().replace(':5432/', ':x/'), 'tm2_url_port')],
    [48, rejected(runtimeUrl().replace(':5432/', ':/'), 'tm2_url_port')],
    [
      49,
      rejected(
        runtimeUrl().replace(/\/struinfo_tm2$/u, '/'),
        'tm2_url_database',
      ),
    ],
    [
      50,
      rejected(
        runtimeUrl().replace(/\/struinfo_tm2$/u, '/a/b'),
        'tm2_url_database',
      ),
    ],
    [
      51,
      rejected(
        runtimeUrl().replace(/\/struinfo_tm2$/u, '/a%2Fb'),
        'tm2_url_database',
      ),
    ],
    [
      52,
      rejected(
        runtimeUrl().replace(/\/struinfo_tm2$/u, '/a%5Cb'),
        'tm2_url_database',
      ),
    ],
    [
      53,
      rejected(
        runtimeUrl().replace(/\/struinfo_tm2$/u, '/a%00b'),
        'tm2_url_database',
      ),
    ],
    [54, rejected(`${runtimeUrl()}?host=localhost`, 'tm2_url_override')],
    [55, rejected(`${runtimeUrl()}?port=5432`, 'tm2_url_override')],
    [
      56,
      rejected(`${runtimeUrl()}?user=struinfo_tm2_runtime`, 'tm2_url_override'),
    ],
    [57, rejected(`${runtimeUrl()}?database=struinfo_tm2`, 'tm2_url_override')],
    [58, rejected(`${runtimeUrl()}?dbname=struinfo_tm2`, 'tm2_url_override')],
    [59, rejected(`${runtimeUrl()}?options=x`, 'tm2_url_override')],
    [60, rejected(`${runtimeUrl()}?service=x`, 'tm2_url_override')],
    [61, rejected(`${runtimeUrl()}?sslmode=disable`, 'tm2_url_override')],
    [62, rejected(`${runtimeUrl()}?synthetic=x`, 'tm2_url_override')],
    [63, rejected(`${runtimeUrl()}#synthetic`, 'tm2_url_override')],
    [
      64,
      rejected(
        'postgres://struinfo_tm2_runtime:x@%2Ftmp%2Fpostgres/struinfo_tm2',
        'tm2_url_host',
      ),
    ],
    [
      65,
      rejected(
        'postgres://struinfo_tm2_runtime:x@127.0.0.1,localhost/struinfo_tm2',
        'tm2_url_host',
      ),
    ],
    [
      66,
      rejected(
        'host=127.0.0.1 user=struinfo_tm2_runtime dbname=struinfo_tm2',
        'tm2_url_raw_character',
      ),
    ],
  ]);
  return vectors.get(number);
}

function evidence(
  row: Tm2MandatoryCase,
  assertionCount: number,
  suffix: string,
): Tm2CaseEvidence {
  return Object.freeze({
    caseId: row.id,
    vectorId: row.vectorId,
    assertionCount,
    safeEvidenceCodes: Object.freeze([`${row.id}:${suffix}`]),
  });
}

function assertCondition(condition: boolean, code: string): void {
  if (!condition) {
    throw new Tm2SafeFailure(code);
  }
}

function assertUrlVector(row: Tm2MandatoryCase, vector: UrlCaseVector): number {
  const observed = decodeTm2Url(vector.role, vector.input);
  if (vector.expected === 'accepted') {
    assertCondition(
      observed.status === 'accepted',
      `${row.id}:test_decoder_rejected`,
    );
    if (
      observed.status === 'accepted' &&
      vector.expectedDecodedPassword !== undefined
    ) {
      assertCondition(
        observed.config.password === vector.expectedDecodedPassword,
        `${row.id}:decoded_password_mismatch`,
      );
    }
  } else {
    assertCondition(
      observed.status === 'not_ready' && observed.code === vector.expected,
      `${row.id}:test_decoder_issue_mismatch`,
    );
  }
  if (vector.productComparable) {
    const productObserved = productAccepts(vector.input);
    assertCondition(
      productObserved === (vector.expected === 'accepted'),
      `${row.id}:product_decoder_parity`,
    );
  }
  return vector.productComparable ? 2 : 1;
}

function assertEndpointRule(row: Tm2MandatoryCase): number {
  const common = {
    STRUIINFO_TM2_ADMIN_DATABASE_URL:
      'postgres://struinfo_tm2_admin:a@127.0.0.1/struinfo_tm2',
    STRUIINFO_TM2_MIGRATION_DATABASE_URL:
      'postgres://struinfo_tm2_migrator:b@127.0.0.1/struinfo_tm2',
    STRUIINFO_TM2_RUNTIME_DATABASE_URL:
      'postgres://struinfo_tm2_runtime:c@127.0.0.1/struinfo_tm2',
  };
  const candidate =
    row.number === 67
      ? {
          ...common,
          STRUIINFO_TM2_RUNTIME_DATABASE_URL:
            common.STRUIINFO_TM2_RUNTIME_DATABASE_URL.replace(
              /\/struinfo_tm2$/u,
              '/other',
            ),
        }
      : {
          ...common,
          STRUIINFO_TM2_RUNTIME_DATABASE_URL:
            common.STRUIINFO_TM2_RUNTIME_DATABASE_URL.replace(
              'struinfo_tm2_runtime',
              'struinfo_tm2_migrator',
            ),
        };
  const observed = admitTm2Environment(candidate);
  assertCondition(
    observed.status === 'not_ready',
    `${row.id}:environment_admitted`,
  );
  return 1;
}

function productConfiguration(
  role: 'migration' | 'runtime',
): Readonly<PostgresConnectionConfig> {
  const variable =
    role === 'migration'
      ? 'STRUIINFO_TM2_MIGRATION_DATABASE_URL'
      : 'STRUIINFO_TM2_RUNTIME_DATABASE_URL';
  return decodePostgresConnectionUrl(
    process.env[variable],
    role === 'migration' ? 'migrator' : 'runtime',
  );
}

function acceptedForRole(
  context: Tm2ExecutionContext,
  role: 'migration' | 'runtime',
): AcceptedTm2Url {
  return context.admission[role];
}

function assertConfigCase(
  row: Tm2MandatoryCase,
  context: Tm2ExecutionContext,
): number {
  const role =
    row.number === 76 || row.number === 79 || row.number === 90
      ? 'migration'
      : 'runtime';
  const expected = acceptedForRole(context, role).config;
  const actual = productConfiguration(role);
  const descriptor = Object.getOwnPropertyDescriptor(actual, 'password');
  const keys = Reflect.ownKeys(actual);
  const checks = new Map<number, boolean>([
    [69, Object.getPrototypeOf(actual) === null],
    [70, keys.length === 8],
    [
      71,
      keys.every(
        (key) =>
          Object.getOwnPropertyDescriptor(actual, key)?.get === undefined,
      ),
    ],
    [72, keys.every((key) => typeof key === 'string')],
    [73, !Object.hasOwn(actual, 'connectionString')],
    [74, auditClosedPgConfig(actual).length === 0],
    [75, typeof actual.password === 'string' && actual.password.length > 0],
    [76, typeof actual.password === 'string' && actual.password.length > 0],
    [77, typeof actual.password === 'string' && actual.password.length > 0],
    [78, actual.password === expected.password],
    [79, actual.password === expected.password],
    [80, actual.password === expected.password],
    [81, typeof actual.password !== 'function'],
    [82, descriptor?.value !== null],
    [83, descriptor?.value !== undefined],
    [84, actual.host === expected.host],
    [85, actual.port === expected.port],
    [86, actual.database === expected.database],
    [87, actual.user === expected.user],
    [88, Object.getOwnPropertyDescriptor(actual, 'ssl')?.value === false],
    [89, actual.application_name === TM2_APPLICATION_NAMES.runtime],
    [90, actual.application_name === TM2_APPLICATION_NAMES.migration],
    [91, actual.application_name === TM2_APPLICATION_NAMES.runtime],
    [
      92,
      Object.getOwnPropertyDescriptor(actual, 'options')?.value ===
        TM2_STARTUP_OPTIONS,
    ],
    [
      93,
      Object.isFrozen(actual) &&
        configsAreByteForByteEquivalent(expected, actual),
    ],
    [94, descriptor?.writable === false && descriptor.configurable === false],
    [95, Object.getPrototypeOf(actual) === null],
    [
      96,
      keys.every(
        (key) =>
          Object.getOwnPropertyDescriptor(actual, key)?.get === undefined,
      ),
    ],
    [
      97,
      actual.password === expected.password &&
        descriptor?.value === expected.password,
    ],
    [
      98,
      !Object.hasOwn(actual, 'connectionString') &&
        (process.env.STRUIINFO_TM2_RUNTIME_DATABASE_URL === undefined ||
          !Object.values(actual).includes(
            process.env.STRUIINFO_TM2_RUNTIME_DATABASE_URL,
          )),
    ],
  ]);
  assertCondition(
    checks.get(row.number) === true,
    `${row.id}:config_assertion_failed`,
  );
  return 2;
}

async function connectWithConfig(
  config: Readonly<PostgresConnectionConfig>,
): Promise<boolean> {
  const client = new Client(config);
  try {
    await client.connect();
    await client.query('SELECT 1 AS synthetic_probe');
    return true;
  } catch {
    return false;
  } finally {
    try {
      await client.end();
    } catch {
      // Connection success/failure is the only assertion for this helper.
    }
  }
}

function withoutPassword(
  config: Readonly<PostgresConnectionConfig>,
): Readonly<Omit<PostgresConnectionConfig, 'password'>> {
  const {host, port, database, user, ssl, application_name, options} = config;
  return {
    host,
    port,
    database,
    user,
    ssl,
    application_name,
    options,
  };
}

async function withPoisonFiles(
  context: Tm2ExecutionContext,
  contents: string | undefined,
  work: () => Promise<boolean>,
): Promise<boolean> {
  const posix = join(context.poisonRoot, 'home', '.pgpass');
  const windows = join(
    context.poisonRoot,
    'app-data',
    'postgresql',
    'pgpass.conf',
  );
  const originalPosix = await readFile(posix, 'utf8');
  const originalWindows = await readFile(windows, 'utf8');
  try {
    if (contents === undefined) {
      await Promise.all([rm(posix, {force: true}), rm(windows, {force: true})]);
    } else {
      await Promise.all([
        writeFile(posix, contents, {encoding: 'utf8', mode: 0o600}),
        writeFile(windows, contents, {encoding: 'utf8'}),
      ]);
    }
    return await work();
  } finally {
    await Promise.all([
      writeFile(posix, originalPosix, {encoding: 'utf8', mode: 0o600}),
      writeFile(windows, originalWindows, {encoding: 'utf8'}),
    ]);
  }
}

async function assertAmbientCase(
  row: Tm2MandatoryCase,
  context: Tm2ExecutionContext,
): Promise<number> {
  const config = productConfiguration('runtime');
  const posix = join(context.poisonRoot, 'home', '.pgpass');
  const windows = join(
    context.poisonRoot,
    'app-data',
    'postgresql',
    'pgpass.conf',
  );
  if (row.number === 99) {
    assertCondition(
      process.env.HOME === join(context.poisonRoot, 'home'),
      `${row.id}:home_not_isolated`,
    );
  } else if (row.number === 100) {
    assertCondition(
      process.env.USERPROFILE === join(context.poisonRoot, 'user-profile'),
      `${row.id}:userprofile_not_isolated`,
    );
  } else if (row.number === 101) {
    assertCondition(
      process.env.APPDATA === join(context.poisonRoot, 'app-data'),
      `${row.id}:appdata_not_isolated`,
    );
  } else if (row.number === 102 || row.number === 103) {
    const contents = await readFile(
      row.number === 102 ? posix : windows,
      'utf8',
    );
    assertCondition(
      contents.includes(
        createPoisonPgPassLine(context.admission.runtime.config),
      ),
      `${row.id}:poison_record_missing`,
    );
    assertCondition(
      !contents.includes(config.password),
      `${row.id}:explicit_password_copied`,
    );
  } else if (row.number === 104) {
    const valid = `${createPgPassLine(config, config.password)}\n`;
    const connected = await withPoisonFiles(
      context,
      valid,
      async () =>
        await connectWithConfig(
          withoutPassword(config) as PostgresConnectionConfig,
        ),
    );
    assertCondition(connected, `${row.id}:poison_negative_control_invalid`);
  } else if (row.number >= 105 && row.number <= 107) {
    const poison =
      row.number === 107
        ? undefined
        : `${createPgPassLine(
            config,
            `synthetic-${String(row.number)}-poison`,
          )}\n`;
    const connected = await withPoisonFiles(
      context,
      poison,
      async () => await connectWithConfig(config),
    );
    assertCondition(connected, `${row.id}:explicit_password_not_authoritative`);
  } else if (row.number === 108) {
    assertCondition(
      !Object.keys(process.env).some(
        (key) => key.toLowerCase() === 'pgpassfile',
      ),
      `${row.id}:pgpassfile_present`,
    );
  } else if (row.number >= 109 && row.number <= 111) {
    assertCondition(
      !Object.keys(process.env).some((key) => /^pg/iu.test(key)),
      `${row.id}:ambient_pg_variable_present`,
    );
  } else if (row.number === 112) {
    const sentinel = sanitizePgEnvironment(
      {SYNTHETIC_SENTINEL: 'preserved', PGPASSWORD: 'forbidden'},
      {home: 'h', userProfile: 'u', appData: 'a'},
    );
    assertCondition(
      sentinel.SYNTHETIC_SENTINEL === 'preserved',
      `${row.id}:non_pg_environment_lost`,
    );
  } else {
    throw new Tm2SafeFailure(`${row.id}:ambient_case_unmapped`);
  }
  return row.number === 102 || row.number === 103 ? 2 : 1;
}

async function assertSessionCase(
  row: Tm2MandatoryCase,
  runtime: BoundPostgresTm2Runtime,
): Promise<number> {
  const sessions = {
    admin: await runtime.sessionIdentity('admin'),
    migration: await runtime.sessionIdentity('migration'),
    runtime: await runtime.sessionIdentity('runtime'),
  };
  const roles = ['admin', 'migration', 'runtime'] as const;
  const checks = [
    sessions.admin.sessionUser === TM2_ROLE_IDENTITIES.admin &&
      sessions.admin.currentUser === TM2_ROLE_IDENTITIES.admin,
    sessions.migration.sessionUser === TM2_ROLE_IDENTITIES.migration &&
      sessions.migration.currentUser === TM2_ROLE_IDENTITIES.migration,
    sessions.runtime.sessionUser === TM2_ROLE_IDENTITIES.runtime &&
      sessions.runtime.currentUser === TM2_ROLE_IDENTITIES.runtime,
    sessions.admin.roleSetting === 'none',
    sessions.migration.roleSetting === 'none',
    sessions.runtime.roleSetting === 'none',
    sessions.admin.databaseName === runtime.admission.admin.config.database,
    sessions.migration.databaseName ===
      runtime.admission.migration.config.database,
    sessions.runtime.databaseName === runtime.admission.runtime.config.database,
    roles.every((role) => sessions[role].serverAddress !== null) &&
      sessions.admin.serverAddress === sessions.migration.serverAddress &&
      sessions.migration.serverAddress === sessions.runtime.serverAddress,
    roles.every((role) => sessions[role].serverPort !== null) &&
      sessions.admin.serverPort === sessions.migration.serverPort &&
      sessions.migration.serverPort === sessions.runtime.serverPort,
    roles.every(
      (role) =>
        sessions[role].serverVersionNumber >= 180_000 &&
        sessions[role].serverVersionNumber < 190_000,
    ),
    roles.every((role) => sessions[role].serverEncoding === 'UTF8'),
    roles.every((role) => sessions[role].clientEncoding === 'UTF8'),
    roles.every((role) => sessions[role].standardConformingStrings === 'on'),
    new Set(roles.map((role) => sessions[role].sessionUser)).size === 3,
    roles.every(
      (role) =>
        sessions[role].databaseName === runtime.admission.admin.config.database,
    ),
    sessions.admin.timeZone === sessions.migration.timeZone &&
      sessions.migration.timeZone === sessions.runtime.timeZone,
  ];
  assertCondition(
    checks[row.number - 113] === true,
    `${row.id}:session_identity_mismatch`,
  );
  return 4;
}

export async function executeEnvironmentCase(
  row: Tm2MandatoryCase,
  context: Tm2ExecutionContext,
  runtime: () => BoundPostgresTm2Runtime,
): Promise<Tm2CaseEvidence> {
  if (row.number <= 66) {
    const vector = vectorFor(row.number);
    if (vector === undefined) {
      throw new Tm2SafeFailure(`${row.id}:url_case_unmapped`);
    }
    return evidence(row, assertUrlVector(row, vector), 'url_observed');
  }
  if (row.number <= 68) {
    return evidence(
      row,
      assertEndpointRule(row),
      'environment_closure_observed',
    );
  }
  if (row.number <= 98) {
    return evidence(
      row,
      assertConfigCase(row, context),
      'product_config_observed',
    );
  }
  if (row.number <= 112) {
    return evidence(
      row,
      await assertAmbientCase(row, context),
      'ambient_credential_observed',
    );
  }
  return evidence(
    row,
    await assertSessionCase(row, runtime()),
    'session_identity_observed',
  );
}
