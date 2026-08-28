import {createHash} from 'node:crypto';

export const TM2_URL_ENVIRONMENT_NAMES = [
  'STRUIINFO_TM2_ADMIN_DATABASE_URL',
  'STRUIINFO_TM2_MIGRATION_DATABASE_URL',
  'STRUIINFO_TM2_RUNTIME_DATABASE_URL',
] as const;

export type Tm2Role = 'admin' | 'migration' | 'runtime';

export const TM2_ROLE_IDENTITIES: Readonly<Record<Tm2Role, string>> =
  Object.freeze({
    admin: 'struinfo_tm2_admin',
    migration: 'struinfo_tm2_migrator',
    runtime: 'struinfo_tm2_runtime',
  });

export const TM2_APPLICATION_NAMES: Readonly<Record<Tm2Role, string>> =
  Object.freeze({
    admin: 'struinfo-tm2-admin',
    migration: 'struinfo-tm2-migrator',
    runtime: 'struinfo-tm2-runtime',
  });

export const TM2_STARTUP_OPTIONS =
  '-c role=none -c search_path=pg_catalog' as const;

export const TM2_PASSWORD_KNOWN_ANSWERS = Object.freeze([
  Object.freeze({
    serialized: 'synthetic%40secret',
    decoded: 'synthetic@secret',
  }),
  Object.freeze({serialized: 'synthetic+secret', decoded: 'synthetic+secret'}),
  Object.freeze({
    serialized: 'synthetic%2Bsecret',
    decoded: 'synthetic+secret',
  }),
  Object.freeze({
    serialized: 'synthetic%2525secret',
    decoded: 'synthetic%25secret',
  }),
]);

export type Tm2AdmissionCode =
  | 'tm2_url_missing'
  | 'tm2_url_not_string'
  | 'tm2_url_whitespace'
  | 'tm2_url_raw_character'
  | 'tm2_url_scheme'
  | 'tm2_url_authority'
  | 'tm2_url_username'
  | 'tm2_url_password_missing'
  | 'tm2_url_password_empty'
  | 'tm2_url_password_decoded_empty'
  | 'tm2_url_percent_encoding'
  | 'tm2_url_unicode'
  | 'tm2_url_host'
  | 'tm2_url_port'
  | 'tm2_url_database'
  | 'tm2_url_override';

export interface Tm2PgConfig {
  readonly host: string;
  readonly port: number;
  readonly database: string;
  readonly user: string;
  readonly password: string;
  readonly ssl: false;
  readonly application_name: string;
  readonly options: typeof TM2_STARTUP_OPTIONS;
}

export interface AcceptedTm2Url {
  readonly status: 'accepted';
  readonly role: Tm2Role;
  readonly authorityHost: '127.0.0.1' | '[::1]' | 'localhost';
  readonly config: Tm2PgConfig;
}

export interface RejectedTm2Url {
  readonly status: 'not_ready';
  readonly role: Tm2Role;
  readonly code: Tm2AdmissionCode;
}

export type Tm2UrlAdmission = AcceptedTm2Url | RejectedTm2Url;

export interface AcceptedTm2Environment {
  readonly status: 'accepted';
  readonly admin: AcceptedTm2Url;
  readonly migration: AcceptedTm2Url;
  readonly runtime: AcceptedTm2Url;
}

export interface RejectedTm2Environment {
  readonly status: 'not_ready';
  readonly code: Tm2AdmissionCode | 'tm2_endpoint_mismatch';
  readonly variable: (typeof TM2_URL_ENVIRONMENT_NAMES)[number];
}

export type Tm2EnvironmentAdmission =
  AcceptedTm2Environment | RejectedTm2Environment;

interface ParsedAuthority {
  readonly serializedUsername: string;
  readonly serializedPassword: string;
  readonly hasPasswordSeparator: boolean;
  readonly rawPort: string | undefined;
}

const roleByEnvironmentName: Readonly<
  Record<(typeof TM2_URL_ENVIRONMENT_NAMES)[number], Tm2Role>
> = Object.freeze({
  STRUIINFO_TM2_ADMIN_DATABASE_URL: 'admin',
  STRUIINFO_TM2_MIGRATION_DATABASE_URL: 'migration',
  STRUIINFO_TM2_RUNTIME_DATABASE_URL: 'runtime',
});

function hasOnlyUnicodeScalars(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (next < 0xdc00 || next > 0xdfff) {
        return false;
      }
      index += 1;
      continue;
    }
    if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) {
      return false;
    }
  }
  return true;
}

function containsForbiddenRawCharacter(value: string): boolean {
  for (const character of value) {
    const codePoint = character.codePointAt(0);
    if (codePoint === undefined || codePoint <= 0x20 || codePoint === 0x7f) {
      return true;
    }
  }
  return false;
}

function decodeComponentOnce(serialized: string):
  | {readonly status: 'decoded'; readonly value: string}
  | {
      readonly status: 'rejected';
      readonly code: 'tm2_url_percent_encoding' | 'tm2_url_unicode';
    } {
  let decoded: string;
  try {
    decoded = decodeURIComponent(serialized);
  } catch {
    return {status: 'rejected', code: 'tm2_url_percent_encoding'};
  }
  if (!hasOnlyUnicodeScalars(decoded)) {
    return {status: 'rejected', code: 'tm2_url_unicode'};
  }
  return {status: 'decoded', value: decoded};
}

function extractAuthority(value: string): ParsedAuthority | undefined {
  const schemeSeparator = value.indexOf('://');
  if (schemeSeparator < 0) {
    return undefined;
  }
  const authorityStart = schemeSeparator + 3;
  let authorityEnd = value.length;
  for (const delimiter of ['/', '?', '#']) {
    const candidate = value.indexOf(delimiter, authorityStart);
    if (candidate >= 0 && candidate < authorityEnd) {
      authorityEnd = candidate;
    }
  }
  const authority = value.slice(authorityStart, authorityEnd);
  const atIndex = authority.lastIndexOf('@');
  if (atIndex < 0) {
    return undefined;
  }
  const userInfo = authority.slice(0, atIndex);
  const hostAndPort = authority.slice(atIndex + 1);
  const passwordSeparator = userInfo.indexOf(':');
  const hasPasswordSeparator = passwordSeparator >= 0;
  const serializedUsername = hasPasswordSeparator
    ? userInfo.slice(0, passwordSeparator)
    : userInfo;
  const serializedPassword = hasPasswordSeparator
    ? userInfo.slice(passwordSeparator + 1)
    : '';

  let rawPort: string | undefined;
  if (hostAndPort.startsWith('[')) {
    const bracket = hostAndPort.indexOf(']');
    if (bracket < 0) {
      return undefined;
    }
    const suffix = hostAndPort.slice(bracket + 1);
    if (suffix !== '') {
      if (!suffix.startsWith(':')) {
        return undefined;
      }
      rawPort = suffix.slice(1);
    }
  } else {
    const colon = hostAndPort.lastIndexOf(':');
    if (colon >= 0) {
      rawPort = hostAndPort.slice(colon + 1);
    }
  }

  return {
    serializedUsername,
    serializedPassword,
    hasPasswordSeparator,
    rawPort,
  };
}

function createOwnedConfig(
  role: Tm2Role,
  values: {
    readonly host: string;
    readonly port: number;
    readonly database: string;
    readonly user: string;
    readonly password: string;
  },
): Tm2PgConfig {
  const config = Object.create(null) as Record<string, unknown>;
  const fields: Readonly<Record<keyof Tm2PgConfig, unknown>> = {
    host: values.host,
    port: values.port,
    database: values.database,
    user: values.user,
    password: values.password,
    ssl: false,
    application_name: TM2_APPLICATION_NAMES[role],
    options: TM2_STARTUP_OPTIONS,
  };
  for (const [key, fieldValue] of Object.entries(fields)) {
    Object.defineProperty(config, key, {
      value: fieldValue,
      enumerable: true,
      configurable: false,
      writable: false,
    });
  }
  return Object.freeze(config) as unknown as Tm2PgConfig;
}

function reject(role: Tm2Role, code: Tm2AdmissionCode): RejectedTm2Url {
  return {status: 'not_ready', role, code};
}

export function decodeTm2Url(role: Tm2Role, input: unknown): Tm2UrlAdmission {
  if (input === undefined || input === null) {
    return reject(role, 'tm2_url_missing');
  }
  if (typeof input !== 'string') {
    return reject(role, 'tm2_url_not_string');
  }
  if (input !== input.trim()) {
    return reject(role, 'tm2_url_whitespace');
  }
  if (!hasOnlyUnicodeScalars(input)) {
    return reject(role, 'tm2_url_unicode');
  }
  if (containsForbiddenRawCharacter(input)) {
    return reject(role, 'tm2_url_raw_character');
  }
  if (!input.startsWith('postgres://') && !input.startsWith('postgresql://')) {
    return reject(role, 'tm2_url_scheme');
  }

  const authority = extractAuthority(input);
  if (authority === undefined) {
    return reject(role, 'tm2_url_authority');
  }
  if (!authority.hasPasswordSeparator) {
    return reject(role, 'tm2_url_password_missing');
  }
  if (authority.serializedPassword === '') {
    return reject(role, 'tm2_url_password_empty');
  }
  if (authority.rawPort !== undefined && !/^[0-9]+$/.test(authority.rawPort)) {
    return reject(role, 'tm2_url_port');
  }
  if (authority.rawPort === '') {
    return reject(role, 'tm2_url_port');
  }
  if (authority.rawPort !== undefined) {
    const rawPort = Number(authority.rawPort);
    if (!Number.isInteger(rawPort) || rawPort < 1 || rawPort > 65_535) {
      return reject(role, 'tm2_url_port');
    }
  }

  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return reject(role, 'tm2_url_authority');
  }
  if (url.protocol !== 'postgres:' && url.protocol !== 'postgresql:') {
    return reject(role, 'tm2_url_scheme');
  }
  if (url.search !== '' || url.hash !== '') {
    return reject(role, 'tm2_url_override');
  }
  if (!['127.0.0.1', '[::1]', 'localhost'].includes(url.hostname)) {
    return reject(role, 'tm2_url_host');
  }

  const parsedPort = url.port === '' ? 5432 : Number(url.port);
  if (!Number.isInteger(parsedPort) || parsedPort < 1 || parsedPort > 65_535) {
    return reject(role, 'tm2_url_port');
  }

  const username = decodeComponentOnce(authority.serializedUsername);
  if (username.status === 'rejected') {
    return reject(role, username.code);
  }
  if (username.value !== TM2_ROLE_IDENTITIES[role]) {
    return reject(role, 'tm2_url_username');
  }

  const password = decodeComponentOnce(authority.serializedPassword);
  if (password.status === 'rejected') {
    return reject(role, password.code);
  }
  if (password.value === '') {
    return reject(role, 'tm2_url_password_decoded_empty');
  }
  if (password.value.includes('\u0000')) {
    return reject(role, 'tm2_url_unicode');
  }

  if (!url.pathname.startsWith('/')) {
    return reject(role, 'tm2_url_database');
  }
  const serializedDatabase = url.pathname.slice(1);
  if (serializedDatabase === '' || serializedDatabase.includes('/')) {
    return reject(role, 'tm2_url_database');
  }
  const database = decodeComponentOnce(serializedDatabase);
  if (database.status === 'rejected') {
    return reject(role, database.code);
  }
  if (
    database.value === '' ||
    database.value.includes('/') ||
    database.value.includes('\\') ||
    database.value.includes('\u0000')
  ) {
    return reject(role, 'tm2_url_database');
  }

  return {
    status: 'accepted',
    role,
    authorityHost: url.hostname as AcceptedTm2Url['authorityHost'],
    config: createOwnedConfig(role, {
      host: url.hostname === '[::1]' ? '::1' : url.hostname,
      port: parsedPort,
      database: database.value,
      user: username.value,
      password: password.value,
    }),
  };
}

export function admitTm2Environment(
  environment: Readonly<Record<string, string | undefined>>,
): Tm2EnvironmentAdmission {
  const admitted = new Map<Tm2Role, AcceptedTm2Url>();
  for (const variable of TM2_URL_ENVIRONMENT_NAMES) {
    const role = roleByEnvironmentName[variable];
    const result = decodeTm2Url(role, environment[variable]);
    if (result.status === 'not_ready') {
      return {status: 'not_ready', code: result.code, variable};
    }
    admitted.set(role, result);
  }

  const admin = admitted.get('admin');
  const migration = admitted.get('migration');
  const runtime = admitted.get('runtime');
  if (admin === undefined || migration === undefined || runtime === undefined) {
    throw new Error('TM2_ENVIRONMENT_ORACLE_INCOMPLETE');
  }
  const endpoint = `${admin.authorityHost}:${String(admin.config.port)}/${admin.config.database}`;
  for (const [variable, value] of [
    ['STRUIINFO_TM2_MIGRATION_DATABASE_URL', migration],
    ['STRUIINFO_TM2_RUNTIME_DATABASE_URL', runtime],
  ] as const) {
    const candidate = `${value.authorityHost}:${String(value.config.port)}/${value.config.database}`;
    if (candidate !== endpoint) {
      return {status: 'not_ready', code: 'tm2_endpoint_mismatch', variable};
    }
  }
  return {status: 'accepted', admin, migration, runtime};
}

export function auditClosedPgConfig(config: unknown): readonly string[] {
  if (typeof config !== 'object' || config === null) {
    return ['config_not_record'];
  }
  const expected = [
    'application_name',
    'database',
    'host',
    'options',
    'password',
    'port',
    'ssl',
    'user',
  ];
  const findings: string[] = [];
  if (Object.getPrototypeOf(config) !== null) {
    findings.push('config_prototype');
  }
  const keys = Reflect.ownKeys(config);
  if (keys.some((key) => typeof key === 'symbol')) {
    findings.push('config_symbol_key');
  }
  const strings = keys.filter((key): key is string => typeof key === 'string');
  const sorted = [...strings].sort();
  if (JSON.stringify(sorted) !== JSON.stringify(expected)) {
    findings.push('config_key_set');
  }
  for (const key of strings) {
    const descriptor = Object.getOwnPropertyDescriptor(config, key);
    if (
      descriptor === undefined ||
      !('value' in descriptor) ||
      descriptor.enumerable !== true
    ) {
      findings.push(`config_descriptor:${key}`);
    }
  }
  const password = Object.getOwnPropertyDescriptor(config, 'password');
  if (
    password === undefined ||
    !('value' in password) ||
    typeof password.value !== 'string' ||
    password.value.length === 0
  ) {
    findings.push('config_password');
  }
  if (Object.hasOwn(config, 'connectionString')) {
    findings.push('config_connection_string');
  }
  return Object.freeze(findings);
}

export function sanitizePgEnvironment(
  source: Readonly<Record<string, string | undefined>>,
  roots: {
    readonly home: string;
    readonly userProfile: string;
    readonly appData: string;
  },
): Record<string, string> {
  const result = Object.create(null) as Record<string, string>;
  for (const key of Object.keys(source)) {
    const value = source[key];
    if (!/^pg/i.test(key) && value !== undefined) {
      Object.defineProperty(result, key, {
        value,
        enumerable: true,
        configurable: true,
        writable: true,
      });
    }
  }
  result.HOME = roots.home;
  result.USERPROFILE = roots.userProfile;
  result.APPDATA = roots.appData;
  return result;
}

function escapePgPassField(value: string): string {
  return value.replaceAll('\\', '\\\\').replaceAll(':', '\\:');
}

export function createPoisonPgPassLine(config: Tm2PgConfig): string {
  return createPgPassLine(config, 'synthetic-poison-password');
}

export function createPgPassLine(
  config: Tm2PgConfig,
  password: string,
): string {
  return [
    config.host,
    String(config.port),
    config.database,
    config.user,
    password,
  ]
    .map(escapePgPassField)
    .join(':');
}

export function deriveWorkspaceLockKnownAnswer(workspaceId: string): {
  readonly digest: string;
  readonly firstEightBytes: string;
  readonly signedKey: string;
} {
  const name = `struinfo:workspace-write-lock:v1:${workspaceId}`;
  const digestBuffer = createHash('sha256').update(name, 'utf8').digest();
  const unsigned = digestBuffer.readBigUInt64BE(0);
  const signed = unsigned >= 1n << 63n ? unsigned - (1n << 64n) : unsigned;
  return {
    digest: digestBuffer.toString('hex'),
    firstEightBytes: digestBuffer.subarray(0, 8).toString('hex'),
    signedKey: signed.toString(10),
  };
}
