import {MigrationFailure} from './migration_log.js';
import {
  decodePostgresConnectionUrl,
  PostgresConnectionConfigError,
  type PostgresConnectionConfig,
} from '../postgresql/postgres_connection_config.js';

export const MIGRATION_DATABASE_URL_VARIABLE =
  'STRUIINFO_MIGRATION_DATABASE_URL';

export interface MigrationConfig {
  readonly connection: Readonly<PostgresConnectionConfig>;
}

export function parseMigrationConfig(
  environment: Readonly<Record<string, string | undefined>>,
): Readonly<MigrationConfig> {
  const raw = environment.STRUIINFO_MIGRATION_DATABASE_URL;
  if (raw === undefined || raw.trim() === '') {
    throw new MigrationFailure({
      event: 'migration_credential_missing',
      outcome: 'failed',
    });
  }

  let connection: Readonly<PostgresConnectionConfig>;
  try {
    connection = decodePostgresConnectionUrl(raw, 'migrator');
  } catch (error) {
    if (!(error instanceof PostgresConnectionConfigError)) {
      throw error;
    }
    throw new MigrationFailure({
      event: 'migration_credential_invalid',
      outcome: 'failed',
    });
  }
  return Object.freeze({connection});
}
