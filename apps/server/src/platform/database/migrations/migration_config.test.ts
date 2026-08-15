import {describe, expect, it} from 'vitest';

import {
  MIGRATION_DATABASE_URL_VARIABLE,
  parseMigrationConfig,
} from './migration_config.js';
import {MigrationFailure} from './migration_log.js';

describe('parseMigrationConfig', () => {
  it.each(['postgres:', 'postgresql:'])(
    'accepts an immutable %s migration credential',
    (protocol) => {
      const databaseUrl = `${protocol}//struinfo_tm2_migrator:synthetic@localhost/struinfo`;
      const config = parseMigrationConfig({
        STRUIINFO_MIGRATION_DATABASE_URL: databaseUrl,
      });

      expect(config.connection).toEqual({
        host: 'localhost',
        port: 5432,
        database: 'struinfo',
        user: 'struinfo_tm2_migrator',
        password: 'synthetic',
        ssl: false,
        application_name: 'struinfo-tm2-migrator',
        options: '-c role=none -c search_path=pg_catalog',
      });
      expect(Object.getPrototypeOf(config.connection)).toBeNull();
      expect(Object.isFrozen(config)).toBe(true);
    },
  );

  it('fails closed when the migration credential is missing', () => {
    expect(() => parseMigrationConfig({})).toThrow(
      expect.objectContaining({
        record: {
          event: 'migration_credential_missing',
          outcome: 'failed',
        },
      }),
    );
  });

  it('fails closed when the migration credential is blank', () => {
    expect(() =>
      parseMigrationConfig({STRUIINFO_MIGRATION_DATABASE_URL: ' \t '}),
    ).toThrow(
      expect.objectContaining({
        record: {
          event: 'migration_credential_missing',
          outcome: 'failed',
        },
      }),
    );
  });

  it.each([
    'https://migration:synthetic@localhost/struinfo',
    'postgresql:///struinfo',
    'not-a-url',
    ' postgresql://struinfo_tm2_migrator:synthetic@localhost/struinfo',
  ])('rejects the invalid migration credential %s', (databaseUrl) => {
    expect(() =>
      parseMigrationConfig({
        STRUIINFO_MIGRATION_DATABASE_URL: databaseUrl,
      }),
    ).toThrow(
      expect.objectContaining({
        record: {
          event: 'migration_credential_invalid',
          outcome: 'failed',
        },
      }),
    );
  });

  it('never reads DATABASE_URL and does not use it as a fallback', () => {
    let ordinaryCredentialRead = false;
    const environment = new Proxy<Readonly<Record<string, string | undefined>>>(
      {},
      {
        get: (target, property, receiver) => {
          if (property === 'DATABASE_URL') {
            ordinaryCredentialRead = true;
            throw new Error('DATABASE_URL must not be read.');
          }
          return Reflect.get(target, property, receiver) as string | undefined;
        },
      },
    );

    expect(() => parseMigrationConfig(environment)).toThrow(MigrationFailure);
    expect(ordinaryCredentialRead).toBe(false);
  });

  it('uses an actionable stable variable name without retaining its value', () => {
    const secret = 'synthetic-migration-secret';
    let failure: unknown;
    try {
      parseMigrationConfig({
        STRUIINFO_MIGRATION_DATABASE_URL: `https://${secret}@localhost/struinfo`,
      });
    } catch (error) {
      failure = error;
    }

    expect(MIGRATION_DATABASE_URL_VARIABLE).toBe(
      'STRUIINFO_MIGRATION_DATABASE_URL',
    );
    expect(String(failure)).not.toContain(secret);
    expect(failure).toBeInstanceOf(MigrationFailure);
  });
});
