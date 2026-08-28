import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

import {NodeMigrationFileSystem} from '../platform/database/migrations/migration_files.js';
import {JsonMigrationLogger} from '../platform/database/migrations/migration_log.js';
import {
  NodeProcessExitDecision,
  runMigrationProcess,
} from '../platform/database/migrations/migration_process.js';
import {PgMigrationConnector} from '../platform/database/migrations/postgres_migration_connection.js';
import {materializeExternalSecretEnvironment} from '../config/external_secret_environment.js';

const migrationRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../migrations',
);
const logger = new JsonMigrationLogger({
  writeLine: (line) => {
    process.stdout.write(`${line}\n`);
  },
});

async function main(): Promise<void> {
  let environment: Readonly<Record<string, string | undefined>>;
  try {
    environment = materializeExternalSecretEnvironment(process.env);
  } catch {
    logger.write({event: 'migration_credential_invalid', outcome: 'failed'});
    process.exitCode = 1;
    return;
  }
  await runMigrationProcess({
    environment,
    migrationRoots: [migrationRoot],
    fileSystem: new NodeMigrationFileSystem(),
    connector: new PgMigrationConnector(),
    logger,
    exitDecision: new NodeProcessExitDecision(),
  });
}

void main();
