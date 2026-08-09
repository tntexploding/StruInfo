import {describe, expect, it} from 'vitest';

import {
  ConfigurationError,
  parseRuntimeConfig,
  type ProcessRole,
} from './runtime_config.js';

const DATABASE_URL = 'postgresql://runtime:synthetic@127.0.0.1/struinfo';

describe('parseRuntimeConfig', () => {
  it('parses defaults once into a frozen ordinary object', () => {
    const config = parseRuntimeConfig('api', {DATABASE_URL});

    expect(config).toEqual({
      role: 'api',
      databaseUrl: DATABASE_URL,
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
  });

  it.each([
    ['scheduler', 3001],
    ['worker', 3002],
    ['all', 3001],
  ] satisfies readonly [ProcessRole, number][])(
    'uses the frozen %s health-port default',
    (role, healthPort) => {
      expect(parseRuntimeConfig(role, {DATABASE_URL}).healthPort).toBe(
        healthPort,
      );
    },
  );

  it('accepts explicit valid values and inclusive boundaries', () => {
    const config = parseRuntimeConfig('worker', {
      DATABASE_URL: 'postgres://runtime@localhost/database',
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
        STRUIINFO_SHUTDOWN_TIMEOUT_MS: '1000',
      }).shutdownTimeoutMs,
    ).toBe(1000);
  });

  it('rejects a missing database URL', () => {
    expect(() => parseRuntimeConfig('api', {})).toThrow(
      new ConfigurationError('DATABASE_URL is required.'),
    );
  });

  it('rejects an invalid database URL without echoing it', () => {
    const injectedSecret = 'not-a-url-with-synthetic-password';
    const error = captureConfigurationError(() =>
      parseRuntimeConfig('api', {DATABASE_URL: injectedSecret}),
    );

    expect(error.message).toBe(
      'DATABASE_URL must be a valid PostgreSQL connection URL.',
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
      parseRuntimeConfig('api', {DATABASE_URL, [name]: value}),
    ).toThrow(name);
  });

  it.each(['', 'host with spaces'])('rejects invalid host %j', (host) => {
    expect(() =>
      parseRuntimeConfig('api', {DATABASE_URL, STRUIINFO_HOST: host}),
    ).toThrow('STRUIINFO_HOST');
  });

  it('rejects an unsupported log level', () => {
    expect(() =>
      parseRuntimeConfig('api', {
        DATABASE_URL,
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
