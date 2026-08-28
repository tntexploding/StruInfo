import {isIP} from 'node:net';

export const POSTGRES_STARTUP_OPTIONS =
  '-c role=none -c search_path=pg_catalog' as const;

export const POSTGRES_APPLICATION_NAMES = Object.freeze({
  migrator: 'struinfo-tm2-migrator',
  runtime: 'struinfo-tm2-runtime',
} as const);

export type PostgresConnectionPurpose = keyof typeof POSTGRES_APPLICATION_NAMES;

const DEFAULT_POSTGRES_PORT = 5_432;
const POSTGRES_ROLE_IDENTITIES = Object.freeze({
  migrator: 'struinfo_tm2_migrator',
  runtime: 'struinfo_tm2_runtime',
} as const satisfies Record<PostgresConnectionPurpose, string>);

/**
 * The only connection shape supplied to node-postgres in the single-host
 * boundary. It deliberately cannot carry a connection string or password
 * callback.
 */
export interface PostgresConnectionConfig {
  readonly host: string;
  readonly port: number;
  readonly database: string;
  readonly user: string;
  readonly password: string;
  readonly ssl: false;
  readonly application_name: string;
  readonly options: typeof POSTGRES_STARTUP_OPTIONS;
}

export class PostgresConnectionConfigError extends Error {
  public constructor() {
    super('PostgreSQL connection configuration is invalid.');
    this.name = 'PostgresConnectionConfigError';
  }
}

/**
 * Decodes one single-host PostgreSQL URL exactly once and discards the source URL.
 * The returned record is frozen, null-prototype, and contains only the eight
 * admitted node-postgres connection properties.
 */
export function decodePostgresConnectionUrl(
  input: unknown,
  purpose: PostgresConnectionPurpose,
): Readonly<PostgresConnectionConfig> {
  if (
    typeof input !== 'string' ||
    input.length === 0 ||
    input !== input.trim() ||
    !isUnicodeScalarSequence(input) ||
    hasRawDisallowedAscii(input) ||
    !Object.hasOwn(POSTGRES_APPLICATION_NAMES, purpose)
  ) {
    throw new PostgresConnectionConfigError();
  }

  const authority = serializedAuthority(input);
  const atIndex = authority.indexOf('@');
  if (
    atIndex <= 0 ||
    atIndex !== authority.lastIndexOf('@') ||
    !hasValidSerializedHostAndPort(authority.slice(atIndex + 1))
  ) {
    throw new PostgresConnectionConfigError();
  }
  const userInfo = authority.slice(0, atIndex);
  const passwordSeparator = userInfo.indexOf(':');
  if (passwordSeparator <= 0 || passwordSeparator === userInfo.length - 1) {
    throw new PostgresConnectionConfigError();
  }

  let parsed: URL;
  try {
    parsed = new URL(input);
  } catch {
    throw new PostgresConnectionConfigError();
  }

  if (
    (parsed.protocol !== 'postgres:' && parsed.protocol !== 'postgresql:') ||
    !isValidSingleHost(parsed.hostname) ||
    parsed.search !== '' ||
    parsed.hash !== '' ||
    parsed.username === '' ||
    parsed.password === ''
  ) {
    throw new PostgresConnectionConfigError();
  }

  const serializedDatabase = parsed.pathname.slice(1);
  if (
    !parsed.pathname.startsWith('/') ||
    serializedDatabase.length === 0 ||
    serializedDatabase.includes('/')
  ) {
    throw new PostgresConnectionConfigError();
  }

  const user = decodeComponent(parsed.username);
  const password = decodeComponent(parsed.password);
  const database = decodeComponent(serializedDatabase);
  if (
    user !== POSTGRES_ROLE_IDENTITIES[purpose] ||
    password.length === 0 ||
    database.length === 0 ||
    user.includes('\u0000') ||
    password.includes('\u0000') ||
    database.includes('\u0000') ||
    database.includes('/') ||
    database.includes('\\')
  ) {
    throw new PostgresConnectionConfigError();
  }

  const port = parsed.port === '' ? DEFAULT_POSTGRES_PORT : Number(parsed.port);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new PostgresConnectionConfigError();
  }

  const config = Object.create(null) as PostgresConnectionConfig;
  Object.defineProperties(config, {
    host: dataProperty(unbracketHost(parsed.hostname)),
    port: dataProperty(port),
    database: dataProperty(database),
    user: dataProperty(user),
    password: dataProperty(password),
    ssl: dataProperty(false),
    application_name: dataProperty(POSTGRES_APPLICATION_NAMES[purpose]),
    options: dataProperty(POSTGRES_STARTUP_OPTIONS),
  });
  return Object.freeze(config);
}

function isValidSingleHost(hostname: string): boolean {
  const unbracketed = unbracketHost(hostname);
  const ipVersion = isIP(unbracketed);
  if (ipVersion === 6) {
    return unbracketed !== '::';
  }
  if (ipVersion === 4) {
    return unbracketed !== '0.0.0.0';
  }
  if (
    hostname.length === 0 ||
    hostname.length > 253 ||
    hostname.includes(':') ||
    hostname.includes(',')
  ) {
    return false;
  }
  const dnsName = hostname.endsWith('.') ? hostname.slice(0, -1) : hostname;
  if (dnsName.length === 0) {
    return false;
  }
  return dnsName
    .split('.')
    .every(
      (label) =>
        label.length >= 1 &&
        label.length <= 63 &&
        /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u.test(label),
    );
}

function unbracketHost(hostname: string): string {
  return hostname.startsWith('[') && hostname.endsWith(']')
    ? hostname.slice(1, -1)
    : hostname;
}

function serializedAuthority(input: string): string {
  const schemeSeparator = input.indexOf('://');
  if (schemeSeparator <= 0) {
    throw new PostgresConnectionConfigError();
  }
  const start = schemeSeparator + 3;
  const endCandidates = [
    input.indexOf('/', start),
    input.indexOf('?', start),
    input.indexOf('#', start),
  ].filter((index) => index >= 0);
  const end =
    endCandidates.length === 0 ? input.length : Math.min(...endCandidates);
  return input.slice(start, end);
}

function decodeComponent(value: string): string {
  try {
    const decoded = decodeURIComponent(value);
    if (!isUnicodeScalarSequence(decoded)) {
      throw new PostgresConnectionConfigError();
    }
    return decoded;
  } catch (error) {
    if (error instanceof PostgresConnectionConfigError) {
      throw error;
    }
    throw new PostgresConnectionConfigError();
  }
}

function hasValidSerializedHostAndPort(value: string): boolean {
  if (value.startsWith('[')) {
    const bracket = value.indexOf(']');
    if (bracket < 0) {
      return false;
    }
    const suffix = value.slice(bracket + 1);
    return suffix === '' || /^:[0-9]+$/u.test(suffix);
  }
  const separator = value.indexOf(':');
  return (
    separator < 0 ||
    (separator === value.lastIndexOf(':') &&
      /^[0-9]+$/u.test(value.slice(separator + 1)))
  );
}

function isUnicodeScalarSequence(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (next < 0xdc00 || next > 0xdfff) {
        return false;
      }
      index += 1;
    } else if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) {
      return false;
    }
  }
  return true;
}

function dataProperty(value: unknown): PropertyDescriptor {
  return {
    value,
    enumerable: true,
    configurable: false,
    writable: false,
  };
}

function hasRawDisallowedAscii(value: string): boolean {
  for (const character of value) {
    const codePoint = character.codePointAt(0);
    if (codePoint !== undefined && (codePoint <= 0x20 || codePoint === 0x7f)) {
      return true;
    }
  }
  return false;
}
