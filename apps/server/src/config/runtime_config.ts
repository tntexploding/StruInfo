import {isAbsolute} from 'node:path';

import {
  decodePostgresConnectionUrl,
  PostgresConnectionConfigError,
  type PostgresConnectionConfig,
} from '../platform/database/postgresql/postgres_connection_config.js';

export type ProcessRole = 'api' | 'scheduler' | 'worker' | 'all';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface AiProposalProviderConfig {
  readonly providerKey: 'openai-responses-v1';
  readonly model: string;
  readonly apiKey: string;
  readonly maxOutputTokens: 800;
  readonly timeoutMs: 60_000;
}

export interface EmbeddingProviderConfig {
  readonly providerKey: 'openai-embeddings-v1';
  readonly model: string;
  readonly apiKey: string;
  readonly maximumBatchSize: 32;
  readonly timeoutMs: 60_000;
}

export interface RuntimeConfig {
  readonly role: ProcessRole;
  readonly database: Readonly<PostgresConnectionConfig>;
  readonly workspaceId: string;
  readonly dataRoot: string;
  readonly host: string;
  readonly port: number;
  readonly healthHost: string;
  readonly healthPort: number;
  readonly databaseReadinessTimeoutMs: number;
  readonly shutdownTimeoutMs: number;
  readonly logLevel: LogLevel;
  readonly aiProposalProvider?: Readonly<AiProposalProviderConfig>;
  readonly embeddingProvider?: Readonly<EmbeddingProviderConfig>;
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
const CANONICAL_UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;

export function parseRuntimeConfig(
  role: ProcessRole,
  environment: Readonly<Record<string, string | undefined>>,
): Readonly<RuntimeConfig> {
  const database = parseDatabaseConfig(environment.DATABASE_URL);
  const dataRoot = parseDataRoot(environment.STRUIINFO_DATA_ROOT);
  const workspaceId = parseWorkspaceId(environment.STRUIINFO_WORKSPACE_ID);
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
  const openAiApiKey = parseOpenAiApiKey(
    environment.OPENAI_API_KEY,
    environment.STRUIINFO_OPENAI_MODEL,
    environment.STRUIINFO_OPENAI_EMBEDDING_MODEL,
  );
  const aiProposalProvider = parseAiProposalProvider(
    openAiApiKey,
    environment.STRUIINFO_OPENAI_MODEL,
  );
  const embeddingProvider = parseEmbeddingProvider(
    openAiApiKey,
    environment.STRUIINFO_OPENAI_EMBEDDING_MODEL,
  );

  return Object.freeze({
    role,
    database,
    workspaceId,
    dataRoot,
    host,
    port,
    healthHost,
    healthPort,
    databaseReadinessTimeoutMs: DEFAULT_DATABASE_READINESS_TIMEOUT_MS,
    shutdownTimeoutMs,
    logLevel,
    ...(aiProposalProvider === undefined ? {} : {aiProposalProvider}),
    ...(embeddingProvider === undefined ? {} : {embeddingProvider}),
  });
}

function parseAiProposalProvider(
  apiKey: string | undefined,
  model: string | undefined,
): Readonly<AiProposalProviderConfig> | undefined {
  if (model === undefined) return undefined;
  if (apiKey === undefined || !validModel(model)) {
    throw new ConfigurationError(
      'OPENAI_API_KEY and STRUIINFO_OPENAI_MODEL must both be supplied to enable AI proposals.',
    );
  }
  return Object.freeze({
    providerKey: 'openai-responses-v1' as const,
    model,
    apiKey,
    maxOutputTokens: 800 as const,
    timeoutMs: 60_000 as const,
  });
}

function parseEmbeddingProvider(
  apiKey: string | undefined,
  model: string | undefined,
): Readonly<EmbeddingProviderConfig> | undefined {
  if (model === undefined) return undefined;
  if (apiKey === undefined || !validModel(model)) {
    throw new ConfigurationError(
      'OPENAI_API_KEY and STRUIINFO_OPENAI_EMBEDDING_MODEL must both be supplied to enable semantic search.',
    );
  }
  return Object.freeze({
    providerKey: 'openai-embeddings-v1' as const,
    model,
    apiKey,
    maximumBatchSize: 32 as const,
    timeoutMs: 60_000 as const,
  });
}

function parseOpenAiApiKey(
  apiKey: string | undefined,
  responseModel: string | undefined,
  embeddingModel: string | undefined,
): string | undefined {
  if (
    apiKey === undefined &&
    responseModel === undefined &&
    embeddingModel === undefined
  ) {
    return undefined;
  }
  if (
    apiKey === undefined ||
    (responseModel === undefined && embeddingModel === undefined) ||
    apiKey.length < 1 ||
    apiKey.length > 4_096 ||
    containsWhitespaceOrControl(apiKey)
  ) {
    throw new ConfigurationError(
      'OPENAI_API_KEY and at least one configured OpenAI model must be supplied together.',
    );
  }
  return apiKey;
}

function validModel(model: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$/u.test(model);
}

function containsWhitespaceOrControl(value: string): boolean {
  return Array.from(value).some((character) => {
    const codePoint = character.codePointAt(0);
    return (
      character.trim().length === 0 ||
      codePoint === undefined ||
      codePoint <= 0x1f ||
      codePoint === 0x7f
    );
  });
}
function parseWorkspaceId(value: string | undefined): string {
  if (value === undefined || !CANONICAL_UUID_PATTERN.test(value)) {
    throw new ConfigurationError(
      'STRUIINFO_WORKSPACE_ID must be a canonical lowercase UUID.',
    );
  }
  return value;
}

function parseDataRoot(value: string | undefined): string {
  if (value === undefined || value.trim() === '') {
    throw new ConfigurationError('STRUIINFO_DATA_ROOT is required.');
  }
  if (!isAbsolute(value)) {
    throw new ConfigurationError(
      'STRUIINFO_DATA_ROOT must be an absolute filesystem path.',
    );
  }
  return value;
}

function parseDatabaseConfig(
  value: string | undefined,
): Readonly<PostgresConnectionConfig> {
  try {
    return decodePostgresConnectionUrl(value, 'runtime');
  } catch (error) {
    if (!(error instanceof PostgresConnectionConfigError)) {
      throw error;
    }
    throw new ConfigurationError(
      'DATABASE_URL must be a valid single-host PostgreSQL connection URL with explicit credentials.',
    );
  }
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
