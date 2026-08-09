export type ProcessRole = 'api' | 'scheduler' | 'worker' | 'all';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface RuntimeConfig {
  readonly role: ProcessRole;
  readonly databaseUrl: string;
  readonly host: string;
  readonly port: number;
  readonly healthHost: string;
  readonly healthPort: number;
  readonly databaseReadinessTimeoutMs: number;
  readonly shutdownTimeoutMs: number;
  readonly logLevel: LogLevel;
}

export class ConfigurationError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'ConfigurationError';
  }
}

const DEFAULT_DATABASE_READINESS_TIMEOUT_MS = 1_000;
const DEFAULT_HOST = '127.0.0.1';
const DEFAULT_PORT = 3_000;
const DEFAULT_SCHEDULER_HEALTH_PORT = 3_001;
const DEFAULT_WORKER_HEALTH_PORT = 3_002;
const DEFAULT_SHUTDOWN_TIMEOUT_MS = 10_000;
const MIN_SHUTDOWN_TIMEOUT_MS = 1_000;
const MAX_SHUTDOWN_TIMEOUT_MS = 60_000;
const MIN_PORT = 1;
const MAX_PORT = 65_535;
const LOG_LEVELS = new Set<LogLevel>(['debug', 'info', 'warn', 'error']);

export function parseRuntimeConfig(
  role: ProcessRole,
  environment: Readonly<Record<string, string | undefined>>,
): Readonly<RuntimeConfig> {
  const databaseUrl = parseDatabaseUrl(environment.DATABASE_URL);
  const host = parseHost('STRUIINFO_HOST', environment.STRUIINFO_HOST);
  const port = parseInteger(
    'STRUIINFO_PORT',
    environment.STRUIINFO_PORT,
    DEFAULT_PORT,
    MIN_PORT,
    MAX_PORT,
  );
  const healthHost = parseHost(
    'STRUIINFO_HEALTH_HOST',
    environment.STRUIINFO_HEALTH_HOST,
  );
  const healthPort = parseInteger(
    'STRUIINFO_HEALTH_PORT',
    environment.STRUIINFO_HEALTH_PORT,
    defaultHealthPort(role),
    MIN_PORT,
    MAX_PORT,
  );
  const shutdownTimeoutMs = parseInteger(
    'STRUIINFO_SHUTDOWN_TIMEOUT_MS',
    environment.STRUIINFO_SHUTDOWN_TIMEOUT_MS,
    DEFAULT_SHUTDOWN_TIMEOUT_MS,
    MIN_SHUTDOWN_TIMEOUT_MS,
    MAX_SHUTDOWN_TIMEOUT_MS,
  );
  const logLevel = parseLogLevel(environment.STRUIINFO_LOG_LEVEL);

  return Object.freeze({
    role,
    databaseUrl,
    host,
    port,
    healthHost,
    healthPort,
    databaseReadinessTimeoutMs: DEFAULT_DATABASE_READINESS_TIMEOUT_MS,
    shutdownTimeoutMs,
    logLevel,
  });
}

function parseDatabaseUrl(value: string | undefined): string {
  if (value === undefined || value.trim() === '') {
    throw new ConfigurationError('DATABASE_URL is required.');
  }

  try {
    const parsed = new URL(value);
    const hasSupportedProtocol =
      parsed.protocol === 'postgres:' || parsed.protocol === 'postgresql:';
    if (!hasSupportedProtocol || parsed.hostname === '') {
      throw new Error('unsupported database URL');
    }
  } catch {
    throw new ConfigurationError(
      'DATABASE_URL must be a valid PostgreSQL connection URL.',
    );
  }

  return value;
}

function parseHost(name: string, value: string | undefined): string {
  const host = value ?? DEFAULT_HOST;
  if (host.trim() === '' || /\s/u.test(host)) {
    throw new ConfigurationError(
      `${name} must be a non-empty host without whitespace.`,
    );
  }
  return host;
}

function parseInteger(
  name: string,
  rawValue: string | undefined,
  defaultValue: number,
  minimum: number,
  maximum: number,
): number {
  if (rawValue === undefined) {
    return defaultValue;
  }

  if (!/^(?:0|[1-9]\d*)$/u.test(rawValue)) {
    throw new ConfigurationError(
      `${name} must be an integer from ${String(minimum)} through ${String(maximum)}.`,
    );
  }

  const value = Number(rawValue);
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new ConfigurationError(
      `${name} must be an integer from ${String(minimum)} through ${String(maximum)}.`,
    );
  }
  return value;
}

function parseLogLevel(value: string | undefined): LogLevel {
  const logLevel = value ?? 'info';
  if (!LOG_LEVELS.has(logLevel as LogLevel)) {
    throw new ConfigurationError(
      'STRUIINFO_LOG_LEVEL must be one of debug, info, warn, or error.',
    );
  }
  return logLevel as LogLevel;
}

function defaultHealthPort(role: ProcessRole): number {
  return role === 'worker'
    ? DEFAULT_WORKER_HEALTH_PORT
    : DEFAULT_SCHEDULER_HEALTH_PORT;
}
