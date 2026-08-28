import {tmpdir} from 'node:os';
import {join} from 'node:path';

import {describe, expect, it} from 'vitest';

import {
  ConfigurationError,
  parseRuntimeConfig,
  type ProcessRole,
} from './runtime_config.js';

const DATABASE_URL =
  'postgresql://struinfo_tm2_runtime:synthetic@127.0.0.1/struinfo';
const DATA_ROOT = join(tmpdir(), 'struinfo-synthetic-data');
const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';
const RUNTIME_ENVIRONMENT = {
  DATABASE_URL,
  STRUIINFO_DATA_ROOT: DATA_ROOT,
  STRUIINFO_WORKSPACE_ID: WORKSPACE_ID,
};

describe('parseRuntimeConfig', () => {
  it('parses defaults once into a frozen ordinary object', () => {
    const config = parseRuntimeConfig('api', RUNTIME_ENVIRONMENT);

    expect(config).toEqual({
      role: 'api',
      database: {
        host: '127.0.0.1',
        port: 5432,
        database: 'struinfo',
        user: 'struinfo_tm2_runtime',
        password: 'synthetic',
        ssl: false,
        application_name: 'struinfo-tm2-runtime',
        options: '-c role=none -c search_path=pg_catalog',
      },
      workspaceId: WORKSPACE_ID,
      dataRoot: DATA_ROOT,
      host: '127.0.0.1',
      port: 3000,
      healthHost: '127.0.0.1',
      healthPort: 3001,
      databaseReadinessTimeoutMs: 1000,
      shutdownTimeoutMs: 10000,
      logLevel: 'info',
    });
    expect(Object.isFrozen(config)).toBe(true);
    expect(Object.getPrototypeOf(config)).toBe(Object.prototype);
    expect(Object.getPrototypeOf(config.database)).toBeNull();
  });

  it.each([
    ['scheduler', 3001],
    ['worker', 3002],
    ['all', 3001],
  ] satisfies readonly [ProcessRole, number][])(
    'uses the frozen %s health-port default',
    (role, healthPort) => {
      expect(parseRuntimeConfig(role, RUNTIME_ENVIRONMENT).healthPort).toBe(
        healthPort,
      );
    },
  );

  it('accepts explicit valid values and inclusive boundaries', () => {
    const config = parseRuntimeConfig('worker', {
      DATABASE_URL:
        'postgres://struinfo_tm2_runtime:synthetic@localhost/database',
      STRUIINFO_DATA_ROOT: DATA_ROOT,
      STRUIINFO_WORKSPACE_ID: WORKSPACE_ID,
      STRUIINFO_HOST: 'localhost',
      STRUIINFO_PORT: '1',
      STRUIINFO_HEALTH_HOST: '::1',
      STRUIINFO_HEALTH_PORT: '65535',
      STRUIINFO_SHUTDOWN_TIMEOUT_MS: '60000',
      STRUIINFO_LOG_LEVEL: 'debug',
    });

    expect(config).toMatchObject({
      host: 'localhost',
      port: 1,
      healthHost: '::1',
      healthPort: 65535,
      shutdownTimeoutMs: 60000,
      logLevel: 'debug',
    });
    expect(
      parseRuntimeConfig('api', {
        DATABASE_URL,
        STRUIINFO_DATA_ROOT: DATA_ROOT,
        STRUIINFO_WORKSPACE_ID: WORKSPACE_ID,
        STRUIINFO_SHUTDOWN_TIMEOUT_MS: '1000',
      }).shutdownTimeoutMs,
    ).toBe(1000);
  });

  it('enables OpenAI proposals only from an explicit model and environment secret pair', () => {
    const config = parseRuntimeConfig('api', {
      ...RUNTIME_ENVIRONMENT,
      OPENAI_API_KEY: 'synthetic-openai-key',
      STRUIINFO_OPENAI_MODEL: 'gpt-5-mini',
    });

    expect(config.aiProposalProvider).toEqual({
      providerKey: 'openai-responses-v1',
      model: 'gpt-5-mini',
      apiKey: 'synthetic-openai-key',
      maxOutputTokens: 800,
      timeoutMs: 60_000,
    });
    expect(Object.isFrozen(config.aiProposalProvider)).toBe(true);
  });

  it('configures embeddings independently while sharing the environment-only secret', () => {
    const embeddingOnly = parseRuntimeConfig('api', {
      ...RUNTIME_ENVIRONMENT,
      OPENAI_API_KEY: 'synthetic-openai-key',
      STRUIINFO_OPENAI_EMBEDDING_MODEL: 'text-embedding-synthetic',
    });
    expect(embeddingOnly.aiProposalProvider).toBeUndefined();
    expect(embeddingOnly.embeddingProvider).toEqual({
      providerKey: 'openai-embeddings-v1',
      model: 'text-embedding-synthetic',
      apiKey: 'synthetic-openai-key',
      maximumBatchSize: 32,
      timeoutMs: 60_000,
    });

    const both = parseRuntimeConfig('api', {
      ...RUNTIME_ENVIRONMENT,
      OPENAI_API_KEY: 'synthetic-openai-key',
      STRUIINFO_OPENAI_MODEL: 'gpt-5-mini',
      STRUIINFO_OPENAI_EMBEDDING_MODEL: 'text-embedding-synthetic',
    });
    expect(both.aiProposalProvider).toBeDefined();
    expect(both.embeddingProvider).toBeDefined();
  });

  it('rejects an embedding model without the environment-only API key', () => {
    expect(() =>
      parseRuntimeConfig('api', {
        ...RUNTIME_ENVIRONMENT,
        STRUIINFO_OPENAI_EMBEDDING_MODEL: 'text-embedding-synthetic',
      }),
    ).toThrow('OPENAI_API_KEY and at least one configured OpenAI model');
  });

  it.each([
    {OPENAI_API_KEY: 'synthetic-openai-key'},
    {STRUIINFO_OPENAI_MODEL: 'gpt-5-mini'},
    {
      OPENAI_API_KEY: 'contains whitespace',
      STRUIINFO_OPENAI_MODEL: 'gpt-5-mini',
    },
    {
      OPENAI_API_KEY: 'synthetic-openai-key',
      STRUIINFO_OPENAI_MODEL: 'bad model',
    },
  ])('rejects partial or invalid OpenAI tag configuration', (provider) => {
    expect(() =>
      parseRuntimeConfig('api', {...RUNTIME_ENVIRONMENT, ...provider}),
    ).toThrow('OPENAI_API_KEY');
  });

  it('rejects a missing database URL', () => {
    expect(() =>
      parseRuntimeConfig('api', {STRUIINFO_DATA_ROOT: DATA_ROOT}),
    ).toThrow(
      'DATABASE_URL must be a valid single-host PostgreSQL connection URL',
    );
  });

  it('requires an absolute external data root', () => {
    expect(() => parseRuntimeConfig('api', {DATABASE_URL})).toThrow(
      new ConfigurationError('STRUIINFO_DATA_ROOT is required.'),
    );
    expect(() =>
      parseRuntimeConfig('api', {
        DATABASE_URL,
        STRUIINFO_DATA_ROOT: 'relative-data',
      }),
    ).toThrow('STRUIINFO_DATA_ROOT must be an absolute filesystem path.');
  });

  it('requires a canonical external workspace selector', () => {
    expect(() =>
      parseRuntimeConfig('api', {
        DATABASE_URL,
        STRUIINFO_DATA_ROOT: DATA_ROOT,
      }),
    ).toThrow(
      new ConfigurationError(
        'STRUIINFO_WORKSPACE_ID must be a canonical lowercase UUID.',
      ),
    );
    expect(() =>
      parseRuntimeConfig('api', {
        ...RUNTIME_ENVIRONMENT,
        STRUIINFO_WORKSPACE_ID: 'AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA',
      }),
    ).toThrow('STRUIINFO_WORKSPACE_ID');
  });

  it('rejects an invalid database URL without echoing it', () => {
    const injectedSecret = 'not-a-url-with-synthetic-password';
    const error = captureConfigurationError(() =>
      parseRuntimeConfig('api', {
        DATABASE_URL: injectedSecret,
        STRUIINFO_DATA_ROOT: DATA_ROOT,
        STRUIINFO_WORKSPACE_ID: WORKSPACE_ID,
      }),
    );

    expect(error.message).toBe(
      'DATABASE_URL must be a valid single-host PostgreSQL connection URL with explicit credentials.',
    );
    expect(error.message).not.toContain(injectedSecret);
  });

  it.each([
    ['STRUIINFO_PORT', '0'],
    ['STRUIINFO_PORT', '65536'],
    ['STRUIINFO_PORT', '3.5'],
    ['STRUIINFO_HEALTH_PORT', '-1'],
    ['STRUIINFO_SHUTDOWN_TIMEOUT_MS', '999'],
    ['STRUIINFO_SHUTDOWN_TIMEOUT_MS', '60001'],
  ])('rejects invalid numeric input for %s', (name, value) => {
    expect(() =>
      parseRuntimeConfig('api', {
        ...RUNTIME_ENVIRONMENT,
        [name]: value,
      }),
    ).toThrow(name);
  });

  it.each(['', 'host with spaces'])('rejects invalid host %j', (host) => {
    expect(() =>
      parseRuntimeConfig('api', {...RUNTIME_ENVIRONMENT, STRUIINFO_HOST: host}),
    ).toThrow('STRUIINFO_HOST');
  });

  it('rejects an unsupported log level', () => {
    expect(() =>
      parseRuntimeConfig('api', {
        DATABASE_URL,
        STRUIINFO_DATA_ROOT: DATA_ROOT,
        STRUIINFO_WORKSPACE_ID: WORKSPACE_ID,
        STRUIINFO_LOG_LEVEL: 'trace',
      }),
    ).toThrow('STRUIINFO_LOG_LEVEL');
  });
});

function captureConfigurationError(
  operation: () => unknown,
): ConfigurationError {
  try {
    operation();
  } catch (error) {
    if (error instanceof ConfigurationError) {
      return error;
    }
    throw error;
  }
  throw new Error('Expected configuration parsing to fail.');
}
