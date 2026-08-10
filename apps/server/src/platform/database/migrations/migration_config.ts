import {MigrationFailure} from './migration_log.js';

export const MIGRATION_DATABASE_URL_VARIABLE =
  'STRUIINFO_MIGRATION_DATABASE_URL';

export interface MigrationConfig {
  readonly databaseUrl: string;
}

export function parseMigrationConfig(
  environment: Readonly<Record<string, string | undefined>>,
): Readonly<MigrationConfig> {
  const databaseUrl = environment.STRUIINFO_MIGRATION_DATABASE_URL;
  if (databaseUrl === undefined || databaseUrl.trim() === '') {
    throw new MigrationFailure({
      event: 'migration_credential_missing',
      outcome: 'failed',
    });
  }

  if (databaseUrl !== databaseUrl.trim() || !isPostgreSqlUrl(databaseUrl)) {
    throw new MigrationFailure({
      event: 'migration_credential_invalid',
      outcome: 'failed',
    });
  }

  return Object.freeze({databaseUrl});
}

function isPostgreSqlUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    const supportedProtocol =
      parsed.protocol === 'postgres:' || parsed.protocol === 'postgresql:';
    return supportedProtocol && parsed.hostname !== '';
  } catch {
    return false;
  }
}
