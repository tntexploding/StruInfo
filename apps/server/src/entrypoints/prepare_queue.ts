import {materializeExternalSecretEnvironment} from '../config/external_secret_environment.js';
import {parseMigrationConfig} from '../platform/database/migrations/migration_config.js';
import {createNodePostgresPool} from '../platform/database/postgresql/postgres_pool.js';
import {preparePgBossSchema} from '../queue/prepare_pg_boss_schema.js';
import {SystemPgBossFactory} from '../queue/pg_boss_runtime.js';

async function main(): Promise<void> {
  let pool: ReturnType<typeof createNodePostgresPool> | undefined;
  let outcome: 'succeeded' | 'failed';
  try {
    const environment = materializeExternalSecretEnvironment(process.env);
    const config = parseMigrationConfig(environment);
    pool = createNodePostgresPool(config.connection);
    await preparePgBossSchema({factory: new SystemPgBossFactory(), pool});
    outcome = 'succeeded';
  } catch {
    outcome = 'failed';
  }
  if (pool !== undefined) {
    try {
      await pool.end();
    } catch {
      outcome = 'failed';
    }
  }
  process.stdout.write(
    `${JSON.stringify({event: 'queue_schema_preparation_completed', outcome})}\n`,
  );
  process.exitCode = outcome === 'succeeded' ? 0 : 1;
}

void main();
